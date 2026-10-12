# Hotel Escape (working title)

A hidden-role social game set in a trapped hotel. Players explore room by room, collect
items, and must trade whenever they meet. One player secretly starts **possessed** and
spreads possession through trades; the clean players win when one of them escapes by the Fire Exit
carrying three Lanterns. Inspired by Panic Station, deliberately simplified.

The authoritative rules are **[docs/GAME_RULES.md](docs/GAME_RULES.md)**. Working rules for
coding agents are in **[CLAUDE.md](CLAUDE.md)** (see also [AGENTS.md](AGENTS.md)); key
technical choices are in **[docs/DECISIONS.md](docs/DECISIONS.md)**; status and next steps in
**[docs/PROGRESS.md](docs/PROGRESS.md)**; the plan for going online and onto the app stores (accounts, a
server, cosmetics, packaging) in **[docs/ONLINE_PLAN.md](docs/ONLINE_PLAN.md)**.

## Status

**The owner's restored ruleset is implemented and playable** (see `docs/GAME_RULES.md`, the product
design; `CLAUDE.md` says no rule or number changes without the owner's approval of a before/after
list). The page opens on a **main menu** over an animated, blurred hotel lobby (reception and concierge,
guests seated and strolling, the manager walking by): **Play with bots**, **Practice alone**, **Settings**,
**Your record**.

- **Your profile.** The first visit asks for a username ("Sign the register": 3 to 16 letters, numbers
  or _, starting with a letter; **Suggest a name** picks one). The main menu then shows your profile card
  ("Playing as velvet_owl · Adjust avatar ›"); **Change name** is on the avatar screen. At the table
  everyone is a player: you by your username and avatar, each bot by its own username and its own
  avatar (Victor, Clara and the other named guests stay in the lobby). Kept on this device for now
  (`src/account/`), behind an interface a server account (Sign in with Apple / Google) can replace.

- **Your avatar (the wardrobe).** **Adjust avatar** opens it: **Male** or **Female**, which shows that
  body's three looks (Tuxedo, Suit and tie, Dinner jacket / Column dress, Ballgown, A-line gown), then
  skin tone, hair, eyes, glasses (and their frame), outfit colour, the accent (bow tie, tie or sash) and
  jewellery. Every pick shows at once on **your own avatar, who stands by the lift in the lobby** (the
  camera moves in on them); it is kept when you leave the screen. Your avatar boards the lift first (alone
  in practice, with Victor and Clara in a match). A few items show a lock and **"Coming soon"** (Platinum
  hair, Monocle, Gold frames, Champagne and Gatsby gold outfits, Rose gold jewellery): nothing can be
  bought or unlocked yet. Every portrait (the guest strip, your panel, the meeting, the trades, the soul
  cards) is drawn from the guest's avatar while you play; the look's stock picture shows until it is.

- **Play with bots.** You and 3–5 computer guests (bots), like an online table filling up: choose how
  many others and your role (random, clean guest or possessed), watch the guests join with their online
  names, then the manager takes guests up in the lift, the screen goes black and the match opens. Every
  rule applies: one hidden Possessor with three Possession cards, their own souls (a guest they possess
  gets two souls of their own: two tries), forced meetings with Trade or Attack, trades chosen in secret,
  4 health and weapons, Lanterns that block possession (and are used up doing it), three Lanterns to escape, private
  search results, a 45-second turn clock (bots play much faster), and dawn after round 8. The bots
  (`src/bots/`) see only what a real player could, play mostly a "medium" style (some bold, some
  careful), and a possessed bot usually wins a guest's trust with a friendly trade before trying a
  Possession card on them. Only you look at your screen, so your own hand and role show on it; nobody
  else's ever does.
- **Practice alone.** One guest alone in a random hotel: you start with 1 Lantern; open doors to
  explore, find 2 more by searching (dark rooms need a Flashlight, two rooms are locked), and escape
  through the Fire Exit.
- **Settings** (remembered on the device): bot speed (relaxed / normal / fast), the view on the other
  guests' turns (follow them / stay on me), graphics (battery saver / balanced / sharp), the menu
  background (animated / still), and Music and Sound effects (off / low / medium / high each), Quick
  chat (on / off) and Tips (on / off, with **Show tips again**).
- **Tips during your first matches**: a small card beside the thing it explains, the first time it
  comes up (your turn, the Move bar, searching, a new card, Lanterns, the clock, a meeting, being
  possessed, the Switchboard and Infirmary, a full hand, the final round, the map, chat, being out), once
  per device. **Got it** puts it away, **Hide tips** turns them off. They never stop the clock, never
  cover a button, and wait while a private screen is up.
- **Music and sound** (`src/audio/`, all made from code by `tools/audio/`): a melancholy 1930s waltz in
  the menu, a quiet night ambience in the game that turns tenser in the final round, a stinger on the end
  screen, and sound effects for the interface, the lift, doors, searches, cards, trades, attacks, rooms
  and footsteps. Browsers play no sound before the first tap, so the music starts with it.
- **Trades shown as cards** (`src/ui/tradeReveal.js`): your own trade plays as a short private scene
  instead of sentences: the cards cross and turn over, a Lantern flares and burns a Possession card to
  ash, crimson smoke curls round you when you are possessed, a spent soul burns out in crimson, an empty
  hand when someone had nothing to give. A tap skips to the end. Every Possession card shows its owner's
  face, and while you are possessed the guests you know are possessed have red eyes on your screen. Attacks show the weapon and the lost hearts; the feed has an icon per line.

Hot-seat (several people passing one iPad) was removed at the owner's request; old `?mode=hotseat`
links open a match against bots instead.

**Online multiplayer is not implemented.** There is no server, no networking, no online accounts and no
database in this project: your username and avatar are kept on this device only.

## Open the preview

Published with GitHub Pages from `main`: **https://mohmdalmalik.github.io/Gaming-App/**
(if it 404s, enable Pages once: repository → Settings → Pages → Deploy from a branch, `main`
`/ (root)`).

## Play with bots

1. Open the preview: the main menu appears over the lobby. Tap **Play with bots**.
2. Choose how many **other guests** (3, 4 or 5) and **your role** (Random, Clean guest, Possessed), then
   **Find a table**. The guests join one by one, each by username (yours marked "You"); seat colours go
   by seat, so yours can change from table to table. When the table is full the lift sequence plays
   and the match opens on your secret role.
3. On your turn you act (tap rooms, the search icon, cards, buttons); on the others' turns the bots play
   by themselves — the strip at the top shows who is **Playing**, the feed under the room name says what
   they just did, and a bot that walks in on you asks you for a card in private or attacks you.
   **Chat** (by the Menu button) opens quick chat: twenty preset lines in two tabs (**Table**: manners,
   Lanterns, plans; **Suspicion**: "I am clean.", "I am possessed.", "<name> tried to possess me!", "I
   trust <name>." …) and six emotes; one tap sends to the whole table. A line that names a guest asks
   **Choose a guest** first (their portraits; Back returns). It shows as a speech bubble over your guest
   and a line in the feed; a line about you reads as said to you ("You tried to possess me!"). The bots
   talk too — an accusation after their Lantern burned a soul, a denial when named, a possessed bot's
   lies — and they listen: each weighs what is said by how far it trusts the speaker. Settings > Quick
   chat turns all of it off (then the bots neither talk nor listen).
4. If you die you can watch or **Skip to the end**. The end screen shows every guest's role;
   **Play again** starts a new table with the same choices, **Main menu** goes back. A quiet line under
   the result gives your record ("Your record: 7 wins · 4 losses"); **Your record** on the main menu
   shows it in full (played, won, lost, win rate, by side, your escapes, practice escapes), kept on this
   device, with a Reset that asks first. A match left early (Main menu before its end) is shown as
   "Left early", never as a win or a loss.

Direct links (they skip the menu and show a "Tap to begin" card; the tests use them):
`?mode=practice`, `?mode=bots&bots=5&role=clean` (`role`: random | clean | possessed; `&seat=2` puts you
in that seat; `&user=nora` plays under that name for the visit, checked like a username and never saved;
without it you play as your profile, or as 'Guest' on a device with none — a direct link never shows the
register). Also `?timer=off` (no clock), `?seed=123` (the same deal, Possessor, table and hotel),
`?intro=off` (no lift sequence), `?botpace=0.1` (bots think 10× faster, for testing).

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
  turn) are played from there. Lantern, Flashlight and weapons are used in context. In a match the
  fan stays up on the other guests' turns (to look at; cards are used on your own turn). A possessed
  player's Possession cards show there as one ×N card, with POSSESSED and "Souls to trade: N" in their
  panel; the card view shows them too. Only on their own screen, a possessed player's guest has red
  eyes and their panel turns dark crimson with "Only you can see this"; a clean player sees a quiet
  CLEAN badge. Everyone else (and the guest strip) always sees the normal guest.
- **Meetings** (a match) — walk in on a guest you have not met in that room this round and you
  must Trade or Attack. In a trade each side picks a card in private and sees only what they
  received. If either guest has no ordinary card (Possession cards don't count), the trade is
  skipped and each is told why (the others see only "no trade"). Give a Lantern and a Possession card
  cannot take you. The lobby is safe. The weapon picker has a Back button.
- **Escape** — a clean guest carrying three Lanterns walks into the Fire Exit (1 AP) and taps
  **Escape** (1 AP). Arrive with nothing left and you can escape on your next turn; the exit is safe.
- **Dawn** (a match) — the header reads "Round 3 of 8"; round 8 is marked as the final round.
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
  main.js             starts everything; the menu → lift → game flow; the turn flow (the player's turns
                      and the bots' turns, meetings both ways); window.__game debug hooks
  config.js           display / camera / feel tuning
  settings.js         the player's own settings (bot speed, view, graphics, menu background, music, sound, quick chat, tips), kept on the device
  record.js           your record (played / won / lost, by side, escapes, practice escapes), kept on the device; counted by main.js at the end screen
  account/            who you are: account.js (the profile on this device, key 'hotelEscape.profile.v1', behind an
                      async interface a server account can replace: signUp, rename, setAvatar, owns, onChange),
                      profile.js (the profile's shape and its repair), username.js (the name rules, reserved
                      words, the light filter, suggestions) — the last two pure (a server can reuse them)
  table.js            who sits where: seats { id p1..pN, username, colour by seat, avatar }; the bots' avatars
  social/chat.js      the table's quick-chat channel: a message is { seat, id, at } (+ about: the seat a line names) and nothing else (a server would relay it)
  audio/              music and sound (Web Audio): bus.js (the cue bus: sfx('doorOpen')), index.js (the player:
                      unlock on the first tap, music by scene with crossfades, effects with variation and a
                      voice cap), gameSounds.js (the hotel's sounds from the engine's PUBLIC events, footsteps),
                      sounds.js (the mix: cue -> file, levels, scenes), library.js (GENERATED file table)
  menu/               the lobby behind the main menu: lobbyScene.js (the API: idle life, the lift
                      sequence, the camera; your avatar by the lift, setPlayerAvatar, and the wardrobe
                      camera, setWardrobe), lobbyLayout.js (every position, the cast, your spot, paths and
                      cameras as data), lobbySet.js (the room), lobbyCast.js (guests, staff, seated poses),
                      lobbyTextures.js (canvas textures, no image files). Preview: tools/menu-preview.html
                      (?menu=1 ?blur=1 ?enter=1&guests=3); check: node tests/menu-scene-shots.mjs
  data/
    rules.js          THE RULE NUMBERS — implements docs/GAME_RULES.md (owner-approved changes only)
    hotel.js          THE HOTEL: the lobby and the 24-tile room deck (doorways, dark, locked, furniture, moods)
    characters.js     body types and outfits; `roster` (the six named guests) is only a fixture for the Node tests and tools now
    names.js          the words of "Suggest a name", the reserved words (with the rules' log words) and the light filter (base64)
    wardrobe.js       THE AVATAR CATALOGUE: the six looks (which named parts each slot paints), every item (colours,
                      eye colours, glasses, frames; 'free' or locked 'earn' / 'shop'), item ids 'slot.key', an
                      avatar made safe (normaliseAvatar), avatarKey; pure (a server can check avatars with it)
    randomAvatar.js   a computer guest's look from its username (seeded, free items only, never a look already at the table)
    chat.js           quick chat: the two tabs of preset lines and the emotes, the cooldown, when the bots may speak
                      (BOT_CHAT) and how they weigh what they hear (BOT_HEAR)
    record.js         the words of Your record and of the end screen's record line
    tips.js           the first-match tips' words (one or two sentences each) and their timing
  game/               pure rules, no rendering (a server could reuse these)
    hotel.js  grid.js   the random hotel (tiles placed as doors open), walkable grid + A* pathfinding
    cards.js            deck build, seeded shuffle, deal, hand helpers
    state.js            players, turns, locked rooms, barricades, meetings, escape and win checks
    actions.js          search, the deck and discard pile, cards played, trade, attack, death
    knowledge.js        knownPossessed: who a guest KNOWS is possessed, from their own private events only
    moves.js            plan a walk to a tapped room (fewest-rooms route, 1 AP per room entered)
  bots/               the computer guests — pure, no rendering, run in the browser and in Node
    view.js             botView: THE one place a bot's information is built (public board + its own
                        hand, role and private events; never another guest's hand, count or role)
    brain.js            one bot's mind: memory, suspicion and trust, trust-building, choices (TUNING knobs)
    profiles.js         usernames and playing styles (mostly medium; some bold, some careful)
    index.js            createBotTable: the API the interface calls (nextAction, tradeCard, thinkMs, …)
    autoplay.js         plays bot turns straight through the rules (Node tools; finishing a match at once)
    chatter.js          the bots' quick chat: small talk and answers, and talk that carries information
                        (accusations after their own Lantern block or Hand Mirror, denials, trust, a
                        possessed bot's lies) — from each bot's own view and mind only; its own random numbers
                        (listening is in brain.js: onChat / hearsay, weights in data/chat.js BOT_HEAR)
  render/             Three.js visuals: greybox rooms, doors, characters, cutaway, mood,
                      searched-room ticks; bakedRoom.js loads the baked rooms; xray.js fades
                      whatever stands between the camera and the active guest / search spot;
                      fog.js the fogged rooms beyond closed doors (+ "Explore · 1 AP" tags);
                      pathPreview.js the dotted path, outline + cost tag of a move to confirm;
                      possessedLook.js the possessed player's own red eyes (shared with the portrait tool);
                      avatar.js a player's avatar from one of the six models (parsed once per look, cloned
                      with its own colours, eye colour and glasses); avatarGlasses.js glasses fitted to any
                      look; avatarPortrait.js the interface portraits drawn from an avatar with the game's
                      own renderer (cached by look; the stock picture until ready)
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
    menu.js                           the main menu screens: the register, the main menu, your avatar, Play with bots, the table, the guests joining, Settings, Your record
    register.js                       "Sign the register" (the first visit's username) and Change name
    profileCard.js                    the main menu's card: "Playing as <name> · Adjust avatar ›"
    avatarEditor.js                   the wardrobe (your avatar): Male / Female, the look, every slot, locked "Coming soon" items
    portrait.js                       a guest's portrait: drawn from their avatar (the service main.js hands in), the stock picture until then
    record.js                         the Your record screen and the end screen's record line (words: src/data/record.js)
    feed.js                           what the other guests just did (public words), under the room name
    chat.js                           quick chat: the Chat button and its two-tab panel, "Choose a guest" for a line
                                      that names one, speech bubbles over the guests, feed lines, the end screen's
                                      "Good game!" (brass line emotes, no emoji)
    tips.js                           first-match tips: when each comes up, where its card sits (beside what it
                                      explains, clear of the interface), once per device; Settings' "Show tips
                                      again" (words and timing: src/data/tips.js)
    handoff.js                        every private screen (role, card pick, the found-card reveal, a Hand Mirror's
                                      view); the player's own trade result is drawn on it by tradeReveal.js
    tradeReveal.js                    the player's own trade SHOWN as the two guests and cards with an effect (swap,
                                      Lantern burn, possession smoke, a spent soul burning out, no trade) instead
                                      of sentences; tap to skip
    soulFace.js                       each guest's own soul card: their possessed face in the card's mirror
    allies.js                         red eyes on the guests a possessed player KNOWS are possessed (knowledge.js)
    souls.js                          the possessed player's own "Souls to trade: N" count
    meeting.js                        the PUBLIC side of a meeting: who, Trade or Attack, weapon, outcome
    discard.js                        the end-of-turn discard down to the hand limit (the only hand-limit screen)
assets/audio/         the music and effects (MP3), generated by tools/audio/ (see tools/audio/README.md)
tools/audio/          the Python that makes every sound from code: dsp.py, instruments.py, music.py (the scores),
                      sfx.py (the effects), build.py (mix, master, encode, measure -> report.json, library.js)
docs/                 GAME_RULES (spec), GAME_CONCEPT, DECISIONS, PROGRESS, ONLINE_PLAN (going online, step by step)
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
node tools/char-pipeline/portrait.mjs all                 # private possessed portraits from the model
                                                          # (<name> --normal also rewrites a normal one)
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
`tools/room-pipeline/build_all.sh 1024 48` (about an hour on 4 CPUs; it ends by saving the light maps at the
512 the game ships, `shrink_maps.py`). Then
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
node tests/browser-bots.mjs       # the main menu and matches against bots in a real browser: settings, the table filling up, the lift, bots' turns, privacy, meetings both ways, being attacked, the end screen, whole matches [--screens] [--matches 3]
node tests/browser-lobby.mjs      # the baked starting room, fog rooms, tap to open / move, camera (big hotel), draw calls
node tests/audio-check.mjs        # music and sound: unlock on the first tap, every file decodes, Settings, the menu -> lift -> game music, cues in a match and practice [--quick]
node tests/trade-reveal-check.mjs # the trade scene: real trades for all seven outcomes (conversion with two new souls of your own, then your role; Lantern block; swap; you possess them; a soul spent on a guest already possessed; two souls crossed): soul faces, hands after, red eyes on known allies
# (the browser tests' launchers seed a saved profile 'tester' before each page, so the menu opens on the
#  main screen; tests/browser-profile.mjs starts with none, to check the register)
node tests/avatar-check.mjs       # avatars: the catalogue and locked items, bots' looks, every look x every value, glasses, runtime portraits vs the stock pictures, red eyes on every look x eye colour, the wardrobe at the three iPad sizes, your avatar in the lift, four tables in a row (memory, draw calls)
node tests/profile-check.mjs      # profiles: the name rules, reserved words and filter, suggestions, profile repair, the account (memory store), seats and bots' avatars, seeded tables, the feed's name masking (~1 s)
node tests/browser-profile.mjs    # the first-run register, the profile card, Change name, blocked storage, usernames at the table, ?user=, long names [--screens] [--sizes 1024x768,1366x1024]
node tests/tips-check.mjs         # first-match tips ON: where they sit, never blocking, the clock runs on, once per device, Hide tips, Show tips again [--size 1024x768] [--shots DIR]
python3 tools/audio/build.py      # rebuild every sound, ~6 min (tools/audio/README.md); needs numpy, scipy, ffmpeg
python3 tools/audio/build.py revolver lobby   # rebuild only these (effect or music names); updates library.js + report.json
node tools/balance/hotseat-sim.mjs 400 6   # 400 six-player matches under the rules as they stand (--before: same bots on the rules before Part 2; --compare: Lantern variants; --cautious)
node tools/balance/hotseat-sim.mjs --study  # six player personalities (tools/balance/personalities.mjs) + rule proposals, in memory only (tests/personality-report.md)
node tests/bots-check.mjs                  # the computer guests: information honesty, 450 seeded matches, determinism, the feed's icons (~5 s)
node tests/chat-check.mjs                  # quick chat: the 20 lines, the channel (about), the bots' talk and listening honesty (scrambled hidden state), talk alone never changes the game, sense, caps, pacing, answers (~15 s)
node tools/balance/bot-match.mjs --n 1000  # all-bot matches at 6, 5 and 4 players: who wins, trust-building, blocks, waits
                                           # (--players 6, --trace one match, --tune blockBias=-0.2,... to try a bot knob)
                                           # --chat talk|on: the bots' quick chat on a clock (talk: must match --chat off exactly;
                                           # on: they listen too), with lines per match, accusations and how true they are;
                                           # --hear k=v / --say moment.key=v try a chat knob; --inject id[:partner]@round an exploit test
```
