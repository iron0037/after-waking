/** Landing-region grid: each cell is colored by the orbital scan's signal for that region. */
import { useMemo, useState } from "preact/hooks";
import { regionKey, regionSignal, type Body, type GameState } from "../../../sim";
import { UI } from "../../palette";
import { mix, roughCredits } from "./util";

const COLS = 16;

export interface RegionPickerProps {
  body: Body;
  state: GameState;
  sensorTier: number;
  selected: number;
  onSelect: (region: number) => void;
}

export function RegionPicker({ body, state, sensorTier, selected, onSelect }: RegionPickerProps) {
  const [hover, setHover] = useState<number | null>(null);
  const seed = state.seed;

  const signals = useMemo(
    () => Array.from({ length: body.regions }, (_, r) => regionSignal(seed, body, r, sensorTier)),
    [seed, body, sensorTier],
  );
  const max = Math.max(...signals, 0);
  const min = Math.min(...signals);
  const norm = (s: number) => (max - min < 1e-6 ? 0 : (s - min) / (max - min));

  const describe = (r: number) => {
    const s = signals[r] ?? 0;
    const t = norm(s);
    const strength = s <= 0 ? "none" : t > 0.66 ? "strong" : t > 0.33 ? "moderate" : "faint";
    const visits = state.regions[regionKey(body.id, r)]?.visits ?? 0;
    const est = s > 0 ? ` (~${roughCredits(s)} cr est.)` : "";
    return `Region ${r + 1} · signal ${strength}${est}${visits > 0 ? " · visited" : ""}`;
  };

  return (
    <div class="sys-regions">
      <div class="sys-region-grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }} onMouseLeave={() => setHover(null)}>
        {signals.map((s, r) => {
          const visited = (state.regions[regionKey(body.id, r)]?.visits ?? 0) > 0;
          const cls = `sys-region${visited ? " visited" : ""}${r === selected ? " selected" : ""}`;
          return (
            <button
              key={r}
              class={cls}
              style={{ background: mix("#15213b", UI.accent, Math.pow(norm(s), 0.8)) }}
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
    </div>
  );
}

/** Index of the strongest-signal region, preferring ones not yet visited. */
export function bestRegion(state: GameState, body: Body, sensorTier: number): number {
  let best = 0;
  let bestScore = -1;
  for (let r = 0; r < body.regions; r++) {
    const visited = (state.regions[regionKey(body.id, r)]?.visits ?? 0) > 0;
    const score = regionSignal(state.seed, body, r, sensorTier) * (visited ? 0.5 : 1);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}
