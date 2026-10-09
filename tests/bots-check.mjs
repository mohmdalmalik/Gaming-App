// Checks for the computer guests (src/bots/) — fast (well under a minute), no browser.
//   node tests/bots-check.mjs
//
//   1. purity: src/bots/* use no DOM, no THREE, no Node APIs, no Math.random, never the engine's random generator
//   2. the engine additions: structured public events and private inboxes; the forced starting role
//      (state.setup.possessedIndex) leaves the hotel, the deck and the hands exactly as a random deal would
//   3. INFORMATION HONESTY: a bot's view — and every choice it makes — is identical when everything the
//      guest could not know (other guests' hands, roles, private notes and events, the draw pile, the room
//      deck's order) is scrambled
//   4. hundreds of seeded all-bot matches at 4, 5 and 6 players: no crash, no refused-action loop, every
//      match ends
//   5. determinism: the same seed plays the same match
//   6. behaviour: possessed bots make friendly trades before trying a Possession card on the same guest; clean
//      bots block with a Lantern; bots escape; the possessed side wins sometimes; possessions are not all in
//      round 1; profiles and thinking pauses look right
import fs from 'node:fs';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, makeCard } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { botView } from '../src/bots/view.js';
import { createMind } from '../src/bots/brain.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles, rollProfile, USERNAMES } from '../src/bots/profiles.js';
import { playBotTurn, playOut } from '../src/bots/autoplay.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);

function newMatch(seed, players, opts = {}) {
  applyMode('hotseat', players);
  const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'hotseat' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const seats = (opts.seats ?? profiles.map((_, i) => i)).map(index => ({ index, profile: profiles[index] }));
  const table = createBotTable(state, floor, seats, seed);
  return { state, table, profiles };
}

// --- 1. purity ---------------------------------------------------------------------------------------
console.log('purity of src/bots/');
for (const f of fs.readdirSync(new URL('../src/bots/', import.meta.url))) {
  const src = fs.readFileSync(new URL(`../src/bots/${f}`, import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const bad = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /require\(/, /Math\.random/, /state\.rng/, /\bprocess\./]
    .filter(re => re.test(code));
  check(!bad.length, `${f}: no DOM, THREE, Node API, Math.random or engine random generator${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}
{
  const brain = fs.readFileSync(new URL('../src/bots/brain.js', import.meta.url), 'utf8');
  const imports = [...brain.matchAll(/^import .* from ['"](.*)['"];?$/gm)].map(m => m[1]);
  check(imports.length === 1 && imports[0] === '../game/cards.js', `brain.js imports only makeRng from cards.js (it reads the view, never the state): ${imports.join(', ')}`);
}

// --- 2. engine additions ---------------------------------------------------------------------------------
console.log('\nengine: events, inboxes, forced role');
{
  const { state } = newMatch(77, 6);
  check(Array.isArray(state.events) && state.events[0]?.type === 'turn' && state.events[0].seat === 0, 'resetState starts the public event list with turn 1');
  check(state.players.every(p => Array.isArray(p.inbox) && p.inbox.length === 0), 'every guest has an empty private inbox');
  const p = state.players[0];
  const door = S.openableDoors(state, floor, p)[0];
  A.openDoor(state, floor, p, door.id);
  const ev = state.events.at(-1);
  check(ev.type === 'open' && ev.seat === 0 && ev.door === door.id && ev.seq === state.events.at(-2).seq + 1 && ev.round === 1, 'opening a door is a public event with seq, round and turn');
  const into = ev.revealed;
  S.enterRoom(state, floor, p, into);
  check(state.events.at(-1).type === 'enter' && state.events.at(-1).from === floor.start.room && state.events.at(-1).to === into, 'walking into a room is a public event');
  // a trade between a possessed and a clean guest in that room
  const P = state.players.find(q => q.possessed), Q = state.players.find(q => !q.possessed && q !== P);
  P.currentRoom = into; Q.currentRoom = into;
  const poss = P.hand.find(c => c.type === 'possession');
  const plain = Q.hand.find(c => c.type !== 'lantern');
  const r = A.resolveTrade(state, floor, P, Q, poss.id, plain.id);
  check(r.ok && r.possessed.length === 1, '(a Possession card passed)');
  check(state.events.at(-1).type === 'trade' && state.events.at(-1).a === P.index && state.events.at(-1).b === Q.index, 'a trade is public: who traded, nothing else');
  const pt = P.inbox.find(e => e.type === 'traded'), qt = Q.inbox.find(e => e.type === 'traded');
  check(pt?.gave === 'possession' && pt.got === plain.type && qt?.got === 'possession', 'each side privately learns what it gave and got');
  check(Q.inbox.some(e => e.type === 'possessed' && e.by === P.index) && P.inbox.some(e => e.type === 'converted' && e.who === Q.index), 'the conversion is private to the two of them');
  check(!state.events.some(e => /possess|lantern|card|hand|gave|got/i.test(JSON.stringify(Object.keys(e)))), 'no public event carries a card, a hand or a role');
  // a block
  const R = state.players.find(q => !q.possessed && q !== Q && q !== P);
  R.currentRoom = into;
  const lan = R.hand.find(c => c.type === 'lantern');
  const qPoss = Q.hand.find(c => c.type === 'possession');
  A.resolveTrade(state, floor, Q, R, qPoss.id, lan.id);
  check(R.inbox.some(e => e.type === 'blockedThem' && e.who === Q.index) && Q.inbox.some(e => e.type === 'blocked' && e.by === R.index), 'a Lantern block is private to the two of them');
  check(R.inbox.find(e => e.type === 'traded').got === null, '(the blocker received nothing: the card burned)');
}
{
  const seed = 4242;
  applyMode('hotseat', 6);
  const a = S.createState(floor, roster.slice(0, 6), seed, { mode: 'hotseat' });
  const deckA = floor.deck.map(t => t.id).join(), drawA = a.drawPile.map(c => c.type).join();
  const handsA = a.players.map(p => p.hand.filter(c => c.type !== 'possession').map(c => c.type).join());
  const randomSeat = a.players.findIndex(p => p.possessed);
  const forced = (randomSeat + 2) % 6;
  const b = { roster: roster.slice(0, 6), mode: 'hotseat', practice: false, hotseat: true, setup: { possessedIndex: forced } };
  S.resetState(b, floor, seed);
  check(b.players[forced].possessed && b.players.filter(p => p.possessed).length === 1, 'state.setup.possessedIndex forces the possessed seat');
  check(b.players[forced].hand.filter(c => c.type === 'possession').length === rules.possessionSupply, `...with the ${rules.possessionSupply} Possession cards`);
  check(floor.deck.map(t => t.id).join() === deckA && b.drawPile.map(c => c.type).join() === drawA
    && b.players.every((p, i) => p.hand.filter(c => c.type !== 'possession').map(c => c.type).join() === handsA[i]),
  'the hotel, the deck and every hand are exactly as without forcing (the random pick is still drawn)');
  check(a.rng() === b.rng(), "the engine's random sequence continues the same");
}

// --- 3. information honesty -----------------------------------------------------------------------------
console.log('\ninformation honesty');
const TYPES = Object.keys(rules.deck);
function scramble(state, keepSeat, rng) {
  // Everything the guest at `keepSeat` could not know, replaced at random.
  for (const p of state.players) {
    if (p.index === keepSeat) continue;
    const n = 1 + Math.floor(rng() * 7);
    p.hand = Array.from({ length: n }, () => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
    if (rng() < 0.5) p.hand.push(makeCard('possession'));
    p.possessed = rng() < 0.5;
    p.knows = new Set(rng() < 0.5 ? [state.players[keepSeat].id] : []);
    p.notes = ['scrambled'];
    p.inbox = [{ seq: 999999, type: 'possessed', by: keepSeat }];
    p.convertedBy = 'x';
    p.roleChangePending = rng() < 0.5;
  }
  state.drawPile = state.drawPile.map(() => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
  state.discardPile = state.discardPile.map(() => makeCard('lantern'));
  for (let i = floor.deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [floor.deck[i], floor.deck[j]] = [floor.deck[j], floor.deck[i]]; }
}
function snapshot(state) {
  return {
    players: state.players.map(p => ({ hand: p.hand, possessed: p.possessed, knows: p.knows, notes: p.notes, inbox: p.inbox, convertedBy: p.convertedBy, roleChangePending: p.roleChangePending })),
    drawPile: state.drawPile, discardPile: state.discardPile, deck: [...floor.deck],
  };
}
function restore(state, snap) {
  state.players.forEach((p, i) => Object.assign(p, snap.players[i]));
  state.drawPile = snap.drawPile; state.discardPile = snap.discardPile;
  floor.deck.length = 0; floor.deck.push(...snap.deck);
}
// What a FRESH mind with this seed chooses, having read everything this seat may know up to now.
function choices(state, seat, profile) {
  const mind = createMind(seat, profile, 991);
  const view = botView(state, floor, seat, mind.cursor);
  mind.observe(view);
  const other = (seat + 1) % state.players.length;
  const allowed = A.tradeableCards(state.players[seat]).map(c => c.id);
  const isActive = state.activeIndex === seat;
  return JSON.stringify({
    act: isActive ? mind.nextAction(view) : null,
    give: allowed.length ? mind.tradeCard(view, other, allowed) : null,
    attack: mind.attackWith(view, other),
    meet: mind.meetWhom(view, state.players.map(p => p.index).filter(i => i !== seat)),
    accept: mind.acceptTrade(view, other),
    discard: allowed.length ? mind.discard(view, allowed.filter(id => state.players[seat].hand.find(c => c.id === id)?.type !== 'possession')) : null,
    mem: { known: [...mind.mem.known], allies: [...mind.mem.allies], knowsMe: [...mind.mem.knowsMe], susp: [...mind.mem.susp], trust: [...mind.mem.trust] },
  });
}
{
  let views = 0, viewSame = 0, decisions = 0, decisionSame = 0, possessedViews = 0;
  const rng = makeRng(31337);
  for (let k = 0; k < 24; k++) {
    const players = 4 + (k % 3);
    const { state, table, profiles } = newMatch(5000 + k, players);
    const stopAt = 6 + (k * 5) % 24;          // somewhere in rounds 2..6
    for (let t = 0; t < stopAt && !state.finished; t++) playBotTurn(state, floor, table);
    if (state.finished) continue;
    for (const p of state.players) {
      if (!p.alive) continue;
      const seat = p.index;
      const before = JSON.stringify(botView(state, floor, seat));
      const decBefore = choices(state, seat, profiles[seat]);
      const snap = snapshot(state);
      scramble(state, seat, rng);
      const after = JSON.stringify(botView(state, floor, seat));
      const decAfter = choices(state, seat, profiles[seat]);
      restore(state, snap);
      views++; if (before === after) viewSame++;
      decisions++; if (decBefore === decAfter) decisionSame++;
      if (p.possessed) possessedViews++;
    }
  }
  check(views > 80 && viewSame === views, `a bot's view never changes when hidden information is scrambled (${viewSame}/${views} views, ${possessedViews} of them possessed guests)`);
  check(decisionSame === decisions, `nor does any choice it makes or anything it concludes (${decisionSame}/${decisions})`);
  const v = botView(newMatch(1, 6).state, floor, 2);
  const keys = JSON.stringify(v.players[0]);
  check(!/hand|possess|name|"id"|knows|notes|inbox/.test(keys), `other guests are seen only as seat, room, health, alive, escaped: ${keys}`);
  check(!('deck' in v) && !('drawPile' in v) && typeof v.roomTilesLeft === 'number', 'no draw pile, no room deck (only how many room tiles are left)');
}
{
  // The engine's random generator is never used by a bot's thinking.
  const { state, table } = newMatch(808, 6);
  for (let t = 0; t < 10; t++) playBotTurn(state, floor, table);
  const orig = state.rng; let calls = 0;
  state.rng = () => { calls++; return orig(); };
  for (const p of state.players) {
    const i = p.index;
    table.nextAction(i); table.meetWhom(i, [0, 1, 2]); table.attackWith(i, (i + 1) % 6); table.acceptTrade(i, (i + 1) % 6);
    const allowed = A.tradeableCards(p).map(c => c.id);
    if (allowed.length) table.tradeCard(i, (i + 1) % 6, allowed);
    table.thinkMs(i, 'trade');
  }
  state.rng = orig;
  check(calls === 0, "bots' thinking never draws from the engine's random generator");
}

// --- 4. many matches ---------------------------------------------------------------------------------------
console.log('\nall-bot matches');
const stats = { matches: 0, unfinished: 0, crashes: 0, refusals: 0, maxRefusalsTurn: 0, jammed: 0, cleanWins: 0, escapes: 0, possessedWins: 0,
  conv: [], firstFriendly: 0, friendlyThenAttempt: 0, blockDecisions: 0, blocks: 0, attacks: 0, voluntary: 0, byPlayers: {} };
for (let k = 0; k < 450; k++) {
  const players = 4 + (k % 3);
  const seed = 10000 + k * 37;
  stats.matches++;
  try {
    const { state, table } = newMatch(seed, players);
    let turns = 0;
    while (!state.finished && turns < 300) {
      const s = playBotTurn(state, floor, table, { maxSteps: 40 });
      turns++;
      const real = s.refusals.filter(r => r.reason !== 'jammed');
      stats.jammed += s.refusals.length - real.length;
      stats.refusals += real.length;
      stats.maxRefusalsTurn = Math.max(stats.maxRefusalsTurn, real.length);
      stats.voluntary += s.meetings.filter(m => m.voluntary).length;
    }
    if (!state.finished) { stats.unfinished++; continue; }
    const b = (stats.byPlayers[players] ||= { n: 0, clean: 0 });
    b.n++;
    if (state.won === 'humans') { stats.cleanWins++; b.clean++; } else stats.possessedWins++;
    if (state.escaped.size) stats.escapes++;
    for (const p of state.players) for (const e of p.inbox) {
      if (e.type === 'possessed') stats.conv.push(e.round);
      if (e.type === 'blockedThem') stats.blocks++;
    }
    stats.attacks += state.events.filter(e => e.type === 'attack').length;
    for (const p of state.players) {
      const seen = new Map();
      for (const d of table.decisions(p.index)) {
        if (d.k !== 'give') continue;
        if (!d.possessed && d.intent === 'block') stats.blockDecisions++;
        if (!d.possessed || d.intent === 'ally') continue;
        if (!seen.has(d.with)) { seen.set(d.with, d.intent); if (d.intent === 'friendly' && d.possCards > 0) stats.firstFriendly++; }
        else if (seen.get(d.with) === 'friendly' && d.intent === 'attempt') { stats.friendlyThenAttempt++; seen.set(d.with, 'done'); }
      }
    }
  } catch (err) {
    stats.crashes++;
    if (stats.crashes <= 3) console.log(`  crash in match ${seed} (${players} players):`, err.stack);
  }
}
check(stats.crashes === 0, `no crash in ${stats.matches} matches`);
check(stats.unfinished === 0, 'every match ends (an escape, everyone possessed or dead, or dawn)');
check(stats.maxRefusalsTurn <= 2 && stats.refusals <= stats.matches * 0.05, `no refused-action loops: ${stats.refusals} refused actions in all, at most ${stats.maxRefusalsTurn} in one turn (doors that turned out jammed, tried once each: ${stats.jammed})`);
const n = stats.matches - stats.crashes - stats.unfinished;
check(stats.escapes > n * 0.2, `bots escape: ${stats.escapes} of ${n} matches`);
check(stats.possessedWins > n * 0.2, `the possessed side wins too: ${stats.possessedWins} of ${n}`);
for (const [pl, b] of Object.entries(stats.byPlayers)) console.log(`         (${pl} players: clean side ${(100 * b.clean / b.n).toFixed(0)}% of ${b.n})`);
const r1 = stats.conv.filter(r => r === 1).length;
check(stats.conv.length > n * 0.5 && r1 < stats.conv.length * 0.4, `possessions happen, and not all in round 1 (${r1} of ${stats.conv.length} in round 1)`);
check(stats.firstFriendly > n * 0.3 && stats.friendlyThenAttempt > n * 0.15, `possessed bots build trust first: ${stats.firstFriendly} friendly first trades, ${stats.friendlyThenAttempt} later followed by an attempt on the same guest`);
check(stats.blockDecisions > n && stats.blocks > n * 0.3, `clean bots block with a Lantern: ${stats.blockDecisions} Lanterns handed over to block, ${stats.blocks} attempts actually blocked`);
check(stats.attacks > 0, `bots attack now and then (${stats.attacks} attacks in ${n} matches)`);

// --- 5. determinism -----------------------------------------------------------------------------------------
console.log('\ndeterminism');
{
  const run = (seed, players) => {
    const { state, table } = newMatch(seed, players);
    playOut(state, floor, table, { maxTurns: 300 });
    return JSON.stringify({ won: state.won, round: state.round, events: state.events, inbox: state.players.map(p => p.inbox) });
  };
  let same = 0;
  for (const [seed, pl] of [[123, 6], [456, 5], [789, 4], [2024, 6]]) if (run(seed, pl) === run(seed, pl)) same++;
  check(same === 4, 'the same seed plays the same match, event for event (4 of 4)');
  const a = run(321, 6), b = run(322, 6);
  check(a !== b, 'a different seed plays a different match');
}
{
  // playOut fills in a seat that has no bot (the interface hands over a match the person has left).
  const { state, table } = newMatch(99, 5, { seats: [0, 1, 2, 3] });
  check(!table.has(4), '(seat 4 starts without a bot)');
  const r = playOut(state, floor, table, { maxTurns: 300 });
  check(r.finished && table.has(4), 'playOut finishes the match, adding a bot for the empty seat');
}

// --- 6. profiles and pace ---------------------------------------------------------------------------------
console.log('\nprofiles and pace');
{
  const rng = makeRng(5);
  let dupes = 0, styles = {}, badTraits = 0, badPace = 0;
  for (let k = 0; k < 300; k++) {
    const ps = rollProfiles(6, rng);
    if (new Set(ps.map(p => p.username)).size !== 6) dupes++;
    for (const p of ps) {
      styles[p.style] = (styles[p.style] || 0) + 1;
      if (Object.values(p.traits).some(v => !(v >= 0 && v <= 1))) badTraits++;
      if (!(p.pace >= 0.7 && p.pace <= 1.4)) badPace++;
    }
  }
  check(USERNAMES.length >= 60 && new Set(USERNAMES).size === USERNAMES.length, `${USERNAMES.length} different usernames to draw from`);
  check(USERNAMES.every(u => /^[a-z0-9_]+$/.test(u)), 'usernames are online-style handles (lowercase, digits, underscores)');
  check(dupes === 0, 'no username twice in a match');
  const total = Object.values(styles).reduce((a, b) => a + b, 0);
  check(styles.medium / total > 0.5 && styles.bold / total > 0.1 && styles.careful / total > 0.1,
    `mostly medium, some bold, some careful: ${Object.entries(styles).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(', ')}`);
  check(badTraits === 0 && badPace === 0, 'every trait is between 0 and 1, every pace between 0.7 and 1.4');
  const { table } = newMatch(3, 6);
  const kinds = ['turn', 'act', 'move', 'meet', 'attack', 'trade', 'reply', 'discard'];
  let lo = Infinity, hi = 0; const per = {};
  for (const kind of kinds) {
    const xs = [];
    for (let k = 0; k < 400; k++) for (let i = 0; i < 6; i++) xs.push(table.thinkMs(i, kind));
    lo = Math.min(lo, ...xs); hi = Math.max(hi, ...xs);
    per[kind] = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  check(lo >= 240 && hi <= 3500, `thinking pauses ${lo}–${hi} ms (quicker than a person, an occasional longer "hmm")`);
  check(per.act < per.trade && per.move < per.meet, `typical pauses: ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ')} ms`);
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failures) { console.log(`\n${failures} BOT CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL BOT CHECKS PASSED');
