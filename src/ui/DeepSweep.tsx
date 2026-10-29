/** The deep-field array's controls (AW-165): sweep the space around the ship, and see how much of the Verge has been searched. */
import { useMemo } from "preact/hooks";
import { deepScanBlockers, effectiveStats, FAINT_REACH, formatDuration, DEEP_SCAN_MINUTES, scanDeep, sweptShare } from "../sim";
import type { GameSession } from "./session";

/** "0.4%" for slivers, whole percent beyond 10. */
function shareLabel(share: number): string {
  const p = share * 100;
  if (p <= 0) return "0%";
  if (p < 0.1) return "<0.1%";
  return p < 10 ? `${p.toFixed(1)}%` : `${Math.round(p)}%`;
}

export function DeepSweepPanel({ session, busy = false }: { session: GameSession; busy?: boolean }) {
  const { state, world } = session;
  const reach = effectiveStats(state).deepScanLy;
  const scans = state.deepScans?.length ?? 0;
  const share = useMemo(() => sweptShare(state), [scans]);
  if (reach <= 0) return null;
  const blockers = deepScanBlockers(state, world);
  const sweep = () => {
    const r = session.act((s, w) => scanDeep(s, w));
    if (!r.ok) return;
    for (const site of r.value.found) session.notify(`Deep-field sweep identified: ${site.name}`, "info");
    if (r.value.faint > 0) session.notify("A faint return just beyond the array's reach: something is out there.", "info");
    if (r.value.found.length === 0 && r.value.faint === 0) session.notify("Deep-field sweep: nothing but the dark.", "info");
  };
  return (
    <section class="panel deep-sweep">
      <h3>Deep-field array</h3>
      <dl class="kv">
        <dt>Reach</dt>
        <dd>
          {reach} ly <span class="muted">· faint returns to {(reach * FAINT_REACH).toFixed(1)} ly</span>
        </dd>
        <dt>Searched</dt>
        <dd>{shareLabel(share)} of the Verge swept</dd>
      </dl>
      <button class="btn" disabled={busy || session.busy || blockers.length > 0} title={blockers.length > 0 ? blockers.join(" ") : `Sweeps ${reach} ly around the ship; takes ${formatDuration(DEEP_SCAN_MINUTES)}`} onClick={sweep}>
        Deep-field sweep (1 day)
      </button>
      {blockers.length > 0 && <p class="muted small ds-note">{blockers[0]}</p>}
    </section>
  );
}
