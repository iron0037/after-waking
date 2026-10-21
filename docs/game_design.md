# Game Design — Draft 2

> Refined from `game_concepts.txt`. Your original text is kept as-is in that file.
> **[DECIDE]** = open choice. **[PROPOSED]** = my suggestion. **[CUT?]** = scope risk.

Working title **[DECIDED]**: ***After Waking***

## Design Pillars
1. **Exploration is the reward.** Every planet is a mystery box: minerals, life, ruins or danger.
2. **Knowledge is progress.** Clues, coordinates and alien statements are what unlock the story, not stat upgrades.
3. **Every choice costs fuel.** Fold costs (mass × distance) shape every decision, from a cargo run to moving the whole Intrepid.
4. **A modern interface for a classic game.** Starflight's depth, without the 1986 friction.

## Core Loop (from your draft, tightened)
1. **Prepare** at the Intrepid: refuel, outfit, hire and train crew, pick up jobs.
2. **Fold** to a star system. You arrive at the edge of the gravity well.
3. **Fly** in-system: scan bodies, handle encounters.
4. **Orbit and survey**: sensors show minerals, life, atmosphere and anomalies.
5. **Land** in the terrain vehicle: mine, capture specimens, explore ruins, survive hazards.
6. **Return** and sell cargo, specimens and **survey data**.
7. **Upgrade** the ship and crew, then push farther out.

**[PROPOSED] Selling survey data.** The Intrepid pays for habitability reports, like Starflight's "recommend for colonization." This ties the money loop straight to the main theme of finding a home.

## Secondary Loops
| Loop | Notes |
|---|---|
| **Job board** | Deliver cargo, carry passengers, scout uncharted worlds, bounties. Handcrafted story jobs are mixed in with procedural ones, so the board doesn't go stale. |
| **Combat and reputation** | Pirates, rival captains, aliens. Reputation is tracked **per clan and per alien race**, and actions affect several at once. Attacking an Exchange freighter pleases the Freebooters and angers the Exchange. |
| **Outposts** **[CUT? → mid-game]** | Found an outpost on a surveyed world by delivering colonists and supplies. It grows over time, produces resources, becomes a refuel point and can be raided. I'd keep this simple: 3–4 upgrade tiers, not a city builder. |
| **Crew** **[DECIDED: humans only]** | Six stations: Captain, Science, Navigation, Engineering, Comms, Medical. Skills improve through training and use. **No androids, ever.** Alien crew become possible only after first contact with a civilization willing to serve. That makes recruiting them a real milestone, not a shop option. |

## Endings: Consolidated from Six
Six separate victory paths is too many to build well. **[PROPOSED]** structure: one main question, *where does humanity go?*, with four endings. Your other two ideas become sandbox goals that change the epilogue.

| Ending | Your original | What it takes |
|---|---|---|
| **Return** | Fly back through the wormhole | Find the anomaly, solve how to reopen it and fuel the passage. Bittersweet: home is the AIs' Earth. |
| **Relocate** | Fold the Intrepid to a habitable world | Survey and verify a world, then stockpile enough plicite. Tradeoff: a near, marginal world is cheap; the far, ideal one is costly. |
| **Accord** | Alien intermediary grants a home | Earn the Quiet's trust and broker terms between them and the clans. The price is political. |
| **Awaken** | The simulation twist | Assemble the clues, then confront the truth. **[DECIDED] It's true.** The meta layer is the point: the Intrepid really is inside a game. |

| Sandbox goal | Your original | Effect |
|---|---|---|
| Clan leadership | Become head of your clan | Unlocks clan resources. Changes the epilogue and possibly which endings are available. |
| Thriving outpost | Build your own outpost | Becomes an alternative destination in Relocate, or an epilogue variant. |

Epilogue slides would reflect everything you achieved.

## Systems Map (Starflight → ours)
| Starflight system | Ours | Modern improvement |
|---|---|---|
| Starport (Arth) | The Intrepid hub | One clickable deck map instead of walking corridors; every service reachable by hotkey |
| Hyperspace travel | Instant fold between stars, then 0.25c in-system flight with time compression | No tedious flights between stars. Click a destination to see the fuel cost and risk before committing. Auto-travel stops when something is detected. See exploration.md. |
| Land anywhere | Environment ratings and vehicles | No landing on gas giants. Worlds are gated by tech you develop. Separate rover, boat, probes and EVA. See exploration.md. |
| Planet orbit/sensors | Survey screen | Overlay toggles for minerals, life and hazards; the scan stays saved permanently |
| Terrain vehicle | Surface exploration | Mouse or WASD control, a minimap, auto-return when fuel is low |
| Alien comms | Dialogue system | Posture plus topic system; full transcripts saved in the journal |
| Ship combat | Real-time combat | Pause-and-order option, readable damage feedback |
| Captain's log / notes | **Auto-journal** | Every clue, coordinate and statement logged, tagged and searchable; pin a clue to the map |
| Crew and training | Crew roster | Skill effects shown in tooltips ("Science 60: detects rare isotopes") |
| Save | Autosave and quicksave | Autosave at the hub and each fold; multiple slots |

**Other modern UI:**
- Remappable keys; resolution scaling.
- Tooltips everywhere.
- Undo for trade and outfitting at the hub.
- Optional difficulty settings: fuel strictness, combat speed, clock pressure.

## Scope Guardrails
- **Region:** about 200–300 stars, with procedural planets plus about 40 handcrafted key locations.
- **Aliens:** 5–6 races, each with a distinct communication style and a reason to matter to an ending.
- **Clans:** 6, with reputations shown in a single panel.
- **Build order:** core loop → survey/surface → comms → combat → clans/jobs → outposts → endings.

## Game Modes **[DECIDED in principle]**
| Mode | Clock | Crises |
|---|---|---|
| **Captain** (standard) | Main deadlines tick on the game calendar | Crises escalate if ignored and can end the game |
| **Explorer** (casual) | No countdowns | Crises are triggered by story progress, not time, and wait for you. Nothing ends the game on a timer. |
| **Ironman** (optional) | As Captain | One save slot, permanent consequences |

## Pressure Sources (clocks and crises)
Use **one main clock per playthrough** **[PROPOSED]**, possibly picked at random or by the story, plus smaller crises as events, so replays feel different.

**From your list:**
- Resource exhaustion on the Intrepid
- Political instability or civil conflict
- A powerful hostile species discovering the Intrepid

**Additional ideas:**
- **Reactor or hull fatigue.** The Intrepid is 2,700 years old and was never built to be a permanent station. Specific rare materials are needed for repairs.
- **Fold wake detection.** Every fold leaves a trace. The more you fold, and the closer to home, the sooner the hostile species finds the Intrepid. This puts the clock under the player's control.
- **Plicite monopoly.** A clan (Exchange?) corners the fuel supply and moves toward a coup. You either break the monopoly or join it.
- **Outbreak.** A specimen someone brought back, possibly you, starts an epidemic aboard. The cure is in a lifeform somewhere out there.
- **Outpost secession.** Outposts from several clans declare independence and stop sending supplies. That creates tension between their reputation and the Intrepid's.
- **The anomaly closing.** The Return ending has a window. Detected late, it becomes a race.
- **Simulation decay** (hidden, tied to Awaken). Distant stars quietly disappear from the map, then nearer ones. It looks like a catastrophe until you understand it. *It's a homage to Starflight's flaring stars with a different cause. We should check it doesn't feel derivative.*
- **The real arrival.** The real Intrepid reaches Kepler-186 at a fixed point. The simulation ends then, whether you're ready or not. This is a secret clock behind all the others.

## Meta Layer Ideas (Awaken) **[PROPOSED, light touch]**
- Clues appear in the game's own UI: a tooltip that's subtly wrong, a star-map coordinate grid that's suspiciously perfect, a log entry stamped with a timestamp from the future.
- Late game: the Archive "help" text starts answering questions you didn't ask.
- The ending can briefly break the fourth wall, without becoming a gimmick that cheapens the other endings.

## Time Scale and Aging **[DECIDED: a win takes 5–50 game years]**
- **The captain ages.** Start at about 25–30. Retirement or death is the ultimate time limit, even in Explorer mode, but generous: it arrives around year 50 at the latest.
- **[PROPOSED] Succession.** When the captain retires, either end with an epilogue, or continue as a protégé or heir with an inherited ship, reputation and some skills. Succession also fits the "head of your clan" goal.
- **Crew age too.** Veterans plateau and eventually retire. Mentoring speeds up younger crew.
- **Where the years go.** In-system flight takes only hours, so time has to pass through other things. **[PROPOSED] time budget:**

| Activity | Game time |
|---|---|
| In-system flight | Hours to about 1 day |
| Surface expedition (exploring one region) | Days to weeks. Planets are huge, and a single world can hold a career's worth of sites. |
| Fold drive recharge (scales with distance) | Days to weeks |
| Refit and repair at the Intrepid | Weeks |
| Crew training course | Weeks to months |
| Drilling, extraction and on-site ore processing | Days to weeks per site; see exploration.md |
| Specimen tracking and capture | Hours to days |
| Research project | Months to years; it runs while you're out exploring |
| Outpost growth | Years |
| "Wait at the Intrepid" for research or events | Player choice |

- **Target [TUNE]:** a typical trip takes about 1–3 months door to door, which gives roughly 60–150 trips over a 15–20-year campaign. In Captain mode, waiting is a strategic cost, since the clocks keep running.

## Crew Progression **[DECIDED: modern skill trees, XP from use]**
- **XP comes from doing the job:**
  - Science: scans, probe dives, analysis.
  - Navigation: folds, flights, evasion.
  - Engineering: repairs, overloads, salvage.
  - Comms: conversations, negotiations, interrogations.
  - Medical: treating injuries, disease, specimen handling.
  - Captain: command decisions, combat, trade.
- **Levels give points in a station skill tree** with specialization branches **[PROPOSED]**, for example:
  - Science: Geology / Xenobiology / Probe Piloting.
  - Engineering: Drives / Systems / Fabrication.
  - Comms: Linguistics / Diplomacy / Signals.
- **Perks change what's possible, not just numbers.** "Deep Diver" lets probes go 30% deeper; "Xenolinguist" reveals hidden dialogue options; "Jury-Rig" allows one field repair per expedition.
- **Background traits** come from clan and upbringing: a Midshipman-trained engineer, a Covenant-raised medic who distrusts Archive tech.
- **The captain's own tree:** Trader / Explorer / Diplomat / Commander. This shapes playstyle and endings.
- **Scope target:** 6 stations × 3 branches × about 5 perks, plus traits.

## Combat **[DECIDED: turn-based, inspired by ships of the line]**
**The model.** Age-of-sail fleet battles: hours of maneuvering and long-range fire, decided by positioning, endurance and nerve. Shots traded at extreme range, damage that cripples before it kills, and ships that strike their colors rather than die.

| Age of sail | After Waking |
|---|---|
| Long-range broadsides, slow reloads | Long-range batteries with recharge or heat cycles. Most shots miss at range. |
| The weather gauge (upwind advantage) | **The gauge:** sensor advantage. Approaching out of a star's glare, from a planet's shadow, or from higher orbital energy. |
| Shot at the rigging cripples a ship's maneuvering | **Targeting choice:** drives (cripple), weapons (disarm), hull (sink), sensors (blind) |
| Damage-control parties mid-battle | The engineer assigns repair crews each turn; that's when Engineering XP pays off |
| Striking colors / surrender | Surrender is always available to both sides, with the consequences carried forward (cargo seized, reputation, prisoners) |
| **Prizes and boarding** | **Disable and board** an enemy to capture it: sell the hull, salvage parts, ransom the crew. This is the Freebooters' trade. |
| The chase | Many fights are pursuits. Speed, drive damage and fold-recharge timing decide whether you escape. |

**Mechanics [PROPOSED]**
- **Simultaneous turns.** Each side plots orders, then they resolve together. A turn represents about 5–10 minutes, so a full battle takes a few hours of game time. That matches the age-of-sail feel and the game's time scale.
- **Map.** A 2D tactical plane with range bands. Bodies give cover and can block sensors.
- **Weapons by range:**
  - Lasers hit at light speed but weaken with distance.
  - Kinetic batteries hit hard but are dodgeable at long range.
  - Missiles have flight time, and point defense can shoot them down.
- **Heat and power** are the limits.
- **Every station has an order to give:**
  - Navigation: maneuver and evasion.
  - Engineering: power, heat and repair crews.
  - Science: sensor lock and targeting.
  - Comms: jamming and hailing (parley, bluff, demand surrender).
  - Medical: casualties.
- **You fly a freighter, not a warship.** Escape, parley and surrender are real outcomes, not failures.
- **Fights are 5–20 turns,** with auto-resolve for trivial encounters.
- **Building it with agents.** Deterministic resolution means agents can test it automatically and balance it through thousands of simulated battles.

## Settled Answers (2026-10-21)
1. **Fold arrival:** at the system's edge (the outermost planet's orbit).
2. **Landing:** the freighter lands. A dropship comes later for heavy freighters.
3. **Starting clan:** player's choice, but not in V1.
4. **Combat:** turn-based, inspired by ships of the line (see above).
5. **Title:** *After Waking*.

## Title Shortlist (for the record; we chose *After Waking*)
| Title | Notes |
|---|---|
| **Starfold** | A nod to Starflight plus the core mechanic. A tiny 2023 game-jam game on itch.io uses the name. That's fine for a private project, but it would need a trademark check before any release. |
| **After Waking** | The in-world calendar (AW), with a double meaning that pays off in the Awaken ending. No exact game title found; "Waking" (2020) is close. |
| **Waking Stars** | Ties together the colonists' awakening and the twist. |
| **The Long Fold** | Says something about the journey and the Intrepid's fuel problem. |
| **Intrepid** | Simple and strong, but generic and widely used. |

Avoid: **Homeworld** (a major franchise), **ADR1FT** (an existing game, too close to "Adrift"), and **Cosmos** (generic and unsearchable).
