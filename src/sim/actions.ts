/**
 * Every player verb. Each action validates against the current state, then mutates it and
 * advances time. Failures return a reason the UI can show verbatim; they never throw.
 */
import { clanMods, upgradePriceFor } from "./clan";
import { bodyNickname } from "./nicknames";
import { COMMODITIES, CONC_RATIO, CONC_SOURCE, type CommodityId } from "../data/commodities";
import { isConcentrate } from "./refinery";
import { driveDamageMult, finishRepairs, maybeInterdict } from "./combat";
import { researchFor, upgradeUnlocked } from "./research";
import { CLAN_NAMES, UPGRADES_BY_ID } from "../data/ship";
import { bodyPosition, KIND_LABEL, type Body } from "./bodies";
import { burnPath } from "./burnpath";
import { boatMobility, siteOnWater, vehicleCargoT, vehicleEnergyMax, vehicleOf, vehiclesOut } from "./vehicles";
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
import { helmCoversRescue, helmOnDeparture, helmOnDocked, netWorth } from "./helm";
import { bondClan, cheerAll, cheerStation, payShare, sentimentOnDocked } from "./sentiment";
import { effectiveStats, finishRetraining, hasPerk, roverSpecimenSlots, shipSpecimenSlots } from "./perks";
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
export const PROSPECT_MINUTES = 3 * HOUR;
export const DRILL_SETUP_MINUTES = 5 * HOUR;
/** Rover energy per drilling hour; scaled with DRILL_PACE so a tonne costs the same energy. */
export const DRILL_ENERGY_PER_HOUR = 0.525;
/**
 * The slower clock (AW-142): extraction runs at about a third of the old pace, so a trip takes
 * 45-50 days instead of ~30. Per-day costs and rates were halved to match, keeping money per trip.
 */
export const DRILL_PACE = 0.35;
export const ROVER_STOW_MINUTES = 30;
export const PROSPECT_ENERGY = 4;
export const DRILL_SETUP_ENERGY = 6;
export const RECALL_FUEL = 1.5;
export const RECALL_MINUTES = 3 * HOUR;
export const SURVEY_MINUTES = 12 * HOUR;
/** Rover cells recharge from the ship's reactor at this many energy units per hour. */
export const ROVER_CHARGE_PER_HOUR = 10;

/** A stowed rover charges from the ship's reactor as time passes (in flight, in orbit, on the pad). */
export function chargeStowedRover(state: GameState, minutes: number): void {
  const out = vehiclesOut(state);
  const stats = effectiveStats(state);
  const gain = (roverChargePerHour(state) * minutes) / 60;
  if (!out.rover) {
    const stored = state.ship.roverEnergy ?? stats.roverEnergy;
    if (stored < stats.roverEnergy) state.ship.roverEnergy = Math.min(stats.roverEnergy, stored + gain);
  }
  // The boat (AW-17) charges from the same reactor while it's in the bay.
  if (!out.boat && stats.boatEnergy > 0) {
    const stored = state.ship.boatEnergy ?? stats.boatEnergy;
    if (stored < stats.boatEnergy) state.ship.boatEnergy = Math.min(stats.boatEnergy, stored + gain);
  }
}

/** Charge rate at the ship (Fast Charge doubles it). */
export function roverChargePerHour(state: GameState): number {
  return ROVER_CHARGE_PER_HOUR * (hasPerk(state, "fast-charge") ? 2 : 1) * effectiveStats(state).roverChargeMult;
}

/** Multiplier on route time (uprated drive motors). Apply to findPath's step minutes. */
export function routeMinutesMult(state: GameState): number {
  return effectiveStats(state).roverDriveTime;
}
/**
 * Surface crews work two 8-hour shifts a day, so hands-on work takes 1.5x its raw duration.
 * Applies to driving, prospecting and drilling.
 */
export const SHIFT_FACTOR = 1.5;
/** Chance per drilling hour of a plain equipment breakdown; weather and tectonics add to it. */
export const INCIDENT_BASE_PER_HOUR = 0.003;

/**
 * Folding is hard on a ship: afterwards the engineers scrub and re-seat the drive before it can fold
 * again. Longer folds do more damage. (Before the engineer and any rush crews.)
 */
export function foldRefitMinutes(ly: number): number {
  return DAY * (REFIT_BASE_DAYS + REFIT_DAYS_PER_LY * ly);
}

export const REFIT_BASE_DAYS = 6;
export const REFIT_DAYS_PER_LY = 2.25;

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
  /** Drive refit after this fold, before the next one. */
  refitMinutes: number;
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
    blockers.push(`Fold drive refit: ready in ${formatDuration(state.foldReadyAt - state.time)}.`);
  }
  if (state.location.kind === "intrepid" && yardReadyAt(state) > state.time) {
    blockers.push(`Yard work in progress: done in ${formatDuration(yardReadyAt(state) - state.time)}.`);
  }
  if (ly > stats.foldRangeLy) blockers.push(`${ly.toFixed(1)} ly is beyond the drive's ${stats.foldRangeLy} ly range.`);
  if (fuel > state.ship.fuel) blockers.push(`Needs ${fuel} fuel; tanks hold ${state.ship.fuel.toFixed(1)}.`);
  return { ly, fuel, refitMinutes: Math.round(foldRefitMinutes(ly) * crew.foldRefit * clanMods(state).foldRefit), blockers };
}

export function fold(state: GameState, world: World, targetId: string): Result {
  if (state.encounter) return fail("A raider has you under its guns.");
  const plan = foldPlan(state, world, targetId);
  if (plan.blockers.length > 0) return fail(plan.blockers[0] as string);

  const fromId = currentSystemId(state);
  // Combat v1: a raider may be waiting as the drive spools up (one roll per departure).
  if (fromId !== "intrepid") {
    const raider = maybeInterdict(state, world, fromId);
    if (raider) return fail(`${raider} hails you as the fold drive spools up.`);
  }
  state.interdictionClear = undefined;
  state.ship.fuel = Math.max(0, state.ship.fuel - plan.fuel);
  state.stats.folds++;
  // Folding is instant (lore). The drive's refit clock starts now.
  state.foldReadyAt = state.time + plan.refitMinutes;
  // The crew tops up the rover's cells from the reactor during the pre-fold checks.
  state.ship.roverEnergy = effectiveStats(state).roverEnergy;
  awardXp(state, "navigation", 15 + 3 * plan.ly);

  if (fromId === "intrepid") helmOnDeparture(state);
  if (targetId === "intrepid") {
    state.location = { kind: "intrepid" };
    advanceTime(state, DOCKING_MINUTES);
    log(state, "travel", `Folded ${plan.ly.toFixed(1)} ly home and docked with the Intrepid.`);
    const departWorth = state.helm?.departWorth;
    sentimentOnDocked(state, departWorth === undefined ? null : netWorth(state) - departWorth);
    helmOnDocked(state);
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
  const prepared = prepareFold(state, world, targetId);
  if (!prepared.ok) return prepared;
  const folded = fold(state, world, targetId);
  if (!folded.ok) return folded;
  return prepared;
}

/**
 * Everything a one-click departure does before the fold itself: fly out to the edge if needed and
 * wait out the refit and the yard. Split from the fold so the UI can show the wait before revealing
 * the destination.
 */
export function prepareFold(state: GameState, world: World, targetId: string): Result<{ waited: number; flewToEdge: boolean }> {
  const plan = foldPlan(state, world, targetId);
  const hard = plan.blockers.filter((b) => !isWaitBlocker(b) && !b.startsWith("Folds can't start inside"));
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
  const waited = Math.max(0, departureReadyAt(state) - state.time);
  if (waited > 0) {
    advanceTime(state, waited);
    log(state, "travel", `Waited ${formatDuration(waited)} for the fold-drive refit${state.location.kind === "intrepid" ? " and the yard" : ""}.`);
  }
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
      t = travelMinutes(burnPath(from, arrival).length, stats.cruiseSpeedC) + MANEUVER_MINUTES;
      arrival = bodyPosition(detail, body, state.time + t);
    }
    // Burns swing around the star rather than through it.
    distanceAU = burnPath(from, arrival).length;
  }

  const minutes =
    travelMinutes(distanceAU, stats.cruiseSpeedC) * (hasPerk(state, "gravity-assist") ? 0.8 : 1) * crewBonuses(state).flightTime * driveDamageMult(state) + MANEUVER_MINUTES;
  const fuel =
    Math.round(IN_SYSTEM_FUEL_PER_AU_PER_KT * (shipMassT(state.ship, stats) / 1000) * distanceAU * crewBonuses(state).flightFuel * 100) / 100;
  return ok({ distanceAU, minutes, fuel, arrival });
}

export function flyTo(state: GameState, world: World, target: FlightTarget): Result<FlightPlan> {
  if (state.encounter) return fail("A raider has you under its guns.");
  if (state.probeDive) return fail("A probe is still on its way down: see it through first.");
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

/**
 * What a world looks worth from orbit: the estimated value of its richest region (and the average),
 * read the way the landing chart reads it (orbital sensor tier, drill reach). Null if unscanned or
 * without a surface.
 */
export function bodyValueEstimate(state: GameState, body: Body): { best: number; average: number } | null {
  if (body.regions === 0 || !state.scannedBodies.includes(body.id)) return null;
  const tier = orbitalSensorTier(state, body.id);
  const reach = effectiveStats(state).drillMaxDepthM;
  let best = 0;
  let sum = 0;
  for (let r = 0; r < body.regions; r++) {
    const v = regionSignal(state.seed, body, r, tier, reach);
    sum += v;
    if (v > best) best = v;
  }
  return { best, average: sum / body.regions };
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
  return effectiveStats(state).drillRateTph * DRILL_PACE * (0.4 + d.grade) * crewBonuses(state).drillRate * clanMods(state).drillRate;
}

/** A slow, careful orbital pass: sharper region readings and wider rover detection on this body. */
/** A detailed survey's duration (Close Orbit halves it). */
export function surveyMinutes(state: GameState): number {
  return SURVEY_MINUTES * (hasPerk(state, "close-orbit") ? 0.5 : 1) * clanMods(state).scanTime;
}

/** Prospector's Eye: the survey charts every deposit on the world, so they're known before landing. */
/**
 * Prospector's Eye: when the ship sets down, its sensors mark every deposit in that region as an
 * unidentified reading ("?"). What each one is stays unknown until the rover's sensors get close.
 */
function senseRegionDeposits(state: GameState, world: World, bodyId: string, region: number): void {
  if (!hasPerk(state, "prospectors-eye")) return;
  const hidden = hasPerk(state, "hidden-seams");
  const know = knowledge(state, bodyId, region);
  const sensed = (know.sensed ??= []);
  let n = 0;
  for (const d of world.surface(bodyId).deposits(region)) {
    if ((d.hidden && !hidden) || know.discovered.includes(d.id) || sensed.includes(d.id)) continue;
    sensed.push(d.id);
    n++;
  }
  if (n > 0) log(state, "discovery", `The ship's sensors mark ${n} unidentified deposit reading${n === 1 ? "" : "s"} in this region.`);
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
  awardXp(state, "science", 25);
  log(state, "discovery", `Detailed survey of ${body.name} complete. Region readings sharpened; rover sensors will reach farther here.`);
  return ok(body);
}

export function scanBody(state: GameState, world: World): Result<Body> {
  const body = orbitingBody(state, world);
  if (!body) return fail("Enter orbit first.");
  if (state.scannedBodies.includes(body.id)) return ok(body);
  advanceTime(state, SCAN_MINUTES * clanMods(state).scanTime);
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
  if (state.encounter) blockers.push("A raider has you under its guns.");
  if (!state.scannedBodies.includes(body.id)) blockers.push("Scan the body before landing.");
  blockers.push(...landingAccess(body, effectiveStats(state).ratings).reasons);
  if (body.regions > 0 && (region < 0 || region >= body.regions || !Number.isInteger(region))) {
    blockers.push("Choose a valid landing region.");
  } else if (body.regions > 0) {
    // Ocean worlds (AW-17): the ship needs an island to set down on.
    const surface = world.surface(body.id);
    const spot = surface.landing(region);
    if (!canEnter(surface, spot.x, spot.y, false)) blockers.push("No dry land in this region to set down on. Pick another.");
  }
  const fuel = surfaceBurnFuel(state, body);
  if (fuel > state.ship.fuel) blockers.push(`Descent needs ${fuel} fuel.`);
  return blockers;
}

/** Fuel for one descent or ascent: heavier ships and stronger gravity cost more. */
export function surfaceBurnFuel(state: GameState, body: Body): number {
  return Math.round(0.4 * Math.max(0.05, body.gravityG) * (shipMassT(state.ship) / 1000) * effectiveStats(state).surfaceBurnMult * 10) / 10;
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
  senseRegionDeposits(state, world, body.id, region);
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
  const landedIn = surface.regionAt(x, y);
  if (landedIn !== null) senseRegionDeposits(state, world, loc.bodyId, landedIn);
  return ok(undefined);
}

/** First arrival in a region (by rover or ship hop) counts as a visit, for map painting. */
export function visitRegion(state: GameState, world: World, bodyId: string, x: number, y: number): void {
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

/** How the vehicle being driven gets around: the boat on water, the rover on land. */
export function vehicleMobility(state: GameState): Mobility {
  const loc = state.location;
  return loc.kind === "surface" && loc.rover && vehicleOf(loc.rover) === "boat" ? boatMobility() : roverMobility(state);
}

/** Multiplier on route minutes: the drive motors are the rover's; the boat keeps its own pace. */
export function vehicleMinutesMult(state: GameState): number {
  const loc = state.location;
  return loc.kind === "surface" && loc.rover && vehicleOf(loc.rover) === "boat" ? 1 : routeMinutesMult(state);
}

/** Drive (or sail) toward (x, y), across region borders if needed. Stops early if energy runs short. */
export function moveRoverTo(state: GameState, world: World, x: number, y: number): Result<{ steps: number; stopped: string | null }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { surface, rover, bodyId } = ctx.value;
  if (rover.x === x && rover.y === y) return ok({ steps: 0, stopped: null });
  const boat = vehicleOf(rover) === "boat";
  const path = findPath(surface, rover, { x, y }, vehicleMobility(state));
  const energyMult = routeEnergyMult(state);
  // The drive motors are the rover's; the boat keeps its own pace.
  const minutesMult = vehicleMinutesMult(state);
  if (!path) return fail(boat ? "No open water route there." : "No route there for this rover.");
  let steps = 0;
  for (const step of path) {
    if (rover.energy < step.energy * energyMult) {
      return ok({ steps, stopped: "Rover energy too low to continue." });
    }
    rover.energy -= step.energy * energyMult;
    rover.x = step.x;
    rover.y = step.y;
    advanceTime(state, step.minutes * SHIFT_FACTOR * minutesMult);
    steps++;
    visitRegion(state, world, bodyId, step.x, step.y);
    revealAround(state, world);
  }
  return ok({ steps, stopped: null });
}

export function revealAround(state: GameState, world: World): void {
  const ctx = surfaceCtx(state, world);
  if (ctx.ok) revealAt(state, world, ctx.value.bodyId, ctx.value.rover);
}

/** Sweep the sensors (the rover's, or the ship's on the pad) around `center`, across region borders. */
export interface SensorSweep {
  /** Terrain sweep radius, in hexes. */
  radius: number;
  /** Deposits are identified out to here (the terrain sweep). */
  depositRange: number;
  /** Plant sites are identified out to here (the terrain sweep). */
  floraRange: number;
  /** Deposits beyond depositRange but within this show as unidentified readings (Seam Sense). */
  depositSenseRange: number;
  /** Plant sites beyond floraRange but within this show as unidentified readings (Field Botanist). */
  floraSenseRange: number;
  /** Hidden Seams: the hidden deposit layer is detectable. */
  hiddenSeams: boolean;
  /** Ecologist: the hidden plant layer is detectable. */
  hiddenFlora: boolean;
}

/** The sensors' reach on this body. The UI's drive preview uses this too, so both agree on what's found. */
export function sensorSweep(state: GameState, bodyId: string): SensorSweep {
  const radius = sensorRadius(state, bodyId);
  return {
    radius,
    depositRange: radius,
    floraRange: radius,
    depositSenseRange: Math.floor(radius * (hasPerk(state, "seam-sense") ? 1.5 : 1)),
    floraSenseRange: Math.floor(radius * (hasPerk(state, "field-botanist") ? 1.5 : 1)),
    hiddenSeams: hasPerk(state, "hidden-seams"),
    hiddenFlora: hasPerk(state, "ecologist"),
  };
}

/** Would a sweep centred at `center` detect this deposit? */
export function detectsDeposit(sweep: SensorSweep, center: Vec2, d: { x: number; y: number; hidden?: boolean }): boolean {
  return (!d.hidden || sweep.hiddenSeams) && hexDistance(d, center) <= sweep.depositRange;
}

/** Would a sweep centred at `center` detect this plant site? */
export function detectsFlora(sweep: SensorSweep, center: Vec2, f: { x: number; y: number; hidden?: boolean }): boolean {
  return (!f.hidden || sweep.hiddenFlora) && hexDistance(f, center) <= sweep.floraRange;
}

/** Would a sweep at `center` sense (but not identify) this deposit? Seam Sense's outer ring. */
export function sensesDeposit(sweep: SensorSweep, center: Vec2, d: { x: number; y: number; hidden?: boolean }): boolean {
  return (!d.hidden || sweep.hiddenSeams) && hexDistance(d, center) <= sweep.depositSenseRange;
}

/** Would a sweep at `center` sense (but not identify) this plant site? Field Botanist's outer ring. */
export function sensesFlora(sweep: SensorSweep, center: Vec2, f: { x: number; y: number; hidden?: boolean }): boolean {
  return (!f.hidden || sweep.hiddenFlora) && hexDistance(f, center) <= sweep.floraSenseRange;
}

function revealAt(state: GameState, world: World, bodyId: string, center: Vec2): void {
  const surface = world.surface(bodyId);
  const sweep = sensorSweep(state, bodyId);
  const { radius, depositSenseRange, floraSenseRange } = sweep;
  const foundDeposits: SurfaceDeposit[] = [];
  const foundFlora: SurfaceFlora[] = [];
  let sensed = 0;
  for (const region of surface.regionsNear(center, Math.max(radius, depositSenseRange, floraSenseRange))) {
    const know = knowledge(state, bodyId, region);
    const o = surface.origin(region);
    markExplored(know, center.x - o.x, center.y - o.y, radius);
    for (const d of surface.deposits(region)) {
      if (know.discovered.includes(d.id)) continue;
      if (detectsDeposit(sweep, center, d)) {
        know.discovered.push(d.id);
        if (know.sensed) know.sensed = know.sensed.filter((id) => id !== d.id);
        foundDeposits.push(d);
      } else if (sensesDeposit(sweep, center, d) && !(know.sensed ??= []).includes(d.id)) {
        know.sensed.push(d.id);
        sensed++;
      }
    }
    for (const f of surface.flora(region)) {
      if (know.floraFound.includes(f.id)) continue;
      if (detectsFlora(sweep, center, f)) {
        know.floraFound.push(f.id);
        if (know.floraSensed) know.floraSensed = know.floraSensed.filter((id) => id !== f.id);
        foundFlora.push(f);
      } else if (sensesFlora(sweep, center, f) && !(know.floraSensed ??= []).includes(f.id)) {
        know.floraSensed.push(f.id);
        sensed++;
      }
    }
  }
  if (sensed > 0) log(state, "discovery", `Sensors flag ${sensed} unidentified reading${sensed === 1 ? "" : "s"} at the edge of their range.`);
  awardXp(state, "science", 2 * (foundDeposits.length + foundFlora.length));
  if (foundDeposits.length + foundFlora.length > 0) cheerStation(state, "science", Math.min(2, foundDeposits.length + foundFlora.length));
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
  const wet = siteOnWater(world, ctx.bodyId, found.deposit);
  const v = vehicleOf(ctx.rover);
  if (wet && v !== "boat") return fail("That seam is under the sea: take the boat out to dredge it.");
  if (!wet && v === "boat") return fail("That deposit is on land: put the rover ashore to work it.");
  if (hexDistance(found.deposit, ctx.rover) > range) {
    const what = v === "boat" ? "Sail the boat" : "Drive the rover";
    return fail(range > 1 ? `${what} within ${range} hexes of the deposit first.` : `${what} next to the deposit first.`);
  }
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
  const bed = vehicleCargoT(state, vehicleOf(rover));
  const room = bed - cargoTonnes(rover.cargo);
  if (room <= 0.05) return fail(vehicleOf(rover) === "boat" ? "The boat's hold is full." : "The rover's cargo bed is full.");

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
  addCargo(rover.cargo, d.commodity, tonnes, bed);
  know.extracted[d.id] = (know.extracted[d.id] ?? 0) + worked;
  rover.energy -= hours * DRILL_ENERGY_PER_HOUR;
  state.stats.tonnesMined += tonnes;
  advanceTime(state, hours * HOUR * SHIFT_FACTOR);
  log(state, "info", `${vehicleOf(rover) === "boat" ? "Dredged" : "Drilled"} ${tonnes} t of ${COMMODITIES[d.commodity].name.toLowerCase()} in ${formatDuration(hours * HOUR * SHIFT_FACTOR)}.`);

  const where = placeName(world, bodyId, state);
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
    cheerAll(state, -1);
    cheerStation(state, "engineering", -2);
    cheerStation(state, "medical", -1);
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
    roverFull: bed - cargoTonnes(rover.cargo) <= 0.05,
    incident: incident?.text ?? null,
  });
}

/** "Juniper IV (the Meadow)" */
export function placeName(world: World, bodyId: string, state?: Pick<GameState, "nicknames">): string {
  const { body } = world.body(bodyId);
  const nick = state ? bodyNickname(state, body) : body.nickname;
  return nick ? `${body.name} (${nick})` : body.name;
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

export const SAMPLE_MINUTES = 90;
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
  const wet = siteOnWater(world, bodyId, site);
  if (wet && vehicleOf(rover) !== "boat") return fail("That's sea life: take the boat out to sample it.");
  if (!wet && vehicleOf(rover) === "boat") return fail("Those grow ashore: put the rover ashore to sample them.");
  if (hexDistance(site, rover) > 1) return fail(wet ? "Sail the boat next to it first." : "Drive the rover next to the plants first.");
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
  cheerStation(state, "medical", 1);
  const entry = FLORA_BY_NAME.get(site.species);
  if (entry) recordFind(state, "flora", entry.id, placeName(world, bodyId, state), entry.name);
  return ok(site);
}

/** Drive-free: the rover must already be at (or next to) the ship. Unloads, recharges, stows. */
export function stowRover(state: GameState, world: World): Result<{ unloaded: number; jettisoned: number }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover } = ctx.value;
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  if (loc.parkedBoat) return fail("The boat is still moored offshore: drive the rover aboard and sail it back first.");
  if (hexDistance(rover, shipTile(state, world)) > 1) {
    return fail(vehicleOf(rover) === "boat" ? "Sail the boat back to the ship first." : "Drive the rover back to the ship first.");
  }
  return ok(unloadAll(state));
}

/** Unload, stow and plug in every vehicle that's out (the boat and the rover on its deck, or the rover). */
function unloadAll(state: GameState): { unloaded: number; jettisoned: number } {
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  const vehicles = [loc.rover, loc.roverAboard, loc.parkedBoat].filter((v): v is RoverState => !!v);
  const capacity = effectiveStats(state).cargoCapacityT;
  let unloaded = 0;
  let jettisoned = 0;
  let lostSamples = 0;
  state.ship.specimens ??= {};
  for (const v of vehicles) {
    for (const [id, tonnes] of Object.entries(v.cargo) as [CommodityId, number][]) {
      const added = addCargo(state.ship.cargo, id, tonnes, capacity);
      unloaded += added;
      jettisoned += tonnes - added;
    }
    for (const [key, n] of Object.entries(v.specimens ?? {})) {
      const room = shipSpecimenSlots(state) - specimenCount(state.ship.specimens);
      const moved = Math.min(room, n);
      if (moved > 0) state.ship.specimens[key] = (state.ship.specimens[key] ?? 0) + moved;
      lostSamples += n - moved;
    }
    if (vehicleOf(v) === "boat") state.ship.boatEnergy = v.energy;
    else state.ship.roverEnergy = v.energy;
  }
  if (lostSamples > 0) log(state, "warning", `The containment racks are full. ${lostSamples} sample(s) had to be released.`);
  advanceTime(state, ROVER_STOW_MINUTES);
  loc.rover = null;
  loc.roverAboard = undefined;
  loc.parkedBoat = undefined;
  if (jettisoned > 0.05) log(state, "warning", `The hold is full. ${jettisoned.toFixed(1)} t of ore left on the ground.`);
  return { unloaded, jettisoned };
}

/** Plug the rover into the ship's reactor without stowing it: tops up the cells, takes time. */
export function rechargeRover(state: GameState, world: World): Result<{ hours: number }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { rover } = ctx.value;
  if (hexDistance(rover, shipTile(state, world)) > 1) {
    return fail("Drive the rover back to the ship to recharge.");
  }
  const full = vehicleEnergyMax(state, vehicleOf(rover));
  if (rover.energy >= full - 0.5) return fail(vehicleOf(rover) === "boat" ? "The boat's cells are already full." : "The rover's cells are already full.");
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
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  if (vehicleOf(rover) === "boat" || loc.parkedBoat) {
    // The boat can't come ashore under its own power: the ship picks up everything and stows it.
    unloadAll(state);
    log(state, "warning", "Hopped the ship out to the boat and winched everything aboard. It cost fuel and three hours.");
    return ok(undefined);
  }
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
  // The captain's clan: Exchange sells a little better; the Diggers tithe precious metals.
  const mods = clanMods(state);
  const tithe = ["platinum", "plicite", "platinumConc"].includes(id) ? 1 - mods.tithe : 1;
  const credits = Math.round(sellCommodity(state.market, id, amount, hasPerk(state, "bulk-seller") ? 0.7 : 1) * crewBonuses(state).salePrice * mods.salePrice * tithe);
  awardXp(state, "captain", credits / 500);
  state.credits += credits;
  state.stats.earned += credits;
  log(state, "trade", `Sold ${amount.toFixed(1)} t of ${COMMODITIES[id].name.toLowerCase()} for ${credits.toLocaleString()} cr.`);
  const bonus = payShare(state, credits);
  if (bonus > 0) {
    state.credits -= bonus;
    log(state, "trade", `Paid the crew ${bonus.toLocaleString()} cr as their share.`);
  }
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

/**
 * Dump cargo from the hold: out of the airlock in space, onto the ground on a surface. For a hold
 * filled with the wrong ore, or to lighten the ship for a fold home. (At the Intrepid, sell it.)
 */
export function jettisonCargo(state: GameState, id: CommodityId, tonnes?: number): Result<number> {
  if (state.location.kind === "intrepid") return fail("Docked at the Intrepid: sell it instead.");
  const have = state.ship.cargo[id] ?? 0;
  const amount = Math.round(Math.min(have, tonnes ?? have) * 10) / 10;
  if (amount < 0.1) return fail("Nothing to jettison.");
  removeCargo(state.ship.cargo, id, amount);
  advanceTime(state, 20);
  log(state, "warning", `Jettisoned ${amount} t of ${COMMODITIES[id].name.toLowerCase()}${state.location.kind === "surface" ? " onto the ground" : " out of the airlock"}.`);
  return ok(amount);
}

/** How much of a commodity can be sold without dipping into tonnage held for contracts. */
export function sellableTonnes(state: GameState, id: CommodityId): number {
  // Concentrate (AW-18) covers whatever a delivery still needs after the raw ore.
  if (isConcentrate(id)) {
    const ore = CONC_SOURCE[id];
    const short = Math.max(0, (reservedCargo(state)[ore] ?? 0) - (state.ship.cargo[ore] ?? 0));
    return Math.max(0, (state.ship.cargo[id] ?? 0) - short / CONC_RATIO);
  }
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

/** What the Lyceum pays per specimen under this key ("bodyId|species"): floating life is prized (priceMult), and the comms crew's bonus applies. */
export function specimenUnitPrice(state: GameState, key: string): number {
  const priceMult = FLORA_BY_NAME.get(key.split("|")[1] ?? "")?.priceMult ?? 1;
  return SPECIMEN_PRICE * priceMult * crewBonuses(state).specimenPrice * effectiveStats(state).specimenPriceMult * clanMods(state).specimenPrice;
}

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
    // The Lyceum pays a bonus for the first specimen of each species, wherever it came from.
    const species = key.split("|")[1] ?? key;
    const bonus = state.catalogedSpecies.includes(species) ? 0 : NEW_SPECIES_BONUS;
    if (bonus) state.catalogedSpecies.push(species);
    total += Math.round(n * specimenUnitPrice(state, key)) + bonus;
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
  const price = fuelPriceFor(state);
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
  const price = fuelPriceFor(state) * FUEL_CREDIT_MARKUP;
  const room = effectiveStats(state).fuelCapacity - state.ship.fuel;
  const withinLimit = Math.floor((fuelCreditLimit(state) - state.loan.balance) / price);
  // Lifeline: whatever the limit, the Exchange tops the tanks up to enough for a short trip.
  const lifeline = Math.max(0, Math.floor(LIFELINE_FUEL - state.ship.fuel));
  return Math.max(0, Math.min(Math.floor(room), Math.max(withinLimit, lifeline)));
}

/** True when the note's credit limit is used up, so only the lifeline (if that) is on offer. */
export function fuelCreditPastLimit(state: GameState): boolean {
  const price = fuelPriceFor(state) * FUEL_CREDIT_MARKUP;
  return Math.floor((fuelCreditLimit(state) - state.loan.balance) / price) < 1;
}

/** The Exchange never leaves a captain grounded: it will always advance fuel up to this much in the tanks. */
export const LIFELINE_FUEL = 20;

/** Buy fuel on the Exchange's tab: no credits needed, but it's added to the loan with a markup. */
export function buyFuelOnCredit(state: GameState, units: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const n = Math.min(Math.floor(units), fuelCreditAvailable(state));
  if (n <= 0) return fail(state.loan.balance >= fuelCreditLimit(state) ? "The Exchange won't extend any more credit." : "Tanks are full.");
  const cost = Math.round(n * fuelPriceFor(state) * FUEL_CREDIT_MARKUP);
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
    cost: Math.round(((fuel * fuelPriceFor(state) * RESCUE_FUEL_MARKUP + RESCUE_FEE + RESCUE_FEE_PER_LY * ly) * (net ? 0.75 : 1)) / 10) * 10,
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
  const helmPays = helmCoversRescue(state);
  cheerAll(state, -8);
  if (!helmPays) chargeToNote(state, quote.cost);
  log(
    state,
    "warning",
    `An Exchange tender answered the distress call after ${quote.days} days and pumped ${quote.fuel} units of plicite aboard. ` +
      (helmPays ? "Helm's fund paid the bill." : `${quote.cost.toLocaleString()} cr added to your note.`),
  );
  return ok({ ...quote, cost: helmPays ? 0 : quote.cost });
}

// --- the yard: work that runs in parallel while docked -------------------------------------

/** Waits the one-click departure can sit out (a refit, the yard), as opposed to hard blockers. */
export function isWaitBlocker(b: string): boolean {
  return b.startsWith("Fold drive refit") || b.startsWith("Yard work in progress");
}

/** When the last yard job (installs, Lyceum courses) finishes; now if nothing is pending. */
export function yardReadyAt(state: GameState): number {
  return Math.max(state.time, ...(state.yard ?? []).map((j) => j.readyAt));
}

/** The ship can leave the Intrepid when the drive's refit and every yard job are done. */
export function departureReadyAt(state: GameState): number {
  const docked = state.location.kind === "intrepid";
  return Math.max(state.foldReadyAt, docked ? yardReadyAt(state) : state.time);
}

/** Finish yard jobs whose time has come. Called as time passes. */
export function tickYard(state: GameState): void {
  if (!state.yard || state.yard.length === 0) return;
  const done = state.yard.filter((j) => j.readyAt <= state.time);
  if (done.length === 0) return;
  state.yard = state.yard.filter((j) => j.readyAt > state.time);
  for (const job of done) {
    if (job.kind === "install" && job.upgradeId) {
      if (!state.ship.upgrades.includes(job.upgradeId)) state.ship.upgrades.push(job.upgradeId);
      log(state, "trade", `The yard finished installing the ${job.label}.`);
      if (job.upgradeId === "probeBay") {
        state.ship.probes = (state.ship.probes ?? 0) + 1;
        log(state, "trade", "The Lyceum included one probe with the bay, ready in the rack.");
      }
    } else if (job.kind === "retrain" && job.station) {
      finishRetraining(state, job.station);
    } else if (job.kind === "repair") {
      finishRepairs(state);
    }
  }
}

/** Yard crews at the Intrepid will scrub the drive around the clock, for a price per day saved. */
export const REFIT_RUSH_CR_PER_DAY = 300;

export function rushRefitCost(state: GameState, days: number): number {
  const left = Math.max(0, state.foldReadyAt - state.time) / DAY;
  return Math.round(Math.min(days, left) * REFIT_RUSH_CR_PER_DAY);
}

/** Pay the Intrepid's yard crews to cut the fold-drive refit short (docked only). */
export function rushRefit(state: GameState, days: number): Result<{ days: number; cost: number }> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const left = Math.max(0, state.foldReadyAt - state.time) / DAY;
  if (left <= 0) return fail("The drive is already refitted.");
  const saved = Math.min(days, left);
  const cost = rushRefitCost(state, saved);
  if (state.credits < cost) return fail(`Rush crews want ${cost.toLocaleString()} cr.`);
  state.credits -= cost;
  state.foldReadyAt -= saved * DAY;
  log(state, "trade", `Paid the yard ${cost.toLocaleString()} cr to rush the refit: ${formatDuration(saved * DAY)} sooner.`);
  return ok({ days: saved, cost });
}

/** Yard time to fit any upgrade. */
export const UPGRADE_INSTALL_DAYS = 2;

export function buyUpgrade(state: GameState, upgradeId: string): Result {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const upgrade = UPGRADES_BY_ID.get(upgradeId);
  if (!upgrade) return fail("Unknown upgrade.");
  if (state.ship.upgrades.includes(upgradeId)) return fail("Already installed.");
  // The top tier of each kind of gear waits on a research project (AW-15).
  const gate = researchFor(upgradeId);
  if (gate && !upgradeUnlocked(state, upgradeId)) return fail(`Needs research first: "${gate.name}" (${CLAN_NAMES[gate.clan]}).`);
  const queued = (id: string) => state.ship.upgrades.includes(id) || (state.yard ?? []).some((j) => j.upgradeId === id);
  if (upgrade.requires && !queued(upgrade.requires)) {
    return fail(`Requires ${UPGRADES_BY_ID.get(upgrade.requires)?.name ?? upgrade.requires} first.`);
  }
  const price = upgradePriceFor(state, upgrade.vendor, upgrade.price);
  if (state.credits < price) return fail(`Costs ${price.toLocaleString()} cr.`);
  if ((state.yard ?? []).some((j) => j.upgradeId === upgradeId)) return fail("Already being installed.");
  state.credits -= price;
  // One yard bay: installs queue behind each other, but run alongside Lyceum courses and the refit.
  const installs = (state.yard ?? []).filter((j) => j.kind === "install");
  const start = Math.max(state.time, ...installs.map((j) => j.readyAt));
  state.yard = [...(state.yard ?? []), { kind: "install", label: upgrade.name, upgradeId, readyAt: start + UPGRADE_INSTALL_DAYS * DAY }];
  bondClan(state, upgrade.vendor, 2);
  log(state, "trade", `Ordered ${upgrade.name}. The yard will have it fitted in ${formatDuration(start + UPGRADE_INSTALL_DAYS * DAY - state.time)}.`);
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

/** Plicite fuel price for this captain (their clan may get it cheaper). */
export function fuelPriceFor(state: GameState): number {
  return Math.round(fuelPrice(state.market) * clanMods(state).fuelPrice);
}
