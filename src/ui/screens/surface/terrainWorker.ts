/**
 * Web Worker that builds the surface map's terrain images off the main thread (see terrainImage.ts `TerrainCache`).
 *
 * It rebuilds the universe from (seed, worldGen) -- the world is deterministic, so this is the same surface the game
 * is showing -- loads the texture atlas itself, computes a region's terrain and fogged pixels (terrainPixels.ts), and
 * sends them back as transferable ImageBitmaps (or raw pixel buffers where OffscreenCanvas is missing).
 */
import type { BodyKind } from "../../../sim";
import { World } from "../../../sim";
import { computeFoggedPixels, computeTerrainPixels, type RegionPixels } from "./terrainPixels";
import { loadTexturesOffscreen } from "./terrainTextures";

export interface InitMessage {
  type: "init";
  /** Absolute URL of the texture atlas. */
  atlasUrl: string;
}

/** Get ready before anything is asked for: build the universe (and `bodyId`'s surface) for this seed. */
export interface WarmMessage {
  type: "warm";
  seed: number;
  gen: number;
  bodyId: string | null;
}

export interface RequestMessage {
  type: "build";
  id: number;
  seed: number;
  gen: number;
  bodyId: string;
  kind: BodyKind;
  region: number;
  /** "full": the full-size images (and thumbnails too); "thumb": thumbnails only (for far zoom). */
  want: "full" | "thumb";
}

/** A thumbnail is the full image shrunk by this factor in each direction. */
export const THUMB_DIV = 3;

/** One image of a region: a bitmap, or the raw RGBA pixels when the worker can't make bitmaps. */
export interface RegionPayload {
  x: number;
  y: number;
  region: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: ArrayBuffer;
  /** Size of the full image this stands for, in HEX pixels (differs from `width`/`height` for a thumbnail). */
  fullWidth: number;
  fullHeight: number;
}

export interface BuiltMessage {
  type: "built";
  id: number;
  /** Whether the terrain was drawn with the textures (false: flat palette colours). */
  textured: boolean;
  /** Set when the region could not be built. */
  failed?: boolean;
  terrain?: RegionPayload;
  fogged?: RegionPayload;
  /** Shrunk copies of the above (absent where the worker can't make bitmaps). */
  thumbTerrain?: RegionPayload;
  thumbFogged?: RegionPayload;
}

export type WorkerReply = BuiltMessage;

interface WorkerScope {
  onmessage: ((ev: MessageEvent<InitMessage | WarmMessage | RequestMessage>) => void) | null;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;

let atlasReady: Promise<boolean> = Promise.resolve(false);
let world: World | null = null;

function worldFor(seed: number, gen: number): World {
  if (!world || world.seed !== seed || world.gen !== gen) world = new World(seed, gen);
  return world;
}

/** The pixels as a full-size canvas, or null where there are no OffscreenCanvases. */
function toCanvas(px: RegionPixels): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === "undefined") return null;
  const canvas = new OffscreenCanvas(px.width, px.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, px.width, px.height), 0, 0);
  return canvas;
}

/** An image of the region: the full-size bitmap (or raw pixels), or the thumbnail drawn from `canvas`. */
function payload(px: RegionPixels, canvas: OffscreenCanvas | null, transfer: Transferable[], thumb: boolean): RegionPayload | undefined {
  const { x, y, region, width, height } = px;
  const base = { x, y, region, fullWidth: width, fullHeight: height };
  if (!canvas) {
    if (thumb) return undefined;
    transfer.push(px.data.buffer);
    return { ...base, width, height, data: px.data.buffer as ArrayBuffer };
  }
  if (!thumb) {
    const bitmap = canvas.transferToImageBitmap();
    transfer.push(bitmap);
    return { ...base, width, height, bitmap };
  }
  const tw = Math.max(1, Math.ceil(width / THUMB_DIV));
  const th = Math.max(1, Math.ceil(height / THUMB_DIV));
  const small = new OffscreenCanvas(tw, th);
  const ctx = small.getContext("2d");
  if (!ctx) return undefined;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, tw, th);
  const bitmap = small.transferToImageBitmap();
  transfer.push(bitmap);
  return { ...base, width: tw, height: th, bitmap };
}

scope.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    atlasReady = loadTexturesOffscreen(msg.atlasUrl);
    return;
  }
  if (msg.type === "warm") {
    try {
      const w = worldFor(msg.seed, msg.gen);
      if (msg.bodyId) w.surface(msg.bodyId);
    } catch {
      // Nothing to warm; the first real request reports any trouble.
    }
    return;
  }
  void (async () => {
    const textured = await atlasReady; // draw with the textures, not the flat fallback
    try {
      const surface = worldFor(msg.seed, msg.gen).surface(msg.bodyId);
      const terrain = computeTerrainPixels(surface, msg.region, msg.kind);
      const fogged = computeFoggedPixels(terrain);
      const transfer: Transferable[] = [];
      const full = msg.want === "full";
      const tCanvas = toCanvas(terrain);
      const fCanvas = toCanvas(fogged);
      const reply: BuiltMessage = { type: "built", id: msg.id, textured };
      // Thumbnails first: drawing them reads the full canvases, which the full bitmaps then take over.
      reply.thumbTerrain = payload(terrain, tCanvas, transfer, true);
      reply.thumbFogged = payload(fogged, fCanvas, transfer, true);
      if (full) {
        reply.terrain = payload(terrain, tCanvas, transfer, false);
        reply.fogged = payload(fogged, fCanvas, transfer, false);
      }
      scope.postMessage(reply, transfer);
    } catch {
      scope.postMessage({ type: "built", id: msg.id, textured, failed: true }, []);
    }
  })();
};
