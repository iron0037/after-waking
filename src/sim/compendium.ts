/**
 * The compendium: a permanent record of every kind of thing the captain has found, measured
 * against the whole catalog. For completionists, and a quiet nudge to go somewhere new.
 *
 * Like contracts.ts, this writes the journal directly so it can be used from anywhere.
 */
import { COMMODITIES, ORE_IDS, type CommodityId } from "../data/commodities";
import { FLORA, MINERAL_SPECIMENS, type CompendiumKind, type MineralSpecimen } from "../data/catalog";
import type { Rng } from "./rng";
import type { GameState } from "./state";
import { noticeFind } from "./covenant";

export interface CompendiumRecord {
  /** When it was first found. */
  t: number;
  /** Where, as a readable place name. */
  where: string;
}

export function compendiumKey(kind: CompendiumKind, id: string): string {
  return `${kind}:${id}`;
}

/** Record a find. Returns true if it's a new entry. */
export function recordFind(state: GameState, kind: CompendiumKind, id: string, where: string, name: string): boolean {
  state.compendium ??= {};
  const key = compendiumKey(kind, id);
  if (state.compendium[key]) return false;
  state.compendium[key] = { t: state.time, where };
  state.journal.push({ t: state.time, kind: "discovery", text: `New compendium entry: ${name}, found on ${where}.` });
  noticeFind(state, kind, id);
  return true;
}

export interface CompendiumTotals {
  mineral: { found: number; total: number };
  gem: { found: number; total: number };
  flora: { found: number; total: number };
  all: { found: number; total: number };
}

export function compendiumTotals(state: GameState): CompendiumTotals {
  const has = (kind: CompendiumKind, id: string) => Boolean(state.compendium?.[compendiumKey(kind, id)]);
  const mineral = { found: ORE_IDS.filter((id) => has("mineral", id)).length, total: ORE_IDS.length };
  const gem = { found: MINERAL_SPECIMENS.filter((g) => has("gem", g.id)).length, total: MINERAL_SPECIMENS.length };
  const flora = { found: FLORA.filter((f) => has("flora", f.id)).length, total: FLORA.length };
  return {
    mineral,
    gem,
    flora,
    all: { found: mineral.found + gem.found + flora.found, total: mineral.total + gem.total + flora.total },
  };
}

const RARITY_WEIGHT = { 1: 6, 2: 3, 3: 1 } as const;
/** What the Exchange's collectors wire you for a duplicate specimen, by rarity. */
export const DUPLICATE_BOUNTY = { 1: 150, 2: 500, 3: 1_500 } as const;

/**
 * Chance that a drilling run turns up a mineral specimen from the ore being worked:
 * about 3.5% per hour of drilling, capped at 30% per run.
 */
/** `chanceMult` scales the odds (Fortune Favors doubles them; a large value makes a find certain). */
export function rollMineralSpecimen(rng: Rng, host: CommodityId, hours: number, chanceMult = 1): MineralSpecimen | null {
  if (rng.next() >= Math.min(0.3, 0.035 * hours) * chanceMult) return null;
  const pool = MINERAL_SPECIMENS.filter((g) => g.host === host);
  if (pool.length === 0) return null;
  return rng.weighted(pool.map((g) => [g, RARITY_WEIGHT[g.rarity]] as const));
}

/**
 * Handle a drilled specimen. The first of each kind goes to the Lyceum's collection (a compendium
 * entry) for a finder's fee; later ones sell to Exchange collectors. Either way it pays.
 */
export function foundMineralSpecimen(state: GameState, gem: MineralSpecimen, where: string): void {
  const bounty = DUPLICATE_BOUNTY[gem.rarity];
  state.credits += bounty;
  state.stats.earned += bounty;
  const host = COMMODITIES[gem.host].name.toLowerCase();
  if (recordFind(state, "gem", gem.id, where, gem.name)) {
    state.journal.push({
      t: state.time,
      kind: "trade",
      text: `Mineral specimen: a ${gem.name} turned up in the ${host} cores. The Lyceum paid a ${bounty} cr finder's fee for its collection.`,
    });
    return;
  }
  state.journal.push({
    t: state.time,
    kind: "trade",
    text: `Mineral specimen: another ${gem.name} in the ${host} cores. Exchange collectors wired ${bounty} cr for it.`,
  });
}

export { RARITY_WEIGHT };
