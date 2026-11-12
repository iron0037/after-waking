/**
 * The clan-outpost mark (AW-246): a domed building with a pennant, on a dark badge with a teal rim.
 * One shape for every map (drawOutpostIcon) and for text (OutpostIcon), so it reads the same everywhere.
 */
import { UI } from "./palette";

/** Draw the mark centered at (cx, cy) with outer radius r. */
export function drawOutpostIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(5, 7, 15, 0.88)";
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r / 6);
  ctx.strokeStyle = UI.outpost;
  ctx.stroke();
  const ground = cy + r * 0.38;
  ctx.fillStyle = UI.outpost;
  ctx.strokeStyle = UI.outpost;
  // The dome.
  ctx.beginPath();
  ctx.arc(cx, ground, r * 0.48, Math.PI, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  // The ground line.
  ctx.lineWidth = Math.max(1, r / 9);
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.66, ground);
  ctx.lineTo(cx + r * 0.66, ground);
  ctx.stroke();
  // The mast and its pennant.
  const top = cy - r * 0.66;
  ctx.beginPath();
  ctx.moveTo(cx, ground - r * 0.45);
  ctx.lineTo(cx, top);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + r * 0.42, top + r * 0.13);
  ctx.lineTo(cx, top + r * 0.28);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The same mark inline with text. */
export function OutpostIcon({ size = 14, title }: { size?: number; title?: string }) {
  return (
    <svg class="outpost-icon" width={size} height={size} viewBox="-10 -10 20 20" aria-label={title ?? "outpost"} role="img">
      {title && <title>{title}</title>}
      <circle r="9" fill="rgba(5, 7, 15, 0.88)" stroke={UI.outpost} stroke-width="1.6" />
      <path d="M -4.6 3.6 A 4.6 4.6 0 0 1 4.6 3.6 Z" fill={UI.outpost} />
      <line x1="-6" y1="3.6" x2="6" y2="3.6" stroke={UI.outpost} stroke-width="1.1" />
      <line x1="0" y1="-0.9" x2="0" y2="-6" stroke={UI.outpost} stroke-width="1.1" />
      <path d="M 0 -6 L 3.8 -4.8 L 0 -3.5 Z" fill={UI.outpost} />
    </svg>
  );
}
