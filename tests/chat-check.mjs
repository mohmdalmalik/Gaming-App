// Checks for quick chat (src/data/chat.js, src/social/chat.js, src/bots/chatter.js) — fast, no browser.
//   node tests/chat-check.mjs
//
//   1. the lines: the nine phrases and six emotes, every id the bots may say exists, sane numbers
//   2. the channel: a message is { seat, id, at } and nothing else; the cooldown; unknown lines refused
//   3. INFORMATION HONESTY: what a bot says is identical when everything that guest could not know is
//      scrambled — and when its OWN role and private inbox are scrambled too (a possessed bot talks
//      exactly as a clean one would; nothing it learned in private shows)
//   4. chat never changes the game: the same seed plays the same match, event for event, with the bots
//      chatting or not; the same seed says the same lines
//   5. pacing and sense over many all-bot matches: the table never chatters faster than its gap, a bot
//      never faster than its own gap (except its death gasp and the end), "Thank you." only after its own
//      trade, "Watch out!" only after it was attacked, "Sorry!" only after it attacked, a greeting near the
//      start, "Good game!" at the end; nothing is said while the screen is held
//   6. answers to the player: a greeting gets at most two answers (often at least one); "Sorry!" after an
//      attack gets an answer only from the guest attacked; "Good game!" at the end gets an answer
import fs from 'node:fs';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, makeCard } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles } from '../src/bots/profiles.js';
import { playBotTurn } from '../src/bots/autoplay.js';
import { createChatter } from '../src/bots/chatter.js';
import { createChatChannel, isChatId } from '../src/social/chat.js';
import { CHAT, CHAT_PHRASES, CHAT_EMOTES, BOT_CHAT } from '../src/data/chat.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);

function newMatch(seed, players) {
  applyMode('hotseat', players);
  const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'hotseat' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const seats = profiles.map((profile, index) => ({ index, profile }));
  const table = createBotTable(state, floor, seats, seed);
  return { state, table, profiles, seats };
}

// --- 1. the lines ------------------------------------------------------------------------------------
console.log('the lines');
{
  const want = ['Good evening!', 'Shall we trade?', 'Need a Lantern?', 'I have a Lantern.', 'Trust me.', 'Watch out!', 'Thank you.', 'Sorry!', 'Good game!'];
  check(JSON.stringify(CHAT_PHRASES.map(p => p.text)) === JSON.stringify(want), `the nine phrases: ${CHAT_PHRASES.map(p => p.text).join(' · ')}`);
  check(JSON.stringify(CHAT_EMOTES.map(e => e.id)) === JSON.stringify(['wave', 'smile', 'laugh', 'gasp', 'suspicious', 'cross']), 'six emotes: wave, smile, laugh, gasp, suspicious, cross');
  const ids = [...CHAT_PHRASES, ...CHAT_EMOTES].map(x => x.id);
  check(new Set(ids).size === ids.length && ids.every(isChatId), 'every line has its own id');
  const said = Object.values(BOT_CHAT.moments).flatMap(m => m.say.map(([id]) => id));
  check(said.every(isChatId), 'every line a bot may say is one of them');
  check(!said.includes('needLantern'), '(bots never offer a Lantern: that would mostly come from a possessed bot, a tell)');
  check(CHAT.cooldownMs >= 2500 && CHAT.cooldownMs <= 4000 && CHAT.bubbleMs >= 3000 && CHAT.bubbleMs <= 4500, `cooldown ${CHAT.cooldownMs} ms, bubble ${CHAT.bubbleMs} ms`);
  check(BOT_CHAT.gapMs >= 18000 && BOT_CHAT.tableGapMs >= 3000, `a bot speaks at most every ${BOT_CHAT.gapMs / 1000} s, the table every ${BOT_CHAT.tableGapMs / 1000} s`);
  const src = fs.readFileSync(new URL('../src/bots/chatter.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const imports = [...code.matchAll(/^import .* from ['"](.*)['"];?$/gm)].map(m => m[1]).sort();
  check(JSON.stringify(imports) === JSON.stringify(['../data/chat.js', '../game/cards.js', './view.js']), `chatter.js reads the game only through the bot's view: ${imports.join(', ')}`);
  check(!/state\.|\.inbox\b(?!:)|\.possessed\b|\.notes\b/.test(code.replace(/botView\(state,/g, '')), 'chatter.js never touches the state, an inbox, a role or a note itself');
  const game = fs.readdirSync(new URL('../src/game/', import.meta.url)).map(f => fs.readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')).join('\n');
  check(!/chat/i.test(game), 'nothing in src/game/ knows about chat (a social layer, not a rule)');
}

// --- 2. the channel ----------------------------------------------------------------------------------
console.log('\nthe channel');
{
  let clock = 1000;
  const ch = createChatChannel({ now: () => clock });
  const got = [];
  ch.onMessage(m => got.push(m));
  const m = ch.say(2, 'greet');
  check(m && JSON.stringify(Object.keys(m).sort()) === '["at","id","seat"]' && m.seat === 2 && m.id === 'greet' && m.at === 1000, 'a message is { seat, id, at } and nothing else');
  check(got.length === 1 && got[0] === m, 'it reaches every listener');
  clock += 1000;
  check(ch.say(2, 'sorry') === null && ch.waitFor(2) === CHAT.cooldownMs - 1000, `the same seat must wait (${ch.waitFor(2)} ms left)`);
  check(ch.say(3, 'sorry') !== null, 'another seat need not');
  clock += CHAT.cooldownMs;
  check(ch.say(2, 'sorry') !== null, 'after the cooldown it may speak again');
  check(ch.say(2, 'You are possessed') === null && ch.post({ seat: 1, id: 'lantern:3' }) === null, 'a line that is not one of the presets is refused');
  const p = ch.post({ seat: 4, id: 'wave', at: 5, hand: ['possession'], possessed: true });
  check(p && JSON.stringify(Object.keys(p).sort()) === '["at","id","seat"]', 'anything else riding along on a message is dropped');
}

// --- 3. information honesty --------------------------------------------------------------------------
console.log('\ninformation honesty');
const TYPES = Object.keys(rules.deck);
// Everything the guest at `keepSeat` could not know, replaced at random; with `own`, its own role and
// private inbox too (its hand stays: it may talk about its own cards).
function scramble(state, keepSeat, rng, own = false) {
  for (const p of state.players) {
    if (p.index === keepSeat) {
      if (own) { p.possessed = !p.possessed; p.inbox = [{ seq: 1, type: 'possessed', by: (keepSeat + 1) % state.players.length }]; p.notes = ['scrambled']; p.knows = new Set(); }
      continue;
    }
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
{
  // One bot at a time (its own chatter: nothing but its own view decides what it says), with a person at
  // the next seat who greets, apologises and says "Good game!".
  let lines = 0, runs = 0, same = 0, sameOwn = 0, possessedRuns = 0;
  const rng = makeRng(4141);
  for (let k = 0; k < 18; k++) {
    const players = 4 + (k % 3);
    const { state, table, profiles } = newMatch(7000 + k, players);
    const seat = k % players, person = (seat + 1) % players;
    const mk = () => createChatter(state, floor, [{ index: seat, profile: profiles[seat] }], 900 + k);
    const A = mk(), B = mk(), C = mk();
    const outA = [], outB = [], outC = [];
    let now = 0;
    const step = (hold = false) => {
      now += 600;
      outA.push(...A.tick(now, { hold }));
      let snap = snapshot(state); scramble(state, seat, rng); outB.push(...B.tick(now, { hold })); restore(state, snap);
      snap = snapshot(state); scramble(state, seat, rng, true); outC.push(...C.tick(now, { hold })); restore(state, snap);
    };
    const hear = id => {
      const msg = { seat: person, id, at: now };
      A.hear(msg, now);
      let snap = snapshot(state); scramble(state, seat, rng); B.hear(msg, now); restore(state, snap);
      snap = snapshot(state); scramble(state, seat, rng, true); C.hear(msg, now); restore(state, snap);
    };
    if (state.players[seat].possessed) possessedRuns++;
    for (let turn = 0; turn < 300 && !state.finished; turn++) {
      playBotTurn(state, floor, table);
      for (let t = 0; t < 10; t++) step(t === 3 && turn % 4 === 1);
      if (turn === 0) hear('greet');
      if (turn % 7 === 3) hear('sorry');
    }
    for (let t = 0; t < 12; t++) step();
    hear('gg');
    for (let t = 0; t < 12; t++) step();
    runs++;
    lines += outA.length;
    if (JSON.stringify(outA) === JSON.stringify(outB)) same++;
    if (JSON.stringify(outA) === JSON.stringify(outC)) sameOwn++;
  }
  check(lines > 40, `(${lines} lines said over ${runs} matches, ${possessedRuns} of them by a possessed bot)`);
  check(same === runs, `what a bot says never changes when what it could not know is scrambled (${same}/${runs} matches)`);
  check(sameOwn === runs, `nor when its own role and private inbox are scrambled: possessed or clean, it talks the same (${sameOwn}/${runs})`);
}

// --- 4. chat never changes the game ------------------------------------------------------------------
console.log('\nthe game is untouched');
function playMatch(seed, players, { chat = true, chatSeed = 77, holdEvery = 0 } = {}) {
  const { state, table, seats, profiles } = newMatch(seed, players);
  const chatter = chat ? createChatter(state, floor, seats, chatSeed) : null;
  const said = [];
  const eventTime = new Map();    // public event seq -> the time it was first there to see
  let now = 0, finishedAt = null, held = [];
  const tick = hold => {
    now += 500;
    for (const e of state.events) if (!eventTime.has(e.seq)) eventTime.set(e.seq, now);
    if (state.finished && finishedAt == null) finishedAt = now;
    const out = (chatter ? chatter.tick(now, { hold }) : [])
      .map(m => ({ ...m, lantern: state.players[m.seat].hand.some(c => c.type === 'lantern') }));   // (does it hold one?)
    if (hold) held.push(...out);
    said.push(...out);
  };
  for (let turn = 0; turn < 300 && !state.finished; turn++) {
    playBotTurn(state, floor, table);
    // about eight seconds a turn, a screen held over the game now and then
    for (let t = 0; t < 16; t++) tick(holdEvery > 0 && turn % holdEvery === 0 && t < 8);
  }
  for (let t = 0; t < 24; t++) tick(false);
  return { state, said, eventTime, finishedAt, held, profiles };
}
{
  let same = 0;
  for (const [seed, pl] of [[123, 6], [456, 5], [789, 4]]) {
    const a = playMatch(seed, pl, { chat: true }), b = playMatch(seed, pl, { chat: false });
    if (JSON.stringify(a.state.events) === JSON.stringify(b.state.events) && a.state.won === b.state.won) same++;
  }
  check(same === 3, 'the same seed plays the same match, event for event, with the bots chatting or not (3 of 3)');
  const x = playMatch(2024, 6), y = playMatch(2024, 6);
  check(x.said.length > 0 && JSON.stringify(x.said) === JSON.stringify(y.said), `the same seed says the same lines (${x.said.length} lines)`);
  const z = playMatch(2024, 6, { chatSeed: 78 });
  check(JSON.stringify(x.said) !== JSON.stringify(z.said), 'another chat seed says other lines');
}

// --- 5. pacing and sense -----------------------------------------------------------------------------
console.log('\npacing and sense');
{
  const stats = { matches: 0, lines: 0, greeted: 0, gg: 0, tableFast: 0, botFast: 0, thanksBad: 0, watchBad: 0, sorryBad: 0, held: 0, lateTalk: 0, ggMax: 0, lanternTrue: 0, lanternBluff: 0 };
  const STYLE = {};
  for (let k = 0; k < 60; k++) {
    const players = 4 + (k % 3);
    const { state, said, eventTime, finishedAt, held, profiles } = playMatch(9100 + k, players, { chatSeed: 300 + k, holdEvery: 5 });
    stats.matches++;
    stats.lines += said.length;
    stats.held += held.length;
    const ev = state.events.map(e => ({ ...e, t: eventTime.get(e.seq) }));
    const recent = (t, test) => ev.some(e => e.t != null && e.t <= t && t - e.t <= BOT_CHAT.staleMs + 6000 && test(e));
    if (said.some(m => (m.id === 'greet' || m.id === 'wave') && m.at < 15000)) stats.greeted++;
    if (said.some(m => m.id === 'gg')) stats.gg++;
    stats.ggMax = Math.max(stats.ggMax, said.filter(m => m.id === 'gg').length);
    for (let i = 1; i < said.length; i++) {
      const gap = said[i].at - said[i - 1].at;
      const end = finishedAt != null && said[i].at >= finishedAt;
      if (gap < (end ? BOT_CHAT.endGapMs : BOT_CHAT.tableGapMs)) stats.tableFast++;
    }
    for (let s = 0; s < players; s++) {
      const mine = said.filter(m => m.seat === s);
      STYLE[profiles[s].style] = STYLE[profiles[s].style] || { lines: 0, bots: 0 };
      STYLE[profiles[s].style].lines += mine.length; STYLE[profiles[s].style].bots++;
      for (let i = 1; i < mine.length; i++) {
        const free = mine[i].id === 'gasp' || (finishedAt != null && mine[i].at >= finishedAt);
        if (mine[i].at - mine[i - 1].at < BOT_CHAT.gapMs && !free) stats.botFast++;
      }
    }
    for (const m of said) {
      if (finishedAt != null && m.at > finishedAt + 30000) stats.lateTalk++;
      if (m.id === 'thanks' && !recent(m.at, e => e.type === 'trade' && (e.a === m.seat || e.b === m.seat))) stats.thanksBad++;
      if (m.id === 'watch' && !recent(m.at, e => e.type === 'attack' && e.target === m.seat)) stats.watchBad++;
      if (m.id === 'sorry' && !recent(m.at, e => e.type === 'attack' && e.by === m.seat)) stats.sorryBad++;
      if (m.id === 'haveLantern') stats[m.lantern ? 'lanternTrue' : 'lanternBluff']++;
    }
  }
  const per = Object.entries(STYLE).map(([s, v]) => `${s} ${(v.lines / v.bots).toFixed(1)}`).join(', ');
  console.log(`         (${stats.lines} lines in ${stats.matches} matches: about ${(stats.lines / stats.matches).toFixed(1)} a match; lines per bot: ${per})`);
  check(stats.tableFast === 0, `the table never speaks faster than once every ${BOT_CHAT.tableGapMs / 1000} s (at the end, ${BOT_CHAT.endGapMs / 1000} s)`);
  check(stats.botFast === 0, `a bot never speaks twice within ${BOT_CHAT.gapMs / 1000} s (except its gasp as it dies, and the end)`);
  check(stats.thanksBad === 0, '"Thank you." only after a trade it was part of');
  check(stats.watchBad === 0, '"Watch out!" only after it was attacked');
  check(stats.sorryBad === 0, '"Sorry!" only after it attacked someone');
  check(stats.held === 0, 'nothing is said while the screen is held');
  check(stats.lanternTrue > stats.lanternBluff && stats.lanternBluff > 0, `"I have a Lantern." is a claim, not proof: mostly true, now and then a bluff (${stats.lanternTrue} true, ${stats.lanternBluff} not)`);
  check(stats.greeted / stats.matches > 0.8, `a greeting near the start (${stats.greeted}/${stats.matches} matches)`);
  check(stats.gg / stats.matches > 0.8 && stats.ggMax <= BOT_CHAT.moments.end.max, `"Good game!" at the end (${stats.gg}/${stats.matches} matches, never more than ${stats.ggMax})`);
  check(stats.lateTalk === 0, 'the bots fall quiet after the end');
  check((STYLE.bold?.lines / STYLE.bold?.bots || 0) > (STYLE.careful?.lines / STYLE.careful?.bots || 0), 'bold guests talk more than careful ones');
}

// --- 6. answers to the player ------------------------------------------------------------------------
console.log('\nanswers to the player');
{
  let answered = 0, tooMany = 0, wrongKind = 0, runs = 0, sorryAnswered = 0, sorryWrong = 0, sorryRuns = 0, ggAnswered = 0, ggRuns = 0, twice = 0;
  for (let k = 0; k < 60; k++) {
    const players = 4 + (k % 3);
    const { state, table, profiles } = newMatch(12000 + k, players);
    const person = k % players;
    const seats = profiles.map((profile, index) => ({ index, profile })).filter(s => s.index !== person);
    const chatter = createChatter(state, floor, seats, 500 + k);
    let now = 0;
    const run = ms => { const out = []; for (let t = 0; t < ms / 250; t++) { now += 250; out.push(...chatter.tick(now)); } return out; };
    run(30000);                                   // the start's greetings come and go
    chatter.hear({ seat: person, id: 'greet', at: now }, now);
    const out = run(4000);
    runs++;
    if (out.length) answered++;
    if (out.length > BOT_CHAT.moments.answerGreet.max) tooMany++;
    if (out.some(m => !['greet', 'wave', 'smile'].includes(m.id))) wrongKind++;
    // the person attacks a bot (a public event), then says "Sorry!"
    const victim = seats[k % seats.length].index;
    const P = state.players[person];
    S.emitPublic(state, { type: 'attack', by: person, target: victim, weapon: 'knife', damage: 1, killed: false, room: P.currentRoom });
    run(5000);
    chatter.hear({ seat: person, id: 'sorry', at: now }, now);
    const back = run(4000);
    sorryRuns++;
    if (back.some(m => m.seat === victim && ['cross', 'smile'].includes(m.id))) sorryAnswered++;
    if (back.some(m => m.seat !== victim && ['cross', 'smile'].includes(m.id))) sorryWrong++;
    // the match ends: the bots say "Good game!", then the person does
    while (!state.finished) playBotTurn(state, floor, table);
    const ended = run(12000);
    chatter.hear({ seat: person, id: 'gg', at: now }, now);
    const gg = run(5000);
    ggRuns++;
    if (gg.some(m => m.id === 'gg' || m.id === 'smile')) ggAnswered++;
    const last = [...ended, ...gg];
    if (seats.some(s => last.filter(m => m.seat === s.index).length > 1)) twice++;
  }
  check(answered / runs > 0.5, `a greeting is often answered (${answered}/${runs})`);
  check(tooMany === 0 && wrongKind === 0, `by at most ${BOT_CHAT.moments.answerGreet.max} bots, with a greeting, a wave or a smile`);
  check(sorryAnswered / sorryRuns > 0.25 && sorryWrong === 0, `"Sorry!" is answered only by the guest attacked (${sorryAnswered}/${sorryRuns}; others ${sorryWrong})`);
  check(ggAnswered / ggRuns > 0.2, `"Good game!" at the end is answered now and then (${ggAnswered}/${ggRuns})`);
  check(twice === 0, 'at the end each bot has one last word at most (it does not answer "Good game!" after its own)');
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failures) { console.log(`\n${failures} CHAT CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHAT CHECKS PASSED');
