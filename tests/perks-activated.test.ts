/** AW-198: perks that waited on combat, clan relations, research and the refinery, now switched on. */
import { describe, expect, it } from "vitest";
import { PERKS, PERKS_BY_ID } from "../src/data/perks";
import { BASE_STATS } from "../src/data/ship";
import {
  answerHail,
  changeRep,
  combatTurn,
  contactOdds,
  DAY,
  flyTo,
  fold,
  hailOdds,
  hasPerk,
  hopFuelTo,
  interdictionChance,
  land,
  landingAccess,
  maybeInterdict,
  newGame,
  officerAt,
  readTheEnemy,
  refineHours,
  relocateShip,
  repairQuote,
  reputation,
  specimenResearchUses,
  spotChance,
  startResearch,
  tickContracts,
  World,
  xpForLevel,
  type Contract,
  type GameState,
  type Orders,
} from "../src/sim";
import type { Station } from "../src/data/crew";

const ACTIVATED = [
  "field-theory", "evasive-pilot", "pursuit-course", "pinpoint-landing", "wake-masking", "drive-repair", "overdrive",
  "fire-control", "shield-tuning", "field-refinery", "favors-owed", "early-warning", "clan-dialects", "bio-assay",
  "living-archive", "silver-tongue", "read-the-enemy",
];

function grant(state: GameState, id: string): void {
  const def = PERKS_BY_ID.get(id)!;
  const holder = def.station === "captain" ? state.captain : officerAt(state, def.station as Exclude<Station, "captain">)!;
  holder.xp = Math.max(holder.xp ?? 0, xpForLevel(10));
  holder.perks = [...(holder.perks ?? []), id];
  expect(hasPerk(state, id)).toBe(true);
}

const world = new World(42);
const charted = world.galaxy.systems.find((s) => !s.home && s.charted)!;

/** A laden ship leaving a charted star, set up for the i-th roll. */
function departing(i: number, perks: string[] = []): GameState {
  const state = newGame({ seed: 42 });
  for (const p of perks) grant(state, p);
  state.location = { kind: "space", systemId: charted.id, pos: { x: 40, y: 0 }, orbiting: null };
  state.ship.cargo = { platinum: 40, copper: 60 };
  state.rngState = (42 * 7919 + i) >>> 0;
  return state;
}

/** The same, in a raider's hail. */
function hailed(perks: string[] = [], from = 0): GameState {
  for (let i = from; i < from + 300; i++) {
    const state = departing(i, perks);
    if (maybeInterdict(state, world, charted.id)) return state;
  }
  throw new Error("no raider");
}

describe("activated perks (AW-198)", () => {
  it("are all switched on, and the ones still waiting say what for", () => {
    for (const id of ACTIVATED) expect(PERKS_BY_ID.get(id)?.needs, id).toBeUndefined();
    for (const id of ["stabilize", "surgeon", "combat-medic", "xenologist", "shoal-reader", "fauna-handler", "longevity"]) {
      expect(PERKS_BY_ID.get(id)?.needs, id).toBeTruthy();
    }
    expect(PERKS.filter((p) => p.needs).length).toBeLessThan(20);
  });

  it("Clan Dialects: a quarter more goodwill; losses unchanged", () => {
    const a = newGame({ seed: 1 });
    const b = newGame({ seed: 1 });
    grant(b, "clan-dialects");
    changeRep(a, "helm", 8, "test", false);
    changeRep(b, "helm", 8, "test", false);
    expect(reputation(b, "helm") - reputation(a, "helm")).toBeCloseTo(2, 5);
    changeRep(a, "diggers", -8, "test", false);
    changeRep(b, "diggers", -8, "test", false);
    expect(reputation(b, "diggers")).toBe(reputation(a, "diggers"));
  });

  it("Favors Owed: each clan forgives one lapse", () => {
    const state = newGame({ seed: 1 });
    grant(state, "favors-owed");
    const job = (id: string): Contract => {
      const c: Contract = { id, clan: "helm", kind: "deliver", title: id, text: "", reward: 1_000, durationDays: 10, deadline: state.time, status: "active", commodity: "copper", tonnes: 1 };
      state.contracts.push(c);
      return c;
    };
    const before = reputation(state, "helm");
    job("one");
    state.time += DAY;
    tickContracts(state);
    expect(reputation(state, "helm")).toBe(before);
    job("two");
    state.time += DAY;
    tickContracts(state);
    expect(reputation(state, "helm")).toBeLessThan(before);
  });

  it("Field Refinery runs the refinery 40% faster", () => {
    const state = newGame({ seed: 1 });
    state.ship.upgrades.push("refinery");
    const slow = refineHours(state, 50);
    grant(state, "field-refinery");
    expect(refineHours(state, 50)).toBeCloseTo(slow * 0.6, 5);
  });

  it("Living Archive speeds specimen research; Bio-Assay names the projects a species feeds", () => {
    const state = newGame({ seed: 1 });
    state.credits = 100_000;
    expect(specimenResearchUses(state, "cloud drifter")).toEqual([]);
    grant(state, "bio-assay");
    expect(specimenResearchUses(state, "cloud drifter")).toContain("Drifter lift cells");
    grant(state, "living-archive");
    state.ship.specimens = { "x|cloud drifter": 2 };
    expect(startResearch(state, "drifter-lift").ok).toBe(true);
    const r = state.research?.["drifter-lift"];
    if (!r) throw new Error("not started");
    expect((r.readyAt - r.startedAt) / DAY).toBeCloseTo(28 * 0.75, 5);
    expect(specimenResearchUses(state, "cloud drifter")).not.toContain("Drifter lift cells");
  });

  it("Silver Tongue and Early Warning improve the hail; Pursuit Course the contact", () => {
    const state = hailed();
    const base = hailOdds(state);
    const spot = spotChance(state);
    grant(state, "silver-tongue");
    grant(state, "early-warning");
    const better = hailOdds(state);
    expect(better.talk).toBeGreaterThan(base.talk);
    expect(better.run).toBeGreaterThanOrEqual(base.run);
    expect(spotChance(state)).toBeGreaterThan(spot);
    state.encounter!.stage = "contact";
    const run = contactOdds(state).run;
    grant(state, "pursuit-course");
    expect(contactOdds(state).run).toBeGreaterThan(run);
  });

  it("Wake Masking: fewer raiders waiting as you fold out", () => {
    expect(interdictionChance(departing(0), world, charted.id)).toBeGreaterThan(0);
    const count = (perks: string[]) => {
      let n = 0;
      for (let i = 0; i < 400; i++) if (maybeInterdict(departing(i, perks), world, charted.id)) n++;
      return n;
    };
    expect(count(["wake-masking"])).toBeLessThan(count([]));
  });

  it("combat perks hit harder; Read the Enemy shows their next move", () => {
    const orders: Orders = { helm: "close", guns: "hull", engineering: "guns", comms: "quiet" };
    const dealt = (perks: string[]) => {
      let total = 0;
      for (let i = 0; i < 20; i++) {
        const state = hailed(perks, i * 7);
        state.ship.upgrades.push("laserBattery", "kineticBattery");
        answerHail(state, "fight");
        const them0 = state.encounter!.enemy.hull;
        for (let t = 0; t < 3 && state.encounter?.stage === "battle"; t++) combatTurn(state, orders);
        total += them0 - (state.encounter?.enemy.hull ?? 0);
      }
      return total;
    };
    expect(dealt(["fire-control", "field-theory"])).toBeGreaterThan(dealt([]));

    const state = hailed();
    answerHail(state, "fight");
    expect(readTheEnemy(state, "hold")).toBeNull();
    grant(state, "read-the-enemy");
    expect(readTheEnemy(state, "hold")).toMatch(/will (break away|close in|hold the range) and fire at your/);
  });

  it("Drive Repair halves the yard's time", () => {
    const state = newGame({ seed: 1 });
    state.ship.damage = { hull: 200, drives: 100, weapons: 100, sensors: 100 };
    const days = repairQuote(state)!.days;
    grant(state, "drive-repair");
    expect(repairQuote(state)!.days).toBe(Math.ceil(days / 2));
  });

  it("Pinpoint Landing: the first hop within the landing region is free", () => {
    const state = newGame({ seed: 42 });
    expect(fold(state, world, "s0").ok).toBe(true);
    const body = world.system("s0").bodies.find((b) => b.easy && landingAccess(b, BASE_STATS.ratings).ok)!;
    expect(flyTo(state, world, { bodyId: body.id }).ok).toBe(true);
    grant(state, "pinpoint-landing");
    expect(land(state, world, 0).ok).toBe(true);
    const loc = state.location as { bodyId: string; ship: { x: number; y: number } };
    const surface = world.surface(loc.bodyId);
    const start = { ...loc.ship };
    const region = surface.regionAt(start.x, start.y);
    let target: { x: number; y: number } | null = null;
    for (let d = 3; d < 12 && !target; d++) {
      for (const [x, y] of [[start.x + d, start.y], [start.x - d, start.y], [start.x, start.y + d], [start.x, start.y - d]] as const) {
        if (surface.regionAt(x, y) === region && relocateShip(structuredClone(state), world, x, y).ok) {
          target = { x, y };
          break;
        }
      }
    }
    expect(target).not.toBeNull();
    expect(hopFuelTo(state, world, target!.x, target!.y)).toBe(0);
    const fuel = state.ship.fuel;
    expect(relocateShip(state, world, target!.x, target!.y).ok).toBe(true);
    expect(state.ship.fuel).toBe(fuel);
    expect(hopFuelTo(state, world, start.x, start.y)).toBeGreaterThan(0);
  });
});
