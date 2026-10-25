/**
 * Seamless terrain textures for the surface map (public/assets/terrain/atlas.webp: a 4x3 grid of 192 px tiles,
 * generated with Stable Diffusion + the pixel-art LoRA and tiled with the "tiling" option; see docs/art_pipeline.md).
 *
 * One texture set serves every world: each (body kind, terrain) pair picks a texture and recolours it so its
 * average colour is the kind's palette colour (`TERRAIN_COLORS`). The result keeps the texture's detail and
 * its colour variation around the mean. Lava is used as painted. Until the atlas has loaded (or if it fails)
 * `tintedTexture` returns null and the map falls back to flat palette colours.
 */
import type { BodyKind } from "../../../sim";
import { Terrain } from "../../../sim";
import { TERRAIN_COLORS } from "../../palette";

/** Edge length of one tile in the atlas, in pixels. */
export const TEX = 192;
/** HEX pixels per texture pixel when the map is painted (above 1 stretches the texture, so its detail reads at the default zoom). */
export const TEX_SCALE = 1.5;
const COLS = 4;

/** Atlas order, row by row. */
const NAMES = [
  "grass", "shrub", "sand", "hardpan",
  "dust", "snow", "rubble", "rock",
  "basalt", "ice", "water", "lava",
] as const;
type TexName = (typeof NAMES)[number];

/** Which texture each terrain uses on each kind of world: [plain, rough, mountain, ice, liquid, lava]. */
const TEXTURE_FOR: Record<BodyKind, readonly [TexName, TexName, TexName, TexName, TexName, TexName]> = {
  asteroid: ["dust", "rubble", "rock", "ice", "water", "lava"],
  barren: ["dust", "rubble", "rock", "ice", "water", "lava"],
  desert: ["sand", "hardpan", "rock", "snow", "water", "lava"],
  terrestrial: ["grass", "shrub", "rock", "snow", "water", "lava"],
  ocean: ["grass", "shrub", "rock", "snow", "water", "lava"],
  ice: ["snow", "rubble", "rock", "ice", "water", "lava"],
  hothouse: ["sand", "hardpan", "rock", "snow", "water", "lava"],
  volcanic: ["dust", "basalt", "basalt", "ice", "water", "lava"],
  gasGiant: ["dust", "rubble", "rock", "ice", "water", "lava"],
  iceGiant: ["dust", "rubble", "rock", "ice", "water", "lava"],
};

/** How much of the texture's contrast to keep, per terrain (bright palettes clip if pushed). */
const AMOUNT: readonly number[] = [0.75, 0.75, 0.8, 0.65, 0.7, 1];

/** Decoded texture: RGB bytes, TEX x TEX, plus the mean colour. */
interface Decoded {
  rgb: Uint8ClampedArray;
  mean: [number, number, number];
}

let atlas: Decoded[] | null = null;
let loading = false;
const tinted = new Map<string, Uint8ClampedArray>();

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

/**
 * The texture for `terrain` on a `kind` world, recoloured to the palette (RGB bytes, TEX x TEX, wrapping),
 * or null if textures aren't available.
 */
export function tintedTexture(kind: BodyKind, terrain: number): Uint8ClampedArray | null {
  if (!atlas || !enabled) return null;
  const key = `${kind}:${terrain}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const name = TEXTURE_FOR[kind][terrain];
  if (name === undefined) return null;
  const tex = atlas[NAMES.indexOf(name)];
  if (!tex) return null;
  const out = new Uint8ClampedArray(TEX * TEX * 3);
  if (terrain === Terrain.lava) {
    out.set(tex.rgb); // painted colours as they are
  } else {
    const pal = parseHex(TERRAIN_COLORS[kind][terrain] as string);
    const amount = AMOUNT[terrain] ?? 1;
    for (let i = 0; i < out.length; i += 3) {
      for (let c = 0; c < 3; c++) {
        const ratio = (tex.rgb[i + c] as number) / Math.max(8, tex.mean[c] as number);
        out[i + c] = (pal[c] as number) * (1 + amount * (ratio - 1));
      }
    }
  }
  tinted.set(key, out);
  return out;
}
