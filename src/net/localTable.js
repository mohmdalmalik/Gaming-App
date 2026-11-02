// SINGLE PLAYER THROUGH THE TABLE (DESIGN §4.2, BUILD-PLAN P1C). The match a person plays on this device alone
// (Practice, or Play with bots) lives in a LocalTable: it deals the game, and it owns the computer guests' minds
// (src/bots/index.js) and their chatter (src/bots/chatter.js). The page (src/main.js) only presents it.
//
//   const table = createLocalTable({ roster, humanSeat, seed, practice, possessedIndex, botSeats, clockOn,
//                                    paceScale, chat, hotelData, cfg, adopt })
//     roster          today's seatTable() result (src/table.js), in seat order
//     humanSeat       the player's own seat
//     seed            today's newSeed() (main.js): ?seed= and rules.practiceSeed keep working
//     practice        true for Practice alone (no bots, no hidden role)
//     possessedIndex  the role choice (state.setup.possessedIndex), or null for a random one
//     botSeats        [{ index, profile }]: the computer guests (today's planGame)
//     clockOn         rules.turnTimerEnabled after applyMode and ?timer=off
//     paceScale       () => number: today's Bot speed × ?botpace × (0.5 once the player is dead)
//     chat            Settings › Quick chat is not Off: the computer guests talk (and listen) only then
//     hotelData, cfg  src/data/hotel.js and src/config.js: the real hotel is built here
//     adopt           TRANSITIONAL { state, floor? } (P1C S1-S4): deal INTO the page's own objects with resetState, as
//                     main.js's resetWorld did, so everything that holds them keeps working. Without `floor` the real
//                     hotel is built here (from S2: the page draws its own copy, src/net/floorCopy.js). S5 removes it.
//
// Seeds exactly as the page used them, so a ?seed= link plays the same match: the deal and the hotel from `seed`
// (resetState); the minds from ((seed * 2654435761) >>> 0) || 1; the chatter from ((seed * 2246822519) >>> 0) || 1.
//
// The table (DESIGN §4.1), so far:
//   table.kind 'local', table.seat
//   table.view                 the latest PlayerView of the player's seat (src/net/playerView.js; card ids are the
//                              engine's own in Single player: identity aliases)
//   table.on(fn)               fn({ view, events, fresh, local }) after every change; events: what this seat saw happen
//                              since the last one (public events and its own, numbered o); returns an unsubscribe
//   table.local.sync()         build the view again from the real game (after anything changed it) and tell `on`;
//                              the listeners have run when it returns
//   table.local.debug          { state, floor, bots, chatter, referee }: the real objects, for the page's test hooks
//                              only (window.__game); TRANSITIONAL until P1C S5: the page still runs part of the match
//                              on them
// With `referee: true` (P1C S3: Practice; S4: every table) the match is run by the referee (src/net/referee.js) in
// local mode: LOCAL_LIMITS, device walks, botRules 'page' (DESIGN §4.4), and the page drives it with
//   table.local.apply(cmd)     the player's command (DESIGN §6.3) -> { ok, reason?, result? }, SYNCHRONOUS: the view is
//                              built again and the listeners have run when it returns (a refusal too: a jammed door is
//                              found by trying it). table.send(cmd) is the same in a promise.
//   table.local.hold({ bots, clock })   every frame, before tick: today's botTick wait list and timerPaused()
//   table.local.tick(now, dt)  with dt: the clock counts dt (at most 50 ms a frame); without: a due bot step or beat runs
//   table.local.step(roomId)   the active guest's figure crossed into roomId; arrived(): its walk ended (the meeting)
//   table.local.walkFailed()   the page could not plan a computer guest's walk; skipToEnd(): the rest at once
//   change.local               [{ type: 'walk', seat, rooms } | { type: 'walkCut', seat, to }]: what the figures do
import { resetState } from '../game/state.js';
import { playerView, seatEvents } from './playerView.js';
import { createHotel } from '../game/hotel.js';
import { createBotTable } from '../bots/index.js';
import { createChatter } from '../bots/chatter.js';
import { BOT_CHAT } from '../data/chat.js';
import { LOCAL_LIMITS } from '../data/online.js';
import { createReferee } from './referee.js';

export const botSeedOf = seed => ((seed * 2654435761) >>> 0) || 1;
export const chatSeedOf = seed => ((seed * 2246822519) >>> 0) || 1;

export function createLocalTable({
  roster, humanSeat = 0, seed, practice = false, possessedIndex = null, botSeats = [], clockOn = true,
  paceScale = () => 1, chat = false, hotelData, cfg, adopt = null, referee = false, now = () => performance.now(),
} = {}) {
  if (!Array.isArray(roster) || !roster.length) throw new Error('createLocalTable needs the seats (roster)');
  const mode = practice ? 'practice' : 'match';
  // --- the deal: the page's own objects (adopt), or new ones -------------------------------------------------
  let state, floor;
  if (adopt) {
    state = adopt.state;
    floor = adopt.floor || createHotel(hotelData, cfg);
    Object.assign(state, { roster, mode, practice });
    state.setup = { possessedIndex };
    resetState(state, floor, seed);
  } else {
    floor = createHotel(hotelData, cfg);
    state = { roster, mode, practice, setup: { possessedIndex } };
    resetState(state, floor, seed);
  }
  state.viewerIndex = humanSeat;

  // --- the computer guests and their chatter ----------------------------------------------------------------
  const seats = practice ? [] : botSeats.filter(s => s && s.index !== humanSeat);
  const bots = practice ? null : createBotTable(state, floor, seats, botSeedOf(seed));
  // (their chat has its own random numbers; talking alone never changes the game, listening does: each bot
  // weighs what it hears from what it knows, src/bots/brain.js)
  const chatter = !practice && chat ? createChatter(state, floor, seats, chatSeedOf(seed), BOT_CHAT, bots) : null;

  // --- the referee (local mode): who acts when, the clock, the bots' steps and beats, the questions -----------------
  // (today's botThink: the brain's own pause, scaled by Bot speed, ?botpace and a half once the player is out)
  const pace = (seat, kind) => {
    let base = 600;
    try { base = bots?.thinkMs(seat, kind) ?? 600; } catch { /* keep the default */ }
    return base * paceScale();
  };
  // (created after applyMode and ?timer=off: the limits are read once; no `random`, so a discard at the end of the clock
  // draws from the engine's own generator exactly where the page did)
  const ref = referee ? createReferee({ state, floor, bots, people: [humanSeat], mode: 'local', walkMode: 'device', botRules: 'page',
    limits: LOCAL_LIMITS, pace, now: now() }) : null;

  // --- what the player's seat is shown ------------------------------------------------------------------------
  const listeners = new Set();
  let lastO = 0;                           // the last of this seat's events already passed on
  const extras = () => ({
    table: { kind: practice ? 'practice' : 'bots', code: null, rules: 'today', clockOn: !!clockOn, relaxed: false },
    ...(ref ? ref.extras(humanSeat, now()) : {}),
  });
  function sync() {
    const view = playerView(state, floor, humanSeat, extras());
    const { events, lastO: o } = seatEvents(state, humanSeat, lastO);
    lastO = o;
    table.view = view;
    const local = ref ? ref.drain().map(x => x.ev) : [];
    const change = { view, events, fresh: false, local };
    for (const fn of [...listeners]) fn(change);
    return change;
  }
  const noRef = () => ({ ok: false, reason: 'notNow' });

  const table = {
    kind: 'local',
    seat: humanSeat,
    view: null,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    send(cmd) { return Promise.resolve(table.local.apply(cmd)); },
    leave() { listeners.clear(); },
    local: {
      sync,
      apply(cmd) {
        if (!ref) return noRef();
        const r = ref.do(humanSeat, cmd, now());
        sync();
        return r;
      },
      hold(h) { ref?.hold(h); },
      tick(nowMs = now(), dtMs = null) {
        if (!ref) return false;
        const changed = dtMs != null ? ref.advance(dtMs * 1, nowMs) : ref.tick(nowMs);
        if (changed) sync();
        return changed;
      },
      step(roomId) { if (!ref) return noRef(); const r = ref.step(roomId, now()); if (r.ok) sync(); return r; },
      arrived() { if (!ref) return noRef(); const r = ref.arrived(now()); sync(); return r; },
      walkFailed() { if (!ref) return noRef(); const r = ref.walkFailed(now()); sync(); return r; },
      skipToEnd() { if (!ref) return noRef(); const r = ref.skipToEnd(now()); sync(); return r; },
      // the clock's hooks (milliseconds)
      timeLeft() { return ref ? ref.timeLeft() : 0; },
      setTimeLeft(ms) { const r = !!ref?.setTimeLeft(ms); if (r) sync(); return r; },
      // the real objects: only for window.__game (the tests' direct engine calls) and, until P1C S5, the page
      debug: { state, floor, bots, chatter, referee: ref, paceScale },
    },
  };
  table.view = playerView(state, floor, humanSeat, extras());
  return table;
}
