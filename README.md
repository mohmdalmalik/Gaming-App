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

**Greybox prototype with the rules playing.** The gameplay view is built from placeholder
shapes (boxes for rooms and furniture, simple articulated figures for characters), and the
full rules loop now runs on top of it: five players take turns on one device (hot-seat),
move room by room, search for cards, meet in forced trade/attack encounters, spread and
block possession, and win or lose. No real art, sound, or menu yet. Because it is hot-seat,
all hidden information is visible to the one player — this build is for verifying the
mechanics, not the social bluffing.

## Open the preview

Published with GitHub Pages from `main`: **https://mohmdalmalik.github.io/Gaming-App/**
(if it 404s, enable Pages once: repository → Settings → Pages → Deploy from a branch, `main`
`/ (root)`).

## How to play (each turn, 4 action points)

- **Move** — usable doors glow and blink. Tap one, then **Move** on the confirm bar, to walk
  into that room (1 AP). Tapping empty floor in your current room repositions for free.
- **Search** (1 AP) — draw a card from the room. Dark rooms need a Flashlight in hand.
- **Hand** — see your cards; use a Bandage (1 AP) to heal; the possessed player sees their
  own tell and their Possession cards here.
- **Encounters** — walk into a room holding another player and, the first time you meet them
  there that round, a **Trade or Attack** is forced. In a trade both pick a card in secret:
  the possessed side can pass a Possession card to convert someone, but a Lantern from the
  other player blocks it (and unmasks the possessed). Attack (needs a weapon) uses a Knife
  (1 damage) or Revolver (2 damage, 2 shots).
- **End turn** — refills action points to 4 and passes to the next living player.
- **Win** — a clean player carrying three Lanterns who steps into the Fire Exit wins for the
  humans; the possessed side wins once no clean player is left alive.

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

## Changing the rules or the floor

Every rule number — action points, action costs, health, hand size, deck composition, card
behaviour — is in `src/data/rules.js`. The floor (rooms, doorways, furniture, which rooms are
dark, moods) is in `src/data/floor1.js`. Change those files, not the game code.
