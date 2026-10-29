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

export interface RequestMessage {
  type: "build";
  id: number;
  seed: number;
  gen: number;
  bodyId: string;
  kind: BodyKind;
  region: number;
}

/** One image of a region: a bitmap, or the raw RGBA pixels when the worker can't make bitmaps. */
export interface RegionPayload {
  x: number;
  y: number;
  region: number;
  width: number;
  height: number;
  bitmap?: ImageBitmap;
  data?: ArrayBuffer;
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
}

export type WorkerReply = BuiltMessage;

interface WorkerScope {
  onmessage: ((ev: MessageEvent<InitMessage | RequestMessage>) => void) | null;
  postMessage(msg: WorkerReply, transfer: Transferable[]): void;
}
const scope = globalThis as unknown as WorkerScope;

let atlasReady: Promise<boolean> = Promise.resolve(false);
let world: World | null = null;

function worldFor(seed: number, gen: number): World {
  if (!world || world.seed !== seed || world.gen !== gen) world = new World(seed, gen);
  return world;
}

function payload(px: RegionPixels, transfer: Transferable[]): RegionPayload {
  const { x, y, region, width, height } = px;
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.putImageData(new ImageData(px.data as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
      const bitmap = canvas.transferToImageBitmap();
      transfer.push(bitmap);
      return { x, y, region, width, height, bitmap };
    }
  }
  transfer.push(px.data.buffer);
  return { x, y, region, width, height, data: px.data.buffer as ArrayBuffer };
}

scope.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === "init") {
    atlasReady = loadTexturesOffscreen(msg.atlasUrl);
    return;
  }
  void (async () => {
    const textured = await atlasReady; // draw with the textures, not the flat fallback
    try {
      const surface = worldFor(msg.seed, msg.gen).surface(msg.bodyId);
      const terrain = computeTerrainPixels(surface, msg.region, msg.kind);
      const fogged = computeFoggedPixels(terrain);
      const transfer: Transferable[] = [];
      const reply: BuiltMessage = { type: "built", id: msg.id, textured, terrain: payload(terrain, transfer), fogged: payload(fogged, transfer) };
      scope.postMessage(reply, transfer);
    } catch {
      scope.postMessage({ type: "built", id: msg.id, textured, failed: true }, []);
    }
  })();
};
