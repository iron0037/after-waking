/**
 * The system orrery: where the ship is, where everything else is, and how to get there.
 * Flight is animated with time compression; the sim only advances when the burn completes.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  bodyProgress,
  clamp,
  flightPlan,
  flyTo,
  formatDuration,
  land,
  landingAccess,
  landingBlockers,
  scanBody,
  shipPosition,
  shipStats,
  SPECTRAL,
  SCAN_MINUTES,
  SURVEY_MINUTES,
  sensorTierFor,
  surveyBody,
  type Body,
  type FlightTarget,
  type Vec2,
  wait,
} from "../../sim";
import { useSession, type GameSession } from "../session";
import { Canvas } from "../Canvas";
import { drawOrrery, type FlightOverlay, type HitTarget, type Route } from "./system/draw";
import { BodyHeader, Environment, Exploration } from "./system/BodyDetails";
import { BodyList } from "./system/BodyList";
import { focusView, HOME_VIEW, zoomAt, zoomForBody, type ViewState } from "./system/projection";
import { RegionPicker, bestRegion } from "./system/RegionPicker";
import { contractTargets, fmtAU } from "./system/util";
import "./system.css";

interface Flight {
  route: Route;
  label: string;
  startMs: number;
  durMs: number;
}

export function SystemView({ session }: { session: GameSession }) {
  useSession(session);
  const loc = session.state.location;
  if (loc.kind !== "space") return <div class="full panel">Not in a star system.</div>;
  return <SystemScreen session={session} systemId={loc.systemId} />;
}

function SystemScreen({ session, systemId }: { session: GameSession; systemId: string }) {
  const { state, world } = session;
  const loc = state.location;
  const orbitingId = loc.kind === "space" ? loc.orbiting : null;
  const detail = world.system(systemId);
  const sys = detail.system;
  const stats = shipStats(state.ship);

  const [selectedId, setSelectedId] = useState<string | null>(orbitingId);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState(false);
  const [view, setView] = useState<ViewState>(HOME_VIEW);
  const [flying, setFlying] = useState(false);
  const [regionPick, setRegionPick] = useState<{ bodyId: string; region: number } | null>(null);

  const flightRef = useRef<Flight | null>(null);
  const timerRef = useRef(0);
  const sizeRef = useRef({ w: 800, h: 600 });
  const hitsRef = useRef<HitTarget[]>([]);
  const headingRef = useRef(-Math.PI / 2);

  const busy = session.busy || flying;
  const shipReal = shipPosition(state, world) as Vec2;
  const starDist = Math.hypot(shipReal.x, shipReal.y);
  const atEdge = starDist >= detail.edgeAU * 0.98;

  // Recomputed per render (not per animation frame): exploration rings and contract markers.
  const progress = new Map(detail.bodies.map((b) => [b.id, bodyProgress(state, b)] as const));
  const targets = contractTargets(state);

  const selected: Body | null = selectedId ? (detail.bodies.find((b) => b.id === selectedId) ?? null) : null;
  const orbitingSel = selected !== null && selected.id === orbitingId;
  const scanned = selected !== null && state.scannedBodies.includes(selected.id);

  const planRes = selected && !orbitingSel ? flightPlan(state, world, { bodyId: selected.id }) : null;
  const edgeRes = flightPlan(state, world, { edge: true });

  // Landing: default to the strongest unvisited region until the player picks one.
  const canPickRegion = orbitingSel && scanned && selected.regions > 0;
  const defaultRegion = useMemo(
    () => (canPickRegion ? bestRegion(state, selected, sensorTierFor(state, selected.id), stats.drillMaxDepthM) : 0),
    [canPickRegion, selected, stats.sensorTier, stats.drillMaxDepthM, state.stats.landings, state.surveyedBodies.length],
  );
  const region = regionPick && selected && regionPick.bodyId === selected.id ? regionPick.region : defaultRegion;

  // --- flight ----------------------------------------------------------------------------

  const finishFlight = () => {
    const f = flightRef.current;
    if (!f) return;
    window.clearTimeout(timerRef.current);
    flightRef.current = null;
    setFlying(false);
    session.act((s, w) => flyTo(s, w, f.route.target));
    session.setBusy(false);
  };

  const startFlight = (target: FlightTarget) => {
    if (session.busy) return;
    const planned = flightPlan(session.state, session.world, target);
    if (!planned.ok) {
      session.notify(planned.reason, "error");
      return;
    }
    const plan = planned.value;
    if (plan.fuel > session.state.ship.fuel) {
      session.notify(`Needs ${plan.fuel} fuel for the burn; tanks hold ${session.state.ship.fuel.toFixed(1)}.`, "error");
      return;
    }
    const label = "bodyId" in target ? session.world.body(target.bodyId).body.name : "the system edge";
    const durMs = clamp(plan.minutes / 60, 1.2, 12) * 1000;
    flightRef.current = {
      route: {
        target,
        plan,
        startReal: shipPosition(session.state, session.world) as Vec2,
        startBodyId: orbitingId,
        startTime: session.state.time,
      },
      label,
      startMs: performance.now(),
      durMs,
    };
    setHoverEdge(false);
    setHoverId(null);
    session.setBusy(true);
    setFlying(true);
    timerRef.current = window.setTimeout(finishFlight, durMs);
  };

  // Leaving mid-burn cancels it; the sim was never advanced, so nothing is lost.
  useEffect(
    () => () => {
      if (flightRef.current) {
        window.clearTimeout(timerRef.current);
        flightRef.current = null;
        session.setBusy(false);
      }
    },
    [],
  );

  // --- map interaction -------------------------------------------------------------------

  const pick = (x: number, y: number): string | null => {
    let best: string | null = null;
    let bestGap = 8;
    for (const h of hitsRef.current) {
      const gap = Math.hypot(h.x - x, h.y - y) - h.r;
      if (gap < bestGap) {
        bestGap = gap;
        best = h.id;
      }
    }
    return best;
  };

  const select = (id: string | null) => {
    if (!busy) setSelectedId(id);
  };

  const zoomBy = (factor: number, x = sizeRef.current.w / 2, y = sizeRef.current.h / 2) =>
    setView((v) => zoomAt(v, sizeRef.current.w, sizeRef.current.h, x, y, factor));

  const zoomToSelected = () => {
    if (!selected) return;
    const { w, h } = sizeRef.current;
    setView(focusView(w, h, detail, selected, state.time, zoomForBody(w, h, detail, selected)));
  };

  // --- drawing ---------------------------------------------------------------------------

  const mkRoute = (target: FlightTarget, plan: Route["plan"]): Route => ({
    target,
    plan,
    startReal: shipReal,
    startBodyId: orbitingId,
    startTime: state.time,
  });
  let idleRoute: Route | null = null;
  if (!flying) {
    if (hoverEdge && edgeRes.ok && !atEdge) idleRoute = mkRoute({ edge: true }, edgeRes.value);
    else if (selected && planRes?.ok) idleRoute = mkRoute({ bodyId: selected.id }, planRes.value);
  }

  const draw = (ctx: CanvasRenderingContext2D, w: number, h: number, timeMs: number) => {
    sizeRef.current = { w, h };
    const f = flightRef.current;
    let time = state.time;
    let flight: FlightOverlay | null = null;
    let route = idleRoute;
    if (f) {
      const raw = clamp((performance.now() - f.startMs) / f.durMs, 0, 1);
      const eased = raw * raw * (3 - 2 * raw);
      const { plan, startTime } = f.route;
      time = startTime + eased * plan.minutes;
      flight = { progress: eased, raw, rate: ((plan.minutes * 60) / (f.durMs / 1000)) * 6 * raw * (1 - raw), label: f.label };
      route = f.route;
    }
    const result = drawOrrery(ctx, w, h, {
      state,
      world,
      detail,
      view,
      time,
      timeMs,
      selectedId: selected?.id ?? null,
      hoverId,
      shipReal,
      route,
      flight,
      heading: headingRef.current,
      progress,
      targets,
    });
    hitsRef.current = result.hits;
    headingRef.current = result.heading;
  };

  // --- render ----------------------------------------------------------------------------

  const edgeFuelShort = edgeRes.ok && edgeRes.value.fuel > state.ship.fuel;
  const planFuelShort = planRes?.ok === true && planRes.value.fuel > state.ship.fuel;
  const access = selected ? landingAccess(selected, stats.ratings) : null;
  const landBlockers = canPickRegion && access?.ok ? landingBlockers(state, world, region) : [];

  return (
    <>
      <div class="viewport sys-viewport">
        <Canvas
          draw={draw}
          animate={flying}
          class={hoverId && !busy ? "sys-pointer" : ""}
          onClick={(x, y) => select(pick(x, y))}
          onMove={(x, y) => {
            const id = busy ? null : pick(x, y);
            if (id !== hoverId) setHoverId(id);
          }}
          onLeave={() => setHoverId(null)}
          onWheel={(dy, x, y) => zoomBy(Math.exp(-dy * 0.0016), x, y)}
        />
        <div class="viewport-tools">
          <button class="btn" onClick={() => zoomBy(1.6)} title="Zoom in">
            +
          </button>
          <button class="btn" onClick={() => zoomBy(1 / 1.6)} title="Zoom out">
            −
          </button>
          <button
            class="btn"
            onClick={zoomToSelected}
            disabled={!selected || busy}
            title={selected ? `Center and zoom in on ${selected.name}${selected.moonIds.length > 0 ? " and its moons" : ""}` : "Select a body first"}
          >
            Zoom to body
          </button>
          <button class="btn" onClick={() => setView(HOME_VIEW)} disabled={view.zoom === 1} title="Reset view">
            Reset view
          </button>
        </div>
        {flying && (
          <button class="btn sys-skip" onClick={finishFlight}>
            Skip ▸▸
          </button>
        )}
        <div class="viewport-hint">
          Click a world to select · scroll to zoom · radial scale is logarithmic, moon orbits are exaggerated
        </div>
      </div>

      <aside class="side sys-side">
        <section class="sys-head">
          <h2>{sys.name}</h2>
          <div class="sys-star muted small">
            <span class="sys-star-dot" style={{ background: SPECTRAL[sys.spectral].color }} />
            {SPECTRAL[sys.spectral].label} · class {sys.spectral} · fold limit {fmtAU(detail.edgeAU)} AU
          </div>
          <div class="sys-status">
            {orbitingId ? (
              <>
                Orbiting <span class="accent">{world.body(orbitingId).body.name}</span>
              </>
            ) : (
              <>
                Drifting, <span class="accent">{fmtAU(starDist)} AU</span> from {sys.name}
              </>
            )}
            {atEdge && <span class="good"> · Clear to fold</span>}
          </div>
          <div class="btn-row">
            <button
              class="btn"
              disabled={busy || atEdge || !edgeRes.ok || edgeFuelShort}
              onClick={() => startFlight({ edge: true })}
              onMouseEnter={() => setHoverEdge(true)}
              onMouseLeave={() => setHoverEdge(false)}
              title={edgeRes.ok ? `${fmtAU(edgeRes.value.distanceAU)} AU · ${formatDuration(edgeRes.value.minutes)} · ${edgeRes.value.fuel} fuel` : ""}
            >
              Fly to system edge
            </button>
            <button class="btn" disabled={busy} onClick={() => session.go("starmap")} title="Star map (M)">
              Star map
            </button>
          </div>
          {state.time < state.foldReadyAt && (
            <button
              class="btn"
              disabled={busy}
              onClick={() => session.act((s) => wait(s, s.foldReadyAt - s.time))}
              title="Hold position and let the fold drive finish charging"
            >
              Hold until the fold drive is charged ({formatDuration(state.foldReadyAt - state.time)})
            </button>
          )}
          {edgeFuelShort && edgeRes.ok && <div class="danger small">The edge burn needs {edgeRes.value.fuel} fuel.</div>}
        </section>

        <section>
          <h3>
            Bodies <span class="muted">· {state.scannedBodies.filter((id) => id.startsWith(`${systemId}.`)).length}/{detail.bodies.length} scanned</span>
          </h3>
          <BodyList
            detail={detail}
            time={state.time}
            shipPos={shipReal}
            scanned={state.scannedBodies}
            orbitingId={orbitingId}
            selectedId={selected?.id ?? null}
            hoverId={hoverId}
            progress={progress}
            targets={targets}
            onSelect={select}
            onHover={(id) => !busy && setHoverId(id)}
          />
        </section>

        {selected ? (
          <section class="panel sys-selected">
            <BodyHeader body={selected} detail={detail} scanned={scanned} />
            <Exploration
              state={state}
              progress={progress.get(selected.id) ?? bodyProgress(state, selected)}
              contracts={targets.get(selected.id) ?? []}
            />

            {!orbitingSel && planRes && (
              <>
                <h3>Flight</h3>
                {planRes.ok ? (
                  <>
                    <dl class="kv">
                      <dt>Distance</dt>
                      <dd>{fmtAU(planRes.value.distanceAU)} AU</dd>
                      <dt>Travel time</dt>
                      <dd>{formatDuration(planRes.value.minutes)}</dd>
                      <dt>Fuel</dt>
                      <dd class={planFuelShort ? "danger" : ""}>
                        {planRes.value.fuel} <span class="muted">of {state.ship.fuel.toFixed(1)}</span>
                      </dd>
                    </dl>
                    {planFuelShort && <ul class="blockers"><li>Not enough fuel for this burn.</li></ul>}
                    <button class="btn primary big" disabled={busy || planFuelShort} onClick={() => startFlight({ bodyId: selected.id })}>
                      Engage
                    </button>
                  </>
                ) : (
                  <div class="danger small">{planRes.reason}</div>
                )}
              </>
            )}

            {orbitingSel && !scanned && (
              <>
                <h3>Orbit</h3>
                <div class="muted small">Unscanned. A full sensor sweep profiles the world and its regions.</div>
                <button
                  class="btn primary big"
                  disabled={busy}
                  onClick={() => session.act((s, w) => scanBody(s, w))}
                >
                  Scan ({formatDuration(SCAN_MINUTES)})
                </button>
              </>
            )}

            {orbitingSel && scanned && access && (
              <>
                <h3>{access.ok ? "Landing" : "Surface"}</h3>
                {!access.ok && (
                  <>
                    <div class="danger small">Can't land with the current ship:</div>
                    <ul class="blockers">
                      {access.reasons.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </>
                )}
                {selected.regions > 0 ? (
                  <>
                    {!state.surveyedBodies.includes(selected.id) && (
                      <div class="sys-survey">
                        <div class="muted small">
                          A detailed survey sharpens these readings and, with penetrating sensors, counts only seams your drill can
                          reach. Rover sensors also reach farther on this world.
                          {!access.ok && " It needs no landing: the survey is flown from orbit."}
                        </div>
                        <button class="btn" disabled={busy} onClick={() => session.act((s, w) => surveyBody(s, w))}>
                          Detailed survey ({formatDuration(SURVEY_MINUTES)})
                        </button>
                      </div>
                    )}
                    <RegionPicker
                      body={selected}
                      state={state}
                      world={world}
                      sensorTier={sensorTierFor(state, selected.id)}
                      reachM={stats.drillMaxDepthM}
                      selected={region}
                      landable={access.ok}
                      onSelect={(r) => setRegionPick({ bodyId: selected.id, region: r })}
                    />
                    {access.ok && landBlockers.length > 0 && (
                      <ul class="blockers">
                        {landBlockers.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                    {access.ok && (
                      <button
                        class="btn primary big"
                        disabled={busy || landBlockers.length > 0}
                        onClick={() => session.act((s, w) => land(s, w, region))}
                      >
                        Land in region {region + 1}
                      </button>
                    )}
                  </>
                ) : (
                  access.ok && <div class="muted small">Nothing to set down on.</div>
                )}
              </>
            )}

            {scanned ? (
              <Environment body={selected} />
            ) : (
              <div class="sys-unscanned muted small">
                Unscanned: {orbitingSel ? "scan to reveal its environment and resources." : "enter orbit and scan to reveal its environment and resources."}
              </div>
            )}
          </section>
        ) : (
          <section class="panel muted small">Select a body on the map or in the list to plan a burn.</section>
        )}
      </aside>
    </>
  );
}
