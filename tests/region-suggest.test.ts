/** AW-228: the landing chart reads what's left in the ground, so worked-out regions stop being suggested. */
import { describe, expect, it } from "vitest";
import { emptyKnowledge, newGame, regionReading, suggestedRegion, World } from "../src/sim";
import { regionKey } from "../src/sim/surface";

describe("suggested landing region (AW-228)", () => {
  it("a worked-out region reads empty and the suggestion moves on", () => {
    const s = newGame({ seed: 42 });
    const world = new World(s.seed, s.worldGen);
    const body = world.galaxy.systems
      .flatMap((sys) => world.system(sys.id).bodies)
      .find((b) => b.regions >= 4 && Object.keys(b.resources).length > 0 && world.surface(b.id).deposits(0).length > 0)!;
    const first = suggestedRegion(s, body, 3, Infinity);
    expect(regionReading(s, body, first, 3)).toBeGreaterThan(0);
    // Dig every seam in it out.
    const know = (s.regions[regionKey(body.id, first)] ??= emptyKnowledge());
    know.visits = 3;
    for (const d of world.surface(body.id).deposits(first)) know.extracted[d.id] = d.tonnes;
    expect(regionReading(s, body, first, 3)).toBe(0);
    expect(suggestedRegion(s, body, 3, Infinity)).not.toBe(first);
  });
});
