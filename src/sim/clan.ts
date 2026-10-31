/**
 * The captain's clan (chosen at the start): its modifiers, applied wherever the numbers live.
 * Data and wording in src/data/clans.ts.
 */
import { repPriceMult } from "./reputation";
import { CAPTAIN_CLANS, NO_CLAN_MODS, type ClanMods } from "../data/clans";
import type { ClanId } from "../data/ship";
import type { GameState } from "./state";

export function clanMods(state: Pick<GameState, "captain">): ClanMods {
  const clan = state.captain.clan;
  return clan ? { ...NO_CLAN_MODS, ...CAPTAIN_CLANS[clan].mods } : NO_CLAN_MODS;
}

/** An upgrade's price for this captain (their own clan's vendors give a discount). */
export function upgradePriceFor(state: GameState, vendor: ClanId, price: number): number {
  // Your own clan's discount, then the vendor's view of you (AW-22).
  const own = vendor === state.captain.clan ? clanMods(state).ownVendorPrice : 1;
  return Math.round((price * own * repPriceMult(state, vendor)) / 100) * 100;
}
