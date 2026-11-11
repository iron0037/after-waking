/**
 * Lyceum specimen jobs (AW-242). After the Meadow starter, the Lyceum posts one specimen job at a time,
 * and only one it knows can be done: the species lives on worlds the Intrepid knows (charted stars and
 * the ones you've visited) that your ship can set down on, in enough numbers to fill it. A creature job
 * is posted only if the rover's gear as fitted gives a fair chance of taking one.
 */
import { CREATURES_BY_ID, CREATURES_BY_NAME } from "../data/creatures";
import { FLORA_BY_NAME } from "../data/catalog";
import { landingAccess } from "./environment";
import { distanceLy } from "./galaxy";
import { effectiveStats, shipSpecimenSlots } from "./perks";
import type { Rng } from "./rng";
import { speciesCaptureChance } from "./creatures";
import { SPECIMEN_PRICE } from "./actions";
import { bodyCreatureSpecies, bodySpecies, regionFlora } from "./surface";
import { universeOf } from "./settings";
import type { Contract } from "./contracts";
import type { GameState } from "./state";
import type { World } from "./world";

/** A creature job needs at least this chance of a capture with the gear aboard. */
export const SPECIMEN_JOB_MIN_CAPTURE = 0.5;
/** The Lyceum wants this many times the specimens in reach before it posts a job. */
const FLORA_MARGIN = 2;
const FAUNA_MARGIN = 3;

export interface SpecimenOpportunity {
  species: string;
  kind: "flora" | "fauna";
  rarity: number;
  /** Specimens the Lyceum reckons are out there, on worlds you can land on. */
  available: number;
  /** Those worlds, nearest first. */
  bodyIds: string[];
  /** Light-years from the Intrepid to the nearest of them. */
  nearestLy: number;
}

/** What the Lyceum could fairly ask for right now. */
export function specimenOpportunities(state: GameState, world: World): SpecimenOpportunity[] {
  const ratings = effectiveStats(state).ratings;
  const visited = new Set(state.visitedSystems);
  const life = universeOf(state.seed).life;
  const perRegion = life === "scarce" ? 2 : life === "plentiful" ? 4.5 : 3;
  const found = new Map<string, SpecimenOpportunity & { near: { id: string; ly: number }[] }>();
  const note = (species: string, kind: "flora" | "fauna", rarity: number, n: number, bodyId: string, ly: number) => {
    if (n <= 0) return;
    let o = found.get(species);
    if (!o) found.set(species, (o = { species, kind, rarity, available: 0, bodyIds: [], nearestLy: Infinity, near: [] }));
    o.available += n;
    o.near.push({ id: bodyId, ly });
  };
  for (const sys of world.galaxy.systems) {
    if (!sys.charted && !visited.has(sys.id)) continue;
    const ly = distanceLy(world.galaxy, "intrepid", sys.id);
    for (const body of world.system(sys.id).bodies) {
      if (!body.life || body.regions <= 0 || !landingAccess(body, ratings).ok) continue;
      // Plants: the sites can be counted without building the surface.
      const counts = new Map<string, number>();
      if (bodySpecies(state.seed, body).length > 0) {
        for (let r = 0; r < body.regions; r++) for (const f of regionFlora(state.seed, body, r)) counts.set(f.species, (counts.get(f.species) ?? 0) + 1);
      }
      for (const [name, n] of counts) note(name, "flora", FLORA_BY_NAME.get(name)?.rarity ?? 1, n, body.id, ly);
      // Land animals: each region holds a few, shared among the world's species.
      const { land } = bodyCreatureSpecies(state.seed, body);
      for (const id of land) {
        const entry = CREATURES_BY_ID.get(id);
        if (entry) note(entry.name, "fauna", entry.rarity, Math.floor((body.regions * perRegion) / land.length), body.id, ly);
      }
    }
  }
  return [...found.values()].map(({ near, ...o }) => {
    near.sort((a, b) => a.ly - b.ly);
    return { ...o, bodyIds: [...new Set(near.map((n) => n.id))].slice(0, 3), nearestLy: near[0]?.ly ?? 0 };
  });
}

/** How many the Lyceum asks for: fewer of the rare ones, fewer animals than plants. */
function wanted(o: SpecimenOpportunity, rng: Rng): number {
  if (o.kind === "fauna") return o.rarity >= 3 ? 1 : o.rarity === 2 ? 2 : rng.int(2, 3);
  return o.rarity >= 3 ? rng.int(2, 3) : o.rarity === 2 ? 4 : rng.int(5, 6);
}

/** A specimen job the Lyceum can fairly post, or null if there's nothing it could ask for. */
export function specimenJob(state: GameState, world: World, rng: Rng, serial: number): Contract | null {
  const racks = shipSpecimenSlots(state);
  const options = specimenOpportunities(state, world).flatMap((o) => {
    const count = wanted(o, rng);
    const size = o.kind === "fauna" ? (CREATURES_BY_NAME.get(o.species)?.size ?? 1) : 1;
    if (count * size > racks) return [];
    if (o.available < count * (o.kind === "fauna" ? FAUNA_MARGIN : FLORA_MARGIN)) return [];
    if (o.kind === "fauna") {
      const entry = CREATURES_BY_NAME.get(o.species);
      if (!entry || speciesCaptureChance(state, entry) < SPECIMEN_JOB_MIN_CAPTURE) return [];
    }
    return [{ o, count }];
  });
  if (options.length === 0) return null;
  // Common species come up more often; animals now and then.
  const { o, count } = rng.weighted(options.map((x) => [x, (x.o.rarity === 1 ? 4 : x.o.rarity === 2 ? 2 : 1) * (x.o.kind === "fauna" ? 0.7 : 1)] as const));
  const entry = o.kind === "fauna" ? CREATURES_BY_NAME.get(o.species) : undefined;
  const priceMult = FLORA_BY_NAME.get(o.species)?.priceMult ?? entry?.priceMult ?? 1;
  const names = o.bodyIds.map((id) => world.body(id).body.name);
  const where = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  // Well above what the Lyceum pays over the counter, with the trip out and, for animals, the risk on top.
  const reward = Math.round((count * SPECIMEN_PRICE * priceMult * 1.8 + 300 * o.nearestLy + (o.kind === "fauna" ? 2_500 : 1_500)) / 50) * 50;
  const what = o.kind === "fauna" ? `${count} live ${o.species}${count === 1 ? "" : "s"}` : `${count} ${o.species} sample${count === 1 ? "" : "s"}`;
  return {
    id: `specimens-${serial}`,
    clan: "lyceum",
    kind: "specimens",
    title: `Lyceum: ${what}`,
    text:
      o.kind === "fauna"
        ? `The Lyceum's zoologists want ${what}, taken unhurt. Scouts have reported them on ${where}.`
        : `The Lyceum's botanists want ${what} for the seed vaults. It's known to grow on ${where}.`,
    species: o.species,
    bodyIds: o.bodyIds,
    count,
    reward,
    durationDays: rng.int(240, 360),
    deadline: null,
    status: "offered",
  };
}
