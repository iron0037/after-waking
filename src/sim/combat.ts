/**
 * Combat v1 (M3): pirates. As you fold out of a system with cargo aboard, a raider may hail you.
 * Pay, talk, run, or fight a short battle of simultaneous turns on three range bands.
 * Deterministic: every roll goes through the state's RNG. See docs/game_design.md (Combat v1).
 */
import {
  KINETIC_HIT,
  LASER_HIT,
  RAIDER_CAPTAINS,
  RAIDERS,
  RANGE_NAMES,
  type FireTarget,
  type RangeBand,
  type RaiderTemplate,
  type ShipSystem,
} from "../data/combat";
import type { CommodityId } from "../data/commodities";
import { awardXp, stationLevel } from "./crew";
import { sellPrice } from "./economy";
import { INTREPID_POS } from "./galaxy";
import { effectiveStats } from "./perks";
import { fail, ok, type Result } from "./result";
import { removeCargo } from "./ship";
import { advanceTime, log, withRng, type GameState } from "./state";
import { DAY, dist } from "./units";
import type { World } from "./world";

const SYSTEMS: readonly ShipSystem[] = ["drives", "weapons", "sensors"];

/** Damage the ship carries between fights: hull points lost, and each system's impairment (0-100). */
export interface ShipDamage {
  hull: number;
  drives: number;
  weapons: number;
  sensors: number;
}

export interface CombatSide {
  hull: number;
  hullMax: number;
  laser: number;
  kinetic: number;
  shields: number;
  speed: number;
  damage: Record<ShipSystem, number>;
}

export type EncounterOutcome = "paid" | "talked off" | "escaped" | "won" | "driven off" | "surrendered" | "overwhelmed";

export interface Encounter {
  stage: "hail" | "battle";
  raider: string;
  raiderName: string;
  captain: string;
  bounty: number;
  nerve: number;
  enemy: CombatSide;
  /** Share of the hold's value they demand. */
  demand: number;
  range: RangeBand;
  turn: number;
  talked: boolean;
  /** The system you were leaving. */
  systemId: string;
  /** What happened, newest last (the UI shows the tail). */
  log: string[];
}

/** How the last encounter ended, for the debrief. */
export interface EncounterResult {
  outcome: EncounterOutcome;
  text: string;
  cargoLost: number;
  bounty: number;
}

export interface Orders {
  helm: "close" | "hold" | "open" | "evade";
  guns: FireTarget | "hold";
  engineering: "repair" | "shields" | "guns";
  comms: "quiet" | "demand" | "strike";
}

// --- the ship's side ------------------------------------------------------------------------

export function shipDamage(state: GameState): ShipDamage {
  return state.ship.damage ?? { hull: 0, drives: 0, weapons: 0, sensors: 0 };
}

export function playerSide(state: GameState): CombatSide {
  const s = effectiveStats(state);
  const d = shipDamage(state);
  return {
    hull: Math.max(0, s.combatHull - d.hull),
    hullMax: s.combatHull,
    laser: s.laserDmg,
    kinetic: s.kineticDmg,
    shields: s.shieldStrength,
    speed: 1,
    damage: { drives: d.drives, weapons: d.weapons, sensors: d.sensors },
  };
}

function saveDamage(state: GameState, side: CombatSide): void {
  state.ship.damage = {
    hull: Math.max(0, Math.round(side.hullMax - side.hull)),
    drives: Math.round(side.damage.drives),
    weapons: Math.round(side.damage.weapons),
    sensors: Math.round(side.damage.sensors),
  };
}

export function holdValue(state: GameState): number {
  return (Object.entries(state.ship.cargo) as [CommodityId, number][]).reduce((sum, [id, t]) => sum + t * sellPrice(state.market, id), 0);
}

// --- interdiction -----------------------------------------------------------------------------

/** Chance that a raider is waiting as you fold out of this system with what's in the hold. */
export function interdictionChance(state: GameState, world: World, systemId: string): number {
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  if (!sys || sys.home) return 0;
  const ly = dist(sys.pos, INTREPID_POS);
  const base = sys.charted ? 0.25 : Math.min(0.5, 0.35 + 0.015 * Math.max(0, ly - 6));
  return base * Math.min(1.5, holdValue(state) / 10_000);
}

function pickRaider(rng: { weighted<T>(items: readonly (readonly [T, number])[]): T }, charted: boolean, ly: number): RaiderTemplate {
  const w = charted ? [3, 1, 0] : [2, 2, 1 + Math.max(0, ly - 8) * 0.2];
  return rng.weighted(RAIDERS.map((r, i) => [r, w[i] ?? 0] as const));
}

/**
 * Called as the fold drive spools up. Returns the raider's description if one hails you (and
 * sets state.encounter), or null. Each departure rolls once.
 */
export function maybeInterdict(state: GameState, world: World, fromId: string): string | null {
  if (state.encounter || state.interdictionClear === fromId) return null;
  state.interdictionClear = fromId;
  const chance = interdictionChance(state, world, fromId);
  if (chance <= 0) return null;
  const sys = world.galaxy.systems.find((s) => s.id === fromId);
  if (!sys) return null;
  const ly = dist(sys.pos, INTREPID_POS);
  const picked = withRng(state, (rng) => (rng.next() < chance ? { r: pickRaider(rng, sys.charted, ly), cap: rng.pick(RAIDER_CAPTAINS), demand: rng.range(0.15, 0.3) } : null));
  if (!picked) return null;
  const { r, cap, demand } = picked;
  state.encounter = {
    stage: "hail",
    raider: r.id,
    raiderName: r.name,
    captain: cap,
    bounty: r.bounty,
    nerve: r.nerve,
    enemy: { hull: r.hull, hullMax: r.hull, laser: r.laser, kinetic: r.kinetic, shields: r.shields, speed: r.speed, damage: { drives: 0, weapons: 0, sensors: 0 } },
    demand,
    range: 2,
    turn: 0,
    talked: false,
    systemId: fromId,
    log: [`A ${r.name} drops out of the glare of ${sys.name}. Captain ${cap} hails: "Heave to and hand over ${Math.round(demand * 100)}% of that hold, and nobody gets hurt."`],
  };
  log(state, "warning", `Interdicted leaving ${sys.name}: a ${r.name} under ${cap} demands a share of the hold.`);
  return `A ${r.name}`;
}

// --- the hail -------------------------------------------------------------------------------

export type HailChoice = "pay" | "talk" | "run" | "fight";

/** Odds for each answer to the hail, for the UI. */
export function hailOdds(state: GameState): { talk: number; run: number } {
  const e = state.encounter;
  if (!e) return { talk: 0, run: 0 };
  const me = playerSide(state);
  const talk = clamp(0.2 + 0.06 * stationLevel(state, "comms") + 0.03 * stationLevel(state, "captain"), 0.05, 0.85);
  const run = clamp(0.3 + 0.05 * stationLevel(state, "navigation") + (me.speed - e.enemy.speed) * 1.5 - me.damage.drives / 200, 0.05, 0.9);
  return { talk, run };
}

export function answerHail(state: GameState, choice: HailChoice): Result<EncounterResult | null> {
  const e = state.encounter;
  if (!e || e.stage !== "hail") return fail("Nobody is hailing you.");
  advanceTime(state, 10);
  const odds = hailOdds(state);
  switch (choice) {
    case "pay": {
      const lost = takeShare(state, e.demand);
      return ok(finish(state, "paid", `You paid ${Math.round(e.demand * 100)}% of the hold (${lost.toFixed(1)} t). The ${e.raiderName} peels away.`, lost, 0));
    }
    case "talk": {
      if (e.talked) return fail("They've heard enough talk.");
      e.talked = true;
      awardXp(state, "comms", 10);
      const r = withRng(state, (rng) => rng.next());
      if (r < odds.talk / 3) return ok(finish(state, "talked off", `Your comms officer convinces ${e.captain} that you're not worth the trouble. They leave.`, 0, 0));
      if (r < odds.talk) {
        e.demand = Math.round((e.demand / 2) * 100) / 100;
        e.log.push(`Some fast talking: ${e.captain} settles for ${Math.round(e.demand * 100)}%.`);
        return ok(null);
      }
      startBattle(e, 1, `${e.captain} isn't amused. The ${e.raiderName} opens fire at medium range.`);
      return ok(null);
    }
    case "run": {
      awardXp(state, "navigation", 8);
      const r = withRng(state, (rng) => rng.next());
      if (r < odds.run) return ok(finish(state, "escaped", `Hard burn for open space: you outrun the ${e.raiderName} and fold clear.`, 0, 0));
      startBattle(e, 0, `The ${e.raiderName} cuts you off. They're on you at close range.`);
      return ok(null);
    }
    case "fight":
      startBattle(e, 2, `You refuse. Both ships run out their guns at long range.`);
      return ok(null);
  }
}

function startBattle(e: Encounter, range: RangeBand, text: string): void {
  e.stage = "battle";
  e.range = range;
  e.log.push(text);
}

// --- the battle -------------------------------------------------------------------------------

export interface TurnReport {
  lines: string[];
  result: EncounterResult | null;
}

/** One turn: both sides' orders resolve together (about ten minutes of game time). */
export function combatTurn(state: GameState, orders: Orders): Result<TurnReport> {
  const e = state.encounter;
  if (!e || e.stage !== "battle") return fail("There's no fight on.");
  advanceTime(state, 10);
  e.turn++;
  const me = playerSide(state);
  const them = e.enemy;
  const lines: string[] = [];
  const say = (t: string) => {
    lines.push(t);
    e.log.push(t);
  };

  if (orders.comms === "strike") {
    const lost = takeShare(state, 0.7);
    return ok({ lines, result: finish(state, "surrendered", `You strike your colours. The ${e.raiderName}'s crew strip ${lost.toFixed(1)} t from the hold and let you go.`, lost, 0) });
  }

  const nav = stationLevel(state, "navigation");
  const sci = stationLevel(state, "science");
  const eng = stationLevel(state, "engineering");
  const comms = stationLevel(state, "comms");

  // Their orders: run when hurt, close in to use a kinetic battery, aim to disarm a dangerous ship.
  const frac = them.hull / them.hullMax;
  const theirHelm: Orders["helm"] = frac < e.nerve && them.damage.drives < 80 ? "open" : them.kinetic > 0 && e.range > 0 ? "close" : "hold";
  const theirGuns: FireTarget =
    orders.helm === "open" && me.damage.drives < 60 ? "drives" : me.laser + me.kinetic > them.laser + them.kinetic && me.damage.weapons < 60 ? "weapons" : "hull";

  // 1. Maneuver: opposite wishes are settled by speed.
  const want = (h: Orders["helm"]) => (h === "close" ? -1 : h === "open" ? 1 : 0);
  const mine = want(orders.helm);
  const theirs = want(theirHelm);
  const mySpeed = me.speed * (1 - me.damage.drives / 100) + 0.03 * nav;
  const theirSpeed = them.speed * (1 - them.damage.drives / 100);
  let move = 0;
  let winner: "me" | "them" | "both" | "none" = "none";
  if (mine !== 0 && theirs !== 0 && mine !== theirs) {
    const iWin = withRng(state, (rng) => rng.next()) < mySpeed / (mySpeed + theirSpeed);
    move = iWin ? mine : theirs;
    winner = iWin ? "me" : "them";
  } else if (mine !== 0 || theirs !== 0) {
    move = mine !== 0 ? mine : theirs;
    winner = mine !== 0 && theirs !== 0 ? "both" : mine !== 0 ? "me" : "them";
  }
  const before = e.range;
  if (move > 0 && before === 2) {
    if ((winner === "me" || winner === "both") && mine > 0 && me.damage.drives < 100) {
      awardXp(state, "navigation", 10);
      return ok({ lines, result: finish(state, "escaped", `You open the range past their guns and fold clear of the ${e.raiderName}.`, 0, 0) });
    }
    if ((winner === "them" || winner === "both") && theirs > 0) {
      return ok({ lines, result: finish(state, "driven off", `Badly hurt, the ${e.raiderName} breaks off and runs. No bounty, but the hold is yours.`, 0, 0) });
    }
  }
  e.range = Math.max(0, Math.min(2, before + move)) as RangeBand;
  if (e.range !== before) say(`Range ${RANGE_NAMES[before]} to ${RANGE_NAMES[e.range]}.`);

  // 2. Engineering before the guns: shields up or guns hot.
  const myShields = me.shields * (orders.engineering === "shields" ? 1.6 : 1);
  const myGunBoost = orders.engineering === "guns" ? 1.25 : 1;

  // 3. Fire, both at once.
  const evadeMe = orders.helm === "evade" ? 0.15 + 0.01 * nav : 0;
  const myAimPenalty = orders.helm === "evade" ? 0.15 : 0;
  const myHits = orders.guns === "hold" || me.damage.weapons >= 100 ? [] : volley(state, me, e.range, 0.02 * sci - myAimPenalty, 0, myGunBoost);
  const theirHits = them.damage.weapons >= 100 ? [] : volley(state, them, e.range, 0, evadeMe, 1);
  const dealt = applyHits(them, myHits, orders.guns === "hold" ? "hull" : orders.guns, them.shields);
  const taken = applyHits(me, theirHits, theirGuns, myShields);
  if (orders.guns !== "hold") say(dealt > 0 ? `Your guns hit for ${Math.round(dealt)}${orders.guns !== "hull" ? ` (their ${orders.guns})` : ""}.` : "Your shots go wide.");
  if (dealt > 0) awardXp(state, "science", 2);
  say(taken > 0 ? `They hit you for ${Math.round(taken)}${theirGuns !== "hull" ? ` (your ${theirGuns})` : ""}.` : "Their fire misses.");

  // 4. Repairs.
  if (orders.engineering === "repair") {
    const fix = 8 + 3 * eng;
    const worst = SYSTEMS.reduce((a, b) => (me.damage[b] > me.damage[a] ? b : a));
    if (me.damage[worst] >= 10) {
      me.damage[worst] = Math.max(0, me.damage[worst] - fix);
      say(`Damage control patches the ${worst}.`);
    } else if (me.hull < me.hullMax) {
      me.hull = Math.min(me.hullMax, me.hull + fix / 2);
      say("Damage control shores up the hull.");
    }
    awardXp(state, "engineering", 3);
  }
  saveDamage(state, me);

  // 5. Endings.
  if (them.hull <= 0) return ok({ lines, result: won(state, `The ${e.raiderName}'s reactor scrams. ${e.captain} strikes their colours.`) });
  if (me.hull <= 0) {
    const lost = takeShare(state, 0.7);
    return ok({ lines, result: finish(state, "overwhelmed", `Your hull won't take more. You strike, and the ${e.raiderName} strips ${lost.toFixed(1)} t from the hold.`, lost, 0) });
  }
  const beaten = them.hull / them.hullMax < e.nerve || them.damage.weapons >= 70;
  if (orders.comms === "demand") {
    awardXp(state, "comms", 2);
    if (beaten && withRng(state, (rng) => rng.next()) < 0.5 + 0.04 * comms) return ok({ lines, result: won(state, `"Enough!" ${e.captain} strikes their colours.`) });
    say(beaten ? `${e.captain} isn't ready to quit.` : `${e.captain} laughs at your demand.`);
  } else if (them.hull / them.hullMax < e.nerve / 2 && withRng(state, (rng) => rng.next()) < 0.5) {
    return ok({ lines, result: won(state, `Holed and burning, the ${e.raiderName} strikes its colours.`) });
  }
  if (e.turn >= 20) return ok({ lines, result: finish(state, "driven off", `After a long fight the ${e.raiderName} gives up and fades into the glare.`, 0, 0) });
  return ok({ lines, result: null });
}

/** Each weapon's chance to hit and damage this turn. */
function volley(state: GameState, side: CombatSide, range: RangeBand, aimBonus: number, evade: number, boost: number): number[] {
  const out: number[] = [];
  const blind = side.damage.sensors / 200;
  const weak = 1 - (side.damage.weapons / 100) * 0.8;
  const guns: [number, readonly number[]][] = [
    [side.laser, LASER_HIT],
    [side.kinetic, KINETIC_HIT],
  ];
  for (const [dmg, table] of guns) {
    if (dmg <= 0) continue;
    const p = clamp((table[range] ?? 0.5) - blind + aimBonus - evade, 0.05, 0.95);
    if (withRng(state, (rng) => rng.next()) < p) out.push(dmg * weak * boost);
  }
  return out;
}

/** Shields soak up to their strength this turn; the rest lands on the target (systems also shake the hull). */
function applyHits(side: CombatSide, hits: number[], target: FireTarget, shields: number): number {
  let pool = shields;
  let total = 0;
  for (const h of hits) {
    const soaked = Math.min(pool, h);
    pool -= soaked;
    const dmg = h - soaked;
    total += dmg;
    if (target === "hull") side.hull -= dmg;
    else {
      side.damage[target] = Math.min(100, side.damage[target] + dmg * 1.6);
      side.hull -= dmg * 0.3;
    }
  }
  side.hull = Math.max(0, side.hull);
  return total;
}

function won(state: GameState, text: string): EncounterResult {
  const e = state.encounter as Encounter;
  state.credits += e.bounty;
  state.stats.earned += e.bounty;
  awardXp(state, "captain", 40);
  return finish(state, "won", `${text} Helm pays a ${e.bounty.toLocaleString()} cr bounty for the ${e.raiderName}.`, 0, e.bounty);
}

function finish(state: GameState, outcome: EncounterOutcome, text: string, cargoLost: number, bounty: number): EncounterResult {
  const e = state.encounter;
  if (e) e.log.push(text);
  state.encounter = undefined;
  const result = { outcome, text, cargoLost, bounty };
  state.lastEncounter = result;
  awardXp(state, "captain", 10);
  log(state, outcome === "won" || outcome === "escaped" || outcome === "talked off" || outcome === "driven off" ? "info" : "warning", text);
  return result;
}

/** Hand over a share of every cargo (by tonnage, so the same share of the value). Returns tonnes lost. */
function takeShare(state: GameState, share: number): number {
  let lost = 0;
  for (const [id, t] of Object.entries(state.ship.cargo) as [CommodityId, number][]) {
    lost += removeCargo(state.ship.cargo, id, Math.round(t * share * 10) / 10);
  }
  return lost;
}

// --- repairs at the Intrepid ------------------------------------------------------------------

export function repairQuote(state: GameState): { cost: number; days: number } | null {
  const d = shipDamage(state);
  const points = d.hull * 60 + (d.drives + d.weapons + d.sensors) * 40;
  if (points <= 0) return null;
  return { cost: Math.round(points / 10) * 10, days: 1 + Math.ceil((d.hull + d.drives + d.weapons + d.sensors) / 120) };
}

/** Put the yard to work on the battle damage: paid up front, done in a day or more. */
export function repairShip(state: GameState): Result<{ cost: number; days: number }> {
  if (state.location.kind !== "intrepid") return fail("Repairs are done in the Intrepid's yard.");
  const q = repairQuote(state);
  if (!q) return fail("Nothing to repair.");
  if ((state.yard ?? []).some((j) => j.kind === "repair")) return fail("The yard is already on it.");
  if (state.credits < q.cost) return fail(`Repairs cost ${q.cost.toLocaleString()} cr.`);
  state.credits -= q.cost;
  state.yard = [...(state.yard ?? []), { kind: "repair", label: "battle damage repairs", readyAt: state.time + q.days * DAY }];
  log(state, "trade", `The yard took on the battle damage: ${q.cost.toLocaleString()} cr, ${q.days} day${q.days === 1 ? "" : "s"}.`);
  return ok(q);
}

export function finishRepairs(state: GameState): void {
  state.ship.damage = undefined;
  log(state, "trade", "The yard finished the repairs. The ship is whole again.");
}

/** Drive damage slows the ship in flight (1 = undamaged). */
export function driveDamageMult(state: GameState): number {
  return 1 + shipDamage(state).drives / 100;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** For tests and tools: the raider templates by id. */
export function raiderById(id: string): RaiderTemplate | undefined {
  return RAIDERS.find((r) => r.id === id);
}

