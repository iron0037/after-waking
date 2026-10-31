/**
 * Planet surfaces. A world is split into many regions; each landing explores one region, shown
 * as a top-down tile map (one tile ≈ 2 km). Terrain and deposits regenerate from the seed;
 * what the player has discovered or dug out is stored separately in RegionKnowledge.
 */
import { SEAS } from "../data/seas";
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { climateOf, FLORA } from "../data/catalog";
import type { Body } from "./bodies";
import { generateGalaxy, INTREPID_POS, type Galaxy } from "./galaxy";
import { hashSeed, rngFor, type Rng } from "./rng";
import { disk, hexDistance, hexWorldPos, ring } from "./hex";
import { clamp, dist, type Vec2 } from "./units";

export const REGION_SIZE = 48;
export const TILE_KM = 2;

export const Terrain = {
  plain: 0,
  rough: 1,
  mountain: 2,
  ice: 3,
  liquid: 4,
  lava: 5,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

export const TERRAIN_INFO: Record<Terrain, { name: string; minutes: number; energy: number; passable: "yes" | "climb" | "no" }> = {
  [Terrain.plain]: { name: "Plain", minutes: 8, energy: 1, passable: "yes" },
  [Terrain.rough]: { name: "Rough ground", minutes: 20, energy: 2.5, passable: "yes" },
  [Terrain.mountain]: { name: "Mountains", minutes: 45, energy: 4, passable: "climb" },
  [Terrain.ice]: { name: "Ice", minutes: 12, energy: 1.5, passable: "yes" },
  [Terrain.liquid]: { name: "Liquid", minutes: 0, energy: 0, passable: "no" },
  [Terrain.lava]: { name: "Lava", minutes: 0, energy: 0, passable: "no" },
};

/** What a terrain is called on this world: its liquid is "Liquid methane" (or ammonia, sulfuric acid) where the seas aren't water (AW-189). */
export function terrainName(body: Pick<Body, "sea">, terrain: Terrain): string {
  if (terrain === Terrain.liquid && body.sea) {
    const liquid = SEAS[body.sea].liquid;
    return liquid.charAt(0).toUpperCase() + liquid.slice(1);
  }
  return TERRAIN_INFO[terrain].name;
}

export interface DepositSpec {
  id: number;
  /** Only crews with Hidden Seams (geology) can detect it. */
  hidden?: boolean;
  commodity: CommodityId;
  /** 0..1: fraction of extracted rock that is worth keeping. */
  grade: number;
  depthM: number;
  tonnes: number;
}

export interface Deposit extends DepositSpec {
  x: number;
  y: number;
}

export interface FloraSpec {
  id: number;
  /** Only crews with an Ecologist can spot it. */
  hidden?: boolean;
  species: string;
}

export interface FloraSite extends FloraSpec {
  x: number;
  y: number;
}

export interface RegionMap {
  bodyId: string;
  region: number;
  /** Planet-wide hex coordinates of this region's (0, 0) tile. */
  origin: Vec2;
  width: number;
  height: number;
  terrain: Uint8Array;
  elevation: Float32Array;
  deposits: Deposit[];
  /** Specimen sites, on living worlds only. */
  flora: FloraSite[];
  landing: Vec2;
}

/** What the player knows about a region. Lives in the save file. */
export interface RegionKnowledge {
  discovered: number[];
  prospected: number[];
  drillSites: number[];
  /** Tonnes already removed from each deposit. */
  extracted: Record<number, number>;
  visits: number;
  /** Flora sites spotted by the rover, and those already sampled. */
  floraFound: number[];
  floraSampled: number[];
  /** Deposits and plant sites sensed but not yet identified (shown as "?" until the sensors get close). */
  sensed?: number[];
  floraSensed?: number[];
  /** Tiles swept by rover sensors, as a bitset of 32-bit words (row-major). The "painted" map. */
  explored: number[];
}

export function regionKey(bodyId: string, region: number): string {
  return `${bodyId}#${region}`;
}

export function emptyKnowledge(): RegionKnowledge {
  return {
    discovered: [],
    prospected: [],
    drillSites: [],
    extracted: {},
    visits: 0,
    floraFound: [],
    floraSampled: [],
    explored: [],
  };
}

/** Fill in fields added since a save was written. */
export function normalizeKnowledge(k: RegionKnowledge): RegionKnowledge {
  k.floraFound ??= [];
  k.floraSampled ??= [];
  k.explored ??= [];
  return k;
}

const TILES = REGION_SIZE * REGION_SIZE;

export function isExplored(k: RegionKnowledge, x: number, y: number): boolean {
  const i = y * REGION_SIZE + x;
  return (((k.explored[i >> 5] ?? 0) >>> (i & 31)) & 1) === 1;
}

/** Mark every tile within `radius` hex steps of (cx, cy) as swept. Returns how many were new. */
export function markExplored(k: RegionKnowledge, cx: number, cy: number, radius: number): number {
  let fresh = 0;
  for (const { x, y } of disk({ x: cx, y: cy }, radius)) {
    if (x < 0 || y < 0 || x >= REGION_SIZE || y >= REGION_SIZE) continue;
    {
      const i = y * REGION_SIZE + x;
      const word = k.explored[i >> 5] ?? 0;
      const bit = 1 << (i & 31);
      if ((word & bit) === 0) {
        k.explored[i >> 5] = (word | bit) | 0;
        fresh++;
      }
    }
  }
  return fresh;
}

/** Fraction of the region's tiles the rover has swept, 0..1. */
export function exploredFraction(k: RegionKnowledge | undefined): number {
  if (!k?.explored?.length) return 0;
  let count = 0;
  for (const word of k.explored) {
    let w = word >>> 0;
    while (w) {
      w &= w - 1;
      count++;
    }
  }
  return count / TILES;
}

/** The handful of catalogued plant species that grow on a living world, by climate; stable per body. */
export function bodySpecies(seed: number, body: Body): string[] {
  // Life on a world with exotic seas lives in the sea (AW-189).
  if (!body.life || body.sea) return [];
  const rng = rngFor(seed, body.id, "species");
  const climate = climateOf(body.tempC);
  // Land plants only: sea life has its own list (aquaticSpecies), so adding it never reshuffles these.
  const pool = FLORA.filter((f) => !f.aquatic && f.climates.includes(climate));
  const names = new Set<string>();
  const want = Math.min(pool.length, rng.int(3, 6));
  for (let guard = 0; names.size < want && guard < 200; guard++) {
    names.add(rng.weighted(pool.map((f) => [f.name, f.rarity === 1 ? 6 : f.rarity === 2 ? 3 : 1] as const)));
  }
  return [...names];
}

/** Sea life on a living world with open water (AW-17), from its own stream. */
export function aquaticSpecies(seed: number, body: Body): string[] {
  if (!body.life) return [];
  const sea = body.sea;
  if (!sea && ((body.kind !== "terrestrial" && body.kind !== "ocean") || body.tempC < -10)) return [];
  const climate = climateOf(body.tempC);
  // Water life lives in water; methane life only in methane (AW-189).
  const pool = FLORA.filter((f) => f.aquatic && (sea ? f.seas?.includes(sea) : !f.seas && f.climates.includes(climate)));
  if (pool.length === 0) return [];
  const rng = rngFor(seed, body.id, "sea-species");
  const names = new Set<string>();
  const want = Math.min(pool.length, rng.int(2, 3));
  for (let guard = 0; names.size < want && guard < 100; guard++) {
    names.add(rng.weighted(pool.map((f) => [f.name, f.rarity === 1 ? 6 : f.rarity === 2 ? 3 : 1] as const)));
  }
  return [...names];
}

/** Seabed deposits and sea-life sites get ids from here up, clear of the land sites and hidden layers. */
export const SEA_ID_BASE = 100;

/**
 * Seabed deposits and sea life in a region with open water (AW-17). Their own random streams, so
 * no land site ever moves. The first scouts had no boats: nothing at sea has been worked.
 */
function seaSites(seed: number, body: Body, region: number, terrain: Uint8Array, w: number, h: number): { deposits: Deposit[]; flora: FloraSite[] } {
  const water: number[] = [];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (terrain[y * w + x] === Terrain.liquid) water.push(y * w + x);
  if (water.length < w * h * 0.05) return { deposits: [], flora: [] };
  const rng = rngFor(seed, body.id, region, "sea");
  const at = (): Vec2 => {
    const i = water[rng.int(0, water.length - 1)] as number;
    return { x: i % w, y: Math.floor(i / w) };
  };
  // Exotic seas hold what they're made of, and what's dissolved in them (AW-189).
  const exotic = body.sea ? SEAS[body.sea].dredge : null;
  const entries = exotic ?? (Object.entries(body.resources) as [CommodityId, number][]);
  const nDeposits = entries.length === 0 ? 0 : body.kind === "ocean" ? rng.int(2, 4) : exotic ? rng.int(2, 3) : rng.int(0, 2);
  const scale = frontierTonnage(seed, body);
  const deposits: Deposit[] = Array.from({ length: nDeposits }, (_, i) => {
    const spec = depositSpec(rng, body, entries, exotic ? 2.5 : rng.range(0.5, 1.3), SEA_ID_BASE + i);
    return { ...spec, tonnes: Math.max(5, Math.round(spec.tonnes * scale)), ...at() };
  });
  const species = aquaticSpecies(seed, body);
  const flora: FloraSite[] =
    species.length === 0 ? [] : Array.from({ length: rng.int(1, 3) }, (_, i) => ({ id: SEA_ID_BASE + i, species: rng.pick(species), ...at() }));
  return { deposits, flora };
}

/** Specimen sites in one region of a living world. */
export function regionFlora(seed: number, body: Body, region: number): FloraSpec[] {
  const species = bodySpecies(seed, body);
  if (species.length === 0) return [];
  const rng = rngFor(seed, body.id, region, "flora");
  return Array.from({ length: rng.int(2, 5) }, (_, id) => ({ id, species: rng.pick(species) }));
}

/**
 * Life signs from orbit: how many plant sites a region holds (the ordinary ones; the hidden layer
 * needs an Ecologist on the ground). Cheap enough to compute for every region.
 */
export function regionLifeSignal(seed: number, body: Body, region: number): number {
  return regionFlora(seed, body, region).length;
}

const galaxyCache = new Map<number, Galaxy>();
function galaxyFor(seed: number): Galaxy {
  let g = galaxyCache.get(seed);
  if (!g) {
    g = generateGalaxy(seed);
    galaxyCache.clear();
    galaxyCache.set(seed, g);
  }
  return g;
}

export type Frontier = "home" | "charted" | "uncharted";

/** How picked-over a body's system is: the first scouts worked the home and charted stars. */
export function frontierOf(seed: number, body: Body): { frontier: Frontier; ly: number } {
  const sysId = body.id.split(".")[0] as string;
  const sys = galaxyFor(seed).systems.find((s) => s.id === sysId);
  if (!sys) return { frontier: "uncharted", ly: 0 };
  const ly = dist(sys.pos, INTREPID_POS);
  return { frontier: sys.home ? "home" : sys.charted ? "charted" : "uncharted", ly };
}

/**
 * Seams left in the ground. Home and charted worlds were skimmed by the first scouts; past the
 * charted stars the seams are richer, and grow richer the farther out you go (1.25x to 1.8x).
 */
export function frontierTonnage(seed: number, body: Body): number {
  const { frontier, ly } = frontierOf(seed, body);
  if (frontier === "home") return 0.9;
  if (frontier === "charted") return 1;
  return Math.min(1.8, 1.25 + 0.05 * Math.max(0, ly - 6));
}

/** Share of a world's deposits the scouts already worked out (they're simply gone). */
export function scoutedShare(seed: number, body: Body): number {
  const { frontier } = frontierOf(seed, body);
  return frontier === "home" ? 0.2 : frontier === "charted" ? 0.1 : 0;
}

/** Was this deposit worked out by the first scouts? Deterministic per deposit; decided after placement. */
export function scoutedOut(seed: number, body: Body, region: number, id: number): boolean {
  const share = scoutedShare(seed, body);
  return share > 0 && (hashSeed(seed, body.id, region, id, "scouted") % 1000) / 1000 < share;
}

/**
 * Every deposit the generator rolls for a region, scouted-out ones included, with tonnage scaled for
 * the frontier. Placement walks this full list so positions (and plant sites after them) never shift.
 */
export function rawRegionDeposits(seed: number, body: Body, region: number): DepositSpec[] {
  const scale = frontierTonnage(seed, body);
  return rolledDeposits(seed, body, region).map((d) => ({ ...d, tonnes: Math.max(5, Math.round(d.tonnes * scale)) }));
}

/** Deposit list without positions (what's actually left); cheap enough for every region in an orbital scan. */
export function regionDeposits(seed: number, body: Body, region: number): DepositSpec[] {
  return rawRegionDeposits(seed, body, region).filter((d) => !scoutedOut(seed, body, region, d.id));
}

function rolledDeposits(seed: number, body: Body, region: number): DepositSpec[] {
  const rng = rngFor(seed, body.id, region, "deposits");
  const entries = Object.entries(body.resources) as [CommodityId, number][];
  if (entries.length === 0) return [];
  // Home worlds: reliable but modest, since the first scouts skimmed the best seams.
  const richness = body.easy ? rng.range(0.45, 0.9) : rng.range(0.3, 1.6);
  const count = Math.round(rng.range(3, 9) * richness * (body.kind === "asteroid" ? 0.6 : 1));
  const deposits: DepositSpec[] = [];
  for (let i = 0; i < count; i++) deposits.push(depositSpec(rng, body, entries, richness, i));
  return deposits;
}

function depositSpec(rng: Rng, body: Body, entries: [CommodityId, number][], richness: number, id: number): DepositSpec {
  const commodity = rng.weighted(entries);
  const abundance = body.resources[commodity] ?? 0.2;
  const grade = clamp(abundance * rng.range(0.25, 0.9) * richness, 0.05, 1);
  // Precious ores come in smaller seams; shallow seams are more common than deep ones.
  const sizeScale = clamp(Math.sqrt(150 / COMMODITIES[commodity].basePrice), 0.25, 1.6);
  return {
    id,
    commodity,
    grade: Math.round(grade * 100) / 100,
    // Home worlds: the first scouts drilled the shallow seams' cores; most are within a starter drill's reach.
    depthM: Math.round(15 + (body.easy ? 385 : 885) * Math.pow(rng.next(), 1.7)),
    tonnes: Math.round(rng.range(30, 260) * (0.5 + grade) * sizeScale),
  };
}

/**
 * The hidden layer (Hidden Seams): about one extra deposit per two regions, from its own random
 * stream so the ordinary deposits never change. Ids continue after the ordinary ones.
 */
export function hiddenDeposits(seed: number, body: Body, region: number, firstId: number): DepositSpec[] {
  const entries = Object.entries(body.resources) as [CommodityId, number][];
  if (entries.length === 0) return [];
  const rng = rngFor(seed, body.id, region, "hidden-deposits");
  const count = rng.chance(0.5) ? 1 : 0;
  // The seams other crews miss are the good ones: the world's pricier minerals, at a high grade.
  const valued = entries.map(([id, a]) => [id, a * COMMODITIES[id].basePrice] as [CommodityId, number]);
  return Array.from({ length: count }, (_, i) => {
    const spec = depositSpec(rng, body, valued, rng.range(1.1, 1.6), firstId + i);
    return { ...spec, tonnes: Math.round(spec.tonnes * 1.5), hidden: true };
  });
}

/** The hidden layer of plant sites (Ecologist): one or two per region on living worlds. */
export function hiddenFlora(seed: number, body: Body, region: number, firstId: number): FloraSpec[] {
  const species = bodySpecies(seed, body);
  if (species.length === 0) return [];
  const rng = rngFor(seed, body.id, region, "hidden-flora");
  return Array.from({ length: rng.int(1, 2) }, (_, i) => ({ id: firstId + i, species: rng.pick(species), hidden: true }));
}

/**
 * Estimated value of a region's deposits, blurred by sensor quality (tier 3+ is exact).
 * Tier 1 sees surface signatures only, so it counts every seam. Tier 2+ penetrates the crust:
 * given `reachM` (the drill's reach) it counts only value the ship can actually dig out.
 */
export function regionSignal(seed: number, body: Body, region: number, sensorTier: number, reachM = Infinity): number {
  const depthAware = sensorTier >= 2;
  const truth = regionDeposits(seed, body, region)
    .filter((d) => !depthAware || d.depthM <= reachM)
    .reduce((sum, d) => sum + d.tonnes * d.grade * COMMODITIES[d.commodity].basePrice, 0);
  const blur = sensorTier >= 3 ? 0 : sensorTier === 2 ? 0.2 : 0.5;
  const noise = rngFor(seed, body.id, region, "signal", sensorTier).range(-blur, blur);
  return Math.max(0, truth * (1 + noise));
}

/**
 * How a world's regions tile its surface: a grid of `cols` × `rows` regions, numbered row by
 * row from the north-west. Region n sits at column n % cols, row floor(n / cols); the last row
 * may be partly empty. Planet-wide hex coordinates run 0..width-1 by 0..height-1.
 */
export interface SurfaceLayout {
  cols: number;
  rows: number;
  regions: number;
  width: number;
  height: number;
}

export function surfaceLayout(body: Body): SurfaceLayout {
  const regions = Math.max(1, body.regions);
  const rows = Math.max(1, Math.round(Math.sqrt(regions / 2)));
  const cols = Math.ceil(regions / rows);
  return { cols, rows, regions, width: cols * REGION_SIZE, height: rows * REGION_SIZE };
}

export function regionOrigin(layout: SurfaceLayout, region: number): Vec2 {
  return { x: (region % layout.cols) * REGION_SIZE, y: Math.floor(region / layout.cols) * REGION_SIZE };
}

/** The region containing planet-wide tile (gx, gy), or null off the surface. */
export function regionAt(layout: SurfaceLayout, gx: number, gy: number): number | null {
  if (gx < 0 || gy < 0 || gx >= layout.width || gy >= layout.height) return null;
  const region = Math.floor(gy / REGION_SIZE) * layout.cols + Math.floor(gx / REGION_SIZE);
  return region < layout.regions ? region : null;
}

/**
 * Terrain is one continuous field across the whole planet, so neighboring regions meet
 * seamlessly. (Regions are 48 rows tall, an even number, so hex row parity is preserved.)
 */
export function generateRegion(seed: number, body: Body, region: number): RegionMap {
  const w = REGION_SIZE;
  const h = REGION_SIZE;
  const origin = regionOrigin(surfaceLayout(body), region);
  const noiseSeed = hashSeed(seed, body.id, "terrain");
  const seaSeed = hashSeed(seed, body.id, "sea");
  const ruggedness = 0.15 * body.tectonics + (body.kind === "asteroid" ? 0.3 : 0);

  const elevation = new Float32Array(w * h);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Sample at each hex's true centre in planet-wide space: no row skew, no seams.
      const p = hexWorldPos(origin.x + x, origin.y + y);
      const e = fbm(noiseSeed, p.x / 14, p.y / 14, 4);
      const rough = fbm(noiseSeed ^ 0x9e3779b9, p.x / 5, p.y / 5, 2);
      // Sea level drifts slowly across the planet: wetter basins, drier highlands.
      const seaLevel = (fbm(seaSeed, p.x / 140, p.y / 140, 2) - 0.5) * 0.3;
      const i = y * w + x;
      elevation[i] = e;
      terrain[i] = classify(body, e, rough, seaLevel, ruggedness);
    }
  }

  const landing = findLanding(terrain, w, h);
  const placeRng = rngFor(seed, body.id, region, "placement");
  const rolled = rawRegionDeposits(seed, body, region);
  const placed: Deposit[] = rolled.map((spec) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = placeRng.int(1, w - 2);
      const y = placeRng.int(1, h - 2);
      const t = terrain[y * w + x] as Terrain;
      // On ocean worlds most seams lie under the sea, for the boat to dredge.
      if (TERRAIN_INFO[t].passable === "no" && !(body.kind === "ocean" && t === Terrain.liquid)) continue;
      if (hexDistance({ x, y }, landing) < 4) continue;
      return { ...spec, x, y };
    }
    return { ...spec, x: landing.x + 3, y: landing.y };
  });

  // The scouts' worked-out seams are gone; the rest keep their places (and their ids).
  const deposits: Deposit[] = placed.filter((d) => !scoutedOut(seed, body, region, d.id));

  const flora: FloraSite[] = regionFlora(seed, body, region).map((spec) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = placeRng.int(1, w - 2);
      const y = placeRng.int(1, h - 2);
      const t = terrain[y * w + x] as Terrain;
      if (TERRAIN_INFO[t].passable !== "yes") continue;
      if (hexDistance({ x, y }, landing) < 3) continue;
      return { ...spec, x, y };
    }
    return { ...spec, x: landing.x, y: landing.y + 2 };
  });

  // The hidden layers, placed with their own stream so the ordinary sites above never move.
  const hiddenRng = rngFor(seed, body.id, region, "hidden-placement");
  const spot = (minFromLanding: number, needYes: boolean): Vec2 => {
    for (let tries = 0; tries < 200; tries++) {
      const x = hiddenRng.int(1, w - 2);
      const y = hiddenRng.int(1, h - 2);
      const passable = TERRAIN_INFO[terrain[y * w + x] as Terrain].passable;
      if (passable === "no" || (needYes && passable !== "yes")) continue;
      if (hexDistance({ x, y }, landing) < minFromLanding) continue;
      return { x, y };
    }
    return { x: landing.x + 2, y: landing.y + 2 };
  };
  for (const spec of hiddenDeposits(seed, body, region, rolled.length)) deposits.push({ ...spec, ...spot(4, false) });
  for (const spec of hiddenFlora(seed, body, region, flora.length)) flora.push({ ...spec, ...spot(3, true) });

  const sea = seaSites(seed, body, region, terrain, w, h);
  deposits.push(...sea.deposits);
  flora.push(...sea.flora);

  return { bodyId: body.id, region, origin, width: w, height: h, terrain, elevation, deposits, flora, landing };
}

/** Elevation below which a world with exotic seas is sea: lowland seas and lakes, like a terrestrial world's. */
export const EXOTIC_SEA_LEVEL = 0.34;

/** Elevation below which an ocean world is sea: about three-quarters water, in island chains (terrestrial worlds use 0.32). */
export const OCEAN_SEA_LEVEL = 0.6;

function classify(body: Body, e: number, rough: number, seaLevel: number, ruggedness: number): Terrain {
  const mountainLine = 0.78 - ruggedness * 0.15;
  const roughLine = 0.62 - ruggedness * 0.1;
  const frozen = body.tempC < -10;

  if (body.kind === "volcanic" && e < 0.22 + seaLevel * 0.5) return Terrain.lava;
  // Exotic seas (AW-189): the lowlands hold liquid ammonia, methane or acid, never frozen.
  if (body.sea && e < EXOTIC_SEA_LEVEL + seaLevel) return Terrain.liquid;
  // Ocean worlds are open sea with island chains; terrestrial worlds have lakes and inland seas.
  if ((body.kind === "terrestrial" || body.kind === "ocean") && e < (body.kind === "ocean" ? OCEAN_SEA_LEVEL : 0.32) + seaLevel) {
    return frozen ? Terrain.ice : Terrain.liquid;
  }
  if (e > mountainLine) return Terrain.mountain;
  if (body.kind === "ice") return e > roughLine || rough > 0.72 ? Terrain.rough : Terrain.ice;
  if (e > roughLine || rough > 0.7 - ruggedness * 0.2) return Terrain.rough;
  return Terrain.plain;
}

function findLanding(terrain: Uint8Array, w: number, h: number): Vec2 {
  const center = { x: Math.floor(w / 2), y: Math.floor(h / 2) };
  for (let r = 0; r < Math.max(w, h); r++) {
    for (const { x, y } of ring(center, r)) {
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const t = terrain[y * w + x];
      if (t === Terrain.plain || t === Terrain.ice) return { x, y };
    }
  }
  return center;
}

export function terrainAt(map: RegionMap, x: number, y: number): Terrain | null {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return map.terrain[y * map.width + x] as Terrain;
}

// --- noise -------------------------------------------------------------------------------

function lattice(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = lattice(seed, x0, y0);
  const b = lattice(seed, x0 + 1, y0);
  const c = lattice(seed, x0, y0 + 1);
  const d = lattice(seed, x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Fractal value noise in [0, 1]. */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(seed + o * 1013, x * freq, y * freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}
