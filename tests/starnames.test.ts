/** AW-223: more variety in star names, for new careers only. */
import { describe, expect, it } from "vitest";
import { STAR_NAMES, STAR_NAMES_V2 } from "../src/data/names";
import { World } from "../src/sim";

describe("star names (AW-223)", () => {
  it("new careers draw on a much bigger pool; saves from before keep their names", () => {
    expect(STAR_NAMES_V2.length).toBeGreaterThan(5 * STAR_NAMES.length);
    for (const n of STAR_NAMES) expect(STAR_NAMES_V2).toContain(n);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const charted = new World(seed, 6).galaxy.systems.filter((s) => s.charted);
      for (const s of charted) {
        expect(STAR_NAMES_V2 as readonly string[]).toContain(s.name);
        seen.add(s.name);
      }
      // An older save rebuilds its old names.
      for (const s of new World(seed, 5).galaxy.systems.filter((x) => x.charted)) expect(STAR_NAMES as readonly string[]).toContain(s.name);
    }
    expect(seen.size).toBeGreaterThan(100);
  });

  it("only the names change: the same stars stand in the same places", () => {
    const a = new World(7, 5).galaxy.systems;
    const b = new World(7, 6).galaxy.systems;
    expect(b.map((s) => [s.pos, s.spectral, s.charted])).toEqual(a.map((s) => [s.pos, s.spectral, s.charted]));
  });
});
