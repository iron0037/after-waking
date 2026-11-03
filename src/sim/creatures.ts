/**
 * Creatures on the surface (AW-215, AW-216). Where each starts comes from the seed (RegionMap.creatures); where it
 * is now, and what's happened to it, lives in `state.fauna`.
 *
 * - **Roaming.** As time passes while landed, creatures near the vehicle move: skittish ones flee it, hunters come
 *   after it, the rest wander near home. No hunter comes within SAFE_RADIUS of the freighter.
 * - **Fights.** A hunter that gets in reach of the rover's gear (or bites range) starts a fight; the rover defends
 *   itself as it drives. The captain can also order a capture: the rover holds its ground against hunters and chases
 *   down the rest. Fights are worked out here in 10-minute rounds and handed to the UI as a list of events to play.
 * - **Energy.** Every shot and chase step draws rover energy. The rover breaks off while it still has the drive home
 *   plus a margin. If a hunter wrecks it first, it's disabled: the crew is hurt, the load is lost, the ship has to
 *   recover it, and its gear is offline until the Intrepid's yard repairs it.
 * - **Taken alive.** A creature brought down is stunned, never killed. In a capture it goes straight into the
 *   sample cases (if there's room); otherwise it's a pickup, like a plant, for 30 days.
 */
import { CREATURES_BY_ID, CREATURES_BY_NAME, type CreatureEntry } from "../data/creatures";
import { VEHICLE_WEAPONS, type VehicleWeapon } from "../data/vehicleWeapons";
import { awardXp } from "./crew";
import { recordFind } from "./compendium";
import { hexDistance, neighbors } from "./hex";
import { injureCrew, type SeverityWeights } from "./injuries";
import { canEnter, findPath, type Mobility } from "./pathfinding";
import { effectiveStats, hasPerk, roverSpecimenSlots } from "./perks";
import { fail, ok, type Result } from "./result";
import { specimenCount } from "./ship";
import { advanceTime, log, withRng, type GameState, type RoverState } from "./state";
import { rngFor } from "./rng";
import { siteKey, type SiteKey, type SurfaceCreature } from "./bodysurface";
import { stationLevel } from "./crew";
import { DAY, type Vec2 } from "./units";
import { boatMobility, vehicleEnergyMax, vehicleOf } from "./vehicles";
import type { World } from "./world";
import { boatDock } from "./boat";
import { placeName, routeEnergy, roverMobility, shipTile } from "./actions";

/** Hunters never come this close to the freighter, and no fight starts this close to it. */
export const SAFE_RADIUS = 2;
/** Creatures this near the vehicle (or the ship) move as time passes; the rest keep still. */
const AWAKE_RADIUS = 14;
/** A downed creature waits this long to be collected before it's gone. */
export const DOWNED_DAYS = 30;
/** Minutes in a fight round. */
export const ROUND_MINUTES = 10;
const MAX_ROUNDS = 36;
/** Hunters driven off leave the rover alone this long. */
const CALM_MINUTES = 12 * 60;
/** How far a wanderer strays from home. */
const LEASH = 5;

/** What the save remembers about a creature that has moved or been met. */
export interface FaunaState {
  x: number;
  y: number;
  /** Stunning taken, if it's been in a fight. */
  hurt?: number;
  /** When it was brought down (a pickup until DOWNED_DAYS later). */
  downAt?: number;
  /** Collected or expired. */
  gone?: boolean;
  /** Won't hunt the rover again before this. */
  calmUntil?: number;
  /** A docile creature that's been shot at runs like a skittish one. */
  spooked?: boolean;
  /** Fractional hexes of movement owed. */
  move?: number;
}

export interface LiveCreature {
  key: SiteKey;
  region: number;
  entry: CreatureEntry;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  down: boolean;
  /** When it was brought down, if it was. */
  downAt?: number;
  home: Vec2;
}

export type FightMode = "defend" | "capture";

export interface FightEvent {
  round: number;
  kind: "fire" | "net" | "bite" | "chase" | "flee" | "approach" | "retreat" | "down" | "netted" | "escaped" | "breakoff" | "disabled";
  /** Weapon id, for fire and net. */
  weapon?: string;
  hit?: boolean;
  amount?: number;
  rover: Vec2;
  creature: Vec2;
}

export type FightOutcome = "captured" | "down" | "escaped" | "broke off" | "disabled" | "gave up";

export interface FightReport {
  /** Increases with every fight, so the UI knows a new one to play. */
  id: number;
  bodyId: string;
  key: SiteKey;
  species: string;
  mode: FightMode;
  outcome: FightOutcome;
  text: string;
  events: FightEvent[];
  minutes: number;
}

// --- reading creature state ----------------------------------------------------------------------

function faunaOf(state: GameState, bodyId: string): Record<string, FaunaState> {
  state.fauna ??= {};
  return (state.fauna[bodyId] ??= {});
}

function live(state: GameState, bodyId: string, spawn: SurfaceCreature): LiveCreature | null {
  const entry = CREATURES_BY_ID.get(spawn.species);
  if (!entry) return null;
  const f = state.fauna?.[bodyId]?.[spawn.key];
  if (f?.gone) return null;
  if (f?.downAt !== undefined && state.time - f.downAt > DOWNED_DAYS * DAY) return null;
  return {
    key: spawn.key,
    region: spawn.region,
    entry,
    x: f?.x ?? spawn.x,
    y: f?.y ?? spawn.y,
    hp: Math.max(0, entry.hp - (f?.hurt ?? 0)),
    maxHp: entry.hp,
    down: f?.downAt !== undefined,
    ...(f?.downAt !== undefined ? { downAt: f.downAt } : {}),
    home: { x: spawn.x, y: spawn.y },
  };
}

/** Every creature still about within `radius` hexes of `center` (downed ones included, until they expire). */
export function creaturesNear(state: GameState, world: World, bodyId: string, center: Vec2, radius: number): LiveCreature[] {
  const surface = world.surface(bodyId);
  const out: LiveCreature[] = [];
  // Creatures can roam into a neighbouring region, so look a leash further than asked.
  for (const region of surface.regionsNear(center, radius + LEASH + 2)) {
    for (const spawn of surface.creatures(region)) {
      const c = live(state, bodyId, spawn);
      if (c && hexDistance(c, center) <= radius) out.push(c);
    }
  }
  return out;
}

/** One creature by key, if it's still about. */
export function creatureByKey(state: GameState, world: World, bodyId: string, key: SiteKey): LiveCreature | null {
  const spawn = world.surface(bodyId).creature(key);
  return spawn ? live(state, bodyId, spawn) : null;
}

/** Sensor reach on this body (as for deposits): kept here to avoid a cycle with actions. */
function sight(state: GameState): number {
  return Math.max(2, 2 + effectiveStats(state).sensorTier);
}

/** What the crew can see right now: creatures within sensor range of the vehicle or the ship. */
export function visibleCreatures(state: GameState, world: World): LiveCreature[] {
  const loc = state.location;
  if (loc.kind !== "surface") return [];
  const eyes: Vec2[] = [shipTile(state, world)];
  if (loc.rover) eyes.push(loc.rover);
  const r = sight(state) + 2;
  const seen = new Map<string, LiveCreature>();
  for (const eye of eyes) for (const c of creaturesNear(state, world, loc.bodyId, eye, r)) seen.set(c.key, c);
  return [...seen.values()];
}

export function isHunter(c: CreatureEntry): boolean {
  return c.temperament === "hostile" || c.temperament === "territorial";
}

// --- the vehicle's side ----------------------------------------------------------------------------

/** The gear the vehicle can use right now (none while the rover waits for a yard repair). */
export function vehicleWeapons(state: GameState): VehicleWeapon[] {
  if (state.ship.roverWrecked) return [];
  return effectiveStats(state)
    .vehicleWeapons.map((id) => VEHICLE_WEAPONS[id])
    .filter((w): w is VehicleWeapon => !!w);
}

/** Hexes per fight round the vehicle covers when it chases or runs: faster with uprated motors. */
export function vehicleChaseSpeed(state: GameState, v: RoverState): number {
  return vehicleOf(v) === "boat" ? 1 : 1 / Math.max(0.3, effectiveStats(state).roverDriveTime);
}

/** The vehicle's plating, full. */
export function vehicleHullMax(state: GameState): number {
  return effectiveStats(state).roverHull;
}

function hullOf(state: GameState, v: RoverState): number {
  return v.hull ?? vehicleHullMax(state);
}

function dockOf(state: GameState, world: World, v: RoverState): Vec2 {
  return (vehicleOf(v) === "boat" ? boatDock(state, world) : null) ?? shipTile(state, world);
}

function mobilityOf(state: GameState, v: RoverState): Mobility {
  return vehicleOf(v) === "boat" ? boatMobility() : roverMobility(state);
}

/** Energy kept back in any fight: the drive home, plus 15% of a full charge (at least 8). */
export function energyReserve(state: GameState, world: World, v: RoverState): number {
  const loc = state.location;
  if (loc.kind !== "surface") return 0;
  const surface = world.surface(loc.bodyId);
  const home = findPath(surface, v, dockOf(state, world, v), mobilityOf(state, v));
  return routeEnergy(state, home) + Math.max(8, 0.15 * vehicleEnergyMax(state, vehicleOf(v)));
}

function creatureMobility(c: CreatureEntry): Mobility {
  return c.aquatic ? boatMobility() : { canClimb: true, roughAsPlain: true };
}

// --- roaming --------------------------------------------------------------------------------------

/** Step one hex toward (sign 1) or away from (-1) a point, keeping to the creature's ground. */
function stepCreature(world: World, bodyId: string, c: LiveCreature, toward: Vec2, sign: 1 | -1, avoid: Vec2 | null): Vec2 | null {
  const surface = world.surface(bodyId);
  const mob = creatureMobility(c.entry);
  const here = hexDistance(c, toward);
  let best: Vec2 | null = null;
  let bestScore = sign === 1 ? here : -here;
  for (const n of neighbors(c.x, c.y)) {
    if (!canEnter(surface, n.x, n.y, mob)) continue;
    if (avoid && isHunter(c.entry) && hexDistance(n, avoid) <= SAFE_RADIUS) continue;
    const d = hexDistance(n, toward);
    const score = sign === 1 ? d : -d;
    if (score < bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

function setPos(state: GameState, bodyId: string, c: LiveCreature, p: Vec2): void {
  const f = (faunaOf(state, bodyId)[c.key] ??= { x: c.x, y: c.y });
  f.x = p.x;
  f.y = p.y;
  c.x = p.x;
  c.y = p.y;
}

/** Does this creature want the rover right now? */
function hunting(state: GameState, c: LiveCreature, rover: RoverState, ship: Vec2): boolean {
  if (c.down || !isHunter(c.entry)) return false;
  const f = state.fauna?.[state.location.kind === "surface" ? state.location.bodyId : ""]?.[c.key];
  if (f?.calmUntil !== undefined && state.time < f.calmUntil) return false;
  if (hexDistance(rover, ship) <= SAFE_RADIUS) return false;
  if (!!c.entry.aquatic !== (vehicleOf(rover) === "boat")) return false;
  // Territorial creatures only defend their patch.
  if (c.entry.temperament === "territorial") return hexDistance(rover, c.home) <= 3;
  return hexDistance(rover, c) <= c.entry.sense;
}

function fleeing(state: GameState, bodyId: string, c: LiveCreature, rover: RoverState | null): boolean {
  if (c.down || !rover) return false;
  const skittish = c.entry.temperament === "skittish" || !!state.fauna?.[bodyId]?.[c.key]?.spooked;
  return skittish && hexDistance(rover, c) <= c.entry.sense;
}

/** How far the gear reaches now (bites range with nothing aboard). */
function reach(state: GameState): number {
  return Math.max(1, ...vehicleWeapons(state).filter((w) => w.kind !== "net").map((w) => w.range));
}

/**
 * Let `minutes` pass for the creatures near the vehicle. Returns the hunter that has caught up with the rover, if
 * one has (the caller fights it). Called after time passes on the surface.
 */
export function stirCreatures(state: GameState, world: World, minutes: number): LiveCreature | null {
  const loc = state.location;
  if (loc.kind !== "surface" || minutes <= 0) return null;
  const ship = shipTile(state, world);
  const rover = loc.rover && !loc.rover.disabled ? loc.rover : null;
  const center = rover ?? ship;
  let attacker: LiveCreature | null = null;
  const fauna = faunaOf(state, loc.bodyId);
  {
    for (const c of creaturesNear(state, world, loc.bodyId, center, AWAKE_RADIUS)) {
      if (c.down) continue;
      // Its own dice, so wandering creatures never shift the rolls for storms, prices or finds.
      const rng = rngFor(state.seed, loc.bodyId, c.key, Math.floor(state.time));
      const f = (fauna[c.key] ??= { x: c.x, y: c.y });
      f.move = Math.min(30, (f.move ?? 0) + (c.entry.speed * minutes) / 60);
      while (f.move >= 1) {
        f.move -= 1;
        let next: Vec2 | null = null;
        if (rover && hunting(state, c, rover, ship)) {
          if (hexDistance(c, rover) <= Math.max(1, reach(state))) break;
          next = stepCreature(world, loc.bodyId, c, rover, 1, ship);
        } else if (fleeing(state, loc.bodyId, c, rover)) {
          next = stepCreature(world, loc.bodyId, c, rover as RoverState, -1, null);
        } else if (rng.chance(0.35)) {
          const options = neighbors(c.x, c.y).filter(
            (n) => canEnter(world.surface(loc.bodyId), n.x, n.y, creatureMobility(c.entry)) && hexDistance(n, c.home) <= LEASH && (!isHunter(c.entry) || hexDistance(n, ship) > SAFE_RADIUS),
          );
          if (options.length > 0) next = rng.pick(options);
        }
        if (next) setPos(state, loc.bodyId, c, next);
      }
      if (!attacker && rover && hunting(state, c, rover, ship) && hexDistance(c, rover) <= Math.max(1, reach(state))) attacker = c;
    }
  }
  return attacker;
}

// --- fights -----------------------------------------------------------------------------------------

const DANGER_SEVERITY: Record<1 | 2 | 3, SeverityWeights> = { 1: [85, 14, 1], 2: [65, 30, 5], 3: [45, 40, 15] };

/** Why a capture can't start (empty if it can). */
export function captureBlockers(state: GameState, world: World, key: SiteKey): string[] {
  const loc = state.location;
  if (loc.kind !== "surface") return ["Not on a surface."];
  const rover = loc.rover;
  if (!rover) return ["Deploy the rover (or launch the boat) first."];
  if (rover.disabled) return ["The rover is disabled. Recall it."];
  const c = creatureByKey(state, world, loc.bodyId, key);
  if (!c) return ["That creature is gone."];
  if (c.down) return ["It's already down: drive alongside and collect it."];
  if (!!c.entry.aquatic !== (vehicleOf(rover) === "boat")) return [c.entry.aquatic ? "That lives in the water: take the boat out." : "That lives ashore: put the rover ashore."];
  const gear = vehicleWeapons(state);
  if (gear.length === 0) return ["The rover's gear is offline until the Intrepid's yard repairs it."];
  if (!isHunter(c.entry) && hexDistance(rover, c) > 25) return ["Too far off: drive closer first."];
  if (rover.energy < energyReserve(state, world, rover) + 2) return ["Not enough energy to spare for a chase: recharge first."];
  return [];
}

/** The best shot this round: a net when it's the way to take it, else the hardest-hitting stunner in reach. */
function chooseWeapon(gear: VehicleWeapon[], c: LiveCreature, d: number, capture: boolean): VehicleWeapon | null {
  const inReach = gear.filter((w) => w.range >= d);
  const nets = inReach.filter((w) => w.kind === "net").sort((a, b) => b.hit - a.hit);
  const worn = c.hp <= c.maxHp * 0.4;
  if (nets[0] && (capture || !isHunter(c.entry)) && (!isHunter(c.entry) || worn)) return nets[0];
  const stunners = inReach.filter((w) => w.kind !== "net").sort((a, b) => b.damage * b.hit - a.damage * a.hit);
  return stunners[0] ?? null;
}

/**
 * Fight it out with one creature. `defend`: a hunter has caught the rover (it fights back, and leaves a downed
 * creature where it falls). `capture`: the captain's order (the rover holds against hunters, chases the rest, and
 * takes the catch aboard if there's room).
 */
export function fightCreature(state: GameState, world: World, key: SiteKey, mode: FightMode): Result<FightReport> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  const v = loc.rover;
  if (!v) return fail("Deploy the rover first.");
  if (v.disabled) return fail("The rover is disabled. Recall it.");
  const c = creatureByKey(state, world, loc.bodyId, key);
  if (!c) return fail("That creature is gone.");
  if (c.down) return fail("It's already down.");
  const bodyId = loc.bodyId;
  const surface = world.surface(bodyId);
  const ship = shipTile(state, world);
  const fauna = faunaOf(state, bodyId);
  const f = (fauna[c.key] ??= { x: c.x, y: c.y });
  const gear = vehicleWeapons(state);
  const capture = mode === "capture";
  const hunter = isHunter(c.entry);
  const vmob = mobilityOf(state, v);
  const events: FightEvent[] = [];
  const start = state.time;
  const sci = stationLevel(state, "science");
  let vMove = 0;
  let cMove = 0;
  let outcome: FightOutcome = "gave up";
  let hull = hullOf(state, v);
  const push = (round: number, kind: FightEvent["kind"], extra: Partial<FightEvent> = {}) =>
    events.push({ round, kind, rover: { x: v.x, y: v.y }, creature: { x: c.x, y: c.y }, ...extra });

  const creatureStep = (toward: Vec2, sign: 1 | -1): boolean => {
    const n = stepCreature(world, bodyId, c, toward, sign, hunter ? ship : null);
    if (!n) return false;
    setPos(state, bodyId, c, n);
    return true;
  };
  const vehicleStep = (toward: Vec2): number => {
    const path = findPath(surface, v, toward, vmob);
    const step = path?.[0];
    if (!step) return 0;
    const cost = routeEnergy(state, [step]);
    v.energy -= cost;
    v.x = step.x;
    v.y = step.y;
    return cost;
  };
  /** The creature's turn: hunters close and bite, the rest flee (or ignore). */
  const creatureTurn = (round: number): void => {
    if (c.down) return;
    const d = hexDistance(v, c);
    if (hunter) {
      if (d > 1) {
        cMove += c.entry.speed / 6;
        while (cMove >= 1 && hexDistance(v, c) > 1) {
          cMove -= 1;
          if (!creatureStep(v, 1)) break;
          push(round, "approach");
        }
        return;
      }
      const dodge = vehicleChaseSpeed(state, v) > 1 ? 0.1 : 0;
      const bit = withRng(state, (rng) => rng.chance(0.6 - dodge));
      const dmg = bit ? Math.round(c.entry.attack * effectiveStats(state).roverArmour * withRng(state, (rng) => rng.range(0.7, 1.3))) : 0;
      hull -= dmg;
      push(round, "bite", { hit: bit, amount: dmg });
      if (bit) {
        awardXp(state, "engineering", 1);
        const danger = Math.max(1, c.entry.danger) as 1 | 2 | 3;
        if (c.entry.danger > 0 && withRng(state, (rng) => rng.chance(Math.min(0.6, dmg / 25)))) {
          injureCrew(state, {
            stations: vehicleOf(v) === "boat" ? ["science", "engineering", "medical"] : ["engineering", "science"],
            cause: `mauled by a ${c.entry.name}`,
            weights: DANGER_SEVERITY[danger],
            lighten: hasPerk(state, "fauna-handler") ? 1 : 0,
          });
        }
      }
      return;
    }
    const scared = c.entry.temperament === "skittish" || f.spooked;
    if (scared && d <= c.entry.sense + 2) {
      cMove += c.entry.speed / 6;
      while (cMove >= 1) {
        cMove -= 1;
        if (!creatureStep(v, -1)) break;
        push(round, "flee");
      }
    }
  };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    advanceTime(state, ROUND_MINUTES);
    const d = hexDistance(v, c);
    const reserve = energyReserve(state, world, v);
    // The rover's turn. With its gear offline it can only run for it.
    if (gear.length === 0) {
      outcome = "broke off";
      push(round, "breakoff");
      break;
    }
    const w = chooseWeapon(gear, c, d, capture);
    if (w) {
      if (v.energy - w.energy < reserve) {
        outcome = "broke off";
        push(round, "breakoff");
        break;
      }
      v.energy -= w.energy;
      if (w.kind === "net") {
        const hold = (w.hit / (c.entry.size === 2 ? 1.6 : 1)) * (hunter ? 0.7 : 1);
        const held = withRng(state, (rng) => rng.chance(hold));
        push(round, "net", { weapon: w.id, hit: held });
        if (held) {
          outcome = "captured";
          break;
        }
      } else {
        const aim = Math.min(0.95, w.hit + 0.02 * Math.max(0, sci - 1));
        const hit = withRng(state, (rng) => rng.chance(aim));
        const dmg = hit ? Math.round(w.damage * withRng(state, (rng) => rng.range(0.8, 1.2))) : 0;
        f.hurt = (f.hurt ?? 0) + dmg;
        c.hp = Math.max(0, c.maxHp - f.hurt);
        push(round, "fire", { weapon: w.id, hit, amount: dmg });
        if (hit) awardXp(state, "science", 2);
        if (!hunter) f.spooked = true;
        if (c.hp <= 0) {
          outcome = capture ? "captured" : "down";
          break;
        }
      }
    } else if (capture && !hunter) {
      // Run it down: the gear can't reach it yet.
      if (v.energy - 1.5 < reserve) {
        outcome = "broke off";
        push(round, "breakoff");
        break;
      }
      vMove += vehicleChaseSpeed(state, v);
      let moved = false;
      while (vMove >= 1 && hexDistance(v, c) > 1 && v.energy - 1.5 >= reserve) {
        vMove -= 1;
        if (vehicleStep(c) <= 0) break;
        moved = true;
      }
      if (moved) push(round, "chase");
    }
    // Otherwise a hunter is still out of reach: hold and let it come.
    creatureTurn(round);
    if (hull <= 0) {
      outcome = "disabled";
      push(round, "disabled");
      break;
    }
    if (!hunter && hexDistance(v, c) > c.entry.sense + 4) {
      outcome = "escaped";
      push(round, "escaped");
      break;
    }
  }

  // A rover breaking off from a hunter runs for the ship; the hunter chases while it can keep up.
  if (outcome === "broke off" && hunter) {
    const dock = dockOf(state, world, v);
    for (let round = MAX_ROUNDS + 1; round <= MAX_ROUNDS + 6; round++) {
      if (hexDistance(v, dock) <= SAFE_RADIUS || hexDistance(v, c) > 3) break;
      advanceTime(state, ROUND_MINUTES);
      vMove += vehicleChaseSpeed(state, v);
      while (vMove >= 1) {
        vMove -= 1;
        vehicleStep(dock);
      }
      push(round, "retreat");
      creatureTurn(round);
      if (hull <= 0) {
        outcome = "disabled";
        push(round, "disabled");
        break;
      }
    }
    if (outcome !== "disabled") f.calmUntil = state.time + CALM_MINUTES;
  }
  v.hull = Math.max(0, hull);

  // Settle the outcome.
  const name = c.entry.name;
  const where = placeName(world, bodyId, state);
  let text: string;
  if (outcome === "captured" || outcome === "down") {
    f.downAt = state.time;
    if (outcome === "captured") {
      const r = takeAboard(state, bodyId, c);
      text = r ? `Captured a ${name}: it's in the sample cases.` : `Brought down a ${name}, but the sample cases are full: it's waiting, stunned, for ${DOWNED_DAYS} days.`;
      if (!r) outcome = "down";
    } else {
      text = `Brought down a ${name}. It's out cold where it fell: collect it within ${DOWNED_DAYS} days.`;
    }
    awardXp(state, "captain", 5);
    recordFind(state, "fauna", c.entry.id, where, name);
  } else if (outcome === "disabled") {
    disable(state, c.entry);
    text = `The ${name} wrecked the ${vehicleOf(v) === "boat" ? "boat" : "rover"}. The crew is shaken and hurt, and the load is lost. Recall it with the ship.`;
  } else if (outcome === "broke off") {
    text = hunter ? `The rover broke off from the ${name} to keep enough energy to get home.` : `The rover gave up on the ${name}: no energy to spare for the chase.`;
  } else if (outcome === "escaped") {
    text = `The ${name} got away.`;
  } else {
    text = `The ${name} kept its distance; the crew called it off.`;
  }
  log(state, outcome === "disabled" ? "warning" : outcome === "captured" || outcome === "down" ? "discovery" : "info", text);
  const report: FightReport = {
    id: (state.lastFight?.id ?? 0) + 1,
    bodyId,
    key: c.key,
    species: c.entry.id,
    mode,
    outcome,
    text,
    events,
    minutes: state.time - start,
  };
  state.lastFight = report;
  return ok(report);
}

/** Put a downed creature in the sample cases, if there's room. */
function takeAboard(state: GameState, bodyId: string, c: LiveCreature): boolean {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return false;
  const v = loc.rover;
  if (specimenCount(v.specimens) + c.entry.size > roverSpecimenSlots(state)) return false;
  v.specimens ??= {};
  const skey = `${bodyId}|${c.entry.name}`;
  v.specimens[skey] = (v.specimens[skey] ?? 0) + 1;
  const f = faunaOf(state, bodyId)[c.key];
  if (f) f.gone = true;
  state.stats.specimens = (state.stats.specimens ?? 0) + 1;
  awardXp(state, "medical", 4);
  return true;
}

/** A wrecked vehicle: the crew is hurt, the load lost, the gear offline until the yard repairs it. */
function disable(state: GameState, c: CreatureEntry): void {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return;
  const v = loc.rover;
  v.disabled = true;
  v.cargo = {};
  v.specimens = {};
  v.hull = 0;
  state.ship.roverWrecked = true;
  injureCrew(state, {
    stations: ["engineering", "science"],
    cause: `when a ${c.name} wrecked the ${vehicleOf(v) === "boat" ? "boat" : "rover"}`,
    weights: [30, 45, 25],
    lighten: hasPerk(state, "fauna-handler") ? 1 : 0,
  });
}

// --- the captain's orders ---------------------------------------------------------------------------

/**
 * Order a capture. If the creature is out of its notice range, the rover first drives up toward it (defending
 * itself as usual on the way); then it fights or chases until the creature is taken, gets away, or the energy
 * margin is reached.
 */
export function captureCreature(state: GameState, world: World, key: SiteKey): Result<FightReport> {
  const blockers = captureBlockers(state, world, key);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  const v = loc.rover as RoverState;
  const c = creatureByKey(state, world, loc.bodyId, key) as LiveCreature;
  const surface = world.surface(loc.bodyId);
  // Close in: hunters until they notice the rover, the rest until the gear (or a short dash) can reach.
  const near = isHunter(c.entry) ? Math.max(1, Math.min(c.entry.sense, 4)) : Math.max(2, Math.min(c.entry.sense - 1, 4));
  const lead: FightEvent[] = [];
  if (hexDistance(v, c) > near) {
    const path = findPath(surface, v, c, mobilityOf(state, v)) ?? [];
    for (const step of path) {
      if (hexDistance(step, c) < near) break;
      const cost = routeEnergy(state, [step]);
      if (v.energy - cost < energyReserve(state, world, v) + 2) return fail("Not enough energy to get close and still get home.");
      v.energy -= cost;
      v.x = step.x;
      v.y = step.y;
      lead.push({ round: 0, kind: "chase", rover: { x: v.x, y: v.y }, creature: { x: c.x, y: c.y } });
      advanceTime(state, step.minutes * 1.5);
      // A different hunter can jump the rover on the way.
      const other = stirCreatures(state, world, step.minutes * 1.5);
      if (other && other.key !== key) {
        const r = fightCreature(state, world, other.key, "defend");
        if (!r.ok || r.value.outcome === "disabled" || r.value.outcome === "broke off") return r;
      }
    }
  }
  const r = fightCreature(state, world, key, "capture");
  if (r.ok) r.value.events.unshift(...lead.slice(-12));
  return r;
}

/** Collect a downed creature beside the vehicle. */
export function collectCreature(state: GameState, world: World, key: SiteKey): Result<string> {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return fail("Deploy the rover first.");
  const v = loc.rover;
  const c = creatureByKey(state, world, loc.bodyId, key);
  if (!c) return fail("That creature is gone.");
  if (!c.down) return fail("It isn't down: capture it first.");
  if (hexDistance(v, c) > 1) return fail("Drive alongside it first.");
  if (!!c.entry.aquatic !== (vehicleOf(v) === "boat")) return fail(c.entry.aquatic ? "Take the boat out to haul it in." : "Use the rover to load it.");
  if (specimenCount(v.specimens) + c.entry.size > roverSpecimenSlots(state)) return fail(`The sample cases are full (it needs ${c.entry.size} slot${c.entry.size === 1 ? "" : "s"}).`);
  takeAboard(state, loc.bodyId, c);
  advanceTime(state, 30);
  log(state, "discovery", `Loaded the stunned ${c.entry.name} into the sample cases.`);
  return ok(c.entry.name);
}

/** Specimen slots a specimen of this species fills: creatures can take two. */
export function specimenSize(species: string): number {
  return CREATURES_BY_NAME.get(species)?.size ?? 1;
}

/** For tests and the UI: the key of a creature in a region. */
export function creatureKey(region: number, id: number): SiteKey {
  return siteKey(region, id);
}

/**
 * Time has passed on the surface: let the creatures move, and if a hunter catches the rover, fight it off.
 * Returns the fight, if there was one.
 */
export function creatureWatch(state: GameState, world: World, minutes: number): FightReport | null {
  const attacker = stirCreatures(state, world, minutes);
  if (!attacker) return null;
  const r = fightCreature(state, world, attacker.key, "defend");
  return r.ok ? r.value : null;
}
