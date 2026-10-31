/**
 * Canvas drawing for the surface map (pointy-top hexes, odd-r layout). The map is a camera over the whole
 * planet in planet-wide hex coordinates; only the regions in view are drawn. Pure functions: everything they
 * need is passed in.
 */
import { COMMODITIES } from "../../../data/commodities";
import { FLORA_BY_NAME } from "../../../data/catalog";
import {
  disk,
  hexCorners,
  hexDistance,
  hexToPixel,
  pixelToHex,
  REGION_SIZE,
  remainingTonnes,
  step,
  type Deposit,
  type HexDir,
  type PathStep,
  type RegionKnowledge,
  type SurfaceDeposit,
  type SurfaceFlora,
  type SurfaceLayout,
  type Vec2,
} from "../../../sim";
import { RARITY_COLOR, UI } from "../../palette";
import { HEX, hexPath, type RegionImage } from "./terrainImage";

const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace';
const MARGIN_X = 14;
const MARGIN_TOP = 14;
/** Room under the map for the hint line and terrain legend. */
const MARGIN_BOTTOM = 42;
const DEPLETED = "#5b6472";
const SQRT3 = Math.sqrt(3);

export interface Layout {
  /** Hex circumradius in pixels. */
  size: number;
  /** Hex width in pixels: the stand-in for "tile size" when scaling icons and sprites. */
  tw: number;
  /** Scale from the offscreen terrain images (drawn at HEX) to the screen. */
  k: number;
  /** Screen position of the planet-wide pixel origin (hexToPixel space). */
  ox: number;
  oy: number;
  /** The whole surface, in tiles. */
  cols: number;
  rows: number;
  /** Viewport size in CSS pixels. */
  w: number;
  h: number;
}

/** Hex size at which one region fills the viewport (the default zoom). */
export function fitSize(w: number, h: number): number {
  const unitW = SQRT3 * (REGION_SIZE + 0.5);
  const unitH = 1.5 * (REGION_SIZE - 1) + 2;
  return Math.max(3, Math.min((w - MARGIN_X * 2) / unitW, (h - MARGIN_TOP - MARGIN_BOTTOM) / unitH));
}

/** Where the map's centre sits on screen: the middle of the area above the footer. */
export function viewCenter(w: number, h: number): Vec2 {
  return { x: w / 2, y: MARGIN_TOP + (h - MARGIN_TOP - MARGIN_BOTTOM) / 2 };
}

/**
 * A camera layout: hexes of `size` px, with the point `center` (in unit hex-pixel space, i.e.
 * hexToPixel(x, y, 1)) at the middle of the view.
 */
export function cameraLayout(w: number, h: number, cols: number, rows: number, size: number, center: Vec2): Layout {
  const c = viewCenter(w, h);
  return {
    size,
    tw: SQRT3 * size,
    k: size / HEX,
    ox: c.x - center.x * size,
    oy: c.y - center.y * size,
    cols,
    rows,
    w,
    h,
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

/** Screen position of a region's pixel origin (its tiles sit at that plus hexToPixel(local x, local y)). */
function regionScreenOrigin(L: Layout, origin: Vec2): Vec2 {
  // Region origins sit on even rows, so local hex parity matches planet-wide parity.
  return { x: L.ox + SQRT3 * origin.x * L.size, y: L.oy + 1.5 * origin.y * L.size };
}

/** A region on screen: its number and planet-wide origin tile. */
export interface ViewRegion {
  region: number;
  origin: Vec2;
}

/** Regions that overlap the viewport. */
export function visibleRegions(L: Layout, layout: SurfaceLayout): ViewRegion[] {
  // Unit hex-pixel bounds of the view, then the tile range (a tile of slack on every side).
  const ux0 = -L.ox / L.size;
  const uy0 = -L.oy / L.size;
  const ux1 = (L.w - L.ox) / L.size;
  const uy1 = (L.h - L.oy) / L.size;
  const tx0 = Math.floor(ux0 / SQRT3) - 1;
  const tx1 = Math.ceil(ux1 / SQRT3) + 1;
  const ty0 = Math.floor((uy0 - 1) / 1.5) - 1;
  const ty1 = Math.ceil((uy1 - 1) / 1.5) + 1;
  const c0 = Math.max(0, Math.floor(tx0 / REGION_SIZE));
  const c1 = Math.min(layout.cols - 1, Math.floor(tx1 / REGION_SIZE));
  const r0 = Math.max(0, Math.floor(ty0 / REGION_SIZE));
  const r1 = Math.min(layout.rows - 1, Math.floor(ty1 / REGION_SIZE));
  const out: ViewRegion[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const region = r * layout.cols + c;
      if (region < layout.regions) out.push({ region, origin: { x: c * REGION_SIZE, y: r * REGION_SIZE } });
    }
  }
  return out;
}

/** Tiles the rover's sensors are sweeping right now (mid-drive), painted in before the sim catches up. */
export interface Reveal {
  /** Full-color terrain images (not the fogged ones) of the regions the sweep touches. */
  terrain: RegionImage[];
  /** Every tile swept so far on this drive (planet-wide). */
  tiles: Vec2[];
}

let gridCache: { size: number; grid: Path2D; border: Path2D } | null = null;

/**
 * Hex outlines of one region, and its outer border, relative to the region's screen origin. Every region has
 * the same shape, so one pair of paths serves them all; rebuilt only when the hex size changes.
 */
function regionPaths(size: number): { grid: Path2D; border: Path2D } {
  if (gridCache && gridCache.size === size) return gridCache;
  const grid = new Path2D();
  const border = new Path2D();
  for (let y = 0; y < REGION_SIZE; y++) {
    for (let x = 0; x < REGION_SIZE; x++) {
      const c = hexToPixel(x, y, size);
      const pts = hexCorners(c.x, c.y, size);
      const first = pts[0] as Vec2;
      grid.moveTo(first.x, first.y);
      for (let i = 1; i < 6; i++) grid.lineTo((pts[i] as Vec2).x, (pts[i] as Vec2).y);
      grid.closePath();
      if (x > 0 && y > 0 && x < REGION_SIZE - 1 && y < REGION_SIZE - 1) continue;
      EDGE_DIRS.forEach((dir, i) => {
        const n = step(x, y, dir);
        if (n.x >= 0 && n.y >= 0 && n.x < REGION_SIZE && n.y < REGION_SIZE) return;
        const p = pts[i] as Vec2;
        const q = pts[(i + 1) % 6] as Vec2;
        border.moveTo(p.x, p.y);
        border.lineTo(q.x, q.y);
      });
    }
  }
  gridCache = { size, grid, border };
  return gridCache;
}

function blit(ctx: CanvasRenderingContext2D, L: Layout, img: RegionImage): void {
  // A thumbnail (far zoom) is a smaller canvas standing for a full-size image (`w` x `h` HEX pixels).
  ctx.drawImage(img.canvas, L.ox + img.x * L.k, L.oy + img.y * L.k, (img.w ?? img.canvas.width) * L.k, (img.h ?? img.canvas.height) * L.k);
}

/** A brief notice over the map while the region the ship is in is still being drawn. */
export function drawPreparing(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.save();
  ctx.fillStyle = "rgba(5, 7, 15, 0.82)";
  ctx.fillRect(0, 0, w, h);
  ctx.font = `14px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = UI.muted;
  ctx.fillText("Preparing the surface…", w / 2, h / 2);
  ctx.restore();
}

/** Strokes `path` (relative to a region's origin) once for each region in `regions`. */
function strokeEachRegion(ctx: CanvasRenderingContext2D, L: Layout, path: Path2D, regions: readonly ViewRegion[]): void {
  for (const r of regions) {
    const o = regionScreenOrigin(L, r.origin);
    ctx.translate(o.x, o.y);
    ctx.stroke(path);
    ctx.translate(-o.x, -o.y);
  }
}

/** The terrain of every region in view (`painted` images), the mid-drive sensor reveal, and the hex grid. */
export function drawBase(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  painted: readonly RegionImage[],
  regions: readonly ViewRegion[],
  reveal: Reveal | null = null,
): void {
  ctx.fillStyle = UI.space;
  ctx.fillRect(0, 0, L.w, L.h);
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  for (const img of painted) blit(ctx, L, img);
  if (reveal && reveal.tiles.length > 0 && reveal.terrain.length > 0) {
    ctx.save();
    ctx.translate(L.ox, L.oy);
    ctx.scale(L.k, L.k);
    ctx.beginPath();
    for (const t of reveal.tiles) {
      const c = hexToPixel(t.x, t.y, HEX);
      hexPath(ctx, c.x, c.y, HEX + 0.6);
    }
    ctx.clip();
    for (const img of reveal.terrain) ctx.drawImage(img.canvas, img.x, img.y);
    ctx.restore();
  }
  ctx.imageSmoothingEnabled = smoothing;

  // Subtle hex outlines.
  if (L.tw >= 7 && typeof Path2D !== "undefined") {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = "rgba(10, 14, 26, 0.2)";
    strokeEachRegion(ctx, L, regionPaths(L.size).grid, regions);
    ctx.restore();
  }
}

/**
 * Faint dashed outlines where regions meet, and a small "Region N" label in each region's top-left corner
 * (kept on screen while any of the region is). The `active` region is labelled a little brighter.
 */
export function drawRegionBorders(ctx: CanvasRenderingContext2D, L: Layout, regions: readonly ViewRegion[], active: number): void {
  if (typeof Path2D === "undefined") return;
  ctx.save();
  ctx.lineWidth = 1.25;
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = "rgba(215, 227, 244, 0.3)";
  strokeEachRegion(ctx, L, regionPaths(L.size).border, regions);
  ctx.setLineDash([]);
  ctx.font = `bold 11px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  const regionW = SQRT3 * (REGION_SIZE + 0.5) * L.size;
  const regionH = (1.5 * (REGION_SIZE - 1) + 2) * L.size;
  for (const r of regions) {
    const o = regionScreenOrigin(L, r.origin);
    const text = `Region ${r.region + 1}`;
    const tw = ctx.measureText(text).width;
    // Clamp into the view (clear of the zoom buttons), but never outside the region itself.
    const x = Math.min(Math.max(o.x + 8, 12), o.x + regionW - tw - 8);
    const y = Math.min(Math.max(o.y + 8, 48), o.y + regionH - 22);
    ctx.strokeStyle = "rgba(5, 7, 15, 0.85)";
    ctx.strokeText(text, x, y);
    ctx.fillStyle = r.region === active ? "rgba(215, 227, 244, 0.9)" : "rgba(215, 227, 244, 0.5)";
    ctx.fillText(text, x, y);
  }
  ctx.restore();
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

/** A deposit to draw, with its own region's knowledge. */
export interface DepositMark {
  d: SurfaceDeposit;
  know: RegionKnowledge;
}

/**
 * Every deposit in `deposits` (the caller picks which are known). Seams deeper than `drillReachM`
 * are drawn faded, with a dashed red outline and a strike, so they read as "not with this drill".
 */
export function drawDeposits(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  deposits: readonly DepositMark[],
  selectedKey: string | null,
  timeMs: number,
  drillReachM: number,
): void {
  const r = Math.max(5, L.tw * 0.38);
  ctx.setLineDash([]);
  for (const { d, know } of deposits) {
    const x = cx(L, d.x, d.y);
    const y = cy(L, d.x, d.y);
    const depleted = remainingTonnes(know, d) <= 0.05;
    const prospected = know.prospected.includes(d.id);
    const tooDeep = !depleted && d.depthM > drillReachM;

    if (know.drillSites.includes(d.id)) drillMark(ctx, L, d, depleted);

    diamond(ctx, x, y, r + 1.5);
    ctx.fillStyle = "rgba(5, 7, 15, 0.85)";
    ctx.fill();
    diamond(ctx, x, y, r);
    ctx.fillStyle = depleted ? DEPLETED : COMMODITIES[d.commodity].color;
    ctx.globalAlpha = tooDeep ? 0.4 : 1;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = depleted ? "#8a93a0" : tooDeep ? UI.danger : "rgba(255, 255, 255, 0.85)";
    if (tooDeep) ctx.setLineDash([2.5, 2]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (tooDeep) {
      // Struck through: out of this drill's reach.
      ctx.strokeStyle = UI.danger;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - r * 0.75, y + r * 0.75);
      ctx.lineTo(x + r * 0.75, y - r * 0.75);
      ctx.stroke();
      label(ctx, `${d.depthM} m`, x, y + r + 12, UI.danger);
    } else if (!prospected) {
      // unsurveyed: a "?" in the middle
      ctx.fillStyle = "rgba(5, 7, 15, 0.8)";
      ctx.font = `bold ${Math.round(r * 1.15)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("?", x, y + 0.5);
    } else if (!depleted) {
      label(ctx, `${Math.round(d.grade * 100)}%`, x, y + r + 12, UI.text);
    }

    if (d.key === selectedKey) {
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

/** Something the sensors flagged but haven't identified (Seam Sense, Field Botanist, Prospector's Eye). */
export interface UnknownMark {
  x: number;
  y: number;
  kind: "deposit" | "flora";
}

/** A dashed grey outline (diamond for a deposit, circle for a plant site) with a "?": something's there. */
export function drawUnknowns(ctx: CanvasRenderingContext2D, L: Layout, marks: readonly UnknownMark[], timeMs: number): void {
  const r = Math.max(5, L.tw * 0.36);
  const glow = 0.65 + 0.2 * Math.sin(timeMs / 600);
  for (const m of marks) {
    const x = cx(L, m.x, m.y);
    const y = cy(L, m.x, m.y);
    ctx.setLineDash([]);
    if (m.kind === "deposit") diamond(ctx, x, y, r + 1);
    else {
      ctx.beginPath();
      ctx.arc(x, y, r + 1, 0, Math.PI * 2);
    }
    ctx.fillStyle = "rgba(5, 7, 15, 0.75)";
    ctx.fill();
    ctx.setLineDash([2.5, 2]);
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = `rgba(200, 210, 225, ${glow})`;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(220, 228, 240, ${glow + 0.1})`;
    ctx.font = `bold ${Math.round(r * 1.15)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("?", x, y + 0.5);
  }
}

const LEAF = "#5fd47a";
const LEAF_DIM = "#4f7a5a";

/** A flora site to draw, with its own region's knowledge. */
export interface FloraMark {
  f: SurfaceFlora;
  know: RegionKnowledge;
}

/** A little sprout on each flora site given (the ones the rover has spotted); sampled ones are dimmed and ticked. */
export function drawFlora(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  flora: readonly FloraMark[],
  selectedKey: string | null,
  timeMs: number,
): void {
  const u = Math.max(5, L.tw * 0.36);
  ctx.setLineDash([]);
  for (const { f, know } of flora) {
    const x = cx(L, f.x, f.y);
    const y = cy(L, f.x, f.y);
    const sampled = know.floraSampled.includes(f.id);
    const color = sampled ? LEAF_DIM : LEAF;

    ctx.fillStyle = "rgba(5, 7, 15, 0.8)";
    ctx.beginPath();
    ctx.arc(x, y, u + 2, 0, Math.PI * 2);
    ctx.fill();
    // Rarity ring: grey common, green uncommon, gold rare.
    const rarity = FLORA_BY_NAME.get(f.species)?.rarity;
    if (rarity) {
      ctx.strokeStyle = RARITY_COLOR[rarity];
      ctx.globalAlpha = sampled ? 0.55 : 1;
      ctx.lineWidth = Math.max(1.5, u * 0.2);
      ctx.beginPath();
      ctx.arc(x, y, u + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
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

    if (f.key === selectedKey) {
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

/**
 * The hex the Selected Hex card describes: a crisp white outline over a dark keyline, so it reads on any terrain
 * and at any zoom (the line stays a couple of pixels wide, and grows outward a little when the hexes are tiny).
 */
export function drawSelectedHex(ctx: CanvasRenderingContext2D, L: Layout, tile: Vec2): void {
  const grow = L.size < 8 ? (8 - L.size) * 0.25 : 0;
  const w = Math.min(3, Math.max(1.75, L.size * 0.1));
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(5, 7, 15, 0.8)";
  ctx.lineWidth = w + 2.5;
  ctx.beginPath();
  tilePath(ctx, L, tile, grow);
  ctx.stroke();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = w;
  ctx.beginPath();
  tilePath(ctx, L, tile, grow);
  ctx.stroke();
  ctx.restore();
}

/** Period of the ship beacon's pulse, ms. */
const BEACON_MS = 1800;
let reducedMotionQuery: MediaQueryList | null | undefined;

/** True when the player has asked the OS for less motion. */
function prefersReducedMotion(): boolean {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  }
  return reducedMotionQuery?.matches ?? false;
}

/**
 * A yellow beacon on the ship's hex so it can't be lost: a slowly pulsing outline (alpha and width), and, when the
 * map is zoomed out, a soft halo and ring sized in screen pixels so it shows even when the ship sprite is tiny.
 * With reduced motion, the pulse is replaced by a steady glow. Drawn under the ship sprite.
 */
export function drawShipBeacon(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2, timeMs: number): void {
  const pulse = prefersReducedMotion() ? 0.6 : 0.5 - 0.5 * Math.cos((2 * Math.PI * (timeMs % BEACON_MS)) / BEACON_MS);
  const x = cx(L, at.x, at.y);
  const y = cy(L, at.x, at.y);
  // 1 when the hexes are tiny (<= 4 px), fading to 0 by 16 px.
  const far = Math.min(1, Math.max(0, (16 - L.size) / 12));
  ctx.save();
  ctx.setLineDash([]);
  if (far > 0) {
    const r = L.size + 14 + far * 28 + pulse * 6;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
    glow.addColorStop(0, `rgba(255, 214, 64, ${(0.45 + pulse * 0.2) * far})`);
    glow.addColorStop(0.6, `rgba(255, 214, 64, ${0.18 * far})`);
    glow.addColorStop(1, "rgba(255, 214, 64, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255, 214, 64, ${(0.5 + pulse * 0.4) * far})`;
    ctx.lineWidth = 1.5 + far * 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.8, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineJoin = "round";
  ctx.strokeStyle = `rgba(255, 214, 64, ${0.55 + pulse * 0.45})`;
  ctx.lineWidth = 1.5 + pulse * 1.5 + far;
  ctx.beginPath();
  tilePath(ctx, L, at, 0.5 + far);
  ctx.stroke();
  ctx.restore();
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

/**
 * The survey boat (AW-17) at a canvas pixel position, a clean top-down hull with its bow along `heading`
 * (degrees, 0 = north, clockwise). `moored` draws it at rest with a mooring ring instead of a wake;
 * `roverAboard` lashes a little rover to the deck.
 */
export function drawBoat(
  ctx: CanvasRenderingContext2D,
  L: Layout,
  at: Vec2,
  timeMs: number,
  heading: number,
  opts: { moored?: boolean; moving?: boolean; roverAboard?: boolean } = {},
): void {
  const u = Math.max(7, L.tw * 0.85);
  const bob = Math.sin(timeMs / 500 + at.x * 0.05) * u * 0.04;
  ctx.save();
  ctx.setLineDash([]);
  ctx.translate(at.x, at.y + bob);
  // Water disturbance: a soft ring (moored) or a wake behind the stern (underway).
  ctx.strokeStyle = "rgba(190, 235, 255, 0.55)";
  ctx.lineWidth = 1.2;
  if (opts.moored) {
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(0, 0, u * 1.15, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.rotate((heading * Math.PI) / 180);
  if (opts.moving) {
    ctx.beginPath();
    ctx.moveTo(-u * 0.3, u * 0.95);
    ctx.lineTo(-u * 0.7, u * 1.9);
    ctx.moveTo(u * 0.3, u * 0.95);
    ctx.lineTo(u * 0.7, u * 1.9);
    ctx.stroke();
  }
  const hull = (k: number): void => {
    ctx.beginPath();
    ctx.moveTo(0, -u * 1.05 * k);
    ctx.bezierCurveTo(u * 0.55 * k, -u * 0.55 * k, u * 0.5 * k, u * 0.5 * k, u * 0.4 * k, u * 0.9 * k);
    ctx.lineTo(-u * 0.4 * k, u * 0.9 * k);
    ctx.bezierCurveTo(-u * 0.5 * k, u * 0.5 * k, -u * 0.55 * k, -u * 0.55 * k, 0, -u * 1.05 * k);
    ctx.closePath();
  };
  // shadow on the water
  ctx.fillStyle = "rgba(5, 18, 32, 0.4)";
  ctx.save();
  ctx.translate(u * 0.08, u * 0.1);
  hull(1.04);
  ctx.fill();
  ctx.restore();
  // hull
  hull(1);
  ctx.fillStyle = "#e9f1f8";
  ctx.fill();
  ctx.lineWidth = Math.max(1.4, u * 0.1);
  ctx.strokeStyle = "#1f7f9b";
  ctx.lineJoin = "round";
  ctx.stroke();
  // deck well and cabin
  ctx.fillStyle = "#b9c9d8";
  ctx.fillRect(-u * 0.22, -u * 0.35, u * 0.44, u * 0.7);
  ctx.fillStyle = "#1f7f9b";
  ctx.fillRect(-u * 0.26, u * 0.42, u * 0.52, u * 0.3);
  ctx.fillStyle = "#0b2a38";
  ctx.fillRect(-u * 0.16, u * 0.5, u * 0.32, u * 0.1);
  if (opts.roverAboard) {
    // the rover lashed to the deck
    ctx.fillStyle = "rgba(5, 7, 15, 0.9)";
    ctx.fillRect(-u * 0.2, -u * 0.32, u * 0.4, u * 0.58);
    ctx.fillStyle = UI.cyan;
    ctx.fillRect(-u * 0.15, -u * 0.27, u * 0.3, u * 0.48);
    ctx.fillStyle = "#e8fbff";
    ctx.fillRect(-u * 0.09, -u * 0.18, u * 0.18, u * 0.16);
  }
  ctx.restore();
}

/** Shore hexes where the boat can put the rover off: tinted, with the hovered one picked out. */
export function drawShoreTargets(ctx: CanvasRenderingContext2D, L: Layout, tiles: readonly Vec2[], hover: Vec2 | null, timeMs: number): void {
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 260);
  ctx.setLineDash([]);
  for (const t of tiles) {
    const hot = hover !== null && hover.x === t.x && hover.y === t.y;
    ctx.fillStyle = `rgba(95, 212, 255, ${hot ? 0.45 : 0.18 + pulse * 0.12})`;
    ctx.beginPath();
    tilePath(ctx, L, t);
    ctx.fill();
    ctx.strokeStyle = hot ? "#e8fbff" : UI.cyan;
    ctx.lineWidth = hot ? 2 : 1.5;
    ctx.beginPath();
    tilePath(ctx, L, t, -1);
    ctx.stroke();
  }
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
