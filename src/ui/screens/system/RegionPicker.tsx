/** Landing-region grid: each cell is colored by the orbital scan's signal for that region. */
import { useMemo, useState } from "preact/hooks";
import { exploredFraction, regionKey, regionRecap, regionSignal, type Body, type GameState, type World } from "../../../sim";
import { UI } from "../../palette";
import { mix, roughCredits } from "./util";

const COLS = 16;

export interface RegionPickerProps {
  body: Body;
  state: GameState;
  world: World;
  sensorTier: number;
  /** Drill reach in metres: tier 2+ sensors count only seams within it. */
  reachM: number;
  selected: number;
  onSelect: (region: number) => void;
}

export function RegionPicker({ body, state, world, sensorTier, reachM, selected, onSelect }: RegionPickerProps) {
  const [hover, setHover] = useState<number | null>(null);
  const seed = state.seed;

  const signals = useMemo(
    () => Array.from({ length: body.regions }, (_, r) => regionSignal(seed, body, r, sensorTier, reachM)),
    [seed, body, sensorTier, reachM],
  );
  const max = Math.max(...signals, 0);
  const min = Math.min(...signals);
  const norm = (s: number) => (max - min < 1e-6 ? 0 : (s - min) / (max - min));

  const describe = (r: number) => {
    const s = signals[r] ?? 0;
    const t = norm(s);
    const strength = s <= 0 ? "none" : t > 0.66 ? "strong" : t > 0.33 ? "moderate" : "faint";
    const know = state.regions[regionKey(body.id, r)];
    const visits = know?.visits ?? 0;
    const est = s > 0 ? ` (~${roughCredits(s)} cr est.)` : "";
    const seen = visits > 0 ? ` · visited, ${Math.round(exploredFraction(know) * 100)}% explored` : "";
    return `Region ${r + 1} · signal ${strength}${est}${seen}`;
  };

  return (
    <div class="sys-regions">
      <div class="sys-region-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }} onMouseLeave={() => setHover(null)}>
        {signals.map((s, r) => {
          const know = state.regions[regionKey(body.id, r)];
          const visited = (know?.visits ?? 0) > 0;
          const explored = visited ? exploredFraction(know) : 0;
          const cls = `sys-region${visited ? " visited" : ""}${r === selected ? " selected" : ""}`;
          return (
            <button
              key={r}
              class={cls}
              style={{
                backgroundColor: mix("#15213b", UI.accent, Math.pow(norm(s), 0.8)),
                backgroundImage: explored > 0 ? `linear-gradient(${UI.cyan}, ${UI.cyan})` : undefined,
                backgroundSize: explored > 0 ? `${Math.max(12, explored * 100)}% 3px` : undefined,
                backgroundPosition: "left bottom",
                backgroundRepeat: "no-repeat",
              }}
              onMouseEnter={() => setHover(r)}
              onClick={() => onSelect(r)}
              aria-label={describe(r)}
            />
          );
        })}
      </div>
      <div class="sys-region-readout small">{describe(hover ?? selected)}</div>
      <div class="sys-region-legend small muted">
        <span>faint</span>
        <span class="sys-region-ramp" />
        <span>strong</span>
        <span class="sys-region-key">
          <span class="sys-region visited" /> visited
        </span>
      </div>
      <RegionRecapBox state={state} world={world} bodyId={body.id} region={selected} />
    </div>
  );
}

/** "You've been here before": what's already known about the selected region. */
function RegionRecapBox({ state, world, bodyId, region }: { state: GameState; world: World; bodyId: string; region: number }) {
  const recap = regionRecap(state, world, bodyId, region);
  if (!recap) return null;
  const worked = recap.reachableTonnes <= 0 && recap.floraUnsampled === 0 && recap.explored > 0.5;
  return (
    <div class="sys-recap small">
      You've landed here before ({recap.visits}×): {Math.round(recap.explored * 100)}% explored · {recap.depositsKnown}{" "}
      {recap.depositsKnown === 1 ? "deposit" : "deposits"} known · {Math.round(recap.reachableTonnes).toLocaleString()} t reachable left
      {recap.floraUnsampled > 0 && (
        <>
          {" "}
          · {recap.floraUnsampled} flora {recap.floraUnsampled === 1 ? "site" : "sites"} unsampled
        </>
      )}
      {worked && <div class="accent sys-recap-warn">Looks worked out — try a fresh region.</div>}
    </div>
  );
}

/** Index of the strongest-signal region, preferring ones not yet visited. */
export function bestRegion(state: GameState, body: Body, sensorTier: number, reachM: number): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < body.regions; r++) {
    const visited = (state.regions[regionKey(body.id, r)]?.visits ?? 0) > 0;
    const score = regionSignal(state.seed, body, r, sensorTier, reachM) * (visited ? 0.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
