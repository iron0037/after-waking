/** The Intrepid: market, shipyard, Exchange counter and the way out. */
import { useEffect, useState } from "preact/hooks";
import { COMMODITIES, COMMODITY_IDS } from "../../data/commodities";
import { CLAN_NAMES, UPGRADE_CATEGORY_NAMES, UPGRADES, type UpgradeCategory } from "../../data/ship";
import {
  acceptContract,
  buyFuel,
  buyUpgrade,
  cargoTonnes,
  completeContract,
  contractProgress,
  DAY,
  formatDate,
  formatDuration,
  fuelPrice,
  NEW_SPECIES_BONUS,
  payLoan,
  sell,
  sellAll,
  sellPrice,
  sellSpecimens,
  shipStats,
  SHIP_SPECIMEN_SLOTS,
  SPECIMEN_PRICE,
  specimenCount,
  wait,
  type Contract,
} from "../../sim";
import { cr, pct, tonnes } from "../format";
import { useSession, type GameSession } from "../session";
import "./hub.css";

type Tab = "market" | "jobs" | "shipyard" | "exchange" | "depart";

const TABS: { id: Tab; label: string }[] = [
  { id: "market", label: "Market" },
  { id: "jobs", label: "Jobs" },
  { id: "shipyard", label: "Shipyard" },
  { id: "exchange", label: "Exchange" },
  { id: "depart", label: "Depart" },
];

const TAB_BLURB: Record<Tab, string> = {
  market: "The Exchange clan runs the Concourse scales. Everything is weighed, nothing is free.",
  jobs: "The clan boards by the Concourse gate. Paper contracts, wet signatures, and a deadline on every one.",
  shipyard: "Gantries, sparks and clan salesmen. Every part on the shelf was pulled from somebody's grandmother's engine room.",
  exchange: "Brass counters under dim lamps. The note on your ship is older than most of the clerks.",
  depart: "Last checks at the airlock. The Verge is out there, and it doesn't care about your schedule.",
};

export function Hub({ session }: { session: GameSession }) {
  useSession(session);
  const { state } = session;
  const contracts = state.contracts ?? [];
  const starterOffers = contracts.filter((c) => c.status === "offered" && c.starter).length;
  const [tab, setTab] = useState<Tab>(() =>
    starterOffers > 0 && state.stats.folds === 0 && contracts.every((c) => c.status === "offered") ? "jobs" : "market",
  );

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
        <div class="hub-id">
          <img class="hub-ship" src="./assets/intrepid.png" alt="The Intrepid" title="The Intrepid" />
          <div>
            <div class="hub-title-row">
              <h1 class="hub-title">The Intrepid</h1>
              <button class="btn primary hub-depart" onClick={() => session.go("starmap")} title="Open the star map and plot a course (M)">
                Depart ▸ Star map
              </button>
            </div>
            <div class="muted">Five miles of hull, two million voices, and a berth with your name on the lease.</div>
            <div class="muted small">
              Your ship: <span class="accent">{state.ship.name}</span>
            </div>
          </div>
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
              {t.id === "jobs" && starterOffers > 0 && <span class="hub-badge">{starterOffers}</span>}
            </button>
          ))}
        </nav>
      </header>
      <p class="hub-blurb muted">{TAB_BLURB[tab]}</p>
      <div class="hub-body">
        {tab === "market" && <Market session={session} />}
        {tab === "jobs" && <Jobs session={session} />}
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

      <section class="panel hub-wide">
        <SpecimenDesk session={session} />
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

function SpecimenDesk({ session }: { session: GameSession }) {
  const { state, world } = session;
  const specimens = state.ship.specimens ?? {};
  const held = specimenCount(specimens);
  const reserved = new Set(
    (state.contracts ?? []).filter((c) => c.status === "active" && c.kind === "specimens").map((c) => c.bodyId),
  );
  const rows = Object.entries(specimens)
    .filter(([, n]) => n > 0)
    .map(([key, count]) => {
      const [bodyId = "", ...rest] = key.split("|");
      let bodyName = bodyId;
      try {
        bodyName = world.body(bodyId).body.name;
      } catch {
        /* unknown body: show the raw id */
      }
      return {
        key,
        species: rest.join("|"),
        bodyName,
        count,
        reserved: reserved.has(bodyId),
        isNew: !state.catalogedSpecies.includes(key),
      };
    })
    .sort((a, b) => a.bodyName.localeCompare(b.bodyName) || a.species.localeCompare(b.species));
  const sellable = rows.filter((r) => !r.reserved);
  const estimate = sellable.reduce((sum, r) => sum + r.count * SPECIMEN_PRICE + (r.isNew ? NEW_SPECIES_BONUS : 0), 0);

  return (
    <>
      <div class="hub-section-head">
        <h2>Lyceum specimen desk</h2>
        <span class={held >= SHIP_SPECIMEN_SLOTS ? "accent" : "muted"}>
          Containment: {held} / {SHIP_SPECIMEN_SLOTS}
        </span>
      </div>
      {rows.length > 0 ? (
        <table class="data">
          <thead>
            <tr>
              <th>Species</th>
              <th>Collected on</th>
              <th class="num">Count</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.species}</td>
                <td>{r.bodyName}</td>
                <td class="num">{r.count}</td>
                <td>
                  {r.reserved ? (
                    <span class="tag good" title="Reserved for an active specimen contract; the desk won't buy these.">
                      held for contract
                    </span>
                  ) : r.isNew ? (
                    <span class="tag accent-tag">new species +{cr(NEW_SPECIES_BONUS)}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="muted">The containment racks are empty. The rover brings samples back from flora on the surface.</p>
      )}
      <div class="hub-actions">
        <button
          class="btn primary"
          disabled={sellable.length === 0}
          title={sellable.length === 0 ? "Nothing here the desk can buy." : "Sell every unreserved specimen"}
          onClick={() => session.act((s) => sellSpecimens(s))}
        >
          Sell specimens
        </button>
        <span class="muted small">
          {sellable.length > 0 ? `about ${cr(estimate)}. ` : ""}
          {cr(SPECIMEN_PRICE)} each; the first sale of a new species pays a bonus of {cr(NEW_SPECIES_BONUS)}.
        </span>
      </div>
    </>
  );
}

// --- jobs --------------------------------------------------------------------------------

function ContractCard({ session, c }: { session: GameSession; c: Contract }) {
  const { state } = session;
  const active = c.status === "active";
  const progress = contractProgress(state, c);
  const left = c.deadline !== null ? c.deadline - state.time : 0;
  const urgent = active && left < 14 * DAY;
  const activeCount = (state.contracts ?? []).filter((x) => x.status === "active").length;

  return (
    <div class={`panel hub-contract ${active ? "active" : ""}`}>
      <div class="hub-card-head">
        <div>
          <span class="tag">{CLAN_NAMES[c.clan]}</span> <strong>{c.title}</strong>
          {c.starter && !active && (
            <>
              {" "}
              <span class="tag good" title="A gentle job near home to teach the loop.">
                New captain
              </span>
            </>
          )}
        </div>
        <span class="accent">{cr(c.reward)}</span>
      </div>
      <div class="muted small">{c.text}</div>
      {active ? (
        <>
          <div class="hub-contract-row">
            <span class={urgent ? "danger" : "muted"}>{left > 0 ? `${formatDuration(left)} left` : "Overdue"}</span>
            <span class={progress.ready ? "good" : ""}>{progress.label}</span>
          </div>
          <div class="bar hub-contract-bar">
            <span style={{ width: `${pct(progress.have, progress.need)}%` }} />
          </div>
          <button
            class="btn primary"
            disabled={!progress.ready}
            title={progress.ready ? `Turn in for ${cr(c.reward)}` : `Not yet: ${progress.label}`}
            onClick={() => session.act((s) => completeContract(s, c.id))}
          >
            Turn in
          </button>
        </>
      ) : (
        <div class="hub-contract-row">
          <span class="muted">{c.durationDays} days to complete</span>
          <button
            class="btn"
            disabled={activeCount >= 4}
            title={activeCount >= 4 ? "You can hold at most 4 active contracts." : `Sign with ${CLAN_NAMES[c.clan]}`}
            onClick={() => session.act((s) => acceptContract(s, c.id))}
          >
            Accept
          </button>
        </div>
      )}
    </div>
  );
}

function Jobs({ session }: { session: GameSession }) {
  const contracts = session.state.contracts ?? [];
  const active = contracts.filter((c) => c.status === "active");
  const offered = contracts.filter((c) => c.status === "offered");
  const past = contracts.filter((c) => c.status === "done" || c.status === "failed");

  return (
    <div class="hub-jobs">
      <section>
        <h2>Active contracts ({active.length} / 4)</h2>
        {active.length > 0 ? (
          <div class="hub-cards hub-contracts">
            {active.map((c) => (
              <ContractCard key={c.id} session={session} c={c} />
            ))}
          </div>
        ) : (
          <p class="muted">Nothing signed. Take a job below; deliveries and sample runs are turned in aboard the Intrepid.</p>
        )}
      </section>

      <section>
        <h2>On offer</h2>
        {offered.length > 0 ? (
          <div class="hub-cards hub-contracts">
            {offered.map((c) => (
              <ContractCard key={c.id} session={session} c={c} />
            ))}
          </div>
        ) : (
          <p class="muted">The boards are bare. New postings appear every few weeks.</p>
        )}
      </section>

      {past.length > 0 && (
        <details class="hub-history">
          <summary>History ({past.length})</summary>
          <table class="data">
            <tbody>
              {[...past].reverse().map((c) => (
                <tr key={c.id}>
                  <td>
                    <span class={c.status === "done" ? "good" : "danger"}>{c.status === "done" ? "Done" : "Lapsed"}</span>
                  </td>
                  <td>{c.title}</td>
                  <td class="muted">{CLAN_NAMES[c.clan]}</td>
                  <td class="num">{c.status === "done" ? cr(c.reward) : <span class="muted">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

// --- shipyard ----------------------------------------------------------------------------

function Shipyard({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = shipStats(state.ship);
  const r = stats.ratings;
  const categories = (Object.keys(UPGRADE_CATEGORY_NAMES) as UpgradeCategory[]).filter((c) => UPGRADES.some((u) => u.category === c));

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
        {categories.map((cat) => (
          <div key={cat} class="hub-vendor">
            <h3>{UPGRADE_CATEGORY_NAMES[cat]}</h3>
            <div class="hub-cards">
              {UPGRADES.filter((u) => u.category === cat).map((u) => {
                const installed = state.ship.upgrades.includes(u.id);
                const short = u.price - state.credits;
                const req = u.requires ? UPGRADES.find((x) => x.id === u.requires) : undefined;
                const missing = !!u.requires && !state.ship.upgrades.includes(u.requires);
                const reqName = req?.name ?? u.requires ?? "";
                return (
                  <div key={u.id} class={`panel hub-card ${installed ? "installed" : ""}`}>
                    <div class="hub-card-head">
                      <strong>{u.name}</strong>
                      {installed ? <span class="tag good">Installed</span> : <span class="accent">{cr(u.price)}</span>}
                    </div>
                    <div class="hub-card-tags">
                      <span class="tag" title={`Sold by the ${CLAN_NAMES[u.vendor]} clan`}>
                        {CLAN_NAMES[u.vendor]}
                      </span>
                      {missing && <span class="tag accent-tag">Requires {reqName}</span>}
                    </div>
                    <div class="muted small">{u.description}</div>
                    {!installed && (
                      <button
                        class="btn"
                        disabled={short > 0 || missing}
                        title={
                          missing
                            ? `Requires ${reqName} first.`
                            : short > 0
                              ? `You need ${cr(short)} more.`
                              : `Install for ${cr(u.price)}. Two days in the yard.`
                        }
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
  const prepaid = loan.prepaid ?? 0;
  const covered = loan.payment > 0 ? Math.floor(prepaid / loan.payment) : 0;

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
            <dt>Installment</dt>
            <dd>{cr(loan.payment)}</dd>
            <dt>Every</dt>
            <dd>{loan.intervalDays} days</dd>
            <dt>Next due</dt>
            <dd>{formatDate(loan.nextDue)}</dd>
            <dt>Prepaid</dt>
            <dd class={prepaid > 0 ? "good" : "muted"}>
              {cr(prepaid)}
              {prepaid > 0 && (
                <span class="muted">
                  {" "}
                  (covers {covered >= 1 ? `${covered} upcoming installment${covered === 1 ? "" : "s"}` : "part of the next installment"})
                </span>
              )}
            </dd>
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
        <h3 class="hub-gap">How the note works</h3>
        <ul class="hub-notes small muted">
          <li>
            Each installment is taken from your credits automatically on its due date. You never have to be aboard to pay it.
          </li>
          <li>
            Pay early and the money is banked as <strong>prepaid</strong>. It also cuts the balance, and it covers upcoming
            installments first, so your credits stay untouched until it runs out.
          </li>
          <li>
            If the installment is due and your credits are short, it counts as a <strong>missed payment</strong>: the Exchange
            adds a 10% late fee to the balance, and remembers.
          </li>
        </ul>
        <div class="btn-row">
          <button class="btn" disabled={!owed || state.credits < next} title={why(next)} onClick={() => pay(next)}>
            Pay an installment early {owed && <span class="muted">({cr(next)})</span>}
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
    </div>
  );
}

// --- depart ------------------------------------------------------------------------------

function Depart({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = shipStats(state.ship);
  const held = cargoTonnes(state.ship.cargo);
  const fuelOk = state.ship.fuel >= stats.fuelCapacity * 0.5;
  const chargeMinutes = state.foldReadyAt - state.time;
  const foldReady = chargeMinutes <= 0;

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
            {foldReady ? "Fold drive charged" : `Fold drive charging: ${formatDuration(chargeMinutes)}`}
          </li>
        </ul>
        <button class="btn primary big" onClick={() => session.go("starmap")}>
          Open star map
        </button>
        <p class="muted small">You can plot a course now and fold when the drive is ready.</p>
      </section>

      <section class="panel">
        <h2>Wait aboard the Intrepid</h2>
        <p class="muted small">
          Let the days turn. Prices drift, the fold drive charges, and the note keeps counting.{" "}
          <span class={foldReady ? "good" : "accent"}>
            {foldReady ? "The fold drive is charged." : `Fold drive ready in ${formatDuration(chargeMinutes)}.`}
          </span>
        </p>
        <div class="btn-row">
          <button class="btn" onClick={() => session.act((s) => wait(s, DAY))}>
            1 day
          </button>
          <button class="btn" onClick={() => session.act((s) => wait(s, 7 * DAY))}>
            7 days
          </button>
          {!foldReady && (
            <button class="btn primary" onClick={() => session.act((s) => wait(s, Math.ceil(s.foldReadyAt - s.time)))}>
              Until the fold drive is charged ({formatDuration(chargeMinutes)})
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
