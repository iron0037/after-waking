/** AW-21: what each starting clan sets up, beyond the modifiers. */
import { describe, expect, it } from "vitest";
import { CAPTAIN_CLANS } from "../src/data/clans";
import { covenantErrands, diggersLeadOnDocked, newGame, reputation, World, type GameState } from "../src/sim";
import { YEAR } from "../src/sim/units";

const SEED = 42;
const world = new World(SEED);

function leads(state: GameState): number {
  return Object.values(state.regions).reduce((n, k) => n + k.discovered.length, 0);
}

describe("starting clans (AW-21)", () => {
  it("a Digger captain launches with one rich seam marked, on a scanned world", () => {
    const s = newGame({ seed: SEED, clan: "diggers" });
    expect(leads(s)).toBe(1);
    expect(s.diggersLeadAt).toBe(s.time);
    const [key, know] = Object.entries(s.regions).find(([, k]) => k.discovered.length > 0)!;
    const bodyId = key.split("#")[0]!;
    expect(s.scannedBodies).toContain(bodyId);
    const d = world.surface(bodyId).deposits(Number(key.split("#")[1])).find((x) => x.id === know.discovered[0])!;
    expect(d.grade).toBeGreaterThanOrEqual(0.45);
    expect(s.journal.some((j) => j.text.includes("assay office"))).toBe(true);
    expect(leads(newGame({ seed: SEED, clan: "exchange" }))).toBe(0);
  });

  it("then one more a year, given at docking", () => {
    const s = newGame({ seed: SEED, clan: "diggers" });
    s.time += YEAR / 2;
    diggersLeadOnDocked(s, world);
    expect(leads(s)).toBe(1);
    s.time += YEAR / 2;
    diggersLeadOnDocked(s, world);
    expect(leads(s)).toBe(2);
    const other = newGame({ seed: SEED, clan: "lyceum" });
    other.time += 2 * YEAR;
    diggersLeadOnDocked(other, world);
    expect(leads(other)).toBe(0);
  });

  it("the new-game text names the effects that live outside the modifiers", () => {
    const covenant = newGame({ seed: SEED, clan: "covenant" });
    expect(covenantErrands(covenant, world).length).toBeGreaterThan(0);
    expect(CAPTAIN_CLANS.covenant.perk).toMatch(/errand/);
    const free = newGame({ seed: SEED, clan: "freebooters" });
    expect(reputation(free, "helm")).toBeLessThan(0);
    expect(reputation(free, "exchange")).toBeLessThan(0);
    expect(CAPTAIN_CLANS.freebooters.cost).toMatch(/Helm and the Exchange start out cool/);
    expect(CAPTAIN_CLANS.diggers.perk).toMatch(/seam/);
  });
});
