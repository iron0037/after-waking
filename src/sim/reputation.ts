/**
 * Clan relations (AW-22): each clan's standing with you, from -100 to +100. What you do for (or
 * against) one clan ripples to its allies and rivals. Standing sets what a clan pays for contracts
 * and charges for gear; a hostile clan won't deal with you at all. Extreme standings drift slowly
 * back toward where they started, so one bad year isn't forever.
 */
import { hasPerk } from "./perks";
import { CLAN_TIES } from "../data/clans";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { log, type GameState } from "./state";
import { YEAR } from "./units";

export const CLAN_IDS = Object.keys(CLAN_NAMES) as ClanId[];

export type RepTier = "hostile" | "cool" | "neutral" | "friendly" | "trusted";

export interface TierInfo {
  label: string;
  /** Contract pay multiplier. */
  pay: number;
  /** Gear price multiplier. */
  price: number;
  /** One line on what it means. */
  means: string;
}

export const TIER_INFO: Record<RepTier, TierInfo> = {
  hostile: { label: "Hostile", pay: 0, price: 0, means: "Won't post work for you, sell you gear, run your research or sign on with you." },
  cool: { label: "Cool", pay: 0.9, price: 1.1, means: "Pays 10% less for contracts and charges 10% more for gear." },
  neutral: { label: "Neutral", pay: 1, price: 1, means: "Business as usual." },
  friendly: { label: "Friendly", pay: 1.1, price: 0.95, means: "Pays 10% more for contracts; gear 5% off." },
  trusted: { label: "Trusted", pay: 1.2, price: 0.9, means: "Pays 20% more for contracts; gear 10% off." },
};

export const REP_MIN = -100;
export const REP_MAX = 100;
/** How much of a change spills onto other clans, times the tie between them (-1 to +1). */
export const SPILLOVER = 0.5;
/** Standing relaxes toward its starting point by this share a year. */
export const REP_DRIFT_PER_YEAR = 0.15;

export function repTier(value: number): RepTier {
  if (value <= -40) return "hostile";
  if (value <= -10) return "cool";
  if (value < 20) return "neutral";
  if (value < 50) return "friendly";
  return "trusted";
}

/** Where a clan's standing starts: your own clan likes you; Freebooter captains start cool with the law and the bank. */
export function startingRep(state: Pick<GameState, "captain">, clan: ClanId): number {
  const own = state.captain.clan;
  if (own === clan) return 25;
  if (own === "freebooters" && (clan === "helm" || clan === "exchange")) return clan === "helm" ? -20 : -15;
  return 0;
}

export function reputation(state: GameState, clan: ClanId): number {
  return state.reputation?.[clan] ?? startingRep(state, clan);
}

export function tierOf(state: GameState, clan: ClanId): RepTier {
  return repTier(reputation(state, clan));
}

/** Contract pay multiplier for this clan's work (0 if hostile). */
export function repPayMult(state: GameState, clan: ClanId): number {
  return TIER_INFO[tierOf(state, clan)].pay;
}

/** Gear price multiplier at this clan's counter (hostile clans don't sell; this returns 1 for them). */
export function repPriceMult(state: GameState, clan: ClanId): number {
  return TIER_INFO[tierOf(state, clan)].price || 1;
}

/** Will this clan deal with you at all? */
export function clanRefuses(state: GameState, clan: ClanId): boolean {
  return tierOf(state, clan) === "hostile";
}

export interface RepChange {
  t: number;
  clan: ClanId;
  delta: number;
  reason: string;
}

function setRep(state: GameState, clan: ClanId, value: number): void {
  state.reputation ??= {};
  state.reputation[clan] = Math.round(Math.max(REP_MIN, Math.min(REP_MAX, value)) * 10) / 10;
}

/**
 * Change a clan's standing (and, through its ties, a little of everyone else's). Tier changes are
 * logged in the journal; every change goes in the recent-changes list for the Clans panel.
 */
export function changeRep(state: GameState, clan: ClanId, amount: number, reason: string, spill = true): void {
  if (amount === 0) return;
  // Clan Dialects (comms): speaking their way earns a quarter more goodwill.
  if (amount > 0 && hasPerk(state, "clan-dialects")) amount *= 1.25;
  const deltas = new Map<ClanId, number>([[clan, amount]]);
  if (spill) {
    for (const other of CLAN_IDS) {
      if (other === clan) continue;
      const tie = CLAN_TIES[clan]?.[other] ?? CLAN_TIES[other]?.[clan] ?? 0;
      if (tie !== 0) deltas.set(other, amount * tie * SPILLOVER);
    }
  }
  for (const [c, d] of deltas) {
    if (Math.abs(d) < 0.05) continue;
    const before = reputation(state, c);
    setRep(state, c, before + d);
    const after = reputation(state, c);
    const t0 = repTier(before);
    const t1 = repTier(after);
    state.repLog ??= [];
    state.repLog.push({ t: state.time, clan: c, delta: Math.round((after - before) * 10) / 10, reason: c === clan ? reason : `${reason} (${CLAN_NAMES[clan]}'s ${d > 0 ? "friends" : "rivals"} noticed)` });
    if (state.repLog.length > 40) state.repLog.splice(0, state.repLog.length - 40);
    if (t0 !== t1) {
      const up = after > before;
      const name = CLAN_NAMES[c];
      const label = TIER_INFO[t1].label.toLowerCase();
      const head = up
        ? t1 === "trusted"
          ? `${name} trust you now.`
          : t1 === "friendly"
            ? `${name} count you a friend now.`
            : `${name} have warmed to you: ${label} now.`
        : `${name} have cooled on you: ${label} now.`;
      log(state, up ? "info" : "warning", `${head} ${TIER_INFO[t1].means}`);
    }
  }
}

/** Slow drift back toward each clan's starting standing. Called as time passes. */
export function tickReputation(state: GameState, minutes: number): void {
  if (!state.reputation) return;
  const k = 1 - Math.exp((-REP_DRIFT_PER_YEAR * minutes) / YEAR);
  for (const clan of CLAN_IDS) {
    const v = state.reputation[clan];
    if (v === undefined) continue;
    const home = startingRep(state, clan);
    state.reputation[clan] = v + (home - v) * k;
  }
}

export interface ClanStanding {
  clan: ClanId;
  value: number;
  tier: RepTier;
  info: TierInfo;
  allies: ClanId[];
  rivals: ClanId[];
  recent: RepChange[];
}

/** Every clan's standing with you, for the Clans panel. */
export function clanStandings(state: GameState): ClanStanding[] {
  return CLAN_IDS.map((clan) => {
    const value = Math.round(reputation(state, clan));
    const tier = repTier(value);
    const ties = CLAN_IDS.filter((o) => o !== clan).map((o) => [o, CLAN_TIES[clan]?.[o] ?? CLAN_TIES[o]?.[clan] ?? 0] as const);
    return {
      clan,
      value,
      tier,
      info: TIER_INFO[tier],
      allies: ties.filter(([, t]) => t > 0).map(([o]) => o),
      rivals: ties.filter(([, t]) => t < 0).map(([o]) => o),
      recent: (state.repLog ?? []).filter((r) => r.clan === clan && state.time - r.t < 2 * YEAR).slice(-5).reverse(),
    };
  });
}

/** How much a finished contract lifts its clan: more for bigger jobs. */
export function contractRepGain(reward: number): number {
  return Math.min(12, 4 + reward / 2_500);
}

export const REP_LAPSE = -12;
