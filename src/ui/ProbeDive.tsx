/**
 * The descent of an atmospheric probe (AW-16): a decision point at a time, the signal going, and the debrief.
 * Rules live in src/sim/probes; this only shows them. A dive in progress is state.probeDive, so a reload resumes it.
 */
import { FLORA_BY_NAME } from "../data/catalog";
import { COMMODITIES, GAS_IDS } from "../data/commodities";
import { currentProbeEvent, depthBand, diveDepthKm, optionHint, READING_PRICE_PER_DEPTH, sellPrice } from "../sim";
import { bandPhrase, cr, tonnes } from "./format";
import type { GameSession, ProbeReport } from "./session";
import "./probes.css";

/** What the link looks like at each stage of the descent: the first decision is early, the last is nearly blind. */
const LINK_STATUS = [
  "Link steady. Telemetry is clean.",
  "Link thinning. Packets are dropping.",
  "Link breaking up. Mostly static now.",
] as const;

const OUTCOME_TEXT: Record<ProbeReport["result"]["outcome"], { title: string; text: string; cls: string }> = {
  recovered: { title: "Probe recovered", text: "The ballast timer fired on schedule and the probe broke the cloud tops intact.", cls: "good" },
  damaged: { title: "Probe damaged", text: "It came up battered, with half its canisters cracked. Still flyable.", cls: "accent" },
  lost: { title: "Probe lost", text: "The ballast timer ran out. Nothing came up, and nothing ever will.", cls: "danger" },
};

export function ProbeDiveOverlay({ session }: { session: GameSession }) {
  const report = session.probeReport;
  if (report?.stage === "signal") return <SignalLost report={report} />;
  if (report) return <Debrief session={session} report={report} />;
  if (session.state.probeDive) return <Descent session={session} />;
  return null;
}

function Descent({ session }: { session: GameSession }) {
  const { state, world } = session;
  const dive = state.probeDive;
  const event = currentProbeEvent(state);
  if (!dive || !event) return null;
  const band = depthBand(dive.depth);
  const body = world.body(dive.bodyId).body;
  const link = LINK_STATUS[Math.min(LINK_STATUS.length - 1, Math.floor((dive.step / dive.events.length) * LINK_STATUS.length))];
  const km = diveDepthKm(dive.depth, dive.step);
  const busy = session.busy;
  return (
    <div class="overlay probe-overlay">
      <div class="probe-dive" role="dialog" aria-label="Probe descent">
        <div class="probe-kicker">Atmospheric probe · {body.name}</div>
        <div class="probe-depth">
          <strong>{band.name}</strong> <span class="muted">· about {km.toLocaleString()} km down</span>
        </div>
        <div class="probe-link small" aria-live="polite">
          {link}
        </div>
        <div class="probe-steps muted small">
          Decision {dive.step + 1} of {dive.events.length}
        </div>
        <p class="probe-event">{event.text}</p>
        <div class="probe-options">
          {event.options.map((o, i) => {
            const hint = optionHint(o);
            return (
              <button key={o.label} class="btn probe-option" disabled={busy} onClick={() => session.chooseProbe(i as 0 | 1)}>
                <span>{o.label}</span>
                {hint && <span class="probe-hint muted small">{hint}</span>}
              </button>
            );
          })}
        </div>
        {dive.choices.length > 0 && <div class="muted small probe-so-far">So far: {dive.choices.join(" · ").toLowerCase()}.</div>}
      </div>
    </div>
  );
}

function SignalLost({ report }: { report: ProbeReport }) {
  return (
    <div class="overlay probe-overlay probe-signal-stage">
      <div class="probe-dive probe-signal" role="status" aria-live="polite">
        <div class="probe-kicker">Atmospheric probe · {report.bodyName}</div>
        <p class="probe-event">Signal lost at {report.km.toLocaleString()} km. The ballast timer will bring it up if it survives…</p>
      </div>
    </div>
  );
}

function Debrief({ session, report }: { session: GameSession; report: ProbeReport }) {
  const { state } = session;
  const o = OUTCOME_TEXT[report.result.outcome];
  const rows = GAS_IDS.filter((g) => (report.result.gases[g] ?? 0) > 0).map((g) => {
    const t = report.result.gases[g] ?? 0;
    return { id: g, t, value: t * sellPrice(state.market, g) };
  });
  const totalT = rows.reduce((s, r) => s + r.t, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const fresh = report.result.newReadings;
  const freshValue = fresh.reduce((s, d) => s + READING_PRICE_PER_DEPTH * d, 0);
  const floater = report.result.floater ? FLORA_BY_NAME.get(report.result.floater) : undefined;
  return (
    <div class="overlay probe-overlay">
      <div class="probe-dive probe-debrief" role="dialog" aria-label="Probe debrief">
        <div class="probe-kicker">Atmospheric probe · {report.bodyName}</div>
        <h2 class={o.cls}>{o.title}</h2>
        <p class="small">{o.text}</p>
        <div class="muted small">
          {report.bandName}, {report.km.toLocaleString()} km · {Math.round(report.result.hours)} hours from launch to ballast
        </div>
        {rows.length > 0 ? (
          <table class="data probe-haul">
            <thead>
              <tr>
                <th>Gas recovered</th>
                <th class="num">Tonnes</th>
                <th class="num">At today's price</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span class="swatch" style={{ background: COMMODITIES[r.id].color }} />
                    {COMMODITIES[r.id].name}
                  </td>
                  <td class="num">{tonnes(r.t)}</td>
                  <td class="num">{cr(r.value)}</td>
                </tr>
              ))}
              <tr class="probe-total">
                <td>In the hold</td>
                <td class="num">{tonnes(totalT)}</td>
                <td class="num accent">{cr(totalValue)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p class="muted small">No gas came back{report.result.outcome === "lost" ? "." : ": the hold had no room for it."}</p>
        )}
        {fresh.length > 0 && (
          <p class="small probe-reading">
            Profiled {listOf(fresh.map(bandPhrase))} for the first time: the Lyceum will pay <span class="accent">{cr(freshValue)}</span>.
          </p>
        )}
        {report.result.floater && (
          <div class="probe-floater">
            <div class="probe-floater-head">
              {floater && <span class="swatch" style={{ background: floater.color }} />}
              <strong>Something alive came up: {withArticle(report.result.floater)}</strong>
            </div>
            {floater && <div class="small muted">{floater.blurb}</div>}
            {floater && floater.priceMult && (
              <div class="small">Worth about {floater.priceMult}× an ordinary plant sample at the Lyceum desk.</div>
            )}
          </div>
        )}
        {report.choices.length > 0 && (
          <div class="muted small probe-so-far">Your calls on the way down: {report.choices.map((c) => c.toLowerCase()).join(" · ")}.</div>
        )}
        <div class="btn-row probe-actions">
          <button class="btn primary" onClick={() => session.closeProbeReport()}>
            Back to the bridge
          </button>
        </div>
      </div>
    </div>
  );
}

/** "a, b and c" */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}
