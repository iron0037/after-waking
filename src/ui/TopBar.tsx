import { activeRegion, ageAt, compendiumTotals, formatDate, formatDuration, shipStats, type GameState, type World } from "../sim";
import { cargoSummary, cr, pct } from "./format";
import type { GameSession } from "./session";

export function TopBar({
  session,
  onJournal,
  onCompendium,
  onContracts,
  onQuit,
}: {
  session: GameSession;
  onJournal: () => void;
  onCompendium: () => void;
  onContracts: () => void;
  onQuit: () => void;
}) {
  const { state, world } = session;
  const stats = shipStats(state.ship);
  const foldReady = state.time >= state.foldReadyAt;
  const activeContracts = (state.contracts ?? []).filter((c) => c.status === "active").length;
  return (
    <header class="topbar">
      <div class="tb-block">
        <div class="tb-label">{formatDate(state.time)}</div>
        <div class="tb-value">
          {state.captain.name}, {ageAt(state.captain.born, state.time)}
        </div>
      </div>
      <div class="tb-block">
        <div class="tb-label">Location</div>
        <div class="tb-value">{locationLabel(state, world)}</div>
      </div>
      <div class="tb-block">
        <div class="tb-label">Credits</div>
        <div class="tb-value accent">{cr(state.credits)}</div>
      </div>
      <div class="tb-block" title="Plicite fuel">
        <div class="tb-label">
          Fuel {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
        </div>
        <div class="bar">
          <span style={{ width: `${pct(state.ship.fuel, stats.fuelCapacity)}%` }} />
        </div>
      </div>
      <div class="tb-block">
        <div class="tb-label">Hold</div>
        <div class="tb-value">{cargoSummary(state.ship.cargo, stats.cargoCapacityT)}</div>
      </div>
      <div class="tb-block">
        <div class="tb-label">Fold drive</div>
        <div class={`tb-value ${foldReady ? "good" : "muted"}`}>
          {foldReady ? "Ready" : `Charging ${formatDuration(state.foldReadyAt - state.time)}`}
        </div>
      </div>
      <div class="tb-block" title={`Next payment due ${formatDate(state.loan.nextDue)}`}>
        <div class="tb-label">Exchange note</div>
        <div class={`tb-value ${state.loan.missed > 0 ? "danger" : ""}`}>
          {state.loan.balance > 0 ? cr(state.loan.balance) : "Paid off"}
        </div>
      </div>
      <div class="tb-spacer" />
      <button class="btn" onClick={onContracts} title="Contracts (K)">
        Contracts ({activeContracts})
      </button>
      <button class="btn" onClick={onCompendium} title="Compendium (B)">
        Compendium {compendiumTotals(state).all.found}/{compendiumTotals(state).all.total}
      </button>
      <button class="btn" onClick={onJournal} title="Journal (J)">
        Journal
      </button>
      <button class="btn" onClick={onQuit} title="Return to title (progress is autosaved)">
        Title
      </button>
    </header>
  );
}

function locationLabel(state: GameState, world: World): string {
  const loc = state.location;
  if (loc.kind === "intrepid") return "Docked at the Intrepid";
  const sys = world.system(loc.systemId).system;
  if (loc.kind === "surface") return `${world.body(loc.bodyId).body.name}, region ${activeRegion(state, world) + 1}`;
  if (loc.orbiting) return `Orbiting ${world.body(loc.orbiting).body.name}`;
  return `${sys.name} system`;
}
