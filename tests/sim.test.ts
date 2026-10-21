import { describe, expect, it } from "vitest";
import {
  AU_LIGHT_MINUTES,
  deserialize,
  distanceLy,
  findPath,
  generateGalaxy,
  hashSeed,
  landingAccess,
  newGame,
  Rng,
  serialize,
  travelMinutes,
  World,
  DAY,
  YEAR,
  formatDate,
  formatDuration,
  advanceTime,
  GAME_START,
} from "../src/sim";
import { BASE_STATS } from "../src/data/ship";

const SEEDS = [1, 42, 1234, 9001, 31337];

describe("rng", () => {
  it("is deterministic", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("separates hash parts", () => {
    expect(hashSeed("ab", "c")).not.toBe(hashSeed("a", "bc"));
  });
});

describe("units and time", () => {
  it("crosses 1 AU in ~33 minutes at 0.25c", () => {
    expect(AU_LIGHT_MINUTES).toBeCloseTo(8.317, 2);
    expect(travelMinutes(1, 0.25)).toBeCloseTo(33.27, 1);
  });
  it("formats the After Waking calendar", () => {
    expect(formatDate(30 * YEAR)).toBe("AW 30 · Day 1 · 00:00");
    expect(formatDuration(3 * DAY + 4 * 60)).toBe("3d 4h");
  });
});

describe("galaxy", () => {
  it.each(SEEDS)("seed %i: every star is reachable from the Intrepid within starting fold range", (seed) => {
    const galaxy = generateGalaxy(seed);
    expect(galaxy.systems.length).toBeGreaterThanOrEqual(15);
    const reached = new Set<string>(["intrepid"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of galaxy.systems) {
        if (reached.has(s.id)) continue;
        for (const r of reached) {
          if (distanceLy(galaxy, r, s.id) <= BASE_STATS.foldRangeLy) {
            reached.add(s.id);
            grew = true;
            break;
          }
        }
      }
    }
    expect(reached.size).toBe(galaxy.systems.length + 1);
  });

  it("regenerates identically from the seed", () => {
    expect(JSON.stringify(generateGalaxy(42))).toBe(JSON.stringify(generateGalaxy(42)));
  });
});

describe("bodies", () => {
  it.each(SEEDS)("seed %i: physically sensible systems", (seed) => {
    const world = new World(seed);
    for (const sys of world.galaxy.systems) {
      const detail = world.system(sys.id);
      expect(detail.bodies.length).toBeGreaterThan(0);
      for (const b of detail.bodies) {
        expect(Number.isFinite(b.tempC)).toBe(true);
        expect(b.gravityG).toBeGreaterThan(0);
        if (b.kind === "gasGiant" || b.kind === "iceGiant") {
          expect(b.surface).toBe("none");
          expect(landingAccess(b, { ...BASE_STATS.ratings, maxGravityG: 99, maxPressureAtm: 1e9 }).ok).toBe(false);
        }
        if (b.parentId === null) expect(b.orbitAU).toBeLessThanOrEqual(detail.edgeAU);
      }
    }
  });

  it("offers at least a few landable worlds near home for a starting ship", () => {
    const world = new World(42);
    const landable = world.galaxy.systems
      .filter((s) => s.charted)
      .flatMap((s) => world.system(s.id).bodies)
      .filter((b) => landingAccess(b, BASE_STATS.ratings).ok && Object.keys(b.resources).length > 0);
    expect(landable.length).toBeGreaterThanOrEqual(5);
  });
});

describe("surface", () => {
  it("generates deterministic regions with reachable deposits", () => {
    const world = new World(42);
    const body = world.galaxy.systems
      .flatMap((s) => world.system(s.id).bodies)
      .find((b) => landingAccess(b, BASE_STATS.ratings).ok && b.regions > 4);
    expect(body).toBeDefined();
    const a = world.region(body!.id, 0);
    const b = new World(42).region(body!.id, 0);
    expect(Array.from(a.terrain)).toEqual(Array.from(b.terrain));
    expect(a.deposits).toEqual(b.deposits);
    const reachable = a.deposits.filter((d) => findPath(a, a.landing, d, true) !== null);
    expect(reachable.length).toBeGreaterThan(0);
  });
});

describe("save", () => {
  it("round-trips", () => {
    const state = newGame({ seed: 5 });
    advanceTime(state, 100 * DAY);
    const copy = deserialize(serialize(state));
    expect(copy).toEqual(state);
    expect(copy.time).toBeGreaterThan(GAME_START);
  });
});
