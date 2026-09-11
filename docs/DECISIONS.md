# Technical decisions

Short record of the choices that shape the code and why, so another coding agent can continue the work. Product decisions are the owner's and live in `GAME_CONCEPT.md`.

## Engine and loading
- **Three.js r186, loaded as ES modules through an import map from jsDelivr** (`index.html`). Pinned to an exact version so the game cannot break when a new release changes behaviour. No addons are used; camera controls are custom because the game needs snap rotation, not orbiting.
- **No build step, no bundler, no framework.** GitHub Pages serves the files from `main` as they are, which keeps the iPad-only workflow possible (edit → push → reload). All paths are relative so the site works at the `/Gaming-App/` sub-path; `.nojekyll` stops Pages from ignoring files.
- `index.html` imports `src/main.js` dynamically and shows an error overlay if the engine cannot be loaded or the floor data is invalid, instead of a blank page. The "Tap to begin" button stays disabled ("Loading…") until the first frame has rendered.

## Rules separate from rendering
- `src/game/` contains only plain JavaScript: no Three.js, no DOM. `floor.js` (geometry from data), `grid.js` (walkable grid + A*), `state.js` (discovery, action points, turns) and `moves.js` (plan a walk from a tap, apply the rules) can be run in Node and later on a server for multiplayer. `src/render/` only draws what the game state says.
- Room transitions are detected from the player's position crossing a room boundary (`discovery.update`). Rooms are axis-aligned rectangles that touch but never overlap, so each doorway is exactly one boundary crossing, and the pre-check in `moves.planMove` counts the same crossings (prefixed with the room the player actually stands in) before allowing a walk.

## Players and turns (hot-seat)
- `state.players` holds per-player rules state (current room, action points, health, alive, possessed, hand, unmasked-knowledge); discovered rooms and encounter locks are shared. Only `state.activeIndex` acts; `endTurn` passes control to the next **living** player and refills their points from `rules.actionPointsPerTurn`. A round is one pass round the table; a new lap clears the per-room encounter locks. (The `escaped`/continue model of pass 2 is gone — reaching the exit is now a win check, not a per-player exit.)
- Movement objects (`src/player.js`) are one per player; only the active one is updated each frame. Handing over the turn `halt`s the outgoing player (clears any queued path and the walking flag) so a half-finished walk can't resume — and spend a fresh point — when their turn comes round again, and so their figure doesn't keep animating a walk in place.
- Encounters resolve after the walk finishes (the arrival is detected when the active mover's path empties), so a move-and-meet is one confirm then one modal.

## Characters (`src/data/characters.js`, `src/render/characterView.js`)
- Body types (male/female proportions) and outfits (colours + silhouette: tie/bow tie/lapels, A-line/column/full skirt) are data. The roster names five players with an outfit and a marker colour each.
- The view builds an articulated figure from boxes with pivots at shoulders and hips and a simple walk cycle; a coloured floor ring identifies each player and a marker floats over the active one. A future glTF character view only needs to offer the same `{ group, update(mover, dt), setActive() }` surface — nothing in the rules knows what a character looks like.
- Draw calls: ~17 meshes per character (≈85 for five) on top of the rooms. Fine for now; if the iPad struggles once all rooms are revealed, merge each room's static boxes into one mesh.

## Data-driven floor (`src/data/floor1.js`)
- Rooms are placed by centre and size; furniture by room-relative position and size; each room carries its mood.
- **Doorways are declared once**, on either room, as *which wall*, *offset from that wall's centre*, *width*, *to room*. The loader creates the matching opening on the neighbour and validates that the rooms really share that wall. Overlapping rooms, unreachable rooms, doorways blocked by furniture and a missing exit are reported as fatal problems.
- The floor has **14 rooms** around a central landing with four doorways (west: corridor + guest suite dead end; north: corridor, lounge, library and a back passage looping round to the kitchen; east: corridor, service corridor, stairs and the exit, with a storage dead end; south: dining room dead end). Five start spots are listed in `start.positions`.
- Action-point rules (`rules` block) are data too; the code never hard-codes costs.

## Camera and cutaway
- Perspective camera on a rig: fixed pitch (56°), distance = zoom, yaw snaps in 90° steps with a short eased turn. The rig follows the player with a lag; a two-finger drag adds a world-space pan offset that eases back to the player once the fingers lift.
- Pan is computed by projecting the fingers onto the ground plane, so the floor sticks to the fingers at any zoom level.
- **Cutaway rule** (`render/cutaway.js`): based on the camera's yaw only (so walls never flap while walking). A wall shared with another *discovered* room is lowered whenever it is perpendicular to the view, so you can see over it into the next room; exterior walls and walls to undiscovered rooms are lowered only when they face the camera, so the far walls stay as a backdrop. Wall meshes have their origin at the floor so lowering is a `scale.y` change; nothing ever scales to 0.

## Pathfinding and discovery
- 0.25 m grid over the floor. A cell is walkable if it lies inside a room away from the walls (wall thickness + player clearance) or inside a doorway opening, and not inside a furniture box grown by the clearance. A* with 8 directions and no corner cutting; the cell path is then straightened (string pulling with a side margin) so walking looks natural.
- Only cells of discovered rooms are usable, plus a **landing** just inside each undiscovered room behind a glowing doorway. Tapping on or near a glowing doorway targets that landing, so a tap on the frame reliably takes the player through (a tap exactly on the boundary would otherwise stop one cell short).
- Tapping deep inside an undiscovered room does nothing; tapping furniture or a wall snaps to the nearest walkable floor within 1.5 m.

## Lighting and look (greybox)
- Three.js r186 uses physical light units: point-light intensity is candela with inverse-square falloff. Mood intensities in the data are small numbers multiplied by `config.render.pointLightScale`. Neutral tone mapping keeps warm colours from clipping to white.
- **All point lights exist from the start** (added to the scene, not to the hidden room groups) with intensity 0 until a room is revealed. Three.js recompiles every shader when the number of lights changes, which would stall on the iPad at each reveal; a constant count avoids that. Budget: about 12 point lights per floor. `MeshLambertMaterial` everywhere (cheap), no shadows, no post-processing.
- Each room's floor and wall greys are pulled 20% toward the room's mood colour (`config.render.moodTint`) so the warm→cold shift also shows in the surfaces, not only in the light.
- A light flickers only where the room's `mood.flicker` says so (currently the back passage and the service corridor). Doorway highlights are opaque and steady — an earlier pulsing version read as flicker on the device.
- 16 point lights on this floor (14 rooms, two with a second light).
- Soft **contact shadows** (one shared radial-gradient texture, `materials.makeShadow`) sit under each character and furniture piece to ground them on the floor — cheaper than real shadow maps and enough for the greybox. Furniture is tinted toward each room's mood colour like the walls, so the boxes sit in the room rather than reading as separate cool grey.
- Pixel ratio is capped at 1.5 (iPads report 2). Slightly softer, much cheaper per frame. `window.__game.setPixelRatio(2)` lets the owner compare on the device.

## Input
- Pointer Events on the canvas handle touch and mouse alike. One finger = tap to walk (only if it stayed single-finger, moved ≤ 10 px and lasted ≤ 450 ms); two fingers = pinch zoom + pan; right/middle mouse drag = pan; wheel = zoom (ctrl+wheel = trackpad pinch); Safari's gesture events are used only when no touch pointers are active (desktop trackpad). `touch-action: none` plus non-passive `touchmove`/`gesture*` listeners stop iPad Safari from zooming or scrolling the page.
- No audio yet. The "Tap to begin" click handler is the place to unlock audio later (iOS only allows it inside a tap).

## Testing
- Headless Chromium (Playwright) loads the real `index.html` from a static server; the CDN requests for Three.js are intercepted and served from a local copy because the sandbox blocks the CDN. The suite drives the game through real taps/clicks and through `window.__game` (the debug hooks in `main.js`), checks for console errors, and verifies discovery, action points, End turn, rotate/cutaway, map, exit, restart, pinch, pan, wheel, draw calls and that the shader program count never grows. Screenshots are used for visual sanity.
- Software rendering there runs ~7 fps and the game clamps frame time at 50 ms, so time-based checks step the simulation manually.

## Rules engine (Hotel Escape)
Implements `docs/GAME_RULES.md`. Kept pure and separate from rendering so a server can reuse it.
- **All rule numbers live in `src/data/rules.js`** — action points (4/turn), action costs (move 1, discover 1, search 1, use-card 1, attack 1), health (3), hand size (4), the searchable deck composition, the possessed supply (3 Possession cards), Lanterns-to-escape (3), and per-card behaviour. Change values there, never in code.
- **Entering a room costs move + discover the first time (2 AP for a new room, 1 for a known one).** `moveCostInto`/`enterRoom` add the discover point when the room is being revealed; `usableDoorways` only blinks a door the player can actually afford, and the confirm bar shows the real cost.
- **Cards** (`src/game/cards.js`): a seeded PRNG (mulberry32) drives shuffling and dealing so a game is reproducible in tests; `main.js` seeds from `Date.now()` and reseeds on New game. Each card is an instance with a unique id (revolvers carry their own `shots`). The draw pile excludes Possession cards — those are the possessed side's private supply, dealt to the possessed player at setup and then circulated only through successful trades, so the supply stays capped at 3.
- **State** (`src/game/state.js`): per-player `health`, `alive`, `possessed`, `hand`, `knows` (ids unmasked), `currentRoom`, `actionPoints`; shared `discovered` rooms and `encounterLocks`. `enterRoom` charges the move and reveals; `endTurn` skips the dead, refills AP and, on a new lap, bumps the round and clears the encounter locks. `checkWin`: humans win when a clean, living player with 3 Lanterns enters the exit; the possessed side wins when no living clean player remains.
- **Encounters** (`src/game/actions.js`): `resolveTrade` takes both players' chosen cards and applies the spec exactly — a Possession card converts the receiver unless they gave a Lantern, in which case possession fails, the Lantern goes to the possessed giver, the Possession card stays on the possessed side, and the defender learns the giver is possessed. `resolveAttack` applies knife/revolver damage, spends and discards an empty revolver, and marks a player dead at 0 HP. A per-room, per-round `encounterLocks` set stops the same pair being forced to meet twice in one room in a round.
- **Cards deferred per spec §11**: Master Key, Lock Pick and Barricade are in the deck (so its composition matches the 6-player spec) but have no effect yet because locked/hidden rooms are explicitly out of this build; the hand panel labels them as such.

## Turn-based interaction
- Movement is no longer free roaming: on a player's turn the doors leading out of their room blink (a bright floor bar, a deliberate action cue kept separate from the mood flicker). Tapping a door raises a confirm bar; confirming spends 1 AP and walks the player to a free standing slot in the room (the centre, or a nearby spot when others are already there — arrivals avoid overlapping). Tapping inside the current room is a free reposition. An undiscovered room can only be entered as far as the doorway landing until it is revealed, after which the player can move freely inside it.
- The encounter modal mirrors the real game's flow even though hot-seat makes everything visible: the entering player picks a card, then the other, then it resolves. The UI is split into `src/ui/` (card tiles, hand panel, encounter modal) so the presentation can change without touching the rules.
- Rooms are searchable only where the data says so (`searchable: true` — the content rooms: guest suite, lounge, library, kitchen, storage, dining), never corridors/landings/stairs, and each room can be searched once (`state.searchedRooms`). Dark rooms (`dark: true` — Back Stairs Passage, Storage, Service Corridor) also need a Flashlight to search.
- A forced encounter is with one player of the entering player's choice: when a room holds several others, the encounter modal shows a chooser first, and only the chosen pair is locked for the round (the others aren't forced).
- A dead player's character view lies flat with a small blood pool (`characterView.setDead`) and stays where they fell; the turn strip crosses them out.

## Interface layout (portraits, panels, hand)
- Placeholder character faces live in `src/ui/portrait.js` (`makePortrait(doc, player, {possessed})`) as inline SVG — one function behind which real face art can drop in later without touching the interface logic. Normal and POSSESSED (an altered "weird eye" plus a colder wash) are two states of the same call; callers just pass the player and whether to show the possessed look.
- Bottom-left **active-player panel**: portrait (normal / possessed), name, three health bars, AP. The possessed portrait and a subtle full-screen tint (`#possess-tint`, pointer-events none, under the HUD) are driven by the active player's `possessed` flag, so they update automatically.
- Top **players strip**: a small portrait + name per player, the active one highlighted with a coloured ring and a TURN tag, the dead crossed out. These portraits are always drawn normal — they never reveal a possessed role (hidden information).
- Bottom-centre **hand**: the active player's cards face down (card backs, capped at 8 drawn) with a count badge that re-renders on every `refresh()` (after trading, searching, using, discarding). Tapping the strip opens the detailed face-up hand panel.
- The AP display, turn indicator, rotate buttons, End turn and the map button are kept; the layout puts player info bottom-left, cards bottom-centre, actions + view controls bottom-right, so the middle stays clear on an iPad in landscape.
- **Hand limit** (`rules.handLimit`, 6): at End turn a player over the limit gets a discard modal (`src/ui/discard.js`) — tap cards to drop until at 6, then Done — before control passes on. `actions.discardCard`/`overHandLimit` are the pure helpers.
