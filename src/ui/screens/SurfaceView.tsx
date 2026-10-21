/** Planet surface: a survey map of one region, the rover, and the prospect → drill → haul loop. */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { COMMODITIES } from "../../data/commodities";
import {
  cargoTonnes,
  currentRegion,
  deployRover,
  DRILL_ENERGY_PER_HOUR,
  DRILL_SETUP_ENERGY,
  DRILL_SETUP_MINUTES,
  drill,
  formatDuration,
  formatPressure,
  HOUR,
  KIND_LABEL,
  knowledge,
  launch,
  moveRoverTo,
  PROSPECT_ENERGY,
  PROSPECT_MINUTES,
  prospect,
  RECALL_FUEL,
  recallRover,
  remainingTonnes,
  shipStats,
  stowRover,
  Terrain,
  TERRAIN_INFO,
  type Deposit,
  type GameState,
  type Location,
  type PathStep,
  type RegionKnowledge,
  type RegionMap,
  type RoverState,
  type Vec2,
} from "../../sim";
import { cargoList, pct, tonnes } from "../format";
import { TERRAIN_COLORS, UI } from "../palette";
import { useSession, type GameSession } from "../session";
import { Canvas } from "../Canvas";
import {
  computeLayout,
  drawBase,
  drawDeposits,
  drawHoverTile,
  drawRoute,
  drawRover,
  drawSensorRange,
  drawShip,
  drawTooltip,
  tileAt,
  type Layout,
  type TipLine,
} from "./surface/mapDraw";
import { affordablePrefix, chebyshev, energyHome, evaluate, planPath, type RoutePlan } from "./surface/routing";
import { buildTerrainImage } from "./surface/terrainImage";
import "./surface.css";

type SurfaceLoc = Extract<Location, { kind: "surface" }>;

/** Milliseconds of animation per tile driven. */
const STEP_MS = 70;

interface Anim {
  pts: Vec2[];
  t0: number;
}

interface Hover {
  tile: Vec2;
  px: number;
  py: number;
}

export function SurfaceView({ session }: { session: GameSession }) {
  useSession(session);
  const loc = session.state.location;
  if (loc.kind !== "surface") return <div class="full panel muted">Not on a surface.</div>;
  return <Surface session={session} loc={loc} />;
}

function depositStatus(know: RegionKnowledge, d: Deposit): "depleted" | "prospected" | "new" {
  if (remainingTonnes(know, d) <= 0.05) return "depleted";
  return know.prospected.includes(d.id) ? "prospected" : "new";
}

function Surface({ session, loc }: { session: GameSession; loc: SurfaceLoc }) {
  const { state, world } = session;
  const { body } = world.body(loc.bodyId);
  const map = currentRegion(state, world) as RegionMap;
  const know = knowledge(state, loc.bodyId, loc.region);
  const stats = shipStats(state.ship);
  const rover = loc.rover;
  const busy = session.busy;
  const canClimb = stats.roverCanClimb;

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const animRef = useRef<Anim | null>(null);
  const hoverRef = useRef<Hover | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const routeRef = useRef<{ key: string; plan: RoutePlan | null }>({ key: "", plan: null });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (animRef.current) {
        animRef.current = null;
        session.setBusy(false);
      }
    };
  }, [session]);

  const terrainImg = useMemo(() => buildTerrainImage(map, body.kind), [map, body.kind]);

  const discovered = map.deposits.filter((d) => know.discovered.includes(d.id));
  const selected = discovered.find((d) => d.id === selectedId) ?? null;
  const depositAt = (t: Vec2): Deposit | undefined => discovered.find((d) => d.x === t.x && d.y === t.y);

  const homeEnergy = rover ? energyHome(map, rover, canClimb) : null;
  const stranded = rover !== null && (homeEnergy === null || homeEnergy > rover.energy);

  // --- driving ---------------------------------------------------------------------------

  const drive = async (path: PathStep[]): Promise<void> => {
    if (!rover || session.busy || path.length === 0) return;
    const steps = affordablePrefix(path, rover.energy);
    if (steps.length === 0) {
      session.notify("Rover energy is too low to move.", "error");
      return;
    }
    const pts: Vec2[] = [{ x: rover.x, y: rover.y }, ...steps];
    animRef.current = { pts, t0: performance.now() };
    hoverRef.current = null;
    session.setBusy(true);
    await new Promise<void>((resolve) => setTimeout(resolve, steps.length * STEP_MS + 40));
    if (!aliveRef.current) return;
    animRef.current = null;
    const last = pts[pts.length - 1] as Vec2;
    const result = session.act((s, w) => moveRoverTo(s, w, last.x, last.y));
    session.setBusy(false);
    if (result.ok && (result.value.stopped || steps.length < path.length)) {
      session.notify("Rover energy ran out before it reached the target.", "error");
    }
  };

  const driveTo = (target: Vec2, approach: boolean): void => {
    if (!rover || session.busy) return;
    if (rover.x === target.x && rover.y === target.y) return;
    if (approach && chebyshev(rover, target) <= 1) return;
    const path = planPath(map, rover, target, canClimb, approach);
    if (!path) {
      session.notify("No route there for this rover.", "error");
      return;
    }
    void drive(path);
  };

  // --- map -------------------------------------------------------------------------------

  const hoverPlan = (tile: Vec2): RoutePlan | null => {
    if (!rover) return null;
    const key = `${rover.x},${rover.y},${tile.x},${tile.y},${rover.energy}`;
    if (routeRef.current.key === key) return routeRef.current.plan;
    const dep = depositAt(tile);
    const inRange = chebyshev(rover, tile) <= (dep ? 1 : 0);
    const path = inRange ? null : planPath(map, rover, tile, canClimb, dep !== undefined);
    const plan = path && path.length > 0 ? evaluate(map, path, rover, canClimb) : null;
    routeRef.current = { key, plan };
    return plan;
  };

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    const L = computeLayout(w, h, map.width, map.height);
    layoutRef.current = L;
    drawBase(ctx, w, h, L, terrainImg);

    // Where the rover is drawn: mid-drive it slides along the path.
    let pos: Vec2 | null = rover ? { x: rover.x, y: rover.y } : null;
    const anim = animRef.current;
    if (anim) {
      const p = Math.min(anim.pts.length - 1, Math.max(0, (t - anim.t0) / STEP_MS));
      const i = Math.floor(p);
      const a = anim.pts[i] as Vec2;
      const b = anim.pts[Math.min(anim.pts.length - 1, i + 1)] as Vec2;
      pos = { x: a.x + (b.x - a.x) * (p - i), y: a.y + (b.y - a.y) * (p - i) };
    }

    if (pos) drawSensorRange(ctx, L, { x: Math.round(pos.x), y: Math.round(pos.y) }, 2 + stats.sensorTier);
    drawShip(ctx, L, map.landing);
    drawDeposits(ctx, L, map, know, selected?.id ?? null, t);

    // hover: route preview and tooltip
    const hover = anim ? null : hoverRef.current;
    if (hover && rover) {
      const plan = hoverPlan(hover.tile);
      if (plan) {
        const short = plan.energy > rover.energy;
        const strands = plan.back === null || plan.energy + plan.back > rover.energy;
        drawRoute(ctx, L, rover, plan.path, short || strands ? UI.danger : UI.good, null);
      }
    }
    if (anim) {
      const rest = anim.pts.slice(1).map((p) => ({ ...p, minutes: 0, energy: 0 }));
      drawRoute(ctx, L, anim.pts[0] as Vec2, rest, "rgba(95, 212, 255, 0.8)", null);
    }
    if (hover) drawHoverTile(ctx, L, hover.tile);

    if (pos && rover) {
      const onPad = Math.round(pos.x) === map.landing.x && Math.round(pos.y) === map.landing.y;
      drawRover(ctx, L, pos, t, onPad);
    }

    if (hover) drawTooltip(ctx, w, h, hover.px, hover.py, tooltipLines(hover.tile));
  };

  const tooltipLines = (tile: Vec2): TipLine[] => {
    const lines: TipLine[] = [];
    const terrain = map.terrain[tile.y * map.width + tile.x] as Terrain;
    const info = TERRAIN_INFO[terrain];
    const isShip = tile.x === map.landing.x && tile.y === map.landing.y;
    const needsClimber = info.passable === "climb" && !canClimb;
    lines.push({ text: isShip ? `${info.name} · landing pad` : info.name, color: UI.text });
    const dep = depositAt(tile);
    if (dep) {
      const status = depositStatus(know, dep);
      lines.push({
        text: `${COMMODITIES[dep.commodity].name} · ${status === "new" ? "unsurveyed" : status === "depleted" ? "worked out" : `${Math.round(dep.grade * 100)}%`}`,
        color: COMMODITIES[dep.commodity].color,
      });
    }
    if (info.passable === "no") {
      lines.push({ text: "Impassable", color: UI.muted });
    } else if (needsClimber) {
      lines.push({ text: "Rover can't climb this", color: UI.muted });
    } else if (!rover) {
      lines.push({ text: "Deploy the rover to drive", color: UI.muted });
    } else {
      const plan = hoverPlan(tile);
      if (plan) {
        const bad = plan.energy > rover.energy;
        const strands = plan.back === null || plan.energy + plan.back > rover.energy;
        lines.push({
          text: `Drive ${formatDuration(plan.minutes)} · ${plan.energy.toFixed(1)} energy`,
          color: bad || strands ? UI.danger : UI.good,
        });
        if (bad) lines.push({ text: "Not enough energy", color: UI.danger });
        else if (strands) lines.push({ text: "Too far to return to ship", color: UI.danger });
      } else if (dep && chebyshev(rover, tile) <= 1) {
        lines.push({ text: "Rover is in range", color: UI.good });
      } else if (!(rover.x === tile.x && rover.y === tile.y)) {
        lines.push({ text: "No route", color: UI.danger });
      }
    }
    return lines;
  };

  const onMove = (px: number, py: number): void => {
    const L = layoutRef.current;
    const tile = L ? tileAt(L, px, py) : null;
    hoverRef.current = tile ? { tile, px, py } : null;
  };

  const onClick = (px: number, py: number): void => {
    const L = layoutRef.current;
    const tile = L ? tileAt(L, px, py) : null;
    if (!tile || session.busy) return;
    const dep = depositAt(tile);
    if (dep) setSelectedId(dep.id);
    driveTo(tile, dep !== undefined);
  };

  const present = ([...new Set(map.terrain)] as Terrain[]).sort((a, b) => a - b);

  return (
    <>
      <div class="viewport">
        <Canvas draw={draw} onClick={onClick} onMove={onMove} onLeave={() => (hoverRef.current = null)} animate />
        <div class="viewport-hint">{rover ? "Click to drive · Hover for route cost" : "Deploy the rover to explore · Hover for terrain"}</div>
        <div class="surface-legend">
          {present.map((t) => (
            <span key={t} class="legend-item">
              <i style={{ background: TERRAIN_COLORS[body.kind][t] }} />
              {TERRAIN_INFO[t].name}
              {TERRAIN_INFO[t].passable === "climb" && !canClimb ? " ✕" : ""}
            </span>
          ))}
        </div>
      </div>
      <aside class="side surface-side">
        <div class="panel">
          <h2>{body.name}</h2>
          <div class="muted small">
            Region {loc.region + 1} of {body.regions} · {KIND_LABEL[body.kind]}
          </div>
          <div class="small">
            {Math.round(body.tempC)} °C · {body.gravityG.toFixed(2)} g · {formatPressure(body.pressureAtm)}
          </div>
        </div>

        <RoverPanel rover={rover} stats={stats} homeEnergy={homeEnergy} stranded={stranded} state={state} />

        {selected ? (
          <DepositPanel
            session={session}
            dep={selected}
            know={know}
            rover={rover}
            drive={() => driveTo(selected, true)}
            busy={busy}
          />
        ) : (
          <div class="panel muted small">
            {discovered.length > 0
              ? "Select a deposit on the map or in the list."
              : rover
                ? "No deposits detected yet. Drive the rover around the region to sweep with its sensors."
                : "Deploy the rover to start surveying."}
          </div>
        )}

        {discovered.length > 0 && (
          <div class="panel">
            <h3>Deposits found</h3>
            <table class="data deposit-table">
              <thead>
                <tr>
                  <th>Commodity</th>
                  <th class="num">Dist</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {discovered
                  .map((d) => ({ d, dist: chebyshev(rover ?? map.landing, d) }))
                  .sort((a, b) => a.dist - b.dist)
                  .map(({ d, dist }) => {
                    const status = depositStatus(know, d);
                    return (
                      <tr
                        key={d.id}
                        class={`${d.id === selected?.id ? "sel" : ""} ${status === "depleted" ? "dim" : ""}`}
                        onClick={() => setSelectedId(d.id)}
                      >
                        <td>
                          <i class="swatch" style={{ background: status === "depleted" ? "#5b6472" : COMMODITIES[d.commodity].color }} />
                          {COMMODITIES[d.commodity].name}
                        </td>
                        <td class="num">{dist}</td>
                        <td>
                          {status === "new" && <span class="tag new">new</span>}
                          {status === "prospected" && <span class="tag">{Math.round(d.grade * 100)}%</span>}
                          {status === "depleted" && <span class="muted">depleted</span>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            <div class="muted small tbl-note">Distance in tiles from {rover ? "the rover" : "the ship"}.</div>
          </div>
        )}

        <div class="panel">
          <h3>Actions</h3>
          <div class="btn-row">
            {!rover && (
              <button class="btn" disabled={busy} onClick={() => session.act((s, w) => deployRover(s, w))}>
                Deploy rover
              </button>
            )}
            {rover && (
              <>
                <button
                  class="btn"
                  disabled={busy || (rover.x === map.landing.x && rover.y === map.landing.y)}
                  onClick={() => driveTo(map.landing, false)}
                >
                  Return to ship
                </button>
                <button
                  class="btn"
                  disabled={busy || chebyshev(rover, map.landing) > 1}
                  title={chebyshev(rover, map.landing) > 1 ? "Drive the rover back to the ship first" : "Unloads the cargo bed and recharges (30 min)"}
                  onClick={() => {
                    const r = session.act((s, w) => stowRover(s, w));
                    if (r.ok) {
                      setSelectedId(null);
                      const { unloaded, jettisoned } = r.value;
                      session.notify(
                        `Unloaded ${tonnes(unloaded)} into the hold.${jettisoned > 0.05 ? ` ${tonnes(jettisoned)} left behind: hold full.` : ""}`,
                      );
                    }
                  }}
                >
                  Stow rover &amp; unload
                </button>
              </>
            )}
            {stranded && (
              <button
                class="btn danger"
                disabled={busy || state.ship.fuel < RECALL_FUEL}
                title={`The ship hops over and winches the rover aboard: ${RECALL_FUEL} fuel and 3 h`}
                onClick={() => session.act((s, w) => recallRover(s, w))}
              >
                Recall rover
              </button>
            )}
          </div>
          {stranded && (
            <p class="muted small act-note">
              The rover can't drive home on its remaining energy. Recall costs {RECALL_FUEL} fuel and 3 h.
            </p>
          )}
          <button
            class="btn primary big launch"
            disabled={busy || rover !== null}
            onClick={() => session.act((s, w) => launch(s, w))}
          >
            Launch
          </button>
          {rover && <p class="muted small act-note">Stow the rover before launching.</p>}
        </div>
      </aside>
    </>
  );
}

function RoverPanel({
  rover,
  stats,
  homeEnergy,
  stranded,
  state,
}: {
  rover: RoverState | null;
  stats: ReturnType<typeof shipStats>;
  homeEnergy: number | null;
  stranded: boolean;
  state: GameState;
}) {
  const hold = cargoTonnes(state.ship.cargo);
  const fuelPct = pct(state.ship.fuel, stats.fuelCapacity);
  const energyLow = rover !== null && (stranded || rover.energy < stats.roverEnergy * 0.3);
  const tight = rover !== null && !stranded && homeEnergy !== null && rover.energy < homeEnergy * 1.3;
  const bedT = rover ? cargoTonnes(rover.cargo) : 0;
  return (
    <div class="panel">
      <h3>Rover</h3>
      {rover ? (
        <>
          <dl class="kv">
            <dt>Energy</dt>
            <dd>
              {Math.round(rover.energy)} / {stats.roverEnergy}
            </dd>
          </dl>
          <div class={`bar ${energyLow || tight ? "warn" : ""}`}>
            <span style={{ width: `${pct(rover.energy, stats.roverEnergy)}%` }} />
          </div>
          {stranded ? (
            <p class="danger small act-note">
              {homeEnergy === null
                ? "No route back to the ship for this rover."
                : `Not enough energy to drive home (needs ${homeEnergy.toFixed(1)}).`}
            </p>
          ) : (
            tight &&
            homeEnergy !== null && (
              <p class="accent small act-note">Energy is getting tight: the trip home takes {homeEnergy.toFixed(1)}.</p>
            )
          )}
          <dl class="kv spaced">
            <dt>Cargo bed</dt>
            <dd>
              {tonnes(bedT)} / {tonnes(stats.roverCargoT)}
            </dd>
          </dl>
          <div class="bar">
            <span style={{ width: `${pct(bedT, stats.roverCargoT)}%` }} />
          </div>
          <CargoChips cargo={rover.cargo} />
        </>
      ) : (
        <p class="muted small">Stowed aboard.</p>
      )}
      <dl class="kv spaced">
        <dt>Ship hold</dt>
        <dd>
          {tonnes(hold)} / {tonnes(stats.cargoCapacityT)}
        </dd>
      </dl>
      <div class="bar">
        <span style={{ width: `${pct(hold, stats.cargoCapacityT)}%` }} />
      </div>
      <CargoChips cargo={state.ship.cargo} />
      <dl class="kv spaced">
        <dt>Fuel</dt>
        <dd>
          {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
        </dd>
      </dl>
      <div class={`bar ${fuelPct < 20 ? "warn" : ""}`}>
        <span style={{ width: `${fuelPct}%` }} />
      </div>
    </div>
  );
}

function CargoChips({ cargo }: { cargo: Parameters<typeof cargoList>[0] }) {
  const list = cargoList(cargo);
  if (list.length === 0) return null;
  return (
    <div class="cargo-chips">
      {list.map((c) => (
        <span key={c.id} class="cargo-chip">
          <i class="swatch" style={{ background: COMMODITIES[c.id].color }} />
          {c.name} {tonnes(c.tonnes)}
        </span>
      ))}
    </div>
  );
}

function DepositPanel({
  session,
  dep,
  know,
  rover,
  drive,
  busy,
}: {
  session: GameSession;
  dep: Deposit;
  know: RegionKnowledge;
  rover: RoverState | null;
  drive: () => void;
  busy: boolean;
}) {
  const stats = shipStats(session.state.ship);
  const commodity = COMMODITIES[dep.commodity];
  const status = depositStatus(know, dep);
  const prospected = know.prospected.includes(dep.id);
  const isSite = know.drillSites.includes(dep.id);
  const dist = rover ? chebyshev(rover, dep) : null;
  const near = dist !== null && dist <= 1;
  const remaining = remainingTonnes(know, dep);
  const tooDeep = dep.depthM > stats.drillMaxDepthM;
  const rate = stats.drillRateTph * (0.4 + dep.grade);
  const room = rover ? stats.roverCargoT - cargoTonnes(rover.cargo) : 0;

  const placement: string[] = [];
  if (!rover) placement.push("Deploy the rover first.");
  else if (!near) placement.push(`The rover is ${dist} tiles away: drive it next to the deposit.`);

  const prospectBlockers = [...placement];
  if (rover && rover.energy < PROSPECT_ENERGY) prospectBlockers.push(`Core samples need ${PROSPECT_ENERGY} rover energy.`);

  const drillBlockers = [...placement];
  if (status === "depleted") drillBlockers.push("This deposit is worked out.");
  if (tooDeep) drillBlockers.push(`The seam is ${dep.depthM} m down and the drill only reaches ${stats.drillMaxDepthM} m. A better drill would get it.`);
  if (rover && room <= 0.05) drillBlockers.push("The rover's cargo bed is full. Drive back to the ship and unload.");
  const setupEnergy = isSite ? 0 : DRILL_SETUP_ENERGY;
  if (rover && rover.energy < setupEnergy + 0.5) drillBlockers.push("Not enough rover energy to run the drill.");

  const hoursFull = rover
    ? Math.max(0, Math.min(remaining / rate, room / rate, (rover.energy - setupEnergy) / DRILL_ENERGY_PER_HOUR))
    : 0;
  const hours4 = Math.min(4, hoursFull);
  const setupMin = isSite ? 0 : DRILL_SETUP_MINUTES;

  const runDrill = (maxHours: number): void => {
    const r = session.act((s, w) => drill(s, w, dep.id, maxHours));
    if (!r.ok) return;
    const { tonnes: got, hours, depleted, roverFull } = r.value;
    const why = depleted ? "deposit worked out" : roverFull ? "cargo bed full" : hours < maxHours - 0.01 ? "rover energy low" : "";
    session.notify(`Drilled ${tonnes(got)} of ${commodity.name.toLowerCase()} in ${formatDuration(hours * HOUR)}${why ? ` (${why})` : ""}.`);
  };

  return (
    <div class="panel deposit-panel">
      <h3>Selected deposit</h3>
      <div class="dep-title" title={commodity.blurb}>
        <i class="swatch big" style={{ background: status === "depleted" ? "#5b6472" : commodity.color }} />
        <span>{commodity.name}</span>
        <span class={`tag ${status}`}>{status === "new" ? "unsurveyed" : status}</span>
      </div>
      <p class="muted small blurb">{commodity.blurb}</p>
      <dl class="kv">
        <dt>Position</dt>
        <dd>
          {dep.x}, {dep.y}
          {dist !== null && <span class="muted"> · {dist} tiles</span>}
        </dd>
        {prospected ? (
          <>
            <dt>Grade</dt>
            <dd>{Math.round(dep.grade * 100)}%</dd>
            <dt>Depth</dt>
            <dd class={tooDeep ? "danger" : ""}>
              {dep.depthM} m{tooDeep ? ` (drill max ${stats.drillMaxDepthM} m)` : ""}
            </dd>
            <dt>Remaining</dt>
            <dd>{tonnes(remaining)}</dd>
            <dt>Drill rate</dt>
            <dd>{rate.toFixed(2)} t/h</dd>
            {isSite && (
              <>
                <dt>Drill rig</dt>
                <dd class="accent">set up</dd>
              </>
            )}
          </>
        ) : (
          <>
            <dt>Seam</dt>
            <dd class="muted">grade, depth and size unknown</dd>
          </>
        )}
      </dl>

      {!prospected ? (
        <>
          <ul class="blockers">{prospectBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !near && (
              <button class="btn" disabled={busy} onClick={drive}>
                Drive there
              </button>
            )}
            <button
              class="btn primary"
              disabled={busy || prospectBlockers.length > 0}
              onClick={() => session.act((s, w) => prospect(s, w, dep.id))}
            >
              Prospect ({formatDuration(PROSPECT_MINUTES)})
            </button>
          </div>
        </>
      ) : (
        <>
          <ul class="blockers">{drillBlockers.map((b) => <li key={b}>{b}</li>)}</ul>
          <div class="btn-row dep-actions">
            {rover && !near && (
              <button class="btn" disabled={busy} onClick={drive}>
                Drive there
              </button>
            )}
            <button class="btn primary" disabled={busy || drillBlockers.length > 0} onClick={() => runDrill(Infinity)}>
              Drill until full
            </button>
            <button class="btn" disabled={busy || drillBlockers.length > 0} onClick={() => runDrill(4)}>
              Drill 4 h
            </button>
          </div>
          {drillBlockers.length === 0 && (
            <p class="muted small act-note">
              Full run: about {tonnes(rate * hoursFull)} in {formatDuration(hoursFull * HOUR + setupMin)}. 4 h run: about{" "}
              {tonnes(rate * hours4)} in {formatDuration(hours4 * HOUR + setupMin)}.
              {!isSite && ` Includes ${formatDuration(DRILL_SETUP_MINUTES)} rig setup, once per site.`}
            </p>
          )}
        </>
      )}
    </div>
  );
}
