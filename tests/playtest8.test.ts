/** Playtest 8 (2026-10-25): species bonus, new gear, bulk pay, frontier richness, mineral planning. */
import { describe, expect, it } from "vitest";
import {
  advanceTime,
  buyUpgrade,
  contractBenefits,
  DAY,
  deliveryContract,
  deserialize,
  effectiveStats,
  frontierTonnage,
  HAULAGE_PER_T,
  newGame,
  rawRegionDeposits,
  regionDeposits,
  Rng,
  roverChargePerHour,
  routeMinutesMult,
  sellSpecimens,
  serialize,
  shipStats,
  systemMinerals,
  World,
} from "../src/sim";

describe("species bonus", () => {
  it("pays once per species, wherever it was found", () => {
    const state = newGame({ seed: 42 });
    state.ship.specimens = { "s0.p1|cloud drifter": 1, "s3.p5|cloud drifter": 1 };
    const r = sellSpecimens(state);
    expect(r.ok).toBe(true);
    expect(state.catalogedSpecies.filter((s) => s === "cloud drifter")).toHaveLength(1);
    const journal = state.journal.at(-1)!.text;
    expect(journal).toMatch(/2 specimen/);
  });

  it("older saves keep their catalogue, keyed by species", () => {
    const state = newGame({ seed: 42 });
    state.catalogedSpecies = ["s0.p1|glass reed", "s1.p2|glass reed"];
    expect(deserialize(serialize(state)).catalogedSpecies).toEqual(["glass reed"]);
  });
});

describe("new gear", () => {
  it("the probe bay comes with one probe", () => {
    const state = newGame({ seed: 42 });
    state.credits = 100_000;
    expect(buyUpgrade(state, "probeBay").ok).toBe(true);
    advanceTime(state, 3 * DAY);
    expect(state.ship.probes).toBe(1);
  });

  it("fast charger and drive motors", () => {
    const state = newGame({ seed: 42 });
    const charge = roverChargePerHour(state);
    state.ship.upgrades.push("roverFastCharger", "roverMotors");
    expect(roverChargePerHour(state)).toBe(charge * 2);
    expect(routeMinutesMult(state)).toBe(0.75);
  });

  it("cargo pods need the expanded hold first", () => {
    const state = newGame({ seed: 42 });
    state.credits = 200_000;
    expect(buyUpgrade(state, "expandedHold2").ok).toBe(false);
    expect(buyUpgrade(state, "expandedHold").ok).toBe(true);
    expect(buyUpgrade(state, "expandedHold2").ok).toBe(true);
    advanceTime(state, 5 * DAY);
    expect(shipStats(state.ship).cargoCapacityT).toBe(450);
    expect(effectiveStats(state).cargoCapacityT).toBe(450);
  });
});

describe("bulk deliveries pay for the hold space", () => {
  it("include a haulage fee per tonne", () => {
    for (let i = 0; i < 20; i++) {
      const c = deliveryContract(new Rng(i + 1), 0, i);
      expect(c.reward).toBeGreaterThanOrEqual((c.tonnes ?? 0) * HAULAGE_PER_T);
    }
  });
});

describe("the frontier", () => {
  it("home worlds are picked over; worlds past the charted stars are richer", () => {
    const world = new World(42);
    const home = world.system(world.galaxy.systems.find((s) => s.home)!.id).bodies.find((b) => b.regions > 0 && Object.keys(b.resources).length > 0)!;
    const far = world.galaxy.systems.filter((s) => !s.charted).flatMap((s) => world.system(s.id).bodies).find((b) => b.regions > 0)!;
    expect(frontierTonnage(42, home)).toBeLessThan(1);
    expect(frontierTonnage(42, far)).toBeGreaterThan(1.2);
    // Some home deposits are gone, but the rest keep their ids.
    let rolled = 0;
    let left = 0;
    for (let r = 0; r < Math.min(home.regions, 10); r++) {
      const raw = rawRegionDeposits(42, home, r);
      const kept = regionDeposits(42, home, r);
      rolled += raw.length;
      left += kept.length;
      for (const d of kept) expect(raw.find((x) => x.id === d.id)).toBeDefined();
    }
    expect(left).toBeLessThan(rolled);
  });
});

describe("planning folds", () => {
  it("summarises a system's known minerals, with where you can land", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const minerals = systemMinerals(state, world, "s0");
    expect(minerals.length).toBeGreaterThan(0);
    for (const m of minerals) expect(m.bodies.length).toBeGreaterThan(0);
    expect(minerals.some((m) => m.bodies.some((b) => b.landable))).toBe(true);
  });
});

describe("contract benefits line", () => {
  it("names crewmates from the clan, else the clan's goodwill, and Helm obligations", () => {
    const state = newGame({ seed: 42 });
    const c = deliveryContract(new Rng(1), state.time, 1);
    const kin = (state.crew ?? []).filter((m) => m.clan === c.clan);
    const line = contractBenefits(state, c).join(" | ");
    expect(line).toContain("experience");
    expect(line).toContain("spirits");
    if (kin.length > 0) expect(line).toContain(`+loyalty with ${kin[0]?.name}`);
    else expect(line).toContain("+goodwill with");
    state.crew = [];
    expect(contractBenefits(state, c).join(" | ")).toContain("+goodwill with");
    expect(contractBenefits(state, { ...c, obligation: true }).join(" | ")).toContain("Helm's goodwill");
  });
});
