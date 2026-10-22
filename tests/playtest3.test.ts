/** Fixes and features from the third playtest (2026-10-22). */
import { describe, expect, it } from "vitest";
import {
  acceptContract,
  DAY,
  DOCKING_MINUTES,
  fold,
  flyTo,
  knownDeposits,
  knowledge,
  land,
  landingAccess,
  loanOutlook,
  newGame,
  sellAll,
  shipStats,
  wait,
  World,
} from "../src/sim";
import { BASE_STATS } from "../src/data/ship";
import { exploredFraction } from "../src/sim/surface";

describe("folding", () => {
  it("is instant, and the rover's cells are full afterwards", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.ship.roverEnergy = 5;
    const t0 = state.time;
    expect(fold(state, world, "s0").ok).toBe(true);
    expect(state.time).toBe(t0);
    expect(state.ship.roverEnergy).toBe(shipStats(state.ship).roverEnergy);

    expect(wait(state, state.foldReadyAt - state.time).ok).toBe(true);
    const t1 = state.time;
    expect(fold(state, world, "intrepid").ok).toBe(true);
    expect(state.time - t1).toBe(DOCKING_MINUTES); // docking, not the fold
  });
});

describe("landing", () => {
  it("sweeps the ground around the ship before the rover rolls out", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    const body = world.system("s0").bodies.find((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)!;
    expect(flyTo(state, world, { bodyId: body.id }).ok).toBe(true);
    expect(land(state, world, 0).ok).toBe(true);
    expect(exploredFraction(knowledge(state, body.id, 0))).toBeGreaterThan(0);
  });
});

describe("selling the hold", () => {
  it("keeps back what an active delivery contract needs", () => {
    const state = newGame({ seed: 42 });
    const c = state.contracts.find((x) => x.kind === "deliver")!;
    expect(acceptContract(state, c.id).ok).toBe(true);
    const commodity = c.commodity!;
    state.ship.cargo[commodity] = (c.tonnes ?? 0) + 10;
    const r = sellAll(state);
    expect(r.ok).toBe(true);
    expect(state.ship.cargo[commodity]).toBeCloseTo(c.tonnes ?? 0, 5);
    // Only contract cargo left: nothing to sell.
    expect(sellAll(state).ok).toBe(false);
  });
});

describe("loan outlook", () => {
  it("projects the payoff the auto-debit actually reaches", () => {
    const state = newGame({ seed: 42 });
    const outlook = loanOutlook(state.loan);
    expect(outlook.installments).toBeGreaterThan(15);
    expect(outlook.installments).toBeLessThan(30);
    expect(outlook.nextInterest).toBeGreaterThan(0);
    state.credits = 10_000_000;
    wait(state, outlook.payoffAt - state.time + DAY);
    expect(state.loan.balance).toBe(0);
    expect(state.stats.loanPaid).toBe(48_000 + outlook.totalInterest);
  });
});

describe("known deposits from orbit", () => {
  it("lists discovered, untapped deposits by region", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const body = world.system("s0").bodies.find((b) => b.regions > 2)!;
    const d = world.region(body.id, 2).deposits[0]!;
    knowledge(state, body.id, 2).discovered.push(d.id);
    const known = knownDeposits(state, world, body.id);
    expect(known).toHaveLength(1);
    expect(known[0]).toMatchObject({ region: 2, key: `2:${d.id}`, commodity: d.commodity });
    knowledge(state, body.id, 2).extracted[d.id] = d.tonnes;
    expect(knownDeposits(state, world, body.id)).toHaveLength(0);
  });
});
