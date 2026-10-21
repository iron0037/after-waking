/** The Intrepid: market, shipyard, Exchange counter and the way out. */
import { useEffect, useState } from "preact/hooks";
import { COMMODITIES, COMMODITY_IDS } from "../../data/commodities";
import { CLAN_NAMES, UPGRADES, type ClanId } from "../../data/ship";
import {
  buyFuel,
  buyUpgrade,
  cargoTonnes,
  DAY,
  formatDate,
  formatDuration,
  fuelPrice,
  payLoan,
  sell,
  sellAll,
  sellPrice,
  shipStats,
  wait,
} from "../../sim";
import { cr, pct, tonnes } from "../format";
import { useSession, type GameSession } from "../session";
import "./hub.css";

type Tab = "market" | "shipyard" | "exchange" | "depart";

const TABS: { id: Tab; label: string }[] = [
  { id: "market", label: "Market" },
  { id: "shipyard", label: "Shipyard" },
  { id: "exchange", label: "Exchange" },
  { id: "depart", label: "Depart" },
];

const TAB_BLURB: Record<Tab, string> = {
  market: "The Exchange clan runs the Concourse scales. Everything is weighed, nothing is free.",
  shipyard: "Gantries, sparks and clan salesmen. Every part on the shelf was pulled from somebody's grandmother's engine room.",
  exchange: "Brass counters under dim lamps. The note on your ship is older than most of the clerks.",
  depart: "Last checks at the airlock. The Verge is out there, and it doesn't care about your schedule.",
};

export function Hub({ session }: { session: GameSession }) {
  useSession(session);
  const [tab, setTab] = useState<Tab>("market");

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.target instanceof HTMLInputElement || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const next = TABS[Number(ev.key) - 1];
      if (next) setTab(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div class="full hub">
      <header class="hub-head">
        <div>
          <h1 class="hub-title">The Intrepid</h1>
          <div class="muted">Five miles of hull, two million voices, and a berth with your name on the lease.</div>
        </div>
        <nav class="hub-tabs" role="tablist">
          {TABS.map((t, i) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              class={`hub-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
              title={`${t.label} (${i + 1})`}
            >
              <span class="hub-tab-key">{i + 1}</span> {t.label}
            </button>
          ))}
        </nav>
      </header>
      <p class="hub-blurb muted">{TAB_BLURB[tab]}</p>
      <div class="hub-body">
        {tab === "market" && <Market session={session} />}
        {tab === "shipyard" && <Shipyard session={session} />}
        {tab === "exchange" && <Exchange session={session} />}
        {tab === "depart" && <Depart session={session} />}
      </div>
    </div>
  );
}

// --- market ------------------------------------------------------------------------------

function Trend({ mult }: { mult: number }) {
  const change = Math.round((mult - 1) * 100);
  if (change === 0) return <span class="muted">0%</span>;
  return change > 0 ? <span class="good">▲{change}%</span> : <span class="danger">▼{-change}%</span>;
}

function Market({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = shipStats(state.ship);
  const cargo = state.ship.cargo;
  const held = cargoTonnes(cargo);
  const estimate = COMMODITY_IDS.reduce((sum, id) => sum + (cargo[id] ?? 0) * sellPrice(state.market, id), 0);
  const price = fuelPrice(state.market);
  const room = Math.floor(stats.fuelCapacity - state.ship.fuel);
  const affordable = Math.floor(state.credits / price);
  const canBuy = room >= 1 && affordable >= 1;
  const buy = (n: number) => session.act((s) => buyFuel(s, n));

  return (
    <div class="hub-grid">
      <section class="panel hub-wide">
        <div class="hub-section-head">
          <h2>Ore buyers</h2>
          <span class="muted">
            Hold: {tonnes(held)} / {tonnes(stats.cargoCapacityT)}
          </span>
        </div>
        <table class="data">
          <thead>
            <tr>
              <th>Commodity</th>
              <th class="num">Aboard</th>
              <th class="num">Price / t</th>
              <th class="num">vs. base</th>
              <th class="num">Hold value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {COMMODITY_IDS.map((id) => {
              const have = cargo[id] ?? 0;
              const aboard = have > 0.05;
              const p = sellPrice(state.market, id);
              return (
                <tr key={id}>
                  <td>
                    <span class="swatch" style={{ background: COMMODITIES[id].color }} />
                    <span class="hub-name" title={COMMODITIES[id].blurb}>
                      {COMMODITIES[id].name}
                    </span>
                  </td>
                  <td class="num">{aboard ? tonnes(have) : <span class="muted">-</span>}</td>
                  <td class="num">{cr(p)}</td>
                  <td class="num">
                    <Trend mult={state.market.mult[id]} />
                  </td>
                  <td class="num">{aboard ? cr(have * p) : <span class="muted">-</span>}</td>
                  <td class="num">
                    <button
                      class="btn"
                      disabled={!aboard}
                      title={aboard ? `Sell all ${COMMODITIES[id].name.toLowerCase()}` : "None aboard"}
                      onClick={() => session.act((s) => sell(s, id))}
                    >
                      Sell
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div class="hub-actions">
          <button class="btn primary" disabled={held <= 0.05} onClick={() => session.act((s) => sellAll(s))}>
            Sell entire hold
          </button>
          <span class="muted">
            {held > 0.05 ? `about ${cr(estimate)} (big lots push the price down as they sell)` : "The hold is empty."}
          </span>
        </div>
      </section>

      <section class="panel">
        <h2>Plicite fuel</h2>
        <dl class="kv">
          <dt>Price</dt>
          <dd class="accent">{cr(price)} / unit</dd>
          <dt>Tanks</dt>
          <dd>
            {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
          </dd>
          <dt>Credits</dt>
          <dd>{cr(state.credits)}</dd>
        </dl>
        <div class={`bar hub-fuelbar ${state.ship.fuel < stats.fuelCapacity * 0.25 ? "warn" : ""}`}>
          <span style={{ width: `${pct(state.ship.fuel, stats.fuelCapacity)}%` }} />
        </div>
        <div class="btn-row">
          <button class="btn" disabled={!canBuy} onClick={() => buy(5)}>
            +5 <span class="muted">({cr(Math.min(5, room, affordable) * price)})</span>
          </button>
          <button class="btn" disabled={!canBuy} onClick={() => buy(10)}>
            +10 <span class="muted">({cr(Math.min(10, room, affordable) * price)})</span>
          </button>
          <button class="btn primary" disabled={!canBuy} onClick={() => buy(room)}>
            Fill <span class="muted">({cr(Math.min(room, affordable) * price)})</span>
          </button>
        </div>
        <p class="muted small">
          Plicite is what makes folds possible. The Lyceum says it is just chemistry. The Exchange says it is just money.
        </p>
      </section>
    </div>
  );
}

// --- shipyard ----------------------------------------------------------------------------

function Shipyard({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = shipStats(state.ship);
  const r = stats.ratings;
  const vendors = (Object.keys(CLAN_NAMES) as ClanId[]).filter((c) => UPGRADES.some((u) => u.vendor === c));

  return (
    <div class="hub-grid">
      <section class="panel">
        <h2>{state.ship.name}</h2>
        <h3>Ship</h3>
        <dl class="kv">
          <dt>Hull mass</dt>
          <dd>{tonnes(stats.hullMassT)}</dd>
          <dt>Cargo capacity</dt>
          <dd>{tonnes(stats.cargoCapacityT)}</dd>
          <dt>Fuel capacity</dt>
          <dd>{stats.fuelCapacity} units</dd>
          <dt>Fold range</dt>
          <dd>{stats.foldRangeLy} ly</dd>
          <dt>Cruise speed</dt>
          <dd>{stats.cruiseSpeedC.toFixed(2)} c</dd>
          <dt>Sensors</dt>
          <dd>Tier {stats.sensorTier}</dd>
        </dl>
        <h3 class="hub-gap">Drill &amp; rover</h3>
        <dl class="kv">
          <dt>Drill depth</dt>
          <dd>{stats.drillMaxDepthM} m</dd>
          <dt>Drill rate</dt>
          <dd>{stats.drillRateTph} t/h</dd>
          <dt>Rover cargo</dt>
          <dd>{tonnes(stats.roverCargoT)}</dd>
          <dt>Rover energy</dt>
          <dd>{stats.roverEnergy}</dd>
          <dt>Rover climbs</dt>
          <dd class={stats.roverCanClimb ? "good" : "muted"}>{stats.roverCanClimb ? "Mountains" : "Flat and rough only"}</dd>
        </dl>
        <h3 class="hub-gap">Landing ratings</h3>
        <dl class="kv">
          <dt>Gravity</dt>
          <dd>up to {r.maxGravityG} g</dd>
          <dt>Pressure</dt>
          <dd>up to {r.maxPressureAtm} atm</dd>
          <dt>Temperature</dt>
          <dd>
            {r.minTempC} to {r.maxTempC} °C
          </dd>
          <dt>Corrosion</dt>
          <dd class={r.corrosionProof ? "good" : "muted"}>{r.corrosionProof ? "Proofed" : "Unprotected"}</dd>
          <dt>Radiation</dt>
          <dd>up to level {r.maxRadiation}</dd>
        </dl>
      </section>

      <section class="hub-upgrades">
        {vendors.map((clan) => (
          <div key={clan} class="hub-vendor">
            <h3>{CLAN_NAMES[clan]}</h3>
            <div class="hub-cards">
              {UPGRADES.filter((u) => u.vendor === clan).map((u) => {
                const installed = state.ship.upgrades.includes(u.id);
                const short = u.price - state.credits;
                return (
                  <div key={u.id} class={`panel hub-card ${installed ? "installed" : ""}`}>
                    <div class="hub-card-head">
                      <strong>{u.name}</strong>
                      {installed ? <span class="tag good">Installed</span> : <span class="accent">{cr(u.price)}</span>}
                    </div>
                    <div class="muted small">{u.description}</div>
                    {!installed && (
                      <button
                        class="btn"
                        disabled={short > 0}
                        title={short > 0 ? `You need ${cr(short)} more.` : `Install for ${cr(u.price)}. Two days in the yard.`}
                        onClick={() => session.act((s) => buyUpgrade(s, u.id))}
                      >
                        Buy
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

// --- exchange ----------------------------------------------------------------------------

function Exchange({ session }: { session: GameSession }) {
  const { state } = session;
  const loan = state.loan;
  const owed = loan.balance > 0;
  const next = Math.min(loan.payment, loan.balance);
  const ten = Math.min(10_000, loan.balance);
  const pay = (n: number) => session.act((s) => payLoan(s, n));
  const chargeMinutes = state.foldReadyAt - state.time;

  const why = (n: number): string =>
    !owed ? "Nothing owed." : state.credits < n ? `You need ${cr(n - state.credits)} more.` : `Pay ${cr(n)}`;

  return (
    <div class="hub-grid">
      <section class="panel">
        <h2>Exchange note</h2>
        {owed ? (
          <dl class="kv">
            <dt>Balance</dt>
            <dd class="accent">{cr(loan.balance)}</dd>
            <dt>Payment</dt>
            <dd>{cr(loan.payment)}</dd>
            <dt>Every</dt>
            <dd>{loan.intervalDays} days</dd>
            <dt>Next due</dt>
            <dd>{formatDate(loan.nextDue)}</dd>
            <dt>Missed payments</dt>
            <dd class={loan.missed > 0 ? "danger" : ""}>{loan.missed}</dd>
            <dt>Annual rate</dt>
            <dd>{(loan.annualRate * 100).toFixed(1)}%</dd>
            <dt>Credits on hand</dt>
            <dd>{cr(state.credits)}</dd>
          </dl>
        ) : (
          <p class="good">Paid in full. The ship is yours, and the clerks look at you differently.</p>
        )}
        <p class="muted small">
          Payments are collected automatically when due. Miss one and the Exchange adds a late fee, and remembers.
        </p>
        <div class="btn-row">
          <button class="btn" disabled={!owed || state.credits < next} title={why(next)} onClick={() => pay(next)}>
            Pay next installment {owed && <span class="muted">({cr(next)})</span>}
          </button>
          <button class="btn" disabled={!owed || state.credits < ten} title={why(ten)} onClick={() => pay(ten)}>
            Pay {cr(ten)}
          </button>
          <button
            class="btn primary"
            disabled={!owed || state.credits < loan.balance}
            title={why(loan.balance)}
            onClick={() => pay(loan.balance)}
          >
            Pay off in full
          </button>
        </div>
      </section>

      <section class="panel">
        <h2>Wait aboard the Intrepid</h2>
        <p class="muted small">Let the days turn. Prices drift, the fold drive charges, and the note keeps counting.</p>
        <div class="btn-row">
          <button class="btn" onClick={() => session.act((s) => wait(s, DAY))}>
            1 day
          </button>
          <button class="btn" onClick={() => session.act((s) => wait(s, 7 * DAY))}>
            7 days
          </button>
          {chargeMinutes > 0 && (
            <button class="btn" onClick={() => session.act((s) => wait(s, Math.ceil(s.foldReadyAt - s.time)))}>
              Until the fold drive is charged ({formatDuration(chargeMinutes)})
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

// --- depart ------------------------------------------------------------------------------

function Depart({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = shipStats(state.ship);
  const held = cargoTonnes(state.ship.cargo);
  const fuelOk = state.ship.fuel >= stats.fuelCapacity * 0.5;
  const foldReady = state.time >= state.foldReadyAt;

  return (
    <div class="hub-grid">
      <section class="panel">
        <h2>Pre-departure</h2>
        <ul class="hub-checklist">
          <li class={fuelOk ? "good" : "accent"}>
            <span class="mark">{fuelOk ? "✔" : "!"}</span>
            Fuel {state.ship.fuel.toFixed(1)} / {stats.fuelCapacity}
            {!fuelOk && <span class="muted"> (under half a tank; the Market sells plicite)</span>}
          </li>
          <li class={held <= 0.05 ? "good" : "accent"}>
            <span class="mark">{held <= 0.05 ? "✔" : "!"}</span>
            {held <= 0.05 ? "Hold empty, ready for ore" : `${tonnes(held)} still in the hold`}
            {held > 0.05 && <span class="muted"> (sell it before you go if you can)</span>}
          </li>
          <li class={foldReady ? "good" : "danger"}>
            <span class="mark">{foldReady ? "✔" : "✘"}</span>
            {foldReady ? "Fold drive charged" : `Fold drive charging: ${formatDuration(state.foldReadyAt - state.time)}`}
          </li>
        </ul>
        <button class="btn primary big" onClick={() => session.go("starmap")}>
          Open star map
        </button>
        <p class="muted small">You can plot a course now and fold when the drive is ready.</p>
      </section>
    </div>
  );
}
