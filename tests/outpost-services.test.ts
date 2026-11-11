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
  newGame,
  OUTPOST_GEAR_MARKUP,
  outpostFuelPrice,
  outpostGear,
  outpostGearPrice,
  outposts,
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
