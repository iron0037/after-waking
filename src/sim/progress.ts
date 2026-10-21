/**
 * Exploration progress, for "map painting": how much of each region, world and system the
 * player has covered, and reminders of what's already known when returning somewhere.
 */
import { remainingTonnes } from "./actions";
import type { Body } from "./bodies";
import { shipStats } from "./ship";
import type { GameState } from "./state";
import { exploredFraction, regionKey } from "./surface";
import type { World } from "./world";

export interface BodyProgress {
  regions: number;
  regionsVisited: number;
  /** Fraction of the whole surface swept by rover sensors, 0..1. */
  explored: number;
  scanned: boolean;
  surveyed: boolean;
}

export function bodyProgress(state: GameState, body: Body): BodyProgress {
  let visited = 0;
  let explored = 0;
  for (let r = 0; r < body.regions; r++) {
    const k = state.regions[regionKey(body.id, r)];
    if (k && k.visits > 0) visited++;
    explored += exploredFraction(k);
  }
  return {
    regions: body.regions,
    regionsVisited: visited,
    explored: body.regions > 0 ? explored / body.regions : 0,
    scanned: state.scannedBodies.includes(body.id),
    surveyed: (state.surveyedBodies ?? []).includes(body.id),
  };
}

export interface SystemProgress {
  bodies: number;
  scanned: number;
  surveyed: number;
  /** Bodies with at least one landing. */
  landed: number;
  regionsVisited: number;
  regionsTotal: number;
  visited: boolean;
}

export function systemProgress(state: GameState, world: World, systemId: string): SystemProgress {
  const bodies = world.system(systemId).bodies;
  const p: SystemProgress = {
    bodies: bodies.length,
    scanned: 0,
    surveyed: 0,
    landed: 0,
    regionsVisited: 0,
    regionsTotal: 0,
    visited: state.visitedSystems.includes(systemId),
  };
  for (const b of bodies) {
    const bp = bodyProgress(state, b);
    if (bp.scanned) p.scanned++;
    if (bp.surveyed) p.surveyed++;
    if (bp.regionsVisited > 0) p.landed++;
    p.regionsVisited += bp.regionsVisited;
    p.regionsTotal += bp.regions;
  }
  return p;
}

export interface RegionRecap {
  visits: number;
  explored: number;
  depositsKnown: number;
  /** Tonnes left in known, reachable (drill depth) deposits. */
  reachableTonnes: number;
  floraUnsampled: number;
}

/** "You've been here before": what the player already knows about a region. */
export function regionRecap(state: GameState, world: World, bodyId: string, region: number): RegionRecap | null {
  const k = state.regions[regionKey(bodyId, region)];
  if (!k || k.visits === 0) return null;
  const map = world.region(bodyId, region);
  const reach = shipStats(state.ship).drillMaxDepthM;
  let reachableTonnes = 0;
  for (const d of map.deposits) {
    if (k.discovered.includes(d.id) && d.depthM <= reach) reachableTonnes += remainingTonnes(k, d);
  }
  return {
    visits: k.visits,
    explored: exploredFraction(k),
    depositsKnown: k.discovered.length,
    reachableTonnes,
    floraUnsampled: (k.floraFound ?? []).filter((id) => !(k.floraSampled ?? []).includes(id)).length,
  };
}
