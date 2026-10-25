/**
 * Ship status window (AW-130): the hold, specimens, vehicles and gear at a glance, from any screen.
 * Also where the portable refinery (AW-18) is run. Numbers come from src/sim (holdManifest).
 */
import { UPGRADES_BY_ID } from "../data/ship";
import {
  effectiveStats,
  formatDuration,
  holdManifest,
  HOUR,
  requirementProgress,
  trackedProjects,
  refineBlockers,
  refineOre,
  vehiclesOut,
} from "../sim";
import { cr, pct, tonnes } from "./format";
import type { GameSession } from "./session";

export function ShipStatus({ session, onClose }: { session: GameSession; onClose: () => void }) {
  const { state } = session;
  const stats = effectiveStats(state);
  const m = holdManifest(state);
  const out = vehiclesOut(state);
  const hasRefinery = stats.refineryRateTph > 0;
  const bodyName = (id: string) => {
    try {
      return session.world.body(id).body.name;
    } catch {
      return id;
    }
  };

  return (
    <div class="overlay" onClick={onClose}>
      <div class="contracts ship-status" onClick={(e) => e.stopPropagation()}>
        <div class="journal-head">
          <h2>{state.ship.name}</h2>
          <span class="muted">
            Hold {tonnes(m.usedT)} / {tonnes(m.capacityT)} · worth about {cr(m.value)}
          </span>
          <button class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="con-body">
          <section>
            <h3>Hold</h3>
            <div class="bar ship-hold-bar" title={`${Math.round(pct(m.usedT, m.capacityT))}% full`}>
              <span style={{ width: `${pct(m.usedT, m.capacityT)}%` }} />
            </div>
            {m.rows.length === 0 ? (
              <p class="muted">The hold is empty.</p>
            ) : (
              <table class="data">
                <thead>
                  <tr>
                    <th>Cargo</th>
                    <th class="num">Aboard</th>
                    <th class="num">Worth today</th>
                    <th class="num" title="Tonnes that active delivery contracts want. Concentrate counts at its ore equivalent.">
                      For contracts
                    </th>
                    {hasRefinery && <th class="num">Refinery</th>}
                  </tr>
                </thead>
                <tbody>
                  {m.rows.map((r) => {
                    const why = refineBlockers(state, r.id)[0];
                    return (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td class="num">{tonnes(r.tonnes)}</td>
                        <td class="num">{cr(r.value)}</td>
                        <td class="num">{r.wanted > 0 ? tonnes(r.wanted) : <span class="muted">-</span>}</td>
                        {hasRefinery && (
                          <td class="num">
                            {r.refineHours > 0 ? (
                              <button
                                class="btn"
                                disabled={!r.refinable || session.busy}
                                title={
                                  r.refinable
                                    ? `Refine all ${tonnes(r.tonnes)} into ${tonnes(r.tonnes / 2.5)} of concentrate: ${formatDuration(r.refineHours * HOUR)} of crew time`
                                    : (why ?? "")
                                }
                                onClick={() => session.act((s) => refineOre(s, r.id))}
                              >
                                Refine ({formatDuration(r.refineHours * HOUR)})
                              </button>
                            ) : (
                              <span class="muted">-</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {hasRefinery && (
              <p class="muted small">
                The refinery turns 2.5 t of metal ore into 1 t of concentrate worth 10% more, at about {stats.refineryRateTph} t of ore an hour of crew
                time. It frees hold space and lightens the ship for the fold. Delivery contracts accept concentrate.
              </p>
            )}
          </section>

          {trackedProjects(state).length > 0 && (
            <section>
              <h3>Tracked research</h3>
              {trackedProjects(state).map((p) => (
                <div key={p.id} class="ship-research">
                  <strong>{p.name}</strong> <span class="muted small">for the {UPGRADES_BY_ID.get(p.unlocks)?.name ?? p.unlocks}</span>
                  <ul class="research-needs small">
                    {p.needs.map((req, i) => {
                      const prog = requirementProgress(state, req);
                      return (
                        <li key={i} class={prog.met ? "good" : ""}>
                          {prog.met ? "✓ " : "· "}
                          {prog.label}
                        </li>
                      );
                    })}
                    <li class="muted">· {cr(p.cost)} at the Intrepid's Research tab</li>
                  </ul>
                </div>
              ))}
            </section>
          )}

          <section>
            <h3>
              Specimens <span class="muted small">{m.specimenCount} / {m.specimenSlots} racks</span>
            </h3>
            {m.specimens.length === 0 ? (
              <p class="muted">No live samples aboard.</p>
            ) : (
              <table class="data">
                <tbody>
                  {m.specimens.map((s) => (
                    <tr key={`${s.bodyId}|${s.species}`}>
                      <td>{s.species}</td>
                      <td class="muted">{bodyName(s.bodyId)}</td>
                      <td class="num">×{s.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section>
            <h3>Ship</h3>
            <dl class="kv">
              <dt>Fuel</dt>
              <dd>
                {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
              </dd>
              <dt>Rover</dt>
              <dd>{out.rover ? "out on the surface" : `in the bay, cells ${Math.round(state.ship.roverEnergy ?? stats.roverEnergy)} / ${stats.roverEnergy}`}</dd>
              {stats.boatEnergy > 0 && (
                <>
                  <dt>Boat</dt>
                  <dd>{out.boat ? "out on the water" : `in the bay, cells ${Math.round(state.ship.boatEnergy ?? stats.boatEnergy)} / ${stats.boatEnergy}`}</dd>
                </>
              )}
              {stats.probeCapacity > 0 && (
                <>
                  <dt>Probes</dt>
                  <dd>
                    {state.ship.probes ?? 0} / {stats.probeCapacity}
                  </dd>
                </>
              )}
              <dt>Drill</dt>
              <dd>
                {stats.drillMaxDepthM} m, {stats.drillRateTph} t/h
              </dd>
            </dl>
            <h3>Installed</h3>
            {state.ship.upgrades.length === 0 ? (
              <p class="muted">Stock freighter. The Shipyard aboard the Intrepid fits upgrades.</p>
            ) : (
              <ul class="ship-upgrades">
                {state.ship.upgrades.map((id) => {
                  const u = UPGRADES_BY_ID.get(id);
                  return (
                    <li key={id} title={u?.description}>
                      {u?.name ?? id}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
