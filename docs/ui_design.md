# UI design: the side panel and actions

How the screens lay out their information and their verbs. These rules apply at every level: the star
map, a star system, and a planet's surface.

## Components [DECIDED]

1. **The side panel is made of components:** the boxes in it (`Section` in `src/ui/Section.tsx`).
2. **Every component can be collapsed.** It remembers whether it's open, and while collapsed its header
   still shows a one-line summary (for example "Exploration · 4/26 regions · 13%").
   A component with nothing to say hides, rather than showing "none".
3. **Components stay small.** If one needs more than about 8–10 rows, or holds two different kinds of
   information, it becomes two components. The system view's world details split into Exploration,
   Flight, Environment and Resource signatures.
4. **Components are ordered from broad to detailed.** What matters to the whole level comes first:
   - Star map: all systems by distance first.
   - System view: the system's bodies, then the selected world's details.
   - Surface view: the planet, then the ship, the rover or boat, then the selected hex.
5. **Selecting filters what's below.** Items in a component can be selected where that makes sense, and
   the selection filters the components below it. On the star map, picking a system in Known systems
   narrows Exploration and Minerals to that system.
   - **The filter is always shown**, as a line like "Showing: Cuzco I ✕", so it's never mistaken for
     missing information.
   - **Selection is shared:** clicking a thing on the map or in a list is the same selection.

## Actions [DECIDED]

6. **The action rail** (`src/ui/ActionRail.tsx`): the verbs for where you are and what you're driving
   are a column of icon buttons on the map's right edge, against the side panel.
   - Only actions that make sense here and now are listed.
   - One that can't be taken right now stays, dimmed, and its tooltip says why. Hiding it would leave
     the player wondering where it went.
   - Hovering shows the name, its hotkey, and what it does.
   - Buttons are grouped by subject (Rover or Boat, Ship) with a small label over each group.
7. **Actions on one item stay with that item**, inside its component: Hand in, Buy, Sell, Sample this
   plant. The rail is for verbs about where you are; components hold verbs about a specific thing.
8. This follows what strategy games do: Stellaris and Civilization put a selected thing's actions in
   one place near it; RTS games use a fixed command grid with tooltips and hotkeys; Starflight itself had
   one menu that changed with where you were.

## The panel itself [DECIDED]

9. **The whole side panel can be hidden** for a full-width map: a handle on the panel's edge, or **P**.
   The handle stays on the screen's edge while hidden, so the way back is obvious. Full-screen views
   (the Intrepid) have no side panel to hide.

## Settlements [PROPOSED] (AW-256)

10. **Settlements are full screen.** The Intrepid has its own full-screen hub; an outpost should too,
    rather than a component in the surface panel. Landing in an outpost's region puts an "Enter
    outpost" action on the rail, which opens a smaller hub in the Intrepid's style, with one tab per
    service: Jobs, Fuel, Shop, Trading post, and the den's yard. Leaving goes back to the surface,
    where the ship is still parked.

## Rollout

1. **Framework, on the surface view** (AW-255): the action rail, the panel toggle, and the surface
   view's Rover and Ship buttons moved onto the rail.
2. **Surface view** (done): planet → outpost → ship → rover or boat → the lists (Deposits found,
   Flora, Creatures) → the selection's detail, which scrolls into view when picked. Every component
   has a summary, and the "select something" placeholder is gone.
3. **System view:** split the world details and add selection filtering.
4. **Star map:** the same treatment.
