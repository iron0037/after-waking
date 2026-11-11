/**
 * The clans' outposts (AW-23): small, permanent establishments on planet surfaces. Where they stand
 * comes from the seed alone, like the stars, so careers already under way get them too and nothing
 * already generated moves. How many there are is a universe setting (0–7, default 3); the seed picks
 * which clans. Each clan settles where it would want to be: the Lyceum on a living world, the Diggers
 * on the richest ground, the Freebooters somewhere out of the way, and so on.
 */
import { COMMODITIES } from "../data/commodities";
import { OUTPOST_TYPES } from "../data/outposts";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import type { Body } from "./bodies";
import { pirateActivity } from "./combat";
import { distanceLy, type StarSystem } from "./galaxy";
import { tierOf } from "./reputation";
import { rngFor } from "./rng";
import { outpostCountOf } from "./settings";
import type { GameState } from "./state";
import { dist, type Vec2 } from "./units";
import type { World } from "./world";

export interface Outpost {
  id: string;
  clan: ClanId;
  /** "research station", "pirate's den" ... */
  kind: string;
  name: string;
  systemId: string;
  bodyId: string;
  region: number;
  /** The landing pad, planet-wide: the ship sets down here. */
  pad: Vec2;
  population: number;
}

/** Clans in the order the seed considers them; the first N get an outpost. */
const CLANS: ClanId[] = ["lyceum", "freebooters", "diggers", "exchange", "covenant", "midshipmen", "helm"];

interface Candidate {
  sys: StarSystem;
  body: Body;
  ly: number;
}

const gentle = (b: Body) => b.gravityG <= 1.3 && b.pressureAtm <= 2.5;
const oreValue = (b: Body) => Object.entries(b.resources).reduce((v, [id, r]) => v + (r ?? 0) * (COMMODITIES[id as keyof typeof COMMODITIES]?.basePrice ?? 0), 0);

/** How much a clan wants to settle here; 0 means never. */
function appeal(clan: ClanId, c: Candidate, world: World, isolation: number): number {
  const { sys, body, ly } = c;
  switch (clan) {
    case "lyceum":
      // A living world, the nearer the better.
      return body.life && !sys.home ? (ly <= 15 ? 2 : 1) : 0;
    case "freebooters":
      // Out of the way: uncharted, past the busy lanes but still where the raiders work.
      return !sys.charted && !sys.home && ly >= 10 && ly <= 22 ? 1 + isolation : 0;
    case "diggers":
      // The richest ground within reach.
      return sys.home ? 0 : (oreValue(body) / 100) * (ly <= 14 ? 1 : 0.4);
    case "exchange":
      // A busy charted lane, an easy landing.
      return sys.charted ? (gentle(body) ? 2 : 0.3) / (1 + ly / 4) : 0;
    case "covenant":
      // Dead, airless and quiet, toward the edge.
      return !sys.home && body.pressureAtm < 0.01 && body.gravityG <= 1 ? ly : 0;
    case "midshipmen":
      // On the main routes: a charted system, a fold or so out, with a solid place to build.
      return sys.charted && !sys.home ? (gentle(body) ? 1.5 : 0.5) / (1 + Math.abs(ly - 9) / 3) : 0;
    case "helm":
      // Where the raiders are worst.
      return sys.charted && !sys.home ? pirateActivity(world, sys.id) * (gentle(body) ? 1.5 : 1) * 10 : 0;
  }
}

const cache = new WeakMap<World, readonly Outpost[]>();

/** Every outpost in this universe, by the seed (empty with the setting at 0). */
export function outposts(world: World): readonly Outpost[] {
  const hit = cache.get(world);
  if (hit) return hit;
  const seed = world.seed;
  const n = outpostCountOf(seed);
  const order = [...CLANS];
  const shuffle = rngFor(seed, "outpost-clans");
  for (let i = order.length - 1; i > 0; i--) {
    const j = shuffle.int(0, i);
    [order[i], order[j]] = [order[j] as ClanId, order[i] as ClanId];
  }
  const candidates: Candidate[] = [];
  for (const sys of world.galaxy.systems) {
    const ly = distanceLy(world.galaxy, "intrepid", sys.id);
    for (const body of world.system(sys.id).bodies) if (body.regions > 0) candidates.push({ sys, body, ly });
  }
  // How far each star is from its nearest neighbor, in ly (the den likes lonely stars).
  const isolation = new Map(
    world.galaxy.systems.map((s) => [s.id, Math.min(...world.galaxy.systems.filter((o) => o.id !== s.id).map((o) => dist(o.pos, s.pos)))]),
  );
  const used = new Set<string>(); // "bodyId#region": one outpost to a region
  const out: Outpost[] = [];
  for (const clan of order.slice(0, n)) {
    const rng = rngFor(seed, "outpost", clan);
    let best: { c: Candidate; score: number } | null = null;
    for (const c of candidates) {
      const free = Array.from({ length: c.body.regions }, (_, r) => r).some((r) => !used.has(`${c.body.id}#${r}`));
      if (!free) continue;
      // A little seeded variety, so the same kind of world doesn't always win; clans would rather not crowd one
      // star, and the most crushing worlds (beyond what a Bulker can face) are a last resort, not a first choice.
      const crowded = out.some((o) => o.systemId === c.sys.id) ? 0.6 : 1;
      const brutal = c.body.pressureAtm > 15 || c.body.gravityG > 2.2 ? 0.4 : 1;
      const score = appeal(clan, c, world, isolation.get(c.sys.id) ?? 0) * crowded * brutal * rng.range(0.75, 1.25);
      if (score > 0 && (!best || score > best.score)) best = { c, score };
    }
    if (!best) continue;
    const { sys, body } = best.c;
    const regions = Array.from({ length: body.regions }, (_, r) => r).filter((r) => !used.has(`${body.id}#${r}`));
    const region = regions[rng.int(0, regions.length - 1)] as number;
    used.add(`${body.id}#${region}`);
    const type = OUTPOST_TYPES[clan];
    out.push({
      id: `outpost-${clan}`,
      clan,
      kind: type.kind,
      name: rngFor(seed, "outpost-name", clan).pick(type.names),
      systemId: sys.id,
      bodyId: body.id,
      region,
      pad: world.surface(body.id).landing(region),
      population: Math.round(rng.int(type.population[0], type.population[1]) / 5) * 5,
    });
  }
  cache.set(world, out);
  return out;
}

export function outpostById(world: World, id: string): Outpost | undefined {
  return outposts(world).find((o) => o.id === id);
}

/** The outpost in this region of this world, if any. */
export function outpostAt(world: World, bodyId: string, region: number): Outpost | undefined {
  return outposts(world).find((o) => o.bodyId === bodyId && o.region === region);
}

/**
 * Whether the captain knows the outpost is there. Every clan's outpost is on the Intrepid's charts
 * except the pirate's den: you find that by visiting its system, or the Freebooters tell you once
 * they count you a friend.
 */
export function outpostKnown(state: GameState, o: Outpost): boolean {
  if (o.clan !== "freebooters") return true;
  if (state.visitedSystems.includes(o.systemId)) return true;
  const tier = tierOf(state, "freebooters");
  return tier === "friendly" || tier === "trusted";
}

/** The outposts the captain knows of. */
export function knownOutposts(state: GameState, world: World): Outpost[] {
  return outposts(world).filter((o) => outpostKnown(state, o));
}

/** "Linnaeus Station, a Lyceum research station" */
export function outpostTitle(o: Outpost): string {
  const clan = CLAN_NAMES[o.clan];
  return `${o.name}, ${/^[AEIOU]/.test(clan) ? "an" : "a"} ${clan} ${o.kind}`;
}
