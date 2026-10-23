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

## Still open

- **Late-game money needs somewhere to go.** A competent captain ends 60 trips with about 0.66M cr. The real sinks are ship classes (AW-103), research (AW-15), outposts (M4) and, eventually, the Intrepid's own fold. Until they exist, late-game wealth is expected.
- **Hard content later on.** Worlds farther out should be richer but harsher (environment ratings, hostile life, combat in M3), so an established captain still has frontier challenges. Generation currently doesn't scale richness with distance. Changing that would alter existing worlds, so it waits for a save-version bump or new regions.
- **Crew sentiment (AW-100)** adds another spiral risk: unpaid wages leading to unhappy crew who quit. It needs its own way back, such as crew accepting deferred wages for a while and loyalty buffering bad stretches.
- **The bot doesn't take contracts or prepay the loan,** so real players have more income and more options than the bot shows.
