/** AW-189 phase 1: exotic seas (world generation 3). */
import { describe, expect, it } from "vitest";
import { SEAS } from "../src/data/seas";
import {
  aquaticSpecies,
  effectiveStats,
  exoticSea,
  landingAccess,
  launchBoatBlockers,
  newGame,
  World,
  WORLD_GEN_LATEST,
  type Body,
} from "../src/sim";
import { Terrain } from "../src/sim/surface";

const SEEDS = [42, 7, 11, 99, 3, 5, 8, 13];
const bodies = (world: World): Body[] => world.galaxy.systems.flatMap((s) => world.system(s.id).bodies);

describe("exotic seas", () => {
  it("new games use generation 3; generation 2 worlds are untouched", () => {
    expect(WORLD_GEN_LATEST).toBe(4);
    const g2 = new World(42, 2);
    const g3 = new World(42, 3);
    expect(bodies(g2).some((b) => b.sea)).toBe(false);
    // Same bodies, same orbits and the same land deposits: generation 3 only adds seas.
    const a = bodies(g2);
    const b = bodies(g3);
    expect(b.map((x) => [x.id, x.kind, x.orbitAU, x.tempC])).toEqual(a.map((x) => [x.id, x.kind, x.orbitAU, x.tempC]));
  });

  it("every kind of exotic sea turns up, where its liquid can exist", () => {
    const found = new Set<string>();
    for (const seed of SEEDS) {
      for (const b of bodies(new World(seed))) {
        if (!b.sea) continue;
        found.add(b.sea);
        expect(exoticSea(b)).toBe(b.sea);
        if (b.sea === "methane") expect(b.tempC).toBeLessThanOrEqual(-150);
        if (b.sea === "nitrogen") expect(b.tempC).toBeLessThanOrEqual(-196);
        if (b.sea === "ammonia") expect(b.tempC).toBeLessThanOrEqual(-35);
        if (b.sea === "acid") expect(b.chemistry).toBe("corrosive");
      }
    }
    expect([...found].sort()).toEqual(["acid", "ammonia", "methane", "nitrogen"]);
  });

  it("their lowlands are liquid, and the sea floor holds what the sea is made of", () => {
    for (const seed of SEEDS) {
      const world = new World(seed);
      for (const b of bodies(world).filter((x) => x.sea === "ammonia" || x.sea === "methane")) {
        const surface = world.surface(b.id);
        for (let r = 0; r < Math.min(b.regions, 30); r++) {
          const deps = surface.deposits(r).filter((d) => d.id >= 100);
          if (deps.length === 0) continue;
          const allowed = SEAS[b.sea!].dredge.map(([c]) => c);
          for (const d of deps) {
            expect(allowed).toContain(d.commodity);
            expect(surface.terrainAt(d.x, d.y)).toBe(Terrain.liquid);
          }
          return;
        }
      }
    }
    throw new Error("no exotic seabed found");
  });

  it("generation 4 gives some cold moons of giants thick air (Titan, Triton); nothing else changes", () => {
    let thick = 0;
    for (const seed of SEEDS) {
      const g3 = bodies(new World(seed, 3));
      const g4 = bodies(new World(seed, 4));
      expect(g4.map((b) => b.id)).toEqual(g3.map((b) => b.id));
      g4.forEach((b, i) => {
        const old = g3[i]!;
        if (b.pressureAtm === old.pressureAtm) {
          expect([b.tempC, b.kind, b.orbitAU]).toEqual([old.tempC, old.kind, old.orbitAU]);
          return;
        }
        thick++;
        expect(b.parentId).not.toBeNull();
        expect(b.pressureAtm).toBeGreaterThanOrEqual(0.8);
        expect(b.kind).toBe("ice");
      });
    }
    expect(thick).toBeGreaterThan(5);
  });

  it("nitrogen worlds need the cryogenic hull to land and cryo floats Mk II to sail", () => {
    for (const seed of SEEDS) {
      const world = new World(seed);
      const b = bodies(world).find((x) => x.sea === "nitrogen");
      if (!b) continue;
      const s = newGame({ seed });
      s.ship.upgrades.push("pressureHull2", "radShielding", "landingStruts");
      expect(landingAccess(b, effectiveStats(s).ratings).reasons.join(" ")).toMatch(/°C/);
      s.ship.upgrades.push("cryoHull");
      expect(landingAccess(b, effectiveStats(s).ratings).ok).toBe(true);
      s.ship.upgrades.push("boat", "cryoFloats");
      expect(effectiveStats(s).boatCryoDeep).toBe(false);
      s.ship.upgrades.push("cryoFloats2");
      expect(effectiveStats(s).boatCryoDeep).toBe(true);
      return;
    }
    throw new Error("no nitrogen world");
  });

  it("methane seas can hold life of their own", () => {
    let living = 0;
    for (const seed of SEEDS) {
      for (const b of bodies(new World(seed)).filter((x) => x.sea === "methane" && x.life)) {
        living++;
        for (const name of aquaticSpecies(seed, b)) expect(["azotosome drift", "tholin mat"]).toContain(name);
      }
    }
    expect(living).toBeGreaterThan(0);
  });

  it("the boat needs cryo floats for methane and a lined hull for acid", () => {
    for (const seed of SEEDS) {
      const world = new World(seed);
      for (const b of bodies(world).filter((x) => x.sea === "methane" || x.sea === "acid")) {
        const surface = world.surface(b.id);
        // A landing region with a shore the ship can stand on.
        for (let r = 0; r < Math.min(b.regions, 40); r++) {
          const s = newGame({ seed });
          s.ship.upgrades.push("boat");
          s.location = { kind: "surface", systemId: b.id.split(".")[0]!, bodyId: b.id, region: r, rover: null, globalCoords: true, ship: surface.landing(r) };
          const blockers = launchBoatBlockers(s, world);
          if (blockers.some((x) => /water's edge/.test(x))) continue;
          expect(blockers.join(" ")).toMatch(b.sea === "methane" ? /cryo floats/ : /acid-lined/);
          s.ship.upgrades.push(b.sea === "methane" ? "cryoFloats" : "acidLining");
          expect(effectiveStats(s)[b.sea === "methane" ? "boatCryo" : "boatAcidProof"]).toBe(true);
          expect(launchBoatBlockers(s, world)).toEqual([]);
          return;
        }
      }
    }
    throw new Error("no exotic shore found");
  });
});
