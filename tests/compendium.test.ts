import { describe, expect, it } from "vitest";
import { COMMODITY_IDS } from "../src/data/commodities";
import { FLORA, MINERAL_SPECIMENS, FLORA_BY_NAME } from "../src/data/catalog";
import { bodySpecies, compendiumTotals, World } from "../src/sim";
import { runBot } from "../src/sim/bot";

describe("catalog", () => {
  it("has unique ids and names", () => {
    const ids = [...FLORA.map((f) => f.id), ...MINERAL_SPECIMENS.map((g) => g.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(FLORA_BY_NAME.size).toBe(FLORA.length);
  });

  it("gives every climate enough flora and every ore at least one specimen", () => {
    for (const climate of ["cold", "temperate", "warm"] as const) {
      expect(FLORA.filter((f) => f.climates.includes(climate)).length).toBeGreaterThanOrEqual(6);
    }
    for (const id of COMMODITY_IDS) expect(MINERAL_SPECIMENS.some((g) => g.host === id)).toBe(true);
  });

  it("living worlds draw catalogued species", () => {
    const world = new World(42);
    const living = world.galaxy.systems.flatMap((s) => world.system(s.id).bodies).filter((b) => b.life);
    expect(living.length).toBeGreaterThan(0);
    for (const b of living) {
      const species = bodySpecies(42, b);
      expect(species.length).toBeGreaterThanOrEqual(3);
      for (const name of species) expect(FLORA_BY_NAME.has(name)).toBe(true);
    }
  });
});

describe("compendium", () => {
  it("fills in as the captain mines", () => {
    const { state } = runBot(42, 6);
    const totals = compendiumTotals(state);
    expect(totals.mineral.found).toBeGreaterThanOrEqual(3);
    expect(totals.all.total).toBe(COMMODITY_IDS.length + MINERAL_SPECIMENS.length + FLORA.length);
  });

  it("turns up mineral specimens over a career", () => {
    const found = [42, 7, 2026].reduce((sum, seed) => sum + compendiumTotals(runBot(seed, 10).state).gem.found, 0);
    expect(found).toBeGreaterThan(0);
  });
});
