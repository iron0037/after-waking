/** AW-208: a burn aims where its target will be when the ship actually arrives. */
import { describe, expect, it } from "vitest";
import { bodyPosition, dist, flightPlan, newGame, World } from "../src/sim";

describe("flight lead (AW-208)", () => {
  it("the aim point is the target's position at the real arrival time, speed-ups included", () => {
    const world = new World(42);
    for (const sys of world.galaxy.systems.slice(0, 8)) {
      const detail = world.system(sys.id);
      const moon = detail.bodies.find((b) => b.parentId !== null);
      if (!moon) continue;
      for (const perks of [[], ["gravity-assist"]]) {
        const state = newGame({ seed: 42 });
        state.location = { kind: "space", systemId: sys.id, pos: { x: detail.edgeAU, y: 0 }, orbiting: null };
        state.crew!.find((m) => m.station === "navigation")!.perks = perks;
        const plan = flightPlan(state, world, { bodyId: moon.id });
        if (!plan.ok) throw new Error(plan.reason);
        const there = bodyPosition(detail, moon, state.time + plan.value.minutes);
        expect(dist(plan.value.arrival, there)).toBeLessThan(moon.orbitAU * 0.02);
      }
      return;
    }
    throw new Error("no moon found");
  });
});
