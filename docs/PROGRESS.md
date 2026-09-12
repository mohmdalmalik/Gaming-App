# Progress

_Last updated after the first graphics pass (starting room dressed with real models)._

## Done
### Pass 10 — starting room craftsmanship refinement
A quality pass over the starting room (hall only), driven by feedback and the hotel reference:
- **Furniture geometry**: the sofa, wing chair, coffee table and console are rebuilt with rounded
  edges (Three's `RoundedBoxGeometry`) — softened cushions, gently reclined curved backs, shaped
  rolled arms, welt/piping seams — and every leg now rises from the floor to the piece it supports
  (no floating gaps). Matte fabric reads clearly as cloth against the wood.
- **Surfaces**: the parquet is much quieter (close warm plank tones, hairline seams instead of
  black gaps, soft lengthwise grain); the rug is a restrained woven burgundy with a simple gold
  border (no busy medallion/chevrons).
- **Brass** now uses a Phong material so it catches a restrained specular highlight from the room's
  warm lights (polished metal) instead of the old flat self-lit look; lamp shades stay self-lit.
- **Grounding**: the seating group sits on the rug, which was hiding its floor contact shadows, so
  each of those pieces gets a soft shadow on the rug surface; legs connect to their furniture.
- **Plants** are rebuilt with recognizable tapered leaf blades in a terracotta pot.
- **Doorway indicators** are softened to a translucent brass-gold glow that fits the palette while
  staying clearly visible (a shared indicator, so this is a subtle change in every room).
Kept lightweight: the whole scene renders in ~350 draw calls / ~28k triangles. Layout, camera,
characters, UI, rules and walking routes are unchanged; the shared model loader and other rooms are
untouched. All three suites pass; inspected at normal and close zoom from all four camera angles.

### Pass 9 — starting room as the craftsmanship benchmark
Elevated the starting room ("Fourth Floor Landing") to be the visual benchmark for the rest of the
game, still entirely from lightweight procedural geometry + small canvas textures (no downloads).
Bespoke upholstered furniture replaces the generic kit for this room only: a camel two-seat sofa
(rolled arms + throw cushions), a green velvet wing chair, a walnut-and-glass coffee table with a
book shelf, and a three-drawer console with brass pulls — with coordinated wood-grain and fabric
textures. Added real architectural relief (walnut skirting, a picture rail, a cream crown cornice)
and refined walnut door surrounds around all four openings, kept clear of the game's gold doorway
markers so there is no flicker and the "leads somewhere" cue still shows. Carefully placed period
objects: a glowing brass table lamp, a rotary telephone, book stacks, a second framed picture (a
warm landscape), a longcase clock and a luggage stack by the lift. The centre and the four doorway
lanes stay clear; collision/walkability is unchanged (it still comes from the same floor1.js
footprints). Everything wall-mounted lowers/hides correctly on camera rotation. Other rooms and the
shared model loader are untouched. All three suites pass; inspected from all four camera angles.
See `docs/DECISIONS.md` → "Starting room — benchmark craftsmanship pass".

### Pass 8 — Art Deco upgrade of the starting room
Recreated the reference concept for the starting room only ("Fourth Floor Landing"), all from
lightweight procedural geometry + small canvas textures (no downloaded assets): ivory upper walls
with walnut lower panelling and brass detailing, walnut parquet, a patterned burgundy rug, brass
wall sconces, a framed Art Deco sunburst, and a proper hotel lift (double doors, decorative
surround, sunburst pediment, floor indicator, call button). Warm lighting keeps wood/cream/brass
distinct. Wall decorations correctly follow the wall cutaway on rotation (nothing floats). Layout,
doorways, furniture, walking paths, characters, interface, camera and rules are unchanged; other
rooms keep their current look. All suites pass; verified movement + cutaway.

Flicker follow-up: the owner reported z-fighting near the doorways and the picture. The doorway
surrounds overlapped the game's own bright exit markers, so they were removed (the panelling and
those markers already frame each opening); the picture and lift pieces were re-layered so no two
visible faces sit at the same depth. Verified in a headless screenshot; no more shimmer.
See `docs/DECISIONS.md` → "Starting room — bespoke Art Deco pass". (Floor is basket-weave parquet;
herringbone is an easy follow-up.)

### Pass 7 — two rule refinements + a furniture placement fix
- **Possession cards & the hand limit**: Possession cards no longer count toward the 6-card
  hand limit (a possessed player is never forced to discard because of them) and are hidden
  from the on-screen card count, so the number others see can't reveal who is possessed. They
  stay fully tradeable. (`countableCount` in cards.js; used by the hand limit, the HUD count and
  the discard prompt.)
- **Starting room is a SAFE ZONE** (`safe: true` in the room data): no forced encounters there,
  no attacks, but players may still trade voluntarily via a new **Trade** button (trade-only,
  cancellable, normal trade rules). Other rooms can be flagged safe the same way later.
- **Furniture placement fix**: Kenney models have off-centre pivots, so pieces were poking
  through or floating off walls. Models are now recentred on load (centred on X/Z, resting on
  the floor) so every piece sits flush and matches its collision box; the hall was re-tidied.
- `docs/GAME_RULES.md` updated for both rule changes. All suites pass (rules/logic/browser), with
  new tests for the possession count, the safe room and voluntary trading.

### Pass 6c — furniture facing fixed + rooms dressed by theme
- **Facing bug fixed**: furniture was placed at the wrong rotation (e.g. the hall sofa faced
  into the wall). Worked out that every Kenney piece faces +Z at yaw 0, and set each piece's
  rotation so it faces into the room.
- **Themed rooms (4 total)**: dressed the **library** (bookcases — where they belong — a reading
  chair, lamp, rug), the **lounge** (two sofas round a coffee table), and the **dining room**
  (round table + chairs + sideboard), in addition to the **hall**. Rooms with no matching
  models (kitchen, storage, corridors, guest suite, stairs) are left greybox on purpose — no
  out-of-place furniture.
- **Pathways verified**: a script moves through every doorway and checks each dressed room is
  fully walkable — all 14 doorways pass, spawns clear, rooms 99–100% navigable.
- **Floor-disappearing bug fixed** (instanced floor was being wrongly culled in far rooms).

### Pass 6b — starting-room furniture refined
Refined the dressed starting room's furniture only (lighting, gameplay, other rooms unchanged):
- **Scale**: furniture is enlarged ≈2–2.6× so it reads at a believable size next to the
  characters (bookcases now clearly taller than a person, a generously sized sofa). Each piece's
  collision footprint was scaled to match.
- **Arrangement**: composed into intentional groupings — a sofa + lounge chair around a glass
  coffee table on a rug (south-west), a reading nook of two bookcases + a chair + a floor lamp
  (north-east), a console with a table lamp + a plant (south-east), and the lift + coat rack +
  plant at the entrance (north-west) — with the centre and all four doorways kept clear.
- Verified spawns, doorways, the central walking area, and piece overlaps before committing.

### Pass 6 — first graphics pass (starting room only)
The **starting room** ("Fourth Floor Landing") is now dressed with real Kenney CC0 glTF models —
a warm, cosy, late-1980s grand-hotel sitting room — as a visual test of the art direction. Every
other room is still greybox and untouched, and all gameplay, rules, camera, controls, characters,
doorways and collision are unchanged.
- **Assets organised** from the loose repo-root upload into `assets/models/furniture/` and
  `assets/models/building/` (texture in `building/Textures/`).
- **Warm walnut / cream / brass** recolour of the neutral kit, warm wood floor, wall panelling,
  polished-brass lift doors, and a seating group (sofa, two lounge chairs, glass coffee table on a
  red-brown rug), bookcases, a console + table lamps, a floor lamp, plants and a coat rack.
- **Warm lamp lighting** via the existing per-room mood system (lights dropped to lamp height,
  emissive lampshades).
- The loader (`src/render/models.js`) and dressing (`src/render/roomDressing.js` + data in
  `src/data/dressing.js`) are room-agnostic, so the same approach can dress other rooms later.
- See `docs/DECISIONS.md` → "Real art — room dressing" for how it fits together.


### Pass 1 — greybox exploration
Dollhouse camera (follow, 90° snap rotation, pinch zoom, two-finger pan), tap-to-walk with
pathfinding, room discovery with glowing doorways, per-room mood lighting, HUD, 2D map.

### Pass 2 — characters and five hot-seat players
Placeholder articulated figures (male/female body types, six outfits by silhouette and
colour), five players taking turns on one device, per-player coloured rings and an active
marker, a 14-room floor around a central landing.

### Pass 5 — interface pass (this pass)
- **Portraits**: placeholder SVG faces (normal + possessed "weird eye"), behind one `makePortrait` call so real faces can replace them later.
- **Bottom-left active-player panel**: portrait, name, three health bars, AP. When the active player is possessed the portrait shows the weird eye and a subtle screen tint appears — both driven by the possessed flag.
- **Top players strip**: small portrait + name per player, active one highlighted with a TURN tag, dead crossed out; portraits never reveal possessed roles.
- **Bottom hand**: the active player's cards face down with a live count badge (updates on trade/search/use/discard); tap to open the full hand.
- **Hand limit 6**: at End turn, over-limit players discard down to 6 (choosing which) before control passes. Value in `src/data/rules.js`.
- Layout keeps AP, turn indicator, rotate, End turn and map, with nothing overlapping and the play area clear.

### Pass 4 — rules refinements
- Entering an **undiscovered** room now costs **2 AP** (1 discover + 1 move); a known room costs 1. Usable-door blink and the confirm bar reflect the real cost.
- **Searching**: only searchable room types (guest suite, lounge, library, kitchen, storage, dining) can be searched — not corridors/landings/stairs — and each room only once. The Search button disables when a room can't be searched.
- **Encounters**: entering a room with several people lets you **choose which one** to trade or attack; only that pair is locked for the round.
- **Death**: a killed character lies on the floor with a blood pool where they fell.

### Pass 3 — the rules
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
0. **The dressed starting room (new).** Tap to begin: the first room should look like a warm hotel
   sitting room — wood floor, walnut walls, brass lift doors, a sofa/chairs/coffee-table seating
   group on a rug, bookcases, lamps and plants — while everything still plays as before. Walk
   around: you should move freely, not walk through furniture, and all four doorways still work.
   Every other room is still greybox (that's expected — this pass dressed one room only).
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
