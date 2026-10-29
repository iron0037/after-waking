/**
 * The Verge: the stars around the Intrepid. The Intrepid itself sits at the origin, anchored
 * in empty interstellar space. Star positions are in light-years on a 2D chart (the real
 * region is 3D, but a flat chart reads better, as Starflight's did).
 */
import { catalogName, STAR_NAMES } from "../data/names";
import { rngFor, type Rng } from "./rng";
import { dist, type Vec2 } from "./units";

export type SpectralClass = "M" | "K" | "G" | "F" | "A";

export interface StarSystem {
  id: string;
  /** Given name for charted stars, catalog number otherwise. */
  name: string;
  catalog: string;
  pos: Vec2;
  spectral: SpectralClass;
  /** Solar masses. */
  mass: number;
  /** Solar luminosities. */
  luminosity: number;
  /** The nearest stars were charted by the first scouts: their bodies are known in advance. */
  charted: boolean;
  /**
   * One of the few systems nearest the Intrepid, explored thoroughly by the first scouts:
   * a gentle star, calm landable worlds and shallow seams. Where new captains learn the trade.
   */
  home: boolean;
}

export interface Galaxy {
  seed: number;
  systems: StarSystem[];
}

export const INTREPID_POS: Vec2 = { x: 0, y: 0 };

interface SpectralProfile {
  weight: number;
  mass: [number, number];
  luminosity: [number, number];
  color: string;
  label: string;
}

export const SPECTRAL: Record<SpectralClass, SpectralProfile> = {
  M: { weight: 45, mass: [0.12, 0.5], luminosity: [0.002, 0.07], color: "#ff8f66", label: "red dwarf" },
  K: { weight: 27, mass: [0.5, 0.8], luminosity: [0.1, 0.6], color: "#ffc285", label: "orange dwarf" },
  G: { weight: 17, mass: [0.8, 1.1], luminosity: [0.6, 1.5], color: "#fff0c2", label: "yellow dwarf" },
  F: { weight: 8, mass: [1.1, 1.5], luminosity: [1.6, 4.5], color: "#f6f6ff", label: "white star" },
  A: { weight: 3, mass: [1.6, 2.4], luminosity: [6, 22], color: "#c9d8ff", label: "blue-white star" },
};

export interface GalaxyOptions {
  count: number;
  chartedCount: number;
  /** The nearest N charted systems are "home": benign by design. */
  homeCount: number;
  /** Every new star is placed this far from an existing one, so the map is connected. */
  linkLy: [number, number];
  minSeparationLy: number;
  maxRadiusLy: number;
}

export const DEFAULT_GALAXY: GalaxyOptions = {
  count: 22,
  chartedCount: 12,
  homeCount: 3,
  linkLy: [3, 7.5],
  minSeparationLy: 2.6,
  maxRadiusLy: 32,
};

export function generateGalaxy(seed: number, options: GalaxyOptions = DEFAULT_GALAXY): Galaxy {
  const rng = rngFor(seed, "galaxy");
  const anchors: Vec2[] = [INTREPID_POS];
  const positions: Vec2[] = [];

  let attempts = 0;
  while (positions.length < options.count && attempts < 20_000) {
    attempts++;
    const from = rng.pick(anchors);
    const angle = rng.range(0, Math.PI * 2);
    const r = rng.range(options.linkLy[0], options.linkLy[1]);
    const p = { x: from.x + Math.cos(angle) * r, y: from.y + Math.sin(angle) * r };
    if (dist(p, INTREPID_POS) > options.maxRadiusLy) continue;
    if (anchors.some((a) => dist(a, p) < options.minSeparationLy)) continue;
    positions.push(p);
    anchors.push(p);
  }

  // Nearest stars get charted and named first.
  positions.sort((a, b) => dist(a, INTREPID_POS) - dist(b, INTREPID_POS));
  const names = shuffled(rng, STAR_NAMES);

  const systems = positions.map((pos, i): StarSystem => {
    const starRng = rngFor(seed, "star", i);
    const home = i < options.homeCount;
    // Home stars are calm orange or yellow dwarfs: no flare stars next door.
    const spectral: SpectralClass = home
      ? starRng.weighted([["K", 60], ["G", 40]] as const)
      : starRng.weighted((Object.keys(SPECTRAL) as SpectralClass[]).map((k) => [k, SPECTRAL[k].weight] as const));
    const profile = SPECTRAL[spectral];
    const t = starRng.next();
    const charted = i < options.chartedCount;
    const catalog = catalogName(i);
    return {
      id: `s${i}`,
      name: charted ? (names[i % names.length] as string) : catalog,
      catalog,
      pos: { x: round2(pos.x), y: round2(pos.y) },
      spectral,
      mass: lerp(profile.mass, t),
      luminosity: lerp(profile.luminosity, t * t),
      charted,
      home,
    };
  });

  return { seed, systems };
}

export function findSystem(galaxy: Galaxy, id: string): StarSystem {
  const s = galaxy.systems.find((sys) => sys.id === id);
  if (!s) throw new Error(`Unknown system ${id}`);
  return s;
}

/** Light-years between two systems, or between a system and the Intrepid (id "intrepid"). */
export function distanceLy(galaxy: Galaxy, fromId: string, toId: string): number {
  return dist(positionOf(galaxy, fromId), positionOf(galaxy, toId));
}

export function positionOf(galaxy: Galaxy, id: string): Vec2 {
  if (id === "intrepid") return INTREPID_POS;
  const deep = parseDeepId(id);
  return deep ?? findSystem(galaxy, id).pos;
}

/** A point in interstellar space as a fold target id (AW-165): "deep:x,y" in light-years. */
export function deepId(p: Vec2): string {
  return `deep:${p.x.toFixed(2)},${p.y.toFixed(2)}`;
}

export function parseDeepId(id: string): Vec2 | null {
  if (!id.startsWith("deep:")) return null;
  const [x, y] = id.slice(5).split(",").map(Number);
  return x === undefined || y === undefined || Number.isNaN(x) || Number.isNaN(y) ? null : { x, y };
}

export function isDeepId(id: string): boolean {
  return id.startsWith("deep:");
}

function lerp([a, b]: [number, number], t: number): number {
  return a + (b - a) * t;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}
