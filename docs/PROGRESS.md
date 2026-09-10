# Progress

_Last updated after the second greybox pass (characters, five hot-seat players, 14-room floor)._

## Done
### Pass 1 — greybox prototype
- Dollhouse camera (follow, 90° snap rotation, pinch zoom with limits, two-finger pan that eases back), tap-to-walk with pathfinding, room discovery with glowing doorways, action points, per-room mood lighting, exit overlay, HUD, 2D map, "Tap to begin".

### Pass 2 — characters, players, bigger floor
- Placeholder articulated characters (head, torso, arms, legs, walk cycle) replace the capsule. Male and female body types; six outfits in `src/data/characters.js` (suit with tie, tuxedo with bow tie, white dinner jacket; emerald A-line, burgundy column, midnight-blue ballgown), distinguished by silhouette and colour. Built as a swappable view so glTF models can replace it later.
- Five players, hot-seat: each has a different outfit and a coloured floor ring; the active one has a marker above the head. Only the active player moves; *End turn* passes to the next player and refills their points. HUD shows whose turn it is, the turn order strip, the room, the round, and who is next on the End turn button. The 2D map shows all five.
- Action points: 5 per turn; 1 per doorway including going back into known rooms; free inside the room (`rules` in `src/data/floor1.js`).
- New floor: 14 rooms around a central landing with four doorways (west, north, east, south), a loop on the north/east side, three dead ends (guest suite, storage, dining room), one exit, warm → uneasy progression.
- Reaching the exit takes that player out (overlay "X found the exit!" → Continue passes the turn); when everyone has escaped, "Everyone found the exit!" with Restart.
- Lighting: flicker only where a room's data says so; doorway highlights are opaque and steady (the pulse is gone).

## Validation status
- `node tests/logic-check.mjs` (pure rules) and `node tests/browser-test.mjs` (headless Chromium, real taps/clicks, ~70 checks incl. the full hot-seat flow, an escape, rotation skipping, restart, gestures) **all pass** with no console errors. Setup instructions are in the file headers.
- Not yet tested on a real iPad.
- Automated review lenses (logic, rendering, iPad touch, spec) — see the handover for what ran.

## What the owner should test on the iPad (Safari, landscape)
1. Open the preview, tap **Tap to begin**. Five figures stand in the landing; Victor (gold ring, marker over his head) is up. Check the five look clearly different and roughly person-sized against the walls.
2. Tap the floor: only Victor walks; arms and legs swing. Tap one of the four glowing doorways: he goes through, points 5 → 4, the room appears.
3. **End turn → Eleanor**: the highlight, marker and camera move to her; she has 5 points; the strip at the top shows who is up. Send each player a different way.
4. Spend all points: the pill turns red and a message names the player; End turn passes on.
5. Go back into a room you already know: it also costs 1 (as asked).
6. Watch for flicker: the Back Stairs Passage and Service Corridor lights should flicker; nothing else — and the yellow doorway frames must be steady.
7. Reach the Fire Exit (east: East Corridor → Service Corridor → Service Stairs → Fire Exit): "found the exit" overlay, Continue passes the turn, and that player is skipped afterwards (crossed out in the strip).
8. Map: all five dots in their colours; the active one has an arrow.
9. Feel: walking speed, stride, camera angle, zoom — `src/config.js`; outfits and colours — `src/data/characters.js`; rooms — `src/data/floor1.js`.

## Open product questions (defaults chosen for now)
- When a player reaches the exit they leave the game and the others continue; the game ends when all five are out. Alternative: first to escape wins/ends the game.
- Player names (Victor, Eleanor, Marcus, Beatrice, Henry) are placeholders.
- Backtracking into a known room costs a point (as asked); with 0 points a player is stuck until End turn.
- The map and the turn counter ("Round N") are kept from pass 1.

## Not built yet (by design)
Main menu lobby, character selection screen, receptionist intro, health bars, cards, searchable objects, sound, real art.

## Next steps
1. iPad test of this pass; tune feel and character proportions from feedback.
2. Confirm the open questions above.
3. Development plan step 2: menu with 3D lobby, character selection (the outfits already exist in data), receptionist intro, health and cards, searchable objects.

## Known limitations
- Three.js comes from a CDN; the first load needs an internet connection.
- Safari's edge-swipe (back/forward) cannot be blocked by a web page: start two-finger drags away from the screen edges, or add the page to the Home Screen.
- Pixel ratio is capped at 1.5 for smoothness; `window.__game.setPixelRatio(2)` in the console compares sharpness.
