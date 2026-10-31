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

### The Awaken clue trail (AW-25) **[DECIDED 2026-10-29]**
- **The dossier.** The Covenant keeps a dossier of evidence (`src/data/clues.ts`, `src/sim/covenant.ts`). There are seven clues:
  - **Folded plicite:** the mineral specimen. Plicite is "made to be found".
  - **Song moss:** the plant that hums at 432 Hz, an old Earth tuning standard.
  - **The fold curve:** the Covenant's recorder, carried through three folds, shows fold fuel fits the formula to the twelfth decimal.
  - **The missing world:** the first-year catalogue lists a world the charts don't. Its orbit is empty and perfectly clean.
  - **The impossible signal:** a 432 Hz carrier repeating the Intrepid's pre-anomaly maintenance codes.
  - **The seams:** terrain that repeats hex for hex.
  - **A log from the future:** your own journal entry, dated years ahead.
- **Where clues come from:**
  - **Finds:** the two specimens, plus three perks that now work: Anomaly Theory (science, on scans), Listening Post (comms, arriving at uncharted stars) and Sixth Sense (captain, on landing).
  - **Errands** from the Covenant's listeners at the Intrepid, which pay a small stipend:
    - Carry the recorder.
    - Search a star's empty orbit.
    - Listen at an uncharted star for a day.
  - **Who gets errands, and when:** Covenant captains are offered the first errand at once. Everyone else gets it after a first clue or a few trips.
- **Effects:**
  - At 3 clues, the Archive's help turns strange and the future log appears in the journal.
  - At 5 clues, the Covenant says every thread leads outward to the edge of the Verge. That is the hand-off to deep space and the Awaken finale.

### Deep space and the Return ending **[DECIDED 2026-10-29, to build]**
- **v1 as built (AW-165):**
  - **The deep location:** `state.location = { kind: "deep", pos }`, in light-years. Fold targets are ids: `deepId(pos)` = `"deep:x,y"`.
  - **Blind folds:** 60% of the drive's range and ×1.25 fuel. A fold from deep space to a star or the Intrepid gets its full range.
  - **Where you can't fold:** within 0.6 ly of a star or of the Intrepid, or beyond 40 ly from the Intrepid.
  - **Deep-field array:** 45k cr from the Lyceum, sweeping 3 ly per day-long scan with faint returns out to 1.5× that. The long-baseline array (70k cr) sweeps 5 ly; it's gated by the "Long-baseline interferometry" research (20 systems charted, 2 t xenon).
  - **Sweeps run** from deep space or from any star system.
  - **Rescue:** the tender reaches deep space and charges by the light-year.
  - **Sites so far:** the anomaly's mouth only, 16–26 ly out and at least 2 ly from any star (`src/sim/deepspace.ts`).
- **Blind folds.**
  - You can fold to an empty point in interstellar space. With no star to lock onto, a blind fold reaches only about 60% of the drive's range and costs extra plicite.
  - The drive still refits after every hop, and there's no refuelling out there, so the tanks set how far an expedition can roam.
  - Deep-space points have no gravity well, so you can fold again as soon as the drive is ready.
- **Deep-field array.**
  - An expensive scanner sweeps a radius of a few light-years, taking a day at a time.
  - Scans are stored as circles and shaded on the star map, marking what you've already searched.
  - Finds inside the radius are identified; finds a little beyond it show as faint "?" returns, like the Seam Sense readings on surfaces.
- **What's out there:**
  - **The anomaly's mouth:** the wormhole, for the Return ending.
  - **Rogue planets:** starless worlds you can land on and mine.
  - **Derelicts:** salvage, logs and clues.
  - **Plicite drifts:** fuel you can mine far from port.
  - **Pirate bases:** where raiders come from, and a big prize.
  - **The edge:** past the Verge, the scanner returns a perfectly regular nothing. This is the Awaken finale.
- **Rumours** are sold at the Intrepid, and at outposts later.
  - Each one names an area that may or may not hold what it claims.
  - Buying several lets you narrow the area down.
  - The Intrepid's own log of where it came out of the anomaly is a free, true first lead. The mouth has drifted since.
- **Return** happens in stages:
  1. Find the mouth.
  2. Study it, with a probe dive into the anomaly and then a Lyceum research project.
  3. Stockpile the plicite needed to move the Intrepid.
  4. Fold the city-ship through and play the epilogue.
  - "The anomaly closing" gives the path a window.

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

**The Archive as first-run guidance (AW-24) [DECIDED 2026-10-29].**
- Each subject is explained once, the first time it comes up. The entries are in `src/data/archive.ts`; the rules for when each appears are in `src/sim/archive.ts`.
- **Subjects:** the Intrepid, folding, contracts, region signal, the sensor ring, drill depth, specimens, probes, raiders, the loan, and the rest.
- **Voice:** a formal technical record with the occasional plain Lyceum gloss. Nothing in it thinks.
- **Where it shows:** a strip below the screen, floating above any open window. It can be silenced, and the Journal's Archive tab re-reads the entries.
- **On the Awaken path,** `state.awakening` swaps in each entry's `strange` text. Nothing advances it yet; that comes with M5.
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
| Fold-drive refit (scales with distance; the engineer and paid yard crews shorten it) | Days to weeks |
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

### Slice 1: roster, XP, levels, hiring hall **[DECIDED 2026-10-22]** (AW-14)
- **The roster.** The captain is the player. Five officers (Science, Navigation, Engineering, Comms, Medical) hold one station each. Code lives in `src/sim/crew.ts`, content in `src/data/crew.ts`.
- **Levels 1–10 from XP.** Experience comes from the work, and a clan's trained stations earn +25%. The curve is set so a busy station reaches level 3–4 in the first ten trips and the cap takes most of a career (80+ trips).
- **Levels give small, steady bonuses:**

  | Station | Bonus per level above 1 |
  |---|---|
  | Science | +1 hex of sensor sweep at levels 4, 7 and 10 |
  | Engineering | +4% drill rate; −5% incident chance; −4% fold-drive refit time |
  | Navigation | −3% flight fuel; −2% fold fuel; −2% flight time |
  | Captain | +1% sale prices |
  | Comms | +3% contract pay |
  | Medical | −5% time lost to incidents; +3% specimen prices |

  Perks that change what's possible come in slice 2.
- **Wages rise with level.** The base is 30 cr/day at level 1, plus 7% per level. Clans adjust it: Freebooters ×0.8, Exchange ×1.1, Covenant ×0.95. Veterans cost more, which gives the economy a long-term money sink.
- **Hiring hall** aboard the Intrepid:
  - Five recruits, and the pool turns over every 30 days.
  - About half come from a clan that trains for their post; they start a level higher and learn faster.
  - Signing costs 15 days' wages. The new officer replaces the current one, who goes ashore.
- **Upbringing [DECIDED 2026-10-25]** (the second half of a background, after clan). It follows from when someone was born relative to the Waking (AW 0), and it's fixed for life:

  | Upbringing | Who | Effect |
  |---|---|---|
  | Decks-born | born after the Waking, raised aboard the Intrepid | shore leave lifts their mood 50% faster |
  | Settlement-raised | born after the Waking, raised on a settlement (about a third of the Waking-born) | long hauls wear on them half as much |
  | Cryo-child | went under before age 12 | +10% experience |
  | Remembers Earth | went under at 12 or older | loyalty slips half as fast |

  Officers range from their early twenties to about sixty, so sleepers are the majority, as they would be thirty years after the Waking.
- **Later slices:** perk trees with three branches per station; aging, retirement and mentoring; injuries.
- **The captain's own tree:** Trader / Explorer / Diplomat / Commander. This shapes playstyle and endings.
- **Scope target:** 6 stations × 3 branches × about 5 perks, plus traits.

## Ship Classes **[PROPOSED 2026-10-23]**
Your third-rate freighter can only be improved so far. Later in a career, captains buy a different hull.

- **Classes trade off cargo, speed, combat, landing ability and crew size.** Examples:
  - Big, slow bulk haulers.
  - Sleek, nimble corvettes for fighting.
  - Survey ships with strong sensors and small holds.
  - Heavy landers rated for harsh worlds.
- **Each class has its own upgrade list** (some shared, many class-specific) and its own enlisted-crew minimum and maximum (see docs/crew_perks.md).
- **Clans build different ships:**
  - Midshipmen: warships and fast hulls.
  - Diggers: heavy landers and mining tenders.
  - Exchange: bulk freighters.
  - Lyceum: survey ships.
  - Freebooters: secondhand ships at a discount, with "history".
- **Expensive.** A new hull usually means a new Exchange note. The old ship can be traded in or sold.
- **One ship at a time.** Spare ships can be laid up at the Intrepid for a monthly berthing fee.
- **Upgrades:** decide whether they transfer, partially refund on sale, or are lost with the hull.

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
| The chase | Many fights are pursuits. Speed, drive damage and fold-refit timing decide whether you escape. |

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

### Combat v1: pirates **[DECIDED 2026-10-25] (M3)**
The first slice of the ships-of-the-line model. Pirates only; rival captains, aliens and boarding come later.

**When it happens.** As you spool the fold drive to leave a system with cargo aboard, a raider may drop out of the star's glare. The chance grows with the value of the hold and how far out you are: none at the home stars, low at the charted stars, higher in uncharted space. Leaving empty is safe. A typical career sees an interdiction every five or six trips.

**The hail.** The raider's captain demands a share of the hold (about a third by value). You choose:
- **Pay** and go: lose that share, no fight.
- **Talk**: the comms officer tries to bargain the demand down (comms level, captain level), or bluff them off entirely. Fails into the demand or a fight.
- **Run**: navigation level and drive state against the raider's speed. Escape folds you out; a failed run starts the fight at close range.
- **Fight.**

**The battle.** Simultaneous turns on three range bands (long, medium, close). Each turn you give four orders:
- **Helm (navigation):** close in, hold range, open range, or evade.
- **Guns:** fire at their drives, weapons or hull, or hold fire.
- **Engineering:** repair your worst-hit system, or push power to shields or to the guns.
- **Comms:** demand their surrender, offer yours, or stay quiet.

Damage hits four systems: **hull, drives, weapons, sensors**. Crippled drives can't run or close; crippled weapons can't fire; blinded sensors miss more. Lasers are steady at any range, kinetic batteries hit hard up close and miss at long range. Science level sharpens aim; engineering level speeds repairs.

**Endings.** Either side can **strike its colours**. Pirates strike when badly hurt or disarmed. You win their bounty (Helm pays for raiders) and salvage. If you strike, or your hull fails, they take most of the hold and your credits are safe: they want cargo, not a murder charge. You can also **escape** by opening range and folding when the drive is ready. Nobody dies in v1; damage carries over until the Intrepid's yard repairs it (credits and days).

**Gear.** Midshipmen and Helm sell weapons (laser battery, kinetic battery), deflector shields and armour plate. The stock freighter carries one light laser. Captain and comms experience come from encounters; the gunnery and evasion perks already planned come alive.

**Balance target.** An honest freighter that pays costs about 5% of career income; a fitted ship that fights well breaks even or profits on bounties. The bot pays by default, so the career report measures the cost.

**v1.1 (playtest 10, AW-160/161/162) [DECIDED 2026-10-29].**
- **Raiders size you up.** Fighting power is (laser×0.7 + kinetic×0.6 + shields×0.8) × √(hull/100). A raider weaker than your ship attacks only with probability (ratio)³. A battered ship looks weaker.
- **Battle experience follows orders.**
  - Helm maneuvers train the navigator, with a bonus for a clean evade.
  - Hits train the captain (command) and science (targeting).
  - Engineering power orders and repairs train the engineer; demands train comms.
  - The debrief lists each station's gains.
- **Taking a prize.** When a raider strikes, you board her:
  - Salvage, as before.
  - Helm's bounty for the captain: 2,000 / 4,000 / 7,000 cr by raider class.
  - Part of their plunder, if your hold has room.
  - Their crew: turn all of them in at 400 cr a head, or offer the one or two promising ones a berth. Those Freebooters wait a year in the hiring hall at half the signing fee, a little more loyal than most.

**v1.2: contacts in flight and auto-combat (AW-20, AW-163) [DECIDED 2026-10-29].**
- **Contacts in flight.** A raider can be waiting on an in-system route as well as at the fold.
  - Each leg with cargo aboard rolls 35% of the system's departure chance, scaled by the leg's length (full at 2 AU or more).
  - The burn stops 30–75% of the way along, wherever they're met. The roll is fixed for the route and the day, so the flight plan knows where the ship will stop.
  - One raider per system visit: after an in-flight contact, the departure fold is clear.
- **Who sees whom.** Your sensors see them first with a chance that grows with the sensor array and the science officer, and shrinks with sensor damage. At a quarter light-speed nobody can fight; they have to match your burn. You choose:
  - **Steer wide** (only if you saw them first): costs a quarter of the leg's time; navigation and science improve the odds. If it fails, they hail.
  - **Hold your burn**: the run, easier if you saw them first. If it fails, the battle starts at medium range.
  - **Hail them** (or answer their hail): drop to combat speed and take the usual hail (pay, talk, run, fight).
  - **Drop to combat speed and attack**: battle at long range. Hunting raiders for prizes is allowed.
  - Afterwards, the debrief offers to continue the flight.
- **Auto-combat.** **Fight it out** and **Break away** leave the encounter to the officers, turn by turn, with the log scrolling. **Take command** returns control at any point. Auto-fight stops at the prize, so the captives are still the captain's call.

## Star Systems: World Generation 2 **[DECIDED 2026-10-26] (AW-145)**
Generation 1 gave every star our Solar System's layout: small rocky worlds inside the frost line, giants outside. The exoplanet surveys say otherwise, so new games use generation 2. Saves remember which generator built their universe (`state.worldGen`; old saves are generation 1), so a game in progress never reshuffles.

- **What the surveys found:**
  - Small planets (super-Earths and sub-Neptunes) are the most common, mostly well inside 1 AU.
  - They often sit in compact "peas in a pod" systems of similar, evenly spaced worlds.
  - Red dwarfs host a couple of small planets each but rarely giants.
  - Hot Jupiters are rare (about 1% of Sun-like stars).
  - Giants are likelier around heavier stars.
- **Architectures** (weights by star class, in `bodies.ts`): compact, solar-like, hot Jupiter, warm Jupiter, sparse, giants-dominated. Red dwarfs are 60% compact; A stars lean to giants. Hot Jupiters run a little above the real rate, for variety.
- **Mini-Neptunes** (2-4 Earth radii, no surface) are a common planet type; probes can dive them like ice giants.
- **The habitable zone scales with the star:** a world gets Earth's sunlight at sqrt(L) AU, so a red dwarf's temperate band is a few hundredths of an AU out. Radiation is measured against that distance too, so close-in red-dwarf worlds aren't all lethal.
- **Planets are numbered in order from the star,** and the fold limit hugs the outermost world (compact systems are tiny).
- **Home systems** stay solar-like with three easy worlds, and the Meadow is always a real planet near a mild orbit (in generation 1 it could land on a belt asteroid).

Career report: no broke careers; novice and competent income about where they were.

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

## Clan Relations (AW-22) **[DECIDED 2026-10-31]**
- **Standing.** Every clan rates you from −100 to +100 (`src/sim/reputation.ts`). The tiers:

  | Tier | Range | Contract pay | Gear prices |
  |---|---|---|---|
  | Hostile | −40 or below | No work | Won't sell |
  | Cool | −40 to −10 | ×0.9 | +10% |
  | Neutral | −10 to 20 | ×1 | normal |
  | Friendly | 20 to 50 | ×1.1 | −5% |
  | Trusted | 50 and up | ×1.2 | −10% |

  - A hostile clan also won't run your research or sign on with you.
  - Contracts it already gave you still pay, at the Cool rate.
- **Where you start:** your own clan at +25 (Friendly). A Freebooter captain starts Cool with Helm (−20) and the Exchange (−15). Everyone else starts at 0.
- **What moves it:**

  | Event | Change |
  |---|---|
  | Contract delivered | +4 to +12 (bigger jobs, more) |
  | Contract lapsed | −12 |
  | Research commissioned | +5 |
  | Gear bought from a clan | up to +5 (scaled by price) |
  | Exchange installment paid | +1 |
  | Exchange payment missed | −8 |
  | Helm obligation skipped | −15 |
  | Raider taken | Helm +3 to +5 |
  | Raider crew given a berth | Freebooters +4 |
  | Covenant errand | +6 |

- **Ripples.** A change spills onto other clans at half strength, times their tie (`CLAN_TIES`, from −1 to +1):
  - Helm–Midshipmen +0.4; Helm–Lyceum +0.2; Midshipmen–Diggers +0.3.
  - Helm–Freebooters −0.6; Exchange–Freebooters −0.5; Lyceum–Covenant −0.5; Exchange–Diggers −0.2; Helm–Covenant −0.2.
- **Drift.** Standing relaxes toward where it started by 15% a year, so one bad year isn't permanent.
- **Seen in:** the Clans panel, standing tags on contract cards and Shipyard prices, and a journal line whenever a tier changes.

## Starting Clan Perks **[PROPOSED: user's Exchange idea + matching perks]**
Your starting clan shapes the early game. Every perk is small but felt, and each has a matching cost so no choice is free.

| Clan | Perk | Cost / friction |
|---|---|---|
| **Exchange** *(user's idea)* | Loan interest halved; sell 3% better | Traders, not haulers: the Exchange's brokers add 5% to your plicite, and missed payments carry a double late fee. *(Rebalanced in AW-174: the old fuel discount made it the strongest clan.)* |
| **Helm** | Fold-drive refits 15% faster; 3 extra systems charted at start | Helm expects you to take enforcement jobs; refusing costs standing |
| **Midshipmen** | 10% off Midshipmen ship upgrades; start with a skilled engineer | Fussy about maintenance: skipping refits costs reputation |
| **Diggers** | Drill rate +15%; one free high-grade deposit lead per year | Diggers expect a cut of your biggest strikes (a tithe on plicite and platinum) |
| **Lyceum** | Orbital scans and surveys take half the time; specimens sell for 15% more | Upkeep: the Lyceum asks you to carry its researchers, which takes up berths |
| **Covenant** | Access to the Covenant's anomaly reports (the Awaken clue trail starts early) | Archive-derived upgrades cost 10% more: your brethren disapprove |
| **Freebooters** | Black-market fuel 10% cheaper; smuggling jobs open from day one | Helm and Exchange start out cool toward you |

Clan choice isn't in V1. These perks plug into the same modifiers the balance pass uses (loan rate, prices, rates).

## New-Player Experience **[DECIDED 2026-10-21]**
"A single bad run shouldn't ruin you when you're starting out."
- **Home systems:** the three charted stars nearest the Intrepid. In the lore, the first scouts explored them thoroughly.
  - Gentle K/G stars, with no flare stars next door.
  - At least two calm landable worlds each, with low weather and tectonics.
  - Modest, mostly shallow seams.
- **Scout records:** every body in the twelve charted systems starts scanned, and the home worlds start fully surveyed. You know what you're getting into.
- **The Meadow:** a small living world in the nearest home system. It's the gentle first landing, with flora to sample.
- **Starter contracts:**
  - Exchange: deliver 60 t of iron-nickel ore (4,500 cr, about 2.5× market).
  - Lyceum: 4 flora samples from the Meadow (5,000 cr).
  - Helm: finish the scouts' charts with two detailed surveys (3,500 cr).
- **Ongoing:** recurring delivery contracts at 1.3–1.6× market value, with deadlines.
- **Safety net:** Exchange fuel credit, so a broke captain is never stranded.
- **Measured:** a bare ship's first three trips are profitable 92% of the time, with a median of about 17k cr. Losses come from straying beyond home early.

## Map Painting **[DECIDED 2026-10-21]**
Some players love marking off what they've done, and everyone benefits from "hey, you already looked there."
- **Surface:** every tile swept by rover sensors is remembered. Unswept tiles show as dim orbital imagery, and swept tiles in full color. Regions show an explored %.
- **World:** regions visited, surface explored %, scanned and surveyed status.
- **System and star map:** progress arcs that fill as you scan, land and explore. Home systems and contract targets are marked.
- **Revisit recap:** landing somewhere you've been shows what's known: explored %, deposits known, reachable tonnes left, unsampled flora, and a "looks worked out" warning.

## Compendium **[DECIDED 2026-10-21, inspired by Stardew Valley's museum]**
A permanent record of everything found, measured against the whole game catalog, so completionists always know what's left.
- **The catalog is fixed and authored** (`src/data/catalog.ts`), not procedurally named, so the collection is finite and meaningful:
  - 32 flora species, tied to climate bands (cold, temperate, warm), with rarities.
  - 16 mineral specimens, each tied to a host ore and turned up while drilling. Two plicite specimens double as Awaken clues.
  - The 8 ores themselves.
  - Artifacts arrive with ruins (M5).
- **Collecting:**
  - Living worlds draw 3–6 species from the climate's pool, weighted by rarity.
  - Drilling has about a 3.5% chance per hour to turn up a specimen from the host ore.
  - A duplicate specimen sells to Exchange collectors (150–1,500 cr by rarity).
- **UI:** an overlay (B key, or the top-bar button). Found entries show where and when; unfound entries show a silhouette, rarity and a hint.
- **Next:**
  - A unique pixel sprite per entry, batch-generated through the art pipeline.
  - **[PROPOSED]** Lyceum milestone rewards at 10, 25 and 50 entries (research unlocks, rare gear), like Stardew's museum rewards.
  - **[PROPOSED]** A display room aboard the Intrepid.
  - Grow the catalog toward 150+ entries with fauna, more minerals and artifacts.
