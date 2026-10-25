import { describe, expect, it } from "vitest";
import { acceptContract, burnPath, newGame, officerAt, starKeepOut } from "../src/sim";

describe("burns go around the star, not through it", () => {
  it("flies straight when the line is clear", () => {
    const p = burnPath({ x: 1, y: 0 }, { x: 1, y: 2 });
    expect(p.bends).toBe(false);
    expect(p.length).toBeCloseTo(2, 9);
  });

  it("swings around the star when the line would cross it, and never comes inside the keep-out", () => {
    const from = { x: -1.5, y: 0.02 };
    const to = { x: 2, y: -0.05 };
    const p = burnPath(from, to);
    const r = starKeepOut(from, to);
    expect(p.bends).toBe(true);
    expect(p.length).toBeGreaterThan(Math.hypot(to.x - from.x, to.y - from.y));
    expect(p.length).toBeLessThan(Math.hypot(to.x - from.x, to.y - from.y) + Math.PI * r);
    const a = p.at(0);
    const b = p.at(1);
    expect(a.x).toBeCloseTo(from.x, 9);
    expect(b.y).toBeCloseTo(to.y, 9);
    for (let i = 0; i <= 200; i++) {
      const q = p.at(i / 200);
      expect(Math.hypot(q.x, q.y)).toBeGreaterThan(r - 1e-9);
    }
    // The path is continuous: no jumps between samples.
    for (let i = 0; i < 200; i++) {
      const q1 = p.at(i / 200);
      const q2 = p.at((i + 1) / 200);
      expect(Math.hypot(q2.x - q1.x, q2.y - q1.y)).toBeLessThan((p.length / 200) * 1.01);
    }
  });
});

describe("contract experience", () => {
  it("comes when the job is done, not when it's signed", () => {
    const state = newGame({ seed: 7 });
    const offer = state.contracts!.find((c) => c.status === "offered")!;
    const before = officerAt(state, "comms")?.xp ?? 0;
    expect(acceptContract(state, offer.id).ok).toBe(true);
    expect(officerAt(state, "comms")?.xp ?? 0).toBe(before);
  });
});
