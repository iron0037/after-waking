/** AW-20: raiders met in flight, and leaving a fight to the officers. */
import { describe, expect, it } from "vitest";
import {
  answerContact,
  autoOrders,
  autoStep,
  claimPrize,
  contactOdds,
  DAY,
  flightPlan,
  flyTo,
  fold,
  newGame,
  World,
  type AutoMode,
  type GameState,
} from "../src/sim";

const SEED = 42;
const world = new World(SEED);
const sys = world.galaxy.systems.find((s) => !s.home && !s.charted)!;
const far = world.system(sys.id).bodies.reduce((a, b) => (b.orbitAU > a.orbitAU ? b : a));

/** A laden freighter at the system edge whose burn to the outermost world meets a raider. */
function intercepted(offset = 0, armed = false): GameState {
  for (let i = 0; i < 400; i++) {
    const state = newGame({ seed: SEED });
    state.location = { kind: "space", systemId: sys.id, pos: { x: world.system(sys.id).edgeAU, y: 0 }, orbiting: null };
    state.ship.cargo = { platinum: 40, copper: 60 };
    state.ship.fuel = 50;
    if (armed) state.ship.upgrades.push("laserBattery", "kineticBattery", "deflectors", "armorPlate");
    state.time += (i + offset) * DAY;
    state.rngState = (SEED * 31 + i) >>> 0;
    const plan = flightPlan(state, world, { bodyId: far.id });
    if (plan.ok && plan.value.contact) return state;
  }
  throw new Error("no contact in 400 days");
}

describe("contacts in flight (AW-20)", () => {
  it("the flight plan shows where the burn will stop, and the flight stops there", () => {
    const state = intercepted();
    const plan = flightPlan(state, world, { bodyId: far.id });
    if (!plan.ok) throw new Error(plan.reason);
    const f = plan.value.contact!.fraction;
    expect(f).toBeGreaterThan(0.25);
    expect(f).toBeLessThan(0.8);
    const t0 = state.time;
    const fuel0 = state.ship.fuel;
    expect(flyTo(state, world, { bodyId: far.id }).ok).toBe(false);
    expect(state.encounter?.stage).toBe("contact");
    expect(state.time - t0).toBeCloseTo(plan.value.minutes * f, 0);
    expect(fuel0 - state.ship.fuel).toBeLessThanOrEqual(plan.value.fuel);
    expect(state.location.kind === "space" && state.location.orbiting).toBeNull();
  });

  it("one raider per visit: after a contact, the departure fold is clear", () => {
    const state = intercepted();
    flyTo(state, world, { bodyId: far.id });
    answerContact(state, "hail");
    expect(state.encounter?.stage).toBe("hail");
    expect(flightPlan(state, world, { bodyId: far.id }).ok).toBe(true);
  });

  it("each answer leads where it should", () => {
    const hail = intercepted();
    flyTo(hail, world, { bodyId: far.id });
    answerContact(hail, "hail");
    expect(hail.encounter?.stage).toBe("hail");

    const engage = intercepted();
    flyTo(engage, world, { bodyId: far.id });
    answerContact(engage, "engage");
    expect(engage.encounter?.stage).toBe("battle");
    expect(engage.encounter?.range).toBe(2);

    // Slipping past needs the first sighting.
    let saw = 0;
    let blind = 0;
    for (let k = 0; k < 20; k++) {
      const s = intercepted(k * 3);
      flyTo(s, world, { bodyId: far.id });
      const odds = contactOdds(s);
      if (s.encounter!.spottedFirst) {
        saw++;
        expect(odds.slip).not.toBeNull();
      } else {
        blind++;
        expect(odds.slip).toBeNull();
        expect(answerContact(s, "slip").ok).toBe(false);
      }
    }
    expect(saw).toBeGreaterThan(0);
    expect(blind).toBeGreaterThan(0);
  });

  it("afterwards the flight picks up where it left off", () => {
    for (let k = 0; k < 20; k++) {
      const state = intercepted(k * 5);
      flyTo(state, world, { bodyId: far.id });
      answerContact(state, "run");
      if (state.encounter) continue; // caught: try another
      expect(state.lastEncounter?.outcome).toBe("escaped");
      expect(state.lastEncounter?.resume).toEqual({ bodyId: far.id });
      expect(state.lastEncounter?.text).toMatch(/Back on course/);
      expect(flyTo(state, world, state.lastEncounter!.resume!).ok).toBe(true);
      expect(state.location.kind === "space" && state.location.orbiting).toBe(far.id);
      return;
    }
    throw new Error("never got away");
  });
});

describe("leaving it to the officers", () => {
  function auto(state: GameState, mode: AutoMode): void {
    for (let i = 0; i < 40 && state.encounter && state.encounter.stage !== "prize"; i++) autoStep(state, mode);
  }

  it("auto-fight with a fitted ship usually takes the prize, and stops there for the captain", () => {
    let won = 0;
    for (let k = 0; k < 12; k++) {
      const state = intercepted(k * 4, true);
      flyTo(state, world, { bodyId: far.id });
      if (!state.encounter) continue;
      auto(state, "fight");
      if (state.encounter?.stage === "prize") {
        won++;
        expect(autoStep(state, "fight").ok).toBe(false);
        expect(claimPrize(state, "turnIn").ok).toBe(true);
      }
      expect(state.encounter).toBeUndefined();
    }
    expect(won).toBeGreaterThanOrEqual(6);
  });

  it("auto-run gets the stock freighter away more often than not, and never strikes", () => {
    let away = 0;
    for (let k = 0; k < 20; k++) {
      const state = intercepted(k * 4);
      flyTo(state, world, { bodyId: far.id });
      auto(state, "run");
      expect(state.encounter).toBeUndefined();
      expect(state.lastEncounter?.outcome).not.toBe("surrendered");
      if (["escaped", "slipped past", "driven off"].includes(state.lastEncounter!.outcome)) away++;
    }
    expect(away).toBeGreaterThanOrEqual(11);
  });

  it("officers' orders are sensible", () => {
    const state = intercepted();
    flyTo(state, world, { bodyId: far.id });
    answerContact(state, "engage");
    expect(autoOrders(state, "run").helm).toBe("open");
    expect(autoOrders(state, "fight").comms).toBe("quiet"); // they aren't beaten yet
    state.encounter!.enemy.hull = 5;
    expect(autoOrders(state, "fight").comms).toBe("demand");
  });

  it("fold departures still work after an in-system contact", () => {
    const state = intercepted();
    flyTo(state, world, { bodyId: far.id });
    answerContact(state, "hail");
    expect(fold(state, world, "intrepid").ok).toBe(false); // still settling
  });
});
