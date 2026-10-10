# GAME_RULES.md — Hotel Escape (restored ruleset)

## Overview
Guests are trapped on a hotel floor. Lanterns are the way out: a clean guest carrying three of them can leave by the fire exit. Clean guests must find Lanterns, pass them to one guest, and get that guest out. One guest is secretly Possessed and spreads possession through trades.

## Players
4–6, tuned for 6. Hot-seat on one iPad for testing; the real game will be online, one device each.
- Practice mode: one guest alone, in a random hotel like any other match, starts with one Lantern like every guest, finds two more and reaches the exit. No meetings, no possessed guest, no deadline.

## Turn
- 4 action points (AP), never carried over.
- Open a closed door of your room: 1 AP (see Doors and exploring). Move into an adjacent room through an open doorway: 1 AP. Escape from the Fire Exit: 1 AP. Search: 1 AP. Use a card: 1 AP (Espresso: free). Use a room's job (Infirmary, Switchboard): 1 AP.
- Your guest always stands in the middle of the room they are in; there is no walking around inside a room. You act by tapping: tap a room to open or enter it, tap a room's furniture to search it (you don't walk to it).
- 45-second timer for the active player's actions. It pauses during meetings and pass-the-device screens. When it runs out, the turn ends. ?timer=off disables it.
- A round = every living guest takes one turn.
- Dawn deadline: the match lasts at most 8 rounds. The round is shown as "Round 3 of 8", and the final round before dawn is clearly marked.

## Health
- 4 health bars. Bandage restores 1 (max 4). The Infirmary restores 2 (max 4).
- At 0 health a guest dies and is out of the game. Everything they carried drops in that room, except Possession cards, which leave the game.

## Meetings
- Entering a room that holds a guest you have not met in that room this round forces a meeting. If several are there, choose one.
- The entering guest chooses TRADE or ATTACK.
- The same two guests cannot be forced to meet again in the same room in the same round. Meeting in a different room triggers a new meeting.
- The lobby is a safe zone: no meetings, no trades and no attacks.

### Trade
- Both guests secretly choose one card to give; the cards swap at the same time. In hot-seat the device is passed so the other guest chooses in private. Results are private: each guest sees only what they received.
- A clean guest can never give a Possession card. A possessed guest may give a Possession card, or a normal card to look innocent.
- If either guest has no ordinary card (Possession cards don't count), the trade is skipped and both are told why.
- In an ordinary trade a Lantern goes to the other guest like any other card, so teammates can pass Lanterns to one guest.
- Receive a Possession card without giving a Lantern: you become possessed, keep that Possession card and receive one extra Possession card (two tries).
- Receive a Possession card while giving a Lantern: the attempt fails and the Lantern is used up — the Lantern and the Possession card are both discarded — and you privately learn who tried.

### Attack
- Needs a weapon; costs 1 AP; replaces the trade.
- Knife: −1 health, reusable.
- Revolver: −2 health, 2 shots, then discarded.

## Possession
- One guest is secretly Possessed at setup and starts with 3 Possession cards.
- The chain: a guest who becomes possessed keeps the card that possessed them AND receives one extra Possession card: two tries. Each guest they possess gets two tries the same way. A Lantern block still burns the card used (the Lantern and the Possession card are both thrown away); a guest who dies takes their Possession cards out of the game.
- Possessed guests see a private tell (portrait + screen tint). In hot-seat it shows on that guest's private screens and, during their own turn, on the main screen too: a POSSESSED label, how many Possession cards they still hold ("souls to trade") and their Possession cards in the hand. It disappears before the iPad is passed on.
- Possession cards never count toward the hand limit and can't be discarded.
- How many cards a guest holds is private: the table never shows other guests' card counts (only a Hand Mirror reveals a hand). Your own count is shown only to you.

## Lanterns and escape
- Lanterns do double duty: given in a trade they block a possession attempt, and three of them open the fire exit.
- Every guest starts with one Lantern (see Cards and deck). All other Lanterns are found by searching.
- The Fire Exit is revealed like any other room, when the door to it is opened. Walking into the Fire Exit is a normal move (1 AP). Escaping is a separate action: a clean guest with three Lanterns standing in the Fire Exit spends 1 AP to escape. If you arrive with no AP left, you can escape on your next turn — the Fire Exit stays a safe zone meanwhile; dawn can still beat you. A possessed guest can hold Lanterns but can never escape.

## Winning
- Clean side: one clean guest escapes with three Lanterns.
- Possessed side: every living guest is possessed, or every clean guest is dead, or dawn breaks — no clean guest has escaped when round 8 ends.

## The hotel map
- A new random hotel every match, built from a shuffled room deck of 24 tiles that are placed as the hotel is explored.
- Every room is a same-size square tile with 1 to 4 doorways centred on its sides, so any room can join any other.
- The lobby is the centre start tile. It starts with 3 or 4 open doorways, chosen at random each match; a closed-off side is a plain wall.
- The Fire Exit is shuffled into the last five tiles of the room deck.
- A new tile is turned automatically to a random orientation that fits: one of its doorways meets the door that was opened, and none of its doorways opens into a wall. Where two doorways meet, they connect. If a tile can't fit, it goes to the bottom of the deck and the next tile is tried.
- The hotel never closes itself off before the Fire Exit is placed: there is always at least one reachable unexplored doorway.
- Tile mix: 1 Fire Exit, 2 locked rooms (each a dead end with a single doorway), dark rooms in about the same share as before, 5 rooms with jobs (2 Linen Stores, 2 Infirmaries, 1 Switchboard, in place of ordinary tiles; the deck stays at 24), and the rest ordinary rooms and corridors, with doorway counts that give branching routes and a few dead ends. The exact mix is in src/data/hotel.js (awaiting the owner's approval).
- *Placeholder, awaiting approval:* if no remaining tile can fit behind a door, the door is jammed: it stays shut for the rest of the match, and trying it costs nothing.

## Doors and exploring
- Unexplored doorways are closed doors, with a fogged, unknown room shown beyond each one. Tapping a fogged room opens its door: 1 AP; the room behind is revealed, but you stay where you are. Tapping a revealed room asks you to confirm the move; your guest then walks there (1 AP per room) and stands in its middle. You are never forced to enter.
- Opened doors stay open. (A locked door is different: see Rooms.)
- A newly revealed room is empty, so opening a door never triggers a meeting.

## Rooms
- Start in the lobby. Rooms stay visible once revealed.
- Dark rooms: anyone can enter; searching needs a Flashlight (not used up).
- Two locked rooms are tiles in the room deck. Each has a single doorway, and its door is locked from the moment the room is revealed. A locked room never joins the lobby.
- A Master Key (always works, then discarded) or a Lock Pick (works half the time, discarded either way) unlocks a locked door from the room on the other side of it. It opens only that door.
- An unlocked door stays open until the end of the turn of the guest who unlocked it, then locks again. Getting in again later takes another Master Key or Lock Pick.
- A locked door only stops guests going in; a guest inside can always walk out, and the door stays locked behind them.
- Barricade: seals one doorway of your room until your next turn starts.

### Rooms with jobs
- Linen Store ×2: the first search here draws 2 cards instead of 1.
- Infirmary ×2: 1 AP to restore 2 health (maximum 4).
- Switchboard ×1: 1 AP, once per player per turn. Everyone learns how many guests are currently possessed, but not who.

## Searching
- 1 AP. If dropped cards are lying in the room, you take them all — dropped items can always be picked up. Otherwise you draw one card (two in a Linen Store); each room gives one card draw per match.
- Search results are private: only the searcher sees what they found. The table only sees that someone searched.
- When the deck runs out, shuffle the discard pile into a new deck.

## Cards and deck (6 players)
- Possession ×2 (the possessed guest's supply, not in the deck).
- Draw deck (48): Lantern ×14, Bandage ×7, Flashlight ×5, Knife ×4, Barricade ×4, Lock Pick ×4, Hand Mirror ×3, Espresso ×3, Revolver ×2, Master Key ×2.
- Lantern: give it in a trade to block a possession attempt; three of them let a clean guest escape.
- Hand Mirror: 1 AP. Choose a guest in your room; they show you their whole hand in private. Used up.
- Espresso: free to use (no AP). Gain 2 extra AP this turn. Used up.
- Starting hand: 4 cards. Every guest, the possessed guest included, is dealt 1 Lantern and 3 cards from the deck with the Lanterns taken out; the remaining Lanterns are then shuffled back into the deck.
- Hand limit: 6, checked at the end of your turn. During your turn you keep everything you find or receive, even past 6; when you end your turn with more than 6, you choose cards to discard until you hold 6. Cards received on someone else's turn are settled at the end of your own next turn. Lanterns count like other cards; Possession cards don't count.
