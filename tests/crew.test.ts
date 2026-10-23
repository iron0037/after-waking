/** Crew roster, experience, levels, wages and the hiring hall (AW-14, slice 1). */
import { describe, expect, it } from "vitest";
import { OFFICER_STATIONS } from "../src/data/crew";
import {
  awardXp,
  crewBonuses,
  dailyWages,
  deserialize,
  fold,
  foldPlan,
  hireRecruit,
  levelForXp,
  newGame,
  officerAt,
  RECRUIT_POOL_DAYS,
  serialize,
  stationLevel,
  wait,
  wageOf,
  World,
  xpForLevel,
  DAY,
} from "../src/sim";
import { runBot } from "../src/sim/bot";

describe("crew roster", () => {
  it("starts with five green officers, one per station, and a hiring hall", () => {
    const state = newGame({ seed: 42 });
    expect(state.crew).toHaveLength(5);
    expect(new Set(state.crew!.map((m) => m.station))).toEqual(new Set(OFFICER_STATIONS));
    for (const s of OFFICER_STATIONS) expect(stationLevel(state, s)).toBe(1);
    expect(stationLevel(state, "captain")).toBe(1);
    expect(dailyWages(state)).toBeGreaterThan(110);
    expect(dailyWages(state)).toBeLessThan(170);
    expect(state.recruits!.length).toBeGreaterThan(0);
  });

  it("has a level curve that round-trips", () => {
    for (let l = 1; l <= 10; l++) expect(levelForXp(xpForLevel(l))).toBe(l);
    expect(levelForXp(xpForLevel(2) - 1)).toBe(1);
    expect(levelForXp(1e9)).toBe(10);
  });

  it("levels up from work, raises wages, and logs it", () => {
    const state = newGame({ seed: 42 });
    const eng = officerAt(state, "engineering")!;
    const wage = wageOf(eng);
    const rate = crewBonuses(state).drillRate;
    awardXp(state, "engineering", xpForLevel(5));
    expect(stationLevel(state, "engineering")).toBeGreaterThanOrEqual(5);
    expect(wageOf(eng)).toBeGreaterThan(wage);
    expect(crewBonuses(state).drillRate).toBeGreaterThan(rate);
    expect(state.journal.at(-1)!.text).toMatch(/reached level/);
  });

  it("a skilled navigator saves fold fuel; a skilled engineer shortens the refit", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    const before = foldPlan(state, world, "s0");
    awardXp(state, "navigation", xpForLevel(10));
    awardXp(state, "engineering", xpForLevel(10));
    const after = foldPlan(state, world, "s0");
    expect(after.fuel).toBeLessThan(before.fuel);
    expect(after.refitMinutes).toBeLessThan(before.refitMinutes);
    expect(fold(state, world, "s0").ok).toBe(true);
  });
});

describe("hiring hall", () => {
  it("signs a recruit in place of the current officer, for a fee", () => {
    const state = newGame({ seed: 7 });
    state.credits = 100_000;
    const r = state.recruits![0]!;
    const old = officerAt(state, r.station)!;
    const res = hireRecruit(state, r.id);
    expect(res.ok).toBe(true);
    expect(officerAt(state, r.station)!.id).toBe(r.id);
    expect(state.crew!.some((m) => m.id === old.id)).toBe(false);
    expect(state.crew).toHaveLength(5);
    expect(state.credits).toBe(100_000 - r.fee);
    expect(state.recruits!.some((x) => x.id === r.id)).toBe(false);
  });

  it("only hires aboard the Intrepid, and the pool turns over monthly", () => {
    const world = new World(7);
    const state = newGame({ seed: 7 });
    const first = state.recruits!.map((r) => r.id);
    expect(fold(state, world, "s0").ok).toBe(true);
    expect(hireRecruit(state, first[0]!).ok).toBe(false);
    wait(state, RECRUIT_POOL_DAYS * DAY);
    expect(state.recruits!.map((r) => r.id)).not.toEqual(first);
  });

  it("gives older saves a crew on load", () => {
    const state = newGame({ seed: 42 });
    delete state.crew;
    delete state.recruits;
    delete state.nextRecruitsAt;
    delete state.captain.xp;
    const loaded = deserialize(serialize(state));
    expect(loaded.crew).toHaveLength(5);
    expect(loaded.recruits!.length).toBeGreaterThan(0);
    expect(loaded.captain.xp).toBe(0);
  });
});

describe("pacing", () => {
  it("officers gain a few levels over ten trips, not the whole ladder", () => {
    const report = runBot(42, 10);
    const levels = Object.fromEntries(["captain", ...OFFICER_STATIONS].map((s) => [s, stationLevel(report.state, s as never)]));
    console.log("levels after 10 trips:", levels, "wages/day:", dailyWages(report.state));
    for (const l of Object.values(levels)) expect(l).toBeLessThanOrEqual(7);
    expect(Math.max(...Object.values(levels))).toBeGreaterThanOrEqual(2);
  });
});
