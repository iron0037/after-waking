import { describe, expect, it } from "vitest";
import { deserialize, newGame, serialize, systemArchitecture, World, WORLD_GEN_LATEST } from "../src/sim";

describe("world generation 2 (AW-145)", () => {
  it("new games use the latest generator; old saves keep theirs", () => {
    const state = newGame({ seed: 9 });
    expect(state.worldGen).toBe(WORLD_GEN_LATEST);
    const old = JSON.parse(serialize(state));
    delete old.worldGen;
    expect(deserialize(JSON.stringify(old)).worldGen).toBe(1);
  });

  it("generation 1 is untouched (a save's universe never reshuffles)", () => {
    const a = new World(42, 1).system("s0").bodies.map((b) => `${b.id}:${b.kind}:${b.orbitAU.toFixed(4)}`);
    const b = new World(42, 1).system("s0").bodies.map((b) => `${b.id}:${b.kind}:${b.orbitAU.toFixed(4)}`);
    expect(a).toEqual(b);
    expect(new World(42, 1).system("s0").bodies.length).toBeGreaterThan(0);
  });

  it("the Meadow is a real planet near its star's habitable zone", () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const w = new World(seed, 2);
      const sys = w.system("s0");
      const meadow = sys.bodies.find((b) => b.nickname === "the Meadow")!;
      expect(meadow).toBeDefined();
      expect(meadow.kind).toBe("terrestrial");
      expect(meadow.parentId).toBeNull();
      expect(meadow.name).not.toMatch(/Belt/);
      const hz = Math.sqrt(sys.system.luminosity);
      expect(meadow.orbitAU / hz).toBeGreaterThan(0.2);
      expect(meadow.orbitAU / hz).toBeLessThan(3);
    }
  });

  it("numbers planets in order from the star", () => {
    const w = new World(7, 2);
    for (const s of w.galaxy.systems.slice(0, 20)) {
      const planets = w.system(s.id).bodies.filter((b) => b.parentId === null && b.kind !== "asteroid").sort((x, y) => x.orbitAU - y.orbitAU);
      const numerals = planets.map((p) => p.name.slice(s.name.length + 1));
      expect(numerals.slice(0, 3)).toEqual(["I", "II", "III"].slice(0, numerals.length));
    }
  });

  it("has many kinds of system, and red dwarfs are mostly compact", () => {
    const seen = new Set<string>();
    let mCompact = 0;
    let m = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = new World(seed, 2);
      for (const s of w.galaxy.systems) {
        const a = systemArchitecture(seed, s);
        seen.add(a);
        if (s.spectral === "M" && !s.home) {
          m++;
          if (a === "compact") mCompact++;
        }
      }
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
    expect(mCompact / m).toBeGreaterThan(0.45);
  });
});
