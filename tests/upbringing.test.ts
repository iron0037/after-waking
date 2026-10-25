import { describe, expect, it } from "vitest";
import { awardXp, newGame, officerAt, tickRecruits, tickSentiment, upbringingOf, YEAR, DAY } from "../src/sim";

describe("upbringing (AW-14)", () => {
  it("follows from birth relative to the Waking", () => {
    expect(upbringingOf({ id: "a", name: "A", born: -20 * YEAR })).toBe("earth");
    expect(upbringingOf({ id: "a", name: "A", born: -10 * YEAR })).toBe("cryoChild");
    expect(["decks", "settlement"]).toContain(upbringingOf({ id: "a", name: "A", born: 2 * YEAR }));
  });

  it("all four turn up among recruits", () => {
    const seen = new Set<string>();
    const state = newGame({ seed: 11 });
    for (let i = 0; i < 80; i++) {
      state.time += 31 * DAY;
      state.nextRecruitsAt = 0;
      tickRecruits(state);
      for (const r of state.recruits ?? []) seen.add(upbringingOf(r));
    }
    expect([...seen].sort()).toEqual(["cryoChild", "decks", "earth", "settlement"]);
  });

  it("cryo-children learn 10% faster", () => {
    const state = newGame({ seed: 3 });
    const m = officerAt(state, "science")!;
    m.born = -10 * YEAR;
    m.xp = 0;
    awardXp(state, "science", 10);
    const cryo = m.xp;
    m.born = 5 * YEAR;
    m.id = "x-decks";
    while (upbringingOf(m) !== "decks") m.id += "!";
    m.xp = 0;
    awardXp(state, "science", 10);
    expect(cryo / m.xp).toBeCloseTo(1.1, 5);
  });

  it("those who remember Earth lose loyalty half as fast", () => {
    const state = newGame({ seed: 3 });
    state.location = { kind: "space", systemId: "s0", pos: { x: 1, y: 0 }, orbiting: null };
    const [a, b] = [officerAt(state, "science")!, officerAt(state, "medical")!];
    a.born = -40 * YEAR;
    b.born = 1 * YEAR;
    b.id = "x";
    while (upbringingOf(b) !== "decks") b.id += "!";
    for (const m of [a, b]) {
      m.happiness = 10;
      m.loyalty = 60;
    }
    tickSentiment(state, 0.1 * DAY);
    expect(60 - a.loyalty!).toBeCloseTo((60 - b.loyalty!) / 2, 5);
  });
});
