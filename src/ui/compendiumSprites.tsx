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
  /** The atlas redrawn as flat dark silhouettes (a data URL, also set as the page's `--comp-silhouettes`) for entries not found yet; null if it couldn't be made. */
  silhouettes: string | null;
}

const ATLAS_URL = "./assets/compendium/atlas.webp";
const INDEX_URL = "./assets/compendium/index.json";
/**
 * The atlas as an absolute URL. It goes into a CSS custom property, and a relative url() there is
 * resolved against the stylesheet that uses it (assets/ in a production build), not the page.
 */
const atlasHref = (): string => new URL(ATLAS_URL, document.baseURI).href;
/** The colour of an undiscovered entry's silhouette. */
const SILHOUETTE = [0x26, 0x32, 0x4d] as const;

let loaded: SpriteIndex | null = null;
let pending: Promise<SpriteIndex | null> | null = null;

/** The atlas with every visible pixel painted the silhouette colour (alpha kept): one plain image instead of a CSS mask per card. */
async function makeSilhouettes(img: HTMLImageElement): Promise<string | null> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      data.data[i] = SILHOUETTE[0];
      data.data[i + 1] = SILHOUETTE[1];
      data.data[i + 2] = SILHOUETTE[2];
    }
    ctx.putImageData(data, 0, 0);
    // One shared custom property on the page (not on each icon: the data URL is a few hundred KB).
    const url = canvas.toDataURL("image/png");
    document.documentElement.style.setProperty("--comp-silhouettes", `url(${url})`);
    return url;
  } catch {
    return null;
  }
}

/** Fetches the index and atlas and prepares the silhouettes. Called at game start so the compendium opens with its sprites in place. */
export function preloadSprites(): Promise<SpriteIndex | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const [res, img] = await Promise.all([
          fetch(INDEX_URL),
          new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = () => reject(new Error("atlas failed to load"));
            image.src = ATLAS_URL;
          }),
        ]);
        if (!res.ok) return null;
        const index = (await res.json()) as Omit<SpriteIndex, "silhouettes">;
        loaded = { ...index, silhouettes: await makeSilhouettes(img) };
        return loaded;
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
    void preloadSprites().then((i) => live && setIndex(i));
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
  if (!index || !cell || (!found && !index.silhouettes)) return <span class="comp-icon" style={found ? { background: color } : undefined} />;
  const style = {
    "--atlas": `url("${atlasHref()}")`,
    "--atlas-size": `${index.width}px ${index.height}px`,
    "--atlas-pos": `${-cell[0] * index.cell}px ${-cell[1] * index.cell}px`,
  } as Record<string, string>;
  return <span class={`comp-icon sprite ${found ? "" : "silhouette"}`} style={style} />;
}
