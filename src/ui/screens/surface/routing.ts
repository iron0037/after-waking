/** Route planning helpers for the surface screen (thin wrappers over the sim's pathfinder, planet-wide coordinates). */
import { findPath, neighbors, type Mobility, type PathStep, type TileSource, type Vec2 } from "../../../sim";

/** How this rover gets around, with the crew's perks: terrain it can cross (roverMobility) and the route energy and time multipliers (routeEnergyMult, routeMinutesMult). */
export interface Mover {
  mobility: Mobility;
  energyMult: number;
  /** Drive-time multiplier (uprated drive motors). */
  minutesMult: number;
}

/** findPath with the crew's perks and gear: step energy and minutes are already scaled, so every sum and budget downstream agrees with the sim (moveRoverTo). */
function pathFor(tiles: TileSource, from: Vec2, to: Vec2, mover: Mover): PathStep[] | null {
  const path = findPath(tiles, from, to, mover.mobility);
  return path && (mover.energyMult !== 1 || mover.minutesMult !== 1)
    ? path.map((s) => ({ ...s, energy: s.energy * mover.energyMult, minutes: s.minutes * mover.minutesMult }))
    : path;
}

/** The cheapest route to `to`; if it can't be entered (and `approach`), to the cheapest hex next to it. */
export function planPath(tiles: TileSource, from: Vec2, to: Vec2, mover: Mover, approach: boolean): PathStep[] | null {
  const direct = pathFor(tiles, from, to, mover);
  if (direct || !approach) return direct;
  let best: PathStep[] | null = null;
  let bestMinutes = Infinity;
  for (const n of neighbors(to.x, to.y)) {
    const path = pathFor(tiles, from, n, mover);
    if (!path) continue;
    const minutes = path.reduce((s, p) => s + p.minutes, 0);
    if (minutes < bestMinutes) {
      best = path;
      bestMinutes = minutes;
    }
  }
  return best;
}

export interface RoutePlan {
  path: PathStep[];
  minutes: number;
  energy: number;
  /** Energy needed to get from the route's end back to the ship; null if no route home. */
  back: number | null;
}

export function evaluate(tiles: TileSource, path: PathStep[], start: Vec2, home: Vec2, mover: Mover): RoutePlan {
  const end = path.length > 0 ? (path[path.length - 1] as Vec2) : start;
  return {
    path,
    minutes: path.reduce((s, p) => s + p.minutes, 0),
    energy: path.reduce((s, p) => s + p.energy, 0),
    back: energyHome(tiles, end, home, mover),
  };
}

/** Energy to drive from `from` to the ship, or null if there is no route. */
export function energyHome(tiles: TileSource, from: Vec2, home: Vec2, mover: Mover): number | null {
  const path = pathFor(tiles, from, home, mover);
  return path ? path.reduce((s, p) => s + p.energy, 0) : null;
}

/** The longest prefix of `path` the given energy can pay for. */
export function affordablePrefix(path: PathStep[], energy: number): PathStep[] {
  let left = energy;
  const steps: PathStep[] = [];
  for (const step of path) {
    if (left < step.energy) break;
    left -= step.energy;
    steps.push(step);
  }
  return steps;
}
