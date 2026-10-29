import { describe, expect, it } from "vitest";
import { deserialize, gasDeliveryContract, gasDeliveryReward, newGame, Rng, serialize } from "../src/sim";

describe("gas delivery jobs (AW-157)", () => {
  it("are sized to a few probe dives and pay for them", () => {
    const rng = new Rng(4);
    for (let i = 0; i < 200; i++) {
      const c = gasDeliveryContract(rng, i);
      expect(c.tonnes).toBeLessThanOrEqual(6);
      // At least ~600 cr a tonne once the goods and dive fee are counted, even for methane.
      expect(c.reward / (c.tonnes ?? 1)).toBeGreaterThan(600);
    }
    expect(gasDeliveryReward("methane", 6)).toBeGreaterThan(3500);
  });

  it("old saves' oversized methane jobs shrink to 6 t", () => {
    const state = newGame({ seed: 3 });
    state.contracts.push({
      id: "gas-x", clan: "diggers", kind: "deliver", title: "Diggers: 36 t of methane", text: "", commodity: "methane",
      tonnes: 36, reward: 1950, durationDays: 200, deadline: null, status: "active",
    });
    const loaded = deserialize(serialize(state));
    const c = loaded.contracts.find((x) => x.id === "gas-x")!;
    expect(c.tonnes).toBe(6);
    expect(c.title).toBe("Diggers: 6 t of methane");
    expect(c.reward).toBeGreaterThanOrEqual(gasDeliveryReward("methane", 6));
  });
});
