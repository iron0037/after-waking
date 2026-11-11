/** AW-23: the clans' outposts, placed by the seed. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_UNIVERSE,
  knownOutposts,
  newGame,
  outpostAt,
  outpostKnown,
  outposts,
  settingsLine,
  universeOf,
  universeSeed,
  World,
  type Outpost,
} from "../src/sim";

const at = (base: number, n: number) => new World(universeSeed(base, { ...DEFAULT_UNIVERSE, outposts: n }));

describe("outposts (AW-23)", () => {
  it("the setting rides in the seed; seeds from before outposts read as the default 3", () => {
    expect(universeOf(42).outposts).toBe(3);
    expect(universeSeed(42, DEFAULT_UNIVERSE)).toBe(42); // the default doesn't change the seed
    for (let n = 0; n <= 7; n++) {
      const seed = universeSeed(42, { ...DEFAULT_UNIVERSE, hostile: "plentiful", life: "scarce", outposts: n });
      expect(universeOf(seed)).toMatchObject({ outposts: n, hostile: "plentiful", life: "scarce", stars: 22 });
    }
    expect(settingsLine({ ...universeOf(42), ...newGame({ seed: 42 }).settings! })).toMatch(/3 outposts/);
  });

  it("as many as the setting asks, one clan each, one to a region, the same every time", () => {
    for (const base of [42, 7, 2026]) {
      for (const n of [0, 3, 7]) {
        const list = outposts(at(base, n));
        expect(list).toHaveLength(n);
        expect(new Set(list.map((o) => o.clan)).size).toBe(n);
        expect(new Set(list.map((o) => `${o.bodyId}#${o.region}`)).size).toBe(n);
      }
      expect(outposts(at(base, 7)).map((o) => o.bodyId)).toEqual(outposts(at(base, 7)).map((o) => o.bodyId));
    }
  });

  it("each clan settles where it would want to be", () => {
    for (const base of [42, 7, 2026, 11, 99]) {
      const world = at(base, 7);
      const by = (clan: string) => outposts(world).find((o) => o.clan === clan) as Outpost;
      const where = (o: Outpost) => world.body(o.bodyId);
      expect(where(by("lyceum")).body.life).toBe(true);
      expect(where(by("freebooters")).detail.system.charted).toBe(false);
      expect(where(by("exchange")).detail.system.charted).toBe(true);
      expect(where(by("helm")).detail.system.charted).toBe(true);
      expect(where(by("covenant")).body.pressureAtm).toBeLessThan(0.01);
      for (const o of outposts(world)) {
        expect(where(o).body.regions).toBeGreaterThan(o.region);
        expect(outpostAt(world, o.bodyId, o.region)?.id).toBe(o.id);
        expect(o.population).toBeGreaterThanOrEqual(30);
        expect(o.population).toBeLessThanOrEqual(400);
      }
    }
  });

  it("the pirate's den is off the charts until you find its star or the Freebooters trust you", () => {
    const world = at(42, 7);
    const s = newGame({ seed: world.seed });
    const den = outposts(world).find((o) => o.clan === "freebooters")!;
    expect(outpostKnown(s, den)).toBe(false);
    expect(knownOutposts(s, world)).toHaveLength(6);
    s.reputation = { freebooters: 25 };
    expect(outpostKnown(s, den)).toBe(true);
    s.reputation = {};
    s.visitedSystems.push(den.systemId);
    expect(outpostKnown(s, den)).toBe(true);
  });
});
