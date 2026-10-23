/** Balance pass (AW-37): refits, parallel yard work, and the ways back from a bad run. */
import { describe, expect, it } from "vitest";
import {
  advanceTime,
  buyFuelOnCredit,
  buyUpgrade,
  dailyUpkeep,
  DAY,
  departureReadyAt,
  fold,
  foldPlan,
  fuelCreditAvailable,
  LIFELINE_FUEL,
  newGame,
  retrain,
  rushRefit,
  takePerk,
  awardXp,
  xpForLevel,
  wait,
  World,
} from "../src/sim";

describe("fold-drive refit", () => {
  it("is a refit after each fold, sped up by the yard for a price", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    expect(state.foldReadyAt).toBeGreaterThan(state.time + 3 * DAY);
    expect(foldPlan(state, world, "intrepid").blockers.some((b) => b.startsWith("Fold drive refit"))).toBe(true);
    // Back at the Intrepid, rush crews can shave the wait.
    wait(state, state.foldReadyAt - state.time);
    expect(fold(state, world, "intrepid").ok).toBe(true);
    state.credits = 50_000;
    const before = state.foldReadyAt;
    const r = rushRefit(state, 2);
    expect(r.ok).toBe(true);
    expect(state.foldReadyAt).toBe(before - 2 * DAY);
    expect(state.credits).toBeLessThan(50_000);
  });
});

describe("yard work runs in parallel", () => {
  it("installs queue in one bay, courses run alongside, and departure waits for the longest", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.credits = 200_000;
    awardXp(state, "science", xpForLevel(4));
    expect(takePerk(state, "science", "seam-sense").ok).toBe(true);
    const t0 = state.time;
    expect(buyUpgrade(state, "roverSled").ok).toBe(true);
    expect(buyUpgrade(state, "roverCells").ok).toBe(true);
    expect(retrain(state, "science").ok).toBe(true);
    expect(state.time).toBe(t0); // nothing advanced the clock
    const ready = departureReadyAt(state);
    expect(ready - t0).toBeGreaterThanOrEqual(14 * DAY); // the course is the longest item
    expect(fold(state, world, "s0").ok).toBe(false);
    wait(state, ready - state.time);
    expect(state.ship.upgrades).toEqual(expect.arrayContaining(["roverSled", "roverCells"]));
    expect(fold(state, world, "s0").ok).toBe(true);
  });
});

describe("ways back from a bad run", () => {
  it("defers one missed installment a year, then counts misses", () => {
    const state = newGame({ seed: 42 });
    state.credits = 0;
    state.ship.upgrades = [];
    advanceTime(state, 61 * DAY);
    state.credits = 0;
    expect(state.loan.missed).toBe(0);
    expect(state.loan.graceAt).toBeDefined();
    advanceTime(state, 60 * DAY);
    state.credits = 0;
    advanceTime(state, 1);
    expect(state.loan.missed).toBe(1);
  });

  it("the Exchange always tops the tanks up to a lifeline, whatever the note", () => {
    const state = newGame({ seed: 42 });
    state.ship.fuel = 0;
    state.credits = 0;
    state.loan.balance = 500_000; // far past the credit limit
    expect(fuelCreditAvailable(state)).toBe(LIFELINE_FUEL);
    expect(buyFuelOnCredit(state, 999).ok).toBe(true);
    expect(state.ship.fuel).toBe(LIFELINE_FUEL);
  });

  it("Helm always has survey work on the board", () => {
    const state = newGame({ seed: 42 });
    advanceTime(state, 90 * DAY);
    expect(state.contracts.some((c) => c.kind === "survey" && !c.starter && c.status === "offered")).toBe(true);
  });

  it("charges upkeep on installed equipment", () => {
    const state = newGame({ seed: 42 });
    expect(dailyUpkeep(state)).toBe(0);
    state.ship.upgrades = ["expandedHold"];
    expect(dailyUpkeep(state)).toBeGreaterThan(0);
  });
});
