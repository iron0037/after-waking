# Balance (AW-37) **[DECIDED 2026-10-23, first pass]**

## Principles (from the user)

1. **Even challenge.** Many games are hard early and trivial later. Ours should stay challenging, with places to explore that are as hard or harder once you're established.
2. **Nothing spirals.** Inexperienced players shouldn't get trapped by compounding problems (no money → no fuel → angry crew → …). There is always a way back on your feet. It may be slow or expensive, but it always exists.
3. **Features don't inflate.** Every new reward (crew levels, perks, upgrades) is measured against the economy before it ships.
4. **Mining is generally profitable, and investments pay off.** Values are realistic first, flexed for fun.

## How we measure

- `BALANCE=1 npx vitest run tests/career.test.ts` runs 60-trip careers on 6 seeds for two profiles. It reports results in buckets of 10 trips: days, revenue, costs and profit per trip; profit per 100 days; % profitable; worst trip; credits; loan; crew level; rescues. It also counts careers that ended broke and deep in debt.
  - **Competent:** picks the best systems, surveys, and buys the standard upgrades.
  - **Novice:** picks systems at random, takes the chart's default region, never surveys, buys the obvious upgrades, and calls for rescue when stranded.
- `BALANCE=1 npx vitest run tests/balance.test.ts`: 15-trip strategy comparison (bare / survey / upgrades / both) on 12 seeds.

## Targets

| Measure | Target |
|---|---|
| Days per trip | 30–90 |
| Competent profit per trip, first 10 trips | about 8–14k cr, roughly 80% of trips profitable |
| Novice profit per trip, early | positive (about 3–9k cr), at least 65% profitable |
| Careers ending broke and in deep debt | none |
| Growth in profit per 100 days, late vs early (competent) | ideally ≤ 2×, with the rest absorbed by future money sinks |
| Upgrades | clearly beat not investing over 15+ trips |

## Before → after (60-trip careers, 6 seeds)

| | Before | After |
|---|---|---|
| Days per trip | 20–24 | 27–32 |
| Competent profit per trip, first 10 trips | 36.4k cr | 9.9k cr |
| Competent profit per 100 days, early → late | 147k → 217k cr | 27k → 59k cr |
| Competent credits after 60 trips | 2.3M cr | 0.66M cr |
| Competent trips profitable, early | 95% | 80% |
| Novice profit per trip, early | 16k cr (with the realistic novice) | 8.7k cr |
| Novice trips profitable | about 68% | 70–80% across the whole career |
| Careers ending broke | 0 (but 1 of 6 soft-locked at home in an intermediate run) | 0 |

The 15-trip strategy report now shows the investment payoff clearly. Late-trip profit per trip:
- Bare play: about 1k cr. Nearby deposits get worked out, so a captain who never invests stalls.
- Surveys only: about 5.7k cr.
- Upgrades only: about 8.4k cr.
- Surveys and upgrades: about 11.1k cr.

## What changed

- **Ore prices halved, markets thinner.** `basePrice` ×0.5 and `marketDepthT` ×0.6 in `src/data/commodities.ts`. Big lots now depress prices more.
- **Fold-drive refit** (replaces "recharge"):
  - Folding damages the drive, and engineers must scrub it: 4 days + 1.5 per ly (`foldRefitMinutes`).
  - The engineer's level shortens it (−4% per level). The navigator's old recharge bonus became −2% flight time per level.
  - At the Intrepid, yard crews rush it for 400 cr per day saved.
  - The return refit happens at home, so it naturally lengthens the time between trips.
- **Equipment upkeep.** Installed upgrades cost 0.06% of their price per day, paid at the Intrepid with wages. A bigger, better ship costs more to run, which flattens the late curve.
- **Bulk Seller** reduces price impact by 30% (was 50%), because it rewarded the biggest haulers most.
- **Parallel yard work.**
  - Installs (one bay; they queue) and Lyceum courses no longer stop the clock. They run while you do other things.
  - The ship leaves when the longest item is done: the refit, the last install, or the last course.
- **Ways back from a bad run:**
  - **Hardship grace.** Once a year, an installment you can't cover is deferred for a 3% fee instead of counting as missed with a 10% penalty.
  - **Lifeline fuel.** The Exchange always tops the tanks up to 20 units on credit, even past the note's limit. This fixed a soft-lock seen in testing.
  - **Standing survey work.** Helm always has a survey contract on the board that needs no mining, paying the fuel cost ×1.5 + 2,000 cr.
  - **Distress call** (AW-99) and **fuel on credit** (AW-104), from earlier.
  - **Helm's Small Operators' Fund** (`src/sim/helm.ts`). Helm wants many small captains flying, so it props up struggling ones:
    - **Who qualifies:** net worth under 60k cr.
    - **When it steps in:** after 2 losing trips in a row (measured by net worth from departure to docking), or when you dock unable to cover wages and upkeep.
    - **What it gives:** a month of wages and upkeep, a full tank and an immediate refit. It also pays a small operator's first distress call.
    - **The catch:**
      - Each assist adds a Helm survey to fly within 150 days, paying only its costs.
      - Skipping it means Helm shuns you for 2 years.
      - Help is capped at 2 assists a year.
    - **Effect in the career report:**
      - Novice missed loan payments fell from 4 to 2 on average, and their debt runs lower.
      - The competent captain is barely affected; their early-to-late growth fell to about 1.8×.
  - **Exchange insurance** is deferred to combat (M3), when there are real losses to insure.

## Frontier pass **[DECIDED 2026-10-25]** (playtest 8)

The user found no reason to leave the safe, nearby worlds, so the first scouts' work now shows.

| Where | Deposit tonnage | Deposits already worked out |
|---|---|---|
| Home worlds | 0.9× | 20% |
| Charted worlds | 1.0× | 10% |
| Past the charted stars | 1.25×, plus 5% per ly beyond 6 ly (capped at 1.8×) | none |

- **Positions stay put.** Worked-out deposits are removed after placement, so positions, ids and plant sites never move.
- **Bulk deliveries** now pay a 35 cr/t haulage fee on top of the goods' value.
- **New gear:**
  - cargo pods: +150 t after the expanded hold, 48k cr,
  - a rover fast charger: 2× charge rate,
  - uprated drive motors: 25% faster,
  - and the probe bay now includes one probe.

**Career report after the pass** (6 seeds, 60 trips):

| | Early profit per trip | Late profit per trip | Early trips profitable |
|---|---|---|---|
| Competent | about 6.7k cr | about 13k cr | 70% |
| Novice | about 6.6k cr | about 10k cr | 70% |

- Growth comes from ranging out. The competent captain's profit per 100 days rises about 2.7×, a bit more than before, because the frontier rewards those who invest in range and landing ratings.
- No careers went broke and the novice crew stayed.
- An intermediate tuning (home 0.6× and 40% worked out) caused a novice spiral: debt over 100k cr and four crew quitting. It was rejected.

## Still open

- **Late-game money needs somewhere to go.** A competent captain ends 60 trips with about 0.66M cr. The real sinks are ship classes (AW-103), research (AW-15), outposts (M4) and, eventually, the Intrepid's own fold. Until they exist, late-game wealth is expected.
- **Hard content later on.** Worlds farther out should be richer but harsher (environment ratings, hostile life, combat in M3), so an established captain still has frontier challenges. Generation currently doesn't scale richness with distance. Changing that would alter existing worlds, so it waits for a save-version bump or new regions.
- **Crew sentiment (AW-100)** adds another spiral risk: unpaid wages leading to unhappy crew who quit. It needs its own way back, such as crew accepting deferred wages for a while and loyalty buffering bad stretches.
- **The bot doesn't take contracts or prepay the loan,** so real players have more income and more options than the bot shows.
