/** Specimen rarity badges: a ring in gray (common), green (uncommon) or gold (rare) around a plant's leaf icon. */
import { FLORA_BY_NAME, type Rarity } from "../data/catalog";
import { CREATURES_BY_NAME } from "../data/creatures";

export const RARITY_LABEL: Record<Rarity, string> = { 1: "common", 2: "uncommon", 3: "rare" };

/** The rarity of a specimen species by name, plant or creature (undefined for unknown species). */
export function floraRarity(species: string): Rarity | undefined {
  return FLORA_BY_NAME.get(species)?.rarity ?? CREATURES_BY_NAME.get(species)?.rarity;
}

/**
 * The icon for a species, ringed by its rarity: a leaf, or kelp for sea plants (`sea`); a paw or a fish for
 * creatures (AW-257), as on the surface map.
 */
export function LeafMark({ species, big = false, sea = false, class: cls = "" }: { species: string; big?: boolean; sea?: boolean; class?: string }) {
  const r = floraRarity(species);
  const beast = CREATURES_BY_NAME.get(species);
  if (beast) return <CreatureGlyph aquatic={!!beast.aquatic} color={beast.color} big={big} title={r ? `${RARITY_LABEL[r]} creature specimen` : undefined} />;
  if (sea)
    return (
      <i class={`leaf-mark sea ${big ? "big" : ""} ${r ? `rar${r}` : ""} ${cls}`} title={r ? `${RARITY_LABEL[r]} sea-life specimen` : "sea life"}>
        <svg viewBox="0 0 12 14" aria-hidden="true">
          <path d="M3 13c1.5-2 -1.5-4 0-6s0-3 0-4M6 13c-1.5-2 1.5-4 0-7s0-3 0-5M9 13c1.5-2 -1.5-4 0-6s0-3 0-4" />
        </svg>
      </i>
    );
  return <i class={`leaf-mark ${big ? "big" : ""} ${r ? `rar${r}` : ""} ${cls}`} title={r ? `${RARITY_LABEL[r]} specimen` : undefined} />;
}

/** A creature's icon in a list (AW-257): a paw, or a fish for sea creatures, in the given color. */
export function CreatureGlyph({ aquatic, color, big = false, title }: { aquatic: boolean; color: string; big?: boolean; title?: string }) {
  const size = big ? 16 : 13;
  return (
    <svg class="creature-glyph" width={size} height={size} viewBox="-10 -10 20 20" aria-label={title ?? (aquatic ? "sea creature" : "creature")} role="img">
      {title && <title>{title}</title>}
      <circle r="9.5" fill={aquatic ? "rgb(10, 42, 78)" : "rgb(5, 7, 15)"} />
      {aquatic ? (
        <g fill={color}>
          <ellipse cx="1.5" cy="0" rx="5" ry="3" />
          <path d="M-2.5 0 L-7.5 -3.5 L-7.5 3.5 Z" />
        </g>
      ) : (
        <g fill={color}>
          <ellipse cx="0" cy="2.6" rx="3.8" ry="3.1" />
          <ellipse cx="-4.4" cy="-1.1" rx="1.4" ry="1.7" />
          <ellipse cx="-1.6" cy="-4.3" rx="1.4" ry="1.7" />
          <ellipse cx="1.6" cy="-4.3" rx="1.4" ry="1.7" />
          <ellipse cx="4.4" cy="-1.1" rx="1.4" ry="1.7" />
        </g>
      )}
    </svg>
  );
}

/** A tiny key to the ring colors. */
export function RarityLegend() {
  return (
    <span class="rarity-legend" title="Ring color on a specimen's icon shows how rare it is">
      {([1, 2, 3] as const).map((r) => (
        <span key={r} class={`rarity-key rar${r}`}>
          <i class="rarity-dot" />
          {RARITY_LABEL[r]}
        </span>
      ))}
    </span>
  );
}
