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

## Real art — room dressing (first pass, starting room only)
- **Assets**: Kenney's CC0 *Furniture Kit* and *Building Kit* (glTF/`.glb`), organised under
  `assets/models/furniture/` and `assets/models/building/` (with the shared `Textures/colormap.png`
  kept beside the shell pieces so their relative texture references resolve). Loaded at run time
  with `three/addons/loaders/GLTFLoader.js` (already on the import map).
- **One cheap material everywhere**: `render/models.js` converts every loaded PBR material to the
  same `MeshLambertMaterial` the greybox uses and **recolours by material name** toward warm
  walnut / cream / brass (late-80s grand-hotel Art Deco). Changing the whole look is a one-file
  edit to the `PALETTE` there. Models are cached and cloned (shared geometry + materials); a
  per-instance `overrides` map recolours one clone (e.g. the rug's deep red-brown).
- **Data-driven, room-agnostic**: which room gets dressed and with what shell/decor lives in
  `src/data/dressing.js` (keyed by room id — only listed rooms are touched, everything else stays
  greybox). The **colliding furniture stays in the room data** (`floor1.js` `furniture`, now with
  `model` / `yaw` / `scale` / `props` fields): collision and the visible model come from the *same*
  footprint, so you can't walk through what you see.
- **Scale**: the Kenney pieces are true-to-life size, but next to the ~1.8 m box characters they
  read as small, so each furniture entry carries a `scale` (≈2–2.6×) that enlarges the model AND
  is baked into its collision `size`. Bookcases stand taller than a person; the sofa/chairs are
  generously sized. Layout is composed into wall/corner groupings (a seating group on a rug, a
  reading nook, a console, an entrance) with the room centre and the four doorway lanes kept clear
  so the five start spots and pathfinding are unaffected — verified by a footprint/spawn/overlap
  check before the values were committed. `render/roomDressing.js` applies it: hides the
  greybox floor + furniture boxes (their contact shadows are kept to ground the models), lays a
  wooden floor as a single `InstancedMesh` of the 2 m tile, rebuilds each wall segment from tiled
  wall pieces **slotted back into the cutaway** (an inner node bakes out the model's height so the
  existing metre-based `setWallHeight` still lowers them), then places furniture + non-colliding
  decor (rug, cushions, coat rack). `buildFloor` passes the presentation fields through untouched;
  the game logic still only reads `center`/`size`.
- **Warm lamp lighting**: the starting room's `mood.lights` gained a few points that the dressing
  drops down to lamp height and warms; lamp shades are emissive so they read as the source. Light
  **count is fixed before `renderer.compile()`** (added via the data, created up front at intensity
  0) so no shader recompile stalls on the iPad — the same rule the greybox already followed.
- **Facing**: every Kenney piece faces +Z at yaw 0 (backrest/back at −Z). So a piece sitting
  against a wall faces into the room with yaw = south wall 180, north 0, east −90, west 90. The
  `yaw` in the room data follows that rule; `scale` (≈2–2.6×) sizes each model to the ~1.8 m
  characters and is baked into the collision `size`. Placements are validated by a script
  (footprints, spawns, all doorways, per-room reachability, overlaps) before they're committed.
- **Starting room — bespoke Art Deco pass** (`src/render/hallDeco.js`, `style: 'deco'` in the hall
  dressing): the hall is rebuilt from procedural geometry + small CanvasTextures (no downloads):
  ivory-and-walnut panelling with a brass chair rail, walnut parquet, a patterned burgundy rug,
  brass sconces, a framed Deco sunburst, brass doorway surrounds and a proper double-door lift
  with a sunburst pediment, floor indicator and call button. **Cutaway-safe**: the panelled wall
  meshes stay 1-unit-tall groups in `view.walls` (the existing cutaway squashes them), and every
  protruding decoration is registered on the wall segment it sits on and hidden when that segment
  lowers (a thin wrapper around `view.setWallHeight`), so nothing floats when the camera rotates —
  verified programmatically. It uses its own materials/textures and does not touch the shared
  model loader/palette, so other rooms are unchanged. (Floor is basket-weave parquet for now;
  herringbone is a possible tweak.)
- **Starting room — benchmark craftsmanship pass** (extends `hallDeco.js`): the hall is now the
  visual reference for the rest of the game. It replaces the generic Kenney furniture with its own
  bespoke, procedurally-modelled pieces (a camel two-seat sofa with rolled arms + throw cushions, a
  green velvet wing chair, a walnut-and-glass coffee table with a book shelf, a three-drawer console
  with brass pulls) built from shared box/cylinder geometry and coordinated wood-grain + fabric
  CanvasTextures. `roomDressing.js` skips the generic furniture for `deco` rooms (`if (deco)
  continue;`), but the collision/walkable grid is unchanged — it still comes from the same
  `floor1.js` footprints, so the models match what you can walk around. Architectural relief was
  added as real geometry: a walnut skirting board, a picture rail and a cream crown cornice run
  along every wall segment, and each of the four doorways gets a refined walnut surround (two jambs
  + a header + a brass fillet). The surrounds sit **proud of the wall and outside** the game's gold
  doorway markers, so they never share a plane with them (no z-fighting) and never hide the
  "leads somewhere" cue. Period objects dress the room: a glowing brass table lamp, a rotary
  telephone, book stacks, a second framed picture (a warm landscape) on the east wall, a longcase
  (grandfather) clock against the west wall, and a stack of cognac suitcases by the lift. Every
  wall-mounted piece (surrounds, mouldings, art, clock, sconces) is registered on its wall segment,
  so it lowers/hides correctly on cutaway; furniture and the low luggage stay visible (you're
  meant to see them when a wall opens). Grounding uses the existing soft contact shadows plus a
  couple of extra shadow blobs under the free-standing clock and luggage. Still no downloads, no
  build step, hall-only; the shared loader and other rooms are untouched.
- **Starting room — craftsmanship refinement** (further work in `hallDeco.js`): a quality pass on
  the same room. Furniture is rebuilt with `RoundedBoxGeometry` (from `three/addons`) so cushions,
  arms and table/console edges are softened; backs are gently reclined (a small `rotation.x`), arms
  are shaped with a rounded body + a cylinder roll, and a `legs4()` helper rises every leg from the
  floor to the piece's underside so nothing floats. A rounded-box geometry cache keyed by
  dimensions keeps this cheap. Brass moved from self-lit `MeshLambert`+emissive to `MeshPhong` with
  a warm `specular` and modest `shininess`, so it now catches a restrained highlight from the room's
  point lights (lamp shades stay emissive). The parquet and rug canvas textures were retoned for a
  calmer, higher-quality read (close plank tones + hairline seams + soft grain; a woven rug field
  with a simple gold border). Contact shadows for the seating group are re-added on the rug surface
  (the rug plane at y≈0.02 was covering the greybox shadows at y≈0.012). Plants use flattened
  4-sided cone "blades". The shared doorway indicator (`roomView.js`) is made slightly translucent
  so it fits the palette as a soft glow — the one change visible in every room; everything else is
  hall-only, and the model loader is still untouched. Scene stays light (~350 draw calls).
- **Rooms dressed so far** (by theme, only where the Furniture Kit fits): the **hall** (landing —
  a seating group, a console, plants, the lift), the **library** (bookcases facing in, a reading
  chair + lamp), the **lounge** (two sofas in an L round a coffee table), and the **dining room**
  (round table + chairs + a sideboard). Kitchen, storage, corridors, stairs and the guest suite
  stay greybox — the kit has no counters/beds/crates, so nothing inappropriate is forced in.
- **Model recentring**: Kenney furniture models often carry an off-centre pivot, so placing one
  at its intended point pushed it through a wall or left it floating. `models.js` now wraps each
  loaded model and recentres the content (centred on X/Z, base on the floor at Y=0), so a piece
  placed at a point sits centred on it and flush, matching its collision box. Building shell
  pieces are already centred, so this is a no-op for them.
- **Floor culling**: the tiled floor is one `InstancedMesh`; its bounding sphere is at the model
  origin, so for rooms far from the world origin Three.js frustum-culled the whole floor when the
  origin was off-screen (the floor vanished to the dark background). Fixed by `frustumCulled = false`
  on that single mesh.
- **Performance**: ~180 draw calls / ~7 k triangles for the fully dressed starting room; trivial
  for a real GPU. It is *fill-rate* heavy only under the headless software renderer (many pixels ×
  ~19 point lights), so `browser-test.mjs` renders at half resolution — a test-harness speed knob,
  no game change. If the iPad ever struggles once several rooms are dressed, instance repeated
  furniture and merge each room's static meshes (the seam is all in `models.js`/`roomDressing.js`).

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

## Interface redesign — Art Deco player interface (pass 11)
- The interface was restyled to the approved grand-hotel concept (charcoal-navy panels, brass
  hairline framing, ivory serif display type) entirely in `styles.css` plus small structural
  changes; **every DOM id/class the game code and the browser test rely on was preserved**, so the
  redesign is mostly presentational. Two browser-test lines were updated where an interaction
  genuinely changed (the AP label is now "x / y", and Bandage is used from the hand's detail pane).
- **Guest strip** (`hud.js` `buildStrip`): portrait cards with names, an identity-colour underline,
  and `Your turn` / `Next` flags (`.mini-player.active` / `.next`). Still built once per roster and
  always drawn neutral — possession is never shown here.
- **Active-player panel**: larger portrait, health segments (`#health`), action pips (`#ap-pips`) +
  a numeric `#action-points` ("x / y"), and a *Private details* link that opens the hand. The
  possessed tell (weird-eye portrait + `#possess-tint`) shows only on the current guest's own panel.
- **Hand** (`ui/hand.js`): a bottom-docked sheet (`.overlay.sheet` + `.panel.sheet`) that keeps the
  room visible above it. Cards are large selectable tiles (`ui/cards.js` `cardTile`, now with an
  `.art` panel); selecting one fills a detail pane with the description, a plain-language note on how
  the card is actually used (`USAGE`), and any valid action. Only Bandage has a Use button; Lantern
  shows the Exit-Key track. `main.js` closes the hand on every turn change.
- **Buttons**: two-line action buttons (label + cost/reason). Search's sub-line shows its cost or a
  plain reason from `SEARCH_REASON` when `canSearch` fails; End turn names the next guest. Camera
  controls (rotate + Map) are a separate `.ctl` cluster.
- **Map** (`map.js`): a brass-framed floor plan — ivory-washed room cards, serif labels, a
  current-position arrow, a green tick on searched rooms, dashed brass "?" marks toward unexplored
  doors, and a legend. Only discovered rooms are drawn (discovery unchanged).
- **Artwork drop-in**: `PORTRAIT_ART` (by outfit) in `ui/portrait.js` and `CARD_ART` (by card type)
  in `ui/cards.js` are empty manifests; registering an image path there swaps the placeholder for a
  real illustration with no other code change (and no missing-file requests until one is registered).
  Placeholders are refined flat-vector busts and tinted glyph cards. See `docs/PROGRESS.md` →
  "Artwork still needed".

## First real 3D character — Victor (glTF, tuxedo outfit)
- **What changed**: only the `tuxedo` outfit now carries `model: 'assets/characters/victor.glb'`
  (+ `modelHeight`). Every other guest still uses the placeholder box figure. Nothing in the game
  rules, movement, collision, camera, selection ring/marker, colours, or death behaviour changed —
  `characterView.js` simply loads the model when an outfit has one and builds the box figure
  otherwise. This is deliberately one guest for review before extending the style to the other four.
- **No non-lobby room may control the exit** (Phase 0 correction). The first 18-room layout had
  the Service Corridor and then the Service Stairs on every route to the exit, and the Ballroom
  behind the Dining Room. Harmless in single-player practice, fatal in Phase 1: one possessed
  guest standing in a service room would have controlled the whole endgame. The Storage Room now
  runs the width of the service wing and opens onto the exit, and Suite 412 reaches the Ballroom,
  giving two doorway-disjoint routes to the exit and an alternative into every objective room.
  `tests/logic-check.mjs` fails if either named room ever becomes a single point of failure again.
- **Two dead ends are kept deliberately, and chosen so nothing depends on them.** Guest Suite 414
  (an item room) and the Housekeeping Store (the utility cupboard). Backtracking is a design goal
  in GAME_CONCEPT.md; the rule is that a dead end may never sit on the only route to an objective
  or the exit.
- **Objectives are recorded against the room, not the player.** They are not cards, so "cannot be
  offered / stolen / forced out of you" is true by construction rather than by a rule someone has
  to remember. Two predicates (`objectivesAreCarried`, `canOfferObjective`) state it explicitly so
  the tests can assert the rule rather than the accident.
- **The exit is resolved before anything else in the room**, and is guaranteed twice over: the
  arrival branch in `onArrive` returns before any meeting can be generated, AND the exit room is
  flagged `safe` so `pendingEncounters` yields nothing there. This is the one ordering the rules
  must not get wrong, so it does not depend on a single line staying in the right order.
- **Offers are pre-committed on your own turn.** A meeting resolves from two stored choices with
  no callback and no prompt, which is what makes it playable on one shared iPad and, later,
  online: nobody is interrupted, and nobody can burn another player's clock by deliberating.
- **Dark rooms are atmosphere, gated by a flag.** With no Flashlight card in v0.1, a darkness gate
  would simply make four rooms unsearchable. `darkRoomsRequireLight` keeps the Phase 1 rule alive
  and tested without imposing it now.

- **Phase 0 is a mode, not a fork** (practice mode). The multiplayer rules engine — possession,
  forced encounters, trade, attack, health — is complete and still covered by its tests. Rather
  than deleting or branching it, Phase 0 runs the same engine with a one-guest roster and a set
  of flags in `src/data/rules.js` (`practiceMode`, `healthEnabled`, `lockedDoorsEnabled`,
  `roundLimitEnforced`, `onlineMode`). Turning practice off restores the full game with no code
  changes, so the two phases can never drift apart.
- **One rules file.** `src/data/rules.js` holds every tunable number and the card catalogue; the
  nested `actionCost` shape the engine reads is derived from the flat values at the bottom of the
  file, so a cost can only be changed in one place.
- **Rooms carry a `role`** (`lobby` / `item` / `objective` / `utility` / `exit`) rather than a
  pile of booleans. Searching reads the role: an item room gives a card, an objective room gives
  an objective, a utility room gives nothing but says so. Adding a room type is a data change.
- **The exit is sealed, not absent.** The Fire Exit exists in the map from the start but
  `isRoomOpen()` hides it from the usable doorways, the frontier markers, the 3D doorway view and
  the 2D map until every objective is found. This is the Panic Station "Hive at the bottom of the
  deck" idea: it guarantees a real exploration phase before the endgame instead of hoping the
  exit is found late.
- **A found card is never discarded silently.** Searching on a full hand opens a choice (take it
  and drop one / use it now / leave it). The room is marked searched either way, so a full hand
  cannot be used to farm the same room twice.
- **Health is hidden, not faked.** With no damage, no combat and no action-point penalty, health
  cannot change, so showing three bars would imply a rule that does not exist. `healthEnabled`
  hides the row; the value and the Bandage logic stay for Phase 1.
- **`[hidden]` is forced globally in CSS.** Several panels set `display: flex`, which silently
  beats the browser's default `[hidden]` rule — that is how a Health row and a Trade button
  stayed on screen while `el.hidden` was `true`. The browser tests now assert what is painted
  (`offsetParent` / computed display), not just the attribute.

- **Pipeline** (`tools/char-pipeline/`, not part of the running game): `make_victor.py` builds Victor
  headless with **Blender 4.2 as a pip module** (`bpy`) from primitives (boxes/spheres/cylinders with
  bevel + subsurf for rounded, cartoon shapes), assigns a material and a single-bone vertex group per
  part, joins everything into one mesh, adds an armature and rigid-skins it, authors two Actions —
  **Idle** (subtle breathing + sway) and **Walk** (in-place stride: legs swing, knees bend, arms
  counter-swing, slight hip bob) — and exports `assets/characters/victor.glb` (glTF binary,
  `export_animations`, ACTIONS mode so each Action is its own clip, Y-up). Re-run to rebuild:
  `python tools/char-pipeline/make_victor.py`.
- **Garments are single surfaces, not overlapping parts** (Victor pass 7): a pelvis block plus two leg
  tubes always shows a curved boundary where the parts intersect, whatever the material. The trousers
  are therefore generated as one mesh, ring by ring: above the crotch each ring is the smooth union of
  the two thigh cross-sections, the ring at the crotch touches at one shared vertex, and below it the
  legs continue as two rings — so the surface, its normals and its skin weights run through the join.
  The jacket's front opening is likewise cut into each ring (open strips whose ends lie exactly on the
  opening curve, rings resampled evenly by arc length) instead of deleting quads, which had produced a
  flat-topped notch because a superellipse's parameter leaves almost no vertices on a flat front.
- **Facing**: Blender front = −Y; `export_yup` maps it to glTF +Z, which matches the game's heading-0
  forward (+Z), so the model faces its travel direction with no per-model rotation.
- **Readability from the steep elevated camera** (this took two real fixes, caught by in-game shots,
  not the isolated preview):
  1. *Head*: the head is **upright** (no tilt) like the other guests, and the hair is a full cap that
     OWNS the whole crown. The game camera looks down, so a tilted-up face only exposes the bald crown;
     a first attempt that tilted the face up read as a shiny bald egg from above. Hair on top is what
     makes a head read as a head from this angle.
  2. *Shading + colour*: the model's PBR (`MeshStandard`) materials are converted on load to the same
     matte `MeshLambertMaterial` the whole greybox uses (KEEPING each part's colour — no recolour),
     exactly like the furniture loader (`models.js`). Under the warm overhead light `MeshStandard`'s
     specular blew a bright hotspot on the round head (another "bald" read); matte Lambert removes it.
     Model colours are authored as **sRGB hex converted to linear** for Blender's Principled base
     colour — authoring raw linear numbers made a near-black tuxedo render mid-grey and dark hair
     render dirty-blonde.
- **Integration** (`characterView.js`): `GLTFLoader` loads the model; an `AnimationMixer` cross-fades
  Idle↔Walk by measured ground speed, and Walk's `timeScale` scales with speed so the stride matches
  movement (existing movement code still controls travel — the model walks in place). Skinned meshes
  use `frustumCulled = false` (posed bounds differ from bind-pose bounds). Death collapses the whole
  model flat; the box-figure death pose is unchanged for other guests. The loader/mixer path is fully
  isolated in `if (useModel)` branches so the placeholder code is byte-for-byte the old behaviour.
- **Cost (v1)**: 4,420 triangles, 6 materials, ~217 KB. Superseded by v2 below (14,420 tris, 8
  materials, 480 KB; still uncompressed — Draco isn't available in this headless Blender).
- **Portrait (v1)**: kept the painted portrait. Superseded: since v2 the portraits are rendered from
  the model (owner-authorised), see below.

## Victor v2, grounded movement and the interface pass (pass 12b)
Brief: bring Victor, his movement and the player interface up to the owner's cartoon target
(`docs/CHARACTER_GUI_CHECKPOINT.md` has the measured target, the gap analysis, every increment and
the lessons). Key decisions:
- **Build from measured proportions, not guesses**: ~2.9 heads tall, shoulders 1.25× head width,
  torso 29 % / legs 32 % / head 36 % of height. Everything is parametric in
  `tools/char-pipeline/make_victor.py` on top of `victor_lib.py` (superellipse lofts, capsules,
  smooth-falloff vertex shapers, tapered tubes, sRGB→linear colours). Rebuild = one command.
- **Designed head, not a scaled sphere**: a UV-sphere skull with jaw taper, chin, cheeks and a fuller
  back; features (eyes, brows, nose, ears, moustache, mouth) are placed with the skull's analytic
  surface function so they sit ON the face. Hair is a closed cap that owns the crown, with vertices
  in the first row below the hairline snapped onto the hairline curve (clean edge, no stair-step),
  a side part on his left and a swept quiff on his right (built at the origin, rotated about its own
  centre, then placed).
- **Tailoring that conforms**: the jacket is a loft with rounded shoulders, waist and hem; the shirt
  V and peaked lapels are triangulated + subdivided panels projected onto the chest surface (a
  corner-only polygon is a flat chord that sags behind the bulging chest and vanishes).
- **Rig for clean bends**: shoulder/upper-arm/forearm/hand and thigh/shin/foot per side, spine,
  neck, head; limb segments are capsules with joint spheres, so rigid weights bend cleanly. Elbows
  and knees are real joints now.
- **Walk with phases, stride measured**: contact / mid-stance / toe-off / passing per leg, knee lift
  in swing, hip bob + sway, pelvis/spine counter-rotation, opposing arm swing with elbow bend. The
  cycle's stride is measured from the posed feet in Blender and written into the GLB extras
  (`strideLength`). In the game (`characterView.js`) the walk **phase advances by distance
  travelled ÷ stride**, so the planted foot moves backward at exactly the ground speed — no sliding
  at any speed, and game movement stays authoritative (the clip is in place).
- **Shading**: matte Lambert conversion on load (unchanged), colours authored as sRGB hex. No scene
  lighting was changed to flatter the character.
- **Portraits from the model**: `portrait.mjs` renders a bust with the game's look; `portrait_post.py`
  crops it and makes the private possessed variant (cold wash, vignette, altered eye drawn at the
  projected eye position). Same filenames as before, so the interface code and the public/private
  rule are unchanged.
- **Interface**: one `.hud-bottom` container (flex; a two-row grid in portrait) so the panel, hand
  opener and buttons can never overlap; guest strip on a charcoal plate; ≥48 px targets; drawn SVG
  card icons (`ui/cardIcons.js`, a painted image in `CARD_ART` still wins); map labels kept clear of
  the position arrow, plus a grid and compass. All DOM ids the tests rely on are unchanged.
- **Evidence tooling** (`tools/char-pipeline/`): `capture.mjs` (real-game screenshots at any viewport,
  N rotations, hand/map, `--still`), `preview_glb.mjs` (front/¾/back/game-angle/turntable/portrait
  renders with the game's lighting), `walk_check.mjs` (movement verification from the real game),
  `record_smooth.mjs` (deterministic 30 fps recording by stepping the page clock), `scene_stats.mjs`
  (live draw calls / triangles). Headless SwiftShader renders at ~3 fps, so only game-time-stepped
  recordings represent animation timing; none of it is iPad performance evidence.
- **Measured**: victor.glb 14,420 tris / 8 materials / 480,412 bytes; whole hall scene with Victor
  340 draw calls, 41,426 triangles, 13 programs (headless count, same code path as the iPad).

## Victor v5 — rebuilt to the owner's character sheet (Victor-only pass)
- **Measure, then model.** The character sheet's front panel is the proportion authority: every
  vertical landmark is stored as a percentage of standing height in `CFG` (`make_victor.py`), and
  the skull and hair are superellipse shells driven by height tables read off the sheet
  (half-width, front depth, back depth, squareness). Features are placed on the analytic face
  surface, so they cannot float or sink when the tables change.
- **Hair as its own cap**, not a thickened skull: its rows follow the measured hairline, it has a
  rounded lip, a hidden inner skin and a minimum 14 mm thickness over the skull. The sweep to his
  right, the part on his left and the lock grooves are small modulations on top of the measured
  silhouette.
- **Like-for-like comparison tooling** (`compare.py`, `compare_head.py`, `make_panels.py`): sheet
  panel vs render at equal displayed height, IoU plus per-band widths; head close-ups compared by
  head height with feature blobs. The previewer's `body@yaw` / `face@yaw` views use a long lens so a
  level render matches the sheet; the neutral light is albedo-faithful (Lambert ÷ π compensated) so
  material colours are judged before the hall's warm lighting is applied. The hall lighting itself is
  unchanged.
- **Reference assets in the repo**: `tools/char-pipeline/ref/victor-sheet.png` (measurement source)
  and `hotel-reference.jpg` (identity) are committed; cropped panels and renders stay gitignored and
  are regenerated by the tools.
- **Measured**: victor.glb 21,020 tris / 7 materials / 684,296 bytes; hall scene with Victor 339
  draw calls, 48,026 triangles, 13 programs (headless count). Silhouette IoU vs the sheet: front
  0.855, back 0.880, three-quarter 0.799.


## Phase 1 — the hot-seat rules sandbox (local only)
- **One rulebook, three modes.** `src/data/rules.js` holds the practice defaults and an
  `applyMode(mode, playerCount)` that overwrites what a mode changes: `'practice'` (Phase 0),
  `'hotseat'` (the approved v1 rules) and `'legacy'` (the older engine, kept working and tested).
  It mutates the one shared `rules` object on purpose — every module reads values off it at call
  time, so there is still exactly one place a number lives and no module has to know which mode is
  running. `main.js` calls it once, before any state is built.
- **The mode lives in the address, not in a file.** `?mode=hotseat&players=6` (plus `?seed=` and
  `?timer=off` for testing). The start screen writes it, so the owner never edits code to change
  game; the page reloads because the table size has to be known before the world is built, which
  keeps the practice path byte-for-byte what it was.
- **Possession is an intent, not a card.** There is no Possession card in hot-seat and therefore no
  charge pool. The simulations behind the rules audit showed the pool was constant (every
  conversion granted exactly as many charges as it spent), so it capped nothing; removing it gave
  the best measured balance. A possessed player commits Trade or Possess alongside their Offer.
- **Private information has exactly one home: the hand-over screens.** `src/ui/handoff.js` is the
  only module that ever shows a role, a hand or an Offer. Everything else — the HUD, the meeting
  panel, the public log, the map — is written so it *cannot* print a role. In hot-seat the
  possessed screen tint and the possessed portrait are switched off, because the device is sitting
  between six people.
- **Private consequences are queued, not announced.** A meeting can produce something only one
  player may know (who attacked them, that they have been converted). Those lines go into that
  player's `notes` queue and are shown on their own screen — at the start of their next turn for
  the off-turn player, immediately on a private card for the player holding the device.
- **The turn timer counts the action phase only.** It is paused by every hand-over screen, role
  reveal, meeting result and blocking prompt, so passing the iPad round can never cost a turn.
  `rules.turnTimerEnabled` (or `?timer=off`) switches it off for play-testing.
- **Two meeting engines, not one rewritten one.** `resolveMeeting` branches on `state.hotseat` for
  the approved card semantics (Distraction cancels, Lantern blocks, Possess converts) and leaves
  the Phase 0 / legacy path exactly as it was, so the tests written for that path keep proving what
  they proved. Neither takes a callback: arity 4, so an off-turn prompt is structurally impossible.
- **The voluntary lobby trade is off in hot-seat.** The Phase 0 panel shows both players' hands,
  which would hand the whole table another player's cards, and it can move a Possession card. The
  brief allowed keeping it only if it already worked correctly; it does not, for hidden roles. It
  still works in practice and legacy modes. A future Offer-based lobby trade could bring it back
  safely — it would exchange the two standing Offers with possession disallowed.
- **A sixth guest and a sixth start spot.** The roster had five; a six-player table needs six, so
  Clara was added with an existing outfit and `floor1.start.positions` gained a sixth (verified
  walkable). Nothing else about the map changed.
- **A searched room now shows a small brass tick in 3D** (`src/render/searchMarks.js`): one sprite
  per searched room, built lazily, at most 16 in a match. Cheaper than re-dressing the room and it
  reads at a glance from the table.
- **The map is fixed; the deal is not.** The 18-room hotel is static data, so it is the same every
  match. The hot-seat seed is random per match (otherwise the same guest would always be the
  Possessor); `?seed=` forces it for testing. Practice keeps its fixed `practiceSeed`.


## Rules reset — the owner's restored ruleset (supersedes the two sections above on rules)
- **`docs/GAME_RULES.md` is the product design, and `CLAUDE.md` now guards it.** No rule or number
  changes without the owner's explicit approval of a plain-language before/after list. The Offers
  ruleset lives on in `docs/archive/GAME_RULES_offers_version.md` and in git history only.
- **One engine, two ways to play.** The three-engine arrangement (practice / offers / legacy) is
  gone. `src/data/rules.js` holds one ruleset; `applyMode('practice' | 'hotseat')` only changes the
  table size, whether there is a hidden role, and whether the clock runs. Far less code, and every
  test now tests the rules that ship.
- **Placeholders where the rules were silent** — since approved by the owner and written into
  `docs/GAME_RULES.md`: one card draw per room, dropped items always pickable; locked rooms random
  each match (never the lobby, its neighbours or the exit); keys and picks used from the next room;
  a Barricade lasts until its placer's next turn starts; a dead guest's Possession cards leave the
  game; the possessed tell shows only on private screens in hot-seat.
- **The possessed tell stays off the shared screen in hot-seat.** The rule says the tell is private;
  on one iPad between six people, a purple wash during someone's turn is the opposite of private.
  So the possessed portrait and tint appear on the private screens and in the hand sheet, and the
  public HUD stays neutral. Online, with one device each, the tell can be on the main screen.
- **Trades pass the device.** The entering guest picks a card in private, the device goes to the
  other guest who picks in private, the cards swap, and the device comes back with a private
  "you received…" card. The other guest reads theirs on their own next private screen. The public
  panel says only that a trade was made.
- **Superseded by the approved Lantern rules** (next section): key pieces are gone.
- **Locked and barricaded doorways are enforced in pathfinding**, not just in the door blink: the
  landing cells on both sides of such a doorway are removed from the walkable set, so no route can
  thread through the opening. The map draws a padlock or a bar on them.
- **Dead guests drop everything** into `state.roomDrops` and the next search there takes it all.
- **The discard pile reshuffles into the deck** when it runs out; the state carries its seeded RNG
  so reshuffles and Lock Pick rolls stay reproducible under `?seed=`.


## Approved rule changes — Lanterns are the way out
- **Lanterns do double duty.** Three in a clean guest's hand open the exit (`rules.lanternsToEscape`);
  given in a trade they block possession. The key pieces, their hiding and the `pieceRooms` state
  are gone.
- **Lanterns are never dealt.** `deal()` takes the Lanterns out, deals the four-card hands from the
  rest, then shuffles the Lanterns back into what is left using the match's seeded RNG — so they are
  spread through the pile, not stacked at the bottom.
- **A blocking Lantern is used up.** Both it and the Possession card are discarded (the Possession
  card leaves the game; the Lantern goes to the discard pile). In an ordinary trade a Lantern moves
  like any card.
- **Comparison variants live in the rules file but only the simulator touches them.**
  `rules.lanternBlock` ('discard' approved / 'attacker') and `rules.lanternsDealtEach` (0 approved /
  1) let `tools/balance/hotseat-sim.mjs` compare the alternatives through the real engine rather
  than a copy of it; the game and every test run the approved values, and a rules test asserts it.
- **Search results are private.** `search()` writes only "X searched the Kitchen." to the public log;
  in hot-seat the result goes on the searcher's private card and the shared toast just says someone
  searched. The full-hand take/leave toasts are suppressed in hot-seat for the same reason. The exit's
  refusal message is the same words for everyone, so it gives away neither possession nor Lanterns.
- **Barricade expiry is tied to the placer, not a turn count.** It comes down when the guest who
  placed it starts their next turn; the earlier "turn + living guests" count ran one turn long if
  someone died in between. A dead placer's barricade comes down at the next turn start.
- **The full-hand and discard prompts wrap.** Six cards in one row overflowed the box and clipped the
  outer cards out of reach on an iPad; with Lanterns counting toward the hand limit, full hands are
  common, so the rows now wrap with compact tiles and the browser test checks every card is on
  screen and tappable.


## Approved rule change — the dawn deadline
- **`rules.roundLimit` (8) is checked in `checkWin`, hot-seat only.** `state.round` advances as the
  last living guest of a round ends their turn, so `round > roundLimit` is true exactly when round 8
  has ended. The dawn check comes after the escape check and after the "no clean guest left" check,
  so an escape on the last turn of round 8 still wins, and a wipe-out is reported as a wipe-out.
  `state.dawn` records why the hotel won, for the end screen. Practice never checks it.
- **One place writes the round** (`src/ui/roundLabel.js`): "Round 3 of 8" in hot-seat, "Round 3" in
  practice. The final round is marked in the header (in words and a warning colour), on the
  pass-the-device screen and on the private turn screen, since those are where people look.


## Starting room — baked art pass (supersedes the hallDeco sections above for the lobby)
Target: `docs/art-reference.jpg` (style, palette and finish; not its layout or its old interface).
- **One baked model instead of hand-placed pieces.** The lobby is built headless in Blender
  (`tools/lobby-pipeline/make_lobby.py`) from the game's own room data (`dump_lobby.mjs` →
  `lobby.json`), so walls, doorways and every furniture footprint line up with collision and
  pathfinding by construction; `tests/browser-lobby.mjs` fails if they drift. `hallDeco.js` is gone.
  Room size, doorways, footprints, the walkable grid and the rules are unchanged.
- **Baked, not live, lighting.** Soft sky light from the open top, a soft key light, every lamp and
  sconce, and an ambient-occlusion pass are baked with Cycles into two light maps (an atlas for walls
  and furniture; a straight-down one for the floor and rugs, since that is most of the view),
  denoised with Open Image Denoise, stored as sRGB JPEG at `light / 4`. In the game every lobby
  material is an unlit `MeshBasicMaterial` = albedo × light map (`src/render/bakedRoom.js`): the
  cheapest shader Three.js has, with no per-pixel light cost. The room's point lights still exist
  (moved to the new lamps) because they light the characters, who are not baked.
- **Albedo from vertex colours** for all the solid pieces (walnut, brass, velvet, leaves), textures
  only where a pattern is needed (floor tiles, rugs, paintings). Five materials in total.
- **Walls cut like an architectural model.** All lobby walls stand at one height (2.4 m) under a
  dark wood cap. Each game wall segment is two nodes: `_lo` (to 0.64 m, topped by a dark cut cap)
  and `_up` (origin on the cut). The cutaway still decides *when* a wall lowers; `bakedRoom.js`
  maps that to folding the upper part down onto the cut and hiding it, so a lowered wall reads as a
  cut model instead of a squashed one, and wall-hung pieces (paintings, sconces) go with it. The cut
  caps are baked separately with the upper walls hidden, the only state they are seen in.
- **Doorway cue (every doorway, not only the lobby's).** The glowing yellow posts are replaced by a
  soft warm pool across the threshold, a faint light spill standing in the opening while the room
  behind is undiscovered, and a gold ring (slow pulse) on the active guest's side of each door they
  can use. One cue style for the whole hotel, so it means the same thing everywhere; the tests still
  address the ring as `blink`.
- **Chosen-door preview.** While a door move waits for confirmation, `pathPreview.js` draws the
  planned walk as gold dots (one `InstancedMesh`, one draw call) and an HTML tag over the door with
  the cost ("Explore · 1 AP" / "Move · 1 AP"). It reads the same plan the confirm bar uses; the
  interface panels themselves are unchanged.
- **Lower camera.** Default pitch 42° at distance 11.5 (was 56° at 13) to show the fronts of
  furniture and faces, as in the reference. `?camera=classic` restores the old values
  (`config.cameraClassic`).
- **Measuring on the device.** `?stats=1` shows fps, the slowest frame of each second, draw calls and
  triangles (`src/ui/perfStats.js`), since headless software rendering says nothing about iPad speed.
- **A light spill never stands in a cut wall.** Spills are hidden on doorways the camera is looking
  over (on the camera's side of the view, in a wall facing the camera), since the cutaway has
  lowered that wall and a standing glow would stick up out of it.
- **Measured (headless, same code path as the iPad, start view):** lobby 271 → 89 draw calls, 29 → 9
  textures, 56k → 87k triangles (the bevels; trivial for an iPad GPU), CPU time to submit a frame
  2.6 → 2.3 ms. Download: `lobby.glb` ~2.5 MB (uncompressed geometry; Draco is not available
  in this Blender) + light maps ~1 MB.


## Path to mobile apps
- **The plan:** later, package this web game as iOS and Android apps with a wrapper such as
  Capacitor, with the game files bundled inside the app (not loaded from the website). The browser
  version on GitHub Pages stays the development and preview build.
- **Until then, keep the game self-contained.** Everything it needs should be files in this repo,
  loaded by relative paths (already the rule for the sub-path). The one exception today is Three.js,
  loaded from the jsDelivr CDN by the import map in `index.html`; when packaging, that pinned version
  gets copied into the repo and the import map points at the local copy. Don't add other CDNs,
  web fonts or remote services the game needs in order to run.
- **Compress assets and load rooms on demand.** Every megabyte is paid for in the app download.
  Keep textures small and compressed (JPEG/KTX2), and compress geometry when the tooling allows
  (the lobby `.glb` is uncompressed today: ~2.5 MB). Load a room's art when it is about to be seen,
  not everything at start-up: the lobby's model already loads asynchronously, with the greybox
  showing until it arrives, and other rooms should follow that pattern.
- **Avoid browser-only features that wouldn't work inside an app:** new tabs/windows or links out to
  other sites, the browser's back button or address bar as part of the game, fullscreen and
  "add to home screen" prompts, hover-only interactions, service-worker tricks, and anything that
  assumes a `https://…github.io` origin. The address parameters (`?mode=`, `?seed=`, `?stats=1`…)
  and the start screen's reload into a mode work inside a wrapper, since it serves the files locally;
  they should stay developer tools, not something a player must type. Anything that must survive
  (saves, settings, accounts later) goes through one small storage module that can switch to the
  wrapper's native storage, never scattered `localStorage` calls. Sound must start from a tap (iOS
  rule, already noted under Input).


## Approved rule change — the random hotel (supersedes the fixed 18-room floor above)
- **One pure module grows the map** (`src/game/hotel.js`), fed by a data file of tiles
  (`src/data/hotel.js`). The floor object it builds keeps the shape the rest of the game already
  read (rooms, roomList, doorways, walls, bounds, start, exitRoom), plus `frontier` (closed doors),
  `cells` and `deck`, and it grows in place. `resetState` rebuilds it for every match, seeded, so
  `?seed=` reproduces a whole hotel. The fixed map (`floor1.js`, `floor.js`) is retired.
- **Tiles are 8 m squares, the lobby's size.** With one tile size every tile sits on one grid, so a
  room reached by two different routes always lines up. A smaller standard tile beside the 8 m lobby
  would put rooms reached along different paths half a tile out of line with each other.
- **"Fits" means matching every neighbour.** Doorway meets doorway, wall meets wall, the tile keeps a
  doorway toward the door that was opened, and a random orientation is picked among those that fit.
  A locked tile never joins the lobby (the old "never next to the lobby" rule, carried over).
- **Never closing off, made checkable.** Until the Fire Exit is placed, a placement is only allowed if
  a closed door reachable from the lobby (not through a locked room) still leads to a cell with no
  other room around it. Any tile, the Fire Exit included, always fits there, so exploring can always
  continue to the exit. Tested over 400 hotels (logic-check), 400 rules-engine hotels (rules-check)
  and every simulated match.
- **Jammed doors (placeholder, awaiting approval):** a door no remaining tile can fit behind stays
  shut for the match and costs nothing to try. It is rare before the exit is placed (about 1 match
  in 12 in the generator test), and the rule above guarantees another way on.
- **Doors cost 1 AP to open, you stay put; entering is a normal move.** Every revealed room is
  "discovered", so the old doorway-landing logic has nothing to do.
- **The walkable grid is rebuilt in place after each door** (`Object.assign(grid, buildGrid(...))`),
  looking rooms up through the tile grid: at most about 30 ms (headless) for a full 24-tile hotel.
- **Views are made as rooms appear.** `addRoomView` per revealed room, all dropped and rebuilt for a new
  match. Door leaves (greybox walnut) stand in closed doors and swing open when opened; the ring cue
  marks doors you can open or walk through. The 2D map draws closed doors with a "?".
- **A fixed pool of lights.** Rooms no longer own point lights; each lists where its lights are and a
  pool of 8 (`config.render.lightPool`) is given to those nearest the camera every frame. The light
  count never changes, so no shader rebuild ever stalls the iPad as the hotel grows.
- **The lobby keeps its baked art on any layout.** The model now has every side in parts
  (A | B · door · C | D) plus a plain-wall part F; an open side shows A B C D, a closed-off side A F D.
  The four bake passes each light only what is actually seen together.
- **Other rooms are greybox for now.** The earlier Kenney-kit dressing cost 100+ draw calls per room,
  which does not scale to 24 tiles; room art comes after this system is approved.
