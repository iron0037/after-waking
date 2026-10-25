/** Crew happiness and loyalty (AW-100) and the crew's share of the spoils (AW-101). */
import { describe, expect, it } from "vitest";
import {
  awardXp,
  crewAlerts,
  crewBonuses,
  crewCut,
  DAY,
  fold,
  hireRecruit,
  HAPPINESS_BASELINE,
  newGame,
  officerAt,
  sell,
  setCrewShare,
  wait,
  World,
  xpForLevel,
  type GameState,
} from "../src/sim";

function roundTrip(state: GameState, world: World): void {
  wait(state, Math.max(0, state.foldReadyAt - state.time));
  expect(fold(state, world, "s0").ok).toBe(true);
  wait(state, state.foldReadyAt - state.time);
  expect(fold(state, world, "intrepid").ok).toBe(true);
}

describe("crew sentiment", () => {
  it("starts everyone with a mood, and happiness relaxes toward neutral", () => {
    const state = newGame({ seed: 42 });
    for (const m of state.crew!) {
      expect(m.happiness).toBeGreaterThan(0);
      expect(m.loyalty).toBeGreaterThan(0);
    }
    const eng = officerAt(state, "engineering")!;
    eng.happiness = 10;
    state.location = { kind: "space", systemId: "s0", pos: { x: 0, y: 0 }, orbiting: null };
    state.lastDockedAt = state.time;
    wait(state, 30 * DAY);
    expect(eng.happiness!).toBeGreaterThan(10);
    expect(eng.happiness!).toBeLessThan(HAPPINESS_BASELINE);
  });

  it("level-ups cheer the officer", () => {
    const state = newGame({ seed: 42 });
    const nav = officerAt(state, "engineering")!;
    const before = nav.happiness!;
    awardXp(state, "engineering", xpForLevel(2));
    expect(nav.happiness!).toBeGreaterThan(before);
  });

  it("a miserable officer works a level below themselves", () => {
    const state = newGame({ seed: 42 });
    awardXp(state, "engineering", xpForLevel(5));
    const rate = crewBonuses(state).drillRate;
    officerAt(state, "engineering")!.happiness = 5;
    expect(crewBonuses(state).drillRate).toBeLessThan(rate);
  });

  it("someone at the end of their rope gives notice, and leaves a trip later unless things improve", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const med = officerAt(state, "medical")!;
    med.happiness = 5;
    med.loyalty = 5;
    roundTrip(state, world);
    expect(med.noticeAt).toBeDefined();
    expect(officerAt(state, "medical")).not.toBeNull();
    med.happiness = 5;
    med.loyalty = 5;
    roundTrip(state, world);
    expect(officerAt(state, "medical")).toBeNull();
    // The post is empty until someone is signed.
    state.credits = 100_000;
    const recruit = state.recruits!.find((r) => r.station === "medical");
    if (recruit) {
      expect(hireRecruit(state, recruit.id).ok).toBe(true);
      expect(officerAt(state, "medical")).not.toBeNull();
    }
  });

  it("notice is withdrawn if things improve", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const sci = officerAt(state, "science")!;
    sci.happiness = 5;
    sci.loyalty = 5;
    roundTrip(state, world);
    expect(sci.noticeAt).toBeDefined();
    sci.happiness = 90;
    sci.loyalty = 60;
    roundTrip(state, world);
    expect(sci.noticeAt).toBeUndefined();
    expect(officerAt(state, "science")).not.toBeNull();
  });

  it("unpaid wages at docking sour the crew", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    state.credits = 0;
    state.loan.balance = 48_000;
    wait(state, Math.max(0, state.foldReadyAt - state.time));
    expect(fold(state, world, "s0").ok).toBe(true);
    wait(state, state.foldReadyAt - state.time);
    state.credits = 0;
    const before = officerAt(state, "comms")!.loyalty!;
    state.helm = { streak: 0, assists: [0, 0], shunnedUntil: state.time + 1e9 }; // no Helm bail-out in this test
    expect(fold(state, world, "intrepid").ok).toBe(true);
    expect(officerAt(state, "comms")!.loyalty!).toBeLessThan(before);
  });

  it("the crew's share of a sale is paid as bonuses and lifts spirits", () => {
    const a = newGame({ seed: 42 });
    a.ship.cargo.copper = 100;
    const b = structuredClone(a);
    expect(setCrewShare(b, 0.1).ok).toBe(true);
    for (const m of a.crew!) m.happiness = 40;
    for (const m of b.crew!) m.happiness = 40;
    const ra = sell(a, "copper");
    const rb = sell(b, "copper");
    expect(ra.ok && rb.ok).toBe(true);
    expect(b.credits).toBeLessThan(a.credits);
    expect(officerAt(b, "engineering")!.happiness!).toBeGreaterThan(officerAt(a, "engineering")!.happiness!);
  });

  it("crewAlerts lists officers on notice and empty posts; crewCut previews the share", () => {
    const state = newGame({ seed: 42 });
    expect(crewAlerts(state)).toEqual({ onNotice: [], emptyPosts: [] });
    officerAt(state, "comms")!.noticeAt = state.time;
    state.crew = state.crew!.filter((m) => m.station !== "medical");
    const alerts = crewAlerts(state);
    expect(alerts.onNotice.map((m) => m.station)).toEqual(["comms"]);
    expect(alerts.emptyPosts).toEqual(["medical"]);
    expect(crewCut(state, 1000)).toBe(0);
    setCrewShare(state, 0.1);
    expect(crewCut(state, 1000)).toBe(100);
    state.crew = [];
    expect(crewCut(state, 1000)).toBe(0);
  });
});
