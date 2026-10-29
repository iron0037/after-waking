/**
 * Deep space (AW-165): the dark between the stars. Blind folds take the ship to empty points; a
 * deep-field array sweeps the space around it, and the sweeps are kept as circles. What lies out
 * here is placed from the seed (deepSites); for now that's the anomaly's mouth (Return, AW-166),
 * with rogue planets, derelicts, plicite drifts and pirate bases to follow (AW-168, AW-169).
 */
import { dist, DAY, type Vec2 } from "./units";
import { INTREPID_POS } from "./galaxy";
import { rngFor } from "./rng";
import { fail, ok, type Result } from "./result";
import { effectiveStats } from "./perks";
import { awardXp } from "./crew";
import { advanceTime, log, type GameState } from "./state";
import type { World } from "./world";

/** A blind fold reaches this share of the drive's range, and burns this much more plicite. */
export const BLIND_FOLD_RANGE = 0.6;
export const BLIND_FOLD_FUEL = 1.25;
/** Deep-space points must be at least this far from any star (closer, fold to the star instead). */
export const DEEP_CLEARANCE_LY = 0.6;
/** Beyond this, the navigators can't fix a position: the star references thin out (the edge, AW-170). */
export const DEEP_LIMIT_LY = 40;
/** A deep-field sweep takes a day; faint returns reach this multiple of the array's radius. */
export const DEEP_SCAN_MINUTES = DAY;
export const FAINT_REACH = 1.5;
/** Arriving within this of a site puts the ship there. */
export const SITE_REACH_LY = 0.25;

export type DeepSiteKind = "anomaly";

export interface DeepSite {
  id: string;
  kind: DeepSiteKind;
  pos: Vec2;
  /** Its name once identified. */
  name: string;
  /** What the array reports when it's identified. */
  report: string;
}

const SITE_CACHE = new Map<string, DeepSite[]>();

/** Everything between the stars, fixed for the seed. */
export function deepSites(world: World): DeepSite[] {
  const key = `${world.seed}:${world.gen}`;
  const cached = SITE_CACHE.get(key);
  if (cached) return cached;
  const rng = rngFor(world.seed, "deep", "sites");
  const stars = world.galaxy.systems.map((s) => s.pos);
  const clear = (p: Vec2, min: number) => stars.every((s) => dist(s, p) >= min);
  const place = (rMin: number, rMax: number, clearance: number): Vec2 => {
    for (let i = 0; i < 500; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(rMin, rMax);
      const p = { x: Math.round(Math.cos(a) * r * 100) / 100, y: Math.round(Math.sin(a) * r * 100) / 100 };
      if (clear(p, clearance)) return p;
    }
    return { x: rMax, y: 0 };
  };
  const sites: DeepSite[] = [
    {
      id: "anomaly",
      kind: "anomaly",
      // It has drifted a long way from where the Intrepid came out.
      pos: place(16, 26, 2),
      name: "The anomaly",
      report:
        "Starlight bends around nothing. The array logs a lens with no mass behind it, slowly turning: the shape of the thing the Intrepid came through, thirty years ago.",
    },
  ];
  SITE_CACHE.set(key, sites);
  return sites;
}

/** Why the ship can't fold to this point in deep space (empty if it can). */
export function deepPointBlockers(world: World, p: Vec2): string[] {
  const out: string[] = [];
  const near = world.galaxy.systems.find((s) => dist(s.pos, p) < DEEP_CLEARANCE_LY);
  if (near) out.push(`That's inside ${near.name}'s reach: fold to the star itself.`);
  if (dist(p, INTREPID_POS) < DEEP_CLEARANCE_LY) out.push("That's the Intrepid's doorstep: fold to the Intrepid.");
  if (dist(p, INTREPID_POS) > DEEP_LIMIT_LY) out.push(`The navigators can't fix a position more than ${DEEP_LIMIT_LY} ly out: the star references thin out.`);
  return out;
}

/** The site the ship is at, if any. */
export function siteHere(state: GameState, world: World): DeepSite | null {
  const loc = state.location;
  if (loc.kind !== "deep") return null;
  return deepSites(world).find((s) => dist(s.pos, loc.pos) <= SITE_REACH_LY) ?? null;
}

/** Fold arrival in empty space. Called by fold(). */
export function arriveDeep(state: GameState, world: World, pos: Vec2, ly: number): void {
  state.location = { kind: "deep", pos: { x: pos.x, y: pos.y } };
  const site = siteHere(state, world);
  if (site) {
    state.deepKnown ??= {};
    state.deepKnown[site.id] = "known";
    log(state, "travel", `Folded ${ly.toFixed(1)} ly into the dark between the stars and came out beside ${site.name.toLowerCase()}. ${site.report}`);
    return;
  }
  log(state, "travel", `Folded ${ly.toFixed(1)} ly blind into the dark between the stars, ${dist(pos, INTREPID_POS).toFixed(1)} ly from the Intrepid. Nothing on the scopes but distant suns.`);
}

export interface DeepScanResult {
  found: DeepSite[];
  faint: number;
  radius: number;
}

/** Where a sweep is centred: the deep-space point, or the star system you're in. */
export function scanCentre(state: GameState, world: World): Vec2 | null {
  const loc = state.location;
  if (loc.kind === "deep") return loc.pos;
  if (loc.kind === "space") return world.galaxy.systems.find((s) => s.id === loc.systemId)?.pos ?? null;
  return null;
}

/** Why a deep-field sweep can't run now (empty if it can). */
export function deepScanBlockers(state: GameState, world: World): string[] {
  const out: string[] = [];
  if (effectiveStats(state).deepScanLy <= 0) out.push("Needs a deep-field array (the Lyceum sells them at the Shipyard).");
  if (state.encounter) out.push("A raider has you under its guns.");
  if (!scanCentre(state, world)) out.push(state.location.kind === "surface" ? "Launch from the surface first." : "Undock first: the Intrepid's own noise swamps the array.");
  return out;
}

/**
 * A day-long sweep of the space around the ship. Anything within the array's reach is identified;
 * anything a little beyond shows as a faint return. The swept circle is kept for the star map.
 */
export function scanDeep(state: GameState, world: World): Result<DeepScanResult> {
  const blockers = deepScanBlockers(state, world);
  if (blockers.length > 0) return fail(blockers[0] as string);
  const centre = scanCentre(state, world) as Vec2;
  const radius = effectiveStats(state).deepScanLy;
  advanceTime(state, DEEP_SCAN_MINUTES);
  state.deepScans ??= [];
  state.deepScans.push({ x: centre.x, y: centre.y, r: radius, t: state.time });
  state.deepKnown ??= {};
  const found: DeepSite[] = [];
  let faint = 0;
  for (const site of deepSites(world)) {
    const d = dist(site.pos, centre);
    if (d <= radius) {
      if (state.deepKnown[site.id] !== "known") found.push(site);
      state.deepKnown[site.id] = "known";
    } else if (d <= radius * FAINT_REACH && !state.deepKnown[site.id]) {
      state.deepKnown[site.id] = "faint";
      faint++;
    }
  }
  awardXp(state, "science", 6 + 10 * found.length);
  const parts = [`Deep-field sweep: ${radius} ly around the ship.`];
  for (const s of found) parts.push(`Identified: ${s.name}. ${s.report}`);
  if (faint > 0) parts.push(`${faint === 1 ? "A faint return" : `${faint} faint returns`} just beyond reach: something is out there.`);
  if (found.length === 0 && faint === 0) parts.push("Nothing but the dark.");
  log(state, found.length > 0 ? "discovery" : "info", parts.join(" "));
  return ok({ found, faint, radius });
}

/** What the array knows of, for the star map: identified sites, and faint returns (position only). */
export function knownDeepSites(state: GameState, world: World): { site: DeepSite; level: "known" | "faint" }[] {
  const known = state.deepKnown ?? {};
  return deepSites(world)
    .filter((s) => known[s.id])
    .map((site) => ({ site, level: known[site.id] as "known" | "faint" }));
}

/** Share of a circle of space (around the Intrepid) that has been swept, for a progress readout. */
export function sweptShare(state: GameState, radiusLy = 32, samples = 2000): number {
  const scans = state.deepScans ?? [];
  if (scans.length === 0) return 0;
  const rng = rngFor(1, "swept");
  let hit = 0;
  for (let i = 0; i < samples; i++) {
    const a = rng.range(0, Math.PI * 2);
    const r = radiusLy * Math.sqrt(rng.next());
    const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
    if (scans.some((c) => dist(c, p) <= c.r)) hit++;
  }
  return hit / samples;
}
