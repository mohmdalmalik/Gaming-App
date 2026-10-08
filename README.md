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

- **Practice (default).** One guest alone in a random hotel: you start with 1 Lantern; open doors to
  explore, find 2 more by searching (dark rooms need a Flashlight, two rooms are locked), and escape
  through the Fire Exit.
- **Hot-seat — `?mode=hotseat&players=6`.** Four to six people passing **one device**: one hidden
  Possessor with two Possession cards (a guest they possess keeps the card and gets one try with it),
  private role screens, forced meetings with Trade or Attack, trades chosen in private on the passed
  device, 4 health and weapons, Lanterns that block
  possession (and are used up doing it), three Lanterns to escape, private search results, a
  45-second turn clock, and a dawn deadline: if nobody has escaped when round 8 ends, the hotel
  wins. A testing tool for the real online game.

**Online multiplayer is not implemented.** There is no server, no networking, no accounts and no
database in this project. No real art beyond the baked rooms and the six guests,
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
lobby doors and room deck). During the possessed guest's own action phase the main screen shows their
reminder — a POSSESSED label, "Souls to trade: N" and their Possession cards as one ×N card in the fan —
as the owner-approved rules say (no possessed portrait or violet tint there); it is gone before the iPad
is passed on. It is on by default (`ui.hotseatPossessedOnMainScreen` in `src/config.js`);
`?possessedTell=private` previews the game with the reminder on the private screens only, `?possessedTell=main`
forces it on.

The standard view is **corner-on**, like the owner's room pictures: the whole room at the default zoom,
its two near walls cut down, rooms nearer the camera cut down too, and anything else that would hide the
active guest (a wardrobe, a side wall at a doorway) faded out around them. Viewing switches that work in
any mode: `?camera=square` shows the previous square-on view, `?camera=classic` the older, higher one
(both for comparison), and `?stats=1` shows a small frame-rate / draw-call
readout at the top left (below the room name), for measuring speed on the iPad.

## How to play (each turn, 4 action points)

- **The hotel** — a new random hotel every match. You start in the lobby with 3 or 4 closed doors;
  rooms are tiles from a shuffled room deck, placed as doors are opened. The Fire Exit is one of the
  last five tiles.
- **Your guest stands in the middle of their room** — there is no walking about inside a room; you
  act by tapping rooms and furniture.
- **Open a door** (1 AP) — beyond every closed door lies a fogged, unknown room; the ones next to your
  room glow, with an "Explore · 1 AP" tag. Tap one and its door opens at once (no question): the room
  behind it appears (it is empty, so nothing happens there yet); you stay where you are, and the view
  eases so both rooms are in view. Rooms next door you can walk into now carry a quiet "Go · 1 AP" tag.
  A fogged room further off says "Walk to the room next to it first."
- **Move** (1 AP per room) — tap any revealed room (anywhere on it): a dotted path, an outline round it
  and a "Move · N AP" tag show the walk, and **Move** confirms it. The guest walks there by the fewest
  rooms and stands in its middle (round it when others are there). Walking into a room with a guest you
  have not met there this round stops the walk there for the meeting. Tapping your own room does
  nothing. A room tapped while walking is offered when you arrive (a fogged room or the search icon
  tapped while walking says "Wait until you arrive."). A tap just beside a button, the panel or the
  hand does nothing (an 18 px margin), so a missed button never opens a door. A locked room says so; a Master Key or Lock Pick (tap it in your hand) opens
  its one door from next door, until the end of your turn — then it locks again (the map shows 🔓 while
  it is open). A guest inside can always walk out; the door stays locked behind them.
- **Search** (1 AP) — there is no Search button: a room that can still be searched shows a pulsing
  brass magnifier over its search spot (the drawer, the shelves, the trolley…). Tap it (or the
  furniture itself) and the guest searches it from where they stand, turning to face it; the card(s)
  found are shown large, then go into the hand.
  It takes anything lying in the room (a dead guest's cards); otherwise draws one card, once per room
  (two in a Linen Store) — once searched, the icon is gone. Dark rooms need a Flashlight in hand (the
  icon is dimmed with a flashlight mark and says so when tapped); with no actions left it is dimmed
  too. What you find is private: the table only sees that you searched. Everything found goes into
  the hand, even past 6. Every guest (practice included) starts with 1 Lantern + 3 other cards; the
  other Lanterns are found by searching.
- **Hand limit (6)** — settled only when you END your turn: over 6 (Possession cards don't count), the
  End turn button reads "Discard N first", a calm one-line "Cards 8/6 · discard 2 at end of turn" sits
  above the fan, and End turn (or the 45 s clock running out) opens the discard screen before the turn
  passes. Cards received on someone else's turn are settled at the end of your own next turn.
- **Rooms with jobs** — in an Infirmary or the Switchboard a room button appears by End turn:
  Infirmary (1 AP, heal 2), Switchboard (1 AP, once a turn: the whole table learns how many guests
  are possessed, not who). The map marks them (✚ ☎ ≡).
- **Hand** — held as a fan of face-up cards at the bottom of the screen (resting partly below the
  edge; a card rises when touched). Tap a card to see it large with what it does and its action
  (‹ › step through the hand; tap outside or ✕ to close). Bandage (heal 1), Master Key / Lock Pick
  (open a locked door next to you, until the end of your turn), Barricade (seal a doorway of your room for one round), Hand Mirror
  (1 AP: see the whole hand of a guest in your room, in private) and Espresso (free: +2 actions this
  turn) are played from there. Lantern, Flashlight and weapons are used in context. In hot-seat the
  fan shows only during your own turn. A possessed guest's Possession cards show there as one ×N card
  (with POSSESSED and "Souls to trade: N" in their panel) during their own turn only, gone before the
  pass screen; the card view shows them too.
- **Meetings** (hot-seat) — walk in on a guest you have not met in that room this round and you
  must Trade or Attack. In a trade each side picks a card in private and sees only what they
  received. If either guest has no ordinary card (Possession cards don't count), the trade is
  skipped and each is told why (the table sees only "no trade"). Give a Lantern and a Possession card
  cannot take you. The lobby is safe. The weapon picker has a Back button.
- **Escape** — a clean guest carrying three Lanterns walks into the Fire Exit (1 AP) and taps
  **Escape** (1 AP). Arrive with nothing left and you can escape on your next turn; the exit is safe.
- **Dawn** (hot-seat) — the header reads "Round 3 of 8"; round 8 is marked as the final round.
  If nobody has escaped when it ends, dawn breaks and the hotel wins. Practice has no deadline.
- **End turn** — refills action points to 4; if you hold more than 6 ordinary cards you discard
  first (Lanterns count; Possession cards never do): tap a card to pick it, then confirm with the
  button. The rules engine itself refuses to end a turn over the limit (`canEndTurn` in
  `src/game/state.js`), so a future server enforces it too. A double tap on End turn ends only one turn. *Restart practice* asks before it wipes the game.
- **Landscape only** — in portrait (or a window under ~900 px wide) a card asks you to turn the iPad
  sideways; the turn clock waits meanwhile.

Controls (camera): pinch / wheel to zoom — out as far as it takes to see every revealed room at once
(the limit grows with the hotel; zoomed far out each room with guests carries one name tag) — and drag (one finger,
two, or the mouse) to pan anywhere over the revealed hotel. The view stays where you leave it; it comes
back to the active guest when their turn starts, when they move or open a door, when a meeting starts,
or with the ⌖ **centre on me** button beside ↺ ↻ (rotate 90° a step; the view stays corner-on). The map
button (bottom-right) opens the 2D map.

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
    moves.js            plan a walk to a tapped room (fewest-rooms route, 1 AP per room entered)
  render/             Three.js visuals: greybox rooms, doors, characters, cutaway, mood,
                      searched-room ticks; bakedRoom.js loads the baked rooms; xray.js fades
                      whatever stands between the camera and the active guest / search spot;
                      fog.js the fogged rooms beyond closed doors (+ "Explore · 1 AP" tags);
                      pathPreview.js the dotted path, outline + cost tag of a move to confirm
  camera.js input.js player.js discovery.js   camera rig (zoom to fit the hotel, free pan, centre on
                                               me), gestures, movement, room→walk glue
  hud.js  map.js  overlays.js   HUD + action bar (room job / Escape, Trade, End turn), 2D map, overlays
  ui/
    cards.js                          card tiles, cards shown large, the order a hand is shown in
    handFan.js                        the hand held as a fan of face-up cards (bottom centre)
    hand.js                           the card view: one card large, with Bandage / key / Barricade / … actions
    searchSpot.js                     the search icon over the room's flagged search furniture
    screenTags.js                     the one layer for tags over the 3D view: under the interface, never over it
    guestTags.js                      one name tag per room with guests, when zoomed far out
    goTags.js                         the quiet "Go · 1 AP" tags on rooms next door
    handoff.js                        pass-the-device + every private screen (role, turn, card pick,
                                      result, the found-card reveal)
    souls.js                          the possessed guest's own "Souls to trade: N" count (their private screens,
                                      and the main screen during their own turn)
    meeting.js                        the PUBLIC side of a meeting: who, Trade or Attack, weapon, outcome
    discard.js                        the end-of-turn discard down to the hand limit (the only hand-limit screen)
docs/                 GAME_RULES (spec), GAME_CONCEPT, DECISIONS, PROGRESS
tests/                Node checks (rules-check, logic-check) + a headless browser walkthrough
```

## Character pipeline (Blender → glTF → game)
All six guests (Victor, Eleanor, Marcus, Beatrice, Henry, Clara) are built headless with Blender as a
Python module from the owner's reference sheets (`tools/char-pipeline/ref/*-sheet.png`) and exported as
`.glb` to `assets/characters/`. One shared builder and rig: `guest_kit.py` (heads, faces, hair, suits,
hands, shoes, rig, bake, export), `dress_kit.py` (bodices, sleeves, skirts, belts, pumps, updos/long hair),
`guest_anim.py` + `gait.py` (the shared Idle and heel-to-toe Walk). Each guest is a spec in `guests/`.
```bash
python3 -m pip install "bpy==4.2.0" pillow
python3 tools/char-pipeline/make_guest.py victor          # suited guests: victor, marcus, henry
python3 tools/char-pipeline/make_dress_guest.py eleanor   # dress guests: eleanor, clara, beatrice
python3 tools/char-pipeline/sheet_compare.py ...          # sheet panels vs renders (see its header)
node tools/char-pipeline/lineup.mjs                       # all six in the real lobby light (+ scene cost)
node tools/char-pipeline/portrait.mjs <name>              # interface portraits from the model
```
(`tools/char-pipeline/README.md` lists every tool. `make_victor.py` is Victor's older builder, kept for
reference.)

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

## Room pipeline (Blender → baked glTF → game)

Every other room is built the same way as the starting room, from the game's own tile data, and matched to
the owner's reference image for it (`tools/room-pipeline/ref/`; see `tools/room-pipeline/README.md`):
`node tools/room-pipeline/dump_rooms.mjs > tools/room-pipeline/rooms.json`, `python3 tools/room-pipeline/textures_rooms.py`,
`tools/room-pipeline/build_all.sh 1024 48` (about an hour on 4 CPUs). Then
`node tools/room-pipeline/vsref.mjs` puts each room in the game next to its reference
(`tools/room-pipeline/shots/<room>-vs-ref.png`, contact sheet `shots/rooms-vs-refs.png`),
`node tools/room-pipeline/walkcheck.mjs` walks a guest through every doorway of every room, and
`node tools/room-pipeline/perf.mjs --rooms 12` measures draw calls. Output: `assets/models/rooms/`.

## Changing the rules or the floor

Every rule number — action points, costs, health, the deck, Lanterns to escape, the dawn round limit, locked rooms, the
timer — is in `src/data/rules.js`, which implements `docs/GAME_RULES.md`. The floor (rooms, their
doorways, furniture, which rooms are dark or locked, moods) is the room deck in `src/data/hotel.js`. Change those files,
not the game code — and per `CLAUDE.md`, not without the owner's approval of a before/after list.

Which mode runs is decided by the address: `applyMode()` at the bottom of `src/data/rules.js`.

### Tests

```
python3 -m http.server 8123 --bind 127.0.0.1 &
node tests/rules-check.mjs        # the rules engine against docs/GAME_RULES.md (359 assertions)
node tests/logic-check.mjs        # floor, map topology, grid, pathfinding
node tests/browser-practice.mjs   # practice mode in a real browser [--screens]
node tests/browser-hotseat.mjs    # hot-seat in a real browser: roles, private trades, attacks, escape [--screens]
node tests/browser-lobby.mjs      # the baked starting room, fog rooms, tap to open / move, camera (big hotel), draw calls
node tests/autoplay.mjs --url http://127.0.0.1:8123/ --matches 10   # bots play whole hot-seat matches through the real UI (tests/autoplay-report.md)
node tools/balance/hotseat-sim.mjs 400 6   # 400 six-player matches under the rules as they stand (--before: same bots on the rules before Part 2; --compare: Lantern variants; --cautious)
node tools/balance/hotseat-sim.mjs --study  # six player personalities (tools/balance/personalities.mjs) + rule proposals, in memory only (tests/personality-report.md)
node tests/autoplay.mjs --url http://127.0.0.1:8123/ --persona-study --matches 30   # the same personalities through the real UI
```
