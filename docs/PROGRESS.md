# Progress

_Last updated after the rules pass (Hotel Escape mechanics on the greybox)._

## Done
### Pass 1 — greybox exploration
Dollhouse camera (follow, 90° snap rotation, pinch zoom, two-finger pan), tap-to-walk with
pathfinding, room discovery with glowing doorways, per-room mood lighting, HUD, 2D map.

### Pass 2 — characters and five hot-seat players
Placeholder articulated figures (male/female body types, six outfits by silhouette and
colour), five players taking turns on one device, per-player coloured rings and an active
marker, a 14-room floor around a central landing.

### Pass 3 — the rules (this pass)
The full Hotel Escape rules from `docs/GAME_RULES.md` play on the greybox:
- **Turn actions** replace free roaming: usable doors blink; tap a door and confirm to move
  (1 AP) and walk to a free spot in the room; free repositioning inside a room; Search (1 AP);
  use a card (Bandage, 1 AP); Attack (1 AP, in an encounter). End turn refills AP to 4 and
  passes to the next living player. AP and whose turn it is are always shown.
- **Cards & hands**: the deck and every card type from the spec; 4 cards dealt per player with
  a guaranteed Lantern; one player secretly possessed and holding the 3 Possession cards; a
  hand panel showing each player's cards, health, the possessed tell, and who they've unmasked.
- **Searching**: 1 AP draws a card; dark rooms need a Flashlight.
- **Forced encounters**: entering a room with someone (first meeting there that round) forces
  Trade or Attack. The trade is a secret two-card exchange with the Lantern-blocks-Possession
  rule, the reveal-on-block, and the per-room-per-round lock, exactly as written. Knife
  (1 HP, reusable), Revolver (2 HP, 2 shots then discarded), Bandage healing.
- **Possession** spreads through successful trades with a private notification.
- **Win conditions**: a clean player with 3 Lanterns reaching the Fire Exit wins for the
  humans; everyone possessed (or all clean dead) wins for the possessed side. A clear end
  screen names the winner, reveals who was possessed, and offers a New game.
- All rule numbers live in `src/data/rules.js`.

## Validation status
- `node tests/rules-check.mjs` (pure rules), `node tests/logic-check.mjs` (floor/grid), and
  `node tests/browser-test.mjs` (headless Chromium: load with no console errors, the full turn
  flow, search + dark rooms, hand + bandage, trade block/reveal, possession spread, attack,
  both win screens, restart) **all pass**. Setup is in each file's header.
- Not yet tested on a real iPad.

## What to test on the iPad (Safari, landscape) — exercising every mechanic
1. **Start & tell.** Tap to begin. Open **Hand**: one player each turn will see a purple "You
   are POSSESSED" banner and Possession cards — note who (in hot-seat you can see it). Everyone
   has a Lantern.
2. **Move & search.** On a turn, tap a blinking door → **Move**. Then **Search** for a card.
   Walk to a dark room (Back Stairs Passage, Storage, Service Corridor) and try to Search
   without a Flashlight — it refuses; search one after finding a Flashlight.
3. **Trade — block & reveal.** Send the possessed player and a clean player into the same room
   (move one onto the other). On the forced encounter choose **Trade**: give the Possession
   card as the possessed player, give a **Lantern** as the clean one — possession is blocked,
   the clean player now "knows" the possessed one (check their Hand banner), and the Lantern
   changed hands.
4. **Trade — possession spreads.** Repeat, but have the clean player give a non-Lantern — they
   become possessed and now hold a Possession card (check their Hand).
5. **Attack.** Give a player a turn with a Knife or Revolver in hand, meet someone, choose
   **Attack** — the target loses health (watch the hearts in the turn strip). Two revolver
   shots discard it. Reduce someone to 0 to see them die and be skipped.
6. **Bandage.** After taking damage, open **Hand** and Use a Bandage to heal a bar.
7. **Win — humans.** Collect three Lanterns on one clean player (search / trade for them) and
   walk into the Fire Exit → "The humans escaped!".
8. **Win — possessed.** Let possession spread until no clean player is left → "The hotel keeps
   them", with the possessed revealed. New game reshuffles.
9. **Feel:** rule numbers in `src/data/rules.js`; the floor and dark rooms in
   `src/data/floor1.js`; camera/character feel in `src/config.js`.

## Open items (from the spec §11, deferred)
- Master Key, Lock Pick and Barricade are dealt (deck matches the spec) but have no effect —
  locked/hidden rooms are out of this build. Their cards say so.
- Deck balance, a possessed-side catch-up mechanic, and locked rooms wait for real
  multiplayer testing.
- Player names (Victor, Eleanor, Marcus, Beatrice, Henry) are placeholders.

## Known limitations
- Hot-seat shows all hidden information to the one player — by design for this build.
- Characters still don't path around each other (the active player's route can pass through a
  standing figure). Arrivals now avoid landing on top of someone.
- Three.js loads from a CDN; the first load needs an internet connection.
- Safari edge-swipe can't be blocked in-page; start two-finger drags away from the edges, or
  add to the Home Screen.

## Next steps
1. iPad test of the rules; tune numbers and feel from feedback.
2. Decide the deferred items above.
3. Later passes: main menu with the 3D lobby, character selection (outfits already in data),
   receptionist intro; then real art, sound, and true multiplayer (where hidden roles finally
   become hidden).
