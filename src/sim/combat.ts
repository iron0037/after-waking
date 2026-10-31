/**
 * Combat v1 (M3): pirates. As you fold out of a system with cargo aboard, a raider may hail you.
 * Pay, talk, run, or fight a short battle of simultaneous turns on three range bands.
 * Deterministic: every roll goes through the state's RNG. See docs/game_design.md (Combat v1).
 */
import { changeRep } from "./reputation";
import { clanMods } from "./clan";
import {
  HEAD_BOUNTY,
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
import { awardXp, officerAt, raiderRecruit, stationLevel, type Recruit } from "./crew";
import { STATIONS, type Station } from "../data/crew";
import { addCargo } from "./ship";
import { COMMODITIES, ORE_IDS, GAS_IDS } from "../data/commodities";
import { sellPrice } from "./economy";
import { INTREPID_POS } from "./galaxy";
import { effectiveStats, hasPerk } from "./perks";
import { fail, ok, type Result } from "./result";
import { removeCargo } from "./ship";
import { advanceTime, log, withRng, type GameState } from "./state";
import { DAY, dist } from "./units";
import type { World } from "./world";
import type { FlightTarget } from "./actions";
import { rngFor } from "./rng";

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

export type EncounterOutcome = "paid" | "talked off" | "escaped" | "slipped past" | "won" | "driven off" | "surrendered" | "overwhelmed";

/** What you take when a raider strikes to you: salvage, their captain, their hold, their crew. */
export interface Prize {
  salvage: number;
  captainBounty: number;
  loot: Partial<Record<CommodityId, number>>;
  /** Raider crew besides the captain; the promising ones could serve aboard a ship of yours. */
  captives: number;
  promising: Recruit[];
}

export interface Encounter {
  /** contact: met in flight, nobody has slowed yet (AW-20). hail: they've made their demand. */
  stage: "contact" | "hail" | "battle" | "prize";
  /** In-system contacts: where you were headed, and whether your sensors saw them first. */
  resume?: FlightTarget;
  destName?: string;
  spottedFirst?: boolean;
  /** Extra flight time a wide berth costs. */
  detourMinutes?: number;
  prize?: Prize;
  /** Everybody's experience when the encounter began, to report what the fight taught them. */
  xpStart?: Partial<Record<Station, number>>;
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
  /** Experience each station gained over the encounter. */
  xp?: Partial<Record<Station, number>>;
  /** Plunder taken from a beaten raider's hold, and former raiders sent to the hiring hall. */
  loot?: Partial<Record<CommodityId, number>>;
  recruited?: string[];
  /** Met in flight: the flight to pick back up, and its name. */
  resume?: FlightTarget;
  resumeName?: string;
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
/**
 * How busy a system's lanes are with raiders, before your hold and your stay are counted (playtest 12):
 * none at the home stars (Helm patrols them), most at the charted stars where the traffic is, then
 * thinning out through uncharted space until, far out, there's nobody worth robbing (pirate bases are
 * the exception, AW-169; aliens take over out there, M6).
 */
export function pirateActivity(world: World, systemId: string): number {
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  if (!sys || sys.home) return 0;
  if (sys.charted) return RAID_BASE;
  const ly = dist(sys.pos, INTREPID_POS);
  const fade = Math.max(0, Math.min(1, (RAID_FADE_END_LY - ly) / (RAID_FADE_END_LY - RAID_FADE_START_LY)));
  return RAID_BASE * 0.85 * fade;
}

/** Raiders' base chance at a busy charted star, and where uncharted space thins them out to nothing. */
export const RAID_BASE = 0.22;
export const RAID_FADE_START_LY = 11;
export const RAID_FADE_END_LY = 22;

/** The longer you work a system, the likelier someone notices: x0.5 for a quick visit, up to x2 after two months. */
export function lingerFactor(state: GameState): number {
  const days = (state.time - (state.systemArrivedAt ?? state.time)) / DAY;
  return Math.max(0.5, Math.min(2, 0.5 + days / 40));
}

/** Chance that a raider is waiting as you fold out of this system with what's in the hold. */
export function interdictionChance(state: GameState, world: World, systemId: string): number {
  return pirateActivity(world, systemId) * Math.min(1.5, holdValue(state) / 10_000) * lingerFactor(state) * clanMods(state).raidChance;
}

export type PirateIntel = { level: "unknown" | "patrolled" | "quiet" | "low" | "moderate" | "high"; label: string; text: string; raiders: string[] };

/**
 * What the Intrepid's captains say about raiders at a star, for the star map. Only charted stars and
 * ones you've visited have reports; out past that, nobody knows.
 */
export function pirateIntel(state: GameState, world: World, systemId: string): PirateIntel {
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  if (!sys) return { level: "unknown", label: "No intel", text: "", raiders: [] };
  if (sys.home) return { level: "patrolled", label: "Patrolled", text: "Helm patrols the home stars. Raiders stay away.", raiders: [] };
  if (!sys.charted && !state.visitedSystems.includes(sys.id)) {
    return { level: "unknown", label: "No intel", text: "Nobody's been out here to say. Raiders, or worse, could be anywhere.", raiders: [] };
  }
  const a = pirateActivity(world, systemId);
  const raiders = raiderMix(sys.charted, dist(sys.pos, INTREPID_POS), null)
    .filter(([, w]) => w > 0)
    .map(([r]) => r.name);
  if (a <= 0) return { level: "quiet", label: "Quiet", text: "Too far out for raiders: there's nobody to rob.", raiders: [] };
  const level = a >= RAID_BASE * 0.95 ? "high" : a >= RAID_BASE * 0.5 ? "moderate" : "low";
  const label = level === "high" ? "Raiders active" : level === "moderate" ? "Some raiders" : "Few raiders";
  const where = sys.charted ? "Busy lanes draw raiders." : "Traffic thins out here, and so do the raiders.";
  return { level, label, text: `${where} The longer you stay and the richer your hold, the likelier they find you.`, raiders };
}

/**
 * Which raiders work a star: skiffs and gunboats in the busy charted lanes, heavier ships farther out.
 * Against a captain with real guns (`power`), the heavier ships come more often: the pirates send
 * what it takes.
 */
function raiderMix(charted: boolean, ly: number, power: number | null): (readonly [RaiderTemplate, number])[] {
  const base: Record<string, number> = charted
    ? { skiff: 3, gunboat: 1.5, corsair: 0.5, marauder: 0.2 }
    : { skiff: 2, gunboat: 2, corsair: 1 + Math.max(0, ly - 8) * 0.2, marauder: 0.4 };
  const hunt = power === null ? 0 : Math.max(0, Math.min(3, (power - 8) / 8));
  return RAIDERS.map((r) => {
    const w = base[r.id] ?? 0;
    const heavy = power !== null && sidePower(raiderSide(r)) >= power * 0.7;
    return [r, w * (heavy ? 1 + hunt : 1)] as const;
  });
}

function pickRaider(rng: { weighted<T>(items: readonly (readonly [T, number])[]): T }, charted: boolean, ly: number, power: number): RaiderTemplate {
  return rng.weighted(raiderMix(charted, ly, power));
}

/**
 * Called as the fold drive spools up. Returns the raider's description if one hails you (and
 * sets state.encounter), or null. Each departure rolls once.
 */
export function maybeInterdict(state: GameState, world: World, fromId: string): string | null {
  if (state.encounter || state.interdictionClear === fromId) return null;
  state.interdictionClear = fromId;
  // Wake Masking (navigation): a fainter fold wake, so fewer raiders are waiting for it.
  const chance = interdictionChance(state, world, fromId) * (hasPerk(state, "wake-masking") ? 0.65 : 1);
  if (chance <= 0) return null;
  const sys = world.galaxy.systems.find((s) => s.id === fromId);
  if (!sys) return null;
  const ly = dist(sys.pos, INTREPID_POS);
  const picked = withRng(state, (rng) => {
    if (rng.next() >= chance) return null;
    const r = pickRaider(rng, sys.charted, ly, sidePower(playerSide(state)));
    if (!willAttack(r, state, rng.next())) return null;
    return { r, cap: rng.pick(RAIDER_CAPTAINS), demand: rng.range(0.15, 0.3) };
  });
  if (!picked) return null;
  const { r, cap, demand } = picked;
  state.encounter = {
    stage: "hail",
    raider: r.id,
    raiderName: r.name,
    captain: cap,
    bounty: r.bounty,
    nerve: r.nerve,
    enemy: raiderSide(r),
    demand,
    range: 2,
    turn: 0,
    talked: false,
    systemId: fromId,
    xpStart: xpSnapshot(state),
    log: [`A ${r.name} drops out of the glare of ${sys.name}. Captain ${cap} hails: "Heave to and hand over ${Math.round(demand * 100)}% of that hold, and nobody gets hurt."`],
  };
  log(state, "warning", `Interdicted leaving ${sys.name}: a ${r.name} under ${cap} demands a share of the hold.`);
  return `A ${r.name}`;
}

// --- contacts in flight (AW-20) -----------------------------------------------------------------

/** Share of a departure's raid chance that each in-system leg carries (scaled by the leg's length). */
export const IN_SYSTEM_RAID_SHARE = 0.35;

export interface RouteContact {
  /** How far along the burn they're met (0..1). */
  fraction: number;
  raider: string;
}

/**
 * Is a raider lurking on this route? Deterministic for the day, the route and the visit, so the flight
 * plan can show where the burn will stop (and the same route today meets the same raider).
 * One raider per system visit: after an encounter here, the rest of the visit is clear.
 */
export function routeContact(state: GameState, world: World, systemId: string, distanceAU: number, routeKey: string): RouteContact | null {
  if (state.encounter || state.interdictionClear === systemId) return null;
  const chance = interdictionChance(state, world, systemId) * IN_SYSTEM_RAID_SHARE * Math.min(1, distanceAU / 2);
  if (chance <= 0) return null;
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  const rng = rngFor(state.seed, "contact", systemId, routeKey, state.stats.folds, Math.floor(state.time / DAY));
  if (rng.next() >= chance) return null;
  const r = pickRaider(rng, sys.charted, dist(sys.pos, INTREPID_POS), sidePower(playerSide(state)));
  if (!willAttack(r, state, rng.next())) return null;
  return { fraction: rng.range(0.3, 0.75), raider: r.id };
}

/** Even outgunned, some raiders attack anyway: desperate, drunk or proud (playtest 12). */
export const RECKLESS_RAIDERS = 0.12;

/** Raiders size you up first: a ship that outguns them is rarely worth the risk, but some try anyway. */
function willAttack(r: RaiderTemplate, state: GameState, roll: number): boolean {
  const ratio = sidePower(raiderSide(r)) / sidePower(playerSide(state));
  return ratio >= 1 || roll <= Math.max(RECKLESS_RAIDERS, ratio * ratio * ratio);
}

function raiderSide(r: RaiderTemplate): CombatSide {
  return { hull: r.hull, hullMax: r.hull, laser: r.laser, kinetic: r.kinetic, shields: r.shields, speed: r.speed, damage: { drives: 0, weapons: 0, sensors: 0 } };
}

/** Chance your sensors see a raider before it sees you: the array, the science officer, sensor damage. */
export function spotChance(state: GameState): number {
  const sensors = effectiveStats(state).sensorTier;
  // Early Warning (comms): the listeners hear them first.
  return clamp(0.35 + 0.1 * sensors + 0.03 * stationLevel(state, "science") - shipDamage(state).sensors / 200 + (hasPerk(state, "early-warning") ? 0.2 : 0), 0.1, 0.9);
}

/** The flight stops where the raider is met; the encounter opens at the contact stage. Returns the alert text. */
export function startContact(state: GameState, world: World, systemId: string, contact: RouteContact, target: FlightTarget, destName: string, legMinutes: number): string {
  const r = raiderById(contact.raider) as RaiderTemplate;
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  const rolled = withRng(state, (rng) => ({ cap: rng.pick(RAIDER_CAPTAINS), demand: rng.range(0.15, 0.3), spotted: rng.next() < spotChance(state) }));
  state.interdictionClear = systemId;
  const intro = rolled.spotted
    ? `Long-range contact on your course to ${destName}: a ${r.name}, running dark and holding station. They haven't seen you yet.`
    : `Proximity alarm: a ${r.name} has matched your course to ${destName}, guns out. Captain ${rolled.cap} hails: "Drop to combat speed and hand over ${Math.round(rolled.demand * 100)}% of that hold."`;
  state.encounter = {
    stage: "contact",
    resume: target,
    destName,
    spottedFirst: rolled.spotted,
    detourMinutes: Math.round(legMinutes * 0.25),
    raider: r.id,
    raiderName: r.name,
    captain: rolled.cap,
    bounty: r.bounty,
    nerve: r.nerve,
    enemy: raiderSide(r),
    demand: rolled.demand,
    range: 2,
    turn: 0,
    talked: false,
    systemId,
    xpStart: xpSnapshot(state),
    log: [intro],
  };
  log(state, "warning", `Raider contact in ${sys?.name ?? "the system"}: a ${r.name} on the way to ${destName}.`);
  return rolled.spotted ? `Contact: a ${r.name} ahead on your course.` : `A ${r.name} has matched your course.`;
}

export type ContactChoice = "slip" | "run" | "hail" | "engage";

/** Odds for each answer to a contact, for the UI. Slipping past needs you to have seen them first. */
export function contactOdds(state: GameState): { slip: number | null; run: number } {
  const e = state.encounter;
  if (!e || e.stage !== "contact") return { slip: null, run: 0 };
  // Pursuit Course (navigation): the navigator reads their intercept and plots around it.
  const pursuit = hasPerk(state, "pursuit-course");
  const slip = e.spottedFirst
    ? clamp(0.5 + 0.05 * stationLevel(state, "navigation") + 0.03 * stationLevel(state, "science") - shipDamage(state).sensors / 200 + (pursuit ? 0.1 : 0), 0.1, 0.95)
    : null;
  // At a quarter light-speed nothing can fight; they have to match your burn, which is easier if they saw you coming.
  const run = clamp(hailOdds(state).run + (e.spottedFirst ? 0.15 : 0) + (pursuit ? 0.15 : 0), 0.05, 0.95);
  return { slip, run };
}

/**
 * Answer a contact in flight:
 * - slip: steer a wide berth around them (only if you saw them first); costs a quarter of the leg.
 * - run: hold your cruise burn and make them catch you; failing that, they force a fight.
 * - hail: drop to combat speed and talk (they make their demand: the usual hail).
 * - engage: drop to combat speed and run out the guns at long range.
 */
export function answerContact(state: GameState, choice: ContactChoice): Result<EncounterResult | null> {
  const e = state.encounter;
  if (!e || e.stage !== "contact") return fail("There's no contact to answer.");
  const odds = contactOdds(state);
  const toHail = (text: string) => {
    e.stage = "hail";
    e.log.push(text);
  };
  switch (choice) {
    case "slip": {
      if (odds.slip === null) return fail("They've already seen you.");
      advanceTime(state, e.detourMinutes ?? 30);
      awardXp(state, "navigation", 8);
      awardXp(state, "science", 3);
      if (withRng(state, (rng) => rng.next()) < odds.slip) {
        return ok(finish(state, "slipped past", `You swing wide and run quiet. The ${e.raiderName} never sees you. ${clearText(e)}`, 0, 0));
      }
      toHail(`They spot your drive flare. The ${e.raiderName} matches course, and Captain ${e.captain} hails: "Nice try. ${Math.round(e.demand * 100)}% of the hold."`);
      return ok(null);
    }
    case "run": {
      awardXp(state, "navigation", 8);
      if (withRng(state, (rng) => rng.next()) < odds.run) {
        return ok(finish(state, "escaped", `You hold your burn at a quarter light-speed and the ${e.raiderName} can't match it. ${clearText(e)}`, 0, 0));
      }
      startBattle(e, 1, `The ${e.raiderName} matches your burn and forces you down to combat speed. They open fire at medium range.`);
      return ok(null);
    }
    case "hail":
      advanceTime(state, 10);
      toHail(
        e.spottedFirst
          ? `You drop to combat speed and hail. Captain ${e.captain} of the ${e.raiderName} answers: "Generous of you to stop. ${Math.round(e.demand * 100)}% of the hold."`
          : `You drop to combat speed and answer. Captain ${e.captain} repeats the demand: ${Math.round(e.demand * 100)}% of the hold.`,
      );
      return ok(null);
    case "engage":
      advanceTime(state, 10);
      startBattle(e, 2, e.spottedFirst ? `You drop to combat speed and come at them out of the dark, guns run out at long range.` : `You drop to combat speed and run out your guns. Long range.`);
      return ok(null);
  }
}

function clearText(e: Encounter): string {
  return e.resume ? `Back on course for ${e.destName}.` : "The way out is clear; fold when ready.";
}

// --- leaving it to the officers ---------------------------------------------------------------

export type AutoMode = "fight" | "run";

/** The orders your officers give if you leave the battle to them (auto-fight or auto-run). */
export function autoOrders(state: GameState, mode: AutoMode): Orders {
  const e = state.encounter;
  const me = playerSide(state);
  if (!e) return { helm: "hold", guns: "hold", engineering: "repair", comms: "quiet" };
  const them = e.enemy;
  const noGuns = me.damage.weapons >= 100 || me.laser + me.kinetic <= 0;
  const drivesDead = me.damage.drives >= 100;
  const worst = SYSTEMS.reduce((a, b) => (me.damage[b] > me.damage[a] ? b : a));
  const target = (t: FireTarget): FireTarget => (t !== "hull" && them.damage[t] >= 100 ? "hull" : t);
  if (mode === "run") {
    return {
      helm: drivesDead ? "evade" : "open",
      guns: noGuns ? "hold" : target("drives"),
      engineering: me.damage.drives >= 10 ? "repair" : me.shields > 0 ? "shields" : "repair",
      comms: "quiet",
    };
  }
  const beaten = them.hull / them.hullMax < e.nerve || them.damage.weapons >= 70;
  const losing = me.hull / me.hullMax < 0.25 && them.hull / them.hullMax > 0.5;
  // Laser-armed ships stay out of a kinetic battery's reach; kinetic ships close in.
  const helm: Orders["helm"] = drivesDead
    ? "hold"
    : losing
      ? "open"
      : me.kinetic > 0 && e.range > 0
        ? "close"
        : me.kinetic === 0 && them.kinetic > 0 && e.range < 2
          ? "open"
          : "hold";
  const outgunned = them.laser + them.kinetic > (me.laser + me.kinetic) * 1.3;
  return {
    helm,
    guns: noGuns ? "hold" : target(outgunned && them.damage.weapons < 70 ? "weapons" : "hull"),
    engineering: noGuns || me.damage[worst] >= 40 ? "repair" : me.shields > 0 && outgunned ? "shields" : "guns",
    comms: beaten ? "demand" : "quiet",
  };
}

/**
 * One step of an encounter left to the officers: answer the contact or hail, or fight a turn.
 * Stops (fails) at the prize: what to do with captives is the captain's call.
 */
export function autoStep(state: GameState, mode: AutoMode): Result<EncounterResult | null> {
  const e = state.encounter;
  if (!e) return fail("There's no encounter.");
  switch (e.stage) {
    case "contact": {
      if (mode === "fight") return answerContact(state, "engage");
      const odds = contactOdds(state);
      return answerContact(state, odds.slip !== null && odds.slip >= odds.run ? "slip" : "run");
    }
    case "hail":
      return answerHail(state, mode === "fight" ? "fight" : "run");
    case "battle": {
      const r = combatTurn(state, autoOrders(state, mode));
      return r.ok ? ok(r.value.result) : fail(r.reason);
    }
    case "prize":
      return fail("The prize is yours to settle.");
  }
}

// --- the hail -------------------------------------------------------------------------------

export type HailChoice = "pay" | "talk" | "run" | "fight";

/** Odds for each answer to the hail, for the UI. */
export function hailOdds(state: GameState): { talk: number; run: number } {
  const e = state.encounter;
  if (!e) return { talk: 0, run: 0 };
  const me = playerSide(state);
  // Silver Tongue (captain) talks raiders down; Early Warning (comms) gives the run a head start.
  const talk = clamp(0.2 + 0.06 * stationLevel(state, "comms") + 0.03 * stationLevel(state, "captain") + (hasPerk(state, "silver-tongue") ? 0.15 : 0), 0.05, 0.9);
  const run = clamp(
    0.3 + 0.05 * stationLevel(state, "navigation") + (me.speed - e.enemy.speed) * 1.5 - me.damage.drives / 200 + (hasPerk(state, "early-warning") ? 0.05 : 0),
    0.05,
    0.9,
  );
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
      if (r < odds.run) return ok(finish(state, "escaped", `Hard burn for open space: you outrun the ${e.raiderName}. ${clearText(e)}`, 0, 0));
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
  const { helm: theirHelm, guns: theirGuns } = enemyIntent(state, orders.helm);

  // 1. Maneuver: opposite wishes are settled by speed.
  const want = (h: Orders["helm"]) => (h === "close" ? -1 : h === "open" ? 1 : 0);
  const mine = want(orders.helm);
  const theirs = want(theirHelm);
  // Evasive Pilot (navigation) wins more maneuvers; Overdrive (engineering) pushes the drives when breaking away.
  const overdrive = orders.helm === "open" && hasPerk(state, "overdrive");
  const mySpeed = (me.speed * (1 - me.damage.drives / 100) + 0.03 * nav + (hasPerk(state, "evasive-pilot") ? 0.1 : 0)) * (overdrive ? 1.4 : 1);
  if (overdrive && withRng(state, (rng) => rng.next()) < 0.25) {
    me.damage.drives = Math.min(100, me.damage.drives + 10);
    say("Overdrive strains the drives.");
  }
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
      return ok({ lines, result: finish(state, "escaped", `You open the range past their guns and lose the ${e.raiderName} in the glare. ${clearText(e)}`, 0, 0) });
    }
    if ((winner === "them" || winner === "both") && theirs > 0) {
      return ok({ lines, result: finish(state, "driven off", `Badly hurt, the ${e.raiderName} breaks off and runs. No bounty, but the hold is yours.`, 0, 0) });
    }
  }
  e.range = Math.max(0, Math.min(2, before + move)) as RangeBand;
  if (e.range !== before) say(`Range ${RANGE_NAMES[before]} to ${RANGE_NAMES[e.range]}.`);

  // 2. Engineering before the guns: shields up or guns hot.
  // Shield Tuning (engineering) and Field Theory (science) stiffen the screens; Fire Control (engineering) hits harder.
  const myShields = me.shields * (orders.engineering === "shields" ? 1.6 : 1) * (hasPerk(state, "shield-tuning") ? 1.15 : 1) * (hasPerk(state, "field-theory") ? 1.15 : 1);
  const myGunBoost = (orders.engineering === "guns" ? 1.25 : 1) * (hasPerk(state, "fire-control") ? 1.1 : 1);
  const aimBonus = (hasPerk(state, "fire-control") ? 0.05 : 0) + (hasPerk(state, "field-theory") ? 0.03 : 0);

  // 3. Fire, both at once.
  const evadeMe = orders.helm === "evade" ? 0.15 + 0.01 * nav + (hasPerk(state, "evasive-pilot") ? 0.05 : 0) : 0;
  const myAimPenalty = orders.helm === "evade" ? 0.15 : 0;
  const myHits = orders.guns === "hold" || me.damage.weapons >= 100 ? [] : volley(state, me, e.range, 0.02 * sci - myAimPenalty + aimBonus, 0, myGunBoost);
  const theirHits = them.damage.weapons >= 100 ? [] : volley(state, them, e.range, 0, evadeMe, 1);
  const dealt = applyHits(them, myHits, orders.guns === "hold" ? "hull" : orders.guns, them.shields);
  const taken = applyHits(me, theirHits, theirGuns, myShields);
  if (orders.guns !== "hold") say(dealt > 0 ? `Your guns hit for ${Math.round(dealt)}${orders.guns !== "hull" ? ` (their ${orders.guns})` : ""}.` : "Your shots go wide.");
  // Every order trains whoever gave it: the captain commands the guns, science lays them on target,
  // the navigator flies, the engineer fights the fires, comms works the channel.
  if (myHits.length > 0) {
    awardXp(state, "captain", 2 * myHits.length);
    awardXp(state, "science", 2 * myHits.length);
  }
  if (orders.helm !== "hold") awardXp(state, "navigation", 3 + (orders.helm === "evade" && theirHits.length === 0 ? 2 : 0));
  if (orders.engineering !== "repair") awardXp(state, "engineering", 2);
  say(taken > 0 ? `They hit you for ${Math.round(taken)}${theirGuns !== "hull" ? ` (your ${theirGuns})` : ""}.` : "Their fire misses.");

  // 4. Repairs.
  if (orders.engineering === "repair") {
    const fix = 8 + 3 * eng;
    // Drive Repair (engineering): the drives come back twice as fast.
    const driveFix = hasPerk(state, "drive-repair") ? 2 : 1;
    const worst = SYSTEMS.reduce((a, b) => (me.damage[b] > me.damage[a] ? b : a));
    if (me.damage[worst] >= 10) {
      me.damage[worst] = Math.max(0, me.damage[worst] - fix * (worst === "drives" ? driveFix : 1));
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

/**
 * They strike: board and take the prize (combat v1.1). The encounter stays open at the "prize" stage
 * until the captain decides what to do with the raider crew (claimPrize). Returns null: not over yet.
 */
function won(state: GameState, text: string): EncounterResult | null {
  const e = state.encounter as Encounter;
  awardXp(state, "captain", 40);
  const template = raiderById(e.raider);
  const prize = withRng(state, (rng) => {
    const loot: Partial<Record<CommodityId, number>> = {};
    const lootT = template ? rng.range(template.lootT[0], template.lootT[1]) : 5;
    // Their plunder: a few goods taken off other captains, valuable ones more often.
    const goods = [...ORE_IDS.filter((id) => id !== "waterIce"), ...GAS_IDS];
    const picks = rng.int(1, 3);
    for (let i = 0; i < picks; i++) {
      const id = rng.weighted(goods.map((g) => [g, Math.sqrt(COMMODITIES[g].basePrice)] as const));
      const t = Math.round((lootT / picks) * (COMMODITIES[id].basePrice > 400 ? 0.25 : 1) * 10) / 10;
      loot[id] = (loot[id] ?? 0) + t;
    }
    const captives = template ? rng.int(template.crew[0], template.crew[1]) : 2;
    const promisingCount = Math.min(captives, rng.chance(0.5) ? 2 : 1);
    const promising = Array.from({ length: promisingCount }, (_, i) => raiderRecruit(rng, `x${Math.floor(state.time)}-${i}`, state.time));
    return { salvage: e.bounty, captainBounty: template?.captainBounty ?? 1_000, loot, captives, promising };
  });
  e.stage = "prize";
  e.prize = prize;
  e.log.push(`${text} You board her: ${e.captain} and ${prize.captives} crew in irons, and a hold to search.`);
  return null;
}

export type PrizeChoice = "turnIn" | "recruit";

/**
 * Settle a taken raider. Salvage, the captain's bounty and their hold are yours either way; the crew
 * are either all handed to Helm for the head bounty, or the promising ones are offered a berth and
 * wait for you in the hiring hall (half the signing fee; no head bounty for them).
 */
export function claimPrize(state: GameState, choice: PrizeChoice): Result<EncounterResult> {
  const e = state.encounter;
  if (!e || e.stage !== "prize" || !e.prize) return fail("There's no prize to settle.");
  const p = e.prize;
  const capacity = effectiveStats(state).cargoCapacityT;
  const loot: Partial<Record<CommodityId, number>> = {};
  for (const [id, t] of Object.entries(p.loot) as [CommodityId, number][]) {
    const added = addCargo(state.ship.cargo, id, t, capacity);
    if (added > 0.05) loot[id] = Math.round(added * 10) / 10;
  }
  const recruited = choice === "recruit" ? p.promising : [];
  if (recruited.length > 0) state.recruits = [...(state.recruits ?? []), ...recruited];
  const heads = p.captives - recruited.length;
  const pay = p.salvage + p.captainBounty + heads * HEAD_BOUNTY;
  state.credits += pay;
  state.stats.earned += pay;
  if (recruited.length > 0) awardXp(state, "comms", 10);
  // The law likes a raider taken; the Freebooters like their own given a second chance (AW-22).
  changeRep(state, "helm", heads > 0 ? 5 : 3, `Took the ${e.raiderName}`);
  if (recruited.length > 0) changeRep(state, "freebooters", 4, `Gave ${e.raiderName} crew a berth`);
  const lootText = Object.keys(loot).length > 0 ? ` Their hold gave up ${Object.entries(loot).map(([id, t]) => `${t} t of ${COMMODITIES[id as CommodityId].name.toLowerCase()}`).join(", ")}.` : "";
  const crewText =
    recruited.length > 0
      ? ` ${recruited.map((r) => r.name).join(" and ")} took your offer of a berth instead of a cell; they'll be waiting at the Intrepid's hiring hall.`
      : "";
  const result = finish(
    state,
    "won",
    `Helm pays ${pay.toLocaleString()} cr: ${p.salvage.toLocaleString()} for the ${e.raiderName}, ${p.captainBounty.toLocaleString()} for ${e.captain}${heads > 0 ? `, and ${(heads * HEAD_BOUNTY).toLocaleString()} for ${heads} of the crew` : ""}.${lootText}${crewText}`,
    0,
    pay,
  );
  result.loot = loot;
  result.recruited = recruited.map((r) => r.name);
  return ok(result);
}

/** A side's rough fighting strength, for raiders deciding whether you're worth the risk. */
export function sidePower(side: CombatSide): number {
  return Math.max(0.1, (side.laser * 0.7 + side.kinetic * 0.6 + side.shields * 0.8) * Math.sqrt(Math.max(1, side.hull) / 100));
}

function xpSnapshot(state: GameState): Partial<Record<Station, number>> {
  const out: Partial<Record<Station, number>> = { captain: state.captain.xp ?? 0 };
  for (const s of STATIONS) if (s !== "captain") out[s] = officerAt(state, s)?.xp ?? 0;
  return out;
}

function finish(state: GameState, outcome: EncounterOutcome, text: string, cargoLost: number, bounty: number): EncounterResult {
  const e = state.encounter;
  if (e) e.log.push(text);
  state.encounter = undefined;
  awardXp(state, "captain", 10);
  // What the encounter taught each of them.
  const xp: Partial<Record<Station, number>> = {};
  if (e?.xpStart) {
    const now = xpSnapshot(state);
    for (const s of STATIONS) {
      const gained = Math.round((now[s] ?? 0) - (e.xpStart[s] ?? 0));
      if (gained > 0) xp[s] = gained;
    }
  }
  const result: EncounterResult = { outcome, text, cargoLost, bounty, xp, ...(e?.resume ? { resume: e.resume, resumeName: e.destName } : {}) };
  state.lastEncounter = result;
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

// --- order advice (for the UI) ------------------------------------------------------------------

/** For each order, why it would be wasted right now (absent = worth considering). The UI dims these. */
export type OrderAdvice = { [K in keyof Orders]: Partial<Record<Orders[K], string>> };

export function orderAdvice(state: GameState): OrderAdvice {
  const advice: OrderAdvice = { helm: {}, guns: {}, engineering: {}, comms: {} };
  const e = state.encounter;
  if (!e || e.stage !== "battle") return advice;
  const me = playerSide(state);
  const them = e.enemy;
  const noGuns = me.damage.weapons >= 100 || me.laser + me.kinetic <= 0;

  if (me.damage.drives >= 100) {
    advice.helm.close = "Your drives are dead: you can't manoeuvre.";
    advice.helm.open = "Your drives are dead: you can't manoeuvre.";
  } else if (e.range === 0) {
    advice.helm.close = "Already at close range.";
  }

  if (noGuns) {
    for (const t of ["hull", "drives", "weapons", "sensors"] as const) advice.guns[t] = "Your weapons are out.";
  } else {
    for (const t of SYSTEMS) if (them.damage[t] >= 100) advice.guns[t] = `Their ${t} are already wrecked.`;
  }

  if (!SYSTEMS.some((s) => me.damage[s] >= 10) && me.hull >= me.hullMax) advice.engineering.repair = "Nothing aboard needs repair.";
  if (me.shields <= 0) advice.engineering.shields = "No deflector screens fitted.";
  if (noGuns) advice.engineering.guns = "Your weapons are out.";

  const beaten = them.hull / them.hullMax < e.nerve || them.damage.weapons >= 70;
  if (!beaten) advice.comms.demand = "They aren't beaten yet: they'll laugh at a demand.";
  return advice;
}

// --- repairs at the Intrepid ------------------------------------------------------------------

export function repairQuote(state: GameState): { cost: number; days: number } | null {
  const d = shipDamage(state);
  const points = d.hull * 60 + (d.drives + d.weapons + d.sensors) * 40;
  if (points <= 0) return null;
  const days = 1 + Math.ceil((d.hull + d.drives + d.weapons + d.sensors) / 120);
  // Drive Repair (engineering): the yard work goes in half the time.
  return { cost: Math.round(points / 10) * 10, days: hasPerk(state, "drive-repair") ? Math.max(1, Math.ceil(days / 2)) : days };
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


/**
 * What the raider means to do this turn, given your helm order: run when hurt, close in to use a
 * kinetic battery, and aim to disarm a dangerous ship (or cripple yours if you're running).
 * Read the Enemy (captain) shows it in the battle screen.
 */
export function enemyIntent(state: GameState, playerHelm: Orders["helm"]): { helm: Orders["helm"]; guns: FireTarget } {
  const e = state.encounter as Encounter;
  const me = playerSide(state);
  const them = e.enemy;
  const frac = them.hull / them.hullMax;
  const helm: Orders["helm"] = frac < e.nerve && them.damage.drives < 80 ? "open" : them.kinetic > 0 && e.range > 0 ? "close" : "hold";
  const guns: FireTarget =
    playerHelm === "open" && me.damage.drives < 60 ? "drives" : me.laser + me.kinetic > them.laser + them.kinetic && me.damage.weapons < 60 ? "weapons" : "hull";
  return { helm, guns };
}

/** Read the Enemy (captain): the raider's next move, in words, or null without the perk or outside a battle. */
export function readTheEnemy(state: GameState, playerHelm: Orders["helm"]): string | null {
  const e = state.encounter;
  if (!e || e.stage !== "battle" || !hasPerk(state, "read-the-enemy")) return null;
  const { helm, guns } = enemyIntent(state, playerHelm);
  const move = helm === "open" ? "break away" : helm === "close" ? "close in" : "hold the range";
  const aim = guns === "hull" ? "your hull" : `your ${guns}`;
  return `${e.captain} will ${move} and fire at ${aim}.`;
}
