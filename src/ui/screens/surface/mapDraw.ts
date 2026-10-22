/** Canvas drawing for the surface map (pointy-top hexes, odd-r layout). Pure functions: everything they need is passed in. */
import { COMMODITIES } from "../../../data/commodities";
import {
  disk,
  hexCorners,
  hexDistance,
  hexToPixel,
  mapPixelSize,
  pixelToHex,
  remainingTonnes,
  step,
  type Deposit,
  type HexDir,
  type PathStep,
  type RegionKnowledge,
  type RegionMap,
  type Vec2,
} from "../../../sim";
import { UI } from "../../palette";
import { HEX, hexPath } from "./terrainImage";

const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace';
const MARGIN_X = 14;
const MARGIN_TOP = 14;
/** Room under the map for the hint line and terrain legend. */
const MARGIN_BOTTOM = 42;
const DEPLETED = "#5b6472";

export interface Layout {
  /** Hex circumradius in pixels (largest that fits the viewport). */
  size: number;
  /** Hex width in pixels: the stand-in for "tile size" when scaling icons and sprites. */
  tw: number;
  /** Scale from the offscreen terrain images (drawn at HEX) to the screen. */
  k: number;
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}

export function computeLayout(w: number, h: number, cols: number, rows: number): Layout {
  const unit = mapPixelSize(cols, rows, 1);
  const size = Math.max(3, Math.min((w - MARGIN_X * 2) / unit.w, (h - MARGIN_TOP - MARGIN_BOTTOM) / unit.h));
  const px = mapPixelSize(cols, rows, size);
  return {
    size,
    tw: Math.sqrt(3) * size,
    k: size / HEX,
    ox: Math.round((w - px.w) / 2),
    oy: Math.round(MARGIN_TOP + (h - MARGIN_TOP - MARGIN_BOTTOM - px.h) / 2),
    cols,
    rows,
  };
}

/** The tile under a canvas pixel, or null if it is off the map. */
export function tileAt(L: Layout, px: number, py: number): Vec2 | null {
  const t = pixelToHex(px - L.ox, py - L.oy, L.size);
  return t.x < 0 || t.y < 0 || t.x >= L.cols || t.y >= L.rows ? null : t;
}

/** Canvas pixel position of a tile's centre. */
export function tileCenter(L: Layout, t: Vec2): Vec2 {
  const c = hexToPixel(t.x, t.y, L.size);
  return { x: L.ox + c.x, y: L.oy + c.y };
}

const cx = (L: Layout, x: number, y: number) => L.ox + hexToPixel(x, y, L.size).x;
const cy = (L: Layout, x: number, y: number) => L.oy + hexToPixel(x, y, L.size).y;

/** Adds the hex tile (as a closed subpath, screen space) to the current path. */
function tilePath(ctx: CanvasRenderingContext2D, L: Layout, t: Vec2, grow = 0): void {
  hexPath(ctx, cx(L, t.x, t.y), cy(L, t.x, t.y), L.size + grow);
}

/** Tiles the rover's sensors are sweeping right now (mid-drive), painted in before the sim catches up. */
export interface Reveal {
  /** The full-color terrain image (not the fogged one). */
  terrain: HTMLCanvasElement;
  /** Every tile swept so far on this drive. */
  tiles: Vec2[];
}

let gridCache: { key: string; path: Path2D } | null = null;

/** All hex outlines of the map as one path, relative to the map origin; rebuilt only when the size changes. */
function gridPath(L: Layout): Path2D {
  const key = `${L.cols}x${L.rows}@${L.size.toFixed(3)}`;
  if (gridCache && gridCache.key === key) return gridCache.path;
  const path = new Path2D();
  for (let y = 0; y < L.rows; y++) {
    for (let x = 0; x < L.cols; x++) {
      const c = hexToPixel(x, y, L.size);
      const pts = hexCorners(c.x, c.y, L.size);
      const first = pts[0] as Vec2;
      path.moveTo(first.x, first.y);
      for (let i = 1; i < 6; i++) path.lineTo((pts[i] as Vec2).x, (pts[i] as Vec2).y);
      path.closePath();
    }
  }
  gridCache = { key, path };
  return path;
}

export function drawBase(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  L: Layout,
  terrain: HTMLCanvasElement,
  reveal: Reveal | null = null,
): void {
  ctx.fillStyle = UI.space;
  ctx.fillRect(0, 0, w, h);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(terrain, L.ox, L.oy, terrain.width * L.k, terrain.height * L.k);
  if (reveal && reveal.tiles.length > 0) {
    ctx.save();
    ctx.translate(L.ox, L.oy);
    ctx.scale(L.k, L.k);
    ctx.beginPath();
    for (const t of reveal.tiles) {
      const c = hexToPixel(t.x, t.y, HEX);
      hexPath(ctx, c.x, c.y, HEX + 0.6);
    }
    ctx.clip();
    ctx.drawImage(reveal.terrain, 0, 0);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smoothing;

  // Subtle hex outlines.
  if (L.tw >= 7 && typeof Path2D !== "undefined") {
    ctx.save();
    ctx.translate(L.ox, L.oy);
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(10, 14, 26, 0.2)";
    ctx.stroke(gridPath(L));
    ctx.restore();
  }
}

/** A little lander on its pad. */
export function drawShip(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2): void {
  const x = cx(L, at.x, at.y);
  const y = cy(L, at.x, at.y);
  const s = L.tw * 0.5;
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(5, 7, 15, 0.45)";
  ctx.beginPath();
  ctx.arc(x, y + s * 0.15, s * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI.ship;
  ctx.fillStyle = UI.ship;
  ctx.lineWidth = Math.max(1.5, L.tw * 0.09);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // legs
  ctx.beginPath();
  ctx.moveTo(x - s * 0.35, y + s * 0.2);
  ctx.lineTo(x - s * 0.8, y + s * 0.85);
  ctx.moveTo(x + s * 0.35, y + s * 0.2);
  ctx.lineTo(x + s * 0.8, y + s * 0.85);
  ctx.stroke();
  // hull
  ctx.beginPath();
  ctx.moveTo(x, y - s * 0.95);
  ctx.lineTo(x + s * 0.45, y - s * 0.1);
  ctx.lineTo(x + s * 0.45, y + s * 0.35);
  ctx.lineTo(x - s * 0.45, y + s * 0.35);
  ctx.lineTo(x - s * 0.45, y - s * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#3a2a10";
  ctx.beginPath();
  ctx.arc(x, y - s * 0.15, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = "butt";
}

/** Marks a tile where the ship can't set down (move-ship targeting). */
export function drawBlockedTile(ctx: CanvasRenderingContext2D, L: Layout, tile: Vec2): void {
  const x = cx(L, tile.x, tile.y);
  const y = cy(L, tile.x, tile.y);
  const d = L.size * 0.5;
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255, 90, 90, 0.35)";
  ctx.beginPath();
  tilePath(ctx, L, tile);
  ctx.fill();
  ctx.strokeStyle = UI.danger;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x - d, y - d);
  ctx.lineTo(x + d, y + d);
  ctx.moveTo(x + d, y - d);
  ctx.lineTo(x - d, y + d);
  ctx.stroke();
}

/** Edge i of a hex (corner i to corner i+1) faces these directions, in order. */
const EDGE_DIRS: readonly HexDir[] = ["e", "se", "sw", "w", "nw", "ne"];

/** The sensor sweep: a hex disk of `radius` around `at`, tinted, with a dashed outline around its rim. */
export function drawSensorRange(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2, radius: number): void {
  const tiles = disk(at, radius).filter((t) => t.x >= 0 && t.y >= 0 && t.x < L.cols && t.y < L.rows);
  ctx.save();
  ctx.fillStyle = "rgba(95, 212, 255, 0.07)";
  ctx.beginPath();
  for (const t of tiles) tilePath(ctx, L, t);
  ctx.fill();
  ctx.strokeStyle = "rgba(95, 212, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.lineJoin = "round";
  ctx.beginPath();
  for (const t of tiles) {
    const pts = hexCorners(cx(L, t.x, t.y), cy(L, t.x, t.y), L.size);
    EDGE_DIRS.forEach((dir, i) => {
      const n = step(t.x, t.y, dir);
      if (hexDistance(n, at) <= radius) return;
      const p = pts[i] as Vec2;
      const q = pts[(i + 1) % 6] as Vec2;
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
    });
  }
  ctx.stroke();
  ctx.restore();
}

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
}

export function drawDeposits(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  map: RegionMap,
  know: RegionKnowledge,
  selectedId: number | null,
  timeMs: number,
): void {
  const r = Math.max(5, L.tw * 0.38);
  ctx.setLineDash([]);
  for (const d of map.deposits) {
    if (!know.discovered.includes(d.id)) continue;
    const x = cx(L, d.x, d.y);
    const y = cy(L, d.x, d.y);
    const depleted = remainingTonnes(know, d) <= 0.05;
    const prospected = know.prospected.includes(d.id);

    if (know.drillSites.includes(d.id)) drillMark(ctx, L, d, depleted);

    diamond(ctx, x, y, r + 1.5);
    ctx.fillStyle = "rgba(5, 7, 15, 0.85)";
    ctx.fill();
    diamond(ctx, x, y, r);
    ctx.fillStyle = depleted ? DEPLETED : COMMODITIES[d.commodity].color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = depleted ? "#8a93a0" : "rgba(255, 255, 255, 0.85)";
    ctx.stroke();
    if (!prospected) {
      // unsurveyed: a "?" in the middle
      ctx.fillStyle = "rgba(5, 7, 15, 0.8)";
      ctx.font = `bold ${Math.round(r * 1.15)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x, y + 0.5);
    } else if (!depleted) {
      label(ctx, `${Math.round(d.grade * 100)}%`, x, y + r + 12, UI.text);
    }

    if (d.id === selectedId) {
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 260);
      const grow = pulse * 2;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      tilePath(ctx, L, d, 1 + grow);
      ctx.stroke();
    }
  }
}

const LEAF = "#5fd47a";
const LEAF_DIM = "#4f7a5a";

/** A little sprout on every flora site the rover has spotted; sampled ones are dimmed and ticked. */
export function drawFlora(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  map: RegionMap,
  know: RegionKnowledge,
  selectedId: number | null,
  timeMs: number,
): void {
  const u = Math.max(5, L.tw * 0.36);
  ctx.setLineDash([]);
  for (const f of map.flora) {
    if (!know.floraFound.includes(f.id)) continue;
    const x = cx(L, f.x, f.y);
    const y = cy(L, f.x, f.y);
    const sampled = know.floraSampled.includes(f.id);
    const color = sampled ? LEAF_DIM : LEAF;

    ctx.fillStyle = "rgba(5, 7, 15, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, u + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.2, u * 0.16);
    ctx.lineCap = "round";
    // stem
    ctx.beginPath();
    ctx.moveTo(x, y + u * 0.75);
    ctx.lineTo(x, y - u * 0.15);
    ctx.stroke();
    // leaves: left, right, and a bud on top
    leaf(ctx, x, y + u * 0.2, -1, u);
    leaf(ctx, x, y + u * 0.2, 1, u);
    ctx.beginPath();
    ctx.ellipse(x, y - u * 0.4, u * 0.2, u * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = "butt";

    if (sampled) {
      ctx.strokeStyle = UI.text;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + u * 0.35, y + u * 0.95);
      ctx.lineTo(x + u * 0.7, y + u * 1.3);
      ctx.lineTo(x + u * 1.3, y + u * 0.55);
      ctx.stroke();
    }

    if (f.id === selectedId) {
      const pulse = 0.5 + 0.5 * Math.sin(timeMs / 260);
      const grow = pulse * 2;
      ctx.strokeStyle = `rgba(126, 231, 135, ${0.55 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      tilePath(ctx, L, f, 1 + grow);
      ctx.stroke();
    }
  }
}

/** One leaf curling out from (x, y) to the left (dir -1) or right (dir 1). */
function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, dir: number, u: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + dir * u * 0.9, y - u * 0.1, x + dir * u * 0.85, y - u * 0.75);
  ctx.quadraticCurveTo(x + dir * u * 0.15, y - u * 0.55, x, y);
  ctx.fill();
}

/** Corner brackets around a hex with a drill rig set up. */
function drillMark(ctx: CanvasRenderingContext2D, L: Layout, d: Deposit, depleted: boolean): void {
  const pts = hexCorners(cx(L, d.x, d.y), cy(L, d.x, d.y), L.size - 1);
  const f = 0.35;
  ctx.strokeStyle = depleted ? "#8a93a0" : UI.accent;
  ctx.lineWidth = 2;
  ctx.lineJoin = "miter";
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const p = pts[i] as Vec2;
    const a = pts[(i + 5) % 6] as Vec2;
    const b = pts[(i + 1) % 6] as Vec2;
    ctx.moveTo(p.x + (a.x - p.x) * f, p.y + (a.y - p.y) * f);
    ctx.lineTo(p.x, p.y);
    ctx.lineTo(p.x + (b.x - p.x) * f, p.y + (b.y - p.y) * f);
  }
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = "rgba(5, 7, 15, 0.9)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

export function drawRoute(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  from: Vec2,
  path: readonly PathStep[],
  color: string,
  target: Vec2 | null,
): void {
  if (path.length > 0) {
    ctx.strokeStyle = "rgba(5, 7, 15, 0.7)";
    ctx.lineWidth = 4;
    ctx.setLineDash([]);
    trace(ctx, L, from, path);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    trace(ctx, L, from, path);
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    for (const p of path) {
      ctx.beginPath();
      ctx.arc(cx(L, p.x, p.y), cy(L, p.x, p.y), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (target) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    tilePath(ctx, L, target, -1);
    ctx.stroke();
  }
}

function trace(ctx: CanvasRenderingContext2D, L: Layout, from: Vec2, path: readonly PathStep[]): void {
  ctx.beginPath();
  ctx.moveTo(cx(L, from.x, from.y), cy(L, from.x, from.y));
  for (const p of path) ctx.lineTo(cx(L, p.x, p.y), cy(L, p.x, p.y));
  ctx.stroke();
}

export function drawHoverTile(ctx: CanvasRenderingContext2D, L: Layout, tile: Vec2): void {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  tilePath(ctx, L, tile, -0.5);
  ctx.stroke();
}

let roverImg: HTMLImageElement | null = null;
let roverTopImg: HTMLImageElement | null = null;
let roverTopFailed = false;

/** The rover sprite once it has loaded; null until then (callers fall back to a plain marker). */
function roverSprite(): HTMLImageElement | null {
  if (!roverImg && typeof Image !== "undefined") {
    roverImg = new Image();
    roverImg.src = "./assets/rover.png";
  }
  return roverImg && roverImg.complete && roverImg.naturalWidth > 0 ? roverImg : null;
}

/** The optional top-down rover sprite (nose pointing up); null if it is missing, broken or still loading. */
function roverTopSprite(): HTMLImageElement | null {
  if (roverTopFailed) return null;
  if (!roverTopImg && typeof Image !== "undefined") {
    const img = new Image();
    img.onerror = () => {
      roverTopFailed = true;
    };
    img.src = "./assets/rover-top.png";
    roverTopImg = img;
  }
  return roverTopImg && roverTopImg.complete && roverTopImg.naturalWidth > 0 ? roverTopImg : null;
}

/** Where the rover is drawn: `shift` nudges it off the ship's pad. `at` is a canvas pixel position. */
function roverPoint(L: Layout, at: Vec2, shift: boolean): { x: number; y: number } {
  const off = shift ? L.tw * 0.26 : 0;
  return { x: at.x + off, y: at.y + off };
}

/**
 * The rover at a canvas pixel position (a tile centre, or in between mid-drive; see `tileCenter`). `shift` nudges
 * it off the ship's pad.
 * With the top-down sprite, `heading` (degrees, 0 = north, clockwise) rotates it; otherwise
 * `facing` is +1 or -1 and mirrors the side-view sprite to the direction of travel.
 */
export function drawRover(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  at: Vec2,
  timeMs: number,
  shift: boolean,
  facing = 1,
  heading = 0,
): void {
  const { x, y } = roverPoint(L, at, shift);
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 350);
  ctx.setLineDash([]);
  const top = roverTopSprite();
  if (top) {
    const h = L.tw * 1.7;
    const w = h * (top.naturalWidth / top.naturalHeight);
    ctx.fillStyle = `rgba(95, 212, 255, ${0.1 + pulse * 0.1})`;
    ctx.beginPath();
    ctx.arc(x, y, h * 0.45, 0, Math.PI * 2);
    ctx.fill();
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((heading * Math.PI) / 180);
    ctx.drawImage(top, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = prev;
    return;
  }
  const sprite = roverSprite();
  if (sprite) {
    const w = L.tw * 2;
    const h = w * (sprite.naturalHeight / sprite.naturalWidth);
    ctx.fillStyle = `rgba(95, 212, 255, ${0.1 + pulse * 0.1})`;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.12, w * 0.5, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    const prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(facing < 0 ? -1 : 1, 1);
    ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = prev;
    return;
  }
  const r = Math.max(4, L.tw * 0.3);
  ctx.fillStyle = `rgba(95, 212, 255, ${0.12 + pulse * 0.15})`;
  ctx.beginPath();
  ctx.arc(x, y, r * (1.5 + pulse * 0.5), 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(5, 7, 15, 0.9)";
  ctx.fillRect(x - r - 1.5, y - r * 0.75 - 1.5, (r + 1.5) * 2, r * 1.5 + 3);
  ctx.fillStyle = "#e8fbff";
  ctx.fillRect(x - r, y - r * 0.75, r * 2, r * 1.5);
  ctx.fillStyle = UI.cyan;
  ctx.fillRect(x - r * 0.55, y - r * 0.4, r * 1.1, r * 0.8);
}

/** What a hovered route would do to the rover's cells. */
export interface EnergyPreview {
  /** Energy the move would use. */
  cost: number;
  /** Energy needed to drive home from the route's end; null if there is no way home. */
  back: number | null;
}

function energyColor(frac: number): string {
  return frac > 0.5 ? UI.good : frac > 0.25 ? UI.accent : UI.danger;
}

/**
 * A small energy gauge under the rover (`at` is a canvas pixel position): green → amber → red as it drops. With a `preview`, the energy a
 * move would burn is a striped segment at the end of the fill, and a tick marks the reserve needed to get
 * home afterwards. The gauge is outlined red when the trip can't be afforded.
 */
export function drawEnergyBar(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  at: Vec2,
  shift: boolean,
  energy: number,
  max: number,
  preview: EnergyPreview | null,
): void {
  if (max <= 0) return;
  const { x, y } = roverPoint(L, at, shift);
  const bw = Math.round(Math.min(64, Math.max(26, L.tw * 1.6)));
  const bh = L.tw >= 14 ? 6 : 5;
  const bx = Math.round(x - bw / 2);
  // Just under the hex's lower corner.
  const by = Math.round(y + L.size * 0.85);
  const frac = Math.max(0, Math.min(1, energy / max));
  const fillW = Math.round(bw * frac);
  const cost = preview ? Math.max(0, preview.cost) : 0;
  const afterFrac = Math.max(0, Math.min(1, (energy - cost) / max));
  const keepW = preview ? Math.round(bw * afterFrac) : fillW;
  const short = preview !== null && cost > energy;
  const strands = preview !== null && (preview.back === null || cost + preview.back > energy);

  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(5, 7, 15, 0.88)";
  ctx.fillRect(bx - 1.5, by - 1.5, bw + 3, bh + 3);
  // remaining fill
  ctx.fillStyle = energyColor(preview ? afterFrac : frac);
  ctx.fillRect(bx, by, keepW, bh);
  if (preview && fillW > keepW) {
    // the segment the move would burn: striped
    const sx = bx + keepW;
    const sw = fillW - keepW;
    const col = short || strands ? UI.danger : "#e8fbff";
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, by, sw, bh);
    ctx.clip();
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(sx, by, sw, bh);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = -bh; i < sw + bh; i += 4) {
      ctx.moveTo(sx + i, by + bh);
      ctx.lineTo(sx + i + bh, by);
    }
    ctx.stroke();
    ctx.restore();
  }
  if (preview && preview.back !== null) {
    // reserve marker: the energy the trip home needs
    const mx = Math.round(bx + bw * Math.min(1, preview.back / max)) + 0.5;
    ctx.strokeStyle = strands ? UI.danger : UI.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx, by - 3);
    ctx.lineTo(mx, by + bh + 3);
    ctx.stroke();
  }
  ctx.strokeStyle = short || strands ? UI.danger : "rgba(215, 227, 244, 0.55)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
  ctx.restore();
}

export interface TipLine {
  text: string;
  color: string;
}

export function drawTooltip(ctx: CanvasRenderingContext2D, w: number, h: number, mx: number, my: number, lines: TipLine[]): void {
  if (lines.length === 0) return;
  ctx.font = `12px ${FONT}`;
  const pad = 8;
  const lineH = 16;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l.text).width)) + pad * 2;
  const bh = lines.length * lineH + pad * 2 - 4;
  let x = mx + 16;
  let y = my + 16;
  if (x + bw > w - 4) x = mx - 16 - bw;
  if (y + bh > h - 4) y = my - 16 - bh;
  x = Math.max(4, x);
  y = Math.max(4, y);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(10, 14, 26, 0.95)";
  ctx.fillRect(x, y, bw, bh);
  ctx.strokeStyle = "#36507a";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, bh - 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, x + pad, y + pad + 9 + i * lineH);
  });
}
