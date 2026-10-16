# Technical decisions

Short record of the choices that shape the code and why, so another coding agent can continue the work. Product decisions are the owner's and live in `GAME_CONCEPT.md`.

## Read this first: what is current (written 14 Oct 2026, v0.6)

This file is a diary, oldest section first. Everything down to the section "Main menu, play with bots, hot-seat removed" describes the game as it was in September and early October, and some of those sections are wrong today: each now starts with a **SUPERSEDED** line saying where the current facts are. Where this block and an old section disagree, this block wins; where this block and `src/data/rules.js` disagree about a number, `rules.js` wins (and this block should be corrected). From "Computer guests (bots)" on, sections are current unless they say otherwise; the "Round 2" and "Round 4" sections at the end are the latest.

- **Rules and where the numbers live.** The owner's rules are `docs/GAME_RULES.md` (changed only after the owner approves a before/after list: CLAUDE.md). Every rule number is in `src/data/rules.js`; the hotel (the lobby and a deck of 24 room tiles, shuffled every match) is `src/data/hotel.js`. At v0.6: 4 actions a turn, and opening a door, moving into a room, searching, playing a card and attacking cost 1 action each (Espresso is free; escaping costs 1); a 45-second clock in matches; 4 health; hand limit 6, settled at the end of your own turn; 3 Possession cards, each a guest's own "soul", and 2 new souls for each guest possessed; 3 Lanterns to escape (everyone starts with 1); dawn after round 8; 4 to 6 guests in a match, 1 in practice. `tests/docs-check.mjs` fails if this list drifts from `rules.js`.
- **Since v0.6 (Round 4, 15 Oct 2026, owner-approved): five rule changes that are in the code but not yet in `docs/GAME_RULES.md`** (a proposal with the exact old and new lines is with the owner; until it is approved, `src/data/rules.js` and `src/data/hotel.js` are the truth). The Infirmaries and the Switchboard cannot be searched (their own action takes the search's place); each Infirmary works once per match, for whoever uses it first, in public; the Switchboard costs 2 actions and may be rung as often as the guest can pay; the end-of-turn discard keeps the turn clock running but always gets at least `rules.discardMinSeconds` (10) seconds, and when time runs out the game discards random ordinary cards for the guest and the turn ends; the draw deck is 50 cards with 16 Lanterns. Details and numbers: "Round 4, rooms, the discard clock and the lobby".
- **Architecture, in one paragraph.** A static browser game: Three.js r186 as ES modules through an import map (plus a few `three/addons`: glTF loading, skeleton cloning, geometry merging), plain JavaScript in `src/`, no build step, relative paths only (GitHub Pages serves it from a sub-path). The rules are pure JavaScript in `src/game/` (`state`, `actions`, `cards`, `hotel`, `grid`, `moves`, `knowledge`: no DOM, no Three.js, so a server can reuse them) and the computer guests in `src/bots/` are pure too and see the game only through `botView`. `src/main.js` owns the turn flow (the player's turns, the bots' turns, meetings, the clock) and wires the screens: `src/ui/`, `src/hud.js`, `src/overlays.js`, the main menu (`src/ui/menu.js`) and the lobby scene behind it (`src/menu/`), drawing (`src/render/`), sound (`src/audio/`). Words and numbers that are not rules are data in `src/data/`. It is one device, you and 3 to 5 computer guests (or practice alone); nothing is online yet (`docs/ONLINE_PLAN.md`); your profile, settings and record sit in the device's localStorage behind small interfaces (`src/account/`, `src/settings.js`, `src/record.js`).
- **Tests.** `window.__game` (end of `src/main.js`) is how the browser tests look inside the game; direct links (`?mode=bots&...`, `?mode=practice`) skip the menu. The pure suites run in Node; the browser suites run in headless Chromium (README, "Running the tests").
- **Superseded early sections, and what replaced them.** Players and turns (hot-seat), Phase 1 (the hot-seat sandbox) and Rules reset's pass-the-device parts: hot-seat is gone, see "Main menu, play with bots, hot-seat removed". Data-driven floor, and the fixed 14- and 18-room floors: "Approved rule change — the random hotel". Rules engine (health 3, "2 AP for a new room", "Master Key, Lock Pick and Barricade have no effect"): "Rules reset", "Owner-approved (7 Oct 2026): 4 health", `rules.js`. Turn-based interaction, Pathfinding and discovery, Reliable door taps: "Tap a room, not a door". Real art, room dressing: "Starting room — baked art pass" and "Every room baked like the lobby". Characters and the Victor sections: "All six guests modelled" and "Avatars: the wardrobe". "2 Possession cards": "Owner-approved (10 Oct 2026): 3 Possession cards" and "soul cards". "Choose your guest": "Profiles: a username first".
- **Files the old sections name that no longer exist:** `src/data/floor1.js` and `src/game/floor.js` (now `src/data/hotel.js` and `src/game/hotel.js`); `src/render/hallDeco.js` (the baked lobby, `tools/lobby-pipeline/`); `src/render/models.js` and the Kenney furniture and building pieces under `assets/models/` (removed 14 Oct 2026: no room used them); `src/ui/fullHand.js` (now `src/ui/discard.js` and `doEndTurn` in `main.js`); `src/ui/guestPicker.js` (replaced by the profile and avatar); `tests/autoplay.mjs`, `tests/browser-hotseat.mjs` and `tests/browser-test.mjs` (replaced by the suites in the README; the old QA scripts are in `tests/old/`).

## Engine and loading
- **Three.js r186, loaded as ES modules through an import map from jsDelivr** (`index.html`). Pinned to an exact version so the game cannot break when a new release changes behaviour. A few `three/addons` are used (`GLTFLoader` for the baked rooms and the guests, `SkeletonUtils`, `BufferGeometryUtils`, `RoundedBoxGeometry`; the import map maps `three/addons/` to the same pinned release; this line once said "no addons are used"); camera controls are custom because the game needs snap rotation, not orbiting.
- **No build step, no bundler, no framework.** GitHub Pages serves the files from `main` as they are, which keeps the iPad-only workflow possible (edit → push → reload). All paths are relative so the site works at the `/Gaming-App/` sub-path; `.nojekyll` stops Pages from ignoring files.
- `index.html` imports `src/main.js` dynamically and shows an error overlay if the engine cannot be loaded or the floor data is invalid, instead of a blank page. The "Tap to begin" button stays disabled ("Loading…") until the first frame has rendered.

## Rules separate from rendering
- `src/game/` contains only plain JavaScript: no Three.js, no DOM. `hotel.js` (the random hotel, grown from tiles; this line once named `floor.js`, which no longer exists), `grid.js` (walkable grid + A*), `state.js` (turns, actions, meetings, win checks), `actions.js`, `cards.js`, `knowledge.js` and `moves.js` (plan a walk to a tapped room) can be run in Node and later on a server for multiplayer. `src/render/` only draws what the game state says.
- Room transitions are detected from the player's position crossing a room boundary (`discovery.update`). Rooms are axis-aligned rectangles that touch but never overlap, so each doorway is exactly one boundary crossing, and the pre-check in `moves.planMove` counts the same crossings (prefixed with the room the player actually stands in) before allowing a walk.

## Players and turns (hot-seat)
> **SUPERSEDED in part, see "Main menu, play with bots, hot-seat removed" and "Computer guests (bots)".** Hot-seat (people passing one iPad) was removed on 9 Oct 2026: it is now you and 3 to 5 computer guests on one device. Still true: `endTurn` hands control to the next living guest and refills their actions.
- `state.players` holds per-player rules state (current room, action points, health, alive, possessed, hand, unmasked-knowledge); discovered rooms and encounter locks are shared. Only `state.activeIndex` acts; `endTurn` passes control to the next **living** player and refills their points from `rules.actionPointsPerTurn`. A round is one pass round the table; a new lap clears the per-room encounter locks. (The `escaped`/continue model of pass 2 is gone — reaching the exit is now a win check, not a per-player exit.)
- Movement objects (`src/player.js`) are one per player; only the active one is updated each frame. Handing over the turn `halt`s the outgoing player (clears any queued path and the walking flag) so a half-finished walk can't resume — and spend a fresh point — when their turn comes round again, and so their figure doesn't keep animating a walk in place.
- Encounters resolve after the walk finishes (the arrival is detected when the active mover's path empties), so a move-and-meet is one confirm then one modal.

## Characters (`src/data/characters.js`, `src/render/characterView.js`)
> **SUPERSEDED, see "All six guests modelled to the owner's sheets" and "Avatars: the wardrobe, runtime portraits, bots' looks".** Guests are glTF avatars; the box figure described here is only the stand-in when a model cannot load.
- Body types (male/female proportions) and outfits (colours + silhouette: tie/bow tie/lapels, A-line/column/full skirt) are data. The roster names five players with an outfit and a marker colour each.
- The view builds an articulated figure from boxes with pivots at shoulders and hips and a simple walk cycle; a coloured floor ring identifies each player and a marker floats over the active one. A future glTF character view only needs to offer the same `{ group, update(mover, dt), setActive() }` surface — nothing in the rules knows what a character looks like.
- Draw calls: ~17 meshes per character (≈85 for five) on top of the rooms. Fine for now; if the iPad struggles once all rooms are revealed, merge each room's static boxes into one mesh.

## Data-driven floor (`src/data/floor1.js`)
> **SUPERSEDED, see "Approved rule change — the random hotel (supersedes the fixed 18-room floor above)".** `src/data/floor1.js` no longer exists and there is no fixed floor: the hotel is grown from tiles (`src/data/hotel.js`, `src/game/hotel.js`) and is different every match.
- Rooms are placed by centre and size; furniture by room-relative position and size; each room carries its mood.
- **Doorways are declared once**, on either room, as *which wall*, *offset from that wall's centre*, *width*, *to room*. The loader creates the matching opening on the neighbour and validates that the rooms really share that wall. Overlapping rooms, unreachable rooms, doorways blocked by furniture and a missing exit are reported as fatal problems.
- The floor has **14 rooms** around a central landing with four doorways (west: corridor + guest suite dead end; north: corridor, lounge, library and a back passage looping round to the kitchen; east: corridor, service corridor, stairs and the exit, with a storage dead end; south: dining room dead end). Five start spots are listed in `start.positions`.
- Action-point rules (`rules` block) are data too; the code never hard-codes costs.

## Camera and cutaway
> **PARTLY SUPERSEDED, see "Corner-on camera and see-through" and "Camera: see the whole hotel".** The standard view is corner-on and zooms out to fit every revealed room; the cutaway idea (walls lowered so you can see in) still holds.
- Perspective camera on a rig: fixed pitch (56°), distance = zoom, yaw snaps in 90° steps with a short eased turn. The rig follows the player with a lag; a two-finger drag adds a world-space pan offset that eases back to the player once the fingers lift.
- Pan is computed by projecting the fingers onto the ground plane, so the floor sticks to the fingers at any zoom level.
- **Cutaway rule** (`render/cutaway.js`): based on the camera's yaw only (so walls never flap while walking). A wall shared with another *discovered* room is lowered whenever it is perpendicular to the view, so you can see over it into the next room; exterior walls and walls to undiscovered rooms are lowered only when they face the camera, so the far walls stay as a backdrop. Wall meshes have their origin at the floor so lowering is a `scale.y` change; nothing ever scales to 0.

## Pathfinding and discovery
> **SUPERSEDED, see "Tap a room, not a door; no walking about inside a room".** A tap picks a room, not a spot, and a guest always stands in the middle of their room. `src/game/grid.js` and the A* search still exist.
- 0.25 m grid over the floor. A cell is walkable if it lies inside a room away from the walls (wall thickness + player clearance) or inside a doorway opening, and not inside a furniture box grown by the clearance. A* with 8 directions and no corner cutting; the cell path is then straightened (string pulling with a side margin) so walking looks natural.
- Only cells of discovered rooms are usable, plus a **landing** just inside each undiscovered room behind a glowing doorway. Tapping on or near a glowing doorway targets that landing, so a tap on the frame reliably takes the player through (a tap exactly on the boundary would otherwise stop one cell short).
- Tapping deep inside an undiscovered room does nothing; tapping furniture or a wall snaps to the nearest walkable floor within 1.5 m.

## Lighting and look (greybox)
> **PARTLY SUPERSEDED, see "Starting room — baked art pass" and "Every room baked like the lobby".** Rooms are baked models now, so the light counts and room tints below describe the old greybox. Still true: lights exist from the start at intensity 0 (no shader recompiles), cheap materials, no shadows, no post-processing, pixel ratio capped at 1.5.
- Three.js r186 uses physical light units: point-light intensity is candela with inverse-square falloff. Mood intensities in the data are small numbers multiplied by `config.render.pointLightScale`. Neutral tone mapping keeps warm colours from clipping to white.
- **All point lights exist from the start** (added to the scene, not to the hidden room groups) with intensity 0 until a room is revealed. Three.js recompiles every shader when the number of lights changes, which would stall on the iPad at each reveal; a constant count avoids that. Budget: about 12 point lights per floor. `MeshLambertMaterial` everywhere (cheap), no shadows, no post-processing.
- Each room's floor and wall greys are pulled 20% toward the room's mood colour (`config.render.moodTint`) so the warm→cold shift also shows in the surfaces, not only in the light.
- A light flickers only where the room's `mood.flicker` says so (currently the back passage and the service corridor). Doorway highlights are opaque and steady — an earlier pulsing version read as flicker on the device.
- 16 point lights on this floor (14 rooms, two with a second light).
- Soft **contact shadows** (one shared radial-gradient texture, `materials.makeShadow`) sit under each character and furniture piece to ground them on the floor — cheaper than real shadow maps and enough for the greybox. Furniture is tinted toward each room's mood colour like the walls, so the boxes sit in the room rather than reading as separate cool grey.
- Pixel ratio is capped at 1.5 (iPads report 2). Slightly softer, much cheaper per frame. `window.__game.setPixelRatio(2)` lets the owner compare on the device.

## Real art — room dressing (first pass, starting room only)
> **SUPERSEDED, see "Starting room — baked art pass" and "Every room baked like the lobby".** Every room, the lobby included, is a baked glTF model now. `src/render/hallDeco.js` is gone, and so are the Kenney furniture and building pieces and their loader (`src/render/models.js` and the Kenney path of `src/render/roomDressing.js`): removed on 14 Oct 2026 because no room used them ("Round 2, docs and tests").
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
> **PARTLY SUPERSEDED, see "Tap a room, not a door".** The input handling below still holds; a one-finger tap now means a room (open, go to, search), not "walk to this spot".
- Pointer Events on the canvas handle touch and mouse alike. One finger = tap to walk (only if it stayed single-finger, moved ≤ 10 px and lasted ≤ 450 ms); two fingers = pinch zoom + pan; right/middle mouse drag = pan; wheel = zoom (ctrl+wheel = trackpad pinch); Safari's gesture events are used only when no touch pointers are active (desktop trackpad). `touch-action: none` plus non-passive `touchmove`/`gesture*` listeners stop iPad Safari from zooming or scrolling the page.
- Audio: unlocked by the first tap anywhere (iOS only allows it inside a tap) — see "Music and sound effects" below.

## Testing
> **SUPERSEDED, see README "Running the tests".** The single browser-test script described here became the suites listed there (Node suites for the rules, the bots and the words; browser suites for the screens).
- Headless Chromium (Playwright) loads the real `index.html` from a static server; the CDN requests for Three.js are intercepted and served from a local copy because the sandbox blocks the CDN. The suite drives the game through real taps/clicks and through `window.__game` (the debug hooks in `main.js`), checks for console errors, and verifies discovery, action points, End turn, rotate/cutaway, map, exit, restart, pinch, pan, wheel, draw calls and that the shader program count never grows. Screenshots are used for visual sanity.
- Software rendering there runs ~7 fps and the game clamps frame time at 50 ms, so time-based checks step the simulation manually.

## Rules engine (Hotel Escape)
> **SUPERSEDED, see "Rules reset", "Owner-approved (7 Oct 2026): 4 health", "Approved rule change — the random hotel" and `src/data/rules.js`.** Three facts below were wrong and are corrected in place (14 Oct 2026): health is 4, not 3; a room costs 1 action to open its door and 1 to move in, not "2 AP for a new room"; and Master Key, Lock Pick and Barricade all work.
Implements `docs/GAME_RULES.md`. Kept pure and separate from rendering so a server can reuse it.
- **All rule numbers live in `src/data/rules.js`** — actions per turn (4), action costs (move 1, open a door 1, search 1, use-card 1, attack 1), health (4: it said 3 here until 14 Oct 2026), hand size (4), the searchable deck composition, the possessed supply (3 Possession cards), Lanterns-to-escape (3), and per-card behaviour. Change values there, never in code.
- **Opening a door and moving into the room are two actions of 1 each** (it said "move + discover, 2 AP for a new room" here until 14 Oct 2026; since the random hotel you open a closed door of your own room, staying where you are, and then walk in). The Move bar shows the real cost ("Move · 2 actions").
- **Cards** (`src/game/cards.js`): a seeded PRNG (mulberry32) drives shuffling and dealing so a game is reproducible in tests; `main.js` seeds from `Date.now()` and reseeds on New game. Each card is an instance with a unique id (revolvers carry their own `shots`). The draw pile excludes Possession cards — those are the possessed side's souls, dealt to the possessed player at setup. Each carries its `owner` (soul cards: only the owner holds and gives it); one that has done its work leaves the game, and each conversion makes `rules.soulsOnConvert` (2) new souls for the newly possessed guest, so the number in play can grow past 3 (see 'Owner-approved (10 Oct 2026): soul cards').
- **State** (`src/game/state.js`): per-player `health`, `alive`, `possessed`, `hand`, `knows` (ids unmasked), `currentRoom`, `actionPoints`; shared `discovered` rooms and `encounterLocks`. `enterRoom` charges the move and reveals; `endTurn` skips the dead, refills AP and, on a new lap, bumps the round and clears the encounter locks. `checkWin`: humans win when a clean, living player with 3 Lanterns enters the exit; the possessed side wins when no living clean player remains.
- **Encounters** (`src/game/actions.js`): `resolveTrade` takes both players' chosen cards and applies the spec exactly — a Possession card converts the receiver unless they gave a Lantern, in which case possession fails and the Lantern and the Possession card are both discarded (`rules.lanternBlock` 'discard'), and the defender learns the giver is possessed. `resolveAttack` applies knife/revolver damage, spends and discards an empty revolver, and marks a player dead at 0 HP. A per-room, per-round `encounterLocks` set stops the same pair being forced to meet twice in one room in a round.
- **Master Key, Lock Pick and Barricade work** (this bullet said they had "no effect yet" until 14 Oct 2026): a key or pick opens a locked door from the next room until the end of the opener's turn, and a Barricade seals a doorway of your room for one round. See "Locked doors re-lock at the end of the opener's turn" and `src/game/actions.js` (`useUnlock`, `useBarricade`).

## Turn-based interaction
> **SUPERSEDED, see "Tap a room, not a door; no walking about inside a room" and "Rules reset".** The blinking doors, the confirm bar for a door and the free walk inside a room are gone (you tap rooms; a guest stands in the middle of theirs); the meeting flow now follows "Rules reset" and docs/GAME_RULES.md.
- Movement is no longer free roaming: on a player's turn the doors leading out of their room blink (a bright floor bar, a deliberate action cue kept separate from the mood flicker). Tapping a door raises a confirm bar; confirming spends 1 AP and walks the player to a free standing slot in the room (the centre, or a nearby spot when others are already there — arrivals avoid overlapping). Tapping inside the current room is a free reposition. An undiscovered room can only be entered as far as the doorway landing until it is revealed, after which the player can move freely inside it.
- The encounter modal mirrors the real game's flow even though hot-seat makes everything visible: the entering player picks a card, then the other, then it resolves. The UI is split into `src/ui/` (card tiles, hand panel, encounter modal) so the presentation can change without touching the rules.
- Rooms are searchable only where the data says so (`searchable: true` — the content rooms: guest suite, lounge, library, kitchen, storage, dining), never corridors/landings/stairs, and each room can be searched once (`state.searchedRooms`). Dark rooms (`dark: true` — Back Stairs Passage, Storage, Service Corridor) also need a Flashlight to search.
- A forced encounter is with one player of the entering player's choice: when a room holds several others, the encounter modal shows a chooser first, and only the chosen pair is locked for the round (the others aren't forced).
- A dead player's character view lies flat with a small blood pool (`characterView.setDead`) and stays where they fell; the turn strip crosses them out.

## Interface layout (portraits, panels, hand)
> **PARTLY SUPERSEDED, see "Interface redesign", "The possessed guest's own interface" and "Round 2, polish".** Health is four bars (not three), and the hand is a fan of face-up cards, not face-down backs. Portraits are drawn from each guest's avatar.
- Placeholder character faces live in `src/ui/portrait.js` (`makePortrait(doc, player, {possessed})`) as inline SVG — one function behind which real face art can drop in later without touching the interface logic. Normal and POSSESSED (the same face with both eyes a deep blood-red iris and a white catchlight — the drawn fallback for the possessed portrait images) are two states of the same call; callers just pass the player and whether to show the possessed look.
- Bottom-left **active-player panel**: portrait (normal / possessed), name, three health bars, AP. The possessed portrait and a faint dark-plum corner shadow (`#possess-tint`, pointer-events none, under the HUD; hidden again by `hud.hide()` on the way back to the menu) are driven by the viewer's own `possessed` flag, so they update automatically.
- Top **players strip**: a small portrait + name per player, the active one highlighted with a coloured ring and a TURN tag, the dead crossed out. These portraits are always drawn normal — they never reveal a possessed role (hidden information).
- Bottom-centre **hand**: the active player's cards face down (card backs, capped at 8 drawn) with a count badge that re-renders on every `refresh()` (after trading, searching, using, discarding). Tapping the strip opens the detailed face-up hand panel.
- The AP display, turn indicator, rotate buttons, End turn and the map button are kept; the layout puts player info bottom-left, cards bottom-centre, actions + view controls bottom-right, so the middle stays clear on an iPad in landscape.
- **Hand limit** (`rules.handLimit`, 6): at End turn a player over the limit gets a discard modal (`src/ui/discard.js`) — tap cards to drop until at 6, then Done — before control passes on. `actions.discardCard`/`overHandLimit` are the pure helpers.

## Interface redesign — Art Deco player interface (pass 11)
> **PARTLY SUPERSEDED, see "Search from the room, and the hand held like cards" and "Round 2, polish".** There is no Search button and the hand is a fan now; the Art Deco look and the rule that existing element ids are kept still hold.
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
  possessed tell (red-eyed portrait, crimson plate, POSSESSED badge + `#possess-tint`) shows only on the player's own panel.
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
> **HISTORY, see "All six guests modelled to the owner's sheets" and "Avatars: the wardrobe, runtime portraits, bots' looks" for what ships now.** This section and the next two (Victor v2, v5) record how the first glTF guest was made.
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
- **A found card is never discarded silently.** (Superseded: the owner-approved hand-limit rule keeps
  every found card and settles the limit at the end of the turn — see "Owner-approved: 1 Lantern each;
  hand limit at the end of your turn" below.)
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
> **HISTORY, see "All six guests modelled to the owner's sheets".** Walking is now by room, not free movement.
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
  crops it and makes the private possessed variant (since the possessed-look pass: a second render of the
  same guest with the game's own red eyes from `src/render/possessedLook.js`, laid on the plum-crimson plate). Same filenames as before, so the interface code and the public/private
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
> **HISTORY, see "All six guests modelled to the owner's sheets" and "Avatars: the wardrobe".**
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
> **SUPERSEDED, see "Rules reset" (next section) and "Main menu, play with bots, hot-seat removed".** Hot-seat, the Offers ruleset, the "legacy" engine, "Possession is an intent" and the six-guests-one-iPad privacy design are all gone. There is one ruleset (`src/data/rules.js`), `applyMode` takes `'practice'` or `'match'`, and `?mode=hotseat` links open a match against bots.
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
> **The hot-seat parts of this section are SUPERSEDED, see "Main menu, play with bots, hot-seat removed".** There is no device to pass: "private screens" are now screens only the player looks at, and `applyMode('hotseat')` is `applyMode('match')`. The rules half (one ruleset, the owner's numbers, GAME_RULES.md guarded by CLAUDE.md) still holds.
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
  (Since changed by the owner: during the possessed guest's own turn the main screen now shows a
  POSSESSED label, the souls count and the ×N Possession card — still no portrait or tint. See
  "The main screen (player panel + fan)" below.)
- **Trades pass the device.** The entering guest picks a card in private, the device goes to the
  other guest who picks in private, the cards swap, and the device comes back with a private
  "you received…" card. The other guest reads theirs on their own next private screen. The public
  panel says only that a trade was made. In a voluntary trade (the Fire Exit) the other guest picks
  first and the guest whose turn it is picks second; they then read their own result in private as soon
  as the device comes back to them, before the public panel, so a guest converted there never learns it
  from their main screen in front of the table.
- **Superseded by the approved Lantern rules** (next section): key pieces are gone.
- **Locked and barricaded doorways are enforced in pathfinding**, not just in the door blink: the
  landing cells on both sides of such a doorway are removed from the walkable set, so no route can
  thread through the opening. The map draws a padlock or a bar on them.
- **Dead guests drop everything** into `state.roomDrops` and the next search there takes it all.
- **The discard pile reshuffles into the deck** when it runs out; the state carries its seeded RNG
  so reshuffles and Lock Pick rolls stay reproducible under `?seed=`.


## Approved rule changes — Lanterns are the way out
> **Some numbers here changed, see "Owner-approved: 1 Lantern each; hand limit at the end of your turn".** Every guest now starts with 1 Lantern (they were "never dealt" when this was written). Three Lanterns to escape, and a Lantern as the block against possession, still hold.
- **Lanterns do double duty.** Three in a clean guest's hand open the exit (`rules.lanternsToEscape`);
  given in a trade they block possession. The key pieces, their hiding and the `pieceRooms` state
  are gone.
- **Lanterns are never dealt.** (Superseded — every guest now starts with 1; see the section at the end.)
  `deal()` takes the Lanterns out, deals `rules.lanternsDealtEach` of them to each guest, fills the
  four-card hands from the rest, then shuffles the remaining Lanterns back in with the match's seeded RNG.
- **A blocking Lantern is used up.** Both it and the Possession card are discarded (the Possession
  card leaves the game; the Lantern goes to the discard pile). In an ordinary trade a Lantern moves
  like any card.
- **Comparison variants live in the rules file but only the simulator touches them.**
  `rules.lanternBlock` ('discard' approved / 'attacker') and `rules.lanternsDealtEach` (1 approved /
  0 the old rule) let `tools/balance/hotseat-sim.mjs` compare the alternatives through the real engine rather
  than a copy of it; the game and every test run the approved values, and a rules test asserts it.
- **Search results are private.** `search()` writes only "X searched the Kitchen." to the public log;
  in hot-seat the result goes on the searcher's private card and the shared toast just says someone
  searched. The exit's
  refusal message is the same words for everyone, so it gives away neither possession nor Lanterns.
- **Barricade expiry is tied to the placer, not a turn count.** It comes down when the guest who
  placed it starts their next turn; the earlier "turn + living guests" count ran one turn long if
  someone died in between. A dead placer's barricade comes down at the next turn start.
- **The discard prompt wraps.** Six cards in one row overflowed the box and clipped the
  outer cards out of reach on an iPad; with Lanterns counting toward the hand limit, full hands are
  common, so the rows now wrap with compact tiles and the browser test checks every card is on
  screen and tappable.


## Approved rule change — the dawn deadline
> **"Hot-seat only" below now means "a match" (not practice), see "Main menu, play with bots, hot-seat removed".** The rule itself (dawn after round 8, `rules.roundLimit`) is unchanged.
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

## Approved rule changes — Part 2: rooms with jobs and new cards
> **PARTLY SUPERSEDED (15 Oct 2026), see "Round 4, rooms, the discard clock and the lobby".** The Infirmaries and the Switchboard can no longer be searched (their own action takes the search's place), each Infirmary now works once per match, and the Switchboard costs 2 actions with no once-a-turn limit. The Linen Store, the five-job-tiles-in-place-of-ordinary-tiles choice and "a room's job is data" below still hold.
- **A room's job is data.** A tile in `src/data/hotel.js` carries `job: 'linenStore' | 'infirmary' |
  'switchboard'`; the numbers (2 cards, 1 AP, heal 2, …) live in `src/data/rules.js`; what each job does is
  in `src/game/actions.js` (`search`, `canUseRoom`, `useInfirmary`, `useSwitchboard`). A new job means one
  data field plus one engine function — no rendering change.
- **The five job tiles replaced five ordinary tiles of the same doorway shapes** (Guest Suites 410, 412,
  414, 418 and the Garden Lounge), so the hotel generator's mix of dead ends, corners, straights, Ts and
  crossroads — and everything the never-close-off rule was tested on — is unchanged.
- **Linen Store: "the first search" is the room's card draw.** A search that picks up a dead guest's
  dropped cards does not use it (as for any room). Both cards always go into the hand, even past 6 (the
  limit is settled at the end of the turn).
- **Switchboard counts living guests** (the dead are out of the game) and the answer is public: a notice
  the whole table dismisses, plus the public log. ~~"Once per player per turn" is kept per guest, per turn.~~
  **SUPERSEDED 15 Oct 2026:** there is no once-a-turn limit any more. The Switchboard costs 2 actions and a guest may ring it as
  often as they can pay ("Round 4, rooms, the discard clock and the lobby"). The count is still of living guests, and still public.
- **Hand Mirror: contents private, the act public.** What the mirror shows appears only on the user's
  private hand-over screen; the table sees "A used a Hand Mirror on B", and B is told privately on their
  own next screen. A clean guest who sees a Possession card is recorded as knowing (the same "unmasked" list
  a Lantern block feeds). It can't be used mid-walk: walking in on a guest starts the meeting first.
- **Espresso** is the one free card: it works at 0 actions, stacks, and the extra actions are shown as
  copper bonus pips; like all actions they are gone when the turn ends.
- **Simulator** (`tools/balance/hotseat-sim.mjs`): bot choices are now seeded per match, so the same
  command gives the same numbers; `--before` replays the same bots, seeds and hotels on the rules before
  Part 2, so a change is measured like for like rather than against an old table.

## Every room baked like the lobby (tools/room-pipeline/)
- **One kit, generalised from the lobby build.** `roomkit.py` holds the lobby's techniques (softly
  bevelled boxes, walls cut at a consistent 2.4 m with a dark cap, doorways with walnut casings and brass
  plinths, sconces, gilt-framed paintings) plus wall styles (walnut panelling, wallpaper over a walnut
  wainscot, glazed tile, painted plaster), windows, mirrors, clocks, radiators and caged bulbs.
  `make_room.py` has a furniture builder for every footprint kind in `src/data/hotel.js` and a theme per
  room; `build_all.sh` bakes all of them. The furniture stands on the game's own footprints, so collision
  and pathfinding are unchanged; decoration only goes against the walls, inside the 0.3 m band guests
  never reach.
- **Built in the tile's default orientation, turned in the game.** A tile can be placed at any of four
  orientations; the model is turned with it (`dressBakedTile`), and each game wall segment is matched to
  its model part by turning its centre back into the model's frame. The baked light turns with the room.
- **Few draw calls.** Only the upper walls fold for the cutaway, so each wall segment keeps one upper part
  (`W_<side>_<k>_up`) and everything else — lower walls, furniture, decoration — is merged into "static"
  plus "floor". Three materials (vertex colour, the shared atlas, and unlit lamp glass): about 10–15 draw
  calls a room; 13 rooms revealed come to ~130 (the grey boxes were ~150).
- **One shared albedo atlas** (`rooms/albedo.jpg`, 16 cells: floors, rugs, paintings, wallpapers, book
  spines, wall tiles, signs) loaded once; each room adds only its two light maps (512 px JPEG, baked at 1024) and its
  geometry. The .glb files carry no images and are packed (8-bit colours, 16-bit UVs) to ~0.6–1 MB.
- **Loaded when revealed.** A room's files are fetched the first time its door is opened (and cached for
  the next match), in keeping with "load rooms on demand" in the path to mobile apps.
- **Flicker on a baked room** dims its whole light map with the bulb (mood.js), since the light is baked.

## Rooms rebuilt to the owner's references (tools/room-pipeline/ref/)
- **One style from 17 reference images.** Mahogany walls in tall moulded panels with square pilasters and
  brass plinths at every doorway and corner, a heavy cap, upright sconces beside each doorway, cream stone
  floors (herringbone in the ballroom, planks in the library, a checker in the kitchen, sage tiles in the
  infirmaries, slate in the back corridor) and burgundy rugs, runners and border bands with a thin gold
  line. The six rooms without a reference (corner corridor, linen stores, suite 416, housekeeping, fire
  exit) use the same kit so the hotel is consistent.
- **Game rules win over the pictures.** Doorways are exactly the tiles' (a reference opening the tile does
  not have becomes wall); the furniture footprints in `src/data/hotel.js` were re-laid to follow each
  picture while keeping every doorway reachable and the middle clear (`tests/logic-check.mjs`, all 96
  orientations), and the model stands on exactly those footprints. One piece per room is the search
  spot (`searchSpot(...)`, `size[1]` = its real height, `searchPoint` names it).
- **Colours are matched as they show, not as albedo.** The game draws baked rooms unlit through Khronos
  neutral tone mapping, which strips up to 0.04 from each channel of a dark colour: a saturated brown
  albedo came out orange with no blue at all. Colours are now written as the reference shows them and
  converted by `shown()` for the light each surface gets, and the light maps' colour is tamed before
  saving (bounce light between brown walls made them orange).
- **Lowered walls look like the references' low front walls.** A lowered wall keeps its lower 0.64 m;
  the doorway and corner posts keep 1.05 m. The part of a post above the cut is baked with the cut caps
  (upper walls hidden), so it is lit correctly when it is seen.
- **Rugs are shapes, not textures.** A rug, a cross or T runner, or a border band is the union of
  rectangles with its gold line inset from the outline (`rug()` in `roomkit.py`), so one continuous line
  follows any shape and stops where a runner leaves through a doorway; the floor is cut around it.
- **Comparison is honest to the game.** `vsref.mjs` shows each room with the game's own camera (pitch,
  field of view, default zoom, 90° steps), entrance at the bottom; the references are drawn from a turned,
  higher three-quarter view, so framing differs by design. `walkcheck.mjs` walks a guest through every
  doorway of every room in the real game.

## All six guests modelled to the owner's sheets (tools/char-pipeline/guest_kit.py, dress_kit.py)
- **One builder, many guests.** Victor's hand-written builder was generalised into `guest_kit.py` (suited
  guests) and `dress_kit.py` (dress guests); each guest is a spec in `tools/char-pipeline/guests/`. Same
  rig and bone names for everyone, so the game loads any guest the same way (`outfit.model` in
  `src/data/characters.js`, portraits in `src/ui/portrait.js`). Each GLB ≈ 28–32k triangles, ≈1.1 MB.
- **Measured against the sheets.** Every guest was iterated against sheet panels (`sheet_compare.py`:
  silhouette overlap per view + side-by-side) and checked in the real lobby (`lineup.mjs`). Honest
  similarity is ~80–88% per view (silhouette overlap 0.85–0.93); the main remaining gap everywhere is
  hair gloss — the sheets are glossy studio renders, the game uses matte Lambert materials on purpose
  (a specular hotspot made Victor's hair read as a bald shiny dome, see earlier sections).
- **Colours are solved for the hotel light, not the preview.** The lobby lamps are strongly warm; light
  base colours washed out (navy → lavender, black shoes → brown). `guest_kit.PALETTE` / `lobby_base()`
  pick bases that land on the sheet's colour under the measured lobby light, so the neutral preview reads
  slightly more saturated than the sheets. The game view wins.
- **Walk cadence.** At 2 m/s these short-legged guests would need ~5.7 steps/s for a fully planted walk,
  which read as frantic. The walk is authored by foot placement + IK (`gait.py`: heel strike, foot flat,
  heel rise, toe-off, swing) and the game uses 1.5× the planted-foot stride (`guest_anim.WALK_STRIDE_SCALE`),
  giving ~3.5 steps/s with a slight foot glide that is hard to see from the game camera. Dress guests take
  shorter steps (`walk_kw=dict(skirt=True)`) and their skirts are weighted to follow the legs.
- **Scene cost** with all six on screen in the lobby: 144 draw calls, ~237k triangles, 11 shader programs.

## Search from the room, and the hand held like cards (interface only — no rule changed)
> **The hot-seat wording in this section is SUPERSEDED, see "Main menu, play with bots, hot-seat removed".** The hand-over screens it mentions are now private screens for the one player; the search icon and the card fan described here still ship.
- **No Search button.** The furniture flagged `search: true` in `src/data/hotel.js` carries the search
  spot. `placeRoom` (`src/game/hotel.js`) now keeps that flag on the placed, turned furniture and
  `searchSpotOf(room)` returns it, so any new footprint works with no code change. The icon
  (`src/ui/searchSpot.js`) is one DOM button projected from a point just above that furniture each
  frame (only its transform is written, and only when it moved): crisp, 60 px, easy to tap. What it
  shows comes from the rules — `searchLeft` (a new pure helper in `actions.js`: unused draw or cards on
  the floor) decides whether there is an icon, `canSearch` whether it is live or dimmed (dark, no
  actions, empty deck). A tap walks the guest to free floor in front of the furniture (free, inside the
  room) and then runs the same `search()` as the old button; refusals give the old button's words.
- **The found card is shown large** on the hand-over card (`handoff.privateFound`): opaque and marked
  private in hot-seat, exactly where the private note used to be (the table still sees only
  "X searched."); on a lighter backdrop in practice. Then it deals into the fan.
- **The hand is a fan** (`src/ui/handFan.js`) in the middle of the bottom bar, so flex layout keeps it
  off the guest panel and the buttons at every size. Cards rest about a quarter below the screen edge
  (as in Hearthstone) and rise when touched/hovered: a full-height fan covered the lobby door ring
  nearest the camera at 1180×820. Rebuilt only when the hand changes; positions are CSS transforms,
  re-placed whenever the strip's own width changes (a ResizeObserver: an Infirmary / Escape / Trade
  button widens the button row without any window resize) and taken at once, without a glide, so no
  half-finished slide can leave a card over the buttons. When the search furniture is at or past the
  screen edge (a corner piece nearest the camera), the icon is kept on screen at the nearest edge.
- **The card view replaces the hand sheet** (`src/ui/hand.js`): one card large, with the same detail
  and action code as before, ‹ › to browse, the same possessed / unmasked banner. A card that is used
  up closes the view.
- **Privacy.** The fan and the icon show only in the active guest's own action phase; the script hides
  them whenever a hand-over, private, meeting, notice, map, prompt or end screen is up, and a CSS `:has()`
  rule hides them the instant any of those overlays appears. In hot-seat the fan never shows Possession
  cards: on a shared device a purple card on the always-on screen would reveal the role (the same
  reason the possessed tint is off in hot-seat). They are seen, as before, only through *Private
  details*. Practice (and later online play, one device each) can show them. (Since changed by the
  owner: in hot-seat the fan shows them as one ×N card during the possessed guest's own turn only —
  see "The main screen (player panel + fan)" below.)
- **Not added:** discarding from the card view. Discarding is only the end-of-turn hand-limit prompt
  in the rules, so the existing discard prompt stays the only place for it.

## Playtest fix round (interface; one owner-approved rule)
> **The hot-seat wording in this section is SUPERSEDED, see "Main menu, play with bots, hot-seat removed".** The skipped-trade rule and its neutral words still hold.

- **Skipped trade = pure rules + neutral words.** `canTrade(P, Q)` and `skipTrade(state, floor, P, Q)`
  live in `src/game/actions.js` so a server can reuse them; `resolveTrade` refuses a trade that should be
  skipped. Owner-approved rule (Option B): the trade is skipped if either guest has no *ordinary* card —
  Possession cards don't count. The first version counted a Possession card as something to give, and
  then a guest showing 0 cards who still traded was visibly possessed; now whether a trade happens
  depends only on the public card counts. A possessed guest holding only Possession cards is skipped
  exactly like an empty-handed clean guest, and every note, the public line and the log read word for
  word the same (tested in rules-check and browser-hotseat 5b). The public line never says whose hand was
  empty. Each guest's private note says only what they can know. In hot-seat the guest holding the
  device reads theirs at once; the other reads theirs on their next private screen.
- **Door tap zone** = the ring's drawn extent (`t + 0.62` inset + `0.33` radius, `src/render/roomView.js`)
  plus 0.12 m of finger slack: `DOOR_TAP_ACROSS` in `src/main.js`.
- **Fan taps open on pointer release with pointer capture**, not on the browser's click (which is
  hit-tested where the finger lifts, after a re-layout may have moved the card). The click that follows
  is swallowed once so it cannot land on (and close) the card view just opened. Cards already drawn are
  kept (keyed by id), so a pressed card is never replaced mid-tap.
- **Escape button** (**SUPERSEDED in Round 4: there is no Escape button now, the Fire Exit has an Exit icon, see "Round 4, the turn flow, the lock choice, the Exit icon and the Cards screen"; the reasoning about what grey and green may tell still holds**): enabled only when `canEscape` would let the guest out. Disabled reads "Clean + 3
  Lanterns" for everyone barred (hot-seat), so a possessed guest's button looks exactly like a clean guest
  short of Lanterns; with no actions it reads "No actions left" for all. Enabled means the guest can win
  this instant, so it reveals nothing that pressing it would not.
- **Portrait** is refused with a pure-CSS overlay (`(orientation: portrait), (max-width: 900px)`) rather
  than a second layout; the turn clock checks the same media query and pauses.
- **Bodies**: a death turns the victim (before the fall) so the body lies on free floor of the room, away
  from the living; standing spots treat a body as a 1.75 m segment to keep clear of. Display only.
- **Short room names** for the top strip are data (`short:` in `src/data/hotel.js`), not code.


## Corner-on camera and see-through (camera fix round; owner-approved view, no rule changed)

- **The standard view is corner-on** (`config.camera`: yaw offset 45°, pitch 44°, distance 16, zoom
  8–26), like the owner's room pictures: a whole 8 m room with a margin at the default zoom on 1024×768
  and 1180×820. `lookAhead` (1.2 m, scaled with zoom) aims the camera a little past the guest toward the
  viewer, so the guest's room sits above the middle of the screen and its near doorways clear the hand.
  Rotate still steps 90° (the view stays corner-on). `?camera=square` is the previous square-on view,
  `?camera=classic` the older higher one; `?camera=diagonal` still works (it is the default now).
  Taps, pan and the path preview go through ground-plane ray casts, so they needed no change.
- **Cutaway, corner-on** (`render/cutaway.js`): every room's two near walls (facing the camera) are
  lowered and its two far walls stand, as in the pictures. Rooms more than 2 m nearer the camera than
  the guest's room are cut down entirely, and walls backing onto the guest's room are lowered, so that
  room is always open to view. The square-on views keep the old rule.
- **See-through window** (`render/xray.js`) instead of re-exporting furniture: the rooms are baked with
  their furniture merged into one "static" mesh, and splitting every tall piece out would mean a full
  re-bake (~1 h) plus cut caps for each piece. Instead the room materials get a few shader lines: a
  fragment is dropped (ordered dither at the edge, so no transparency sorting and no extra draw calls)
  when it is inside a screen-space oval around the active guest and nearer the camera than the guest,
  and above the floor. The same is done around the search furniture while its icon is up, so the next
  room's cabinet cannot hide it. Covers tall furniture, next-door furniture, door leaves and the side
  wall at a doorway. Known limit: the plain backs of tall pieces on a near wall still show elsewhere.
- **Doors**: an open leaf is as tall as the taller of the two walls it stands between; it hinges on
  whichever jamb lets it swing open without passing through furniture. Rings next to a walking guest
  are hidden (no second ring under the guest crossing a doorway). A locked door gets a padlock sign
  (a sprite, seen from anywhere) besides the padlocks on the leaf. On the map the padlock sits on the
  doorway, not over the room's name.
- **Search icon** (`ui/searchSpot.js`): the badge's foot rests on the search furniture (its edge facing
  the room, on top or at 1.1 m on a tall piece — the Switchboard icon sits on its desk). It never
  covers the interface: every few frames it collects the rectangles of the top bar, player panel, fan
  cards, rotate/Map/End turn/room buttons, the Move–Open–Cancel bar, toasts, the path tag and the
  room's door rings, and takes the nearest clear place, caption included. When it had to move (or the
  furniture is off screen) it is docked at that nearest clear place with a small brass arrow on its rim
  pointing at the furniture; if nowhere is clear it hides until somewhere is. The dimmed icon's hint is
  now a side-on torch with a beam (the old one read as a megaphone).
- **Small visuals**: guests get a faint warm rim and fill in their own shader (no scene light, so no
  other shader changes; readable in dark rooms). The active marker sits 0.16 m above the model's
  measured head. A searched room shows a small brass tag with an engraved tick on its search furniture
  instead of a large white tick in the air.

## Reliable door taps (touch fix round; no rule changed)
> **SUPERSEDED, see "Tap a room, not a door; no walking about inside a room".** Doors are no longer tapped or ringed (a tap picks a room); the lesson that a late click lands on whatever is under the finger by then still matters (see `src/ui/tapGuard.js`, which keeps a double tap from answering the next screen).

- **No "ghost" confirm.** A finger tap is followed by a browser click aimed at whatever is under the
  finger by then. A door ring under the spot where the Move/Open bar appears got that late click on
  the bar's button, so the door opened (or the guest walked) with no confirmation, or Cancel closed the
  bar at once. `src/input.js` cancels the canvas's `touchend` (no late click; taps still come from the
  pointer events), and `src/hud.js` only accepts a pointer click on Move/Cancel whose press began on the
  bar after it appeared (keyboard / scripted clicks, `detail` 0, still count). This was the cause of the
  autoplay notes `ring-inner-edge-miss`, `door-tap-no-move` (guest already walking) and
  `door-tap-no-confirm` ("The door opens…" with no bar).
- **Door taps while walking are kept, not dropped.** A tap made while the guest is still walking (or
  arriving) is remembered as a ground point and answered once they stand still, if it is on a door, in
  the same turn, and nothing (a meeting, a card) opened meanwhile; the answer is only the Move/Open
  question, never a move. Floor taps mid-walk are still ignored.
- **Camera at rest frames the room.** While the guest walks the camera follows them as before; once
  they stand still it aims no more than 1.2 m (at the default zoom; more when zoomed in) from the centre
  of their room, so a guest searching in a far corner no longer pushes the near door rings under the
  hand (`followPoint` in `src/main.js`).
- The harness's `ring-inner-edge-miss` message now reads the game's real tap zone
  (`__game.doorTapAcross()`, 1.22 m) instead of the stale 0.85 m. `tap-failed-move-confirm`
  ("element is not stable") is Playwright's stability wait during a slow headless frame; not changed.

## Locked doors re-lock at the end of the opener's turn (owner-approved rule)

- **The rule** (docs/GAME_RULES.md, Rooms): the two locked rooms are dead ends with a single doorway;
  a Master Key or Lock Pick opens that one door from the room on the other side, until the end of the
  opener's turn, then it locks again; a locked door only stops guests going in.
- **The Cloakroom became a dead end** (it was a corner with two doorways): with one door per locked room
  the lock is the door. The deck stays at 24 (now 3 corners, 5 dead ends); the tile keeps its place in
  the `tiles` list so seeded decks still shuffle as before. Its model was rebuilt with the room pipeline
  (east wall panelled, bench against it). Its one doorway holds the locked door, which the game draws
  as its usual single door with padlocks, not the reference picture's gold-handled double front door.
- **State** (`src/game/state.js`): `state.lockedRooms` (rooms whose one door is locked now — keyed by the
  room, which is the same thing as its single door) and `state.openLocks` (room → `{ by, turn, doorway }`,
  written by `useUnlock`). `endTurn` calls `relockDoors` (like `expireBarricades`) and returns `relocked`.
- **Direction-aware passing**: `lockedAgainst(state, doorway, fromRoom)` / `doorwayPassable(..., fromRoom)`
  block only going IN; `usableDoorways`, `canAffordRoute` (entering a locked room is refused, leaving
  never is) and the path allow-list `buildAllowed(state, floor, grid, player)` (seals a locked door's
  landing cells unless the guest stands inside that room) all follow it. So a guest who was inside when
  the door re-locked always walks out, and can't come back in without another key.
- **Hotel growth** (`keepsHotelOpen` in `src/game/hotel.js`) treats locked TILES (`room.locked`) as walls
  at all times, not the current lock state, so a door locking again can never close the hotel off; and
  since locked rooms are dead ends the Fire Exit can never be behind one (rules-check and logic-check
  test this over 400 hotels each).
- **Looks**: the door leaf swings shut again, padlocks on, when it re-locks (`roomView.js` now also
  animates closing), and stands open (still padlocked) while the active guest is inside the locked room
  — the way out. The map shows 🔒 locked / 🔓 open this turn. Toasts say "open until the end of your
  turn" and "has locked again" (hot-seat: shown when the next guest's action phase starts).
- The simulator bots play a key only with the actions to step straight in, and do.
- **Wasted keys** (review follow-up): `useUnlock` refuses, spending nothing, when the door is also
  barricaded (reason `sealed`: the door always locks again before the Barricade comes down, so the card
  could never help) and when the guest is not the one taking their turn (`notYourTurn`: the door locks
  again at the end of the opener's turn, so only the active guest may open one). The card view greys
  out a barricaded door's button and says why, and warns "You will have no action left to go in" when
  the key would use the guest's last action and they hold no Espresso (allowed by the rules, just
  wasted). A door a key has open this turn shows an OPEN padlock sign in the scene (`openedNow` in
  `createDoorwayViews`), so it is clear it will lock again.


## The possessed guest's own interface (interface only; no rule changed)
> **The hot-seat parts are SUPERSEDED, see "Main menu, play with bots, hot-seat removed" and "The possessed look".** The possessed look is shown on the player's own screen only (nobody else looks at it); "Souls to trade" and the ×N Possession card still ship.

- **"Souls to trade"** is the owner's word for the Possession cards a possessed guest still holds
  (`soulsHeld` in `src/ui/souls.js`, simply the Possession cards in their hand). It is shown as a small
  dark chip with a crimson edge and a mini Possession card (violet before the possessed-look pass), and with 0 left it says so calmly ("No souls left to trade —
  you still win with the possessed side if dawn breaks first"), never as an error.
- **Where it shows in hot-seat — the private surfaces, and the main screen during their own turn**, as
  the owner-approved `docs/GAME_RULES.md` (Possession) says. Private surfaces: the role screen (also the "Something has changed" screen of a newly converted guest) and the private
  turn screen (possessed portrait beside the POSSESSED badge, the count on the same line, the crimson plate on
  that card (a violet wash before the possessed-look pass), the Possession cards as ONE tile with a ×N badge, and the hand's tiles sharing one row,
  118px wide at most and narrower as the hand grows (`--n` set in `renderHand`), so 3 Possession + 7
  cards and a note still fit above the Start button on a 1024×768 iPad). The card view shows the Possession cards as one
  stack with a ×N badge; on that card the count and what it does are said ONCE, beside it ("Souls to
  trade: 3" and one description — the banner then keeps only "You are POSSESSED. You can never escape."
  and the footer leaves the count out); on every other card the banner carries the trade reminder and
  the souls chip beside it (the footer never repeats the count). The banner is the same height on every
  card (room for two lines, the chip beside the words), so the card and the ‹ › arrows never move while
  you step through the hand. In hot-seat the card view has NO possessed
  portrait and NO violet wash behind it, because it also opens from a fan card during the action phase on
  the screen the whole table sees (a full-screen colour change is visible from across the table; the
  in-panel text was already there before). Outside hot-seat the card view gets the portrait and wash too. The handoff card's `possessed` class is cleared by
  `reset()` and the card view's on `close()`, and `passTurn` closes the card view before the pass screen,
  so nothing of it survives to the next hand-over (tested in `tests/browser-hotseat.mjs`).
- **The main screen (player panel + fan)** has the same tell built in — a POSSESSED label by the name,
  the souls chip under the action pips, the Possession cards as one ×N fan card. Outside hot-seat it shows
  (with the possessed portrait and tint), ready for online play (one device each). In hot-seat, where the
  always-on screen is shared, the owner approved (GAME_RULES.md > Possession, commit acacf88) showing
  the label, the chip and the ×N fan card — NOT the portrait or the violet tint, which the approved list
  does not include — during the possessed guest's own action phase only. It is the switch
  `cfg.ui.hotseatPossessedOnMainScreen` (`src/config.js`), `true` by default; `false` (or
  `?possessedTell=private` in the address) keeps the tell on the private screens only, and
  `?possessedTell=main` forces it on. `possessedTellOnMain()` in `src/main.js`, re-checked every frame,
  is false before any pass, private, meeting, public notice (the Switchboard's count, read by the whole
  table) or end screen, so it is gone before the iPad is passed on — and false while a converted guest
  has not yet been told in private (`roleChangePending`). A CSS `:has()` rule in `styles.css` also hides
  the label and the souls chip the moment any of those screens is up, as it does for the fan.
  While the fan is hidden and the turn has moved on, it drops the previous guest's cards from the page
  (and while it is hidden for a meeting in the possessed guest's own turn it takes the ×N card out of
  the hidden markup too), and the card view (`close()`: big card, detail, footer, banner) and the discard screen (`close()`:
  its cards) are emptied too, so nothing of that hand waits in hidden markup. Tested in
  `tests/browser-hotseat.mjs` (section 3b plays a real round: the tell during the possessed guest's
  own turn, absent on every pass and private screen, for every clean guest and on the next turn) and
  watched by `tests/autoplay.mjs` (a tell outside that guest's own action phase is a critical violation).
- **A barricade shows to every guest** (`isBarricaded` in `createDoorwayViews`): boards nailed across
  both faces of the doorway (one merged mesh), a red floor glow and an X sign hung low on the boards
  (0.8 m) and 0.45 m out from the doorway on the side facing the camera (`camera` option), so it stays
  clear of the top guest strip even when the doorway is on the far wall, at all four rotations. The door
  leaf in that doorway swings shut behind the boards while it is sealed (an open leaf beside them still
  read as an open door and could hide them) and swings open again when they come down. The messages are
  short ("Door to the Library barricaded until your next turn.", "Barricade down: door to the
  Library.") and stay up 5 s (`hud.toast(message, seconds)`).

## Owner-approved: 1 Lantern each; hand limit at the end of your turn
- **Starting Lantern.** `rules.lanternsDealtEach` is 1: `deal()` (src/game/cards.js) gives every guest 1
  Lantern + 3 cards from the deck with the Lanterns taken out, then shuffles the other Lanterns back in.
  The possessed guest's 3 Possession cards are added on top (state.js). Practice uses the same deal, so a
  practice run starts with 1 Lantern and needs to find 2 more — practice should match the rules it teaches.
  The practice start screen says so ("You start with 1 Lantern — find 2 more and escape through the Fire
  Exit", `buildStartScreen()` in main.js, worked out from the rules numbers).
- **Hand limit only at the end of your own turn.** `search()` always puts what it finds in the hand (a
  Linen Store's 2 cards too) and returns `over` (how many would have to go). The old take-or-leave prompt
  (`src/ui/fullHand.js`, `resolveFullHand`) is gone. `endTurnNow()` in main.js is the one gate: End turn
  and the clock running out both go through it, and over the limit it closes the card view/map, stops the
  clock and opens the discard screen (`src/ui/discard.js`, marked "Private — Name only" in hot-seat) before
  `passTurn`; `passTurn` itself refuses to run while over the limit. The rule also lives in the pure
  engine, so a future server enforces it the same way: `canEndTurn(state)` in `src/game/state.js` says
  `{ ok: false, reason: 'overHandLimit', over }` while the active guest holds more than
  `rules.handLimit` countable cards, and `endTurn()` returns that refusal and changes nothing (tested in
  `tests/rules-check.mjs`). The simulators discard first (and throw if they ever hit the refusal); the
  browser autoplay goes through the real discard screen. Possession cards are never counted or
  offered. Cards received on someone else's turn simply wait until that guest ends their own next turn.
- **Gentle warning, not an error.** `handLimitWarning()` (src/ui/cards.js) gives "Cards 8/6 · discard 2
  at end of turn" — short so the label above the fan stays on ONE line (`white-space: nowrap`) at
  1180×820 and 1024×768 — in the same words in the card view footer and the private turn screen; End
  turn's second line says "Discard 2 first". The count is public anyway (top strip), so it gives nothing away.
- **The clock never ends a turn mid-arrival.** If it hits 0 while a guest is stepping into a room
  (`pendingArrival`), it waits for the arrival (a forced meeting pauses it), then ends the turn; ending it
  mid-arrival would hand that arrival to the next guest.
- **Simulator.** The bots keep everything and discard at the end of the turn (they already did); the
  baseline now deals 1 Lantern each. Six players, mixed table: clean side wins ~23% (was ~22% when measured
  as the 'dealt1' proposal); `--pkeys dealt0` measures the old rule.


## Owner-approved: card counts are private (and what hot-seat may show)
> **The hot-seat reasoning is gone, the rule stays** (docs/GAME_RULES.md, Possession: the table never sees how many cards another guest holds). See "Main menu, play with bots, hot-seat removed".
- **Rule (docs/GAME_RULES.md > Possession):** the table never sees how many cards another guest holds. The top strip shows
  only the room and health; not even the active guest's own count is on it, because the whole table sees the strip in
  hot-seat. Why: a Possession card changing hands, or a Lantern block, changed the counts unevenly and gave possessions
  away. A guest's own count (End turn's "Discard N first", the over-limit label, the card view footer, the search result)
  shows only on that guest's own screens, during their own turn, never under a pass, meeting, notice or end screen
  (`ownInfoOnMain()` in src/main.js; a CSS `:has()` guard hides it until the next frame).
- **The skipped-trade line** no longer says "one of them had no ordinary card" in public: it says only that there was no
  trade. Each guest still learns why in private.
- **Owner's standing requirement for the online game:** hot-seat is only a testing tool, so it may show a possessed
  guest's own information on the shared iPad (e.g. the POSSESSED sign appearing right after a trade on that guest's own
  turn). In the online game, where each player has their own device, nothing may show or hint at a role, a possession or a
  hand to any other player.
- **Practice** deals the starting Lantern too (owner-approved): start with 1, find 2 more.


## Owner-approved (7 Oct 2026): 4 health, 2 Possession cards, the chain
> **The Possession cards number was changed again, see "Owner-approved (10 Oct 2026): 3 Possession cards" and "Owner-approved (10 Oct 2026): soul cards".** It is 3 now, and each card is its owner's soul. Four health still holds.
- `rules.maxHealth` 3 → 4 and `rules.possessionSupply` 3 → 2 (src/data/rules.js). Everything reads them: the
  engine, the health bars (four fit the panel at 1024 px), the strip's hearts, the souls count, the
  balance simulator (≈31% clean wins, 6 players, mixed table).
- The chain needs no engine change: a guest who is possessed already keeps the card that possessed them
  (`resolveTrade`), a Lantern block discards both, a death takes the card out of the game. The private note
  now says so ("…and you keep that card: one try to possess someone else in a trade").
- (Replaced on 10 Oct 2026 by soul cards: see 'Owner-approved (10 Oct 2026): soul cards'.)

## Tap a room, not a door; no walking about inside a room (Oct 2026)
- **Rule (docs/GAME_RULES.md > Turn, Doors and exploring):** a guest always stands in the middle of their
  room; the player acts by tapping rooms and furniture. The free reposition, the walk to the search spot
  and the gold door rings are gone.
- **Fogged rooms** (`src/render/fog.js`). Every empty cell that a closed, unjammed door leads to gets ONE
  fog room (`fogCells(floor)` in src/game/hotel.js — several doors can lead into one cell). It is a few
  stacked see-through planes per cell in ONE `InstancedMesh` with a small `ShaderMaterial` (a 128² noise
  texture made once, drifting slowly; per-instance shown/explorable/layer/seed attributes), so all the
  fog is one draw call. Fog beyond the doors of the active guest's room is brighter, with a breathing gold
  edge and an HTML "Explore · 1 AP" tag (pointer-events none); elsewhere it is dimmer. When a door opens
  its fog fades out (`cfg.fog.fade`) as the room rises; a new match's fog is simply there.
- **What a tap means** (`tapTargetAt` in main.js): a ray from the camera is tested against the ground,
  every revealed room's walls at their CURRENT (cutaway) height and its furniture boxes — analytically,
  no meshes — and the nearest hit wins: another room's wall or furniture means that room; the floor means
  the room it lies in (`roomAt`), or the fog room of that cell. The walls of the guest's own room are
  skipped (a tap there means what lies beyond), and its search-spot furniture means "search". So it works
  at every turn of the view and with the cutaway, and a tap on a tall far wall never lands on the floor
  hidden behind it. `__game.tapPointFor({ room } | { fog })` finds an on-canvas point for the tests.
- **Fog → open at once** (1 AP, `openDoor`, no confirm — the owner's flow); a fog room not next to your
  room: "Walk to the room next to it first." **Room → confirm → walk.** `roomRoute` (src/game/moves.js,
  pure) finds the FEWEST-rooms route through passable doorways (BFS; it says why there is none:
  locked / barricaded / no route); `planRoomMove` paths only through those rooms to the destination's
  standing spot and charges as before (`canAffordRoute`, one move per room entered — the engine still
  charges each crossing as it happens). Entering a room on the way that holds a guest not met there this
  round stops the walk there for the meeting: `planRoomMove` itself (pure, reusable by a server) returns
  `stop` (the first room on the route with a guest to meet — `encountersIn` in state.js; safe zones and
  guests already met there this round never stop it; nor does practice), `meet`, and the cost only up to
  the stop; the walk ends on that room's standing spot and the confirm says so up front.
- **Standing spots** are data (`hotel.standingSpots`, src/data/hotel.js: the middle, a ring 1.4 m out
  (four sides, then the diagonals at ≈2.2 m), then an outer ring at 2.85 m — all at least 1.4 m apart, so
  six guests in one room never hide one another); `standingSlot` takes the first free one: not within
  1 m of a guest or a body, and the whole figure clear of walls and furniture (`moves.standable`, the
  same test tests/logic-check.mjs runs on every tile in every orientation). The lobby's start spots are
  the first six. A walk ends exactly on its spot. The active guest's marker ring and arrow draw over
  everything (no depth test), so they are always visible among other guests.
- **Search in place**: the magnifier (or tapping its furniture) searches at once; the guest turns to face
  it. `searchPending()` stays as a hook that always says false (old scripts).
- **Taps while walking**: a tap on a ROOM is kept and offered (Move / Cancel) on arrival; a tap on fog or the
  search spot is NOT kept (each spends an action at once, after the player has moved on): it says
  "Wait until you arrive." When the turn clock runs out mid-walk, a guest still in the room the walk
  started from finishes the step into the next room (that move charged as they cross, like any move) and
  stands on its spot; one already in a room on the way stops on that room's spot (nothing more is
  spent). Nobody ends a turn in a doorway or off a standing spot.
- **A dead zone round the interface** (`inDeadZone` in main.js): a tap on the 3D view within 18 px of any
  showing piece of interface — the top strip, room name and round, the panel, the WHOLE hand-fan box, the
  buttons, End turn, the Move/Cancel bar, a toast, the search icon — does nothing. A finger that misses a
  button by a few pixels must not open a door (which costs an action with no question).
- **Your own door jammed**: tapping the fog behind it says "The door is jammed shut — there is no way
  through here." even when another room's door into that fog is fine.
- **After a door opens** the view eases (`rig.showRooms`, `cfg.camera.showMargin`) so the guest's room and
  the new room are both in view, guest included; then each room next door the guest can walk into right
  now carries a quiet "Go · 1 AP" tag (`src/ui/goTags.js`), lighter than the gold "Explore · 1 AP";
  hidden while the Move/Cancel bar, a meeting or a private screen is up, and when zoomed far out (past
  `tagsFrom`, where the guests' name tags take over).
- **Doors**: no rings; closed doors of the active guest's room keep a soft threshold glow (dimmer than
  before) linking each to its brighter fog. Padlocks, barricades and swinging leaves are unchanged.
- `cfg.player.speed` 2.0 → 2.5 m/s (rooms only now; 8 m ≈ 3 s), placeholder stride frequency to match. (**2.5 → 2.9 m/s in Round 4**, 8 m ≈ 2.75 s; see "Round 4, the turn flow, ...".)

## Camera: see the whole hotel (Oct 2026)
- **Zoom out to fit** (`src/camera.js` `fitDistance`): the zoom-out limit is the distance at which every
  revealed room — the convex hull of the rooms' corners, floor and wall tops — fits inside the part of the
  screen the interface leaves free (`cfg.camera.fitMargin`), for the current turn of the view and screen
  shape; never less than `maxDistance` (26). Perspective makes the near end look bigger, so for each
  distance tried the aim slides (bisection) until the rooms sit evenly in that space; the result is cached
  until the rooms, the turn or the aspect change (≈ a few ms once). Zooming OUT glides the view toward that
  overview centre, so at the limit everything is in view; zooming in keeps the view where it is. The far
  plane grows with the distance.
- **One limit for every turn of the view**: the limit is the widest of the four turns, so rotating while
  fully zoomed out never snaps the zoom; the view glides to that turn's overview centre instead.
- **Free pan, no drift**: a drag (one finger now too — a tap is still anything under 10 px; the drag pans
  from where the finger first touched, so the first 10 px are not lost) pans; the middle of the screen
  (the aim, with its lookahead) may go anywhere within R = `panMargin` + 0.15 × (distance − 16) of a
  revealed room (1.5 m at the standard zoom), or to the overview centre when zoomed well out — so a
  revealed room is always on screen and the hotel can never be dragged away. Nothing pulls it back. `rig.recentre({ zoom })` eases back to the guest: on a new turn (instantly, standard
  zoom), a confirmed move or an opened door (keeps the zoom), a meeting, and the ⌖ "centre on me" button
  (`#btn-centre`, beside the rotate buttons, standard zoom).
- **Far out, guests stay findable**: past `cfg.camera.tagsFrom` (34 m) each room with guests in it
  carries ONE small HTML tag naming them in their colours ("Victor · Eleanor +4", the active guest
  first and the tag in brass when they are in it; `src/ui/guestTags.js`) — no draw calls.
- **One tag layer** (`src/ui/screenTags.js`) for every tag over the view (Explore, Go, guests): it sits
  BELOW the interface (`#view` is its own stacking context under `#hud`), keeps each tag whole inside the
  screen, and hides a tag for as long as it would overlap any showing interface or a more important tag
  (the order they are placed in: the active guest's name when zoomed far out — they can always be
  found — then Explore, Go, the other guests); a tag that would clash with another first tries one
  tag-height higher, then lower. Cheap: positions are written only when they
  change, a tag is measured only when its words change, the interface's boxes are re-read every 4th frame
  and the view's size is cached until a resize. Back to the menu, the layer is emptied (`main.js
  backToMenu`): the menu's frames do not place tags, and the last game's "Go · 1 AP" stayed over the menu
  and the lift until 12 Oct 2026.
- **The path preview** leaves out the dots that would run under the Move/Cancel bar.
- **Cost**: a 19-room hotel seen whole is ≈370 draw calls / 440k triangles in the test browser (baked
  tiles are a handful of draws each, all the fog one); the lobby view is unchanged apart from the fog's one.

## Computer guests (bots): honest information, human-like play (Oct 2026)
- **Where**: `src/bots/` — pure modules (no DOM, no THREE, no Node APIs), so the same brains run in the
  game and in the Node tools. The interface talks only to `createBotTable` (`src/bots/index.js`); all-bot
  matches and "finish the match at once" go through `src/bots/autoplay.js`, which carries out every choice
  through the rules engine exactly as the interface does (a move walks the fewest-rooms route and stops at
  the first forced meeting; meetings, trades, attacks, the hand limit, end of turn).
- **Information honesty**: a bot decides from `botView()` (`src/bots/view.js`) plus its own memory, and
  nothing else. The view is the public board (rooms, doors, locks, barricades, who stands where, health,
  alive/dead/escaped, who already met where this round, how many room tiles are left), the PUBLIC event
  list, and the bot's own hand, role, action points and PRIVATE events. No names or ids (nothing that could
  hint at which seat is a person); never another guest's hand, card count or role, the draw pile or the
  room deck's order. `tests/bots-check.mjs` scrambles all of that hidden information and checks the view —
  and every choice and conclusion — stays identical. A possessed bot knows only the possessed guests it is
  linked to through conversions (who converted it, whom it converted) or worked out (a Possession card
  received, the Switchboard count).
- **Structured events (engine, no behaviour change)**: `state.events` (public, append-only, each with `seq`,
  `round`, `turn`: turn, enter, open, search, trade, noTrade, attack, mirror, switchboard, unlock, barricade,
  infirmary, escape, relock) and `player.inbox` (private: traded with what was given and got, blocked /
  blockedThem, possessed / converted, mirrorSaw / mirroredBy). Emitted next to the existing log lines;
  Bandage and Espresso use stay unannounced. Seats are `player.index`. A future server can use the same
  lists. The balance simulator prints exactly the same numbers as before.
- **Pick your role**: `state.setup.possessedIndex` forces the possessed seat. The random pick is still drawn
  first, so the hotel, the deck and every later draw are the same as without forcing.
- **Determinism**: every bot has its own seeded generator (decisions) and a second one (thinking pauses),
  so the interface asking for pauses more or less often never changes a choice; bots never draw from the
  engine's generator. Same seed → same match, event for event. Card ids (a global counter) never break ties.
- **How a bot plays**: utility scoring — what it could do here and now, and where it could walk (worth
  discounted by distance) — weighted by its profile's traits (boldness, caution, greed, aggression,
  patience, trust, skill, pace; ~60% medium, ~20% bold, ~20% careful, online-style usernames). Clean bots
  reason from public evidence (attacks, Switchboard counts against the trades in between, trades with a
  known possessed guest) and private evidence (blocks, mirrors, kindness received); they block with a
  Lantern when suspicion or caution is high, collect Lanterns and head for the Fire Exit, and late on turn
  on strong suspects or pool a single Lantern with a guest they are sure of. Possessed bots build trust
  first (a friendly trade, then the attempt on that guest), prefer guests who did not block them, feel the
  clock once the Fire Exit is found, search, open doors (a little less keenly than a clean guest) and wander
  rather than stand still, and some stand guard in the room before the Fire Exit now and then (14 Oct 2026: they
  used to "open few doors" and park by the Fire Exit, which gave them away; see "Round 2, computer guests and
  sound"). Behaviour knobs live in `TUNING` (`src/bots/brain.js`) — bot behaviour only, never a
  rule — and `tools/balance/bot-match.mjs --tune` tries them.
- **Pace**: `thinkMs` gives quicker-than-human pauses (about 0.35–1.4 s a step, 0.7–2 s for trades and
  meetings, an occasional "hmm" up to 2.5 s, times the guest's pace 0.7–1.4); the interface multiplies by
  the player's speed setting. Measured: about 3.6 actions and 5.7 s of thinking per bot turn.
- **Measured balance (all-bot, 2,000 matches per size, current rules)**: clean side wins about 50% at 6
  players, 42% at 5, 34% at 4 (possessed wins are mostly at dawn). The smaller tables favour the possessed
  side for a structural reason the older simulators also showed: the same two Possession cards and the same
  24-room hotel against only three clean guests, who find the Fire Exit later (90% of 4-player matches vs
  98% at 6). Possessions spread over rounds 1–5 (about 5–7% in round 1); a possessed bot's first trade with
  a guest in rounds 1–3 is friendly about 46% of the time and an attempt about 25%.
- **Jammed doors**: a door that turns out jammed is refused by the engine ('jammed') but is a discovery, not
  a mistake — each is tried once and then drops out of the view. Bots stop trying doors once no room tiles
  are left (the count is public).

## Main menu, play with bots, hot-seat removed (Oct 2026, owner's request)
- **One person looks at the screen.** Hot-seat (people passing one iPad) is gone at the owner's request:
  no pass-the-device screens, no `?mode=hotseat` (old links open a match against bots), no
  `ui.hotseatPossessedOnMainScreen`, no `?possessedTell`. The rules' multi-guest mode is now called `match`
  (`applyMode('match', n)`; `'hotseat'` is still accepted as another name so the balance tools keep
  working). A match is the online game's table with bots in the other seats: the player's seat is random
  (like joining a table), and their OWN private information — hand, role, possessed tell, card count —
  may show on their screen (`state.viewerIndex`: the HUD, the hand fan, the card view and the map show the
  viewer, not whoever's turn it is). Nobody else's ever does.
- **Turn flow** (`src/main.js`): on the player's turn they act as before; on a bot's turn `botTick` asks
  the bot for ONE action at a time (`src/bots/index.js` nextAction) once nothing is under way and its
  thinking pause is over, and carries it out through the same rules code and the same walks the player's
  actions use. Refusals go back to the bot (`reject`); three in a turn, or a runaway turn, end it, and the
  45-second clock runs for bots too as a backstop. A jammed door is not counted as a refusal (it is a
  discovery). Meetings work in all directions: the player walks in on a bot (the usual panel; the bot
  picks its card in secret), a bot walks in on the player (it pauses, then attacks — the player reads the
  public result — or the player picks a card on a private screen while "Marcus is choosing…"), or two bots
  meet (a public line in the feed). Voluntary Fire Exit trades: the player proposes and the bot answers
  after a pause, or a bot proposes and the player accepts or declines in private. A player who dies can
  watch, or skip to the end: `src/bots/autoplay.js` plays the rest through the rules at once.
- **Pace**: the bots' thinking pauses (`thinkMs`) times the Bot speed setting (relaxed 1.1, normal 0.75,
  fast 0.45), and bots walk 1.25 / 1.7 / 2.3 times the player's speed (`mover.speedScale`). The camera
  follows whoever is playing unless the player chose "Stay on me".
- **The feed** (`src/ui/feed.js`) shows the rules' own PUBLIC log lines (never a role, hand or private
  result) for the last few things the others did, the player's own actions left out, "you" for the player.
- **The menu** (`src/ui/menu.js`, `src/settings.js`): Play with bots (3-5 others, role random / clean /
  possessed — `state.setup.possessedIndex`), Practice alone, Settings (localStorage, guarded; only
  conveniences, never a rule). The table "fills up" with the bots' usernames at uneven intervals, like an
  online lobby. Seats, guests and bots are rolled with their own generator (seeded by `?seed` for tests).
- **The lobby behind the menu** (`src/menu/`): its own Three.js scene rendered by the game's renderer
  while the menu is up (the game scene is not drawn meanwhile), blurred with CSS. On Play the blur eases
  away and `lobby.enter()` plays the lift sequence; it is capped at 9 s so a slow device never waits on
  it; then a fade to black, the game is set up (`setupGame`: new cast in place, character views kept per
  guest and reused, movers rebuilt, bots created), and the lights come up on the player's role. If the
  lobby scene fails to load, the menu shows over the blurred hotel lobby instead.
- **Direct links** for tests: `?mode=practice`, `?mode=bots&bots=N&role=R&seat=S`, `?intro=off`,
  `?botpace=0.1`. They skip the menu and show the old "Tap to begin" card.
- **The lobby scene itself** (`src/menu/`): a night-time Art Deco lobby built from simple shapes and canvas
  textures (no new image files), about 30 draw calls: each person (the six guests, two extras, the manager
  and the concierge) is merged into ONE draw call with colours stored per vertex, so the staff and extras
  are re-dressed copies of the guest models. The models have no sit clip, so seated poses are solved at
  runtime over the breathing idle (feet planted, hands on the lap; standing up blends in 0.55 s). All
  motion follows `dt` only (dt 0 freezes it: the "Still" menu background); the boarding is timed by when
  each guest reaches the doors, and walk speed adapts so feet never slide. `enter({ guests })` resolves when
  the doors shut (about 5.8 s for three guests). If the iPad struggles, the two background extras (about
  60k triangles) are the first thing to cut.

## The possessed look (red eyes, crimson private plate)

- **What it is** (owner's reference, Oct 2026): a possessed guest looks exactly like the normal guest —
  same face, skin, hair and clothes — except both eyes, which become a deep blood-red iris (darker at the
  rim, brighter low in the middle) with a small white catchlight high and a little right of centre. No
  purple, no glow beyond a faint 0.12 self-light, no change to the skin. It replaces the old violet
  "weird eye" + cold wash.
- **One module for game and portraits**: `src/render/possessedLook.js` (imports only `three`) holds the
  colours (`POSSESSED_COLORS`), the eye's paint (`POSSESSED_EYE`) and `createPossessedEyes(root)`, which
  finds the material named `Eye` on a loaded guest (and the women's own `Shine` highlight), measures each
  eye oval from the mesh, and swaps in one red matte material (hiding `Shine`) while on. No extra draw
  calls; one extra shader program, prepared the first time it is shown. `characterView.js` keeps material
  names when it flattens the GLB and exposes `setPossessed(on)`; `tools/char-pipeline/preview_glb.html`
  uses the same module (`possessed=1`), so `portrait.mjs all` renders the private portraits
  (`assets/portraits/<name>-possessed.jpg`) with exactly the game's eyes on the plum-crimson plate.
  The normal portraits are approved art and only rewritten with `--normal` when a model changes.
- **Who sees it** is decided in ONE place, `src/main.js`: each frame
  `cv.setPossessed(phase === 'game' && !PRACTICE && i === humanSeat && state.players[i].possessed)` — only
  the player's own guest, on their own screen; never a computer guest (even a possessed bot), never in
  practice, never on the old game still drawn behind the menu. The interface tell likewise only syncs
  while a game is running (`syncHandFan`), and `hud.hide()` also hides `#possess-tint`.
  `castCharacters()` resets it because character views are reused between games. The public guest strip
  always uses the normal portraits.
- **The interface** (`styles.css`, `src/hud.js` `syncTell`, `src/ui/handoff.js`, `src/ui/hand.js`): the
  player's own panel, role card and card-view banner use a dark plum-crimson plate (#2b1018 → #160910)
  with a thin crimson line (#a3263a) inside the gold border, and a POSSESSED pill with "Only you can see
  this". A clean player in a match gets a quiet green CLEAN pill; practice shows neither. `#possess-tint`
  is now a barely visible dark-plum corner shadow (red screen edges read as "you are hurt" in games).
  `--evil` (violet) is kept only for the Possession card itself. The reference's ring icon and split
  floor ring were deliberately left out (owner: ignore them for now).

## Owner-approved (10 Oct 2026): 3 Possession cards; a newly possessed guest gets two tries
- The possessed guest starts with **3** Possession cards again (`rules.possessionSupply`, was 2 from 7 Oct).
- A guest who becomes possessed keeps the card that possessed them **and receives one extra** Possession
  card (`rules.possessionOnConvert = 1`): two tries; each guest they possess gets two tries the same way. The
  extra card is new (made in `resolveTrade`, src/game/actions.js — never taken from anyone, never from the
  deck). A Lantern block still discards the card used and the Lantern. The trade events say how many extra
  cards came (`events.possessed[].extra`, and the private `possessed` event), so the interface and the bots
  can show / use them. Approved from a before/after list in the chat; docs/GAME_RULES.md updated with the
  approved wording. Reason: in play against bots the possessed side felt very hard to win.
- (The "keep the card and get one more" part was replaced later the same day by soul cards: see
  'Owner-approved (10 Oct 2026): soul cards'. `possessionOnConvert` and `.extra` are gone.)

## Music and sound effects (Oct 2026, owner's request)
- **All made from code, nothing downloaded.** `tools/audio/` (Python: numpy/scipy + ffmpeg) synthesises
  every piece of music and every effect — additive piano, saw-bank strings, FM celesta, music box, bells,
  modal synthesis for struck things, filtered noise, a stick-slip hinge model, a synthetic hall reverb —
  then masters and encodes it. No licensing questions; anything can be retuned and rebuilt. The style
  brief: a 1920s-30s grand hotel at night, warm and slightly eerie (tools/audio/README.md describes each
  piece).
- **MP3** (44.1 kHz; music 128 kbps stereo, effects mostly 64 kbps mono): decodes in every browser the game
  targets (iPad Safari, Chrome). About 5.5 MB in all. Loops are exactly periodic by construction, and each
  loop file carries a little of its own end before it and start after it, so looping `[loopStart, loopEnd)`
  is seamless even when a decoder shifts the audio by the MP3 encoder delay.
- **Web Audio, one module** (`src/audio/index.js`): an AudioContext created on the first real gesture (iOS
  allows no sound before one; Chrome warns about a context made earlier), separate music and effects
  gains (the Settings levels), crossfades between scene tracks, small random pitch/level variation, a cap
  of 12 effects at once, pause when the page is hidden. Music is decoded only while its scene is near
  (a decoded minute of stereo is ~20 MB — iPad memory), effects are all decoded after the first tap. On
  Safari 17+ the audio session is set to `playback` so the game is heard with the ring switch on silent.
- **A cue bus, not calls into the audio code** (`src/audio/bus.js`): screens ask for a sound by name
  (`sfx('lanternBlock')`); with sound off, before the first tap or in Node tests nothing happens. The
  hotel's own sounds (doors, searches, unlocks, barricades, rooms, attacks, escape, footsteps) are not
  called from the game code at all: `src/audio/gameSounds.js` reads the engine's PUBLIC event list each
  frame, so a sound can never reveal more than the whole table already knows (no sound for a bot's
  private card play), and a future server's event stream can drive it unchanged. Other guests' sounds are
  quieter and panned by where they are on screen.
- **Music by scene**: menu and lift → the lobby waltz; the game → the night ambience, crossfading to the
  final-round piece in round 8; the end screen → a stinger from the player's side (win, the possessed
  side's dark win, lose; dawn tolls its bell first); back to the menu → the waltz. Stingers follow the
  Music setting.

## Trades shown as cards; music and sound (Oct 2026, owner's request — interface only, no rule changed)
- **The player's own trade is a short card scene, not sentences** (`src/ui/tradeReveal.js`): swap, Lantern
  block (the Possession card burns to ash), blocked by them, you are possessed (crimson smoke, the cards you
  now hold fan out), you possessed them, no trade (an empty hand held out). It opens as the usual private
  "note" screen, so the turn clock, the tests and `#btn-handoff-next` behave as before; the rules' own
  private note for that trade is taken off the waiting list (the scene says it). A tap skips to the end;
  Continue appears, and takes taps, only a moment after the scene ends (a quick double tap can't close it
  unseen). Reduced motion: shorter, no particles. Another guest's portrait is never the possessed one.
- **Cheap to draw on an iPad**: CSS transforms/opacity on a few elements; embers, ash and smoke on one small
  canvas (edges faded, so smoke never stops on a hard line); the burning card is a per-pixel dissolve of
  its own face on a card-sized canvas. Attack results (`meeting.js`) and the feed (`feed.js`, icons picked
  by the rules' action words, never by a room's name) use the same card art.
- **Audio safety**: a limiter (DynamicsCompressor, -3 dB threshold, 20:1; the master trims its built-in
  make-up gain) before the speakers, so a loud effect over the music never clips; measured transparent
  below about -1.3 dBFS. Leaving the end screen stops every stinger (a dawn ending plays two). Music and
  Sound effects both Off: the audio is suspended and the iPad's audio session given back, so the player's
  own music isn't paused by a silent game. Effects are high-passed at 30 Hz at build time; the revolver
  and the death sound carry a mid-range crack/knock so they still read on a tablet's small speakers.

## Quality round fixes (10 Oct 2026 — interface and performance only, no rule changed)
- **A double tap never answers the screen it opens** (`src/ui/tapGuard.js`): Trade opens the cards to give,
  Attack the weapons, a guest's name Trade/Attack, a menu button the next menu screen — each right under
  the finger. The private card pick and yes/no (`handoff.js`), every meeting panel (`meeting.js`) and the
  menu screens (`menu.js`) ignore a pointer click in their first 300 ms; keyboard clicks (no pointer,
  `e.detail` 0) always count. Tests that tap a screen the moment it opens wait 400 ms first.
- **The Move bar names a guest waiting in the room the walk ends in** ("You will meet Clara there: a
  meeting is forced."), not only one on the way (`offerMove`; the rules' `encountersIn`, so a safe zone or
  a meeting already held this round says nothing).
- **Shader warm-up** (`main.js warmUp`): a tile (the Fire Exit's, the smallest), the search tick, the
  locked-door and barricade pieces and the player's own red eyes are drawn once out of sight behind the
  black screen at the start of a game (behind "Tap to begin" on a direct link, without the eyes), so the
  first door, search, barricade or possession no longer freezes the game while the iPad builds shaders.
  Once per visit (programs are kept). `KHR_parallel_shader_compile` is used when there (no warning when not).
- **Light maps at the size that shows**: the room tiles' two maps ship at 512 (baked at 1024, shrunk by
  `tools/room-pipeline/shrink_maps.py`, which `build_all.sh` runs), the lobby's atlas at 1024. Side by side
  at the iPad's 2x density they look the same; a fully explored hotel now holds ~118 MB of textures instead
  of ~326 MB, and the downloads are ~4 MB smaller. Between games the room tiles' maps also leave the
  graphics chip (`releaseTileTextures`; the pictures stay cached, a room seen again re-uploads its maps).
- **The menu's picture first**: the hotel behind the menu (its starting room and the game's guest) loads
  only after the menu's lobby scene has (or when a game is set up); before the lobby picture appears
  ~11 MB downloads instead of ~15 MB. A game started before then waits up to 3 s behind the black screen
  for its starting room, rather than open on the grey placeholder. Left for later: meshopt compression of the .glb files (gltfpack
  `-cc -noq` shrinks a guest 1.18 → 0.44 MB) — it needs the decoder in every GLTFLoader, an extra step in
  the character and room pipelines (their own tools read the .glb files), and it is only worth it if
  GitHub Pages does not already gzip .glb (not checked: Pages is not reachable from here).
- **Cheaper idle frames**: the turn clock touches the page only when its second changes (the bar is a
  `scaleX` transform: no re-layout every frame); the 'Still' menu background is drawn again only on a new
  size or pixel ratio, coming back from a game, or twice a second (its guests may still be arriving).

## Owner-approved (10 Oct 2026): soul cards
Approved word for word from a before/after list in the chat. The owner had noticed that after a trade in
which both possessed guests handed over a Possession card, nobody lost one and the player held two.
- **Before:** Possession cards were interchangeable. Receiving one possessed you; you kept that card and got
  one more (`possessionOnConvert: 1`). Two possessed guests who both handed one over simply swapped them
  (nothing lost), and one handed to a guest already possessed was kept by them (the possessed side lost
  nothing, and the receiver gained a try).
- **After:** each possessed guest's Possession cards are their own souls, with their own face; you only ever
  hold and give your own. (1) Becoming possessed: the card that possessed you is used up and you get two
  souls of your own (`rules.soulsOnConvert: 2`). (2) Both hand over a soul: both are used up, each loses a
  try, each now knows the other. (3) A soul handed to a guest already possessed (they gave an ordinary
  card): used up; the giver still gets their card, the other gains nothing; each now knows the other.
  Unchanged: 3 to start, a Lantern blocks whatever the blocker's role (both burn, the blocker learns who
  tried), the dead take their souls out of the game, souls never count toward the hand limit and can't be
  discarded. No other balance change (owner's choice). docs/GAME_RULES.md updated with the approved wording.
- **Engine** (`src/game/cards.js`, `actions.js`): every Possession card carries `owner` (a player id;
  `makeCard('possession', { owner })`, the starting supply is the first possessed guest's). `mayGive` /
  `tradeableCards`: a soul only by a possessed guest who owns it, else `resolveTrade` says `illegal`. A used-up
  soul goes nowhere (not the discard pile, not the deck). `resolveTrade` returns `possessed[] { newly, by,
  souls }`, `blocks[]`, `spent[] { by, at }` (rules 2 and 3; two entries when both handed one over) and the
  private notes; `received` is null where nothing arrived, and `'possession'` for a guest a card possessed.
  New private events: `soulSpent { by }` (receiver) / `alreadyPossessed { who }` (giver), and
  `soulsCrossed { with }` (each); both sides go into each other's `knows`. The public log is still only
  "X and Y traded."
- **What a guest knows** (`src/game/knowledge.js`): `knownPossessed(state, player)` gives the ids that guest
  certainly knows are possessed, from their own record and private events only (who possessed them, whom
  they possessed, a Possession card that reached them, a block they made, a spent or crossed soul, a Hand
  Mirror that showed one, their `knows`). Never from other guests' secrets (tested by scrambling them). For
  the interface's red eyes on known allies; a server can reuse it.
- **Bots** (`src/bots/brain.js`): the old guess ("a Possession card I gave neither converted nor was blocked,
  so they were already possessed") is gone; they learn allies from the new events and never hand a soul to a
  known ally (bots-check: 0 in 450 matches). Still information-honest (the scramble test covers the new
  events and the owner field) and deterministic.
- **Bot matches** (`node tools/balance/bot-match.mjs --n 1000`, clean side's wins, before → after): 6 players
  43.2% → 44.3%, 5 players 38.1% → 38.4%, 4 players 31.2% → 31.1%. The hotel wins less by possessing
  everyone (6 players 15.1% → 9.2%) and more at dawn (41.7% → 46.5%). Souls spent between possessed guests
  per match (on one already possessed / both handed over): 0.69 / 0.46 at 6 players, 0.37 / 0.36 at 5,
  0.10 / 0.14 at 4. Refused actions 0, unfinished matches 0.

## Soul cards on screen; red eyes on known allies (10 Oct 2026, owner-approved — interface only)
- **A soul's face** (`src/ui/soulFace.js`, used through `src/ui/cards.js` `setCardFace`): every Possession
  card the player sees shows its OWNER's possessed portrait (`card.owner` -> the roster guest ->
  `assets/portraits/<id>-possessed.jpg`) inside the card's own brass mirror, behind the card's purple smoke,
  with a thin crimson line inside the brass. Drawn once per guest on a canvas (the card face with the mirror
  opened by a per-pixel pass, the portrait under it) into one JPEG data URL, so every surface keeps a single
  `<img>`: the hand fan, the tiles (role and turn screens, the card pick, the Hand Mirror), the card view,
  the souls chip and the trade scenes (whose burning dissolve reads the same image). No new image file and
  nothing per frame. `main.js` draws the table's faces ahead at game set-up, one per tick; an image shown
  before its face was ready carries `data-soul` and is upgraded the moment it is. An unknown owner keeps the
  plain face. Chosen over a small medallion because the mirror is already the card's medallion and makes the
  face legible at the hand-fan size (~70 px wide). (Since 11 Oct: the player's own face first, the others'
  once the game has faded in, and the drawing canvas let go afterwards — see 'Quality round 3'.)
- **Trade scenes** (`src/ui/tradeReveal.js`): three new outcomes from `events.spent` — `soulSpent`,
  `alreadyPossessed`, `soulsCrossed` — and `possessed` redrawn: a soul that is used up burns out in CRIMSON
  (the same dissolve as the Lantern burn with a rose-to-crimson rim, crimson sparks and a smoke puff instead
  of ash); possessed raises two souls with your own face where the card that possessed you burned. Each
  caption is one short line. Cues reuse existing names (`possessOther` for "they are possessed too"); no new
  sound. Previews: `previewTradeReveal('soulSpent' | 'alreadyPossessed' | 'soulsCrossed' | 'blockedPossessed')`
  (the old `possessedThree` and `swapPossession` samples no longer match a rule and are gone).
- **Red eyes on known allies** (`src/ui/allies.js` `redEyedAllies`): while the player is possessed, the guests
  `knownPossessed` (src/game/knowledge.js) lists — and nothing else — wear red eyes on their screen: the 3D
  guest (the render loop's `setPossessed`), the guest strip (`hud.js`), the attack result's portraits
  (`meeting.js`) and the trade scenes. Never in practice, never for a clean viewer. A guest the scene on
  screen is about to show to be possessed is held back (`holdAlly`) until it shows it, so the strip or the
  hotel behind the scene never tells first (`runTrade` now refreshes the HUD after the scene opens). Views
  are reset per game (castCharacters, hud.rebuild; the memo is keyed on the viewer's record). The player's
  own red eyes are unchanged.
- **Tested** by `tests/trade-reveal-check.mjs`: seven real trades through the interface (conversion,
  blocked, swap, possessedThem, soulSpent, alreadyPossessed, soulsCrossed): faces on the cards (pick screen,
  scene, role screen chip, hand fan), the hands afterwards, and the red eyes absent before, absent as the
  scene starts, present after (strip and the 3D guest), and never for a clean player.

## Quick chat and emotes (Oct 2026, owner-approved idea A — a social layer, no rule)
(On 12 Oct 2026 the nine lines became twenty in two tabs, with lines that name a guest, and the bots
began to talk about who is who and to listen: see "Quick chat: twenty lines; bots that talk and listen"
below. What follows still holds for the small talk, the pacing, the bubbles and the end screen.)
- **What**: in a match, a Chat button beside the Menu button opens a small panel: nine preset lines and six
  emotes (brass line drawings, no emoji), all in `src/data/chat.js`. One tap sends and closes it; a 3 s
  cooldown. A message shows as a speech bubble over the speaker's guest (3.5 s, through the shared tag layer,
  so it stays under the interface and drops out where it would clash — the feed's lines count as interface
  too, since chat made the feed busier: no bubble or other tag shows through a feed line) and as a feed line ("Henry: Good
  evening!", "You wave."), with a soft `click` for other guests' messages. Never in practice, never over a
  private screen, a meeting or the map (on other guests' turns and while watching after death it works). The
  end screen gets a one-tap "Good game!" and shows what is said there. Settings > Quick chat: Off removes all
  of it, the bots' chat included.
- **Not a rule**: nothing in `src/game/` knows about chat (tests/chat-check.mjs checks it). A message is
  `{ seat, id, at }` and nothing else; it travels through `src/social/chat.js` (`say` for the player, `post`
  for others). Online, `say` would go to the server and its relay would come back through `post`; the server
  would check the id and the cooldown again.
- **Bots** (`src/bots/chatter.js`): a separate, pure module (not part of `createBotTable`), asked four times a
  second by `main.js`. Each bot reads only `botView` with its inbox cursor past the end — so the public events,
  where everyone is and its own hand, never its private events — and the chat it heard. Moments and chances
  are data (`BOT_CHAT`): a greeting at the start, "Thank you." after its own trade (whatever changed hands),
  "Watch out!" / a gasp when attacked, "Sorry!" now and then after attacking, "Good game!" at the end,
  answers to the player's greeting / apology / "Good game!", and at its turn's start near someone "Shall we
  trade?", "Trust me." or "I have a Lantern.". Possessed and clean bots say the same things, as often (so no
  line is a tell); "I have a Lantern." is now and then a bluff, so it is a claim, not proof; bots never offer
  a Lantern ("Need a Lantern?" would mostly come from a possessed bot). Bold guests talk more, careful ones
  less; one line per bot per 20 s at most and one for the table per 4.5 s (1.3 s at the end); a line waits
  while a screen covers the game (a brief one, like walking in on someone, is dropped). Own random numbers
  (one per bot from the match seed, plus one for who answers first), so the game plays the same with or
  without chat (bots-check's determinism unchanged; chat-check compares matches event for event).
- **Tested**: `node tests/chat-check.mjs` — honesty (what a bot says is identical when everything it could
  not know is scrambled, and when its own role and inbox are scrambled too), pacing, sense ("Thank you."
  only after its own trade, "Watch out!" only after it was attacked), answers, the channel, the game
  untouched.

## Choose your guest; your record (Oct 2026, owner-approved ideas B and F — interface only, no rule)
(The "Your guest" picker and `?guest=` were replaced on 12 Oct 2026 by your profile and avatar: see
"Profiles: a username first, then a table of players" below. Your record is unchanged.)
- **Your guest** (`src/ui/guestPicker.js`): a row on the Play with bots screen — Random and the six guests,
  each by portrait (`makePortrait`, the same images as the strip) and name — remembered as the `guest`
  setting (a roster id, default `random`). `planGame` (main.js) leaves the chosen guest out of the shuffle
  and seats them at your random seat, so the bots get the others; with Random the deal is exactly as
  before (same random numbers, so seeded tests are unchanged). Practice uses the same choice (Random: any
  of the six). Direct links take `&guest=clara` (a name or id, or `random`); without it they behave as
  before (practice is Victor), so the test suites' direct links are unchanged. The lift
  (`lobbyScene.enter({ prefer })`) boards your guest when they are one of the three seated guests who can
  board (Victor, Clara, Henry); the other three have no boarding path, so then the lift is as before.
  Boarding alone (practice), Clara goes round the sofa's right end (`soloBoardingPaths`), since Victor
  stays seated in her way.
  The tiles are built once and only re-marked on a pick, so the portraits never reload.
- **Your record** (`src/record.js`): played / won / lost (your side's result, alive or not), the same split
  by the side you ended on, your own escapes, and practice escapes apart — in localStorage, every read
  and write guarded like settings.js. It counts on top of what is saved (another tab may have counted),
  except once a write has failed (storage that reads but refuses writes): then the count in memory is
  newer and is kept for the visit. `main.js countRecord` counts once per game (`gameToken`), when the end
  screen shows — the end screen can show twice for one game (e.g. the role screen's Continue after Skip to
  the end), and Play again / Restart practice deal a new token. A match left early never reaches the end
  screen; `backToMenu` counts it as `left` instead (shown as "Left early", never a win or a loss: the
  owner's choice, 11 Oct 2026, so quitting after dying neither hides a loss nor counts one). Words in
  `src/data/record.js`.
- **On screen** (`src/ui/record.js`): a fourth, smaller main-menu button opens the record screen in the
  Settings panel style (big brass numerals, the win rate on a rule, quiet rows); Reset swaps the button row
  for a confirm step, and every step resets the menu's tap guard so a double tap cannot confirm it. The end
  screen gets one quiet italic line under the result (a match: wins and losses; practice: practice
  escapes). Only the player's own results — nothing about another guest.

## Tips during your first matches (Oct 2026, owner-approved idea E, "can be toggled off" — interface only, no rule)
- **What**: a small Art Deco card (`src/ui/tips.js`; the words and timing in `src/data/tips.js`) the first
  time something comes up — your first turn (actions, glowing doors, tapping rooms), the Move bar,
  searching, a new card, Lanterns and the Fire Exit, the turn clock, a meeting (Trade or Attack; a Lantern
  handed over blocks a Possession card), starting possessed and being possessed mid-match (your souls
  carry your face, you can never escape, how you win), the Switchboard, the Infirmary, a full hand, the
  final round, the map, quick chat, being out. Each once per device (`hotelEscape.tips.v1`, guarded like
  settings.js), in matches and in practice (practice has its own Lantern and Switchboard tips, so seeing
  those in practice never hides the match's, which carry the clean-guest escape and what the call reveals).
  Settings > Tips (On / Off) and **Show tips again** (forgets the ones seen and turns tips on).
- **Never in the way** (designed for the online game): the card sits beside what it explains — placed
  against the boxes of every showing part of the interface (strip, panel, hand cards, buttons, Move bar,
  magnifier, toast, chat panel), and off the "Go" / "Explore" tags and the player's own guest when that
  costs little nearness (else its arrow could point at the wrong thing). With no clear place it waits.
  Only the card takes taps (it is also in main.js's tap dead zone, so a near miss of Got it opens no
  door). One at a time from a queue; each hides itself after 9 s; a tip about a passing moment (the Move
  bar, the magnifier, a meeting) is dropped when the moment passes and may take over from one that has
  been up 4 s. **The clock never stops for a tip**: a player's own tips must not hold up an online table.
  None shows over a private screen, the trade scene, the card view, a notice or question, the map, the
  chat panel, the black between screens or the "turn sideways" card; one cut off by them within 2 s comes
  back later — unless the screen is the one it explains (the map, the chat panel, the card view: the
  player did what it said). The map and quick-chat tips wait for the player's own first turn. The meeting tip is the one shown beside an open meeting panel (never over its buttons).
- **Privacy**: main.js hands the tips only the player's own situation (their turn, room, own hand and
  role, where their own guest stands) and what the whole table sees (round, rooms found, a meeting they
  are in, when another guest last spoke) — never another guest's role, hand or private result, so no tip
  can hint at one. A clean player can never be shown a possessed tip.
- **Tests**: every existing browser check starts with tips Off (`tests/smoke-lib.mjs` `tipsOff`, an init
  script that writes `tips: 'off'` into the saved settings before each page loads unless the settings
  already say; also in browser-practice, browser-lobby and qa-lib). `node tests/tips-check.mjs` turns
  them on and checks placement, that nothing is blocked (End turn under the finger, a tap beside the card
  opens a door, the clock runs on), once per device, Hide tips, Show tips again, practice, at any size.
- **Settings screen**: eight rows now, so on short screens the gaps between rows tighten a little more
  (buttons keep their size): it fits 1024 x 768 (46..743) and 1024 x 690.

## Quality round 3 (11 Oct 2026 — interface, tests and docs only; no rule or rule number changed)
- **Double taps never reach the hotel**: the second tap of a double tap on a quick-chat line or emote, or on
  a tip's Got it / Hide tips, used to land on the hotel (the panel or card had gone) and open a door for an
  action. Both now swallow a hotel tap for a moment after (`chat.swallowTap`, `tips.swallowTap`, checked
  first in `onTap`). A double tap on the Chat button leaves the panel open (`tooSoon`).
- **Good game! during the chat pause**: tapped within 3 s of the player's last line, it rests with the Chat
  button's brass line and is said when the pause ends (the cooldown is kept, as a server would keep it).
  The end screen's chat is two rows: the button alone, then the lines (their row's height kept from the
  start), so neither the button nor Main menu / Play again moves when lines arrive.
- **Tips**: a spot from which the arrow cannot reach what the tip explains is used only when no other spot
  can (no more arrows pointing past the panel after a "Go" tag slid under the card); "Tips are off" keeps
  the card's edge (and arrow) where it was; the tag boxes come from the tag layer's own list
  (`screenTags.list()`), the interface is measured once per look (and each element's style read once), a
  tip with no clear place looks again after 1 s, and the card moves by `translate` (no layout while it
  glides). Tip buttons, chat lines and Good game! are 44 px tall; Settings keeps 44 px buttons on a short
  screen (the spacing gives).
- **Wording**: a clean guest who unmasks someone (Lantern block, Hand Mirror) reads "Now you know", not
  "Only you know" — with soul cards others may know too. The role screen after a conversion names the one
  guest who knows ("Only Clara, whose soul possessed you, knows."), matching the red eyes the player sees.
- **Your record** reads a damaged save safely: every count is held to 1,000,000 and played = won + lost.
- **Soul faces**: the player's own is drawn first, behind the black screen (waited for at most 0.8 s); the
  others' after the fade-in, a quarter of a second apart; the drawing canvas and the source pictures are let
  go 5 s after the last face. The trade's card pick shows your souls as one tile with ×N, like the hand.
- **Move bar**: Move and Cancel are one group, so they never part (beside a short sentence, or together on
  the next line).
- **Chat history** (`chat.recent`) starts empty in each game.
- **Test hooks (owner's decision pending)**: `window.__game` is set on every page load, so anyone can read
  every hidden role and hand from the browser's console (only against bots: the whole game is on the one
  device). Options for the owner: leave it until online play (where the server sends each device only its
  own view — the code is already shaped for that), or create it only with a test flag in the address.
- **Balance tool**: `tools/balance/personality-study.mjs`'s 'return to giver' and 'one generation'
  proposals now model soul cards (the newly possessed guest's own souls are taken away; the giver gets a
  new soul of their own back); 'spent on conversion' is now the rule itself, so it changes nothing.

## Profiles: a username first, then a table of players (12 Oct 2026, owner's request — interface only, no rule)
- **The profile lives on the device for now** (`src/account/account.js`, localStorage key
  `hotelEscape.profile.v1`): `{ version: 1, id: 'local-<16 hex>', username, avatar, inventory: [],
  createdAt, updatedAt, nameChangedAt }`. The interface is asynchronous from day one (`ready`, `profile`
  (a frozen copy, or null), `persistent`, `signUp`, `rename`, `setAvatar`, `owns`, `onChange`), so a server
  account (Sign in with Apple / Google) can replace the store later with the same calls; callers never
  touch storage, and they wait for `account.ready` before they first read `account.profile` (main.js shows
  the first menu screen, and plans a direct link's game, only then). Every read and write is guarded like `src/record.js`: blocked or full storage keeps the
  profile in memory for the visit (`persistent` false; the register says "This device isn't keeping your
  name"). A damaged save is repaired (a valid name kept, bad avatar slots back to the look's own); without a
  valid name the register asks again. `id` is random so a server can claim it; `updatedAt` lets a later
  merge keep the newer copy. `owns(itemId)` is true for the free items only: nothing can be unlocked yet,
  and once it can, a server must check it (the device's inventory is editable).
- **Usernames** (`src/account/username.js`, pure, so a server can run the same checks): 3–16 of A–Z a–z
  0–9 _, starting with a letter; case kept for show, ignored when compared. Reserved: the hotel's own
  words (you, guest, admin, possessed, clean …), every card and room name from the data (run together and
  with _: "FireExit", "Fire_Exit"), and every word of the rules' public log ("searched", "traded", "the" …),
  so no name can change how a log line reads; `tests/profile-check.mjs` plays bot matches and checks that
  every log word is reserved. A light filter (`src/data/names.js`, base64 so the words are not in plain
  text): leetspeak read as letters, stretched letters caught, long words anywhere, short ones only as a
  whole part (split on _, digits and capitals), so "class" and "Sussex" pass. A real check belongs to a
  server. Suggest a name: adjective_noun from hotel words, always valid.
- **First run**: "Sign the register" (`src/ui/register.js`, `#menu-signup`), anchored to the TOP of the
  screen so the field and buttons stay above the iPad's keyboard (measured: Continue ends at 254 px; the
  keyboard starts about 370 px down at 1024×768). The field's text is 22 px (16 px or more: Safari does not
  zoom). Checked on Continue / Enter, then live after a refusal; a typed space becomes _. The same screen
  in rename mode is Change name (from the avatar screen). The panel snaps between the top (register) and
  the middle (other screens), never sliding across. Then the main menu: the profile card
  (`src/ui/profileCard.js`: "Playing as <name> · Adjust avatar ›", opens the avatar screen), Play with
  bots, Practice alone, and Settings and Your record side by side. `menu.show()` sends anyone without a
  profile to the register; `onScreenChange(name, prev)` tells main.js of every screen change.
- **The table** (`src/table.js`): every seat is `{ id: 'p1'…'pN' (by seat), name: username, color:
  SEAT_COLORS[seat], avatar }` (plus the matching `outfit` while views still read one), and
  `state.players[i].avatar` is passed through by the rules (display only, never read by a rule or a bot).
  Seat colours go by seat, as every player at an online table would see them. Bots' usernames never equal
  yours (`rollProfiles(n, rng, { avoid })`, case ignored, the same number of random draws). Bots' avatars
  come from `randomAvatar` (seeded by the bot's username: its own random numbers, never the match's), free
  items only, never two in one look nor in yours. **Seeded tables keep their seats**: planGame still draws
  the 5 random numbers that shuffled the six named guests, so a `?seed=` gives the same seat, bots and
  possessed seat as before (profile-check compares them). The six named guests stay only in the menu's
  lobby; `roster` remains as the Node tests' and tools' fixture. Practice seats you as your profile.
- **Where names show**: the strip (one line, the username, "…" past 74 px), the player panel (capped at
  200 px), End turn ("nightowl's turn", the name capped at 150 px before "’s turn"), the matchmaking list
  (every seat by username, yours marked "You"), the end screen (usernames, yours marked "You"), the feed
  and the meeting panel. The old strip "handle" line and "Your guest" picker are gone.
- **The feed reads lines with names put aside** (`feedLine` in `src/ui/feed.js`): the hotel's room and card
  names are held whole, every guest's name (longest first, whole words only) is masked, the line is
  classified and "You"/"you" substituted on the masked text, then the names go back. Before, a guest
  called "Kitchen" turned "nora searched Kitchen." into "nora searched you."; a guest called "Linen" now
  never matches inside "Linen Store".
- **Names are text, never markup**: meeting.js escapes every name (and the plain texts main.js hands it)
  where it builds HTML. Safe today thanks to the name rules, but required once names come from other
  devices (and a server must check names again: never trust the client).
- **Direct links** (`?mode=`) never show the register: they play as the saved profile, or 'Guest' (reserved,
  so nobody else can be called that); `?user=name` (checked, never saved) names you for the visit. The old
  `?guest=` is ignored. The test launchers (`tests/smoke-lib.mjs`, `tests/qa-lib.mjs`, and
  browser-lobby's own context) seed a profile 'tester' before each page load unless a test asks for none
  (`launch({ profile: false })`, as `tests/browser-profile.mjs` does).
- **An old player's first avatar**: a saved "Your guest" (`settings.guest`, no longer a default) seeds it
  (Clara: her look in her colours); 'random' or nothing rolls one from the new name.
- **Safari may erase a site's storage** after 7 days without a visit (home-screen apps are exempt), and
  Safari and the home-screen app keep separate storage: the player may be asked for a name again (the
  record and settings share this today). `navigator.storage.persist()` is asked once after sign-up (best
  effort), only where the browser decides quietly (not Firefox, which asks the player in a pop-up); the
  real fix is the server account.

## Avatars: the wardrobe, runtime portraits, bots' looks (12 Oct 2026, owner's request — interface only, no rule)

- **An avatar is ids only** (`src/data/wardrobe.js`): `{ v: 1, base, skin, hair, eyes, glasses, frame, main,
  accent, metal }`, each a catalogue key; an item's global id is `slot.key` ('glasses.monocle'), the id an
  inventory and later a store's products use. Never raw colours: the catalogue can be retuned and a server
  can check ownership. `normaliseAvatar` makes any saved or received avatar safe (unknown, damaged or
  not-owned values fall back to the look's own). Six items are locked "Coming soon" (Platinum hair, Monocle,
  Gold frames, Champagne and Gatsby gold outfits, Rose gold jewellery); nothing can be owned yet, and a
  server must grant paid items later (the device's list is never trusted).
- **Six looks, recoloured at run time, no new model files.** Each look is one of the six guest models
  (`src/render/avatar.js`): parsed once per look (shared geometry), cloned per guest with its own matte
  materials painted by material name. The models' baked shading is neutral grey on every clothing part,
  so one colour value reads the same on every look; seams, lapels and the sash follow the main colour,
  darker. All parts of a clone share ONE skeleton (SkeletonUtils gives each part its own: 9-15 bone
  textures per guest, updated every frame and, before this, never freed).
- **Eye colours use the possessed eyes' own shader** (`possessedEyeMaterial` with other colours and no
  glow): no new shader. The possessed switch is rebuilt whenever the eye material changes, so un-possessing
  always gives the avatar's own eyes back. No red, amber, violet or pink irises, ever: red means possessed.
- **Glasses are made in code** (`src/render/avatarGlasses.js`), fitted per look from the model's own
  measurements (eye ovals, brows, face front, head width, ears) and fixed to the head bone: one extra draw
  call, follows the walk, no rebuild of the approved .glb files. Henry keeps his own frames for "Round".
- **Portraits are drawn with the game's own renderer** (`src/render/avatarPortrait.js`), never a second
  WebGL context: an off-screen half-float target, a small tone-map pass matching the screen's, an
  asynchronous read-back, the plate laid under it in plain JS (no canvas read-back), a JPEG object URL kept
  by `avatarKey` + look (up to 80). One portrait per frame; the player's own are prewarmed in the menu, a
  table's during matchmaking and behind the black screen, possessed ones when needed (soul faces, allies).
  Until one is ready the look's shipped picture shows and is swapped in place (`src/ui/portrait.js`; src/ui
  keeps no three.js import: main.js hands the service in). In the shipped colours they match the committed
  pictures to a mean error of about 1-1.7 levels of 255 (tests/avatar-check.mjs). The 'screen' path
  (draw into a corner of the game canvas) was rejected: the menu's Still background skips redraws.
- **The shader warm-up wears the extra eyes and glasses only while it starts the compile**
  (`src/render/avatar.js withAllShaders`): three.js picks and starts every shader inside `compile` and then
  only waits, so they come off before the wait. Before (integration, 12 Oct), a new player signing up
  after the lobby had loaded got a profile-card portrait with glasses they never chose (the portrait drawn
  while the warm-up waited, on the same shared model), and the lobby could show red eyes for a moment.
  A new player's portraits are warmed up at sign-up too (`main.js warmPortraits`).
- **Soul faces are kept by the look, not the seat** (`src/ui/soulFace.js setSoulPortraits`): seat ids are
  p1..pN at every table, so 'p3' must never show the last table's face.
- **Character views from avatars** (`src/main.js castCharacters`): one view per seat; a view whose look
  returns at the next table is reused with its new seat colour, the others are disposed. Measured over
  four tables: the same draw calls as before avatars (~126-206 at the role screen), textures level, the
  hotel's own room pieces the only geometry that grows (as before).
- **The wardrobe previews on your avatar in the lobby**: it stands by the lift (layout `player`), boards
  first (practice alone; a match with Victor and Clara; replaces `prefer`), and is the game's own avatar
  model (iris eyes and glasses included), not the lobby's merged one-draw-call figure (~10-15 draw calls,
  menu only). The wardrobe camera keeps a fixed vertical field of view and is shifted sideways with a view
  offset so the avatar stands in the middle of the space right of the panel at every screen shape. The
  avatar stands a step right of the reception desk's rounded end and back toward the wall (2.3, -4.55), and
  the camera looks from 2.4 m in front and 0.3 m to its left: the desk ends left of a ballgown's skirt and
  Henry in his armchair stays out of the picture (QA 12 Oct: from straight in front of the old spot the desk
  covered the right arm; from the right, Henry filled the foreground). The manager waits at the windows
  while it is open; the lobby is sharp (not blurred) and at the game's resolution, and stays so through
  Change name (the register comes and goes without the camera flying out).
- **Bots' looks** (`src/data/randomAvatar.js`): seeded from the username (its own random numbers, never the
  match's), free items only; never a look already at the table (yours included) while one is free — the
  look then comes from a second stream of the same name, so only the look moves and the colours stay that
  bot's own.

## Quick chat: twenty lines; bots that talk and listen (12 Oct 2026, owner's request — a social layer, no rule)
- **Lines** (`src/data/chat.js`): twenty in two tabs of ten (the panel remembers the last tab on the device,
  `hotelEscape.chatTab.v1`, guarded). **Table**: the nine from before less "Trust me.", plus "Who has a
  Lantern?" and "Meet me at the Fire Exit.". **Suspicion**: the owner's five ("I am clean.", "I am
  possessed.", "<name> tried to possess me!", "I trust <name>.", "I don't trust <name>."), "Trust me.",
  "Ring the Switchboard!", "<name> is possessed!", "<name> is clean.", "Stay away from <name>!". The six
  emotes are unchanged. The six extra lines and the tab names are the design's proposal (owner questions).
- **A line that names a guest**: `{ seat, id, about, at }` (`about`: their seat). `cleanMessage`
  (`src/social/chat.js`) refuses a missing, own-seat or out-of-range `about`, drops it from other lines and
  drops anything else; the channel knows the table's size (`seats()`). A server would relay exactly this.
- **The panel** (`src/ui/chat.js`, styles at the end of styles.css): 320 x 381 px at every iPad size
  (measured at 1024x768, 1180x820, 1366x1024: every button 44 px or more, nothing clipped, 105 px above the
  Map row at 1024x768). A line about a guest shows a dotted "WHO" blank and a chevron; tapping it turns the
  panel to **Choose a guest** at the same height (Back 44 x 44, the line, a 3-column grid of 92 px tiles:
  portrait as in the guest strip, red eyes there only where the strip shows them, and the username), the
  other guests still in the hotel in seat order. The double-tap guard (`tooSoon`) covers the step change and
  Back, so a double tap on a line never picks the guest under the finger. Closing (outside, Escape) goes
  back to the lines. With nobody left to name, those lines are disabled.
- **How it reads**: `chatWords(id, { you, about, aboutYou, nameOf })` gives the words in pieces, the guest
  named in bright brass. A line naming you reads as said to you ("You tried to possess me!", "I trust
  you."; "Stay away from" keeps your name) in a bubble with a doubled bright-brass edge — never crimson,
  which is only ever your own possessed look. Feed: "nora: I don't trust felix." (`feed.chat` takes the
  pieces); a line naming you gets the feed's `me` style, "You" underlined; the end screen's row the same.
  Names are `state.players[seat].name` (usernames).
- **Bots talk** (`src/bots/chatter.js`, rewritten): it now reads the bot's OWN private results (its trades,
  a Lantern block it made or suffered, its Hand Mirror) and its own mind (`botTable.catchUp`, at the start
  of its turn, after a block, when an ally is named), and every line said. A clean bot accuses only from its
  own eyes ("<name> tried to possess me!" after its Lantern burned that soul; "<name> is possessed!" after
  its Hand Mirror showed one): always true. A possessed bot counter-accuses the guest who burned its soul,
  and at most once a match falsely accuses a guest right after a trade with them (most of all one who named
  an ally), with the same timing as a true accusation. Named, a bot answers "I am clean." / "I don't trust
  <you>." with the same chances whatever its role; nobody else takes sides (see 'Quality round 4').
  Lines have priorities (an accusation is never lost behind a "Thank you."); caps a match: 3 accusations,
  2 strong denials, one opinion per guest, one false accusation. "I am possessed." is never said in play;
  a possessed bot may say it as its last word when its side won. The unused `deduced` moment of the
  prototype was dropped (a known-possessed guest already shows in "Stay away", four times as likely), and
  the answer to "Who has a Lantern?" is data (`answerLantern`).
- **Bots listen** (`src/bots/brain.js` onChat / hearsay; `src/bots/index.js` hear): every line reaches every
  bot (`main.js` hands each channel message to `bots.hear` and `chatter.hear`), read in its place among the
  events. A clean bot believes a speaker as far as its own evidence about them allows (never from what was
  said about them), counts each speaker's line once, and splits the blame when two guests accuse each other;
  an impossible claim (no trade between them, no Hand Mirror on that guest) or a lie about itself counts
  against the speaker; hearsay moves an estimate by at most +0.5 / -0.25 (`BOT_HEAR`), in full for avoiding,
  meeting, Fire Exit trades and pooling, at 0.75 for an attack, and not at all for a Lantern block (so talk
  never makes a guest a Lantern magnet; it was 0.75 until QA round 4 measured that it did). A possessed bot holds back a soul from a guest the talk suggests is
  possessed too. A line is weighed by the listener's role when it was said, so when the chatter catches a
  mind up never changes a choice.
- **Talk alone never changes the game**; listening does. With Quick chat Off the table is silent and the
  bots neither talk nor listen (today's balance). Measured (`tools/balance/bot-match.mjs`, seed 1):
  3,000 matches per size, the clean side wins 45.2 / 38.7 / 31.0% at 6 / 5 / 4
  players with no chat, exactly the same with talk only (1,000 per size: every figure equal), and 48.5 /
  41.1 / 33.0% with talk and listen. Conversions 2.36 -> 2.18 a match at 6 players; Lantern blocks 1.60 ->
  1.68; clean-on-clean attacks 0.35 either way; 0 refused actions and 0 unfinished matches in every run.
  Clean bots' accusations are 100% true; possessed bots' 16% (6p), 11% (5p), 5% (4p): by accident.
  About 31 / 24 / 18 lines a match on a 5.9 / 5.2 / 4.3 minute clock (small talk is never weighed, so it can
  be trimmed freely). (Superseded by 'Quality round 4' below: the exploit the next lines measured is gone,
  and the figures with listening are 45.2 / 38.7 / 33.5%.) Exploit tests (6 players, 1,500 matches, one
  clean seat speaks at round 2): its escape chance was 10.7% after "Good evening!", 12.5% after "I am
  possessed." (the bots handed a suspect a Lantern to block, and a clean guest keeps it), 14.1% after a
  false "<name> tried to possess me!" about a trade partner.
- **Tests**: tests/chat-check.mjs (rewritten: lines, channel, honesty with chat — the watched bot's lines
  and choices identical in a scrambled world, its own role forced possessed in half the runs; named
  answers the same for both roles; talk without listening = no chat, event for event; determinism; sense,
  caps, pacing; the player's lines), tests/bots-check.mjs (brain.js may import data/chat.js; the scrambled
  world hears the same lines), tests/browser-bots.mjs (the privacy scan skips what is said; 3b: tabs,
  Choose a guest, Back, the double-tap guard, feed, bubbles, the end row).

## Quality round 4 (12 Oct 2026 — bots' chat, profiles, the wardrobe, portraits; no rule or rule number changed)
- **The bots' chat gives no role away** (`src/bots/chatter.js`, `src/data/chat.js`; measured with all-bot
  matches on a clock, 500 per size at 6 and 4 players, before → after):
  - *No third guest takes sides.* Only a possessed bot ever defended a guest just named ("I trust <them>." /
    "I don't trust <the accuser>.", the `allyNamed` moment), so such a line was 99% possessed and so was the
    guest it defended. Removed: only the guest named answers, the same way whatever its role (the design's
    "a denial is never a tell"). A third-party line within 8 s of a naming line: 0.33 → 0.01 a match.
  - *A lie comes when the truth would.* The false "<name> tried to possess me!" was said at the start of the
    possessed bot's own turn, rounds after the trade (100% possessed when not right after their trade). Now
    it comes right after a trade in which it handed over no soul, with the timing, priority and staleness of
    a clean bot's true accusation after its Lantern burned a soul; the counter-accusation and the Hand Mirror
    lie use the same timing too (the counter's quicker delay made the possessed one accuse first 72% of
    the time: now 43-53%).
  - *A line about its own turn is said in that turn.* Turn-start lines (nearby, suspects, vouches, gather,
    checkCount, askLantern) waiting out the table's gap spilled into the next guest's turn, mostly from
    possessed bots that end their turn at once with a soul in hand (91-95% possessed). They are dropped once
    the turn is over: 357 → 0 such lines in 500 matches.
  - *"I trust <name>." and "Who has a Lantern?" as often from either side.* A possessed bot vouches for an
    ally or a guest it is winning over with gifts, at 0.15 of the chance (per 1,000 turns, clean / possessed:
    5.4 / 31.5 → 4.0 / 3.8 at 6 players); it asks for a Lantern on the same condition as a clean guest
    (short of Lanterns, little left to find): 3.0 / 8.8 → 2.2 / 2.2. Possessed share of own-turn "I trust
    <name>." 76% → 36-50% (base about 40%).
  - *No contradictions:* never "I trust <name>." after accusing them, nor (possessed) about a guest who
    knows what it is (24 in 500 matches → 0). A bot that said "Good evening!" answers a greeting with a
    wave or a smile (31% of the answers were a second "Good evening!" → 0).
  - *Small talk is answered whoever says it* (a person or a bot alike), so at an online table an answer
    never shows which seats are people: at most 2 answers to greetings in any 20 s from the whole table,
    each bot once to a guest; at most 2 answers to one "Good game!" and 5 last words in all. Start of a
    match: 4.6 → 5.0 lines in the first minute (6 players); end: about 3.4 "Good game!" lines instead of 2.
  - Left as they are: "Meet me at the Fire Exit." comes from different plans on the two sides (a little more
    often clean at 6 players, possessed at 4); "I don't trust <name>." at the start of a turn is mostly a
    clean bot's (its suspicions; a possessed bot doubts only guests who know it).
- **Talk never makes a Lantern magnet** (`BOT_HEAR.blockShare` 0, `allyHint.liarAboutMe` 0.6 → 0.2): a clean
  bot's choice to hand a Lantern to block no longer counts what was said. Before, a clean player lying in
  chat was handed more Lanterns (bot-match `--inject`, 6 players, the same matches: a false "tried to possess
  me!" about a trade partner 1.31 Lanterns / 13.9% escape against 1.05 / 10.7% for "Good evening!"); now
  1.01 / 8.9% against 1.03 / 10.4%, "I am possessed." 0.91 / 10.6% against 0.92 / 9.8% (4 players likewise).
  The clean side with talk and listen (1,000 matches): 45.2 / 38.7 / 33.5% at 6 / 5 / 4 players, the same
  as with chat off at 6 and 5 (45.2 / 38.7 / 31.0%, 3,000 matches, above) and a little above it at 4; it
  was 48.5 / 41.1 / 33.0% while what was said moved Lantern blocks. 0 refused actions, 0 unfinished matches.
- **tests/chat-check.mjs** checks all of it: every line says which moment it came from (`moment`, `free`;
  the channel drops both), so the bot's own gap is checked per line; never more lines in 30 s than the gap
  allows; a 200-match section for the tells above; the same 180 matches played three times (one clean seat
  says "Good evening!", "I am possessed." or an impossible accusation) for the Lantern magnet; the honesty
  section over 128 matches (110 lines about a guest).
- **Profiles** (`src/account/`, `src/data/wardrobe.js`): a look id is an own key of BASES only (a saved or
  received 'constructor' or '__proto__' crashed the page at start, on every reload); a store that throws
  when read gives no profile instead of a crash; a saved name no longer allowed (a word reserved since)
  keeps the id, avatar and dates for the new name the register asks for ("Your name can no longer be
  used"); a profile saved by a newer version is read but never written over (`readOnly`: "please reload");
  names that read like a role ("possess" anywhere, "clean" as a whole part) are refused like reserved ones;
  real names the filter caught (Nazir, Shital, Pornchai, Scunthorpe…) pass (`FILTER_ALLOW`); one note at
  most under the register about what the device keeps; a failed save says so; `?user=` names you for the
  direct link's own game only; a profile cleared by another tab sends the menu to the register.
- **The wardrobe**: one-finger drags scroll its list anywhere in it (`data-scrolls`; two-finger moves are
  still cancelled); the panel is anchored to the top, so a row that comes or goes moves only the rows below
  it; the Look row says "Loading…" while a new look downloads, and a look that cannot be shown says so; a
  look that arrives mid-boarding takes the old one's place and walks on; no guest in your own look boards
  beside you (a Tuxedo player boards with Clara and Henry).
- **Portraits**: drawn only once the menu's lobby is up and the player's shaders are built (a model
  download and a shader build no longer come before the lobby); the shaders are built for the off-screen
  targets the portraits are drawn into (three.js picks the variant by the target bound); every seat's two
  portraits are drawn during matchmaking and the lift; soul faces are encoded with `toBlob`; the buffers are
  let go 5 s after the last draw; a shown portrait counts as used (the player's own possessed one is not
  the first let go); a failed one is tried again after 30 s. The profile card shows the last portrait drawn
  of that avatar (kept on the device, `hotelEscape.cardPortrait.v1`) or a plain plate, never another look's
  face; a picture that fails to load shows that plate too. A guest whose model cannot be downloaded is the
  box figure (tried once more after 4 s). Devices without float buffers draw into an sRGB 8-bit buffer (no
  banding in dark cloth); three.js still warns once about EXT_color_buffer_float there (its own float bone
  textures, not the portraits).
- **Not a leak** (checked): renderer.info geometries rising over the first matches of a visit (329 → 613 in
  5, the same pattern before this round) is the room tiles' models being drawn for the first time as new
  random hotels show new tiles (24 tiles, 476 geometries in all, loaded once a page and kept): bounded by
  the tile set, not a per-match leak.

## Reliability: a frame that goes wrong, start-up messages (14 Oct 2026 — interface and tests only; no rule or rule number changed)

From the read-only audit of 13 Oct (code-2, graphics-12, design-10, compat-2, -3, -4, graphics-2); the
skeptic's corrections were applied (no timer that "unsticks" meetings, no card for a benign rejection).

- **A frame can no longer freeze the picture** (`src/ui/crash.js`, `src/main.js`). three.js asks for the next
  frame BEFORE it runs the callback, so one `throw` in the per-frame code meant every later line of every
  frame was skipped (the 3D picture stopped, the buttons kept working, nothing said why). `main.js`'s loop is
  now `frameLoop` / `placeTags` / `lobbyFrame`, and each part of a frame runs through `crash.step(name, fn)`:
  clock, walk, queued tap, bots, camera, rooms, doorways, path, fog, mood, cutaway, guests (red eyes),
  **render**, hand, search icon, feed, chat, tips, sound, and each kind of tag (the frame's tags are always
  closed with `screenTags.end()`). A step that throws is skipped for that frame; the picture is drawn anyway.
  The whole callback is a step too ('frame'), the last guard. `window.__game.crash` exposes the net (tests).
- **When the "Something went wrong" card shows** (Back to menu, Reload, the version and the last message in
  small print for a screenshot): only after REPEATED failure. One step failing 45 frames in a row for at least
  3 s; the picture (`render`) 10 frames and 1 s; the same uncaught page error 8 times within 5 s. Never for a
  one-off, a step that fails every other frame, a rejected promise (benign ones happen on iPad Safari: audio
  resume, image decode; they are only written down), or the browser's own ResizeObserver / "Script error."
  notices. Shown once; Back to menu resets the counts. While it is up the turn clock and the computer guests
  wait (`overlays.errorOpen`). The last 10 messages are kept in memory (a ring; the same message from the same
  step counts up); a message is one line, 160 characters at most, with the file and line of the first `src/`
  frame: property names and files, never a value, so nothing of another guest's role or hand can be in it.
  Console output is limited to one line per failing step every 2 s (the probe had 85 errors a second).
- **Not done, on purpose**: a fixed-time watchdog that clears `meetingLive` (the skeptic: the flag stays true
  across a person's private card choice, which may legitimately take minutes; clearing it would let the clock
  and the bots run during a meeting). The trade scene's own `requestAnimationFrame` loops (`tradeReveal.js`)
  are not part of the frame and are not wrapped; an error there is only written down by the page listener.
- **Graphics context lost and back** (`src/render/avatarPortrait.js`; three.js already restores the scene by
  itself): the portrait renderer now counts losses (`epoch`), ends a wait for a read-back at once on a loss
  (a cut-off read-back may never settle, and the portraits behind it would wait for ever), and a draw cut off
  or started inside a loss goes back to the FRONT of its queue instead of being marked failed (a failure shows
  the stock picture for 30 s). On `webglcontextrestored` the off-screen buffers are made again (they were
  made in the old context) and the queue runs on. `main.js` writes "lost" and "came back" into the ring.
- **Start-up** (`index.html`, a classic script in plain old JavaScript, before the game's module):
  1. no import maps (iPadOS below 16.4) shows "Hotel Escape needs iPadOS 16.4 or newer." (changed after review:
     `HTMLScriptElement.supports('importmap')` is only a HINT now, see 'Review fixes' below: the game is always
     tried and the card shows only when it then fails to load);
  2. no 20 s "check the internet" timer any more. A loading screen (`#boot`, away for the first 0.9 s so a quick
     load shows nothing) and the menu's "Opening the hotel…" show the real count of files and MB from the
     browser's own resource timings (`PerformanceObserver`, counted when a file FINISHES). The only complaint is
     a file that really fails: the game's `import()` rejects, or `main.js` throws while starting;
  3. a failed load reloads ONCE by itself (a Safari that has old and new files mixed after a publish usually
     recovers on a reload), marked in `sessionStorage` (`hotelEscape.reloadedOnce`, cleared as soon as the game
     has loaded; if the marker cannot be written and read back there is no automatic reload, so a loop is
     impossible), then
     "The game could not load. Try again." with a **Reload** button and the technical text in small print.
     No WebGL says so ("This browser cannot show 3D graphics, which Hotel Escape needs.") and does not reload.
     Reload is plain HTML (`onclick="location.reload()"`), so it works even when the scripts never ran;
  4. the card is one element (`#error-overlay`), shared with `overlays.showError` (a problem during play, lazy
     loads); `showError(message, { title, detail, menu })`.
  The cache window itself (about 10 minutes on GitHub Pages) is NOT fixed: that needs version stamps in the
  file names, i.e. a build step (CLAUDE.md: none for now). Only a real iPad can say whether a reload revalidates
  every file in Safari; the audit asked for a check after the next publish (open the game, publish, reload).
- **"Turn sideways"** is now only for a window taller than wide (`orientation: portrait`); a wide but small
  one (Split View, Page Zoom at 125 % and more on a 10-inch iPad, a phone held sideways) says "Make this window
  wider, or reduce page zoom." Pure CSS, one rule (`styles.css`, `.rotate-tall` / `.rotate-wide`); the card still
  covers the game in both, and the clock still waits (`main.js` `sideways` is the same media query).
- **Tests**: `tests/crash-check.mjs` (node, the net with a fake clock and window, plus a source check that the
  frame goes through it), `tests/browser-reliability.mjs` (the scenarios above in Chromium: no import maps,
  a blocked file, a file missing once, sessionStorage blocked, no WebGL, a 24 s file with no alarm, a failing
  step, a failing picture, repeated page errors, the context lost, the sideways / wider messages, the Version
  line); `browser-practice.mjs`'s 860×700 case now expects the wider message.

## Publishing safety net (14 Oct 2026 — a net, not a change of workflow)

The owner keeps committing straight to `main`, and GitHub Pages publishes `main` as it is (the preview
is the development build; CLAUDE.md fixes "no build step for now"). Audit code-3 and its skeptic: process
hardening, smallest first. Nothing here blocks a publish.

- **A version to name** (`src/version.js`: `VERSION`, `VERSION_DATE`, set by whoever publishes, together with
  a git tag `v0.N`): a quiet "Version v0.5 · 14 Oct 2026" line at the bottom of Settings (not on the main menu:
  that would be a design choice for the owner) and in the small print of the problem card. A hash cannot be
  injected on a branch deploy with no build, so it is a constant that is edited at each publish.
- **A way back** (README > Publishing and rolling back): restoring the tag's tree as ONE new commit
  (`git restore --source=v0.N --staged --worktree -- .`, commit, normal push) puts the live game back exactly
  as it was at that version without rewriting history. `git revert v0.N..main` does NOT work here: `main`
  holds "Merge main (published)" merge commits (the commands were tried in a scratch repository with merges,
  added, changed and deleted files; undoing only the last publish is `git revert -m 1 <its merge>`).
- **The flaky timing check** (`tests/logic-check.mjs`): "the slowest walkable-grid rebuild under 150 ms" failed
  from garbage-collection pauses and busy machines (40-157 ms measured with the typical rebuild at 12 ms).
  Now the MEDIAN of the 400 rebuilds must be under 150 ms (over 10 times the usual: a real slowdown moves the
  median) and the slowest under 1.5 s.
- **A warning, not a gate** (`.github/workflows/tests.yml`): on every push and pull request, Node 22, one job
  per suite (rules-check, logic-check, bots-check, chat-check, profile-check, crash-check; `fail-fast: false`
  so each reports). These import only `src/`, with no three.js, so there is no `npm ci` and nothing is cached;
  proven by running the same steps in a clean `git archive` copy with no `node_modules`. A red cross appears
  on the commit; Pages does not wait for it. The browser suites (Chromium, 5-15 minutes) stay manual.
  Not done (the owner's call, when outside players exist): Pages deploying FROM the workflow (Settings →
  Pages → Source: GitHub Actions) so a red run really blocks a publish; a Mac or PC is not needed for it.


## Round 1 build fixes: accidental taps, flicker and Reduce Motion, the 1024×694 screens, button sounds, the Revolver (14 Oct 2026 — interface, tests and one bug fix; no rule or rule number changed)

From the 13 Oct audit, items F5 and G1–G4 of the owner-approved list.

- **Giving a card is two steps** (design-2), like the discard screen: a tap lifts the card (`.selected`) and
  says its name and what it does in the line under the row (the same `cardDesc` words as the hand sheet; two
  lines of room are kept, so choosing never moves a button); another card switches the choice; the gold button
  beneath names it ("Give the Lantern"; for the possessed guest's souls, which are one stack with a ×N badge,
  "Give your soul") and gives it. Until a card is lifted it reads "Tap a card to give" and is grey. Tapping the
  chosen card again keeps it chosen (unlike the discard screen's toggle: the second tap of a double tap must not
  un-choose it). The Give button is under the tap guard against the moment of the LAST lift, so the second tap of
  a double tap cannot give; the cards are still guarded for the screen's first 300 ms. A Cancel (a caller that
  passes `onCancel`) stays beside it, plain, and keeps working. The same `privatePick` serves a meeting trade, a
  Fire Exit trade and the souls. Not changed, on the skeptic's advice: the weapon picker and Accept / Decline
  stay one tap. `tests/smoke-lib.mjs` has `giveCard(page, tile)` for every test that gives a card.
- **End turn asks only when actions are left** (design-3): "You still have 3 actions. End turn?" (the real
  number, "action" for 1), as the same light bar as Move (`#confirm-bar`, `hud.askEndTurn`; buttons End turn /
  Keep playing; `hud.confirmKind` says which question is up). Under the tap guard: its answers ignore a tap
  within 300 ms of the bar opening, so a double tap on End turn only asks. Never at 0 actions (the bar also goes
  if the last action is spent behind it), never when the clock runs out (`onTimeUp` calls `endTurnNow` itself),
  never for a computer guest (its turn ends in `passTurn`). `window.__game.endTurn()` (the tests' hook) is the
  answered form; `tests/smoke-lib.mjs` `endTurn(page)` taps the button and answers. The Move tip is for the Move
  bar only (`moveBar: hud.confirmKind === 'move'`). Opening a closed door still asks nothing (a stray door costs
  one action): a deliberate difference from Move, told to the owner.
- **Leave and Restart put the safe answer in gold** (`overlays.ask(..., { safe: 'no' })`): "Keep playing" is the
  primary button and Main menu / Restart plain, for "Leave the match?", "Leave practice?" and "Restart practice?".
  The "You are out" question (nothing is lost) keeps its gold Skip to the result.
- **The two flickering corridors** (compat-8): `FLICKER` in `src/data/hotel.js` is now 5 steps a second, between
  0.5 and 1.0 of the light (was 10 a second, 0.3–1.0). The maths moved to the pure `src/render/flicker.js`, so
  `tests/flicker-check.mjs` can run the game's own function for 60 bulbs × 10 minutes and count: never more than
  3 flashes a second of the whole room (a flash: a pair of opposite changes of 10 % of the light; the old setting
  shows 5, kept as a control so the check can fail). With Reduce Motion (`src/motion.js`, a live
  `prefers-reduced-motion` query) the level is held at the middle of the range (0.75) at every moment.
- **Reduce Motion elsewhere** (one block at the end of `styles.css`): the cards dealt into the hand (in place at
  once), the search icon's pulse, the waiting dots (three still dots), the menu pages and the waiting seats, the
  found card, the card view, toasts and the Move bar sliding in, the menu's blur-and-zoom and slide-out. Only
  motion: every word and picture is still there. The lobby behind the menu is held Still (`settings.get
  ('menuMotion')` answers 'off' while Reduce Motion is on; the Settings row then shows Still, which is true).
  Not touched: the camera and walking (that is the game), and the lift's short ride into a match. The trade and
  attack scenes and the tips had their own rule already.
- **1024×694** (design-4, graphics-9): at heights up to 770 px the found-card picture shrinks with the height
  (`(92vh − 350px) / 1.5` wide), the card's padding and the bar's margin are tighter, so the note ("You now hold
  2 Lanterns.") ends above Add to my hand with nothing to scroll; taller windows keep the big card. The map's
  canvas may now shrink (`min-height: 0`: it used to keep the size it was last drawn at and push the legend out
  of the panel) and the legend sits in tighter rows up to 770 px. Measured at 1024×694, 1024×768, 1180×820 and
  1366×1024 (`tests/browser-build-fixes.mjs`, section c).
- **Button sounds** (sound-5, sound-6): which cue a button makes is the pure `src/audio/buttonCues.js`. The old
  prefix match (`btn-hand`) had caught Continue (`btn-handoff-next`) and the hand's arrows, which played the long
  'open' drawer; openers are now named exactly, and a closer is a word of the id (back, cancel, close, done).
  Two siblings that had been missed now open like their neighbours: the Record page (`btn-menu-record`) and the
  profile card (`btn-profile`). `tests/audio-buttons-check.mjs` lists every button of `index.html` (and the ones
  the code makes with an id) with its cue and fails on an unlisted button, so the next one cannot slip; it also
  checks every cue the code asks for has a sound file. Choosing a card (give, discard, weapon) makes the existing
  'select' sound: `cardTile` plays it after the screen's own handler, and a handler that ignored the tap
  (too soon, or the card already chosen) returns `false`, which keeps it silent.
- **A Revolver that comes back through the reshuffle** (gameplay-8, point 3): confirmed. A fired-out Revolver
  went to the discard pile with `shots: 0`; when the deck ran out and the pile was shuffled in, the same card came
  back with 0 shots and fired once more to −1 (a Revolver thrown away at the hand limit with one shot left came
  back with one). `drawCard` now runs every card of the shuffled pile through `renewCard` (`src/game/cards.js`):
  full ammunition again, from the card data (`rules.cards.revolver.shots`). It restores what
  `docs/GAME_RULES.md` says (two shots, discarded when empty, the pile shuffled into a new deck): a bug fix, not
  a rule change. `tests/rules-check.mjs` has the case (it fails without the fix).

## Round 1 review fixes (14 Oct 2026 — interface, tests and docs only; no rule or rule number changed)

An independent review of the three builds above found these; each was reproduced before it was fixed.

- **The import-map check is a hint, not a gate** (`index.html`). The first build refused to load the game at
  all when `HTMLScriptElement.supports('importmap')` was false or missing. Nothing here can show what Safari 16.4+
  answers, and a wrong "no" would have locked the owner's working iPad out. Now the answer is only stored
  (`boot.noMaps`); the game is always tried; "Hotel Escape needs iPadOS 16.4 or newer." (with a Reload button
  after all, and the technical text in small print) shows only when the game then FAILS to load and the answer was
  "no". A browser that answers wrongly still starts. `tests/browser-reliability.mjs` has both cases (the wrong
  answer: the game starts; the import map taken out of the page: the card).
- **No automatic reload while offline** (`index.html failed()`): `navigator.onLine === false` goes straight to
  "The game could not load. Try again." with Reload. A reload cannot help offline, and the browser's own error
  page replaced the game (in a Home Screen app there is no toolbar to get out).
- **A load that stalls gets a way out** (`#boot-reload`): the loading screen shows a plain-HTML Reload button
  once the file and MB count has not changed for 30 s. No message, no marker, no automatic action (a stalled
  connection never rejects, so nothing else would ever say so).
- **Graphics lost and never back** (`src/main.js`, `crash.stuck`): a lost context that has not come back after 5
  s of the page being in view (time with the page hidden does not count: a loss in the background is normal and
  Safari restores it on return) raises the "Something went wrong" card (Reload; Back to menu), as any freeze does.
  If it comes back after all, the card goes by itself.
- **Held sideways in Split View** (`index.html` sets `html.device-landscape`; `styles.css`): a window taller than
  wide on a device that is held sideways says "Make this window wider", not "Please turn your iPad sideways". The
  device counts as sideways only when `screen.orientation` says landscape AND Safari's older
  `window.orientation` (where there is one) agrees: two answers that disagree are not trusted, so an iPad held
  upright is never told to make the window wider. Chromium cannot show what Safari reports: the test gives the
  page iPad-like answers. A computer (no `window.orientation`, a landscape screen) asks a tall window to be wider.
- **A Revolver's words say its own shots** (`cardDesc(type, card)` in `src/ui/cards.js`): a Revolver with one
  shot left said "Two shots, then it is gone." on the pick screen, the hand's card view and the large card. The
  words now say "One shot left, then it is gone." (display only; `rules.js` is untouched).
- **Settings under Reduce Motion**: Animated is dimmed and cannot be tapped, and the label says "Reduce Motion is
  on" on the same line (the screen stays as tall). Before, a tap was stored and the row snapped back to Still with
  no explanation.
- **A reshuffled Revolver is as good as new, even a half-used one.** `renewCard` tops every Revolver of the
  reshuffled pile up to two shots, including one thrown away at the hand limit with one shot left (it used to
  come back with one). This is the audit's own fix (gameplay-8, point 3: "reset a Revolver's shots when it goes to
  the discard pile"; the discard pile is only ever read by the reshuffle), and GAME_RULES.md says only "2 shots,
  then discarded" and "the discard pile is shuffled into a new deck": told to the owner in the report, who may
  prefer that only a spent one is renewed.
- **Left as the owner's call**: "Back to menu" on the "Something went wrong" card counts an unfinished match as
  "Left early" in the record (`backToMenu` counts any Main-menu exit before the end; the owner defined "left early"
  as exactly that). Skipping the count for a crash exit is one flag (`backToMenu({ crashed: true })`).
- **Tests and CI**: `tests/audio-buttons-check.mjs` also checks that `src/audio/index.js` imports and uses
  `buttonCues.js` (it imported the matcher directly, so it would have passed with the old matcher back in
  index.js); `audio-buttons-check` and `flicker-check` run in the GitHub Action beside the other fast suites;
  `tests/tips-check.mjs` waits for the Move bar's tip to finish gliding clear of the bar before it measures
  (the tip is placed against the bar while it slides in and moves at the next tick, which on a loaded machine is
  later than the fixed 600 ms the test waited); the README's rollback section says how to bring the rolled-back
  work back (`git revert` the rollback commit: a merge of the old branch says "Already up to date").

## Round 2, polish: small text, guests easier to tell apart, keyboard focus and tall pop-ups, the app icon, a match the browser cut short (14 Oct 2026 — interface, tests and docs only; no rule or rule number changed)

From the 13 Oct audit, items G5, G7, G12, G13 and G14 of the owner-approved list.

- **Small text (G5; design-5, compat-10).** The floor for visible text is now 11 px, and 12-13 px for what a player
  reads or acts on mid-turn. Changed in place in `styles.css` (about 30 labels, only the key ones): the turn flags
  above the strip 9 -> 11 px; the strip's room and hearts 11.5 / 11 -> 12; Safe zone 11 -> 12; Health / Actions 11
  -> 12 (the label column 52 -> 58 px); the CLEAN / POSSESSED pill 10.5 -> 12 and "Only you can see this" 10.5 -> 12
  (12.5 in the role card's head); "My cards" 12 -> 13; the Revolver / souls badge on the fan 10.5 -> 12; the search
  icon's caption 11.5 -> 12.5; the card view's "Private" 11 -> 12; the chat panel's tabs 11 -> 12.5, its heading
  10 -> 11, the "WHO" blank in a line 10 -> 12; the Tip label 10 -> 11; Your record's captions 11 -> 12; "Playing
  as" 10.5 -> 12; the version line and the problem card's small print 11.5 -> 12; the attack scene's "Empty" tag 11
  -> 12; and the wardrobe's "Coming soon" 9.5 -> 11 px and brightened (the old brass-dim was 3.85:1 on the panel,
  now about 8:1). What is left under 12 px is four labels, all at 11 and all secondary (the turn flags, "Coming
  soon", the Lanterns chip's word, the Tip label). The HUD is tight at 1024 wide, so every block was measured at 1024x768 and
  1024x694 before and after: no block overlaps another, no key label is cut off, the chat panel, the map's legend
  and the Settings / Record / wardrobe panels still fit (`tests/browser-polish.mjs`, section text). Not done, on
  purpose: a "Text size" setting (a held recommendation, the owner's call) and the role paragraph's size (the learn
  agent's).
- **Guests easier to tell apart (G7; graphics-8, compat-9).** (1) The other guests' floor rings are at 0.6 (was
  0.35: `config.character.ringInactiveOpacity`) and every ring has a thin dark edge (a second, wider ring just
  under it, one extra small mesh per guest; `src/render/characterView.js`), so a colour reads on the red rugs and
  the cream floor alike. (2) Each guest's initial sits in their dot on the plan (the dots are bigger, radius 10; the
  guest whose turn it is has a brass halo and a heading pointer) and in the corner of their portrait in the strip
  (CSS `::before` on `data-mark`, so it survives the portrait being swapped for red eyes). The mark is
  `guestMarks` in `src/table.js`: the first letter; two letters each when two names start alike ("Mi", "Mo"); the
  seat numbers if even those match. Names are public, so it shows nothing private. (3) The lime seat colour
  merged with gold and orange for red-green colour blindness (CIELAB distance 5; under about 12 is hard to tell
  apart), and cyan with lavender (8.6). `SEAT_COLORS` is now `#e6bc5c #73d4e6 #2f8cff #e673ac #e6652e #b6b2ff`
  (gold, sky, blue, pink, vermillion, lilac): the lime became a blue, and the other five moved a little (about 8 or
  less in CIELAB: gold a touch lighter, orange redder, lilac a touch bluer) because replacing the lime alone could
  not lift cyan / lilac above 8.6. Found by searching candidate sets with the Machado simulations of protanopia,
  deuteranopia and tritanopia; every pair is now at least 17.5 apart under all four ways of seeing (32 normal, 24
  protanopia, 17.5 deuteranopia, 23 tritanopia). Every place that draws a seat colour takes it from the seat: the
  ring, the strip's underline and corner mark, the plan's dot, the chat bubble's dot, the feed, the end screen, the
  matchmaking list; the lobby roster in `src/data/characters.js` and the legend's swatch in `styles.css` were
  updated to match. `tests/polish-check.mjs` runs the simulation (the old set is the control that fails). A
  floor ring still has no letter (the name tags show names when zoomed out): the strip and plan carry the marks.
  Not done: a different ring SHAPE per seat (the audit's other suggestion): the owner's look-and-feel choice.
- **Keyboard focus and tall pop-ups (G12; compat-5, compat-6).** `src/ui/focus.js` is a watcher over the screens
  that cover the game: the private screens (one overlay: the secret role, the turn's start, the trade pick and its
  result, a note, the Hand Mirror, a search's find), the discard, meeting, question, notice, end and problem
  screens, the card view and the map. While one is open (its overlay has no `hidden`) focus moves to its main button
  (the pick and the discard: the first card, because Give / Discard wait for a choice), Tab and Shift+Tab stay inside
  (so Tab can no longer reach Main menu or the game under the secret role card; the old behaviour is reproduced by
  `tests/browser-polish.mjs --control`), the dialog is `role="dialog"` (the existing `alertdialog` stays) with
  `aria-modal="true"` and a name (its title), Escape does not skip a private screen (it takes the plain way out only
  on a question, "Keep playing", and on the card view and the map, which the player opened) and focus goes back to
  where it was. It needs no change inside those screens (it watches the `hidden` attribute and re-places focus
  when a screen draws its next step in place), it is one call in `src/main.js`, and `watchDialog(doc, spec)` is the
  reusable part: the in-match Menu panel and How to play already keep their own focus (`gameMenu.js`, `howToPlay.js`),
  and could be a list entry. `inert` on the game behind (the audit's suggestion) was not needed: Tab is held in the
  dialog and `aria-modal` hides the rest from a screen reader; Safari 15.5+ would take it if that proves not
  enough. A card you can choose (the pick, the discard, a weapon) is now a keyboard button too (`tabindex`,
  `role="button"`, `aria-pressed`, Enter / Space): without that the trap would have held a keyboard player in a
  screen with nothing to choose. Touch scrolling: `data-scrolls` on the four containers (the discard and the
  meeting `.modal`, the hand-over card, the card view's text column), which `src/input.js`'s touchmove rule already
  lets through, plus `overscroll-behavior: contain`; checked with real touch events through the DevTools protocol
  (the wardrobe's list scrolls 185 px with the same swipe, the control; each pop-up scrolls with the attribute and
  not without). The discard draws more than 8 cards smaller (84 px, six to a row: `#discard-cards.dense`), so 11
  cards fit at 1024x694 with Done on the screen (it was 710 px tall in a 650 px box).
- **Home Screen (G13; design-12, graphics-10, code-12, compat-12).** An icon the owner may change: a brass lantern
  on navy in a thin Art Deco ring, drawn as SVG from the look of the Lantern card (`assets/icons/icon.svg`,
  1024 x 1024; a simpler `favicon.svg` for the tab), rasterised with headless Chromium to `icon-180` (the
  apple-touch-icon), `icon-192`, `icon-512`, a maskable 512 and the 32 / 16 px favicons (`assets/icons/README.md`).
  `manifest.webmanifest`: name and short name "Hotel Escape", `start_url` and `scope` `./`, `display: standalone`,
  `orientation: landscape`, theme and background `#0f1119` (the page's own background; the head's `theme-color` was
  `#141318` and is now the same), icons by relative path. **standalone, not fullscreen**: nothing here shows what
  iPadOS does with `fullscreen` (no device), `apple-mobile-web-app-capable` in the head already makes iOS run the
  saved page without Safari's bars, and `standalone` is the value every platform treats the same. The head gained
  `link rel=icon` (SVG, 32, 16), `apple-touch-icon`, `manifest`, `apple-mobile-web-app-title` and
  `mobile-web-app-capable`; every path is relative (the site is at a sub-path), checked by loading the game from
  `/Gaming-App/`. No service worker: nothing is cached for offline, which `docs/ONLINE_PLAN.md`'s caution about
  offline tricks asked for. **A Home Screen copy has its own storage**: an empty profile and record (the register
  again), separate from Safari's; said in the README. The picture is a proposal: the audit left it to the owner.
- **A match the browser cut short (G14; compat-1, step 1 only).** `src/matchMarker.js` writes
  `hotelEscape.matchInProgress.v1` in localStorage (the skeptic's advice: sessionStorage is less sure to survive a
  Safari kill) holding only the time, when a real match begins (`begin()`, `src/main.js`: not practice, not a
  direct link) and removes it when the end screen shows and in `backToMenu` (Menu > Leave > Main menu, the end
  screen's Main menu and the problem card's Back to menu all go through it). At the next start of the main menu, if
  it is still there and is less than 6 hours old, the game counts one "Left early" (`record.countLeft`), clears the
  marker and shows the notice card once: "Welcome back. The game was restarted by your browser. Your last match was
  not finished and is counted as left early." (`src/data/lostMatch.js`; the notice card now sits above the menu: z-index 45). An older, damaged
  or future-dated marker is ignored and removed. A direct link (`?mode=`) and practice never read or write it, so
  the test suites are not affected. A match left on purpose is counted at once by `backToMenu` and the marker is
  cleared first, so nothing is counted twice. No Resume: it would be thrown away by online play (the server will hold
  the match), and it waits for the owner to say how often a real iPad cuts a match short. Known limits: two tabs
  of the game (the second one sees the first one's marker and says so); a tab closed on purpose in the middle of a
  match reads the same and is counted as left early, which the skeptic found right.
- **Tests.** New `tests/polish-check.mjs` (node, ~1 s, also in the GitHub Action: the seat colours under the three
  colour-blindness simulations with the old set as the control, the marks, the marker's every case, the ring's
  numbers) and `tests/browser-polish.mjs` (head / reload / focus / scroll / text / seats; `--control` runs the focus
  section against a focus.js that does nothing, and it fails as the audit described). Run with these changes
  in place and passing: rules-check, logic-check, bots-check, chat-check, profile-check, crash-check,
  audio-buttons-check, flicker-check, howto-check; and in a browser browser-build-fixes, browser-lobby (the extra ring
  mesh per guest is one more draw call each: 62 in the lobby view, budget 120), tips-check, trade-reveal-check,
  browser-profile, browser-reliability, avatar-check, browser-practice, audio-check. `browser-bots` passed all of
  its checks except one timing-sensitive check per run (the chat bubble "You tried to possess me!" in one run; "a bot
  attacks you: the result says hit you" in two others, where the bot that met the player traded instead of
  attacking: the scripted attack depends on the order the computer guests act in, and `src/bots/` was being
  changed by another task at the time). What those two checks read (a bubble's text, the attack panel's text) is not changed by this round.
- **Only a real iPad can say**: how the larger labels sit at the real size and in sunlight (the HUD was measured in
  Chromium at the true window sizes, but Safari's text metrics differ a little); whether Safari's focus ring and
  an iPad's keyboard behave like Chromium's (Tab order, Enter on a card, Escape); whether VoiceOver announces the
  dialogs and card buttons well; real finger scrolling of a tall pop-up; the icon on the Home Screen at its true
  size and rounding, whether `standalone` opens full screen as hoped, and what the Home Screen copy's empty profile
  feels like; and whether Safari ever discards the tab mid-match (the note is how the owner will know).

## Round 2, learn: How to play, the Menu panel, the Lanterns chip, Victory / Defeat, three tips (14 Oct 2026 — interface, tests and docs only; no rule or rule number changed)

From the 13 Oct audit (owner-approved list: F1 teach new players, G17 the Menu panel, G6 the Lanterns count and
the end screen, G11 tips). Every number a sentence shows is read from `src/data/rules.js`; `docs/GAME_RULES.md` is
untouched and no rule was added, removed or changed.

- **One word for the action budget** (`src/ui/actionsWord.js`): "1 action" / "3 actions", never "AP" or "action
  points", on the tags ("Explore · 1 action", "Go · 1 action"), the Move button and its path tag ("Move · 2
  actions"), the toasts ("No actions left.", "Not enough actions: ..."), the old hand-over line. The panel's label
  Actions and the tips already said it. Internal names (`actionPoints`, `actionCost`) and code comments are as they
  were. `tests/howto-check.mjs` scans every string literal of `src/` (comments left out) and `index.html` for "AP" and
  "action points", so the old word cannot come back unseen.
- **How to play** (`src/ui/howToPlay.js`, markup `#howto-overlay`, words `src/data/howToPlay.js`). Five pages from the
  lead's draft (the goal; your turn; meetings and trades; possession and Lanterns; staying alive), Back / Next /
  Close. All the wording is in the data file (the owner is reviewing it, so it changes in one place); each line is a
  function of the rules (`r => ...`, as the tips are), so 4 actions, 45 seconds, 3 Lanterns, 4 health, 6 cards, round
  8, the Knife's and Revolver's numbers, the Espresso's 2 extra actions and the Infirmary's numbers are never typed
  in. `tests/howto-check.mjs` draws the pages from a copy of the rules with every number changed and checks the new
  numbers appear and none of the old ones (and, when the costs of opening, moving, searching, using a card and a room's
  job stop being equal, the sentence "cost 1 action each" gives way to each cost on its own). One overlay serves both
  places it opens from (z-index 60: above the main menu's 40 and the Menu panel's 12), and gives the screen back on
  Close (focus too). It is only reading: it can only open from the main menu or from the Menu panel, which already
  holds the clock (below). Every page gets the height of the tallest, so Back and Next stay where the finger found
  them; if a very short window cannot fit a page the lines scroll inside the card (`data-scrolls`) and the buttons
  stay. Under the tap guard (`src/ui/tapGuard.js`): the second tap of a double tap on the button that opened it answers
  nothing, and a double tap on Next turns one page. Keyboard: focus moves in (to Next), Tab stays inside, the arrow
  keys turn pages, Escape closes, focus goes back. It restates the draft exactly; one thing is NOT in it that the
  owner may want: the Lantern gamble's other half ("a Lantern is lost if the other guest gives you an ordinary card")
  is said by the first-meeting tip, not on page 4.
- **The hint under "Practice alone"** (`NEW_PLAYER_HINT`, `src/ui/menu.js renderHint`): shown while the record
  (`src/record.js`) has no finished match and no finished practice. A match left early does NOT hide it (nothing
  was played to the end: that player still has not seen how a match goes). It goes for good at the first finished
  match or practice. The main menu's row is now How to play | Settings | Your record (three equal buttons, 17 px
  serif); the menu panel is 474 px tall at 1024x694 with the hint, centred (110-584 of 694).
- **The role screen** (`src/ui/handoff.js revealRole`): the headline is "You are clean" / "You are possessed" (the
  badge CLEAN GUEST / POSSESSED stays; the player's name is no longer the headline: it is on the panel and the
  strip), the paragraph is 16 px (was 13), and ONE line below it says how the OTHER side wins (the clean guest is told
  how the possessed win; the possessed guest, how the clean guests win, "3 Lanterns" from the rules). The change of
  role mid-match ("You have been possessed") keeps its own headline and gets the possessed line. A possessed guest's
  own way to win is still only in the tips ("you win at dawn, or when no clean guest is left"): the draft asked for
  the other side's line only. At 1024x694 the clean card is 436 px and the possessed card 462 px tall (of 694).
- **The Menu panel** (`src/ui/gameMenu.js`, markup `#gamemenu-overlay`, words `src/data/gameMenu.js`). The Menu button
  (`#btn-leave`) opens Resume (gold), Music and Sound effects (the same Off / Low / Medium / High, the same saved
  settings and the same `audio.applySettings()` as Settings), How to play, and Leave (it says "Leave practice" in
  practice). Leave closes the panel and opens the game's own question exactly as before ("Leave the match?" /
  "Leave practice?", Keep playing in gold, `#btn-ask-yes` / `#btn-ask-no`); Keep playing goes back to the game, not
  to the panel. On the end screen the button still goes straight to the main menu; while a screen of the game is up,
  or a meeting is live, it still does nothing. Focus moves to Resume, Tab stays inside, Escape resumes and
  gives the focus back to the Menu button; a tap on the dark round the card resumes too (as it closes the question).
  **What the turn clock does with the Menu, found out before it was touched and kept exactly.** Before this panel the
  Menu button opened "Leave the match?"; while any question is up `timerPaused()` is true (it includes the question), so
  the clock stood still (on the player's own turn and on a computer guest's turn alike: `tickTimer` returns before
  counting), `botTick` returned (the computer guests waited; a walk already under way finished), and the hand, the
  search icon and the Chat button stepped aside (`screenClear`), the tips waited (`covered`), the game's buttons were
  held (`uiBusy`). Keep playing, or a tap outside the card, gave the clock back with the time it had; Main menu
  counted the match as left early. The panel is the same: `main.js` asks `askUp()` (a question is up OR the panel
  is open) in exactly the five places it asked "is a question up?", so the clock stands still while the panel is
  open, while How to play is open from it, and while the question after Leave is open. Nothing in the panel starts,
  stops or changes the clock. Whether it SHOULD run while the Menu is open (an online table cannot hold one player's
  clock) is the owner's pending decision; if the owner decides it should run, it is one line (`askUp` /
  `timerPaused`). `tests/browser-learn.mjs` pins it: the clock does not move over 2.5 s with the panel open, nor
  with the question open, and runs after Keep playing / Resume.
- **The Lanterns chip** (`src/hud.js syncLanterns`, markup `#lantern-chip`): "✦ LANTERNS 1/3" in the player panel
  under Actions, your OWN count (Lanterns in your own hand) out of `rules.lanternsToEscape`, in practice and in a
  match, the same form and wording for a clean and a possessed guest (a possessed guest can hold Lanterns too, and
  nothing about the chip changes at 3/3: it says nothing of a side). It touches the page only when the count changes
  and runs every frame with the tell. It sits in the panel's own column (the panel grows about 28 px upward; the possessed
  panel, which also shows its souls, grows the same), so it crowds nothing: checked against the strip, the room name,
  the hand fan, the buttons and the toast at the four sizes. Not done: the audit also suggested the count on the
  match map (`src/map.js` draws it only in practice, with a comment that it was private on a shared screen): the
  brief asked for the chip only.
- **The end screen** (`src/overlays.js showEnd`, `src/main.js showEnd`, `src/ui/endRecap.js`, words
  `src/data/endScreen.js`): "Victory" or "Defeat" above the title, for the player's side whether or not they are alive
  or got out (a dead clean guest whose side got out sees Victory), gold or salmon like the title; the summary's second
  line now says who won ("The clean guests win. · Round 5 of 8"; the old "your side" phrase is what Victory / Defeat
  say now); and one recap line from the finished game's own record (`convertedBy`): "oakhart was possessed first and
  possessed ari_v, birch and moth." — "You were possessed first and possessed oakhart." — and for a chain "... 1 more
  was possessed after that." The recap is shown only now, when the roles list under it reveals every side anyway.
  Practice has no sides and keeps its own words (no verdict, no recap). At 1024x694 the card tightens a little
  (padding, title 34 px) so six guests, the recap and the Good game row fit.
- **Tips** (`src/data/tips.js`, `src/ui/tips.js`; the engine keeps its rules: once per device, never over a private
  screen, never stops the clock; it gained a note of the player's own room, to see an arrival, and the two camera
  flags below). The first-meeting tip now says both halves of the Lantern dilemma, in the same words for everyone: "A
  Lantern blocks a soul, but is lost if the other guest gives you an ordinary card." Three new tips, nothing else
  added: **Safe zone** (in a match, on the first WALK into one: a change of the player's own room to a safe room;
  the start in the Landing is not an arrival, so it does not crowd the first turn; not in practice, where it would
  be used up before the match it matters in; it sits below the room's badge), **Look around** (pinch and drag: on
  the player's own turn while they have not touched the camera in this game; lowest priority, after the others; sits
  above the camera buttons) and **The round buttons** (the first use of one of the three: what the arrows and the
  target do). A drag, a pinch, the wheel or any round button counts as touching the camera and marks "Look around"
  as seen for good (the player did what it says); a drag or a pinch does not bring the round-buttons tip (it is about
  the buttons). The tips are told three more plain flags (`safe`, `cameraTouched`, `cameraButton`): the player's
  own room, which the badge shows everyone, and their own use of the camera; never anything about another guest.
- **Tests**: new `tests/howto-check.mjs` (node, ~1 s: the pages follow the rules, the draft's sentences, the hint,
  the role lines, the tips' words, the recap for every way a match can end, no "AP") and `tests/browser-learn.mjs`
  (the menu and How to play at the four iPad sizes with the keyboard and the guard; a match at each size: role
  screen, chip, Menu panel, the clock, five ways to end; a possessed player; practice); `tests/tips-check.mjs` has a
  section for the three new tips and now taps Menu, then Leave, before the question; `audio-buttons-check`
  lists the six new buttons; `browser-practice`, `browser-lobby` expect "1 action"; `browser-bots` taps Menu, then
  Leave, where it expected the question.
- **Only a real iPad can say**: how the tap targets and the text sizes feel (the 16 px role paragraph, the How to
  play pages), whether Safari's focus ring or keyboard show up the way Chromium's do, how Back / Next feel with a
  finger, the sound rows' loudness change while a match plays, and whether the new camera tips read well beside the
  round buttons at the real size.

## Round 2, computer guests and sound: possessed guests that blend in, a Hand Mirror that shows no soul, downloads that retry (14 Oct 2026 — bot behaviour, one line of text and sound loading only; no rule or rule number changed)
Items F2, G8 and G9 of the owner-approved list from the audit of 13 Oct 2026. Nothing in `src/game/*` or
`src/data/rules.js` was touched; bot behaviour lives in `src/bots/*`.

- **The problem (F2).** A possessed computer guest opened 0.10 doors a turn in rounds 1-3 (a clean one 1.38), from
  round 4 stood still on 40% of its turns, often in the room beside the Fire Exit. Both the feed ("X opened a door")
  and the top strip (where every guest stands) are public, so a player who watched them could pick out the possessed
  guest: with no door opened after two rounds it was possessed 86-96% of the time, two turns running beside the Fire
  Exit 95-97%. Hiding the strip or the feed would take information from people too, so the bots changed instead.
- **What the bots do now** (`TUNING` and `Mind` in `src/bots/brain.js`; every number can be tried with
  `tools/balance/bot-match.mjs --tune` or `tools/balance/tells.mjs --tune`):
  - **Explore**: `possExplore` 0.4 -> 2.5 (a possessed guest opens doors at about 60% of a clean guest's rate in
    rounds 1-3, 0.76 against 1.25 a turn at six guests, instead of 7%). `hoard` 1.4 -> 1.0 (it searches like a clean
    guest). This is a blend-in, not a plan: the Fire Exit still helps only the clean side.
  - **Guard less, and not for long**: `campWeight` 1 -> 0.05 and the liking for the post fades turn after turn in
    the same room (`campFatigue`, from the guest's own record `mem.stay`). A guard is now rare and short. It was worth
    only about 3 points of balance.
  - **Wander**: a possessed guest with nothing pressing walks to a room it has not been in for a while (`roam`,
    `roamOptions`, from its own `mem.seen`) instead of standing still.
  - **Personality**: a new trait, `curiosity` (`src/bots/profiles.js`), 0.05-0.95, for clean and possessed guests
    alike, scales how keen a guest is to open doors (about 0.1 to 1.9 times usual: some guests are homebodies who open
    no door for a round or two, some are first through every door) and, the other way, how much of a homebody guards.
    It is worked out from the guest's name and its other traits, with no random draw of its own (a test counts: still 25
    draws a guest), so the guests rolled for a given seed are exactly the guests as before. Because a clean homebody
    now also opens no door early, "has not opened a door" is no longer a purely role-based sign.
  - **Winning back the balance** (more exploring helps the clean side find the Fire Exit sooner: at four guests it was
    found about 1.2 rounds earlier): `attemptBias` 0 -> 0.1 and a new `attemptSmall` 0.1 for each seat below six (fewer
    guests, fewer chances to try a soul). These are possessed-side bot knobs, not rules.
- **Measured** (all-bot matches with the game's own computer guests, `tools/balance/tells.mjs`, 4,000 matches a size;
  "possessed" includes guests converted by then; 6 / 5 / 4 guests; before -> after):

  | what a person could watch for | before | after |
  |---|---|---|
  | (a) no door opened by the end of round 2, possessed | 86 / 92 / 96% | 47 / 56 / 59% |
  | (a) no door opened by the end of round 3 | 94 / 98 / 99% | 61 / 69 / 72% |
  | (a) the one guest who opened the fewest doors by round 3 is the original possessed one (a guess at random: 17 / 20 / 25%) | 70 / 80 / 89% | 21 / 27 / 36% |
  | (b) same ordinary room at the end of 3 turns in a row, round 3 on | 97 / 97 / 96% (10,623 times at 6) | 41 / 42 / 35% (383 times) |
  | (b) a turn with no action at all, round 3 on | 94 / 96 / 97% | 17 / 18 / 18% (so now it points at a CLEAN guest) |
  | (c) beside the Fire Exit at the end of 2 turns in a row | 97 / 96 / 95% (17,325 times at 6) | 53 / 47 / 33% (543 times) |
  | (c) beside the Fire Exit at the end of any turn, round 4 on | 85 / 83 / 78% | 57 / 54 / 43% |
  | (c) inside the Fire Exit, round 4 on, is possessed | 0.3 / 0.1 / 0.0% | 6 / 7 / 6% |
  | doors a turn in rounds 1-3, possessed / clean (6 guests) | 0.10 / 1.38 | 0.76 / 1.25 |
  | clean side wins, 6 / 5 / 4 guests (seed 3, 4,000 matches; seed 11, 4,000; `bot-match` seed 9, 2,000) | 46.8 / 40.0 / 31.5; 47.2 / 39.8 / 30.7; 46.0 / 40.0 / 31.1% | 47.3 / 38.3 / 33.1; 47.2 / 40.4 / 31.4; 48.6 / 38.9 / 31.8% |
  | possession attempts / successes a match (6 guests) | 5.5 / 2.4 | 6.2 / 2.6 |
  | match length, median rounds / turns (6 guests) | 7 / 39 | 6 / 34 |

  Every signal is now at or under about 70% (the target was 65-70%), and the one-guess tests near the chance of
  picking a guest at random. The balance did not move: averaged over the three runs the clean side wins 46.7 -> 47.7%
  at six guests, 39.9 -> 39.2% at five, 31.1 -> 32.1% at four (one run is good for about 1 point either way; the
  largest single difference was 2.6 points). (The 50 / 42 / 34 in "Measured balance" above was measured before the
  soul cards; the bots measured 47 / 40 / 31 just before this change.) Refused actions 0 and unfinished matches 0 in
  every run. A bot turn takes about 0.7 s longer (4.0 actions instead of 3.5), but matches are shorter, so a whole
  match takes about as long.
- **What is still a sign.** A guest in the Fire Exit is clean about 94% of the time (clean guests wait there, a
  possessed one rarely does: it was 99.7%). The guest who has walked the most rooms by round 5 is the original
  possessed one 27 / 31 / 42% of the time (chance 17 / 20 / 25%): possessed guests wander. A guest who stands still is
  now more likely clean than possessed. None of these is a rule; each is one more knob if the owner wants it flatter.
- **Hand Mirror (G8).** A Hand Mirror showing "no Possession card" proves nothing: a possessed guest who has used or
  given away every soul shows none (3,000 six-guest matches: 32.5% of such looks were at a guest already possessed).
  The result screen (`privateHand` in `src/ui/handoff.js`, `MIRROR_NO_SOUL`) now says, whoever you are: "No Possession
  card. A possessed guest who has used all their souls shows none." (nothing is added when a soul is seen: the
  existing line names the guest). The computer guests agree: a guest cleared only by a mirror is "likely clean"
  (`isLikelyClean`, estimate `mirrorSuspicion` 0.25, `mem.mirrorClear`) and no longer "certainly clean" (4%, still what
  the Switchboard's count gives). A claim that such a guest is possessed counts against the speaker half as much. The
  look still goes out of date when the guest trades again. A possessed bot's own look still clears nobody.
- **Chat kept in step.** The bots' lines are unchanged; two things moved with the bots' movement. The possessed
  "Meet me at the Fire Exit." was said only while standing beside the Fire Exit, which they now rarely do, so
  `tests/chat-check.mjs` (no role tells: the plans said at the start of a turn come about as often from either side)
  failed; it is now said by a possessed guest holding a soul within two doors of the Fire Exit (`nearExit`), which
  gives about the same number of lines a turn as before (10.7 clean / 9.4 possessed per 1000 turns, 13.0 / 8.1 before).
  The test also gained two honest exceptions it had needed all along: "I trust <name>." from a possessed guest may be
  for a guest it has made a friendly gift to (the bot's own rule), and "Stay away from <name>!" is only expected to
  raise the estimate when the bot does not already think the speaker all but certainly possessed.
- **Sound downloads (G9, `src/audio/index.js`).** A failed download is tried again after 3 s, then after 10 s
  (`RETRY_PAUSES`), only waiting, never a loop, never holding the game: the sound simply arrives when the file does
  (the night music fades in a few seconds late; an effect missed once is heard from the next time). A file that is
  really not there (404) is asked for once. A file that failed every try rests for a minute (`COOL_OFF_MS`) and is
  asked for afresh the next time something wants it; a scene's music that failed every try is asked for again by
  itself after the rest (twice at most). Three effects in a row failing every try stop the preload (the connection
  is down); the others are asked for when needed. Before, one failed request silenced a file until the page was
  reloaded.
- **Sound ahead of time (G9).** The night music's download (1.9 MB, bytes only, decoded when the game starts, so
  memory is as before) starts when "Find a table" is pressed (`startBots`) and, for practice, when the lift starts
  (`setScene('intro')`); the four end fanfares (win, winPossessed, lose, dawn: about 590 KB, the same for every
  guest, whichever side) are fetched from round 3 (`prefetchEnding`, `ENDING_FROM_ROUND` in `src/main.js`: a match
  runs six rounds at the median, so the first version, round 7, left most matches to fetch them at the end; it is
  bytes only, nothing decoded), and the final-round music is decoded ahead in round 7. The 2.5-second rule
  for a fanfare is unchanged. Before the first tap nothing new is fetched: only the menu's own music, as before.
- **Tests.** `tests/audio-load-check.mjs` (new, node, ~3 s, in the GitHub Action): with the network and the clock
  faked, the exact request order and spacing (3 s then 10 s, nothing before the first tap, the 404, the rest, the
  lift, the fanfares, the connection down). `tests/audio-check.mjs` gained a request log (before the first tap only
  `music-lobby.mp3`; `music-game.mp3` fetched while the table fills up, a few seconds after "Find a table" and before the
  lift (the test prints the actual gaps; they depend on the machine and are not asserted); the four fanfares from round 3,
  none before, none at the end) and a section where a real browser has the first
  request for the night music and for the rummage aborted. `tests/bots-check.mjs`: a possessed bot opens doors in
  rounds 1-2 at least a third as often as a clean one; of the guests with no door opened by the end of round 2 at most
  70% are possessed; the Hand Mirror cases (likely clean, Switchboard certain, out of date after a trade, a possessed
  bot's look clears nobody); the curiosity trait (spread, no extra draw). `tools/balance/tells.mjs` (new) is the
  measuring tool for the table above.
- **Only a real iPad can say**: whether a real Wi-Fi hiccup or Safari's own network handling behaves like the aborted
  request of the test (a request that stalls for a long time without failing is not retried: there is no timeout), how
  the extra 2.5 MB of downloads in matchmaking and from round 3 feels on a slow or metered connection, whether the music
  decoding the downloaded bytes at the start of a match is as quiet on the iPad as it was, and above all how the
  computer guests FEEL: whether a possessed guest that opens doors and wanders still plays plausibly and the match is
  as tense as before.

## Round 2, docs and tests: a DECISIONS file that says what is current, a README that works from a clean machine, tests for public events and Your record, unused files removed (14 Oct 2026 — documents, tests, tools and a clean-up; no rule or rule number changed)

Items F7 and G18 of the owner-approved list from the audit of 13 Oct 2026 (the audit's code-4, code-5, code-6,
code-8, code-10, graphics-13 and security-15), done last, after the other Round 2 builders, so the documents describe
the final state. Nothing in `docs/GAME_RULES.md` and no number in `src/data/rules.js` changed (two new constants in
it are the table sizes below, with the same values the code already used).

- **DECISIONS.md reads from the top (F7, code-4).** A "Read this first: what is current" block at the very top
  (the numbers and where they live, the architecture in one paragraph, how to test, which early sections are
  superseded and by what, which files the old text names that no longer exist). Every stale early section starts with
  a one-line **SUPERSEDED, see "…"** (or PARTLY SUPERSEDED, or HISTORY) pointing at the section that holds the current
  facts; the six wrong facts the audit listed are corrected in place and say so ("No addons are used" — there are
  `three/addons` imports; health 3 — 4; "2 AP for a new room" — open a door 1 and move 1; "Master Key, Lock Pick and
  Barricade have no effect" — they work; `floor.js`/`floor1.js` — `hotel.js`). **No section was moved, renamed or
  deleted**, so docs/PROGRESS.md's references by name still work (the skeptic's point: do not move sections to
  `docs/archive/`). The suggested CLAUDE.md line ("when a decision changes, edit its section the same day") was NOT
  added: CLAUDE.md is the owner's file; it is proposed in the report.
- **The documents are checked (`tests/docs-check.mjs`, node, ~0.1 s, also in the GitHub Action).** The numbers in the
  "Read this first" block must equal `rules.js` (so "health 3" cannot come back unseen); the README's project
  structure must name every file under `src/` (the audit found 14 missing); every path the block and the structure
  name must exist; the GitHub Action must run every fast suite; the README must name every suite in `tests/` and none
  that is gone; every preview server named is bound to `127.0.0.1`; `docs/VERSIONS.md` has a row for the version in
  `src/version.js`; every DECISIONS section named in PROGRESS.md or the README exists. Proven by planting "3 health" in
  the block, a README without `tapGuard.js` and a preview command without `--bind` in a scratch copy: each fails it. (It
  is a guard against the audit's finding, not a proof of the prose: a human still has to write the sentences.)
- **README (F7, code-5, security-15).** The preview command is `python3 -m http.server 8000 --bind 127.0.0.1` (the old
  one served the folder, `.git` included, to the whole Wi-Fi). A "Running the tests" section works from a clean copy:
  Node 20.19 or newer, `node tests/run-fast.mjs` for the fast suites, `npm --prefix tests ci` and Playwright's
  Chromium (or `CHROME_PATH`) for the browser suites, the server bound to `127.0.0.1`, direct links. Hard-coded
  counts ("359 assertions", "450 matches", "~15 s") are gone; "which mode runs is decided by the address" now says
  what `main.js` does (`applyMode('practice' | 'match', n)` per game; a direct link only skips the menu); the 14
  missing files are in the structure; `assets/README.md` no longer says the game has two images ("Supplied so far") and
  has a table of what each folder is and who reads it. `tests/run-fast.mjs` runs exactly the Action's list (it reads the
  workflow), so "the fast suites in one command" cannot differ from CI. `tests/browser-practice.mjs` now falls back to
  Playwright's own Chromium instead of throwing when `/opt/pw-browsers` is missing (the other launchers already did).
- **A test that every public event holds only its documented keys (G18, code-6: `tests/public-events-check.mjs`).** The
  14 public event types and the keys and kinds of value each may carry are written out in the test (from
  `src/game/state.js` and the `emitPublic` calls). It runs 300 seeded all-bot matches (about 48,000 events) and fails
  on any key not on the list (an earlier slip put the searcher's hand size on the `search` event), a missing key, an
  object or list where a number belongs, a Possession card named as a weapon, a seat not at the table, or an event
  type it does not know. It scans `src/` for `emitPublic` calls too, so a NEW event type must be written down in the
  test (and in the comment above `emitPublic`) before the suite passes: whoever adds an event decides on purpose that
  it is public. Proven by planting the old leak in a scratch copy of the engine (`hand: player.hand.length` on
  `search`): the suite fails, naming the key.
- **Your record testable in Node (G18, code-6: `src/record.js`, `tests/record-check.mjs`).** `createRecord({ store })`
  takes anything with `getItem` and `setItem` (the shape of localStorage, as the account takes its store); the
  exported `record` is made with the device's own localStorage looked up at each call, exactly as before. Behaviour is
  identical: a differential run of the old and the new module over 400 random sequences (counting, left early,
  practice, reset, another tab saving in between, damaged saves, throwing or missing storage) gave the same record and
  the same saved text every time. The suite covers counting by side and escapes, "Left early" (never played, won or
  lost), practice escapes, reset, saving and a new visit, two tabs, thirteen kinds of damaged save, huge numbers, blocked
  and missing storage, storage that refuses writes then works again, the words and the win rate. A planted
  double-count of a win fails it. (What `main.js` does with it, once per game when its end screen shows, is still
  covered only by the browser suites.)
- **Fixed waits (G18, code-6).** Ten of the longest fixed pauses in the browser suites now wait for the condition the
  next line checks, with a new helper (`settle` / `settleNode` in `tests/smoke-lib.mjs`: it waits up to a limit, says
  true or false, never throws, so the check after it still fails in its own words): `audio-check` (Music Off stops the
  waltz; the lift's bell and doors; the lobby music gone; the game music released; the four fanfares fetched from round 3;
  the stinger at the end), `browser-polish` (back to the menu; the wardrobe up, twice) and `browser-learn` (the
  Lanterns chip in practice). The rest stay: most of those in `tips-check` are "nothing happens" checks (a tip never
  comes back, the clock keeps running), where the waiting is the test; the others let a camera or a light settle
  before a measurement or a screenshot, or stand beside a CSS animation, with no state to wait for. **One of the ten was NOT safe as first written**: with the
  4-second wait after "back to the menu" gone, `audio-check` navigated away while the menu's hotel was still
  downloading and its console check counted the aborted downloads (a failure the old wait had hidden). It now waits for
  `window.__game.settled()` before each page load, which is what that line meant to do (the old `dressingDone()` call
  there waited for nothing).
- **Old QA scripts (code-6).** The nine `qa-*.mjs` scripts, `qa-lib.mjs` and the two playtest reports they belong to
  (`autoplay-report.md`, which names a `tests/autoplay.mjs` that no longer exists, and `qa-visual-report.md`) moved to
  `tests/old/` with a README saying they are historical (nothing runs them or imports them; their relative imports
  were repointed so they still load). `tests/personality-report.md` stays: the balance tools write it.
- **Maintenance tools (code-8).** `walkcheck`, `perf`, `shoot` and `vsref` in `tools/room-pipeline/` opened the plain
  address, which is the main menu and has no "Tap to begin" card; they open `?mode=practice` now, take `--url`, find
  Chromium through `CHROME_PATH` like the tests, and say "last verified: 14 Oct 2026" in their first lines (and the README
  says what was run). `tools/lobby-pipeline/lobby.json` (the lobby's start positions had changed) and
  `tools/room-pipeline/rooms.json` (the corridors' flicker values had changed in round 1) were regenerated with their
  own `dump_*.mjs`; the Blender build reads neither of those fields.
- **Clean-up (code-10, graphics-13).** Removed, each first checked by grep over `src/`, `tests/`, `tools/` and
  `index.html`, by a network log of a whole game (the main menu; a match from "Find a table" through the lift to the end
  screen with every baked room revealed and every card type shown; then practice: no file of the list below was
  asked for, and after the removal nothing 404s and the console stays clean) and by the node suites:
  the dead exports `isValidUsername`, `hasType`, `isEvil`, `frontierDoorways`, `isDiscovered`, `loadedBases`,
  `STYLE_NAMES`, `countTile`; `handoff.passTo` and its "Pass the device to…" text (no caller); the hot-seat fields
  `state.hotseat` and `__game.hotseat` (nothing read them), and `applyMode('hotseat')` (every caller says `'match'`
  now; an unknown mode throws instead of quietly meaning practice); the Kenney furniture and building models
  (`assets/models/furniture`, 31 files, 318,460 bytes; `assets/models/building`, 17 files, 104,859 bytes) with their loader
  (`src/render/models.js`, deleted, and the Kenney path of `src/render/roomDressing.js`, which went from 169 to 55 lines:
  every room is baked); and `CARD_ART` with the old 640 x 640 card illustrations (11 files, 550,537 bytes). Those
  pictures were **moved, not deleted**: `tools/card-pipeline/art/` now holds them because
  `make_lockpick_face.py` reads `lockPick.jpg` (re-running it from there reproduces the shipped Lock Pick face
  byte for byte) and `lantern.jpg` is the hand-painted reference; the pipeline's scripts and README point there. Comments
  that were no longer true were fixed (`rules.js` "Call ONCE", the PASS screen note in `handoff.js`, the hot-seat
  remarks in `characters.js` and `roundLabel.js`, and the README's applyMode sentence). `createState` takes `'practice'`
  or `'match'` and `resetState` now throws when it is given no seed (every caller gives one; the `performance.now()`
  fallback was a way to deal an unrepeatable game).
- **The table sizes are in `rules.js` (code-10), as a pure move.** `rules.minPlayers` 4 and `rules.maxPlayers` 6 (GAME_RULES
  "4–6", "3–5 computer guests"), with `minBots` 3 and `maxBots` 5 derived from them in `derive()`. They replace the
  `4`/`6` clamp in `applyMode`, the menu's `[3, 4, 5]` and the three `Math.max(3, Math.min(5, …))` clamps in `main.js`
  (the old `?mode=hotseat&players=` link, the menu's choice and `?bots=`); same values everywhere, so nothing a player
  sees changes. `tests/docs-check.mjs` pins the numbers to the "Read this first" block.
- **A test the computer-guest change broke, and its fix (`tests/browser-bots.mjs`, section 5).** On the code as it stood
  when this round began (the last commit plus the new computer-guest behaviour, none of this round's clean-up) the
  scripted attack failed: "a bot attacks you: the result says hit you", and every check after it; a plain checkout of
  the last commit passed all 67 checks. So it was the roaming bots, not the clean-up (the polish builder saw the same
  failure; the bots builder's own run passed: the scene depends on where the bots happen to roam). Logging the scripted
  killer showed two causes. The killer was "whoever acts first", and the check relied on it walking IN to the player's
  room to force a meeting; a roaming bot can start its turn already in the player's room (a guest already there is not
  forced to meet again: the pair is locked) and simply walks off. And once that was arranged, the player's death ended
  the match at once, because by round 4 every other guest had been possessed, so there was no "You are out" question
  left to check. The test now sets its scene: the killer is the next guest to act, started next door (the lobby will
  do) with a knife, and a clean guest is kept alive. Same checks, same words; where a bot happened to roam no longer
  decides whether they run. It passes again (67 checks). A possible follow-up for the bot work, not a rule: three of
  four guests possessed by round 4 in that seed.
- **Not done, on purpose.** Test-only helpers in production modules (`growTo`, `placeTile`, `stackDeck`,
  `characters.roster`, the feed's `_kindOf`: tests use them, so they are not dead); one shared `esc()` for the four
  files that each copy it, the three names for the seat list (`roster`, `cast`, `seats`) and the capitalised `PRACTICE`
  that changes at run time (no bug; a wide edit of working screens for tidiness); about 19 unused CSS classes; the
  card-pipeline's `ui-shots.mjs` and two `char-pipeline` scripts still open `?mode=hotseat` links (outside the four
  scripts the audit named); whether `tools/` (26 MB, the character reference sheets included) should stay in the
  published site (the owner may prefer them public or private).
- **Verified here:** see docs/PROGRESS.md ("Round 2 (v0.6)") for what was run; the browser suites I did not run are
  listed there.

## Round 2, fixes after review (14 Oct 2026 — interface, computer-guest behaviour, tests and documents; no rule or rule number changed)

The independent review of round 2 found 19 things; each was checked first (reproduced, or confirmed in the code) and
fixed with the smallest change that fits, with a test that fails without the fix where a browser can show it. What
changed, and what was left on purpose:

- **The Lantern's other half is said where the choice is made.** A computer guest who walks in on the player opens the
  private card pick with no Trade / Attack panel, so the first-meeting tip (which sits beside that panel) never came
  up before the first card was chosen (reproduced: seed 21, three computer guests: the tip stayed unseen through a
  whole trade). Lifting a Lantern on the pick screen now adds its own line, `LANTERN_TRADE_NOTE` ("A Lantern blocks a
  soul, but is lost if the other guest gives you an ordinary card."), the same words for either side, kept in
  `src/data/tips.js` and used by the tip too (one place). Room for it is kept from the start of any pick that offers
  a Lantern, so lifting a card moves no button. The rules' own Lantern text (`rules.js`) is untouched.
- **A double tap on the dark round the Menu panel (or the Leave question) opened a door.** The first tap closed the
  panel, the second landed on the hotel under it (actions 4 to 3, a door open, no question). `gameMenu.swallowTap()` and
  `overlays.swallowTap()` are true for 350 ms after either closes, and `main.js` `onTap` asks them beside the chat's
  and the tips' own. A tap a moment later is the game's again.
- **The role screen's line for a clean guest** now says all three ways the possessed side wins, as GAME_RULES
  (Winning) and page 1 of How to play do: "The possessed win if every living guest is possessed, or no clean guest is
  left, or dawn breaks before anyone escapes." (It said "everyone", wrong once anyone is dead, and left out the
  kill-them-all way.)
- **How to play: the one error of fact.** Page 5 said a guest who is out "drops everything you carry"; GAME_RULES
  (Health) says Possession cards leave the game instead. Not changed, because the wording is the owner's to decide,
  and none is an error: (a) no page, and not the match's Lantern tip, says how to get out: stand in the Fire Exit and
  tap Escape, 1 action; (b) End turn is never mentioned, nor that unused actions are lost; (e) nothing says what
  happens when a computer guest walks into you (it chooses, and a trade then asks you for a card). Sentences that would
  fit: "Escaping costs 1 action: stand in the Fire Exit and tap Escape." (since Round 4: "...and tap the Exit icon.") / "Tap End turn when
  you are done; unused actions are lost." / "If a guest walks into your room, they choose; a trade then asks you for a
  card." **The owner approved all three on 15 Oct 2026 and they are on pages 4, 2 and 3** (the five pages, the
  complete role-screen line for a clean guest, the lantern Home Screen icon and the possessed computer guests'
  new, quicker feel were approved the same day). (d) The pages teach the match, so opened from Practice's Menu they still say 45 seconds and dawn: by design
  (the header of `src/data/howToPlay.js`; page 1 says practice has no deadline).
- **Small ones.** The Menu button's accessible name is "Menu" (it said "Main menu", which is not where it goes). The map
  legend says "A guest (their initial, or seat number)" (two names that start alike get their seat numbers; three
  letters first was rejected: a plan dot is 20 px). The "Welcome back" card says the match "is counted as left early".
  How to play keeps the keyboard focus when the window changes shape (measuring the pages turned Next off for a
  moment, which dropped the focus). After Menu > Leave > Keep playing the focus goes back to the Menu button.
- **A tall private screen no longer leaves the next one scrolled.** The one card serves every private screen and a
  hidden box keeps its scroll position, so a Hand Mirror result swiped down opened the next screen with its title out
  of sight. `handoff.close()` puts the card back to the top before it hides; the meeting, discard and card-view panels
  start at their top when they open.
- **Floor rings on the red rug.** The orange and blue rings were about 2.4:1 against the rug, and a dark edge shows
  nothing on a dark floor. Every ring now also has a thin light edge outside the dark one (`ringLightOpacity`, one more
  small mesh per guest); a ring reads on the cream floor, the rug and a dark one. Lifting the orange (the review's other
  idea) was tried on paper and rejected: `#ff8a4c` is 6.9 apart from gold for deuteranopia, the very problem the seat
  colours were chosen to avoid.
- **Fanfares from round 3, not round 7.** A match runs six rounds at the median, so the four end fanfares (about 590 KB,
  bytes only) are fetched from round 3 (`ENDING_FROM_ROUND` in `main.js`); the final-round music is still decoded
  ahead in round 7.
- **Hand Mirror, no soul seen (computer guests).** Souls never come back (they are not in the deck, and a guest is dealt
  new ones only by being possessed, in a trade), so a guest a mirror showed no soul, and who has not traded since,
  cannot possess anyone, whatever their role. `holdsNoSoul` keeps a clean bot from handing them a Lantern to block and
  from refusing their trade as it might a stranger's; the estimate of whether they are possessed stays 25% (a possessed
  guest who has spent every soul shows none), for chat, attacks and who to trust.
- **How the possessed side now wins (a decision for the owner).** The clean side wins about as often as before the
  computer-guest change, but the possessed side wins differently. Per 3,000 matches a seed, three seeds (before the
  change / now): 

  | guests | clean wins | possessed: everyone possessed or dead | possessed: dawn | median rounds |
  |---|---|---|---|---|
  | 6 | 46.0 / 47.8% | 8.9 / 13.7% | 45.1 / 38.5% | 7 / 6 |
  | 5 | 39.0 / 39.0% | 17.3 / 25.5% | 43.7 / 35.5% | 7 / 6 |
  | 4 | 31.8 / 33.1% | 26.1 / 36.4% | 42.2 / 30.5% | 7 / 6 |

  A possessed bot's first trade with a guest is a Possession card 45 / 44 / 42% of the time before and 56 / 63 / 70%
  now (6 / 5 / 4 guests), and conversions in round 1 went from 6 / 5 / 3% to 9 / 10 / 10%: the knobs that cancelled the
  gain from exploring (`TUNING.attemptBias`, `attemptSmall`) keep the clean win rate where it was but make the possessed
  side quicker. If the owner wants dawn wins back: bring those two down and offset the sooner Fire Exit another way (a
  lower `hoard` or exploring value for the clean side), then measure with `tools/balance/bot-match.mjs`. The header of
  `src/bots/brain.js` no longer says "builds trust first".
- **A possessed homebody still opens a door.** A possessed guest with a low curiosity never opened one (a guest with no
  door by the end of round 3 was possessed 60 / 67 / 70% of the time at 6 / 5 / 4 guests). `TUNING.possFloor` 0.6 is the
  least a possessed guest's curiosity can be: 53 / 59 / 58% now, the "fewest doors" guess 20 / 27 / 36% to 17 / 25 / 33%
  (chance 17 / 20 / 25%), the clean side's win rate within 1.8 points of before. The review's other idea, lowering
  `TUNING.roam`, was measured and does nothing (rooms entered a turn in round 4 on: 3.15 to 3.12; the guess "the guest
  who walked the most" at the end of round 5: 26.5 to 26.2%): the possessed guests walk more because they walk to the
  guests they mean to possess. That sign stays (about 70% by round 6); flattening it would mean fewer attempts.
- **Chat parity (`tests/chat-check.mjs`).** The review's "nearby" ratio (possessed 1.5x clean) is unchanged by these
  changes (1.46 to 1.52 on two sets of 600 matches). The "vouches" ratio is a ratio of about 100 lines a side and
  wobbles by chance (1.66x on one set of 600 matches and 1.19x on another, same bots), so a ratio over its limit now
  fails only when the two rates also differ by more than chance (three standard errors); the limits are the same.
- **`tests/public-events-check.mjs`** no longer depends on the bots happening to produce a meeting where nobody can
  trade (it did not in 300 matches after the change): that one event is provoked by hand and held to its shape.
- **Documents.** This file's tests bullet no longer states one run's audio timings as fact (`audio-check` prints them,
  they depend on the machine), and its architecture line puts the main menu in `src/ui/menu.js` (`src/menu/` is the lobby
  scene behind it). `docs-check` prints a note while `docs/VERSIONS.md` still says "written in after publishing" for the
  current version: put the real commit in right after the publish or the rollback steps have nothing to go back to.
- **Only a real iPad can say**: how the Lantern line reads on the pick screen at finger size; whether the light ring
  edge looks right on the real display (a soft halo on the cream floor); the double tap on the dark round the panel with a
  real finger; Safari's focus handling after Leave > Keep playing (Safari does not focus a button on tap, so the focus
  return matters only with a keyboard).

## Round 4, the guest strip: bigger, a clear "Possessed" marker, and where the round ends (15 Oct 2026 — interface and tests only; no rule or rule number changed)

The owner asked for the top strip of guests to be clearer, bigger, to show better who is possessed once they know, and to
show when the round will end ("a better indication that I'm going to the next round"). Nothing in `docs/GAME_RULES.md`,
`src/data/rules.js` or the engine changed.

- **What is drawn, and from where.** `src/ui/stripModel.js` (`stripGuests`) turns the state into plain data, one row per
  guest in seat order: whose turn, who is next, out / dead, and `known`. `src/ui/roundLabel.js` (`roundReadout`) counts the
  round. `src/hud.js` (`drawStrip`) only draws those rows, and touches a cell only when its row changed. Both are pure
  (no page), so `tests/strip-check.mjs` (fast, in the GitHub Action) holds them to the information rules without a browser.
- **The "Possessed" marker (a crimson card, an eye badge on the portrait, the word "Possessed" under it).** It is the
  VIEWER's own knowledge and nothing else: `knownPossessed` (`src/game/knowledge.js`), the same set that already gave a
  possessed player red eyes on their allies. It is for both sides now: a clean viewer who learned someone is possessed (a Hand
  Mirror that showed a Possession card, a Lantern that blocked a Possession card) sees the marker too. Red eyes in the
  portrait stay as approved on 10 Oct (a possessed viewer only; `redEyedAllies` is unchanged, it now asks the shared
  `knownPossessedIds` in `src/ui/allies.js`). A guest a trade scene is still holding back is not marked until the scene lets
  go (`holdAlly`; for a clean viewer too, whose Lantern block the scene shows: `markBefore` / `markAfter` in `tradeReveal.show`), and the strip re-checks that every frame without allocating (`hud.syncStrip`, run with `syncTell`).
  Never on a guest the viewer is unsure of, never in practice, and **never on the viewer's own tile**: their own role is on
  their own panel, and the strip is the part of the screen that has always been role-free. The gold turn frame and the
  crimson marker can both show on one card (gold card edge, crimson portrait ring, badge and word), and the colour is never
  the only sign: the badge and the word carry it, and "Next" is a dashed card.
- **Bigger.** Portraits 72 px (80 px on a 1024-tall screen, 64 px with Safari's bars: under 721 px tall), names 14 px,
  hearts 15 px on a dark band across the portrait's lower edge (the last heart glows), the turn flag 13 px on the card's
  top edge. A cell is as wide as the room between the room name and the Chat / Menu buttons allows, shared among the
  guests (`--cw` in `styles.css`, 66 to 96 px); at 1024 wide the strip sits 30 px right of the middle for that reason, and
  the feed under the room name is narrowed to stay clear of it (more for six guests than for four). Height: about 171 px at
  1024x768 (was 143) and 160 px at 1024x694, 21 px more while a guest is marked. The cost to know: main.js's tap dead zone
  covers the strip plus 18 px, so a taller strip means more of the top of the screen is not tappable. The round label in
  the final round is now two lines ("Round 8 of 8" and "Final round" under it): the one-line "Round 8 of 8 · Final round" was
  wider than the Chat / Menu buttons and ran under the wider strip at 1024 (the same slip as PROGRESS's "final-round label
  never covers the guest strip").
- **The round.** After the last guest a dashed divider ("Round ends", a loop arrow; "Dawn" with a sunrise in the final round)
  and, under the guests, a line that loops back to the first guest with the words: "3 turns left in Round 2", "Last turn of
  Round 2" (the divider, the line and the words turn bright and the arrow nudges, not under Reduce Motion), and in the final
  round "3 turns left · Dawn after this round". Turns left = the active guest's own turn plus the living guests after them in
  seat order, which is exactly where the engine wraps (`endTurn`: `to.index <= from.index`); the dead, and anyone out of the
  game, are not counted. `strip-check` plays 6,750 real rounds (4, 5, 6 guests, some dead) and checks the count against the
  engine's own wrap. In the final round nobody is marked "Next" after the last turn: dawn follows, not another turn.
- **Changed in an existing suite:** `tests/browser-profile.mjs` capped a strip name at 76 px; a cell is up to 96 px now.
- **Owner decision left open:** whether a possessed player's own tile should also carry the marker (it does not: the panel
  already says it, and the strip stays role-free). One line in `stripGuests` would add it.

## Round 4, the turn flow, the lock choice, the Exit icon and the Cards screen (15 Oct 2026 — interface and tests only; no rule or rule number changed)

The owner's first iPad feedback of Round 4. Nothing in `docs/GAME_RULES.md`, the engine or any number in `src/data/rules.js`
changed (the one edit in `rules.js` is the short card text, `cards.<type>.desc`, which the owner is asked to approve; the
before/after list is in the scratchpad's `round4/learn/card-text.md`). Bots do exactly what they did.

- **How to play and the Cards screen.** How to play now teaches the game, not the cards (no Espresso, Hand Mirror, Bandage, Knife or
  Revolver numbers); five pages, the numbers still read from `rules.js`. What each card does is on a new read-only **Cards**
  screen (`src/ui/cardsGuide.js`, list in `src/data/cardsGuide.js`: one entry per type in `CARDS`, so a new card appears by itself,
  picture from the shared card tile, one line from `rules.cards.<type>.desc`). It opens from the main menu (now two rows of two
  buttons), from the in-match Menu panel next to How to play, and from a small button on the last How to play page; it sits above
  whatever opened it, owns the keys while it is up, holds the clock exactly as How to play does, and shows only kinds of cards
  (the Possession card is plain, no guest's face). The escape sentence on page 4 now says "tap the Exit icon".
- **The discard finishes itself.** The discard that brings the hand down to the limit shows the card leaving (about half a
  second; only a fade under Reduce Motion; nothing can be tapped meanwhile) and then closes and passes the turn. There is no
  "Keep these 6" step. Every discard is still two taps. `discard.open` refuses a hand that is not over the limit.
- **The found-card reveal is short.** A kicker, a title ("You found a Lantern"), the cards large, and one line per KIND of card taken
  from the description. No "You now hold N" tally and no "more than 6" note: the hand strip already says it.
- **Walking 2.5 → 2.9 m/s** (`cfg.player.speed`; a walk between rooms about 14% shorter). The computer guests walk a multiple of the
  same value, so they follow and keep their relation to the player; their thinking pauses are untouched. The real guests' walk cycle
  and the footstep sounds follow the distance walked; the stand-in figure's stride rate went 1.85 → 2.15 in proportion. 3.0 would
  give a clearer step (about 17% shorter): one number.
- **The turn passes by itself** 900 ms after the human guest's last action, through exactly the path of the End turn button
  (`endTurnNow`: the discard screen first when over the limit), once per turn (keyed on the game and the turn number), only when nothing
  is going on (`autoEndBusy` in `src/main.js`) and never on a bot's turn, for a dead guest or after the clock cut a walk short. It waits
  while the guest holds an **Espresso** (a free card to play) or stands in the Fire Exit with a guest (a free Trade is possible): End turn
  then glows (a steady ring under Reduce Motion) and the player taps it. A test global, `window.__noAutoEnd`, switches it off
  (`autoEndOff` in `tests/smoke-lib.mjs`, in every `launch()`); only `tests/browser-turnflow.mjs` turns it on. **For online play later:**
  a guest who stays at 0 actions after the beat probably holds an Espresso or has a free Trade, a timing tell; the server flow should
  end every turn the same way (same beat for everyone, or no tell). Nothing shows or plays it today.
- **The lock choice** (`src/ui/lockChoice.js`). Tap the padlock on a locked door next to you (or the shut door) and a small card asks
  which card to use: one button per KIND held ("Use Master Key", "Use Lock Pick"), one honest line each ("Always opens it. Used up." /
  "Opens it half the time, or snaps. Used up either way.", the chance read from `rules.lockPickChance`), "Costs 1 action." and "Not
  now". It works only in your action phase from the room next to the door (`adjacentLockedRooms`, the hand's Open condition); other
  cases give the existing toasts and spend nothing. The choice goes through `onUnlock` (`useUnlock`), the same path as the hand's
  Open button, and the door shows the result (`roomView.playUnlock`): the padlock pops and the door swings open after a held beat, or a
  snapped pick shakes the padlock and the door stays shut; the door looks the same for either successful card. The sound is the
  public unlock event plus `doorOpen` 0.45 s later. The padlock is hit-tested in screen space (at least 30 px), the door by ray; the
  padlock is drawn about 35% larger while you hold a card for it. A double tap answers once (clicks in the first 300 ms are ignored and
  a tap right after it closes is swallowed: `lockChoice.swallowTap`). A bot's unlock is not animated.
- **The Exit icon replaces the Escape button.** In the Fire Exit, on the player's own turn, a door-with-an-arrow icon sits on the exit
  door where a Search icon would sit ("Exit the hotel · 1 action"): green when this guest can leave (a tap escapes, as before, no
  confirmation), grey when not (a tap says what is missing and spends nothing; with no actions: "No actions left."). Every guest in the
  Fire Exit sees it, green or grey, and a possessed guest sees exactly what a clean guest short of Lanterns sees (same classes, drawing,
  tag, label and toast sentence), so its existence tells nothing. The toast in a match is "Only a clean guest with 3 Lanterns can leave.
  You have N." for everyone (so a possessed guest with 3 never reads "You need 3... You have 3."); in Practice "You need 3 Lanterns to
  leave. You have N.". One table, `KINDS` in `src/ui/searchSpot.js`, defines every room action icon (search and exit today): the
  drawing, the furniture it rests on, when it is offered, its looks and their words, its label; a new kind (Infirmary, Switchboard) is
  one entry, a few CSS lines and one line in `main.js`'s `onTap` table. The exit kind hides while walking. Grey with 3 Lanterns is a
  possessed player's own tell, the same information the old disabled button gave.
- **Fixer round (after review).** The Lock Pick line on the lock card says "half the time" like the card does; the How to play line
  says the Infirmary "restores 2 health"; the Practice end screen says "Fire Exit"; every toast is now in a live region
  (`role="status"`) so a refusal is spoken; the Chat panel is held above the Rotate / Centre / Map buttons and scrolls inside itself when
  the taller strip (a marked guest) pushes it down; and a clean viewer's strip marker waits for the trade scene that reveals it.
- **Open for the owner:** the card wording (`round4/learn/card-text.md`; the Lantern line is the owner's own), whether a clean viewer's strip
  should show the "Possessed" marker (see the strip section), and whether the top of the hotel feels too covered by the taller strip.

## Round 4, rooms, the discard clock and the lobby (15 Oct 2026 — owner-approved rule changes and the screens for them; the lobby dial)

The owner approved five changes on 15 Oct 2026, after a plain-language before/after list (CLAUDE.md, "Rules changes"): (1) the two Infirmaries and the Switchboard are no longer searched, their own action takes the search's place; (2) each Infirmary works once per match; (3) the Switchboard costs 2 actions and has no once-a-turn limit; (4) the end-of-turn discard has a time limit that runs on the turn clock; (5) two more Lanterns in the deck. The engine and the computer guests were changed and checked first (`src/game/`, `src/bots/`, `src/data/rules.js`, `src/data/hotel.js`), then the screens. `docs/GAME_RULES.md` is **not** updated yet: the exact old and new lines are a proposal waiting for the owner, so until they approve it `rules.js` is the truth (the numbers in `tests/docs-check.mjs` do not read GAME_RULES.md).

- **No search in the job rooms.** `searchable: false` on the tiles `infirmary1`, `infirmary2` and `switchboard` (`src/data/hotel.js`). Their `searchPoint` and the `searchSpot` piece of furniture stay, as the place the interface puts the room action's icon (`src/ui/searchSpot.js`, kinds `heal` and `switchboard`: the same button and place as the magnifier, no button in the bottom bar). `canSearch` answers `notSearchable` and `searchLeft` is false there, so no screen offers a search, no bot plans one, and no card can be drawn from these rooms. **One exception, on purpose:** while a dead guest's cards lie on the floor (`state.roomDrops`), `canSearch` is ok again, and a search there is an ordinary pick-up (1 action, takes everything on the floor, draws nothing, does not mark the room searched). Without it a guest killed in an Infirmary would take their Lanterns out of the game, and cards would be stranded in a room nobody can search. It follows the owner's existing line "dropped items can always be picked up" (GAME_RULES, Searching) and is in the proposal for GAME_RULES (change 7), so the owner sees it. The screen then shows the magnifier beside the room's own icon (a second button, `#search-spot-2`). The bots test "a place to search" as `r.searchable || r.drops`.
- **Each Infirmary works once per match, in public.** `state.spentInfirmaries` is a Set of room ids, rebuilt by `resetState`, with the helper `isSpent(state, roomId)` (`src/game/state.js`), in the style of `state.searchedRooms`. It is public on purpose: using an Infirmary already was (a public log line and the public `infirmary` event), so nothing new is given away, and every seat has to be able to draw "used" on that room. The event now carries `room`, so a guest who was not looking learns which Infirmary is spent (`tests/public-events-check.mjs` writes the shape down). Whoever uses it first spends it for everybody. `canUseRoom` refuses with `finished` or `dead` first; a room with no job answers `noJob`; an Infirmary then checks `spent`, `full` and `ap` in that order, the Switchboard only `ap`. A guest at full health is refused (`full`) **without spending anything**, so the room's one use is never wasted on a guest it cannot help, and a refusal never uses the room up. Every result, refusals included, carries `job` and `room`. On screen a spent Infirmary's icon is grey with a tick, a grey cross hangs over its cabinet (`src/render/searchMarks.js`) and its mark on the map is dimmed and says "used" (`src/map.js`). The bots read `view.rooms[].spent`: a hurt bot heals only in an Infirmary that is not spent (`clinicHere`), walks only to one that is not spent, and no longer holds a Bandage back for one that is.
- **The Switchboard costs 2 actions, as often as the guest can pay.** `rules.switchboardCost = 2` (`rules.actionCost.switchboard` follows). The once-a-turn limit is gone, with everything that kept it: `state.switchboardCalls`, the `usedThisTurn` refusal and the bots' `rangSwitchboardThisTurn`. The count itself is as before: living guests only, public (a notice for the table and the public log). A computer guest rings at most once a turn on its own (`turnState.rang`) and only with `ap >= view.switchboardCost`, so a bot is never refused for want of actions; that is the bots' own pacing, not a rule.
- **The discard keeps the turn clock running: the engine's part.** Two functions in `src/game/actions.js`, so a server can call them when ITS clock runs out. `discardRandomDown(state, player, rng = state.rng)` discards random ordinary cards (a Lantern can go, a Possession card never) down to `rules.handLimit`, never more than needed, nothing when the guest is within the limit, and returns the cards it discarded. `endTurnByTimeout(state, floor, rng = state.rng)` does that for the active guest and then `endTurn`, and returns endTurn's result plus `discarded` (`finished` after the match). The random choice uses `state.rng`, the engine's own seeded stream (the one reshuffles and Lock Picks use), so a seeded game replays the same. Each card goes to the discard pile exactly as a chosen `discardCard` sends it and makes **no log line, no public event and no private note**: the table sees nothing it would not see for a normal discard. Telling the guest what went is the screen's job, privately. `endTurn` still refuses a turn over the limit (`canEndTurn`), so a discard can only be skipped through these two functions.
- **The discard keeps the turn clock running: the screen's part.** The allowance is `max(turn clock left, rules.discardMinSeconds)` (`discardAllowance`, `src/ui/discardClock.js`; `discardMinSeconds` is 10 in `rules.js`). The discard screen opens with that many seconds on the same clock (`endTurnNow` in `src/main.js` sets `timerLeft` to it) and draws a countdown (a screen reader hears 10 and 5 seconds left): a guest who ends the turn with 2 seconds left gets 10, one with 30 left keeps 30. The clock is no longer paused while the discard screen is open (it was before); only the half second the last card spends leaving (`discard.finishing`) still pauses it. At zero `atZero(over)` decides: over the limit, `endTurnByClock` closes the screen, calls `discardRandomDown`, passes the turn and tells the guest on their own screen ("Time ran out. The game discarded your Knife and your Lantern.", `discardedLine`); within the limit the turn simply ends, as it always has. The same happens **at once** if the 45-second clock itself runs out in the action phase while the guest holds more than the limit (the discard screen then never opens). The clock counts `dt`, a frame is never counted as more than 50 ms and a hidden tab draws no frames, so time away from the page is not counted: coming back never finds a discard made behind the guest's back. **The clock is off in Practice** (and with `?timer=off`): `discardAllowance` answers null, no countdown is drawn and the discard has no time limit, exactly as before. A computer guest discards by itself in `endTurnNow` before the turn passes. The seconds maths and the words are pure functions in `src/ui/discardClock.js`, held by `tests/discard-clock-check.mjs`.
- **The deck: two more Lanterns (14 to 16, 48 cards to 50), and how that was chosen.** Taking three rooms out of the search took cards, and Lanterns with them. Measured with the game's own bots (all-bot matches, chat off, the same seeds for every variant, 10,000 matches per table size and variant; one standard error is about 0.5 points on a win rate and 0.7 on a difference), the clean side's wins at 4 / 5 / 6 guests:

  | | 4 guests | 5 guests | 6 guests |
  |---|---|---|---|
  | before: 14 Lanterns, the rooms searchable | 33.5% | 38.3% | 47.0% |
  | after the room change alone (the Infirmaries and the Switchboard unsearchable, the Infirmary once, the Switchboard at 2) | 26.8% | 32.1% | 39.7% |
  | with 16 Lanterns (what the game does now) | 31.2% | 36.4% | 46.6% |

  Which change does it (2,000 matches, each change put back alone): only the unsearchable rooms matter. With them searchable again the clean side wins 33.2 / 38.0 / 48.7%; the Infirmary once and the Switchboard at 2 actions move nothing visible (27.3 / 31.2 / 40.9% and 27.7 / 31.1 / 42.1%). The loss is about 2.2 cards fewer drawn per match (16.1 / 17.9 / 18.7 against 18.3 / 20.0 / 21.0) and about 0.7 Lanterns fewer found (5.04 / 5.80 / 6.30 against 5.73 / 6.51 / 7.06). **Why +2 and nothing else:** two Lanterns give the Lanterns back in full (5.65 / 6.49 / 7.12 found a match) with one number in the deck list and no other card touched. They do not give the lost cards back, so 4 and 5 guests stay about 2 points under (31.2 and 36.4 against 33.5 and 38.3); at 6 guests the figure is within noise (-0.4). Options measured and not used: one more Lantern (15, deck 49: 29.6 / 33.3 / 43.3%, at 3,000 matches: too small); one Bandage swapped for a Lantern (deck stays 48: 31.0 / 37.0 / 44.6%); two Bandages swapped (Lantern 16, Bandage 5: 33.5 / 39.7 / 49.6%, overshoots at 6 guests); two more Lanterns and one Bandage fewer (Lantern 16, Bandage 6, deck 49: 32.5 / 37.9 / 46.6%, the closest to the old figures but it takes a Bandage out, and healing is already scarcer now that an Infirmary works once); the Linen Store drawing 3 cards (30.9 / 36.8 / 44.8%, and it makes two rooms worth much more); the first use of an Infirmary or the Switchboard also drawing a card (28.3 / 32.8 / 43.0%, at 3,000 matches: not enough, and it needs engine code and a private reveal on those screens). The draw pile at the start is now 34 / 30 / 26 cards of which 12 / 11 / 10 are Lanterns (it was 32 / 28 / 24 and 10 / 9 / 8; checked in code).
  **Bots are not people.** They search every room they can, never hoard or bluff, and use the Infirmary and the Switchboard at their own rate; the order of the options (more Lanterns in the pile, more clean wins) is solid, the exact percentages are bot figures. The possessed side already won more than half before this round (66.5 / 61.7 / 53.0%), so "back to the old figures" is back to a game that favours the possessed side, most at 4 and 5 guests; whether the owner wants the clean side nearer half at every size is a separate decision that nothing here makes. To measure the game as it is now: `node tools/balance/bot-match.mjs --n 10000 --players 4,5,6 --chat off` ("Clean side wins"; a 300-match check at 4 guests gave 32.3%). The before / after copies of the code were throw-away and are not in the repo.
- **The lobby's lift dial.** The dial over the lift doors (`lift.dial` in `src/menu/lobbyLayout.js`, drawn by `dialTexture(labels)` in `src/menu/lobbyTextures.js`) now reads L, 2, 4, 6 ... 20: the odd floors are skipped on purpose, the hotel is a tall one, and no 13 is ever shown. As the doors shut the needle climbs from L and rests in the gap between the 12 and the 14 (`lift.destination`, counted in steps from L as `indexOf('12') + 0.5`): the hidden floor the guests are stuck on, which has no mark of its own, so the needle points at nothing the hotel has a name for. The starting room, first called the Fourth Floor Landing, was renamed the **13th Floor Lobby** on 16 Oct 2026 (the owner's own name, `src/data/hotel.js`: the room `name`, the strip's short name `Lobby` and the hotel's `13th Floor`), so the dial's resting gap, the room and the story all say the same thing: the guests are stuck on the hidden 13th floor. The marks are plain lining figures drawn at 1.5 times size so they stay sharp when the camera pushes in, with the two-digit marks a little narrow so neighbours near the top of the arc never touch. The wall clock behind the reception desk moved off the pillar (`reception.clock` and its sunburst `burst`, same file): it is centred between the two pilasters either side and clear of the brass frieze below, so nothing crowds a pilaster or the brass line.
- **The words** (`src/data/howToPlay.js`, `src/data/tips.js`; `tests/howto-check.mjs` holds them). How to play page 5 says each Infirmary works once per match for whoever gets there first and everyone sees when it is used, that the Switchboard costs 2 actions and can be used as often as you can pay, that the room's own action takes the place of searching, and that the discard has a time limit (the turn clock keeps running, at least 10 seconds, then the game discards for you, at random); every number is read from `rules.js`, so a changed rule changes the page. The page still has five pages and at least three lines each, and the three owner-approved sentences are word for word as they were. "At random" is said on purpose: a Lantern can go, so the guest should not be surprised. The tips for the Infirmary, the Switchboard (both tell the player to tap the icon: the cross, the headset), the clock and a full hand say the same in fewer words; the full-hand tip says nothing about a clock in Practice, which has none. The tip for an Infirmary cannot know whether that Infirmary is already used (tips are never handed the game state), so it says the rule and the icon says "Already used".
- **For online play later:** the server owns the clock and calls `endTurnByTimeout` when it runs out; the allowance `max(left, 10)` must be applied the same way for every guest, and the random draw should come from the server's own seeded generator. Nothing about the discard is trusted from a client. One more thing to decide then: because a guest always gets at least 10 seconds on the discard, a turn can run past the 45-second mark; if the server ever shows the active guest's clock to the whole table, a clock that overruns would tell everyone that this guest holds more than the limit. Keep the discard allowance off any table-wide clock (show every seat the same 45-second clock, plus a neutral "thinking" state).
- **Where the room icon is, for the things that keep clear of it.** The icon is its badge plus its caption, and the caption ("Switchboard · 2 actions") is wider than the button's own box, so the first-time tips, the Explore/Go tags and the accidental-tap dead zone name `.search-spot .ss-badge` and `.search-spot .ss-caption` (both icons, since a dead guest's cards can add a second one), never `#search-spot` alone; a tip's `at` may name several parts and sits beside the box around them (`rectOf`, `src/ui/tips.js`).
- **Settled by the owner on 16 Oct 2026:** the `docs/GAME_RULES.md` wording (eight changed lines and two added, including the pick-up of a dead guest's cards in the job rooms) was approved and written in; the shorter card descriptions were approved as written; the strip's crimson "Possessed" mark is shown to clean guests too (only for guests they are certain about, on their own screen: GAME_RULES, Possession); the starting room is the 13th Floor Lobby. **Still open:** whether the lift dial's resting gap (between 12 and 14) is the look wanted, and whether the clean side should win more often than the figures above (a later round).
