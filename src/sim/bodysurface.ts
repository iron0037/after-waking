/**
 * A whole world's surface in planet-wide hex coordinates. Regions are storage chunks: terrain,
 * deposits and flora are generated per region (and cached by World), but the rover drives,
 * routes and senses across region borders as one continuous map.
 *
 * Sites (deposits and flora) are addressed by a key "region:id", since ids are per region.
 */
import type { Body } from "./bodies";
import {
  regionAt,
  regionOrigin,
  REGION_SIZE,
  surfaceLayout,
  type Deposit,
  type FloraSite,
  type RegionMap,
  type SurfaceLayout,
  type Terrain,
} from "./surface";
import type { Vec2 } from "./units";

export type SiteKey = string;

export function siteKey(region: number, id: number): SiteKey {
  return `${region}:${id}`;
}

export function parseSiteKey(key: SiteKey): { region: number; id: number } | null {
  const m = /^(\d+):(\d+)$/.exec(key);
  return m ? { region: Number(m[1]), id: Number(m[2]) } : null;
}

/** A deposit in planet-wide coordinates. `id` stays the region-local id used by RegionKnowledge. */
export interface SurfaceDeposit extends Deposit {
  key: SiteKey;
  region: number;
}

export interface SurfaceFlora extends FloraSite {
  key: SiteKey;
  region: number;
}

/** Anything the rover can be routed across. */
export interface TileSource {
  width: number;
  height: number;
  terrainAt(x: number, y: number): Terrain | null;
}

export class BodySurface implements TileSource {
  readonly layout: SurfaceLayout;
  readonly width: number;
  readonly height: number;

  constructor(
    readonly body: Body,
    private readonly regionMap: (region: number) => RegionMap,
  ) {
    this.layout = surfaceLayout(body);
    this.width = this.layout.width;
    this.height = this.layout.height;
  }

  region(region: number): RegionMap {
    return this.regionMap(region);
  }

  regionAt(gx: number, gy: number): number | null {
    return regionAt(this.layout, gx, gy);
  }

  origin(region: number): Vec2 {
    return regionOrigin(this.layout, region);
  }

  toGlobal(region: number, p: Vec2): Vec2 {
    const o = this.origin(region);
    return { x: o.x + p.x, y: o.y + p.y };
  }

  toLocal(gx: number, gy: number): { region: number; x: number; y: number } | null {
    const region = this.regionAt(gx, gy);
    if (region === null) return null;
    const o = this.origin(region);
    return { region, x: gx - o.x, y: gy - o.y };
  }

  terrainAt(gx: number, gy: number): Terrain | null {
    const local = this.toLocal(gx, gy);
    if (!local) return null;
    return this.regionMap(local.region).terrain[local.y * REGION_SIZE + local.x] as Terrain;
  }

  elevationAt(gx: number, gy: number): number | null {
    const local = this.toLocal(gx, gy);
    if (!local) return null;
    return this.regionMap(local.region).elevation[local.y * REGION_SIZE + local.x] ?? null;
  }

  /** The region's original landing site, in planet-wide coordinates. */
  landing(region: number): Vec2 {
    return this.toGlobal(region, this.regionMap(region).landing);
  }

  deposits(region: number): SurfaceDeposit[] {
    const o = this.origin(region);
    return this.regionMap(region).deposits.map((d) => ({ ...d, x: d.x + o.x, y: d.y + o.y, key: siteKey(region, d.id), region }));
  }

  flora(region: number): SurfaceFlora[] {
    const o = this.origin(region);
    return this.regionMap(region).flora.map((f) => ({ ...f, x: f.x + o.x, y: f.y + o.y, key: siteKey(region, f.id), region }));
  }

  deposit(key: SiteKey): SurfaceDeposit | null {
    const ref = parseSiteKey(key);
    if (!ref || ref.region >= this.layout.regions) return null;
    return this.deposits(ref.region).find((d) => d.id === ref.id) ?? null;
  }

  floraSite(key: SiteKey): SurfaceFlora | null {
    const ref = parseSiteKey(key);
    if (!ref || ref.region >= this.layout.regions) return null;
    return this.flora(ref.region).find((f) => f.id === ref.id) ?? null;
  }

  /** Regions overlapping the hex disk of `radius` around (gx, gy) (by bounding box). */
  regionsNear(center: Vec2, radius: number): number[] {
    const out = new Set<number>();
    for (const dy of [-radius, 0, radius]) {
      for (const dx of [-radius - 1, 0, radius + 1]) {
        const r = this.regionAt(center.x + dx, center.y + dy);
        if (r !== null) out.add(r);
      }
    }
    return [...out];
  }
}
