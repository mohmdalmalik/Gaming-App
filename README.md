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
guests seated and strolling, the manager walking by): **Play with bots**, **Practice alone** (with a hint
under it, "New to Hotel Escape? Practice alone is the best place to start.", until you have played a match or
finished a practice), **How to play** and **Cards** side by side, then **Settings** and **Your record**.

- **How to play** (`src/ui/howToPlay.js`; every word in `src/data/howToPlay.js`, with the numbers read from
  `src/data/rules.js` so it follows the rules): five short pages (the goal, your turn, meetings and trades,
  possession and Lanterns, staying alive) with Back / Next / Close, from the main menu and from the Menu
  panel in a match. The keyboard works (focus moves in, Tab stays inside, the arrow keys turn pages,
  Escape closes). The action budget is "actions" everywhere ("Explore · 1 action", "Move · 2 actions").
  The pages teach the game, not the cards: what each card does is on the Cards screen.
- **Cards** (`src/ui/cardsGuide.js`; words in `src/data/cardsGuide.js` and each card's one short line in
  `src/data/rules.js`, `cards.<type>.desc`): a read-only list of every kind of card with its picture, name and
  one line. It opens from the main menu, from the Menu panel in a match (next to How to play) and from a
  small button on the last How to play page, above whichever is under it; Close comes back to it. It shows only
  the kinds of cards, never anyone's hand, and changes nothing in a match (the Menu panel still holds the clock).
- **The Menu button in a match** opens a small panel (`src/ui/gameMenu.js`): Resume, Music and Sound effects
  (the same choices and the same saved settings as Settings), How to play, and Leave, which asks "Leave the
  match?" as before. **The turn clock does exactly what it did when the button asked that question**: it
  stands still, and the computer guests wait, while the panel (or the question after it) is open. (Whether
  the clock should run while the Menu is open is the owner's decision, still pending.) On the end screen the
  button still goes straight to the main menu.
- **What the match screen says about your goal**: the role screen's headline is "You are clean" / "You are
  possessed", with its paragraph at 16 px and ONE line about how the other side wins; a small
  "Lanterns 1/3" chip in your player panel (your own count, the same for both sides); the end screen says
  **Victory** or **Defeat** for your side, and a recap ("oakhart was possessed first and possessed ari_v,
  birch and moth.").

- **Your profile.** The first visit asks for a username ("Sign the register": 3 to 16 letters, numbers
  or _, starting with a letter; **Suggest a name** picks one). The main menu then shows your profile card
  ("Playing as velvet_owl · Wardrobe ›"); **Change name** is the pencil in the Wardrobe. At the table
  everyone is a player: you by your username and avatar, each bot by its own username and its own
  avatar (Victor, Clara and the other named guests stay in the lobby). Kept on this device for now
  (`src/account/`), behind an interface a server account (Sign in with Apple / Google) can replace.

- **Your avatar (the Wardrobe).** **Wardrobe** (the profile card) opens it over the lobby, where **your own avatar
  stands large by the lift**. Left, the areas as brass key fobs: Body (man or woman, skin tone), Face (and eye
  colour), Hair (styles and colours), Moustache (men) or Make-up (women), Eyewear (and frame colour), Outfit (jackets
  or gowns, neckwear or belts, trousers and shoes, colours), Extras (earrings, a buttonhole or corsage, the Lantern fob
  or charm, gloves) and Looks (the six classic guests as ready-made looks, and three of your own to save, rename, wear
  and delete). Right, the options as picture tiles (drawn by the game's own code: `tools/char-pipeline/parts/thumbs.mjs`)
  with a colour row; tap one and your guest wears it at once. The camera comes close for the face, hair, moustache
  and eyewear, to the knees for the extras, full length for the rest; drag to turn your guest round. Undo, Surprise
  me (owned pieces only, and only looks whose eyes show), Cancel (puts back the look you came in with) and Save look
  (the lift bell). Every tile says what it is to you: Wearing, Yours, NEW, an **Achievement** item (a rosette, the task
  and how far you have come: "2 of 3 Lanterns") or a **Boutique** item (a champagne frame: "Opens later"); one that is
  not yours opens a card that says how it is had ("See achievement" opens the **Hotel Honours** page at it). For now
  every item is **unlocked for testing** (one line locks them: `UNLOCK_ALL_FOR_TESTING` in `src/data/wardrobe.js`) and
  the tiles say so. The Hotel Honours page (the wardrobe's top bar, or the end screen's achievement line) shows the
  five achievements, the piece each earns, your progress and when you earned it; they are checked on the end screen
  only. Your avatar boards the lift first (alone in practice, with Victor and Clara in a match). Avatars are made of
  swappable pieces (avatar v2, `src/data/wardrobe.js`; old saves keep their look).
  cards) is drawn from the guest's avatar while you play; the stock picture of the Look whose face it wears
  shows until it is. A guest costs 2 draw calls (its pieces merged once), where a look cost 9-15.

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
  possessed, the Switchboard and Infirmary, a full hand, the final round, the map, chat, being out, the
  first walk into a safe zone, how to look round the hotel, what the three round camera buttons do), once
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

**Add to Home Screen (iPad).** In Safari: the Share button → *Add to Home Screen*. The game then has its own icon
(a brass lantern on navy: `assets/icons/`) and opens without Safari's address and toolbar, so there is more
room (the window is 768 px tall instead of about 694). It is the same game from the same address: no app store
and no offline mode (there is no service worker). **A Home Screen copy keeps its own separate storage**, so it
starts with an empty profile: you sign the register again and your record starts at zero; your Safari profile
and record stay where they were, in Safari. (Safari may clear a site's storage after about 7 days without a visit;
by WebKit's published policy a Home Screen app is exempt from that: not tested here, there is no device.) The manifest says `display: standalone`: Apple's own
`apple-mobile-web-app-capable` tag in `index.html` already makes iPadOS run it that way, and `fullscreen` is not
something iOS is known to honour, so `standalone` is the value that behaves the same everywhere.

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
  room glow, with an "Explore · 1 action" tag. Tap one and its door opens at once (no question): the room
  behind it appears (it is empty, so nothing happens there yet); you stay where you are, and the view
  eases so both rooms are in view. Rooms next door you can walk into now carry a quiet "Go · 1 action" tag.
  A fogged room further off says "Walk to the room next to it first."
- **Move** (1 AP per room) — tap any revealed room (anywhere on it): a dotted path, an outline round it
  and a "Move · N actions" tag show the walk, and **Move** confirms it. The guest walks there by the fewest
  rooms and stands in its middle (round it when others are there). A guest walks at 2.9 m/s
  (`cfg.player.speed`; 2.5 before Round 4), so a walk of about 8 m between two rooms takes under 3 seconds; the computer
  guests walk a multiple of the same speed (the Bot speed setting). Walking into a room with a guest you
  have not met there this round stops the walk there for the meeting. Tapping your own room does
  nothing. A room tapped while walking is offered when you arrive (a fogged room or the search icon
  tapped while walking says "Wait until you arrive."). A tap just beside a button, the panel or the
  hand does nothing (an 18 px margin), so a missed button never opens a door. A locked room says so; a Master Key or Lock Pick opens
  its one door from next door — tap the padlock on the door (drawn larger while you hold a card for it) and a small card asks which
  to use (one button per kind you hold, and Not now), or tap the card in your hand — until the end of your turn, then it locks
  again (the map shows 🔓 while it is open). The door shows the result: the padlock pops open and the door swings, or a pick that
  snaps shakes the padlock and the door stays shut. A guest inside can always walk out; the door stays locked behind them.
- **Search** (1 AP) — there is no Search button: a room that can still be searched shows a pulsing
  brass magnifier over its search spot (the drawer, the shelves, the trolley…). Tap it (or the
  furniture itself) and the guest searches it from where they stand, turning to face it; the card(s)
  found are shown large with a short title ("You found a Lantern") and one short line per kind of card (no tally
  of what you now hold, no limit note: the hand strip already says "Cards 7/6 · discard 1 at end of turn"), then go
  into the hand.
  It takes anything lying in the room (a dead guest's cards); otherwise draws one card, once per room
  (two in a Linen Store) — once searched, the icon is gone. Dark rooms need a Flashlight in hand (the
  icon is dimmed with a flashlight mark and says so when tapped); with no actions left it is dimmed
  too. What you find is private: the table only sees that you searched. Everything found goes into
  the hand, even past 6. Every guest (practice included) starts with 1 Lantern + 3 other cards; the
  other Lanterns are found by searching. **The Infirmaries and the Switchboard cannot be searched** (approved, 15 Oct 2026:
  their own action takes the search's place, `searchable: false` in `src/data/hotel.js`), so they give no card; only a dead
  guest's cards lying there can still be picked up. The draw deck is **50 cards, 16 of them Lanterns** (`rules.deck`; it was 48
  and 14 before 15 Oct 2026: two Lanterns were added to give back what those three rooms no longer find).
- **Hand limit (6)** — settled only when you END your turn: over 6 (Possession cards don't count), the
  End turn button reads "Discard N first", a calm one-line "Cards 8/6 · discard 2 at end of turn" sits
  above the fan, and End turn opens the discard screen before the turn
  passes. Every discard is two taps (a card, then the button that names it), and the discard that brings the
  hand down to 6 finishes the screen by itself: the card is seen leaving for about half a second, then the turn
  passes (there is no "Keep these 6" step). Cards received on someone else's turn are settled at the end of your
  own next turn. **The discard has a time limit** (approved, 15 Oct 2026; a match, where the 45 s turn clock is on): the
  turn clock keeps running while you choose and the screen shows it as a countdown, but you always get at least
  10 seconds (`rules.discardMinSeconds`). At zero the game discards random ordinary cards for you (only as many as
  needed, never a Possession card) and the turn ends; you are told which ones, privately, in a short notice ("Time ran
  out. The game discarded your Knife and your Lantern."), and the table sees nothing. The same happens at once if the
  45 s clock runs out in your action phase while you hold more than 6 (the discard screen then never opens).
  Practice (and `?timer=off`) has no clock, so no limit. (`src/main.js` `endTurnNow` / `onTimeUp` / `endTurnByClock`,
  `src/ui/discardClock.js`.)
- **Rooms with jobs** — an Infirmary or the Switchboard has no Search: its action is the icon on its furniture
  (`src/ui/searchSpot.js`, kinds `heal` and `switchboard`, same button as the search icon; no button in the bottom bar).
  Infirmary (1 AP, heal 2, **once per match** for the whole table: the first guest to use it spends it for everyone; grey at
  full health, nothing spent), Switchboard (2 AP, as often as you can pay: the whole table learns how many guests are
  possessed, not who). A spent Infirmary is public: its icon turns grey with a tick, a grey cross hangs over its cabinet
  (`src/render/searchMarks.js`) and its mark on the map is dimmed ("used"). A dead guest's cards lying in either room bring
  the search icon back beside the action icon. The map marks the rooms (✚ ☎ ≡).
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
  received: a tap lifts a card and says what it does (a Revolver says how many shots it has left), a
  second card switches the choice, and the button that names it ("Give the Lantern", "Give your soul")
  gives it, so one stray tap gives nothing. If either guest has no ordinary card (Possession cards don't count), the trade is
  skipped and each is told why (the others see only "no trade"). Give a Lantern and a Possession card
  cannot take you. The lobby is safe. The weapon picker has a Back button.
- **Escape** — a clean guest carrying three Lanterns walks into the Fire Exit (1 action) and taps the **Exit icon**
  (a door with an arrow, "Exit the hotel · 1 action", over the exit's door; there is no Escape button in the bottom bar).
  Every guest standing in the Fire Exit sees the icon on their own turn: green when this guest can leave, grey when not
  (too few Lanterns, or the exit will not open for them: the same grey for both, nothing says why). A tap on grey says
  what is missing and spends nothing ("You need 3 Lanterns to leave. You have 1." in practice; in a match "Only a clean
  guest with 3 Lanterns can leave. You have 1." for everyone, so it never tells who is possessed). Arrive with nothing left
  and you can escape on your next turn; the exit is safe.
- **Dawn** (a match) — the header reads "Round 3 of 8"; round 8 is marked as the final round.
  If nobody has escaped when it ends, dawn breaks and the hotel wins. Practice has no deadline.
- **End turn** — refills action points to 4; if you hold more than 6 ordinary cards you discard
  first (Lanterns count; Possession cards never do): tap a card to pick it, then confirm with the
  button. The rules engine itself refuses to end a turn over the limit (`canEndTurn` in
  `src/game/state.js`), so a future server enforces it too. With actions left, End turn asks first ("You still
  have 3 actions. End turn?", with End turn and Keep playing in the same bar as Move); no question with none
  left, when the clock runs out, or for a computer guest. A double tap on End turn only asks, never ends two
  turns. **The turn also passes by itself** a short quiet beat (900 ms) after your last action, the same way End turn
  does (so a hand over the limit opens the discard screen first), once per turn: not while anything is going on
  (a walk, a door, a reveal, a meeting, a trade, a private screen, the menu, the card view, the chat panel), and not
  while you hold an Espresso or stand in the Fire Exit with a guest (a free Trade is still possible): then End turn
  glows gently and you tap it. End turn still ends early, with the question. (`src/main.js`, `autoEndState`; the
  tests switch it off with `window.__noAutoEnd`, see `tests/smoke-lib.mjs`.) *Leave the match?*, *Leave practice?* and *Restart practice?* put Keep playing in gold and the
  leaving answer plain.
- **Landscape only** — a window taller than wide (an iPad held upright) shows a card asking you to turn the
  iPad sideways; a wide but small window (page zoom, a small browser window) says "Make this window wider, or
  reduce page zoom."; so does a narrow window on an iPad that is already sideways (Split View). The turn
  clock waits behind either card.
- **Reduce Motion** (the iPad's own Settings > Accessibility > Motion) quiets the decorative motion: the two
  flickering corridors hold steady, the cards dealt into the hand and the menu pages stop moving, and the lobby
  behind the menu stays still (Settings > Menu background then shows Animated dimmed, with the reason). Nothing
  it shows is left out.

Controls (camera): pinch / wheel to zoom — out as far as it takes to see every revealed room at once
(the limit grows with the hotel; zoomed far out each room with guests carries one name tag) — and drag (one finger,
two, or the mouse) to pan anywhere over the revealed hotel. The view stays where you leave it; it comes
back to the active guest when their turn starts, when they move or open a door, when a meeting starts,
or with the ⌖ **centre on me** button beside ↺ ↻ (rotate 90° a step; the view stays corner-on). The map
button (bottom-right) opens the 2D map.

## Run locally

No build step. Serve the repo folder and open it (ES modules need a server, not `file://`):

```
python3 -m http.server 8000 --bind 127.0.0.1
```

then open `http://127.0.0.1:8000/`. `--bind 127.0.0.1` keeps the server to this computer: without it the folder (the
hidden `.git` history included) is served to everyone on the same Wi-Fi.

Three.js loads from a CDN, so the first load needs an internet connection.

## Running the tests

You need Node 20.19 or newer (the GitHub Action uses 22) and Python 3; nothing else for the fast suites.

1. **Fast suites** (the rules, the computer guests, the words, the documents; no browser, a few minutes in all): `node tests/run-fast.mjs`. It runs exactly what the GitHub Action runs (the list is in `.github/workflows/tests.yml`); one alone: `node tests/rules-check.mjs`.
2. **Browser suites** (each plays the real game in headless Chromium with software WebGL, 1 to 3 frames a second, so each takes 5 to 15 minutes: run only the ones your change touches, one at a time). Once: `npm --prefix tests ci` (Playwright and the three.js files the tests serve in place of the CDN: `tests/package.json`), then `node tests/node_modules/playwright-core/cli.js install chromium` (or set `CHROME_PATH` to a Chromium you already have).
3. Serve the folder **bound to this machine only**: `python3 -m http.server 8123 --bind 127.0.0.1 &`, then run a suite: `node tests/browser-lobby.mjs` (they use port 8123; `--url http://127.0.0.1:PORT/` says another). Stop the server when you are done.
4. A suite prints one line per check and exits 0 only if all passed. Screenshots go to `tests/shots/` (not in git). `tests/old/` holds historical QA scripts that nothing runs.
5. **Direct links** skip the menu and are what the suites use (more under "Play with bots"): `?mode=practice`, `?mode=bots&bots=3&role=clean&seed=7&intro=off&botpace=0.1&timer=off`; `window.__game` (end of `src/main.js`) is how a test looks inside the game.

The list of every suite, and the maintenance tools, is under "Changing the rules or the floor" > "Tests" below.

## Publishing and rolling back

**How the live game is made.** GitHub Pages serves the `main` branch as it is: no build, no staging copy. A
change is live for everyone about a minute after it reaches `main`, and a browser may keep the old files for up
to about ten minutes (reload twice to be sure). Nothing waits for the tests: a GitHub Action
(`.github/workflows/tests.yml`) runs the fast suites (the list is in the workflow, and `node tests/run-fast.mjs` runs the same; no install needed) on every
push and shows a red cross on the commit if one fails. That is a warning only; it never blocks or removes a publish. Look at the Actions tab or the
commit's mark after a publish.

**Every publish gets a version, `v0.N`** (the next number each time):

1. In `src/version.js` set `VERSION` (`'v0.6'`) and `VERSION_DATE` (`'20 Oct 2026'`). It shows at the bottom of
   Settings ("Version v0.6 · 20 Oct 2026") and in the small print of the "Something went wrong" card, so a
   screenshot or a bug report says which build it came from. Commit it with the publish.
2. Push to `main`, then write that exact commit into `docs/VERSIONS.md` (version, date, commit, one line on what
   is in it). The version list is a file because Claude's cloud session cannot push git tags (GitHub refuses
   them); a tag or a Release you make yourself on GitHub works the same way in the commands below.

**See the versions.**

```
cat docs/VERSIONS.md                         # every published version and its commit
git log --oneline <commit-of-v0.5>..main      # what has been published since v0.5
git show <commit-of-v0.5> --stat             # what v0.5 was
```

On the iPad: Settings shows the version of the game you are playing.

**Put the live game back on an earlier version** (to say it to Claude: "roll back to v0.5"; the commit is in `docs/VERSIONS.md`). History is never
rewritten and nothing is force-pushed: the rollback is one new commit that makes the files exactly what they
were at `v0.5`, pushed like any other change:

```
git checkout main && git pull
git restore --source=<commit-of-v0.5> --staged --worktree -- .    # the files exactly as at v0.5 (files added since go too)
git commit -m "Roll back to v0.5"
git push origin main
```

About a minute later the live game is v0.5 again, and Settings says so (the version file comes back with it).
Because history is kept, the newer work is still there to look at (`git log <commit-of-v0.5>..main`). To bring it back for
fixing, undo the rollback commit: `git revert <the "Roll back to v0.5" commit>` (merging the old branch again
does nothing: its commits are already part of history, so git says "Already up to date"), then fix it and
publish it as the next number. To take back only the LAST publish, undo its commit instead (each publish is one squashed
commit on `main`): `git revert <the publish commit>` then `git push origin main`.
`git revert v0.5..main` over several publishes does not work here: history has merge commits.

**Why not a staging site or a build step:** the owner works straight on `main`, the game is not yet played by
outsiders, and CLAUDE.md fixes "no build step for now". This is the cheapest net: a version to name, a one-
screen way back, a warning when a fast suite fails. If outside players ever arrive, the next step is to let
Pages publish from a workflow, so a red run blocks the publish (Settings → Pages → Source: GitHub Actions).

**If the game will not load** (right after a publish Safari can mix old and new files): the page reloads once by
itself (not while the device is offline: a reload cannot help), then says "The game could not load. Try again."
with a **Reload** button (technical text in small print under it). A load that never finishes (a stalled
connection) gets a plain Reload button on the loading screen after 30 seconds. A browser too old for the game
(iPadOS below 16.4) says "Hotel Escape needs iPadOS 16.4 or newer." The browser's own answer about import maps is
only a hint: the game is always tried first, and that card shows only when it then fails to load, so a browser
that answers wrongly still starts the game.

## Project structure

```
index.html            page shell: import map, HUD, panels, overlays, the start-up script (what is loading, the
                      old-browser message, one automatic reload, the problem card)
styles.css            interface styling (touch-safe, safe-area aware)
wardrobe.css          the Wardrobe's and the Hotel Honours page's styling (its three iPad sizes, Reduce Motion)
manifest.webmanifest  the web-app manifest for Add to Home Screen: name, standalone, landscape, navy colours, the icons (relative paths, so it works at the sub-path)
.github/workflows/tests.yml   the fast node suites on every push and pull request (a warning only, see above)
src/
  main.js             starts everything; the menu → lift → game flow; the turn flow (the player's turns
                      and the bots' turns, meetings both ways); window.__game debug hooks
  version.js          the version label and date shown in Settings (set at each publish)
  config.js           display / camera / feel tuning
  settings.js         the player's own settings (bot speed, view, graphics, menu background, music, sound, quick chat, tips, clearer possessed eyes), kept on the device
  motion.js           the device's Reduce Motion setting (prefers-reduced-motion), read live: it holds the two flickering corridors' light steady, the menu lobby Still and, in styles.css, the decorative CSS motion quiet
  record.js           your record (played / won / lost, by side, escapes, practice escapes), kept on the device; counted by main.js at the end screen
  honours.js          your achievements ("Hotel Honours": progress and what was earned), kept on the device (key hotelEscape.honours.v1); checked by main.js on the end screen only, once per game
  matchSummary.js     what you did in a finished match, from the rules' own events (pure: a server can reuse it): counts or not (practice, test links, idle), wins by the side you started on, your Mirror and Lantern block while clean, the Lanterns you found
  matchMarker.js      "a match is in progress" marker in localStorage (key hotelEscape.matchInProgress.v1, the time only): written when a real match begins, removed when it ends or is left; still there at the next start of the main menu means the browser cut the match short (src/main.js counts one "Left early" and says so once). Never touched by a direct link (?mode=) or practice
  account/            who you are: account.js (the profile on this device, key 'hotelEscape.profile.v1', behind an
                      async interface a server account can replace: signUp, rename, setAvatar, owns, grant, onChange,
                      and the Looks page: saveLook, renameLook, deleteLook, restoreLook, wearLook),
                      profile.js (the profile's shape and its repair), looks.js (three saved Looks of your own and the
                      six classic Looks as read-only presets: names, repair, what is missing when one is worn),
                      username.js (the name rules, reserved words, the light filter, suggestions) — the last three
                      pure (a server can reuse them)
  table.js            who sits where: seats { id p1..pN, username, colour by seat, avatar }; the bots' avatars
  social/chat.js      the table's quick-chat channel: a message is { seat, id, at } (+ about: the seat a line names) and nothing else (a server would relay it)
  audio/              music and sound (Web Audio): bus.js (the cue bus: sfx('doorOpen')), index.js (the player:
                      unlock on the first tap, music by scene with crossfades, effects with variation and a
                      voice cap; a failed download is retried after 3 s and 10 s; the night music is fetched during
                      matchmaking / the lift and the end fanfares from round 3: tests/audio-load-check.mjs), gameSounds.js (the hotel's sounds from the engine's PUBLIC events, footsteps),
                      sounds.js (the mix: cue -> file, levels, scenes), library.js (GENERATED file table),
                      buttonCues.js (which cue each button makes: open / close / select / click; pure, listed and checked by tests/audio-buttons-check.mjs)
  menu/               the lobby behind the main menu: lobbyScene.js (the API: idle life, the lift
                      sequence, the camera; your avatar by the lift, setPlayerAvatar, and the wardrobe
                      camera, setWardrobe: full length, to the knees or close up; turnWardrobe: drag to turn),
                      lobbyLayout.js (every position, the cast, your spot, paths and
                      cameras as data), lobbySet.js (the room), lobbyCast.js (guests, staff, seated poses),
                      lobbyTextures.js (canvas textures, no image files), wardrobeLight.js (the Wardrobe's key
                      light on your avatar, Wardrobe only). Preview: tools/menu-preview.html
                      (?menu=1 ?blur=1 ?enter=1&guests=3); check: node tests/menu-scene-shots.mjs
  data/
    rules.js          THE RULE NUMBERS — implements docs/GAME_RULES.md (owner-approved changes only)
    hotel.js          THE HOTEL: the lobby and the 24-tile room deck (doorways, dark, locked, furniture, moods)
    characters.js     body types and outfits; `roster` (the six named guests) is only a fixture for the Node tests and tools now
    names.js          the words of "Suggest a name", the reserved words (with the rules' log words) and the light filter (base64)
    wardrobe.js       THE AVATAR CATALOGUE (avatar v2): swappable pieces on shared bodies, the six classic Looks, every item
                      (pieces, colours, glasses; 'free', 'achievement' or 'boutique'; UNLOCK_ALL_FOR_TESTING, the one-line
                      switch), item ids 'slot.key', the v1 -> v2 migration, an avatar made safe (normaliseAvatar), the keys,
                      partKeysFor, paletteHex, lookAlike, displayAvatar; pure (a server can check avatars with it)
    partsIndex.js     GENERATED by tools/char-pipeline/parts/manifest.py: which bodies and pieces the art has built (never edit)
    thumbsIndex.js    GENERATED by tools/char-pipeline/parts/thumbs.mjs: the wardrobe's tile pictures on disk (never edit)
    achievements.js   the five achievements (what you do, the item each gives) and the end screen's line
    randomAvatar.js   a computer guest's look from its username (seeded; about one in three wears an unlockable item; never alike to a guest already at the table)
    chat.js           quick chat: the two tabs of preset lines and the emotes, the cooldown, when the bots may speak
                      (BOT_CHAT) and how they weigh what they hear (BOT_HEAR)
    record.js         the words of Your record and of the end screen's record line
    tips.js           the first-match tips' words (one or two sentences each) and their timing
    howToPlay.js      THE WORDS THAT TEACH THE GAME: the How to play pages (written from docs/GAME_RULES.md, the numbers read from rules.js at run time), the hint under "Practice alone", the role screen's headline and its one line about how the other side wins, the Lanterns chip
    gameMenu.js       the words of the in-match Menu panel
    cardsGuide.js     the words of the Cards screen, and the list it shows (one entry per card type in the catalogue)
    lostMatch.js      the card shown once when the browser cut a match short ("The game was restarted by your browser…")
    endScreen.js      the end screen's Victory / Defeat, who won, and the recap line
    dressing.js       which baked model, light maps and exposure each room has (src/render/roomDressing.js and bakedRoom.js read it)
    roomLamps.js      GENERATED (tools/room-pipeline/export_lamps.py): every real lamp, sconce and lantern of each room, for the lamp halos
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
    brain.js            one bot's mind: memory, suspicion and trust, trust-building, choices (TUNING knobs; a possessed guest blends in: it explores, wanders and guards only now and then)
    profiles.js         usernames and playing styles (mostly medium; some bold, some careful) and each guest's curiosity (how keen it is to open doors, either side)
    index.js            createBotTable: the API the interface calls (nextAction, tradeCard, thinkMs, …)
    autoplay.js         plays bot turns straight through the rules (Node tools; finishing a match at once)
    chatter.js          the bots' quick chat: small talk and answers, and talk that carries information
                        (accusations after their own Lantern block or Hand Mirror, denials, trust, a
                        possessed bot's lies) — from each bot's own view and mind only; its own random numbers
                        (listening is in brain.js: onChat / hearsay, weights in data/chat.js BOT_HEAR)
  render/             Three.js visuals (placeholder boxes where a model is missing, baked glTF rooms and guests otherwise):
                      scene.js the renderer, scene, camera and global light, sized to its container;
                      materials.js the shared greybox geometry and materials (the one place a material swap happens);
                      roomView.js a room's floor, walls, doorways and furniture boxes, built as each room is revealed;
                      roomDressing.js hands a revealed room to bakedRoom.js, and src/data/dressing.js says which baked model, light maps and exposure each room has;
                      bakedRoom.js loads the baked room models (the lobby and every tile, built by tools/lobby-pipeline and tools/room-pipeline);
                      cutaway.js lowers the walls that face the camera so the inside shows; xray.js fades
                      whatever stands between the camera and the active guest / search spot;
                      mood.js the lights: a fixed pool of point lights given to the rooms nearest the camera, so no shader ever recompiles;
                      flicker.js the two spooky corridors' flicker as pure functions, steady under Reduce Motion;
                      searchMarks.js the brass tick on the furniture of a searched room;
                      fog.js the fogged rooms beyond closed doors (+ "Explore · 1 action" tags);
                      lampHalos.js the soft glow round every lamp, sconce and lantern of the rooms on the board (one draw call), placed from src/data/roomLamps.js;
                      pathPreview.js the dotted path, outline + cost tag of a move to confirm;
                      characterView.js one guest's figure behind one surface (an avatar, a glTF guest or the box stand-in): walking, dying, the possessed look;
                      possessedLook.js the possessed player's own red eyes (shared with the portrait tool);
                      avatarParts.js a guest made of pieces: the manifest, each piece's GLB parsed once and
                      shared, the worn pieces merged once (shadow patches, glasses) into one skinned mesh +
                      the eyes: 2 draw calls a guest; avatar.js a player's avatar from those pieces (its own
                      bones, a 16-colour palette uniform: a colour change only repaints, the eye colour,
                      the possessed eyes); avatarGlasses.js glasses fitted to any face; avatarPortrait.js
                      the interface portraits drawn from an avatar with the game's own renderer (one model
                      per set of pieces, framed per face and hairstyle; the stock picture until ready)
  camera.js input.js player.js discovery.js   camera rig (zoom to fit the hotel, free pan, centre on
                                               me), gestures, movement, room→walk glue
  hud.js  map.js  overlays.js   HUD + action bar (room job, Trade, End turn), 2D map, overlays
  ui/
    focus.js                          keyboard focus for the screens over the game (private screens, discard, meeting, questions, notice, end, problem card, card view, map): focus on the main button, Tab stays inside, role=dialog + aria-modal + a name, Escape never skips a private screen, focus goes back; reusable (watchDialog)
    cards.js                          card tiles, cards shown large, the order a hand is shown in (a card you can choose is a keyboard button too)
    cardIcons.js                      small drawn card icons (the feed's lines, and a card type that has no face picture)
    tapGuard.js                       a double tap must not answer the screen it opens: a click that comes too soon after a screen opened is ignored
    roundLabel.js                     how the round is written everywhere ("Round 3 of 8", the final round marked), and the strip's "3 turns left in Round 2" line
    perfStats.js                      the ?stats=1 frame-rate / draw-call readout
    handFan.js                        the hand held as a fan of face-up cards (bottom centre)
    hand.js                           the card view: one card large, with Bandage / key / Barricade / … actions
    lockChoice.js                     tap the padlock of a locked door next to you: a small card to choose the Master Key or Lock Pick (or Not now)
    searchSpot.js                     the room action icon over a room's furniture, from one small table of kinds: the magnifier (search) and, in the Fire Exit, the door-with-an-arrow (Exit the hotel; grey or green); more kinds are a few lines
    screenTags.js                     the one layer for tags over the 3D view: under the interface, never over it
    guestTags.js                      one name tag per room with guests, when zoomed far out
    goTags.js                         the quiet "Go · 1 action" tags on rooms next door
    actionsWord.js                    "1 action" / "3 actions": the one word for the action budget wherever the player reads it (never "AP")
    howToPlay.js                      the How to play screen: five short pages, Back / Next / Close, from the main menu and the in-match Menu panel (words: src/data/howToPlay.js)
    gameMenu.js                       the in-match Menu panel (the Menu button): Resume, Music and Sound effects, How to play, Cards, Leave; holds the clock and the bots still exactly as the Leave question did (words: src/data/gameMenu.js)
    cardsGuide.js                     the Cards screen: every kind of card with its picture, name and one line, read-only; from the main menu, the Menu panel and the last How to play page (words: src/data/cardsGuide.js)
    endRecap.js                       the end screen's one-line recap: who was possessed first and whom they possessed (words: src/data/endScreen.js)
    menu.js                           the main menu screens: the register, the main menu, your avatar, Play with bots, the table, the guests joining, Settings, Your record
    register.js                       "Sign the register" (the first visit's username) and Change name
    profileCard.js                    the main menu's card: "Playing as <name> · Wardrobe ›"
    wardrobe/                         the Wardrobe (your avatar): wardrobe.js (the screen: the rail of areas, the stage with Undo,
                                      Surprise me and drag to turn, the panel of tabs, colour rows and picture tiles, the details
                                      card, the Looks, Cancel and Save look), areas.js (the areas, their tabs and sounds, as data),
                                      surprise.js (Surprise me: owned pieces only, eyes always showing; pure), icons.js (its line icons)
    honours.js                        the Hotel Honours page: the five achievements, their pieces and your progress (from the wardrobe and the end screen)
    portrait.js                       a guest's portrait: drawn from their avatar (the service main.js hands in), the stock picture until then
    crash.js                          the safety net: every step of a frame runs through it, so one failing step never freezes the picture; the last messages kept; "Something went wrong" (Back to menu, Reload) only after repeated failure
    record.js                         the Your record screen and the end screen's record line (words: src/data/record.js)
    honoursEnd.js                     the end screen's quiet "Achievement earned: …" line (src/honours.js)
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
    allies.js                         red eyes on the guests a possessed player KNOWS are possessed (knowledge.js); the same knowledge, for either side, drives the strip's "Possessed" marker
    stripModel.js                     what the top guest strip shows, as plain data: turn flags and the guests the viewer certainly knows are possessed (tests/strip-check.mjs)
    souls.js                          the possessed player's own "Souls to trade: N" count
    meeting.js                        the PUBLIC side of a meeting: who, Trade or Attack, weapon, outcome
    discard.js                        the end-of-turn discard down to the hand limit (the only hand-limit screen), with its countdown (where the turn clock is on) and the private "the game discarded..." notice
    discardClock.js                   the discard clock's seconds maths and words, as pure functions: how long the screen runs (what is left of the turn clock, never under rules.discardMinSeconds; none where the clock is off), what zero does, the "10 / 5 seconds left" announcements, the notice's sentence (tests/discard-clock-check.mjs)
assets/audio/         the music and effects (MP3), generated by tools/audio/ (see tools/audio/README.md)
assets/icons/         the app icon: a brass lantern on navy in an Art Deco ring. icon.svg is the master (1024), favicon.svg the simpler tab icon, icon-maskable.svg the same at 80 % for round masks;
                      the PNGs (icon-180 = apple-touch-icon, icon-192, icon-512, icon-maskable-512, favicon-32, favicon-16) are rasterised from them with headless Chromium (README in the folder)
assets/cards/         the card pictures: face/<type>.jpg (the owner's finished card faces, 512 x 768) and back.jpg (the card back)
assets/characters/ assets/portraits/ assets/models/   the guests' glTF models, their stock portraits, and the baked rooms (models/lobby, models/rooms)
tools/                not part of the game (the whole repo is published, tools included); each folder has a README:
  audio/              the Python that makes every sound from code: dsp.py, instruments.py, music.py (the scores),
                      sfx.py (the effects), build.py (mix, master, encode, measure -> report.json, library.js)
  balance/            the bot simulators: who wins, trust-building, tells (can a player tell the possessed bots apart?)
  card-pipeline/ char-pipeline/ lobby-pipeline/ room-pipeline/   Blender and Python that make the cards, guests, lobby and rooms (below)
docs/                 GAME_RULES (spec), GAME_CONCEPT, DECISIONS (start with "Read this first"), PROGRESS (newest first), VERSIONS (each publish), ONLINE_PLAN (going online, step by step)
tests/                the suites ("Running the tests" above; the list is under "Tests" below), run-fast.mjs (the fast ones in one command), smoke-lib.mjs (the browser launcher), old/ (historical QA scripts: nothing runs them)
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
node tools/char-pipeline/stock-portraits.mjs --port 9541 [--write]   # the six Looks' stock pictures
                                                          # (assets/portraits/) drawn by the game's own portrait code
                                                          # from the current pieces: compare, or rewrite those that differ
```
(`tools/char-pipeline/README.md` lists every tool. `make_victor.py` is Victor's older builder, kept for
reference.)

**The wardrobe's swappable pieces** (faces, hair, moustaches, tops, neckwear, trousers, shoes on one shared body per
gender) are built by `tools/char-pipeline/parts/` into `assets/characters/parts/<body>/`; its `manifest.py` alone
writes `assets/characters/parts/manifest.json` and `src/data/partsIndex.js`:
```bash
LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/bpy/lib python3 tools/char-pipeline/parts/build.py m   # the male pieces
python3 tools/char-pipeline/parts/manifest.py --check     # always after a build (format, budgets, shadow patches)
```
(Review sheets, the red-eye and poke-through tests: "Parts pipeline" in `tools/char-pipeline/README.md`.) The wardrobe's
tile pictures: `node tools/char-pipeline/parts/thumbs.mjs --port 9635` (after new pieces reach the index; it writes
`assets/characters/parts/thumbs/<body>/<slot>_<id>.webp` and `src/data/thumbsIndex.js`).

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
`python3 tools/room-pipeline/export_lamps.py` writes `src/data/roomLamps.js`, the lamps the game's halos glow round
(rooms and lobby; seconds a room, no re-bake; `build_all.sh` runs it at the end).
`vsref`, `walkcheck`, `perf` and `shoot` play the game in headless Chromium: serve the repo first
(`python3 -m http.server 8123 --bind 127.0.0.1`; `--url` names another address). They open the practice direct link
(`?mode=practice`: the plain address opens the main menu), and each says "last verified" with a date in its first lines.
Last run and working: 14 Oct 2026. The Blender steps (`bpy`) were not run in that check.

## Changing the rules or the floor

Every rule number — action points, costs, health, the deck, Lanterns to escape, the dawn round limit, locked rooms, the
timer — is in `src/data/rules.js`, which implements `docs/GAME_RULES.md`. The floor (rooms, their
doorways, furniture, which rooms are dark or locked, moods) is the room deck in `src/data/hotel.js`. Change those files,
not the game code — and per `CLAUDE.md`, not without the owner's approval of a before/after list.

Which ruleset a game uses is set in code, once per game: `src/main.js` calls `applyMode('practice' | 'match', guests)` (in `src/data/rules.js`) each time a game is dealt, from the menu's choice. The address does not choose it: a direct link (`?mode=practice`, `?mode=bots`) only skips the menu.

### Tests

```
python3 -m http.server 8123 --bind 127.0.0.1 &
node tests/rules-check.mjs        # the rules engine against docs/GAME_RULES.md
node tests/logic-check.mjs        # floor, map topology, grid, pathfinding
node tests/browser-practice.mjs   # practice mode in a real browser [--screens]
node tests/browser-bots.mjs       # the main menu and matches against bots in a real browser: settings, the table filling up, the lift, bots' turns, privacy, meetings both ways, being attacked, the end screen, whole matches [--screens] [--matches 3]
node tests/browser-lobby.mjs      # the baked starting room, fog rooms, tap to open / move, camera (big hotel), draw calls
node tests/browser-rooms.mjs      # the Infirmary and Switchboard icons in a real browser: grey at full health, once per match, 2 actions a ring, the search icon beside them when a dead guest's cards lie there, the spent mark, in a match [--screens] [--practice-only]
node tests/audio-check.mjs        # music and sound: unlock on the first tap, every file decodes, Settings, the menu -> lift -> game music, cues in a match and practice [--quick]
node tests/audio-buttons-check.mjs # which sound every button makes (pure, no browser): a new button must be listed with its sound, so it cannot slip onto the wrong one; and every cue has its file (~1 s)
node tests/audio-load-check.mjs    # how the sound files download, with the network and the clock faked: a failed download is tried again after 3 s, then 10 s (never in a loop), a 404 once, the night music's download starts with the lift, the end fanfares from round 3, nothing before the first tap (~3 s)
node tests/flicker-check.mjs       # the two corridors' flicker measured (at most 3 flashes a second of the whole room; steady, not moving at all, under Reduce Motion) (~5 s)
node tests/browser-build-fixes.mjs # the round 1 fixes in a real browser: End turn's question and the two-step card pick, the sounds, a one-card find and the map legend at the four iPad sizes, Reduce Motion [--only a,b,c,d]
node tests/trade-reveal-check.mjs # the trade scene: real trades for all seven outcomes (conversion with two new souls of your own, then your role; Lantern block; swap; you possess them; a soul spent on a guest already possessed; two souls crossed): soul faces, hands after, red eyes on known allies
# (the browser tests' launchers seed a saved profile 'tester' before each page, so the menu opens on the
#  main screen; tests/browser-profile.mjs starts with none, to check the register)
node tests/avatar-check.mjs       # avatars as drawn: every Look x every colour (the palette), every glasses style merged in and fitted to every face, every hairstyle on every face and every outfit mix assembled, runtime portraits framed like the stock pictures, red eyes on every Look x eye colour, the wardrobe at the three iPad sizes, your avatar in the lift, four tables in a row (memory, draw calls)
node tests/browser-wardrobe.mjs   # the Wardrobe and the Hotel Honours page: Surprise me and the tile pictures (no browser); at the four iPad sizes the fit, 44 px targets, the camera's shots; tile by tile (try-on, the details card, See achievement, Undo, a drag to turn, the keyboard, the Looks, Cancel, Save look); the testing switch off (try on, not kept); Reduce Motion [--skip sizes,flow,locked,motion] [--shots DIR]
node tests/browser-avatar-parts.mjs # guests made of pieces: a v1 profile's Victor from pieces renders like today's whole model (pixel difference), 2 draw calls a guest (3 with catchlights), a colour change repaints only, the possessed eyes, glasses merged in, a six-seat match within 18 calls for its guests, the menu's lobby one call a person
node tests/polish-check.mjs       # the round 2 polish, pure logic (no browser): the six seat colours stay apart for red-green and blue-yellow colour blindness (a simulation; the old lime set is the control that fails), the guest's initial, the "match in progress" marker (kept, taken once, 6 hours, damaged, blocked storage), the ring's numbers (~1 s; also in the GitHub Action)
node tests/browser-polish.mjs     # the round 2 polish in a real browser: the app icon and manifest from a sub-path, a match cut short (reload mid-match, Main menu, a finished match, a stale marker, direct links), keyboard focus on the screens over the game, touch scrolling of tall pop-ups, small text and the tight HUD at 1024x768 and 1024x694, the initials and rings [--only head,reload,focus,scroll,text,seats]
node tests/crash-check.mjs        # the frame safety net (src/ui/crash.js): a failing step is skipped, the card only after repeated failure, the ring of messages (~1 s; also in the GitHub Action)
node tests/browser-reliability.mjs # start-up and failures in a real browser: an old browser (no import maps), a blocked file (one automatic reload, then the card), slow loading (no false alarm), a failing step (the picture goes on, the card after repeats), the graphics context lost and back (portraits drawn again), the sideways / wider messages, the Version line [--screens]
node tests/profile-check.mjs      # profiles: the name rules, reserved words and filter, suggestions, profile repair (version 2, a version 1 profile migrated), the account (memory store, grant), seats and bots' avatars, seeded tables, the feed's name masking (~1 s)
node tests/wardrobe-check.mjs     # avatar v2 (no browser, ~40 s): the catalogue (the ten new items, the two locked sets, the one-line testing switch), the six Looks and the keys, v1 -> v2 for every v1 combination (about 10 million), making an avatar safe, pending pieces and the fallback gown bodies, the switch on and off with bugs A and B (an owned item kept at load and at the table; --only switch --root DIR runs them against an older copy), bots' looks over 2000 tables (never alike, eyes always show, about one in three wearing an unlockable), the clearer-eyes avatar [--only catalogue,looks,v1,safe,index,switch,bots,game]
node tests/honours-check.mjs      # the achievements (no browser, ~1 s): each of the five earned from matches scripted through the real rules engine, every rule against abuse (practice, test links, idle, unfinished, the side you started on, the Mirror and the block only while clean), device storage, and main.js checking them on the end screen only, once per game
node tests/browser-profile.mjs    # the first-run register, the profile card, Change name, blocked storage, usernames at the table, ?user=, long names [--screens] [--sizes 1024x768,1366x1024]
node tests/tips-check.mjs         # first-match tips ON: where they sit, never blocking, the clock runs on, once per device, Hide tips, Show tips again, the safe-zone / pinch-and-drag / round-buttons tips [--size 1024x768] [--shots DIR] [--new-only: just the new tips]
node tests/public-events-check.mjs # what the public events may carry (no browser, ~5 s): every public event of a few hundred bot matches has only its documented keys (a role, a hand, a card count or a private result can never ride along), and a new event type must be written down in the test
node tests/record-check.mjs       # Your record (src/record.js, an injected store, no browser, ~1 s): counting, "Left early", reset, saving, a second tab, damaged saves, blocked or missing storage
node tests/strip-check.mjs        # the top guest strip (no browser, ~2 s): the "Possessed" marker is exactly what the viewer's own knowledge says (either side, never a guess, never the viewer, nothing while a trade scene holds it back), and "3 turns left in Round 2" follows the engine's own turn order (the dead skipped, the final round says dawn)
node tests/discard-clock-check.mjs # the discard clock (no browser, ~1 s): 30 s left -> 30 s, 2 s left -> 10 s, clock off -> no limit; 6 cards no screen, 7 or 9 ask for exactly the number over; zero (or the 45 s clock out in the action phase) -> the engine's random discard of ordinary cards only, nothing public, then the turn passes; the countdown's words and the notice
node tests/docs-check.mjs         # the documents' facts (no browser, ~1 s): the numbers in docs/DECISIONS.md "Read this first" are rules.js's, the README's file list names every src/ file, the paths the documents name exist, the GitHub Action runs every fast suite, a preview server is bound to 127.0.0.1
node tests/run-fast.mjs           # every fast suite (the GitHub Action's list) in one command
node tests/howto-check.mjs        # the words that teach the game (no browser): the How to play pages follow the rules' numbers (a copy of the rules with every number changed), the round-4 rules are in the words (Infirmary once per match, Switchboard 2 actions, the discard's time limit: pages and tips), the hint, the role screen's lines, the tips, the end screen's recap, no "AP" anywhere the player reads (~1 s)
node tests/browser-learn.mjs      # How to play, the hint, the role screen, the Lanterns chip, the in-match Menu panel and what the clock does while it is open, the end screen's Victory / Defeat, at the four iPad sizes [--only a,b,c,d] [--sizes 1024x694,1180x820]
node tests/browser-turnflow.mjs   # the turn flow (round 4): the turn passing by itself when the actions run out (not with an action left, an Espresso or a free Trade, a reveal, a meeting or the card view open; once only; Practice and a match), the discard screen that closes by itself (no "Keep these 6"), the short found-card reveal, the walking speed [--only a,b,c,d,e]. The other browser suites switch auto end off (tests/smoke-lib.mjs autoEndOff)
python3 tools/audio/build.py      # rebuild every sound, ~6 min (tools/audio/README.md); needs numpy, scipy, ffmpeg
python3 tools/audio/build.py revolver lobby   # rebuild only these (effect or music names); updates library.js + report.json
node tools/balance/hotseat-sim.mjs 400 6   # 400 six-player matches under the rules as they stand (--before: same bots on the rules before Part 2; --compare: Lantern variants; --cautious)
node tools/balance/hotseat-sim.mjs --study  # six player personalities (tools/balance/personalities.mjs) + rule proposals, in memory only (tests/personality-report.md)
node tests/bots-check.mjs                  # the computer guests: information honesty, hundreds of seeded matches, determinism, the feed's icons
node tests/chat-check.mjs                  # quick chat: the 20 lines, the channel (about), the bots' talk and listening honesty (scrambled hidden state), talk alone never changes the game, sense, caps, pacing, answers (a minute or two)
node tools/balance/bot-match.mjs --n 1000  # all-bot matches at 6, 5 and 4 players: who wins, trust-building, blocks, waits
                                           # (--players 6, --trace one match, --tune blockBias=-0.2,... to try a bot knob)
                                           # --chat talk|on: the bots' quick chat on a clock (talk: must match --chat off exactly;
                                           # on: they listen too), with lines per match, accusations and how true they are;
                                           # --hear k=v / --say moment.key=v try a chat knob; --inject id[:partner]@round an exploit test
node tools/balance/tells.mjs --n 1500 --players 6  # can a player tell the possessed computer guests apart by how they move? (doors opened by round 2, standing still, parked by the Fire Exit; --tune k=v)
```
