/**
 * Balance report: compares bot strategies across seeds. Skipped in the normal test run.
 * Run with: BALANCE=1 npx vitest run tests/balance.test.ts
 */
import { describe, it } from "vitest";
import { runBot, DEFAULT_UPGRADES, type BotOptions } from "../src/sim/bot";
import { DAY, YEAR, GAME_START } from "../src/sim";

const SEEDS = [42, 7, 2026, 11, 99, 3, 17, 123, 555, 808, 1999, 31337];
const TRIPS = 15;

const STRATEGIES: Record<string, BotOptions> = {
  "bare (no survey, no upgrades)": { survey: false, upgrades: [] },
  "survey only": { survey: true, upgrades: [] },
  "upgrades only": { survey: false, upgrades: DEFAULT_UPGRADES },
  "survey + upgrades": { survey: true, upgrades: DEFAULT_UPGRADES },
};

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

describe.skipIf(!env.BALANCE)("balance report", () => {
  it("compares strategies", () => {
    const rows: Record<string, string | number>[] = [];
    for (const [name, opts] of Object.entries(STRATEGIES)) {
      const all = SEEDS.map((seed) => runBot(seed, TRIPS, opts));
      const trips = all.flatMap((r) => r.tripSummaries);
      const early = all.flatMap((r) => r.tripSummaries.slice(0, 5));
      const late = all.flatMap((r) => r.tripSummaries.slice(-5));
      const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
      const years = avg(all.map((r) => (r.state.time - GAME_START) / YEAR) as number[]);
      rows.push({
        strategy: name,
        "days/trip": avg(trips.map((t) => t.days)),
        "net/trip (first 5)": avg(early.map((t) => t.net)),
        "net/trip (last 5)": avg(late.map((t) => t.net)),
        "% trips profitable": Math.round((100 * trips.filter((t) => t.net > 0).length) / Math.max(1, trips.length)),
        "net per 100 days": avg(all.map((r) => (r.state.credits - 6_000) / ((r.state.time - GAME_START) / DAY) * 100)),
        "end credits": avg(all.map((r) => r.state.credits)),
        "upgrades": avg(all.map((r) => r.state.ship.upgrades.length)),
        "loan left": avg(all.map((r) => r.state.loan.balance)),
        "missed pays": avg(all.map((r) => r.state.loan.missed)),
        "years": years,
        "errors": all.reduce((s, r) => s + r.errors.length, 0),
      });
    }
    console.table(rows);
    for (const [name, opts] of Object.entries(STRATEGIES)) {
      for (const seed of SEEDS) {
        const errs = runBot(seed, TRIPS, opts).errors;
        if (errs.length) console.log(name, seed, errs);
      }
    }
  }, 300_000); // a full report runs many bot careers
});
