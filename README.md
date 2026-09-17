# Hotel Escape (working title)

A hidden-role social game set in a trapped hotel. Players explore room by room, collect
items, and must trade whenever they meet. One player secretly starts **possessed** and
spreads possession through trades; the clean players win by assembling an Exit Key from three
Lanterns and escaping. Inspired by Panic Station, deliberately simplified.

The authoritative rules are **[docs/GAME_RULES.md](docs/GAME_RULES.md)**. Working rules for
coding agents are in **[CLAUDE.md](CLAUDE.md)** (see also [AGENTS.md](AGENTS.md)); key
technical choices are in **[docs/DECISIONS.md](docs/DECISIONS.md)**; status and next steps in
**[docs/PROGRESS.md](docs/PROGRESS.md)**.

## Status

**Phase 0 — single-player practice mode.** One guest explores an 18-room hotel laid out for
the six-player balance baseline: move room by room on 4 action points a turn, search rooms for
cards, find 3 objectives, unlock the Fire Exit and reach it. This phase exists to test movement,
room layout, the interface and the basic rules flow on an iPad.

The multiplayer systems (hidden Possessor, forced meetings, trading, challenge, health) are
**written and tested but switched off** behind flags in `src/data/rules.js` — see
`docs/GAME_RULES.md` §0. Nothing has been deleted; set `practiceMode: false` to bring the
Phase 1 hot-seat game back. No real art, sound, or menu yet.

## Open the preview

Published with GitHub Pages from `main`: **https://mohmdalmalik.github.io/Gaming-App/**
(if it 404s, enable Pages once: repository → Settings → Pages → Deploy from a branch, `main`
`/ (root)`).

## How to play (each turn, 4 action points)

- **Move** — usable doors glow and blink. Tap one, then **Move** on the confirm bar. A room you
  already know costs 1 action point; revealing and entering a new one costs 2. The cost is always
  shown before you confirm. Tapping empty floor in your current room repositions for free.
- **Search** (1 AP) — once per room. An item room gives one card, an objective room gives one
  objective, the Housekeeping Store is empty and says so.
- **Hand** — see your cards. **Hint** (1 AP) reveals one undiscovered room next door. Lantern and
  Distraction are carried for the multiplayer phase and explain themselves in the hand sheet.
- **Full hand** — find a card while holding six and you choose: take it and drop one, use it now,
  or leave it. Nothing is ever discarded silently, and the room still counts as searched.
- **Objectives** — 3 of them, shown in the header. The Fire Exit stays hidden and sealed until
  all three are found, then it appears on the map.
- **End turn** — refills action points to 4. **Restart practice** starts the hotel over.
- **Finish** — step into the Fire Exit. You can then keep exploring or restart.

Controls (camera): pinch / wheel to zoom, two-finger or right-drag to pan, ↺ ↻ to rotate,
the map button (bottom-right) for the 2D map.

## Run locally

No build step. Serve the repo folder and open it (ES modules need a server, not `file://`):

```
python3 -m http.server 8000
```

Three.js loads from a CDN, so the first load needs an internet connection.

## Project structure

```
index.html            page shell: import map, HUD, panels, overlays
styles.css            interface styling (touch-safe, safe-area aware)
src/
  main.js             starts everything; the turn flow; window.__game debug hooks
  config.js           display / camera / feel tuning
  data/
    rules.js          THE RULE NUMBERS: AP, health, hand size, deck, card behaviour
    floor1.js         THE FLOOR: rooms, doorways, furniture, moods, dark rooms
    characters.js     body types, outfits and the five players
  game/               pure rules, no rendering (a server could reuse these)
    floor.js  grid.js   world geometry, walkable grid + A* pathfinding
    cards.js            deck build, seeded shuffle, deal, hand helpers
    state.js            players, turns, health, possession, encounter locks, win checks
    actions.js          search, bandage, trade resolution, attacks
    moves.js            plan a walk from a tap
  render/             Three.js placeholder visuals (rooms, doorways, characters, cutaway, mood)
  camera.js input.js player.js discovery.js   camera rig, gestures, movement, tap→plan glue
  hud.js  map.js  overlays.js   HUD + action bar, 2D map, start/end/error overlays
  ui/
    cards.js  hand.js  encounter.js   card tiles, the hand panel, the encounter modal
docs/                 GAME_RULES (spec), GAME_CONCEPT, DECISIONS, PROGRESS
tests/                Node checks (rules-check, logic-check) + a headless browser walkthrough
```

## Character pipeline (Blender → glTF → game)
Characters are built headless with Blender as a Python module and exported as `.glb`:
```bash
python3 -m pip install "bpy==4.2.0" pillow
python3 tools/char-pipeline/make_victor.py          # rebuilds assets/characters/victor.glb
node tools/char-pipeline/preview_glb.mjs --glb assets/characters/victor.glb --out tools/char-pipeline/shots/v
node tools/char-pipeline/capture.mjs --out tools/char-pipeline/shots/g --rot 4   # real-game screenshots
node tools/char-pipeline/portrait.mjs                 # interface portraits from the model
```
(`tools/char-pipeline/README.md` lists every tool; `docs/CHARACTER_GUI_CHECKPOINT.md` is the
working checkpoint for the character + interface phase.)

## Changing the rules or the floor

Every rule number — the phase flags, action points, action costs, hand size, room counts,
objective count, deck composition, card behaviour — is in `src/data/rules.js`. The floor (rooms,
their `role`, doorways, furniture, which rooms are dark, moods) is in `src/data/floor1.js`.
Change those files, not the game code.

To bring the multiplayer rules back for testing, set `practiceMode: false` (and `healthEnabled:
true` once combat is approved) in `src/data/rules.js`. The full roster, possession, encounters,
trade and attack all return, and `tests/browser-test.mjs` starts running instead of skipping.

### Tests

```
python3 -m http.server 8123 --bind 127.0.0.1 &
node tests/rules-check.mjs        # rules engine: Phase 1 multiplayer + Phase 0 practice
node tests/logic-check.mjs        # floor, room roles, grid, pathfinding
node tests/browser-practice.mjs   # the Phase 0 practice loop in a real browser [--screens]
node tests/browser-test.mjs       # Phase 1 multiplayer walkthrough (skips while practiceMode)
```
