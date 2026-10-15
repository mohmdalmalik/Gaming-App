# Hotel Escape — visual & UX QA report

Tested: the committed game (clean worktree `/home/user/wt-ui`, commit `7ef0b76`, served on
`http://127.0.0.1:8125/`), headless Chromium with software WebGL.
Viewports: iPad 1024×768, 1180×820, 1366×1024 (DPR 2, touch) and desktop 1440×900 (mouse), plus
mid-game resizes to portrait 820×1180 / 768×1024.
No game code was changed. All scratch scripts are `tests/qa-*.mjs`; screenshots are in
`tests/shots/qa/` (the `sheet-*.png` files are contact sheets that put 4 shots on one image).

## What was played

| What | Count | Result |
|---|---|---|
| Practice matches played to the end by a bot using the real UI (door taps, confirm bar, search icon, reveal, full-hand and discard prompts, Escape button) | 30 (seeds 1001–1030: 14 at 1180×820, 8 at 1024×768, 8 at 1440×900 with the mouse) | 30 of 30 escaped with 3 Lanterns, in rounds 9–23 (average 13). No console errors, no stuck states |
| Hot-seat matches, 4 / 5 / 6 players (the game clamps `players=2` or `3` up to 4), bot driving every pass, role, private-turn, pick and meeting screen | 12 (8×4p, 2×5p, 2×6p) | 5 clean escapes, 4 dawns, 2 "no clean guest left", 1 bot stall at round 6 (see M9) |
| All 23 room tiles and the Fire Exit placed with `revealTile`, guest in each, screenshot; 7 rooms in all 4 camera rotations | 24 rooms | `t-*.png`, `sheet-tiles-*.png`, `sheet-rot-*.png` |
| Scripted edge cases (practice + hot-seat) | about 40 | `ui-*.png`, `he-*.png`, `hidden-*.png`, `lay-*.png`, `w-*.png` |
| Raycast check: can the guest be hidden from the camera? 25 rooms × 4 rotations × ~150 standing spots | ~15 000 spots | `occlusion.json` |

A leak check ran on every public screen in the hot-seat matches: no role word, Possession card,
possessed portrait or purple tint was ever visible on a shared screen. Trades, searches and Hand
Mirror results appeared only on the private screens.

## Issues, ranked

Severity: **blocker** = the game can get stuck or be wrong; **major** = a player will hit it and it
hurts; **minor** = noticeable, easy to live with; **polish** = art-director nitpicks.

### Blocker

**B1. A guest with no cards who has to trade gets stuck on a screen with no button.**
- Steps: hot-seat. A guest has used up every card (a real possibility: bandages, keys, Espresso,
  Hand Mirror, Barricade are all used up). Someone walks in on them, has no weapon, and the only
  option is Trade.
- What happens: the empty-handed guest's private screen says "Give one card to Eleanor … No card
  you are allowed to give." There is no card and no Continue button, so the match cannot go on.
  The same happens if the guest who walks in has no cards.
- Screenshot: `shots/qa/he-a-emptyhand-pick.png`
- Suspected code: `src/ui/handoff.js:138`. `privatePick` hides the Continue button when there is no
  `onCancel`. `src/main.js:337-345` (`runTrade`) never passes one and never checks for an empty
  `tradeableCards(who)`.
- This is also a rules gap: GAME_RULES does not say what an empty-handed guest gives in a trade, so
  the owner has to decide it (give nothing, or the trade is skipped).

### Major

**M1. The search icon can sit on top of the "Move · 1 AP" / "Open" confirm button, so tapping Move
taps Search.**
- Steps: 1180×820, Storage Room or Service Corridor (search spot on the wall nearest the camera,
  seed 4242 with all tiles revealed), tap a door ring.
- What happens: the confirm bar ("Move to Ballroom?  Move · 1 AP  Cancel") appears, and the pulsing
  magnifier with its "Need a Flashlight" / "Search" label is drawn right over the Move button. A tap
  in the middle of the button lands on the search icon. In a lit room that walks the guest off to
  search and spends an action instead of moving. `elementFromPoint` on the button's centre returned
  the search icon in 2 of 4 rooms tried.
- It happens in ordinary play: in practice seed 1007 the icon covered the "Open · 1 AP" button 3
  times in one match. Before the bot was changed to work around it, its real taps on Move timed out
  because the icon took them.
- Screenshots: `shots/qa/confirm-storage.png`, `shots/qa/p-1007-icon-over-confirm.png`
- Suspected code: `styles.css:388` puts the confirm bar at bottom 244 px, and nothing stops the
  search icon's range (`src/ui/searchSpot.js:49`) from reaching it. The icon is added to `#hud`
  after the bar, so it is drawn on top. The icon should hide while the confirm bar is up, or its
  lower limit should end above the bar.

**M2. Double-tapping End turn in practice throws away a whole turn.**
- Steps: practice, double-tap "End turn".
- What happens: the turn counter jumps from 2 to 4 and the second turn's 4 actions are lost. In
  hot-seat the hand-over screen swallows the second tap, but practice has no screen in between.
- Evidence: log from `qa-06-ui.mjs` step 16.
- Suspected code: `src/main.js:286` (`doEndTurn`). It needs a short lock after a turn ends.

**M3. "Restart practice" wipes the game at once, with no "Are you sure?".**
- Steps: practice, open a door, tap "↻ Restart practice" (top right, just under the Round label).
- What happens: a brand-new hotel appears at once and all progress is gone. The button is also
  only 38 px tall (under the 44 px touch minimum) and sits where a thumb rests on an iPad.
- Screenshot: `shots/qa/ui-02-after-restart-air.png`
- Suspected code: `src/main.js:850`; `styles.css:145` (height 38px).

**M4. Tall furniture on the camera side hides the guest and shows its plain dark back.**
- Steps: stand in Guest Suite 416 (rotate once), the Library, the Storage Room, Housekeeping or
  the Dining Room with a wardrobe, bookcase or shelf on the wall nearest the camera.
- What happens: the guest vanishes behind a black box. In Suite 416 with one rotation Victor is
  completely hidden behind the wardrobe; in the Library only the top of his head shows. Walls on
  that side are lowered, but furniture is not. These backs also read as untextured: the tops of
  the Storage and Housekeeping shelves are flat navy slabs, and the search icon floats over the
  back of the piece it belongs to.
- Screenshots: `hidden-suite416-r1.png`, `hidden-library-r0.png`, `t-storage-r0-air.png`,
  `t-housekeeping-r0-air.png`, `sheet-rot-library.png` (r1), `sheet-rot-suite416.png` (r1)
- Suspected code: `src/render/cutaway.js` only lowers walls. Tall pieces against a lowered wall
  need to be lowered, faded or cut too, or the guest needs a see-through outline when hidden.

**M5. The search icon slides onto the HUD when its furniture is near the screen edge, and its label
gets cut off.**
- Steps: stand at the edge of a room, or rotate, so the flagged furniture is off to the side or
  behind the camera.
- What happens: the icon is pinned to 44 px from the edge. It then sits on top of the player
  portrait (`hidden-library-r1.png`, bottom left) or the Map button (`w-04-busy-normal.png`,
  bottom right). The "Need a Flashlight" label is clipped to "eed a Flashlight"
  (`hidden-storage-r0.png`), and the icon no longer points at any furniture. In the practice bot
  runs it also covered a door ring several times (reported as "covered by undefined", the SVG).
- Suspected code: `src/ui/searchSpot.js:49` (the limits only keep clear of the top strip and the
  fan, not the left panel or right-hand buttons) and `:87` (the x clamp of 44 is less than half the
  label width). Also `styles.css:296` (80 px box, wider caption).

**M6. With the iPad in portrait (or any window under 900 px wide) the hand covers the guest panel.**
- Steps: turn the iPad to portrait mid-game (tested at 820×1180 and 768×1024).
- What happens: the fan of cards is drawn over the name, health and action points. Nothing asks
  the player to turn back to landscape.
- Screenshot: `ui-18-resize-820x1180-air.png`, `ui-18-resize-768x1024-air.png`
- Suspected code: `styles.css:639-651` (narrow-width grid puts the fan row above the panel) and
  `src/ui/handFan.js:22` (`SUNK`: the cards hang below their strip, which is now the panel). The
  simplest fix is a "Please turn your iPad sideways" overlay in portrait. Landscape at 1024, 1180,
  1366 and 1440 is clean: no overlaps even with 8 cards and Escape + Trade + End turn showing
  (`sheet-lay.png`).

**M7. Tall furniture in the next room covers this room's near side.**
- Steps: Dining Room with an Infirmary to its south (camera side), rotated once.
- What happens: the neighbour's medicine cabinet stands in front of the Dining Room sideboard and
  its search icon, as if it were in the room. In other rotations a black wardrobe from next door
  rises behind the sideboard.
- Screenshot: `sheet-rot-dining.png` (r1 and r3)
- Suspected code: `src/render/cutaway.js`, same cause as M4.

**M8. The walking guest disappears behind a side wall while going through a doorway, especially
after rotating the camera.**
- Steps: walk through a doorway in a wall that runs toward the camera (tap rotate during the walk
  to see it clearly).
- What happens: that wall stays full height, seen edge-on as a long dark band down the middle of
  the screen. The guest crossing the doorway is hidden behind the near part of it. Two door rings
  also overlap at that doorway during the crossing.
- Screenshot: `w-walk-07.png` (Victor is the sliver at the doorway), `w-walk-06.png`
- Suspected code: `src/render/cutaway.js:18-19`. A wall that the active guest is inside or next to
  could be lowered as well.

**M9. (Not reproduced) one hot-seat bot match stalled on the screens at round 6.**
- Seed 2005, 4 players, round 6, 2 dead: the bot's screen-clearing loop ran 40 times without
  reaching the action phase or an end screen, so some screen kept reopening. Two reruns of the same
  seed played to the end. The diagnostics are now in `qa-07-hotseat.mjs` (it saves `hs-<seed>-loop.png`
  and the open screens). The logic agent may want to watch for the same thing.

### Minor

**m1. South doors and locked doors sit under the hand fan.**
- With the guest in the middle of a room at 1180×820, the south door's centre is under the cards.
  The ring itself is just above them. Tapping the door leaf opens a card instead.
- A locked door looks like a closed red door: no ring, no padlock. It sits behind the fan, so it is
  easy to miss (`ui-08-locked-next-door-air.png`). Tapping just inside it does explain the lock
  clearly.
- The practice bot tapped the real ring for each door it wanted in its last 21 matches.
  - In all 21, at least one ring it needed was off-screen and the player would have had to pan
    first. This happens most after the guest walks to a search spot in a corner, because the camera
    then centres on the corner.
  - In 9 matches the search icon was sitting on the ring.
  - In 3 matches a ring was under the fan.

**m2. Map: the padlock is drawn on top of the locked room's name ("Clo🔒room").**
- Screenshot: `ui-04-map-air.png`
- Suspected code: `src/map.js:147`. The mark goes 0.9 m into the locked room, where the label is.

**m3. Revolver "2 shots" badge is cut off by the next card in the fan ("2 sho").**
- Screenshots: `02-lobby-*.png`, `ui-03-fan-8-air.png`
- Suspected code: `styles.css:273` (badge top-right, under the neighbouring card).

**m4. Corpses overlap the living.**
- A guest who dies falls over across the neighbouring standing spot, and living guests then stand
  on or in the body.
- Screenshots: `he-k-corpse.png`, `hs-2001-clickfail-44290.png`
- Suspected code: `src/main.js:737` and `:480`. Standing spots only avoid living guests.

**m5. Dark rooms make the guest nearly invisible.**
- A navy suit on a dark floor in Service Corridor, Back Stairs Passage and Housekeeping. Only the
  ring shows (`t-serviceCorridor-r0-air.png`, `t-backCorridor-r0-air.png`).
- The mood is right, but the guest could keep a faint rim light or a small light of his own.

**m6. The active-guest marker floats about half a metre above the head.**
- From the game's camera it reads as a gold diamond on the floor behind the guest (every
  screenshot, e.g. `02-lobby-ipad.png`).
- Suspected code: `src/render/characterView.js:52` (`modelHeight` 1.66 + 0.3 + 0.18, but the models
  look about 1.2 m tall on screen).

**m7. Discarding is instant and cannot be undone.**
- One tap on a card in "Hand is full" throws it away, including Lanterns. The line says "discard 2"
  but not "tap a card".
- The two full-hand dialogs are titled "Hand is full" and "Your hands are full".
- Screenshots: `ui-10-discard-air.png`, `ui-11-fullhand-air.png`

**m8. Misleading line when a found card is left behind.**
- The toast says "Left the Knife in the kitchen counter.". The card actually goes to the discard
  pile, so searching there again will not find it.
- Suspected code: `src/main.js:515`.

**m9. Practice shows hot-seat words.**
- The Lantern text talks about trades and possession attempts (`ui-06-found-reveal-air.png`,
  `src/data/rules.js:84`).
- The card view says "🔒 Private" and the panel says "Private details".
- The Switchboard says "No guest is possessed right now" (`ui-14-switchboard-air.png`).

**m10. The top guest strip text is tiny.**
- The line under each name is 10 px and wraps to three lines ("Fourth Floor / Landing · 4 / cards ·
  ♥♥♥"). It is hard to read at arm's length on an iPad.
- Screenshot: `hs-2001-05-r1-action.png`. Code: `styles.css:684`.

**m11. A possessed guest holding 3 Lanterns sees an enabled "Escape · 1 action" button.**
- Tapping it shows a public toast ("The fire exit opens only for a clean guest…"), which tells the
  table they are possessed.
- The words are neutral, but the button could be disabled (it already is when they have fewer
  Lanterns) so nobody gives themselves away by accident.
- Screenshot: `he-d-possessed-escape.png`.

**m12. Attack cannot be undone.**
- Once "Attack" is tapped, the weapon picker has no Cancel or back button
  (`hs-2001-11-meeting.png`).

**m13. The Fire Exit feels unfinished next to the other rooms.**
- It is a bare dark-green box with one crate, and its green exit door is small and flat.
- For the room the whole game is about, it is the least dramatic tile (`t-exit-r0-air.png`,
  `lay-*.png`).

**m14. The practice win screen is understated.**
- "You reached the fire exit", and the guest simply vanishes (no walk-out, no celebration).
- Behind it the action bar shows "Escape —" and a greyed-out gold button (`p-1002-end-air.png`).

### Polish

**p1.** The hot-seat start subtitle wraps with "rounds)" alone on the last line
(`hs-2001-01-start.png`; `src/main.js:860`). The end-screen summary is one run-on line ending in an
orphan "Round 8 of 8" (`hs-2001-end-4p.png`).

**p2.** The parquet floors show square seams where the texture repeats (Ballroom, Library, Storage:
`p-1001-031-ballroom.png`, `hidden-library-r0.png`).

**p3.** Some open door leaves swing close to corner furniture (the round tables in the Dining Room
and Ballroom at r0). From this camera they look as if they pass through the table
(`p-1001-015-dining.png`).

**p4.** The flashlight hint on the dimmed search icon reads as a megaphone
(`p-1001-006-serviceCorridor.png`).

**p5.** The death marker is a flat red blob under the body. It works, but it looks cruder than the
rest of the art (`hs-2001-clickfail-44290.png`).

**p6.** The large white "searched" ticks float in the air over searched rooms. They are readable,
but look like debug marks (`hs-2001-end-4p.png`).

**p7.** The `?stats=1` read-out is drawn over the "YOUR TURN / NEXT" labels of the guest strip
(`w-00-six-in-lobby.png`).

**p8.** The search icon over the Switchboard desk floats about 1 m above it, over the next room's
floor (`t-switchboard-r0-air.png`).

## Checked and fine

- **Dark rooms.** With no Flashlight the icon is dimmed, says "Need a Flashlight" and a tap
  explains why. With one it goes live (`ui-07-*.png`).
- **Locked rooms.** A tap on the locked door explains it. The Lock Pick failed ("The lock pick
  snapped") and the Master Key opened the room. Both are offered in the card view as "Open
  Cloakroom · 1 action" (`ui-08-*.png`).
- **Barricade.** It lists every doorway by room name and the toast confirms it (`ui-09-*.png`).
- **Espresso.** It works at 1 and at 4 actions. The panel shows "6" with two bonus pips
  (`ui-12-espresso-6ap-air.png`).
- **Infirmary.** It heals to 3. At full health the button is dimmed and reads "Full health".
- **Switchboard.** The public notice stays up until someone taps Continue.
- **Linen Store.** It shows two cards side by side (`ui-15-linen-pair-air.png`).
- **Lobby.** Two guests together get no meeting and no Trade button (`he-b-lobby-two-guests.png`).
- **Fire Exit.** The voluntary trade works with accept or decline on a private screen. A clean guest
  with 3 Lanterns escapes to "The guests got out". Arriving with 0 actions shows "Escape · No actions
  left", and the next turn allows the escape.
- **Hot-seat screens.** Conversion, the private "Something has changed" screen, the Hand Mirror, the
  timer, "Time is up", the "Final round — dawn breaks when it ends" label and the dawn end screen all
  read clearly (`he-*.png`).
- **Rapid taps.** A double tap on the search icon costs 1 action, not 2. A double tap on "Add to my
  hand" is safe. A double End turn in hot-seat is safe.
- **Camera during walks.** Rotating mid-walk and resizing the window mid-walk both arrive correctly.
- **Walking.** At real speed the walk looks planted, with no visible foot sliding, and guests face
  where they walk and turn to face the furniture when they search.

## Performance

Measured in the busiest scene: all 24 tiles plus the lobby revealed, six guests, `?stats=1`.

| View | Draw calls | Triangles |
|---|---|---|
| Normal zoom | ~133 | ~291k |
| Zoomed right out | 274–337 | 387–420k |

The scene holds 1 260 meshes, 296 geometries, 41 textures and 13 shader programs, lit by 8 pooled
point lights plus a hemisphere light.

Headless software rendering on this shared 4-core machine ran at 1–2 fps, so frame rate cannot be
judged here. Draw calls are fine for an iPad. The triangle count and 8 point lights on every surface
are the numbers to watch on an older iPad when zoomed out, so the owner should open `?stats=1` on
the real device and zoom right out. Loading took 0.5–1.8 s and the console showed no errors or
failed requests in any run.

## What looks good

- **The art direction is coherent and warm.** The baked rooms (lobby, Ballroom, Library, Dining,
  Suite 416, Kitchen, Linen Stores) have real character: panelling, rugs, lamps, framed pictures.
  The low camera makes them feel like a dolls' house.
- **The six guests are charming and easy to tell apart.** Outfit colours, rings and the portrait
  strip all match. The walk and idle animations are smooth.
- **The UI style is consistent throughout.** Navy panels, brass borders, serif titles and the
  illustrated cards match on every screen. The found-card reveal, private screens, meeting panels
  and hand fan look polished and read well at every iPad size.
- **The hot-seat privacy flow is clean.** Every hand-over screen is neutral, and nothing private was
  seen on a shared screen in 12 matches.
- **In landscape, the HUD never overlapped** at any iPad or desktop size, even with 8 cards and three
  action buttons.

## Overall verdict

The game looks well above greybox level. Most rooms, the characters and the card art already feel
like one product. In one sentence: **the art is good, the camera and cutaway have not yet caught up
with it.**

The weak spots are all about the camera and the edges of the screen:
- tall furniture and side walls can hide the guest;
- the search icon wanders onto the HUD;
- doors near the bottom edge fall under the cards.

Two interaction bugs should be fixed before the owner's next play session:
- the empty-hand trade softlock;
- the double-tap End turn in practice.
