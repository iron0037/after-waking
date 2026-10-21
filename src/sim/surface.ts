/**
 * Planet surfaces. A world is split into many regions; each landing explores one region, shown
 * as a top-down tile map (one tile ≈ 2 km). Terrain and deposits regenerate from the seed;
 * what the player has discovered or dug out is stored separately in RegionKnowledge.
 */
import { COMMODITIES, type CommodityId } from "../data/commodities";
import { FLORA_PREFIX, FLORA_SUFFIX } from "../data/names";
import type { Body } from "./bodies";
import { hashSeed, rngFor } from "./rng";
import { clamp, type Vec2 } from "./units";

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

export interface DepositSpec {
  id: number;
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
  species: string;
}

export interface FloraSite extends FloraSpec {
  x: number;
  y: number;
}

export interface RegionMap {
  bodyId: string;
  region: number;
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

/** Mark every tile within `radius` (Chebyshev) of (cx, cy) as swept. Returns how many were new. */
export function markExplored(k: RegionKnowledge, cx: number, cy: number, radius: number): number {
  let fresh = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(REGION_SIZE - 1, cy + radius); y++) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(REGION_SIZE - 1, cx + radius); x++) {
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

/** The handful of plant species that grow on a living world; stable per body. */
export function bodySpecies(seed: number, body: Body): string[] {
  if (!body.life) return [];
  const rng = rngFor(seed, body.id, "species");
  const names = new Set<string>();
  const want = rng.int(3, 6);
  while (names.size < want) names.add(`${rng.pick(FLORA_PREFIX)} ${rng.pick(FLORA_SUFFIX)}`);
  return [...names];
}

/** Specimen sites in one region of a living world. */
export function regionFlora(seed: number, body: Body, region: number): FloraSpec[] {
  const species = bodySpecies(seed, body);
  if (species.length === 0) return [];
  const rng = rngFor(seed, body.id, region, "flora");
  return Array.from({ length: rng.int(2, 5) }, (_, id) => ({ id, species: rng.pick(species) }));
}

/** Deposit list without positions; cheap enough to compute for every region in an orbital scan. */
export function regionDeposits(seed: number, body: Body, region: number): DepositSpec[] {
  const rng = rngFor(seed, body.id, region, "deposits");
  const entries = Object.entries(body.resources) as [CommodityId, number][];
  if (entries.length === 0) return [];
  // Home worlds: reliable but modest, since the first scouts skimmed the best seams.
  const richness = body.easy ? rng.range(0.45, 0.9) : rng.range(0.3, 1.6);
  const count = Math.round(rng.range(3, 9) * richness * (body.kind === "asteroid" ? 0.6 : 1));
  const deposits: DepositSpec[] = [];
  for (let i = 0; i < count; i++) {
    const commodity = rng.weighted(entries);
    const abundance = body.resources[commodity] ?? 0.2;
    const grade = clamp(abundance * rng.range(0.25, 0.9) * richness, 0.05, 1);
    // Precious ores come in smaller seams; shallow seams are more common than deep ones.
    const sizeScale = clamp(Math.sqrt(150 / COMMODITIES[commodity].basePrice), 0.25, 1.6);
    deposits.push({
      id: i,
      commodity,
      grade: Math.round(grade * 100) / 100,
      // Home worlds: the first scouts drilled the shallow seams' cores; most are within a starter drill's reach.
      depthM: Math.round(15 + (body.easy ? 385 : 885) * Math.pow(rng.next(), 1.7)),
      tonnes: Math.round(rng.range(30, 260) * (0.5 + grade) * sizeScale),
    });
  }
  return deposits;
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

export function generateRegion(seed: number, body: Body, region: number): RegionMap {
  const w = REGION_SIZE;
  const h = REGION_SIZE;
  const noiseSeed = hashSeed(seed, body.id, region, "terrain");
  const regionRng = rngFor(seed, body.id, region, "layout");
  const seaLevel = regionRng.range(-0.15, 0.15);
  const ruggedness = 0.15 * body.tectonics + (body.kind === "asteroid" ? 0.3 : 0);

  const elevation = new Float32Array(w * h);
  const terrain = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = fbm(noiseSeed, x / 14, y / 14, 4);
      const rough = fbm(noiseSeed ^ 0x9e3779b9, x / 5, y / 5, 2);
      const i = y * w + x;
      elevation[i] = e;
      terrain[i] = classify(body, e, rough, seaLevel, ruggedness);
    }
  }

  const landing = findLanding(terrain, w, h);
  const placeRng = rngFor(seed, body.id, region, "placement");
  const deposits: Deposit[] = regionDeposits(seed, body, region).map((spec) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = placeRng.int(1, w - 2);
      const y = placeRng.int(1, h - 2);
      const t = terrain[y * w + x] as Terrain;
      if (TERRAIN_INFO[t].passable === "no") continue;
      if (Math.abs(x - landing.x) + Math.abs(y - landing.y) < 4) continue;
      return { ...spec, x, y };
    }
    return { ...spec, x: landing.x + 3, y: landing.y };
  });

  const flora: FloraSite[] = regionFlora(seed, body, region).map((spec) => {
    for (let tries = 0; tries < 200; tries++) {
      const x = placeRng.int(1, w - 2);
      const y = placeRng.int(1, h - 2);
      const t = terrain[y * w + x] as Terrain;
      if (TERRAIN_INFO[t].passable !== "yes") continue;
      if (Math.abs(x - landing.x) + Math.abs(y - landing.y) < 3) continue;
      return { ...spec, x, y };
    }
    return { ...spec, x: landing.x, y: landing.y + 2 };
  });

  return { bodyId: body.id, region, width: w, height: h, terrain, elevation, deposits, flora, landing };
}

function classify(body: Body, e: number, rough: number, seaLevel: number, ruggedness: number): Terrain {
  const mountainLine = 0.78 - ruggedness * 0.15;
  const roughLine = 0.62 - ruggedness * 0.1;
  const frozen = body.tempC < -10;

  if (body.kind === "volcanic" && e < 0.22 + seaLevel * 0.5) return Terrain.lava;
  if ((body.kind === "terrestrial" || body.kind === "ocean") && e < 0.32 + seaLevel) {
    return frozen ? Terrain.ice : Terrain.liquid;
  }
  if (e > mountainLine) return Terrain.mountain;
  if (body.kind === "ice") return e > roughLine || rough > 0.72 ? Terrain.rough : Terrain.ice;
  if (e > roughLine || rough > 0.7 - ruggedness * 0.2) return Terrain.rough;
  return Terrain.plain;
}

function findLanding(terrain: Uint8Array, w: number, h: number): Vec2 {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  for (let r = 0; r < Math.max(w, h); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const t = terrain[y * w + x];
        if (t === Terrain.plain || t === Terrain.ice) return { x, y };
      }
    }
  }
  return { x: cx, y: cy };
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
