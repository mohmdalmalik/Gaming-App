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
- `state.players` holds per-player rules state (current room, action points, escaped); discovered rooms are shared by everyone. Only `state.activeIndex` may move; `endTurn` passes control to the next player who has not escaped and refills their points from `rules.actionPointsPerTurn`. A round is one pass round the table.
- Reaching the exit marks that player *escaped* and skips them in the rotation; the game ends when everyone has escaped. (Alternative — first to escape ends the game — is a one-line change in `state.enterRoom`.)
- Movement objects (`src/player.js`) are one per player; only the active one is updated each frame, the others stand still.

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
- Pixel ratio is capped at 1.5 (iPads report 2). Slightly softer, much cheaper per frame. `window.__game.setPixelRatio(2)` lets the owner compare on the device.

## Input
- Pointer Events on the canvas handle touch and mouse alike. One finger = tap to walk (only if it stayed single-finger, moved ≤ 10 px and lasted ≤ 450 ms); two fingers = pinch zoom + pan; right/middle mouse drag = pan; wheel = zoom (ctrl+wheel = trackpad pinch); Safari's gesture events are used only when no touch pointers are active (desktop trackpad). `touch-action: none` plus non-passive `touchmove`/`gesture*` listeners stop iPad Safari from zooming or scrolling the page.
- No audio yet. The "Tap to begin" click handler is the place to unlock audio later (iOS only allows it inside a tap).

## Testing
- Headless Chromium (Playwright) loads the real `index.html` from a static server; the CDN requests for Three.js are intercepted and served from a local copy because the sandbox blocks the CDN. The suite drives the game through real taps/clicks and through `window.__game` (the debug hooks in `main.js`), checks for console errors, and verifies discovery, action points, End turn, rotate/cutaway, map, exit, restart, pinch, pan, wheel, draw calls and that the shader program count never grows. Screenshots are used for visual sanity.
- Software rendering there runs ~7 fps and the game clamps frame time at 50 ms, so time-based checks step the simulation manually.
