# GAME_RULES.md — Hotel Escape (working title)

## 0. What this build is — TWO PLAYABLE MODES

The shipped build has two modes, chosen on the start screen (and by the address, so a mode can be
bookmarked). Every number in both lives in **`src/data/rules.js`**; `applyMode()` at the bottom of
that file is the only thing that switches between them.

| Mode | Address | What it is |
| --- | --- | --- |
| **Practice** (default) | `/` | PHASE 0. One guest exploring the hotel. Unchanged by Phase 1. |
| **Hot-seat** | `/?mode=hotseat&players=6` | PHASE 1. The approved rules, 4-6 people passing one device. |

**Online multiplayer is not implemented.** There is no server, no networking, no matchmaking, no
accounts and no database anywhere in this project. Hot-seat is entirely local.

Section 0 below describes practice mode; **section 0b describes the hot-seat rules**, which are
the approved v1 ruleset.

## 0a. PHASE 0: PRACTICE MODE
The shipped build is a **single-player practice mode** for validating movement, the map, action
points, searching, cards, objectives and the exit. It is not the multiplayer game.

What is ON in Phase 0:
- One guest (Victor). 4 action points a turn. 18 logical rooms laid out for a six-player game.
- Room discovery, searching, three card types (Lantern, Hint, Distraction), a 6-card hand limit.
- Three objectives to find; the exit stays hidden and sealed until all three are in.
- End turn, Restart practice, the 2D map, iPad touch controls.

What is OFF in Phase 0 (the rules and code are still here, behind flags in `src/data/rules.js`):
- Other players, the hidden Possessor, possession, forced meetings, trading, challenge/combat.
- Health and damage (`healthEnabled: false`) — nothing can change health, so nothing is shown.
- Locked doors (`lockedDoorsEnabled: false`) and the round limit (`roundLimitEnforced: false`).
- Online multiplayer (`onlineMode: false`).

Every number lives in **`src/data/rules.js`**. Nothing else hard-codes a cost or a count.

### Phase 0 map (18 rooms, six-player balance layout)
| Role | Count | Rooms |
| --- | --- | --- |
| Lobby (safe start) | 1 | Fourth Floor Landing |
| Item search | 12 | West/North/East corridors, Suites 412 and 414, Back Stairs Passage, Kitchen, Service Corridor, Storage, Service Stairs, Dining Room, Cloakroom |
| Objective | 3 | Lounge, Library, Ballroom |
| Utility (searchable, empty) | 1 | Housekeeping Store |
| Exit (sealed until 3/3) | 1 | Fire Exit |

Two dead-end branches (Guest Suite 414, Housekeeping Store). Two or three connections per room,
except the lobby and the service corridor, which are hubs with four. No locked doors. The layout is
fixed and the deal is seeded (`rules.practiceSeed`), so the same hotel comes back every time.

**Topology guarantees** (enforced by `tests/logic-check.mjs`, which fails if any of these breaks):
- Every room is reachable from the lobby.
- **No non-lobby room controls all access to the exit.** The Service Corridor and the Service
  Stairs are named explicitly in the test, because they used to.
- Two routes from the lobby to the exit that share no doorway: through the Storage Room, and
  through the Service Stairs.
- Every objective room has more than one route to it. The Ballroom is reachable through the
  Dining Room *and* through Guest Suite 412.
- The lobby has four ways in; the exit has two.
- The two dead ends are an item room and the utility cupboard, so nothing needed depends on them.

### Objectives — permanent public team progress
An objective is recorded against the **room**, never against a player. It is not a card, is never
dealt, never enters a hand, cannot be chosen as an Offer, cannot be taken by a Challenge, and no
player can ever be forced to give one up. `rules.legacyCarriedExitKey` is `false`; the old
"three Lanterns in one hand are the Exit Key" model belongs to the inactive Phase 1 engine only.

### The exit — a safe end-zone, resolved first
- Hidden and sealed until every objective is found, then revealed to everyone at once.
- Flagged `safe`, so arriving there can never trigger a meeting or a Challenge.
- **Arrival is resolved before anything else in the room.** A clean guest escapes on entry and
  that is permanent. A possessed guest may stand in the exit and nothing happens.
- `rules.requiredEscapees` is 1 in practice (there is one guest). `rules.escapeesAtBalanceCount`
  is 2, the six-player target, and is used the moment more guests exist.

### Meetings — pre-committed Offers, no off-turn prompts
Each player chooses what they are willing to hand over **on their own turn** (`setOffer`), and the
possessed side commits its hidden trade-or-possess intent at the same moment. Walking into an
occupied non-lobby room then resolves the meeting from the two stored Offers with no further
input: `resolveMeeting(state, floor, mover, other)` takes no callback, so there is nothing it
could ask the off-turn player. Both Offers are cleared the instant a meeting resolves, and an
Offer never survives the turn that set it. Nobody is ever made to spend time, or another
player's clock, responding out of turn.

### Dark rooms — atmosphere only (deliberate v0.1 decision)
Four rooms keep a `dark` flag. In v0.1 it drives lighting and mood and nothing else: dark rooms
are entered and searched exactly like any other, `rules.darkRoomsRequireLight` is `false`, and
there is no Flashlight card. Turning the flag on restores the Phase 1 gate, and the rules tests
exercise both settings.

### Searching names the search point
Every searchable room declares a `searchPoint` — the console table, the laundry cart, the
sideboard. All player-facing wording names that object, never the whole room, so searching a
corridor reads as going through the console table rather than ransacking a corridor.

### Phase 0 cards
| Card | In practice | Later |
| --- | --- | --- |
| Lantern | Carried only; explained in the hand sheet | Blocks a possession attempt in a trade |
| Hint | 1 action: reveals one undiscovered room next door. Never moves you, never reaches further, never reveals a sealed exit | unchanged |
| Distraction | Carried only; explained in the hand sheet | Slips you out of a meeting |

Searching a room with a full hand never discards silently: the player takes it (dropping one),
uses it on the spot if it can be used, or leaves it. The room counts as searched either way, so a
full hand cannot be used to search the same room twice.


---

## 0b. PHASE 1 — THE HOT-SEAT RULES SANDBOX (`gameMode: "hotseatRulesV1"`)

Four to six people, **one device**, passed round the table. Start it from the start screen or go
straight to `?mode=hotseat&players=6`. `?seed=123` fixes the deal and the hidden role for
testing; `?timer=off` plays without the clock.

### The configuration, as approved
| Key | Value | |
| --- | --- | --- |
| `playerCount` | 6 | 4-6 supported |
| `rooms` | 18 | the corrected Phase 0 map, unchanged |
| `actionPointsPerTurn` | 4 | never carried over |
| `knownRoomMoveCost` | 1 | |
| `newRoomEntryCost` | 2 | reveal + step in |
| `searchCost` | 1 | |
| `startingHandSize` | 4 | at least one Lantern each |
| `handLimit` | 6 | enforced at end of turn |
| `itemSearchRooms` | 12 | one card each, once each |
| `objectiveCount` | 3 | `ceiling(players / 2)` |
| `requiredCleanEscapees` | 2 | `maximum(1, floor(players / 3))` |
| `roundLimit` | 8 | enforced |
| `turnTimerEnabled` | true | |
| `turnTimerSeconds` | 45 | |
| `healthEnabled` | false | |
| `combatEnabled` | false | |
| `lockedDoorsEnabled` | false | |
| `legacyCarriedExitKey` | false | |

Four players: 2 objectives, 1 clean escape. Five players: 3 objectives, 1 clean escape.

### Roles
Exactly **one** guest starts possessed. There is no second Possessor and no charge pool:
possession is an **intent** committed with an Offer, not a card, so it can neither be traded away
nor run out. Every player sees their role once, alone, on a private screen they must acknowledge.
A guest who is converted later is told **privately, at the start of their own next turn** — never
out loud, never on the public interface.

### What is public and what is not
The always-on interface may show, and does show: each guest's name, the room they are in, their
action points, how many cards they hold, objective progress, escape progress, the round and the
turn clock. It **never** shows a hidden role, an intent, another player's hand or another
player's Offer — and in this mode the possessed screen tint and the possessed portrait are
switched off entirely, because the device sits between six people.

### A turn
1. **Pass screen** — neutral: "Pass the device to Eleanor". Nothing private. The clock is stopped.
2. **Private screen** — that player alone: their role, anything that happened to them since, their
   hand, and the Offer they commit for this turn. The clock is still stopped.
3. **Action phase** — 4 action points, the 45-second clock running. Move, search, play a Hint, end
   the turn early. Every cost is shown before it is confirmed, and an action that cannot be
   afforded is never offered.

The clock counts **only** the action phase. It never runs during a role reveal, a hand-over, a
meeting result or a prompt, so passing the iPad round costs nobody their turn. When it runs out
the Offer locks as **Nothing** with intent **Trade** and the turn ends; nothing else happens.

A **round** is one turn for every guest still in the hotel. After eight rounds the match ends.

### Offers and meetings
Each player sets their Offer **at the beginning of their own turn**: one card from their hand, or
Nothing. The possessed side also privately picks **Trade** or **Possess**. The Offer is locked the
moment the turn's first action begins and stands until that player's next turn or until a meeting
consumes it. To use a card you committed, clear the Offer first — and if you play it anyway the
game says plainly that you are now offering Nothing.

Walking into a room that already holds other guests forces **one** meeting: the arriving player
chooses which single guest they meet. Only the arriving player triggers one, at most one happens
per turn, and the lobby and the exit never trigger one at all. It then resolves with **no input
from the other player** — `resolveMeeting(state, floor, mover, other)` takes no callback, so there
is nothing it could ask them:

1. A **Distraction** from either side cancels the meeting. It is spent, nothing is traded, nobody
   is possessed, and it reveals nothing about anybody.
2. A committed **possession attempt**:
   - target already possessed → an ordinary exchange;
   - target's Offer is a **Lantern** → **blocked**. The Lantern is spent (not handed over), no card
     changes hands, and the target alone learns who attacked them. The table is told only that an
     attempt was blocked;
   - otherwise → the target is possessed, with no normal exchange. Publicly it reads exactly like
     a meeting where neither side gave anything.
3. Otherwise both Offers change hands at the same moment. Nothing transfers nothing.

Both Offers reset afterwards either way.

### Objectives and the exit
Unchanged from the correction pass: objectives are permanent public team progress recorded
against the **room**, never held, offered, taken or lost. When all of them are in, the exit is
revealed to everyone at once with a notice.

The exit is a **safe end-zone and is resolved first**. A clean guest who steps in escapes
immediately and permanently: no meeting, no possession, no challenge. They take no further turns,
leave the map and the 3D floor, and cannot be met. A possessed guest may stand in the exit and
nothing happens.

### Winning
- **Guests** win the moment `requiredCleanEscapees` clean guests are out (2 at six players).
- **The possessed side** wins when too few clean guests remain to make up that number, or when the
  eighth round has been played.
- There is no elimination, no health, no combat, no weapons and no locked doors in this mode. The
  legacy combat code is still present and tested, and `resolveAttack` refuses outright here.

### The hot-seat deck
The same three card types, in a pile sized for six hands plus every item room: 16 Lanterns,
14 Hints, 12 Distractions (42). Six 4-card hands take 24, the 12 item rooms need 12, and the rest
is slack. The Lantern share is the difficulty dial for the possessed side — see the comment on
`rules.hotseatDeck` for how to measure and adjust it.

---

## 1. Overview (the LEGACY multiplayer engine — still present, not the approved rules)
A hidden-role social game set in a trapped hotel. Players explore room by room, collect items, and must trade when they meet. One player secretly starts Possessed and spreads possession through trades. Clean players win by assembling an exit key from three lanterns and escaping. The possessed side wins by possessing everyone before that happens. Inspired by Panic Station, deliberately simplified.

## 2. Players
- Real game: designed around 6 players. Deck values assume 6.
- Current test build: 5 players, all controlled by one person in hot-seat turns.
- NOTE: hidden information is not truly hidden in hot-seat mode. This build tests mechanics, not social bluffing, which needs separate players later.

## 3. Health
- Each player has 3 health bars.
- A Bandage card restores 1 bar (max 3).
- Reaching 0 health = dead and out of the game. A dead player's character stays lying on the floor where they fell (with a little blood).

## 4. Action Points (AP)
- 4 AP at the start of each turn.
- Costs: discovering a new room costs 1 AP and entering it costs 1 AP, so moving into an undiscovered room costs 2 AP total; moving into a room you already know costs 1 AP. Search the current room 1 AP; use a card 1 AP; attack 1 AP (requires a weapon).
- Repositioning within the current room is free.
- "End turn" passes control to the next player and refreshes AP to 4.
- At 0 AP no further paid actions; end the turn.

## 5. Turn structure
1. Usable doors blink; the player selects one and confirms.
2. Character spends 1 AP and walks to the centre of the chosen room, or stands beside players already there (never overlapping).
3. If they entered a room holding one or more other players, and it is their first meeting there this round, an ENCOUNTER is forced (section 7). When more than one other player is present, the entering player chooses which one to meet. EXCEPTION: SAFE rooms never force an encounter (section 7).
4. The player may also search, use cards, or heal (1 AP each).
5. When done or out of AP, end the turn.
- A "round" = one full cycle where every living player has taken a turn. Encounter locks reset at the start of each round.

## 6. Rooms & discovery
- Only the starting room is visible at first.
- Starting room is central with at least four doorways so players spread out.
- Doorways to undiscovered rooms are clearly marked (steady highlight).
- Walking through a doorway reveals the new room; discovered rooms stay visible.
- Branching routes, some dead ends, one exit room.
- Mood shifts warm→uneasy deeper in. Flicker only where room data specifies; doorways do not flicker.
- Some rooms are DARK: a player may enter and move through them, but cannot SEARCH a dark room without a Flashlight.
- Only certain room types can be searched (e.g. bedrooms, storage, lounges); corridors, landings and stairs cannot be searched. Each room can be searched only once (by any player).
- Some rooms are SAFE (the starting room is a safe zone; more rooms could be flagged safe later). A safe room never forces an encounter and no attacks may be made there, but players may still trade voluntarily (section 7).
- 2D map (bottom-right button) shows only discovered rooms and player positions.

## 7. Encounters: Trade or Attack
When an encounter is forced, the entering player first chooses WHICH other player to face (if more than one is present), then chooses ONE of:

### Trade (default)
- Both players secretly select one card; cards exchange simultaneously.
- A CLEAN player may only give a normal item card (never a Possession card).
- A POSSESSED player may give a Possession card, OR give a normal card to appear innocent (a bluff).
- Resolution: receiving a Possession card AND not giving a Lantern in that same trade → the receiver becomes Possessed (privately notified). Receiving a Possession card BUT giving a Lantern in that trade → possession FAILS and that player now knows the other is Possessed (the Lantern still changes hands).
- Encounter lock: the same two players cannot be forced to trade again in the SAME room in the SAME round. Meeting in a DIFFERENT room re-triggers an encounter.

### Attack (alternative)
- Requires a weapon. Costs 1 AP. Replaces the trade for that encounter.
- Knife: drains 1 HP; reusable.
- Revolver: drains 2 HP; target must be in the same room; holds 2 shots, then discarded.

### Safe rooms (e.g. the starting room)
- A SAFE room never forces an encounter — entering it with other players present does not trigger a forced trade.
- Attacking is disabled entirely in a safe room (no Knife or Revolver may be used there).
- Players MAY still choose to trade VOLUNTARILY in a safe room when both agree (letting clean players safely hand off Lanterns and coordinate). A voluntary trade follows the normal trade rules above.
- Rooms are flagged in the room data (`safe: true`), so other rooms could be made safe later.

## 8. Possession (hidden role)
- At setup exactly one player is secretly Possessed.
- The possessed player sees a private visual tell (altered eye on portrait, subtle screen tint) invisible to others.
- Possession spreads only through trades.
- A newly possessed player can then pass Possession cards in future trades.
- Possession cards are a limited supply (section 10).

## 9. Win conditions
- CLEAN players win the moment one clean, living player holds three Lanterns (the Exit Key) and steps into the exit room.
- POSSESSED side wins if every living player is possessed first.
- If all clean players die with none escaped, the possessed side wins.

## 10. Cards & deck
Lanterns do double duty: DEFEND against possession in a trade AND are the escape resource (three = the Exit Key). Defending yourself may hand a win-resource to a possible traitor — the core tension.

### Card types
- Lantern — defends against possession in a trade; three combine into the Exit Key.
- Possession — only the possessed side may trade it; turns the receiver possessed unless they give a Lantern in the same trade.
- Flashlight — required to SEARCH a dark room.
- Knife — weapon; drains 1 HP; reusable.
- Revolver — weapon; drains 2 HP; same room only; 2 shots then discarded.
- Bandage — restores 1 health bar.
- Master Key — opens any locked/hidden room once, then discarded.
- Lock Pick — attempts to open a locked room; may fail.
- Barricade — seals a doorway for one round.

### Starting deck (6-player game), tuned to avoid card-scarcity death-spiral
- 1 × Possessed role card (dealt secretly, not in the draw deck)
- 3 × Possession cards (possessed side's supply)
- 9 × Lantern
- 3 × Flashlight
- 3 × Knife
- 2 × Revolver (2 shots each)
- 4 × Bandage
- 2 × Master Key
- 3 × Lock Pick
- 3 × Barricade
- Remaining slots: filler item cards as needed

### Starting hands
- Each player draws 4 cards, guaranteed at least one Lantern.

### Hand limit
- A player may hold at most 6 cards. If they end their turn holding more than 6, they discard down to 6 before control passes on (the player chooses which cards to discard).
- Possession cards do NOT count toward the 6-card limit: a possessed player is never forced to discard because of their Possession cards, and only their normal item cards count toward the limit.
- Possession cards are also hidden from the public card count shown on screen, so the number others can see reflects only normal item cards (it must not reveal who is possessed). Possession cards remain tradeable exactly as before — only their counting and visibility change.

### Searching
- Searching a room (1 AP) draws a card or reveals a hidden item placed in that room. Main way new items enter play. Only searchable room types can be searched (not corridors/landings/stairs) and each room can be searched only once. Dark rooms require a Flashlight to search.

## 11. Open items (NOT in the next build)
- Deck balance once real multiplayer testing begins.
- Catch-up mechanic if the possessed side is reduced to one player.
- Locked/hidden rooms and how Master Key / Lock Pick interact.
- Sound, art, character models, main menu, receptionist intro.
