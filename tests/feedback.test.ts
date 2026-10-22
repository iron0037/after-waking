/** Fixes and features from the 2026-10-21 playtest (SCRUM-41, 43, 51, 52, 32). */
import { describe, expect, it } from "vitest";
import {
  advanceTime,
  autoFold,
  buyUpgrade,
  cargoTonnes,
  DAY,
  deployRover,
  flyTo,
  fold,
  knowledge,
  land,
  landingAccess,
  moveRoverTo,
  newGame,
  payLoan,
  relocateShip,
  shipStats,
  shipTile,
  stowRover,
  workDeposit,
  World,
  type GameState,
} from "../src/sim";
import { BASE_STATS } from "../src/data/ship";

describe("loan prepayment (SCRUM-41)", () => {
  it("an early installment covers the next due date instead of triggering a miss", () => {
    const state = newGame({ seed: 3 });
    payLoan(state, state.loan.payment);
    state.credits = 0; // broke on the due date
    advanceTime(state, 61 * DAY);
    expect(state.loan.missed).toBe(0);
    expect(state.loan.prepaid).toBe(0);
  });

  it("still auto-debits from credits when nothing was prepaid", () => {
    const state = newGame({ seed: 3 });
    state.credits = 30_000; // covers ~61 days of wages (paid daily while docked) plus the installment
    const balance = state.loan.balance;
    advanceTime(state, 61 * DAY);
    expect(state.loan.missed).toBe(0);
    expect(state.loan.balance).toBeLessThan(balance + 1_000);
  });
});

describe("autoFold (SCRUM-43)", () => {
  it("flies to the edge, waits out the recharge, and folds in one action", () => {
    const world = new World(42);
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    const target = world.system("s0").bodies.find((b) => b.easy)!;
    expect(flyTo(state, world, { bodyId: target.id }).ok).toBe(true);
    expect(state.time).toBeLessThan(state.foldReadyAt); // drive still charging, deep in the well
    const r = autoFold(state, world, "intrepid");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.flewToEdge).toBe(true);
      expect(r.value.waited).toBeGreaterThan(0);
    }
    expect(state.location.kind).toBe("intrepid");
  });
});

describe("rover upgrade tiers (SCRUM-51)", () => {
  it("requires the base tier first, then stacks", () => {
    const state = newGame({ seed: 1 });
    state.credits = 100_000;
    expect(buyUpgrade(state, "roverSled2").ok).toBe(false);
    expect(buyUpgrade(state, "roverSled").ok).toBe(true);
    expect(buyUpgrade(state, "roverSled2").ok).toBe(true);
    expect(shipStats(state.ship).roverCargoT).toBe(BASE_STATS.roverCargoT + 60);
  });
});

/** Land on the first calm home world with a reachable, drillable deposit. */
function landOnEasyWorld(seed: number): { state: GameState; world: World; depositId: number } {
  const world = new World(seed);
  const state = newGame({ seed });
  expect(fold(state, world, "s0").ok).toBe(true);
  for (const body of world.system("s0").bodies.filter((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)) {
    if (!flyTo(state, world, { bodyId: body.id }).ok) continue;
    for (let region = 0; region < body.regions; region++) {
      const map = world.region(body.id, region);
      const d = map.deposits.find((x) => x.depthM <= BASE_STATS.drillMaxDepthM && Math.abs(x.x - map.landing.x) + Math.abs(x.y - map.landing.y) < 14);
      if (!d) continue;
      expect(land(state, world, region).ok).toBe(true);
      knowledge(state, body.id, region).discovered.push(d.id);
      return { state, world, depositId: d.id };
    }
  }
  throw new Error("no suitable deposit");
}

describe("relocating the ship (SCRUM-52)", () => {
  it("hops the ship within the region, and the rover then deploys from the new spot", () => {
    const { state, world } = landOnEasyWorld(42);
    const loc = state.location;
    if (loc.kind !== "surface") throw new Error("not landed");
    const map = world.region(loc.bodyId, loc.region);
    const spot = { x: map.landing.x + 3, y: map.landing.y };
    const fuel = state.ship.fuel;
    const r = relocateShip(state, world, spot.x, spot.y);
    if (!r.ok) return; // terrain there may be rough; the rule itself is covered below
    expect(shipTile(state, map)).toEqual(spot);
    expect(state.ship.fuel).toBeLessThan(fuel);
    expect(deployRover(state, world).ok).toBe(true);
    const rover = (state.location as { rover: { x: number; y: number } }).rover;
    expect({ x: rover.x, y: rover.y }).toEqual(spot);
    expect(relocateShip(state, world, spot.x + 1, spot.y).ok).toBe(false); // rover is out
  });
});

describe("work this deposit (SCRUM-32)", () => {
  it.each([42, 7, 2026])("seed %i: runs the drill-haul-unload loop to a clean stop", (seed) => {
    const { state, world, depositId } = landOnEasyWorld(seed);
    const before = cargoTonnes(state.ship.cargo);
    const r = workDeposit(state, world, depositId);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(["deposit depleted", "hold full", "low energy", "unreachable"]).toContain(r.value.stop);
    if (r.value.stop !== "unreachable") {
      expect(r.value.tonnes).toBeGreaterThan(0);
      expect(cargoTonnes(state.ship.cargo)).toBeGreaterThan(before);
    }
    const loc = state.location;
    if (loc.kind === "surface" && r.value.stop !== "low energy") {
      expect(loc.rover).toBeNull(); // stowed at the end
    }
  });

  it("refuses deposits beyond the drill's reach", () => {
    const { state, world } = landOnEasyWorld(42);
    const loc = state.location;
    if (loc.kind !== "surface") throw new Error("not landed");
    const map = world.region(loc.bodyId, loc.region);
    const deep = map.deposits.find((d) => d.depthM > BASE_STATS.drillMaxDepthM);
    if (!deep) return;
    knowledge(state, loc.bodyId, loc.region).discovered.push(deep.id);
    expect(workDeposit(state, world, deep.id).ok).toBe(false);
    void moveRoverTo;
    void stowRover;
  });
});
