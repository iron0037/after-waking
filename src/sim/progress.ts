/**
 * Exploration progress, for "map painting": how much of each region, world and system the
 * player has covered, and reminders of what's already known when returning somewhere.
 */
import { remainingTonnes } from "./actions";
import type { Contract } from "./contracts";
import type { Body } from "./bodies";
import { shipStats } from "./ship";
import type { GameState } from "./state";
import { siteKey } from "./bodysurface";
import { exploredFraction, regionKey, type Deposit } from "./surface";
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

/**
 * One number for "how thoroughly have I covered this system", 0..1, for progress rings:
 * scanning counts most, then landing on its worlds, then working several regions.
 */
export function explorationScore(state: GameState, world: World, systemId: string): number {
  const p = systemProgress(state, world, systemId);
  const surfaced = world.system(systemId).bodies.filter((b) => b.regions > 0).length;
  const scanned = p.bodies > 0 ? p.scanned / p.bodies : 0;
  const landed = Math.min(1, p.landed / Math.max(1, surfaced));
  return Math.min(1, 0.4 * scanned + 0.3 * landed + 0.3 * Math.min(1, p.regionsVisited / 5));
}

/** Bodies an active contract still needs work on, with those contracts. Surveyed targets drop off. */
export function contractTargetsByBody(state: GameState): Map<string, Contract[]> {
  const map = new Map<string, Contract[]>();
  const add = (id: string, c: Contract) => map.set(id, [...(map.get(id) ?? []), c]);
  for (const c of state.contracts ?? []) {
    if (c.status !== "active") continue;
    if (c.kind === "specimens" && c.bodyId) add(c.bodyId, c);
    if (c.kind === "survey") for (const id of c.surveyBodyIds ?? []) if (!state.surveyedBodies.includes(id)) add(id, c);
  }
  return map;
}

/** The same targets, rolled up by star system. */
export function contractTargetsBySystem(state: GameState): Map<string, Contract[]> {
  const map = new Map<string, Contract[]>();
  for (const [bodyId, contracts] of contractTargetsByBody(state)) {
    const systemId = bodyId.split(".")[0] as string;
    const list = map.get(systemId) ?? [];
    for (const c of contracts) if (!list.includes(c)) list.push(c);
    map.set(systemId, list);
  }
  return map;
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

export interface KnownDeposit {
  region: number;
  /** Site key "region:id" (see bodysurface.ts). */
  key: string;
  commodity: Deposit["commodity"];
  remainingT: number;
  depthM: number;
  grade: number;
  prospected: boolean;
  /** Within the current drill's reach. */
  reachable: boolean;
}

/**
 * Untapped deposits the rover has already found on a world, across every region, for planning a
 * return trip from orbit. Richest (by tonnes within reach) first.
 */
export function knownDeposits(state: GameState, world: World, bodyId: string): KnownDeposit[] {
  const { body } = world.body(bodyId);
  const reach = shipStats(state.ship).drillMaxDepthM;
  const out: KnownDeposit[] = [];
  for (let r = 0; r < body.regions; r++) {
    const know = state.regions[regionKey(bodyId, r)];
    if (!know || know.discovered.length === 0) continue;
    for (const d of world.region(bodyId, r).deposits) {
      if (!know.discovered.includes(d.id)) continue;
      const remainingT = remainingTonnes(know, d);
      if (remainingT <= 0.05) continue;
      out.push({
        region: r,
        key: siteKey(r, d.id),
        commodity: d.commodity,
        remainingT,
        depthM: d.depthM,
        grade: d.grade,
        prospected: know.prospected.includes(d.id),
        reachable: d.depthM <= reach,
      });
    }
  }
  return out.sort((a, b) => Number(b.reachable) - Number(a.reachable) || b.remainingT - a.remainingT);
}
