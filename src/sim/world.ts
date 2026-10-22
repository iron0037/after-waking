/**
 * Everything derivable from the galaxy seed, cached. Nothing in here is saved: a World is
 * rebuilt from GameState.seed on load.
 */
import { BodySurface } from "./bodysurface";
import { findBody, generateSystem, type Body, type SystemDetail } from "./bodies";
import { generateGalaxy, type Galaxy } from "./galaxy";
import { generateRegion, type RegionMap } from "./surface";

/** Rover routes and the surface camera span several regions; keep plenty cached (each is small). */
const REGION_CACHE_LIMIT = 96;

export class World {
  readonly galaxy: Galaxy;
  private readonly systems = new Map<string, SystemDetail>();
  private readonly regions = new Map<string, RegionMap>();
  private readonly surfaces = new Map<string, BodySurface>();

  constructor(readonly seed: number) {
    this.galaxy = generateGalaxy(seed);
  }

  system(systemId: string): SystemDetail {
    let detail = this.systems.get(systemId);
    if (!detail) {
      const sys = this.galaxy.systems.find((s) => s.id === systemId);
      if (!sys) throw new Error(`Unknown system ${systemId}`);
      detail = generateSystem(this.seed, sys);
      this.systems.set(systemId, detail);
    }
    return detail;
  }

  /** Body ids are prefixed with their system id: "s3.p2.m1" lives in "s3". */
  body(bodyId: string): { detail: SystemDetail; body: Body } {
    const detail = this.system(bodyId.split(".")[0] as string);
    return { detail, body: findBody(detail, bodyId) };
  }

  /** The whole surface of a world in planet-wide coordinates, stitched from its regions. */
  surface(bodyId: string): BodySurface {
    let surface = this.surfaces.get(bodyId);
    if (!surface) {
      surface = new BodySurface(this.body(bodyId).body, (r) => this.region(bodyId, r));
      this.surfaces.set(bodyId, surface);
    }
    return surface;
  }

  region(bodyId: string, region: number): RegionMap {
    const key = `${bodyId}#${region}`;
    let map = this.regions.get(key);
    if (!map) {
      map = generateRegion(this.seed, this.body(bodyId).body, region);
      if (this.regions.size >= REGION_CACHE_LIMIT) {
        const oldest = this.regions.keys().next().value;
        if (oldest !== undefined) this.regions.delete(oldest);
      }
      this.regions.set(key, map);
    }
    return map;
  }
}
