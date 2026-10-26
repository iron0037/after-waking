import { describe, expect, it } from "vitest";
import { BASE_STATS } from "../src/data/ship";
import { cargoTonnes, flyTo, fold, hexDistance, jettisonCargo, knowledge, land, landingAccess, newGame, workDeposit, World, type GameState } from "../src/sim";

function landNearBigDeposit(seed: number): { state: GameState; world: World; key: string } {
  const world = new World(seed);
  const state = newGame({ seed });
  expect(fold(state, world, "s0").ok).toBe(true);
  for (const body of world.system("s0").bodies.filter((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)) {
    if (!flyTo(state, world, { bodyId: body.id }).ok) continue;
    const surface = world.surface(body.id);
    for (let region = 0; region < body.regions; region++) {
      const landing = surface.landing(region);
      const d = surface.deposits(region).find((x) => x.depthM <= BASE_STATS.drillMaxDepthM && x.tonnes > 60 && hexDistance(x, landing) < 12);
      if (!d) continue;
      expect(land(state, world, region).ok).toBe(true);
      knowledge(state, body.id, region).discovered.push(d.id);
      return { state, world, key: d.key };
    }
  }
  throw new Error("no deposit");
}

describe("playtest 11", () => {
  it("auto-work can stop at a chosen amount", () => {
    const { state, world, key } = landNearBigDeposit(42);
    const before = cargoTonnes(state.ship.cargo);
    const r = workDeposit(state, world, key, 25);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const hauled = cargoTonnes(state.ship.cargo) - before;
    expect(hauled).toBeGreaterThan(20);
    expect(hauled).toBeLessThan(28);
    expect(["target reached", "deposit depleted"]).toContain(r.value.stop);
  });

  it("cargo can be jettisoned away from the Intrepid, but not while docked", () => {
    const state = newGame({ seed: 3 });
    state.ship.cargo = { waterIce: 120, copper: 10 };
    expect(jettisonCargo(state, "waterIce", 50).ok).toBe(false);
    state.location = { kind: "space", systemId: "s0", pos: { x: 1, y: 0 }, orbiting: null };
    expect(jettisonCargo(state, "waterIce", 50).ok).toBe(true);
    expect(state.ship.cargo.waterIce).toBeCloseTo(70);
    expect(jettisonCargo(state, "waterIce").ok).toBe(true);
    expect(state.ship.cargo.waterIce).toBeUndefined();
    expect(state.ship.cargo.copper).toBe(10);
  });
});
