# Hotel Escape: Single player and Co-op (final design)

*Lead design, 2 Nov 2026. Repo at commit `dacfcde` (v0.11). Nothing in the repo was changed. Built from the four
research reports (`scratchpad/mp/research/code.md`, `ux.md`, `tech.md`, `rules.md`), the three proposals
(`proposals/minimal.md`, `robust.md`, `edge.md`) and the three judgements (`judge/simplicity.md`, `player.md`,
`robustness.md`). Every judge must-fix is answered in section 1.3. Code references are file:line at `dacfcde`.*

*Companion files: `BUILD-PLAN.md` (what builders do tonight, in order) and `OWNER-DECISIONS.md` (what waits for the
owner, with the rule BEFORE/AFTER list).*

*__As built (v0.12, 3 Nov 2026).__ This design was built as written, except for the points listed in
`docs/DECISIONS.md`, section "Co-op (v0.12): what was built differently from the design, and what is not built yet".
The largest: `render.yaml` starts the server with a 256 MB heap cap (§17); the build filter also lists
`src/config.js` (§10.6); a page on another protocol or with other data gets `bye update` / `serverOld` and close
4004 / 4005 rather than `err` (§7.4); IPv6 limits count a /56 with a /48 share and a server-wide brake (§7.5). Not
built: the stand-ins of §5.7 (R6/R7), the Relaxed clock, "a friend who arrives mid-match" (§8.10), quick chat in the
waiting room and `table.clockLeft()` (§4.1). The file references (file:line) below are to `dacfcde` (v0.11), before
the build.*

*__Amended 2 Nov after critique.__ `CRITIQUE.md` (44 findings, checked against `dacfcde`) led to changes marked
**[Amended 2 Nov after critique, #n]**, where n is the critique's finding number. The largest are:*
- *the screens keep **one long-lived presenter state** (`applyView`), not a fresh object per view (§4.1, §6.6);*
- *Single player's table applies commands **synchronously**, and test pokes are re-synced (§4.3);*
- *the referee has **`botRules: 'page' | 'autoplay'`** (§5.3);*
- *an outsider never sees the active seat's **discard** (§5.3);*
- *cards keep `owner`/`shots` in the view (§6.1);*
- *`do` results are **whitelisted** (§6.3);*
- *test-only `TIME_SCALE`/`LIMITS_SCALE` switches exist (§9, §15);*
- *the review link goes through the **real Co-op screens** (§16).*

*`CRITIQUE-RESPONSE.md` lists every finding with what was done.*

---

## 0. In plain words (for the owner)

- **The main menu gets two big buttons: "Single player" and "Co-op".**
  - **Single player** holds today's **Play with bots** and **Practice alone**, unchanged. The only difference is
    one extra tap to reach them.
  - **Co-op** is a private table with friends, each on their own iPad, phone or computer. You start a table, send
    the link (or the 5-letter code), friends tap it and sit down, and you start the match. Bots fill empty seats.
- **About the name.** "Co-op" usually means everyone is on the same side. In Hotel Escape someone at the table is
  secretly possessed and against the others, so players may expect the wrong game. We recommend **"Play with
  friends"**. It is your choice and it is one line of text; until you decide, the button says "Co-op".
- **No password.** A table is private: nobody can find it without your link or code, the code only works while
  the table is waiting to start, and you can **lock** the table and **remove** someone before the match.
- **How it works.** A small program, "the server", runs the same rules and the same bots your iPad runs today.
  Each device receives only what its own guest may know. Even someone who takes the web page apart can't see
  other people's cards or roles.
- **Single player stays exactly as it is.** It is rewired underneath to use the same "one player's view" as Co-op,
  so it keeps working and gets tested every day, but nothing you see or feel changes. All of today's automatic
  tests must still pass, unedited, after every step.
- **Your rules are untouched.** Online play raises questions your rules don't answer yet (a friend whose iPad
  falls asleep, someone who never picks a card). Until you approve the rule list in `OWNER-DECISIONS.md`, Co-op
  uses **today's rules unchanged**, plus a few clearly marked technical stand-ins (section 13). Co-op stays
  "coming soon" for players until you approve the list and open a hosting account.
- **What you can try before paying anything.** A test link where you hold two players' seats on one iPad and
  switch between their screens, and a recorded match with several players. Later, a free hosting account for a
  real two-device test.
- **Money.** Nothing until friends play for real. Then about $7 a month (Render "Starter") plus about $0.25 a month
  for a small disk so a match survives server updates. Your decision (`OWNER-DECISIONS.md` D7).

---

## 1. The choice, and what was grafted

### 1.1 Base: the Minimal design

The three judges ranked the proposals differently. Totals: Minimal 21.5 (8 + 6.5 + 7), Edge 20, Robust 19.5.
Minimal is the base because it is the simplest thing that works (CLAUDE.md), protects Single player best, stays on
the hosting path the owner already saw (`docs/ONLINE_PLAN.md:13-18`), and is the only proposal that closed the
meeting-step weapon leak and found a review route that works on a real iPad.

Its central idea stays: **after every step the server sends each person their whole current view** (measured
3,565 B average, 4,756 B max, `probe-minimal/view-size.mjs`, re-run by two judges). Events only drive animation.
A lost message costs at most an animation; reconnecting is "say hello, get the full view".

### 1.2 Grafts (by source)

| Graft | From | Why |
|---|---|---|
| Per-table card ids in the engine (optional `perTableIds`), with per-seat aliases on the wire | Edge E2, Robust E1/E4, Minimal 6.3 | Tables stop sharing module state; a saved table restores without id clashes (replay broke 50/50 without them, robust probe); aliases stop card trails |
| Save the table after every step (Edge's ~60-line snapshot: Sets/Maps tagged, hotel rebuilt with `placeTile`), save before send, restore before listen, SIGTERM drain | Edge 2.1/4.3, Robust 4.2-4.4 | A deploy or restart no longer ends matches when a disk exists. Snapshot is data, so bug-fixes don't void live matches (unlike replay) |
| Crash isolation per table, reload-last-save, void after a second failure, event-loop watchdog, step caps | Edge 1.2.3, robustness must-fix 7 | One table's bug never stops the process |
| Update policy: auto-deploy with build filters, `/health` with match counts, data hash in `hello` | Robust 4.5, 9 | The owner never presses deploy; a page and server holding different hotel data can't silently draw a wrong map |
| Presence `here / hidden / gone` with a `vis` hint from the page; newest connection wins | Robust 6, 13.5 | Away is known within ~2 s of an app switch; Safari zombie sockets never lock a player out |
| Pending private results kept in the view until read | Robust 8.1 | A search result, Mirror result or trade reveal survives a drop |
| Table record in localStorage: a Safari reload rejoins | Robust 12.2 | Today a reload loses the match |
| Presentation queue that skips past 3 s of backlog | Robust 7 | Coming back never replays old walks |
| "While you were away" (only once the stand-in rule R6 is approved) | Robust 6, 14.8 | You must know what "your" guest did |
| Waiting room: portraits, Lock, 5 s countdown with Wait, "Wait · Play with bots" when alone, 560 px panel, keyboard handling | Edge 13 | Best fit for the look; the lobby stays visible |
| Peek: "You're invited to nora's table", rate-limited, in the protocol | Edge 8.7, player must-fix 11 | The host's name before joining |
| Equal-traffic test, protocol fuzz, interleaved tables, acts never auto-retried, answers idempotent by ask id | Edge 7.3, 8.3, 14.1 | Fairness and robustness proofs |
| `pagehide` close, connection-check with a fake socket, never give up reconnecting | Robust 12.1, 15.1; player must-fix 7 | iPad Safari |
| All new words in one data file | Robust 3.1 | Renaming "Co-op" and any wording review stay data-only |
| Honest plain words ("switchboard is waking up", "usually about 20 minutes") | Minimal 12.3 | |

**Not taken:** deterministic replay, hand-written ChaCha20, digests and outbox resume (Robust); Cloudflare Durable
Objects (Edge: a new platform, a free-plan CPU limit at the measured worst case, a save format every release must
read, no Middle East placement). Recorded in `docs/DECISIONS.md` as the exit door if Render ever disappoints.

### 1.3 Every judge must-fix, and where it is answered

| Must-fix (judge) | Answer |
|---|---|
| Crash isolation; `'error'` listener on every socket; `maxPayload` 4 KB (simplicity 1, robustness 7) | §10.4, §12.4 |
| No stable card ids on the wire; per-seat aliases re-issued each time a card enters a hand (simplicity 2, robustness 2) | §6.5 |
| Public phase is only `meeting` + two seats; bots' meeting beat fixed; person walker always sees Trade/Attack with Attack greyed; test by swapping the weapon (simplicity 3, player 2, robustness 1) | §5.4, §6.8 test 6 |
| Owner review that works on the iPad (no Split View) (simplicity 4, player 15, robustness 17) | §16 |
| Update policy runnable from an iPad, no secrets; protocol version + data hash (simplicity 5, robustness 11) | §7.4, §10.6, §17 |
| Single player first, optional engine edits only, seeded referee replay green before main.js switches, `__game.state` kept, R11 friends-only (simplicity 6) | §3, §4.3, §6.8, BUILD-PLAN P1 |
| Rules gated; numbers in `src/data/online.js` marked pending; GAME_RULES.md untouched; no "choose your role" online; test links ignored online (simplicity 7) | §13, OWNER-DECISIONS |
| Crypto randomness for every online secret, bot seeds included; reseed minds after restore (simplicity 8, robustness 5) | §3, §10.3, §12.2 |
| View is the only thing a device receives; scramble test, whitelist, wire scan, seam-check, `seq` stripped, placements, `deckEmpty`, drops as presence (simplicity 9) | §6, §15 |
| Origin allowlist (Capacitor/Electron later), `wss://`, `?server=` localhost only, rate and wrong-code limits, token only in `hello` (simplicity 10) | §12 |
| Safari wake events, `pagehide`, fresh socket, ping on visible, pill after 1 s, Wake Lock, `?join=` kept (simplicity 11, player 7) | §11 |
| All numbers, words, labels in data files; label "Co-op" until decided (simplicity 12) | §14.1, `src/data/online.js`, `src/data/onlineText.js` |
| Render Free wake explained; Starter before friends; Singapore confirmed (simplicity 13) | §14.4, OWNER-DECISIONS D7 |
| Docs (simplicity 14) | BUILD-PLAN P6 |
| Alert on an off-turn ask: sound + full-screen ask + seconds ring (player 1) | §14.6 |
| Away known within ~2 s (player 3) | §11.3: the server knows at once from the page's `vis hidden` hint (stand-in grace counts from then); others see Away after 5 s |
| Never lose a private result (player 4) | §6.4 |
| No match ended by a deploy, restart or another table's bug (player 5) | §10 (with a disk; honest message without) |
| Tap feedback within a frame; the walk starts on the device's own route (player 6) | §4.5 |
| Warn before starting with an Away friend (player 8) | §8.6 |
| Play again with the same countdown, nobody pulled off the end screen (player 9) | §8.9 |
| Lock (player 10, robustness 13) | §8.5 |
| Code field above the keyboard, tested (player 12) | §14.3 |
| "Busy" never blames the player's internet (player 13) | §14.8 |
| Two names for two table screens (player 14) | §14.5 ("Your private table") |
| Stand-in shown as Away, never chats; role change, then While you were away, then control (player 16) | §5.7 (pending R6) |
| Look changes in the waiting room reach everyone (player 17) | §7.1 `lobby {op:'look'}` |
| Equal traffic (robustness 3) | §6.8 test 7 |
| Every refusal reason and ask audited by the scramble test (robustness 4) | §6.8 test 1 |
| Names and looks checked on the server (robustness 6) | §12.5 |
| Newest connection wins (robustness 9) | §11.4 |
| Stand-in grace min(10 s, deadline − 3 s) (robustness 10) | §5.7 (pending R6) |
| Limits that bind: trusted client IP, /64, creation limits, ≤2 open tables, global cap → busy (robustness 12) | §12.3 |
| Peek shares join limits and returns only the host's name for waiting tables (robustness 14) | §8.3 |
| CI suites; state what this container can't prove (robustness 15, 16) | §15, §18 |

---

## 2. Architecture

```
  iPad A (Safari, GitHub Pages)          iPad B                 one Node 22 process (Render, Singapore)
 ┌──────────────────────────────┐   ┌────────────┐            ┌─────────────────────────────────────────────┐
 │ screens (presenter):          │   │ same page  │   wss://   │ server/index.js  http /health, ws, Origin,  │
 │ main.js, hud, map, ui/*,      │   └────────────┘◄──JSON────►│   limits, heartbeat, SIGTERM, watchdog      │
 │ render/*                      │                             │      │                                      │
 │   reads table.view only       │                             │ src/net/rooms.js  tables by code, waiting   │
 │   sends table.send(cmd)       │                             │   room, presence, fan-out, aliases, saving  │
 │        │                      │                             │      │                                      │
 │  Table interface ─────────────┼─ Co-op: OnlineTable ─wss───►│ src/net/referee.js     (same file as page)  │
 │        │                      │                             │ src/net/playerView.js  (same file as page)  │
 │  Single player: LocalTable ───┤                             │ src/game/* + src/bots/* (unchanged rules)   │
 │   referee + playerView +      │                             │ store: memory, or files on a Render disk    │
 │   src/game + src/bots in page │                             └─────────────────────────────────────────────┘
 │  Review link: loopback ───────┘  (rooms.js running inside the page; two seats on one iPad)
 └──────────────────────────────┘
```

- **One referee** (`src/net/referee.js`, pure) runs the match in three places: the page for Single player, the
  server for Co-op, and Node tests. It is today's turn flow lifted out of `main.js` (meetings 849-1039, bots
  1076-1199, clock 597-676) and `src/bots/autoplay.js`, with people's choices turned into questions.
- **One view builder** (`src/net/playerView.js`, pure) decides what one seat may know. It extends `botView`
  (`src/bots/view.js:32-92`).
- **The screens can't tell Single player from Co-op.** Both hand them a `PlayerView` and accept the same commands
  (the bots' own action objects, `src/bots/index.js:24-29`).
- **The server** is one Node 22 program with one dependency, `ws` (pinned 8.22.0, see §17). The page uses the
  browser's own `WebSocket`: no client library, nothing added to the import map, still no build step.
- **Tables live in memory** and are saved after every step to a store: in memory (tests, Render Free) or as files
  (`DATA_DIR`, a Render disk). Measured headroom: 300 tables at about 50× real speed used 67% of one core and
  320 MB (tech.md §9).

### 2.1 Files (new unless marked)

| Path | What | Runs in |
|---|---|---|
| `src/net/playerView.js` | `playerView()`, `seatEvents()`: what one seat may know | page, server, tests |
| `src/net/viewAsState.js` | `applyView()`: writes a `PlayerView` into one long-lived object shaped like the engine state, so screens and button checks run unchanged (§6.6) *[Amended 2 Nov after critique, #7]* | page, tests |
| `src/net/floorCopy.js` | The device's own hotel (one object for the page's life), grown from public placements with `placeTile` | page, tests |
| `src/net/rng.js` | `cryptoRng(randomBytes)`: a `[0,1)` source from injected random bytes *[Amended 2 Nov after critique, #21]* | server, page (loopback), tests |
| `src/net/outcomes.js` | `tradeOutcome()`, a pure copy of the one in `ui/tradeReveal.js:39-49` (which re-exports it) *[Amended 2 Nov after critique, #21]* | page, server, tests |
| `src/net/aliases.js` | Per-seat card aliases | server, page (loopback), tests |
| `src/net/referee.js` | The match: phases, questions, deadlines, bot steps, holds, walk modes, stand-ins (pending) | page, server, tests |
| `src/net/snapshot.js` | Engine state + floor to plain JSON and back (Edge spike `lib/snapshot.js`, 48 lines) | server, tests |
| `src/net/localTable.js` | Single player: deals, runs the referee and bots and the chatter in the page; local pacing hooks | page |
| `src/net/rooms.js` | The server's brain: tables by code, waiting room, host, start, presence, fan-out, saving. Pure: `send`, `now`, `random`, `store` injected | server, page (loopback), tests |
| `src/net/store.js` | `createMemoryStore()` | server, page, tests |
| `src/net/codes.js` | 5-letter codes and their blocklist | server, page, tests |
| `src/net/protocol.js` | Message types, validators, close codes, limits | page, server, tests |
| `src/net/dataHash.js` | Hash of the shared data the page draws and checks with | page, server |
| `src/net/serverUrl.js` | Which server to talk to, or "coming soon" | page |
| `src/net/connection.js` | The page's WebSocket: hello, retries, Safari wake-ups, ping, `vis`, `pagehide` | page |
| `src/net/onlineTable.js` | `openCoop()`: the waiting-room calls plus the Table interface over `connection.js` | page |
| `src/net/loopback.js` | An in-page transport to `rooms.js` (JSON round trip) for the review link | page |
| `src/net/guestKey.js` | The device key in localStorage (sessionStorage / memory fallback) | page |
| `src/net/wakeLock.js` | Screen Wake Lock during the waiting room and the match | page |
| `src/net/presentQueue.js` | Plays updates in order; skips to the latest past 3 s of backlog | page |
| `src/data/online.js` | Server address, protocol version, technical numbers, today's rules online and the pending proposals | page, server |
| `src/data/onlineText.js` | Every new word, including the label "Co-op" | page |
| `src/ui/coopMenu.js` | Co-op screen, waiting room, join, can't-join cards, coming soon | page |
| `src/ui/coopMatch.js` | In-match additions: Away tags, reconnect pill and card, stall banner, ask ring, end buttons | page |
| `src/ui/seatSwitch.js` | The review link's "Show sam's screen" switch, shown from the waiting room on *[Amended 2 Nov after critique, #37]* | page |
| `src/net/fakeLobby.js` | Development only (`?coop=fake` on localhost, loaded by dynamic `import()` only): scripted waiting-room states and errors for building the screens before the server exists | page |
| `coop.css`, `coop-match.css` | Styles for the two UI files (relative links in `index.html`) | page |
| `server/index.js`, `server/fileStore.js`, `server/clientIp.js` | The thin wire: http, ws, Origin, limits, heartbeat, file store, SIGTERM | server |
| `server/package.json`, `server/package-lock.json`, `server/.gitignore`, `server/README.md` | `ws` 8.22.0 exact; `node_modules` ignored | — |
| `render.yaml` | Render Blueprint: region, build filters, health check, env (no secrets) | — |
| **Changed:** `src/game/state.js`, `cards.js`, `hotel.js`, `actions.js` (one line), `src/bots/autoplay.js` | Optional parameters only (§3) | |
| **Changed:** `src/main.js`, `src/discovery.js`, `src/hud.js`, `src/map.js`, in-match `src/ui/*`, `src/matchSummary.js`, `src/audio/gameSounds.js` | Read the view, send commands (§4.3) | |
| **Changed:** `index.html` (menu sections, two `<link>`s), `src/ui/menu.js`, `src/ui/register.js` | Menu split, Co-op screens, invite line | |

`server/` imports `../src/net/*`, `../src/game/*`, `../src/bots/*`, the `../src/data/*.js` files those need (rules,
hotel, chat, online, and what `src/table.js` and `src/bots/profiles.js` pull in; `protocol-check` lists the real import
graph), `../src/table.js`, `../src/account/username.js` and `../src/social/chat.js`. All are pure today (code.md §3.1:
Node 22 played a whole match with them). GitHub Pages also publishes `server/`; that is harmless (no secrets).
`.nojekyll` stays.

---

## 3. Engine options (optional parameters; every current caller behaves exactly as today)

| # | File | Change | Default (no option) |
|---|---|---|---|
| E1 | `src/game/state.js:15-30` | `createState(floor, roster, seed, opts)` and `resetState(state, floor, seed, opts = {})` accept `opts.rng` (a `() => [0,1)` source used for the deal, the possessed seat, reshuffles and Lock Picks; `state.rng = opts.rng`) and `opts.hotelRng` (passed to `resetHotel`). With `opts.rng`, `seed` may be `null` and `state.seed = null` | `makeRng(seed)`, today's path; `?seed=` links unchanged |
| E2 | `src/game/cards.js:18-45`, `state.js`, `actions.js:481` | `makeCard(type, { owner, id })`; `buildDrawDeck(spec, newId)`; `buildPossessionSupply(owner, newId)`; `export const nextCardId = state => state?.cardSeq != null ? 'c' + (++state.cardSeq) : null`. `opts.perTableIds: true` sets `state.cardSeq = 0`; the soul cards at `actions.js:481` pass `id: nextCardId(state)` | the module counter (`cards.js:18`), so ids are identical to today |
| E3 | `src/game/hotel.js:57-84` | `resetHotel(floor, seed, rng = null)`; export `clearHotel(floor)` and `placeLobby(floor, doors)` (sets `floor.start`), which `resetHotel` now calls | identical rooms and random sequence |
| E4 | `src/bots/autoplay.js:60-72` | export `planWalk(state, floor, p, to)` → `{ ok: true, rooms }` or `{ ok: false, reason }` (roomRoute; `here` if under 2 rooms; cut at the first room with a forced meeting; `canAffordRoute`). `runAction`'s `move` uses it, then enters each room and runs `runMeeting` as now | identical |

**Online (server) passes:** `rng` and `hotelRng` from `crypto` (stateless: `cryptoRng(randomBytes)` in the new
`src/net/rng.js`, modelled on `edge-spike/lib/rng.js`, with the byte source injected; nothing to save or recover),
`perTableIds: true`. Bot and chatter seeds come from `crypto` too. **Single player passes nothing.** *[Amended 2 Nov
after critique, #21]*

**Not changed:** the shared event counter `state.eventSeq` (`state.js:112`): the view strips `seq` (§6.2). Public
event shapes: unchanged, so `tests/public-events-check.mjs` SHAPES stay as they are. `applyMode`
(`rules.js:180-195`) mutates four fields the engine never reads (code.md §3.2); tables keep their own clock
setting, so many tables share `rules` safely.

**Guard:** a baseline of seeded matches (seeds 1-50, 4/5/6 seats, all-bot through `autoplay.playOut`) is recorded
**before** the edits as `tests/fixtures/engine-baseline.json` (event list hash, winner, turns per seed) and must match
**after** them. `rules-check`, `bots-check` (incl. determinism, `bots-check.mjs:604-614`) and `public-events-check`
stay green unedited.

---

## 4. The table seam

### 4.1 The Table interface (exact)

```js
// What the screens may use. LocalTable and OnlineTable both implement it. Nothing else of the match is visible.
table.kind                 // 'local' | 'online'
table.seat                 // my seat once dealt
table.view                 // the latest PlayerView (§6.1); replaced on every change, never mutated (Object.freeze in dev).
                           //   The SCREENS never read it directly: the presenter copies it into its one long-lived
                           //   presenter state with applyView (§6.6). [Amended 2 Nov after critique, #7]
table.on(fn)               // fn({ view, events, fresh, local }) after every change → unsubscribe()
                           //   events: what just happened, in order (§6.2), for animation, sounds and the feed
                           //   fresh:  true after a reconnect, a seat switch, a restore or a skipped message → draw, don't animate
                           //   local:  LocalTable only: [{ type:'walk', seat, rooms } | { type:'walkCut', seat, to }] (§4.4)
                           //   LocalTable runs listeners BEFORE apply/step/tick return (synchronous). [Amended #8]
table.send(cmd)            // → Promise<{ ok, reason?, result? }>   (cmd: §6.3). LocalTable: a promise around the
                           //   synchronous table.local.apply(cmd), which Single player's presenter calls directly. [Amended #8]
                           //   result is whitelisted: move → { rooms }; everything else null (§6.3). [Amended #11]
table.say(id, about?)      // quick chat → Promise<msg | null>  (null: cooling down)
table.onChat(fn)           // every line said at the table, bots' included → unsubscribe()
table.clockLeft(now)       // seconds left on the clock being shown, or null
table.leave()
table.local                // LocalTable only (§4.4); undefined online
table.net                  // OnlineTable only: { status, onStatus(fn), lobby, lobbyOp(op), back() }
```

### 4.2 LocalTable (Single player)

```js
createLocalTable({
  roster,                 // today's seatTable() result (src/table.js:44), seat order
  humanSeat,              // the player's seat (random today, main.js:1669; ?seat= in tests)
  seed,                   // today's newSeed() (main.js:147): ?seed= and practiceSeed keep working
  practice,               // true for Practice alone
  possessedIndex,         // today's role choice → state.setup.possessedIndex (main.js:1676-1681, state.js:44-46)
  botSeats,               // [{ index, profile }] (today's planGame)
  clockOn,                // rules.turnTimerEnabled after applyMode and ?timer=off
  paceScale,              // () => number: Bot speed × ?botpace × (0.5 once the player is dead), main.js:1059-1063
  chat,                   // boolean: Settings › chat is not off (main.js:1720); no chatter otherwise
  hotelData, cfg,         // the real floor is built inside; the page never holds it (after S2)
  adopt,                  // TRANSITIONAL { state, floor }: S1 re-deals INTO the page's own objects with resetState, as
                          //   resetWorld does (main.js:1570-1574); S2 stops adopting the floor; S5 removes it
}) → table
```

*[Amended 2 Nov after critique, #13, #14]* LocalTable derives today's seeds itself: bots
`((seed * 2654435761) >>> 0) || 1` (`main.js:1717`), chatter `((seed * 2246822519) >>> 0) || 1` (`main.js:1720`).
`pace(seat, kind) = (bots.thinkMs(seat, kind) ?? 600) × paceScale()`, exactly today's `botThink`. `main.js` imports
`localTable.js` with a dynamic `import()` when a match is set up, so `src/bots/*` stay lazily loaded
(`main.js:1621-1642`).

- The real `state`, the real floor, the bot minds and the chatter live **inside** LocalTable (from S5; during S1-S4
  through `adopt`). `main.js` holds only `table`, the floor copy (§6.7) and its one long-lived presenter state, filled
  by `applyView` (§6.6). *[Amended 2 Nov after critique, #7]*
- Card aliases are the engine ids (identity) in Single player, so the ~230 test references and hooks that pass card
  ids keep working (code.md §5). `view-check` runs with real aliases.
- `limits` are `LOCAL_LIMITS` (§5.2): today's clock, no meeting or screen limits, no stand-ins, no stall timer.
- `walkMode: 'device'` (§4.4).

### 4.3 How the screens stop reading the whole game (main.js switch)

`main.js` today deals (160, 1574), runs bots (1076-1199), meetings (849-1039) and the clock (597-676), and makes 33
rules-changing calls. After the switch it only **presents**: it reads its presenter state (filled by `applyView`
from `table.view`), keeps the floor copy in step, animates `events`, and sends commands. The switch goes in five
steps (BUILD-PLAN P1C, S1-S5, in four checkpoints). After each step all fast suites and all browser suites pass
**without editing a single existing test**, and only then is the step committed on the lane branch for the lead to
merge and publish. *[Amended 2 Nov after critique, #41]*

**The page's long-lived objects stay long-lived** *[Amended 2 Nov after critique, #7]*. Today `main.js` creates one
`state` and one `floor` at boot (`main.js:106`, `:160`) and hands them to modules that keep them:
- discovery (`main.js:410`), the search spot (`:427`), the sounds (`:2245`), the map (`:287`) and the search marks
  (`:251`) hold them;
- `gameSounds` resets whenever `state.events !== list` (`src/audio/gameSounds.js:105`);
- the feed remembers log-line **objects** (`src/ui/feed.js:127-136`);
- `knownPossessedIds` memoises on the viewer object (`src/ui/allies.js:25-27`).

So the presenter state is **one object for the page's life**, written only by `applyView` (§6.6). The floor copy is
**one object for the page's life**, created where `main.js:160` creates the floor today and re-dealt in place (§6.7).
A fresh object per view would silence event sounds and flood the feed with repeats.

**Tests keep working** *[Amended 2 Nov after critique, #8]*. The browser suites change players in `__game.state`
directly, about 90 times, and read results such as `moveToRoom(...).ok` synchronously.
- `window.__game.state` becomes a getter to `table.local.debug.state` (the real state).
- `window.__game.floor` returns the **real** floor (`debug.floor`), so direct engine calls in tests (e.g.
  `A.useInfirmary(g.state, g.floor, other)`, `tests/browser-rooms.mjs:146-148`) stay valid. The screens draw from
  the floor copy.
- Both getters set a dirty flag. Every presenter entry point (the frame, `refresh`, `discovery.refresh`, every
  `__game` hook) first calls `table.local.sync()` when the flag is set, which rebuilds the view from the real state.
- `table.local.apply(cmd)` is synchronous and `table.on` listeners run before it returns, so hook results stay
  synchronous.
- The clock hooks (`forceTimeUp`, `setTimeLeft`, `timeLeft`) map onto the referee's local clock.
- `stackDeck` and `revealTile` move behind `table.local.debug`.
- `rules` and every other hook keep their names and meaning (`main.js:2536-…`).

The online table has no `debug` and no hooks except `window.__net.send` when the page is on localhost (tests).

**Screen code that writes into player objects becomes acknowledgements** *[Amended 2 Nov after critique, #9]*. On
the presenter state such writes would vanish at the next sync, and "While the others played" would show again every
turn. The seven sites become acks (§6.3) or a referee duty:
- `ui/handoff.js:121` and `main.js:1166` → `{k:'ack', what:'notes', lines?}`;
- `ui/tradeReveal.js:621` → `{k:'ack', what:'notes', lines}`;
- `main.js:544`, `:581`, `:941` → `{k:'ack', what:'role'}`;
- `main.js:703` (bots' notes) → the referee under `botRules: 'page'`.

`browser-honesty` proves that nothing else writes into the presenter state (§6.8 test 11).

### 4.4 Local pacing hooks (why Single player feels exactly the same)

Today the walking figure applies the move: `discovery.update()` calls `enterRoom` when the figure crosses a
doorway (`discovery.js:50-60`), action points drop at each doorway, a meeting starts on arrival (`onArrive`,
`main.js:812`), and a clock running out mid-walk cuts the walk short at the next room (`cutWalkShort`, 634). Bots'
walks work the same way (`runBotAction` → `startWalk`, 1102-1110), and bots wait for every screen on this device
(`botTick`, 1076-1083). To keep all of that, LocalTable runs the referee in **device walk mode** and exposes:

```js
table.local = {
  apply(cmd),               // SYNCHRONOUS → { ok, reason?, result? }; listeners have run when it returns [Amended #8]
  sync(),                   // rebuild the view from the real state (a test poked __game.state)    [Amended #8]
  hold({ bots, clock }),    // every frame. bots: today's botTick wait list (meetingLive, a walk under way, handoff,
                            //   notice, ask, end, error, discard, meeting). clock: today's timerPaused() (main.js:607-608)
  tick(nowMs, dtMs),        // every frame: the clock counts dt (≤50 ms a frame, as today) unless held; a due bot step,
                            //   bot beat or chatter line runs; changes are delivered through table.on.
                            //   Called inside frameLoop's step('bots', …) and step('clock', …), which crash-check
                            //   reads (tests/crash-check.mjs:183-184). [Amended #16]
  step(roomId),             // the ACTIVE guest's figure crossed into roomId (replaces discovery.update → enterRoom).
                            //   Checked as enterRoom checks it (adjacent, passable, affordable), with or without a
                            //   walk in progress: the figure follows the grid path, and the walkTo debug path
                            //   (discovery.js:39-46) walks with no move at all. [Amended #15]
  arrived(),                // the active guest's walk ended (replaces onArrive's rules part: the forced meeting)
  walkFailed(),             // the page could not plan a bot's walk with planToRoom: a refused action, as today (1106)
  skipToEnd(),              // today's skipToEnd (1203-1222) through autoplay.playOut
  debug,                    // { state, floor, bots, referee }: window.__game only (seam-check enforces it)
};
```

- A `move` command (a person's or a bot's) is validated with `planWalk` (E4) and becomes a **walk in progress**;
  `table.on` delivers `local: [{ type:'walk', seat, rooms }]` and the page plans the figure's path with
  `discovery.planToRoom` exactly as today. Each doorway crossing calls `step(room)` → `enterRoom`. The end of the
  walk calls `arrived()` → the forced meeting, if any.
- **Clock running out mid-walk:** the referee applies today's rule (`main.js:634-648`): still in the starting room →
  the step under way into the next room is finished; already in a room on the way → stop there. It delivers
  `local: [{ type:'walkCut', seat, to }]`, the page re-plans the figure (today's code), and the turn ends after
  `arrived()`.
- **Bot think pauses** use `pace()`; a bot's next action waits while `hold.bots` is on, exactly as `botTick`. Beats
  inside a meeting (`meet`, `trade`, `reply`) run on time, as today's `after()` timers do (844-847).
- **Screen pauses are the page's** in local mode: `hold.clock` already pauses the clock while a private screen is up,
  so the referee's own screen pause (§5.5) is off with `mode: 'local'`. A missed ack can then never freeze the clock.
  *[Amended 2 Nov after critique, #16]*
- **Randomness:** in local mode the referee draws from `state.rng` only where `main.js` does today. `?seed=` games
  therefore keep the same deck, Lock Picks and random discards. *[Amended 2 Nov after critique, #14]*

### 4.5 OnlineTable and atomic moves

- Online the referee runs in **atomic walk mode**: a `move` enters every room of the planned route at once and the
  forced meeting (if any) starts immediately. Other devices animate the walk from the `enter` events.
- **Feedback within one frame:** the walker's own device starts walking at the tap along its own plan
  (`discovery.planToRoom` on the floor copy and the presenter state), shows the move as pending, and is confirmed by
  `res` and the `enter` events. A refusal (`res.ok === false`) walks the figure back and shows today's refusal toast
  (`moveRefusal`, `main.js:2009`).
- **The one felt difference, Co-op only:** your action points drop when you tap Move, and a move tapped before the
  clock runs out completes its route. This changes nothing a guest may do (rules.md T4). Single player keeps
  today's doorway-by-doorway behaviour.

---

## 5. The referee (`src/net/referee.js`)

Pure: no DOM, no timers, no `Date.now`, no `Math.random`. Time comes in as `now`; randomness through `random`.
Its own state is plain data (snapshot-safe, §10).

### 5.1 API

```js
createReferee({
  state, floor,            // dealt (local: makeRng(seed); server: E1/E2 options)
  bots,                    // createBotTable(state, floor, seats, seed); stand-ins added on demand (addSeat)
  people,                  // number[]: seats played by people
  mode,                    // 'local' | 'online'
  walkMode,                // 'device' (local) | 'atomic' (online)
  botRules,                // 'page' (LocalTable and the server) | 'autoplay' (the replay test), §5.3 [Amended #6]
  limits,                  // §5.2 (the server passes them divided by TIME_SCALE in tests, §9)
  pace,                    // (seat, kind) => ms before a bot step or beat
  walkMs,                  // online: (seat, rooms) => ms the walk takes on screens (bots wait for it; asks after a move add it)
  random,                  // () => [0,1) for time-out choices (local: state.rng; server: crypto)
  now,
}) → ref

ref.do(seat, cmd, now)        → { ok, reason?, result? }    // §6.3; result whitelisted (move → { rooms }, else null)
ref.tick(now)                 → boolean                      // deadlines, bot steps and beats; true if anything changed
ref.hold({ bots, clock })     // local only
ref.advance(dtMs)             // local only: the frame clock
ref.step(roomId) · ref.arrived() · ref.walkFailed() · ref.skipToEnd()   // local only (§4.4)
ref.setPresence(seat, 'here' | 'hidden' | 'gone', now)
ref.extras(seat, now)         → { phase, clock, stall, ask, results, end }   // what playerView adds for THAT seat:
                              //   an outsider's phase and clock never show the active seat's discard (§5.3) [Amended #17]
ref.drain()                   → [{ to: seat | 'all', ev }]   // table events since the last drain (§6.2)
ref.toJSON()                  → plain data;  createReferee.restore(json, opts) → ref
ref.phase                     // public: { kind, seats }
```

### 5.2 Limits (the only difference between Single player, Co-op today and Co-op after approval)

```js
LOCAL_LIMITS     = { clock: rules.turnTimerEnabled ? 'device' : null, turnMs: 45000, discardMinMs: 10000,
                     meetMs: null, cardMs: null, offerMs: null, screenCapMs: null, startAckMs: null,
                     standIn: false, idleTimeouts: null, stallMs: null, devicePauses: true }
ONLINE_RULES.today   = { clock: 'server', turnMs: 45000, discardMinMs: 10000,           // today's rules
                     meetMs: null, cardMs: null, offerMs: null, screenCapMs: null,       // today: no limits
                     startAckMs: 20000,                                                  // T6, technical
                     standIn: false, idleTimeouts: null,                                 // no rule today
                     stallMs: 300000,                                                    // TP3 placeholder (§13)
                     devicePauses: false, offerOncePerTurn: false, relaxedFactor: 1 }
ONLINE_RULES.pending = { ...today, meetMs: 20000, cardMs: 20000, offerMs: 20000, screenCapMs: 10000,   // R3 R4 R5
                     standIn: true, standInGraceMs: 10000, idleTimeouts: 2,                           // R6 R7
                     offerOncePerTurn: true, relaxedFactor: 2 /* host option, R10 */, stallMs: null } // PROPOSED, NOT RULES
```

`src/data/online.js` holds both sets, marked "PROPOSED, NOT RULES: waiting for the owner's approval". The server uses
`today` until `ONLINE_RULES.approved` is set by the lead after the owner approves. Tests run both. After approval
the numbers move into `src/data/rules.js` next to `turnTimerSeconds`, and `docs/GAME_RULES.md` gets the approved
wording (R12) in the same commit.

### 5.3 Phases

| Phase (internal) | Public `phase.kind` | Waiting for | Then |
|---|---|---|---|
| `start` | `start` | each present person's `ack role` (online: at most `startAckMs`; local: you) | `turn` |
| `turn` | `turn` | the active seat. A person sends commands; a bot steps when due (`bots.nextAction`); 3 refusals or 40 steps end its turn (`autoplay.js:114-125`, `main.js:1086`) | `meeting`, `offer`, `discard`, next `turn`, `ended` |
| `meet:whom` | `meeting` | the walker, if 2+ candidates (bot: `meetWhom`) | `lockEncounter` |
| `meet:act` | `meeting` | a **person** walker always (Attack greyed if no weapon or no AP, as `ui/meeting.js:87`); a bot decides in the same beat as `meet:whom` | attack → `resolveAttack`; trade → cards |
| `meet:cards` | `meeting` | both sides at once, sealed. A bot's card is computed at the start and hidden (as `main.js:919`); a person is asked; `!canTrade` → `skipTrade` | after the last answer, a `trade` beat for a bot side, then `resolveTrade` |
| `offer` | `offer` | the asked guest (bot: `reply` beat then `acceptTrade`) | yes → `meet:cards` (voluntary); no → `turn` |
| `discard` | **`turn` for everyone but the active seat**; `discard` only in the active seat's own view *[Amended #17]* | the active seat. Deadline = what's left of the clock, at least 10 s (`ui/discardClock.js`, approved rule) | `endTurn` → `checkWin` → next `turn` |
| `ended` | `ended` | — | — |

- Meetings mirror `autoplay.runMeeting`/`runTrade` (`autoplay.js:23-55`) step for step, so a meeting with a person
  resolves as a bot meeting would.
- ~~A walk by a bot into a room with only bots resolves at once with `autoplay.runMeeting` (the headless path).~~
  *[Struck, amended 2 Nov after critique, #6, #19]* A bot-to-bot meeting takes the same `meet` beat as today's page
  (`main.js:871-873`). Resolving it at once would change Single player and, online, tell the table that both guests
  are bots.
- **`botRules`** *[Amended 2 Nov after critique, #6]*. Today's page plays bots slightly differently from
  `autoplay.playOut`. `botRules: 'page'` reproduces the page; LocalTable and the server use it, so Single player stays
  identical and Co-op bots behave like Single player bots. `botRules: 'autoplay'` reproduces `autoplay` and is used
  only by the replay test. The four differences, also listed in `referee.js`'s header:
  1. **Jammed door:** page: not a refusal, no `reject` (`main.js:1141-1145`). Autoplay: a refusal plus
     `table.reject` (`autoplay.js:121-125`; three refusals end a bot's turn).
  2. **Bot-to-bot meeting:** page: one `meet` think pause first (`main.js:871-873`). Autoplay: at once.
  3. **A bot's turn timing out over the hand limit:** page: the bot chooses its discards (`endTurnNow` →
     `botDiscardDown`, `main.js:731-734`). Under `'page'` the referee does the same for a bot, never the random
     `endTurnByTimeout` of §5.6, which stays for people. Autoplay has no clock, so the case never arises there.
  4. **Bots' notes:** page: cleared each turn (`main.js:703`). Autoplay: kept.
- **Discard privacy** *[Amended 2 Nov after critique, #17]*. How many cards a guest holds is private
  (`GAME_RULES.md:51`, `:105`). So for everyone but the active seat:
  - the public phase stays `turn`;
  - the public clock keeps counting the turn, holding at 0:00 while a discard minimum runs;
  - `clock.kind: 'discard'` and the `discard` ask appear only in the active seat's own view.

  Ending a turn over the limit with ≥ 10 s left therefore looks, to the table, exactly like a longer turn.
  `fairness-check` proves it (§6.8 test 7b). The remaining tell, at under 10 s left, is told to the owner (BUILD-PLAN
  §4).
- **Determinism guard:** an all-bot table through the referee with `botRules: 'autoplay'` reproduces `bots-check`'s
  seeded matches event for event (`referee-check`, §15).

### 5.4 Meeting privacy (no weapon tells)

- Outsiders see one public phase: `{ kind: 'meeting', seats: [walker, met] }` until the meeting resolves. Sub-steps
  (`whom`, `act`, `cards`) and their deadlines are never public.
- **Bots:** one `meet` beat, then whom and attack-or-trade decided together (today's `botMeeting`, `main.js:872-888`),
  so a bot holding a weapon takes no extra beat. (`autoplay.js:30` asks `attackWith` only when armed; the referee
  keeps that call inside the same beat.)
- **People:** a person walker always gets the Trade/Attack question, armed or not, as today's screen
  (`main.js:858-865`).
- A person's own thinking time remains visible, as at a real table (§18).

### 5.5 Clock

- **Turn clock** (`rules.turnTimerSeconds`, 45 s): runs only in `turn` for the active seat; frozen in `meeting` and
  `offer` (`GAME_RULES.md:15`); the `discard` clock is today's approved rule. Outsiders never see the discard clock:
  they see the turn clock, holding at 0:00 while a discard minimum runs (§5.3). *[Amended 2 Nov after critique, #17]*
- **Private screen pause** (today's rule: "while you read a private screen"): when a result that opens a screen
  reaches the **active person** (found cards, a Mirror result, the trade reveal, the role change, the "While the
  others played" notes), their turn clock pauses until they acknowledge it. Uncapped under today's rules (TP3 limits
  the total to 5 minutes); 10 s cap only if R4 is approved. Another person's screen never pauses anyone.
  **Online only:** in local mode the page's `hold.clock` does this pausing, and the referee's own screen pause is
  off (§4.4). *[Amended 2 Nov after critique, #16]*
- **Local:** today's `tickTimer` exactly: dt-based, paused by `hold.clock`, cut-walk-short at zero (§4.4).
- **Online:** deadlines in server milliseconds; 500 ms grace (a command arriving up to 0.5 s after zero counts);
  nothing a device does pauses the table (no Menu, upright iPad or hidden page pause: these are device behaviours,
  not written rules; listed for the owner under R10).

### 5.6 Time-outs

| What runs out | Today's rules (used now) | If the owner approves (pending) |
|---|---|---|
| Turn clock | `endTurnByTimeout` (`actions.js:186`): random ordinary discards if over the limit, private `autoDiscarded` result. A **bot's** turn under `botRules: 'page'`: it chooses its own discards, as today's page (§5.3) *[Amended #6]* | same |
| Discard clock | `discardRandomDown` (`actions.js:170-181`) | same |
| Role screens at the start | turn 1 starts after 20 s (T6, technical); the screen stays until read | same |
| Meeting choice, card, Fire Exit answer | no limit. TP3: a single wait over 5 minutes stops the match without a result | R3/R5: 20 s, then a random guest and Trade / a random ordinary card / "no" |
| Active person's private screen | pauses their clock without a cap (TP3 applies) | R4: at most 10 s |

### 5.7 Stand-ins (built behind the pending flag; off until R6/R7 are approved)

*[Amended 2 Nov after critique, #35]* **Not built tonight.** Stand-ins and the `whileAway` result sit behind rules
the owner has not approved. Tonight the flag stays off and the code is absent. The `pending` R3/R4/R5 time-outs are
built only if time allows (BUILD-PLAN P1B). This section stays as the design for when R6/R7 are approved.

- `bots.addSeat(seat)` (`src/bots/index.js:43-48`): the mind reads `botView` from the start of that seat's own
  events, so it knows exactly what the person was told. It never chats.
- Starts when a seat that must act is `hidden` or `gone`: at a turn start after `standInGraceMs` (10 s); at an open
  question after min(10 s, deadline − 3 s). Reconnecting inside the grace returns the question to the person.
- Idle (R7): two time-outs in a row of that seat's own clocks with nothing done → stand-in until `{k:'back'}`.
- Hand-back after the step in progress (`bots.removeSeat`, `index.js:74`). The returning person sees any role
  change first, then a private **While you were away** result listing their own guest's moves, then control.
- Others see only **Away** (plus **Bot** only if the owner approves labels).

---

## 6. The per-player view

### 6.1 PlayerView (what each person's screens receive; both tables produce it)

```js
{
  v: 1,
  table: { kind: 'friends' | 'bots' | 'practice', code: 'BKTWM' | null,
           rules: 'today' | 'approved', clockOn: true, relaxed: false },
  seat, seats, round, roundLimit, turn, activeSeat, finalRound, finished, won: null | 'humans' | 'possessed', dawn,
  phase: { kind: 'start' | 'turn' | 'meeting' | 'offer' | 'discard' | 'ended', seats: [a, b?] },   // never sub-steps;
                                                // 'discard' only in the active seat's own view (§5.3) [Amended #17]
  clock: null | { seat, kind: 'turn' | 'discard', leftMs, running },   // public, except kind 'discard': own view only
  stall: null | { leftMs },                     // TP3: time until the match stops without a result (shown after 60 s)
  hotel: { lobbyDoors: ['north', 'east', 'west'],
           placed: [['kitchen', 1, 0, 2], ...],  // [tile id, cell i, cell j, rotation] in placement order
           jammed: ['<doorId>'], roomTilesLeft: 17 },
  discovered: [roomId], searched: [roomId], spent: [roomId], locked: [roomId],
  openLocks: [[roomId, seat, ...publicFields]], barricades: [[doorId, seat, ...publicFields]],
  drops: [roomId],                              // presence only: something lies there
  deckEmpty: false, met: ['roomId:a-b'],
  players: [{ seat, id, name, color, mark, avatar, room, health, alive, escaped,
              away,                             // Co-op: hidden ≥5 s or disconnected; always false in Single player
              bot? }],                          // only if ONLINE.botLabels (owner decision D3); never in Single player
  me: { seat, id, room, ap, health, alive, possessed, convertedBy, roleChangePending, roleSeen,
        knows: [playerId], notes: [text],
        hand: [{ id: '<alias>', type, shots?, owner? }],   // owner: Possession cards only, always your own id
                                                           //   (soul faces, ui/cards.js:44) [Amended #10]
        inbox: [{ o, type, ... }] },            // all my private events; seq removed; o = my ordinal (§6.2)
  log: [{ round, turn, text }],                 // the public log, last 30 lines (ui/feed.js parses it)
  ask: null | { id, kind, ..., leftMs: number | null },   // the question for ME only (§6.3)
  results: [{ id, kind, ... }],                 // my private results, kept until I acknowledge them (§6.4)
  end: null | { won, dawn, reveal: [{ seat, possessed, convertedBy, alive, escaped }],
                history: { events, inbox },      // once, for Your record and achievements (matchSummary.js)
                standInTurns: [turn] }           // pending R6 only
}
```

`openLocks` and `barricades` carry exactly the public fields the engine's button checks read (the builder lists
them; `view-check` proves the checks agree, §6.8 test 8).

**Never in it:** another seat's hand, card count, role, `knows`, notes, inbox, `convertedBy` or questions; the draw
or discard pile (only `deckEmpty`); what lies on a floor (only that something does); the room deck order (only its
length); the seed or any generator state; engine `seq`; engine card ids; another seat's deadlines; bot styles.

### 6.2 Events and ordinals

- `seatEvents(state, seat, sentO)` merges the public events (`state.events`) and the seat's own inbox in engine
  order, removes `seq`, and gives each an ordinal **`o` = how many events of this seat's own stream come at or
  before it**. Others' private events never move it, so `o` reveals nothing (tech.md §3b: today's shared counter
  separates plain trades from possessions in 100% of cases).
- `applyView` maps `o` back to a `seq` field for the screens that order by it (`matchSummary.js:36`,
  `audio/gameSounds.js:65-113`). Public events go to `state.events` and your own to `me.inbox`, as in the engine
  today, so `matchSummary`'s counts and `gameSounds`' per-type sounds see each event once. *[Amended 2 Nov after
  critique, #44]*
- Each `view` message carries the new events since the last one sent to that device, plus the table's own events:

| Table event | To | When |
|---|---|---|
| `{ type:'away', seat }` / `{ type:'back', seat }` | everyone | hidden ≥5 s or disconnected / returned |
| `{ type:'left', seat }` | everyone | left the match on purpose |
| `{ type:'host', seat }` | everyone | the host changed (waiting room) |
| `{ type:'standIn', on }` | that seat | pending R6 |

### 6.3 Commands and questions

**Commands** (`table.send(cmd)`): the bots' own action objects plus answers and acknowledgements.

| cmd | When | Notes |
|---|---|---|
| `{k:'move', to}` | your turn | local: a walk in progress (§4.4); online: atomic, `result: { rooms }` (the only command with a `result`, below) |
| `{k:'open', door}` · `{k:'search'}` · `{k:'job'}` · `{k:'escape'}` | your turn | search adds a `found` result |
| `{k:'card', type, card, target?}` | your turn | `card` is your alias. Hand Mirror `target` = **seat**; keys = room id; Barricade = doorway id. Mirror adds a `mirror` result |
| `{k:'trade', with}` | your turn, Fire Exit | opens an `offer` question for `with` |
| `{k:'end'}` | your turn | over the hand limit → `discard` question |
| `{k:'discard', card}` | your `discard` question | repeat until within the limit |
| `{k:'answer', ask, value}` | you have an `ask` | value per kind below; safe to repeat (same ask id → same reply) |
| `{k:'ack', what:'role' \| 'notes' \| 'result', id?, lines?}` | a screen closed | ends a screen pause; removes the result. `notes` with `lines` removes only those lines (the trade reveal's own, `ui/tradeReveal.js:621`; one line, `main.js:1166`), without `lines` all of them. Replaces today's screen writes into player objects (§4.3) *[Amended #9]* |
| `{k:'back'}` | "Are you still there?" | pending R7 |

**Questions** (`view.ask`, only the asked seat):

| kind | Fields | `value` |
|---|---|---|
| `role` | `role: 'clean'|'possessed', changed?, by?` | (ack) |
| `meetWhom` | `candidates: [seat]` | a seat |
| `meetAct` | `with, canAttack, weapons: [alias]` | `'trade'` or `{ attack: alias }` |
| `tradeCard` | `with, cards: [alias], voluntary` | an alias |
| `offer` | `from` | `true` / `false` |
| `discard` | `over, cards: [alias]` | (use `{k:'discard'}`) |
| `stillThere` | — | (use `{k:'back'}`; pending R7) |

**Refusals** (`reason`): `notYourTurn`, `notNow`, `stale` (the `turn` changed), `unknown`, `notYourCard`, `badAsk`,
`badTarget`, and the engine's own reasons passed through (`ap`, `here`, `blocked`, `jammed`, `noTradeHere`, …),
each about your own or public state. The scramble test covers every reason and every ask (§6.8).

**Results of a command are whitelisted** *[Amended 2 Nov after critique, #11]*. The engine returns raw objects:
- `openDoor` returns a room with functions (`actions.js:35`);
- `search` returns the engine card with its id (`:150`);
- the Hand Mirror returns the target's cards with engine ids (`:248`);
- `resolveTrade` returns both sides' notes.

None of that leaves the referee. `ref.do` (and so `res.result` and `table.send`) returns `{ rooms }` for `move` and
`null` for every other command. Private outcomes travel only in `view.results` (§6.4). `protocol-check`'s wire scan
covers `res` messages too.

### 6.4 Results (private, kept until acknowledged)

| kind | Fields | Opens (and, for the active person, pauses their clock) |
|---|---|---|
| `found` | `cards: [{ id, type, shots? }], where` | the search result screen (`main.js:1250`) |
| `mirror` | `target, hand: [{ type, shots?, owner? }]` *[Amended #10]* | the Hand Mirror view (`main.js:1407`; shots shown at `ui/hand.js:128`, soul faces from `owner`) |
| `trade` | `with, outcome, gave, got, notes, voluntary`; `gave` and `got` are `{ type, shots?, owner? }` *[Amended #10]* (outcome names as `tradeOutcome()` today, now in `src/net/outcomes.js`, built only from my own private events) | the trade reveal (`ui/tradeReveal.js`, which draws both cards, `main.js:931-933`) |
| `noTrade` | `with, empty, notes` | the empty-slot reveal |
| `declined` | `with` | "X declined." |
| `notes` | `lines` | "While the others played:" (`main.js:584`) |
| `autoDiscarded` | `cards: [type]` | the quiet discard note (`main.js:676`) |
| `timedOut` | `ask, gave?` | pending R3/R5 |
| `whileAway` | `lines` | pending R6 |

A result stays in every view until `{k:'ack', what:'result', id}`, so a drop at the wrong moment loses nothing.

### 6.5 Card aliases

- Server and loopback: each seat has `aliases: Map<engineId, alias>` kept by `rooms.js` (saved with the table).
- A card entering the seat's hand gets a fresh 8-character alias from `crypto`, never starting with `c` (so no alias
  can look like an engine id); leaving deletes it; coming back gets a new one. Nobody can follow a card from hand to
  hand. *[Amended 2 Nov after critique, #12]*
- **Who maps** *[Amended #12]*: `playerView` maps every card id in `me.hand`, in `extras.ask` (`weapons`, `cards`)
  and in `extras.results` (`cards`) through `aliasOf`. `rooms.js` maps a command's aliases back with `idFor` before
  `ref.do`; an unknown alias → `notYourCard`.
- No engine event carries a card id (every `emitPublic`/`emitPrivate` in `actions.js:27-563` carries types or seats).
- Single player: identity aliases (engine ids), for the existing tests.

### 6.6 viewAsState (applyView)

*[Amended 2 Nov after critique, #7, #44]* `applyView(target, view, received, { fresh })` writes the view **into one
long-lived presenter state** (`target`) and returns it. `viewAsState(view, received)` is
`applyView(blankState(), view, received)`, for tests and one-off checks.

**What it writes**, shaped like the engine state:
- Sets and Maps rebuilt; `openLocks` and `barricades` keyed back to player ids;
- other players with `hand: []`, `possessed: false`, `knows: new Set()`, `notes: []`, `inbox: []`;
- `drawPile`: one placeholder when `!deckEmpty`, else empty, so `canSearch` (`actions.js:91`) answers without the size;
- `roomDrops`: one placeholder per room in `drops`;
- `events`: the **public** events the page has received (`seq := o`); `me.inbox`: **your own** events (`seq := o`);
  `log` from the view;
- `viewerIndex = seat`, which closes the "active seat" fallbacks (`hud.js:37`, `ui/hand.js:9`, `map.js:83`).

**What it keeps** (identity), because the page's modules hold these objects and key on them (§4.3):
- `target` itself, always;
- each `target.players[i]` within a match (a new match gets new player records, as `resetState` gives today);
- `target.events`, append-only within a match: a new array only on `fresh` or a new match, when `gameSounds`
  rightly resets;
- `target.log` entries, reused when round, turn and text match, so `feed.sync` sees each line once.

### 6.7 floorCopy

`createFloorCopy(hotelData, cfg)` and `syncFloor(floor, view.hotel)`:
- On a new match: `clearHotel` + `placeLobby(lobbyDoors)` on the **same object**. The floor copy is one object for
  the page's life, created at boot where `main.js:160` creates the floor today, because discovery, the map and the
  search marks keep it (§4.3). *[Amended 2 Nov after critique, #7]*
- Then `placeTile` for each new placement in order, marking jammed doors and bumping `floor.version` (so room views,
  fog and grid catch up as after `openDoor` today).
- `floor.deck` is an array of `roomTilesLeft` placeholders.

Measured: 339/339 rebuilds identical to the real hotel (`probe-minimal/view-size.mjs`).

### 6.8 The honesty tests

1. **Scramble** (`view-check`, template `bots-check.mjs:141-226`): 24 seeded 4-6 seat matches through the referee
   with scripted people; at random points, for every living seat, scramble everything that seat can't know (others'
   hands: types, ids and counts; roles; `knows`; notes; inbox; `convertedBy`; `roleChangePending`; draw and discard
   piles, contents and lengths, keeping `deckEmpty`; `roomDrops` contents; the room deck order, keeping its length;
   `eventSeq` shifted; the hidden bot answer in a sealed trade). `JSON.stringify` of that seat's view, its `ask`, its
   `results` and the reason of any refused command must be byte-identical.
2. **Key whitelist:** exactly the keys of §6.1; `hand`, `inbox`, `notes`, `knows`, `possessed`, `convertedBy` only under
   `me` (and `end.reveal` once finished); no key `seq`, `seed`, `rng`, `deck`, `drawPile`, `discardPile`, `style`.
3. **No engine id:** with real aliases on, **no engine id present in the real state appears anywhere in the view**
   (set membership, not a regex: a random alias could itself look like `c1234567`). *[Amended 2 Nov after critique,
   #12]*
4. **Round trip:** `JSON.parse(JSON.stringify(view))` deep-equals the view.
   **4b. Identity** *[Amended 2 Nov after critique, #7]*: two consecutive `applyView` calls keep `state`, each
   `players[i]` and `events`, and a copy of `feed.sync`'s logic sees each log line once over a whole match.
5. **Floor copy** equals the real floor (rooms, rotations, doorways, closed and jammed doors, walls, exit), checked at
   every 3rd turn and at the end. *[Amended #43]*
6. **Phase privacy** (`fairness-check`): replay each meeting with the walker's weapon swapped for an ordinary card
   (scripted bot choosing Trade both times): outsiders' messages and their timestamps (injected clock) are identical;
   a person walker gets `meetAct` in both cases.
7. **Equal traffic** (`fairness-check`): for seats outside a trade, message count, bytes **and timestamps** are
   identical for a plain trade, a possession, a Lantern block, a spent soul and crossed souls (`actions.js:518-521`
   emits the same public event for all). The person's acks are scripted so that their **last ack arrives at the same
   moment in every case** (a possession has one more screen, the role change, inside the same total time). The check
   then proves the server adds no pause of its own. *[Amended 2 Nov after critique, #18]* (How long a person reads their own screens
   is theirs. Whether the role screen after a possession shares the trade reveal's pause is an owner question, in
   BUILD-PLAN §4.)
   - **7b. Discard privacy** *[Amended #17]*: outsiders' messages are byte- and time-identical whether a person ends
     the turn under or over the hand limit with ≥ 10 s left. The comparison is scripted so that **the turn passes at
     the same moment** in both runs: under the limit, End at t; over the limit, End earlier and the last discard at t.
     Discards themselves send outsiders nothing (no public event, `actions.js:144-151`).
   - **7c. Looks** *[Amended #20]*: a person's unlockable item survives the server's check as a bot's does, so no
     item marks a bot.
8. **Button checks agree:** for the viewer, `canSearch`, `canEscape`, `canUseRoom`, `openableDoors`,
   `adjacentLockedRooms`, `canTradeVoluntarily`, `playersInRoom`, `encountersIn`, `pendingEncounters`, `roomRoute`,
   `canAffordRoute(me)`, `searchLeft`, `overHandLimit(me)`, `tradeableCards(me)` give the same answers on
   `viewAsState` + floor copy as on the real state.
9. **Alias trail** (`fairness-check`): an alias a seat has seen never reappears to it after the card left its hand.
10. **Wire scan** (`protocol-check`): every message each test seat receives, **`res` messages included**, is scanned
    for other hands' ids and types by position, deck ids, seed bytes, engine `seq` values and other seats'
    `possessed: true` before the end: 0 hits. *[Amended #11]*
11. **Screens get nothing secret** (`browser-honesty`, Single player in a real page, run with the clock held,
    `?timer=off`, so the ticking clock doesn't change the visible text):
    - **Scramble:** mid-match, take the presenter's state JSON and the visible text; scramble the hidden fields of
      `table.local.debug.state`; `refresh()`; both are unchanged.
    - **Write trap** *[Amended 2 Nov after critique, #9]*: over the match, 0 writes into the presenter state outside
      `applyView`. Count them either with a test-only Proxy on its plain objects and arrays (not on Sets and Maps,
      whose methods break inside a Proxy), or with a deep compare against `applyView(blank, table.view, received)`
      taken just before each sync.

    **`seam-check`** (static):
    - No file under `src/` except `src/net/*`, `src/bots/*`, `src/game/*` imports a rules-changing function:
      `search`, `openDoor`, `resolveTrade`, `resolveAttack`, `skipTrade`, `endTurn`, `enterRoom`, `lockEncounter`,
      `discardCard`, `discardRandomDown`, `endTurnByTimeout`, any `use*`, `escape`, `createState`, `resetState`,
      `resetHotel`, `createBotTable`, `createChatter`, and the hotel mutators `stackDeck`, `growTo`, `placeTile`,
      `openFrontierDoor` (today imported by `main.js:15` for test hooks, which move behind `table.local.debug`)
      *[Amended #42]*.
    - None reads `.drawPile`, `floor.deck` (except the floor copy), `possessedIndex`, another player's `.inbox`, or
      `table.local.debug` outside the `window.__game` block. The own-inbox reads `matchSummary.js:30` and
      `allies.js:25` are whitelisted *[Amended #42]*.
    - A purity scan of `src/net/` (minus BUILD-PLAN rule 7's exceptions) uses the same regexes as
      `tests/bots-check.mjs:61` *[Amended #42]*.
    - `docs/GAME_RULES.md` matches its recorded hash.

---

## 7. The message protocol

JSON text frames over `wss://` (`ws://` only on localhost). Every message has `t`. Device to server: at most 4,096
bytes.

### 7.1 Device → server

| t | Fields | Who / when | Server does |
|---|---|---|---|
| `hello` | `v` (protocol int), `app` (`'v0.12'`), `data` (8-hex data hash, §7.4), `token` (string or null), `name` (or null), `avatar` (or null), `vis` (`'visible'`/`'hidden'`) | first message on every socket, within 5 s (`ONLINE.timing.helloTimeoutMs`) *[Amended #23]* | checks `v` and `data`; finds or creates the guest (a new `token` in `welcome`); checks name (`checkUsername`) and look (`normaliseAvatar`); the newest socket for a token wins (§11.4); then sends the guest's place (`lobby` or `view`) |
| `peek` | `code` | anyone | `peeked` (only for a table still waiting) or `err notFound`; shares the wrong-code limits |
| `create` | `size?` (4/5/6, default 6) | named, not seated | new table, you are host |
| `join` | `code`, `wait?` | named, not seated | a seat in the waiting room, or `err`; `wait:true` on a mid-match table queues you for the next match (§8.10) |
| `lobby` | `id`, `op`: `{k:'size',n}` · `{k:'lock',on}` · `{k:'remove',pid}` · `{k:'start'}` · `{k:'wait'}` · `{k:'again'}` · `{k:'look',avatar}` | host-only ops refused for others (`notHost`); waiting room only, except `again` (end) and `look` | updates; everyone gets `lobby` |
| `do` | `id` (≤12 chars, `ONLINE.limits.doIdMaxChars`), `turn`, `cmd` (§6.3) | seated, in a match | referee `do` → `res`; everyone whose view changed gets `view` |
| `say` | `id` (phrase id), `about?` | seated | `cleanMessage` + 3 s cooldown (`src/social/chat.js:21-61`) → `chat` to all; bots hear it |
| `vis` | `v`: `'hidden'` / `'visible'` | page visibility | presence hint (§11.3) |
| `leave` | — | anyone | waiting room: seat freed; match: your guest stays (today's rules: its turns run on the clock; pending R8: a bot plays); end: leave the table |
| `ping` | `at` | anyone | `pong` |

**Never accepted from a device:** a seat for yourself (the token decides), a role, a seed, a result, a card type
other than in your own `card` command, a roll, or a time.

### 7.2 Server → device

| t | Fields | Numbered `n`? |
|---|---|---|
| `welcome` | `v`, `token`, `server` (ms), `place`: `'none'|'lobby'|'match'` | no |
| `peeked` | `code`, `host` (name) | no |
| `lobby` | `lobby`: LobbyView (§8.4) | yes |
| `view` | `view` (§6.1), `events` (§6.2), `fresh?` | yes |
| `res` | `id`, `ok`, `reason?`, `result?` (whitelisted: `{ rooms }` for `move`, else absent; §6.3) *[Amended #11]* | no |
| `chat` | `msg: { seat, id, about?, at }` | yes |
| `err` | `code`, `retryMs?` | no |
| `bye` | `why`, `retryMs?` (the socket then closes) | no |
| `pong` | `at`, `server` | no |

**`err` codes:** `notFound`, `full`, `midMatch`, `locked`, `removed`, `closed`, `tooMany`, `badCode`, `badName`,
`notHost`, `notNow`, `busy` (table cap, create limit or `TABLES_OPEN=false`), `update` (device data or protocol older),
`serverOld` (device newer).

**`bye` and close codes** (sent as a message first, because a page can't read HTTP status):

| `why` | Close | Screen (§14.8) |
|---|---|---|
| `elsewhere` | 4001 | Playing on another device |
| `removed` | 4002 | You've left the table |
| `closed` | 4003 | This table has closed |
| `update` | 4004 | Update needed |
| `serverOld` | 4005 | One moment |
| `busy` | 4009 | The hotel is full right now |
| `restart` (with `retryMs`) | 1012 | silent reconnect, then the restart notice |
| (no hello in 5 s) | 4010 | silent reconnect |
| (bad JSON) / (rate) / (too big) | 1007 / 1008 / 1009 | silent reconnect |

### 7.3 Numbers, idempotency, staleness

- **`n`:** a per-device counter on `lobby`, `view` and `chat`, starting at 1 on each socket. A gap (`n !== last + 1`)
  means "draw the next view fresh, don't animate". Nothing else depends on it: every `view` is complete.
- **`do.id`:** the server keeps each seat's last 16 `{ id → res }` (saved with the table). A repeated id gets the
  stored reply and acts once.
- **Acts are never re-sent automatically** after a reconnect: the player sees the fresh view and taps again if
  needed. **Answers and acks are** re-sent automatically if unanswered (they are idempotent by ask id / result id).
- **`do.turn`:** acts carry the turn the device believed; a mismatch → `stale`. Answers carry the ask id; a closed
  ask → `badAsk`.

### 7.4 Versions and shared data

- `ONLINE.protocol = 1`, `ONLINE.minProtocol = 1`. Every change stays compatible one step back or bumps `protocol`.
- `hello.data` is `dataHash()`: FNV-1a over a canonical JSON of `src/data/hotel.js` tiles and lobby, `src/data/rules.js`
  (minus the four fields `applyMode` changes), chat phrase ids and the username rules. It is computed **once, when
  the module loads**, so later runtime changes to `rules` can't drift it. *[Amended 2 Nov after critique, #43]* A mismatch or an old protocol
  → `err update`: "Update needed" → **Update now** reloads (with a cache-busting query). If the same mismatch comes
  back right after the reload (sessionStorage flag), the server is the old one → "One moment", retry in 60 s.
- The table's snapshot records the data hash it was dealt with. A restore under a different hash ends that match
  politely ("The game was updated, so this match ended. It won't count.") instead of mixing rules mid-match.

### 7.5 Limits (technical constants in `src/data/online.js`, enforced in `server/index.js` and `rooms.js`)

| Limit | Value | On breach |
|---|---|---|
| `maxPayload` | 4,096 B (ws default 100 MiB) | close 1009 |
| Messages | 10/s, bursts of 20, per socket | close 1008 |
| Bad JSON / unknown `t` / binary frame | — | close 1007 / 1003 |
| Every socket gets `on('error')` | — | (without it one oversized frame crashed the spike's whole process, tech.md §4) |
| Open sockets per client IP | 12 | HTTP 429 |
| New sockets per IP | 30 a minute | HTTP 429 |
| `hello` per token | 20 a minute | `err tooMany` |
| Wrong codes and peeks per IP | 10 a minute, 30 per 10 minutes | `err tooMany` + `retryMs` |
| Table creations | 5 a minute per IP, 3 per token; at most 2 open tables per token, 6 per IP | `err busy` |
| Open tables | 300 (`MAX_TABLES`) | `err busy` |
| `TABLES_OPEN=false` (env kill switch) | — | `err busy` for create |
| Unsent buffer | 256 KB | terminate (the device reconnects) |

**Tests and these limits** *[Amended 2 Nov after critique, #3]*. Every test client comes from 127.0.0.1, so:
- **`ws` clients:** the server suites run the server with `TRUST_PROXY=render`, and each simulated client sends its
  own `X-Forwarded-For` (§12.3 takes the right-most entry). One `protocol-check` case keeps a single address and
  proves the real per-IP limits bind.
- **Browser contexts:** they can't set that header on a WebSocket upgrade. Chromium drops `extraHTTPHeaders` there;
  verified 2 Nov with `scratchpad/lead-amend/xff-probe.mjs`. So browser suites stay inside the real limits (≤ 6
  contexts, ≤ 2 tables per server run; failed connects during an outage never reach the server).
- **More than that:** a suite starts the server with the test-only `LIMITS_SCALE`, which the server refuses when
  `NODE_ENV=production`.

### 7.6 Example (abridged)

```
→ {"t":"hello","v":1,"app":"v0.12","data":"9c1e44a0","token":null,"name":"nora","avatar":{…},"vis":"visible"}
← {"t":"welcome","v":1,"token":"Qm9…","server":1798000000000,"place":"none"}
→ {"t":"create","size":6}
← {"t":"lobby","n":1,"lobby":{"code":"BKTWM","phase":"waiting","size":6,"locked":false,"you":"p1","host":"p1","canStart":false,"people":[{"pid":"p1","name":"nora","mark":"N","host":true,"you":true,"away":false}]}}
   … sam joins …
→ {"t":"lobby","id":"a1","op":{"k":"start"}}
← {"t":"res","id":"a1","ok":true}
← {"t":"lobby","n":3,"lobby":{…,"phase":"starting","startsInMs":5000}}
← {"t":"view","n":4,"fresh":true,"view":{…,"phase":{"kind":"start","seats":[]},"ask":{"id":"q1","kind":"role","role":"clean","leftMs":20000}},"events":[]}
→ {"t":"do","id":"7","turn":1,"cmd":{"k":"ack","what":"role"}}
← {"t":"res","id":"7","ok":true}
→ {"t":"do","id":"8","turn":3,"cmd":{"k":"move","to":"kitchen"}}
← {"t":"res","id":"8","ok":true,"result":{"rooms":["lobby","hall","kitchen"]}}
← {"t":"view","n":6,"view":{…,"phase":{"kind":"meeting","seats":[0,4]},"ask":{"id":"q2","kind":"meetAct","with":4,"canAttack":false,"weapons":[],"leftMs":null}},"events":[{"o":41,"type":"enter","seat":0,"room":"hall",…},{"o":42,"type":"enter","seat":0,"room":"kitchen",…}]}
```

---

## 8. Table lifecycle

```
         create                  start (host, ≥2 people; 5 s countdown, Wait)            match ends
(none) ─────────► WAITING ─────────────────────────────────────────────► PLAYING ─────────────► ENDED
                   │  ▲  join · leave · remove · size · lock · look         │                      │
                   │  └──────────────── Play again (host) ◄─────────────────┼──────────────────────┘
                   │                                                         │ no person connected 2 min:
                   └── no person connected 10 min, or 60 min unused ──► CLOSED ◄── ended, not counted; ENDED 10 min unused
```

### 8.1 Codes
5 letters from `BCDFGHJKMNPRSTVWXZ` (18 consonants: no vowels or Y, so no words; no L or Q, which look like other
letters): 18⁵ ≈ 1.9 million codes (ux.md §3.1). From `crypto`, by rejection sampling: a byte ≥ 252 (14 × 18) is
redrawn, so every letter is equally likely *[Amended #43]*. A small blocklist in `src/net/codes.js`; a code
containing one is redrawn. Not reused for 24 h after a table closes. Typed in any case; spaces, dashes and a whole
pasted link are understood. Six letters later is a one-constant change.

### 8.2 Create
`create` → a table with you as host in seat order 0 of the waiting room. The link is built on the device:
`location.origin + location.pathname + '?join=' + code` (relative to wherever the page lives, so it stays right after
a domain move).

### 8.3 Join and peek
- `join` works only while WAITING (or ENDED), not locked, the token not removed, people < size. Otherwise `err
  midMatch` / `locked` / `removed` / `full`. A token already seated goes straight back to its seat at any time.
- Duplicate names at one table get a digit for that table (`nora` → `nora2`, within 16 characters).
- `peek` answers `{ host }` only for a WAITING table, and counts against the wrong-code limits. It shows "You're
  invited to nora's table" above the register on a new device.

### 8.4 LobbyView

```js
{ code, phase: 'waiting' | 'starting' | 'playing' | 'ended', startsInMs: null | ms,
  size, locked, you: pid, host: pid, canStart, why: null | 'needFriend',
  people: [{ pid, name, avatar, mark, host, you, away }],      // pid: opaque per-table person id, never the token
  queued: null | { round, roundLimit } }                        // §8.10
```

### 8.5 The waiting room
Host: size 4/5/6 (never below the number of people; default 6), **Lock** (no new joins; seated people can still come
back), remove (sticks by token hash for the table's life), Start. Everyone: Wardrobe changes (`lobby {op:'look'}`,
validated with `normaliseAvatar`, reaches everyone), quick chat, Leave. The join bell (`sfx('joined')`) rings for real
people only. A dropped person shows **Away**; after 2 minutes away in the waiting room their seat is freed.

### 8.6 Host and start
- The host is the creator. If they leave or stay away 2 minutes in the waiting room, the person seated longest
  becomes host and everyone is told ("nora left. sam is now the host."). In a match the host has no powers.
- **Start** needs at least 2 people (alone: "Nobody has joined yet." · **Wait** · **Play with bots**, which opens Single
  player's Play with bots). If someone is Away: "ivy is away. Start anyway?" with the consequence in today's-rules
  words (§14.5).
- A 5-second countdown ("The lift is on its way… 5") that the host can cancel with **Wait**.

### 8.7 Deal (in one step)
1. People shuffled into random seats with `crypto` (today's random seat, `main.js:1669`).
2. Bots fill the rest up to the size: `rollProfiles` avoiding every person's name (extending `main.js:1671`),
   `botAvatars` (`src/table.js:37`), colours by seat (`SEAT_COLORS`, `table.js:17`), marks (`guestMarks`).
3. `createState` with E1/E2 options; bot and chatter seeds from `crypto`; **every role Random** (TP1); test links
   (`?seed`, `?seat`, `?role`, `?timer`, `?bots`, `?botpace`) ignored.
4. Everyone's devices play the existing lift sequence into the private role screen (phase `start`).

### 8.8 Match and end
- The referee runs (§5). A drop shows **Away**. Leaving keeps your guest at the table (TP4).
- At the end every device gets `view.end`; the table goes to ENDED with the same people and code.

### 8.9 Play again
The host's **Play again** returns the table to WAITING (same people, code, size); then a normal Start with the 5 s
countdown. Anyone still on the end screen sees "The next match starts in 5…" with **Back to the table**, so nobody
is pulled into a match without warning. Late friends can join now.

### 8.10 A friend who arrives mid-match (should-have; **not tonight**, amended 2 Nov after critique, #35)
Until it is built, `err midMatch` shows **Try again** (§14.8). The design, for later:
`err midMatch` offers **Wait here**: `join {code, wait:true}` queues them; they see "nora's table is mid-match (round 5
of 8). You'll get a seat when it ends." (public round progress only) and are seated automatically when the table
returns to WAITING, if there is room. Otherwise "Try again".

### 8.11 Close
No person connected for 2 minutes (a match ends without a result); WAITING 60 minutes without a start; ENDED 10
minutes unused; or everyone left. Devices still connected get `bye closed`. Saved files are deleted 24 h later (codes
not reused meanwhile).

---

## 9. The server clock

- One `setInterval(250 ms)` ticks every table (`rooms.tick`): referee deadlines, bot steps and beats, presence graces,
  countdowns, close timers. No per-table timer objects.
- Deadlines are server milliseconds; devices get `leftMs` ("left when sent") and count down from arrival. Network delay
  (about 30-150 ms to Singapore, tech.md §5) only makes the device slightly pessimistic.
- **Grace:** deadlines fire at `deadline + 500 ms`; a command arriving before that counts.
- **Bot pacing online:** `pace = bots.thinkMs(seat, kind)` at "Normal" speed; after a move add `walkMs(rooms)` =
  rooms × `ONLINE.timing.walkMsPerRoom`, so people see each walk before the next step. *[Amended 2 Nov after
  critique, #34]* `walkMsPerRoom` is **derived, not measured**: rooms are 8 m apart (`src/config.js:52`), and a bot walks at
  `player.speed` 2.9 m/s × the bot walk scale 1.45 (`main.js:1065`) ≈ 4.2 m/s, so ≈ 1.9 s a room (1900 ms). It
  replaces the 650 ms placeholder.
- **`TIME_SCALE` (tests only)** *[Amended 2 Nov after critique, #4]*. A typical match takes about 20 minutes, so
  whole-match tests would run for hours on the wall clock.
  - `server/index.js` reads the env `TIME_SCALE` (a number ≥ 1) and passes it to `createRooms({ timeScale })`, which
    divides bot pace, walk time, every referee limit (turn and discard clocks, start ack, stall) and every countdown
    and close timer by it.
  - The heartbeat and the page's reconnect timing stay real.
  - The server refuses to start with `TIME_SCALE` when `NODE_ENV=production`.
  - The loopback takes `timeScale` too: `?pace=fast` (20) on localhost only.
- **Stall timer (TP3):** it watches the waits that have no time limit under today's rules: a meeting choice, a trade
  card, a Fire Exit answer, and the active person's private-screen pause. (Turns and discards already have the 45 s
  clock; role screens have the 20 s start.) When one such wait passes 60 s, everyone sees a countdown to 5 minutes;
  at 5 minutes the match ends without a result. `stallMs: null` (pending rules) switches it off.
- **Relaxed clock** (pending R10): host option, every limit ×2, fixed for the whole match.

---

## 10. Saving tables and recovery

### 10.1 The rule
Every change goes through one function per table, `commit(fn)`: run the referee or lobby step, **save the table**,
then send. Restore happens **before** the server listens.

### 10.2 What is saved

```js
{ v: 1, id: 't_6f2kq9vd3m', code: 'BKTWM', created, phase, size, locked, host,
  people: [{ pid, tokenHash, name, avatar, joinedAt, seat, away, left }],
  removed: [tokenHash], queued: [tokenHash], closedAt: null,
  match: null | {
    n, dataHash, startedAt,
    engine: toSnapshot(state, floor),       // src/net/snapshot.js: Sets/Maps tagged; floor as lobby doors,
                                            //   placements, jammed doors, deck order; no generator state (crypto)
    referee: ref.toJSON(),                  // phase, asks, deadlines, sealed answers, holds, results, ordinals
    aliases: { [seat]: [[engineId, alias]] }, doIds: { [seat]: [[id, res]] },
    bots: [{ index, profile }]              // minds are rebuilt with fresh crypto seeds and catch up from botView
  } }
```

Size: median 14 KB, max 35 KB; save 0.33 ms, restore 1.7 ms (edge spike, 211/300 mid-match restores, 0 divergences;
re-run by two judges). Fresh bot minds catch up and finish (robust probe, 100/100).

**How this is tested** *[Amended 2 Nov after critique, #5]*. A restored match can't play out identically to the
uninterrupted one:
- bot minds carry their own generators and memory (`src/bots/brain.js:108-150`);
- the table's heard-chat list lives in a closure (`src/bots/index.js:39`);
- `createBotTable` closes over the old `state` and `floor` (`src/bots/index.js:36-51`).

So `referee-check` proves two separate things:
- **(a) The snapshot is lossless.** Fork a match: one branch continues on the live objects, the other goes through
  the JSON snapshot. Both get fresh minds with the same seed and the same random source at the same position, and
  must play out identically.
- **(b) Fresh minds after a restore** (new seeds, catching up from the start) finish every match legally.

### 10.3 Stores
- `createMemoryStore()` (`src/net/store.js`): default; tests; Render Free; the loopback review.
- `createFileStore(dir)` (`server/fileStore.js`): when `DATA_DIR` is set. One file per table; write `tmp` → `fsync` →
  `rename`. Used locally for `restore-check` and on Render with a disk (owner decision D7).

### 10.4 Faults
- Every referee or lobby call runs in `try/catch` per table. On a throw: reload that table's last save, drop the input,
  log one line (no names, tokens or hands). A second throw for the same table within 60 s
  (`ONLINE.timing.faultWindowMs`, amended #23): end that match politely
  ("Something went wrong at this table. This match had to stop. It won't count.") and return to WAITING. The process
  keeps serving every other table.
- **Watchdog:** each tick measures event-loop lag; a table whose step takes over 200 ms twice is ended politely.
  At most 50 bot steps per table per tick.
- `process.on('uncaughtException')` logs and keeps running only for socket-level errors; anything else exits so Render
  restarts it (and the saves bring the tables back).

### 10.5 Restart
- **SIGTERM** (deploy, Render maintenance): stop accepting sockets; save every table; send every socket
  `bye {why:'restart', retryMs: 3000}` (`ONLINE.timing.restartRetryMs`) and close 1012; exit within 25 s
  (`ONLINE.timing.drainMs`), inside Render's 30 s. *[Amended #23]*
- **Boot:** load every saved table; rebuild state and floor with `fromSnapshot`; new bot minds with crypto seeds; move
  every open deadline later by the outage + 15 s (`ONLINE.timing.restoreGraceMs`); mark everyone `gone`; then listen. Devices reconnect (they retry for
  ever) and get a full view with the notice "The hotel's server restarted. Everyone is back where they were. Whoever
  was playing got their time back."
- **Without a disk** (Render Free): tables are gone after a restart. Devices get `err` on hello with their remembered
  table → "The hotel closed for a moment. The server restarted, so this match ended. It won't count."

### 10.6 Update policy (nobody presses deploy; no secrets)
- Render auto-deploys from `main` only when a file the server imports changes (`render.yaml` `buildFilter.paths`:
  `server/**`, `src/net/**`, `src/game/**`, `src/bots/**`, `src/social/**`, `src/table.js`, `src/account/username.js`,
  and the `src/data/*.js` files the server imports). `protocol-check` compares that list with the server's real import
  graph, so it can't drift.
- `/health` → `{ ok, protocol: [min, max], data, tables, matches, people, uptimeS }`.
- Rule-data changes (anything in the data hash) restore matches under the old hash by ending them politely (§7.4);
  the lead pushes those when `/health` shows `matches: 0` where possible.

---

## 11. Reconnection and iPad Safari

### 11.1 What Safari does (sources §19)
- A page in the background (app switch, screen lock) has its WebSocket killed after about 30-60 s, often without
  `onclose`; a socket can look open and be dead (WebKit 247943; Flarum #4588). iOS 18 closes with 1006, and a library
  with a retry budget stopped reconnecting for good from the second backgrounding (Flarum #4597, Apr-May 2026).
- Returning from the back/forward cache fires `pageshow` with `persisted` and **not** `visibilitychange` (Flarum
  PR #4590).
- Closing the socket in `pagehide` is the clean path after the Oct-Dec 2025 WebKit fixes (bugs 301702, 303176, 303534,
  303619); but iOS may not fire `pagehide` when a tab is killed (WebKit 199854), so nothing relies on it.
- Screen Wake Lock: Safari 16.4+; Home Screen web apps from iOS/iPadOS 18.4. Released when hidden; must be asked again.

### 11.2 `src/net/connection.js` (a state machine; tested with a fake socket)

| State | Enter when | Does |
|---|---|---|
| `connecting` | start, or a retry | a **new** `WebSocket` every time; old handlers removed; `hello` |
| `live` | `welcome` received | no message for 25 s while visible → `ping`; no `pong` in 3 s → `reconnecting` |
| `reconnecting` | close, error, failed ping, `bye restart` | retry at 0 s (if visible), then 0.5, 1, 2, 4, 8, 10 s (±25% jitter), then every 10 s **for as long as the table lives**; after `bye restart` the first try waits `retryMs` |
| `lost` | 20 s without `live` | keep retrying every 10 s; the "Still reconnecting…" card |
| `closed` | `bye elsewhere/removed/closed/update/serverOld/busy`, or `leave` | stop; the matching screen |

**Page events:** `visibilitychange` → hidden: send `vis hidden`; → visible, `pageshow`, `online`, `focus`: if not live,
connect now; if live, `ping` and reconnect without a `pong` in 3 s; ask for the Wake Lock again (waiting room and
match only); resume audio. `pagehide`: send `vis hidden`, close with 1001, reconnect on `pageshow`.

### 11.3 Presence on the server
`here` (socket open, answered the last heartbeat) · `hidden` (the page said so) · `gone` (no socket). A `ws` ping every
10 s; a socket that missed the previous one is terminated. Others see **Away** after 5 s hidden or at once when gone,
so an app switch is known within about 5 s and a dead connection within 10-20 s.

### 11.4 Identity and devices
- **Guest key:** 24 random bytes (base64url) from `crypto`, in `localStorage['hotelEscape.guest.v1']` (sessionStorage,
  then memory, if storage is blocked), separate from the profile (`hotelEscape.profile.v1`, `account.js:49`). Sent only
  in `hello`, never in a URL. The server keeps only `hashToken(token)` (sha256 on the server; the in-page loopback
  uses FNV-1a, since there is no secrecy inside one page). *[Amended #28]*
- **Storage is injected** *[Amended 2 Nov after critique, #27]*:
  - `guestKey({ storage, key })`, and `openCoop({ …, storage, remember = true, setUrl = true, doc, win })`.
  - The review link's second seat (sam) uses a memory storage with `remember: false, setUrl: false`, so the two
    seats on one iPad have different keys. With one key, newest-wins would send the first seat `bye elsewhere`, and
    both would rewrite `?join=`.
  - Node tests inject storage the same way.
- **Newest connection wins:** a `hello` with a token that already has a socket sends the old one `bye elsewhere`
  (4001). The new one is never refused (a returning iPad meets its own zombie socket otherwise). "Play here instead" on
  the old device simply connects again.
- **Lost key** (Safari's 7-day clean-up, a private window, a Home Screen copy): a new guest who can't rejoin a running
  match. Where `account.persistent` is false (`account.js:161`), the waiting room warns.

### 11.5 Remembering the table
- `?join=CODE` stays in the address bar while seated (removed with `history.replaceState` on leaving), so a reload
  goes straight back.
- `localStorage['hotelEscape.table.v1'] = { code, at }`: a page opened without `?join=` within 6 h shows "Rejoining your
  table…" · **Cancel** and reconnects; the server sends the seat if the token is still seated.

### 11.6 What the player sees
Under 1 s of trouble, nothing. After 1 s a pill **Reconnecting…**. Back: toast **You're back at the table.** After 20 s
the card **Still reconnecting…** (§14.7). A fresh view after any gap redraws without replaying old animations (the
presentation queue also skips past 3 s of backlog).

---

## 12. Security and anti-cheat (in proportion)

1. **Intentions only.** Devices send the commands of §6.3; the server checks types, lengths and ranges
   (`src/net/protocol.js` validators), then the referee and the engine refuse anything illegal. Results, card types,
   rolls, seats and times are never accepted from a device.
2. **Secret randomness from `crypto`** for the deal, the possessed seat, the hotel, reshuffles, Lock Picks, random
   discards, time-out choices, seat order, bot and chatter seeds, codes, tokens and aliases. Bot minds are reseeded
   from `crypto` after a restore. Single player keeps `makeRng(seed)`.
3. **Limits that bind** (§7.5): the client IP is the right-most `X-Forwarded-For` entry added by Render when
   `TRUST_PROXY=render` (the left-most is attacker-controlled), else the socket address; IPv6 grouped by /64; limits
   generous enough for carrier-grade NAT and paired with per-token limits. (Tests: §7.5.)
4. **Origin allowlist** (`ALLOWED_ORIGINS`, default `https://mohmdalmalik.github.io`, plus `http://localhost:*` **and
   `http://127.0.0.1:*`** when `NODE_ENV !== 'production'`): anything else gets HTTP 403. *[Amended 2 Nov after
   critique, #29]* Every test serves the page on 127.0.0.1, and a page there sends `Origin: http://127.0.0.1:PORT`
   (verified 2 Nov). `resolveServer`'s `?server=` admits `ws://127.0.0.1:*` as well as `ws://localhost:*`. It must later admit the Capacitor/Electron origins
   (`docs/ONLINE_PLAN.md` §4). It stops other sites opening sockets in a visitor's browser; the token is the identity.
5. **Names and looks** re-checked on every `hello` and `look` (`checkUsername`, `src/account/username.js:90`;
   `normaliseAvatar`). Screens keep escaping every network string (`esc`/`who`, `ui/meeting.js`). A modified page could
   wear an unearned item; harmless while nothing is sold.
   *[Amended 2 Nov after critique, #20]* People's looks go through `normaliseAvatar(av, { trusted: true })`, the same
   call as bots' (`src/table.js:37-39`). It checks shape and safety; ownership can't be checked without accounts.
   Stripping people's unlockable items while bots keep theirs would let anyone spot the bots (TP8). `fairness-check`
   has one line for it.
6. **No server address from links on the live site:** `?server=` works only when the page itself is on localhost
   (or 127.0.0.1). The same holds for the test-only links `?coop=fake`, `?coop=soon` and `?pace=fast`. *[Amended #29,
   #32, #4]*
7. **Logs:** one line per table event (created, started, ended, closed, counts of refusals) without tokens, names,
   hands or roles.
8. **No secrets in the repo.** The server needs none now; its settings are Render environment values.
9. **What can't be prevented:** friends telling secrets on a call or showing screens (the waiting room says "Roles are
   secret: keep your screen to yourself."); whoever runs the server could read hands (one sentence for the owner).

---

## 13. Online rules: today's rules plus marked technical placeholders

`docs/GAME_RULES.md` is untouched. Until the owner approves the BEFORE/AFTER list (`OWNER-DECISIONS.md`), Co-op runs
**today's rules unchanged**. Where a table of several people makes a rule impossible to apply as written, or where
the rules are silent, the build uses one of these placeholders. **They are not rules**, each is labelled `TP` in
`src/data/online.js`, and each disappears when the owner approves the matching item.

| TP | Placeholder (what Co-op does now) | Why it is not a rule change | Replaced by |
|---|---|---|---|
| TP1 | Every seat is dealt with **Random** role (one of today's three choices); the role picker is not offered at Co-op tables | Two people can't both be possessed, and a person who picks a role tells everyone it wasn't random. Random is already a choice the rule offers | R2 |
| TP2 | The host picks 4, 5 or 6 guests (default 6); bots sit in empty seats; nobody joins a match already running except to return to their own seat | Today's "4-6 guests, you and computer guests" (`GAME_RULES.md:7-8`), as Play with bots does | R1 |
| TP3 | No time limit on meeting choices, cards, Fire Exit answers or your own private screens (today's rules). One safety valve: **a single wait over 5 minutes stops the match without a result** (not counted), shown as a countdown after 60 s | A service failure path, like a server restart; it never picks a winner or a card | R3, R4, R5, R6 |
| TP4 | A person who is away or leaves keeps their seat; their guest stays at the table and **its turns end on today's 45-second clock** (with today's random discard if over the hand limit). No bot plays it. They can come back while the match lasts | Today's clock rule, applied to an empty chair | R6, R7, R8 |
| TP5 | A guest who is out can watch (seeing only what their guest knew) or leave. "Skip to the result" is not offered at Co-op tables | Other people are still playing: it can't be skipped | R9 |
| TP6 | The table's clock is the server's. Device pauses (Menu, upright iPad, hidden page) don't stop it; test links (`?timer=off` etc.) do nothing at Co-op tables | Those pauses aren't written rules; `?timer=off` is a test link (listed under R10 for the owner to confirm) | R10 |
| TP7 | Co-op matches don't count in Your record or achievements yet | A product choice not made yet; doing nothing changes nothing | D4, D5 |
| TP8 | Bots look like players in the match (today's choice); the waiting room says empty seats get bots | Today's owner choice (`ONLINE_PLAN.md:358-360`) | D3 |
| TP9 | The private-screen pause applies only to the **active** player's own screens | `GAME_RULES.md:15` says "while you read a private screen", *you* being the player whose turn it is | R4 |

**Gate:** Co-op is shown to players only when `ONLINE.server.live` is set **and** `ONLINE.server.open` is true. The lead
sets `open` only after the owner approves at least R1, R2, R3, R6, R8 and R10 (or explicitly chooses to open with
today's rules and the placeholders). Until then the live site shows "Coming soon" (§14.4), and only localhost, the
review link and `?coop=preview` (once a server exists) reach real tables.

---

## 14. The menu split and every Co-op screen

### 14.1 Style and words
- The existing Art Deco menu: `.menu-panel` (`styles.css:1030-1034`, `min(430px, 44vw)` over the blurred lobby),
  `.menu-kicker`, `.menu-h2`, `.menu-btn` and its gold `.primary` (1052-1067), `.seg`, `.mf-label`/`.mf-note`, `.mm-seat`
  rows (1082-1096), colours `--brass`, `--brass-bright`, `--ivory`, `--line`, the `--w-rule` double rule.
- New CSS in `coop.css` (menus) and `coop-match.css` (in match), linked from `index.html` with relative paths.
- Every word below lives in `src/data/onlineText.js`. `{label}` is `ONLINE_TEXT.label`, **"Co-op"** until the owner
  decides (recommended "Play with friends").
- Every button ≥ 44 px; states in words (Host, You, Away, Bot), never colour alone; errors in an `aria-live` region with
  the typed code kept; Reduce Motion followed (`src/motion.js`).

### 14.2 Fit at the four iPad sizes (landscape; computed from today's CSS values)

Usable height = viewport − about 48 px of margin. The waiting room widens the panel to `min(560px, 52vw)` with a class.

| Screen | Height | 1024×694 (646) | 1024×768 (720) | 1180×820 (772) | 1366×1024 (976) |
|---|---|---|---|---|---|
| Main menu (two big buttons replace two big buttons; hint moves out) | ≤ today's | fits | fits | fits | fits |
| Single player | kicker 22 + h2 46 + 2×64 + hint 40 + back 54 + gaps ≈ 330 | fits | fits | fits | fits |
| Co-op | kicker + h2 + line 44 + 64 + code row 76 + back 54 + status 20 + gaps ≈ 400 | fits | fits | fits | fits |
| Coming soon | ≈ 300 | fits | fits | fits | fits |
| Your private table, host (532 px wide at 1024, 560 otherwise; seats in a 2-column grid, 260-274 px each) | kicker 22 + h2 40 + code card 76 + seats 3×52+2×8 (+12) + size/lock row 78 + status 28 + actions 70 + footer 18 ≈ **516** | fits (130 spare; `@media (max-height:760px)` tightens h2 to 28 px) | fits | fits | fits |
| Your private table, guest | ≈ 438 | fits | fits | fits | fits |
| Can't-join card | ≈ 260 | fits | fits | fits | fits |

`tests/browser-coop.mjs` checks at all four sizes: nothing outside the viewport, no sideways scroll, every button
≥ 44 px, `scrollHeight ≤ clientHeight` in the panel, and a screenshot of every screen.

### 14.3 The code field and the on-screen keyboard
In landscape the iPad keyboard covers about half of the screen. While the field is focused and
`visualViewport.height < innerHeight − 100`, the panel gets `.kbd` (`top: 12px; transform: none`), keeping the field
and **Join** above the keyboard. Field: placeholder **5 letters**, `autocapitalize="characters" autocomplete="off"
autocorrect="off" spellcheck="false" enterkeyhint="go"`, and `maxlength` = `ONLINE.code.inputMax` (200), because
browsers apply `maxlength` to pasted text and a pasted invite link
(`https://mohmdalmalik.github.io/Gaming-App/?join=BKTWM`, 53 characters) must fit; `normaliseCode` cleans it.
*[Amended 2 Nov after critique, #26]* Tested with an emulated `visualViewport` resize at all four sizes.

### 14.4 Menu screens and words

**Main menu (changed).** Kicker *A hidden-role game for 4–6 guests*, **Hotel Escape**, *Someone in this hotel is
already possessed.*, the profile card: unchanged. Then:
- **Single player** (primary) · *Play with bots, or practice alone.*
- **{label}** · *A private table with friends, each on their own device.*
- **How to play · Cards**, **Settings · Your record**: unchanged.

**Single player (new `#menu-single`).** Kicker **Single player** · heading **How do you want to play?**
- **Play with bots** (primary) · *Join a table of 4–6 guests* (today's words) → today's `#menu-bots`, unchanged.
- **Practice alone** · *Explore the hotel and find the way out* (today's words).
- The new-player hint, moved here, words unchanged (*New to Hotel Escape? Practice alone is the best place to start.*).
- **‹ Back**

The button ids `btn-menu-bots` and `btn-menu-practice` stay; tests open Single player first (`openSinglePlayer()`
helper in `tests/smoke-lib.mjs`).

**{label} (new `#menu-coop`), a server is available.** Kicker **{label}** · heading **A private table**
- *Everyone plays on their own iPad, phone or computer. One guest is secretly possessed, so keep your screen to
  yourself.*
- **Start a table** (primary) · *You'll get a link to send to your friends.*
- Label **Have a code?** · field **5 letters** · **Join**. The new buttons that open a screen
  (`#btn-menu-single`, `#btn-menu-coop`) carry `data-sfx="open"`. *[Amended #30]*
- **‹ Back**
- Status line: after 1 s the pressed button reads **Opening your table…** / **Looking for the table…**; after 4 s *The
  hotel's switchboard is waking up. The first table of the day can take up to a minute.* (Render Free sleeps);
  offline (`navigator.onLine === false`): buttons dimmed, *You're offline. Connect to Wi-Fi to play with friends. Single
  player still works offline.*
- Inline field errors: *Codes use only consonants: no A, E, I, O, U, Y, L or Q.* · *Codes are 5 letters.*

**{label}: coming soon (live site without a server, §13 gate; on localhost, `?coop=soon` forces it so it can be
tested and screenshotted, amended #32).** Kicker **{label}** · heading **Coming soon**
- *Soon you'll start a private table and send your friends a link. Everyone plays on their own iPad, phone or
  computer.*
- *Single player is ready now.*
- **Single player** (primary) · **‹ Back**

A `?join=` link opened while Co-op isn't open: heading **{label} isn't open yet** · *This link is for a {label} table,
which isn't open yet. Single player is ready now.* · **Single player** · **Main menu**. (The register is shown first
only if the device has no profile, as for any visit.)

### 14.5 Your private table (the waiting room, `#menu-table`)

**Host.**
- Kicker **{label} · Your private table**
- Heading **Waiting for friends…**, which becomes **Ready when you are** once a friend sits down.
- Code card: label **Table code** · **B K T W M** (serif 40 px, letter-spacing 0.32em, `--brass-bright`;
  `aria-label="Table code: B, K, T, W, M"`) · **Invite friends** (gold) · **Copy link**
- Seats (2 columns × 3): seat ring with initial mark, portrait (`ui/portrait.js`), name (serif 17 px), tags in 11 px
  caps: **Host** · **You** · **Away** (*reconnecting…*) · **Bot** (only if D3). Empty: *Empty seat: a bot will sit here*
  (with the existing `mmWait` pulse).
- **Guests at the table** `4 · 5 · 6` · *Empty seats get bots when you start.*
- **New guests** `Welcome · Locked` · when Locked: *No one new can join. Guests already seated can still come back.*
- Status: *2 of 6 seats taken.*
- **Start the match** (primary) · **Leave table** · quiet **Wardrobe**. *[Amended 2 Nov after critique, #24]*
  - The Wardrobe's Done returns to the waiting room, not the main menu: inside `menu.js`, `show('main')` arriving
    from the Wardrobe while a Co-op table is open redirects to `'table'`. `main.js:2299` is not edited.
  - A look change sends `lobby {op:'look'}` from `account.onChange` (`src/account/account.js:268`).
- Footer: *Roles are secret: keep your screen to yourself.*
- If storage isn't persistent: *This browser won't remember you. If you leave, you can't come back to this match.*

**Guest.** Kicker **{label} · nora's table** · heading **Waiting for nora to start…** · the same code card (when locked:
*nora has locked this table.*) · the same seats without Remove · *A table for 6 guests. nora starts the match; empty
seats get bots.* · **Leave table** · quiet **Wardrobe**.

**Dialogs and messages.**
- Host taps a friend's seat: **Remove sam from the table?** / *They can't come back to this table.* / **Cancel** ·
  **Remove**
- Start alone: **Nobody has joined yet.** / *Play with bots instead, or wait for your friends.* / **Wait** · **Play with
  bots**
- Start with someone away (today's rules): **ivy is away.** / *If you start now, ivy's turns will run out on the clock
  until they're back.* / **Wait** · **Start anyway**. (Pending R6: *A bot will play for ivy until they're back.*)
- Countdown: **The lift is on its way… 5** (5 → 1, the lift dial's brass arc; Reduce Motion: number only). Host:
  **Wait**. Guests: *nora can still stop it.*
- Invite friends calls `navigator.share({ title: 'Hotel Escape', text: 'Join my table in Hotel Escape. Code: BKTWM',
  url })` **inside the tap** (Safari refuses a share after any wait; WebKit "The User Activation API"). Cancel shows
  nothing. No share sheet → copy, toast *Link copied. Paste it into Messages or WhatsApp.* If copying fails, the link
  text is selected for copying by hand.
- Toasts: *You joined nora's table.* · *sam joined.* (bell for people only) · *nora left. sam is now the host.* ·
  *ivy left the table.*

**Arriving by link.** No profile on this device: the existing register (`index.html:248-264`) opens with *You're
invited to nora's table.* (from `peek`; *You're invited to a table.* if peek fails) above **Sign the register**; after
**Continue**, straight into the waiting room. A profile present: straight in. Unlike today's `?mode=` links
(`main.js:108-133`), a join link **never** seats "Guest".

### 14.6 In the match (small additions to existing screens)

- **Off-turn asks:** when a question reaches you off your turn (someone walked in on you, a Fire Exit offer) or your
  turn starts: `sfx('yourTurn')` plus the full-screen ask (today's meeting/handoff screens); audio is resumed on
  return to visible. If `ask.leftMs` is a number (only after R3/R5 approval), a seconds ring on the card, crimson at
  5 s, in the existing clock style.
- **Strip:** an away guest gets a grey ring and **Away**.
- **Feed (today's rules):** *sam's connection dropped. Their turns will run out on the clock until they're back.* ·
  *sam is back.* · *sam left the match. Their guest stays at the table.* (Pending R6/R8 variants: *A bot is playing for
  sam until they're back.* · *A bot will play for sam until the end.*)
- **Stall banner (TP3)**, top centre, after 60 s of one wait: *Waiting for nora…* (their turn or screen) or *Waiting
  for the meeting to finish…*; second line *If it takes 4:00 more, this match ends without a result.* (live count).
  At zero: **This match was stopped** / *It waited more than 5 minutes for one choice, so it ended without a result.
  It won't count.* / **Back to the table**.
- **Menu → Leave (today's rules):** **Leave the match?** / *Your guest stays at the table and its turns run out on the
  clock. You can come back with the table's link while the match lasts.* / **Keep playing** · **Leave**
- **Out of the match:** **You are out** / *Your guest has died. Everything you carried lies on the floor. Watch the
  others play on, or leave the table.* / **Watch** · **Leave table** (Single player keeps "Skip to the result").
- **Pending R6/R7 only:** **Are you still there?** / *A bot is playing your turns.* / **I'm back** · **While you were
  away** / *A bot played for you:* (your own guest's moves) / **Continue** · toast *Time ran out: a card was chosen for
  you (Bandage).*
- **End screen:** Victory/Defeat, recap and roles as today. Host: **Play again** (primary) · **Leave table**. Guests:
  **Back to the table** (primary) · **Leave table**, with *nora starts the next match.* When the host starts again:
  *The next match starts in 5…* · **Back to the table**.

### 14.7 Connection and recovery words

| When | Shown as | Words | Buttons |
|---|---|---|---|
| not live for over 1 s | pill, top centre | **Reconnecting…** | — |
| back | toast | **You're back at the table.** | — |
| not live for 20 s (today's rules) | card | **Still reconnecting…** / *Your seat is kept. Until you're back, your turns run out on the clock.* | **Try again** · **Leave match** |
| not live for 20 s (pending R6) | card | **Still reconnecting…** / *Your seat is safe. A bot is playing for you until you're back.* | **Try again** · **Leave match** |
| page reload, table remembered | menu status | **Rejoining your table…** | **Cancel** |
| server restarted, match restored | notice, once | **The hotel's server restarted** / *Everyone is back where they were. Whoever was playing got their time back.* | **OK** |
| server restarted, no saved match | card | **The hotel closed for a moment** / *The server restarted, so this match ended. It won't count.* | **Main menu** |
| updated mid-match (data hash) | card | **The game was updated** / *So this match ended. It won't count.* | **Back to the table** |
| a table's fault | card | **Something went wrong at this table** / *This match had to stop. It won't count. Sorry about that.* | **Back to the table** |
| same table on another device | card | **Playing on another device** / *You're playing this table on another device.* | **Play here instead** · **Main menu** |

### 14.8 Can't join and errors (one card: title / line / buttons)

| When | Title | Line | Buttons |
|---|---|---|---|
| `notFound` | No table with that code | There's no table with code BKTWM. Check the letters, or ask your friend to send the link again. | Try again · Back |
| `full` | This table is full | All 6 seats are taken. Ask the host to make room, or start your own table. | Start a table · Back |
| `midMatch` | This table is mid-match | This table is in the middle of a match. Matches usually take about 20 minutes. | Wait here · Main menu (Wait here only if §8.10 shipped; else Try again) |
| `locked` | This table is locked | The host has locked this table. Ask them to unlock it. | Back |
| `removed` | You've left the table | The host removed you from this table. | Main menu |
| `closed` | This table has closed | Everyone has left this table. Ask your friend for a new link. | Start a table · Main menu |
| `tooMany` | Too many tries | Wait a minute, then try again. | OK |
| `busy` | The hotel is full right now | Too many tables are open at the moment. Try again in a few minutes. Single player still works. | Try again · Single player |
| offline | You're offline | Connect to Wi-Fi to play with friends. Single player still works offline. | Single player · Try again |
| can't reach | Can't reach the game | We can't connect right now. Check your internet, then try again. Single player still works. | Try again · Single player |
| `update` | Update needed | A new version of Hotel Escape is out. Update to join this table. | Update now |
| `serverOld` | One moment | The game is being updated. Try again in a minute. | Try again |
| storage blocked | (note in the waiting room) | This browser won't remember you. If you leave, you can't come back to this match. | — |

---

## 15. Tests

*[Amended 2 Nov after critique, #1, #2, #3, #4, #5, #29, #33, #39]*
- **Every planned suite exists from P0 on** as a stub (prints `PENDING STUB`, exits 0), named in the README, so
  `docs-check` stays green as phases land.
- **Every non-browser suite, the two server suites included, runs in the one `tests.yml` matrix.** A step
  `npm ci --prefix server` (only when `server/package-lock.json` exists) installs `ws`; tests load it with
  `createRequire(new URL('../server/package.json', import.meta.url))('ws')`. There is no separate server workflow.
- **Browser suites run one at a time on the machine** (a `flock` lock), serve the page on `127.0.0.1` and take their
  ports as arguments (ephemeral by default).

**Fast Node suites** (CI; existing 18 stay green unedited):

| Suite | Checks |
|---|---|
| `engine-options-check` | E1-E4: without options the 50-seed baseline is identical; with crypto sources deals are valid; per-table ids are unique per table and independent of the module counter |
| `view-check` | §6.8 tests 1-5 (with 4b, identity) and 8; card `owner`/`shots` where today's screens draw them *[Amended #7, #10]* |
| `referee-check` | (1) all-bot tables through the referee (`botRules: 'autoplay'`) reproduce `bots-check`'s seeded matches event for event; (2) one case for each `botRules: 'page'` difference (§5.3); (3) 200 matches with 1-6 scripted people, random legal commands and random silences: every match ends or stalls out by TP3, no exception; (4) every phase, ask, result and time-out under `today` and `LOCAL_LIMITS` (and `pending` if built tonight), whitelisted results, discard privacy; (5) device walk mode: `step`/`arrived`/`walkCut` reproduce today's cut-short rule, `step` works with no walk in progress; holds stop clock and bots; (6a) the snapshot is lossless: a forked match, one branch through the JSON snapshot, both with fresh minds of the same seed and the same forked random source, plays out identically; (6b) fresh minds after a restore finish every match legally *[Amended #5, #6, #15, #17]* |
| `fairness-check` | §6.8 tests 6, 7, 7b, 7c, 9; interleaved tables of different sizes in one process |
| `seam-check` | §6.8 test 11 (static part); `GAME_RULES.md` hash; no `PENDING STUB` suite left (from P6) |
| `connection-check` | `connection.js` with a fake WebSocket and fake page events: zombie socket, `pageshow persisted` without `visibilitychange`, three background cycles in a row, `bye restart` timing, newest-wins stop, backoff never gives up, old handlers detached |

**Server suites** (in the fast matrix, after the `npm ci --prefix server` step; amended #2):

`protocol-check`: an in-process server on an ephemeral port, `ws` clients each with their own `X-Forwarded-For`, an
injected clock. It checks:
- origins: a foreign Origin gets 403; a `http://127.0.0.1:*` page is admitted;
- codes and wrong-code limits; the real per-IP limits bind for one address;
- peek; host-only ops; lock; removal sticks; start fills bots;
- refusals: out of turn, stale, not-your-card, bad-ask;
- idempotent `do`; reconnect gives a full view and the same seat; newest wins;
- 1007/1008/1009; heartbeat terminate; version and data `err`s; Play again; close timers; busy/creation limits;
- the build-filter list equals the import graph; a 5,000-message fuzz;
- **wire scan, `res` included: 0 secrets**.

`restore-check`: the real server as a child process with a temp `DATA_DIR`, `TIME_SCALE` ≈ 20 and per-client
`X-Forwarded-For`; 20 tables of 2-3 scripted people with random delays and drops plus bots. It checks:
- `kill -9` 5-10 times; every match finishes; no effect happens twice;
- each device's received history (by `o`) is a prefix of the final history;
- one SIGTERM run checks the drain and the clock shift.

*[Amended #3, #4, #11, #29]*

**Browser** (Playwright + the container's Chromium, by hand like today's suites, one at a time under the lock):
- every existing suite, unedited, after each P1C step;
- `browser-honesty` (Single player, §6.8 test 11, `?timer=off`);
- `browser-coop` *[Amended #3, #4, #29, #38]*:
  - setup: the page on `http://127.0.0.1:<port1>/`, the server on `127.0.0.1:<port2>` with `TIME_SCALE`
    (different origins);
  - **a whole match with 3 contexts** through `window.__net.send`; **6 contexts** for the waiting room, joining
    and the screens; each context is its own guest;
  - create; join by link on a fresh context with the register; join by code; lock; remove; start;
  - a text scan of every page for other seats' roles and cards;
  - a `setOffline` drop **of 40 s**, then return. `setOffline` blocks frames but does not close the socket, so only
    the heartbeat and the page's 25 s ping notice; see §18;
  - server `kill -9` with `DATA_DIR` mid-trade; Play again; the keyboard check;
  - the review link at 1024×694 with `?pace=fast`;
  - screenshots of every Co-op screen at 1024×768, 1180×820, 1366×1024 and 1024×694.

**Load** (`tools/load/coop-load.mjs`, from the spike, under the browser lock): 100 and 300 tables, 2 test people each
plus bots, accelerated with `TIME_SCALE`, file store on. **Gate:** 0 unfinished matches and memory < 400 MB. The
event-loop p99 at 300 tables and the save time per step are **reported as measurements**: the CPU is shared with
other lanes' browsers, so a timing target would be meaningless here. *[Amended 2 Nov after critique, #39]*

---

## 16. How the owner reviews it before any hosting account exists

1. **Recorded match (no setup).** We run the server and 4-6 headless players here and publish a private page of
   screenshots: the waiting room, the start, a meeting from both sides, a drop and return, the end screen, at the four
   iPad sizes.
2. **"Two seats on one iPad" (interactive, no account):** `…/Gaming-App/?friends=demo` on the live site.
   - The page runs `rooms.js` and the referee inside itself (`loopback.js`; every message still goes through
     `JSON.stringify`/`parse`). You hold two people's seats (yours and "sam"); bots hold the rest; today's rules.
   - **It goes through the real Co-op screens, with the loopback as their server** *[Amended 2 Nov after critique,
     #37]*. This way the owner tries what they asked for: creating a table and joining it with a code.
     1. You tap **Start a table** and see the code.
     2. You tap **Show sam's screen** (the seat switch is shown from the waiting room on), type the code as sam and
        join.
     3. You switch back and tap **Start**.

     `coopMenu.js` takes the loopback's `openCoop` and transport by injection. sam's seat keeps its device key in a
     memory storage (§11.4). The waiting-room part needs only P2B and P3, so it can ship before the in-match part
     (P4). Until then it ends at "Match dealt: the match itself arrives next."
   - **Show sam's screen** switches whose screen is shown, through the same path as a reconnection (a fresh full view),
     so each screen shows only its own cards. When a question waits on the other seat, the switch offers itself
     ("sam must choose a card").
   - A quiet line under the heading says *Test table: the online rules are not decided yet.* The table runs today's
     rules with the placeholders TP1, TP3, TP4 and TP6 (§13), which aren't rules. *[Amended #40]*
   - `?pace=fast` (localhost only) runs the demo at `TIME_SCALE` 20 for the automatic tests. *[Amended #4]*
   - Full screen in landscape, so the real layout is tested. Two Safari windows side by side would not work: under
     900 px wide the game covers itself with "Make this window wider" and pauses (`styles.css:895`, `index.html:591`,
     `main.js:606-608`).
   - Limits: one device, no real network.
3. **Later, Render Free** (sign-up with GitHub, no card): the first real two-device test with
   `?coop=preview`. It sleeps after 15 minutes without traffic and takes about a minute to wake.

---

## 17. Hosting and deploy

- **Server:** Node 22 (`NODE_VERSION=22`; Render's default for new services is Node 24, per Render docs), `ws` **8.22.0**
  exact with `package-lock.json` and `npm ci` (8.22.0 was published 26 Sep 2026; 8.22.1 on 31 Oct 2026 is only two days
  old; we move to it after 14 Nov 2026, earlier only if its changelog shows a security fix). No other dependencies.
- **`render.yaml`** (a Blueprint, no secrets): `type: web`, `runtime: node`, `region: singapore` (the region can't be
  changed later; owner confirms, D7), `plan: free` at first, `buildCommand: cd server && npm ci`, `startCommand: node
  server/index.js`, `healthCheckPath: /health`, `buildFilter.paths` (§10.6), env `ALLOWED_ORIGINS`, `NODE_VERSION`,
  `TRUST_PROXY=render`, `NODE_ENV=production`. A disk (`/var/data`, 1 GB) and `DATA_DIR` only on a paid plan.
- **Owner steps (later, from the iPad, about 10 minutes):** render.com → Sign up with GitHub → New → Blueprint → choose
  Gaming-App → check region Singapore → Apply → send us the `…onrender.com` address. We put the `wss://` form in
  `ONLINE.server.live` and publish. `server/README.md` has the same steps with screenshots-to-be.
- **Costs** (third-party price figures, to check before paying): Free $0 (sleeps); Starter about $7/month; disk about
  $0.25/GB/month. Bandwidth: about 0.44 MB per seat per match (measured), inside a reported 5 GB/month allowance for
  about 1,900 six-person matches; `ws` compression is a one-line switch if needed.
- **Exit doors:** Railway Hobby ($5/month, has Singapore) or Fly.io; or a Cloudflare Durable Object host for the same
  `rooms.js` (about 200 lines, edge proposal) if idle cost or restarts ever matter more.

---

## 18. Risks, and what this container can't prove

| Risk | Size | Mitigation |
|---|---|---|
| The main.js switch breaks Single player | High | Five steps in four checkpoints, each merged only with every existing suite passing unedited; one long-lived presenter state and floor copy (§4.3); test pokes re-synced; device walk mode and holds keep today's feel; `browser-honesty` with a write trap; an iPad checklist per publish *[Amended #7, #8, #9, #41]* |
| Referee differs from today's bots | Medium | `botRules: 'page'` reproduces the page's four differences from `autoplay` (§5.3); `referee-check` reproduces `bots-check` matches event for event under `botRules: 'autoplay'` before main.js switches *[Amended #6]* |
| The main.js switch is too big for tonight | High | Estimated 25-35 Claude working days (code.md §6.6). Split into checkpoints P1C·1-4 with a hand-off each; browser runs serialised by one lock; plan to stop after P1C·1 or P1C·2 tonight (BUILD-PLAN §1) *[Amended #33]* |
| An away friend stalls the table (today's rules) | Medium | TP3 stops the match after 5 minutes; R3/R6 approval removes it; Co-op isn't open to players before approval |
| Restarts on Render Free end matches | Medium | Honest message; disk on Starter (D7) |
| A person's own thinking time is a tell | Low | As at a real table; meeting sub-steps and bot beats hide everything else |
| Page/server skew after a publish | Low | protocol version and data hash in `hello`; one-step compatibility; data-hash restores end politely |
| `ws` supply chain | Low | exact pin, lockfile, a version over two weeks old |
| Lost guest key | Low | storage warning; seat held until the match ends |

**Not provable here:** real iPad Safari backgrounding and the Wake Lock (the owner's two-device test on Render Free);
Render's disk and fsync behaviour on a deploy; real latency from the Gulf to Singapore; WebKit (only Chromium is
installed). render.com could not be fetched from this session (it must be allowed in the session's network settings to
check Render facts directly); Render facts below come from search summaries.

**What Chromium's test tools can and can't do (verified 2 Nov)** *[Amended 2 Nov after critique, #3, #38]*:
- **`setOffline` blocks frames but closes nothing.** After `context.setOffline(true)` the page's WebSocket stays open
  (readyState 1) with no `close` event, and frames and pings are lost both ways. A drop made this way is noticed only
  by the server heartbeat (10-20 s, §11.3) and the page's ping (25 s of silence + 3 s, §11.2). Tests wait 25 s or
  more (critic's probe, `scratchpad/critic/offline/t.mjs`).
- **`extraHTTPHeaders` are not sent on a WebSocket upgrade**, so a browser context can't pose as its own client IP;
  see §7.5 (`scratchpad/lead-amend/xff-probe.mjs`).
- **A page on 127.0.0.1 sends `Origin: http://127.0.0.1:PORT`**, hence the dev allowlist (§12.4).

---

## 19. Sources

**Repo** (commit `dacfcde`, read 2 Nov 2026): `src/main.js:100-200, 400-1240, 2525-2560`; `src/discovery.js:1-62`;
`src/bots/autoplay.js:1-150`, `src/bots/index.js:1-128`, `src/bots/view.js:1-92`; `src/game/state.js:1-130`,
`src/game/cards.js:1-101`, `src/game/hotel.js:40-130`, `src/game/actions.js:430-530`, `src/game/knowledge.js:1-48`;
`src/ui/menu.js:1-80`; `index.html:240-330, 591, 741`; `styles.css:890-900, 1028-1096, 1895-1905`; `src/table.js`;
`src/data/rules.js:25-49, 170-196`; `src/data/howToPlay.js:97`; `tests/smoke-lib.mjs`, `tests/run-fast.mjs`,
`.github/workflows/tests.yml`; `docs/ONLINE_PLAN.md`, `docs/GAME_RULES.md:7-15, 105`.

**Scratchpad** (2 Nov 2026): `research/code.md`, `tech.md`, `ux.md`, `rules.md`; `proposals/minimal.md`, `robust.md`,
`edge.md`; `judge/simplicity.md`, `player.md`, `robustness.md`; probes `probe-minimal/view-size.mjs`,
`robust-probe/replay.mjs`, `edge-spike/test-snapshot.mjs`, `edge-spike/lib/snapshot.js`, `edge-spike/lib/rng.js`.
*Added 2 Nov after critique:* `final/CRITIQUE.md`; the critic's `setOffline` probe `critic/offline/t.mjs`; the
lead's `extraHTTPHeaders`/Origin probe `lead-amend/xff-probe.mjs` (Chromium 1194: no `X-Forwarded-For` on the upgrade;
Origin `http://127.0.0.1:PORT`).

**Checked for this design (2 Nov 2026):**
- npm registry, `ws`: 8.21.0 2026-05-22, 8.22.0 2026-09-26, 8.22.1 2026-10-31 (latest); no dependencies.
  https://registry.npmjs.org/ws
- Render Blueprint YAML reference (search summary; render.com itself not reachable from this session): `region`,
  `buildFilter` with `paths`/`ignoredPaths`, `healthCheckPath`, `plan`, build and start commands; JSON Schema at
  render.com/schema/render.yaml.json. https://render.com/docs/yaml-spec · https://docs.render.com/blueprint-spec ·
  https://render.com/tutorials/advanced-blueprint-patterns/putting-it-all-together

**Carried from the research and judgements (dates as cited there):**
- Render changelog, WebSocket messages keep Free services awake (24 Feb 2026).
  https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages
- Render docs, Node version (`NODE_VERSION` first; Node 24.14.1 default for services created from 2026-04-21).
  https://render.com/docs/node-version
- WebKit blog, "The User Activation API" (share needs the tap). https://webkit.org/blog/13862/the-user-activation-api/
- Flarum #4597 (iOS reconnect fails from the second backgrounding, Apr-May 2026), #4588, PR #4590 (bfcache `pageshow`).
  https://github.com/flarum/framework/issues/4597 · https://github.com/flarum/framework/issues/4588 ·
  https://github.com/flarum/framework/pull/4590
- WebKit bugs 247943 (sockets in background), 199854 (no `pagehide` on kill), 301702/303176/303534/303619 (bfcache
  socket fixes). https://bugs.webkit.org/show_bug.cgi?id=199854
- MDN browser-compat-data, Screen Wake Lock (Safari 16.4; Home Screen apps 18.4).
- Apple, "Adopting Multitasking Enhancements on iPad" (Split View panes are compact width).
- W3C, WCAG 2.2 SC 2.2.1 Timing Adjustable. https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html
- Secret Hitler web game (cozuya/secret-hitler, commit 7e3a201, 28 Jun 2026): refuses joins mid-game; password only for
  publicly listed games (ux.md).
