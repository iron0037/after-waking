/** AW-23 (2/4): what an outpost offers a ship landed in its region. */
import { describe, expect, it } from "vitest";
import type { ClanId } from "../src/data/ship";
import {
  buyOutpostFuel,
  buyOutpostGear,
  currentOutpost,
  DAY,
  DEFAULT_UNIVERSE,
  fuelPriceFor,
  hexInfo,
  newGame,
  OUTPOST_GEAR_MARKUP,
  outpostFuelPrice,
  outpostGear,
  outpostGearPrice,
  outpostAt,
  outposts,
  outpostSite,
  relocateShip,
  sell,
  sellAtOutpost,
  TRADING_POST_RATE,
  universeSeed,
  World,
  type GameState,
} from "../src/sim";

const SEED = universeSeed(42, { ...DEFAULT_UNIVERSE, outposts: 7 });
const world = new World(SEED);

function at(clan: ClanId): GameState {
  const s = newGame({ seed: SEED });
  s.credits = 500_000;
  const o = outposts(world).find((x) => x.clan === clan)!;
  s.location = { kind: "surface", systemId: o.systemId, bodyId: o.bodyId, region: o.region, rover: null, ship: o.pad, globalCoords: true };
  return s;
}

describe("outpost services (AW-23)", () => {
  it("knows which outpost the ship is landed at, and none elsewhere", () => {
    expect(currentOutpost(at("lyceum"), world)?.clan).toBe("lyceum");
    expect(currentOutpost(newGame({ seed: SEED }), world)).toBeNull();
  });

  it("sells fuel at a markup", () => {
    const s = at("midshipmen");
    s.ship.fuel = 10;
    expect(outpostFuelPrice(s)).toBe(Math.round(fuelPriceFor(s) * 1.5));
    const before = s.credits;
    const r = buyOutpostFuel(s, world, 20);
    expect(r.ok && r.value).toBe(20);
    expect(s.ship.fuel).toBe(30);
    expect(before - s.credits).toBe(20 * outpostFuelPrice(s));
  });

  it("the trading post buys cargo a little under the Intrepid's price; others don't buy", () => {
    const post = at("exchange");
    post.ship.cargo = { copper: 20 };
    const home = newGame({ seed: SEED });
    home.ship.cargo = { copper: 20 };
    const r = sellAtOutpost(post, world, "copper");
    if (!r.ok) throw new Error(r.reason);
    const h = sell(home, "copper");
    if (!h.ok) throw new Error(h.reason);
    expect(r.value).toBeCloseTo(h.value * TRADING_POST_RATE, -1);
    const lab = at("lyceum");
    lab.ship.cargo = { copper: 5 };
    expect(sellAtOutpost(lab, world, "copper").ok).toBe(false);
  });

  it("stocks a few of its clan's own fittings and fits them on the spot, at a markup", () => {
    const s = at("diggers");
    const stock = outpostGear(s, currentOutpost(s, world)!);
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.length).toBeLessThanOrEqual(5);
    expect(stock.every((u) => u.vendor === "diggers")).toBe(true);
    const u = stock.find((x) => !x.requires && x.id !== "coreDrill") ?? stock[0]!;
    const price = outpostGearPrice(s, currentOutpost(s, world)!, u);
    expect(price).toBeGreaterThanOrEqual(Math.round(u.price * OUTPOST_GEAR_MARKUP * 0.9));
    const t0 = s.time;
    const before = s.credits;
    const r = buyOutpostGear(s, world, u.id);
    if (!r.ok) throw new Error(r.reason);
    expect(s.ship.upgrades).toContain(u.id);
    expect(before - s.credits).toBe(price);
    expect(s.time - t0).toBeGreaterThanOrEqual(2 * DAY);
    expect(buyOutpostGear(s, world, u.id).ok).toBe(false);
  });
});

describe("hopping to an outpost (AW-260)", () => {
  /** Landed in another region of the outpost's world, on open ground the ship can hop from. */
  function nextDoor(clan: ClanId): { s: GameState; o: ReturnType<typeof outposts>[number] } {
    const o = outposts(world).find((x) => x.clan === clan)!;
    const surface = world.surface(o.bodyId);
    const body = world.body(o.bodyId).body;
    const other = Array.from({ length: body.regions }, (_, r) => r).find((r) => r !== o.region && !outpostAt(world, o.bodyId, r))!;
    const s = newGame({ seed: SEED });
    s.ship.fuel = 60;
    s.location = { kind: "surface", systemId: o.systemId, bodyId: o.bodyId, region: other, rover: null, ship: surface.landing(other), globalCoords: true };
    return { s, o };
  }

  it("a hop into the outpost's region arrives there: its panel and its board", () => {
    const { s, o } = nextDoor("lyceum");
    expect(currentOutpost(s, world)).toBeNull();
    const r = relocateShip(s, world, o.pad.x, o.pad.y);
    if (!r.ok) throw new Error(r.reason);
    expect(currentOutpost(s, world)?.id).toBe(o.id);
    expect(s.contracts.some((c) => c.postedAt === o.id)).toBe(true);
  });

  it("a pirate's den won't take a hop from a ship its tower hasn't cleared", () => {
    const { s, o } = nextDoor("freebooters");
    const r = relocateShip(s, world, o.pad.x, o.pad.y);
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.reason).toMatch(/coming down from orbit/);
    s.denCleared = o.systemId;
    expect(relocateShip(s, world, o.pad.x, o.pad.y).ok).toBe(true);
  });

  it("the hex card names the outpost on its buildings", () => {
    const s = at("lyceum");
    const o = outposts(world).find((x) => x.clan === "lyceum")!;
    const site = outpostSite(o.pad);
    expect(hexInfo(s, world, site.x, site.y)?.outpost).toMatchObject({ name: o.name, here: true });
  });
});
