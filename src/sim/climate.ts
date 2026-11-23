/**
 * Latitude climate (AW-265, world generation 8): Earth-like and ocean worlds have ice caps toward the
 * poles, and terrestrial worlds a dry desert belt in the low latitudes, the way Earth's subtropics are.
 *
 * A planet's surface map unrolls like the region chart and the orbit art: longitude across, latitude
 * down, so a tile's row is its latitude. The caps follow the same size rule the orbit art always drew
 * (`polarCapLat`), so the world you land on matches the one you saw from orbit.
 *
 * Each zone has its own climate for life: cold-climate plants and animals near the caps, warm-climate
 * ones in the desert belt, and the world's own climate between.
 */
import { climateOf, type Climate } from "../data/catalog";
import type { Body } from "./bodies";
import { hashSeed } from "./rng";
import { fbm, REGION_SIZE, regionOrigin, surfaceLayout } from "./surface";

export const Zone = { temperate: 0, arid: 1, polar: 2 } as const;
export type Zone = (typeof Zone)[keyof typeof Zone];
export const ZONES: readonly Zone[] = [Zone.temperate, Zone.arid, Zone.polar];

/** Does this world have latitude climate? Generation 8's terrestrial and ocean worlds with water seas. */
export function hasClimateBands(body: Pick<Body, "climateBands">): boolean {
  return body.climateBands === true;
}

/**
 * Where a rocky world's polar caps begin, in radians of latitude, or null for a world too hot for any.
 * Colder worlds have bigger caps: about 83° at 15 °C, 61° at 0 °C. (The orbit art's long-standing rule.)
 */
export function polarCapLat(tempC: number): number | null {
  if (tempC > 45) return null;
  return Math.max(0.3, Math.min(1.42, 1.45 - (15 - tempC) * 0.025));
}

/** The desert belt's latitudes (radians), or null: about 15°–35°, wider on hot worlds; none on cool or ocean worlds. */
export function aridBelt(body: Pick<Body, "kind" | "tempC">): { lo: number; hi: number } | null {
  if (body.kind !== "terrestrial" || body.tempC < 5) return null;
  const hi = 0.61 + Math.max(-0.12, Math.min(0.25, (body.tempC - 15) * 0.01));
  const lo = 0.26 - Math.max(0, Math.min(0.12, (body.tempC - 25) * 0.005));
  return { lo, hi };
}

/** A tile's latitude in radians, 0 at the equator to π/2 at either pole. */
export function latitudeOf(gy: number, height: number): number {
  return Math.abs(((gy + 0.5) / height) * 2 - 1) * (Math.PI / 2);
}

/** The climate zone at planet tile (gx, gy). Zone edges wander with longitude, so they're ragged, not ruled. */
export function zoneAt(seed: number, body: Body, gx: number, gy: number): Zone {
  if (!hasClimateBands(body)) return Zone.temperate;
  const lat = latitudeOf(gy, surfaceLayout(body).height);
  const wobble = fbm(hashSeed(seed, body.id, "climate"), gx / 26, gy / 26, 3) - 0.5;
  const cap = polarCapLat(body.tempC);
  if (cap !== null && lat > cap + wobble * 0.35) return Zone.polar;
  const belt = aridBelt(body);
  if (!belt) return Zone.temperate;
  // The belt's edges wander by some ten degrees, and toward them the desert breaks up into patches with green between
  // (a slower field than the wobble): a solid core, a ragged fringe, never a ruled stripe.
  const lo = belt.lo + wobble * 0.5;
  const hi = belt.hi + (fbm(hashSeed(seed, body.id, "climate-hi"), gx / 22, gy / 22, 3) - 0.5) * 0.6;
  if (lat <= lo || lat >= hi) return Zone.temperate;
  const depth = Math.min(lat - lo, hi - lat) / Math.max(0.05, (hi - lo) / 2);
  const patch = fbm(hashSeed(seed, body.id, "climate-patch"), gx / 11, gy / 11, 3);
  return patch + depth * 0.7 > 0.62 ? Zone.arid : Zone.temperate;
}

/** The climate life lives in, in a zone: cold at the caps, warm in the desert belt, the world's own between. */
export function zoneClimate(body: Pick<Body, "tempC">, zone: Zone): Climate {
  return zone === Zone.polar ? "cold" : zone === Zone.arid ? "warm" : climateOf(body.tempC);
}

/**
 * A small cache for per-world climate answers, which are asked for on every region and every site. Keyed by seed and
 * body (and whether it has bands, so a generation 7 copy of the same world never reads a generation 8 answer).
 */
export function climateMemo<T>(): (seed: number, body: Body, extra: string, make: () => T) => T {
  const cache = new Map<string, T>();
  return (seed, body, extra, make) => {
    const key = `${seed}|${body.id}|${body.climateBands ? 1 : 0}|${extra}`;
    let hit = cache.get(key);
    if (hit === undefined) {
      if (cache.size > 20_000) cache.clear();
      hit = make();
      cache.set(key, hit);
    }
    return hit;
  };
}
const zonesMemo = climateMemo<Zone[]>();
const sharesMemo = climateMemo<Record<Zone, number>>();

/** Which zones a world has anywhere on it: the temperate band always, the caps and the belt where they reach. */
export function worldZones(seed: number, body: Body): Zone[] {
  if (!hasClimateBands(body)) return [Zone.temperate];
  return zonesMemo(seed, body, "", () => sampleWorldZones(seed, body));
}

function sampleWorldZones(seed: number, body: Body): Zone[] {
  const { width, height } = surfaceLayout(body);
  const seen = new Set<Zone>();
  for (let gy = 0; gy < height; gy += 4) for (let gx = 0; gx < width; gx += 16) seen.add(zoneAt(seed, body, gx, gy));
  seen.add(Zone.temperate);
  return ZONES.filter((z) => seen.has(z));
}

/** How much of a region lies in each zone, sampled on an 8×8 grid (shares sum to 1). */
export function regionZoneShares(seed: number, body: Body, region: number): Record<Zone, number> {
  if (!hasClimateBands(body)) return { [Zone.temperate]: 1, [Zone.arid]: 0, [Zone.polar]: 0 };
  return sharesMemo(seed, body, String(region), () => sampleShares(seed, body, region));
}

function sampleShares(seed: number, body: Body, region: number): Record<Zone, number> {
  const shares: Record<Zone, number> = { [Zone.temperate]: 0, [Zone.arid]: 0, [Zone.polar]: 0 };
  const o = regionOrigin(surfaceLayout(body), region);
  const step = REGION_SIZE / 8;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) shares[zoneAt(seed, body, o.x + 3 + i * step, o.y + 3 + j * step)] += 1 / 64;
  return shares;
}
