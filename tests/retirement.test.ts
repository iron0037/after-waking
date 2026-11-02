/** AW-206: veterans retire (with turnover on); Longevity, Loyalty and Family Ship. */
import { describe, expect, it } from "vitest";
import { newGame, retirementAge, retirementsOnDocked, yearsToRetirement, levelForXp, xpForLevel, RETIRE_AGE_MIN, RETIRE_AGE_SPAN, type GameState } from "../src/sim";
import { YEAR } from "../src/sim/units";

function veteranGame(turnover = true): GameState {
  const state = newGame({ seed: 42, people: { turnover } as never });
  const m = state.crew!.find((x) => x.station === "engineering")!;
  m.born = state.time - 70 * YEAR;
  m.xp = xpForLevel(8);
  return state;
}

describe("retirement (AW-206)", () => {
  it("each officer has a fixed retirement age in the late fifties or sixties", () => {
    const state = newGame({ seed: 42 });
    for (const m of state.crew!) {
      const age = retirementAge(state, m);
      expect(age).toBeGreaterThanOrEqual(RETIRE_AGE_MIN);
      expect(age).toBeLessThanOrEqual(RETIRE_AGE_MIN + RETIRE_AGE_SPAN);
      expect(retirementAge(state, m)).toBe(age);
    }
  });

  it("a veteran gives a trip's notice, then goes ashore; a volunteer waits for the post", () => {
    const state = veteranGame();
    expect(retirementsOnDocked(state)).toEqual([]);
    const eng = state.crew!.find((x) => x.station === "engineering")!;
    expect(eng.retiringAt).toBe(state.time);
    expect(state.journal.at(-1)!.text).toMatch(/retire when we next dock/);
    state.time += 60 * 24 * 40;
    expect(retirementsOnDocked(state).map((m) => m.id)).toEqual([eng.id]);
    expect(state.crew!.some((x) => x.station === "engineering")).toBe(false);
    expect(state.recruits!.some((r) => r.volunteer && r.station === "engineering")).toBe(true);
  });

  it("Family Ship leaves a protégé at half the level", () => {
    const state = veteranGame();
    const medic = state.crew!.find((x) => x.station === "medical")!;
    medic.perks = ["family-ship"];
    retirementsOnDocked(state);
    state.time += 60 * 24 * 40;
    retirementsOnDocked(state);
    const p = state.crew!.find((x) => x.station === "engineering")!;
    expect(p.id).toMatch(/-p$/);
    expect(levelForXp(p.xp)).toBe(4);
  });

  it("Longevity and Loyalty put it off; with turnover off, nobody retires", () => {
    const state = newGame({ seed: 42 });
    const m = state.crew![0]!;
    const base = retirementAge(state, m);
    state.crew!.find((x) => x.station === "medical")!.perks = ["longevity"];
    state.captain.perks = ["loyalty"];
    expect(retirementAge(state, m)).toBe(base + 7);

    const off = veteranGame(false);
    expect(yearsToRetirement(off, off.crew![0]!)).toBeNull();
    retirementsOnDocked(off);
    off.time += 60 * 24 * 40;
    expect(retirementsOnDocked(off)).toEqual([]);
    expect(off.crew).toHaveLength(5);
  });
});
