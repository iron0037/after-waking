/** AW-211: a seam up in the mountains needs all-terrain treads. */
import { describe, expect, it } from "vitest";
import {
  deployRover,
  drill,
  flyTo,
  knowledge,
  land,
  landingBlockers,
  mountainBlocker,
  newGame,
  workDeposit,
  World,
  type GameState,
} from "../src/sim";
import { neighbors } from "../src/sim/hex";
import { Terrain } from "../src/sim/surface";

const SEED = 42;
const world = new World(SEED);

/** Landed somewhere with a mountain seam in reach of the starter drill, the rover parked beside it. */
function besideMountainSeam(): { s: GameState; key: string; bodyId: string; d: { x: number; y: number } } {
  for (const sys of world.galaxy.systems.filter((x) => !x.home)) {
    const detail = world.system(sys.id);
    for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert"))) {
      const s = newGame({ seed: SEED });
      s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
      s.ship.fuel = 60;
      if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
      const surface = world.surface(body.id);
      for (let r = 0; r < Math.min(body.regions, 20); r++) {
        const d = surface.deposits(r).find((x) => surface.terrainAt(x.x, x.y) === Terrain.mountain && x.depthM <= 150);
        if (!d || landingBlockers(s, world, r).length > 0) continue;
        if (!land(s, world, r).ok || !deployRover(s, world).ok) break;
        const spot = neighbors(d.x, d.y).find((n) => surface.terrainAt(n.x, n.y) === Terrain.plain || surface.terrainAt(n.x, n.y) === Terrain.rough);
        const loc = s.location as GameState["location"];
        if (!spot || loc.kind !== "surface" || !loc.rover) break;
        loc.rover.x = spot.x;
        loc.rover.y = spot.y;
        const know = knowledge(s, body.id, d.region);
        know.discovered.push(d.id);
        know.prospected.push(d.id);
        return { s, key: d.key, bodyId: body.id, d };
      }
    }
  }
  throw new Error("no mountain seam found");
}

describe("mountain seams (AW-211)", () => {
  it("can't be drilled or worked without all-terrain treads", () => {
    const { s, key } = besideMountainSeam();
    const r = drill(s, world, key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/all-terrain treads/);
    const w = workDeposit(s, world, key);
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.reason).toMatch(/all-terrain treads/);
  });

  it("with treads, the mountains are no obstacle", () => {
    const { s, key, bodyId, d } = besideMountainSeam();
    expect(mountainBlocker(s, world, bodyId, d)).toMatch(/treads/);
    s.ship.upgrades.push("allTerrain");
    expect(mountainBlocker(s, world, bodyId, d)).toBeNull();
    expect(drill(s, world, key).ok).toBe(true);
  });
});
