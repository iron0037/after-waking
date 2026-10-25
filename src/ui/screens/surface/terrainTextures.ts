/**
 * Seamless terrain textures for the surface map (public/assets/terrain/atlas.webp: a 4x3 grid of 192 px tiles,
 * generated with Stable Diffusion + the pixel-art LoRA and tiled with the "tiling" option; see docs/art_pipeline.md).
 *
 * One texture set serves every world: each (body kind, terrain) pair picks a texture and recolours it so its
 * average colour is the kind's palette colour (`TERRAIN_COLORS`). The result keeps the texture's detail and
 * its colour variation around the mean. Lava is used as painted. Until the atlas has loaded (or if it fails)
 * `tintedTexture` returns null and the map falls back to flat palette colours.
 *
 * Three terrains get more than a plain recolour (see terrainImage.ts):
 *  - plains on living temperate worlds blend quiet steppe with lush meadow near the water (`lushRule`);
 *  - liquid is shaded by depth, darker offshore (`liquidRule`, `depthGradient`), over a nearly flat water tile;
 *  - ice and snow are toned down (darker, greyer, low contrast) so markers read against them.
 */
import type { BodyKind } from "../../../sim";
import { Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";

/** Edge length of one tile in the atlas, in pixels. */
export const TEX = 192;
/** HEX pixels per texture pixel when the map is painted (above 1 stretches the texture, so its detail reads at the default zoom). */
export const TEX_SCALE = 1.5;
const COLS = 4;

/**
 * Atlas order, row by row. "steppe" is the quiet everyday grassland, "grass" the lush meadow (verdant ground only),
 * "frost" a soft, low-contrast snow and ice, and "water" a calm, flat sheet that depth shading is laid over.
 */
const NAMES = [
  "grass", "shrub", "sand", "hardpan",
  "dust", "frost", "rubble", "rock",
  "basalt", "steppe", "water", "lava",
] as const;
type TexName = (typeof NAMES)[number];

/** Which texture each terrain uses on each kind of world: [plain, rough, mountain, ice, liquid, lava]. */
const TEXTURE_FOR: Record<BodyKind, readonly [TexName, TexName, TexName, TexName, TexName, TexName]> = {
  asteroid: ["dust", "rubble", "rock", "frost", "water", "lava"],
  barren: ["dust", "rubble", "rock", "frost", "water", "lava"],
  desert: ["sand", "hardpan", "rock", "frost", "water", "lava"],
  terrestrial: ["steppe", "shrub", "rock", "frost", "water", "lava"],
  ocean: ["steppe", "shrub", "rock", "frost", "water", "lava"],
  ice: ["frost", "rubble", "rock", "frost", "water", "lava"],
  hothouse: ["sand", "hardpan", "rock", "frost", "water", "lava"],
  volcanic: ["dust", "basalt", "basalt", "frost", "water", "lava"],
  gasGiant: ["dust", "rubble", "rock", "frost", "water", "lava"],
  iceGiant: ["dust", "rubble", "rock", "frost", "water", "lava"],
};

/** How much of the texture's contrast to keep, per terrain (bright palettes clip if pushed). */
const AMOUNT: readonly number[] = [0.75, 0.75, 0.8, 0.22, 0.5, 1];
/** Ordinary plains on worlds that use the steppe tile: kept quiet, so ground cover doesn't shout. */
const STEPPE_AMOUNT = 0.4;
/** Shrubland keeps a bit less of its (very leafy) contrast than rock and rubble do. */
const SHRUB_AMOUNT = 0.6;
/** Steppe leans toward this dry olive, so it reads apart from the lush meadow. */
const STEPPE_TINT = [150, 156, 92] as const;
/** The lush meadow tile is toned down from the full-strength grass the first pass painted everywhere. */
const LUSH_AMOUNT = 0.55;
/** Ice and snow are painted darker and greyer than their palette colour (ice worlds most), so markers stand out on them. */
const ICE_TONE = 0.8;
const ICE_WORLD_TONE = 0.7;
const ICE_GREY = 0.18;
const ICE_ROCK_TONE = 0.8;
/** How much of the water tile's speckle shows (it is mostly flat). */
const WATER_DETAIL = 0.12;

/** Decoded texture: RGB bytes, TEX x TEX, plus the mean colour. */
interface Decoded {
  rgb: Uint8ClampedArray;
  mean: [number, number, number];
}

let atlas: Decoded[] | null = null;
let loading = false;
const tinted = new Map<string, Uint8ClampedArray>();
let detail: Float32Array | null = null;

let enabled = true;

/** Turns the textures off (flat palette colours) or back on; affects images built afterwards. */
export function setTexturesEnabled(on: boolean): void {
  enabled = on;
}

/** True once the atlas is decoded and `tintedTexture` can return textures. */
export function texturesReady(): boolean {
  return atlas !== null && enabled;
}

/** Starts loading the atlas (once). Safe to call anywhere; does nothing outside a browser. */
export function loadTextures(): void {
  if (atlas || loading || typeof Image === "undefined" || typeof document === "undefined") return;
  loading = true;
  const img = new Image();
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const out: Decoded[] = [];
      for (let n = 0; n < NAMES.length; n++) {
        const data = ctx.getImageData((n % COLS) * TEX, Math.floor(n / COLS) * TEX, TEX, TEX).data;
        const rgb = new Uint8ClampedArray(TEX * TEX * 3);
        const sum = [0, 0, 0];
        for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
          for (let c = 0; c < 3; c++) {
            const v = data[i + c] as number;
            rgb[j + c] = v;
            sum[c] = (sum[c] as number) + v;
          }
        }
        const px = TEX * TEX;
        out.push({ rgb, mean: [(sum[0] as number) / px, (sum[1] as number) / px, (sum[2] as number) / px] });
      }
      atlas = out;
    } catch {
      // Stay on flat colours.
    }
  };
  img.onerror = () => {
    loading = false;
  };
  img.src = "./assets/terrain/atlas.webp";
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The palette colour a terrain is recoloured to (ice and snow are pulled toward a darker blue-grey). */
function paletteColor(kind: BodyKind, terrain: number): [number, number, number] {
  const pal = parseHex(TERRAIN_COLORS[kind][terrain] as string);
  if (kind === "ice" && terrain !== Terrain.ice && terrain !== Terrain.lava && terrain !== Terrain.liquid) {
    return pal.map((v) => v * ICE_ROCK_TONE) as [number, number, number]; // the bare ground between the sheets, a little less glaring
  }
  if (terrain !== Terrain.ice) return pal;
  const tone = kind === "ice" ? ICE_WORLD_TONE : ICE_TONE;
  const lum = 0.3 * pal[0] + 0.59 * pal[1] + 0.11 * pal[2];
  return pal.map((v) => (v + (lum - v) * ICE_GREY) * tone) as [number, number, number];
}

/** `tex` recoloured so its mean is `pal`, keeping `amount` of its contrast. */
function recolour(tex: Decoded, pal: readonly [number, number, number], amount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(TEX * TEX * 3);
  for (let i = 0; i < out.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const ratio = (tex.rgb[i + c] as number) / Math.max(8, tex.mean[c] as number);
      out[i + c] = (pal[c] as number) * (1 + amount * (ratio - 1));
    }
  }
  return out;
}

function texture(name: TexName): Decoded | null {
  return atlas?.[NAMES.indexOf(name)] ?? null;
}

/**
 * The texture for `terrain` on a `kind` world, recoloured to the palette (RGB bytes, TEX x TEX, wrapping),
 * or null if textures aren't available. (Liquid comes back at its mid-depth colour; the map shades it by depth
 * with `depthGradient` and `waterDetail` instead.)
 */
export function tintedTexture(kind: BodyKind, terrain: number): Uint8ClampedArray | null {
  if (!atlas || !enabled) return null;
  const key = `${kind}:${terrain}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const name = TEXTURE_FOR[kind][terrain];
  if (name === undefined) return null;
  const tex = texture(name);
  if (!tex) return null;
  let out: Uint8ClampedArray;
  if (terrain === Terrain.lava) {
    out = new Uint8ClampedArray(tex.rgb); // painted colours as they are
  } else {
    const amount = name === "steppe" ? STEPPE_AMOUNT : name === "shrub" ? SHRUB_AMOUNT : (AMOUNT[terrain] ?? 1);
    let pal = paletteColor(kind, terrain);
    if (name === "steppe") pal = pal.map((v, c) => (v + ((STEPPE_TINT[c] as number) - v) * 0.3) * 0.95) as [number, number, number];
    out = recolour(tex, pal, amount);
  }
  tinted.set(key, out);
  return out;
}

/** Where verdant ground is, in elevation above the local sea level: at or below `from` fully lush, at or above `to` not at all. */
export interface LushRule {
  from: number;
  to: number;
}

/**
 * Which plains are lush meadow rather than ordinary steppe, or null if the world has none. Living worlds with a
 * temperate climate are verdant where the ground lies low, near their water (the elevation is the sim's, so it
 * follows coasts and lake shores); ocean-world islands are lush throughout. Everything else stays quiet.
 */
export function lushRule(body: { kind: BodyKind; life: boolean; tempC: number }): LushRule | null {
  if (!body.life || body.tempC < -2 || body.tempC > 60) return null;
  if (body.kind === "ocean") return { from: 9, to: 10 };
  if (body.kind === "terrestrial") return { from: 0.02, to: 0.09 };
  return null;
}

/** The lush meadow tile recoloured for a `kind` world's plains (null until textures are ready). */
export function lushTexture(kind: BodyKind): Uint8ClampedArray | null {
  if (!atlas || !enabled) return null;
  const key = `${kind}:lush`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const tex = texture("grass");
  if (!tex) return null;
  const out = recolour(tex, paletteColor(kind, Terrain.plain), LUSH_AMOUNT);
  tinted.set(key, out);
  return out;
}

/** How a kind of world's liquid deepens: depth is `(level - elevation) / range`, clamped to 0..1. */
export interface LiquidRule {
  /** The liquid line where the map can't find a shore to read it from (`classify` in sim/surface.ts; it drifts by up to +-0.15 around this). */
  level: number;
  /** Elevation below the liquid line at which the liquid is at its deepest. */
  range: number;
}

export function liquidRule(kind: BodyKind): LiquidRule {
  if (kind === "ocean") return { level: 0.6, range: 0.3 };
  if (kind === "terrestrial") return { level: 0.32, range: 0.13 };
  return { level: 0.4, range: 0.2 };
}

/** Number of steps in a depth gradient. */
export const DEPTH_STEPS = 12;

/**
 * The liquid's colour at each depth, shallow (step 0) to deep, as RGB triples: the palette colour in between,
 * lightened toward the shore and darkened to a deep tone offshore. It works from the body kind's liquid colour,
 * so methane and acid seas deepen the same way water does.
 */
export function depthGradient(kind: BodyKind): Float32Array {
  const pal = parseHex(TERRAIN_COLORS[kind][Terrain.liquid] as string);
  const out = new Float32Array(DEPTH_STEPS * 3);
  for (let k = 0; k < DEPTH_STEPS; k++) {
    const d = k / (DEPTH_STEPS - 1);
    for (let c = 0; c < 3; c++) {
      const v = pal[c] as number;
      const shallow = v + (255 - v) * 0.2;
      const mid = v * 0.92;
      const deep = v * 0.33;
      out[k * 3 + c] = d < 0.35 ? shallow + (mid - shallow) * (d / 0.35) : mid + (deep - mid) * ((d - 0.35) / 0.65);
    }
  }
  return out;
}

/**
 * The calm-water tile as brightness factors around 1 (TEX x TEX, wrapping): a faint, non-directional speckle
 * to lay over the depth colour. Null until textures are ready.
 */
export function waterDetail(): Float32Array | null {
  if (!atlas || !enabled) return null;
  if (detail) return detail;
  const tex = texture("water");
  if (!tex) return null;
  const lum = new Float32Array(TEX * TEX);
  let mean = 0;
  for (let i = 0; i < lum.length; i++) {
    const v = 0.3 * (tex.rgb[i * 3] as number) + 0.59 * (tex.rgb[i * 3 + 1] as number) + 0.11 * (tex.rgb[i * 3 + 2] as number);
    lum[i] = v;
    mean += v;
  }
  mean = Math.max(8, mean / lum.length);
  for (let i = 0; i < lum.length; i++) lum[i] = 1 + WATER_DETAIL * ((lum[i] as number) / mean - 1);
  detail = lum;
  return lum;
}
