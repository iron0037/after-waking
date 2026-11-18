/**
 * The outpost the ship is landed beside (AW-23): who runs it, fuel, its little shop, the trading post's
 * counter, and at a pirate's den, the Corsair. The rules are in src/sim/outpostservices.ts.
 *
 * The services live on the outpost's own full-screen hub (AW-256, src/ui/screens/OutpostHub.tsx); the
 * surface panel shows only a summary, and the action rail has "Enter".
 */
import { COMMODITIES, type CommodityId } from "../../../data/commodities";
import { CLAN_NAMES } from "../../../data/ship";
import {
  acceptContract,
  completeContract,
  contractPayout,
  contractProgress,
  buyHull,
  buyOutpostFuel,
  buyOutpostGear,
  currentOutpost,
  effectiveStats,
  fuelPriceFor,
  hullBlockers,
  hullPrice,
  HULLS_BY_ID,
  OUTPOST_TYPES,
  outpostFuelPrice,
  outpostGear,
  outpostGearBlockers,
  outpostGearPrice,
  outpostTitle,
  sellAtOutpost,
  sellPrice,
  TRADING_POST_RATE,
  type Outpost,
} from "../../../sim";
import { cr, tonnes } from "../../format";
import { Section } from "../../Section";
import type { GameSession } from "../../session";

/** The outpost's own board, and the work to hand in here (AW-23). */
export function OutpostJobs({ session, outpostId }: { session: GameSession; outpostId: string }) {
  const { state } = session;
  const all = state.contracts ?? [];
  const offered = all.filter((c) => c.status === "offered" && c.postedAt === outpostId);
  const due = all.filter((c) => c.status === "active" && c.turnInAt === outpostId);
  const activeCount = all.filter((c) => c.status === "active").length;
  if (offered.length === 0 && due.length === 0) {
    return <p class="muted small">No work on the board here right now. It fills up again every couple of months.</p>;
  }
  return (
    <ul class="outpost-list">
      {due.map((c) => {
        const p = contractProgress(state, c);
        return (
          <li key={c.id} title={c.text}>
            <span>
              {c.title} <span class="accent">{cr(contractPayout(state, c))}</span>
              <div class="muted small">{p.label}</div>
            </span>
            <button class="btn small primary" disabled={!p.ready} title={p.ready ? "Hand it in" : `Not yet: ${p.label}`} onClick={() => session.act((s) => completeContract(s, c.id))}>
              {c.kind === "passengers" ? "Set down" : "Hand in"}
            </button>
          </li>
        );
      })}
      {offered.map((c) => (
        <li key={c.id} title={c.text}>
          <span>
            {c.title} <span class="accent">{cr(contractPayout(state, c))}</span>
            <div class="muted small">
              {c.text} {c.durationDays} days.
            </div>
          </span>
          <button
            class="btn small"
            disabled={activeCount >= 4}
            title={activeCount >= 4 ? "You can hold at most 4 active contracts." : "Sign here; hand it in here too."}
            onClick={() => session.act((s) => acceptContract(s, c.id))}
          >
            Sign
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Fuel at the outpost's markup. */
export function OutpostFuel({ session }: { session: GameSession }) {
  const { state } = session;
  const stats = effectiveStats(state);
  const room = Math.floor(stats.fuelCapacity - state.ship.fuel);
  const fuelPrice = outpostFuelPrice(state);
  const fill = Math.min(room, Math.floor(state.credits / fuelPrice));
  return (
    <>
      <p class="small">
        {cr(fuelPrice)} a unit <span class="muted">(the Intrepid charges {cr(fuelPriceFor(state))})</span>. Tanks {Math.round(state.ship.fuel)} /{" "}
        {stats.fuelCapacity}.
      </p>
      <div class="dep-actions">
        <button
          class="btn"
          disabled={fill <= 0}
          onClick={() => session.act((s, w) => buyOutpostFuel(s, w, fill))}
          title={fill > 0 ? `${fill} units for ${cr(fill * fuelPrice)}` : room < 1 ? "Tanks are full" : "You can't afford any"}
        >
          Fill up{fill > 0 ? ` (${cr(fill * fuelPrice)})` : ""}
        </button>
        <button class="btn" disabled={Math.min(10, fill) <= 0} onClick={() => session.act((s, w) => buyOutpostFuel(s, w, 10))}>
          +10
        </button>
      </div>
    </>
  );
}

/** The Exchange's trading post: buys the hold at a discount to the Intrepid. */
export function OutpostTrade({ session }: { session: GameSession }) {
  const { state } = session;
  const cargo = (Object.entries(state.ship.cargo) as [CommodityId, number][]).filter(([, t]) => t > 0.05);
  return (
    <>
      <p class="muted small">Buys cargo at {Math.round(TRADING_POST_RATE * 100)}% of the Intrepid's price.</p>
      {cargo.length === 0 ? (
        <p class="muted small">The hold is empty.</p>
      ) : (
        <ul class="outpost-list">
          {cargo.map(([id, t]) => (
            <li key={id}>
              <span>
                {COMMODITIES[id].name} <span class="muted">{tonnes(t)}, about {cr(Math.round(t * sellPrice(state.market, id) * TRADING_POST_RATE))}</span>
              </span>
              <button class="btn small" onClick={() => session.act((s, w) => sellAtOutpost(s, w, id))}>
                Sell
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** A few of the clan's own fittings, fitted on the spot. */
export function OutpostShop({ session, outpost }: { session: GameSession; outpost: Outpost }) {
  const { state, world } = session;
  const stock = outpostGear(state, outpost);
  return (
    <>
      <p class="muted small">A few of the {CLAN_NAMES[outpost.clan]}'s own fittings, fitted on the spot (2 days).</p>
      <ul class="outpost-list">
        {stock.map((u) => {
          const why = outpostGearBlockers(state, world, u.id);
          const fitted = why[0] === "Already fitted.";
          return (
            <li key={u.id} title={u.description}>
              <span>
                {u.name} <span class="muted">{fitted ? "fitted" : cr(outpostGearPrice(state, outpost, u))}</span>
                <div class="muted small">{u.description}</div>
                {why.length > 0 && !fitted && <div class="muted small">{why[0]}</div>}
              </span>
              {!fitted && (
                <button class="btn small" disabled={why.length > 0} onClick={() => session.act((s, w) => buyOutpostGear(s, w, u.id))}>
                  Buy
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** The den's yard: the Corsair, sold nowhere else. */
export function OutpostYard({ session }: { session: GameSession }) {
  const { state } = session;
  const corsair = HULLS_BY_ID.get("corsair");
  if (!corsair) return null;
  const why = hullBlockers(state, "corsair");
  return (
    <>
      <p class="muted small">{corsair.blurb}</p>
      <div class="dep-actions">
        <button class="btn" disabled={why.length > 0} title={why[0] ?? "She'll be flown to the Intrepid and berthed there."} onClick={() => session.act((s) => buyHull(s, "corsair"))}>
          Buy a Corsair ({cr(hullPrice(state, corsair))})
        </button>
        {why.length > 0 && <div class="muted small">{why[0]}</div>}
      </div>
    </>
  );
}

/** The side panel's summary of the outpost beside the ship; its services are on its own screen (AW-256). */
export function OutpostPanel({ session }: { session: GameSession }) {
  const { state, world } = session;
  const o = currentOutpost(state, world);
  if (!o) return null;
  const all = state.contracts ?? [];
  const offered = all.filter((c) => c.status === "offered" && c.postedAt === o.id).length;
  const due = all.filter((c) => c.status === "active" && c.turnInAt === o.id).length;
  const jobs = [offered ? `${offered} on the board` : "", due ? `${due} to hand in` : ""].filter(Boolean).join(" · ");
  return (
    <Section id="outpost" title={o.name} summary={`${CLAN_NAMES[o.clan]} ${o.kind}${jobs ? ` · ${jobs}` : ""}`}>
      <p class="small">
        {outpostTitle(o)}, {o.population} people.
      </p>
      <p class="muted small">{OUTPOST_TYPES[o.clan].blurb}</p>
      {jobs && <p class="small accent">Jobs: {jobs}.</p>}
      <p class="muted small">Its fuel, shop and jobs are inside: Enter it from the toolbar.</p>
    </Section>
  );
}
