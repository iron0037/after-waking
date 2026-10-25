import { describe, expect, it } from "vitest";
import { RESEARCH, RESEARCH_FOR_UPGRADE } from "../src/data/research";
import { UPGRADES_BY_ID } from "../src/data/ship";
import {
  advanceTime,
  buyUpgrade,
  DAY,
  newGame,
  refineOre,
  researchBlockers,
  researchStatus,
  startResearch,
  upgradeUnlocked,
} from "../src/sim";

describe("research projects (AW-15)", () => {
  it("each gates a real upgrade, and first-tier gear stays open", () => {
    for (const p of RESEARCH) expect(UPGRADES_BY_ID.has(p.unlocks)).toBe(true);
    for (const id of ["expandedHold", "deepDrill", "surveyArray", "probeBay", "roverCells", "boat", "refinery"]) {
      expect(RESEARCH_FOR_UPGRADE.has(id)).toBe(false);
    }
  });

  it("lists what's missing, takes the goods and the fee, and finishes on the clock", () => {
    const state = newGame({ seed: 4 });
    state.credits = 100_000;
    expect(researchBlockers(state, "plicite-bits").some((b) => b.includes("titanium"))).toBe(true);
    state.ship.cargo = { titanium: 30, plicite: 5 };
    expect(researchBlockers(state, "plicite-bits")).toEqual([]);
    expect(startResearch(state, "plicite-bits").ok).toBe(true);
    expect(state.ship.cargo.titanium).toBeCloseTo(5, 5);
    expect(state.ship.cargo.plicite).toBeCloseTo(1, 5);
    expect(state.credits).toBe(100_000 - 12_000);
    expect(researchStatus(state, "plicite-bits")).toBe("running");
    expect(startResearch(state, "plicite-bits").ok).toBe(false);
    expect(upgradeUnlocked(state, "coreDrill")).toBe(false);
    advanceTime(state, 21 * DAY + 1);
    expect(researchStatus(state, "plicite-bits")).toBe("done");
    expect(upgradeUnlocked(state, "coreDrill")).toBe(true);
  });

  it("the Shipyard won't sell gated gear until the project is done", () => {
    const state = newGame({ seed: 4 });
    state.credits = 500_000;
    expect(buyUpgrade(state, "deepDrill").ok).toBe(true);
    const r = buyUpgrade(state, "coreDrill");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/research/i);
    state.research = { "plicite-bits": { startedAt: 0, readyAt: 0, done: true } };
    expect(buyUpgrade(state, "coreDrill").ok).toBe(true);
  });

  it("takes concentrate for ore, and data requirements aren't used up", () => {
    const state = newGame({ seed: 4 });
    state.credits = 100_000;
    state.location = { kind: "space", systemId: "s0", pos: { x: 1, y: 0 }, orbiting: null };
    state.ship.upgrades.push("refinery");
    state.ship.cargo = { titanium: 75, copper: 75 };
    refineOre(state, "titanium");
    refineOre(state, "copper");
    state.location = { kind: "intrepid" };
    expect(startResearch(state, "pod-frames").ok).toBe(true);
    expect(state.ship.cargo.titaniumConc).toBeCloseTo(30 - 12, 1);
    const surveys = state.surveyedBodies.length;
    state.surveyedBodies.push(...Array.from({ length: 12 }, (_, i) => `x${i}`));
    expect(startResearch(state, "crust-acoustics").ok).toBe(true);
    expect(state.surveyedBodies.length).toBe(surveys + 12);
    // Two at a time.
    state.ship.cargo = { plicite: 10 };
    state.visitedSystems = Array.from({ length: 8 }, (_, i) => `s${i}`);
    expect(researchBlockers(state, "fold-harmonics").some((b) => b.includes("at a time"))).toBe(true);
  });
});
