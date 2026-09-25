# PROGRESS

## Phase 0 correction pass (2026-09-17, later)

A small correction pass on the Phase 0 build. No Phase 1 work, no new multiplayer features, no
online code. Architecture, visuals, tests and the inactive multiplayer engine all preserved.

**1. Objectives — permanent public team progress.** Recorded against the room, never against a
player. Not a card, never dealt, never in a hand, not offerable, not stealable, never compellable.
`legacyCarriedExitKey: false` isolates the old carried Exit-Key model to the inactive engine.

**2. Exit — a safe end-zone resolved first.** Revealed globally at 3/3, flagged `safe`, arrival
resolved before any meeting or challenge, escape permanent, possessed guests may stand there with
no effect. `requiredEscapees: 1` in practice, `escapeesAtBalanceCount: 2` for six players.

**3. Meetings — pre-committed Offers.** `setOffer` only on your own turn; `resolveMeeting` takes
no callback, so no off-turn player is ever prompted; both Offers cleared on resolution and on
turn end.

**4. Map topology — corrected.**

| | Before | After |
| --- | --- | --- |
| Rooms / doorways | 18 / 21 | 18 / 21 |
| Rooms on every route to the exit | Service Corridor, Service Stairs | none |
| Articulation rooms | hall, corridorW, serviceCorridor, stairs, dining | corridorW, stairs (each cuts off only a dead end) |
| Routes to the Ballroom | Dining Room only | Dining Room or Suite 412 |
| Exit doorways | 1 | 2 |
| Doorway-disjoint routes to the exit | 1 | 2 |
| Dead ends | Ballroom, Housekeeping | Suite 414, Housekeeping |

Changes: the Storage Room was widened east to run beneath the Service Stairs and open onto the
Fire Exit; Suite 412 was deepened south to reach the Ballroom; the Service Stairs and Fire Exit
were deepened so Storage meets them; Suite 414 and Housekeeping became the two dead ends.

**5. Searchable corridors.** Every searchable room declares a `searchPoint` and all wording names
it. A console table was added to the North Corridor so each corridor search point is a real object.

**6. Dark rooms.** Atmosphere only. `darkRoomsRequireLight: false`, no Flashlight card, no gate.
The rules tests exercise the flag both ways so the Phase 1 rule stays covered.

**Tests run — all green**

| Suite | Assertions | Result |
| --- | --- | --- |
| `tests/rules-check.mjs` | 153 | pass |
| `tests/logic-check.mjs` | 67 | pass |
| `tests/browser-practice.mjs` (root) | 84 | pass |
| `tests/browser-practice.mjs` (`/Gaming-App/` sub-path) | 84 | pass |
| `tests/browser-test.mjs` (Phase 1) | — | skips, practice mode on |

Browser suite covers iPad landscape (1180x820), small iPad (1024x768) and desktop (1600x900):
no overlap, nothing off-screen, every control a comfortable touch size, console clean.

**Remaining ambiguity for the owner**
- The Service Corridor still has four doorways and the lobby four. Every other room has two or
  three. Both are deliberate hubs.
- Two rooms remain articulation points (West Corridor, Service Stairs) but each cuts off only a
  dead end, never an objective or the exit. That is what makes the dead ends possible.
- The turn timer itself is not implemented. The rule that a meeting costs the off-turn player no
  time is satisfied structurally (there is nothing to respond to); the timer lands with Phase 1.

**Phase 1 was not started.**


## Phase 0 — single-player practice mode (2026-09-17)

The build is now a **practice mode**: one guest, 18 rooms, 4 action points a turn, searching,
three card types, three objectives and a sealed Fire Exit. The multiplayer rules engine is
untouched and still tested — it is switched off by flags in `src/data/rules.js`, not deleted.

**Changed**
- `src/data/rules.js` — rewritten as the single rules configuration (phase flags, action points
  and costs, hand sizes, room/objective counts, practice seed, card catalogue, two decks).
- `src/data/floor1.js` — 14 → 18 rooms with explicit `role`s; added Ballroom (objective),
  Cloakroom (item), Suite 414 (item), Housekeeping Store (utility); deepened Suite 412 and
  nudged Storage so the new connections fit; moved furniture that blocked new doorways.
- `src/game/floor.js` — carries a room's `role` through to the built floor.
- `src/game/state.js` — practice option, objective tracking, `isRoomOpen` / `exitUnlocked`
  sealing the exit, practice win check.
- `src/game/actions.js` — role-aware `search`, `resolveFullHand`, `useHint`.
- `src/game/cards.js` — `buildDrawDeck(spec)` so practice deals its own three-card deck.
- `src/main.js`, `src/hud.js`, `src/map.js`, `src/overlays.js`, `src/ui/hand.js`,
  `src/ui/fullHand.js` (new), `index.html`, `styles.css` — practice interface.
- `tests/browser-practice.mjs` (new), `tests/rules-check.mjs`, `tests/logic-check.mjs`,
  `tests/browser-test.mjs` (skips while practice mode is on).

**Manual QA checklist — all covered by `tests/browser-practice.mjs` and run green**

| # | Check | Result |
| --- | --- | --- |
| 1 | Lobby → practice transition (Tap to begin) | pass |
| 2 | Movement into discovered rooms (1 AP) | pass |
| 3 | Entering new rooms costs 2 AP, shown before confirming | pass |
| 4 | Insufficient AP: doors stop blinking, Search disabled | pass |
| 5 | Room discovery and map updates | pass |
| 6 | A room can only be searched once | pass |
| 7 | Item-card collection | pass |
| 8 | Six-card hand limit | pass |
| 9 | Full-hand decision (take / use / leave), no silent discard | pass |
| 10 | Hint reveals one adjacent room, costs 1 AP, is consumed | pass |
| 11 | Objective discovery, header reads n / 3 | pass |
| 12 | Exit unlocks after 3 objectives, with a notice | pass |
| 13 | Entering the exit completes the run | pass |
| 14 | End turn refills AP, round advances | pass |
| 15 | Restart practice resets the hotel | pass |
| 16 | Touch interaction at iPad sizes (1180×820, 1024×768) | pass |
| 17 | Desktop layout (1600×900) | pass |
| 18 | GitHub Pages sub-path deployment (`/Gaming-App/`) | pass |

Assertion counts: 102 rules, 53 floor/pathfinding, 70 browser. Console clean.

**Known gaps / for the owner to decide**
- The lobby and the service corridor have four connections each; every other room has two or
  three. The lobby needs four so guests can spread out in Phase 1.
- Three rooms are still flagged `dark`. Phase 0 ignores the flag (there is no Flashlight card),
  so they can be searched normally; the flag returns with Phase 1.
- Objectives are not carried, traded or stolen in this phase, as specified.

# Progress

_Last updated after pass 12b: Victor v2 (designed model), grounded movement, model portraits and the interface pass — presented for the owner's visual review._

## Done
### Pass 12b — Victor v2, grounded movement, portraits from the model, interface pass
Against the owner's cartoon target (measured in `docs/CHARACTER_GUI_CHECKPOINT.md`):
- **Victor v2**: designed skull (jaw, chin, cheeks), hair cap with snapped hairline / side part /
  quiff, tapered brows + moustache, eyes/nose/ears/mouth on the face surface; lofted tailored jacket
  with conforming shirt V + peaked lapels, bow tie, cuffs, mitt hands, shoes; jointed rig (shoulders,
  elbows, hips, knees, ankles). 14,420 tris, 8 materials, 480 KB.
- **Movement**: phased walk (contact / passing / lift, hip bob, opposing arms with elbows); the game
  advances the walk by distance travelled ÷ the clip's measured stride (in the GLB), so feet don't
  slide; smooth Idle↔Walk fades; verified from the real game (`walk_check.mjs`).
- **Portraits** rendered from the model (normal + private possessed) replace the painted ones.
- **Interface**: coordinated bottom bar (no overlap at 1024×768 … 1366×1024 and in portrait), guest
  strip on a dark plate, ≥48 px targets, drawn card icons, map with labels clear of the arrow.
- Automated: all three suites pass; real-game screenshots at 4 rotations and 5 viewports; a
  deterministic 30 fps recording. **Not yet tested on a real iPad.**
- Remaining limitations (honest): hairline shows slight stepping at the temples in close-up; limb
  segmentation (capsule joints) is visible up close; a tiny within-cycle foot slide at
  contact/toe-off (the average is matched); headless captures can't show device frame rate.

### Pass 12 — first real 3D character (Victor, glTF)
Replaced only Victor's placeholder box figure with a real rounded, cartoon-style 3D guest built and
animated headless in Blender (`bpy`) and exported to `assets/characters/victor.glb`.
- **Look**: dark tuxedo, ivory shirt and bow tie, lapels, shaped hair and moustache, rounded hands
  and shoes, expressive brows; head tilted up so the face reads from the game's steep elevated camera.
- **Animation**: subtle **Idle** (breathing/sway) and a smooth in-place **Walk** loop that cross-fades
  by movement speed, with stride matched to speed (existing movement code still drives travel).
- **Integration**: `characterView.js` loads the model for the `tuxedo` outfit only; everything else
  (movement, collision, colours, selection ring/marker, death/restart, camera, rooms, rules, and the
  other four guests' box figures) is unchanged. Feet grounded; fits through doorways.
- **Cost**: 4,420 triangles, 6 materials, ~217 KB. Automated checks (all three suites + headless
  render/screenshots) pass; **not yet tested on a real iPad** — that's the owner's step.
- **Open product choice**: keep the painted portrait or switch to a model-rendered one
  (`assets/portraits/victor-model.jpg`, not wired). Painted stays active until the owner decides.
- Pipeline + preview + screenshot/record scripts live in `tools/char-pipeline/` (not shipped).
- One guest done for review before extending the style to the other four.

### Pass 11c — first real artwork (Victor + Lantern)
Integrated the first supplied art through the existing drop-in support:
- **Victor** now uses painted portraits — `assets/portraits/victor.jpg` (normal) and
  `victor-possessed.jpg` (private possessed look), registered in `PORTRAIT_ART` under his outfit
  (`tuxedo`). His **public strip portrait stays the normal image** regardless of his hidden role;
  only his own active-player panel shows the possessed portrait when he is possessed.
- **Lantern** now uses `assets/cards/lantern.jpg`, registered in `CARD_ART`; it fills the card's
  illustration area inside the ivory/brass frame.
- Supplied images were downscaled to iPad-suitable copies (~768px portraits, 640px card, ~50–70 KB
  each). Portrait cropping is framed with `object-position: 50% 20%` so the face sits well in both
  the square strip cell and the panel.
- Everything else keeps its placeholder. See `assets/README.md` for the naming/registration
  convention and the remaining art needed. Layout, camera, rooms, 3D characters and rules unchanged;
  all three suites pass (portrait assertions updated to accept an image or the SVG placeholder).

### Pass 11b — interface refinement (hand, cards, readability)
Small refinement pass on the new interface:
- **Open hand** balanced: larger cards that centre when the hand is short and scroll horizontally
  by touch when it is long (including extra Possession cards); the selected-card detail stays beside
  them.
- **Cards** match the concept: warm ivory faces, restrained brass borders, larger illustration
  areas, clear serif names (Possession keeps its purple/evil accent on the ivory face). Names,
  descriptions and values are all live text.
- **Lantern** now explains its two functions once each (trade-block, and collect-three-to-escape)
  with no repeated line. A **possessed** player is never shown an unconditional "reach the exit to
  win": the Lantern's escape note and the footer Exit-Key hint are hidden / reworded for them.
- **Readability**: disabled-action reasons and the card detail text are larger and higher-contrast.
  Added responsive rules so on smaller landscape iPads (~1024px) the player panel, hand button and
  action buttons never overlap (the "View hand" label collapses to the fanned backs + count).
- **Image portraits** now honour the possessed state: a dedicated possessed image is used when
  supplied, otherwise the normal image gets a cold wash — the public strip stays neutral. The
  drop-in manifests (`PORTRAIT_ART`, `CARD_ART`) are unchanged.
Camera settings and gestures untouched. All three suites pass; verified hand selection + scrolling,
Bandage use, trading, turn changes and the map at 11" and 1024px landscape.

### Pass 11 — interface redesign (Art Deco player interface)
Rebuilt the on-screen interface toward the two approved concept mockups — an elegant grand-hotel
look in charcoal, ivory and brass with a warm serif for names and labels — as real interactive
controls (not overlays on the mockups). Nothing about the camera, rooms, movement or rules changed.
- **Guest strip**: portrait cards with names, identity-colour underlines and clear *Your turn* /
  *Next* indicators. Possessed roles are never shown here.
- **Active-player panel**: larger portrait, health segments, action pips (+ a numeric count) and a
  *Private details* link. Possession stays private — only the current guest's own panel shows the
  tell (weird-eye portrait + a faint screen tint).
- **Hand**: a collapsible bottom sheet that keeps the room in view. Large illustrated cards; picking
  one shows its description, how it is actually used, and any valid action. Only Bandage is a
  standalone play; Lantern shows the Exit-Key track rather than a "Use" button. Closes on turn change.
- **Buttons**: a clear hierarchy — Search shows its cost, or a plain-language reason when it can't
  be used; the prominent End turn names the next guest; camera controls (rotate + Map) sit in a
  separate cluster. Generous touch targets, no hover-only actions, safe-area spacing.
- **Map**: a clean brass-framed floor plan with serif room names, the current position, searched
  ticks and dashed "unexplored door" marks, plus a legend. Discovery and player-visibility rules
  are unchanged.
- Portraits and card art are **labelled placeholders** (flat vector busts / tinted glyph cards) with
  drop-in support: register a file in `PORTRAIT_ART` (by outfit) or `CARD_ART` (by card type) and the
  image is used automatically. See "Artwork still needed" below.
All three suites pass (two interaction/assertion lines updated for the new hand flow); inspected on
an iPad-size viewport across the strip, panel, hand, trade, map and camera rotation.

#### Artwork still needed (to replace placeholders)
Portraits (head-and-shoulders, ~3:4, transparent or dark ground), one per guest/outfit:
Victor (black tuxedo, dark hair), Eleanor (midnight-blue ballgown), Marcus (navy suit + red tie),
Beatrice (emerald A-line gown), Henry (white dinner jacket, older, silver hair). Drop as
`assets/portraits/<name>.png` and register in `src/ui/portrait.js` → `PORTRAIT_ART`.
Card illustrations (square, ~512px), one per type: lantern, flashlight, knife, revolver, bandage,
possession, masterKey, lockPick, barricade, trinket. Drop as `assets/cards/<type>.png` and register
in `src/ui/cards.js` → `CARD_ART`.

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

- **Victor correction pass 2**: crown diagnosed (hair geometry correct; overexposure of a too-light
  hair albedo under the hall's overhead lights) and fixed in the asset; moustache, nose bridge, brows,
  eyes, ears, collar and bow tie reshaped to the sheet. Awaiting the owner's review.
- **Victor v5 (appearance rebuild to the character sheet)**: measured proportions, hair cap, face
  features, sloping tailoring, bigger splayed shoes, portraits re-rendered; verified in the game at
  four rotations, walk check and recording. Presented for the owner's review — other characters,
  rooms and GUI work stay paused until approved (`docs/CHARACTER_GUI_CHECKPOINT.md`).

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


---

# Phase 1 — hot-seat rules sandbox (SUPERSEDED — see "Rules reset" below; kept for history)

**What it is:** four to six people play the approved rules on one iPad, passing it round. There is
no server and no networking; online multiplayer is not implemented.

## How to start a six-player match
1. Open the preview: https://mohmdalmalik.github.io/Gaming-App/
2. On the start screen tap **Hot-seat · 6 players** (or open
   `https://mohmdalmalik.github.io/Gaming-App/?mode=hotseat&players=6` directly).
3. Tap **Tap to begin**. Each guest in turn is handed the device, reads their secret role alone and
   taps **I understand**.
4. Play. Every turn: a neutral pass screen → that player's private screen (role, news, hand, Offer)
   → their 45-second action phase.

`?players=4` and `?players=5` work too. `?timer=off` plays without the clock. `?seed=123` deals the
same hands and the same Possessor every time, for testing.

## What to test on the iPad
1. **Roles are private.** At the start, six pass-and-reveal screens. Check nothing private shows on
   the neutral pass screen, and that the role screen only appears after Continue.
2. **The public interface.** During a turn, check the top strip shows names, rooms and card counts
   and nothing else; there is no health row, no Trade button, no purple possessed wash.
3. **Offers.** On your private screen tap a card to offer it (or Nothing). Start the turn, then tap
   **Offer** in the bottom bar — it should still be changeable until your first action, and read
   "locked" afterwards.
4. **A meeting.** Walk onto another guest in a corridor. The result card should name both guests and
   say only what the table is allowed to know. If you were the one affected, the private card that
   follows is for you alone.
5. **Being possessed.** If someone converts you, you are told on **your** next private screen, not
   out loud. From then on your private screen offers **Try to POSSESS**.
6. **A Lantern block.** Offer a Lantern, let the Possessor come to you. The table should be told
   only that an attempt was blocked; your own private card names who tried.
7. **The clock.** Watch the bar in the top right. It should stop dead on every pass screen and every
   result card. Let it run out once: your Offer becomes Nothing and the turn ends.
8. **Objectives and the exit.** Find all three, watch the notice, walk a clean guest into the Fire
   Exit. They leave the hotel — check they vanish from the map, the 3D floor and the turn order.
9. **The end.** Either two clean guests get out, or the eighth round passes. The end screen is the
   only place roles are revealed.
10. **Practice is untouched.** Go back to the plain address: one guest, no clock, no pass screens,
    Restart practice still there.

## Balance finding worth your attention (a rules decision, not a bug)

`node tools/balance/hotseat-sim.mjs` plays 400 matches per row through the real rules engine with
simple bots. With the approved numbers it reports:

| Guests keep a Lantern in their Offer | Guests win | Conversions per match | Rounds |
| --- | --- | --- | --- |
| 100% | 100% | 0.51 | 3.0 |
| 50% | 99% | 0.66 | 3.1 |
| 0% | 96% | 0.86 | 3.2 |

**Six guests search the whole hotel in about three of the eight rounds and walk out.** Six players
× 4 action points × 3 rounds is 72 action points; the 16 searchable rooms cost 16 to search plus
the walking. The Lantern barely matters, and the round limit never comes into play.

The reason the possessed side loses is not the Lantern — it is that **they have no way to make a
meeting happen**. A meeting only occurs when a player walks into a room that already holds
someone, and six guests heading for six different unsearched rooms almost never collide. Half a
conversion per match is not a hidden-role game.

These are bots: they never talk, never suspect anybody, never waste a turn and never regroup, so
this is the *fastest* a table could possibly finish rather than a prediction. But the gap is large
enough that it will not be closed by real players being slower.

This is a rules decision and therefore yours. The levers, roughly in order of how little they
change: shorten the round limit (does not help — they win in 3); make the hotel bigger or the
action points fewer; require more clean escapees; give the possessed side something that draws
guests together or lets them follow one. Nothing in this pass has been changed on my own
initiative — the implemented rules are exactly the ones approved.

## Known limitations of this phase
- Online multiplayer is not implemented and no work towards it has been started.
- The voluntary lobby trade is switched off in hot-seat (it would show both hands). Practice and
  the legacy engine still have it.
- Everyone can still see the 3D hotel behind the hand-over screens; only cards, roles and Offers
  are hidden. That is deliberate — where each guest is standing is public information.
- Guest names (Victor, Eleanor, Marcus, Beatrice, Henry, Clara) and all art are still placeholders.
- Receiving a card in a meeting can take a player to seven cards; they are asked to discard at the
  end of their own next turn, not immediately.


---

# Rules reset — the owner's restored ruleset (superseded by the Lantern changes below)

`docs/GAME_RULES.md` is now the owner's design, implemented as written. Health and combat are
back on; Offers, Hint, Distraction, public objectives, the round limit and the two-escape win are
retired (git history keeps them). Practice mode is one guest finding the three key pieces and
escaping; hot-seat is 4-6 guests on one device.

## Test results
| Suite | Checks | Result |
| --- | --- | --- |
| `tests/rules-check.mjs` | 125 | pass |
| `tests/logic-check.mjs` | 67 | pass |
| `tests/browser-practice.mjs` (root and `/Gaming-App/`) | 43 | pass |
| `tests/browser-hotseat.mjs` (root and `/Gaming-App/`) | 70 | pass |

## Simulation — 400 six-player matches (`node tools/balance/hotseat-sim.mjs 400 6`)
Bots that search everything, heal when hurt, bring key pieces to one carrier (standing in for
table talk), always give a Lantern when they have one, and attack only a guest they have unmasked.
The possessed bot gives a Possession card whenever it has one and hunts clean guests.

| | |
| --- | --- |
| Clean guests win | about 60% |
| The hotel wins | 0% |
| No ending (stuck) | about 40% — in 9 of 10 of those a possessed guest is holding a key piece |
| Match length (finished matches) | median 5 rounds; the longest finished 120 |
| Meetings / trades / attacks per match | 19 / 19 / 0.3 |
| Possession attempts / succeeded / blocked by a Lantern | 3.2 / 0.5 / 2.7 |
| Lanterns given in trades | 27 per match |
| Bandages / Master Keys / Lock Picks used | 0.2 / 0.9 / 1.3 |
| Key pieces found | 2.95 of 3 |
| Deck reshuffles | none |

**What looks broken (recommendations only — nothing has been changed):**
1. **A possessed guest holding a key piece can stall the match for ever.** Possession spreads by
   trade, the possessed guest keeps the piece, and there is no round limit and no other way for the
   clean side to get it back except killing them — which needs a weapon, an attack, and knowing
   who to attack. Two-fifths of simulated matches never end for this reason. Possible fixes for
   you to choose between: a converted guest drops their key pieces; a possessed guest cannot hold
   pieces at all; a round limit that hands the match to the hotel; or accept it and rely on table
   talk and weapons (the bots barely attack: 0.3 attacks a match).
2. **The Lantern is too strong as written.** Twelve in a 40-card deck plus one guaranteed each,
   and giving one costs nothing you want, so competent guests give one in nearly every trade:
   27 Lanterns change hands per match and 5 of every 6 possession attempts are blocked. The
   possessed side converts about half a guest per match and never wins.
3. **The hotel never wins.** Follows from 1 and 2: possession does not spread, and the possessed
   guest does not die, so neither of the hotel's two win conditions is ever reached.
4. **Attacks are rare and weapons barely matter** (0.3 attacks a match) because nobody knows whom
   to attack until a Lantern unmasks someone. Real players will accuse and gamble more than bots.
5. **Locked rooms and keys work but rarely bite**: 1.5 rooms opened a match, no match was ever
   stuck for lack of keys.

The remaining stuck cases (about 4% of matches) are bot limitations, not rules problems — pieces
split between two guests who never manage to meet.

## Open questions (placeholders chosen where the rules are silent)
1. A room's card draw is once per room (as before); anything lying on the floor can always be
   picked up. Should searching draw a card every time instead?
2. The two locked rooms are chosen at random each match (never the lobby, its neighbours or the
   exit). Should they be fixed rooms in the floor data?
3. A Master Key or Lock Pick is used from the room next door to the locked room.
4. A Barricade stands until the guest who placed it starts their next turn.
5. A dead guest's Possession cards leave the game; everything else drops. Should Possession cards
   drop too, and what happens when a clean guest picks one up?
6. The exit room cannot hide a key piece (it is not searchable).
7. In hot-seat the possessed tell (portrait + tint) is shown only on the possessed guest's private
   screens, never on the shared screen. Online it can be on the main screen.
8. A found key piece is told privately; an ordinary card draw is still a public toast.
9. The end screen reveals everyone's role and who died.

## What to test on the iPad (hot-seat, two or three of you is enough)
1. **Roles.** Six pass-and-reveal screens; the pass screen shows nothing private; the possessed
   guest's private screen says POSSESSED and shows three Possession cards.
2. **The public screen.** Health hearts in the strip, no purple wash, no "possessed" anywhere.
3. **A trade.** Walk in on a guest in a corridor → Trade → pick a card → pass the device → they
   pick → pass back → you read what you received alone. The table sees only "Trade complete".
4. **Possession and the Lantern.** As the possessed guest, give a Possession card. If the other
   guest gave a Lantern, their private card says it burned; yours says they know. Otherwise they
   are told they are possessed on their next private screen.
5. **An attack.** With a Knife or Revolver, walk in on someone → Attack → pick the weapon → the
   result is public and their hearts drop. Kill someone and search the room: you take their cards.
6. **Dark and locked rooms.** Search says "need a Flashlight" in a dark room; a locked door says
   so when tapped; open it from the hand sheet with a Master Key or Lock Pick.
7. **The key.** Find pieces (a private card each), trade them to one guest, walk that guest into
   the Fire Exit: "The guests got out".
8. **The clock.** Stops on every pass screen and during meetings; running out ends the turn.
9. **Practice.** The plain address: one guest, no clock, find three pieces, escape.


---

# Approved rule changes — Lanterns are the way out (superseded in part by the dawn deadline below)

Applied exactly the owner-approved before/after list: the key pieces are gone and three Lanterns in a
clean guest's hand open the exit; a Lantern moves normally in an ordinary trade but is used up (with
the Possession card) when it blocks; Lanterns are never dealt; all search results are private; the
earlier placeholders are now written rules. Practice: find three Lanterns and reach the exit.

## Test results
| Suite | Checks | Result |
| --- | --- | --- |
| `tests/rules-check.mjs` | 141 | pass |
| `tests/logic-check.mjs` | 67 | pass |
| `tests/browser-practice.mjs` (root and `/Gaming-App/`) | 46 | pass |
| `tests/browser-hotseat.mjs` (root and `/Gaming-App/`) | 76 | pass |

One run of the hot-seat suite from the sub-path failed a single check while the simulator was
running alongside it and competing for the processor; which check was not captured. Five further
runs, including a clean full pass of every suite with nothing else running, all passed. The likely
cause is a timing-sensitive check (the turn clock) under load; watch for it if it recurs.

Found and fixed on the way (interface only, no rule change): the "Your hands are full → which card do
you leave behind?" prompt put six cards in one row that ran off both sides of the box, so some could
not be tapped on an iPad. It now wraps; the practice test checks every card is on screen.

## Simulation — 400 six-player matches per column (`node tools/balance/hotseat-sim.mjs 400 6`)
Only the first column is the game; the other three are comparisons run through the same engine.

| | **Approved:** Lantern burned · found by search only | Burned · 1 dealt each | To possessed · search only | To possessed · 1 dealt each |
| --- | --- | --- | --- | --- |
| Clean guests win | **50%** | 30% | 50% | 29% |
| The hotel wins | **34%** | 40% | 35% | 39% |
| Never ends (100+ rounds) | **16%** | 31% | 15% | 32% |
| … clean side can never reach 3 Lanterns | 16% | 28% | 14% | 29% |
| … Lanterns stuck with the possessed | 8.7 of 12 | 8.1 | 11.6 | 10.7 |
| … and no Possession cards left | 97% of them | 93% | 98% | 91% |
| Rounds when the clean side wins (median) | 3 | 3 | 3 | 3 |
| Rounds when the hotel wins (median) | 3 | 3 | 3 | 3 |
| Meetings per round | 4.2 | 4.5 | 4.3 | 4.4 |
| Possession attempts / succeeded / blocked | 4.3 / 2.5 / 1.8 | 4.9 / 2.9 / 2.0 | 4.3 / 2.5 / 1.9 | 4.8 / 2.8 / 2.0 |
| Lanterns found by searching | 8.0 | 3.6 | 8.0 | 3.6 |
| Lanterns burned | 1.8 | 2.0 | 0 | 0 |
| Attacks / deaths | 0.12 / 0.02 | 0.10 / 0 | 0.12 / 0.01 | 0.11 / 0 |

Bots: clean guests pick a "carrier" (the clean-looking guest holding the most Lanterns) and bring
Lanterns to them, standing in for table talk; anyone else gives a Lantern in every trade when they
have one, because they can't tell who is possessed. The possessed bot gives a Possession card
whenever it can, otherwise an ordinary card, and never gives up a Lantern.

**What still looks broken (recommendations only — nothing has been changed):**
1. **About one match in six can never end.** The hotel has used up every Possession card (blocks burn
   them), so it can't convert anyone else. The possessed guests hold 8–12 of the 12 Lanterns, so the
   clean side can never get three. There's no round limit, and the only way out is killing the
   possessed, which needs a weapon and knowing whom to kill (0.1 attacks a match). Options: a round
   limit (the hotel wins when it runs out); a possessed guest drops their Lanterns when unmasked or
   converted; Lanterns burned in a block go back into the deck; or a clean win when every Possession
   card is gone.
2. **Dealing one Lantern each makes the clean side weaker, not stronger** (50% → 30%). The Possessor
   gets one too and keeps it, only six are left to find, and guests who "defend" by giving their
   Lantern hand it to the possessed guest pretending to trade normally. The approved rule is the
   better of the two.
3. **Whether the blocking Lantern is burned or goes to the Possessor barely matters** (50/34 vs 50/35):
   burned Lanterns are gone, but ones handed to the Possessor are just as lost to the clean side.
4. **Matches are short: about three rounds either way.** With no Lanterns in hand at the start,
   nobody can defend early, so possession cascades fast; and when it doesn't, the 12 Lanterns sit in
   a 16-card deck, so three turn up almost at once. Real players will be slower than bots, but not
   six rounds slower.
5. **The discard pile never reshuffles at six players.** Six hands of four leave exactly 16 cards for
   16 searchable rooms, and each room draws once, so the deck runs out just as the last room is
   searched. Burned Lanterns never come back.
6. **Weapons barely matter** (0.1 attacks a match) — nobody knows whom to attack until a Lantern
   unmasks someone.
7. **Practice with a forced random seed** can be unwinnable about 1 time in 80 (the third Lantern is
   beyond the 16 room draws). The normal practice address uses a fixed deal that is winnable (the
   third Lantern is the fifth draw).

## What to test on the iPad
1. **Practice** (plain address): search rooms; every result says how many Lanterns you hold. Fill
   your hand to six and search again: all six cards fit in the "which card do you leave behind?"
   screen. Carry three Lanterns into the Fire Exit.
2. **Hot-seat** `?mode=hotseat&players=6`: nobody's private screen shows a Lantern at the start.
3. **Search in hot-seat**: the result appears on a private card; the shared screen only says
   "Marcus searched."
4. **Pass a Lantern to a teammate**: in the lobby, Trade, both pick — the Lantern arrives.
5. **A block**: offer a Lantern to the possessed guest's Possession card. Your private card says it
   burned and was used up; afterwards neither of you holds it.
6. **Escape**: a clean guest with three Lanterns walks into the Fire Exit → "The guests got out".
   A possessed guest with three does nothing.
7. **Barricade**: it stays up through everyone else's turn and comes down as your next turn starts.


---

# Approved rule change — the dawn deadline (current)

If no clean guest has escaped when round 8 ends, dawn breaks and the hotel wins
(`rules.roundLimit` = 8). The round reads "Round 3 of 8"; round 8 is marked as the final round in
the header, on the pass-the-device screen and on the private turn screen. Practice has no deadline.
Every other rule is unchanged.

## Simulation — 400 six-player matches, the rules as they stand (`node tools/balance/hotseat-sim.mjs 400 6`)
| | |
| --- | --- |
| Clean guests win | 51% |
| The hotel wins | 49% — 34% by possessing or killing every clean guest, 15% at dawn |
| Matches that never end | 0 |
| Match length, median rounds | 3 (3 when either side wins) |
| Reached dawn | 61 of 400 |
| … already stuck: neither side could have won | 58 (95%) |
| … clean side locked out, hotel could still convert | 1 (2%) |
| … still genuinely in play: three Lanterns within the clean side's reach | 2 (3%) |
| Lanterns at dawn: clean hands / possessed hands / deck / floor | 0.4 / 8.4 / 0.3 / 0 |
| Possession attempts / succeeded / blocked | 4.3 / 2.5 / 1.8 |
| Lanterns found / burned | 7.9 / 1.8 |

"Stuck" means the clean side can't reach three Lanterns (counting their own, the deck and the floor,
but not any held by possessed guests) and the hotel has no Possession cards left.

**Recommendations only — nothing has been changed:**
1. **Dawn fixed the endless matches, but nearly all of them were decided long before round 8.**
   In 95% of dawn matches the board was already a dead end: the possessed held about 8 of the 12
   Lanterns and had no Possession cards left. Those tables sit through up to five pointless rounds
   waiting for dawn. An early end when neither side can win (for example, "the hotel wins at once
   when the clean side can't reach three Lanterns and the hotel has no Possession cards left") would
   save that time. It's a rule change, so it's your call.
2. **Most matches are short.** The median match is three rounds, so the deadline only bites in the
   stuck matches above. The deadline number is not the lever for balance; the Lantern supply is.
3. **The balance is now close to even** (51 / 49), mostly because dawn converts what used to be
   endless matches into hotel wins.

## The flaky hot-seat check — found and fixed
**Which check:** the last one, "no console errors or failed requests". It was not a rules or clock
check.

**How it was found:** a frozen copy of the previous commit was run six times while four busy
processes kept every core loaded, as the simulator did. It failed in two of the first four runs,
each time on the console check only:
- `warning: dressing: could not load furniture/bookcaseClosedWide.glb: Failed to fetch`
- `error: THREE.GLTFLoader: Couldn't load texture Textures/colormap.png`

**Why:** every page load dresses its rooms by downloading furniture models and textures in the
background, after the page is already usable. The test opens a fresh page for each section. On a
busy machine the previous page was still downloading when the test left it, the browser cancelled
those downloads, and the game rightly warned that a model or texture had not loaded. The earlier
"request aborted" filter hid the network half of the same thing; it was treating the symptom.

**Fix:** the game now records when room dressing has finished (`window.__game.dressingDone()`, a
test hook). Before every page change, and before the final console check, both browser suites wait
for it. The "request aborted" filter is removed, so the console check is fully strict again — a
genuinely missing model or texture still fails the test. Nothing in the game's behaviour changed.

**Proof:** the fixed suite was then run four times under the same load — all four passed.

## Test results
| Suite | Checks | Result |
| --- | --- | --- |
| `tests/rules-check.mjs` | 148 | pass |
| `tests/logic-check.mjs` | 67 | pass |
| `tests/browser-practice.mjs` (root and `/Gaming-App/`) | 47 | pass |
| `tests/browser-hotseat.mjs` (root and `/Gaming-App/`) | 90 | pass |

New checks: no dawn during rounds 1–7 or before the last guest's round-8 turn; dawn the moment round 8
ends; an escape during round 8 still wins; dead guests don't lengthen the night; practice has no
deadline; "Round 1 of 8" in the header; the final round marked in the header, on the pass screen and
on the private turn screen; the final-round label never covers the guest strip at any of the three
screen sizes; the "Dawn breaks" end screen.

Found on the way (interface only): the first version of the final-round header label was long
enough to run over the guest strip on an iPad. The header now says "Round 8 of 8 · Final round"; the
full "dawn breaks when it ends" wording is on the pass and turn screens, where there is room.

## What to test on the iPad
1. Start a six-player hot-seat match: the header reads "Round 1 of 8".
2. Play into round 8 (or use `?timer=off` and end turns quickly): the header turns red and reads
   "Round 8 of 8 · Final round"; each pass-the-device screen and private turn screen says "Final
   round — dawn breaks when it ends".
3. Finish round 8 with nobody out: the end screen reads "Dawn breaks" and reveals who was possessed.
4. A clean guest who escapes during round 8 still wins.
5. Practice (the plain address): the header reads "Round 1", with no "of 8", and never ends by itself.


# Lobby art pass — the starting room to the reference's quality (current)

Style target: `docs/art-reference.jpg` (the image previously at `tools/char-pipeline/ref/hotel-reference.jpg`;
copied to the path the brief names). Only the Fourth Floor Landing changed; no rule, number, room size,
doorway, furniture footprint or interface panel changed. Comparison images: `docs/art-pass/`.

## What changed
- The lobby is one model built in Blender from the game's own room data, with soft light, contact
  shadows and warm lamp/sconce pools baked in (`tools/lobby-pipeline/`, loaded by `src/render/bakedRoom.js`).
  Dark walnut raised panelling with brass inlay, crown moulding and a dark cap at one cut height;
  cream stone floor; two burgundy rugs with gold borders; red velvet sofa and armchair; round walnut
  table; walnut console with brass pulls; brass lamps with warm shades; sconces; gilt-framed paintings;
  plants in brass-banded planters; a walnut lift in a brass frame; walnut door casings with brass
  plinths and thresholds. The previous hand-coded lobby (`hallDeco.js`) is gone.
- Walls fold down onto a dark cut cap when the camera looks over them, like a cut architectural model.
- Doorways (whole hotel): the yellow blocks are replaced by a soft glow at the threshold, a faint light
  spill in openings to undiscovered rooms, and a gently pulsing gold ring in front of each usable door.
- Choosing a door draws a dotted gold path from the guest and a tag over the door ("Explore · 1 AP").
- Camera lowered to 42° (was 56°) and slightly closer; `?camera=classic` shows the old view.
- `?stats=1` shows frames per second, the slowest frame, draw calls and triangles, for the iPad.

## Tests
rules-check, logic-check, browser-practice, browser-hotseat and the new browser-lobby (31 checks: model
loaded and matched to the data, walkable start spots, cutaway both ways, door cues, path + tag, cancel/
confirm, camera angles, stats readout, budgets, clean console), from the root and the `/Gaming-App/`
sub-path.

## Performance (headless Chromium, start view; iPad numbers need `?stats=1` on the device)
| | before | after |
|---|---|---|
| Draw calls | 271 | 89 |
| Triangles | 56k | 87k |
| Textures | 29 | 9 |
| Per-pixel lighting on lobby surfaces | Lambert × ~19 point lights | none (baked) |
| CPU time to submit a frame | 2.6 ms | 2.3 ms |
| Lobby download | — | 2.5 MB model + 0.8 MB light maps |

## What still differs from the reference
- The reference is a diagonal (45°) isometric view; the game's camera snaps in 90° steps (a concept
  default), so the lobby is seen square-on. A diagonal default would be a product decision.
- The reference shows neighbouring rooms around the lobby; here they stay dark until discovered (a rule).
- Seating: the reference has a sofa and two armchairs; the lobby keeps its existing footprints (one
  sofa, one armchair) so pathfinding is unchanged.
- The floor reads paler and its tile grid more visible than the reference's warm beige; the walls are a
  little darker overall, the velvet a little brighter.
- No door number plaques; paintings are simple placeholders.
- The characters are unchanged (separate pass), so they are lit live while the room is baked.

## What to test on the iPad
1. Open the preview, tap Begin: the lobby should look like the side-by-side in `docs/art-pass/`.
2. Rotate with ↺ ↻: the wall nearest you folds down to a low dark-capped stub; nothing floats.
3. Tap a gold ring by a door: a dotted path and an "Explore · 1 AP" tag appear; Cancel clears them;
   Move walks you through.
4. Add `?camera=classic` to compare the old angle; add `?stats=1` and note the fps / worst ms.
5. Walk around the furniture and into every doorway: nothing should block where it did not before.


# Approved rule changes — the random hotel map (current)

**Status: implemented, tested, committed.** One placeholder and the tile mix await the owner's
approval (below). Room art for the new tiles comes after the system is approved; they are grey boxes.

## What changed
- **A new random hotel every match**, built from a shuffled deck of 24 square tiles (8 m, the lobby's
  size) placed as doors are opened (`src/game/hotel.js`, deck in `src/data/hotel.js`). The fixed
  18-room map is retired (git history keeps it).
- **The lobby** keeps its baked look and starts with 3 or 4 open doorways, chosen each match; a
  closed-off side is shown as plain panelled wall (the lobby model now has both versions of each side).
- **The Fire Exit** is shuffled into the last five tiles of the deck.
- **Placement:** a new tile turns to a random orientation that fits (a doorway meets the door that was
  opened, doorway meets doorway and wall meets wall everywhere else). A tile that can't fit goes to the
  bottom of the deck. Until the exit is placed, the hotel can never close itself off.
- **Doors:** unexplored doorways are closed doors (a walnut leaf with a ring in front of it). Opening
  one costs 1 AP and reveals the room behind it; you stay put. Entering is a normal move (1 AP). The door
  swings open and stays open. A new room is empty, so opening never starts a meeting.
- **Practice** uses the random map too (a new hotel on every start and every Restart practice).
- **Locked rooms** are two tiles in the deck, locked from the moment they appear, never next to the lobby.
- Map: closed doors are drawn with a "?", jammed ones as wall.

## For the owner's approval
**Tile mix (24 tiles)** — the four "crossroads" have 4 doorways, "T" 3, "straight"/"corner" 2, dead ends 1:

| Doorways | Tiles |
| --- | --- |
| 4 (crossroads) | Lounge, Ballroom, Grand Corridor, Garden Lounge |
| 3 (T) | Dining Room, Library, Kitchen, East Corridor, West Corridor, **Service Corridor** (dark), **Storage Room** (dark) |
| 2 straight | North Corridor, South Corridor, Guest Suite 418, **Service Stairs** (dark) |
| 2 corner | Corner Corridor, Guest Suite 410, **Back Stairs Passage** (dark), *Cloakroom* (locked) |
| 1 (dead end) | Guest Suite 412, Guest Suite 414, *Guest Suite 416* (locked), **Housekeeping Store** (dark) |
| 1 | Fire Exit (safe, not searchable) |

5 dark rooms of 23 (22%; the old map had 4 of 17). Every room except the lobby and the exit can be
searched once (23 searches available; the old map had 16).

**Placeholder — jammed doors:** if no tile left in the deck can fit behind a door, the door is jammed: it
stays shut for the match and trying it costs nothing. Rare before the exit is placed (about 1 match in
12 in the generator test, 0.01 per simulated match); the never-close-off rule guarantees another way on.

## Tests
rules-check, logic-check (tiles in every orientation; 400 hotels grown to the end: no overlaps, every
room walkable, the exit always reached, never closed off), browser-practice, browser-hotseat,
browser-lobby — all passing, from the root and the `/Gaming-App/` sub-path.

## Performance
Lobby view at the start: 54 draw calls. With 13 rooms revealed: 154 draw calls, 1.3 ms to prepare a frame
(the old fixed map: 271). The light count is fixed (a pool of 8), so no shader rebuilds as the hotel grows.
Rebuilding the walkable grid after a door opens: at most ~30 ms for a full hotel.

## Simulation — 400 six-player matches (`node tools/balance/hotseat-sim.mjs 400 6`)
Bots now open doors. By default clean guests explore whenever the Fire Exit is still hidden (open a door,
go in, search); `--cautious` bots only open doors once nothing known is left to search.

| | |
| --- | --- |
| Clean guests win | 10% |
| The hotel wins | 90% |
| … by possessing or killing every clean guest | 80% |
| … at dawn | 11% |
| Matches that never end | 0 |
| Match length, median rounds (all matches) | 3 |
| … when the clean side wins | 5 |
| … when the hotel wins | 3 |
| Reached dawn | 42 of 400 |
| … no peaceful way left (3 Lanterns only by taking them from the possessed) | 23 (55% of dawn matches) |
| … 3 Lanterns still reachable without a fight | 19 (45% of dawn matches) |
| Lanterns at dawn: clean hands / possessed hands / deck / floor | 0.8 / 8.3 / 1.5 / 0.0 |
| Fire Exit revealed: median round | 4 (never revealed in 309 of 400) |
| … by round 1-2 / 3-4 / 5-6 / 7-8 | 1% / 11% / 9% / 2% |
| Tiles explored per match: median (fewest-most) of 24 | 13 (3-24) |
| Doors opened / jammed per match | 13.30 / 0.01 |
| Meetings per match: median (average) | 15 (18.07) |
| Meetings per round | 5.00 |
| Hotel closed itself off before the Fire Exit | 0 times |
| Possession attempts / succeeded / blocked | 5.84 / 4.41 / 1.44 |
| Lanterns found / burned | 6.28 / 1.44 |
| Attacks / deaths | 0.14 / 0.01 |

With cautious bots the clean side wins 2%. Before this change (fixed map, same bots): clean 50% / hotel
50%, 2.5 possessions per match, 4.4 meetings per round, 7.9 Lanterns found.

**Recommendations only — nothing has been changed:**
1. **The Fire Exit rarely turns up in time.** It appeared in fewer than a quarter of matches. Being in the
   last five of 24 tiles means about 20 doors must be opened first, and a match opens about 13 before
   possession or dawn ends it. Options: shuffle the exit into the second half of the deck instead of the
   last five, use a smaller deck, or make opening + entering cheaper.
2. **Possession now dominates early.** Everyone starts packed in one lobby and the hotel grows a room at a
   time, so guests crowd into the few rooms there are: more forced meetings (5.0 a round, was 4.4) while
   holding fewer Lanterns (exploring costs action points). Possessions that succeed rose from 2.5 to 4.4
   per match and most matches end by round 3. Options: always 4 lobby doors, or the lobby's
   neighbours revealed at the start, or a meeting only when entering a room you did not just open.
3. The never-close-off rule held in every simulated match (0 times), as did the tests.

## What to test on the iPad
1. Open the preview: the lobby should look as before, with 3 or 4 walnut doors; any closed-off side is
   plain panelled wall. Restart practice a few times: the doors change.
2. Tap a door's ring: "Open this door?" with an "Open · 1 AP" tag. Open: the door swings open, a grey room
   appears behind it, you stay in the lobby with 3 AP left.
3. Tap the ring again: "Move · 1 AP" with a dotted path. Move: you walk in.
4. Keep exploring: rooms fit together, doorways always meet doorways, and there is always a closed door
   left somewhere until the Fire Exit appears (it is one of the last five rooms).
5. Map: closed doors show a "?"; a locked room shows a padlock.
6. Hot-seat: opening a door never starts a meeting; walking into a room where someone stands does.
7. With many rooms open, add `?stats=1` and note the fps.
