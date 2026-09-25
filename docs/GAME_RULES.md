# GAME_RULES.md — Hotel Escape (restored ruleset)

## Overview
Guests are trapped on a hotel floor. Lanterns are the way out: a clean guest carrying three of them can leave by the fire exit. Clean guests must find Lanterns, pass them to one guest, and get that guest out. One guest is secretly Possessed and spreads possession through trades.

## Players
4–6, tuned for 6. Hot-seat on one iPad for testing; the real game will be online, one device each.
- Practice mode: one guest alone, in a random hotel like any other match, finds three Lanterns and reaches the exit. No meetings, no possessed guest, no deadline.

## Turn
- 4 action points (AP), never carried over.
- Open a closed door of your room: 1 AP (see Doors and exploring). Move into an adjacent room through an open doorway: 1 AP. Search: 1 AP. Use a card: 1 AP. Repositioning inside a room: free.
- 45-second timer for the active player's actions. It pauses during meetings and pass-the-device screens. When it runs out, the turn ends. ?timer=off disables it.
- A round = every living guest takes one turn.
- Dawn deadline: the match lasts at most 8 rounds. The round is shown as "Round 3 of 8", and the final round before dawn is clearly marked.

## Health
- 3 health bars. Bandage restores 1 (max 3).
- At 0 health a guest dies and is out of the game. Everything they carried drops in that room, except Possession cards, which leave the game.

## Meetings
- Entering a room that holds a guest you have not met in that room this round forces a meeting. If several are there, choose one.
- The entering guest chooses TRADE or ATTACK.
- The same two guests cannot be forced to meet again in the same room in the same round. Meeting in a different room triggers a new meeting.
- The lobby is a safe zone: no forced meetings, no attacks. Guests there may trade voluntarily if both agree; normal trade rules apply, including possession.

### Trade
- Both guests secretly choose one card to give; the cards swap at the same time. In hot-seat the device is passed so the other guest chooses in private. Results are private: each guest sees only what they received.
- A clean guest can never give a Possession card. A possessed guest may give a Possession card, or a normal card to look innocent.
- In an ordinary trade a Lantern goes to the other guest like any other card, so teammates can pass Lanterns to one guest.
- Receive a Possession card without giving a Lantern: you become possessed and keep that Possession card.
- Receive a Possession card while giving a Lantern: the attempt fails and the Lantern is used up — the Lantern and the Possession card are both discarded — and you privately learn who tried.

### Attack
- Needs a weapon; costs 1 AP; replaces the trade.
- Knife: −1 health, reusable.
- Revolver: −2 health, 2 shots, then discarded.

## Possession
- One guest is secretly Possessed at setup and starts with 3 Possession cards.
- Possessed guests see a private tell (portrait + screen tint). In hot-seat it shows only on that guest's private screens.
- Possession cards never count toward the hand limit, are hidden from the public card count, and can't be discarded.

## Lanterns and escape
- Lanterns do double duty: given in a trade they block a possession attempt, and three of them open the fire exit.
- Lanterns are never dealt. They are found only by searching.
- The Fire Exit is revealed like any other room, when the door to it is opened. A clean guest holding three Lanterns who enters it escapes immediately, before any meeting. A possessed guest can hold Lanterns but can never escape.

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
- Tile mix: 1 Fire Exit, 2 locked rooms, dark rooms in about the same share as before, and the rest ordinary rooms and corridors, with doorway counts that give branching routes and a few dead ends. The exact mix is in src/data/hotel.js (awaiting the owner's approval).
- *Placeholder, awaiting approval:* if no remaining tile can fit behind a door, the door is jammed: it stays shut for the rest of the match, and trying it costs nothing.

## Doors and exploring
- Unexplored doorways are closed doors. Opening one costs 1 AP and reveals the room behind it, but you stay where you are. Entering is a normal move (1 AP). You are never forced to enter.
- Opened doors stay open.
- A newly revealed room is empty, so opening a door never triggers a meeting.

## Rooms
- Start in the lobby. Rooms stay visible once revealed.
- Dark rooms: anyone can enter; searching needs a Flashlight (not used up).
- Two locked rooms are tiles in the room deck. A locked room is locked from the moment it is revealed, and never joins the lobby. It is opened from a room next door with a Master Key (always works, then discarded) or a Lock Pick (works half the time, discarded either way). Once opened, it stays open.
- Barricade: seals one doorway of your room until your next turn starts.

## Searching
- 1 AP. If dropped cards are lying in the room, you take them all — dropped items can always be picked up. Otherwise you draw one card; each room gives one card draw per match.
- Search results are private: only the searcher sees what they found. The table only sees that someone searched.
- When the deck runs out, shuffle the discard pile into a new deck.

## Cards and deck (6 players)
- Possession ×3 (the possessed guest's supply, not in the deck).
- Draw deck (40): Lantern ×12, Bandage ×7, Flashlight ×5, Knife ×4, Barricade ×4, Lock Pick ×4, Revolver ×2, Master Key ×2.
- Lantern: give it in a trade to block a possession attempt; three of them let a clean guest escape.
- Starting hand: 4 cards dealt from the deck with the Lanterns taken out. Lanterns are never dealt; they are shuffled into the rest of the deck afterwards.
- Hand limit: 6, checked at the end of your turn. Lanterns count like other cards; Possession cards don't count.
