/** Playtest 11: the rover crew sweeps the landing region on their own. */
import { describe, expect, it } from "vitest";
import {
  autoExplore,
  autoExploreBlockers,
  deployRover,
  exploredFraction,
  flyTo,
  knowledge,
  land,
  landingBlockers,
  newGame,
  shipTile,
  World,
  type GameState,
} from "../src/sim";

const SEED = 42;
const world = new World(SEED);
const hex = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const ax = a.x - (a.y - (a.y & 1)) / 2, az = a.y, bx = b.x - (b.y - (b.y & 1)) / 2, bz = b.y;
  return (Math.abs(ax - bx) + Math.abs(az - bz) + Math.abs(ax + az - bx - bz)) / 2;
};

function landed(): GameState {
  for (const sys of world.galaxy.systems.filter((s) => !s.home)) {
    const detail = world.system(sys.id);
    for (const body of detail.bodies.filter((b) => b.regions > 0 && (b.kind === "barren" || b.kind === "desert" || b.kind === "terrestrial"))) {
      const s = newGame({ seed: SEED });
      s.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
      s.ship.fuel = 60;
      if (!flyTo(s, world, { bodyId: body.id }).ok) continue;
      const region = Array.from({ length: Math.min(body.regions, 20) }, (_, r) => r).find((r) => landingBlockers(s, world, r).length === 0);
      if (region === undefined || !land(s, world, region).ok || !deployRover(s, world).ok) continue;
      return s;
    }
  }
  throw new Error("nowhere to land");
}

describe("rover auto-explore", () => {
  it("needs the rover out", () => {
    const s = landed();
    expect(autoExploreBlockers(s, world)).toEqual([]);
    if (s.location.kind === "surface") s.location.rover = null;
    expect(autoExploreBlockers(s, world).join(" ")).toMatch(/Deploy the rover/);
  });

  it("sweeps most of the region, recharging as needed, and ends beside the ship", () => {
    const s = landed();
    const loc = s.location as Extract<GameState["location"], { kind: "surface" }>;
    const before = exploredFraction(knowledge(s, loc.bodyId, loc.region));
    const t0 = s.time;
    const r = autoExplore(s, world);
    if (!r.ok) throw new Error(r.reason);
    expect(r.value.after).toBeGreaterThan(before + 0.3);
    expect(r.value.legs).toBeGreaterThan(5);
    expect(s.time).toBeGreaterThan(t0);
    expect(hex(loc.rover!, shipTile(s, world))).toBeLessThanOrEqual(1);
    expect(loc.rover!.energy).toBeGreaterThanOrEqual(0);
    // Drives only: nothing in the cargo bed or sample cases.
    expect(Object.keys(loc.rover!.cargo ?? {}).length).toBe(0);
  });

  it("is deterministic", () => {
    const a = landed();
    const b = structuredClone(a);
    autoExplore(a, world);
    autoExplore(b, world);
    expect(a.time).toBe(b.time);
  });
});
