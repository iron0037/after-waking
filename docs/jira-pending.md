# Jira issues to file (connector was offline)

The Atlassian connector disconnected during the 2026-10-22 playtest 3 session. File these in project AW. After filing, add a comment to each closed one citing the commit, move it to Done, and delete this file.

Commit for the done items: see `git log --grep "Playtest 3"`.

| Type | Epic | Summary | Status |
|---|---|---|---|
| Task | UX & Polish | In-system flight animation 20% faster in real time (outer legs still ease, keeping the log-scale feel) | Done |
| Task | UX & Polish | Ship sensors lift the fog around the landing site (and after a hop) before the rover deploys | Done |
| Task | UX & Polish | Surface map and deposit list mark seams deeper than the drill reaches (faded, red strike, depth label, "too deep") | Done |
| Bug | M5 Story & Endings (lore) | Folding cost 30 min of game time; lore says folds are instant. Fold is now instant; docking at the Intrepid takes 30 min | Done |
| Task | UX & Polish | Shipyard sections fold like the surface panels | Done |
| Task | UX & Polish | Intrepid tabs reordered: Market, Shipyard, Exchange, Jobs, Depart (take jobs last, their clock starts on acceptance) | Done |
| Task | UX & Polish | Shipyard shows installation time under each price | Done |
| Task | Balance & Economy | Rover cells are fully charged after every fold (no charge wait on first deploy) | Done |
| Bug | UX & Polish | "Sell entire hold" sold ore needed for active delivery contracts without warning. It now keeps contract tonnage back and says so | Done |
| Task | UX & Polish | Exchange explains the note: amortizing, interest vs principal per installment, projected payoff date, interest to come | Done |
| Task | UX & Polish | From orbit: list of known untapped deposits across regions, with dots on the region chart; click to pick the region | Done |
| Task | UX & Polish | From orbit: preview a region's explored map before landing (the list above covers the "what's there" part) | To Do |
| Bug | UX & Polish | At ~1024 px window width the layout overflows: the top bar is cut off and Intrepid panels run off-screen (the 360 px side column stays reserved on full-width screens) | To Do |
