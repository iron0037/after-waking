import { describe, expect, it } from "vitest";
import { COMMODITIES, CONC_RATIO } from "../src/data/commodities";
import {
  cargoTonnes,
  completeContract,
  contractProgress,
  newGame,
  refineBlockers,
  refineOre,
  Rng,
  sellableTonnes,
  sellPrice,
  stepMarket,
  type Contract,
  type GameState,
} from "../src/sim";

function inSpace(): GameState {
  const state = newGame({ seed: 9 });
  state.location = { kind: "space", systemId: "s0", pos: { x: 1, y: 0 }, orbiting: null };
  state.ship.upgrades.push("refinery");
  state.ship.cargo = { copper: 50, waterIce: 20 };
  return state;
}

describe("portable refinery (AW-18)", () => {
  it("needs the refinery, and doesn't run at the Intrepid or on water ice", () => {
    const state = inSpace();
    state.ship.upgrades = [];
    expect(refineOre(state, "copper").ok).toBe(false);
    state.ship.upgrades.push("refinery");
    expect(refineBlockers(state, "waterIce").length).toBeGreaterThan(0);
    state.location = { kind: "intrepid" };
    expect(refineOre(state, "copper").ok).toBe(false);
  });

  it("turns 2.5 t of ore into 1 t of concentrate, freeing hold space, and takes crew hours", () => {
    const state = inSpace();
    const t0 = state.time;
    const before = cargoTonnes(state.ship.cargo);
    const r = refineOre(state, "copper");
    expect(r.ok).toBe(true);
    expect(state.ship.cargo.copper ?? 0).toBe(0);
    expect(state.ship.cargo.copperConc).toBeCloseTo(50 / CONC_RATIO, 2);
    expect(cargoTonnes(state.ship.cargo)).toBeCloseTo(before - 50 + 20, 1);
    expect((state.time - t0) / 60).toBeCloseTo((50 / 4) * 1.5, 1);
  });

  it("concentrate is worth 10% more than its ore, and its price follows the ore's market", () => {
    const state = inSpace();
    expect(COMMODITIES.copperConc.basePrice).toBe(Math.round(COMMODITIES.copper.basePrice * 2.75));
    stepMarket(state.market, new Rng(3), state.market.day + 40);
    expect(state.market.mult.copperConc).toBe(state.market.mult.copper);
    const ratio = sellPrice(state.market, "copperConc") / sellPrice(state.market, "copper");
    expect(ratio).toBeGreaterThan(2.6);
    expect(ratio).toBeLessThan(2.9);
  });

  it("delivery contracts take concentrate at its ore equivalent", () => {
    const state = inSpace();
    refineOre(state, "copper", 40); // 16 t concentrate, 10 t raw left
    const c: Contract = {
      id: "t1", clan: "diggers", kind: "deliver", title: "Copper run", text: "", reward: 5000,
      durationDays: 60, deadline: state.time + 60 * 1440, status: "active", commodity: "copper", tonnes: 30,
    };
    state.contracts = [c];
    expect(contractProgress(state, c).ready).toBe(true);
    // 10 t raw covers part of it; the rest (20 t) is held back from the 16 t of concentrate.
    expect(sellableTonnes(state, "copperConc")).toBeCloseTo(16 - 20 / CONC_RATIO, 2);
    state.location = { kind: "intrepid" };
    expect(completeContract(state, "t1").ok).toBe(true);
    expect(state.ship.cargo.copper ?? 0).toBe(0);
    expect(state.ship.cargo.copperConc).toBeCloseTo(16 - 8, 1);
  });
});
