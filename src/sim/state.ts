/**
 * The saved game. Everything here is plain JSON; the universe itself is regenerated from
 * `seed` by World. All time passes through advanceTime so the market, the Exchange loan and
 * (later) crises all tick consistently.
 */
import type { CompendiumRecord } from "./compendium";
import { starterContracts, tickContracts, type Contract } from "./contracts";
import { newMarket, stepMarket, type MarketState } from "./economy";
import { Rng } from "./rng";
import type { ShipState, Cargo } from "./ship";
import type { RegionKnowledge } from "./surface";
import { formatDate, GAME_START } from "./time";
import { DAY, YEAR, type Vec2 } from "./units";
import { World } from "./world";

export const SAVE_VERSION = 1;

export interface RoverState {
  x: number;
  y: number;
  energy: number;
  cargo: Cargo;
  /** Specimens riding in the rover's sample cases, keyed "bodyId|species". */
  specimens?: Record<string, number>;
}

export type Location =
  | { kind: "intrepid" }
  /** In a star system. While orbiting, the ship's position follows the body. */
  | { kind: "space"; systemId: string; pos: Vec2; orbiting: string | null }
  /** Landed. `rover` is null while the rover is stowed aboard. */
  | {
      kind: "surface";
      systemId: string;
      bodyId: string;
      region: number;
      rover: RoverState | null;
      /** Where the ship sits now, if it has hopped from the region's original landing site. */
      ship?: Vec2;
    };

export interface Loan {
  balance: number;
  payment: number;
  intervalDays: number;
  nextDue: number;
  missed: number;
  annualRate: number;
  /** Early payments not yet applied to an installment; the auto-debit draws on this first. */
  prepaid?: number;
}

export type JournalKind = "info" | "travel" | "discovery" | "trade" | "warning";

export interface JournalEntry {
  t: number;
  kind: JournalKind;
  text: string;
}

export interface GameState {
  version: number;
  seed: number;
  time: number;
  /** Gameplay RNG state (not world generation). */
  rngState: number;
  captain: { name: string; born: number };
  credits: number;
  loan: Loan;
  ship: ShipState;
  location: Location;
  foldReadyAt: number;
  visitedSystems: string[];
  scannedBodies: string[];
  /** Bodies given a detailed orbital survey: +1 effective sensor tier there. */
  surveyedBodies: string[];
  /** Crew wages accrued since the last payday (paid when docked at the Intrepid). */
  payrollOwed: number;
  contracts: Contract[];
  /** When the job board next gets a new posting. */
  nextContractAt: number;
  /** Species (by specimen key) already sold to the Lyceum; the first sale of each pays a bonus. */
  catalogedSpecies: string[];
  /** Everything ever found, keyed "mineral:copper", "gem:plicite-geode", "flora:glass-reed". */
  compendium: Record<string, CompendiumRecord>;
  regions: Record<string, RegionKnowledge>;
  market: MarketState;
  journal: JournalEntry[];
  stats: { folds: number; tonnesMined: number; earned: number; landings: number; loanPaid?: number };
}

export interface NewGameOptions {
  seed: number;
  captainName?: string;
  shipName?: string;
}

export function newGame({ seed, captainName = "Captain Reyes", shipName = "Second Chance" }: NewGameOptions): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    time: GAME_START + 8 * 60,
    rngState: seed ^ 0x5eed,
    captain: { name: captainName, born: GAME_START - 28 * YEAR - 117 * DAY },
    credits: 6_000,
    loan: {
      balance: 48_000,
      payment: 2_500,
      intervalDays: 60,
      nextDue: GAME_START + 60 * DAY,
      missed: 0,
      annualRate: 0.06,
    },
    ship: { name: shipName, upgrades: [], fuel: 40, cargo: {} },
    location: { kind: "intrepid" },
    foldReadyAt: GAME_START,
    visitedSystems: [],
    scannedBodies: [],
    surveyedBodies: [],
    payrollOwed: 0,
    contracts: [],
    nextContractAt: GAME_START + 20 * DAY,
    catalogedSpecies: [],
    compendium: {},
    regions: {},
    market: newMarket(Math.floor(GAME_START / DAY)),
    journal: [],
    stats: { folds: 0, tonnesMined: 0, earned: 0, landings: 0, loanPaid: 0 },
  };
  // The first scouts charted the near stars: their scan records come with the ship's nav package,
  // and the home worlds were surveyed in detail.
  const world = new World(seed);
  for (const sys of world.galaxy.systems) {
    if (!sys.charted) continue;
    for (const body of world.system(sys.id).bodies) {
      state.scannedBodies.push(body.id);
      if (body.easy) state.surveyedBodies.push(body.id);
    }
  }
  state.contracts = starterContracts(world, state.surveyedBodies);

  log(
    state,
    "info",
    `The Exchange signs over the freighter ${shipName}, along with a 48,000-credit note. The fuel tanks hold 40 units of plicite. The Verge is waiting.`,
  );
  log(
    state,
    "info",
    "Helm's nav package includes the first scouts' records for the twelve charted stars. The three nearest are well-trodden ground: a good place to learn the trade. The job board has work for new captains.",
  );
  return state;
}

/** Six crew at 25 cr a day each. (Crew become individuals with skills in M2.) */
export const CREW_SIZE = 6;
export const WAGE_PER_DAY = 25;

export function log(state: GameState, kind: JournalKind, text: string): void {
  state.journal.push({ t: state.time, kind, text });
}

/** Run gameplay randomness with the saved RNG state, then store the advanced state back. */
export function withRng<T>(state: GameState, fn: (rng: Rng) => T): T {
  const rng = new Rng(state.rngState);
  const result = fn(rng);
  state.rngState = rng.state;
  return result;
}

/** The only way time moves forward. */
export function advanceTime(state: GameState, minutes: number): void {
  if (minutes < 0) throw new Error("Time cannot run backwards");
  state.time += minutes;
  state.payrollOwed += (minutes / DAY) * CREW_SIZE * WAGE_PER_DAY;
  if (state.location.kind === "intrepid") settlePayroll(state);
  tickContracts(state);
  const day = Math.floor(state.time / DAY);
  if (day > state.market.day) withRng(state, (rng) => stepMarket(state.market, rng, day));
  settleLoan(state);
}

/** Pay the crew what they're owed, as far as credits allow. Called whenever time passes at the Intrepid. */
export function settlePayroll(state: GameState): void {
  const owed = Math.round(state.payrollOwed);
  if (owed < 1) return;
  const paid = Math.min(owed, Math.max(0, state.credits));
  state.credits -= paid;
  state.payrollOwed -= paid;
  if (paid >= 100) log(state, "trade", `Paid the crew ${paid.toLocaleString()} cr in wages.`);
  if (state.payrollOwed >= 1) {
    log(state, "warning", `Couldn't cover the crew's wages: ${Math.round(state.payrollOwed).toLocaleString()} cr still owed.`);
  }
}

function settleLoan(state: GameState): void {
  const loan = state.loan;
  while (loan.balance > 0 && state.time >= loan.nextDue) {
    loan.balance = Math.round(loan.balance * (1 + loan.annualRate * (loan.intervalDays / 365)));
    const when = loan.nextDue;
    loan.nextDue += loan.intervalDays * DAY;
    // Early payments already reduced the balance; they cover this installment first.
    const installment = Math.min(loan.payment, loan.balance + (loan.prepaid ?? 0));
    const fromPrepaid = Math.min(loan.prepaid ?? 0, installment);
    loan.prepaid = (loan.prepaid ?? 0) - fromPrepaid;
    const due = Math.min(installment - fromPrepaid, loan.balance);
    if (due <= 0) {
      log(state, "trade", `Exchange installment covered by your early payments. Balance: ${loan.balance.toLocaleString()} cr.`);
    } else if (state.credits >= due) {
      state.credits -= due;
      state.stats.loanPaid = (state.stats.loanPaid ?? 0) + due;
      loan.balance -= due;
      log(
        state,
        "trade",
        `Exchange auto-debited ${due.toLocaleString()} cr${fromPrepaid > 0 ? ` (plus ${fromPrepaid.toLocaleString()} cr from early payments)` : ""}. Balance: ${loan.balance.toLocaleString()} cr.`,
      );
    } else {
      loan.missed++;
      const fee = Math.round(due * 0.1);
      loan.balance += fee;
      log(
        state,
        "warning",
        `Missed Exchange payment due ${formatDate(when)}. A ${fee.toLocaleString()} cr late fee was added. Missed payments: ${loan.missed}.`,
      );
    }
    if (loan.balance <= 0) {
      loan.balance = 0;
      log(state, "trade", `The Exchange note is paid in full. The ${state.ship.name} is yours, free and clear.`);
    }
  }
}
