/** AW-23 (4/4): passenger runs and the outposts' own boards. */
import { describe, expect, it } from "vitest";
import {
  acceptContract,
  completeContract,
  contractProgress,
  DEFAULT_UNIVERSE,
  effectiveStats,
  landingAccess,
  newGame,
  outposts,
  passengerJob,
  passengersAboard,
  refreshOutpostBoard,
  Rng,
  universeSeed,
  World,
  type GameState,
  type Outpost,
} from "../src/sim";

const SEED = universeSeed(42, { ...DEFAULT_UNIVERSE, outposts: 7 });
const world = new World(SEED);

function landedAt(o: Outpost, s: GameState = newGame({ seed: SEED })): GameState {
  s.location = { kind: "surface", systemId: o.systemId, bodyId: o.bodyId, region: o.region, rover: null, ship: o.pad, globalCoords: true };
  return s;
}

describe("passenger runs (AW-23)", () => {
  it("only to outposts the ship can land at, and never to a den that might turn you away", () => {
    const s = newGame({ seed: SEED });
    const ratings = effectiveStats(s).ratings;
    for (let i = 0; i < 60; i++) {
      const j = passengerJob(s, world, new Rng(i), i);
      if (!j) continue;
      const o = outposts(world).find((x) => x.id === j.turnInAt)!;
      expect(landingAccess(world.body(o.bodyId).body, ratings).ok).toBe(true);
      expect(o.clan).not.toBe("freebooters");
      expect(j.title).toMatch(/passengers to/);
    }
  });

  it("passengers board when signed, take hold space, and are set down at their outpost", () => {
    const s = newGame({ seed: SEED });
    let job = null;
    for (let i = 0; i < 40 && !job; i++) job = passengerJob(s, world, new Rng(i), i);
    expect(job).not.toBeNull();
    s.contracts.push(job!);
    const hold = effectiveStats(s).cargoCapacityT;
    // Not with a full hold.
    s.ship.cargo = { ironNickel: hold - 1 };
    expect(acceptContract(s, job!.id).ok).toBe(false);
    s.ship.cargo = {};
    const r = acceptContract(s, job!.id);
    if (!r.ok) throw new Error(r.reason);
    expect(passengersAboard(s)).toBe(job!.passengers);
    expect(effectiveStats(s).cargoCapacityT).toBe(hold - job!.passengers!);
    // Not at the Intrepid.
    expect(completeContract(s, job!.id).ok).toBe(false);
    const o = outposts(world).find((x) => x.id === job!.turnInAt)!;
    landedAt(o, s);
    expect(contractProgress(s, job!).ready).toBe(true);
    const before = s.credits;
    const done = completeContract(s, job!.id);
    if (!done.ok) throw new Error(done.reason);
    expect(s.credits).toBeGreaterThan(before);
    expect(passengersAboard(s)).toBe(0);
    expect(effectiveStats(s).cargoCapacityT).toBe(hold);
  });
});

describe("an outpost's own board (AW-23)", () => {
  it("fills when you land, is signed and handed in there, and pays above the Intrepid's board", () => {
    const o = outposts(world).find((x) => x.clan === "diggers")!;
    const s = landedAt(o);
    refreshOutpostBoard(s, world, o);
    const offers = s.contracts.filter((c) => c.postedAt === o.id && c.status === "offered");
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(2);
    // Refreshing again straight away changes nothing.
    refreshOutpostBoard(s, world, o);
    expect(s.contracts.filter((c) => c.postedAt === o.id && c.status === "offered")).toEqual(offers);
    const job = offers.find((c) => c.kind === "deliver")!;
    expect(job).toBeDefined();
    // Can't sign it from the Intrepid.
    const home = newGame({ seed: SEED });
    home.contracts.push({ ...job });
    expect(acceptContract(home, job.id).ok).toBe(false);
    const r = acceptContract(s, job.id);
    if (!r.ok) throw new Error(r.reason);
    s.ship.cargo = { [job.commodity!]: job.tonnes! };
    expect(contractProgress(s, job).ready).toBe(true);
    const done = completeContract(s, job.id);
    if (!done.ok) throw new Error(done.reason);
    expect(s.ship.cargo).toEqual({});
  });

  it("a Helm patrol station's hunts count the raiders you beat after signing", () => {
    const o = outposts(world).find((x) => x.clan === "helm")!;
    let hunt = null;
    for (let day = 0; day < 400 && !hunt; day += 61) {
      const s = landedAt(o);
      s.time = day * 24 * 60;
      refreshOutpostBoard(s, world, o);
      const h = s.contracts.find((c) => c.kind === "hunt");
      if (h) hunt = { s, h };
    }
    expect(hunt).not.toBeNull();
    const { s, h } = hunt!;
    s.stats.raidersBeaten = 3;
    acceptContract(s, h.id);
    expect(contractProgress(s, h).have).toBe(0);
    s.stats.raidersBeaten = 3 + (h.count ?? 1);
    expect(contractProgress(s, h).ready).toBe(true);
  });
});
