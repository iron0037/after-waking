/**
 * Renders each region's terrain once into offscreen images: every hex filled with its terrain colour and
 * hillshaded relief. The images are drawn at a fixed hex size (`HEX`) and scaled to the screen when blitted.
 *
 * The pixel work (terrainPixels.ts) is slow, so `TerrainCache` runs it in a Web Worker (terrainWorker.ts) and
 * hands back ImageBitmaps; where there is no Worker (tests, odd browsers) it falls back to computing the same
 * pixels synchronously on the main thread.
 *
 * Images live in planet-wide "HEX pixel" space (hexToPixel(gx, gy, HEX)). Each one covers its region plus a
 * one-tile margin borrowed from the neighbours, and sits on whole-pixel offsets of that shared space, so
 * neighbouring images overlap pixel for pixel and the seams between regions don't show.
 */
import type { BodyKind, BodySurface } from "../../../sim";
import { hexCorners } from "../../../sim";
import { ATLAS_PATH, loadTextures, texturesReady } from "./terrainTextures";
import { computeFoggedPixels, computeTerrainPixels, HEX, tileRange, type RegionPixels } from "./terrainPixels";
import type { BuiltMessage, RequestMessage, WorkerReply } from "./terrainWorker";

loadTextures();

export { HEX };

/** Adds one closed hexagon to the current path. */
export function hexPath(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const pts = hexCorners(x, y, size);
  const first = pts[0] as { x: number; y: number };
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < 6; i++) ctx.lineTo((pts[i] as { x: number }).x, (pts[i] as { y: number }).y);
  ctx.closePath();
}

/** What an image is drawn from: a canvas (composed on the main thread) or a bitmap (rendered in the worker). */
export type ImageSource = HTMLCanvasElement | ImageBitmap;

/** An offscreen image of one region; (x, y) is its top-left corner in planet-wide HEX pixel space (whole pixels). */
export interface RegionImage {
  canvas: ImageSource;
  x: number;
  y: number;
  region: number;
}

function newCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  return canvas;
}

/** Puts a region's pixels on a canvas. */
function pixelsToImage(px: RegionPixels): RegionImage {
  const canvas = newCanvas(px.width, px.height);
  const out: RegionImage = { canvas, x: px.x, y: px.y, region: px.region };
  canvas.getContext("2d")?.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return out;
}

/** Builds a region's terrain image on this thread. */
export function buildTerrainImage(surface: BodySurface, region: number, kind: BodyKind): RegionImage {
  return pixelsToImage(computeTerrainPixels(surface, region, kind));
}

/** Offsets of a hexagon's six corners from its centre, at the size the swept-ground clip uses (a hair oversized so neighbours leave no seams). */
const CLIP_SIZE = HEX + 0.6;
const CLIP_DX: number[] = [];
const CLIP_DY: number[] = [];
for (let i = 0; i < 6; i++) {
  const a = (Math.PI / 180) * (60 * i - 30);
  CLIP_DX.push(CLIP_SIZE * Math.cos(a));
  CLIP_DY.push(CLIP_SIZE * Math.sin(a));
}

/** Which tiles of a region image (its `tileRange`, row-major) the rover has swept: 1 for explored, else 0. */
export function exploredMask(surface: BodySurface, region: number, explored: (gx: number, gy: number) => boolean): Uint8Array {
  const { x0, y0, x1, y1 } = tileRange(surface, region);
  const w = x1 - x0 + 1;
  const mask = new Uint8Array(w * (y1 - y0 + 1));
  for (let gy = y0; gy <= y1; gy++) {
    for (let gx = x0; gx <= x1; gx++) if (explored(gx, gy)) mask[(gy - y0) * w + (gx - x0)] = 1;
  }
  return mask;
}

/** Full-color terrain where the swept tiles (`mask`, see `exploredMask`) are, fogged imagery everywhere else. */
export function composeFromMask(terrain: RegionImage, fogged: RegionImage, surface: BodySurface, mask: Uint8Array): RegionImage {
  const canvas = newCanvas(terrain.canvas.width, terrain.canvas.height);
  const out: RegionImage = { ...terrain, canvas };
  const ctx = canvas.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(fogged.canvas, 0, 0);
  // All swept hexes as one clip (a hair oversized so neighbours leave no seams), then the colour image through it.
  // (The corner maths is inlined: this runs for thousands of hexes whenever the rover sweeps new ground.)
  const { x0, y0, x1, y1 } = tileRange(surface, terrain.region);
  const w = x1 - x0 + 1;
  const hexW = Math.sqrt(3) * HEX;
  ctx.beginPath();
  let any = false;
  for (let gy = y0; gy <= y1; gy++) {
    const cy = 1.5 * HEX * gy + HEX - terrain.y;
    for (let gx = x0; gx <= x1; gx++) {
      if (mask[(gy - y0) * w + (gx - x0)] !== 1) continue;
      const cx = hexW * (gx + 0.5 * (gy & 1)) + hexW / 2 - terrain.x;
      ctx.moveTo(cx + (CLIP_DX[0] as number), cy + (CLIP_DY[0] as number));
      for (let i = 1; i < 6; i++) ctx.lineTo(cx + (CLIP_DX[i] as number), cy + (CLIP_DY[i] as number));
      ctx.closePath();
      any = true;
    }
  }
  if (any) {
    ctx.clip();
    ctx.drawImage(terrain.canvas, 0, 0);
  }
  return out;
}

/** Full-color terrain where the rover has swept (`explored`, planet-wide tiles), fogged imagery everywhere else. */
export function composePainted(
  terrain: RegionImage,
  fogged: RegionImage,
  surface: BodySurface,
  explored: (gx: number, gy: number) => boolean,
): RegionImage {
  return composeFromMask(terrain, fogged, surface, exploredMask(surface, terrain.region, explored));
}

interface CacheEntry {
  terrain: RegionImage;
  fogged: RegionImage;
  painted: RegionImage | null;
  /** The fog state `painted` was composed for. */
  paintedSig: string;
  /** The swept tiles `painted` shows (see `exploredMask`); a changed `sig` that leaves them as they were costs nothing. */
  paintedMask: Uint8Array | null;
  /** Whether the terrain image was drawn with textures (the synchronous path rebuilds it if they finish loading later). */
  textured: boolean;
}

/** Most region images kept at once (three images each, a few MB apiece). */
const CACHE_LIMIT = 16;
/** Region builds the worker is handed at once: one, so a newly urgent region (the rover moved on) goes next rather than waiting behind a queue. */
const IN_FLIGHT = 1;

/** Releases an image's memory now rather than at the next garbage collection. */
function release(img: RegionImage | null): void {
  if (img && typeof ImageBitmap !== "undefined" && img.canvas instanceof ImageBitmap) img.canvas.close();
}

// --- the worker -------------------------------------------------------------------------------------

/** Where the surface being drawn comes from: the worker rebuilds the same world from this. */
export interface SurfaceSource {
  seed: number;
  /** World generator version (`state.worldGen ?? 1`). */
  gen: number;
}

let worker: Worker | null | undefined; // undefined: not tried yet; null: unavailable
let nextRequestId = 1;
const listeners = new Map<number, (msg: BuiltMessage) => void>();

function terrainWorker(): Worker | null {
  if (worker !== undefined) return worker;
  worker = null;
  if (typeof Worker === "undefined" || typeof document === "undefined") return null;
  try {
    const w = new Worker(new URL("./terrainWorker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerReply>) => {
      const msg = ev.data;
      if (msg.type !== "built") return;
      const done = listeners.get(msg.id);
      listeners.delete(msg.id);
      done?.(msg);
    };
    w.onerror = () => {
      // The worker could not start (or died): everything falls back to building on this thread.
      worker = null;
      w.terminate();
      const waiting = [...listeners.values()];
      listeners.clear();
      for (const f of waiting) f({ type: "built", id: 0, failed: true } as BuiltMessage);
    };
    w.postMessage({ type: "init", atlasUrl: new URL(ATLAS_PATH, document.baseURI).href });
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

/** A region image from a worker reply: a bitmap, or (no OffscreenCanvas there) raw pixels put on a canvas here. */
function imageFrom(r: { x: number; y: number; region: number; width: number; height: number; bitmap?: ImageBitmap; data?: ArrayBuffer }): RegionImage {
  if (r.bitmap) return { canvas: r.bitmap, x: r.x, y: r.y, region: r.region };
  return pixelsToImage({ x: r.x, y: r.y, region: r.region, width: r.width, height: r.height, data: new Uint8ClampedArray(r.data as ArrayBuffer) });
}

/**
 * Region images for one world's surface, built on demand and kept (least recently used dropped first).
 * With a Worker the builds happen off the main thread: a region that isn't built yet comes back null (and is
 * queued, the `force`d one first) and shows up on a later frame. Without one, callers get a per-frame budget
 * (`beginFrame`) and regions past it are built on a later frame.
 */
export class TerrainCache {
  private readonly entries = new Map<number, CacheEntry>();
  private budget = 0;
  private frame = 0;
  private disposed = false;
  /** Regions waiting for the worker, with the frame they were last asked for and whether they are urgent. */
  private readonly queue = new Map<number, { frame: number; urgent: boolean }>();
  private readonly inFlight = new Set<number>();
  /** Regions the worker couldn't build (built on this thread instead). */
  private readonly failed = new Set<number>();
  /** The last urgent region: the others are served nearest-first from it. */
  private focus = -1;

  constructor(
    readonly surface: BodySurface,
    readonly kind: BodyKind,
    readonly source: SurfaceSource | null = null,
  ) {}

  /** Call once per frame: allows `builds` new regions to be rendered this frame (without a worker) and ages the queue. */
  beginFrame(builds = 1): void {
    this.budget = builds;
    this.frame++;
  }

  /** Stops all work for this surface (the player moved on) and frees its images. */
  dispose(): void {
    this.disposed = true;
    this.queue.clear();
    for (const e of this.entries.values()) {
      release(e.terrain);
      release(e.fogged);
    }
    this.entries.clear();
  }

  /** True while regions are still being built in the background. */
  get busy(): boolean {
    return this.queue.size > 0 || this.inFlight.size > 0;
  }

  private store(region: number, e: CacheEntry): void {
    this.entries.set(region, e);
    while (this.entries.size > CACHE_LIMIT) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      const old = this.entries.get(oldest);
      this.entries.delete(oldest);
      if (old) {
        release(old.terrain);
        release(old.fogged);
      }
    }
  }

  private entry(region: number, force: boolean): CacheEntry | null {
    const useWorker = this.source !== null && !this.failed.has(region) && terrainWorker() !== null;
    let e = this.entries.get(region);
    if (e && !useWorker && !e.textured && texturesReady() && (force || this.budget > 0)) {
      this.entries.delete(region); // built before the textures arrived: draw it again with them
      e = undefined;
    }
    if (e) {
      // Refresh its place in the LRU order.
      this.entries.delete(region);
      this.entries.set(region, e);
      return e;
    }
    if (useWorker) {
      this.request(region, force);
      return null;
    }
    if (!force && this.budget <= 0) return null;
    this.budget--;
    const px = computeTerrainPixels(this.surface, region, this.kind);
    const terrain = pixelsToImage(px);
    const fogged = pixelsToImage(computeFoggedPixels(px));
    this.store(region, { terrain, fogged, painted: null, paintedSig: "", paintedMask: null, textured: texturesReady() });
    return this.entries.get(region) ?? null;
  }

  /** Queues a region for the worker (once) and sends what is next. */
  private request(region: number, urgent: boolean): void {
    if (this.inFlight.has(region)) return;
    const queued = this.queue.get(region);
    this.queue.set(region, { frame: this.frame, urgent: urgent || (queued?.urgent ?? false) });
    if (urgent) this.focus = region;
    this.pump();
  }

  /** The most wanted queued region: urgent first, then nearest the urgent one, then in the order asked. */
  private next(): number | null {
    let best: number | null = null;
    let bestKey = Number.POSITIVE_INFINITY;
    const f = this.focus >= 0 ? this.surface.origin(this.focus) : null;
    for (const [region, q] of [...this.queue]) {
      // Not asked for in this frame or the last: the view has moved on.
      if (q.frame < this.frame - 1) {
        this.queue.delete(region);
        continue;
      }
      const o = this.surface.origin(region);
      const dist = f ? Math.abs(o.x - f.x) + Math.abs(o.y - f.y) : 0;
      const key = (q.urgent ? 0 : 1e6) + dist;
      if (key < bestKey) {
        bestKey = key;
        best = region;
      }
    }
    return best;
  }

  private pump(): void {
    const w = this.source ? terrainWorker() : null;
    while (w && this.source && !this.disposed && this.inFlight.size < IN_FLIGHT) {
      const region = this.next();
      if (region === null) return;
      this.queue.delete(region);
      this.inFlight.add(region);
      const id = nextRequestId++;
      listeners.set(id, (msg) => this.arrived(region, msg));
      const req: RequestMessage = {
        type: "build",
        id,
        seed: this.source.seed,
        gen: this.source.gen,
        bodyId: this.surface.body.id,
        kind: this.kind,
        region,
      };
      w.postMessage(req);
    }
  }

  private arrived(region: number, msg: BuiltMessage): void {
    this.inFlight.delete(region);
    if (this.disposed) {
      if (msg.terrain?.bitmap) msg.terrain.bitmap.close();
      if (msg.fogged?.bitmap) msg.fogged.bitmap.close();
      return;
    }
    if (msg.failed || !msg.terrain || !msg.fogged) {
      // The worker is gone or couldn't build it: this thread takes over (entry() sees there's no worker, or the failure).
      this.failed.add(region);
      return;
    }
    const old = this.entries.get(region);
    this.entries.delete(region);
    if (old) {
      release(old.terrain);
      release(old.fogged);
    }
    this.store(region, {
      terrain: imageFrom(msg.terrain),
      fogged: imageFrom(msg.fogged),
      painted: null,
      paintedSig: "",
      paintedMask: null,
      textured: msg.textured,
    });
    this.pump();
  }

  /** Full-colour terrain of a region (null if it isn't built yet: it is on its way, or the frame's budget is spent). */
  terrain(region: number, force = false): RegionImage | null {
    return this.entry(region, force)?.terrain ?? null;
  }

  /** The fogged/painted map of a region for the fog state `sig` (recomposed only when `sig` changes). */
  painted(region: number, sig: string, explored: (gx: number, gy: number) => boolean, force = false): RegionImage | null {
    const e = this.entry(region, force);
    if (!e) return null;
    if (!e.painted || e.paintedSig !== sig) {
      // The signature covers the neighbours' whole fog; only the tiles this image shows matter.
      const mask = exploredMask(this.surface, region, explored);
      if (!e.painted || !e.paintedMask || !sameMask(mask, e.paintedMask)) {
        e.painted = composeFromMask(e.terrain, e.fogged, this.surface, mask);
        e.paintedMask = mask;
      }
      e.paintedSig = sig;
    }
    return e.painted;
  }
}

function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let shared: TerrainCache | null = null;

/** The cache for this surface (a new world or body starts a fresh one). `source` lets the worker rebuild the world. */
export function terrainCache(surface: BodySurface, kind: BodyKind, source: SurfaceSource | null = null): TerrainCache {
  if (!shared || shared.surface !== surface || shared.kind !== kind) {
    shared?.dispose();
    shared = new TerrainCache(surface, kind, source);
  }
  return shared;
}
