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

**The owner's restored ruleset is implemented and playable** (see `docs/GAME_RULES.md`, the product
design; `CLAUDE.md` says no rule or number changes without the owner's approval of a before/after
list). Two ways to play the same rules, chosen on the start screen:

- **Practice (default).** One guest alone in a random hotel: open doors to explore, find three
  Lanterns by searching (dark rooms need a Flashlight, two rooms are locked), reach the fire exit.
- **Hot-seat — `?mode=hotseat&players=6`.** Four to six people passing **one device**: one hidden
  Possessor with three Possession cards, private role screens, forced meetings with Trade or
  Attack, trades chosen in private on the passed device, health and weapons, Lanterns that block
  possession (and are used up doing it), three Lanterns to escape, private search results, a
  45-second turn clock, and a dawn deadline: if nobody has escaped when round 8 ends, the hotel
  wins. A testing tool for the real online game.

**Online multiplayer is not implemented.** There is no server, no networking, no accounts and no
database in this project. No real art beyond the lobby and Victor (the other rooms are grey boxes),
no sound, no menu yet.

## Open the preview

Published with GitHub Pages from `main`: **https://mohmdalmalik.github.io/Gaming-App/**
(if it 404s, enable Pages once: repository → Settings → Pages → Deploy from a branch, `main`
`/ (root)`).

## Start a six-player hot-seat match

1. Open the preview and tap **Hot-seat · 6 players**, or go straight to
   `https://mohmdalmalik.github.io/Gaming-App/?mode=hotseat&players=6`.
2. Tap **Tap to begin**. Each guest in turn takes the device, reads their secret role alone and
   taps **I understand**.
3. Every turn: a neutral *pass the device* screen → that guest's private screen (role, news,
   health, hand, key pieces) → their 45-second action phase.

`?players=4` / `?players=5` for a smaller table, `?timer=off` to play without the clock,
`?seed=123` to deal the same hands, pick the same Possessor and shuffle the same hotel (the same
lobby doors and room deck).

Two viewing switches work in any mode: `?camera=classic` shows the previous, higher camera angle
(for comparison with the new lower one), and `?stats=1` shows a small frame-rate / draw-call
readout at the top of the screen, for measuring speed on the iPad.

## How to play (each turn, 4 action points)

- **The hotel** — a new random hotel every match. You start in the lobby with 3 or 4 closed doors;
  rooms are tiles from a shuffled room deck, placed as doors are opened. The Fire Exit is one of the
  last five tiles.
- **Open a door** (1 AP) — tap a closed door's ring, then **Open**. The room behind it appears (it is
  empty, so nothing happens there yet); you stay where you are.
- **Move** (1 AP) — tap the ring of an open doorway, then **Move**. Tapping empty floor in your room
  repositions for free. A locked room says so; a Master Key or Lock Pick (from the hand sheet) opens
  it from next door.
- **Search** (1 AP) — takes anything lying in the room (a dead guest's cards); otherwise draws
  one card, once per room. Dark rooms need a Flashlight in hand. What you find is private: the
  table only sees that you searched. Lanterns are never dealt — searching is the only way to get one.
- **Hand** — Bandage (heal 1), Master Key / Lock Pick (open a locked room next door), Barricade
  (seal a doorway of your room for one round) are played from here. Lantern, Flashlight and
  weapons are used in context.
- **Meetings** (hot-seat) — walk in on a guest you have not met in that room this round and you
  must Trade or Attack. In a trade each side picks a card in private and sees only what they
  received. Give a Lantern and a Possession card cannot take you. The lobby is safe.
- **Escape** — a clean guest carrying three Lanterns walks into the Fire Exit.
- **Dawn** (hot-seat) — the header reads "Round 3 of 8"; round 8 is marked as the final round.
  If nobody has escaped when it ends, dawn breaks and the hotel wins. Practice has no deadline.
- **End turn** — refills action points to 4; if you hold more than 6 ordinary cards you discard
  first (Lanterns count; Possession cards never do).

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
    rules.js          THE RULE NUMBERS — implements docs/GAME_RULES.md (owner-approved changes only)
    hotel.js          THE HOTEL: the lobby and the 24-tile room deck (doorways, dark, locked, furniture, moods)
    characters.js     body types, outfits and the guests (up to six)
  game/               pure rules, no rendering (a server could reuse these)
    hotel.js  grid.js   the random hotel (tiles placed as doors open), walkable grid + A* pathfinding
    cards.js            deck build, seeded shuffle, deal, hand helpers
    state.js            players, turns, locked rooms, barricades, meetings, escape and win checks
    actions.js          search, the deck and discard pile, cards played, trade, attack, death
    moves.js            plan a walk from a tap
  render/             Three.js visuals: greybox rooms, doorway cues, characters, cutaway, mood,
                      searched-room ticks; bakedRoom.js loads the baked starting room;
                      pathPreview.js draws the dotted path + cost tag for a chosen door
  camera.js input.js player.js discovery.js   camera rig, gestures, movement, tap→plan glue
  hud.js  map.js  overlays.js   HUD + action bar, 2D map, start/end/error overlays
  ui/
    cards.js  hand.js                 card tiles; the hand sheet with Bandage / key / Barricade actions
    handoff.js                        pass-the-device + every private screen (role, turn, card pick, result)
    meeting.js                        the PUBLIC side of a meeting: who, Trade or Attack, weapon, outcome
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

## Starting-room pipeline (Blender → baked glTF → game)
The starting room is one model with its light baked in (soft sky light, contact shadows, lamp and
sconce pools), built headless from the game's own room data:
```bash
node    tools/lobby-pipeline/dump_lobby.mjs > tools/lobby-pipeline/lobby.json   # walls, doors, footprints
python3 tools/lobby-pipeline/textures.py                                      # tiles, rugs, paintings
python3 tools/lobby-pipeline/make_lobby.py --size 2048 --samples 64           # model + bake (~15 min)
```
Output: `assets/models/lobby/` (`lobby.glb`, `lobby-light.jpg`, `lobby-floor-light.jpg`).
`tools/lobby-pipeline/README.md` explains the parts.

## Changing the rules or the floor

Every rule number — action points, costs, health, the deck, Lanterns to escape, the dawn round limit, locked rooms, the
timer — is in `src/data/rules.js`, which implements `docs/GAME_RULES.md`. The floor (rooms, their
doorways, furniture, which rooms are dark or locked, moods) is the room deck in `src/data/hotel.js`. Change those files,
not the game code — and per `CLAUDE.md`, not without the owner's approval of a before/after list.

Which mode runs is decided by the address: `applyMode()` at the bottom of `src/data/rules.js`.

### Tests

```
python3 -m http.server 8123 --bind 127.0.0.1 &
node tests/rules-check.mjs        # the rules engine against docs/GAME_RULES.md (125 assertions)
node tests/logic-check.mjs        # floor, map topology, grid, pathfinding
node tests/browser-practice.mjs   # practice mode in a real browser [--screens]
node tests/browser-hotseat.mjs    # hot-seat in a real browser: roles, private trades, attacks, escape [--screens]
node tests/browser-lobby.mjs      # the baked starting room, door cues, path preview, camera, draw calls
node tools/balance/hotseat-sim.mjs 400 6   # 400 six-player matches under the rules as they stand (--compare for variants)
```
