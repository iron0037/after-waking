/** Selected-body readout: orbit summary always, full environment profile once scanned. */
import { COMMODITIES, type CommodityId } from "../../../data/commodities";
import {
  contractProgress,
  DAY,
  formatDuration,
  formatPressure,
  KIND_LABEL,
  RADIATION_LABEL,
  TECTONICS_LABEL,
  WEATHER_LABEL,
  type Body,
  type BodyProgress,
  type Contract,
  type GameState,
  type SystemDetail,
} from "../../../sim";
import { BODY_COLOR } from "../../palette";
import { pct } from "../../format";
import { fmtAU } from "./util";

const SURFACE_LABEL = { solid: "Solid", ice: "Ice crust", liquid: "Global ocean", none: "None (gaseous)" } as const;

export function orbitSummary(detail: SystemDetail, body: Body): string {
  const period = formatDuration(body.periodDays * DAY);
  if (body.parentId) {
    const parent = detail.bodies.find((b) => b.id === body.parentId);
    return `Orbits ${parent?.name ?? "its parent"} at ${fmtAU(body.orbitAU)} AU · period ${period}`;
  }
  return `Orbits ${detail.system.name} at ${fmtAU(body.orbitAU)} AU · period ${period}`;
}

export function BodyHeader({ body, detail, scanned }: { body: Body; detail: SystemDetail; scanned: boolean }) {
  return (
    <div class="sys-body-head">
      <span class="sys-swatch" style={{ background: BODY_COLOR[body.kind] }} />
      <div>
        <h2 class="sys-body-name">
          {body.name}
          {body.nickname && <span class="muted sys-nick"> · {body.nickname}</span>}
        </h2>
        <div class="muted small">
          {KIND_LABEL[body.kind]} · {body.radiusEarth.toFixed(2)} R⊕ {scanned && <span class="tag">scanned</span>}
          {body.easy && <span class="tag sys-calm-tag">calm</span>}
        </div>
      </div>
      <div class="sys-body-orbit muted small">{orbitSummary(detail, body)}</div>
    </div>
  );
}

/** How much of the world the player has covered, plus any active contract that points here. */
export function Exploration({
  state,
  progress,
  contracts,
}: {
  state: GameState;
  progress: BodyProgress;
  contracts: Contract[];
}) {
  const landed = progress.regionsVisited > 0;
  const showSurface = progress.regions > 0 && (progress.scanned || landed);
  if (!showSurface && contracts.length === 0) return null;
  return (
    <>
      <h3>Exploration</h3>
      {showSurface && (
        <dl class="kv sys-explore">
          <dt>Regions visited</dt>
          <dd class={landed ? "" : "muted"}>
            {progress.regionsVisited} / {progress.regions}
          </dd>
          <dt>Surface explored</dt>
          <dd class={landed ? "" : "muted"}>{Math.round(progress.explored * 100)}%</dd>
          <dt>Orbital survey</dt>
          <dd class={progress.surveyed ? "good" : "muted"}>{progress.surveyed ? "Done" : "Not yet"}</dd>
        </dl>
      )}
      {contracts.map((c) => {
        const p = contractProgress(state, c);
        return (
          <div key={c.id} class="sys-contract" title={c.text}>
            <span class="sys-job">◆</span> <b>{c.title}</b>
            <div class="muted small">{p.label}</div>
          </div>
        );
      })}
    </>
  );
}

export function Environment({ body }: { body: Body }) {
  const resources = (Object.entries(body.resources) as [CommodityId, number][]).sort((a, b) => b[1] - a[1]);
  const regionText = body.regions > 0 ? `${body.regions}` : "None";
  return (
    <>
      <h3>Environment</h3>
      <dl class="kv sys-env">
        <dt>Gravity</dt>
        <dd>{body.gravityG.toFixed(2)} g</dd>
        <dt>Pressure</dt>
        <dd>{formatPressure(body.pressureAtm)}</dd>
        <dt>Temperature</dt>
        <dd>{Math.round(body.tempC)} °C</dd>
        <dt>Surface</dt>
        <dd>{SURFACE_LABEL[body.surface]}</dd>
        <dt>Chemistry</dt>
        <dd class={body.chemistry === "inert" ? "" : "danger"}>{body.chemistry[0]?.toUpperCase()}{body.chemistry.slice(1)}</dd>
        <dt>Radiation</dt>
        <dd class={body.radiation >= 3 ? "danger" : ""}>{RADIATION_LABEL[body.radiation]}</dd>
        <dt>Weather</dt>
        <dd>{WEATHER_LABEL[body.weather]}</dd>
        <dt>Tectonics</dt>
        <dd>{TECTONICS_LABEL[body.tectonics]}</dd>
        <dt>Regions</dt>
        <dd>{regionText}</dd>
        <dt>Life signs</dt>
        <dd class={body.life ? "good" : "muted"}>{body.life ? "Detected" : "None detected"}</dd>
      </dl>

      <h3 class="sys-sub">Resources</h3>
      {resources.length === 0 ? (
        <div class="muted small">No mineral signatures.</div>
      ) : (
        <ul class="sys-resources">
          {resources.map(([id, abundance]) => (
            <li key={id}>
              <span class="sys-res-name">{COMMODITIES[id].name}</span>
              <div class="bar" title={`Abundance ${abundance.toFixed(2)}`}>
                <span style={{ width: `${Math.max(6, pct(abundance, 1.2))}%`, background: COMMODITIES[id].color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
