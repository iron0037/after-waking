/**
 * Can the crew work a surface site with the gear they have (AW-257)? The surface lists color a site's
 * name by it, as the body list does for landing (AW-247): green now, muted if it needs gear first.
 * Gear only: a site cut off by water or rock is still "now"; the route planner says so when you drive.
 */
import { SEAS } from "../data/seas";
import type { LandingTier } from "./landing";
import { effectiveStats } from "./perks";
import type { GameState } from "./state";
import { Terrain } from "./surface";
import type { Vec2 } from "./units";
import { hasBoat } from "./vehicles";
import type { World } from "./world";

export type ReachTier = Exclude<LandingTier, "never">;

export interface SiteReach {
  tier: ReachTier;
  /** What's missing, for a site that needs gear. */
  why: string | null;
}

/** Whether a site (a deposit `depthM` down, or a plant or creature at the surface) can be worked with the gear aboard. */
export function siteReach(state: GameState, world: World, bodyId: string, site: Vec2, depthM = 0): SiteReach {
  const stats = effectiveStats(state);
  const t = world.surface(bodyId).terrainAt(site.x, site.y);
  if (t === Terrain.liquid) {
    if (!hasBoat(state)) return { tier: "gear", why: "Under the water: it needs a survey boat (the Midshipmen fit them)." };
    const sea = world.body(bodyId).body.sea;
    const needs = sea ? SEAS[sea].boatNeeds : null;
    if (needs && !stats[needs.flag]) return { tier: "gear", why: `${needs.why}` };
  } else if (t === Terrain.mountain && !stats.roverCanClimb) {
    return { tier: "gear", why: "Up in the mountains: the rover needs all-terrain treads." };
  }
  if (depthM > stats.drillMaxDepthM) return { tier: "gear", why: `${depthM} m down; the drill reaches ${stats.drillMaxDepthM} m.` };
  return { tier: "now", why: null };
}
