# GAME_RULES.md — Hotel Escape (working title)

## 1. Overview
A hidden-role social game set in a trapped hotel. Players explore room by room, collect items, and must trade when they meet. One player secretly starts Possessed and spreads possession through trades. Clean players win by assembling an exit key from three lanterns and escaping. The possessed side wins by possessing everyone before that happens. Inspired by Panic Station, deliberately simplified.

## 2. Players
- Real game: designed around 6 players. Deck values assume 6.
- Current test build: 5 players, all controlled by one person in hot-seat turns.
- NOTE: hidden information is not truly hidden in hot-seat mode. This build tests mechanics, not social bluffing, which needs separate players later.

## 3. Health
- Each player has 3 health bars.
- A Bandage card restores 1 bar (max 3).
- Reaching 0 health = dead and out of the game.

## 4. Action Points (AP)
- 4 AP at the start of each turn.
- Costs: move into a room (incl. an already-discovered room) 1 AP; search the current room 1 AP; use a card 1 AP; attack 1 AP (requires a weapon).
- Repositioning within the current room is free.
- "End turn" passes control to the next player and refreshes AP to 4.
- At 0 AP no further paid actions; end the turn.

## 5. Turn structure
1. Usable doors blink; the player selects one and confirms.
2. Character spends 1 AP and walks to the centre of the chosen room, or stands beside players already there (never overlapping).
3. If they entered a room with another player AND it is their first meeting with that player in this room this round, an ENCOUNTER is forced (section 7).
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
- 2D map (bottom-right button) shows only discovered rooms and player positions.

## 7. Encounters: Trade or Attack
When an encounter is forced, the entering player chooses ONE:

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

### Searching
- Searching a room (1 AP) draws a card or reveals a hidden item placed in that room. Main way new items enter play. Dark rooms require a Flashlight to search.

## 11. Open items (NOT in the next build)
- Deck balance once real multiplayer testing begins.
- Catch-up mechanic if the possessed side is reduced to one player.
- Locked/hidden rooms and how Master Key / Lock Pick interact.
- Sound, art, character models, main menu, receptionist intro.
