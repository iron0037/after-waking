/**
 * The saved game. Everything here is plain JSON; the universe itself is regenerated from
 * `seed` by World. All time passes through advanceTime so the market, the Exchange loan and
 * (later) crises all tick consistently.
 */
import { newMarket, stepMarket, type MarketState } from "./economy";
import { Rng } from "./rng";
import type { ShipState, Cargo } from "./ship";
import type { RegionKnowledge } from "./surface";
import { formatDate, GAME_START } from "./time";
import { DAY, YEAR, type Vec2 } from "./units";

export const SAVE_VERSION = 1;

export interface RoverState {
  x: number;
  y: number;
  energy: number;
  cargo: Cargo;
}

export type Location =
  | { kind: "intrepid" }
  /** In a star system. While orbiting, the ship's position follows the body. */
  | { kind: "space"; systemId: string; pos: Vec2; orbiting: string | null }
  /** Landed. `rover` is null while the rover is stowed aboard. */
  | { kind: "surface"; systemId: string; bodyId: string; region: number; rover: RoverState | null };

export interface Loan {
  balance: number;
  payment: number;
  intervalDays: number;
  nextDue: number;
  missed: number;
  annualRate: number;
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
  regions: Record<string, RegionKnowledge>;
  market: MarketState;
  journal: JournalEntry[];
  stats: { folds: number; tonnesMined: number; earned: number; landings: number };
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
    regions: {},
    market: newMarket(Math.floor(GAME_START / DAY)),
    journal: [],
    stats: { folds: 0, tonnesMined: 0, earned: 0, landings: 0 },
  };
  log(
    state,
    "info",
    `The Exchange signs over the freighter ${shipName}, along with a 48,000-credit note. The fuel tanks hold 40 units of plicite. The Verge is waiting.`,
  );
  return state;
}

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
  const day = Math.floor(state.time / DAY);
  if (day > state.market.day) withRng(state, (rng) => stepMarket(state.market, rng, day));
  settleLoan(state);
}

function settleLoan(state: GameState): void {
  const loan = state.loan;
  while (loan.balance > 0 && state.time >= loan.nextDue) {
    loan.balance = Math.round(loan.balance * (1 + loan.annualRate * (loan.intervalDays / 365)));
    const due = Math.min(loan.payment, loan.balance);
    const when = loan.nextDue;
    loan.nextDue += loan.intervalDays * DAY;
    if (state.credits >= due) {
      state.credits -= due;
      loan.balance -= due;
      log(state, "trade", `Exchange loan payment of ${due.toLocaleString()} cr collected. Balance: ${loan.balance.toLocaleString()} cr.`);
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
