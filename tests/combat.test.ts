import { describe, expect, it } from "vitest";
import {
  advanceTime,
  answerHail,
  cargoTonnes,
  claimPrize,
  combatTurn,
  DAY,
  driveDamageMult,
  fold,
  hailOdds,
  interdictionChance,
  maybeInterdict,
  newGame,
  orderAdvice,
  playerSide,
  raiderById,
  sidePower,
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
      for (let t = 0; t < 25 && state.encounter?.stage === "battle"; t++) combatTurn(state, orders);
      if (state.encounter?.stage === "prize") expect(claimPrize(state, "turnIn").ok).toBe(true);
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

describe("order advice (UI hints)", () => {
  it("flags orders that would be wasted", () => {
    const world = new World(SEED);
    const state = hailed(world);
    expect(orderAdvice(state).helm).toEqual({}); // no battle yet
    answerHail(state, "fight");
    let a = orderAdvice(state);
    expect(a.engineering.repair).toBeDefined(); // undamaged
    expect(a.engineering.shields).toBeDefined(); // stock ship has no deflectors
    expect(a.guns.hull).toBeUndefined();
    state.ship.damage = { hull: 0, drives: 100, weapons: 100, sensors: 0 };
    state.encounter!.enemy.damage.drives = 100;
    a = orderAdvice(state);
    expect(a.helm.open).toBeDefined();
    expect(a.guns.hull).toBeDefined();
    expect(a.engineering.repair).toBeUndefined();
    state.ship.damage = { hull: 0, drives: 0, weapons: 0, sensors: 0 };
    expect(orderAdvice(state).guns.drives).toBeDefined(); // their drives are already wrecked
  });
});

describe("prizes and lessons (combat v1.1)", () => {
  /** Fight a hailed raider with a well-armed ship until it strikes (or try the next departure). */
  function beaten(world: World): GameState {
    for (let i = 0; i < 30; i++) {
      const state = hailed(world, true);
      state.rngState = (state.rngState + i * 101) >>> 0;
      state.ship.upgrades.push("laserBattery", "kineticBattery", "deflectors", "armorPlate");
      answerHail(state, "fight");
      const orders: Orders = { helm: "close", guns: "hull", engineering: "guns", comms: "demand" };
      for (let t = 0; t < 25 && state.encounter?.stage === "battle"; t++) combatTurn(state, orders);
      if (state.encounter?.stage === "prize") return state;
    }
    throw new Error("never won");
  }

  it("a beaten raider is boarded: salvage, the captain's bounty, their hold, and captives", () => {
    const world = new World(SEED);
    const state = beaten(world);
    const p = state.encounter!.prize!;
    expect(p.captainBounty).toBeGreaterThan(0);
    expect(p.captives).toBeGreaterThanOrEqual(2);
    expect(p.promising.length).toBeGreaterThanOrEqual(1);
    expect(Object.keys(p.loot).length).toBeGreaterThan(0);
    expect(fold(state, world, "intrepid").ok).toBe(false); // settle it first
    const credits = state.credits;
    const r = claimPrize(state, "turnIn");
    expect(r.ok).toBe(true);
    expect(state.credits - credits).toBe(p.salvage + p.captainBounty + p.captives * 400);
    expect(state.encounter).toBeUndefined();
    expect(state.lastEncounter?.outcome).toBe("won");
    expect(Object.keys(state.lastEncounter?.loot ?? {}).length).toBeGreaterThan(0);
  });

  it("promising raider crew offered a berth wait a year in the hiring hall, at half the fee", () => {
    const world = new World(SEED);
    const state = beaten(world);
    const p = state.encounter!.prize!;
    const credits = state.credits;
    claimPrize(state, "recruit");
    expect(state.credits - credits).toBe(p.salvage + p.captainBounty + (p.captives - p.promising.length) * 400);
    const ids = p.promising.map((r) => r.id);
    expect(state.recruits!.filter((r) => ids.includes(r.id))).toHaveLength(ids.length);
    for (const r of p.promising) expect(r.clan).toBe("freebooters");
    // The hall turns over twice; they're still waiting. After a year, they've gone.
    advanceTime(state, 130 * DAY);
    expect(state.recruits!.filter((r) => ids.includes(r.id))).toHaveLength(ids.length);
    advanceTime(state, 300 * DAY);
    expect(state.recruits!.some((r) => ids.includes(r.id))).toBe(false);
  });

  it("the debrief reports what each station learned, and flying trains the navigator", () => {
    const world = new World(SEED);
    const state = beaten(world);
    claimPrize(state, "turnIn");
    const xp = state.lastEncounter!.xp!;
    expect(xp.captain).toBeGreaterThan(40);
    expect(xp.navigation).toBeGreaterThan(0);
    expect(xp.engineering).toBeGreaterThan(0);
  });

  it("raiders rarely take on a ship that outguns them", () => {
    const world = new World(SEED);
    const count = (armed: boolean) => {
      let n = 0;
      for (let i = 0; i < 400; i++) {
        const { state, systemId } = laden(world, false);
        state.rngState = (SEED * 7919 + i) >>> 0;
        if (armed) state.ship.upgrades.push("laserBattery", "kineticBattery", "deflectors", "armorPlate");
        if (maybeInterdict(state, world, systemId)) n++;
      }
      return n;
    };
    expect(count(true)).toBeLessThan(count(false) * 0.5);
    const strong = newGame({ seed: SEED });
    strong.ship.upgrades.push("laserBattery", "deflectors");
    const skiff = raiderById("skiff")!;
    expect(sidePower({ ...skiff, hullMax: skiff.hull, damage: { drives: 0, weapons: 0, sensors: 0 } })).toBeLessThan(sidePower(playerSide(strong)));
  });
});
