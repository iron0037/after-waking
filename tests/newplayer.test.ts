import { describe, expect, it } from "vitest";
import {
  acceptContract,
  collectSample,
  completeContract,
  contractProgress,
  deployRover,
  exploredFraction,
  findPath,
  flyTo,
  fold,
  knowledge,
  land,
  landingAccess,
  launch,
  moveRoverTo,
  newGame,
  recallRover,
  regionRecap,
  sellSpecimens,
  stowRover,
  surveyBody,
  wait,
  World,
  type GameState,
} from "../src/sim";
import { BASE_STATS } from "../src/data/ship";

const SEEDS = [1, 42, 1234, 9001, 31337, 7, 2026];

describe("home systems", () => {
  it.each(SEEDS)("seed %i: the three nearest stars are gentle and each has ≥2 calm landable worlds", (seed) => {
    const world = new World(seed);
    const home = world.galaxy.systems.filter((s) => s.home);
    expect(home.map((s) => s.id)).toEqual(["s0", "s1", "s2"]);
    for (const sys of home) {
      expect(["K", "G"]).toContain(sys.spectral);
      const easy = world.system(sys.id).bodies.filter((b) => b.easy);
      expect(easy.length).toBeGreaterThanOrEqual(2);
      for (const b of easy) {
        expect(landingAccess(b, BASE_STATS.ratings)).toEqual({ ok: true, reasons: [] });
        expect(b.weather + b.tectonics).toBeLessThanOrEqual(2);
        expect(Object.keys(b.resources).length).toBeGreaterThan(0);
      }
    }
  });

  it.each(SEEDS)("seed %i: the Meadow is a landable living world with flora to sample", (seed) => {
    const world = new World(seed);
    const meadow = world.system("s0").bodies.find((b) => b.nickname === "the Meadow");
    expect(meadow).toBeDefined();
    expect(meadow!.life).toBe(true);
    expect(landingAccess(meadow!, BASE_STATS.ratings).ok).toBe(true);
    const map = world.region(meadow!.id, 0);
    expect(map.flora.length).toBeGreaterThanOrEqual(2);
  });

  it("starts with charted bodies scanned, home worlds surveyed, and starter contracts posted", () => {
    const state = newGame({ seed: 42 });
    const world = new World(42);
    const charted = world.galaxy.systems.filter((s) => s.charted).flatMap((s) => world.system(s.id).bodies);
    expect(state.scannedBodies.length).toBe(charted.length);
    expect(state.surveyedBodies.length).toBeGreaterThanOrEqual(6);
    expect(state.contracts.map((c) => c.id).sort()).toEqual(["starter-iron", "starter-meadow", "starter-survey"]);
  });
});

/** Fly to a body in the current system, waiting out nothing; returns false on failure. */
function goTo(state: GameState, world: World, bodyId: string): void {
  const r = flyTo(state, world, { bodyId });
  if (!r.ok) throw new Error(r.reason);
}

describe("starter contracts", () => {
  it("can collect Meadow samples, deliver them, and sell the extras", () => {
    const seed = 42;
    const world = new World(seed);
    const state = newGame({ seed });
    expect(acceptContract(state, "starter-meadow").ok).toBe(true);
    const meadow = world.system("s0").bodies.find((b) => b.nickname === "the Meadow")!;

    expect(fold(state, world, "s0").ok).toBe(true);
    goTo(state, world, meadow.id);
    // Sample sites across a few regions until the cases hold enough.
    for (let region = 0; region < meadow.regions; region++) {
      const loc = state.location;
      if (loc.kind === "space" && region > 0 && Object.values(state.ship.specimens ?? {}).reduce((a, b) => a + b, 0) >= 5) break;
      expect(land(state, world, region).ok).toBe(true);
      expect(deployRover(state, world).ok).toBe(true);
      const map = world.region(meadow.id, region);
      for (const site of map.flora) {
        const path = findPath(map, map.landing, site, false);
        if (!path) continue;
        if (!moveRoverTo(state, world, site.x, site.y).ok) continue;
        collectSample(state, world, site.id);
        moveRoverTo(state, world, map.landing.x, map.landing.y);
      }
      const loc2 = state.location;
      if (loc2.kind === "surface" && loc2.rover) {
        const back = moveRoverTo(state, world, map.landing.x, map.landing.y);
        if (!back.ok || back.value.stopped) expect(recallRover(state, world).ok).toBe(true);
        expect(stowRover(state, world).ok).toBe(true);
      }
      expect(knowledge(state, meadow.id, region).explored.length).toBeGreaterThan(0);
      expect(exploredFraction(knowledge(state, meadow.id, region))).toBeGreaterThan(0);
      expect(regionRecap(state, world, meadow.id, region)?.visits).toBe(1);
      expect(launch(state, world).ok).toBe(true);
    }

    const c = state.contracts.find((x) => x.id === "starter-meadow")!;
    expect(contractProgress(state, c).ready).toBe(true);
    expect(flyTo(state, world, { edge: true }).ok).toBe(true);
    wait(state, Math.max(0, state.foldReadyAt - state.time));
    expect(fold(state, world, "intrepid").ok).toBe(true);
    const before = state.credits;
    expect(completeContract(state, "starter-meadow").ok).toBe(true);
    expect(state.credits).toBeGreaterThan(before);
    if (Object.keys(state.ship.specimens ?? {}).length > 0) expect(sellSpecimens(state).ok).toBe(true);
  });

  it("survey contract completes after surveying its targets", () => {
    const seed = 42;
    const world = new World(seed);
    const state = newGame({ seed });
    expect(acceptContract(state, "starter-survey").ok).toBe(true);
    const c = state.contracts.find((x) => x.id === "starter-survey")!;
    const sys = c.surveyBodyIds![0]!.split(".")[0]!;
    expect(fold(state, world, sys).ok).toBe(true);
    for (const id of c.surveyBodyIds!) {
      goTo(state, world, id);
      expect(surveyBody(state, world).ok).toBe(true);
    }
    expect(contractProgress(state, c).ready).toBe(true);
  });

  it("posts new delivery work over time and lapses overdue contracts", () => {
    const state = newGame({ seed: 5 });
    expect(acceptContract(state, "starter-iron").ok).toBe(true);
    wait(state, 200 * 24 * 60);
    expect(state.contracts.find((c) => c.id === "starter-iron")!.status).toBe("failed");
    expect(state.contracts.filter((c) => c.id.startsWith("deliver-")).length).toBeGreaterThan(0);
  });
});
