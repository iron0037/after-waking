/** AW-207: signature talents. */
import { describe, expect, it } from "vitest";
import { MINERAL_SPECIMENS } from "../src/data/catalog";
import { TALENTS, TALENTS_BY_ID, type TalentId } from "../src/data/talents";
import {
  blindFoldFuel,
  blindFoldRange,
  changeRep,
  effectiveStats,
  ensureVolunteers,
  foldPlan,
  foundMineralSpecimen,
  newGame,
  reputation,
  retirementsOnDocked,
  roverSpecimenSlots,
  spotChance,
  World,
  type GameState,
} from "../src/sim";
import { YEAR } from "../src/sim/units";

const world = new World(42);

function withTalent(id: TalentId): GameState {
  const state = newGame({ seed: 42 });
  const t = TALENTS_BY_ID.get(id)!;
  state.crew!.find((m) => m.station === t.station)!.talent = id;
  return state;
}

describe("signature talents (AW-207)", () => {
  it("every recruit brings one from their station; the green starting crew and volunteers bring none", () => {
    const state = newGame({ seed: 42 });
    expect(state.crew!.every((m) => m.talent === undefined)).toBe(true);
    expect(state.recruits!.length).toBeGreaterThan(0);
    for (const r of state.recruits!) {
      expect(r.talent, r.name).toBeDefined();
      expect(TALENTS_BY_ID.get(r.talent!)!.station).toBe(r.station);
    }
    state.crew = state.crew!.filter((m) => m.station !== "medical");
    ensureVolunteers(state);
    const vol = state.recruits!.find((r) => r.volunteer)!;
    expect(vol.station).toBe("medical");
    expect(vol.talent).toBeUndefined();
    // Three per station.
    for (const st of ["science", "navigation", "engineering", "comms", "medical"]) expect(TALENTS.filter((t) => t.station === st)).toHaveLength(3);
  });

  it("ship talents: fuel, hold, rover, specimen racks, rare plants, deep sweeps", () => {
    const base = effectiveStats(newGame({ seed: 42 }));
    expect(effectiveStats(withTalent("tank-rigger")).fuelCapacity).toBe(Math.round(base.fuelCapacity * 1.25));
    expect(effectiveStats(withTalent("hold-packer")).cargoCapacityT).toBeGreaterThan(base.cargoCapacityT);
    expect(effectiveStats(withTalent("rover-whisperer")).roverEnergy).toBeGreaterThan(base.roverEnergy);
    expect(roverSpecimenSlots(withTalent("specimen-keeper"))).toBe(roverSpecimenSlots(newGame({ seed: 42 })) + 4);
    expect(base.rareLifeSense).toBe(false);
    expect(effectiveStats(withTalent("archive-tracker")).rareLifeSense).toBe(true);
    const deep = withTalent("deep-sky");
    deep.ship.upgrades.push("deepFieldArray");
    const plain = newGame({ seed: 42 });
    plain.ship.upgrades.push("deepFieldArray");
    expect(effectiveStats(deep).deepScanLy).toBeGreaterThan(effectiveStats(plain).deepScanLy);
  });

  it("navigation talents: dark folds, raider's eyes, quick plots", () => {
    const pilot = withTalent("dark-fold");
    expect(blindFoldRange(pilot)).toBe(0.8);
    expect(blindFoldFuel(pilot)).toBe(1);
    expect(blindFoldRange(newGame({ seed: 42 }))).toBe(0.6);
    expect(spotChance(withTalent("raiders-eyes"))).toBeGreaterThan(spotChance(newGame({ seed: 42 })));
    const target = world.galaxy.systems[0]!.id;
    expect(foldPlan(withTalent("quick-plotter"), world, target).refitMinutes).toBeLessThan(foldPlan(newGame({ seed: 42 }), world, target).refitMinutes);
  });

  it("clan fixer: goodwill with their own clan builds faster", () => {
    const fixer = withTalent("clan-fixer");
    const clan = fixer.crew!.find((m) => m.talent === "clan-fixer")!.clan;
    const plain = newGame({ seed: 42 });
    const a = reputation(fixer, clan);
    const b = reputation(plain, clan);
    changeRep(fixer, clan, 10, "test", false);
    changeRep(plain, clan, 10, "test", false);
    expect(reputation(fixer, clan) - a).toBeGreaterThan(reputation(plain, clan) - b);
  });

  it("gem cutter doubles what mineral specimens fetch", () => {
    const gem = MINERAL_SPECIMENS[0]!;
    const cutter = withTalent("gem-cutter");
    const plain = newGame({ seed: 42 });
    const c0 = cutter.credits;
    const p0 = plain.credits;
    foundMineralSpecimen(cutter, gem, "x");
    foundMineralSpecimen(plain, gem, "x");
    expect(cutter.credits - c0).toBe(2 * (plain.credits - p0));
  });

  it("a Family Ship protégé inherits the veteran's talent", () => {
    const state = withTalent("tank-rigger");
    const eng = state.crew!.find((m) => m.station === "engineering")!;
    eng.born = state.time - 70 * YEAR;
    state.crew!.find((m) => m.station === "medical")!.perks = ["family-ship"];
    retirementsOnDocked(state);
    state.time += 60 * 24 * 40;
    retirementsOnDocked(state);
    const p = state.crew!.find((m) => m.station === "engineering")!;
    expect(p.id).not.toBe(eng.id);
    expect(p.talent).toBe("tank-rigger");
  });
});
