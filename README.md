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

Two modes ship, and the start screen chooses between them.

**Practice (default).** One guest explores an 18-room hotel laid out for the six-player balance
baseline: move room by room on 4 action points a turn, search rooms for cards, find 3 objectives,
unlock the Fire Exit and reach it. Unchanged by Phase 1.

**Hot-seat (Phase 1) — `?mode=hotseat&players=6`.** Four to six people play the approved rules on
**one device**, passing it round: one hidden Possessor, private role screens, pre-committed
Offers, a 45-second turn clock, an eight-round deadline, and two clean guests to get out. No
health, no combat, no weapons, no locked doors. Full rules in `docs/GAME_RULES.md` §0b.

**Online multiplayer is not implemented.** There is no server, no networking, no accounts and no
database in this project, and none has been started. The older multiplayer engine (health,
weapons, the three-Lantern Exit Key) is still present and tested behind `applyMode('legacy')`;
nothing has been deleted. No real art, sound, or menu yet.

## Open the preview

Published with GitHub Pages from `main`: **https://mohmdalmalik.github.io/Gaming-App/**
(if it 404s, enable Pages once: repository → Settings → Pages → Deploy from a branch, `main`
`/ (root)`).

## Start a six-player hot-seat match

1. Open the preview and tap **Hot-seat · 6 players** on the start screen, or go straight to
   `https://mohmdalmalik.github.io/Gaming-App/?mode=hotseat&players=6`.
2. Tap **Tap to begin**. Each guest in turn takes the device, reads their secret role alone and
   taps **I understand**.
3. Every turn runs: a neutral *pass the device* screen → that player's private screen (role, news,
   hand, and the Offer they commit) → their 45-second action phase.

`?players=4` / `?players=5` for a smaller table, `?timer=off` to play without the clock,
`?seed=123` to deal the same hands and the same Possessor every time.

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
    characters.js     body types, outfits and the guests (up to six)
  game/               pure rules, no rendering (a server could reuse these)
    floor.js  grid.js   world geometry, walkable grid + A* pathfinding
    cards.js            deck build, seeded shuffle, deal, hand helpers
    state.js            players, turns, Offers, escapes, possession, win checks
    actions.js          search, hints, meeting resolution, legacy trade/attack
    moves.js            plan a walk from a tap
  render/             Three.js placeholder visuals (rooms, doorways, characters, cutaway, mood,
                      searched-room ticks)
  camera.js input.js player.js discovery.js   camera rig, gestures, movement, tap→plan glue
  hud.js  map.js  overlays.js   HUD + action bar, 2D map, start/end/error overlays
  ui/
    cards.js  hand.js  encounter.js   card tiles, the hand panel, the legacy encounter modal
    handoff.js                        hot-seat pass-the-device + private role/Offer screens
    meeting.js                        hot-seat meeting: who to meet, then the PUBLIC result
    fullHand.js  discard.js           hand-limit prompts
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

Which mode runs is decided by the address, not by editing a file: `applyMode()` at the bottom of
`src/data/rules.js` applies the practice defaults and then whatever that mode changes. The
hot-seat block (`hotseatRules`) and the table-scaling helpers (`objectivesForPlayers`,
`cleanEscapeesForPlayers`) are there too.

To exercise the older multiplayer engine (health, weapons, the three-Lantern Exit Key), set
`practiceMode: false` in `src/data/rules.js`; `tests/browser-test.mjs` then runs instead of
skipping.

### Tests

```
python3 -m http.server 8123 --bind 127.0.0.1 &
node tests/rules-check.mjs        # rules engine: practice, hot-seat and the legacy engine
node tests/logic-check.mjs        # floor, room roles, map topology, grid, pathfinding
node tests/browser-practice.mjs   # the practice loop in a real browser [--screens]
node tests/browser-hotseat.mjs    # the hot-seat loop in a real browser [--screens]
node tests/browser-test.mjs       # the legacy multiplayer walkthrough (skips while practiceMode)
node tools/balance/hotseat-sim.mjs   # 400 simulated hot-seat matches through the pure rules
```
