/** Specimen rarity badges: a ring in grey (common), green (uncommon) or gold (rare) around a plant's leaf icon. */
import { FLORA_BY_NAME, type Rarity } from "../data/catalog";

export const RARITY_LABEL: Record<Rarity, string> = { 1: "common", 2: "uncommon", 3: "rare" };

/** The rarity of a flora species by name (undefined for unknown species). */
export function floraRarity(species: string): Rarity | undefined {
  return FLORA_BY_NAME.get(species)?.rarity;
}

/** The leaf icon for a species, ringed by its rarity. */
export function LeafMark({ species, big = false, class: cls = "" }: { species: string; big?: boolean; class?: string }) {
  const r = floraRarity(species);
  return <i class={`leaf-mark ${big ? "big" : ""} ${r ? `rar${r}` : ""} ${cls}`} title={r ? `${RARITY_LABEL[r]} specimen` : undefined} />;
}

/** A tiny key to the ring colours. */
export function RarityLegend() {
  return (
    <span class="rarity-legend" title="Ring colour on a specimen's icon shows how rare it is">
      {([1, 2, 3] as const).map((r) => (
        <span key={r} class={`rarity-key rar${r}`}>
          <i class="rarity-dot" />
          {RARITY_LABEL[r]}
        </span>
      ))}
    </span>
  );
}
