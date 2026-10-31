/**
 * The saved game. Everything here is plain JSON; the universe itself is regenerated from
 * `seed` by World. All time passes through advanceTime so the market, the Exchange loan and
 * (later) crises all tick consistently.
 */
import type { CommodityId } from "../data/commodities";
import { changeRep, tickReputation, type RepChange } from "./reputation";
import type { ClueId, ErrandKind } from "../data/clues";
import type { ErrandState } from "./covenant";
import { clanMods } from "./clan";
import type { ClanId } from "../data/ship";
import type { CompendiumRecord } from "./compendium";
import { starterContracts, tickContracts, type Contract } from "./contracts";
import type { Station } from "../data/crew";
import { UPGRADES_BY_ID } from "../data/ship";
import { chargeStowedRover, tickYard } from "./actions";
import type { HelmRecord } from "./helm";
import type { DiveRecord, ProbeDive } from "./probes";
import { hasPerk } from "./perks";
import { tickSentiment } from "./sentiment";
import { tickResearch, type ResearchRecord } from "./research";
import type { Encounter, EncounterResult } from "./combat";
import { dailyWages, ensureCrew, tickRecruits, xpForLevel, type CrewMember, type LevelUp, type Recruit } from "./crew";
import { newMarket, stepMarket, type MarketState } from "./economy";
import { Rng } from "./rng";
import type { ShipState, Cargo } from "./ship";
import type { RegionKnowledge } from "./surface";
import { formatDate, GAME_START } from "./time";
import { DAY, YEAR, type Vec2 } from "./units";
import { World } from "./world";
import { WORLD_GEN_LATEST } from "./bodies";

export const SAVE_VERSION = 1;

export interface RoverState {
  x: number;
  y: number;
  energy: number;
  cargo: Cargo;
  /** Specimens riding in the rover's sample cases, keyed "bodyId|species". */
  specimens?: Record<string, number>;
  /** Which vehicle this is (AW-17); absent means the rover. */
  vehicle?: "rover" | "boat";
}

export type Location =
  | { kind: "intrepid" }
  /** Between the stars (AW-165): a point in interstellar space, in light-years. */
  | { kind: "deep"; pos: Vec2 }
  /** In a star system. While orbiting, the ship's position follows the body. */
  | { kind: "space"; systemId: string; pos: Vec2; orbiting: string | null }
  /** Landed. `rover` is null while the rover is stowed aboard. */
  | {
      kind: "surface";
      systemId: string;
      bodyId: string;
      region: number;
      rover: RoverState | null;
      /** Where the ship stands, in planet-wide hex coordinates (rover too). */
      ship?: Vec2;
      /** Set once positions are planet-wide; older saves stored region-local coordinates. */
      globalCoords?: boolean;
      /** Jury-Rig already used on this landing. */
      juryRigUsed?: boolean;
      /** The boat, moored offshore while the rover it carried is ashore (AW-17). */
      parkedBoat?: RoverState;
      /** The rover, riding on the boat's deck while the boat is the one being driven. */
      roverAboard?: RoverState;
    };

export interface YardJob {
  kind: "install" | "retrain" | "repair";
  label: string;
  readyAt: number;
  upgradeId?: string;
  station?: Station;
}

export interface Loan {
  balance: number;
  payment: number;
  intervalDays: number;
  nextDue: number;
  missed: number;
  annualRate: number;
  /** Early payments not yet applied to an installment; the auto-debit draws on this first. */
  prepaid?: number;
  /** When the Exchange last granted a hardship deferral (one a year). */
  graceAt?: number;
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
  /** The player. `xp` is their experience at the captain's station. */
  captain: { name: string; born: number; xp?: number; perks?: string[]; clan?: ClanId; /** Chosen portrait (AW-151); otherwise one is assigned. */ face?: number };
  /** The five officers, one per station. */
  crew?: CrewMember[];
  /** The hiring hall aboard the Intrepid, and when its pool next turns over. */
  recruits?: Recruit[];
  nextRecruitsAt?: number;
  /** Level-ups the player hasn't seen yet (the UI shows each as a popup). */
  levelUps?: LevelUp[];
  /** Work in progress aboard the Intrepid (installs, Lyceum courses); the ship leaves when it's all done. */
  yard?: YardJob[];
  /** Helm's Small Operators' Fund: trip scoring, assists given, obligations. */
  helm?: HelmRecord;
  /** When the ship last docked at the Intrepid (long hauls wear on the crew). */
  lastDockedAt?: number;
  /** Share of each sale paid to the crew as bonuses, 0–0.2. */
  crewShare?: number;
  /** An atmospheric probe on its way down (AW-16). */
  probeDive?: ProbeDive;
  /** Depth bands profiled per giant, and which profiles the Lyceum has bought ("bodyId|depth"). */
  atmoReadings?: Record<string, number[]>;
  /** Research projects commissioned at the Intrepid (AW-15), by project id. */
  research?: Record<string, ResearchRecord>;
  /** Which world generator built this universe (AW-145). Old saves without it are generation 1. */
  worldGen?: number;
  /** 2 once the save uses the slower clock (AW-142); older saves get their loan terms rescaled. */
  clock?: number;
  /** A raider's hail or a battle in progress (combat v1, M3). */
  encounter?: Encounter;
  /** How the last encounter ended, for the debrief. */
  lastEncounter?: EncounterResult;
  /** The system whose departure has already been rolled for raiders (one roll per departure). */
  interdictionClear?: string;
  /** Intrepid prices as of the last docking, and when (playtest 13): what the captain knows out in the field. */
  knownPrices?: { t: number; prices: Partial<Record<CommodityId, number>> };
  /** When the ship last folded into a star system: raiders notice a ship that lingers (playtest 12). */
  systemArrivedAt?: number;
  /** The Archive's guidance (AW-24): entries read, and whether it's speaking at all (on unless false). */
  archiveSeen?: string[];
  guidance?: boolean;
  /** How far along the Awaken path (M5): the number of clues in the Covenant's dossier. */
  awakening?: number;
  /** The Covenant's dossier (AW-25): clues found, errands taken, the impossible journal entry, and when the trail pointed onward. */
  clues?: { id: ClueId; t: number }[];
  errands?: Partial<Record<ErrandKind, ErrandState>>;
  futureLog?: { t: number; text: string };
  awakenFinale?: number;
  /** Deep-field sweeps (AW-165): circles of interstellar space searched, in light-years. */
  deepScans?: { x: number; y: number; r: number; t: number }[];
  /** What the array has picked out between the stars: identified, or a faint return. */
  deepKnown?: Record<string, "known" | "faint">;
  /** Floating life brought up from each giant by probes (playtest 15), so the life-signs readout can confirm it. */
  giantLife?: Record<string, string[]>;
  /** Clan relations (AW-22): each clan's standing with you (-100..100; missing means its starting value), and recent changes. */
  reputation?: Partial<Record<ClanId, number>>;
  repLog?: RepChange[];
  /** The captain's own names for worlds, by body id (shown under the catalogue name). */
  nicknames?: Record<string, string>;
  /** Projects whose needs are pinned to the ship status window and star map. */
  trackedResearch?: string[];
  atmoSold?: string[];
  /** Recent dives (for contracts and the record). */
  probeHistory?: DiveRecord[];
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
  /** Upkeep on installed equipment accrued since the last settling at the Intrepid. */
  upkeepOwed?: number;
  contracts: Contract[];
  /** When the job board next gets a new posting. */
  nextContractAt: number;
  /** Species (by name) already sold to the Lyceum; the first sale of each species pays a bonus. */
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
  /** The captain's own clan (a small perk and a matching cost); none if left out. */
  clan?: ClanId;
  /** The captain's portrait, chosen on the new-game screen. */
  face?: number;
  shipName?: string;
  /** The Archive's first-run guidance; on unless turned off on the new-game screen. */
  guidance?: boolean;
}

export function newGame({ seed, captainName = "Reyes", shipName = "Second Chance", clan, face, guidance = true }: NewGameOptions): GameState {
  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    guidance,
    archiveSeen: [],
    time: GAME_START + 8 * 60,
    rngState: seed ^ 0x5eed,
    captain: { name: captainName.replace(/^captain\s+/i, "").trim() || "Reyes", born: GAME_START - 28 * YEAR - 117 * DAY, xp: 0, ...(clan ? { clan } : {}), ...(face !== undefined ? { face } : {}) },
    credits: 6_000 + (clan === "freebooters" ? 3_000 : 0),
    loan: {
      balance: 48_000,
      payment: 2_500,
      intervalDays: 120,
      nextDue: GAME_START + 120 * DAY,
      missed: 0,
      prepaid: 0,
      annualRate: 0.03,
    },
    ship: { name: shipName, upgrades: [], fuel: 40, cargo: {} },
    location: { kind: "intrepid" },
    foldReadyAt: GAME_START,
    visitedSystems: [],
    clock: 2,
    worldGen: WORLD_GEN_LATEST,
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
  const world = new World(seed, WORLD_GEN_LATEST);
  for (const sys of world.galaxy.systems) {
    if (!sys.charted) continue;
    for (const body of world.system(sys.id).bodies) {
      state.scannedBodies.push(body.id);
      if (body.easy) state.surveyedBodies.push(body.id);
    }
  }
  state.contracts = starterContracts(world, state.surveyedBodies);
  ensureCrew(state);
  if (clan) clanStart(state, world, clan);

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
  state.payrollOwed += (minutes / DAY) * dailyWages(state);
  state.upkeepOwed = (state.upkeepOwed ?? 0) + (minutes / DAY) * dailyUpkeep(state);
  if (state.location.kind === "intrepid") settlePayroll(state);
  tickContracts(state);
  tickRecruits(state);
  tickYard(state);
  tickResearch(state);
  chargeStowedRover(state, minutes);
  tickSentiment(state, minutes);
  tickReputation(state, minutes);
  const day = Math.floor(state.time / DAY);
  if (day > state.market.day) withRng(state, (rng) => stepMarket(state.market, rng, day));
  settleLoan(state);
}

/** Pay the crew what they're owed, as far as credits allow. Called whenever time passes at the Intrepid. */
/** Daily upkeep on installed equipment: more gear, more to maintain (a share of its price per day). */
export const UPKEEP_RATE_PER_DAY = 0.0003;

export function dailyUpkeep(state: GameState): number {
  return (state.ship.upgrades.reduce((sum, id) => sum + (UPGRADES_BY_ID.get(id)?.price ?? 0), 0) * UPKEEP_RATE_PER_DAY) * clanMods(state).upkeep;
}

export function settlePayroll(state: GameState): void {
  // The yard's upkeep bill comes first; the crew are paid from what's left.
  const upkeep = Math.round(state.upkeepOwed ?? 0);
  if (upkeep >= 1) {
    const paid = Math.min(upkeep, Math.max(0, state.credits));
    state.credits -= paid;
    state.upkeepOwed = (state.upkeepOwed ?? 0) - paid;
    if (paid >= 100) log(state, "trade", `Paid the yard ${paid.toLocaleString()} cr for equipment upkeep.`);
  }
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

export interface LoanOutlook {
  /** Installments left at the current payment, counting those covered by prepayments. */
  installments: number;
  /** When the last one falls due. */
  payoffAt: number;
  /** Interest the next installment adds to the balance. */
  nextInterest: number;
  /** Interest still to come over the life of the note (if every installment is paid on time). */
  totalInterest: number;
}

/**
 * The note amortizes: at each due date interest for the period is added to the balance, then the
 * installment comes off it, so whatever exceeds the interest pays down principal. There's no
 * fixed term; it ends when the balance reaches zero. This projects that, assuming on-time payments.
 */
export function loanOutlook(loan: Loan, annualRate = loan.annualRate): LoanOutlook {
  const periodRate = annualRate * (loan.intervalDays / 365);
  let balance = loan.balance;
  let prepaid = loan.prepaid ?? 0;
  let due = loan.nextDue;
  let installments = 0;
  let totalInterest = 0;
  const nextInterest = Math.round(balance * periodRate);
  while (balance > 0 && installments < 1000) {
    const grown = Math.round(balance * (1 + periodRate));
    totalInterest += grown - balance;
    balance = grown;
    const installment = Math.min(loan.payment, balance + prepaid);
    const fromPrepaid = Math.min(prepaid, installment);
    prepaid -= fromPrepaid;
    balance -= Math.min(installment - fromPrepaid, balance);
    installments++;
    if (balance > 0) due += loan.intervalDays * DAY;
  }
  return { installments, payoffAt: due, nextInterest, totalInterest };
}

/** Fee for a hardship deferral, as a share of the installment. */
export const GRACE_FEE = 0.03;

/** When the Exchange will next defer an installment it can't collect (one grace a year); 0 if it never has. */
export function graceAvailableAt(loan: Loan): number {
  return loan.graceAt === undefined ? 0 : loan.graceAt + YEAR;
}

/** The note's rate in effect: Note Restructuring (comms) takes 2 points off. */
export function loanRate(state: GameState): number {
  return Math.max(0, state.loan.annualRate * (hasPerk(state, "note-restructuring") ? 2 / 3 : 1) * clanMods(state).loanRate);
}

function settleLoan(state: GameState): void {
  const loan = state.loan;
  while (loan.balance > 0 && state.time >= loan.nextDue) {
    loan.balance = Math.round(loan.balance * (1 + loanRate(state) * (loan.intervalDays / 365)));
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
      changeRep(state, "exchange", 1, "Paid an installment on time");
      log(
        state,
        "trade",
        `Exchange auto-debited ${due.toLocaleString()} cr${fromPrepaid > 0 ? ` (plus ${fromPrepaid.toLocaleString()} cr from early payments)` : ""}. Balance: ${loan.balance.toLocaleString()} cr.`,
      );
    } else if (loan.graceAt === undefined || state.time - loan.graceAt >= YEAR) {
      // Hardship: once a year the Exchange defers an installment it can't collect, for a small fee,
      // rather than marking it missed. A rough trip shouldn't snowball.
      loan.graceAt = state.time;
      const fee = Math.round(due * GRACE_FEE);
      loan.balance += fee;
      log(
        state,
        "warning",
        `Couldn't cover the Exchange installment due ${formatDate(when)}. They deferred it to the next due date for a ${fee.toLocaleString()} cr fee. ` +
          `That's this year's grace; next time it counts as a missed payment.`,
      );
    } else {
      loan.missed++;
      changeRep(state, "exchange", -8, "Missed a payment on the note");
      // Exchange captains get the relentless collectors: double the late fee.
      const fee = Math.round(due * 0.1 * (state.captain.clan === "exchange" ? 2 : 1));
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

/** What the captain's clan sets up at the start (AW-146). */
function clanStart(state: GameState, world: World, clan: ClanId): void {
  // Officers from your own clan start out a little more loyal to you.
  for (const m of state.crew ?? []) if (m.clan === clan) m.loyalty = Math.min(100, (m.loyalty ?? 50) + 10);
  if (clan === "helm") {
    // Helm's charts of three more stars (the nearest uncharted ones): scanned before you arrive.
    const from = world.galaxy.systems.find((s) => s.home)?.pos ?? { x: 0, y: 0 };
    const extra = world.galaxy.systems
      .filter((s) => !s.charted)
      .sort((a, b) => Math.hypot(a.pos.x - from.x, a.pos.y - from.y) - Math.hypot(b.pos.x - from.x, b.pos.y - from.y))
      .slice(0, 3);
    for (const sys of extra) for (const b of world.system(sys.id).bodies) if (!state.scannedBodies.includes(b.id)) state.scannedBodies.push(b.id);
  }
  if (clan === "midshipmen") {
    // A seasoned Midshipman engineer, one of your own.
    const eng = (state.crew ?? []).find((m) => m.station === "engineering");
    if (eng) {
      if (eng.clan !== "midshipmen") eng.loyalty = Math.min(100, (eng.loyalty ?? 50) + 10);
      eng.clan = "midshipmen";
      eng.xp = Math.max(eng.xp, xpForLevel(3));
    }
  }
}
