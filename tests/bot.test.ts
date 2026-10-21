import { describe, expect, it } from "vitest";
import { runBot } from "../src/sim/bot";

describe("headless captain", () => {
  it.each([42, 7, 2026])("seed %i: completes 10 full trips without errors", (seed) => {
    const report = runBot(seed, 10);
    if (report.errors.length > 0) console.log(report.errors);
    console.table(report.tripSummaries);
    expect(report.errors).toEqual([]);
    expect(report.tripsCompleted).toBe(10);
    expect(report.state.stats.tonnesMined).toBeGreaterThan(100);
    expect(report.state.stats.earned).toBeGreaterThan(0);
  });
});
