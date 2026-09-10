# Progress

## Done — greybox prototype (development plan step 1)
- Dollhouse camera following the player: fixed angle, 90° snap rotation buttons, pinch zoom with limits, two-finger pan that eases back, tuning values in `src/config.js`.
- Capsule player; tap/click to walk with grid pathfinding around furniture, smooth turning, walk bob.
- Test floor in `src/data/floor1.js`: Guest Suite → West Corridor → Lounge (two exits) → Service Passage with two dead ends (Storage Room, Service Room) / South Corridor → Lift Landing → Fire Exit. 9 rooms.
- Discovery: only the suite is visible at first; doorways to unexplored rooms glow; walking through reveals the room permanently.
- Action points from data: 10 to start, free inside a room, 1 per doorway, locked at 0 until End turn.
- Mood per room from data: warm/bright at the start and lounge, cooler and dimmer beyond, flickering light in the Service Passage; the whole scene's light level follows the current room.
- "You found the exit" overlay with Restart; "Tap to begin" start overlay; HUD (room name, turn, action points, rotate, End turn, map); 2D map of discovered rooms with doorways, unexplored exits marked "?", player position.
- Headless browser test suite (see `docs/DECISIONS.md` → Testing) passes with no console errors.

## Not built yet (by design)
Main menu lobby, character selection, receptionist intro, health bars, cards, searchable objects, sound, real art.

## Next steps
1. Owner tests on the iPad and gives feedback on feel (camera angle, zoom range, walking speed, wall heights, light levels) — all tunable in `src/config.js` and `src/data/floor1.js`.
2. Confirm the open product questions listed in the handover (room count, action-point charging when backtracking, reject-vs-walk-as-far, restart flow, map/turn-counter extras).
3. Development plan step 2: menu with 3D lobby, character selection, receptionist intro, health and cards, searchable objects.

## Known limitations
- Three.js comes from a CDN; the first load needs an internet connection.
- Safari's edge-swipe (back/forward) cannot be blocked by a web page: start two-finger drags away from the screen edges, or add the page to the Home Screen.
