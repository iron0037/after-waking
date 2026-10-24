# Travel, Planetary Access and Vehicles — Draft 1

> **[DECIDED]** = settled in conversation. **[PROPOSED]** = my suggestion. **[TUNE]** = a number to settle in playtesting.

## 1. Two Scales of Travel

### Between stars: fold **[DECIDED]**
- Instant. Choose a destination on the star map, see the cost, confirm. There's no interstellar flight segment.
- **[DECIDED] You arrive at the system's edge, around the orbit of the outermost planet, and work your way in.** Folds can't start or end deeper than that. This avoids any physics fiasco and makes every system feel like an expedition inward. Outer worlds are on the way in; the inner system is the destination.
- Real distances are kept, so the inner worlds are short hops and the outer system is long hauls. Real-time duration from the edge to the star (15 s? 60 s?) and cruise speed are both **[TUNE]**.
- The Intrepid sits in interstellar space with no gravity well nearby. You fold right up to it, which makes returning home quick.

### Within a system: real-time flight at 0.25c **[DECIDED]**
- The drive is an Archive technology (see lore.md). It explains reaching 0.25c with no months of acceleration. Covenant members dislike that you use it.
- Real distances turn into game-time costs:

| Trip | Distance | Game time at 0.25c |
|---|---|---|
| Planet to its moon | ~0.003 AU | ~6 seconds |
| Inner planet to neighboring planet | ~0.5 AU | ~17 min |
| Inner system to Jupiter-like orbit | ~4–5 AU | ~2.5 h |
| Cross a system to a Neptune-like orbit | ~30 AU | ~17 h |
| Outer belt / far companion star | 100+ AU | ~2–3 days |

- **Time compression [PROPOSED]:**
  - The game clock runs at about 1 game-hour per real second while cruising, and slows to real time near bodies and during encounters.
  - "Engage" auto-flies to a clicked target and stops automatically if something is detected.
  - A long crossing takes about 15–20 real seconds and never minutes.
- **Encounters at 0.25c [PROPOSED].** Nothing can fight at a quarter light-speed. Detection triggers an *interdiction choice*: drop to combat speed, run, or hail. Small sensor-range ships can slip past; big ones can't.

### Fuel **[DECIDED: linear to start, then tune]**
- One fuel, **plicite**, as in Starflight.
- **Fold cost** = `k × ship_mass × distance_ly`. It's linear in both.
- **Drive tier sets the max distance of a single fold**, so upgrades still expand your reach, which exponential costs would otherwise do.
- **In-system flight** uses a small amount of fuel per AU **[TUNE]**. Cruise speed starts at 0.25c and is also **[TUNE]**. Time spent there matters mainly against the clock and for crew fatigue (if we add fatigue).
- **The Intrepid at linear cost.** Its mass is roughly 10,000× a freighter's, so even a linear fold to a candidate world needs a stockpile measured in campaigns, not cargo holds. That's still a good long-term goal. If testing shows linear scaling is too forgiving, we can use mass × distance^1.5.

## 2. Planetary Access: no more landing on gas giants

Each body has an **environment profile**, and each vehicle has **ratings** against it. If the ratings don't meet the profile, you can't go, or you can go at a stated risk.

### Environment factors
| Factor | Range | Gates |
|---|---|---|
| Surface type | Solid · Liquid · Ice crust · No surface (gas/ice giant) | Which vehicle can be used at all |
| Gravity | 0.01g – 3g+ | Freighter landing/lift-off thrust. Rover suspension. Microgravity means no driving. |
| Atmosphere pressure | Vacuum – 100+ atm | Hull pressure rating |
| Temperature | −230 °C – 900 °C | Thermal rating |
| Chemistry | Inert · Toxic · Corrosive (acid) | Seals, coatings |
| Radiation | Low – Lethal | Shielding; crew exposure time |
| Weather | Calm – Superstorm | Landing windows, surface time limits |
| Tectonics | Stable – Volcanic | Quakes, lava, hazard events |

### Body classes and how you interact with them
| Body | Freighter | Surface operations |
|---|---|---|
| **Rocky world** (Earth- or Mars-like) | Lands if rated | Rover |
| **Ocean world / liquid seas** (water, hydrocarbon, acid) | Lands on shore or a platform | **Boat**; later a **submersible** |
| **Ice world** | Lands if rated | Rover with ice treads. With a drill and submersible, the subsurface ocean (Europa-like, late game). |
| **Hothouse** (Venus-like) | **Locked** until pressure, heat and acid tech | Rover with full sealing (late game) |
| **Volcanic / lava world** | Lands on stable crust if heat-rated | Rover; timed exposure |
| **Super-Earth (high gravity)** | Lands only if thrust lets it *take off again*. The game warns you clearly. | Heavy-suspension rover |
| **Gas / ice giant** | **Cannot land.** Atmospheric **skimming** harvests gases (H₂, He-3, exotics) at hull-stress risk. | **Probes:** atmospheric probes for readings, rare compounds and floating life. Probes are lost past their crush depth. |
| **Asteroid / tiny moon** | **Docks and anchors.** No rover driving in microgravity. | Freighter mining laser; EVA team for artifacts and samples |
| **Star** | Late-game **corona skim** for rare isotopes; high risk | — |

### Atmospheric probes v1 **[DECIDED 2026-10-24]** (AW-16)

The code is in `src/sim/probes.ts`, with content in `src/data/probes.ts`.

- **Equipment:**
  - The Lyceum's **probe bay** (20k cr) carries 3 probes and reaches the deep layers.
  - The **pressure-rated racks** (35k cr) carry 6 and reach the abyss.
  - Probes cost 2,500 cr each and are reused when they come back.
- **The dive:**
  - In orbit of a scanned gas or ice giant, choose a depth band: cloud tops, middle decks, deep layers or the abyss.
  - The science officer flies 1–3 decision points on the way down: a storm band, lightning, a rich layer, a pressure spike or icing. Each choice trades risk for haul or time.
  - Then the link fails, and a mechanical ballast timer brings the probe up. Nothing aboard thinks for itself.
  - **Outcomes:** recovered, damaged (half the haul) or lost.
  - **Skill:** each science level trims risk, to 40% of the base at best, and adds 3% yield.
- **Gases:** methane, deuterium, xenon and helium-3. Thin markets mean a few tonnes move the price.
  - Gas giants run richer in helium-3 deeper down; ice giants are methane-heavy.
  - Each giant's richness (0.6–1.4) is fixed per world.
- **Economics** (simulated at science level 1, before market saturation):

  | Depth band | Net per dive | Loss rate |
  |---|---|---|
  | Cloud tops | ~0.25k cr | 7% |
  | Middle decks | ~1k cr | 10% |
  | Deep layers | ~1.9k cr | 22% |
  | The abyss | ~2.5k cr | 36% |

  A few dives add roughly half a mining trip, with real variance.
- **Generation:** world generation draws only from ore types (`ORE_IDS`), so adding gases didn't change any existing world.

### Probes and remote operation **[PROPOSED, lore fit]**
- No AI means no autonomous drones. Probes are **remote-piloted by your Science officer**, so crew skill sets how deep they go, how much they recover and whether they survive.
- That keeps the human-only rule and gives Science a hands-on role.
- Probe use is a short descent sequence with decision points, not a full vehicle mode, which keeps scope down.

### Locked worlds as progression **[DECIDED]**
- Some body classes, and some *regions* of otherwise-reachable worlds (a toxic lowland, a high-pressure trench, a storm belt), start locked. Each unlock is a deliberate payoff in the progression: a new kind of place opens up.
- The UI shows locked targets, and what would unlock them, so players see the goal.
- **Prototype scope.** Rocky worlds, ice worlds and asteroids with the rover; one gas-giant probe sequence; one ocean world with the boat. More body types and compositions get added over time. The environment profile system is data-driven, so new classes are content, not code.

## 3. How Technology Unlocks
**[PROPOSED]** You don't just buy tech. You **bring back what's needed to develop it**.

- Projects at the Intrepid (e.g. "pressure hull mk II") need specific resources, samples or survey data, plus money.
- Each project is run by a clan: Midshipmen for ship systems, Diggers for mining gear and rovers, Lyceum for science and medicine, Helm for sensors and navigation, and so on. That links tech to reputation.
- In lore, every project is humans slowly deciphering the **Archive**, the AI data dump. The Covenant opposes each one.
- Your discoveries become the gate on progress. Finding acid-resistant microbes on a toxic moon could unlock corrosion coatings, which open up hothouse worlds.

## 4. Vehicles
| Vehicle | Role | Upgrade paths |
|---|---|---|
| **Freighter** | Folds, flight, landing, skimming, docking, mining laser | Drive tier (fold range), hull ratings, cargo, sensors, weapons/shields, scoop, bays |
| **Rover** | Solid surfaces | Treads/suspension, environment seals, armor, cargo, sensors, stun device, range |
| **Boat → Submersible** | Liquid surfaces → depths | Hull pressure rating, sonar, sample arm, cargo |
| **Probes** (consumable) | Gas giants, deep oceans, hazardous scans | Crush depth, sensor suite, sample return |
| **EVA team** | Asteroids, derelicts, ruins too tight for vehicles | Suits (radiation, thermal), tools |

**The freighter lands [DECIDED].** Its hull ratings decide which worlds it can set down on. **Later:** as tonnage grows, large freighters lose the ability to land on high-gravity or thick-atmosphere worlds, and need a **dropship** that carries vehicles and cargo between orbit and surface. Two benefits: growing bigger has a tradeoff, and the dropship becomes its own upgrade path.

**Bay capacity [PROPOSED].** The freighter's vehicle bay has limited slots. Choosing rover, boat or extra probes before you fold becomes a real decision.

**Scope note.** The rover and boat share one surface engine with different terrain passability. The submersible adds a depth layer. Probes and EVA are short, focused sequences. That's three real modes in total, not five.

## 5. Surface Operations: Planets Are Big **[DECIDED]**
Starflight's instant pickup is out. Exploring and extracting take time, and that's where most of the game's years go.

### Scale
- **Each world is divided into regions** (e.g. about 20–200, depending on size). A landing explores one region, not the whole planet.
- **Survey completion is tracked per region and per world.** A completionist could spend a career on one Earth-sized planet, and the game should reward that without requiring it.
- **Orbital scans narrow the search.** Better sensors and Science skill reveal which regions hold deposits, life or anomalies, so landings are informed bets, not blind ones.

### Mining loop
1. **Prospect.** Rover sensors and core samples confirm a deposit's grade and depth.
2. **Set up a drill site.** This takes hours. Drill rating limits depth and rock hardness (Diggers sell the best gear).
3. **Extract.** This takes days. Yield per day depends on drill tier, crew skill and the deposit. Weather and hazard events can interrupt it.
4. **Process, or haul raw.**
   - Raw ore is heavy and low-value per ton.
   - A portable refinery turns it into concentrate, which is lighter and more valuable, but takes extra days, power and a bay slot.
   - That makes it a cargo-versus-time-versus-equipment tradeoff.
5. **Load and leave**, or stake a claim to come back. A claim could later become an outpost.

### Specimens
- Track, stun and contain lifeforms. Containment needs life support matched to the specimen's environment.
- Specimens degrade over time if containment is poor, so a long expedition puts your specimens at risk.
- The Lyceum pays for specimens, and pays more for ones that are new, healthy and well documented.

### Artifacts and ruins
- Excavation is slower and riskier than mining, but artifacts feed the story, the Archive and research.

### Time cost targets [TUNE]
| Activity | Game time |
|---|---|
| Rover traverse across a region | Hours to a day |
| Prospecting a site | Hours |
| Drill setup | Hours |
| Extraction | 1–10 days per site |
| On-site processing | +50–100% of extraction time |
| Specimen hunt | Hours to days |
| Ruin excavation | Days to weeks |

**V1 simplification.** Drilling and processing are timed actions with progress bars and interrupt events, not minigames. We can add depth later if they feel thin.
