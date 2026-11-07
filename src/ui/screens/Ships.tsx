/**
 * The Shipyard's ships (AW-103): what you own, what's berthed, and the hull each clan builds.
 * The rules live in src/sim/fleet.ts.
 */
import { Fragment } from "preact";
import { BASE_STATS, CLAN_NAMES, type ShipStats } from "../../data/ship";
import {
  buyHull,
  commandBlockers,
  commandShip,
  effectiveStats,
  hullBlockers,
  hullOf,
  hullPrice,
  hullsForSale,
  QUIRKS_BY_ID,
  resaleValue,
  sellShip,
  shipStats,
  type Hull,
  type ShipState,
} from "../../sim";
import { PriceStandingTag } from "../Clans";
import { cr, tonnes } from "../format";
import { Section } from "../Section";
import type { GameSession } from "../session";
import "./ships.css";

type Row = { label: string; value: (s: ShipStats) => number; show: (v: number) => string; higherIsBetter?: boolean };

const ROWS: Row[] = [
  { label: "Hold", value: (s) => s.cargoCapacityT, show: (v) => tonnes(v) },
  { label: "Fuel", value: (s) => s.fuelCapacity, show: (v) => `${v}` },
  { label: "Fold", value: (s) => s.foldRangeLy, show: (v) => `${v} ly` },
  { label: "Cruise", value: (s) => s.cruiseSpeedC, show: (v) => `${v.toFixed(2)} c` },
  { label: "Mass", value: (s) => s.hullMassT, show: (v) => tonnes(v), higherIsBetter: false },
  { label: "Hull", value: (s) => s.combatHull, show: (v) => `${v}` },
  { label: "Guns", value: (s) => s.laserDmg + s.kineticDmg, show: (v) => `${v}` },
  { label: "Shields", value: (s) => s.shieldStrength, show: (v) => `${v}` },
  { label: "Lands to", value: (s) => s.ratings.maxGravityG, show: (v) => `${v} g` },
  { label: "Pressure", value: (s) => s.ratings.maxPressureAtm, show: (v) => `${v} atm` },
  { label: "Racks", value: (s) => 16 + s.shipRackBonus, show: (v) => `${v}` },
];

/** A hull's numbers against the starter freighter's. */
function StatGrid({ stats }: { stats: ShipStats }) {
  return (
    <dl class="kv ship-stats">
      {ROWS.map((r) => {
        const v = r.value(stats);
        const b = r.value(BASE_STATS);
        const better = r.higherIsBetter === false ? v < b : v > b;
        const worse = r.higherIsBetter === false ? v > b : v < b;
        return (
          <Fragment key={r.label}>
            <dt>{r.label}</dt>
            <dd class={better ? "good" : worse ? "danger" : ""}>{r.show(v)}</dd>
          </Fragment>
        );
      })}
    </dl>
  );
}

/** The hull's top-down sprite (tools/art/manifest.json, "hull-<id>"). */
function hullSprite(hull: Hull): string {
  return hull.id === "freighter" ? "./assets/freighter.png" : `./assets/hull-${hull.id}.png`;
}

function Sprite({ hull }: { hull: Hull }) {
  return <img class="ship-sprite" src={hullSprite(hull)} alt="" />;
}

function bare(hull: Hull): ShipStats {
  return shipStats({ name: "", hull: hull.id, upgrades: [], fuel: 0, cargo: {} });
}

export function ShipsPanel({ session }: { session: GameSession }) {
  const { state } = session;
  const berthed = state.berthed ?? [];
  const current = hullOf(state.ship);
  return (
    <Section id="yard-ships" title="Ships" level={2} summary={`Flying the ${state.ship.name} (${current.name.toLowerCase()})${berthed.length ? ` · ${berthed.length} berthed` : ""}`}>
      <p class="muted small">
        Each clan builds one hull, and sells it only to captains it counts as friends. Ships you're not flying stay berthed at the Intrepid for
        free, with their own fittings, fuel and probes. The rover, the boat and their gear, the hold and the specimen racks go with you. A berthed
        ship sells back for half of what its hull and fittings cost.
      </p>
      <div class="hub-cards">
        <ShipCard session={session} ship={state.ship} index={null} />
        {berthed.map((s, i) => (
          <ShipCard key={`${s.name}-${i}`} session={session} ship={s} index={i} />
        ))}
      </div>
      <h3 class="hub-gap">From the clans' yards</h3>
      <div class="hub-cards">
        {hullsForSale().map((h) => (
          <HullCard key={h.id} session={session} hull={h} />
        ))}
      </div>
    </Section>
  );
}

function ShipCard({ session, ship, index }: { session: GameSession; ship: ShipState; index: number | null }) {
  const { state } = session;
  const hull = hullOf(ship);
  const quirk = ship.quirk ? QUIRKS_BY_ID.get(ship.quirk) : undefined;
  // The ship in use shows what the crew gets out of it (perks, the Lyceum's berths).
  const stats = index === null ? effectiveStats(state) : shipStats(ship);
  const gear = ship.upgrades.length;
  const blockers = index === null ? [] : commandBlockers(state, index);
  const value = resaleValue(ship);
  return (
    <div class={`panel hub-card ship-card ${index === null ? "installed" : ""}`}>
      <Sprite hull={hull} />
      <div class="hub-card-head">
        <strong>{ship.name}</strong>
        {index === null ? <span class="tag good">In use</span> : <span class="tag">Berthed</span>}
      </div>
      <div class="hub-card-tags">
        <span class="tag">{hull.name}</span>
        {hull.vendor && <span class="tag">{CLAN_NAMES[hull.vendor]}</span>}
        {quirk && (
          <span class={`tag ${quirk.good ? "good" : "danger"}`} title={quirk.text}>
            {quirk.name}
          </span>
        )}
      </div>
      <div class="muted small">
        {tonnes(stats.cargoCapacityT)} hold · fuel {Math.round(ship.fuel)} / {stats.fuelCapacity} · {gear} fitting{gear === 1 ? "" : "s"}
        {ship.damage && " · battle damage"}
      </div>
      {index !== null && (
        <div class="hub-actions ship-actions">
          <button
            class="btn primary"
            disabled={blockers.length > 0}
            title={blockers[0] ?? `Move the crew, the rover and the boat across (half a day).`}
            onClick={() => session.act((s) => commandShip(s, index))}
          >
            Take command
          </button>
          <button
            class="btn"
            title={`The yards pay ${cr(value)}: half the hull and its fittings.`}
            onClick={() => {
              if (confirm(`Sell the ${ship.name} for ${cr(value)}? Her fittings, fuel and probes go with her.`)) session.act((s) => sellShip(s, index));
            }}
          >
            Sell {cr(value)}
          </button>
          {blockers.length > 0 && <div class="muted small">{blockers[0]}</div>}
        </div>
      )}
    </div>
  );
}

function HullCard({ session, hull }: { session: GameSession; hull: Hull }) {
  const { state } = session;
  const price = hullPrice(state, hull);
  const blockers = hullBlockers(state, hull.id);
  const owned = [state.ship, ...(state.berthed ?? [])].filter((s) => (s.hull ?? "freighter") === hull.id).length;
  const vendor = hull.vendor!;
  return (
    <div class="panel hub-card ship-hull">
      <Sprite hull={hull} />
      <div class="hub-card-head">
        <strong>{hull.name}</strong>
        <span class="hub-price">
          <span>
            {price < hull.price && <s class="muted small hub-was">{cr(hull.price)}</s>} <span class="accent">{cr(price)}</span>
          </span>
        </span>
      </div>
      <div class="hub-card-tags">
        <span class="tag" title={`Built by the ${CLAN_NAMES[vendor]}`}>
          {CLAN_NAMES[vendor]}
        </span>
        <PriceStandingTag state={state} clan={vendor} />
        {owned > 0 && <span class="tag good">You own {owned}</span>}
      </div>
      <div class="muted small">{hull.blurb}</div>
      <StatGrid stats={bare(hull)} />
      <ul class="ship-traits small">
        {hull.pros.map((p) => (
          <li key={p} class="good">
            + {p}
          </li>
        ))}
        {hull.cons.map((c) => (
          <li key={c} class="danger">
            − {c}
          </li>
        ))}
      </ul>
      <button class="btn" disabled={blockers.length > 0} title={blockers[0] ?? `Buy for ${cr(price)}. She's berthed here, fuelled.`} onClick={() => session.act((s) => buyHull(s, hull.id))}>
        Buy
      </button>
      {blockers.length > 0 && <div class="muted small">{blockers[0]}</div>}
    </div>
  );
}
