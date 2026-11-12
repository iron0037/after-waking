/**
 * Creatures on the surface (AW-215, AW-216, AW-225). Where each starts comes from the seed (RegionMap.creatures);
 * where it is now, and what's happened to it, lives in `state.fauna`.
 *
 * - **Roaming.** As time passes while landed, creatures near the vehicle move: skittish ones flee it, hunters come
 *   after it, the rest wander near home. No hunter comes within SAFE_RADIUS of the freighter.
 * - **Seen.** Any creature standing on ground the sensors have swept is on the map, anywhere on the world.
 * - **Attempts, as odds.** A capture, or a hunter catching the rover, is settled at once: the odds come from the
 *   rover's speed, gear, plating and spare energy against the creature's speed, toughness and bite. The rover stays
 *   where it is. Success costs the energy it took; failure leaves just enough to get home, and a hunter may hurt the
 *   crew or wreck the rover (disabled until recalled; its gear offline until the yard repairs it).
 * - **Taken alive.** A creature brought down is stunned, never killed: into the sample cases on a capture (if there's
 *   room), otherwise a pickup for 30 days.
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
import { isExplored, regionKey } from "./surface";
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
/** Minutes a round of shooting (or netting) takes. */
export const ROUND_MINUTES = 10;
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

export type FightOutcome = "captured" | "down" | "escaped" | "broke off" | "disabled";

export interface FightReport {
  /** Increases with every attempt, so the UI can tell a new one. */
  id: number;
  bodyId: string;
  key: SiteKey;
  species: string;
  mode: FightMode;
  outcome: FightOutcome;
  text: string;
  /** The odds it was tried at, the energy it took and the minutes it ran. */
  chance: number;
  energy: number;
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
  // Creatures can roam into a neighboring region, so look a leash further than asked.
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

/** Is this planet-wide tile swept by the sensors? */
function swept(state: GameState, world: World, bodyId: string, p: Vec2): boolean {
  const local = world.surface(bodyId).toLocal(p.x, p.y);
  const k = local ? state.regions[regionKey(bodyId, local.region)] : undefined;
  return !!local && !!k && isExplored(k, local.x, local.y);
}

/** Every creature standing on swept ground anywhere on this world (AW-225): what the map and the list show. */
export function visibleCreatures(state: GameState, world: World): LiveCreature[] {
  const loc = state.location;
  if (loc.kind !== "surface") return [];
  const bodyId = loc.bodyId;
  const surface = world.surface(bodyId);
  const seen = new Map<string, LiveCreature>();
  const consider = (c: LiveCreature | null) => {
    if (c && !seen.has(c.key) && swept(state, world, bodyId, c)) seen.set(c.key, c);
  };
  // Regions with any swept ground: the creatures that start there...
  for (const [key, k] of Object.entries(state.regions)) {
    if (!key.startsWith(`${bodyId}#`) || !(k.explored?.length > 0)) continue;
    for (const spawn of surface.creatures(Number(key.slice(bodyId.length + 1)))) consider(live(state, bodyId, spawn));
  }
  // ...and any that have wandered in from elsewhere.
  for (const key of Object.keys(state.fauna?.[bodyId] ?? {})) consider(creatureByKey(state, world, bodyId, key));
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
  return (vehicleOf(v) === "boat" ? boatDock(state, world, v) : null) ?? shipTile(state, world);
}

function mobilityOf(state: GameState, world: World, v: RoverState): Mobility {
  return vehicleOf(v) === "boat" ? boatMobility(shipTile(state, world)) : roverMobility(state);
}

/** Energy kept back in any fight: the drive home, plus 15% of a full charge (at least 8). */
export function energyReserve(state: GameState, world: World, v: RoverState): number {
  const loc = state.location;
  if (loc.kind !== "surface") return 0;
  const surface = world.surface(loc.bodyId);
  const home = findPath(surface, v, dockOf(state, world, v), mobilityOf(state, world, v));
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

// --- fights: worked out at once, as odds (AW-225) --------------------------------------------------

const DANGER_SEVERITY: Record<1 | 2 | 3, SeverityWeights> = { 1: [85, 14, 1], 2: [65, 30, 5], 3: [45, 40, 15] };
/** Energy a hex of chasing costs, on average ground. */
const CHASE_ENERGY_PER_HEX = 1.5;
/** Minutes a hex of chasing takes. */
const CHASE_MINUTES_PER_HEX = 12;

/**
 * What an attempt on a creature looks like before the crew commits: the odds, the energy it should take, and for a
 * hunter, the risk to the crew and the rover. Everything the captain sees on the Attempt capture button.
 */
export interface CaptureOdds {
  /** 0–1. */
  chance: number;
  /** Energy it should take if it works (the rover drives out, does the job, and comes back to where it is). */
  energy: number;
  /** Energy the rover can spend and still get home with a margin. */
  budget: number;
  /** Game minutes it should take. */
  minutes: number;
  /** Hunters: chance someone on the crew is hurt, either way. */
  injuryRisk: number;
  /** Hunters: chance the rover is wrecked if the attempt fails. */
  wreckRisk: number;
  /** The gear that does the work ("net launcher", "stun gun", or "nothing" with the gear offline). */
  method: string;
  /** What's weighing on the odds, in words. */
  notes: string[];
  /** Plating the rover should lose to bites if it works. */
  hullLoss: number;
}

/** What the gear and the fight (or chase) come to, before the drive out and the energy budget. */
interface EncounterOdds {
  chance: number;
  /** Energy for the job itself, not the drive. */
  energy: number;
  minutes: number;
  injuryRisk: number;
  wreckRisk: number;
  method: string;
  notes: string[];
  hullLoss: number;
}

/**
 * The odds against a creature of this kind, from alongside it: the gear, the crew's aim and the fight or the chase.
 * `hp` is how worn down it is, `scared` whether it runs from the start, `hull` the plating the vehicle has now and
 * `speed` how fast it chases (vehicleChaseSpeed). captureOdds adds the drive out and back and the energy budget.
 */
function encounterOdds(state: GameState, entry: CreatureEntry, hp: number, scared: boolean, hull: number, speed: number, vehicle: "rover" | "boat"): EncounterOdds {
  const notes: string[] = [];
  const gear = vehicleWeapons(state);
  const hunter = isHunter(entry);
  const roverSpeed = speed;
  const theirSpeed = entry.speed / 6;

  // The stunner that does the most per shot, aimed by the science officer.
  const sci = stationLevel(state, "science");
  const stunners = gear.filter((w) => w.kind !== "net");
  const nets = gear.filter((w) => w.kind === "net").sort((a, b) => b.hit - a.hit);
  const aim = (w: VehicleWeapon) => Math.min(0.95, w.hit + 0.02 * Math.max(0, sci - 1));
  const best = [...stunners].sort((a, b) => b.damage * aim(b) - a.damage * aim(a))[0] ?? null;
  const stunShots = best ? Math.ceil(hp / Math.max(0.1, best.damage * aim(best))) : Infinity;
  const stunEnergy = best ? stunShots * best.energy : Infinity;
  const net = nets[0] ?? null;
  const netHold = net ? (net.hit / (entry.size === 2 ? 1.6 : 1)) * (hunter ? 0.7 : 1) : 0;
  const netEnergy = net ? (1 / Math.max(0.05, netHold)) * net.energy : Infinity;

  let chance = 1;
  let energy = 0;
  let minutes = 0;
  let method = "nothing";
  let injuryRisk = 0;
  let wreckRisk = 0;
  let hullLoss = 0;

  // What a hunter's bites do over so many rounds alongside: plating lost, and the risk to the crew and the rover.
  const bitesOver = (rounds: number): number => {
    const dodge = roverSpeed > 1 ? 0.1 : 0;
    const perBite = entry.attack * effectiveStats(state).roverArmour;
    const expectedDamage = rounds * perBite * (0.6 - dodge);
    hullLoss = Math.min(hull - 1, expectedDamage);
    const perInjury = entry.danger > 0 ? Math.min(0.6, perBite / 25) : 0;
    injuryRisk = 1 - Math.pow(1 - perInjury, rounds * (0.6 - dodge));
    wreckRisk = Math.max(0, Math.min(0.7, expectedDamage / Math.max(1, hull) - 0.6));
    if (expectedDamage > hull * 0.6) notes.push("It bites harder than the plating can take for long: armor would help.");
    return expectedDamage;
  };

  if (gear.length === 0) {
    chance = 0;
    notes.push("The rover's gear is offline until the Intrepid's yard repairs it.");
    // With nothing to fight back with, the rover can only run, and a hunter bites while it keeps up.
    if (hunter) bitesOver(4 * Math.max(0.5, theirSpeed / Math.max(0.2, roverSpeed)));
  } else if (hunter) {
    // A fight: it closes from where it notices the rover, biting once it's alongside.
    // Nets only hold a hunter once it's worn down: they finish what the stunner started.
    method = best?.name ?? net?.name ?? "nothing";
    const shots = net && best ? Math.ceil(stunShots * 0.6) + Math.ceil(1 / Math.max(0.05, netHold)) : stunShots;
    energy += best ? Math.min(stunEnergy, Math.ceil(stunShots * 0.6) * best.energy + (net ? netEnergy : Infinity)) : netEnergy;
    const reach = Math.max(1, best?.range ?? 1);
    const freeRounds = (reach - 1) / Math.max(0.2, theirSpeed);
    const biteRounds = Math.max(0, shots - freeRounds);
    const expectedDamage = bitesOver(biteRounds);
    chance *= Math.max(0.03, Math.min(0.97, 1.15 - (0.6 * expectedDamage) / Math.max(1, hull)));
    minutes += shots * ROUND_MINUTES;
    if (freeRounds < 1) notes.push(`It closes before the ${method} can wear it down: longer-reaching gear would help.`);
  } else {
    // A chase: skittish ones run from the start; docile ones only once they're shot at.
    const useNet = net !== null && (best === null || netEnergy <= stunEnergy);
    method = useNet ? (net as VehicleWeapon).name : (best?.name ?? "nothing");
    energy += useNet ? netEnergy : stunEnergy;
    const reach = useNet ? (net as VehicleWeapon).range : (best?.range ?? 1);
    const ratio = theirSpeed / Math.max(0.2, roverSpeed);
    const lead = scared ? entry.sense : 1;
    const chaseHexes = lead * Math.max(0.5, ratio) * 1.5;
    energy += chaseHexes * CHASE_ENERGY_PER_HEX;
    minutes += chaseHexes * CHASE_MINUTES_PER_HEX + (useNet ? 2 : stunShots) * ROUND_MINUTES;
    // A runner as fast as the rover gets away about half the time from a prod; reach and motors claw that back.
    const catchChance = scared ? 1.1 - 1.2 * (ratio - 0.7) + 0.12 * (reach - 1) : 1 - 0.2 * Math.max(0, ratio - 1) + 0.05 * (reach - 1);
    chance *= Math.max(0.05, Math.min(0.97, catchChance));
    if (useNet) chance *= Math.min(1, 0.6 + netHold);
    if (scared && ratio > 1) notes.push(`It's faster than the ${vehicle}: uprated motors or longer-reaching gear would help.`);
  }
  return { chance, energy, minutes, injuryRisk, wreckRisk, method, notes, hullLoss };
}

/**
 * The odds of taking a creature of this kind with the gear aboard now, met fresh and unhurt, from alongside it with
 * the rover's (or for sea life, the boat's) plating whole. For deciding whether a specimen job is fair to post (AW-242).
 */
export function speciesCaptureChance(state: GameState, entry: CreatureEntry): number {
  const boat = !!entry.aquatic;
  const speed = boat ? 1 : 1 / Math.max(0.3, effectiveStats(state).roverDriveTime);
  const odds = encounterOdds(state, entry, entry.hp, entry.temperament === "skittish", vehicleHullMax(state), speed, boat ? "boat" : "rover");
  return Math.max(0, Math.min(0.97, odds.chance));
}

/** The odds of taking this creature from where the vehicle is now. Null if it isn't there to try. */
export function captureOdds(state: GameState, world: World, key: SiteKey): CaptureOdds | null {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return null;
  const v = loc.rover;
  const c = creatureByKey(state, world, loc.bodyId, key);
  if (!c || c.down) return null;
  const surface = world.surface(loc.bodyId);
  const budget = Math.max(0, v.energy - energyReserve(state, world, v));

  // Out to it and back: the rover ends where it started.
  const path = hexDistance(v, c) <= 1 ? [] : findPath(surface, v, c, mobilityOf(state, world, v));
  const approachEnergy = path ? 2 * routeEnergy(state, path) : Infinity;
  const approachMinutes = path ? 2 * path.reduce((m, s) => m + s.minutes, 0) * 1.5 : 0;

  const scared = c.entry.temperament === "skittish" || !!state.fauna?.[loc.bodyId]?.[c.key]?.spooked;
  const fight = encounterOdds(state, c.entry, c.hp, scared, hullOf(state, v), vehicleChaseSpeed(state, v), vehicleOf(v) === "boat" ? "boat" : "rover");
  let chance = fight.chance;
  const energy = approachEnergy + fight.energy;
  const minutes = approachMinutes + fight.minutes;
  const notes = fight.notes;

  if (!path) {
    chance = 0;
    notes.push(`No route for the ${vehicleOf(v) === "boat" ? "boat" : "rover"} to reach it.`);
  } else if (energy > budget) {
    // Not enough to spare: the crew can still try, but it's likelier to run out of margin first.
    chance *= budget <= 0 ? 0 : Math.pow(budget / energy, 1.5);
    notes.push(`It should take about ${Math.round(energy)} energy and the rover can spare ${Math.round(budget)}.`);
  }
  return {
    chance: Math.max(0, Math.min(0.97, chance)),
    energy: Math.min(energy, Math.max(budget, 0)),
    budget,
    minutes: Math.max(ROUND_MINUTES, minutes),
    injuryRisk: fight.injuryRisk,
    wreckRisk: fight.wreckRisk,
    method: fight.method,
    notes,
    hullLoss: fight.hullLoss,
  };
}

/** Why a capture can't be tried (empty if it can). */
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
  if (vehicleWeapons(state).length === 0) return ["The rover's gear is offline until the Intrepid's yard repairs it."];
  const odds = captureOdds(state, world, key);
  if (!odds || odds.budget <= 0) return ["No energy to spare: the rover needs all it has to get home. Recharge first."];
  if (odds.chance <= 0) return [odds.notes[0] ?? "No way to reach it from here."];
  return [];
}

/**
 * Settle an attempt on a creature at once (no play-by-play). `capture`: the captain's order. `defend`: a hunter caught
 * the rover as it worked. The rover ends where it started.
 * - Works: the creature is stunned (into the sample cases on a capture, if there's room; otherwise a pickup), and the
 *   energy it took comes off the cells.
 * - Fails: the rover is left with just enough to get home. A hunter may hurt the crew, and may wreck the rover.
 */
export function settleFight(state: GameState, world: World, key: SiteKey, mode: FightMode): Result<FightReport> {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return fail("Deploy the rover first.");
  const v = loc.rover;
  const c = creatureByKey(state, world, loc.bodyId, key);
  if (!c) return fail("That creature is gone.");
  if (c.down) return fail("It's already down.");
  const bodyId = loc.bodyId;
  const odds = captureOdds(state, world, key);
  if (!odds) return fail("That creature is gone.");
  const f = (faunaOf(state, bodyId)[c.key] ??= { x: c.x, y: c.y });
  const hunter = isHunter(c.entry);
  const name = c.entry.name;
  const noun = vehicleOf(v) === "boat" ? "boat" : "rover";
  const won = withRng(state, (rng) => rng.chance(odds.chance));
  const minutes = Math.round(odds.minutes * withRng(state, (rng) => rng.range(0.8, 1.2)));
  advanceTime(state, minutes);
  const hurt = hunter && withRng(state, (rng) => rng.chance(odds.injuryRisk));
  if (hurt) {
    injureCrew(state, {
      stations: noun === "boat" ? ["science", "engineering", "medical"] : ["engineering", "science"],
      cause: `mauled by a ${name}`,
      weights: DANGER_SEVERITY[Math.max(1, c.entry.danger) as 1 | 2 | 3],
      lighten: hasPerk(state, "fauna-handler") ? 1 : 0,
    });
  }
  let outcome: FightOutcome;
  let text: string;
  const before = v.energy;
  if (won) {
    v.energy = Math.max(v.energy - odds.budget, v.energy - odds.energy * withRng(state, (rng) => rng.range(0.85, 1.15)));
    v.hull = Math.max(1, hullOf(state, v) - Math.round(odds.hullLoss * withRng(state, (rng) => rng.range(0.6, 1.2))));
    f.downAt = state.time;
    awardXp(state, "science", 4);
    awardXp(state, "captain", 5);
    recordFind(state, "fauna", c.entry.id, placeName(world, bodyId, state), name);
    if (mode === "capture" && takeAboard(state, bodyId, c)) {
      outcome = "captured";
      text = `Captured a ${name} with the ${odds.method}: it's in the sample cases.`;
    } else {
      outcome = "down";
      text =
        mode === "capture"
          ? `Brought down a ${name}, but the sample cases are full: it lies stunned for ${DOWNED_DAYS} days.`
          : `A ${name} went for the ${noun}; the crew stunned it. It lies out cold nearby: collect it within ${DOWNED_DAYS} days.`;
    }
  } else {
    // Out of margin: the crew gives up with just enough left to get home.
    v.energy = Math.min(v.energy, Math.max(0, v.energy - odds.budget));
    if (hunter) {
      f.hurt = (f.hurt ?? 0) + Math.round(c.hp * 0.4);
      f.calmUntil = state.time + CALM_MINUTES;
      if (withRng(state, (rng) => rng.chance(odds.wreckRisk))) {
        disable(state, c.entry);
        outcome = "disabled";
        text = `The ${name} wrecked the ${noun}. The crew is shaken and hurt, and the load is lost. Recall it with the ship.`;
      } else {
        outcome = "broke off";
        text = `The ${noun} broke off from the ${name} with just enough energy to get home. It's wary of you now, for a while.`;
      }
    } else {
      f.spooked = true;
      // It runs off out of sight of the chase.
      for (let i = 0; i < c.entry.sense; i++) {
        const n = stepCreature(world, bodyId, c, v, -1, null);
        if (!n) break;
        setPos(state, bodyId, c, n);
      }
      outcome = "escaped";
      text = `The ${name} got away; the ${noun} turned back with just enough energy to get home.`;
    }
  }
  log(state, outcome === "disabled" ? "warning" : won ? "discovery" : "info", text);
  const report: FightReport = {
    id: (state.lastFight?.id ?? 0) + 1,
    bodyId,
    key: c.key,
    species: c.entry.id,
    mode,
    outcome,
    text,
    chance: odds.chance,
    energy: Math.max(0, before - v.energy),
    minutes,
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

/** Order a capture: settled at once from where the vehicle stands (AW-225). */
export function captureCreature(state: GameState, world: World, key: SiteKey): Result<FightReport> {
  const blockers = captureBlockers(state, world, key);
  if (blockers.length > 0) return fail(blockers[0] as string);
  return settleFight(state, world, key, "capture");
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
  const r = settleFight(state, world, attacker.key, "defend");
  return r.ok ? r.value : null;
}
