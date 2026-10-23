/**
 * Every player verb. Each action validates against the current state, then mutates it and
 * advances time. Failures return a reason the UI can show verbatim; they never throw.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { UPGRADES_BY_ID } from "../data/ship";
import { bodyPosition, KIND_LABEL, type Body } from "./bodies";
import { fuelPrice, sellCommodity, sellPrice } from "./economy";
import { landingAccess } from "./environment";
import { distanceLy, positionOf, SPECTRAL } from "./galaxy";
import { canEnter, findPath, type Mobility } from "./pathfinding";
import type { BodySurface, SiteKey, SurfaceDeposit, SurfaceFlora } from "./bodysurface";
import { hexDistance } from "./hex";
import { fail, ok, type Result } from "./result";
import type { Rng } from "./rng";
import {
  addCargo,
  cargoTonnes,
  removeCargo,
  ROVER_SPECIMEN_SLOTS,
  SHIP_SPECIMEN_SLOTS,
  shipMassT,
  shipStats,
  specimenCount,
} from "./ship";
import { advanceTime, log, settlePayroll, withRng, type GameState, type RoverState } from "./state";
import { FLORA_BY_NAME } from "../data/catalog";
import { foundMineralSpecimen, recordFind, rollMineralSpecimen } from "./compendium";
import { specimenKey } from "./contracts";
import { awardXp, crewBonuses } from "./crew";
import { effectiveStats, hasPerk, roverSpecimenSlots, shipSpecimenSlots } from "./perks";
import {
  emptyKnowledge,
  markExplored,
  normalizeKnowledge,
  regionKey,
  regionSignal,
  type Deposit,
  REGION_SIZE,
  TILE_KM,
  type FloraSite,
  type RegionKnowledge,
  type RegionMap,
} from "./surface";
import { formatDuration } from "./time";
import { DAY, HOUR, travelMinutes, type Vec2 } from "./units";
import type { World } from "./world";

export type { Result } from "./result";

// --- tuning ------------------------------------------------------------------------------

export const FOLD_FUEL_PER_T_LY = 0.001;
/** Docking with the Intrepid after folding home (the fold itself is instant). */
export const DOCKING_MINUTES = 30;
export const IN_SYSTEM_FUEL_PER_AU_PER_KT = 0.01;
export const MANEUVER_MINUTES = 20;
export const DESCENT_MINUTES = 2 * HOUR;
export const ASCENT_MINUTES = HOUR;
export const SCAN_MINUTES = HOUR;
export const PROSPECT_MINUTES = 2 * HOUR;
export const DRILL_SETUP_MINUTES = 3 * HOUR;
export const DRILL_ENERGY_PER_HOUR = 1.5;
export const ROVER_STOW_MINUTES = 30;
export const PROSPECT_ENERGY = 4;
export const DRILL_SETUP_ENERGY = 6;
export const RECALL_FUEL = 1.5;
export const RECALL_MINUTES = 3 * HOUR;
export const SURVEY_MINUTES = 12 * HOUR;
/** Rover cells recharge from the ship's reactor at this many energy units per hour. */
export const ROVER_CHARGE_PER_HOUR = 10;

/** Charge rate at the ship (Fast Charge doubles it). */
export function roverChargePerHour(state: GameState): number {
  return ROVER_CHARGE_PER_HOUR * (hasPerk(state, "fast-charge") ? 2 : 1);
}
/**
 * Surface crews work two 8-hour shifts a day, so hands-on work takes 1.5x its raw duration.
 * Applies to driving, prospecting and drilling.
 */
export const SHIFT_FACTOR = 1.5;
/** Chance per drilling hour of a plain equipment breakdown; weather and tectonics add to it. */
export const INCIDENT_BASE_PER_HOUR = 0.003;

export function foldRechargeMinutes(ly: number): number {
  return DAY * (1 + 0.75 * ly);
}

// --- where are we ------------------------------------------------------------------------

/** "intrepid" or the id of the system the ship is in. */
export function currentSystemId(state: GameState): string {
  return state.location.kind === "intrepid" ? "intrepid" : state.location.systemId;
}

export function shipPosition(state: GameState, world: World): Vec2 | null {
  const loc = state.location;
  if (loc.kind === "intrepid") return null;
  if (loc.kind === "surface") {
    const { detail, body } = world.body(loc.bodyId);
    return bodyPosition(detail, body, state.time);
  }
  if (loc.orbiting) {
    const { detail, body } = world.body(loc.orbiting);
    return bodyPosition(detail, body, state.time);
  }
  return loc.pos;
}

// --- folding -----------------------------------------------------------------------------

export interface FoldPlan {
  ly: number;
  fuel: number;
  rechargeMinutes: number;
  blockers: string[];
}

/** How far out a fold may start, as a fraction of the system edge (Fold Calibration: 80%). */
export function foldEdgeFraction(state: GameState): number {
  return hasPerk(state, "fold-calibration") ? 0.8 : 0.98;
}

export function foldPlan(state: GameState, world: World, targetId: string): FoldPlan {
  const from = currentSystemId(state);
  const stats = effectiveStats(state);
  const ly = from === targetId ? 0 : distanceLy(world.galaxy, from, targetId);
  const crew = crewBonuses(state);
  const fuel = Math.round(FOLD_FUEL_PER_T_LY * shipMassT(state.ship, stats) * ly * crew.foldFuel * 10) / 10;
  const blockers: string[] = [];

  if (from === targetId) blockers.push("You're already here.");
  if (state.location.kind === "surface") blockers.push("Launch from the surface first.");
  if (state.location.kind === "space") {
    const edge = world.system(state.location.systemId).edgeAU;
    const pos = shipPosition(state, world) as Vec2;
    if (Math.hypot(pos.x, pos.y) < edge * foldEdgeFraction(state)) {
      blockers.push(`Folds can't start inside the gravity well. Fly out to the system edge (${edge.toFixed(1)} AU).`);
    }
  }
  if (state.time < state.foldReadyAt) {
    blockers.push(`Fold drive recharging: ready in ${formatDuration(state.foldReadyAt - state.time)}.`);
  }
  if (ly > stats.foldRangeLy) blockers.push(`${ly.toFixed(1)} ly is beyond the drive's ${stats.foldRangeLy} ly range.`);
  if (fuel > state.ship.fuel) blockers.push(`Needs ${fuel} fuel; tanks hold ${state.ship.fuel.toFixed(1)}.`);
  return { ly, fuel, rechargeMinutes: Math.round(foldRechargeMinutes(ly) * crew.foldRecharge), blockers };
}

export function fold(state: GameState, world: World, targetId: string): Result {
  const plan = foldPlan(state, world, targetId);
  if (plan.blockers.length > 0) return fail(plan.blockers[0] as string);

  const fromId = currentSystemId(state);
  state.ship.fuel = Math.max(0, state.ship.fuel - plan.fuel);
  state.stats.folds++;
  // Folding is instant (lore). The drive's recharge clock starts now.
  state.foldReadyAt = state.time + plan.rechargeMinutes;
  // The crew tops up the rover's cells from the reactor during the pre-fold checks.
  state.ship.roverEnergy = effectiveStats(state).roverEnergy;
  awardXp(state, "navigation", 15 + 3 * plan.ly);

  if (targetId === "intrepid") {
    state.location = { kind: "intrepid" };
    advanceTime(state, DOCKING_MINUTES);
    log(state, "travel", `Folded ${plan.ly.toFixed(1)} ly home and docked with the Intrepid.`);
    return ok(undefined);
  }

  const detail = world.system(targetId);
  const from = positionOf(world.galaxy, fromId);
  const to = positionOf(world.galaxy, targetId);
  const angle = Math.atan2(from.y - to.y, from.x - to.x); // arrive on the side we came from
  state.location = {
    kind: "space",
    systemId: targetId,
    pos: { x: Math.cos(angle) * detail.edgeAU, y: Math.sin(angle) * detail.edgeAU },
    orbiting: null,
  };
  const firstVisit = !state.visitedSystems.includes(targetId);
  if (firstVisit) state.visitedSystems.push(targetId);
  const sys = detail.system;
  log(
    state,
    "travel",
    `Folded ${plan.ly.toFixed(1)} ly to ${sys.name}, a ${SPECTRAL[sys.spectral].label}${firstVisit ? " (first visit)" : ""}. ` +
      `Arrived at the system edge, ${detail.edgeAU.toFixed(1)} AU out. ${detail.bodies.length} bodies on sensors.`,
  );
  return ok(undefined);
}

/**
 * One-click departure: fly out to the system edge if needed, wait for the fold drive to finish
 * charging, then fold. Costs exactly the same time and fuel as doing it by hand.
 */
export function autoFold(state: GameState, world: World, targetId: string): Result<{ waited: number; flewToEdge: boolean }> {
  const plan = foldPlan(state, world, targetId);
  const hard = plan.blockers.filter((b) => !b.startsWith("Fold drive recharging") && !b.startsWith("Folds can't start inside"));
  if (hard.length > 0) return fail(hard[0] as string);

  let flewToEdge = false;
  if (plan.blockers.some((b) => b.startsWith("Folds can't start inside"))) {
    const edge = flightPlan(state, world, { edge: true });
    if (!edge.ok) return edge;
    if (edge.value.fuel + plan.fuel > state.ship.fuel) return fail("Not enough fuel to reach the edge and fold.");
    const flown = flyTo(state, world, { edge: true });
    if (!flown.ok) return flown;
    flewToEdge = true;
  }
  const waited = Math.max(0, state.foldReadyAt - state.time);
  if (waited > 0) {
    advanceTime(state, waited);
    log(state, "travel", `Held position ${formatDuration(waited)} while the fold drive charged.`);
  }
  const folded = fold(state, world, targetId);
  if (!folded.ok) return folded;
  return ok({ waited, flewToEdge });
}

// --- in-system flight --------------------------------------------------------------------

export type FlightTarget = { bodyId: string } | { edge: true };

export interface FlightPlan {
  distanceAU: number;
  minutes: number;
  fuel: number;
  arrival: Vec2;
}

export function flightPlan(state: GameState, world: World, target: FlightTarget): Result<FlightPlan> {
  const loc = state.location;
  if (loc.kind !== "space") return fail(loc.kind === "surface" ? "Launch from the surface first." : "Undock and fold out first.");
  const stats = effectiveStats(state);
  const from = shipPosition(state, world) as Vec2;
  const detail = world.system(loc.systemId);

  let arrival: Vec2;
  let distanceAU: number;
  if ("edge" in target) {
    const r = Math.hypot(from.x, from.y);
    const dir = r > 1e-9 ? { x: from.x / r, y: from.y / r } : { x: 1, y: 0 };
    arrival = { x: dir.x * detail.edgeAU * 1.001, y: dir.y * detail.edgeAU * 1.001 };
    distanceAU = Math.max(0, detail.edgeAU * 1.001 - r);
  } else {
    if (loc.orbiting === target.bodyId) return fail("Already in orbit there.");
    const { body } = world.body(target.bodyId);
    // Lead the target: aim where it will be when we arrive.
    let t = 0;
    arrival = bodyPosition(detail, body, state.time);
    for (let i = 0; i < 4; i++) {
      t = travelMinutes(Math.hypot(arrival.x - from.x, arrival.y - from.y), stats.cruiseSpeedC) + MANEUVER_MINUTES;
      arrival = bodyPosition(detail, body, state.time + t);
    }
    distanceAU = Math.hypot(arrival.x - from.x, arrival.y - from.y);
  }

  const minutes = travelMinutes(distanceAU, stats.cruiseSpeedC) * (hasPerk(state, "gravity-assist") ? 0.8 : 1) + MANEUVER_MINUTES;
  const fuel =
    Math.round(IN_SYSTEM_FUEL_PER_AU_PER_KT * (shipMassT(state.ship, stats) / 1000) * distanceAU * crewBonuses(state).flightFuel * 100) / 100;
  return ok({ distanceAU, minutes, fuel, arrival });
}

export function flyTo(state: GameState, world: World, target: FlightTarget): Result<FlightPlan> {
  const planned = flightPlan(state, world, target);
  if (!planned.ok) return planned;
  const plan = planned.value;
  if (plan.fuel > state.ship.fuel) return fail(`Needs ${plan.fuel} fuel for the burn; tanks hold ${state.ship.fuel.toFixed(1)}.`);

  const loc = state.location;
  if (loc.kind !== "space") return fail("Not in flight.");
  state.ship.fuel -= plan.fuel;
  advanceTime(state, plan.minutes);
  awardXp(state, "navigation", 3 + Math.min(10, 2 * plan.distanceAU));
  loc.pos = plan.arrival;
  loc.orbiting = "bodyId" in target ? target.bodyId : null;
  if ("bodyId" in target) {
    const { body } = world.body(target.bodyId);
    log(state, "travel", `Entered orbit around ${body.name} after ${formatDuration(plan.minutes)} (${plan.distanceAU.toFixed(2)} AU).`);
    // Prospector's Eye reads a surveyed world's deposits from orbit, including worlds surveyed before.
    if (hasPerk(state, "prospectors-eye") && (state.surveyedBodies ?? []).includes(body.id)) chartAllDeposits(state, world, body);
  } else {
    log(state, "travel", `Reached the system edge. Clear to fold.`);
  }
  return ok(plan);
}

// --- orbit -------------------------------------------------------------------------------

function orbitingBody(state: GameState, world: World): Body | null {
  const loc = state.location;
  return loc.kind === "space" && loc.orbiting ? world.body(loc.orbiting).body : null;
}

/** Sensor tier in effect for a body: the ship's array, plus one if we flew a detailed survey there. */
export function sensorTierFor(state: GameState, bodyId: string): number {
  return effectiveStats(state).sensorTier + ((state.surveyedBodies ?? []).includes(bodyId) ? 1 : 0);
}

/** Sensor tier for orbital region readings: the array, a survey, and the Sensor Calibration and Long Ears perks. */
export function orbitalSensorTier(state: GameState, bodyId: string): number {
  return sensorTierFor(state, bodyId) + (hasPerk(state, "sensor-calibration") ? 1 : 0) + (hasPerk(state, "long-ears") ? 1 : 0);
}

/** Hunch (captain): the region a gut feeling points to, read as if the sensors were perfect. Null without the perk. */
export function hunchRegion(state: GameState, body: Body): number | null {
  if (!hasPerk(state, "hunch") || body.regions === 0) return null;
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < body.regions; r++) {
    const visited = (state.regions[regionKey(body.id, r)]?.visits ?? 0) > 0;
    const score = regionSignal(state.seed, body, r, 3, effectiveStats(state).drillMaxDepthM) * (visited ? 0.5 : 1);
    if (score > bestScore) [best, bestScore] = [r, score];
  }
  return best;
}

/**
 * Market Wire (comms): where each commodity's price is heading over the next `days`, assuming the
 * usual drift back toward normal and the glut of recent sales clearing. Null without the perk.
 */
export function marketForecast(state: GameState, days = 7): Partial<Record<CommodityId, number>> | null {
  if (!hasPerk(state, "market-wire")) return null;
  const market = structuredClone(state.market);
  for (const id of Object.keys(market.mult) as CommodityId[]) {
    market.mult[id] = 1 + (market.mult[id] - 1) * Math.pow(0.92, days);
    market.glut[id] *= Math.pow(0.97, days);
  }
  const out: Partial<Record<CommodityId, number>> = {};
  for (const id of Object.keys(market.mult) as CommodityId[]) out[id] = sellPrice(market, id);
  return out;
}

/** How far (in hexes) the rover's or ship's sensors sweep on this body: array tier, survey, and the science officer. */
export function sensorRadius(state: GameState, bodyId: string): number {
  return Math.max(1, 2 + sensorTierFor(state, bodyId) + crewBonuses(state).sensorRadius);
}

/** Tonnes per hour from a deposit: the drill, the grade, and the engineer. */
export function drillRate(state: GameState, d: Deposit): number {
  return effectiveStats(state).drillRateTph * (0.4 + d.grade) * crewBonuses(state).drillRate;
}

/** A slow, careful orbital pass: sharper region readings and wider rover detection on this body. */
/** A detailed survey's duration (Close Orbit halves it). */
export function surveyMinutes(state: GameState): number {
  return SURVEY_MINUTES * (hasPerk(state, "close-orbit") ? 0.5 : 1);
}

/** Prospector's Eye: the survey charts every deposit on the world, so they're known before landing. */
function chartAllDeposits(state: GameState, world: World, body: Body): void {
  let n = 0;
  const hidden = hasPerk(state, "hidden-seams");
  for (let r = 0; r < body.regions; r++) {
    const know = knowledge(state, body.id, r);
    for (const d of world.region(body.id, r).deposits) {
      if ((d.hidden && !hidden) || know.discovered.includes(d.id)) continue;
      know.discovered.push(d.id);
      n++;
    }
  }
  if (n > 0) log(state, "discovery", `The survey charted ${n} deposit${n === 1 ? "" : "s"} across ${body.name}'s surface.`);
}

export function surveyBody(state: GameState, world: World): Result<Body> {
  const body = orbitingBody(state, world);
  if (!body) return fail("Enter orbit first.");
  if (!state.scannedBodies.includes(body.id)) return fail("Run the standard scan first.");
  state.surveyedBodies ??= [];
  if (state.surveyedBodies.includes(body.id)) return fail("Already surveyed in detail.");
  if (body.regions === 0) return fail("There's no surface to survey.");
  advanceTime(state, surveyMinutes(state));
  state.surveyedBodies.push(body.id);
  if (hasPerk(state, "prospectors-eye")) chartAllDeposits(state, world, body);
  awardXp(state, "science", 25);
  log(state, "discovery", `Detailed survey of ${body.name} complete. Region readings sharpened; rover sensors will reach farther here.`);
  return ok(body);
}

export function scanBody(state: GameState, world: World): Result<Body> {
  const body = orbitingBody(state, world);
  if (!body) return fail("Enter orbit first.");
  if (state.scannedBodies.includes(body.id)) return ok(body);
  advanceTime(state, SCAN_MINUTES);
  state.scannedBodies.push(body.id);
  awardXp(state, "science", 8);
  const top = (Object.entries(body.resources) as [CommodityId, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => COMMODITIES[id].name.toLowerCase());
  log(
    state,
    "discovery",
    `Scanned ${body.name}: ${KIND_LABEL[body.kind].toLowerCase()}, ${body.gravityG.toFixed(2)} g, ${Math.round(body.tempC)} °C.` +
      (top.length ? ` Strongest readings: ${top.join(", ")}.` : " No mineral signatures.") +
      (body.life ? " Life signs detected." : ""),
  );
  return ok(body);
}

/** Bodies in a system the current ship could set down on and mine (ignores scans and fuel). */
export function landableBodies(state: GameState, world: World, systemId: string): Body[] {
  const ratings = effectiveStats(state).ratings;
  return world
    .system(systemId)
    .bodies.filter((b) => b.regions > 0 && Object.keys(b.resources).length > 0 && landingAccess(b, ratings).ok);
}

export function landingBlockers(state: GameState, world: World, region: number): string[] {
  const body = orbitingBody(state, world);
  if (!body) return ["Enter orbit first."];
  const blockers: string[] = [];
  if (!state.scannedBodies.includes(body.id)) blockers.push("Scan the body before landing.");
  blockers.push(...landingAccess(body, effectiveStats(state).ratings).reasons);
  if (body.regions > 0 && (region < 0 || region >= body.regions || !Number.isInteger(region))) {
    blockers.push("Choose a valid landing region.");
  }
  const fuel = surfaceBurnFuel(state, body);
  if (fuel > state.ship.fuel) blockers.push(`Descent needs ${fuel} fuel.`);
  return blockers;
}

/** Fuel for one descent or ascent: heavier ships and stronger gravity cost more. */
export function surfaceBurnFuel(state: GameState, body: Body): number {
  return Math.round(0.4 * Math.max(0.05, body.gravityG) * (shipMassT(state.ship) / 1000) * 10) / 10;
}

export function knowledge(state: GameState, bodyId: string, region: number): RegionKnowledge {
  const key = regionKey(bodyId, region);
  return normalizeKnowledge((state.regions[key] ??= emptyKnowledge()));
}

export function land(state: GameState, world: World, region: number): Result {
  const blockers = landingBlockers(state, world, region);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const body = orbitingBody(state, world) as Body;
  const loc = state.location;
  if (loc.kind !== "space") return fail("Not in orbit.");
  state.ship.fuel -= surfaceBurnFuel(state, body);
  advanceTime(state, DESCENT_MINUTES);
  state.location = {
    kind: "surface",
    systemId: loc.systemId,
    bodyId: body.id,
    region,
    rover: null,
    ship: world.surface(body.id).landing(region),
    globalCoords: true,
  };
  knowledge(state, body.id, region).visits++;
  state.stats.landings++;
  revealAt(state, world, body.id, state.location.ship as Vec2);
  log(state, "travel", `Set down on ${body.name}, region ${region + 1} of ${body.regions}.`);
  return ok(undefined);
}

export function launch(state: GameState, world: World): Result {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (loc.rover) return fail("Recover the rover before launching.");
  const { body } = world.body(loc.bodyId);
  const fuel = surfaceBurnFuel(state, body);
  if (fuel > state.ship.fuel) return fail(`Ascent needs ${fuel} fuel. You're stranded until someone brings plicite.`);
  state.ship.fuel -= fuel;
  advanceTime(state, ASCENT_MINUTES);
  state.location = { kind: "space", systemId: loc.systemId, pos: { x: 0, y: 0 }, orbiting: body.id };
  log(state, "travel", `Lifted off ${body.name} and returned to orbit.`);
  return ok(undefined);
}

// --- rover -------------------------------------------------------------------------------
//
// On the surface, the rover and ship use planet-wide hex coordinates (see bodysurface.ts).
// Regions are storage: each keeps its own RegionKnowledge, and sites are keyed "region:id".

interface SurfaceCtx {
  surface: BodySurface;
  bodyId: string;
  rover: RoverState;
}

function surfaceCtx(state: GameState, world: World): Result<SurfaceCtx> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (!loc.rover) return fail("Deploy the rover first.");
  return ok({ surface: world.surface(loc.bodyId), bodyId: loc.bodyId, rover: loc.rover });
}

/** Where the ship stands, in planet-wide coordinates. */
export function shipTile(state: GameState, world: World): Vec2 {
  const loc = state.location;
  if (loc.kind !== "surface") return { x: 0, y: 0 };
  return loc.ship ?? world.surface(loc.bodyId).landing(loc.region);
}

/** The region the rover is in (or the ship, while the rover is stowed). */
export function activeRegion(state: GameState, world: World): number {
  const loc = state.location;
  if (loc.kind !== "surface") return 0;
  const p = loc.rover ?? shipTile(state, world);
  return world.surface(loc.bodyId).regionAt(p.x, p.y) ?? loc.region;
}

export function currentRegion(state: GameState, world: World): RegionMap | null {
  const loc = state.location;
  return loc.kind === "surface" ? world.region(loc.bodyId, activeRegion(state, world)) : null;
}

export const HOP_MINUTES = 90;

/** Fuel for a short hop to a new landing spot nearby: half a descent. */
export function hopFuel(state: GameState, world: World): number {
  const loc = state.location;
  if (loc.kind !== "surface") return 0;
  return Math.max(0.3, Math.round(surfaceBurnFuel(state, world.body(loc.bodyId).body) * 5) / 10);
}

/** Fuel to hop to (x, y): the base hop, plus more the farther it goes (a region's width doubles it). */
export function hopFuelTo(state: GameState, world: World, x: number, y: number): number {
  const d = hexDistance(shipTile(state, world), { x, y });
  return Math.round(hopFuel(state, world) * (1 + d / REGION_SIZE) * (hasPerk(state, "hop-master") ? 0.5 : 1) * 10) / 10;
}

/** Lift off and set down elsewhere (any region), so far deposits come within rover range. */
export function relocateShip(state: GameState, world: World, x: number, y: number): Result {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (loc.rover) return fail("Stow the rover before moving the ship.");
  const surface = world.surface(loc.bodyId);
  if (!canEnter(surface, x, y, false)) return fail("The ship can't set down there: it needs open, level ground.");
  const here = shipTile(state, world);
  if (here.x === x && here.y === y) return fail("The ship is already there.");
  const fuel = hopFuelTo(state, world, x, y);
  if (fuel > state.ship.fuel) return fail(`That hop needs ${fuel} fuel.`);
  state.ship.fuel -= fuel;
  advanceTime(state, HOP_MINUTES);
  loc.ship = { x, y };
  visitRegion(state, world, loc.bodyId, x, y);
  revealAt(state, world, loc.bodyId, loc.ship);
  log(state, "travel", `Hopped the ship ${Math.round(hexDistance(here, { x, y }) * TILE_KM)} km to a new landing site.`);
  return ok(undefined);
}

/** First arrival in a region (by rover or ship hop) counts as a visit, for map painting. */
function visitRegion(state: GameState, world: World, bodyId: string, x: number, y: number): void {
  const region = world.surface(bodyId).regionAt(x, y);
  if (region === null) return;
  const know = knowledge(state, bodyId, region);
  if (know.visits === 0) {
    know.visits = 1;
    log(state, "travel", `Entered region ${region + 1} of ${world.body(bodyId).body.regions}.`);
  }
}

/** Charge the rover's cells to full (taking time), then roll it out beside the ship. */
export function deployRover(state: GameState, world: World): Result<{ chargedHours: number }> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (loc.rover) return fail("The rover is already out.");
  const full = effectiveStats(state).roverEnergy;
  const stored = Math.min(full, state.ship.roverEnergy ?? full);
  const chargedHours = (full - stored) / roverChargePerHour(state);
  advanceTime(state, 15 + chargedHours * HOUR);
  state.ship.roverEnergy = full;
  const home = shipTile(state, world);
  loc.rover = { x: home.x, y: home.y, energy: full, cargo: {} };
  revealAround(state, world);
  return ok({ chargedHours });
}

/** How the rover gets around: climbing gear, and Ground Navigator's way with rough ground. */
export function roverMobility(state: GameState): Mobility {
  return { canClimb: effectiveStats(state).roverCanClimb, roughAsPlain: hasPerk(state, "ground-navigator") };
}

/** Multiplier on route energy (Pathfinder: 10% less). Apply to findPath's step energy. */
export function routeEnergyMult(state: GameState): number {
  return hasPerk(state, "pathfinder") ? 0.9 : 1;
}

/** Energy to drive a planned route, with the crew's perks. */
export function routeEnergy(state: GameState, path: readonly { energy: number }[] | null): number {
  return (path ?? []).reduce((sum, s) => sum + s.energy, 0) * routeEnergyMult(state);
}

/** Drive toward (x, y), across region borders if needed. Stops early if energy runs short. */
export function moveRoverTo(state: GameState, world: World, x: number, y: number): Result<{ steps: number; stopped: string | null }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { surface, rover, bodyId } = ctx.value;
  if (rover.x === x && rover.y === y) return ok({ steps: 0, stopped: null });
  const path = findPath(surface, rover, { x, y }, roverMobility(state));
  const energyMult = routeEnergyMult(state);
  if (!path) return fail("No route there for this rover.");
  let steps = 0;
  for (const step of path) {
    if (rover.energy < step.energy * energyMult) {
      return ok({ steps, stopped: "Rover energy too low to continue." });
    }
    rover.energy -= step.energy * energyMult;
    rover.x = step.x;
    rover.y = step.y;
    advanceTime(state, step.minutes * SHIFT_FACTOR);
    steps++;
    visitRegion(state, world, bodyId, step.x, step.y);
    revealAround(state, world);
  }
  return ok({ steps, stopped: null });
}

function revealAround(state: GameState, world: World): void {
  const ctx = surfaceCtx(state, world);
  if (ctx.ok) revealAt(state, world, ctx.value.bodyId, ctx.value.rover);
}

/** Sweep the sensors (the rover's, or the ship's on the pad) around `center`, across region borders. */
function revealAt(state: GameState, world: World, bodyId: string, center: Vec2): void {
  const surface = world.surface(bodyId);
  const radius = sensorRadius(state, bodyId);
  // Seam Sense and Field Botanist: deposits and plants show up farther out than the terrain sweep.
  const depositRange = Math.floor(radius * (hasPerk(state, "seam-sense") ? 1.5 : 1));
  const floraRange = Math.floor(radius * (hasPerk(state, "field-botanist") ? 1.5 : 1));
  const hiddenSeams = hasPerk(state, "hidden-seams");
  const hiddenFlora = hasPerk(state, "ecologist");
  const foundDeposits: SurfaceDeposit[] = [];
  const foundFlora: SurfaceFlora[] = [];
  for (const region of surface.regionsNear(center, Math.max(radius, depositRange, floraRange))) {
    const know = knowledge(state, bodyId, region);
    const o = surface.origin(region);
    markExplored(know, center.x - o.x, center.y - o.y, radius);
    for (const d of surface.deposits(region)) {
      if (d.hidden && !hiddenSeams) continue;
      if (!know.discovered.includes(d.id) && hexDistance(d, center) <= depositRange) {
        know.discovered.push(d.id);
        foundDeposits.push(d);
      }
    }
    for (const f of surface.flora(region)) {
      if (f.hidden && !hiddenFlora) continue;
      if (!know.floraFound.includes(f.id) && hexDistance(f, center) <= floraRange) {
        know.floraFound.push(f.id);
        foundFlora.push(f);
      }
    }
  }
  awardXp(state, "science", 2 * (foundDeposits.length + foundFlora.length));
  if (foundDeposits.length > 0) {
    const names = foundDeposits.map((d) => COMMODITIES[d.commodity].name.toLowerCase());
    log(
      state,
      "discovery",
      `Sensors picked up ${foundDeposits.length === 1 ? "a deposit" : `${foundDeposits.length} deposits`}: ${names.join(", ")}.`,
    );
  }
  if (foundFlora.length > 0) {
    log(state, "discovery", `Plant life spotted: ${[...new Set(foundFlora.map((f) => f.species))].join(", ")}.`);
  }
}

/** A known deposit, by key, with its region's knowledge. */
export function surfaceDeposit(
  state: GameState,
  world: World,
  key: SiteKey,
): { deposit: SurfaceDeposit; know: RegionKnowledge } | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  const deposit = world.surface(loc.bodyId).deposit(key);
  if (!deposit) return null;
  const know = knowledge(state, loc.bodyId, deposit.region);
  return know.discovered.includes(deposit.id) ? { deposit, know } : null;
}

function depositNearRover(state: GameState, world: World, ctx: SurfaceCtx, key: SiteKey, range = 1): Result<{ d: SurfaceDeposit; know: RegionKnowledge }> {
  const found = surfaceDeposit(state, world, key);
  if (!found) return fail("Unknown deposit.");
  if (hexDistance(found.deposit, ctx.rover) > range) return fail(range > 1 ? `Drive the rover within ${range} hexes of the deposit first.` : "Drive the rover next to the deposit first.");
  return ok({ d: found.deposit, know: found.know });
}

/** How close the rover must be to prospect (Assayer: two hexes). Drilling always needs it adjacent. */
export function prospectRange(state: GameState): number {
  return hasPerk(state, "assayer") ? 2 : 1;
}

export function remainingTonnes(know: RegionKnowledge, d: Deposit): number {
  return Math.max(0, d.tonnes - (know.extracted[d.id] ?? 0));
}

export function prospect(state: GameState, world: World, key: SiteKey): Result<SurfaceDeposit> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const found = depositNearRover(state, world, ctx.value, key, prospectRange(state));
  if (!found.ok) return found;
  const { d, know } = found.value;
  const { rover } = ctx.value;
  if (know.prospected.includes(d.id)) return ok(d);
  if (rover.energy < PROSPECT_ENERGY) return fail("Not enough rover energy to take core samples.");
  rover.energy -= PROSPECT_ENERGY;
  advanceTime(state, PROSPECT_MINUTES * SHIFT_FACTOR * (hasPerk(state, "assayer") ? 0.5 : 1));
  know.prospected.push(d.id);
  awardXp(state, "science", 6);
  log(
    state,
    "discovery",
    `Core samples: ${COMMODITIES[d.commodity].name.toLowerCase()}, grade ${Math.round(d.grade * 100)}%, ` +
      `${d.depthM} m down, about ${Math.round(remainingTonnes(know, d))} t recoverable.`,
  );
  return ok(d);
}

export interface DrillResult {
  tonnes: number;
  hours: number;
  depleted: boolean;
  roverFull: boolean;
  /** What interrupted the work, if anything (storm, quake, breakdown). */
  incident: string | null;
}

/** Set up (once) and extract until the rover is full, the deposit runs out, energy fails, or maxHours pass. */
export function drill(state: GameState, world: World, key: SiteKey, maxHours = Infinity): Result<DrillResult> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const found = depositNearRover(state, world, ctx.value, key);
  if (!found.ok) return found;
  const { d, know } = found.value;
  const { rover, bodyId } = ctx.value;
  const stats = effectiveStats(state);
  if (!know.prospected.includes(d.id)) return fail("Prospect the deposit before drilling.");
  if (d.depthM > stats.drillMaxDepthM) return fail(`The seam is ${d.depthM} m down; the drill reaches ${stats.drillMaxDepthM} m.`);
  const remaining = remainingTonnes(know, d);
  if (remaining <= 0) return fail("This deposit is worked out.");
  const room = stats.roverCargoT - cargoTonnes(rover.cargo);
  if (room <= 0.05) return fail("The rover's cargo bed is full.");

  if (!know.drillSites.includes(d.id)) {
    if (rover.energy < DRILL_SETUP_ENERGY) return fail("Not enough energy to set up the drill rig.");
    rover.energy -= DRILL_SETUP_ENERGY;
    advanceTime(state, DRILL_SETUP_MINUTES * SHIFT_FACTOR);
    know.drillSites.push(d.id);
    awardXp(state, "engineering", 3);
  }

  const rate = drillRate(state, d);
  // Rich Veins: more ore per tonne of seam worked.
  const yieldMult = hasPerk(state, "rich-veins") ? 1.1 : 1;
  let hours = Math.min(remaining / rate, room / (rate * yieldMult), maxHours, rover.energy / DRILL_ENERGY_PER_HOUR);
  if (hours <= 0.01) return fail("Not enough rover energy to run the drill.");

  const { body } = world.body(bodyId);
  const crew = crewBonuses(state);
  const incident = withRng(state, (rng) => rollIncident(rng, body, hours, crew.incidentRate, crew.incidentHours));
  if (incident) hours *= incident.atFraction;

  const worked = Math.round(rate * hours * 10) / 10;
  const tonnes = Math.round(worked * yieldMult * 10) / 10;
  addCargo(rover.cargo, d.commodity, tonnes, stats.roverCargoT);
  know.extracted[d.id] = (know.extracted[d.id] ?? 0) + worked;
  rover.energy -= hours * DRILL_ENERGY_PER_HOUR;
  state.stats.tonnesMined += tonnes;
  advanceTime(state, hours * HOUR * SHIFT_FACTOR);
  log(state, "info", `Drilled ${tonnes} t of ${COMMODITIES[d.commodity].name.toLowerCase()} in ${formatDuration(hours * HOUR * SHIFT_FACTOR)}.`);

  const where = placeName(world, bodyId);
  if (tonnes > 0) recordFind(state, "mineral", d.commodity, where, COMMODITIES[d.commodity].name);
  const fortune = hasPerk(state, "fortune-favors");
  const gem = withRng(state, (rng) => rollMineralSpecimen(rng, d.commodity, hours, fortune ? 2 : 1));
  if (gem) foundMineralSpecimen(state, gem, where);

  if (incident) {
    rover.energy = Math.max(0, rover.energy - incident.energy);
    const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
    if (hasPerk(state, "jury-rig") && !loc.juryRigUsed) {
      loc.juryRigUsed = true;
      log(state, "warning", `${incident.text} The engineer jury-rigged it on the spot: no time lost.`);
    } else {
      advanceTime(state, incident.lostHours * HOUR);
      log(state, "warning", `${incident.text} Lost ${formatDuration(incident.lostHours * HOUR)}.`);
    }
    awardXp(state, "engineering", 10);
    awardXp(state, "medical", 6);
    // Fortune Favors: sometimes the trouble turns something up.
    if (fortune) {
      const lucky = withRng(state, (rng) => (rng.chance(0.25) ? rollMineralSpecimen(rng, d.commodity, hours, 100) : null));
      if (lucky) foundMineralSpecimen(state, lucky, where);
    }
  }
  return ok({
    tonnes,
    hours,
    depleted: remainingTonnes(know, d) <= 0.05,
    roverFull: stats.roverCargoT - cargoTonnes(rover.cargo) <= 0.05,
    incident: incident?.text ?? null,
  });
}

/** "Juniper IV (the Meadow)" */
export function placeName(world: World, bodyId: string): string {
  const { body } = world.body(bodyId);
  return body.nickname ? `${body.name} (${body.nickname})` : body.name;
}

interface Incident {
  text: string;
  /** Fraction of the planned drilling done before the interruption. */
  atFraction: number;
  lostHours: number;
  energy: number;
}

/** Storms, quakes and breakdowns, more likely on wilder worlds and over longer shifts. */
function rollIncident(rng: Rng, body: Body, hours: number, rateMult = 1, hoursMult = 1): Incident | null {
  const perHour = (INCIDENT_BASE_PER_HOUR + 0.004 * body.weather + 0.006 * body.tectonics) * rateMult;
  if (rng.next() >= 1 - Math.exp(-perHour * hours)) return null;
  const kind = rng.weighted([
    ["breakdown", INCIDENT_BASE_PER_HOUR],
    ["storm", 0.004 * body.weather],
    ["quake", 0.006 * body.tectonics],
  ] as const);
  const atFraction = rng.range(0.15, 0.9);
  const incident = pickIncident(rng, kind, atFraction);
  return { ...incident, lostHours: incident.lostHours * hoursMult };
}

function pickIncident(rng: Rng, kind: "breakdown" | "storm" | "quake", atFraction: number): Incident {
  switch (kind) {
    case "storm":
      return {
        text: "A storm rolled over the drill site; the crew sealed up and waited it out.",
        atFraction,
        lostHours: rng.range(6, 30),
        energy: rng.range(5, 15),
      };
    case "quake":
      return {
        text: "A quake shook the rig loose and the bore had to be re-seated.",
        atFraction,
        lostHours: rng.range(4, 14),
        energy: rng.range(10, 25),
      };
    default:
      return {
        text: "The drill head jammed and the crew spent a shift freeing it.",
        atFraction,
        lostHours: rng.range(3, 12),
        energy: rng.range(5, 12),
      };
  }
}

export const SAMPLE_MINUTES = 60;
export const SAMPLE_ENERGY = 3;

/** A spotted flora site, by key, with its region's knowledge. */
export function surfaceFlora(state: GameState, world: World, key: SiteKey): { site: SurfaceFlora; know: RegionKnowledge } | null {
  const loc = state.location;
  if (loc.kind !== "surface") return null;
  const site = world.surface(loc.bodyId).floraSite(key);
  if (!site) return null;
  const know = knowledge(state, loc.bodyId, site.region);
  return know.floraFound.includes(site.id) ? { site, know } : null;
}

/** Take a living sample from a flora site next to the rover. */
export function collectSample(state: GameState, world: World, key: SiteKey): Result<SurfaceFlora> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover, bodyId } = ctx.value;
  const found = surfaceFlora(state, world, key);
  if (!found) return fail("Unknown flora site.");
  const { site, know } = found;
  if (know.floraSampled.includes(site.id)) return fail("Already sampled here.");
  if (hexDistance(site, rover) > 1) return fail("Drive the rover next to the plants first.");
  const slots = roverSpecimenSlots(state);
  if (specimenCount(rover.specimens) >= slots) return fail("The rover's sample cases are full.");
  if (rover.energy < SAMPLE_ENERGY) return fail("Not enough rover energy to run the sample kit.");
  rover.energy -= SAMPLE_ENERGY;
  advanceTime(state, SAMPLE_MINUTES * SHIFT_FACTOR);
  rover.specimens ??= {};
  const specimen = specimenKey(bodyId, site.species);
  // Careful Hands: two samples from one site, if the cases have room.
  const count = hasPerk(state, "careful-hands") && specimenCount(rover.specimens) + 2 <= slots ? 2 : 1;
  rover.specimens[specimen] = (rover.specimens[specimen] ?? 0) + count;
  know.floraSampled.push(site.id);
  log(state, "discovery", count === 2 ? `Collected two living samples of ${site.species}.` : `Collected a living sample of ${site.species}.`);
  awardXp(state, "medical", 5);
  awardXp(state, "science", 2);
  const entry = FLORA_BY_NAME.get(site.species);
  if (entry) recordFind(state, "flora", entry.id, placeName(world, bodyId), entry.name);
  return ok(site);
}

/** Drive-free: the rover must already be at (or next to) the ship. Unloads, recharges, stows. */
export function stowRover(state: GameState, world: World): Result<{ unloaded: number; jettisoned: number }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover } = ctx.value;
  if (hexDistance(rover, shipTile(state, world)) > 1) {
    return fail("Drive the rover back to the ship first.");
  }
  const capacity = effectiveStats(state).cargoCapacityT;
  let unloaded = 0;
  let jettisoned = 0;
  for (const [id, tonnes] of Object.entries(rover.cargo) as [CommodityId, number][]) {
    const added = addCargo(state.ship.cargo, id, tonnes, capacity);
    unloaded += added;
    jettisoned += tonnes - added;
  }
  let lostSamples = 0;
  state.ship.specimens ??= {};
  for (const [key, n] of Object.entries(rover.specimens ?? {})) {
    const room = shipSpecimenSlots(state) - specimenCount(state.ship.specimens);
    const moved = Math.min(room, n);
    if (moved > 0) state.ship.specimens[key] = (state.ship.specimens[key] ?? 0) + moved;
    lostSamples += n - moved;
  }
  if (lostSamples > 0) log(state, "warning", `The containment racks are full. ${lostSamples} sample(s) had to be released.`);
  advanceTime(state, ROVER_STOW_MINUTES);
  state.ship.roverEnergy = rover.energy;
  (state.location as { rover: RoverState | null }).rover = null;
  if (jettisoned > 0.05) log(state, "warning", `The hold is full. ${jettisoned.toFixed(1)} t of ore left on the ground.`);
  return ok({ unloaded, jettisoned });
}

/** Plug the rover into the ship's reactor without stowing it: tops up the cells, takes time. */
export function rechargeRover(state: GameState, world: World): Result<{ hours: number }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover } = ctx.value;
  if (hexDistance(rover, shipTile(state, world)) > 1) {
    return fail("Drive the rover back to the ship to recharge.");
  }
  const full = effectiveStats(state).roverEnergy;
  if (rover.energy >= full - 0.5) return fail("The rover's cells are already full.");
  const hours = (full - rover.energy) / roverChargePerHour(state);
  advanceTime(state, hours * HOUR);
  rover.energy = full;
  return ok({ hours });
}

/** Rescue a rover that can't make it home: the ship hops over and picks it up. */
export function recallRover(state: GameState, world: World): Result {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover } = ctx.value;
  if (state.ship.fuel < RECALL_FUEL) return fail("Not enough fuel to hop the ship over to the rover.");
  state.ship.fuel -= RECALL_FUEL;
  advanceTime(state, RECALL_MINUTES);
  const home = shipTile(state, world);
  rover.x = home.x;
  rover.y = home.y;
  log(state, "warning", "Hopped the ship over to the rover and winched it aboard. It cost fuel and three hours.");
  return ok(undefined);
}

/**
 * Saves from before seamless terrain stored rover/ship positions in the landing region's local
 * coordinates. Convert them to planet-wide coordinates (idempotent).
 */
export function migrateSurfaceCoords(state: GameState, world: World): void {
  const loc = state.location;
  if (loc.kind !== "surface" || loc.globalCoords) return;
  const surface = world.surface(loc.bodyId);
  const o = surface.origin(loc.region);
  loc.ship = loc.ship ? { x: loc.ship.x + o.x, y: loc.ship.y + o.y } : surface.landing(loc.region);
  if (loc.rover) {
    loc.rover.x += o.x;
    loc.rover.y += o.y;
  }
  loc.globalCoords = true;
}

// --- the Intrepid ------------------------------------------------------------------------

function atIntrepid(state: GameState): Result {
  return state.location.kind === "intrepid" ? ok(undefined) : fail("Only available while docked at the Intrepid.");
}

export function sell(state: GameState, id: CommodityId, tonnes?: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const amount = removeCargo(state.ship.cargo, id, tonnes ?? Infinity);
  if (amount <= 0) return fail(`No ${COMMODITIES[id].name.toLowerCase()} aboard.`);
  const credits = Math.round(sellCommodity(state.market, id, amount, hasPerk(state, "bulk-seller") ? 0.5 : 1) * crewBonuses(state).salePrice);
  awardXp(state, "captain", credits / 500);
  state.credits += credits;
  state.stats.earned += credits;
  log(state, "trade", `Sold ${amount.toFixed(1)} t of ${COMMODITIES[id].name.toLowerCase()} for ${credits.toLocaleString()} cr.`);
  settlePayroll(state); // the crew gets paid out of the proceeds
  return ok(credits);
}

/** Tonnes of each commodity that active delivery contracts still need (kept back by sellAll). */
export function reservedCargo(state: GameState): Partial<Record<CommodityId, number>> {
  const out: Partial<Record<CommodityId, number>> = {};
  for (const c of state.contracts ?? []) {
    if (c.status !== "active" || c.kind !== "deliver" || !c.commodity) continue;
    out[c.commodity] = (out[c.commodity] ?? 0) + (c.tonnes ?? 0);
  }
  return out;
}

/** How much of a commodity can be sold without dipping into tonnage held for contracts. */
export function sellableTonnes(state: GameState, id: CommodityId): number {
  return Math.max(0, (state.ship.cargo[id] ?? 0) - (reservedCargo(state)[id] ?? 0));
}

/** Sell the hold, keeping back whatever active delivery contracts need. */
export function sellAll(state: GameState): Result<number> {
  let total = 0;
  let held = 0;
  for (const id of Object.keys(state.ship.cargo) as CommodityId[]) {
    const amount = sellableTonnes(state, id);
    held += (state.ship.cargo[id] ?? 0) - amount;
    if (amount <= 0.05) continue;
    const r = sell(state, id, amount);
    if (r.ok) total += r.value;
  }
  if (held > 0.05) log(state, "trade", `Kept ${held.toFixed(1)} t aboard for your delivery contracts.`);
  if (total > 0) return ok(total);
  return fail(held > 0.05 ? "Everything aboard is held for delivery contracts. Turn them in under Jobs." : "The hold is empty.");
}

export const SPECIMEN_PRICE = 300;
export const NEW_SPECIES_BONUS = 900;

/** Sell specimens to the Lyceum, keeping any that an active contract still needs. */
export function sellSpecimens(state: GameState): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const reserved = new Set((state.contracts ?? []).filter((c) => c.status === "active" && c.kind === "specimens").map((c) => c.bodyId));
  let total = 0;
  let sold = 0;
  const specimens = state.ship.specimens ?? {};
  for (const [key, n] of Object.entries(specimens)) {
    if (reserved.has(key.split("|")[0])) continue;
    const bonus = state.catalogedSpecies.includes(key) ? 0 : NEW_SPECIES_BONUS;
    if (bonus) state.catalogedSpecies.push(key);
    total += Math.round(n * SPECIMEN_PRICE * crewBonuses(state).specimenPrice) + bonus;
    awardXp(state, "medical", n);
    sold += n;
    delete specimens[key];
  }
  if (sold === 0) return fail("No specimens to sell (samples reserved for contracts are kept).");
  state.credits += total;
  state.stats.earned += total;
  settlePayroll(state);
  log(state, "trade", `The Lyceum bought ${sold} specimen(s) for ${total.toLocaleString()} cr.`);
  return ok(total);
}

export function buyFuel(state: GameState, units: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const room = effectiveStats(state).fuelCapacity - state.ship.fuel;
  const price = fuelPrice(state.market);
  const affordable = Math.floor(state.credits / price);
  const n = Math.min(Math.floor(units), Math.floor(room), affordable);
  if (n <= 0) return fail(room < 1 ? "Tanks are full." : "You can't afford any fuel.");
  state.ship.fuel += n;
  state.credits -= n * price;
  log(state, "trade", `Bought ${n} units of plicite fuel at ${price} cr.`);
  return ok(n);
}

/** The Exchange will advance fuel against the note, at a markup, until the balance hits this. */
export const FUEL_CREDIT_LIMIT = 90_000;
export const FUEL_CREDIT_MARKUP = 1.15;

/** How far the Exchange will let the note run for fuel (Credit Line: +50%). */
export function fuelCreditLimit(state: GameState): number {
  return FUEL_CREDIT_LIMIT * (hasPerk(state, "credit-line") ? 1.5 : 1);
}

/** Units of fuel the Exchange would still advance on credit right now. */
export function fuelCreditAvailable(state: GameState): number {
  const price = fuelPrice(state.market) * FUEL_CREDIT_MARKUP;
  const room = effectiveStats(state).fuelCapacity - state.ship.fuel;
  return Math.max(0, Math.min(Math.floor(room), Math.floor((fuelCreditLimit(state) - state.loan.balance) / price)));
}

/** Buy fuel on the Exchange's tab: no credits needed, but it's added to the loan with a markup. */
export function buyFuelOnCredit(state: GameState, units: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const n = Math.min(Math.floor(units), fuelCreditAvailable(state));
  if (n <= 0) return fail(state.loan.balance >= fuelCreditLimit(state) ? "The Exchange won't extend any more credit." : "Tanks are full.");
  const cost = Math.round(n * fuelPrice(state.market) * FUEL_CREDIT_MARKUP);
  state.ship.fuel += n;
  chargeToNote(state, cost);
  log(state, "warning", `The Exchange advanced ${n} units of fuel against your note: +${cost.toLocaleString()} cr owed.`);
  return ok(n);
}

/** Add a charge to the Exchange note. A note that was paid off restarts its installment schedule from today. */
function chargeToNote(state: GameState, amount: number): void {
  if (state.loan.balance <= 0) state.loan.nextDue = state.time + state.loan.intervalDays * DAY;
  state.loan.balance += amount;
}

// --- stranded ----------------------------------------------------------------------------

/**
 * Fuel to get from here back to the Intrepid: lift off (if landed), fly out to the system edge,
 * and fold home. 0 when docked.
 */
export function fuelToGetHome(state: GameState, world: World): number {
  const loc = state.location;
  if (loc.kind === "intrepid") return 0;
  const stats = effectiveStats(state);
  const crew = crewBonuses(state);
  const mass = shipMassT(state.ship, stats);
  const detail = world.system(loc.systemId);
  const pos = shipPosition(state, world) as Vec2;
  const toEdge = Math.max(0, detail.edgeAU - Math.hypot(pos.x, pos.y));
  const flight = IN_SYSTEM_FUEL_PER_AU_PER_KT * (mass / 1000) * toEdge * crew.flightFuel;
  const ascent = loc.kind === "surface" ? surfaceBurnFuel(state, world.body(loc.bodyId).body) : 0;
  const fold = FOLD_FUEL_PER_T_LY * mass * distanceLy(world.galaxy, loc.systemId, "intrepid") * crew.foldFuel;
  return Math.round((ascent + flight + fold) * 10) / 10;
}

/** Fixed charge for sending a tender out, plus this much per light-year to reach you. */
export const RESCUE_FEE = 2_000;
export const RESCUE_FEE_PER_LY = 300;
/** Rescue fuel is priced well above the Market's. */
export const RESCUE_FUEL_MARKUP = 1.5;

export interface RescueQuote {
  /** Fuel the tender brings: enough to get home, with a little margin. */
  fuel: number;
  /** Added to the Exchange note. */
  cost: number;
  /** Days to wait for the tender. */
  days: number;
}

/** What a distress call would cost, or null if the ship can still get home on its own. */
export function rescueQuote(state: GameState, world: World): RescueQuote | null {
  const loc = state.location;
  if (loc.kind === "intrepid") return null;
  const need = fuelToGetHome(state, world);
  if (state.ship.fuel >= need) return null;
  const room = effectiveStats(state).fuelCapacity - state.ship.fuel;
  const fuel = Math.max(1, Math.min(Math.floor(room), Math.ceil(need - state.ship.fuel + 2)));
  const ly = distanceLy(world.galaxy, loc.systemId, "intrepid");
  // Distress Net: the comms officer raises a tender sooner and haggles the bill down.
  const net = hasPerk(state, "distress-net");
  return {
    fuel,
    cost: Math.round(((fuel * fuelPrice(state.market) * RESCUE_FUEL_MARKUP + RESCUE_FEE + RESCUE_FEE_PER_LY * ly) * (net ? 0.75 : 1)) / 10) * 10,
    days: Math.max(1, Math.round((3 + ly) * (net ? 0.5 : 1))),
  };
}

/**
 * Out of fuel and out of luck: the Exchange sends a tender with enough plicite to get home and
 * adds the bill to your note. It's expensive and slow, but nobody is left out there.
 */
export function callForRescue(state: GameState, world: World): Result<RescueQuote> {
  const quote = rescueQuote(state, world);
  if (!quote) return fail("You have the fuel to get home. Save the distress call for when you need it.");
  advanceTime(state, quote.days * DAY);
  state.ship.fuel += quote.fuel;
  chargeToNote(state, quote.cost);
  log(
    state,
    "warning",
    `An Exchange tender answered the distress call after ${quote.days} days and pumped ${quote.fuel} units of plicite aboard. ` +
      `${quote.cost.toLocaleString()} cr added to your note.`,
  );
  return ok(quote);
}

/** Yard time to fit any upgrade. */
export const UPGRADE_INSTALL_DAYS = 2;

export function buyUpgrade(state: GameState, upgradeId: string): Result {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const upgrade = UPGRADES_BY_ID.get(upgradeId);
  if (!upgrade) return fail("Unknown upgrade.");
  if (state.ship.upgrades.includes(upgradeId)) return fail("Already installed.");
  if (upgrade.requires && !state.ship.upgrades.includes(upgrade.requires)) {
    return fail(`Requires ${UPGRADES_BY_ID.get(upgrade.requires)?.name ?? upgrade.requires} first.`);
  }
  if (state.credits < upgrade.price) return fail(`Costs ${upgrade.price.toLocaleString()} cr.`);
  state.credits -= upgrade.price;
  state.ship.upgrades.push(upgradeId);
  advanceTime(state, UPGRADE_INSTALL_DAYS * DAY);
  log(state, "trade", `Installed ${upgrade.name}. ${UPGRADE_INSTALL_DAYS} days in the yard.`);
  return ok(undefined);
}

export function payLoan(state: GameState, amount: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const pay = Math.min(Math.floor(amount), state.credits, state.loan.balance);
  if (pay <= 0) return fail(state.loan.balance <= 0 ? "Nothing owed." : "No credits to pay with.");
  state.credits -= pay;
  state.stats.loanPaid = (state.stats.loanPaid ?? 0) + pay;
  state.loan.balance -= pay;
  // Counts toward upcoming installments, so the next auto-debit draws on it first.
  state.loan.prepaid = (state.loan.prepaid ?? 0) + pay;
  log(state, "trade", `Paid ${pay.toLocaleString()} cr toward the Exchange note. Balance: ${state.loan.balance.toLocaleString()} cr.`);
  return ok(pay);
}

/** Let time pass: waiting for the fold drive, for research, or for prices to recover. */
export function wait(state: GameState, minutes: number): Result {
  if (state.location.kind === "surface" && state.location.rover) return fail("Stow the rover before waiting.");
  advanceTime(state, Math.max(0, minutes));
  return ok(undefined);
}
