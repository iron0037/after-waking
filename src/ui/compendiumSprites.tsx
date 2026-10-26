/**
 * Compendium sprites (AW-28): one 64 px pixel-art cell per entry, packed in public/assets/compendium/atlas.webp with an
 * index.json mapping compendium keys ("flora:glass-reed", "gem:plicite-geode", "mineral:copper") to cells.
 * Built by tools/art/compendium/build_atlas.py. Until the atlas has loaded (or if it is missing) the icon falls back
 * to the entry's colour swatch.
 */
import { useEffect, useState } from "preact/hooks";
import "./compendium.css";

interface SpriteIndex {
  cell: number;
  cols: number;
  width: number;
  height: number;
  sprites: Record<string, [number, number]>;
}

const ATLAS_URL = "./assets/compendium/atlas.webp";
const INDEX_URL = "./assets/compendium/index.json";

let loaded: SpriteIndex | null = null;
let pending: Promise<SpriteIndex | null> | null = null;

function loadSprites(): Promise<SpriteIndex | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(INDEX_URL);
        if (!res.ok) return null;
        const index = (await res.json()) as SpriteIndex;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("atlas failed to load"));
          img.src = ATLAS_URL;
        });
        loaded = index;
        return index;
      } catch {
        return null;
      }
    })();
  }
  return pending;
}

/** The sprite index once the atlas is ready, else null (also null if the atlas is missing). */
export function useSpriteIndex(): SpriteIndex | null {
  const [index, setIndex] = useState<SpriteIndex | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadSprites().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, []);
  return index;
}

/**
 * A compendium entry's icon. `found` shows the sprite; an undiscovered entry shows only its dark silhouette
 * (the shape, none of the colour or name). With no sprite available it falls back to the colour swatch / hatching.
 */
export function CompIcon({ index, entryKey, color, found }: { index: SpriteIndex | null; entryKey: string; color: string; found: boolean }) {
  const cell = index?.sprites[entryKey];
  if (!index || !cell) return <span class="comp-icon" style={found ? { background: color } : undefined} />;
  const style = {
    "--atlas": `url(${ATLAS_URL})`,
    "--atlas-size": `${index.width}px ${index.height}px`,
    "--atlas-pos": `${-cell[0] * index.cell}px ${-cell[1] * index.cell}px`,
  } as Record<string, string>;
  return <span class={`comp-icon sprite ${found ? "" : "silhouette"}`} style={style} />;
}
