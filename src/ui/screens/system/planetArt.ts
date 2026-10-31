/**
 * Procedural planet sprites for the orrery. A sprite is the unlit globe (bands, continents,
 * caps, craters) rendered once per body and size bucket into an offscreen canvas; the star-facing
 * shading is laid over it each frame, so the terminator tracks the orbit without re-rendering.
 * Everything is stable per body: noise is seeded from the game seed and the body id.
 */
import { SEAS } from "../../../data/seas";
import { fbm, hashSeed, type Body } from "../../../sim";
import { BODY_COLOR, TERRAIN_COLORS } from "../../palette";
import { hexRgb } from "./util";

type RGB = [number, number, number];

const SIZES = [24, 32, 48, 64, 96, 128, 192, 256];
const MAX_CACHED = 90;
const cache = new Map<string, HTMLCanvasElement>();

/** Discs smaller than this (px radius) are drawn as a plain gradient: no sprite needed. */
export const SPRITE_MIN_RADIUS = 8;

/** Smallest bucket (in device pixels) that covers a disc of radius `r` CSS px. */
export function spriteSize(r: number): number {
  const need = 2 * r * (typeof window === "undefined" ? 1 : window.devicePixelRatio || 1);
  return SIZES.find((s) => s >= need) ?? (SIZES[SIZES.length - 1] as number);
}

export function bodySprite(seed: number, body: Body, size: number): HTMLCanvasElement {
  const key = `${seed}:${body.id}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sprite = render(seed, body, size);
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, sprite);
  return sprite;
}

// --- small math --------------------------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scaleRGB = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const lighter = (a: RGB, amt: number) => mixRGB(a, WHITE, amt);
const darker = (a: RGB, amt: number) => mixRGB(a, BLACK, amt);

/** Small deterministic stream of 0..1 numbers for placing features. */
function stream(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// --- shading per body kind ---------------------------------------------------------------

interface Ctx {
  body: Body;
  oct: number;
  big: boolean;
  /** Noise seeds, offsets and palette, fixed per body. */
  n: { elev: number; mott: number; cap: number; cloud: number; ridge: number; warp: number; fine: number };
  ox: number;
  oy: number;
  plain: RGB;
  rough: RGB;
  mountain: RGB;
  ice: RGB;
  liquid: RGB;
  lava: RGB;
  base: RGB;
  sea: number;
  capLat: number;
  bands: number;
  bandPhase: number;
  stormLon: number;
  stormLat: number;
}

function makeCtx(seed: number, body: Body, size: number): Ctx {
  const h = (tag: string) => hashSeed(seed, body.id, tag);
  const t = TERRAIN_COLORS[body.kind];
  const rnd = stream(h("art"));
  const liquidWorld = body.surface === "liquid";
  // A global ocean has no dry land at all: sea level above every peak (depth still shades the water).
  // Worlds with exotic seas (methane, ammonia, acid) have lowland seas in the sea's own colour (AW-189).
  const sea = liquidWorld ? 1.05 : body.sea ? 0.44 : body.kind === "terrestrial" ? 0.46 : body.kind === "ocean" ? 0.5 : -1;
  const capLat = body.tempC > 45 ? 9 : Math.max(0.3, Math.min(1.42, 1.45 - (15 - body.tempC) * 0.025));
  const giant = body.kind === "gasGiant" || body.kind === "iceGiant";
  return {
    body,
    oct: size >= 128 ? 5 : size >= 64 ? 4 : 3,
    big: size >= 96,
    n: { elev: h("elev"), mott: h("mott"), cap: h("cap"), cloud: h("cloud"), ridge: h("ridge"), warp: h("warp"), fine: h("fine") },
    ox: rnd() * 60,
    oy: rnd() * 60,
    plain: hexRgb(t[0]),
    rough: hexRgb(t[1]),
    mountain: hexRgb(t[2]),
    ice: hexRgb(t[3]),
    liquid: hexRgb(body.sea ? SEAS[body.sea].color : t[4]),
    lava: hexRgb(t[5]),
    base: hexRgb(BODY_COLOR[body.kind]),
    sea,
    capLat,
    bands: giant ? (body.kind === "gasGiant" ? 6 + Math.floor(rnd() * 5) : 3 + Math.floor(rnd() * 3)) : 0,
    bandPhase: rnd() * 6.28,
    stormLon: (rnd() - 0.5) * 1.1,
    stormLat: -0.25 - rnd() * 0.35,
  };
}

function giantColor(c: Ctx, lon: number, lat: number): RGB {
  const gas = c.body.kind === "gasGiant";
  const u = lon + c.ox;
  const warp = fbm(c.n.warp, u * 1.2, lat * 3 + c.oy, 3) - 0.5;
  const swirl = fbm(c.n.fine, u * 0.9 + warp * 2.4, lat * (gas ? 9 : 5) + c.oy, 3);
  const b = Math.sin((lat + warp * (gas ? 0.9 : 0.5)) * c.bands + c.bandPhase) * (gas ? 0.85 : 0.45);
  const t = 0.5 + 0.5 * b + (swirl - 0.5) * 0.35;
  const dark = darker(c.base, gas ? 0.38 : 0.22);
  const light = lighter(c.base, gas ? 0.3 : 0.2);
  let col = t < 0.5 ? mixRGB(dark, c.base, clamp01(t * 2)) : mixRGB(c.base, light, clamp01((t - 0.5) * 2));
  if (gas) {
    const accent: RGB = mixRGB(c.base, [168, 92, 62], 0.55);
    col = mixRGB(col, accent, 0.45 * smooth(0.58, 0.72, swirl));
  }
  // One big storm on the large renders.
  if (c.big) {
    const dx = (lon - c.stormLon) / (gas ? 0.3 : 0.2);
    const dy = (lat - c.stormLat) / (gas ? 0.16 : 0.1);
    const d = dx * dx + dy * dy;
    if (d < 1) {
      const storm: RGB = gas ? [196, 104, 72] : darker(c.base, 0.35);
      col = mixRGB(col, storm, 0.85 * (1 - d) ** 0.7);
      if (d > 0.7) col = lighter(col, 0.12);
    }
  }
  // Polar haze.
  return mixRGB(col, darker(col, 0.35), smooth(1.1, 1.55, Math.abs(lat)) * 0.8);
}

function rockyColor(c: Ctx, lon: number, lat: number, clouds = true): RGB {
  const { body, n } = c;
  const u = lon + c.ox;
  const v = lat + c.oy;
  const e = fbm(n.elev, u * 1.15, v * 1.15, c.oct);
  const m = fbm(n.mott, u * 2.6, v * 2.6, 3);
  let col: RGB;

  if (e < c.sea) {
    const depth = clamp01((c.sea - e) / 0.2);
    col = mixRGB(lighter(c.liquid, 0.3), darker(c.liquid, 0.35), depth);
  } else {
    const k = c.sea >= 0 ? clamp01((e - c.sea) / 0.28) : clamp01((e - 0.32) / 0.42);
    col = k < 0.5 ? mixRGB(c.plain, c.rough, k * 2) : mixRGB(c.rough, c.mountain, (k - 0.5) * 2);
    col = scaleRGB(col, 0.86 + 0.28 * m);
    if (c.sea >= 0 && e < c.sea + 0.02) col = lighter(col, 0.3);
  }

  if (body.kind === "ice") {
    // Fractured crust: thin dark lineae.
    const r = Math.abs(fbm(n.ridge, u * 3, v * 3, 3) - 0.5);
    if (r < 0.018) col = darker(col, 0.28);
  } else if (body.kind === "volcanic") {
    const r = Math.abs(fbm(n.ridge, u * 2.4, v * 2.4, 4) - 0.5);
    const width = 0.02 + 0.012 * body.tectonics;
    if (r < width) col = mixRGB(col, c.lava, 1 - r / width);
  }

  // Polar caps, ragged at the edge.
  const edge = c.capLat + (fbm(n.cap, u * 3, 0.5, 2) - 0.5) * 0.4;
  const cap = smooth(edge - 0.05, edge + 0.05, Math.abs(lat));
  if (cap > 0) col = mixRGB(col, c.ice, cap * (body.kind === "volcanic" ? 0.5 : 0.9));

  // Weather: swirled cloud decks on thick atmospheres, scattered cover on thin ones.
  if (!clouds) return col;
  if (body.pressureAtm > 3) {
    const warp = fbm(n.warp, u * 1.4, v * 2, 3) - 0.5;
    const cl = fbm(n.cloud, u * 1.6 + warp * 2.5, v * 3.8, 4);
    const deck = darker(lighter(c.base, 0.4), 0.05);
    col = mixRGB(col, deck, 0.7 * smooth(0.36, 0.58, cl));
  } else if (body.pressureAtm > 0.25 && body.kind !== "barren") {
    const cl = fbm(n.cloud, u * 1.9, v * 3.2, 4);
    col = mixRGB(col, WHITE, 0.75 * smooth(0.55, 0.68, cl));
  }
  return col;
}

function craterCount(body: Body): number {
  switch (body.kind) {
    case "barren":
    case "asteroid":
      return 1;
    case "desert":
    case "ice":
      return 0.3;
    case "volcanic":
      return 0.25;
    default:
      return 0;
  }
}

/** Dark bowls with a faint rim, placed on the globe and foreshortened toward the limb. */
function drawCraters(g: CanvasRenderingContext2D, seed: number, body: Body, size: number): void {
  const density = craterCount(body);
  if (density <= 0) return;
  const R = size / 2;
  const rnd = stream(hashSeed(seed, body.id, "craters"));
  const count = Math.round((size >= 128 ? 46 : size >= 64 ? 28 : 14) * density);
  g.save();
  g.beginPath();
  g.arc(R, R, R - 0.5, 0, Math.PI * 2);
  g.clip();
  for (let i = 0; i < count; i++) {
    const lon = (rnd() - 0.5) * 2.7;
    const lat = (rnd() - 0.5) * 2.5;
    const rad = R * (0.025 + rnd() * rnd() * 0.15);
    const z = Math.cos(lat) * Math.cos(lon);
    if (z < 0.12) continue;
    const x = R + R * Math.cos(lat) * Math.sin(lon);
    const y = R - R * Math.sin(lat);
    // Squash along the direction to the centre.
    const ang = Math.atan2(y - R, x - R);
    g.beginPath();
    g.ellipse(x, y, rad, rad * Math.max(0.25, z), ang, 0, Math.PI * 2);
    g.fillStyle = "rgba(0,0,0,0.2)";
    g.fill();
    g.lineWidth = Math.max(0.6, rad * 0.16);
    g.strokeStyle = "rgba(255,255,255,0.13)";
    g.stroke();
  }
  g.restore();
}

function render(seed: number, body: Body, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(size, size);
  const data = img.data;
  const c = makeCtx(seed, body, size);
  const giant = body.kind === "gasGiant" || body.kind === "iceGiant";
  const R = size / 2;

  for (let py = 0; py < size; py++) {
    const ny = (py + 0.5 - R) / R;
    for (let px = 0; px < size; px++) {
      const nx = (px + 0.5 - R) / R;
      const d2 = nx * nx + ny * ny;
      if (d2 >= 1) continue;
      const edge = clamp01((1 - Math.sqrt(d2)) * R);
      const lat = Math.asin(-ny);
      const lon = Math.atan2(nx, Math.sqrt(1 - d2));
      const col = giant ? giantColor(c, lon, lat) : rockyColor(c, lon, lat);
      const i = (py * size + px) * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = edge * 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (!giant) drawCraters(g, seed, body, size);
  return canvas;
}

const mapCache = new Map<string, HTMLCanvasElement>();

/**
 * The same surface the globe shows, unrolled: an equirectangular map (longitude across, latitude
 * down), cloud-free. Used as the backdrop of the landing-region chart.
 */
export function surfaceMap(seed: number, body: Body, w: number, h: number): HTMLCanvasElement {
  const key = `${seed}:${body.id}:${w}x${h}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(w, h);
  const c = makeCtx(seed, body, 128);
  for (let py = 0; py < h; py++) {
    const lat = (0.5 - (py + 0.5) / h) * Math.PI;
    for (let px = 0; px < w; px++) {
      const lon = ((px + 0.5) / w - 0.5) * Math.PI * 2;
      const col = rockyColor(c, lon, lat, false);
      const i = (py * w + px) * 4;
      img.data[i] = col[0];
      img.data[i + 1] = col[1];
      img.data[i + 2] = col[2];
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  if (mapCache.size >= 12) {
    const oldest = mapCache.keys().next();
    if (!oldest.done) mapCache.delete(oldest.value);
  }
  mapCache.set(key, canvas);
  return canvas;
}
