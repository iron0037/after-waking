/**
 * Endings (AW-199): the council's summons on the Intrepid, the probe at the anomaly's mouth, the
 * ending screen with its career report, and the hall of fame kept in browser storage.
 */
import { useEffect, useState } from "preact/hooks";
import { CLAN_NAMES } from "../data/ship";
import {
  ANOMALY_PROBE_HOURS,
  COUNCIL_SCENE,
  PROBE_FRAME,
  ANOMALY_REWARD,
  anomalyProbeBlockers,
  anomalyStage,
  atAnomaly,
  captainTitle,
  clanLabel,
  crossEdgeBlockers,
  crossTheEdge,
  atEdge,
  endingText,
  formatDate,
  probeAnomaly,
  reportAnomaly,
  volunteerBlockers,
  volunteerForAnomaly,
  type CareerReport,
  type EndingId,
} from "../sim";
import { cr } from "./format";
import "./ending.css";
import type { GameSession } from "./session";

// --- the hall of fame ---------------------------------------------------------------------------

const HALL_KEY = "after-waking-hall-of-fame";

export interface HallEntry {
  report: CareerReport;
  /** Real-world date the career ended, ISO. */
  finishedOn: string;
}

export function readHall(): HallEntry[] {
  try {
    const raw = localStorage.getItem(HALL_KEY);
    const list = raw ? (JSON.parse(raw) as HallEntry[]) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const sameCareer = (a: CareerReport, b: CareerReport) => a.seed === b.seed && a.endedAt === b.endedAt && a.captain === b.captain;

/** Add a finished career to the hall (once; a corrected report replaces the old one). */
export function enterHall(report: CareerReport): void {
  try {
    const list = readHall();
    const old = list.find((e) => sameCareer(e.report, report));
    if (old) {
      if (JSON.stringify(old.report) === JSON.stringify(report)) return;
      old.report = report;
    } else list.push({ report, finishedOn: new Date().toISOString() });
    localStorage.setItem(HALL_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable: the ending still shows, it just isn't remembered */
  }
}

const ENDING_NAMES: Record<EndingId, string> = { return: "Return", awaken: "Awaken" };
const ENDING_ART: Record<EndingId, string> = { return: "./assets/ending-return.png", awaken: "./assets/ending-awaken.png" };

// --- the anomaly, on the star map -----------------------------------------------------------------

/** At the anomaly's mouth: send a probe through. */
export function AnomalyPanel({ session }: { session: GameSession }) {
  const { state, world } = session;
  if (!atAnomaly(state, world)) return null;
  const stage = anomalyStage(state);
  const blockers = anomalyProbeBlockers(state, world);
  return (
    <section class="panel anomaly-panel">
      <h3>The anomaly's mouth</h3>
      {stage === "found" ? (
        <>
          <p class="small">
            The council will want proof before anyone risks a ship. A probe sent into the lens might get one frame back before its link dies.
          </p>
          <button
            class="btn primary"
            disabled={session.busy || blockers.length > 0}
            title={blockers[0] ?? `Spends a probe; takes ${ANOMALY_PROBE_HOURS} hours`}
            onClick={() => session.act((s, w) => probeAnomaly(s, w))}
          >
            Send a probe through
          </button>
          {blockers.length > 0 && <p class="muted small">{blockers[0]}</p>}
        </>
      ) : (
        <>
          <p class="small">{PROBE_FRAME}</p>
          <p class="small accent">Take the frame to the council aboard the Intrepid.</p>
        </>
      )}
    </section>
  );
}

/** At the edge of the Verge, with the Covenant's dossier complete: sweep, then cross (AW-170). */
export function EdgePanel({ session }: { session: GameSession }) {
  const { state, world } = session;
  const [confirming, setConfirming] = useState(false);
  if (state.awakenFinale === undefined || !atEdge(state, world)) return null;
  const blockers = crossEdgeBlockers(state, world);
  return (
    <section class="panel edge-panel">
      <h3>The edge</h3>
      {state.edgeSeenAt === undefined ? (
        <p class="small">Past the last star of the Verge, where the Covenant's listeners hear nothing at all. Sweep the dark here and see what the array makes of it.</p>
      ) : confirming ? (
        <>
          <p class="small">
            <strong class="accent">This ends your career.</strong> There is no plotting a fold back from whatever is on the other side. The game ends with your
            career report and a place in the hall of fame.
          </p>
          <div class="btn-row">
            <button class="btn danger" onClick={() => session.act((s, w) => crossTheEdge(s, w), { timelapse: false })}>
              Cross the edge
            </button>
            <button class="btn" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="small">Ahead, the stars stop along a line. It looks like a seam.</p>
          <button class="btn primary" disabled={blockers.length > 0} title={blockers[0]} onClick={() => setConfirming(true)}>
            Fly into the seam
          </button>
        </>
      )}
    </section>
  );
}

// --- the council, on the Intrepid -------------------------------------------------------------

/** The council's summons: report the probe's frame, then volunteer. Shown at the top of the Intrepid. */
export function CouncilPanel({ session }: { session: GameSession }) {
  const { state } = session;
  const stage = anomalyStage(state);
  const [confirming, setConfirming] = useState(false);
  if (stage !== "probed" && stage !== "reported") return null;
  const blockers = volunteerBlockers(state);
  return (
    <section class="panel council-panel">
      <h3>The council</h3>
      {stage === "probed" ? (
        <>
          <p class="small">Word of the probe's frame has run ahead of you. The council is sitting tonight, and the chamber has been cleared for you.</p>
          <button class="btn primary" onClick={() => session.act((s) => reportAnomaly(s), { timelapse: false })}>
            Report the anomaly to the council
          </button>
          <span class="muted small"> The council's reward: {cr(ANOMALY_REWARD)}</span>
        </>
      ) : confirming ? (
        <div class="council-confirm">
          <p class="small">
            <strong class="accent">This ends your career.</strong> {state.ship.name} and its crew fly into the anomaly, and the game ends with your
            career report and a place in the hall of fame. The save can show the ending again but can't be played on.
          </p>
          <div class="btn-row">
            <button class="btn danger" onClick={() => session.act((s, w) => volunteerForAnomaly(s, w), { timelapse: false })}>
              Fly through the anomaly
            </button>
            <button class="btn" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        </div>
      ) : (
        <>
          <p class="small council-scene">{COUNCIL_SCENE}</p>
          <p class="small muted">Nobody has stepped forward yet. Take all the time you need to get ready.</p>
          <button class="btn primary" disabled={blockers.length > 0} title={blockers[0]} onClick={() => setConfirming(true)}>
            Volunteer to fly through
          </button>
        </>
      )}
    </section>
  );
}

// --- the ending screen ----------------------------------------------------------------------------

function years(n: number): string {
  return n < 1 ? `${Math.max(1, Math.round(n * 12))} months` : `${n.toFixed(1)} years`;
}

/** The career report as label/value rows. */
function reportRows(r: CareerReport): [string, string][] {
  return [
    ["Career", years(r.years)],
    ["Credits earned", cr(r.earned)],
    ["Ore mined", `${Math.round(r.tonnesMined).toLocaleString()} t`],
    ["Specimens collected", r.specimens.toLocaleString()],
    ["Compendium", `${r.compendium.found} of ${r.compendium.total}`],
    ["Stars visited", r.starsVisited.toLocaleString()],
    ["Worlds scanned", r.worldsScanned.toLocaleString()],
    ["Landings", r.landings.toLocaleString()],
    ["Folds", r.folds.toLocaleString()],
    ["Contracts fulfilled", r.contractsDone.toLocaleString()],
    ["Raiders beaten", r.raidersBeaten.toLocaleString()],
    ["Research projects", `${r.research.done} of ${r.research.total}`],
    ["Crew level (average)", r.crewLevel.toFixed(1)],
    ...(r.clues > 0 ? ([["Covenant dossier", `${r.clues} of 7`]] as [string, string][]) : []),
    ...(r.bestClan ? ([["Closest clan", `${CLAN_NAMES[r.bestClan.clan]} (${r.bestClan.tier})`]] as [string, string][]) : []),
  ];
}

/** The career is over: the ending's art and words, then the report. */
export function EndingScreen({ session, onTitle }: { session: GameSession; onTitle: () => void }) {
  const ending = session.state.ending;
  const [showReport, setShowReport] = useState(false);
  useEffect(() => {
    if (ending) enterHall(ending.report);
  }, [ending]);
  if (!ending) return null;
  const text = endingText(session.state, ending.id);
  const r = ending.report;
  return (
    <div class="ending-screen">
      <div class="ending-card">
        <img class="ending-art" src={ENDING_ART[ending.id]} alt="" />
        <div class="ending-kicker">{text.kicker}</div>
        <h1 class="ending-title">{text.title}</h1>
        {!showReport ? (
          <>
            <div class="ending-text">
              {text.paragraphs.map((p, i) => (
                <p key={i} style={{ animationDelay: `${0.6 + i * 1.4}s` }}>
                  {p}
                </p>
              ))}
              <p class="ending-coda" style={{ animationDelay: `${0.6 + text.paragraphs.length * 1.4 + 0.8}s` }}>
                {text.coda}
              </p>
            </div>
            <div class="btn-row ending-actions">
              <button class="btn primary big" onClick={() => setShowReport(true)}>
                Career report ▸
              </button>
            </div>
          </>
        ) : (
          <>
            <div class="ending-who">
              {captainTitle(r.captain)} of the {r.shipName} · {clanLabel(r.clan)} · ended {formatDate(r.endedAt)}
            </div>
            <dl class="ending-report">
              {reportRows(r).map(([k, v]) => (
                <div key={k} class="ending-stat">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p class="muted small">This career has been entered in the hall of fame.</p>
            <div class="btn-row ending-actions">
              <button class="btn" onClick={() => setShowReport(false)}>
                ◂ The ending
              </button>
              <button class="btn primary big" onClick={onTitle}>
                Title screen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Every finished career on this browser, newest first. */
export function HallOfFame({ onBack }: { onBack: () => void }) {
  const hall = readHall().slice().reverse();
  return (
    <div class="title-screen">
      <div class="title-card title-menu hall">
        <h2>Hall of fame</h2>
        {hall.length === 0 ? (
          <p class="muted">No finished careers yet. Find a way to end the story, and your captain's record will be kept here.</p>
        ) : (
          <div class="hall-scroll">
          <table class="data hall-table">
            <thead>
              <tr>
                <th>Captain</th>
                <th>Ending</th>
                <th class="num">Years</th>
                <th class="num">Earned</th>
                <th class="num">Ore</th>
                <th class="num">Specimens</th>
                <th class="num">Stars</th>
                <th class="num">Compendium</th>
              </tr>
            </thead>
            <tbody>
              {hall.map((e, i) => (
                <tr key={i} title={`Seed ${e.report.seed} · finished ${new Date(e.finishedOn).toLocaleDateString()}`}>
                  <td>
                    {captainTitle(e.report.captain)} <span class="muted small">· {e.report.shipName}</span>
                  </td>
                  <td class="accent">{ENDING_NAMES[e.report.ending] ?? e.report.ending}</td>
                  <td class="num">{e.report.years.toFixed(1)}</td>
                  <td class="num">{cr(e.report.earned)}</td>
                  <td class="num">{Math.round(e.report.tonnesMined).toLocaleString()} t</td>
                  <td class="num">{e.report.specimens}</td>
                  <td class="num">{e.report.starsVisited}</td>
                  <td class="num">
                    {e.report.compendium.found}/{e.report.compendium.total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        <div class="title-buttons">
          <button class="btn big" onClick={onBack}>
            Back
          </button>
        </div>
      </div>
    </div>
  );
}
