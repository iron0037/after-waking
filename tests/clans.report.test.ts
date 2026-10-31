/**
 * Clan balance report: the same careers played under each captain's clan. Skipped in the normal run.
 * Run with: CLANS=1 npx vitest run tests/clans.report.test.ts
 */
import { describe, it } from "vitest";
import { runBot, DEFAULT_UPGRADES, type BotOptions } from "../src/sim/bot";
import type { ClanId } from "../src/data/ship";

const SEEDS = [42, 7, 2026, 11, 99, 3, 5, 8, 13, 21, 34, 55].slice(0, Number((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.SEEDS ?? 6));
const TRIPS = 40;
const ALL: (ClanId | undefined)[] = [undefined, "exchange", "helm", "midshipmen", "diggers", "lyceum", "covenant", "freebooters"];
const only = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env?.CLAN_LIST?.split(",");
const CLANS = only ? ALL.filter((c) => !c || only.includes(c)) : ALL;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const avg = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length));

describe.skipIf(!env.CLANS)("clan report", () => {
  it("compares clans over a career", () => {
    const profiles: Record<string, BotOptions> = {
      competent: { survey: true, upgrades: DEFAULT_UPGRADES, crewShare: 0.05 },
      novice: { novice: true, upgrades: DEFAULT_UPGRADES },
    };
    for (const [name, opts] of Object.entries(profiles)) {
      const rows: Record<string, number | string>[] = [];
      let base = 0;
      for (const clan of CLANS) {
        const runs = SEEDS.map((seed) => runBot(seed, TRIPS, { ...opts, clan }));
        const worth = avg(runs.map((r) => r.state.credits - r.state.loan.balance));
        if (!clan) base = worth;
        rows.push({
          clan: clan ?? "none",
          "net worth": worth,
          "vs none": `${worth >= base ? "+" : ""}${Math.round(((worth - base) / Math.max(1, Math.abs(base))) * 100)}%`,
          broke: runs.filter((r) => r.state.credits < 1000 && r.state.loan.balance > 60_000).length,
          missed: avg(runs.map((r) => r.state.loan.missed)),
        });
      }
      console.log(`\n=== ${name}: credits minus loan after ${TRIPS} trips ===`);
      console.table(rows);
    }
  }, 1_200_000);
});
