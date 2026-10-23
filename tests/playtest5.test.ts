/** Fixes from the 2026-10-23 playtest. */
import { describe, expect, it } from "vitest";
import {
  detectsFlora,
  effectiveStats,
  fold,
  flyTo,
  landingAccess,
  newGame,
  regionLifeSignal,
  sensorSweep,
  World,
} from "../src/sim";
import { BASE_STATS } from "../src/data/ship";

describe("a stowed rover charges as time passes", () => {
  it("charges from the ship's reactor during an in-system flight", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    state.ship.roverEnergy = 10;
    const body = world.system("s0").bodies.find((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)!;
    expect(flyTo(state, world, { bodyId: body.id }).ok).toBe(true);
    expect(state.ship.roverEnergy).toBeGreaterThan(10);
    expect(state.ship.roverEnergy).toBeLessThanOrEqual(effectiveStats(state).roverEnergy);
  });
});

describe("the drive preview and the sensors agree", () => {
  it("hidden plant sites are only detectable with an Ecologist aboard", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const body = world.system("s0").bodies.find((b) => b.life)!;
    const site = world.surface(body.id).flora(0).find((f) => f.hidden);
    if (!site) return;
    const sweep = sensorSweep(state, body.id);
    expect(detectsFlora(sweep, site, site)).toBe(false);
    expect(detectsFlora({ ...sweep, hiddenFlora: true }, site, site)).toBe(true);
  });
});

describe("life signs from orbit", () => {
  it("count the ordinary plant sites in a region", () => {
    const world = new World(42);
    const body = world.system("s0").bodies.find((b) => b.life)!;
    for (let r = 0; r < 3; r++) {
      expect(regionLifeSignal(42, body, r)).toBe(world.region(body.id, r).flora.filter((f) => !f.hidden).length);
    }
  });
});
