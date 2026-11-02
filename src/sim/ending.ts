/**
 * Endings (AW-199) and the first of them, Return (AW-166).
 *
 * Return: find the anomaly's mouth in deep space, send a probe through it, bring its one frame home
 * to the council, then volunteer to take your ship through. The Intrepid is far too heavy to move
 * (it's about 10,000 freighters' worth of mass), so a volunteer crew goes first, and the story stops
 * at the threshold. An ending finishes the career: the save keeps its ending and a career report.
 */
import { RESEARCH } from "../data/research";
import { CLAN_NAMES, type ClanId } from "../data/ship";
import { clueCount } from "./covenant";
import { compendiumTotals } from "./compendium";
import { awardXp, levelForXp } from "./crew";
import { atEdge, siteHere } from "./deepspace";
import { effectiveStats } from "./perks";
import { changeRep, CLAN_IDS, reputation, repTier } from "./reputation";
import { fail, ok, type Result } from "./result";
import { researchStatus } from "./research";
import { advanceTime, log, type GameState } from "./state";
import { GAME_START } from "./time";
import { peopleOf, universeOf, type GameSettings } from "./settings";
import { HOUR, YEAR } from "./units";
import type { World } from "./world";

export type EndingId = "return" | "awaken";

/** What a career came to, frozen when it ends (for the ending screen and the hall of fame). */
export interface CareerReport {
  ending: EndingId;
  captain: string;
  shipName: string;
  clan: ClanId | null;
  seed: number;
  /** Game time the career ended. */
  endedAt: number;
  years: number;
  earned: number;
  tonnesMined: number;
  specimens: number;
  /** The career's new-game settings (AW-205); missing from reports made before them. */
  settings?: GameSettings;
  folds: number;
  landings: number;
  starsVisited: number;
  worldsScanned: number;
  compendium: { found: number; total: number };
  research: { done: number; total: number };
  raidersBeaten: number;
  contractsDone: number;
  clues: number;
  /** Average crew level, captain included. */
  crewLevel: number;
  /** The clan that thinks best of you. */
  bestClan: { clan: ClanId; value: number; tier: string } | null;
}

export interface EndingState {
  id: EndingId;
  t: number;
  report: CareerReport;
}

/** Credits the council awards for the anomaly report. */
export const ANOMALY_REWARD = 25_000;
/** Hours the probe dive at the mouth takes. */
export const ANOMALY_PROBE_HOURS = 6;

export function isFinished(state: GameState): boolean {
  return state.ending !== undefined;
}

// --- Return: the probe -----------------------------------------------------------------------

/** Is the ship at the anomaly's mouth? */
export function atAnomaly(state: GameState, world: World): boolean {
  return siteHere(state, world)?.kind === "anomaly";
}

/** Why a probe can't go through the mouth now (empty if it can). */
export function anomalyProbeBlockers(state: GameState, world: World): string[] {
  if (!atAnomaly(state, world)) return ["Fold to the anomaly's mouth first."];
  if (state.anomaly?.probedAt !== undefined) return ["The probe has already gone through."];
  const out: string[] = [];
  if (effectiveStats(state).probeCapacity === 0) out.push("Needs an atmospheric probe bay (Shipyard) to send a probe in.");
  else if ((state.ship.probes ?? 0) <= 0) out.push("No probes in the bay. Buy more at the Shipyard.");
  if (state.encounter) out.push("A raider has you under its guns.");
  return out;
}

/** The frame the probe sends back before its link dies. */
export const PROBE_FRAME =
  "The probe slides into the lens and its telemetry stretches, slows, then snaps back for one frame before the link dies. The navigators work on it all night. The stars in that frame are no strangers: they are the sky the Intrepid was crossing when it left the old course, thirty years ago, two-thirds of the way to Kepler-186. The way home is open.";

/** Send a probe into the mouth: it's lost, but its one frame is the proof the council needs. */
export function probeAnomaly(state: GameState, world: World): Result<string> {
  const blockers = anomalyProbeBlockers(state, world);
  if (blockers.length > 0) return fail(blockers[0] as string);
  state.ship.probes = (state.ship.probes ?? 0) - 1;
  advanceTime(state, ANOMALY_PROBE_HOURS * HOUR);
  state.anomaly = { ...state.anomaly, probedAt: state.time };
  awardXp(state, "science", 60);
  log(state, "discovery", `${PROBE_FRAME} Take it to the council aboard the Intrepid.`);
  return ok(PROBE_FRAME);
}

// --- Return: the report and the volunteers --------------------------------------------------------

export type AnomalyStage = "unknown" | "found" | "probed" | "reported";

export function anomalyStage(state: GameState): AnomalyStage {
  if (state.anomaly?.reportedAt !== undefined) return "reported";
  if (state.anomaly?.probedAt !== undefined) return "probed";
  return state.deepKnown?.anomaly === "known" ? "found" : "unknown";
}

export const COUNCIL_SCENE =
  "The council chamber is full, and so are the corridors outside it. The navigators put the probe's frame on the big screen and the room goes quiet: the old stars, the ones on the colonists' schoolroom charts. Someone starts to clap, then everyone does. The Helm's chief navigator shakes your hand for the cameras. Then the hard part: the Intrepid is ten thousand freighters' worth of mass, and no one knows what waits on the far side. Before anyone moves two million people, a small crew has to go through and come back. The council asks for volunteers.";

/** Report the probe's frame to the council: you're hailed as a hero, and they ask for volunteers. */
export function reportAnomaly(state: GameState): Result<string> {
  if (state.location.kind !== "intrepid") return fail("The council meets aboard the Intrepid.");
  if (state.anomaly?.probedAt === undefined) return fail("You need proof first: send a probe through the anomaly.");
  if (state.anomaly.reportedAt !== undefined) return fail("You've already reported it.");
  state.anomaly = { ...state.anomaly, reportedAt: state.time };
  state.credits += ANOMALY_REWARD;
  state.stats.earned += ANOMALY_REWARD;
  for (const clan of CLAN_IDS) changeRep(state, clan, 10, "Found the way home", false);
  awardXp(state, "captain", 100);
  log(state, "discovery", `${COUNCIL_SCENE} The council awards you ${ANOMALY_REWARD.toLocaleString()} cr.`);
  return ok(COUNCIL_SCENE);
}

/** Why you can't volunteer yet (empty if you can). */
export function volunteerBlockers(state: GameState): string[] {
  if (isFinished(state)) return ["This career is over."];
  if (state.anomaly?.reportedAt === undefined) return ["Report the anomaly to the council first."];
  if (state.location.kind !== "intrepid") return ["The council takes volunteers aboard the Intrepid."];
  return [];
}

/** Volunteer to fly through the anomaly. This ends the career. */
export function volunteerForAnomaly(state: GameState, world: World): Result<EndingState> {
  const blockers = volunteerBlockers(state);
  if (blockers.length > 0) return fail(blockers[0] as string);
  log(state, "travel", `${state.ship.name} departs the Intrepid for the anomaly, with every screen aboard tuned to the launch.`);
  return ok(endCareer(state, world, "return"));
}

// --- Awaken: the edge (AW-170) -------------------------------------------------------------------

/** Why you can't cross the edge (empty if you can). */
export function crossEdgeBlockers(state: GameState, world: World): string[] {
  if (isFinished(state)) return ["This career is over."];
  if (state.awakenFinale === undefined || !atEdge(state, world)) return ["There's nothing here to cross."];
  if (state.edgeSeenAt === undefined) return ["Sweep the dark here first."];
  if (state.encounter) return ["A raider has you under its guns."];
  return [];
}

/** Fly into the seam at the edge of the Verge. This ends the career. */
export function crossTheEdge(state: GameState, world: World): Result<EndingState> {
  const blockers = crossEdgeBlockers(state, world);
  if (blockers.length > 0) return fail(blockers[0] as string);
  log(state, "travel", `${state.ship.name} burns for the edge.`);
  return ok(endCareer(state, world, "awaken"));
}

// --- endings ------------------------------------------------------------------------------------

function endCareer(state: GameState, world: World, id: EndingId): EndingState {
  void world;
  const ending: EndingState = { id, t: state.time, report: careerReport(state, id) };
  state.ending = ending;
  return ending;
}

/**
 * Living specimens taken over the career. The counter arrived late (AW-199), so the sampled flora
 * sites on every region chart are a floor for older saves (AW-204).
 */
export function specimensCollected(state: GameState): number {
  const sampled = Object.values(state.regions ?? {}).reduce((n, k) => n + (k.floraSampled?.length ?? 0), 0);
  return Math.max(state.stats.specimens ?? 0, sampled);
}

/** The career so far, in numbers. */
export function careerReport(state: GameState, ending: EndingId): CareerReport {
  const crew = [state.captain, ...(state.crew ?? [])];
  const best = CLAN_IDS.map((clan) => ({ clan, value: Math.round(reputation(state, clan)) })).sort((a, b) => b.value - a.value)[0];
  return {
    ending,
    captain: state.captain.name,
    shipName: state.ship.name,
    clan: state.captain.clan ?? null,
    seed: state.seed,
    endedAt: state.time,
    years: Math.max(0, (state.time - GAME_START) / YEAR),
    earned: state.stats.earned,
    tonnesMined: state.stats.tonnesMined,
    specimens: specimensCollected(state),
    settings: { ...universeOf(state.seed), ...peopleOf(state) },
    folds: state.stats.folds,
    landings: state.stats.landings,
    starsVisited: state.visitedSystems.length,
    worldsScanned: state.scannedBodies.length,
    compendium: compendiumTotals(state).all,
    research: { done: RESEARCH.filter((p) => researchStatus(state, p.id) === "done").length, total: RESEARCH.length },
    raidersBeaten: state.stats.raidersBeaten ?? 0,
    // Older saves started counting late: the board's own record is a floor.
    contractsDone: Math.max(state.stats.contractsDone ?? 0, (state.contracts ?? []).filter((c) => c.status === "done").length),
    clues: clueCount(state),
    crewLevel: Math.round((crew.reduce((n, m) => n + levelForXp(m.xp ?? 0), 0) / Math.max(1, crew.length)) * 10) / 10,
    bestClan: best ? { ...best, tier: repTier(best.value) } : null,
  };
}

export interface EndingText {
  title: string;
  kicker: string;
  paragraphs: string[];
  /** The last line, set apart. */
  coda: string;
}

/** The ending's words. A captain who has read the Covenant's dossier sees one thing more. */
export function endingText(state: GameState, id: EndingId): EndingText {
  const ship = state.ship.name;
  const n = (state.crew ?? []).length;
  const officers = ["", "your one officer", "your two officers", "your three officers", "your four officers", "your five officers", "your six officers"][n] ?? `your ${n} officers`;
  const checklist = n === 0 ? "You ran the checklist twice, alone." : `You and ${officers} ran the checklist twice. Nobody said much.`;
  const covenant = clueCount(state) >= 3;
  if (id === "return") {
    return {
      title: "Return",
      kicker: "The way home",
      paragraphs: [
        `They gave ${ship} a new paint job, a hold full of spare probes, and a send-off from every deck of the Intrepid. Two million people watched the launch, and some of them were still awake when the fold flash faded.`,
        `At the mouth, the lens turned slowly against the stars, the way it had the day you found it. ${checklist}`,
        "On the far side, if the probe's frame was true, waits the sky of the old course and the long road to Kepler-186, and perhaps a way to the Earth they all left behind. Perhaps something else.",
        "The council's plan was simple: go through, look, come back, and tell them what you saw.",
      ],
      coda: covenant
        ? "In the Covenant's listening room, the eldest listener watched your drive flare vanish into the lens and closed your dossier. \"They'll wake up now,\" she said. \"Or we will.\""
        : `${ship} crossed the threshold at 04:12, ship's time. The Intrepid is still listening.`,
    };
  }
  // Awaken: the seam opens, and the captain wakes where they have always been.
  const years = Math.round((state.time - GAME_START) / YEAR);
  return {
    title: "Awaken",
    kicker: "The edge of the Verge",
    paragraphs: [
      `Nobody aboard ${ship} said what they were all thinking. You took her in slowly, a hand on the throttle, the stars ending in a straight line ahead of you like the edge of a page.`,
      "There was no impact. The hull, the cabin, the hum of the drive went out the way a room goes out when you close your eyes.",
      "Cold. Glass, frosted from the inside. A hiss of gas, and a lid that lifts. Above you a status panel blinks in an old typeface: ISS INTREPID · CRYOSTASIS · VOYAGE YEAR 2,686 OF 3,900.",
      `Beyond the viewport the stars are the right ones, the ones on the old charts. The pods stretch away down the deck in their thousands, every face inside asleep and dreaming. Somewhere among them is your crew. Somewhere in there, ${years > 0 ? `${years} years` : "a lifetime"} of folds and landings and debts is still going on without you.`,
      "The panel blinks again. SESSION ENDED. RESUME?",
    ],
    coda: "You could go back to sleep. Or you could start waking the others.",
  };
}

/** A clan's name, for the report. */
export function clanLabel(clan: ClanId | null): string {
  return clan ? CLAN_NAMES[clan] : "No clan";
}
