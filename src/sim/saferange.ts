/**
 * Safe range (AW-237): an option, on unless the captain turns it off, that won't let the rover or the
 * boat drive somewhere it can't get home from, and keeps drilling, prospecting and sampling from
 * spending the energy the trip home needs. "Home" is where the vehicle returns to (vehicleHome): the
 * ship, the water beside it for the boat, or the moored boat for a rover put ashore.
 */
import { canEnter, findPath, type Mobility } from "./pathfinding";
import { neighbors } from "./hex";
import { routeEnergy, spareCellEnergy, vehicleMobility } from "./actions";
import { vehicleHome } from "./boat";
import { fail, ok, type Result } from "./result";
import { vehicleOf } from "./vehicles";
import type { GameState, RoverState } from "./state";
import type { Vec2 } from "./units";
import type { World } from "./world";

export function safeRangeOn(state: GameState): boolean {
  return state.safeRange !== false;
}

export function setSafeRange(state: GameState, on: boolean): Result<boolean> {
  state.safeRange = on;
  return ok(on);
}

function surfaceOf(state: GameState, world: World) {
  const loc = state.location;
  return loc.kind === "surface" ? world.surface(loc.bodyId) : null;
}

/**
 * Energy to get from `from` home, or null if there's no route. If home can't be entered (a moored
 * boat out on the water), the cheapest hex beside it will do, as the surface screen plans it.
 */
export function energyHomeFrom(state: GameState, world: World, from: Vec2, mobility: Mobility = vehicleMobility(state, world)): number | null {
  const surface = surfaceOf(state, world);
  if (!surface) return null;
  const home = vehicleHome(state, world);
  if (from.x === home.x && from.y === home.y) return 0;
  const direct = findPath(surface, from, home, mobility);
  if (direct) return routeEnergy(state, direct);
  let best: number | null = null;
  for (const n of neighbors(home.x, home.y)) {
    if (n.x === from.x && n.y === from.y) return 0;
    if (!canEnter(surface, n.x, n.y, mobility)) continue;
    const path = findPath(surface, from, n, mobility);
    if (!path) continue;
    const e = routeEnergy(state, path);
    if (best === null || e < best) best = e;
  }
  return best;
}

/** The energy the vehicle can draw on: its cells, plus the Long Shifts spare pack if it's still carried. */
function energyInHand(state: GameState, v: RoverState): number {
  return v.energy + spareCellEnergy(state, v);
}

/**
 * Why Safe range won't let the vehicle drive to (x, y), or null if it may. A vehicle that's already
 * short of the trip home may still head toward home: any move that doesn't add to what it needs.
 */
export function strandingBlocker(state: GameState, world: World, x: number, y: number): string | null {
  if (!safeRangeOn(state)) return null;
  const loc = state.location;
  const surface = surfaceOf(state, world);
  if (loc.kind !== "surface" || !loc.rover || !surface) return null;
  const v = loc.rover;
  const noun = vehicleOf(v) === "boat" ? "boat" : "rover";
  const home = vehicleHome(state, world);
  const where = vehicleOf(v) !== "boat" && loc.parkedBoat ? "the boat" : "the ship";
  const path = findPath(surface, v, { x, y }, vehicleMobility(state, world));
  if (!path) return null; // no route at all: the drive itself says so
  const go = routeEnergy(state, path);
  const back = energyHomeFrom(state, world, { x, y });
  if (back === null) return `Safe range: there's no way back to ${where} from there.`;
  if (x === home.x && y === home.y) return null;
  const have = energyInHand(state, v);
  if (go + back <= have + 1e-6) return null;
  // Already past the point of no return: let it limp homeward, never further out.
  const now = energyHomeFrom(state, world, v);
  if (now !== null && now > have && go + back <= now + 1e-6) return null;
  return `Safe range: the ${noun} couldn't get back to ${where} from there (${go.toFixed(1)} energy there and ${back.toFixed(1)} back; it has ${have.toFixed(1)}).`;
}

/** Energy the vehicle must keep for the trip home from where it stands (0 with Safe range off). */
export function homeReserve(state: GameState, world: World): number {
  if (!safeRangeOn(state)) return 0;
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return 0;
  return energyHomeFrom(state, world, loc.rover) ?? 0;
}

/** Why Safe range won't spend `energy` on a job where the vehicle stands, or null. */
export function jobBlocker(state: GameState, world: World, energy: number, job: string): string | null {
  if (!safeRangeOn(state)) return null;
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return null;
  const reserve = homeReserve(state, world);
  const have = energyInHand(state, loc.rover);
  if (have - energy >= reserve - 1e-6) return null;
  const where = vehicleOf(loc.rover) !== "boat" && loc.parkedBoat ? "the boat" : "the ship";
  return `Safe range: ${job} would leave too little to get back to ${where} (the trip takes ${reserve.toFixed(1)}).`;
}

/** Guard a job: fail with the reason, or carry on. */
export function guardJob(state: GameState, world: World, energy: number, job: string): Result<void> {
  const why = jobBlocker(state, world, energy, job);
  return why ? fail(why) : ok(undefined);
}
