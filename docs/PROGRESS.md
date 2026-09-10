# Progress

_Last updated at the end of the session that built the greybox prototype._

## Done — greybox prototype (development plan step 1)
- Dollhouse camera following the player: fixed angle, 90° snap rotation buttons, pinch zoom with limits, two-finger pan that eases back, tuning values in `src/config.js`.
- Capsule player; tap/click to walk with grid pathfinding around furniture, smooth turning, walk bob.
- Test floor in `src/data/floor1.js`: Guest Suite → West Corridor → Lounge (two exits) → Service Passage with two dead ends (Storage Room, Service Room) / South Corridor → Lift Landing → Fire Exit. 9 rooms.
- Discovery: only the suite is visible at first; doorways to unexplored rooms glow; tapping the glow walks you through and reveals the room permanently.
- Action points from data: 10 to start, free inside a room, 1 per doorway, locked at 0 until End turn.
- Mood per room from data: warm/bright at the start and lounge, cooler and dimmer beyond, flickering light in the Service Passage; the whole scene's light level follows the current room.
- "You found the exit" overlay with Restart; "Tap to begin" start overlay (disabled until the 3D view has rendered); HUD (room name, turn, action points, rotate, End turn, map); 2D map of discovered rooms with doorways, unexplored exits marked "?", player position.
- Committed to `main` (commit "Add greybox prototype of the gameplay view").

## Validation status
- `tests/logic-check.mjs` (pure rules in Node) and `tests/browser-test.mjs` (headless Chromium, real taps/clicks + `window.__game`, ~60 checks: load with no console errors, discovery, action points, End turn, rotate/cutaway, map, exit, restart, pinch, pan, wheel, draw calls, constant shader count) **all pass**. Setup and run instructions are in the header of each file.
- **Not yet tested on a real iPad.** The owner should test on the device first (see the handover list below).
- GitHub Pages could not be checked from the build sandbox. If https://mohmdalmalik.github.io/Gaming-App/ shows 404, enable Pages once: repository → Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save.
- An automated code review (5 lenses: spec compliance, iPad Safari/touch, logic, rendering/performance, architecture; plus 3 independent browser testers, each finding adversarially verified) was started at the end of the session but its results were **not** applied before the session ended. A future session should run its own review pass over `src/` with the same lenses.

## What the owner should test on the iPad (Safari, landscape)
1. Open the preview; "Loading…" should become "Tap to begin" within a few seconds. Tap it.
2. Tap on the floor: the capsule walks there, around furniture, and turns smoothly.
3. Tap the glowing door frame: the corridor appears, action points go 10 → 9, the room name updates.
4. Pinch to zoom (it should stop at sensible limits); two-finger drag to look around (it drifts back after ~1 s); ↺ ↻ rotate the view in 90° steps and the lowered walls change sides.
5. Explore to both dead ends (Storage Room, Service Room): the light should turn cooler and dimmer, with a flicker in the Service Passage.
6. Use up all points: a message appears when trying to leave a room with 0; End turn restores 10.
7. Map button (bottom-right): only visited rooms, "?" on unexplored doors, your position; close it.
8. Reach the Fire Exit via the South Corridor and Lift Landing: overlay appears; Restart puts you back in the suite with everything reset.
9. Feel: walking speed, camera angle, zoom range, wall stub height, brightness — all in `src/config.js`; room moods in `src/data/floor1.js`.

## Open product questions for the owner (defaults chosen for now)
- 9 rooms instead of ~7–8 (the Service Passage makes both dead ends true dead ends). Keep, or attach the dead ends directly to the lounge?
- Every doorway crossing costs 1 point, including walking back through rooms you already know. With 0 points you cannot even backtrack until End turn. Intended, or should only *new* rooms cost a point?
- A tap that needs more points than you have is refused with a message. Alternative: walk as far as the points allow.
- Restart drops you straight back into the suite (no "Tap to begin" again). OK?
- Extras not on the list: the map marks unexplored doorways with "?", and the HUD shows a turn counter. Keep?
- The map is drawn north-up and does not rotate with the camera. OK?

## Not built yet (by design)
Main menu lobby, character selection, receptionist intro, health bars, cards, searchable objects, sound, real art.

## Next steps
1. Owner tests on the iPad and reports what feels wrong; tune `src/config.js` / `src/data/floor1.js` accordingly.
2. Confirm the open product questions above.
3. Review pass over the code (see Validation status) and fix anything confirmed.
4. Development plan step 2: menu with 3D lobby, character selection, receptionist intro, health and cards, searchable objects.

## Known limitations
- Three.js comes from a CDN; the first load needs an internet connection.
- Safari's edge-swipe (back/forward) cannot be blocked by a web page: start two-finger drags away from the screen edges, or add the page to the Home Screen.
- Pixel ratio is capped at 1.5 for smoothness; `window.__game.setPixelRatio(2)` in the console compares sharpness.
