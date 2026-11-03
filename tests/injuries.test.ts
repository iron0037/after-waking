/** AW-214: crew injuries, healing, and the race home for a critical one. */
import { describe, expect, it } from "vitest";
import {
  advanceTime,
  battleInjuryChance,
  crewBonuses,
  criticalDays,
  criticalPatient,
  deserialize,
  hasPerk,
  hasTalent,
  injureCrew,
  injuryLine,
  newGame,
  officerAt,
  serialize,
  stationLevel,
  workingLevel,
  xpForLevel,
  type GameState,
} from "../src/sim";
import { DAY } from "../src/sim/units";

function hurt(state: GameState, severity: 1 | 2 | 3, station: "engineering" | "medical" | "science" = "engineering") {
  const weights = [severity === 1 ? 1 : 0, severity === 2 ? 1 : 0, severity === 3 ? 1 : 0] as const;
  return injureCrew(state, { stations: [station], cause: "test", weights })!;
}

function away(): GameState {
  const s = newGame({ seed: 7 });
  s.location = { kind: "deep", pos: { x: 5, y: 5 } };
  for (const m of s.crew!) m.xp = xpForLevel(6);
  return s;
}

describe("crew injuries (AW-214)", () => {
  it("minor costs a level, serious three, critical takes them off duty with their perks and talent", () => {
    const s = away();
    const eng = officerAt(s, "engineering")!;
    eng.perks = ["drill-master"];
    eng.talent = "tank-rigger";
    expect(workingLevel(s, "engineering")).toBe(6);
    hurt(s, 1);
    expect(workingLevel(s, "engineering")).toBe(5);
    eng.injury = undefined;
    hurt(s, 2);
    expect(workingLevel(s, "engineering")).toBe(3);
    expect(hasPerk(s, "drill-master")).toBe(true);
    eng.injury = undefined;
    const before = crewBonuses(s).drillRate;
    hurt(s, 3);
    expect(workingLevel(s, "engineering")).toBe(0);
    expect(crewBonuses(s).drillRate).toBeLessThan(before);
    expect(hasPerk(s, "drill-master")).toBe(false);
    expect(hasTalent(s, "tank-rigger")).toBe(false);
    expect(stationLevel(s, "engineering")).toBe(6); // still their real level
  });

  it("two serious injuries make a critical one; a new injury never softens an old one", () => {
    const s = away();
    hurt(s, 2);
    hurt(s, 1);
    expect(officerAt(s, "engineering")!.injury!.severity).toBe(2);
    hurt(s, 2);
    expect(officerAt(s, "engineering")!.injury!.severity).toBe(3);
  });

  it("wounds heal with time, faster with Stabilize and aboard the Intrepid", () => {
    const heal = (setup: (s: GameState) => void): number => {
      const s = away();
      setup(s);
      hurt(s, 2);
      officerAt(s, "engineering")!.injury!.healDays = 20;
      let days = 0;
      while (officerAt(s, "engineering")!.injury && days < 100) {
        advanceTime(s, DAY);
        days++;
      }
      return days;
    };
    const plain = heal(() => {});
    expect(plain).toBeGreaterThan(5);
    expect(plain).toBeLessThan(30);
    expect(heal((s) => (officerAt(s, "medical")!.perks = ["triage", "hazard-suits", "stabilize"]))).toBeLessThan(plain * 0.6);
    expect(heal((s) => (s.location = { kind: "intrepid" }))).toBeLessThan(plain * 0.6);
  });

  it("a critical patient dies if the ship doesn't reach the Intrepid in time", () => {
    const s = away();
    const name = officerAt(s, "engineering")!.name;
    hurt(s, 3);
    const limit = criticalDays(s);
    expect(limit).toBeGreaterThanOrEqual(30);
    expect(criticalPatient(s)!.member.name).toBe(name);
    expect(injuryLine(s, officerAt(s, "engineering")!)).toMatch(/to reach the Intrepid/);
    advanceTime(s, (limit - 1) * DAY);
    expect(officerAt(s, "engineering")).not.toBeNull();
    advanceTime(s, 2 * DAY);
    expect(officerAt(s, "engineering")).toBeNull();
    expect(s.stats.crewLost).toBe(1);
    expect(s.recruits!.some((r) => r.volunteer && r.station === "engineering")).toBe(true);
    expect(s.journal.some((j) => j.text.includes(`${name} died`))).toBe(true);
  });

  it("docking at the Intrepid stabilizes them", () => {
    const s = away();
    hurt(s, 3);
    advanceTime(s, 10 * DAY);
    s.location = { kind: "intrepid" };
    advanceTime(s, 60);
    expect(officerAt(s, "engineering")!.injury!.severity).toBe(2);
    expect(criticalPatient(s)).toBeNull();
  });

  it("a Surgeon medic operates aboard, but not on themselves", () => {
    const s = away();
    officerAt(s, "medical")!.perks = ["triage", "hazard-suits", "stabilize", "surgeon"];
    hurt(s, 3);
    expect(criticalPatient(s)).toBeNull();
    advanceTime(s, 3 * DAY);
    expect(officerAt(s, "engineering")!.injury!.severity).toBe(2);
    const t = away();
    officerAt(t, "medical")!.perks = ["triage", "hazard-suits", "stabilize", "surgeon"];
    hurt(t, 3, "medical");
    expect(criticalPatient(t)).not.toBeNull();
    advanceTime(t, 3 * DAY);
    expect(officerAt(t, "medical")!.injury!.severity).toBe(3);
  });

  it("Combat Medic lightens battle injuries; harder hits hurt more often", () => {
    const s = away();
    const r = injureCrew(s, { stations: ["engineering"], cause: "test", weights: [1, 0, 0], lighten: 1 });
    expect(r).toBeNull();
    expect(officerAt(s, "engineering")!.injury).toBeUndefined();
    expect(battleInjuryChance(5, 100)).toBeLessThan(battleInjuryChance(25, 100));
    expect(battleInjuryChance(500, 100)).toBeLessThanOrEqual(0.6);
  });

  it("injuries survive a save", () => {
    const s = away();
    hurt(s, 3);
    const back = deserialize(serialize(s));
    expect(back.crew!.find((m) => m.station === "engineering")!.injury!.severity).toBe(3);
  });
});
