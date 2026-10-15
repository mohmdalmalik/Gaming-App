// The public events hold only what the whole table may see (no browser, ~10 s).
//   node tests/public-events-check.mjs
//
// state.events is the engine's PUBLIC list: the computer guests read it, the sounds and the feed are
// made from it, and a server would send it to every seat. It must never carry a role, a hand, a card
// count or a private result. A leak would be one extra key (an earlier slip put the searcher's hand
// size on the "search" event), so this test holds each event type to a list of the keys it may have,
// and the kind of value each key may hold. A key not on the list fails, a missing key fails, an unknown
// event type fails (and so does a new emitPublic() call whose type is not listed here): whoever adds
// an event must come here, write down its shape, and so decide on purpose that it is public.
//
// The list is written out below from src/game/state.js (emitPublic, the comment above it) and the
// emitPublic() calls in src/game/actions.js. Every event also carries { seq, round, turn, type }.
//
// It runs the check over a few hundred seeded all-bot matches (4, 5 and 6 guests), so every kind of
// event is met, and it proves the check itself works: leaky copies of real events are caught.
import fs from 'node:fs';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles } from '../src/bots/profiles.js';
import { playOut } from '../src/bots/autoplay.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const t0 = Date.now();
const floor = createHotel(hotel, config);

// --- The documented shapes -----------------------------------------------------------------------------
// Kinds of value: seat = a seat number (0 .. guests-1); id = a short plain-word string that is an id of
// a room, a doorway or a card type (checked below against the hotel and the card list); count = a whole
// number >= 0; flag = true or false. Nothing else (no object, no array, no null) is allowed anywhere.
const BASE = { seq: 'count', round: 'count', turn: 'count', type: 'id' };
const SHAPES = {
  turn:        [{ seat: 'seat' }],                                                       // whose turn it is now (round: in every event)
  enter:       [{ seat: 'seat', from: 'room', to: 'room' }],                             // a guest walked into a room
  open:        [{ seat: 'seat', room: 'room', door: 'door', revealed: 'room' },          // a door opened: the room behind it
                { seat: 'seat', room: 'room', door: 'door', jammed: 'flag' }],           // ...or it is jammed shut
  search:      [{ seat: 'seat', room: 'room' }],                                         // that a room was searched, never the result
  escape:      [{ seat: 'seat' }],
  mirror:      [{ by: 'seat', target: 'seat' }],                                         // that a Hand Mirror was used, never what it showed
  unlock:      [{ by: 'seat', room: 'room', opened: 'flag' }],                           // a Master Key / Lock Pick: whether it worked
  barricade:   [{ by: 'seat', door: 'door' }],
  infirmary:   [{ seat: 'seat' }],
  switchboard: [{ by: 'seat', count: 'count' }],                                         // how many are possessed, not who
  noTrade:     [{ a: 'seat', b: 'seat' }],                                               // a meeting where nobody could trade
  trade:       [{ a: 'seat', b: 'seat' }],                                               // that two guests traded, never the cards
  attack:      [{ by: 'seat', target: 'seat', weapon: 'card', damage: 'count', killed: 'flag', room: 'room' }],
  relock:      [{ room: 'room' }],
};

// What a value of each kind must look like, for a match of `n` guests.
function kindOk(kind, v, n) {
  switch (kind) {
    case 'seat': return Number.isInteger(v) && v >= 0 && v < n;
    case 'count': return Number.isInteger(v) && v >= 0;
    case 'flag': return typeof v === 'boolean';
    case 'room': return typeof v === 'string' && floor.rooms.has(v);
    case 'door': return typeof v === 'string' && v.length > 0 && v.length < 40 && /^[\w:.>-]+$/.test(v);
    case 'card': return typeof v === 'string' && v in rules.cards && !rules.cards[v].evil;     // an attack names a weapon, never a Possession card
    case 'id': return typeof v === 'string' && /^[a-zA-Z]+$/.test(v);
    default: return false;
  }
}

// Returns a list of problems with one event (empty: fine).
function problems(ev, n) {
  const out = [];
  const shapes = SHAPES[ev.type];
  if (!shapes) return [`unknown event type "${ev.type}"`];
  for (const [k, kind] of Object.entries(BASE)) {
    if (!(k in ev)) out.push(`${ev.type}: missing ${k}`);
    else if (!kindOk(kind, ev[k], n)) out.push(`${ev.type}: ${k} holds ${JSON.stringify(ev[k])}`);
  }
  const own = Object.keys(ev).filter(k => !(k in BASE));
  // the one shape whose own keys are exactly the event's keys
  const fit = shapes.find(sh => Object.keys(sh).length === own.length && own.every(k => k in sh));
  if (!fit) {
    const allowed = new Set(shapes.flatMap(sh => Object.keys(sh)));
    for (const k of own) if (!allowed.has(k)) out.push(`${ev.type}: key "${k}" is not on the list`);
    if (!out.some(m => m.includes('is not on the list'))) out.push(`${ev.type}: keys [${own.join(',')}] fit none of the listed shapes`);
    return out;
  }
  for (const [k, kind] of Object.entries(fit)) if (!kindOk(kind, ev[k], n)) out.push(`${ev.type}: ${k} holds ${JSON.stringify(ev[k])}, not a ${kind}`);
  if (ev.type === 'open' && 'jammed' in ev && ev.jammed !== true) out.push('open: jammed is only ever true');
  if (ev.type === 'attack' && !(ev.damage >= 1 && ev.damage <= 3)) out.push(`attack: damage ${ev.damage}`);
  return out;
}

// --- 1. a new event type must be written down here ---------------------------------------------------------
console.log('every public event the engine can emit is listed');
{
  const typesInCode = new Set();
  const callers = [];
  const walk = dir => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${f.name}`;
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        for (const m of code.matchAll(/emitPublic\(\s*\w+\s*,\s*\{\s*type:\s*'(\w+)'/g)) typesInCode.add(m[1]);
        // any emitPublic call whose first field is not a literal type could hide an unlisted one
        const calls = (code.match(/\bemitPublic\(/g) || []).length;
        const literal = (code.match(/emitPublic\(\s*\w+\s*,\s*\{\s*type:\s*'\w+'/g) || []).length;
        const defs = (code.match(/export function emitPublic\(/g) || []).length;
        if (calls - defs - literal > 0) callers.push(p);
      }
    }
  };
  walk(new URL('../src', import.meta.url).pathname);
  const listed = Object.keys(SHAPES).sort().join();
  check([...typesInCode].sort().join() === listed, `the types in src/ (${[...typesInCode].sort().join(', ')}) are exactly the ${Object.keys(SHAPES).length} listed here`);
  check(callers.length === 0, `every emitPublic() call in src/ names its type as a plain word, so this scan sees it${callers.length ? ': ' + callers.join(', ') : ''}`);
  const stateSrc = fs.readFileSync(new URL('../src/game/state.js', import.meta.url), 'utf8').replace(/\n\/\/\s*/g, ' ');
  const commentLine = stateSrc.match(/PUBLIC\s+state\.events — what the whole table sees: ([^.]*)\./)?.[1] || '';
  const inComment = commentLine.replace(/\s+/g, ' ').split(',').map(s => s.trim()).filter(Boolean).sort().join();
  check(inComment === listed, 'the comment above emitPublic in src/game/state.js names the same types');
}

// --- 2. the check catches a leak (a control) -----------------------------------------------------------------
console.log('\nthe check itself');
{
  const base = { seq: 5, round: 2, turn: 9 };
  S.createState(floor, roster.slice(0, 6), 1, { mode: 'match' });     // a hotel to take a room id from
  const room = [...floor.rooms.keys()][0];
  const good = [
    { ...base, type: 'search', seat: 1, room },
    { ...base, type: 'trade', a: 0, b: 3 },
    { ...base, type: 'attack', by: 0, target: 2, weapon: 'knife', damage: 1, killed: false, room },
    { ...base, type: 'open', seat: 0, room, door: 'a-b', jammed: true },
    { ...base, type: 'switchboard', by: 4, count: 1 },
  ];
  check(good.every(e => problems(e, 6).length === 0), 'real-looking events pass');
  const leaks = [
    ['the searcher\'s hand size on a search (the slip an earlier version had)', { ...good[0], handSize: 5 }],
    ['what was given in a trade', { ...good[1], gave: 'lantern' }],
    ['a role on an attack', { ...good[2], possessed: true }],
    ['the cards of a mirror', { ...base, type: 'mirror', by: 1, target: 2, hand: ['lantern'] }],
    ['a card found by a search', { ...good[0], found: 'knife' }],
    ['a list of cards in a value', { ...base, type: 'noTrade', a: 0, b: [1, 2] }],
    ['an object in a value', { ...good[0], seat: { role: 'possessed' } }],
    ['a Possession card named as the weapon', { ...good[2], weapon: 'possession' }],
    ['a missing key', { ...base, type: 'trade', a: 0 }],
    ['a seat that is not at the table', { ...good[1], b: 9 }],
    ['a made-up event type', { ...base, type: 'whisper', seat: 1 }],
    ['a switchboard that names who', { ...good[4], who: 2 }],
  ];
  for (const [what, ev] of leaks) check(problems(ev, 6).length > 0, `caught: ${what}`);
}

// --- 3. a few hundred matches ---------------------------------------------------------------------------------
console.log('\nevery public event of seeded all-bot matches');
{
  const N = 100;                                   // matches per table size
  const seen = {}, forms = {};
  let events = 0, bad = [], matches = 0, unfinished = 0, notIncreasing = 0;
  for (const players of [4, 5, 6]) {
    for (let k = 0; k < N; k++) {
      const seed = 31000 + players * 1000 + k;
      applyMode('match', players);
      const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'match' });
      const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
      const profiles = rollProfiles(players, rng);
      state.players.forEach((p, i) => { p.name = profiles[i].username; });
      const table = createBotTable(state, floor, profiles.map((profile, index) => ({ index, profile })), seed);
      const r = playOut(state, floor, table, { maxTurns: 400 });
      matches++; if (!r.finished) unfinished++;
      let lastSeq = 0;
      for (const ev of state.events) {
        events++;
        seen[ev.type] = (seen[ev.type] || 0) + 1;
        if (ev.type === 'open') forms[ev.jammed ? 'open (jammed)' : 'open (revealed)'] = (forms[ev.jammed ? 'open (jammed)' : 'open (revealed)'] || 0) + 1;
        if (ev.type === 'unlock') forms[ev.opened ? 'unlock (opened)' : 'unlock (failed)'] = (forms[ev.opened ? 'unlock (opened)' : 'unlock (failed)'] || 0) + 1;
        if (ev.seq <= lastSeq) notIncreasing++;
        lastSeq = ev.seq;
        const p = problems(ev, players);
        if (p.length && bad.length < 8) bad.push(`seed ${seed}: ${p.join('; ')}`);
      }
    }
  }
  check(bad.length === 0, `${events} public events in ${matches} matches: every one has only its documented keys and values${bad.length ? '\n         ' + bad.join('\n         ') : ''}`);
  check(unfinished === 0, `every match finished (so the events run to the end of a match)`);
  check(notIncreasing === 0, 'the events come in order (seq only goes up)');
  const counts = Object.keys(SHAPES).map(t => `${t} ${seen[t] || 0}`).join(', ');
  console.log('         ' + counts);
  console.log('         ' + Object.entries(forms).map(([k, v]) => `${k} ${v}`).join(', '));
  // A meeting where nobody can trade ("noTrade") is rare in bot matches (about one in several hundred, and how often depends on
  // how the computer guests happen to play), so it is provoked by hand once: a guest with no card meets another, the trade is
  // skipped, and its public event is held to its shape like every other.
  {
    applyMode('match', 4);
    const state = S.createState(floor, roster.slice(0, 4), 4242, { mode: 'match' });
    const [P, Q] = state.players;
    P.hand = [];
    const r = A.skipTrade(state, floor, P, Q);
    const ev = state.events.find(e => e.type === 'noTrade');
    check(r.ok && ev, 'a meeting where a guest has no card to give is skipped, with one public event (provoked by hand)');
    if (ev) {
      const p = problems(ev, 4);
      check(p.length === 0, `...and it has only its documented keys and values${p.length ? ': ' + p.join('; ') : ''}`);
      forms['noTrade (provoked)'] = 1;
    }
  }
  const missing = Object.keys(SHAPES).filter(t => !seen[t] && t !== 'noTrade');
  check(missing.length === 0, `all the other ${Object.keys(SHAPES).length - 1} event types were met in those matches${missing.length ? ' (never seen: ' + missing.join(', ') + ')' : ''}`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
