/**
 * Helm's Small Operators' Fund: Helm wants plenty of small captains flying (competition keeps the
 * Verge charted and the council supplied), so it props up struggling firms. Help is for small
 * operators only, comes with a survey job to fly in return, and is capped so it stays a hand up.
 *
 * Trips are measured from departure to docking by net worth (credits + cargo at today's prices −
 * the note − wages and upkeep owed). After a losing streak, or when the ship docks unable to cover
 * what it owes, Helm steps in. Helm also pays a small operator's first distress call.
 */
import { changeRep } from "./reputation";
import { clanMods } from "./clan";
import { COMMODITY_IDS } from "../data/commodities";
import type { Contract } from "./contracts";
import { standingSurvey } from "./contracts";
import { dailyWages } from "./crew";
import { sellPrice } from "./economy";
import { effectiveStats } from "./perks";
import type { Rng } from "./rng";
import { dailyUpkeep, log, withRng, type GameState } from "./state";
import { DAY, YEAR } from "./units";

/** Net worth below which a captain counts as a small operator. */
export const HELM_SMALL_OPERATOR_WORTH = 60_000;
/** Losing trips in a row that bring Helm in. */
export const HELM_LOSING_STREAK = 2;
/** Assists in any 12 months. */
export const HELM_ASSISTS_PER_YEAR = 2;
/** The stipend covers this many days of wages and upkeep. */
export const HELM_STIPEND_DAYS = 60;
/** Days to fly the survey Helm asks for in return. */
export const HELM_OBLIGATION_DAYS = 300;
/** How long Helm shuns a captain who skips an obligation. */
export const HELM_SHUN_YEARS = 2;

export interface HelmRecord {
  /** Net worth when the ship last left the Intrepid. */
  departWorth?: number;
  /** Losing trips in a row. */
  streak: number;
  /** When each assist was given. */
  assists: number[];
  /** Helm already paid this captain's first distress call. */
  rescueCovered?: boolean;
  /** No help until then (a skipped obligation). */
  shunnedUntil?: number;
  /** Obligation contracts already counted against the captain. */
  penalized?: string[];
}

function helm(state: GameState): HelmRecord {
  state.helm ??= { streak: 0, assists: [] };
  return state.helm;
}

/** Credits plus cargo at today's prices, minus the note and anything owed. */
export function netWorth(state: GameState): number {
  const cargo = COMMODITY_IDS.reduce((sum, id) => sum + (state.ship.cargo[id] ?? 0) * sellPrice(state.market, id), 0);
  return Math.round(state.credits + cargo - state.loan.balance - state.payrollOwed - (state.upkeepOwed ?? 0));
}

export type HelmStatus =
  | { eligible: true; assistsLeft: number }
  | { eligible: false; reason: string };

/** Whether Helm would help now, and why not if it wouldn't. */
export function helmStatus(state: GameState): HelmStatus {
  if (!clanMods(state).helmFund) return { eligible: false, reason: "Helm doesn't help Freebooter captains." };
  const h = helm(state);
  if (h.shunnedUntil !== undefined && state.time < h.shunnedUntil) {
    return { eligible: false, reason: "Helm isn't helping a captain who skipped the survey it asked for." };
  }
  if (netWorth(state) >= HELM_SMALL_OPERATOR_WORTH) return { eligible: false, reason: "Helm's fund is for small operators, and you're doing well." };
  const recent = h.assists.filter((t) => state.time - t < YEAR).length;
  if (recent >= HELM_ASSISTS_PER_YEAR) return { eligible: false, reason: `Helm helps at most ${HELM_ASSISTS_PER_YEAR} times a year.` };
  return { eligible: true, assistsLeft: HELM_ASSISTS_PER_YEAR - recent };
}

/** Called as the ship leaves the Intrepid: the trip is measured from here. */
export function helmOnDeparture(state: GameState): void {
  helm(state).departWorth = netWorth(state);
}

/** Called on docking at the Intrepid: score the trip, and step in if the captain is struggling. */
export function helmOnDocked(state: GameState): void {
  const h = helm(state);
  checkObligations(state);
  if (h.departWorth !== undefined) {
    h.streak = netWorth(state) < h.departWorth ? h.streak + 1 : 0;
    h.departWorth = undefined;
  }
  const owed = state.payrollOwed + (state.upkeepOwed ?? 0);
  const cargo = netWorth(state) - state.credits + state.loan.balance + owed;
  const cantPay = state.credits + cargo < owed;
  if (h.streak < HELM_LOSING_STREAK && !cantPay) return;
  const status = helmStatus(state);
  if (!status.eligible) return;

  // The assist: wages and upkeep for a month, a full tank, and the drive refitted.
  const stipend = Math.round((dailyWages(state) + dailyUpkeep(state)) * HELM_STIPEND_DAYS + owed);
  state.credits += stipend;
  const fuel = Math.max(0, effectiveStats(state).fuelCapacity - state.ship.fuel);
  state.ship.fuel += fuel;
  state.foldReadyAt = Math.min(state.foldReadyAt, state.time);
  h.assists.push(state.time);
  h.streak = 0;
  const job = assignObligation(state);
  log(
    state,
    "info",
    `Helm's Small Operators' Fund stepped in: ${stipend.toLocaleString()} cr toward wages and upkeep, ` +
      `${Math.round(fuel)} units of plicite, and the drive refitted.` +
      (job ? ` In return, Helm asks you to fly "${job.title}" within ${HELM_OBLIGATION_DAYS} days.` : ""),
  );
}

/** Helm pays a small operator's first distress call. Returns true if it did. */
export function helmCoversRescue(state: GameState): boolean {
  const h = helm(state);
  if (h.rescueCovered || !helmStatus(state).eligible) return false;
  h.rescueCovered = true;
  h.assists.push(state.time);
  const job = assignObligation(state);
  log(
    state,
    "info",
    "Helm's Small Operators' Fund paid for the tender: they'd rather keep a small crew flying than lose it to the void." +
      (job ? ` In return, Helm asks you to fly "${job.title}" within ${HELM_OBLIGATION_DAYS} days.` : ""),
  );
  return true;
}

/** Sign the captain up for a Helm survey, paid only its costs: the price of the help. */
function assignObligation(state: GameState): Contract | null {
  const job = withRng(state, (rng: Rng) => standingSurvey(state, rng, state.contracts.length + 1));
  if (!job) return null;
  const obligation: Contract = {
    ...job,
    id: `helm-ask-${state.contracts.length + 1}`,
    title: job.title.replace("Helm:", "Helm asks:"),
    text: `${job.text} This is the survey Helm asked for in return for its help; it pays only the costs.`,
    reward: Math.round((job.reward - 2_000) / 1.5 / 50) * 50,
    status: "active",
    deadline: state.time + HELM_OBLIGATION_DAYS * DAY,
    obligation: true,
  };
  state.contracts.push(obligation);
  return obligation;
}

/** A skipped obligation costs Helm's goodwill for a couple of years. */
function checkObligations(state: GameState): void {
  const h = helm(state);
  h.penalized ??= [];
  for (const c of state.contracts) {
    if (!c.obligation || c.status !== "failed" || h.penalized.includes(c.id)) continue;
    h.penalized.push(c.id);
    h.shunnedUntil = state.time + HELM_SHUN_YEARS * YEAR;
    changeRep(state, "helm", -15, `Never flew Helm's "${c.title}"`);
    log(state, "warning", `Helm noted that "${c.title}" was never flown. Its fund won't help you for ${HELM_SHUN_YEARS} years.`);
  }
}
