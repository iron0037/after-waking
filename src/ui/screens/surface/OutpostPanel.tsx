/**
 * The outpost the ship is landed beside (AW-23): who runs it, fuel, its little shop, the trading post's
 * counter, and at a pirate's den, the Corsair. The rules are in src/sim/outpostservices.ts.
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
} from "../../../sim";
import { cr, tonnes } from "../../format";
import { Section } from "../../Section";
import type { GameSession } from "../../session";

/** The outpost's own board, and the work to hand in here (AW-23). */
function OutpostJobs({ session, outpostId }: { session: GameSession; outpostId: string }) {
  const { state } = session;
  const all = state.contracts ?? [];
  const offered = all.filter((c) => c.status === "offered" && c.postedAt === outpostId);
  const due = all.filter((c) => c.status === "active" && c.turnInAt === outpostId);
  const activeCount = all.filter((c) => c.status === "active").length;
  if (offered.length === 0 && due.length === 0) {
    return (
      <>
        <h3 class="hub-gap">Jobs</h3>
        <p class="muted small">No work on the board here right now. It fills up again every couple of months.</p>
      </>
    );
  }
  return (
    <>
      <h3 class="hub-gap">Jobs</h3>
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
    </>
  );
}

export function OutpostPanel({ session }: { session: GameSession }) {
  const { state, world } = session;
  const o = currentOutpost(state, world);
  if (!o) return null;
  const type = OUTPOST_TYPES[o.clan];
  const stats = effectiveStats(state);
  const room = Math.floor(stats.fuelCapacity - state.ship.fuel);
  const fuelPrice = outpostFuelPrice(state);
  const fill = Math.min(room, Math.floor(state.credits / fuelPrice));
  const stock = outpostGear(state, o);
  const cargo = (Object.entries(state.ship.cargo) as [CommodityId, number][]).filter(([, t]) => t > 0.05);
  const corsair = o.clan === "freebooters" ? HULLS_BY_ID.get("corsair") : undefined;
  return (
    <Section id="outpost" title={o.name} summary={`${CLAN_NAMES[o.clan]} ${o.kind}`}>
      <p class="small">
        {outpostTitle(o)}, {o.population} people.
      </p>
      <p class="muted small">{type.blurb}</p>

      <OutpostJobs session={session} outpostId={o.id} />

      <h3 class="hub-gap">Fuel</h3>
      <p class="small">
        {cr(fuelPrice)} a unit <span class="muted">(the Intrepid charges {cr(fuelPriceFor(state))})</span>. Tanks {Math.round(state.ship.fuel)} /{" "}
        {stats.fuelCapacity}.
      </p>
      <div class="dep-actions">
        <button class="btn" disabled={fill <= 0} onClick={() => session.act((s, w) => buyOutpostFuel(s, w, fill))} title={fill > 0 ? `${fill} units for ${cr(fill * fuelPrice)}` : room < 1 ? "Tanks are full" : "You can't afford any"}>
          Fill up{fill > 0 ? ` (${cr(fill * fuelPrice)})` : ""}
        </button>
        <button class="btn" disabled={Math.min(10, fill) <= 0} onClick={() => session.act((s, w) => buyOutpostFuel(s, w, 10))}>
          +10
        </button>
      </div>

      {o.clan === "exchange" && (
        <>
          <h3 class="hub-gap">Trading post</h3>
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
      )}

      <h3 class="hub-gap">Shop</h3>
      <p class="muted small">A few of the {CLAN_NAMES[o.clan]}'s own fittings, fitted on the spot (2 days).</p>
      <ul class="outpost-list">
        {stock.map((u) => {
          const why = outpostGearBlockers(state, world, u.id);
          const fitted = why[0] === "Already fitted.";
          return (
            <li key={u.id} title={u.description}>
              <span>
                {u.name} <span class="muted">{fitted ? "fitted" : cr(outpostGearPrice(state, o, u))}</span>
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

      {corsair && (
        <>
          <h3 class="hub-gap">The den's yard</h3>
          <p class="muted small">{corsair.blurb}</p>
          {(() => {
            const why = hullBlockers(state, "corsair");
            return (
              <div class="dep-actions">
                <button class="btn" disabled={why.length > 0} title={why[0] ?? "She'll be flown to the Intrepid and berthed there."} onClick={() => session.act((s) => buyHull(s, "corsair"))}>
                  Buy a Corsair ({cr(hullPrice(state, corsair))})
                </button>
                {why.length > 0 && <div class="muted small">{why[0]}</div>}
              </div>
            );
          })()}
        </>
      )}
    </Section>
  );
}
