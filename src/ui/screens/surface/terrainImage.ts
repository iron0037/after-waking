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
import type { BuiltMessage, RegionPayload, RequestMessage, WarmMessage, WorkerReply } from "./terrainWorker";

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
  /** For a thumbnail: the size, in HEX pixels, of the full image it stands for (the canvas itself is smaller). */
  w?: number;
  h?: number;
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

/**
 * Full-color terrain where the swept tiles (`mask`, see `exploredMask`) are, fogged imagery everywhere else.
 * Works on thumbnails too (`terrain.w` set): the same hexes, drawn at the thumbnail's scale.
 */
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
  const thumb = terrain.w !== undefined && terrain.h !== undefined;
  if (thumb) ctx.setTransform(canvas.width / (terrain.w as number), 0, 0, canvas.height / (terrain.h as number), 0, 0);
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
    if (thumb) ctx.drawImage(terrain.canvas, 0, 0, terrain.w as number, terrain.h as number);
    else ctx.drawImage(terrain.canvas, 0, 0);
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
  /** The frame this entry was last asked for in: entries asked for this frame (or the last) are never evicted. */
  used: number;
}

/** Most full-size region images kept at once (three images each, a few MB apiece) beyond those on screen. */
const CACHE_LIMIT = 16;
/** Most thumbnail sets kept at once beyond those on screen (about 1.5 MB a set). */
const THUMB_LIMIT = 64;
/**
 * Far zoom: while a region image is drawn at no more than this many device pixels per HEX pixel, the thumbnail
 * (a third of the size) serves instead of the full image.
 */
const LOD_SCALE = 0.4;

/** Releases an image's memory now rather than at the next garbage collection. */
function release(img: RegionImage | null): void {
  if (img && typeof ImageBitmap !== "undefined" && img.canvas instanceof ImageBitmap) img.canvas.close();
}

// --- the workers -------------------------------------------------------------------------------------

/** Where the surface being drawn comes from: the workers rebuild the same world from this. */
export interface SurfaceSource {
  seed: number;
  /** World generator version (`state.worldGen ?? 1`). */
  gen: number;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

let pool: PoolWorker[] | null | undefined; // undefined: not tried yet; null: unavailable
let nextRequestId = 1;
const listeners = new Map<number, (msg: BuiltMessage) => void>();

/** How many workers build regions in parallel. */
function poolSize(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 2 : 2;
  return Math.max(1, Math.min(3, cores - 1));
}

function terrainPool(): PoolWorker[] | null {
  if (pool !== undefined) return pool;
  pool = null;
  if (typeof Worker === "undefined" || typeof document === "undefined") return null;
  try {
    const made: PoolWorker[] = [];
    const atlasUrl = new URL(ATLAS_PATH, document.baseURI).href;
    for (let i = 0; i < poolSize(); i++) {
      const worker = new Worker(new URL("./terrainWorker.ts", import.meta.url), { type: "module" });
      const pw: PoolWorker = { worker, busy: false };
      worker.onmessage = (ev: MessageEvent<WorkerReply>) => {
        const msg = ev.data;
        if (msg.type !== "built") return;
        pw.busy = false;
        const done = listeners.get(msg.id);
        listeners.delete(msg.id);
        done?.(msg);
      };
      worker.onerror = () => {
        // A worker could not start (or died): everything falls back to building on this thread.
        pool = null;
        for (const m of made) m.worker.terminate();
        const waiting = [...listeners.values()];
        listeners.clear();
        for (const f of waiting) f({ type: "built", id: 0, failed: true, textured: false });
      };
      worker.postMessage({ type: "init", atlasUrl });
      made.push(pw);
    }
    pool = made;
  } catch {
    pool = null;
  }
  return pool;
}

/**
 * Gets the workers going early (threads started, texture atlas loaded, the universe, and `bodyId`'s surface if given,
 * built), so the first real region doesn't pay for any of it. Safe to call repeatedly.
 */
export function warmTerrain(seed: number, gen: number, bodyId: string | null = null): void {
  const workers = terrainPool();
  if (!workers) return;
  const msg: WarmMessage = { type: "warm", seed, gen, bodyId };
  for (const w of workers) w.worker.postMessage(msg);
}

/** A region image from a worker reply: a bitmap, or (no OffscreenCanvas there) raw pixels put on a canvas here. */
function imageFrom(r: RegionPayload): RegionImage {
  const thumb = r.width !== r.fullWidth || r.height !== r.fullHeight;
  const extra = thumb ? { w: r.fullWidth, h: r.fullHeight } : {};
  if (r.bitmap) return { canvas: r.bitmap, x: r.x, y: r.y, region: r.region, ...extra };
  return pixelsToImage({ x: r.x, y: r.y, region: r.region, width: r.width, height: r.height, data: new Uint8ClampedArray(r.data as ArrayBuffer) });
}

interface Job {
  frame: number;
  urgent: boolean;
  /** Wanted ahead of time, not for a frame in progress: kept until built, but served last. */
  prefetch: boolean;
}

type Want = "full" | "thumb";

/**
 * Region images for one world's surface, built on demand and kept (least recently used dropped first).
 *
 * With Workers the builds happen off the main thread, several at once: a region that isn't built yet comes back
 * null (and is queued, the `force`d one first) and shows up on a later frame. Without them, callers get a
 * per-frame budget (`beginFrame`) and regions past it are built on a later frame.
 *
 * Far out, where a region covers only a few hundred screen pixels, thumbnails (kept in a larger cache of their
 * own) are drawn instead of the full images. Nothing asked for in the current frame is ever evicted.
 */
export class TerrainCache {
  private readonly entries = new Map<number, CacheEntry>();
  private readonly thumbs = new Map<number, CacheEntry>();
  private budget = 0;
  private frame = 0;
  private lod = false;
  private disposed = false;
  /** Regions waiting for a worker (full images, or thumbnails only). */
  private readonly queues: Record<Want, Map<number, Job>> = { full: new Map(), thumb: new Map() };
  private readonly inFlight = new Set<string>();
  /** Regions the workers couldn't build (built on this thread instead). */
  private readonly failed = new Set<number>();
  /** Set if the workers can't make thumbnails (no OffscreenCanvas there): far zoom then uses the full images. */
  private noThumbs = false;
  /** The last urgent region: the others are served nearest-first from it. */
  private focus = -1;

  constructor(
    readonly surface: BodySurface,
    readonly kind: BodyKind,
    readonly source: SurfaceSource | null = null,
  ) {}

  /**
   * Call once per frame. `builds`: regions the synchronous path may render this frame. `scale`: device pixels per
   * HEX pixel the images are drawn at (`L.k * devicePixelRatio`), which picks full images or thumbnails.
   */
  beginFrame(builds = 1, scale = 1): void {
    this.budget = builds;
    this.frame++;
    this.lod = scale <= LOD_SCALE && this.source !== null && !this.noThumbs;
  }

  /** Stops all work for this surface (the player moved on) and frees its images. */
  dispose(): void {
    this.disposed = true;
    this.queues.full.clear();
    this.queues.thumb.clear();
    for (const m of [this.entries, this.thumbs]) {
      for (const e of m.values()) {
        release(e.terrain);
        release(e.fogged);
      }
      m.clear();
    }
  }

  /** True while regions are still being built in the background. */
  get busy(): boolean {
    return this.queues.full.size > 0 || this.queues.thumb.size > 0 || this.inFlight.size > 0;
  }

  /** Queues the landing region (first) and the ones around it so they are ready when the surface opens. Replaces an earlier prefetch. */
  prefetch(regions: readonly number[]): void {
    if (!this.source || this.disposed) return;
    for (const queue of Object.values(this.queues)) for (const [r, job] of [...queue]) if (job.prefetch) queue.delete(r);
    regions.forEach((r, i) => {
      if (!this.entries.has(r)) this.queueJob("full", r, i === 0, true);
    });
    this.pump();
  }

  private evict(m: Map<number, CacheEntry>, limit: number): void {
    // Oldest first, skipping anything asked for this frame or the last (it is on screen).
    for (const [region, e] of m) {
      if (m.size <= limit) break;
      if (e.used >= this.frame - 1) continue;
      m.delete(region);
      release(e.terrain);
      release(e.fogged);
    }
  }

  private store(m: Map<number, CacheEntry>, region: number, e: Omit<CacheEntry, "used">, limit: number): CacheEntry {
    const old = m.get(region);
    m.delete(region);
    if (old) {
      release(old.terrain);
      release(old.fogged);
    }
    const entry: CacheEntry = { ...e, used: this.frame };
    m.set(region, entry);
    this.evict(m, limit);
    return entry;
  }

  private touch(m: Map<number, CacheEntry>, region: number): CacheEntry | undefined {
    const e = m.get(region);
    if (e) {
      // Refresh its place in the LRU order.
      m.delete(region);
      m.set(region, e);
      e.used = this.frame;
    }
    return e;
  }

  /** The full-image entry for `region`, building it (synchronously) or asking the workers. */
  private entry(region: number, force: boolean): CacheEntry | null {
    const useWorkers = this.source !== null && !this.failed.has(region) && terrainPool() !== null;
    let e = this.entries.get(region);
    if (e && !useWorkers && !e.textured && texturesReady() && (force || this.budget > 0)) {
      this.entries.delete(region); // built before the textures arrived: draw it again with them
      e = undefined;
    }
    if (e) return this.touch(this.entries, region) ?? null;
    if (useWorkers) {
      this.queueJob("full", region, force, false);
      this.pump();
      return null;
    }
    if (!force && this.budget <= 0) return null;
    this.budget--;
    const px = computeTerrainPixels(this.surface, region, this.kind);
    const terrain = pixelsToImage(px);
    const fogged = pixelsToImage(computeFoggedPixels(px));
    return this.store(this.entries, region, { terrain, fogged, painted: null, paintedSig: "", paintedMask: null, textured: texturesReady() }, CACHE_LIMIT);
  }

  /** The thumbnail entry for `region`, or null (and queued) if it isn't there yet. */
  private thumbEntry(region: number, force: boolean): CacheEntry | null {
    const e = this.touch(this.thumbs, region);
    if (e) return e;
    if (!this.failed.has(region)) {
      this.queueJob("thumb", region, force, false);
      this.pump();
    }
    return null;
  }

  private queueJob(want: Want, region: number, urgent: boolean, prefetch: boolean): void {
    if (this.inFlight.has(`${want}${region}`)) return;
    const queue = this.queues[want];
    const q = queue.get(region);
    queue.set(region, { frame: this.frame, urgent: urgent || (q?.urgent ?? false), prefetch: prefetch && (q?.prefetch ?? true) });
    if (urgent && !prefetch) this.focus = region;
  }

  /** The most wanted queued job: current urgent regions first, then nearest the urgent one, then prefetches. */
  private next(): { region: number; want: Want } | null {
    let best: { region: number; want: Want } | null = null;
    let bestKey = Number.POSITIVE_INFINITY;
    const f = this.focus >= 0 ? this.surface.origin(this.focus) : null;
    for (const want of ["full", "thumb"] as const) {
      const queue = this.queues[want];
      for (const [region, q] of [...queue]) {
        // Not asked for in this frame or the last: the view has moved on.
        if (!q.prefetch && q.frame < this.frame - 1) {
          queue.delete(region);
          continue;
        }
        const o = this.surface.origin(region);
        const dist = f ? Math.abs(o.x - f.x) + Math.abs(o.y - f.y) : 0;
        const key = (q.prefetch ? 2e6 : 0) + (q.urgent ? 0 : 1e6) + dist;
        if (key < bestKey) {
          bestKey = key;
          best = { region, want };
        }
      }
    }
    return best;
  }

  private pump(): void {
    const workers = this.source ? terrainPool() : null;
    if (!workers || !this.source || this.disposed) return;
    for (const pw of workers) {
      if (pw.busy) continue;
      const job = this.next();
      if (!job) return;
      this.queues[job.want].delete(job.region);
      const tag = `${job.want}${job.region}`;
      this.inFlight.add(tag);
      pw.busy = true;
      const id = nextRequestId++;
      listeners.set(id, (msg) => this.arrived(job.region, job.want, tag, msg));
      const req: RequestMessage = {
        type: "build",
        id,
        seed: this.source.seed,
        gen: this.source.gen,
        bodyId: this.surface.body.id,
        kind: this.kind,
        region: job.region,
        want: job.want,
      };
      pw.worker.postMessage(req);
    }
  }

  private arrived(region: number, want: Want, tag: string, msg: BuiltMessage): void {
    this.inFlight.delete(tag);
    if (this.disposed) {
      for (const p of [msg.terrain, msg.fogged, msg.thumbTerrain, msg.thumbFogged]) p?.bitmap?.close();
      return;
    }
    if (msg.failed || (want === "full" && (!msg.terrain || !msg.fogged))) {
      // The workers are gone or couldn't build it: this thread takes over (entry() sees no workers, or the failure).
      this.failed.add(region);
      return;
    }
    if (want === "thumb" && (!msg.thumbTerrain || !msg.thumbFogged)) {
      this.noThumbs = true; // no OffscreenCanvas over there: far zoom draws the full images
      return;
    }
    const fresh = { painted: null, paintedSig: "", paintedMask: null, textured: msg.textured };
    if (msg.terrain && msg.fogged) {
      this.store(this.entries, region, { terrain: imageFrom(msg.terrain), fogged: imageFrom(msg.fogged), ...fresh }, CACHE_LIMIT);
    }
    if (msg.thumbTerrain && msg.thumbFogged) {
      this.store(this.thumbs, region, { terrain: imageFrom(msg.thumbTerrain), fogged: imageFrom(msg.thumbFogged), ...fresh }, THUMB_LIMIT);
    }
    this.pump();
  }

  /** Full-colour terrain of a region (null if it isn't built yet: it is on its way, or the frame's budget is spent). */
  terrain(region: number, force = false): RegionImage | null {
    return this.entry(region, force)?.terrain ?? null;
  }

  private compose(e: CacheEntry, region: number, sig: string, explored: (gx: number, gy: number) => boolean): RegionImage {
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

  /**
   * The fogged/painted map of a region for the fog state `sig` (recomposed only when `sig` changes): the full image,
   * or the thumbnail far out. Whichever is built stands in while the wanted one is on its way.
   */
  painted(region: number, sig: string, explored: (gx: number, gy: number) => boolean, force = false): RegionImage | null {
    if (this.lod) {
      const t = this.thumbEntry(region, force);
      if (t) return this.compose(t, region, sig, explored);
      const f = this.touch(this.entries, region);
      return f ? this.compose(f, region, sig, explored) : null;
    }
    const e = this.entry(region, force);
    if (e) return this.compose(e, region, sig, explored);
    const t = this.touch(this.thumbs, region); // zooming in: the thumbnail holds the place until the full image lands
    return t ? this.compose(t, region, sig, explored) : null;
  }
}

function sameMask(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let shared: TerrainCache | null = null;

/**
 * Starts building the region the player is about to land in, and the ones around it, so the surface is ready when it
 * opens (the cache is the one the surface view will pick up).
 */
export function prefetchSurface(surface: BodySurface, kind: BodyKind, source: SurfaceSource, region: number): void {
  const { cols, regions } = surface.layout;
  const row = Math.floor(region / cols);
  const col = region % cols;
  const list = [region];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const r = (row + dr) * cols + (col + dc);
      if ((dr !== 0 || dc !== 0) && col + dc >= 0 && col + dc < cols && row + dr >= 0 && r < regions) list.push(r);
    }
  }
  terrainCache(surface, kind, source).prefetch(list);
}

/** The cache for this surface (a new world or body starts a fresh one). `source` lets the workers rebuild the world. */
export function terrainCache(surface: BodySurface, kind: BodyKind, source: SurfaceSource | null = null): TerrainCache {
  if (!shared || shared.surface !== surface || shared.kind !== kind) {
    shared?.dispose();
    shared = new TerrainCache(surface, kind, source);
  }
  return shared;
}
