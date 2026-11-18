/** AW-256: an outpost's own screen is there while the ship stands in its region, and not elsewhere. */
import { describe, expect, it } from "vitest";
import { DEFAULT_UNIVERSE, newGame, outposts, universeSeed, World } from "../src/sim";
import { validViews } from "../src/ui/session";

const SEED = universeSeed(42, { ...DEFAULT_UNIVERSE, outposts: 7 });
const world = new World(SEED);

describe("the outpost screen (AW-256)", () => {
  it("opens beside an outpost and nowhere else", () => {
    const o = outposts(world).find((x) => x.clan === "lyceum")!;
    const s = newGame({ seed: SEED });
    s.location = { kind: "surface", systemId: o.systemId, bodyId: o.bodyId, region: o.region, rover: null, ship: o.pad, globalCoords: true };
    expect(validViews(s)).toContain("outpost");
    const away = newGame({ seed: SEED });
    expect(validViews(away)).not.toContain("outpost");
  });
});
