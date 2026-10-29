/** Choosing which specimens the Lyceum gets, and keeping those tracked research needs (playtest 10). */
import { describe, expect, it } from "vitest";
import { RESEARCH } from "../src/data/research";
import { newGame, sellSpecimens, specimenHolds, toggleTrackResearch } from "../src/sim";

const drifterProject = RESEARCH.find((p) => p.needs.some((n) => n.kind === "specimens" && n.species === "cloud drifter"))!;

describe("selling specimens", () => {
  it("sells one rack at a time when asked", () => {
    const state = newGame({ seed: 42 });
    state.ship.specimens = { "s0.p1|cloud drifter": 3, "s0.p1|glass reed": 2 };
    expect(sellSpecimens(state, ["s0.p1|glass reed"]).ok).toBe(true);
    expect(state.ship.specimens).toEqual({ "s0.p1|cloud drifter": 3 });
  });

  it("sell-all keeps what a tracked project needs, and only that many", () => {
    const state = newGame({ seed: 42 });
    state.ship.specimens = { "s0.p1|cloud drifter": 3, "s0.p1|glass reed": 2 };
    expect(toggleTrackResearch(state, drifterProject.id).ok).toBe(true);
    const need = drifterProject.needs.find((n) => n.kind === "specimens")!.count;
    const hold = specimenHolds(state).get("s0.p1|cloud drifter")!;
    expect(hold.research).toBe(need);
    expect(hold.projects).toContain(drifterProject.name);
    expect(sellSpecimens(state).ok).toBe(true);
    expect(state.ship.specimens).toEqual({ "s0.p1|cloud drifter": need });
    // Nothing left but the held ones: sell-all has nothing to do; selling the rack by name still works.
    expect(sellSpecimens(state).ok).toBe(false);
    expect(sellSpecimens(state, ["s0.p1|cloud drifter"]).ok).toBe(true);
    expect(state.ship.specimens).toEqual({});
  });

  it("contract samples are never sold, even by name", () => {
    const state = newGame({ seed: 42 });
    state.ship.specimens = { "s0.p1|glass reed": 2 };
    state.contracts = [{ id: "k1", kind: "specimens", status: "active", bodyId: "s0.p1" } as never];
    expect(sellSpecimens(state, ["s0.p1|glass reed"]).ok).toBe(false);
    expect(specimenHolds(state).get("s0.p1|glass reed")?.contract).toBe(true);
  });
});
