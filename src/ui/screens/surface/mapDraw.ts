/** Canvas drawing for the surface map. Pure functions: everything they need is passed in. */
import { COMMODITIES } from "../../../data/commodities";
import { remainingTonnes, TILE_KM, type Deposit, type PathStep, type RegionKnowledge, type RegionMap, type Vec2 } from "../../../sim";
import { UI } from "../../palette";

const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, "Courier New", monospace';
const MARGIN = 26;
const DEPLETED = "#5b6472";

export interface Layout {
  /** Pixels per tile (integer). */
  ts: number;
  ox: number;
  oy: number;
  cols: number;
  rows: number;
}

export function computeLayout(w: number, h: number, cols: number, rows: number): Layout {
  const ts = Math.max(4, Math.floor(Math.min((w - MARGIN * 2) / cols, (h - MARGIN * 2) / rows)));
  return {
    ts,
    ox: Math.round((w - ts * cols) / 2),
    oy: Math.round((h - ts * rows) / 2),
    cols,
    rows,
  };
}

export function tileAt(L: Layout, px: number, py: number): Vec2 | null {
  const x = Math.floor((px - L.ox) / L.ts);
  const y = Math.floor((py - L.oy) / L.ts);
  return x < 0 || y < 0 || x >= L.cols || y >= L.rows ? null : { x, y };
}

const cx = (L: Layout, x: number) => L.ox + (x + 0.5) * L.ts;
const cy = (L: Layout, y: number) => L.oy + (y + 0.5) * L.ts;

export function drawBase(ctx: CanvasRenderingContext2D, w: number, h: number, L: Layout, terrain: HTMLCanvasElement): void {
  ctx.fillStyle = UI.space;
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(terrain, L.ox, L.oy, L.ts * L.cols, L.ts * L.rows);

  // Survey grid: faint per tile, brighter every 8 tiles (16 km).
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  if (L.ts >= 7) {
    ctx.strokeStyle = "rgba(10, 14, 26, 0.16)";
    ctx.beginPath();
    for (let i = 0; i <= L.cols; i++) {
      ctx.moveTo(L.ox + i * L.ts + 0.5, L.oy);
      ctx.lineTo(L.ox + i * L.ts + 0.5, L.oy + L.rows * L.ts);
    }
    for (let j = 0; j <= L.rows; j++) {
      ctx.moveTo(L.ox, L.oy + j * L.ts + 0.5);
      ctx.lineTo(L.ox + L.cols * L.ts, L.oy + j * L.ts + 0.5);
    }
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(215, 227, 244, 0.22)";
  ctx.beginPath();
  for (let i = 0; i <= L.cols; i += 8) {
    ctx.moveTo(L.ox + i * L.ts + 0.5, L.oy);
    ctx.lineTo(L.ox + i * L.ts + 0.5, L.oy + L.rows * L.ts);
  }
  for (let j = 0; j <= L.rows; j += 8) {
    ctx.moveTo(L.ox, L.oy + j * L.ts + 0.5);
    ctx.lineTo(L.ox + L.cols * L.ts, L.oy + j * L.ts + 0.5);
  }
  ctx.stroke();

  // Frame and kilometre ticks.
  ctx.strokeStyle = UI.gridBright;
  ctx.strokeRect(L.ox - 0.5, L.oy - 0.5, L.cols * L.ts + 1, L.rows * L.ts + 1);
  ctx.fillStyle = UI.muted;
  ctx.font = `10px ${FONT}`;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  for (let i = 0; i <= L.cols; i += 8) ctx.fillText(String(i * TILE_KM), L.ox + i * L.ts, L.oy - 8);
  ctx.textAlign = "right";
  for (let j = 0; j <= L.rows; j += 8) ctx.fillText(String(j * TILE_KM), L.ox - 7, L.oy + j * L.ts + 3);
  ctx.textAlign = "left";
  ctx.fillText("km", L.ox + L.cols * L.ts + 6, L.oy - 8);
}

/** A little lander on its pad. */
export function drawShip(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2): void {
  const x = cx(L, at.x);
  const y = cy(L, at.y);
  const s = L.ts * 0.5;
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(5, 7, 15, 0.45)";
  ctx.beginPath();
  ctx.arc(x, y + s * 0.15, s * 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = UI.ship;
  ctx.fillStyle = UI.ship;
  ctx.lineWidth = Math.max(1.5, L.ts * 0.09);
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

export function drawSensorRange(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2, radius: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.ox, L.oy, L.cols * L.ts, L.rows * L.ts);
  ctx.clip();
  const x = L.ox + (at.x - radius) * L.ts;
  const y = L.oy + (at.y - radius) * L.ts;
  const size = (radius * 2 + 1) * L.ts;
  ctx.fillStyle = "rgba(95, 212, 255, 0.07)";
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = "rgba(95, 212, 255, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x, y, size, size);
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
  const r = Math.max(5, L.ts * 0.38);
  ctx.setLineDash([]);
  for (const d of map.deposits) {
    if (!know.discovered.includes(d.id)) continue;
    const x = cx(L, d.x);
    const y = cy(L, d.y);
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
      ctx.strokeRect(x - L.ts / 2 - 2 - grow, y - L.ts / 2 - 2 - grow, L.ts + 4 + grow * 2, L.ts + 4 + grow * 2);
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
  const u = Math.max(5, L.ts * 0.36);
  ctx.setLineDash([]);
  for (const f of map.flora) {
    if (!know.floraFound.includes(f.id)) continue;
    const x = cx(L, f.x);
    const y = cy(L, f.y);
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
      ctx.strokeRect(x - L.ts / 2 - 2 - grow, y - L.ts / 2 - 2 - grow, L.ts + 4 + grow * 2, L.ts + 4 + grow * 2);
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

/** Corner brackets around a tile with a drill rig set up. */
function drillMark(ctx: CanvasRenderingContext2D, L: Layout, d: Deposit, depleted: boolean): void {
  const x0 = L.ox + d.x * L.ts + 1;
  const y0 = L.oy + d.y * L.ts + 1;
  const s = L.ts - 2;
  const k = Math.max(3, s * 0.3);
  ctx.strokeStyle = depleted ? "#8a93a0" : UI.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [ax, ay, sx, sy] of [
    [x0, y0, 1, 1],
    [x0 + s, y0, -1, 1],
    [x0, y0 + s, 1, -1],
    [x0 + s, y0 + s, -1, -1],
  ] as const) {
    ctx.moveTo(ax + sx * k, ay);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax, ay + sy * k);
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
      ctx.arc(cx(L, p.x), cy(L, p.y), 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (target) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(L.ox + target.x * L.ts + 1, L.oy + target.y * L.ts + 1, L.ts - 2, L.ts - 2);
  }
}

function trace(ctx: CanvasRenderingContext2D, L: Layout, from: Vec2, path: readonly PathStep[]): void {
  ctx.beginPath();
  ctx.moveTo(cx(L, from.x), cy(L, from.y));
  for (const p of path) ctx.lineTo(cx(L, p.x), cy(L, p.y));
  ctx.stroke();
}

export function drawHoverTile(ctx: CanvasRenderingContext2D, L: Layout, tile: Vec2): void {
  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(L.ox + tile.x * L.ts + 0.5, L.oy + tile.y * L.ts + 0.5, L.ts - 1, L.ts - 1);
}

let roverImg: HTMLImageElement | null = null;

/** The rover sprite once it has loaded; null until then (callers fall back to a plain marker). */
function roverSprite(): HTMLImageElement | null {
  if (!roverImg && typeof Image !== "undefined") {
    roverImg = new Image();
    roverImg.src = "./assets/rover.png";
  }
  return roverImg && roverImg.complete && roverImg.naturalWidth > 0 ? roverImg : null;
}

/**
 * The rover at a (possibly fractional) tile position. `shift` nudges it off the ship's pad;
 * `facing` is +1 or -1 and mirrors the sprite to the direction of travel.
 */
export function drawRover(ctx: CanvasRenderingContext2D, L: Layout, at: Vec2, timeMs: number, shift: boolean, facing = 1): void {
  const off = shift ? L.ts * 0.26 : 0;
  const x = cx(L, at.x) + off;
  const y = cy(L, at.y) + off;
  const pulse = 0.5 + 0.5 * Math.sin(timeMs / 350);
  ctx.setLineDash([]);
  const sprite = roverSprite();
  if (sprite) {
    const w = L.ts * 2;
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
  const r = Math.max(4, L.ts * 0.3);
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
