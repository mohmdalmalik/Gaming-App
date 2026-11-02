// Seeded all-bot matches for the Node suites (a shared helper, not a suite: tests/docs-check.mjs counts only
// tests/*.mjs, never this subfolder). It is tests/bots-check.mjs's own newMatch (lines 45-54), applyMode
// included, so every suite that needs "a match like bots-check's" builds exactly the same one:
// tests/engine-options-check.mjs, and later view-check, referee-check and fairness-check.
//
//   const { state, floor, table, profiles } = newMatch(6, 1234);           // 6 guests, seed 1234: as bots-check
//   newMatch(5, 77, { seats: [0, 1, 2] })                                  // bots only in seats 0-2
//   newMatch(4, null, { floor: newFloor(), engine: { rng, hotelRng, perTableIds: true }, botSeed: 9 })
//                                                                          // the engine options (src/game/state.js)
//   playMatch(6, 1234)                                                     // newMatch + autoplay.playOut, summarised
//
// `opts.floor`: a hotel of its own (newFloor()); without it every match shares one module-level hotel, as in
// bots-check (a new match rebuilds it in place). `opts.engine`: passed to createState after { mode: 'match' }.
// `opts.botSeed`: the seed for the bot table and the bots' usernames when the deal has no seed (crypto deals).
import { applyMode } from '../../src/data/rules.js';
import { hotel } from '../../src/data/hotel.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { createHotel } from '../../src/game/hotel.js';
import { makeRng } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import { createBotTable } from '../../src/bots/index.js';
import { rollProfiles } from '../../src/bots/profiles.js';
import { playOut } from '../../src/bots/autoplay.js';

export const newFloor = () => createHotel(hotel, config);
let shared = null;
export const sharedFloor = () => (shared ||= newFloor());

export function newMatch(seats, seed, opts = {}) {
  const floor = opts.floor || sharedFloor();
  applyMode('match', seats);
  const state = S.createState(floor, roster.slice(0, seats), seed, { mode: 'match', ...(opts.engine || {}) });
  const botSeed = Number.isFinite(seed) ? seed : (opts.botSeed ?? 1);
  const rng = makeRng((botSeed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(seats, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const botSeats = (opts.seats ?? profiles.map((_, i) => i)).map(index => ({ index, profile: profiles[index] }));
  const table = createBotTable(state, floor, botSeats, botSeed);
  return { state, floor, table, profiles };
}

// FNV-1a, 32 bits, as 8 hex digits (over the UTF-16 code units of a string: enough for a fingerprint).
export function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// A finished match's fingerprint: the public events and every guest's private inbox, in seat order.
export const eventsHash = state => fnv1a(JSON.stringify(state.events) + JSON.stringify(state.players.map(p => p.inbox)));

// One all-bot match played straight through (autoplay.playOut, its default turn cap), summarised as the engine
// baseline records it (tests/fixtures/engine-baseline.json).
export function playMatch(seats, seed, opts = {}) {
  const m = newMatch(seats, seed, opts);
  const r = playOut(m.state, m.floor, m.table, opts.playOut || {});
  return { seed, seats, won: r.won, dawn: r.dawn, turns: r.turns, round: r.round, eventsHash: eventsHash(m.state), match: m };
}

// The baseline's 150 entries: seeds 1-50 x 4, 5 and 6 guests.
export const BASELINE_SEEDS = Array.from({ length: 50 }, (_, i) => i + 1);
export const BASELINE_SEATS = [4, 5, 6];
export function baselineEntries() {
  const out = [];
  for (const seats of BASELINE_SEATS) {
    for (const seed of BASELINE_SEEDS) {
      const { match, ...entry } = playMatch(seats, seed);
      out.push(entry);
    }
  }
  return out;
}
