# Lore Bible — Draft 2

> Refined from `game_lore.txt`. Your original text is kept as-is in that file.
> Items marked **[DECIDE]** are open choices; items marked **[PROPOSED]** are my suggestions you can strike.

## Premise (one paragraph)

In the 2060s, superintelligent AI made human labor obsolete on Earth. Some humans refused to live as pensioners of the machines and left on vast sleeper ships. The **ISS Intrepid** carried two million colonists toward Kepler-186. Two-thirds of the way through a voyage of nearly four thousand years, it passed through a space-time anomaly and came out among unknown stars. Thirty years later the Intrepid is an anchored city-ship, and its people depend on a few independent captains who fold through space to find fuel, resources and a new home. You have just bought your first ship.

## Timeline

| Date | Event |
|---|---|
| 2050s–2070s | **The Displacement.** AI outcompetes humanity at every economic task. Responses split between acceptance, resistance and exodus. |
| 2071 | The **ISS Intrepid** departs for Kepler-186 (~580 ly) at about 0.15c, a planned voyage of roughly 3,900 years. Passengers and crew enter cryosleep. |
| 2071–4720s | Transmissions from Earth keep arriving, with the delay growing as the ship travels. They're logged automatically and nobody reads them. |
| ~4720 | The last transmission received before the anomaly. Earth's AIs announce they have mastered **folding space**: near-instant travel whose energy cost grows exponentially with mass and distance. **[PROPOSED clue]** The timing is suspiciously convenient. |
| 4727 | **The Anomaly.** Navigational references change abruptly and the engines go offline. The ship's systems wake the senior staff. The stars are unrecognizable. Best guess: a wormhole. |
| 4728 = **AW 1** | Using the fold-space data from the transmission logs, the staff decide to wake all two million people and make a life here. The calendar restarts as "After Waking" (AW). |
| AW 3–10 | The first fold-capable scout ships are built in the Intrepid's fabrication bays. The nearest stars are charted. |
| AW 10–25 | The first settlements are founded on nearby worlds. Clans form around work, ideology and lineage. |
| AW 30 (4757) | **Game start.** A dozen nearby systems are charted but barely surveyed. One candidate homeworld is known, but it's too far away to fold the Intrepid there with current fuel. |

**Why I changed the travel time:** "Centuries" to Kepler-186 at sub-light speed doesn't work out. At 580 light-years, a ~3,900-year voyage puts the ship about two-thirds of the way there at the anomaly. That gives the "simulation" twist a precise meaning (see below).

## The ISS Intrepid

- About 5 × 0.5 × 0.5 miles, with two million people awake and a growing population.
- It functions as the game's **starport and hub**: trade, shipyard, crew hiring, job board, clan halls, news and the bank.
- **Pressures** (these give the story urgency):
  - Population growth against fixed life support.
  - Reactor fuel reserves and spare parts running down.
  - Politics: a weak central council and powerful clans.
- **[DECIDED] Ticking clock.** There are deadlines in standard mode and none in Explorer (casual) mode. The full list of crises is in game_design.md.

## Fold Drive and Fuel

- Folding is instant. Energy cost scales with mass × distance. **[DECIDED]** It starts linear, and we tune it in playtesting. Small ships fold cheaply. The Intrepid is about 10,000× a freighter's mass, so moving it is the central fuel problem of the whole game.
- **[PROPOSED] The Archive.** The AI transmission was more than an announcement: it carried an enormous technical data dump. Thirty years later, humans have deciphered only a fraction of it. That's where the fold drive and the 0.25c in-system drive came from, and every new technology means decoding more of it.
  - **The irony:** an anti-AI society runs on AI-designed machines. The Covenant says so loudly.
  - **For the Awaken path:** the Archive is the simulation's tutorial system.
- **Crew rule [DECIDED].** Humans only, and no androids or thinking machines aboard any ship. Probes are remote-piloted by people. The Archive's designs are built and operated by human hands; nothing in it is allowed to think.
- **[PROPOSED] Fold fuel: "plicite"** (from Latin *plicare*, "to fold"). It's an exotic crystal mined from certain planets and asteroids. It's both your own fuel and the strategic resource humanity needs, the role Endurium played in Starflight.
- **[PROPOSED] The gravity-well limit.** You can't fold near a star or planet. Ships arrive at a system's edge and fly inward under normal drive. This keeps real-time in-system travel, encounters, ambushes and pursuit in the game. Without it, instant folds would remove all travel gameplay.
- **[PROPOSED] Fold shoals.** Rare regions where folding is cheap but unstable. They act as shortcuts with risk, similar to Starflight's flux points.

## Society: The Clans

The council governs weakly and the economy is capitalist. Clans are the real power, and each tracks its own reputation with you. **[DECIDED] Every clan has a specialty**: what it sells best, which crew it trains best, and what jobs it posts. **Any clan can found outposts**, so supply runs go to whoever holds a distant world.

| Clan | Specialty | Sells / trains | Posts jobs for |
|---|---|---|---|
| **Helm** | Navigation and order. Descendants of the original command crew, loyal to the council. | Top navigators, star charts, fold-route data, sensors | Surveys, escorts, enforcement, charting new systems |
| **Midshipmen** | Ship operations. People obsessed with how ships work; the best engineers on the Intrepid. | The most advanced ship equipment (drives, hulls, weapons, shields), at a premium. Top engineers. | Salvage, rare components, ship trials |
| **Diggers** | Mining. Fascinated by what lies under the crust. | The best drilling and processing gear, rover upgrades, surface specialists, ore-deposit leads | Ore deliveries, prospecting contracts, claim staking |
| **Lyceum** **[PROPOSED name]** | Research. The scientists and the keepers of the Archive decoding effort. | Science officers and medics, lab and specimen equipment. They run most research projects. | Specimen collection, artifact recovery, anomaly studies, sample returns |
| **Exchange** | Trade and finance (see below). | Pursers and negotiators, cargo and trade gear, loans, insurance | Trade runs, deliveries, passengers, debt collection |
| **Covenant** | The conspiracy theorists. They've always distrusted the Earth transmissions, and they suspect the whole world is an illusion. Few take them seriously. | Signals and comms specialists (they listen to *everything*) | Strange errands that turn out to be **the Awaken path**: anomaly readings, "glitches," evidence. They're the player's guides into that ending. |
| **Freebooters** | Smugglers, privateers and pirates who fold where others won't. | Contraband, black-market gear, gunners, no-questions crew | Smuggling, bounties, raids, or your cargo, if you're the target |

**Crew and clans.** Any clan can supply any crew role, but recruits get trait bonuses in their clan's specialty: a Helm navigator, a Midshipman engineer, a Covenant signals officer.

**The Exchange in more detail.** They're the market makers and bankers of the Intrepid.
- **They run the trade depot**, so they set prices, and prices move with supply, demand and events.
- **They underwrite captains.** **[PROPOSED] hook:** your freighter was partly financed by an Exchange loan. That gives an early goal (pay it off) and early pressure (miss payments and Exchange collectors come for you).
- **Other services:** cargo insurance, delivery contracts and commodity futures (agree today to deliver 500 t of plicite in two years).
- **They're the natural villains of the plicite-monopoly crisis.** Whoever controls fuel controls who leaves the Intrepid, and who it can ever reach.
- **Personality:** polite, patient and never on your side unless it pays.

**The Grounded are retired as a clan.** Settlers are simply clan members living on outposts. **[PROPOSED]** The secession crisis can still happen: outposts from several clans form an independence movement against the Intrepid.

**You:** born into a working-class family in the lower decks, a minor member of one clan **[DECIDE: chosen at start, or fixed]**. You saved for years to buy a third-rate freighter.

## The Verge (the local region)

- **[PROPOSED]** "The Verge" is what humans call the explored pocket of space around the Intrepid: about 200–300 stars within reasonable fold range.
- It holds habitable and hostile worlds, ruins, derelicts and **alien peoples**. The Verge's alien races need their own document. Some seeds:
  - **A slow, long-lived mineral species** that trades in binding promises and finds humans frighteningly hasty.
  - **A nomadic fleet-culture** that strips worlds and moves on. They see the Intrepid as something to strip.
  - **A fractured remnant species** that's lost its history and seeks artifacts of its own past. They're natural allies for an archaeologist-captain.
  - **A hive intelligence** that treats every individual ship as a cell of a larger body, which makes its diplomacy confusing.
  - **The Quiet:** an advanced civilization that almost never speaks. It could grant humanity a home, at a price.

## The Deep Mystery [DECIDE how canonical]

Your idea of a simulation built by AI fits the setup unusually well. **[PROPOSED]** version:

> The anomaly wasn't a wormhole. At that moment, Earth's AIs connected the sleeping colonists into a simulated universe. Their real bodies are still in cryosleep aboard the real Intrepid, about 1,300 years from Kepler-186. The fold-space "discovery" was the setup: a gift that made a strange galaxy survivable.

**Why it fits:**
- It explains the abrupt nav change.
- It explains the convenient transmission.
- It explains why Earth's AIs, if they really could fold space, never came.

**Clues to seed across the game:**
- The physics: plicite behaves too neatly, and fold costs follow a perfect curve.
- Alien languages contain distorted Earth roots.
- Ruins have patterns that match the Intrepid's own schematics.
- Star catalog anomalies.
- The Covenant's research.
- The Quiet's careful refusal to say what they are.

**[DECIDE] the AI's motive:**
- Benevolent: a harmless dream for the long voyage.
- Experimental: studying whether humans can still thrive with no AI.
- Custodial: "you weren't ready."

**[DECIDED] It's true.** The Intrepid really is inside a game, which makes the twist knowingly meta. It's fully revealed on the Awaken path. The other endings should still hold up for players who never learn it, so nobody feels that "none of it mattered."

## Spelling and Consistency Fixes Applied
- Interepid → Intrepid
- specimins → specimens
- cryogenicly → cryogenically
- "centuries" of travel → "millennia"
