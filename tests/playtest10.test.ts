import { describe, expect, it } from "vitest";
import { MINERAL_SPECIMENS } from "../src/data/catalog";
import { COMMODITIES } from "../src/data/commodities";
import {
  awardXp,
  buyUpgrade,
  effectiveStats,
  foundMineralSpecimen,
  hiddenDeposits,
  newGame,
  officerAt,
  researchBlockers,
  researchWants,
  roverSpecimenSlots,
  startResearch,
  STATION_XP_RATE,
  toggleTrackResearch,
  trackedProjects,
  World,
} from "../src/sim";

describe("playtest 10", () => {
  it("science and navigation learn more slowly", () => {
    const state = newGame({ seed: 5 });
    const sci = officerAt(state, "science")!;
    sci.xp = 0;
    awardXp(state, "science", 100);
    // Cryo-children learn 10% faster; either way it's well under the raw award.
    expect(sci.xp).toBeLessThanOrEqual(100 * STATION_XP_RATE.science * 1.1 * 1.25 + 1e-6);
    expect(STATION_XP_RATE.science).toBeLessThan(0.5);
    expect(STATION_XP_RATE.navigation).toBeLessThan(1);
  });

  it("hidden seams lean to the valuable minerals", () => {
    const world = new World(1);
    let hidden = 0;
    let hiddenPrice = 0;
    for (const sys of world.galaxy.systems.slice(0, 10)) {
      for (const b of world.system(sys.id).bodies) {
        for (let r = 0; r < Math.min(b.regions, 4); r++) {
          for (const d of hiddenDeposits(1, b, r, 0)) {
            hidden++;
            hiddenPrice += COMMODITIES[d.commodity].basePrice;
          }
        }
      }
    }
    expect(hidden).toBeGreaterThan(10);
    expect(hiddenPrice / hidden).toBeGreaterThan(150);
  });

  it("every mineral specimen pays, the first one too", () => {
    const state = newGame({ seed: 5 });
    const gem = MINERAL_SPECIMENS[0]!;
    const c0 = state.credits;
    foundMineralSpecimen(state, gem, "somewhere");
    expect(state.credits).toBeGreaterThan(c0);
    expect(state.journal.at(-1)!.text).toMatch(/^Mineral specimen:/);
  });

  it("tracked research shows what to collect, and clears once commissioned", () => {
    const state = newGame({ seed: 5 });
    expect(toggleTrackResearch(state, "pod-frames").ok).toBe(true);
    expect(trackedProjects(state).map((p) => p.id)).toEqual(["pod-frames"]);
    expect(researchWants(state).get("titanium")).toBe(30);
    state.credits = 100_000;
    state.ship.cargo = { titanium: 30, copper: 30 };
    expect(startResearch(state, "pod-frames").ok).toBe(true);
    expect(trackedProjects(state)).toHaveLength(0);
  });

  it("specimen projects take live specimens, and their gear is worth having", () => {
    const state = newGame({ seed: 5 });
    state.credits = 200_000;
    expect(researchBlockers(state, "living-archive").some((b) => b.includes("rare"))).toBe(true);
    state.ship.specimens = { "a|song moss": 2, "b|aurora tuft": 1, "c|abyss lantern": 1, "d|bellwort": 3 };
    expect(startResearch(state, "living-archive").ok).toBe(true);
    expect(state.ship.specimens).toEqual({ "d|bellwort": 3 });
    state.research!["living-archive"]!.done = true;
    const slots = roverSpecimenSlots(state);
    expect(buyUpgrade(state, "fieldXenolab").ok).toBe(true);
    state.ship.upgrades.push("fieldXenolab");
    expect(roverSpecimenSlots(state)).toBe(slots + 3);
    expect(effectiveStats(state).specimenPriceMult).toBeCloseTo(1.4);
  });
});
