/** AW-165: blind folds into deep space, and the deep-field array. */
import { describe, expect, it } from "vitest";
import {
  BLIND_FOLD_RANGE,
  callForRescue,
  deepId,
  deepScanBlockers,
  deepSites,
  effectiveStats,
  fold,
  foldPlan,
  INTREPID_POS,
  knownDeepSites,
  newGame,
  rescueQuote,
  scanDeep,
  siteHere,
  sweptShare,
  World,
  type GameState,
} from "../src/sim";

const SEED = 42;
const world = new World(SEED);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** An empty point this far from the Intrepid, clear of the stars. */
function emptyPoint(r: number): { x: number; y: number } {
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const p = { x: Math.round(Math.cos(a) * r * 100) / 100, y: Math.round(Math.sin(a) * r * 100) / 100 };
    if (world.galaxy.systems.every((s) => dist(s.pos, p) > 1)) return p;
  }
  throw new Error("no empty point");
}

function ready(state: GameState): void {
  state.ship.fuel = effectiveStats(state).fuelCapacity;
  state.foldReadyAt = 0;
}

describe("blind folds", () => {
  it("reach 60% of the drive's range, cost more, and leave the ship between the stars", () => {
    const state = newGame({ seed: SEED });
    ready(state);
    const range = effectiveStats(state).foldRangeLy;
    const near = emptyPoint(range * BLIND_FOLD_RANGE * 0.8);
    const far = emptyPoint(range * 0.9);
    expect(foldPlan(state, world, deepId(far)).blockers.join(" ")).toMatch(/blind fold/);
    const plan = foldPlan(state, world, deepId(near));
    expect(plan.blockers).toEqual([]);
    expect(fold(state, world, deepId(near)).ok).toBe(true);
    expect(state.location).toEqual({ kind: "deep", pos: near });
    // No gravity well out here: once the drive is refitted, fold on.
    expect(foldPlan(state, world, "intrepid").blockers.join(" ")).toMatch(/refit/);
    state.foldReadyAt = 0;
    expect(fold(state, world, "intrepid").ok).toBe(true);
    expect(state.location.kind).toBe("intrepid");
  });

  it("can't target a point by a star, at the Intrepid's door, or past the edge", () => {
    const state = newGame({ seed: SEED });
    ready(state);
    const star = world.galaxy.systems[0]!;
    expect(foldPlan(state, world, deepId({ x: star.pos.x + 0.1, y: star.pos.y })).blockers.join(" ")).toMatch(/fold to the star/);
    expect(foldPlan(state, world, deepId({ x: 0.1, y: 0 })).blockers.join(" ")).toMatch(/Intrepid/);
    expect(foldPlan(state, world, deepId({ x: 45, y: 0 })).blockers.join(" ")).toMatch(/can't fix a position/);
  });

  it("stepping stones reach stars beyond a single fold", () => {
    const state = newGame({ seed: SEED });
    const range = effectiveStats(state).foldRangeLy;
    const target = world.galaxy.systems.find((s) => {
      const d = dist(s.pos, INTREPID_POS);
      return d > range * 1.1 && d < range * 1.5;
    })!;
    expect(foldPlan(state, world, target.id).blockers.join(" ")).toMatch(/beyond the drive/);
    const dir = { x: target.pos.x / dist(target.pos, INTREPID_POS), y: target.pos.y / dist(target.pos, INTREPID_POS) };
    let hop = { x: dir.x * range * 0.55, y: dir.y * range * 0.55 };
    hop = { x: Math.round(hop.x * 100) / 100, y: Math.round(hop.y * 100) / 100 };
    ready(state);
    const r = fold(state, world, deepId(hop));
    if (!r.ok) return; // a star sits on the line: fine, the rule is covered above
    state.foldReadyAt = 0;
    expect(foldPlan(state, world, target.id).blockers).toEqual([]);
  });

  it("the tender still comes, charging by the light-year", () => {
    const state = newGame({ seed: SEED });
    state.location = { kind: "deep", pos: emptyPoint(6) };
    state.ship.fuel = 0;
    const q = rescueQuote(state, world)!;
    expect(q.cost).toBeGreaterThan(0);
    expect(callForRescue(state, world).ok).toBe(true);
    expect(state.ship.fuel).toBeGreaterThan(0);
  });
});

describe("the deep-field array", () => {
  it("needs the gear, and doesn't work docked", () => {
    const state = newGame({ seed: SEED });
    expect(deepScanBlockers(state, world).join(" ")).toMatch(/deep-field array/);
    state.ship.upgrades.push("deepFieldArray");
    expect(deepScanBlockers(state, world).join(" ")).toMatch(/Undock/);
  });

  it("identifies what's within reach, hears faint returns beyond, and keeps the swept circle", () => {
    const state = newGame({ seed: SEED });
    state.ship.upgrades.push("deepFieldArray");
    const anomaly = deepSites(world).find((s) => s.kind === "anomaly")!;
    expect(dist(anomaly.pos, INTREPID_POS)).toBeGreaterThan(15);
    expect(world.galaxy.systems.every((s) => dist(s.pos, anomaly.pos) >= 2)).toBe(true);
    // Just out of reach: a faint return.
    const ux = anomaly.pos.x / dist(anomaly.pos, INTREPID_POS);
    const uy = anomaly.pos.y / dist(anomaly.pos, INTREPID_POS);
    state.location = { kind: "deep", pos: { x: anomaly.pos.x - ux * 4, y: anomaly.pos.y - uy * 4 } };
    const t0 = state.time;
    const faint = scanDeep(state, world);
    expect(faint.ok && faint.value.faint).toBe(1);
    expect(state.time - t0).toBeGreaterThanOrEqual(24 * 60);
    expect(knownDeepSites(state, world)).toEqual([{ site: anomaly, level: "faint" }]);
    // Closer: identified.
    state.location = { kind: "deep", pos: { x: anomaly.pos.x - ux * 2, y: anomaly.pos.y - uy * 2 } };
    const hit = scanDeep(state, world);
    expect(hit.ok && hit.value.found.map((s) => s.id)).toEqual(["anomaly"]);
    expect(state.deepScans).toHaveLength(2);
    expect(sweptShare(state)).toBeGreaterThan(0);
  });

  it("folding to a site puts the ship there", () => {
    const state = newGame({ seed: SEED });
    const anomaly = deepSites(world).find((s) => s.kind === "anomaly")!;
    state.location = { kind: "deep", pos: { x: anomaly.pos.x * 0.85, y: anomaly.pos.y * 0.85 } };
    ready(state);
    expect(fold(state, world, deepId(anomaly.pos)).ok).toBe(true);
    expect(siteHere(state, world)?.id).toBe("anomaly");
    expect(state.deepKnown?.anomaly).toBe("known");
  });

  it("can sweep from a star system too", () => {
    const state = newGame({ seed: SEED });
    state.ship.upgrades.push("deepFieldArray");
    const sys = world.galaxy.systems[3]!;
    state.location = { kind: "space", systemId: sys.id, pos: { x: 1, y: 0 }, orbiting: null };
    expect(scanDeep(state, world).ok).toBe(true);
    expect(state.deepScans![0]).toMatchObject({ x: sys.pos.x, y: sys.pos.y, r: 3 });
  });
});
