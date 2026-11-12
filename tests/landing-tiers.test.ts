/** AW-247: which worlds the ship can land on now, with better gear, or never. */
import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../src/data/ship";
import { BEST_LANDING_RATINGS, landingAccess, landingTier, landingTiers, newGame, World } from "../src/sim";

const world = new World(42);
const bodies = world.galaxy.systems.flatMap((s) => world.system(s.id).bodies);

describe("landing tiers (AW-247)", () => {
  it("now with the ship's ratings, gear with the best a ship can be fitted to, otherwise never", () => {
    const seen = new Set<string>();
    for (const b of bodies) {
      const tier = landingTier(b, BASE_STATS.ratings);
      seen.add(tier);
      if (tier === "now") expect(landingAccess(b, BASE_STATS.ratings).ok).toBe(true);
      if (tier === "gear") {
        expect(landingAccess(b, BASE_STATS.ratings).ok).toBe(false);
        expect(landingAccess(b, BEST_LANDING_RATINGS).ok).toBe(true);
      }
      if (tier === "never") expect(b.regions === 0 || !landingAccess(b, BEST_LANDING_RATINGS).ok).toBe(true);
      if (b.regions === 0) expect(tier).toBe("never");
    }
    expect([...seen].sort()).toEqual(["gear", "never", "now"]);
  });

  it("only scanned bodies get a tier", () => {
    const s = newGame({ seed: 42 });
    const sys = world.galaxy.systems.find((x) => world.system(x.id).bodies.length > 2)!;
    const [first, ...rest] = world.system(sys.id).bodies;
    s.scannedBodies = [first!.id];
    const tiers = landingTiers(s, world, sys.id);
    expect([...tiers.keys()]).toEqual([first!.id]);
    expect(rest.some((b) => tiers.has(b.id))).toBe(false);
  });
});
