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
//   table.local.debug          { state, floor, bots, chatter }: the real objects, for the page's test hooks only
//                              (window.__game); TRANSITIONAL until P1C S5: the page still runs the match on them
import { resetState } from '../game/state.js';
import { playerView, seatEvents } from './playerView.js';
import { createHotel } from '../game/hotel.js';
import { createBotTable } from '../bots/index.js';
import { createChatter } from '../bots/chatter.js';
import { BOT_CHAT } from '../data/chat.js';

export const botSeedOf = seed => ((seed * 2654435761) >>> 0) || 1;
export const chatSeedOf = seed => ((seed * 2246822519) >>> 0) || 1;

export function createLocalTable({
  roster, humanSeat = 0, seed, practice = false, possessedIndex = null, botSeats = [], clockOn = true,
  paceScale = () => 1, chat = false, hotelData, cfg, adopt = null,
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

  // --- what the player's seat is shown ------------------------------------------------------------------------
  const listeners = new Set();
  let lastO = 0;                           // the last of this seat's events already passed on
  const extras = () => ({ table: { kind: practice ? 'practice' : 'bots', code: null, rules: 'today', clockOn: !!clockOn, relaxed: false } });

  const table = {
    kind: 'local',
    seat: humanSeat,
    view: null,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    leave() { listeners.clear(); },
    local: {
      sync() {
        const view = playerView(state, floor, humanSeat, extras());
        const { events, lastO: o } = seatEvents(state, humanSeat, lastO);
        lastO = o;
        table.view = view;
        const change = { view, events, fresh: false, local: [] };
        for (const fn of [...listeners]) fn(change);
        return change;
      },
      // the real objects: only for window.__game (the tests' direct engine calls) and, until P1C S5, the page
      debug: { state, floor, bots, chatter, referee: null, paceScale },
    },
  };
  table.view = playerView(state, floor, humanSeat, extras());
  return table;
}
