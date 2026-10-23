/** Helm's Small Operators' Fund: help for struggling small captains, with strings attached. */
import { describe, expect, it } from "vitest";
import {
  callForRescue,
  DAY,
  fold,
  HELM_ASSISTS_PER_YEAR,
  HELM_OBLIGATION_DAYS,
  helmStatus,
  netWorth,
  newGame,
  wait,
  World,
  type GameState,
} from "../src/sim";

/** Fly out to Vasquez and back, losing `loss` credits along the way. */
function trip(state: GameState, world: World, loss: number): void {
  wait(state, Math.max(0, state.foldReadyAt - state.time));
  expect(fold(state, world, "s0").ok).toBe(true);
  state.credits = Math.max(0, state.credits - loss);
  wait(state, state.foldReadyAt - state.time);
  expect(fold(state, world, "intrepid").ok).toBe(true);
}

describe("Helm's Small Operators' Fund", () => {
  it("steps in after two losing trips: stipend, fuel, refit, and a survey to fly in return", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    trip(state, world, 1_000);
    expect(state.helm!.assists).toHaveLength(0);
    const credits = state.credits;
    trip(state, world, 1_000);
    expect(state.helm!.assists).toHaveLength(1);
    expect(state.ship.fuel).toBe(60);
    expect(state.credits).toBeGreaterThan(credits - 1_000);
    expect(state.time).toBeGreaterThanOrEqual(state.foldReadyAt);
    const ask = state.contracts.find((c) => c.obligation);
    expect(ask?.status).toBe("active");
    expect(ask!.deadline! - state.time).toBeLessThanOrEqual(HELM_OBLIGATION_DAYS * DAY);
  });

  it("is for small operators only, and capped per year", () => {
    const state = newGame({ seed: 42 });
    state.credits = 500_000;
    expect(netWorth(state)).toBeGreaterThan(60_000);
    expect(helmStatus(state).eligible).toBe(false);
    state.credits = 0;
    state.helm = { streak: 0, assists: Array.from({ length: HELM_ASSISTS_PER_YEAR }, () => state.time) };
    expect(helmStatus(state).eligible).toBe(false);
    wait(state, 366 * DAY);
    expect(helmStatus(state).eligible).toBe(true);
  });

  it("pays a small operator's first distress call", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    state.ship.fuel = 0.5;
    const note = state.loan.balance;
    const r = callForRescue(state, world);
    expect(r.ok && r.value.cost).toBe(0);
    expect(state.loan.balance).toBe(note);
    // The second one is on the captain.
    state.ship.fuel = 0.5;
    const r2 = callForRescue(state, world);
    expect(r2.ok && r2.value.cost).toBeGreaterThan(0);
  });

  it("shuns a captain who skips the survey it asked for", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    trip(state, world, 1_000);
    trip(state, world, 1_000);
    expect(state.contracts.some((c) => c.obligation && c.status === "active")).toBe(true);
    wait(state, (HELM_OBLIGATION_DAYS + 1) * DAY);
    trip(state, world, 0); // docking is when Helm takes note
    expect(helmStatus(state).eligible).toBe(false);
    expect(state.helm!.shunnedUntil).toBeGreaterThan(state.time);
  });
});
