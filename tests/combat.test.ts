import { describe, expect, it } from "vitest";
import {
  advanceTime,
  answerHail,
  cargoTonnes,
  combatTurn,
  DAY,
  driveDamageMult,
  fold,
  hailOdds,
  interdictionChance,
  maybeInterdict,
  newGame,
  playerSide,
  repairQuote,
  repairShip,
  World,
  type GameState,
  type Orders,
} from "../src/sim";

const SEED = 42;

function laden(world: World, charted: boolean): { state: GameState; systemId: string } {
  const sys = world.galaxy.systems.find((s) => !s.home && s.charted === charted)!;
  const state = newGame({ seed: SEED });
  state.location = { kind: "space", systemId: sys.id, pos: { x: 40, y: 0 }, orbiting: null };
  state.ship.cargo = { platinum: 40, copper: 60 };
  return { state, systemId: sys.id };
}

/** Roll departures until a raider hails (deterministic for a seed). */
function hailed(world: World, charted = false): GameState {
  for (let i = 0; i < 200; i++) {
    const { state, systemId } = laden(world, charted);
    state.rngState = (SEED * 7919 + i) >>> 0;
    if (maybeInterdict(state, world, systemId)) return state;
  }
  throw new Error("no raider in 200 departures");
}

describe("pirates (combat v1)", () => {
  it("never at the home stars or with an empty hold; likelier with a rich hold in uncharted space", () => {
    const world = new World(SEED);
    const home = world.galaxy.systems.find((s) => s.home)!;
    const { state } = laden(world, false);
    expect(interdictionChance(state, world, home.id)).toBe(0);
    const unchartedId = world.galaxy.systems.find((s) => !s.home && !s.charted)!.id;
    const chartedId = world.galaxy.systems.find((s) => !s.home && s.charted)!.id;
    expect(interdictionChance(state, world, unchartedId)).toBeGreaterThan(interdictionChance(state, world, chartedId));
    state.ship.cargo = {};
    expect(interdictionChance(state, world, unchartedId)).toBe(0);
  });

  it("rolls once per departure, and blocks folding until it's settled", () => {
    const world = new World(SEED);
    const state = hailed(world);
    expect(state.encounter?.stage).toBe("hail");
    expect(maybeInterdict(state, world, state.encounter!.systemId)).toBeNull();
    expect(fold(state, world, "intrepid").ok).toBe(false);
  });

  it("paying hands over the demanded share and ends it", () => {
    const world = new World(SEED);
    const state = hailed(world);
    const before = cargoTonnes(state.ship.cargo);
    const demand = state.encounter!.demand;
    const r = answerHail(state, "pay");
    expect(r.ok).toBe(true);
    expect(state.encounter).toBeUndefined();
    expect(cargoTonnes(state.ship.cargo)).toBeCloseTo(before * (1 - demand), 0);
    expect(state.lastEncounter?.outcome).toBe("paid");
  });

  it("has sensible odds for talking and running", () => {
    const world = new World(SEED);
    const state = hailed(world);
    const odds = hailOdds(state);
    for (const p of [odds.talk, odds.run]) {
      expect(p).toBeGreaterThan(0.04);
      expect(p).toBeLessThan(0.95);
    }
  });

  it("a well-armed ship beats a raider and collects the bounty", () => {
    const world = new World(SEED);
    let wins = 0;
    for (let i = 0; i < 10; i++) {
      const state = hailed(world, true);
      state.rngState = (state.rngState + i * 101) >>> 0;
      state.ship.upgrades.push("laserBattery", "kineticBattery", "deflectors", "armorPlate");
      answerHail(state, "fight");
      const orders: Orders = { helm: "close", guns: "hull", engineering: "guns", comms: "demand" };
      const credits = state.credits;
      for (let t = 0; t < 25 && state.encounter; t++) combatTurn(state, orders);
      expect(state.encounter).toBeUndefined();
      if (state.lastEncounter?.outcome === "won") {
        wins++;
        expect(state.credits).toBeGreaterThan(credits);
      }
    }
    expect(wins).toBeGreaterThanOrEqual(7);
  });

  it("striking your colours costs most of the hold but nothing else", () => {
    const world = new World(SEED);
    const state = hailed(world);
    answerHail(state, "fight");
    const credits = state.credits;
    const before = cargoTonnes(state.ship.cargo);
    const r = combatTurn(state, { helm: "hold", guns: "hold", engineering: "repair", comms: "strike" });
    expect(r.ok).toBe(true);
    expect(state.lastEncounter?.outcome).toBe("surrendered");
    expect(cargoTonnes(state.ship.cargo)).toBeCloseTo(before * 0.3, 0);
    expect(state.credits).toBe(credits);
  });

  it("is deterministic for the same state", () => {
    const world = new World(SEED);
    const a = hailed(world);
    const b = structuredClone(a);
    answerHail(a, "fight");
    answerHail(b, "fight");
    const o: Orders = { helm: "evade", guns: "drives", engineering: "shields", comms: "quiet" };
    for (let t = 0; t < 5 && a.encounter; t++) {
      combatTurn(a, o);
      combatTurn(b, o);
    }
    expect(a.ship.damage).toEqual(b.ship.damage);
    expect(a.encounter?.enemy).toEqual(b.encounter?.enemy);
  });

  it("battle damage slows the ship until the yard repairs it", () => {
    const state = newGame({ seed: SEED });
    state.ship.damage = { hull: 30, drives: 50, weapons: 20, sensors: 0 };
    expect(driveDamageMult(state)).toBeCloseTo(1.5);
    expect(playerSide(state).hull).toBe(70);
    const q = repairQuote(state)!;
    expect(q.cost).toBeGreaterThan(0);
    state.credits = 100_000;
    expect(repairShip(state).ok).toBe(true);
    advanceTime(state, (q.days + 0.1) * DAY);
    expect(state.ship.damage).toBeUndefined();
  });
});
