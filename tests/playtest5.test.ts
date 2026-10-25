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
  SEA_ID_BASE,
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
      // Sea life (AW-17) stays hidden under the waves from orbit.
      expect(regionLifeSignal(42, body, r)).toBe(world.region(body.id, r).flora.filter((f) => !f.hidden && f.id < SEA_ID_BASE).length);
    }
  });
});

describe("playtest 6", () => {
  it("Helm's standing surveys stay within one fold of the Intrepid", async () => {
    const { standingSurvey, distanceLy, Rng } = await import("../src/sim");
    const world = new World(42);
    const state = newGame({ seed: 42 });
    for (let i = 0; i < 20; i++) {
      const c = standingSurvey(state, new Rng(i + 1), 100 + i);
      if (!c) continue;
      const systemId = c.surveyBodyIds![0]!.split(".")[0]!;
      expect(distanceLy(world.galaxy, "intrepid", systemId)).toBeLessThanOrEqual(effectiveStats(state).foldRangeLy);
    }
  });

  it("estimates what a scanned world is worth from orbit", async () => {
    const { bodyValueEstimate } = await import("../src/sim");
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const body = world.system("s0").bodies.find((b) => b.regions > 0 && state.scannedBodies.includes(b.id) && Object.keys(b.resources).length > 0)!;
    const v = bodyValueEstimate(state, body)!;
    expect(v.best).toBeGreaterThan(0);
    expect(v.best).toBeGreaterThanOrEqual(v.average);
    const unscanned = { ...state, scannedBodies: [] };
    expect(bodyValueEstimate(unscanned, body)).toBeNull();
  });
});
