/**
 * Auto-explore (playtest 11): the rover crew sweeps the landing region's fog on their own. They
 * drive to the nearest unswept ground they can reach and still get home from, come back to the ship
 * to recharge when the cells run low, and stop when the region is swept or nothing more is in
 * reach. They only drive: no drilling, no samples, no chasing "?" readings. People drive the rover,
 * as ever; the captain just stops giving turn-by-turn directions.
 */
import { hexDistance, neighbors } from "./hex";
import { canEnter, stepCost } from "./pathfinding";
import { fail, ok, type Result } from "./result";
import { exploredFraction, isExplored, REGION_SIZE } from "./surface";
import { knowledge, moveRoverTo, rechargeRover, routeEnergyMult, shipTile, vehicleMobility } from "./actions";
import { vehicleOf } from "./vehicles";
import { log, type GameState } from "./state";
import { DAY, type Vec2 } from "./units";
import type { World } from "./world";

/** Energy kept in hand on every leg, as a share of the cells, for the drive home. */
export const AUTO_EXPLORE_RESERVE = 0.08;
/** Give up after this long, whatever is left. */
export const AUTO_EXPLORE_MAX_DAYS = 20;

export interface AutoExploreReport {
  legs: number;
  recharges: number;
  /** Share of the region swept, before and after. */
  before: number;
  after: number;
  days: number;
  /** Why it stopped. */
  reason: string;
}

/** Why the crew can't auto-explore right now (empty if they can). */
export function autoExploreBlockers(state: GameState, world: World): string[] {
  const loc = state.location;
  if (loc.kind !== "surface") return ["Land first."];
  if (!loc.rover) return ["Deploy the rover first."];
  if (vehicleOf(loc.rover) !== "rover") return ["Auto-explore drives the rover, not the boat."];
  if (loc.parkedBoat || loc.roverAboard) return ["Bring the boat and the rover back together first."];
  const region = world.surface(loc.bodyId).regionAt(shipTile(state, world).x, shipTile(state, world).y) ?? loc.region;
  if (exploredFraction(knowledge(state, loc.bodyId, region)) >= 0.999) return ["This region is already swept."];
  return [];
}

/** Energy to reach every tile near the region from `from` (Dijkstra on the rover's step costs). */
function energyMap(state: GameState, world: World, bodyId: string, from: Vec2, box: { x0: number; y0: number; x1: number; y1: number }): Map<number, number> {
  const surface = world.surface(bodyId);
  const mobility = vehicleMobility(state);
  const mult = routeEnergyMult(state);
  const w = surface.width;
  const key = (x: number, y: number) => y * w + x;
  const best = new Map<number, number>([[key(from.x, from.y), 0]]);
  // A small binary heap of [cost, x, y].
  const heap: [number, number, number][] = [[0, from.x, from.y]];
  const push = (item: [number, number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = (): [number, number, number] => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length > 0) {
    const [c, x, y] = pop();
    if (c > (best.get(key(x, y)) ?? Infinity)) continue;
    for (const n of neighbors(x, y)) {
      if (n.x < box.x0 || n.y < box.y0 || n.x > box.x1 || n.y > box.y1) continue;
      if (!canEnter(surface, n.x, n.y, mobility)) continue;
      const nc = c + stepCost(surface, n.x, n.y, mobility).energy * mult;
      const k = key(n.x, n.y);
      if (nc < (best.get(k) ?? Infinity)) {
        best.set(k, nc);
        push([nc, n.x, n.y]);
      }
    }
  }
  return best;
}

/** Drive back beside the ship (the nearest open tile next to it, or onto it). */
function driveHome(state: GameState, world: World): boolean {
  const loc = state.location;
  if (loc.kind !== "surface" || !loc.rover) return false;
  const ship = shipTile(state, world);
  if (hexDistance(loc.rover, ship) <= 1) return true;
  const surface = world.surface(loc.bodyId);
  const mobility = vehicleMobility(state);
  const spots = [ship, ...neighbors(ship.x, ship.y)].filter((p) => canEnter(surface, p.x, p.y, mobility));
  for (const p of spots.sort((a, b) => hexDistance(a, loc.rover!) - hexDistance(b, loc.rover!))) {
    const r = moveRoverTo(state, world, p.x, p.y);
    if (r.ok && hexDistance(loc.rover, ship) <= 1) return true;
  }
  return false;
}

/**
 * Sweep the fog in the region where the ship stands. Runs until the region is swept, nothing more
 * is reachable on a full charge, or AUTO_EXPLORE_MAX_DAYS pass. The rover ends beside the ship.
 */
export function autoExplore(state: GameState, world: World): Result<AutoExploreReport> {
  const blockers = autoExploreBlockers(state, world);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const loc = state.location as Extract<GameState["location"], { kind: "surface" }>;
  const bodyId = loc.bodyId;
  const surface = world.surface(bodyId);
  const ship = shipTile(state, world);
  const region = surface.regionAt(ship.x, ship.y) ?? loc.region;
  const know = knowledge(state, bodyId, region);
  const o = surface.origin(region);
  const box = { x0: Math.max(0, o.x - 1), y0: Math.max(0, o.y - 1), x1: Math.min(surface.width - 1, o.x + REGION_SIZE), y1: Math.min(surface.height - 1, o.y + REGION_SIZE) };
  const inRegion = (x: number, y: number) => x >= o.x && y >= o.y && x < o.x + REGION_SIZE && y < o.y + REGION_SIZE && surface.regionAt(x, y) === region;
  const w = surface.width;
  const homeCost = energyMap(state, world, bodyId, ship, box);
  const before = exploredFraction(know);
  const start = state.time;
  let legs = 0;
  let recharges = 0;
  let reason = "";

  for (let guard = 0; guard < 2_000; guard++) {
    if (state.time - start > AUTO_EXPLORE_MAX_DAYS * DAY) {
      reason = `Called it a day after ${AUTO_EXPLORE_MAX_DAYS} days.`;
      break;
    }
    const rover = (state.location as typeof loc).rover;
    if (!rover) break;
    const reserve = AUTO_EXPLORE_RESERVE * Math.max(rover.energy, 1);
    const fromRover = energyMap(state, world, bodyId, rover, box);
    let target: Vec2 | null = null;
    let bestCost = Infinity;
    for (const [k, c] of fromRover) {
      const x = k % w;
      const y = (k - x) / w;
      if (!inRegion(x, y) || isExplored(know, x - o.x, y - o.y)) continue;
      const back = homeCost.get(k);
      if (back === undefined) continue;
      if (c + back * 1.1 + reserve > rover.energy) continue;
      if (c < bestCost) {
        bestCost = c;
        target = { x, y };
      }
    }
    if (target) {
      const r = moveRoverTo(state, world, target.x, target.y);
      legs++;
      if (!r.ok || r.value.stopped) {
        // Something stopped them: head home rather than push on.
        if (!driveHome(state, world)) {
          reason = "The crew couldn't find a way back to the ship.";
          break;
        }
      }
      continue;
    }
    // Nothing more in reach on this charge: home to recharge, unless that's where they already are, full.
    if (!driveHome(state, world)) {
      reason = "The crew couldn't find a way back to the ship.";
      break;
    }
    const recharged = rechargeRover(state, world);
    if (!recharged.ok) {
      reason = exploredFraction(know) >= 0.999 ? "The region is swept." : "Nothing more the rover can reach from here.";
      break;
    }
    recharges++;
  }
  driveHome(state, world);
  const after = exploredFraction(know);
  if (!reason) reason = after >= 0.999 ? "The region is swept." : "Nothing more the rover can reach from here.";
  const days = (state.time - start) / DAY;
  log(
    state,
    "travel",
    `The rover crew swept region ${region + 1} on their own: ${Math.round(before * 100)}% to ${Math.round(after * 100)}% in ${days.toFixed(1)} days, ${legs} legs, ${recharges} recharge${recharges === 1 ? "" : "s"}. ${reason}`,
  );
  return ok({ legs, recharges, before, after, days, reason });
}
