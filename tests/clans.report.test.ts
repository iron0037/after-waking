/**
 * Clan balance report: the same careers played under each captain's clan. Skipped in the normal run.
 * Run with: CLANS=1 npx vitest run tests/clans.report.test.ts
 * Options: SEEDS=<count, up to 20>, SALTS=<reshuffles per seed, default 2>, CLAN_LIST=exchange,lyceum, TRIPS.
 *
 * Measures net worth gained per game year, so perks that save time (faster refits, scans, drills)
 * count, not just what each trip earns.
 *
 * Careers are very noisy: any change that alters one decision sends a career down a different random
 * path, and novice careers vary hugely. So each seed is played SALTS times with reshuffled luck, the
 * standard error is printed, and a "none (reshuffled)" control row shows the noise floor. A clan is
 * only out of line if it differs from "none" by much more than "none (reshuffled)" does.
 */
import { describe, it } from "vitest";
import { runBot, DEFAULT_UPGRADES, type BotOptions } from "../src/sim/bot";
import { newGame, YEAR } from "../src/sim";
import type { ClanId } from "../src/data/ship";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const ALL_SEEDS = [42, 7, 2026, 11, 99, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597, 2584];
const SEEDS = ALL_SEEDS.slice(0, Number(env.SEEDS ?? 6));
const TRIPS = Number(env.TRIPS ?? 40);
const SALTS = Number(env.SALTS ?? 2);
const ALL: (ClanId | undefined)[] = [undefined, "exchange", "helm", "midshipmen", "diggers", "lyceum", "covenant", "freebooters"];
const only = env.CLAN_LIST?.split(",");
const CLANS = only ? ALL.filter((c) => !c || only.includes(c)) : ALL;

const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));
const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  return Math.round(v.length % 2 ? v[(v.length - 1) / 2]! : (v[v.length / 2 - 1]! + v[v.length / 2]!) / 2);
};
const pctOf = (x: number, base: number) => `${x >= base ? "+" : ""}${Math.round(((x - base) / Math.max(1, Math.abs(base))) * 100)}%`;

describe.skipIf(!env.CLANS)("clan report", () => {
  it("compares clans over a career", () => {
    const profiles: Record<string, BotOptions> = {
      competent: { survey: true, upgrades: DEFAULT_UPGRADES, crewShare: 0.05 },
      novice: { novice: true, upgrades: DEFAULT_UPGRADES },
    };
    for (const [name, opts] of Object.entries(profiles)) {
      const rows: Record<string, number | string>[] = [];
      let base = 0;
      let baseMed = 0;
      const variants: { label: string; clan: ClanId | undefined; saltBase: number }[] = [
        ...CLANS.map((clan) => ({ label: clan ?? "none", clan, saltBase: 0 })),
        { label: "none (reshuffled)", clan: undefined, saltBase: 1000 },
      ];
      for (const { label, clan, saltBase } of variants) {
        const runs = SEEDS.flatMap((seed) => Array.from({ length: SALTS }, (_, k) => runBot(seed, TRIPS, { ...opts, clan, rngSalt: saltBase + k })));
        const perYear = runs.map((r) => {
          const start = newGame({ seed: 1, ...(clan ? { clan } : {}) });
          const gained = r.state.credits - r.state.loan.balance - (start.credits - start.loan.balance);
          return gained / Math.max(0.1, (r.state.time - start.time) / YEAR);
        });
        const mean = avg(perYear);
        const med = median(perYear);
        if (label === "none") {
          base = mean;
          baseMed = med;
        }
        const sd = Math.sqrt(perYear.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, perYear.length - 1));
        rows.push({
          clan: label,
          "per year": mean,
          "± SE": Math.round(sd / Math.sqrt(perYear.length)),
          "vs none": pctOf(mean, base),
          median: med,
          "vs none (median)": pctOf(med, baseMed),
          broke: runs.filter((r) => r.state.credits < 1000 && r.state.loan.balance > 60_000).length,
        });
      }
      console.log(`\n=== ${name}: net worth gained per game year over ${TRIPS} trips, ${SEEDS.length} seeds x ${SALTS} reshuffles ===`);
      console.table(rows);
    }
  }, 3_600_000);
});
