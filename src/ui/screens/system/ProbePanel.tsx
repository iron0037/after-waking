/** Atmospheric probe planner for the selected gas or ice giant (AW-16). Rules live in src/sim/probes. */
import {
  atmosphereCharted,
  atmosphereRichness,
  diveOdds,
  effectiveStats,
  isGiant,
  launchProbe,
  newReadingsFor,
  probeBlockers,
  readingsFor,
  richnessLabel,
  type Body,
} from "../../../sim";
import { DEPTHS } from "../../../data/probes";
import { cr, tonnes } from "../../format";
import type { GameSession } from "../../session";
import "../../probes.css";

export function ProbePanel({ session, body, orbiting, scanned, busy }: { session: GameSession; body: Body; orbiting: boolean; scanned: boolean; busy: boolean }) {
  const { state, world } = session;
  if (!isGiant(body)) return null;
  const stats = effectiveStats(state);

  if (stats.probeCapacity === 0) {
    return (
      <section class="probe-panel">
        <h3>Atmospheric probe</h3>
        <div class="muted small probe-teaser">
          An atmospheric probe bay (Shipyard) lets your science officer dive into giants like this for gas.
        </div>
      </section>
    );
  }

  const have = state.ship.probes ?? 0;
  // Launching dives the world the ship orbits, so for any other giant the first blocker is to get there.
  const blockers = orbiting ? probeBlockers(state, world) : [`Enter orbit around ${body.name} to launch a probe.`];
  const odds = scanned ? diveOdds(state, world, body) : [];
  const charted = atmosphereCharted(state, body.id);
  const rich = scanned && charted ? atmosphereRichness(state.seed, body) : 0;
  const profiled = readingsFor(state, body.id);

  return (
    <section class="probe-panel">
      <h3>Atmospheric probe</h3>
      <dl class="kv">
        <dt>In the bay</dt>
        <dd class={have === 0 ? "danger" : ""}>
          {have} <span class="muted">of {stats.probeCapacity}</span>
        </dd>
        <dt>Atmosphere</dt>
        <dd>
          {!scanned ? (
            <span class="muted">unscanned</span>
          ) : charted ? (
            <span title="How much gas a dive here brings back">{richnessLabel(rich)}</span>
          ) : (
            <span class="muted" title="Charted once a probe has come back from this giant">unknown</span>
          )}
        </dd>
      </dl>
      {blockers.length > 0 && (
        <ul class="blockers">
          {blockers.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {scanned && !charted && (
        <div class="muted small probe-teaser">Estimated: atmosphere uncharted until a probe returns. Hauls below assume an average giant.</div>
      )}
      {scanned && (
        <div class="probe-bands">
          {odds.map((o) => {
            const band = DEPTHS[o.depth - 1];
            if (!band) return null;
            const isProfiled = profiled.includes(o.depth);
            const fresh = newReadingsFor(state, body.id, o.depth);
            const off = o.blocked !== null || blockers.length > 0 || busy;
            return (
              <div key={o.depth} class={`probe-band ${o.blocked ? "blocked" : ""}`}>
                <div>
                  <strong>{band.name}</strong> <span class="muted small">{band.km.toLocaleString()} km</span>
                  {isProfiled && (
                    <>
                      {" "}
                      <span class="tag good" title="A probe has already profiled this band of the giant.">
                        profiled
                      </span>
                    </>
                  )}
                </div>
                <div class="small muted probe-band-stats">
                  {o.blocked ? (
                    <span class="danger">{o.blocked}</span>
                  ) : (
                    <>
                      <span title="Chance the probe is lost, before the calls made on the way down">{Math.round(o.risk * 100)}% lost</span> ·{" "}
                      <span title={o.estimated ? "A guess from an average atmosphere; the real haul is known once a probe returns" : "Expected haul at today's prices"}>
                        {o.estimated ? "est. " : ""}~{tonnes(o.tonnes)} (~{cr(o.value)})
                      </span>{" "}
                      · {o.hours} h
                      {fresh.value > 0 && (
                        <div class="probe-new accent" title={`The Lyceum pays once for each new band profiled: ${fresh.depths.length} new on the way down`}>
                          new reading: {cr(fresh.value)}
                        </div>
                      )}
                    </>
                  )}
                </div>
                <button
                  class="btn"
                  disabled={off}
                  title={o.blocked ?? blockers[0] ?? `Launch a probe to the ${band.name.toLowerCase()}`}
                  onClick={() => session.act((s, w) => launchProbe(s, w, o.depth), { timelapse: false })}
                >
                  Launch
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
