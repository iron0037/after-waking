/**
 * Every player verb. Each action validates against the current state, then mutates it and
 * advances time. Failures return a reason the UI can show verbatim; they never throw.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { UPGRADES_BY_ID } from "../data/ship";
import { bodyPosition, KIND_LABEL, type Body } from "./bodies";
import { fuelPrice, sellCommodity } from "./economy";
import { landingAccess } from "./environment";
import { distanceLy, positionOf, SPECTRAL } from "./galaxy";
import { findPath } from "./pathfinding";
import { addCargo, cargoTonnes, removeCargo, shipMassT, shipStats } from "./ship";
import { advanceTime, log, type GameState, type RoverState } from "./state";
import { emptyKnowledge, regionKey, type Deposit, type RegionKnowledge, type RegionMap } from "./surface";
import { formatDuration } from "./time";
import { DAY, HOUR, travelMinutes, type Vec2 } from "./units";
import type { World } from "./world";

export type Result<T = void> = { ok: true; value: T } | { ok: false; reason: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (reason: string): Result<never> => ({ ok: false, reason });

// --- tuning ------------------------------------------------------------------------------

export const FOLD_FUEL_PER_T_LY = 0.001;
export const FOLD_TRANSIT_MINUTES = 30;
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

export function foldPlan(state: GameState, world: World, targetId: string): FoldPlan {
  const from = currentSystemId(state);
  const stats = shipStats(state.ship);
  const ly = from === targetId ? 0 : distanceLy(world.galaxy, from, targetId);
  const fuel = Math.round(FOLD_FUEL_PER_T_LY * shipMassT(state.ship, stats) * ly * 10) / 10;
  const blockers: string[] = [];

  if (from === targetId) blockers.push("You're already here.");
  if (state.location.kind === "surface") blockers.push("Launch from the surface first.");
  if (state.location.kind === "space") {
    const edge = world.system(state.location.systemId).edgeAU;
    const pos = shipPosition(state, world) as Vec2;
    if (Math.hypot(pos.x, pos.y) < edge * 0.98) {
      blockers.push(`Folds can't start inside the gravity well. Fly out to the system edge (${edge.toFixed(1)} AU).`);
    }
  }
  if (state.time < state.foldReadyAt) {
    blockers.push(`Fold drive recharging: ready in ${formatDuration(state.foldReadyAt - state.time)}.`);
  }
  if (ly > stats.foldRangeLy) blockers.push(`${ly.toFixed(1)} ly is beyond the drive's ${stats.foldRangeLy} ly range.`);
  if (fuel > state.ship.fuel) blockers.push(`Needs ${fuel} fuel; tanks hold ${state.ship.fuel.toFixed(1)}.`);
  return { ly, fuel, rechargeMinutes: foldRechargeMinutes(ly), blockers };
}

export function fold(state: GameState, world: World, targetId: string): Result {
  const plan = foldPlan(state, world, targetId);
  if (plan.blockers.length > 0) return fail(plan.blockers[0] as string);

  const fromId = currentSystemId(state);
  state.ship.fuel = Math.max(0, state.ship.fuel - plan.fuel);
  state.stats.folds++;
  advanceTime(state, FOLD_TRANSIT_MINUTES);
  state.foldReadyAt = state.time + plan.rechargeMinutes;

  if (targetId === "intrepid") {
    state.location = { kind: "intrepid" };
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
  const stats = shipStats(state.ship);
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

  const minutes = travelMinutes(distanceAU, stats.cruiseSpeedC) + MANEUVER_MINUTES;
  const fuel = Math.round(IN_SYSTEM_FUEL_PER_AU_PER_KT * (shipMassT(state.ship, stats) / 1000) * distanceAU * 100) / 100;
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

export function scanBody(state: GameState, world: World): Result<Body> {
  const body = orbitingBody(state, world);
  if (!body) return fail("Enter orbit first.");
  if (state.scannedBodies.includes(body.id)) return ok(body);
  advanceTime(state, SCAN_MINUTES);
  state.scannedBodies.push(body.id);
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
  const ratings = shipStats(state.ship).ratings;
  return world
    .system(systemId)
    .bodies.filter((b) => b.regions > 0 && Object.keys(b.resources).length > 0 && landingAccess(b, ratings).ok);
}

export function landingBlockers(state: GameState, world: World, region: number): string[] {
  const body = orbitingBody(state, world);
  if (!body) return ["Enter orbit first."];
  const blockers: string[] = [];
  if (!state.scannedBodies.includes(body.id)) blockers.push("Scan the body before landing.");
  blockers.push(...landingAccess(body, shipStats(state.ship).ratings).reasons);
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
  return (state.regions[key] ??= emptyKnowledge());
}

export function land(state: GameState, world: World, region: number): Result {
  const blockers = landingBlockers(state, world, region);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const body = orbitingBody(state, world) as Body;
  const loc = state.location;
  if (loc.kind !== "space") return fail("Not in orbit.");
  state.ship.fuel -= surfaceBurnFuel(state, body);
  advanceTime(state, DESCENT_MINUTES);
  state.location = { kind: "surface", systemId: loc.systemId, bodyId: body.id, region, rover: null };
  knowledge(state, body.id, region).visits++;
  state.stats.landings++;
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

interface SurfaceCtx {
  map: RegionMap;
  know: RegionKnowledge;
  rover: RoverState;
}

function surfaceCtx(state: GameState, world: World): Result<SurfaceCtx> {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (!loc.rover) return fail("Deploy the rover first.");
  return ok({ map: world.region(loc.bodyId, loc.region), know: knowledge(state, loc.bodyId, loc.region), rover: loc.rover });
}

export function currentRegion(state: GameState, world: World): RegionMap | null {
  const loc = state.location;
  return loc.kind === "surface" ? world.region(loc.bodyId, loc.region) : null;
}

export function deployRover(state: GameState, world: World): Result {
  const loc = state.location;
  if (loc.kind !== "surface") return fail("Not on a surface.");
  if (loc.rover) return fail("The rover is already out.");
  const map = world.region(loc.bodyId, loc.region);
  loc.rover = { x: map.landing.x, y: map.landing.y, energy: shipStats(state.ship).roverEnergy, cargo: {} };
  advanceTime(state, 15);
  revealAround(state, world);
  return ok(undefined);
}

/** Drive toward (x, y). Stops early if energy runs short; reports how far it got. */
export function moveRoverTo(state: GameState, world: World, x: number, y: number): Result<{ steps: number; stopped: string | null }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { map, rover } = ctx.value;
  if (rover.x === x && rover.y === y) return ok({ steps: 0, stopped: null });
  const path = findPath(map, rover, { x, y }, shipStats(state.ship).roverCanClimb);
  if (!path) return fail("No route there for this rover.");
  let steps = 0;
  for (const step of path) {
    if (rover.energy < step.energy) {
      return ok({ steps, stopped: "Rover energy too low to continue." });
    }
    rover.energy -= step.energy;
    rover.x = step.x;
    rover.y = step.y;
    advanceTime(state, step.minutes);
    steps++;
    revealAround(state, world);
  }
  return ok({ steps, stopped: null });
}

function revealAround(state: GameState, world: World): void {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return;
  const { map, know, rover } = ctx.value;
  const radius = 2 + shipStats(state.ship).sensorTier;
  const found = map.deposits.filter(
    (d) => !know.discovered.includes(d.id) && Math.max(Math.abs(d.x - rover.x), Math.abs(d.y - rover.y)) <= radius,
  );
  for (const d of found) know.discovered.push(d.id);
  if (found.length > 0) {
    const names = found.map((d) => COMMODITIES[d.commodity].name.toLowerCase());
    log(state, "discovery", `Rover sensors picked up ${found.length === 1 ? "a deposit" : `${found.length} deposits`}: ${names.join(", ")}.`);
  }
}

function depositNearRover(ctx: SurfaceCtx, depositId: number): Result<Deposit> {
  const d = ctx.map.deposits.find((dep) => dep.id === depositId);
  if (!d || !ctx.know.discovered.includes(depositId)) return fail("Unknown deposit.");
  if (Math.max(Math.abs(d.x - ctx.rover.x), Math.abs(d.y - ctx.rover.y)) > 1) return fail("Drive the rover next to the deposit first.");
  return ok(d);
}

export function remainingTonnes(know: RegionKnowledge, d: Deposit): number {
  return Math.max(0, d.tonnes - (know.extracted[d.id] ?? 0));
}

export function prospect(state: GameState, world: World, depositId: number): Result<Deposit> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const found = depositNearRover(ctx.value, depositId);
  if (!found.ok) return found;
  const d = found.value;
  const { know, rover } = ctx.value;
  if (know.prospected.includes(d.id)) return ok(d);
  if (rover.energy < PROSPECT_ENERGY) return fail("Not enough rover energy to take core samples.");
  rover.energy -= PROSPECT_ENERGY;
  advanceTime(state, PROSPECT_MINUTES);
  know.prospected.push(d.id);
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
}

/** Set up (once) and extract until the rover is full, the deposit runs out, energy fails, or maxHours pass. */
export function drill(state: GameState, world: World, depositId: number, maxHours = Infinity): Result<DrillResult> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const found = depositNearRover(ctx.value, depositId);
  if (!found.ok) return found;
  const d = found.value;
  const { know, rover } = ctx.value;
  const stats = shipStats(state.ship);
  if (!know.prospected.includes(d.id)) return fail("Prospect the deposit before drilling.");
  if (d.depthM > stats.drillMaxDepthM) return fail(`The seam is ${d.depthM} m down; the drill reaches ${stats.drillMaxDepthM} m.`);
  const remaining = remainingTonnes(know, d);
  if (remaining <= 0) return fail("This deposit is worked out.");
  const room = stats.roverCargoT - cargoTonnes(rover.cargo);
  if (room <= 0.05) return fail("The rover's cargo bed is full.");

  if (!know.drillSites.includes(d.id)) {
    if (rover.energy < DRILL_SETUP_ENERGY) return fail("Not enough energy to set up the drill rig.");
    rover.energy -= DRILL_SETUP_ENERGY;
    advanceTime(state, DRILL_SETUP_MINUTES);
    know.drillSites.push(d.id);
  }

  const rate = stats.drillRateTph * (0.4 + d.grade);
  const hours = Math.min(remaining / rate, room / rate, maxHours, rover.energy / DRILL_ENERGY_PER_HOUR);
  if (hours <= 0.01) return fail("Not enough rover energy to run the drill.");
  const tonnes = Math.round(rate * hours * 10) / 10;
  addCargo(rover.cargo, d.commodity, tonnes, stats.roverCargoT);
  know.extracted[d.id] = (know.extracted[d.id] ?? 0) + tonnes;
  rover.energy -= hours * DRILL_ENERGY_PER_HOUR;
  state.stats.tonnesMined += tonnes;
  advanceTime(state, hours * HOUR);
  const result: DrillResult = {
    tonnes,
    hours,
    depleted: remainingTonnes(know, d) <= 0.05,
    roverFull: stats.roverCargoT - cargoTonnes(rover.cargo) <= 0.05,
  };
  log(state, "info", `Drilled ${tonnes} t of ${COMMODITIES[d.commodity].name.toLowerCase()} in ${formatDuration(hours * HOUR)}.`);
  return ok(result);
}

/** Drive-free: the rover must already be at (or next to) the ship. Unloads, recharges, stows. */
export function stowRover(state: GameState, world: World): Result<{ unloaded: number; jettisoned: number }> {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { map, rover } = ctx.value;
  if (Math.max(Math.abs(rover.x - map.landing.x), Math.abs(rover.y - map.landing.y)) > 1) {
    return fail("Drive the rover back to the ship first.");
  }
  const capacity = shipStats(state.ship).cargoCapacityT;
  let unloaded = 0;
  let jettisoned = 0;
  for (const [id, tonnes] of Object.entries(rover.cargo) as [CommodityId, number][]) {
    const added = addCargo(state.ship.cargo, id, tonnes, capacity);
    unloaded += added;
    jettisoned += tonnes - added;
  }
  advanceTime(state, ROVER_STOW_MINUTES);
  (state.location as { rover: RoverState | null }).rover = null;
  if (jettisoned > 0.05) log(state, "warning", `The hold is full. ${jettisoned.toFixed(1)} t of ore left on the ground.`);
  return ok({ unloaded, jettisoned });
}

/** Rescue a rover that can't make it home: the ship hops over and picks it up. */
export function recallRover(state: GameState, world: World): Result {
  const ctx = surfaceCtx(state, world);
  if (!ctx.ok) return ctx;
  const { map, rover } = ctx.value;
  if (state.ship.fuel < RECALL_FUEL) return fail("Not enough fuel to hop the ship over to the rover.");
  state.ship.fuel -= RECALL_FUEL;
  advanceTime(state, RECALL_MINUTES);
  rover.x = map.landing.x;
  rover.y = map.landing.y;
  log(state, "warning", "Hopped the ship over to the rover and winched it aboard. It cost fuel and three hours.");
  return ok(undefined);
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
  const credits = sellCommodity(state.market, id, amount);
  state.credits += credits;
  state.stats.earned += credits;
  log(state, "trade", `Sold ${amount.toFixed(1)} t of ${COMMODITIES[id].name.toLowerCase()} for ${credits.toLocaleString()} cr.`);
  return ok(credits);
}

export function sellAll(state: GameState): Result<number> {
  let total = 0;
  for (const id of Object.keys(state.ship.cargo) as CommodityId[]) {
    const r = sell(state, id);
    if (r.ok) total += r.value;
  }
  return total > 0 ? ok(total) : fail("The hold is empty.");
}

export function buyFuel(state: GameState, units: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const room = shipStats(state.ship).fuelCapacity - state.ship.fuel;
  const price = fuelPrice(state.market);
  const affordable = Math.floor(state.credits / price);
  const n = Math.min(Math.floor(units), Math.floor(room), affordable);
  if (n <= 0) return fail(room < 1 ? "Tanks are full." : "You can't afford any fuel.");
  state.ship.fuel += n;
  state.credits -= n * price;
  log(state, "trade", `Bought ${n} units of plicite fuel at ${price} cr.`);
  return ok(n);
}

export function buyUpgrade(state: GameState, upgradeId: string): Result {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const upgrade = UPGRADES_BY_ID.get(upgradeId);
  if (!upgrade) return fail("Unknown upgrade.");
  if (state.ship.upgrades.includes(upgradeId)) return fail("Already installed.");
  if (state.credits < upgrade.price) return fail(`Costs ${upgrade.price.toLocaleString()} cr.`);
  state.credits -= upgrade.price;
  state.ship.upgrades.push(upgradeId);
  advanceTime(state, 2 * DAY);
  log(state, "trade", `Installed ${upgrade.name}. Two days in the yard.`);
  return ok(undefined);
}

export function payLoan(state: GameState, amount: number): Result<number> {
  const docked = atIntrepid(state);
  if (!docked.ok) return docked;
  const pay = Math.min(Math.floor(amount), state.credits, state.loan.balance);
  if (pay <= 0) return fail(state.loan.balance <= 0 ? "Nothing owed." : "No credits to pay with.");
  state.credits -= pay;
  state.loan.balance -= pay;
  log(state, "trade", `Paid ${pay.toLocaleString()} cr toward the Exchange note. Balance: ${state.loan.balance.toLocaleString()} cr.`);
  return ok(pay);
}

/** Let time pass: waiting for the fold drive, for research, or for prices to recover. */
export function wait(state: GameState, minutes: number): Result {
  if (state.location.kind === "surface" && state.location.rover) return fail("Stow the rover before waiting.");
  advanceTime(state, Math.max(0, minutes));
  return ok(undefined);
}
