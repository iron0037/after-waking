import { describe, expect, it } from "vitest";
import { deployRover, fold, flyTo, land, migrateSurfaceCoords, moveRoverTo, shipTile } from "../src/sim/actions";
import { knowledge } from "../src/sim/actions";
import { landingAccess } from "../src/sim/environment";
import { hexDistance } from "../src/sim/hex";
import { canEnter, findPath } from "../src/sim/pathfinding";
import { BASE_STATS } from "../src/data/ship";
import { newGame, type GameState } from "../src/sim/state";
import { REGION_SIZE } from "../src/sim/surface";
import { World } from "../src/sim/world";

/** Land on the first easy world in s0 that has a region with a right-hand neighbour. */
function landNearBorder(seed: number): { state: GameState; world: World; bodyId: string; region: number } {
  const world = new World(seed);
  const state = newGame({ seed });
  expect(fold(state, world, "s0").ok).toBe(true);
  for (const body of world.system("s0").bodies.filter((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)) {
    const surface = world.surface(body.id);
    if (surface.layout.cols < 2) continue;
    if (!flyTo(state, world, { bodyId: body.id }).ok) continue;
    expect(land(state, world, 0).ok).toBe(true);
    return { state, world, bodyId: body.id, region: 0 };
  }
  throw new Error("no multi-region easy world");
}

describe("seamless planet surface (AW-78)", () => {
  it("stitches regions into one grid with continuous terrain", () => {
    const world = new World(42);
    const body = world.system("s0").bodies.find((b) => b.regions >= 4)!;
    const surface = world.surface(body.id);
    expect(surface.layout.regions).toBe(body.regions);
    // Every region's tiles map back to that region.
    for (let r = 0; r < body.regions; r++) {
      const o = surface.origin(r);
      expect(surface.regionAt(o.x, o.y)).toBe(r);
      expect(surface.regionAt(o.x + REGION_SIZE - 1, o.y + REGION_SIZE - 1)).toBe(r);
    }
    // Elevation is sampled from one planet-wide field, so neighbours across a border are close.
    const o1 = surface.origin(1);
    let jump = 0;
    for (let y = o1.y; y < o1.y + REGION_SIZE; y++) {
      jump = Math.max(jump, Math.abs((surface.elevationAt(o1.x - 1, y) ?? 0) - (surface.elevationAt(o1.x, y) ?? 0)));
    }
    expect(jump).toBeLessThan(0.2);
  });

  it("drives the rover across a region border, visiting and revealing the new region", () => {
    const { state, world, bodyId } = landNearBorder(42);
    const surface = world.surface(bodyId);
    expect(deployRover(state, world).ok).toBe(true);
    const ship = shipTile(state, world);
    // Find the nearest reachable tile just inside region 1.
    const o1 = surface.origin(1);
    let target: { x: number; y: number } | null = null;
    for (let d = 0; d < REGION_SIZE && !target; d++) {
      for (const y of [ship.y - d, ship.y + d]) {
        const p = { x: o1.x + 2, y };
        if (surface.regionAt(p.x, p.y) === 1 && canEnter(surface, p.x, p.y, false) && findPath(surface, ship, p, false)) {
          target = p;
          break;
        }
      }
    }
    expect(target).not.toBeNull();
    // Plenty of energy for the trip in this test.
    const loc = state.location;
    if (loc.kind !== "surface" || !loc.rover) throw new Error("no rover");
    loc.rover.energy = 10_000;
    const moved = moveRoverTo(state, world, target!.x, target!.y);
    expect(moved.ok && moved.value.stopped).toBe(null);
    expect(loc.rover.x).toBe(target!.x);
    expect(knowledge(state, bodyId, 1).visits).toBe(1);
    expect(knowledge(state, bodyId, 1).explored.length).toBeGreaterThan(0);
    expect(hexDistance(loc.rover, ship)).toBeGreaterThan(1);
  });

  it("converts saves from region-local coordinates", () => {
    const { state, world, bodyId } = landNearBorder(7);
    const loc = state.location;
    if (loc.kind !== "surface") throw new Error("not landed");
    const global = { ...loc.ship! };
    // Pretend this save predates seamless terrain: local coords, landing in region 1.
    const surface = world.surface(bodyId);
    const o = surface.origin(1);
    loc.region = 1;
    loc.ship = { x: 5, y: 6 };
    loc.rover = { x: 7, y: 8, energy: 50, cargo: {} };
    delete loc.globalCoords;
    migrateSurfaceCoords(state, world);
    expect(loc.ship).toEqual({ x: o.x + 5, y: o.y + 6 });
    expect({ x: loc.rover.x, y: loc.rover.y }).toEqual({ x: o.x + 7, y: o.y + 8 });
    migrateSurfaceCoords(state, world); // idempotent
    expect(loc.ship).toEqual({ x: o.x + 5, y: o.y + 6 });
    void global;
  });
});
