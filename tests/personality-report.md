# Hotel Escape: how different kinds of players change the game (personality study)

*Measurement only. No game rule and no game code was changed. Every "idea" at the end is a **proposal that needs
the owner's approval** (CLAUDE.md, "Rules changes"). It was tried only inside the simulator.*

## In short

- **The hotel side wins far too often, whatever the players' style.** With one of each personality at a 6-player
  table the clean guests win **8%** of matches and the hotel wins **92%**. At 5 players it is 5.5% and at 4 players
  3.6%. The 30 matches played through the real game agree: the clean side won **1 of 30**.
- **Matches are short.** The median 6-player match ends in **round 4, after 20 turns**. More than a quarter of
  matches are already over by the end of round 2.
- **How the hotel wins:** it rarely needs dawn (10%) or killing. Possession spreads by trading. A guest who is
  possessed receives the Possession card and can pass it straight on, so possession snowballs. **81% of all
  possessions happen in rounds 1–2.** At that point almost nobody holds a Lantern, the only defence.
- **Personality matters much less than the rules.** Whichever personality a clean guest has, the clean side
  wins about 7–9%. The one style that turns the game round is a **whole table of "Safe" players**. They avoid
  meetings and always hand over a Lantern as a shield. Such a table wins **72%**.
- **Rushing is the most useful clean style.** Rushers make half of all escapes. **Slow play never finds the exit.**
  **Killing mostly hurts the clean side.** A clean Killer kills clean guests, and a possessed Killer is the
  *weakest* possessed guest, because an attack replaces a possession attempt.
- **Real-game check:** 30 full hot-seat matches through the real interface found **0 bugs and 0 rule
  violations**. The harness also recorded 0 interface problems and never had to fall back to a debug hook.
- **Time for people:** a typical 6-player hot-seat match would take about **12–17 minutes**. A match that runs
  to dawn takes **30–40 minutes**, and more if the rules are rebalanced (see section 5).
- **The strongest single change measured:** *a Possession card is used up when it converts someone*. The clean
  side goes from 8% to 30%. Together with *each guest starts with 1 Lantern* it reaches **45%** at 6 players.
  Smaller tables need more help (section 7).

---

## 1. How this was tested

| | Real game (browser) | Simulator |
|---|---|---|
| What plays | `tests/autoplay.mjs`: bots tap through the real hot-seat interface in headless Chromium (iPad size) | `tools/balance/hotseat-sim.mjs --study`: the same rules code (`src/game/*`), no browser |
| Decisions | the shared personality rules in `tools/balance/personalities.mjs` | the same file |
| Matches | **30** (18 × 6 players, 6 × 5, 6 × 4) | **about 250,000** (see each table) |
| Roles | seats and seeds chosen so **each personality started possessed 5 times** (3 at 6 players, once each at 5 and 4) | random role and seats; some tests put a chosen personality in the possessed seat |

How precise the numbers are: a "±" figure is the 95% margin. With 12,000 matches the clean-side win rate is
known to about ±0.5 points. Each personality table (2,000–6,000 matches) is within about ±1–2 points, which meets
the ±2% the owner asked for. The 30 real matches are a check that the real game behaves like the simulator and
has no bugs. They are too few to measure win rates on their own.

## 2. The six personalities

The exact decision rules are written at the top of `tools/balance/personalities.mjs`. In short:

| Personality | How it plays when clean | When it is the possessed one |
|---|---|---|
| **Rusher** | Opens doors outward, away from the lobby, to find the Fire Exit fast. It searches only the room it stands in, never gives a Lantern away, uses Espresso as soon as it runs out of actions, and escapes as soon as it can. | Keeps exploring outward and meets a clean guest one step away. |
| **Slow** | Uses at most 2 actions a turn. It searches every room it enters, explores near the lobby first, and gives a Lantern only when it holds 2 or more. | Stays near the lobby and only meets a clean guest next door. |
| **Safe** | Plans its route round rooms with people in them. It heals early, uses Barricades, and in any trade **gives a Lantern if it has one**, which blocks possession. It never attacks unless it knows the target is possessed. | Only approaches guests who say they have no Lantern (a Lantern would block and unmask it). |
| **Aggressive** | Walks to anyone it can reach this turn. It attacks suspects, and anyone else half the time, when armed. It trades a lot and keeps its Lanterns. | Hunts clean guests. It attacks Lantern holders, who would block its card, and tries to possess the rest. |
| **Killer** | Collects weapons and hunts anyone, attacking every guest it meets while armed, possessed or not. | Hunts and attacks every clean guest, and only tries possession when unarmed. |
| **Team player** | The table names a **carrier**: the trusted guest with the most Lanterns. A team player brings its Lanterns to the carrier, escorts it, and shares what it knows about who is possessed. | Heads for the clean guests, carrier first, and tries to possess them. |

All personalities play legally: every action goes through the real rules code, which refuses anything illegal.
They are honest about hidden information, with two simplifications a real table would cover by talking.
Everyone says truthfully how many Lanterns they hold. The possessed guests know each other.

## 3. The real game: 30 matches through the interface

**Bugs and rule violations: none.** The harness checks every step: action points, health, hand limit, card
conservation, turn order, the privacy of shared screens, who holds the device, the meeting rules, the round limit
and the end screens. It recorded **0 violations, 0 interface problems, 0 fallbacks and 0 aborted matches**.

| Table | Matches | Clean win (escape) | Hotel: all possessed or dead | Hotel: dawn | Rounds (median / mean) | Turns (median / mean) | Bot time per match (median / mean, range) |
|---|---|---|---|---|---|---|---|
| 6 players | 18 | 1 | 13 | 4 | 5 / 4.8 | 25.5 / 25.6 | 119 s / 120 s (45–219 s) |
| 5 players | 6 | 0 | 5 | 1 | 2.5 / 3.3 | 11.5 / 15.5 | 62 s / 78 s (35–179 s) |
| 4 players | 6 | 0 | 6 | 0 | 2.5 / 3.3 | 8 / 12.2 | 38 s / 58 s (24–147 s) |
| **All** | **30** | **1 (3%)** | **24** | **5** | 3 / 4.2 | 15 / 20.9 | 80 s / 99 s |

"Bot time" is how long the computer took to play the match at bot speed, sometimes while the simulator was running
on the same machine. It is not how long people would take; see section 5. Per match there were on average
4.2 possession attempts and 3.7 successes, 11.1 trades, 3.2 attacks and 0.5 deaths. The Fire Exit was found in
11 of 30 matches.

### Per personality (real game)

| Personality | Hotel won when it started possessed | Clean side won when it started clean | Got possessed (started clean) | Killed someone | Was killed | Searches | Lanterns found | Attacks | Possession cards handed over | Blocked a possession |
|---|---|---|---|---|---|---|---|---|---|---|
| Rusher | 5 of 5 | 1 of 22 | 21 of 22 | 0 | 2 | 84 | 52 | 0 | 17 | 0 |
| Slow | 5 of 5 | 1 of 22 | 18 of 22 | 0 | 3 | 21 | 16 | 1 | 19 | 3 |
| Safe | 5 of 5 | 1 of 22 | 13 of 22 | 0 | 5 | 66 | 44 | 1 | 13 | 10 |
| Aggressive | 4 of 5 | 0 of 22 | 21 of 22 | 6 | 0 | 40 | 24 | 42 | 26 | 0 |
| Killer | 5 of 5 | 1 of 22 | 19 of 22 | 8 | 2 | 48 | 29 | 43 | 26 | 0 |
| Team player | 5 of 5 | 1 of 22 | 19 of 22 | 1 | 3 | 67 | 46 | 8 | 25 | 2 |

(27 seats each. "Possession cards handed over" counts attempts made while that guest was possessed. "Blocked"
counts Possession cards that failed on that guest because it handed over a Lantern.)

The one clean win (match 3) came from the **Killer**, who happened to collect three Lanterns and walked out. The
Safe player blocked the most possession attempts (10) and was the hardest to possess (13 of 22), but it was also
killed most often (5), because it walks alone.

### Every real match

| # | Players | Possessed at start | Result | Rounds | Turns | Bot time | Still possessed at the end | Deaths (killer → victim; * = possessed) | Possession tries / successes / blocked | Lanterns found · where at the end (clean · possessed · deck · used up · floor) |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 6 | Rusher | All possessed/dead | 5 | 28 | 139 s | Slow, Rusher, Aggressive, Killer | Killer* → Team; Killer* → Safe | 4 / 3 / 1 | 11 · 0 · 8 · 3 · 1 · 2 |
| 1 | 6 | Slow | All possessed/dead | 8 | 42 | 197 s | Aggressive, Killer, Rusher, Slow | Aggressive* → Team; Aggressive* → Safe | 5 / 3 / 2 | 15 · 0 · 8 · 3 · 3 · 0 |
| 2 | 6 | Safe | All possessed/dead | 2 | 10 | 56 s | all six | — | 5 / 5 / 0 | 3 · 0 · 3 · 11 · 0 · 0 |
| 3 | 6 | Aggressive | **Escape** (Killer) | 5 | 25 | 107 s | Team, Rusher, Aggressive, Safe | — | 3 / 3 / 0 | 9 · 7 · 5 · 5 · 0 · 0 |
| 4 | 6 | Killer | Dawn | 8 | 49 | 204 s | Team, Killer, Rusher, Slow, Aggressive | — | 5 / 4 / 1 | 13 · 0 · 12 · 1 · 1 · 0 |
| 5 | 6 | Team | All possessed/dead | 5 | 28 | 135 s | all six | — | 6 / 5 / 1 | 12 · 0 · 11 · 2 · 1 · 0 |
| 6 | 6 | Rusher | All possessed/dead | 8 | 33 | 139 s | Aggressive, Rusher | Killer → Team*; Killer → Slow; Aggressive* → Killer; Aggressive* → Safe | 2 / 2 / 0 | 13 · 0 · 7 · 3 · 0 · 4 |
| 7 | 6 | Slow | All possessed/dead | 3 | 14 | 79 s | Killer, Team, Rusher, Slow, Aggressive | Killer → Safe | 4 / 4 / 0 | 8 · 0 · 7 · 7 · 0 · 0 |
| 8 | 6 | Safe | All possessed/dead | 2 | 9 | 47 s | all six | — | 5 / 5 / 0 | 3 · 0 · 3 · 11 · 0 · 0 |
| 9 | 6 | Aggressive | All possessed/dead | 2 | 9 | 52 s | all six | — | 5 / 5 / 0 | 4 · 0 · 4 · 10 · 0 · 0 |
| 10 | 6 | Killer | All possessed/dead | 2 | 8 | 45 s | all six | — | 5 / 5 / 0 | 1 · 0 · 1 · 13 · 0 · 0 |
| 11 | 6 | Team | Dawn | 8 | 38 | 192 s | Aggressive, Killer, Team | Killer → Slow; Killer* → Rusher | 5 / 2 / 3 | 18 · 3 · 8 · 0 · 3 · 0 |
| 12 | 6 | Rusher | Dawn | 8 | 49 | 219 s | Team, Slow, Safe, Killer | Aggressive → Rusher* | 5 / 4 / 1 | 15 · 4 · 6 · 3 · 1 · 0 |
| 13 | 6 | Slow | All possessed/dead | 3 | 17 | 83 s | all six | — | 5 / 5 / 0 | 5 · 0 · 5 · 9 · 0 · 0 |
| 14 | 6 | Safe | All possessed/dead | 2 | 11 | 51 s | all six | — | 5 / 5 / 0 | 2 · 0 · 2 · 12 · 0 · 0 |
| 15 | 6 | Aggressive | All possessed/dead | 5 | 26 | 131 s | Aggressive, Killer, Team, Rusher, Slow | Killer* → Safe | 5 / 4 / 1 | 10 · 0 · 9 · 4 · 1 · 0 |
| 16 | 6 | Killer | Dawn | 8 | 49 | 204 s | Aggressive, Team, Rusher, Slow, Killer | — | 5 / 4 / 1 | 13 · 0 · 12 · 1 · 1 · 0 |
| 17 | 6 | Team | All possessed/dead | 3 | 15 | 83 s | all six | — | 5 / 5 / 0 | 7 · 0 · 7 · 7 · 0 · 0 |
| 18 | 5 | Rusher | All possessed/dead | 2 | 8 | 51 s | all five | — | 4 / 4 / 0 | 1 · 0 · 1 · 13 · 0 · 0 |
| 19 | 5 | Slow | All possessed/dead | 3 | 15 | 80 s | all five | — | 5 / 4 / 1 | 3 · 0 · 2 · 11 · 1 · 0 |
| 20 | 5 | Safe | All possessed/dead | 3 | 14 | 73 s | all five | — | 4 / 4 / 0 | 5 · 0 · 5 · 9 · 0 · 0 |
| 21 | 5 | Aggressive | All possessed/dead | 2 | 6 | 35 s | all five | — | 4 / 4 / 0 | 1 · 0 · 1 · 13 · 0 · 0 |
| 22 | 5 | Killer | Dawn | 8 | 41 | 179 s | Killer, Rusher, Aggressive | — | 4 / 2 / 2 | 14 · 1 · 11 · 0 · 2 · 0 |
| 23 | 5 | Team | All possessed/dead | 2 | 9 | 50 s | all five | — | 4 / 4 / 0 | 5 · 0 · 5 · 9 · 0 · 0 |
| 24 | 4 | Rusher | All possessed/dead | 8 | 32 | 147 s | Safe, Rusher, Team | Team* → Slow | 3 / 2 / 1 | 10 · 0 · 7 · 4 · 1 · 2 |
| 25 | 4 | Slow | All possessed/dead | 1 | 4 | 24 s | all four | — | 3 / 3 / 0 | 0 · 0 · 0 · 14 · 0 · 0 |
| 26 | 4 | Safe | All possessed/dead | 3 | 10 | 43 s | all four | — | 3 / 3 / 0 | 3 · 0 · 3 · 11 · 0 · 0 |
| 27 | 4 | Aggressive | All possessed/dead | 4 | 16 | 76 s | Team, Safe, Aggressive | Aggressive* → Killer | 2 / 2 / 0 | 4 · 0 · 1 · 10 · 0 · 3 |
| 28 | 4 | Killer | All possessed/dead | 2 | 6 | 32 s | all four | — | 3 / 3 / 0 | 0 · 0 · 0 · 14 · 0 · 0 |
| 29 | 4 | Team | All possessed/dead | 2 | 5 | 27 s | all four | — | 3 / 3 / 0 | 3 · 0 · 3 · 11 · 0 · 0 |

Seeds are 9100 + 131 × match number. Raw data: `tests/personality-results.jsonl`, one line per match. Look at
the Lanterns column: at the end they sit in **possessed hands or still in the deck**, almost never with a clean
guest.

## 4. The simulator: many matches

### 4.1 The mixed table (one of each personality) and smaller tables

| Table | Matches | Clean side wins | Hotel wins | … by escape | … every clean guest possessed or dead | … dawn | Rounds median / mean | Turns median / mean (10%–90%) | Deaths per match |
|---|---|---|---|---|---|---|---|---|---|
| 6 players (one of each) | 12,000 | **7.8%** (±0.5) | 92.2% | 8% | 82% | 10% | 4 / 4.3 | 20 / 22.8 (9–43) | 0.47 |
| 5 players | 6,000 | **5.5%** (±0.6) | 94.5% | 5% | 85% | 10% | 3 / 3.9 | 13 / 17.1 (7–35) | 0.32 |
| 4 players | 6,000 | **3.6%** (±0.5) | 96.4% | 4% | 86% | 10% | 2 / 3.4 | 8 / 12.2 (4–29) | 0.21 |

(For 4 and 5 players the personalities are drawn without repeats.) Other details for 6 players:

- **Possession:** 4.8 attempts per match, 4.3 successful, 0.45 blocked by a Lantern. **44.8% of possessions
  happen in round 1 and 36.4% in round 2.** Only 37% of attempts were aimed at a guest holding a Lantern, and most of
  those guests chose to keep their Lantern.
- **When matches end** (share of matches): round 1: 2%, round 2: 27%, round 3: 19%, round 4: 13%, round 5: 11%,
  round 6: 8%, round 7: 6%, round 8 (dawn or a last-round escape): 14%.
- **Lanterns:** 7.2 of the 14 are found per match. At the end, on average, 5.9 are in possessed hands, 0.5 in clean
  hands and 6.9 still in the deck. **The Fire Exit is found in only 33% of matches** (on average in round 5).
- **Killing:** 3.6 attacks and 0.47 deaths per match. Of the kills, 0.32 per match are by possessed guests, 0.08
  are of possessed guests and 0.07 are clean guests killing clean guests. In 26% of matches a clean guest was dead
  when the hotel won.

**Per personality at the 6-player mixed table:**

| Personality | Clean side won, when it started clean | Hotel won, when it started possessed | Got possessed (started clean) | Survived to the end | Escaped (made the win) | Kills per match | Was killed | Searches | Lanterns found | Attacks | Trades |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Rusher | 8% | 95% | 84% | 91% | **4.0%** | 0.00 | 9% | 3.0 | 1.8 | 0.0 | 4.1 |
| Slow | 7% | 90% | 89% | 91% | 0.0% | 0.00 | 9% | 1.0 | 0.6 | 0.0 | 4.3 |
| Safe | 8% | 91% | **70%** | 86% | 1.3% | 0.00 | 14% | 2.4 | 1.5 | 0.0 | 3.2 |
| Aggressive | 8% | 92% | 95% | 97% | 0.6% | 0.19 | 3% | 1.6 | 0.9 | 1.3 | 5.3 |
| Killer | 7% | **88%** | 94% | 96% | 1.1% | 0.24 | 4% | 1.5 | 1.0 | 2.1 | 4.8 |
| Team player | 9% | **97%** | 87% | 92% | 0.9% | 0.04 | 8% | 2.1 | 1.3 | 0.1 | 5.8 |

(Each personality had 12,000 seats: about 10,000 clean starts and 2,000 possessed starts, so each figure is within
±1 point.) The 5- and 4-player tables show the same pattern, only more one-sided: when a personality starts
possessed the hotel wins 93–98% at 5 players and 95–100% at 4.

### 4.2 Each personality alone (all six seats the same), 2,000 matches each

| Everyone is… | Clean side wins | … every clean guest possessed or dead | … dawn | Rounds median / mean | Turns median / mean | Deaths per match | What happens |
|---|---|---|---|---|---|---|---|
| Rusher | **12.4%** (±1.4) | 88% | 0% | 4 / 3.6 | 21 / 19.4 | 0.01 | Finds the exit fast (59% of matches), but trades without ever blocking: 94% get possessed. |
| Slow | **0.0%** | 96% | 4% | 3 / 3.8 | 18 / 20.8 | 0.00 | **Never finds the Fire Exit.** Possession spreads while everyone potters near the lobby. |
| Safe | **72.2%** (±2.0) | 1% | 27% | 6 / 6.3 | 34 / 35.7 | 0.00 | Few meetings (2.9 trades a match), no possession ever lands on a Lantern holder, and the exit is always found. *The possessed guest here is also Safe, and timid.* |
| Aggressive | **0.6%** | 97% | 2% | 2 / 2.1 | 8 / 9.2 | 0.78 | Everyone runs into everyone, and the game is over in 2 rounds. |
| Killer | **3.5%** | 73% | 23% | 3 / 4.3 | 14 / 15.3 | **2.93** | A bloodbath: 10 attacks and nearly 3 deaths a match, 1.4 of them clean guests killing clean guests. |
| Team player | **2.4%** | 96% | 2% | 2 / 2.4 | 10 / 11.7 | 0.04 | Walking to each other to pool Lanterns means walking into the possessed guest. |

### 4.3 Each personality as the possessed guest, against five Team players (2,000 matches each)

| The possessed guest is… | Hotel wins | … every clean guest possessed or dead | … dawn | Rounds median / mean | Possession tries / successes / blocked | Attacks per match |
|---|---|---|---|---|---|---|
| Rusher | 90.5% (±1.3) | 87% | 3% | 2 / 3.0 | 5.2 / 4.5 / 0.6 | 0.4 |
| Slow | 95.8% (±0.9) | 93% | 3% | 2 / 2.9 | 5.2 / 4.8 / 0.5 | 0.3 |
| Safe | 96.8% (±0.8) | 94% | 3% | 2 / 2.9 | 5.1 / 4.8 / 0.3 | 0.3 |
| Aggressive | 95.8% (±0.9) | 95% | 1% | 2 / 2.6 | 5.2 / 4.7 / 0.5 | 1.0 |
| Killer | 91.4% (±1.2) | 89% | 2% | 3 / 3.1 | 5.0 / 4.5 / 0.5 | 2.3 |
| Team player | **98.3%** (±0.6) | 97% | 2% | 2 / 2.3 | 5.4 / 4.9 / 0.5 | 0.2 |

Against a cooperative table the hotel's style hardly matters. The **possessed Killer and possessed Rusher do
worst** of the six, and even they win about 90%. The Killer spends meetings attacking instead of converting; the
Rusher is off exploring instead of meeting people.

### 4.4 Each personality as one clean guest among the other five (2,000 matches each)

| The clean guest we follow | Clean side wins (team result) | That guest survived | … escaped | … got possessed | … was killed | … kills per match |
|---|---|---|---|---|---|---|
| Rusher | 8.1% (±1.2) | 89% | **4.3%** | 84% | 11% | 0.00 |
| Slow | 7.2% (±1.1) | 89% | 0.0% | 88% | 11% | 0.00 |
| Safe | 8.1% (±1.2) | 82% | 1.6% | **68%** | 18% | 0.00 |
| Aggressive | 7.0% (±1.1) | 98% | 0.9% | 95% | 2% | 0.17 |
| Killer | 6.6% (±1.1) | 96% | 0.9% | 93% | 4% | 0.24 |
| Team player | 8.6% (±1.2) | 91% | 1.1% | 87% | 9% | 0.04 |

One clean player's style moves the team result by only about 2 points, from 6.6% with a Killer to 8.6% with a
Team player, which is close to the margin. The rules decide the match, not one player's style.

## 5. How long a real match would take for people

The simulator measures **turns**. For people, the time per turn is an **assumption**, stated here openly:

- **Hot-seat on one iPad: 35–50 seconds per turn.** This covers the pass-the-device screen, the private turn
  screen, up to 45 s of actions (the turn clock), and on average about 0.6 trades per turn. Each trade needs two
  private picks and two more hand-overs.
- **Online, one device each: 20–30 seconds per turn.** There is no passing, and trade picks happen at the same
  time on two devices.
- Add about **2 minutes at the start** for everyone to read their secret role in hot-seat.

| Table (rules as they stand) | Turns: typical (median) | Long match (90th percentile) | Full length to dawn | Hot-seat time: typical · long · to dawn | Online time: typical · long · to dawn |
|---|---|---|---|---|---|
| 6 players | 20 | 43 | 48 | **12–17 min** · 25–36 min · 28–40 min | 7–10 min · 14–22 min · 16–24 min |
| 5 players | 13 | 35 | 40 | 8–11 min · 20–29 min · 23–33 min | 4–7 min · 12–18 min · 13–20 min |
| 4 players | 8 | 29 | 32 | 5–7 min · 17–24 min · 19–27 min | 3–4 min · 10–15 min · 11–16 min |

**Important for later:** a *balanced* game will be longer, because matches stop ending in round 2. Under the most
balanced idea below (idea C, 6 players) the median match is 39 turns: about **23–33 minutes in hot-seat** and
13–20 minutes online.

## 6. The biggest balance problems these results show

1. **The hotel side wins far too often: 92% at 6 players, 95% at 5, 96% at 4.** No mix of clean personalities
   comes close to a fair game, except a whole table of very careful players.
2. **Possession snowballs in the first two rounds.** Every guest who is possessed receives a working Possession
   card and can pass it on at once, so three cards can convert the whole table. 81% of all possessions happen in
   rounds 1–2, and 28% of matches are over by the end of round 2.
3. **The clean side has no defence at the start.** A Lantern is the only way to block a Possession card, and
   Lanterns are never dealt: they must be found by searching. Meetings are forced, so a clean guest walking into
   the possessed guest in round 1 almost always has nothing that could block. Even later, a clean guest who hands
   over a Lantern loses it.
4. **Small tables are even worse.** At 4 players the possessed guest needs only 3 conversions, one per card. Any
   fix has to be checked at 4 and 5 players, not only 6 (see idea E).
5. **Killing is weak for the hotel and harmful for the clean side.** A possessed Killer is the least successful
   possessed personality (88% against 95–97%), because each attack replaces a conversion. A clean Killer kills
   clean guests: at an all-Killer table there are 1.4 clean-on-clean deaths per match. Killing is not decisive
   today (0.5 deaths per match). It becomes more important once possession is slowed down: 1.1–1.5 deaths per
   match under ideas A, C and D.
6. **Rushing is not useless. It is the best clean style.** Slow, careful exploring never finds the exit. The Fire
   Exit turns up in only a third of matches, and rushers make half of all escapes. The problem is that rushing
   alone cannot win, because the rusher is possessed on the way (84%).
7. **Dawn is not the problem today (10% of matches), but it will be.** Once possession is slowed, the hotel wins
   mainly at dawn: 32–48% of matches under ideas A, C and D. So "8 rounds" may become too short at the same time.
8. **Team play does not pay off under these rules.** Pooling Lanterns means walking up to other guests, which
   feeds the possession chain. The Team player is the *strongest* possessed personality (97%). An all-Team table
   wins only 2.4%.

## 7. Candidate rule ideas: proposals that need the owner's approval

**None of these is in the game.** They were measured only in the simulator, with temporary in-memory changes
(`PROPOSALS` in `tools/balance/personality-study.mjs`). `src/data/rules.js` and `docs/GAME_RULES.md` are unchanged.
Before any of these is built, CLAUDE.md requires a before/after list of every rule change and the owner's
explicit approval. Every figure uses the same mixed table: 6,000 matches per table size, the same seeds, and the
rules as they stand as the baseline.

| Idea | Rule now → proposed | Clean side wins: 6 players | 5 players | 4 players | 6 players: how the hotel wins (all possessed or dead / dawn) | 6 players: median rounds · turns |
|---|---|---|---|---|---|---|
| Baseline | the rules as they stand | 8.1% | 5.4% | 3.6% | 82% / 10% | 4 · 20 |
| **A. A Possession card is used up when it converts someone** | Now the new possessed guest keeps the card and can pass it on. Proposed: it leaves the game, and the new possessed guest has none (it still plays for the hotel). | **30.2%** | 16.3% | 7.3% | 22% / 48% | 8 · 40 |
| **B. Each guest starts with 1 Lantern** | Now Lanterns are never dealt. Proposed: one each at the start, from the same 14. The game already has this switch (`lanternsDealtEach`), and an earlier comparison used it. | **22.3%** | 16.9% | 12.9% | 61% / 16% | 5 · 28 |
| **C. A + B together** | both of the above | **44.9%** | 27.7% | 17.6% | 12% / 44% | 8 · 39 |
| **D. A + B + dawn after round 10** | also: Round limit 8 → 10 | **50.8%** | 33.1% | 22.1% | 17% / 32% | 8 · 40 |
| **E. A + B + 2 Possession cards** (for smaller tables) | also: Possession cards 3 → 2 | 59.9% | **38.7%** (47.9% with dawn after round 10) | **21.0%** (28.1% with dawn after round 10) | 3% / 37% | 7 · 37 |

Smaller ideas, for comparison (6 / 5 / 4 players, clean side wins):

- Dawn after round 10 alone: 8.7% / 6.2% / 4.8%. **Almost no effect.** Matches end long before dawn.
- 2 Possession cards alone: 10.6% / 6.7% / 4.2%.
- A blocking Lantern is not used up (the blocker keeps it): 9.7% / 6.7% / 4.6%.
- 2 Lanterns to escape instead of 3: 13.4% / 9.1% / 6.5%.
- Only the first possessed guest can possess (a converted guest hands the card back): 22.5% / 14.4% / 7.3%.
- A + a blocking Lantern kept: 31.2%. A + dawn after round 10: 36.2%. B + 2 Possession cards: 28.4%.

What the ideas mean, in plain words:

- **Idea A attacks the real cause, the snowball.** On its own it is not enough, because the possessed guest still
  converts the first few people unopposed. Matches become about twice as long.
- **Idea B gives everyone a first defence**, so the round-1 meeting with the possessed guest is no longer a
  guaranteed loss. It also helps careful players most: a possessed Safe player wins only 36%.
- **Idea C (A + B) is the closest to an even game at 6 players** (45% against 55%). Its weak spot is dawn: 44% of
  matches reach dawn, so the owner may prefer **D** (dawn after round 10, 51%). Matches then last about 40 turns.
- **4 and 5 players need extra help** even with C or D (18–33%). Idea E, fewer Possession cards at smaller tables,
  would give each table size its own number of cards. With E, 6 players tip the other way (60–70% clean), so E
  should apply only to 4–5 players.
- Under A, C, D and E, deaths per match rise from 0.5 to about 1.1–1.5, so the attack rules (Knife, Revolver) should be
  looked at again after the possession change.

**Suggested next step for the owner:** choose whether to explore **C or D for 6 players** and **E for 4–5
players**. If yes, the next task is the exact before/after rule list for approval. Only after approval would the
rules be changed and the hot-seat game tested again.

## 8. Things to keep in mind

- Bots are not people. They never bluff, never accuse anyone out loud (except Team players sharing among
  themselves), and always tell the truth about their Lantern count. Real players will talk, lie and get
  suspicious, which could help either side. The size of the gap (8% against 92%) is far larger than bot quirks
  would explain. The real-game matches agree with the simulator: 1 clean win in 18 six-player matches, against 8%
  in the simulator.
- The possessed bots know who the other possessed guests are. In the real game the converted guest is told who
  converted them, and the converter is told whom they converted, so this is close.
- Every personality is one fixed style. Real players mix styles and learn: for example, "always hand over a
  Lantern when you meet someone." The all-Safe table shows that such learning can swing the game, so after any rule
  change it is worth watching whether one dominant strategy appears.

## 9. How to run it again

```
# The real game (server on 8123; one browser; about 50 min for all 30)
(cd /home/user/Gaming-App && setsid nohup python3 -m http.server 8123 --bind 127.0.0.1 >/dev/null 2>&1 &)
cd tests && node autoplay.mjs --url http://127.0.0.1:8123/ --persona-study --matches 30
#   one match: --personalities rusher,slow,safe,aggressive,killer,team --seed 1234
#   results: tests/personality-results.jsonl

# The simulator (about 6 min for the study, 15 min for the proposals at 4, 5 and 6 players)
node tools/balance/hotseat-sim.mjs --study [--json out.json]
node tools/balance/hotseat-sim.mjs --study --only proposals --pplayers 4,5,6
node tools/balance/hotseat-sim.mjs --personalities rusher,slow,safe,aggressive,killer,team --shuffle --n 2000
node tools/balance/hotseat-sim.mjs --personalities rusher,slow,safe,aggressive,killer,team --n 1 --trace   # every action of one match
```

`node tools/balance/hotseat-sim.mjs 400 6` without these options still runs the original bots exactly as
before.

## 10. Follow-up (4 October 2026): tests A, B and C after the locked-door change

Asked by the owner. Simulator only: **no game rule or game code was changed**. The same mixed table as section 7,
6,000 matches per row, same seeds, rules as they stand after the locked-door change (one door per locked room,
re-locks at the end of the opener's turn). Margin about ±1 point.

| Test | Change | Clean side wins: 6 players | 5 players | 4 players | 6 players: median rounds · turns | 6 players: how the hotel wins (all possessed or dead / dawn) |
|---|---|---|---|---|---|---|
| A | Current rules | 8.3% | 5.4% | 3.6% | 4 · 20 | 81% / 10% |
| B | Each guest starts with 1 Lantern | 22.2% | 17.1% | 13.0% | 5 · 28 | 61% / 17% |
| C | B + a newly possessed guest can pass possession on only from the next round | 23.7% | 18.0% | 13.3% | 6 · 29 | 58% / 19% |
| (C without B, for comparison) | next-round possession only | 10.1% | 5.8% | 3.9% | 4 · 24 | 77% / 13% |

- **A:** the door change made no measurable difference (8.1% → 8.3%, within the margin).
- **B:** the earlier improvement still holds (22.3% before, 22.2% now).
- **C:** slowing the chain adds only about 1.5 points on top of B. It does not create a competitive game. The
  original possessed guest still holds 3 Possession cards and converts most victims in rounds 1–2 (conversions in
  round 1 fall only from 41% to 34% with B), and a converted guest is free to pass possession on one round later,
  which is still early.

Run: `node tools/balance/hotseat-sim.mjs --study --only proposals --pkeys dealt1,nextRound,dealt1+nextRound --pplayers 6,5,4`

## 11. Follow-up (4 October 2026): the owner's five measurements for tests A, B and C

Same runs as section 10 (6,000 matches per row; win rates identical). Simulator only, no rule changed. Three
independent reviewers checked the new measurements: one recomputed every number with its own bookkeeping and agreed
exactly; their corrections (dawn turn counted twice, death mislabelled as "handed out", finished matches mixed into
the round-2 figures) are fixed in the numbers below. "After round 2" = when every living guest has had their round-2
turn; a match already over by then is counted in its end state (0 clean guests if the hotel had won).

| Measure | A 6p | B 6p | C 6p | A 5p | B 5p | C 5p | A 4p | B 4p | C 4p |
|---|---|---|---|---|---|---|---|---|---|
| Clean side wins | 8.3% | 22.2% | 23.7% | 5.4% | 17.1% | 18.0% | 3.6% | 13.0% | 13.3% |
| All Possession cards out of the game after round 2 | 1.0% | 1.8% | 1.1% | 0.6% | 1.2% | 0.8% | 0.6% | 1.4% | 1.0% |
| First possessed guest has none of his 3 left after round 2 (passed on or burned) | 38.6% | 43.5% | 48.7% | 28.4% | 34.0% | 38.6% | 14.4% | 20.5% | 23.8% |
| No successful conversion all match | 1.8% | 11.4% | 11.4% | 2.1% | 12.8% | 12.8% | 3.0% | 15.5% | 15.5% |
| Clean guests left after round 2, average (out of) | 1.4 (5) | 2.2 (5) | 2.6 (5) | 1.0 (4) | 1.7 (4) | 1.9 (4) | 0.7 (3) | 1.3 (3) | 1.4 (3) |
| …only matches still running after round 2 | 2.0 | 2.6 | 2.7 | 1.7 | 2.2 | 2.3 | 1.5 | 1.9 | 1.9 |
| Match already lost by the end of round 2 | 27.3% | 12.8% | 4.7% | 41.1% | 22.5% | 14.3% | 53.5% | 32.2% | 25.9% |
| Fire Exit found before the match ended | 34.1% | 56.4% | 60.3% | 23.6% | 43.0% | 45.7% | 15.3% | 31.8% | 32.5% |
| Match length: median rounds · turns (long match, 90th pct) | 4 · 20 (43) | 5 · 28 (47) | 6 · 29 (47) | 3 · 13 (36) | 5 · 22 (40) | 5 · 23 (40) | 2 · 8 (29) | 4 · 15 (32) | 5 · 17 (32) |
| Typical hot-seat time (35–50 s per turn) | 12–17 min | 16–23 min | 17–24 min | 8–11 min | 13–18 min | 13–19 min | 5–7 min | 9–13 min | 10–14 min |

Notes:
- Under the current rules a converted guest keeps the Possession card, so Possession cards almost never leave the
  game (about 1%). The second row says how often the first possessed guest has emptied his own hand; in about 97% of
  those matches converted guests still carry cards and keep spreading them.
- "No successful conversion" is the same for B and C because C only delays guests who were already converted.
- Test C as measured: a guest converted in round R cannot pass possession during round R. About 40% of conversions
  happen after that guest's own round-R turn, so for them the limit never covers one of their turns. A stricter
  version ("not until after their next own turn") was not measured.

## 12. Owner's idea (7 October 2026): 4 health, 2 Possession cards, "1 chance" per possessed guest

Simulator only; no game rule changed. Every row keeps the approved starting Lantern. 6,000 matches per row, same seeds
(margin about ±1 point). Bots heal relative to full health (at 3 health they play exactly as before). Three
independent reviewers checked the variants (semantics traces, an independent recount that matched every number, and
bot fairness).

Two readings of "who gets possessed has 1 chance to possess someone else":
- **Reading 1** = today's card rule: a possessed guest keeps the one card they received (one chance) and their victim
  then holds it, so the chain continues.
- **Reading 2** = one generation: the first possessed guest's victims each get his card (one chance); when one of
  them possesses someone, the card is used up, so the chain stops there.

| Variant | Clean wins 6p | 5p | 4p | 6p: hotel wins by all possessed/dead · dawn | 6p median rounds · turns (long) |
|---|---|---|---|---|---|
| Current rules | 22.4% | 17.2% | 12.9% | 60% · 17% | 5 · 28 (47) |
| 4 health only | 22.9% | 17.8% | 13.0% | 56% · 21% | 5 · 30 (48) |
| 2 Possession cards only | 28.8% | 20.6% | 14.4% | 47% · 25% | 6 · 32 (48) |
| One generation only | 28.1% | 19.6% | 13.3% | 42% · 30% | 6 · 33 (48) |
| 2 cards + one generation | 38.1% | 24.7% | 14.9% | 21% · 41% | 8 · 38 (48) |
| **Owner, reading 1** (4 health + 2 cards) | **30.0%** | 21.7% | 14.8% | 41% · 29% | 6 · 35 (48) |
| **Owner, reading 2** (4 health + 2 cards + one generation) | **40.9%** | 26.8% | 15.5% | 12% · 47% | 8 · 42 (48) |
| Owner, reading 1 + dawn after round 10 | 32.6% | 25.4% | 18.8% | 48% · 19% | 6 · 35 (60) |
| Owner, reading 2 + dawn after round 10 | **46.2%** | 32.4% | 19.9% | 17% · 36% | 8 · 44 (60) |

Notes:
- 4 health barely moves the win rate (+0.5 pt); it cuts deaths by 35–50% (6p: 0.63 → 0.32–0.41 per match, depending on how
  eagerly players heal).
- Under reading 2 most hotel wins come at dawn (47% at 6p): the possession spread is contained and the clock decides.
  That is why dawn after round 10 now helps (+5 pt), unlike before.
- Caveat: a bot playing "Safe" as the first possessed guest almost never uses its cards (only targets guests who claim
  no Lantern), which inflates every clean-win figure by about 8 points at 6p. With those matches left out:
  current 13.4%, reading 1 22.7%, reading 2 33.2%, reading 2 + dawn 10 38.3%. Real players as the ghost will use their
  cards, so the true figures likely sit between the two columns.
- 4 and 5 players stay far from even under every variant; they need their own numbers.
- Match length at 6p, reading 2: median 42 turns ≈ 25–35 min in hot-seat, 14–21 min online.

Run: `node tools/balance/hotseat-sim.mjs --study --only proposals --pkeys hp4,supply2,oneGen,supply2+oneGen,owner1,owner2,owner1+dawn10,owner2+dawn10 --pplayers 6,5,4`
