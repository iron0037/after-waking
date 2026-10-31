/** Corrosive worlds told you to get a corrosion-proof hull that the Shipyard didn't sell. */
import { expect, it } from "vitest";
import { effectiveStats, landingAccess, newGame, World } from "../src/sim";

it("ceramic hull cladding opens corrosive worlds", () => {
  let checked = 0;
  for (const seed of [42, 7, 11, 99, 3]) {
    const world = new World(seed);
    const s = newGame({ seed });
    const ratings = effectiveStats(s).ratings;
    // Corrosive worlds whose only obstacle is the corrosion.
    const blocked = world.galaxy.systems
      .flatMap((sys) => world.system(sys.id).bodies)
      .filter((b) => b.chemistry === "corrosive" && landingAccess(b, ratings).reasons.length === 1);
    for (const b of blocked) {
      expect(landingAccess(b, ratings).reasons[0]).toMatch(/corrosion-proof/);
      checked++;
    }
    s.ship.upgrades.push("corrosionHull");
    for (const b of blocked) expect(landingAccess(b, effectiveStats(s).ratings).ok).toBe(true);
  }
  expect(checked).toBeGreaterThan(0);
});
