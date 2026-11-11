/** AW-242: the Lyceum posts specimen jobs it knows can be done. */
import { describe, expect, it } from "vitest";
import { CREATURES_BY_NAME } from "../src/data/creatures";
import {
  advanceTime,
  completeContract,
  contractProgress,
  DAY,
  effectiveStats,
  landingAccess,
  newGame,
  NEW_SPECIES_BONUS,
  Rng,
  SPECIMEN_JOB_MIN_CAPTURE,
  SPECIMEN_PRICE,
  specimenHolds,
  specimenJob,
  specimenOpportunities,
  speciesCaptureChance,
  World,
  type Contract,
  type GameState,
} from "../src/sim";

const SEED = 42;
const world = new World(SEED);

function jobs(state: GameState, n = 200): Contract[] {
  const out: Contract[] = [];
  for (let i = 0; i < n; i++) {
    const j = specimenJob(state, world, new Rng(1000 + i), i);
    if (j) out.push(j);
  }
  return out;
}

describe("Lyceum specimen jobs (AW-242)", () => {
  it("only asks for species on known worlds the ship can land on, with plenty to spare", () => {
    const s = newGame({ seed: SEED });
    const ratings = effectiveStats(s).ratings;
    const opportunities = specimenOpportunities(s, world);
    expect(opportunities.some((o) => o.kind === "flora")).toBe(true);
    for (const o of opportunities) {
      for (const id of o.bodyIds) {
        const { body, detail } = world.body(id);
        expect(landingAccess(body, ratings).ok).toBe(true);
        const sys = detail.system;
        expect(sys.charted || s.visitedSystems.includes(sys.id)).toBe(true);
      }
    }
    const posted = jobs(s);
    expect(posted.length).toBeGreaterThan(0);
    for (const j of posted) {
      const o = opportunities.find((x) => x.species === j.species)!;
      expect(o).toBeDefined();
      expect(o.available).toBeGreaterThanOrEqual((j.count ?? 0) * 2);
      expect(j.reward).toBeGreaterThan((j.count ?? 0) * SPECIMEN_PRICE);
      expect(j.clan).toBe("lyceum");
    }
  });

  it("creature jobs only when the rover's gear gives a fair chance", () => {
    const s = newGame({ seed: SEED });
    for (const j of jobs(s)) {
      const entry = CREATURES_BY_NAME.get(j.species ?? "");
      if (entry) expect(speciesCaptureChance(s, entry)).toBeGreaterThanOrEqual(SPECIMEN_JOB_MIN_CAPTURE);
    }
    // Better gear opens up more of them.
    const fauna = specimenOpportunities(s, world).filter((o) => o.kind === "fauna");
    const fair = (st: GameState) => fauna.filter((o) => speciesCaptureChance(st, CREATURES_BY_NAME.get(o.species)!) >= SPECIMEN_JOB_MIN_CAPTURE).length;
    const geared = newGame({ seed: SEED });
    geared.ship.upgrades.push("stunGun", "netLauncher", "tangleCannon", "roverLaser", "roverArmour", "roverMotors");
    expect(fair(geared)).toBeGreaterThan(fair(s));
  });

  it("any world's specimens of the species count; turning them in pays, and catalogs a new species", () => {
    const s = newGame({ seed: SEED });
    const job = jobs(s).find((j) => !CREATURES_BY_NAME.has(j.species ?? ""))!;
    job.status = "active";
    job.deadline = s.time + 100 * DAY;
    s.contracts.push(job);
    const n = job.count ?? 0;
    s.ship.specimens = { [`a|${job.species}`]: n - 1, [`b|${job.species}`]: 1, "a|something else": 2 };
    expect(contractProgress(s, job)).toMatchObject({ have: n, need: n, ready: true });
    // Held back from a sale.
    expect(specimenHolds(s).get(`b|${job.species}`)?.contract).toBe(true);
    expect(specimenHolds(s).get("a|something else")?.contract ?? false).toBe(false);
    const before = s.credits;
    s.catalogedSpecies = [];
    const r = completeContract(s, job.id);
    if (!r.ok) throw new Error(r.reason);
    expect(s.credits - before).toBeGreaterThanOrEqual(job.reward * 0.8 + NEW_SPECIES_BONUS);
    expect(s.catalogedSpecies).toContain(job.species);
    expect(s.ship.specimens).toEqual({ "a|something else": 2 });
  });

  it("the board carries one at a time, alongside the Meadow starter", () => {
    const s = newGame({ seed: SEED });
    advanceTime(s, 400 * DAY);
    const open = s.contracts.filter((c) => c.kind === "specimens" && !c.starter && (c.status === "offered" || c.status === "active"));
    expect(open.length).toBe(1);
    expect(s.contracts.some((c) => c.id === "starter-meadow")).toBe(true);
  });
});
