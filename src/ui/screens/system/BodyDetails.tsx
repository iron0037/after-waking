/** Selected-body readout: orbit summary always, full environment profile once scanned. */
import { COMMODITIES, type CommodityId } from "../../../data/commodities";
import type { Ratings } from "../../../data/ship";
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

/**
 * The body's conditions. Red marks exactly what stops your current ship landing (with the reason on
 * hover), so a glance tells you whether a trip there is worth it.
 */
export function Environment({ body, ratings }: { body: Body; ratings: Ratings }) {
  const resources = (Object.entries(body.resources) as [CommodityId, number][]).sort((a, b) => b[1] - a[1]);
  const regionText = body.regions > 0 ? `${body.regions}` : "None";
  const over = {
    gravity: body.gravityG > ratings.maxGravityG ? `Your thrusters lift off from up to ${ratings.maxGravityG.toFixed(1)} g.` : null,
    pressure: body.pressureAtm > ratings.maxPressureAtm ? `Your hull is rated to ${ratings.maxPressureAtm} atm.` : null,
    temp:
      body.tempC > ratings.maxTempC
        ? `Your hull is rated to ${ratings.maxTempC} °C.`
        : body.tempC < ratings.minTempC
          ? `Your hull is rated down to ${ratings.minTempC} °C.`
          : null,
    surface: body.surface === "liquid" ? "No solid ground: needs a boat." : body.surface === "none" ? "No surface to land on." : null,
    chemistry: body.chemistry === "corrosive" && !ratings.corrosionProof ? "Needs a corrosion-proof hull." : null,
    radiation: body.radiation > ratings.maxRadiation ? `Your shielding is rated to ${RADIATION_LABEL[ratings.maxRadiation]}.` : null,
  };
  const cls = (why: string | null) => (why ? "danger" : "");
  return (
    <>
      <h3>Environment</h3>
      <dl class="kv sys-env">
        <dt>Gravity</dt>
        <dd class={cls(over.gravity)} title={over.gravity ?? undefined}>
          {body.gravityG.toFixed(2)} g
        </dd>
        <dt>Pressure</dt>
        <dd class={cls(over.pressure)} title={over.pressure ?? undefined}>
          {formatPressure(body.pressureAtm)}
        </dd>
        <dt>Temperature</dt>
        <dd class={cls(over.temp)} title={over.temp ?? undefined}>
          {Math.round(body.tempC)} °C
        </dd>
        <dt>Surface</dt>
        <dd class={cls(over.surface)} title={over.surface ?? undefined}>
          {SURFACE_LABEL[body.surface]}
        </dd>
        <dt>Chemistry</dt>
        <dd class={cls(over.chemistry)} title={over.chemistry ?? undefined}>
          {body.chemistry[0]?.toUpperCase()}
          {body.chemistry.slice(1)}
        </dd>
        <dt>Radiation</dt>
        <dd class={cls(over.radiation)} title={over.radiation ?? undefined}>
          {RADIATION_LABEL[body.radiation]}
        </dd>
        <dt>Weather</dt>
        <dd>{WEATHER_LABEL[body.weather]}</dd>
        <dt>Tectonics</dt>
        <dd>{TECTONICS_LABEL[body.tectonics]}</dd>
        <dt>Regions</dt>
        <dd>{regionText}</dd>
        <dt>Life signs</dt>
        <dd class={body.life ? "good" : "muted"}>{body.life ? "Detected" : "None detected"}</dd>
      </dl>

      <h3 class="sys-sub" title="Read from orbit. Faint traces may have no seam worth digging anywhere on the surface.">
        Potential resource signatures
      </h3>
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
