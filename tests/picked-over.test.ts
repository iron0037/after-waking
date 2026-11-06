/** AW-226 / AW-227: picked-over home stars, the note's red flag, the Boat shipyard heading. */
import { describe, expect, it } from "vitest";
import { UPGRADES_BY_ID } from "../src/data/ship";
import { advanceTime, newGame, World } from "../src/sim";
import { frontierOf } from "../src/sim/surface";
import { DAY } from "../src/sim/units";

function density(gen: number, frontier: "home" | "charted" | "uncharted"): number {
  const w = new World(42, gen);
  let regions = 0;
  let deposits = 0;
  for (const sys of w.galaxy.systems) {
    for (const b of w.system(sys.id).bodies) {
      if (b.regions === 0 || Object.keys(b.resources).length === 0 || frontierOf(42, b).frontier !== frontier) continue;
      for (let r = 0; r < Math.min(b.regions, 6); r++) {
        regions++;
        deposits += w.surface(b.id).deposits(r).filter((d) => !d.hidden).length;
      }
    }
  }
  return deposits / regions;
}

describe("the home stars are picked over (AW-227)", () => {
  it("new careers find about two seams a region at home; the charted stars and the frontier are untouched", () => {
    expect(density(7, "home")).toBeGreaterThan(1.4);
    expect(density(7, "home")).toBeLessThan(2.8);
    expect(density(7, "charted")).toBeCloseTo(density(6, "charted"), 5);
    expect(density(7, "uncharted")).toBeCloseTo(density(6, "uncharted"), 5);
  });

  it("games already under way keep their seams", () => {
    expect(density(6, "home")).toBeGreaterThan(3);
  });
});

describe("the Exchange note's red flag (AW-226)", () => {
  it("shows while a payment is missed and clears at the next one paid", () => {
    const s = newGame({ seed: 42 });
    s.credits = 0;
    s.loan.graceAt = s.time; // this year's grace already used
    advanceTime(s, Math.max(0, s.loan.nextDue - s.time) + DAY);
    expect(s.loan.missed).toBe(1);
    expect(s.loan.behind).toBe(true);
    s.credits = 1_000_000;
    advanceTime(s, Math.max(0, s.loan.nextDue - s.time) + DAY);
    expect(s.loan.missed).toBe(1);
    expect(s.loan.behind).toBeUndefined();
  });
});

describe("shipyard headings (AW-226)", () => {
  it("boat gear has its own heading", () => {
    for (const id of ["boat", "cryoFloats", "cryoFloats2"]) expect(UPGRADES_BY_ID.get(id)!.category).toBe("boat");
    expect([...UPGRADES_BY_ID.values()].filter((u) => u.name.toLowerCase().includes("boat")).every((u) => u.category === "boat")).toBe(true);
  });
});
