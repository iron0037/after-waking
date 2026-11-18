/** AW-270: the region pickers never suggest a region the ship can't set down in. */
import { describe, expect, it } from "vitest";
import { PERKS_BY_ID } from "../src/data/perks";
import { canSetDownIn, hunchRegion, newGame, suggestedRegion, World, xpForLevel } from "../src/sim";

describe("region suggestions on ocean worlds (AW-270)", () => {
  it("the suggested region and the captain's hunch are always somewhere to land", () => {
    let oceans = 0;
    let tricky = 0;
    for (const seed of [42, 7, 2026]) {
      const world = new World(seed);
      const s = newGame({ seed });
      const def = PERKS_BY_ID.get("hunch")!;
      expect(def.station).toBe("captain");
      s.captain.xp = Math.max(s.captain.xp ?? 0, xpForLevel(10));
      s.captain.perks = [...(s.captain.perks ?? []), "hunch"];
      for (const sys of world.galaxy.systems) {
        for (const body of world.system(sys.id).bodies) {
          if (body.kind !== "ocean" || body.regions === 0) continue;
          const dry = Array.from({ length: body.regions }, (_, r) => r).filter((r) => canSetDownIn(s, body, r));
          if (dry.length === 0) continue;
          oceans++;
          if (dry.length < body.regions) tricky++;
          expect(canSetDownIn(s, body, suggestedRegion(s, body, 1, 250))).toBe(true);
          const hunch = hunchRegion(s, body);
          expect(hunch === null || canSetDownIn(s, body, hunch)).toBe(true);
        }
      }
    }
    expect(oceans).toBeGreaterThan(0);
    expect(tricky).toBeGreaterThan(0); // some worlds have regions with nowhere to land
  });
});
