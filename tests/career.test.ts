/**
 * Career balance report: how the challenge curve and the money evolve over a long career, for a
 * competent captain and a novice. Skipped in the normal test run.
 * Run with: BALANCE=1 npx vitest run tests/career.test.ts
 */
import { describe, it } from "vitest";
import { runBot, DEFAULT_UPGRADES, type BotOptions } from "../src/sim/bot";

const SEEDS = [42, 7, 2026, 11, 99, 3];
const TRIPS = 60;
const BUCKET = 10;

const PROFILES: Record<string, BotOptions> = {
  competent: { survey: true, upgrades: DEFAULT_UPGRADES, crewShare: 0.05 },
  novice: { novice: true, upgrades: DEFAULT_UPGRADES },
};

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

describe.skipIf(!env.BALANCE)("career report", () => {
  it("tracks the curve over 60 trips", () => {
    for (const [name, opts] of Object.entries(PROFILES)) {
      const runs = SEEDS.map((seed) => runBot(seed, TRIPS, opts));
      const rows: Record<string, number | string>[] = [];
      for (let b = 0; b < TRIPS / BUCKET; b++) {
        const trips = runs.flatMap((r) => r.tripSummaries.slice(b * BUCKET, (b + 1) * BUCKET));
        if (trips.length === 0) break;
        const last = runs.map((r) => r.tripSummaries[Math.min(r.tripSummaries.length, (b + 1) * BUCKET) - 1]).filter((t) => t !== undefined);
        rows.push({
          trips: `${b * BUCKET + 1}-${(b + 1) * BUCKET}`,
          "days/trip": avg(trips.map((t) => t.days)),
          "revenue/trip": avg(trips.map((t) => t.revenue)),
          "costs/trip": avg(trips.map((t) => t.revenue - t.net)),
          "net/trip": avg(trips.map((t) => t.net)),
          "net/100d": avg(trips.map((t) => (t.net / Math.max(1, t.days)) * 100)),
          "% profitable": Math.round((100 * trips.filter((t) => t.net > 0).length) / trips.length),
          "worst trip": Math.min(...trips.map((t) => t.net)),
          credits: avg(last.map((t) => t!.credits)),
          loan: avg(last.map((t) => t!.loan)),
          "crew lvl": Math.round(avg(last.map((t) => t!.crewLevel * 10))) / 10,
          rescues: avg(last.map((t) => t!.rescues * 10)) / 10,
          quits: avg(last.map((t) => t!.quits * 10)) / 10,
          happy: avg(last.map((t) => t!.happiness)),
          loyal: avg(last.map((t) => t!.loyalty)),
        });
      }
      console.log(`\n=== ${name} ===`);
      console.table(rows);
      const errs = runs.flatMap((r) => r.errors);
      if (errs.length) console.log(name, "errors:", errs.slice(0, 8));
      const broke = runs.filter((r) => r.state.credits < 1000 && r.state.loan.balance > 60_000).length;
      console.log(`${name}: ${broke}/${runs.length} careers ended broke and deep in debt; missed payments avg ${avg(runs.map((r) => r.state.loan.missed))}; trips completed avg ${avg(runs.map((r) => r.tripsCompleted))}`);
    }
  }, 600_000);
});
