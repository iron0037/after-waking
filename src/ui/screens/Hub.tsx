/** The Intrepid: market, shipyard, Exchange counter and the way out. */
import { useEffect, useState } from "preact/hooks";
import { COMMODITIES, COMMODITY_IDS, GAS_IDS, ORE_IDS, type CommodityId } from "../../data/commodities";
import { PROBE_PRICE } from "../../data/probes";
import { CLAN_NAMES, UPGRADE_CATEGORY_NAMES, UPGRADES, type UpgradeCategory } from "../../data/ship";
import {
  acceptContract,
  buyFuel,
  buyFuelOnCredit,
  buyProbes,
  fuelCreditLimit,
  FUEL_CREDIT_MARKUP,
  fuelCreditAvailable,
  buyUpgrade,
  cargoTonnes,
  completeContract,
  contractPayout,
  contractProgress,
  crewBonuses,
  crewCut,
  effectiveStats,
  dailyUpkeep,
  dailyWages,
  DAY,
  departureReadyAt,
  fuelCreditPastLimit,
  GRACE_FEE,
  graceAvailableAt,
  LIFELINE_FUEL,
  rushRefit,
  rushRefitCost,
  UPKEEP_RATE_PER_DAY,
  formatDate,
  formatDuration,
  fuelPrice,
  HELM_LOSING_STREAK,
  helmStatus,
  loanOutlook,
  loanRate,
  marketForecast,
  reservedCargo,
  sellableTonnes,
  UPGRADE_INSTALL_DAYS,
  NEW_SPECIES_BONUS,
  payLoan,
  sell,
  sellAll,
  sellPrice,
  sellSpecimens,
  shipSpecimenSlots,
  shipStats,
  SPECIMEN_PRICE,
  specimenCount,
  wait,
  type Contract,
} from "../../sim";
import { cr, pct, tonnes } from "../format";
import { HiringHall, Roster } from "../Crew";
import { Section, unfoldSection } from "../Section";
import { useSession, type GameSession } from "../session";
import "./hub.css";

type Tab = "market" | "jobs" | "shipyard" | "crew" | "exchange" | "depart";

const TABS: { id: Tab; label: string }[] = [
  { id: "market", label: "Market" },
  { id: "shipyard", label: "Shipyard" },
  { id: "crew", label: "Crew" },
  { id: "exchange", label: "Exchange" },
  // Jobs come last before departure: a contract's clock starts when it's accepted.
  { id: "jobs", label: "Jobs" },
  { id: "depart", label: "Depart" },
];

const TAB_BLURB: Record<Tab, string> = {
  market: "The Exchange clan runs the Concourse scales. Everything is weighed, nothing is free.",
  jobs: "The clan boards by the Concourse gate. Paper contracts, wet signatures, and a deadline on every one.",
  shipyard: "Gantries, sparks and clan salesmen. Every part on the shelf was pulled from somebody's grandmother's engine room.",
  crew: "The crew bunks are a long walk from the Concourse, but the hiring hall is always open. Everyone has a clan, a price and an opinion about your last fold.",
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

  const [hallPing, setHallPing] = useState(0);
  // "Go to the hiring hall" (from the crew overlay or an empty post): show the Crew tab, hall unfolded and in view.
  useEffect(() => {
    if (!session.hallRequested) return;
    session.hallRequested = false;
    unfoldSection("crew-hall");
    setTab("crew");
    setHallPing((n) => n + 1);
    // The Crew tab may not be on screen yet: look for the hall for a moment.
    let tries = 0;
    const scrollToHall = () => {
      const hall = document.getElementById("sec-crew-hall");
      if (hall) hall.scrollIntoView({ block: "start" });
      else if (++tries < 20) setTimeout(scrollToHall, 50);
    };
    setTimeout(scrollToHall, 60);
  });

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
        {tab === "crew" && <Crew session={session} hallPing={hallPing} />}
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

/** Market Wire: the price a week out, with an arrow for the direction. */
function Forecast({ now, next }: { now: number; next: number }) {
  const diff = next - now;
  const flat = Math.abs(diff) < Math.max(0.5, now * 0.005);
  return (
    <td class="num" title={flat ? "Holding steady" : `${diff > 0 ? "Rising" : "Falling"} by ${cr(Math.abs(diff))} a tonne`}>
      <span class={flat ? "muted" : diff > 0 ? "good" : "danger"}>
        {flat ? "→" : diff > 0 ? "▲" : "▼"} {cr(next)}
      </span>
    </td>
  );
}

function Market({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = effectiveStats(state);
  const forecast = marketForecast(state);
  const cargo = state.ship.cargo;
  const held = cargoTonnes(cargo);
  const reserved = reservedCargo(state);
  const salePrice = crewBonuses(state).salePrice;
  const sellable = COMMODITY_IDS.reduce((sum, id) => sum + sellableTonnes(state, id), 0);
  const heldBack = held - sellable;
  const estimate = COMMODITY_IDS.reduce((sum, id) => sum + sellableTonnes(state, id) * sellPrice(state.market, id) * salePrice, 0);
  const crewCutNow = crewCut(state, estimate);
  const price = fuelPrice(state.market);
  const room = Math.floor(stats.fuelCapacity - state.ship.fuel);
  const affordable = Math.floor(state.credits / price);
  const canBuy = room >= 1 && affordable >= 1;
  const creditUnits = fuelCreditAvailable(state);
  const buy = (n: number) => session.act((s) => buyFuel(s, n));

  const row = (id: CommodityId) => {
    const have = cargo[id] ?? 0;
    const aboard = have > 0.05;
    const p = sellPrice(state.market, id) * salePrice;
    const free = sellableTonnes(state, id);
    const kept = Math.min(have, reserved[id] ?? 0);
    return (
      <tr key={id}>
        <td>
          <span class="swatch" style={{ background: COMMODITIES[id].color }} />
          <span class="hub-name" title={COMMODITIES[id].blurb}>
            {COMMODITIES[id].name}
          </span>
        </td>
        <td class="num">
          {aboard ? tonnes(have) : <span class="muted">-</span>}
          {aboard && kept > 0.05 && (
            <div class="accent small" title="Held back for an active delivery contract. Turn it in under Jobs.">
              {tonnes(kept)} for contract
            </div>
          )}
        </td>
        <td class="num">{cr(p)}</td>
        <td class="num">
          <Trend mult={state.market.mult[id]} />
        </td>
        {forecast && <Forecast now={p} next={(forecast[id] ?? sellPrice(state.market, id)) * salePrice} />}
        <td class="num">{aboard ? cr(have * p) : <span class="muted">-</span>}</td>
        <td class="num">
          <button
            class="btn"
            disabled={free <= 0.05}
            title={
              !aboard
                ? "None aboard"
                : free <= 0.05
                  ? "All of it is held for a delivery contract. Turn it in under Jobs."
                  : kept > 0.05
                    ? `Sell ${tonnes(free)}, keeping ${tonnes(kept)} for your contract`
                    : `Sell all ${COMMODITIES[id].name.toLowerCase()}`
            }
            onClick={() => session.act((s) => sell(s, id, sellableTonnes(s, id)))}
          >
            Sell
          </button>
        </td>
      </tr>
    );
  };

  return (
    <div class="hub-grid">
      <section class="panel hub-wide">
        <div class="hub-section-head">
          <h2>Ore &amp; gas buyers</h2>
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
              {forecast && (
                <th class="num" title="Market Wire: where the price is heading over the next week">
                  Next week
                </th>
              )}
              <th class="num">Hold value</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr class="hub-subhead">
              <th colSpan={forecast ? 7 : 6}>Ores</th>
            </tr>
            {ORE_IDS.map(row)}
            <tr class="hub-subhead">
              <th colSpan={forecast ? 7 : 6} title="Skimmed from gas and ice giants by atmospheric probes. Thin markets: a few tonnes move the price.">
                Gases
              </th>
            </tr>
            {GAS_IDS.map(row)}
          </tbody>
        </table>
        <div class="hub-actions">
          <button class="btn primary" disabled={sellable <= 0.05} onClick={() => session.act((s) => sellAll(s))}>
            Sell entire hold
          </button>
          <span class="muted">
            {sellable > 0.05
              ? `about ${cr(estimate)} (big lots push the price down as they sell)`
              : held > 0.05
                ? "Everything aboard is held for delivery contracts."
                : "The hold is empty."}
            {sellable > 0.05 && heldBack > 0.05 && <span class="accent"> · keeps {tonnes(heldBack)} for your contracts</span>}
            {sellable > 0.05 && crewCutNow > 0 && (
              <span class="accent" title="Set under Crew. Paid as bonuses after each sale, split by level.">
                {" "}
                · crew share {Math.round((state.crewShare ?? 0) * 100)}%: about {cr(crewCutNow)} of this goes to the crew
              </span>
            )}
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
        {room >= 1 && (
          <div class="hub-credit-fuel">
            <button
              class="btn"
              disabled={creditUnits < 1}
              title={
                creditUnits < 1
                  ? fuelCreditPastLimit(state)
                    ? `The Exchange won't extend more credit against your note, apart from the ${LIFELINE_FUEL}-unit lifeline.`
                    : "The Exchange won't extend more credit against your note."
                  : `The Exchange advances fuel against your note at a ${Math.round((FUEL_CREDIT_MARKUP - 1) * 100)}% markup.`
              }
              onClick={() => session.act((s) => buyFuelOnCredit(s, room))}
            >
              Fill on credit{" "}
              {creditUnits >= 1 && (
                <span class="muted">
                  (+{creditUnits} units, {cr(Math.round(creditUnits * price * FUEL_CREDIT_MARKUP))} on your note)
                </span>
              )}
            </button>
            <span class="muted small">Note limit {cr(fuelCreditLimit(state))}</span>
          </div>
        )}
        {fuelCreditPastLimit(state) && (
          <p class="small accent" title="The Exchange never leaves a captain grounded.">
            Your note is at its limit, but the Exchange will still top the tanks up to {LIFELINE_FUEL} units on credit
            {state.ship.fuel >= LIFELINE_FUEL ? " if they ever run lower than that" : ""}: enough for a short trip to earn your way out.
          </p>
        )}
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
  const specimenPrice = Math.round(SPECIMEN_PRICE * crewBonuses(state).specimenPrice);
  const estimate = sellable.reduce((sum, r) => sum + r.count * specimenPrice + (r.isNew ? NEW_SPECIES_BONUS : 0), 0);

  return (
    <>
      <div class="hub-section-head">
        <h2>Lyceum specimen desk</h2>
        <span class={held >= shipSpecimenSlots(state) ? "accent" : "muted"}>
          Containment: {held} / {shipSpecimenSlots(state)}
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
          {cr(specimenPrice)} each; the first sale of a new species pays a bonus of {cr(NEW_SPECIES_BONUS)}.
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
  const payout = contractPayout(state, c);
  const payTitle = payout !== c.reward ? `${cr(c.reward)} posted, adjusted for your comms officer` : undefined;

  return (
    <div class={`panel hub-contract ${active ? "active" : ""}`}>
      <div class="hub-card-head">
        <div>
          <span class="tag">{CLAN_NAMES[c.clan]}</span> <strong>{c.title}</strong>
          {c.exclusive && (
            <>
              {" "}
              <span class="tag accent-tag" title="A Preferred Captain's private offer: it never reaches the public board.">
                Private
              </span>
            </>
          )}
          {c.starter && !active && (
            <>
              {" "}
              <span class="tag good" title="A gentle job near home to teach the loop.">
                New captain
              </span>
            </>
          )}
        </div>
        <span class="accent" title={payTitle}>{cr(payout)}</span>
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
            title={progress.ready ? `Turn in for ${cr(payout)}` : `Not yet: ${progress.label}`}
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

/** Helm's Small Operators' Fund: where a struggling captain stands with it. */
function HelmFund({ session }: { session: GameSession }) {
  const { state } = session;
  const status = helmStatus(state);
  const h = state.helm;
  const asks = (state.contracts ?? []).filter((c) => c.obligation && c.status === "active");
  return (
    <section class="panel hub-helm">
      <h3>Helm's Small Operators' Fund</h3>
      <p class="muted small">
        Helm wants plenty of small captains flying. After {HELM_LOSING_STREAK} losing trips in a row, or if you dock unable to cover
        wages and upkeep, it pays a month of wages and upkeep, fills your tanks and refits the drive. It also pays a small
        operator's first distress call. In return it asks you to fly one of its surveys, and it remembers if you don't.
      </p>
      <div class="small">
        {status.eligible ? (
          <span class="good">
            You qualify: {status.assistsLeft} {status.assistsLeft === 1 ? "assist" : "assists"} left this year
            {h?.rescueCovered ? "" : ", plus your first distress call"}.
          </span>
        ) : (
          <span class="muted">{status.reason}</span>
        )}
        {h && h.streak > 0 && <span class="muted"> Losing trips in a row: {h.streak}.</span>}
      </div>
      {asks.length > 0 && (
        <div class="small accent">
          Helm is waiting on: {asks.map((c) => `"${c.title}" (${formatDuration(Math.max(0, (c.deadline ?? state.time) - state.time))} left)`).join(", ")}.
        </div>
      )}
    </section>
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

      <HelmFund session={session} />

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
                  <td class="num">{c.status === "done" ? cr(c.paid ?? c.reward) : <span class="muted">-</span>}</td>
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

/** A ship stat as the crew gets to use it, noting the hardware figure when perks raise it. */
function Perked({ eff, base, unit = "" }: { eff: number; base: number; unit?: string }) {
  return (
    <>
      {eff}
      {unit}
      {eff !== base && (
        <span class="good small" title="Raised by a crew perk">
          {" "}
          (hardware {base}
          {unit}, +perks)
        </span>
      )}
    </>
  );
}

/** Atmospheric probes: bought one at a time (or to fill the racks) once a bay is installed. */
function ProbeRack({ session, capacity }: { session: GameSession; capacity: number }) {
  const { state } = session;
  const have = state.ship.probes ?? 0;
  const room = capacity - have;
  const afford = Math.floor(state.credits / PROBE_PRICE);
  const fill = Math.min(room, afford);
  const why = room <= 0 ? "The probe racks are full." : afford <= 0 ? `A probe costs ${cr(PROBE_PRICE)}.` : "";
  return (
    <div class="panel hub-card installed">
      <div class="hub-card-head">
        <strong>Atmospheric probes</strong>
        <span class="hub-price">
          <span class="accent">{cr(PROBE_PRICE)}</span>
          <span class="muted small">each</span>
        </span>
      </div>
      <div class="hub-card-tags">
        <span class="tag">
          In the bay {have} / {capacity}
        </span>
      </div>
      <div class="muted small">
        Fired into gas and ice giants by your science officer. A probe that comes back up is reused; one that doesn't has to be replaced.
      </div>
      <div class="btn-row">
        <button class="btn" disabled={why !== ""} title={why || `Buy one probe for ${cr(PROBE_PRICE)}`} onClick={() => session.act((s) => buyProbes(s, 1))}>
          Buy 1
        </button>
        <button
          class="btn"
          disabled={why !== "" || fill < 2}
          title={why || (fill < 2 ? "Buy one at a time." : `Buy ${fill} for ${cr(fill * PROBE_PRICE)}`)}
          onClick={() => session.act((s) => buyProbes(s, fill))}
        >
          Fill the racks{fill >= 2 ? ` (${fill})` : ""}
        </button>
      </div>
    </div>
  );
}

function Shipyard({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = effectiveStats(state);
  const hw = shipStats(state.ship);
  const r = stats.ratings;
  const categories = (Object.keys(UPGRADE_CATEGORY_NAMES) as UpgradeCategory[]).filter((c) => UPGRADES.some((u) => u.category === c));
  const queuedIds = new Set((state.yard ?? []).flatMap((j) => (j.kind === "install" && j.upgradeId ? [j.upgradeId] : [])));

  return (
    <div class="hub-grid">
      <Section id="yard-ship" title={state.ship.name} level={2} summary={`${tonnes(stats.cargoCapacityT)} hold · drill ${stats.drillMaxDepthM} m`}>
        <h3>Ship</h3>
        <dl class="kv">
          <dt>Hull mass</dt>
          <dd>{tonnes(stats.hullMassT)}</dd>
          <dt>Cargo capacity</dt>
          <dd>{tonnes(stats.cargoCapacityT)}</dd>
          <dt>Fuel capacity</dt>
          <dd>{stats.fuelCapacity} units</dd>
          <dt>Fold range</dt>
          <dd>
            <Perked eff={stats.foldRangeLy} base={hw.foldRangeLy} unit=" ly" />
          </dd>
          <dt>Cruise speed</dt>
          <dd>
            {stats.cruiseSpeedC.toFixed(2)} c
            {stats.cruiseSpeedC !== hw.cruiseSpeedC && <span class="good small"> (hardware {hw.cruiseSpeedC.toFixed(2)} c, +perks)</span>}
          </dd>
          <dt>Sensors</dt>
          <dd>Tier {stats.sensorTier}</dd>
        </dl>
        <h3 class="hub-gap">Drill &amp; rover</h3>
        <dl class="kv">
          <dt>Drill depth</dt>
          <dd>
            <Perked eff={stats.drillMaxDepthM} base={hw.drillMaxDepthM} unit=" m" />
          </dd>
          <dt>Drill rate</dt>
          <dd>{stats.drillRateTph} t/h</dd>
          <dt>Rover cargo</dt>
          <dd>
            {tonnes(stats.roverCargoT)}
            {stats.roverCargoT !== hw.roverCargoT && <span class="good small"> (hardware {tonnes(hw.roverCargoT)}, +perks)</span>}
          </dd>
          <dt>Rover energy</dt>
          <dd>
            <Perked eff={stats.roverEnergy} base={hw.roverEnergy} />
          </dd>
          <dt>Rover climbs</dt>
          <dd class={stats.roverCanClimb ? "good" : "muted"}>{stats.roverCanClimb ? "Mountains" : "Flat and rough only"}</dd>
        </dl>
        <h3 class="hub-gap">Landing ratings</h3>
        <dl class="kv">
          <dt>Gravity</dt>
          <dd>
            up to <Perked eff={r.maxGravityG} base={hw.ratings.maxGravityG} unit=" g" />
          </dd>
          <dt>Pressure</dt>
          <dd>
            up to <Perked eff={r.maxPressureAtm} base={hw.ratings.maxPressureAtm} unit=" atm" />
          </dd>
          <dt>Temperature</dt>
          <dd>
            {r.minTempC} to {r.maxTempC} °C
          </dd>
          <dt>Corrosion</dt>
          <dd class={r.corrosionProof ? "good" : "muted"}>{r.corrosionProof ? "Proofed" : "Unprotected"}</dd>
          <dt>Radiation</dt>
          <dd>up to level {r.maxRadiation}</dd>
        </dl>
      </Section>

      <section class="hub-upgrades">
        <p class="muted small hub-upkeep-note">
          Installed gear costs upkeep: {(UPKEEP_RATE_PER_DAY * 100).toFixed(2)}% of its price per day, settled with the crew's wages whenever you're back
          aboard. Yours comes to <strong class="accent">{cr(dailyUpkeep(state))}</strong> a day. Orders are fitted one at a time ({UPGRADE_INSTALL_DAYS} days
          each) alongside refits and Lyceum courses; the ship can't fold out until the yard is done.
        </p>
        {categories.map((cat) => {
          const inCat = UPGRADES.filter((u) => u.category === cat);
          const owned = inCat.filter((u) => state.ship.upgrades.includes(u.id)).length;
          const fitting = inCat.filter((u) => queuedIds.has(u.id)).length;
          return (
          <Section key={cat} id={`yard-${cat}`} title={UPGRADE_CATEGORY_NAMES[cat]} class="hub-vendor" summary={`${owned} of ${inCat.length} installed${fitting > 0 ? `, ${fitting} being fitted` : ""}`}>
            <div class="hub-cards">
              {UPGRADES.filter((u) => u.category === cat).map((u) => {
                const installed = state.ship.upgrades.includes(u.id);
                const job = (state.yard ?? []).find((j) => j.kind === "install" && j.upgradeId === u.id);
                const short = u.price - state.credits;
                const req = u.requires ? UPGRADES.find((x) => x.id === u.requires) : undefined;
                // A queued install counts toward a requirement, as the sim allows ordering the next tier behind it.
                const missing = !!u.requires && !state.ship.upgrades.includes(u.requires) && !queuedIds.has(u.requires);
                const reqName = req?.name ?? u.requires ?? "";
                return (
                  <div key={u.id} class={`panel hub-card ${installed || job ? "installed" : ""}`}>
                    <div class="hub-card-head">
                      <strong>{u.name}</strong>
                      {installed ? (
                        <span class="tag good">Installed</span>
                      ) : job ? (
                        <span class="tag accent-tag">Installing</span>
                      ) : (
                        <span class="hub-price">
                          <span class="accent">{cr(u.price)}</span>
                          <span class="muted small">+ {UPGRADE_INSTALL_DAYS} days in the yard</span>
                        </span>
                      )}
                    </div>
                    <div class="hub-card-tags">
                      <span class="tag" title={`Sold by the ${CLAN_NAMES[u.vendor]} clan`}>
                        {CLAN_NAMES[u.vendor]}
                      </span>
                      {missing && <span class="tag accent-tag">Requires {reqName}</span>}
                    </div>
                    <div class="muted small">{u.description}</div>
                    <div class="muted small" title={`Installed gear costs ${(UPKEEP_RATE_PER_DAY * 100).toFixed(2)}% of its price per day to keep running.`}>
                      Upkeep {cr(u.price * UPKEEP_RATE_PER_DAY)} / day
                    </div>
                    {job && (
                      <div class="accent small">
                        Installing: ready in {formatDuration(Math.max(0, job.readyAt - state.time))}
                      </div>
                    )}
                    {!installed && !job && (
                      <button
                        class="btn"
                        disabled={short > 0 || missing}
                        title={
                          missing
                            ? `Requires ${reqName} first.`
                            : short > 0
                              ? `You need ${cr(short)} more.`
                              : `Install for ${cr(u.price)}. ${UPGRADE_INSTALL_DAYS} days in the yard.`
                        }
                        onClick={() => session.act((s) => buyUpgrade(s, u.id))}
                      >
                        Buy
                      </button>
                    )}
                  </div>
                );
              })}
              {cat === "sensors" && stats.probeCapacity > 0 && <ProbeRack session={session} capacity={stats.probeCapacity} />}
            </div>
          </Section>
          );
        })}
      </section>
    </div>
  );
}

// --- crew --------------------------------------------------------------------------------

function Crew({ session, hallPing }: { session: GameSession; hallPing: number }) {
  const { state } = session;
  const wages = dailyWages(state);
  const recruits = (state.recruits ?? []).length;
  return (
    <div class="hub-crew">
      <Section id="crew-roster" title="Your crew" level={2} summary={`${cr(wages)} a day in wages, ${cr(dailyUpkeep(state))} in upkeep`}>
        <Roster session={session} />
      </Section>
      <Section id="crew-hall" title="Hiring hall" level={2} revealKey={hallPing || null} summary={`${recruits} looking for a berth`}>
        <HiringHall session={session} />
      </Section>
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
  const rate = loanRate(state);
  const outlook = loanOutlook(loan, rate);
  const graceAt = graceAvailableAt(loan);
  const graceNow = state.time >= graceAt;

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
            <dt>Hardship deferral</dt>
            <dd class={graceNow ? "good" : "muted"}>
              {graceNow ? "Available now" : `Used ${formatDate(loan.graceAt ?? 0)}; next available ${formatDate(graceAt)}`}
            </dd>
            <dt>Annual rate</dt>
            <dd>
              {(rate * 100).toFixed(1)}%
              {rate !== loan.annualRate && <span class="good small"> (note says {(loan.annualRate * 100).toFixed(1)}%; your comms officer got it cut)</span>}
            </dd>
            <dt>Next installment</dt>
            <dd>
              {cr(outlook.nextInterest)} interest
              <div class="muted small">{cr(Math.max(0, next - outlook.nextInterest))} off the principal</div>
            </dd>
            <dt>Paid off</dt>
            <dd>
              {formatDate(outlook.payoffAt)}
              <div class="muted small">
                {outlook.installments} more installment{outlook.installments === 1 ? "" : "s"}, if paid on time
              </div>
            </dd>
            <dt>Interest to come</dt>
            <dd>{cr(outlook.totalInterest)}</dd>
            <dt>Credits on hand</dt>
            <dd>{cr(state.credits)}</dd>
          </dl>
        ) : (
          <p class="good">Paid in full. The ship is yours, and the clerks look at you differently.</p>
        )}
        <h3 class="hub-gap">How the note works</h3>
        <ul class="hub-notes small muted">
          <li>
            The note pays itself down. On each due date the Exchange adds that period's interest to the balance, then takes
            the installment. Whatever the installment covers beyond the interest reduces the principal, so the interest
            shrinks over time. There's no fixed term: the note ends when the balance reaches zero.
          </li>
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
          <li>
            Once a year, though, the Exchange grants a <strong>hardship deferral</strong>: an installment you can't cover is pushed to
            the next due date for a {Math.round(GRACE_FEE * 100)}% fee instead of counting as missed. It's used automatically, and it
            isn't offered again for a year.
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
  const stats = effectiveStats(state);
  const held = cargoTonnes(state.ship.cargo);
  const fuelOk = state.ship.fuel >= stats.fuelCapacity * 0.5;
  const refitLeft = Math.max(0, state.foldReadyAt - state.time);
  const jobs = [...(state.yard ?? [])].sort((a, b) => a.readyAt - b.readyAt);
  const readyAt = departureReadyAt(state);
  const waitMinutes = Math.max(0, Math.ceil(readyAt - state.time));
  const pending = refitLeft > 0 || jobs.length > 0;
  const rushOne = rushRefitCost(state, 1);
  const rushThree = rushRefitCost(state, 3);
  const rushAll = rushRefitCost(state, refitLeft / DAY);
  const rushWhy = (cost: number): string =>
    state.credits < cost ? `The yard crews want ${cr(cost)}; you need ${cr(cost - state.credits)} more.` : `Pay ${cr(cost)} to cut the refit short.`;
  const rush = (days: number): void => {
    session.act((s) => rushRefit(s, days));
  };

  return (
    <div class="hub-grid">
      <section class="panel">
        <h2>Before you can leave</h2>
        {pending ? (
          <>
            <ul class="hub-checklist">
              {refitLeft > 0 && (
                <li class="danger">
                  <span class="mark">✘</span>
                  Fold-drive refit: ready in {formatDuration(refitLeft)}
                  <div class="muted small">Folding wears the drive; the engineers scrub it before the next fold. Yard crews will rush it for a fee.</div>
                  <div class="btn-row hub-rush">
                    {refitLeft > DAY && (
                      <button class="btn" disabled={state.credits < rushOne} title={rushWhy(rushOne)} onClick={() => rush(1)}>
                        Rush 1 day <span class="muted">({cr(rushOne)})</span>
                      </button>
                    )}
                    {refitLeft > 3 * DAY && (
                      <button class="btn" disabled={state.credits < rushThree} title={rushWhy(rushThree)} onClick={() => rush(3)}>
                        Rush 3 days <span class="muted">({cr(rushThree)})</span>
                      </button>
                    )}
                    <button class="btn" disabled={state.credits < rushAll} title={rushWhy(rushAll)} onClick={() => rush(refitLeft / DAY)}>
                      Rush all <span class="muted">({cr(rushAll)})</span>
                    </button>
                  </div>
                </li>
              )}
              {jobs.map((j, i) => (
                <li key={`${j.kind}-${j.upgradeId ?? j.station}-${i}`} class="danger">
                  <span class="mark">✘</span>
                  {j.kind === "install" ? `Yard: installing ${j.label}` : `Lyceum: ${j.label}`} · ready in{" "}
                  {formatDuration(Math.max(0, j.readyAt - state.time))}
                </li>
              ))}
            </ul>
            <p class="small muted">
              Everything above runs at the same time, so the ship can leave when the <strong>longest</strong> one is done. Nothing here stops you
              plotting a course meanwhile.
            </p>
            <button class="btn primary big" disabled={waitMinutes <= 0} onClick={() => session.act((s) => wait(s, Math.max(0, Math.ceil(departureReadyAt(s) - s.time))))}>
              Wait until ready ({formatDuration(waitMinutes)})
            </button>
          </>
        ) : (
          <ul class="hub-checklist">
            <li class="good">
              <span class="mark">✔</span>
              Nothing pending: the drive is refitted and the yard is clear.
            </li>
          </ul>
        )}
      </section>

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
          <li class={pending ? "danger" : "good"}>
            <span class="mark">{pending ? "✘" : "✔"}</span>
            {pending ? `Ship can leave in ${formatDuration(waitMinutes)}` : "Ship can leave now"}
          </li>
        </ul>
        <button class="btn primary big" onClick={() => session.go("starmap")}>
          Open star map
        </button>
        <p class="muted small">You can plot a course now; "Fold when ready" waits out the refit and the yard for you.</p>
      </section>

      <section class="panel">
        <h2>Wait aboard the Intrepid</h2>
        <p class="muted small">
          Let the days turn. Prices drift, the fold drive is refitted, and the note keeps counting. Wages and equipment upkeep are settled while
          you're aboard.
        </p>
        <div class="btn-row">
          <button class="btn" onClick={() => session.act((s) => wait(s, DAY))}>
            1 day
          </button>
          <button class="btn" onClick={() => session.act((s) => wait(s, 7 * DAY))}>
            7 days
          </button>
        </div>
      </section>
    </div>
  );
}
