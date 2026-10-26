/**
 * Crew portraits (AW-150): 64 px pixel-art faces that age with the person, packed in public/assets/portraits/atlas.webp
 * (one row per face, one column per age band) with index.json describing the grid. Built by tools/art/portraits/build_atlas.py.
 * Who wears which face is a hash of their id (portraitFace in src/sim), so nothing is saved. If the atlas is missing or hasn't
 * loaded yet, <Portrait> renders nothing and the card simply has no picture.
 */
import { useEffect, useState } from "preact/hooks";
import { assignFaces, nameGender, portraitBand, portraitFace, portraitRoster, type GameState } from "../sim";
import "./portraits.css";

interface PortraitIndex {
  cell: number;
  faces: number;
  bands: number;
  width: number;
  height: number;
  /** One letter per face, row order: "f" or "m", so a name can pick a matching face. */
  genders?: string;
}

const ATLAS_URL = "./assets/portraits/atlas.webp";
const INDEX_URL = "./assets/portraits/index.json";

let loaded: PortraitIndex | null = null;
let pending: Promise<PortraitIndex | null> | null = null;

function loadPortraits(): Promise<PortraitIndex | null> {
  if (!pending) {
    pending = (async () => {
      try {
        const res = await fetch(INDEX_URL);
        if (!res.ok) return null;
        const index = (await res.json()) as PortraitIndex;
        await new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("portrait atlas failed to load"));
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
void loadPortraits();

function usePortraitIndex(): PortraitIndex | null {
  const [index, setIndex] = useState<PortraitIndex | null>(loaded);
  useEffect(() => {
    if (loaded) return;
    let live = true;
    void loadPortraits().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, []);
  return index;
}

/** A person's portrait. `seed` is their id (the captain has none, so pass name + birth); `name` only picks the women's or men's faces. `size` should be a multiple of 64 for crisp pixels, but 48 works. */
let rosterCache: { key: string; faces: Map<string, number> } | null = null;

/** Faces for the whole roster at once, so nobody on screen shares one (cached until the roster changes). */
function rosterFace(state: Pick<GameState, "captain" | "crew" | "recruits">, index: PortraitIndex, seed: string): number | undefined {
  const people = portraitRoster(state, captainSeed(state.captain));
  const key = people.map((p) => p.seed).join(",");
  if (!rosterCache || rosterCache.key !== key) rosterCache = { key, faces: assignFaces(people, index.faces, index.genders) };
  return rosterCache.faces.get(seed);
}

export function Portrait({
  seed,
  name,
  age,
  size = 64,
  class: cls,
  state,
}: {
  seed: string;
  name: string;
  age: number;
  size?: number;
  class?: string;
  /** Pass the game state so faces are unique across the roster. */
  state?: Pick<GameState, "captain" | "crew" | "recruits">;
}) {
  const index = usePortraitIndex();
  if (!index) return null;
  // the first name picks the pool (women's or men's faces); the id's hash picks within it
  const g = nameGender(name);
  const pool = g && index.genders?.length === index.faces ? [...index.genders].flatMap((c, i) => (c === g ? [i] : [])) : [];
  const hashed = pool.length > 0 ? pool[portraitFace(seed, pool.length)]! : portraitFace(seed, index.faces);
  const face = (state && rosterFace(state, index, seed)) ?? hashed;
  const band = Math.min(index.bands - 1, portraitBand(age));
  const k = size / index.cell;
  const style = {
    "--portrait-atlas": `url(${ATLAS_URL})`,
    "--portrait-size": `${size}px`,
    "--portrait-atlas-size": `${index.width * k}px ${index.height * k}px`,
    "--portrait-pos": `${-band * size}px ${-face * size}px`,
  } as Record<string, string>;
  return <span class={`portrait ${cls ?? ""}`} style={style} role="img" aria-label="Portrait" />;
}

/** The captain has no id, so their face comes from name and birth. */
export const captainSeed = (c: { name: string; born: number }): string => `${c.name}|${c.born}`;
