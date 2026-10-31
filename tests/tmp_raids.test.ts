import { it } from "vitest";
import { runBot, DEFAULT_UPGRADES } from "../src/sim/bot";
it("bot encounters", () => {
  for (const [label, opts] of [
    ["competent", { survey: true, upgrades: DEFAULT_UPGRADES }],
    ["novice", { novice: true, upgrades: DEFAULT_UPGRADES }],
    ["armed", { survey: true, upgrades: ["laserBattery", "deflectors", ...DEFAULT_UPGRADES, "kineticBattery", "armorPlate"] }],
  ] as const) {
    const runs = [42, 7, 2026, 11, 99, 3].map((seed) => runBot(seed, 40, opts));
    const counts = runs.map((r) => r.raids);
    console.log(`BOT ${label.padEnd(9)} raids/40 trips: ${counts.join(", ")} (avg ${(counts.reduce((a, b) => a + b, 0) / 6).toFixed(1)}), credits avg ${Math.round(runs.reduce((a, r) => a + r.state.credits - r.state.loan.balance, 0) / 6)}`);
  }
}, 900000);
