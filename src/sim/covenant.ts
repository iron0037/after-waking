/**
 * The Covenant's clue trail toward the Awaken ending (AW-25). Clues go into a dossier: some come
 * from finds (folded plicite, song moss, what the Awaken-path perks notice), others from the
 * Covenant's errands, accepted at the Intrepid. Content lives in src/data/clues.ts.
 */
import { CLUES, CLUES_BY_ID, CLUES_FOR_FINALE, ERRANDS, ERRANDS_BY_KIND, FINALE_TEXT, type Clue, type ClueId, type ErrandDef, type ErrandKind } from "../data/clues";
import { INTREPID_POS } from "./galaxy";
import { hasPerk } from "./perks";
import { fail, ok, type Result } from "./result";
import { rngFor } from "./rng";
import { bondClan } from "./sentiment";
import { advanceTime, log, type GameState } from "./state";
import { dist, HOUR, YEAR } from "./units";
import type { World } from "./world";

export interface ErrandState {
  status: "active" | "done";
  /** The target star, for errands done in a system. */
  systemId?: string;
  /** Folds made when the recorder came aboard. */
  foldsAtStart?: number;
}

/** Folds the recorder has to see. */
export const RECORDER_FOLDS = 3;

// --- clues ------------------------------------------------------------------------------------

export function hasClue(state: GameState, id: ClueId): boolean {
  return (state.clues ?? []).some((c) => c.id === id);
}

export function clueCount(state: GameState): number {
  return (state.clues ?? []).length;
}

/**
 * Add a clue to the dossier (once). Each one deepens the Awaken path: the Archive starts to read
 * strangely, and once the dossier is thick enough the Covenant says where every thread leads.
 * Returns the clue if it was new.
 */
export function awardClue(state: GameState, id: ClueId): Clue | null {
  const clue = CLUES_BY_ID.get(id);
  if (!clue || hasClue(state, id)) return null;
  state.clues ??= [];
  state.clues.push({ id, t: state.time });
  state.awakening = state.clues.length;
  log(state, "discovery", `Covenant dossier: ${clue.title}. ${clue.found}`);
  if (state.clues.length === 1) {
    log(state, "info", "Word gets around: a Covenant listener would like a quiet word next time you're aboard the Intrepid.");
  }
  // A few clues in, the ship's own journal starts to slip.
  if (state.clues.length === 3 && !state.futureLog) {
    state.futureLog = { t: state.time + Math.round(2.3 * YEAR), text: `Folded home and docked with the Intrepid. The Covenant was waiting at the airlock.` };
  }
  if (state.clues.length >= CLUES_FOR_FINALE && !state.awakenFinale) {
    state.awakenFinale = state.time;
    log(state, "discovery", FINALE_TEXT);
  }
  return clue;
}

export interface DossierEntry {
  clue: Clue;
  foundAt: number | null;
}

/** The dossier: every clue, found or not (unfound ones show only their hint). */
export function dossier(state: GameState): DossierEntry[] {
  const found = new Map((state.clues ?? []).map((c) => [c.id, c.t] as const));
  return CLUES.map((clue) => ({ clue, foundAt: found.get(clue.id) ?? null }));
}

/** Has the Covenant told you where the trail leads? */
export function awakenFinaleReached(state: GameState): boolean {
  return state.awakenFinale !== undefined;
}

// --- finds ------------------------------------------------------------------------------------

/** A compendium find may be evidence. Called by recordFind. */
export function noticeFind(state: GameState, kind: string, id: string): void {
  if (kind === "gem" && id === "folded-plicite") awardClue(state, "folded-plicite");
  if (kind === "flora" && id === "song-moss") awardClue(state, "song-moss");
}

/** Anomaly Theory (science): a scan sometimes shows a world tiled like a floor. One body in four. */
export function noticeScan(state: GameState, bodyId: string): void {
  if (hasPerk(state, "anomaly-theory") && rngFor(state.seed, "seams", bodyId).next() < 0.25) awardClue(state, "seams");
}

/** Sixth Sense (captain): the first look at a landing site sometimes catches a seam. One region in five. */
export function noticeLanding(state: GameState, bodyId: string, region: number): void {
  if (hasPerk(state, "sixth-sense") && rngFor(state.seed, "seams-landing", bodyId, region).next() < 0.2) awardClue(state, "seams");
}

/** Listening Post (comms): arriving at an uncharted star sometimes catches the signal. One in four. */
export function noticeArrival(state: GameState, world: World, systemId: string): void {
  const sys = world.galaxy.systems.find((s) => s.id === systemId);
  if (!sys || sys.charted) return;
  if (hasPerk(state, "listening-post") && rngFor(state.seed, "signal", systemId).next() < 0.25) awardClue(state, "signal");
}

// --- the future log ---------------------------------------------------------------------------

/** Report the impossible journal entry to the Covenant. */
export function reportFutureLog(state: GameState): Result<Clue> {
  if (!state.futureLog) return fail("Nothing in the journal looks out of place.");
  if (hasClue(state, "future-log")) return fail("The Covenant already has it.");
  const clue = awardClue(state, "future-log") as Clue;
  return ok(clue);
}

// --- errands ----------------------------------------------------------------------------------

/** Where each in-system errand points: fixed for the seed. */
export function errandTarget(state: GameState, world: World, kind: ErrandKind): string | null {
  const systems = world.galaxy.systems.filter((s) => !s.home);
  const want =
    kind === "missing-world"
      ? systems.filter((s) => s.charted && dist(s.pos, INTREPID_POS) >= 5 && dist(s.pos, INTREPID_POS) <= 14)
      : kind === "listen"
        ? systems.filter((s) => !s.charted && dist(s.pos, INTREPID_POS) >= 8 && dist(s.pos, INTREPID_POS) <= 18)
        : [];
  if (want.length === 0) return null;
  const pick = rngFor(state.seed, "errand", kind).int(0, want.length - 1);
  return (want[pick] ?? want[0])!.id;
}

export interface ErrandOffer {
  def: ErrandDef;
  title: string;
  ask: string;
  systemId: string | null;
  state: ErrandState | null;
}

function fill(text: string, world: World, systemId: string | null): string {
  const name = systemId ? (world.galaxy.systems.find((s) => s.id === systemId)?.name ?? "a far star") : "";
  return text.replaceAll("{star}", name);
}

/**
 * The Covenant's errands you can see: offered once you've enough clues (Covenant captains are
 * offered the first at once; everyone else after their first clue or a few trips), plus those
 * under way or done.
 */
export function covenantErrands(state: GameState, world: World): ErrandOffer[] {
  const clues = clueCount(state);
  const insider = state.captain.clan === "covenant";
  const out: ErrandOffer[] = [];
  for (const def of ERRANDS) {
    const st = state.errands?.[def.kind] ?? null;
    const open = def.kind === "recorder" ? insider || clues >= 1 || state.stats.folds >= 6 : clues >= def.afterClues;
    if (!st && !open) continue;
    const systemId = st?.systemId ?? errandTarget(state, world, def.kind);
    if (def.kind !== "recorder" && !systemId) continue;
    out.push({ def, title: fill(def.title, world, systemId), ask: fill(def.ask, world, systemId), systemId, state: st });
  }
  return out;
}

export function acceptErrand(state: GameState, world: World, kind: ErrandKind): Result<ErrandOffer> {
  if (state.location.kind !== "intrepid") return fail("The Covenant's listeners meet you aboard the Intrepid.");
  const offer = covenantErrands(state, world).find((o) => o.def.kind === kind);
  if (!offer) return fail("The Covenant has nothing like that for you yet.");
  if (offer.state) return fail(offer.state.status === "done" ? "Already done." : "Already under way.");
  state.errands ??= {};
  state.errands[kind] = kind === "recorder" ? { status: "active", foldsAtStart: state.stats.folds } : { status: "active", systemId: offer.systemId ?? undefined };
  log(state, "trade", `Agreed to a Covenant errand: ${offer.title}.`);
  return ok({ ...offer, state: state.errands[kind] ?? null });
}

/** Folds the recorder has seen so far. */
export function recorderFolds(state: GameState): number {
  const st = state.errands?.recorder;
  if (!st || st.status !== "active") return 0;
  return Math.min(RECORDER_FOLDS, state.stats.folds - (st.foldsAtStart ?? state.stats.folds));
}

function completeErrand(state: GameState, kind: ErrandKind): Clue | null {
  const def = ERRANDS_BY_KIND.get(kind) as ErrandDef;
  const st = state.errands?.[kind];
  if (!st || st.status !== "active") return null;
  st.status = "done";
  state.credits += def.stipend;
  state.stats.earned += def.stipend;
  bondClan(state, "covenant", 5);
  const clue = awardClue(state, def.clue);
  const covenant = CLUES_BY_ID.get(def.clue)?.covenant ?? "";
  log(state, "trade", `The Covenant pays ${def.stipend.toLocaleString()} cr for the errand. ${covenant}`);
  return clue;
}

/** Docking with the Intrepid: hand the recorder back once it has seen its folds. */
export function covenantOnDocked(state: GameState): void {
  if (state.errands?.recorder?.status === "active" && recorderFolds(state) >= RECORDER_FOLDS) completeErrand(state, "recorder");
}

/** The in-system errand that can be done here, if any (for the system view's action). */
export function errandHere(state: GameState, world: World): ErrandOffer | null {
  const loc = state.location;
  if (loc.kind !== "space") return null;
  return covenantErrands(state, world).find((o) => o.state?.status === "active" && o.systemId === loc.systemId && o.def.action) ?? null;
}

/** Do the Covenant's task in this system: search the empty orbit, or listen for the signal. */
export function doErrand(state: GameState, world: World): Result<Clue | null> {
  if (state.encounter) return fail("A raider has you under its guns.");
  const here = errandHere(state, world);
  if (!here) return fail("The Covenant has asked for nothing here.");
  advanceTime(state, (here.def.hours ?? 4) * HOUR);
  return ok(completeErrand(state, here.def.kind));
}

/**
 * Where the missing world should be, for drawing its empty lane in the system view: the widest gap
 * between neighbouring orbits (in the middle, geometrically), or just beyond the outermost world.
 */
export function ghostOrbitAU(world: World, systemId: string): number {
  const orbits = world.system(systemId).bodies.map((b) => b.orbitAU).filter((a) => a > 0).sort((a, b) => a - b);
  if (orbits.length === 0) return 1;
  let best = (orbits[orbits.length - 1] as number) * 1.6;
  let widest = 0;
  for (let i = 1; i < orbits.length; i++) {
    const lo = orbits[i - 1] as number;
    const hi = orbits[i] as number;
    if (hi / lo > widest) {
      widest = hi / lo;
      best = Math.sqrt(lo * hi);
    }
  }
  return widest >= 1.6 ? best : (orbits[orbits.length - 1] as number) * 1.6;
}
