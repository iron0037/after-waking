/** AW-103: ship classes. Each clan sells one hull; you keep your old ships berthed at the Intrepid. */
import { describe, expect, it } from "vitest";
import { HULL_ONLY, HULLS, QUIRKS_BY_ID } from "../src/data/hulls";
import {
  blindFoldFuel,
  blindFoldRange,
  buyHull,
  buyUpgrade,
  commandBlockers,
  commandShip,
  effectiveStats,
  fleetOnDocked,
  hullBlockers,
  hullPrice,
  HULLS_BY_ID,
  interdictionChance,
  newGame,
  playerSide,
  reputation,
  resaleValue,
  sellShip,
  shipSpecimenSlots,
  shipStats,
  spotChance,
  World,
  yardStatus,
  deserialize,
  serialize,
  type GameState,
} from "../src/sim";

const world = new World(42);

function rich(): GameState {
  const s = newGame({ seed: 42 });
  s.credits = 1_000_000;
  s.reputation = { helm: 30, diggers: 30, lyceum: 30, covenant: 30, freebooters: 30, midshipmen: 30, exchange: 30 };
  return s;
}

function flying(hull: (typeof HULLS)[number]["id"]): GameState {
  const s = rich();
  s.ship.hull = hull;
  return s;
}

describe("the starter freighter only grows so far", () => {
  it("won't take top-tier gear that needs a bigger frame", () => {
    const s = rich();
    // Research done or not, the frame says no first.
    s.ship.upgrades.push("expandedHold", "deepDrill", "surveyArray", "pressureHull2", "deepFieldArray", "probeBay");
    for (const id of Object.keys(HULL_ONLY)) {
      const r = buyUpgrade(s, id);
      expect(r.ok, id).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/Only fits/);
    }
    // Every Mk I fitting still goes on.
    expect(buyUpgrade(s, "laserBattery").ok).toBe(true);
  });

  it("ships that already carry it keep it", () => {
    const s = rich();
    s.ship.upgrades.push("expandedHold", "expandedHold2");
    expect(shipStats(s.ship).cargoCapacityT).toBe(450);
  });

  it("every hull's class-only gear names hulls that exist, and none of them is the starter", () => {
    for (const hulls of Object.values(HULL_ONLY)) for (const h of hulls) expect(HULLS_BY_ID.get(h)?.vendor).toBeTruthy();
  });
});

describe("buying a hull", () => {
  it("needs the builder's friendship and the cash, and berths the ship fueled", () => {
    const s = newGame({ seed: 42 });
    s.credits = 1_000_000;
    expect(hullBlockers(s, "bulker").join()).toMatch(/friends/);
    s.reputation = { diggers: 25 };
    s.credits = 1000;
    expect(hullBlockers(s, "bulker").join()).toMatch(/Costs/);
    s.credits = 1_000_000;
    const price = hullPrice(s, HULLS_BY_ID.get("bulker")!);
    const r = buyHull(s, "bulker");
    if (!r.ok) throw new Error(r.reason);
    expect(s.credits).toBe(1_000_000 - price);
    expect(s.berthed).toHaveLength(1);
    expect(s.ship.hull ?? "freighter").toBe("freighter");
    expect(r.value.fuel).toBe(100);
    expect(reputation(s, "diggers")).toBeGreaterThan(25);
  });

  it("the starter freighter isn't for sale", () => {
    expect(hullBlockers(rich(), "freighter").length).toBeGreaterThan(0);
  });

  it("a corsair comes with a quirk from its last owner", () => {
    const s = rich();
    const r = buyHull(s, "corsair");
    if (!r.ok) throw new Error(r.reason);
    expect(QUIRKS_BY_ID.get(r.value.quirk ?? "")).toBeDefined();
  });
});

describe("taking command of another ship", () => {
  it("the rover, the boat, the hold and the racks come across; fitted gear, fuel and probes stay", () => {
    const s = rich();
    s.ship.upgrades.push("roverCells", "boat", "expandedHold", "probeBay");
    s.ship.roverEnergy = 55;
    s.ship.boatEnergy = 90;
    s.ship.probes = 2;
    s.ship.fuel = 12;
    s.ship.cargo = { ironNickel: 150 };
    s.ship.specimens = { "x|Glassweed": 3 };
    buyHull(s, "bulker");
    const r = commandShip(s, 0);
    if (!r.ok) throw new Error(r.reason);
    expect(s.ship.hull).toBe("bulker");
    expect(s.ship.upgrades).toEqual(expect.arrayContaining(["roverCells", "boat"]));
    expect(s.ship.upgrades).not.toContain("expandedHold");
    expect(s.ship.roverEnergy).toBeGreaterThanOrEqual(55); // and it charges while the crew moves across
    expect(s.ship.boatEnergy).toBeGreaterThanOrEqual(90);
    expect(s.ship.cargo).toEqual({ ironNickel: 150 });
    expect(s.ship.specimens).toEqual({ "x|Glassweed": 3 });
    expect(s.ship.fuel).toBe(100);
    const old = s.berthed![0]!;
    expect(old.upgrades).toEqual(["expandedHold", "probeBay"]);
    expect(old.probes).toBe(2);
    expect(old.fuel).toBe(12);
    expect(old.cargo).toEqual({});
    expect(effectiveStats(s).roverEnergy).toBeGreaterThan(shipStats({ name: "", upgrades: [], fuel: 0, cargo: {}, hull: "bulker" }).roverEnergy);
    // And back again.
    expect(commandShip(s, 0).ok).toBe(true);
    expect(s.ship.hull ?? "freighter").toBe("freighter");
    expect(s.ship.upgrades).toEqual(expect.arrayContaining(["expandedHold", "probeBay", "roverCells", "boat"]));
  });

  it("not if the hold won't fit, or while the yard is working", () => {
    const s = rich();
    s.ship.upgrades.push("expandedHold");
    s.ship.cargo = { ironNickel: 250 };
    buyHull(s, "scout");
    expect(commandBlockers(s, 0).join()).toMatch(/holds 80 t/);
    s.ship.cargo = {};
    buyUpgrade(s, "laserBattery");
    expect(commandBlockers(s, 0).join()).toMatch(/yard/);
  });

  it("a berthed ship sells for half its hull and fitted gear", () => {
    const s = rich();
    s.ship.upgrades.push("expandedHold", "roverCells");
    buyHull(s, "destroyer");
    commandShip(s, 0);
    const old = s.berthed![0]!;
    expect(resaleValue(old)).toBe(Math.round((60_000 + 22_000) / 2));
    const before = s.credits;
    expect(sellShip(s, 0).ok).toBe(true);
    expect(s.credits).toBe(before + 41_000);
    expect(s.berthed).toHaveLength(0);
  });
});

describe("what each hull is for", () => {
  it("built-in gear counts as fitted: a scout can order the survey array Mk II straight away", () => {
    const s = flying("scout");
    s.research = { "crust-acoustics": { startedAt: 0, readyAt: 0, done: true } };
    expect(buyUpgrade(s, "surveyArray").ok).toBe(false);
    expect(buyUpgrade(s, "expandedHold").ok).toBe(false);
    expect(effectiveStats(s).sensorTier).toBe(2);
    const r = buyUpgrade(s, "surveyArray2");
    expect(r.ok ? "" : r.reason).toBe("");
  });

  it("specimen racks: 28 on a scout, 8 on a destroyer", () => {
    expect(shipSpecimenSlots(flying("scout"))).toBe(28);
    expect(shipSpecimenSlots(flying("destroyer"))).toBe(8);
    expect(shipSpecimenSlots(rich())).toBe(16);
  });

  it("the merchantman can't be fitted for rough worlds", () => {
    const s = flying("merchantman");
    const r = buyUpgrade(s, "landingStruts");
    expect(r.ok).toBe(false);
    expect(effectiveStats(s).ratings.maxGravityG).toBe(1);
  });

  it("the listener runs quiet and folds well into the dark", () => {
    const base = rich();
    const quiet = flying("listener");
    expect(blindFoldRange(quiet)).toBe(0.9);
    expect(blindFoldFuel(quiet)).toBe(1);
    expect(blindFoldRange(base)).toBe(0.6);
    expect(spotChance(quiet)).toBeGreaterThan(spotChance(base) + 0.2);
    expect(effectiveStats(quiet).deepScanLy).toBeGreaterThan(0);
    const sys = world.galaxy.systems.find((x) => x.charted && !x.home)!;
    for (const s of [base, quiet]) s.ship.cargo = { platinum: 20 };
    expect(interdictionChance(quiet, world, sys.id)).toBeLessThan(interdictionChance(base, world, sys.id));
  });

  it("warships are quicker in a fight; bulk haulers slower", () => {
    expect(playerSide(flying("destroyer")).speed).toBeGreaterThan(1.15);
    expect(playerSide(flying("bulker")).speed).toBeLessThan(0.95);
    expect(playerSide(rich()).speed).toBe(1);
  });

  it("Helm marks a corsair each time it docks", () => {
    const s = flying("corsair");
    const before = reputation(s, "helm");
    fleetOnDocked(s);
    expect(reputation(s, "helm")).toBeLessThan(before);
    const plain = rich();
    fleetOnDocked(plain);
    expect(reputation(plain, "helm")).toBe(30);
  });

  it("every hull can reach its own fold range on a full tank, loaded", () => {
    for (const h of HULLS) {
      const s = flying(h.id);
      const st = effectiveStats(s);
      const mass = st.hullMassT + st.cargoCapacityT + st.fuelCapacity;
      expect(0.001 * mass * st.foldRangeLy, h.id).toBeLessThan(st.fuelCapacity / 2);
    }
  });
});

describe("the galleon is the Merchantman now (AW-232)", () => {
  it("saves that own one carry it over", () => {
    const s = rich();
    s.ship.hull = "galleon" as never;
    s.berthed = [{ name: "Old", hull: "galleon" as never, upgrades: [], fuel: 0, cargo: {} }];
    const back = deserialize(serialize(s));
    expect(back.ship.hull).toBe("merchantman");
    expect(back.berthed![0]!.hull).toBe("merchantman");
  });
});

describe("the Shipyard filter (AW-231)", () => {
  it("sorts gear into equipped, incompatible, purchasable, short of credits and locked", () => {
    const s = rich();
    expect(yardStatus(s, "expandedHold")).toBe("purchasable");
    expect(yardStatus(s, "kineticBattery")).toBe("incompatible");
    expect(yardStatus(s, "expandedHold2")).toBe("incompatible");
    s.credits = 0;
    expect(yardStatus(s, "expandedHold")).toBe("short");
    s.credits = 1_000_000;
    buyUpgrade(s, "expandedHold");
    expect(yardStatus(s, "expandedHold")).toBe("equipped"); // being fitted counts
    s.ship.hull = "firstRate";
    expect(yardStatus(s, "expandedHold2")).toBe("locked"); // waits on research
    s.ship.hull = "scout";
    expect(yardStatus(s, "surveyArray")).toBe("equipped"); // built in
  });
});
