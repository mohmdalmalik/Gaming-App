// Checks for quick chat (src/data/chat.js, src/social/chat.js, src/bots/chatter.js, and the bots' listening
// in src/bots/brain.js) — fast, no browser.
//   node tests/chat-check.mjs
//
//   1. the lines: twenty phrases in two tabs of ten ("Table", "Suspicion") and six emotes; the six lines
//      that name a guest carry {name}; every id the bots may say exists; sane numbers; chatter.js reads
//      the game only through the bot's own view
//   2. the channel: a message is { seat, id, at } (+ `about` for a line that names a guest) and nothing
//      else; a missing, own-seat or out-of-range `about` is refused; `about` is dropped from other lines;
//      the cooldown
//   3. INFORMATION HONESTY with chat (128 matches): one bot, twice — one copy sees the truth, the other a world where
//      everything that guest could not know is scrambled each time it looks; both hear the same lines,
//      and what each says and every choice it makes must match (its own role is forced possessed in half
//      the runs); and being named gets the same answers from a possessed bot as from a clean one
//   4. talking without listening never changes the game: the same seed plays the same match, event for
//      event, with the bots talking (not listening) or silent
//   5. determinism: with talk and listen, the same seed plays the same match and says the same lines
//   6. sense and pacing over many all-bot matches on a clock: a clean bot's "<name> tried to possess me!"
//      only after its own Lantern burned that guest's soul, "<name> is possessed!" only after its own Hand
//      Mirror showed one; "I am possessed." only after the end, from a possessed guest; a line about a guest
//      never names the speaker, always a guest still in the hotel; the caps hold; "I trust <name>." only
//      for a guest who was kind or cleared (or, possessed, an ally); the table never chatters faster than
//      its gap, a bot never faster than its own (each line: its moment free or not), about six lines a
//      minute at most and never more than the gap allows in any 30 s; "Thank you." / "Watch out!" /
//      "Sorry!" only when they fit; greetings, "Good game!", quiet after
//   7. the player at the table: a greeting, "Sorry!" and "Good game!" get answers; a bot the player names
//      answers; the player's accusation raises the clean bots' estimate of that guest — more when they
//      believe the player — and a claim the table can see is impossible counts against the player instead
//   8. no role tells (200 six-guest matches): a line about a bot's own turn is said in that turn; no third
//      guest takes sides when someone is named; never "I trust <name>." after accusing them; every "tried to
//      possess me!", true or false, right after a trade between the two; who accuses first, about half and
//      half; the turn-start plans about as often a turn from either side. And talk never makes a Lantern
//      magnet: the same matches played with one clean seat saying "Good evening!", "I am possessed." or an
//      impossible accusation at round 2 — the liar is handed no more Lanterns (and the reason, exactly: what
//      was said never moves a clean bot's estimate for a Lantern block)
import fs from 'node:fs';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, makeCard } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles } from '../src/bots/profiles.js';
import { playBotTurn } from '../src/bots/autoplay.js';
import { createChatter } from '../src/bots/chatter.js';
import { createChatChannel, cleanMessage, isChatId, needsAbout } from '../src/social/chat.js';
import { CHAT, CHAT_TABS, CHAT_PHRASES, CHAT_EMOTES, ABOUT_IDS, BOT_CHAT, BOT_HEAR } from '../src/data/chat.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);
const M = BOT_CHAT.moments;

// A seeded table of bots (`possessedIndex`: the seat forced to start possessed, as the menu's role choice does).
function newMatch(seed, players, { possessedIndex = null, botSeats = null } = {}) {
  applyMode('match', players);
  const state = { roster: roster.slice(0, players), mode: 'match', practice: false };
  if (possessedIndex != null) state.setup = { possessedIndex };
  S.resetState(state, floor, seed);
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const seats = profiles.map((profile, index) => ({ index, profile }));
  const table = createBotTable(state, floor, seats, seed);
  const chatSeats = botSeats ? seats.filter(s => botSeats.includes(s.index)) : seats;
  return { state, table, profiles, seats, chatSeats };
}

// A whole all-bot match with the chat running on a clock, as tools/balance/bot-match.mjs runs it: each bot's
// thinking pause plus the time each action takes on screen, the chatter asked every 250 ms, every line
// heard by the bots (their minds and their chatter). `chat`: 'off' | 'talk' (talk, no listening) | 'on'.
// `holdEvery`: every so many turns the screen is held for the whole turn (a private screen).
const TICK = 250;
const ANIM = { move: 900, open: 800, search: 900, card: 900, job: 900, escape: 1500, trade: 900, end: 300 };
const MEET = { trade: 2600, attack: 2000, noTrade: 1200 };
// `inject`: { id, about: 'never' | null, round } — one clean seat (the one after the first possessed guest)
// says this line at the start of its first turn in that round, as a person might (the exploit checks;
// 'never': about a guest it has never traded with, a claim the table can see is impossible).
function play(seed, players, { chat = 'on', chatSeed = (seed * 7 + 1) >>> 0, holdEvery = 0, onSaid = null, inject = null } = {}) {
  const was = BOT_HEAR.on;
  BOT_HEAR.on = chat === 'on';
  try {
    const { state, table, seats, profiles } = newMatch(seed, players);
    const chatter = chat !== 'off' ? createChatter(state, floor, seats, chatSeed, BOT_CHAT, table) : null;
    const said = [], held = [], turns = [];
    const exploit = { seat: (state.players.findIndex(p => p.possessed) + 1) % players, said: false };
    const eventTime = new Map();      // event seq -> { t: when it was first there to see, held: the held time by then }
    let now = 0, lastTick = 0, finishedAt = null, holding = false, seen = 0, heldMs = 0;
    const advance = ms => {
      if (!chatter) return;
      const end = now + ms;
      for (let t = lastTick + TICK; t <= end; t += TICK) {
        lastTick = t; now = t;
        if (holding) heldMs += TICK;      // (a held screen stops the clocks of the lines waiting)
        for (; seen < state.events.length; seen++) eventTime.set(state.events[seen].seq, { t, held: heldMs });
        if (state.finished && finishedAt == null) finishedAt = t;
        for (const m of chatter.tick(t, { hold: holding })) {
          const P = state.players[m.seat], Q = m.about != null ? state.players[m.about] : null;
          const rec = { ...m, ev: state.eventSeq, heldAt: heldMs, round: state.round, finished: !!state.finished, speakerPossessed: P.possessed,
            active: state.activeIndex, turn: state.turn,
            lantern: P.hand.some(c => c.type === 'lantern'),
            aboutPossessed: Q ? Q.possessed : null, aboutIn: Q ? Q.alive && !state.escaped.has(Q.id) : null };
          said.push(rec);
          if (holding) held.push(rec);
          onSaid?.(rec, state, table);
          table.hear(m);
          chatter.hear(m, t);
        }
      }
      now = end;
    };
    const onStep = chatter ? (a, r, meets) => {
      let ms = table.thinkMs(S.activePlayer(state).index, a.k === 'move' ? 'move' : 'act') + (ANIM[a.k] || 1000);
      for (const mt of meets) ms += MEET[mt.kind] || 2000;
      advance(ms);
    } : null;
    let n = 0;
    while (!state.finished && n < 400) {
      holding = holdEvery > 0 && n % holdEvery === holdEvery - 1;
      const who = S.activePlayer(state);
      turns.push({ seat: who.index, possessed: who.possessed });
      if (inject && chatter && !exploit.said && who.index === exploit.seat && state.round >= inject.round) {
        exploit.said = true;
        let about = null;
        if (inject.about === 'never') {
          const traded = new Set(state.events.filter(e => e.type === 'trade' && (e.a === who.index || e.b === who.index)).map(e => (e.a === who.index ? e.b : e.a)));
          about = state.players.find(p => p.index !== who.index && p.alive && !state.escaped.has(p.id) && !traded.has(p.index))?.index ?? null;
        }
        if (who.possessed || (inject.about && about == null)) exploit.said = 'skipped';
        else { const m = { seat: who.index, id: inject.id, at: now, ...(about != null ? { about } : {}) }; table.hear(m); chatter.hear(m, now); }
      }
      advance(chatter ? table.thinkMs(who.index, 'turn') : 0);
      playBotTurn(state, floor, table, { maxSteps: 40, onStep });
      advance(chatter ? 600 : 0);
      n++;
    }
    holding = false;
    advance(chatter ? 30000 : 0);
    if (finishedAt == null) finishedAt = now;
    if (exploit.said === true) {
      const X = state.players[exploit.seat];
      exploit.lanterns = X.inbox.filter(e => e.type === 'traded' && e.got === 'lantern').length;
      exploit.escaped = state.escaped.has(X.id);
    }
    return { state, table, profiles, said, held, eventTime, finishedAt, clockMs: now, turns, exploit };
  } finally { BOT_HEAR.on = was; }
}

// --- 1. the lines ------------------------------------------------------------------------------------
console.log('the lines');
{
  check(JSON.stringify(CHAT_TABS.map(t => t.label)) === '["Table","Suspicion"]', 'two tabs: Table, Suspicion');
  const tab = id => CHAT_PHRASES.filter(p => p.tab === id).map(p => p.text);
  check(CHAT_PHRASES.length === 20 && tab('table').length === 10 && tab('suspicion').length === 10, `twenty lines, ten in each tab (${tab('table').length} / ${tab('suspicion').length})`);
  const texts = CHAT_PHRASES.map(p => p.text);
  const owner = ['I am clean.', 'I am possessed.', '{name} tried to possess me!', 'I trust {name}.', "I don't trust {name}."];
  check(owner.every(t => texts.includes(t)), "the owner's five: I am clean. · I am possessed. · <name> tried to possess me! · I trust <name>. · I don't trust <name>.");
  const before = ['Good evening!', 'Shall we trade?', 'Need a Lantern?', 'I have a Lantern.', 'Trust me.', 'Watch out!', 'Thank you.', 'Sorry!', 'Good game!'];
  check(before.every(t => texts.includes(t)), 'the nine lines from before are all still there');
  const proposed = ['Who has a Lantern?', 'Meet me at the Fire Exit.', 'Ring the Switchboard!', '{name} is possessed!', '{name} is clean.', 'Stay away from {name}!'];
  check(proposed.every(t => texts.includes(t)), 'and the six new ones: Who has a Lantern? · Meet me at the Fire Exit. · Ring the Switchboard! · <name> is possessed! / is clean. · Stay away from <name>!');
  const about = CHAT_PHRASES.filter(p => p.about);
  check(about.length === 6 && about.every(p => p.text.split('{name}').length === 2 && (p.you == null || !p.you.includes('{name}')))
    && CHAT_PHRASES.filter(p => !p.about).every(p => !p.text.includes('{name}')) && about.every(p => ABOUT_IDS.has(p.id) && needsAbout(p.id)) && ABOUT_IDS.size === 6,
  `six lines name a guest, each with one {name} (${about.map(p => p.id).join(', ')})`);
  check(about.every(p => p.tab === 'suspicion'), 'they are all on the Suspicion tab');
  check(JSON.stringify(CHAT_EMOTES.map(e => e.id)) === JSON.stringify(['wave', 'smile', 'laugh', 'gasp', 'suspicious', 'cross']), 'six emotes: wave, smile, laugh, gasp, suspicious, cross');
  const ids = [...CHAT_PHRASES, ...CHAT_EMOTES].map(x => x.id);
  check(new Set(ids).size === ids.length && ids.every(isChatId), 'every line has its own id');
  const said = Object.values(M).flatMap(m => m.say.map(([id]) => id));
  check(said.every(isChatId), 'every line a bot may say is one of them');
  check(!said.includes('needLantern'), '(bots never offer a Lantern: that would mostly come from a possessed bot, a tell)');
  check(Object.values(BOT_HEAR.weight).length && Object.keys(BOT_HEAR.weight).every(isChatId), 'every line the bots weigh is one of them');
  check(BOT_HEAR.blockShare === 0 && BOT_HEAR.attackShare > 0 && BOT_HEAR.attackShare <= 1 && BOT_HEAR.cap <= 0.6 && BOT_HEAR.floor >= -0.3,
    `hearsay counts at most ${BOT_HEAR.cap} for one guest; none of it for a Lantern block (talk never makes a guest a Lantern magnet), ${BOT_HEAR.attackShare} for an attack`);
  check(CHAT.cooldownMs >= 2500 && CHAT.cooldownMs <= 4000 && CHAT.bubbleMs >= 3000 && CHAT.bubbleMs <= 4500 && CHAT.aboutBubbleMs >= CHAT.bubbleMs && CHAT.aboutBubbleMs <= 6000,
    `cooldown ${CHAT.cooldownMs} ms, bubble ${CHAT.bubbleMs} ms (a line about a guest ${CHAT.aboutBubbleMs} ms)`);
  check(BOT_CHAT.gapMs >= 18000 && BOT_CHAT.tableGapMs >= 3000, `a bot speaks at most every ${BOT_CHAT.gapMs / 1000} s (but for its free lines), the table every ${BOT_CHAT.tableGapMs / 1000} s`);
  const src = fs.readFileSync(new URL('../src/bots/chatter.js', import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const imports = [...code.matchAll(/^import .* from ['"](.*)['"];?$/gm)].map(m => m[1]).sort();
  check(JSON.stringify(imports) === JSON.stringify(['../data/chat.js', '../game/cards.js', './view.js']), `chatter.js reads the game only through the bot's own view: ${imports.join(', ')}`);
  const rest = code.replace(/botView\(state, floor,/g, '').replace(/function createChatter\(state,/, '');
  check(!/\bstate\b/.test(rest), 'chatter.js never touches the state itself (only through botView)');
  // (its own private results: view.inbox, the events read from it (e.hand: what its own Hand Mirror showed);
  // its own role and hand: view.me.*; b.possessed: its own role as it last looked)
  check(!/(?<!view|cursor)\.inbox\b/.test(code) && !/\.notes\b|\.knows\b/.test(code) && !/(?<!\bme|\bb)\.possessed\b/.test(code) && !/(?<!\bme|\be)\.hand\b/.test(code),
    'chatter.js reads only its OWN inbox, role and hand (view.inbox, view.me.*): never another guest\'s');
  const game = fs.readdirSync(new URL('../src/game/', import.meta.url)).map(f => fs.readFileSync(new URL(`../src/game/${f}`, import.meta.url), 'utf8')).join('\n');
  check(!/chat/i.test(game), 'nothing in src/game/ knows about chat (a social layer, not a rule)');
}

// --- 2. the channel ----------------------------------------------------------------------------------
console.log('\nthe channel');
{
  let clock = 1000;
  const ch = createChatChannel({ now: () => clock, seats: () => 6 });
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
  clock += CHAT.cooldownMs;
  check(ch.say(2, 'You are possessed') === null && ch.post({ seat: 1, id: 'lantern:3' }) === null, 'a line that is not one of the presets is refused');
  const a = ch.say(2, 'distrustX', 4);
  check(a && JSON.stringify(Object.keys(a).sort()) === '["about","at","id","seat"]' && a.about === 4, 'a line that names a guest is { seat, id, about, at }');
  clock += CHAT.cooldownMs;
  check(ch.say(2, 'distrustX') === null && ch.say(2, 'distrustX', 2) === null && ch.say(2, 'distrustX', 6) === null && ch.say(2, 'distrustX', -1) === null && ch.say(2, 'distrustX', 1.5) === null,
    'it is refused without a guest, naming the speaker, or naming a seat not at the table');
  check(ch.waitFor(2) === 0, '(a refused line costs no cooldown)');
  const g = ch.say(2, 'greet', 3);
  check(g && !('about' in g), 'a line that names nobody drops any `about`');
  const p = ch.post({ seat: 4, id: 'wave', at: 5, hand: ['possession'], possessed: true, about: 1 });
  check(p && JSON.stringify(Object.keys(p).sort()) === '["at","id","seat"]', 'anything else riding along on a message is dropped');
  const q = ch.post({ seat: 4, id: 'triedPossess', about: 0, role: 'possessed', at: 7 });
  check(q && JSON.stringify(Object.keys(q).sort()) === '["about","at","id","seat"]' && q.about === 0, '...from a line about a guest too');
  check(ch.post({ seat: 7, id: 'greet' }) === null && cleanMessage({ seat: 0, id: 'isClean', about: 0 }) === null && cleanMessage({ seat: 0, id: 'isClean', about: 3 }, 3) === null,
    'a speaker or a guest named outside the table is refused');
}

// --- 3. information honesty --------------------------------------------------------------------------
console.log('\ninformation honesty');
const TYPES = Object.keys(rules.deck);
// Everything the guest at `keep` could not know, replaced at random: the other guests' hands, roles,
// private notes and private results (made-up ones about `keep` too), the draw pile, the room deck's order.
// (Its own role, hand and private results stay: it may speak from them.)
function scramble(state, keep, rng) {
  for (const p of state.players) {
    if (p.index === keep) continue;
    const n = 1 + Math.floor(rng() * 7);
    p.hand = Array.from({ length: n }, () => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
    if (rng() < 0.5) p.hand.push(makeCard('possession', { owner: state.players[Math.floor(rng() * state.players.length)].id }));
    p.possessed = rng() < 0.5;
    p.knows = new Set(rng() < 0.5 ? [state.players[keep].id] : []);
    p.notes = ['scrambled'];
    p.inbox = [{ seq: 999999, type: 'possessed', by: keep }, { seq: 1000000, type: 'blockedThem', who: keep }, { seq: 1000001, type: 'blocked', by: keep },
      { seq: 1000002, type: 'mirrorSaw', target: keep, hand: ['possession'] }, { seq: 1000003, type: 'traded', with: keep, gave: 'lantern', got: 'lantern' }];
    p.convertedBy = 'x';
    p.roleChangePending = rng() < 0.5;
  }
  state.drawPile = state.drawPile.map(() => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
  state.discardPile = state.discardPile.map(() => makeCard('lantern'));
  for (let i = floor.deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [floor.deck[i], floor.deck[j]] = [floor.deck[j], floor.deck[i]]; }
}
const snapshot = state => ({
  players: state.players.map(p => ({ hand: p.hand, possessed: p.possessed, knows: p.knows, notes: p.notes, inbox: p.inbox, convertedBy: p.convertedBy, roleChangePending: p.roleChangePending })),
  drawPile: state.drawPile, discardPile: state.discardPile, deck: [...floor.deck],
});
function restore(state, snap) {
  state.players.forEach((p, i) => Object.assign(p, snap.players[i]));
  state.drawPile = snap.drawPile; state.discardPile = snap.discardPile;
  floor.deck.length = 0; floor.deck.push(...snap.deck);
}
{
  let runs = 0, same = 0, lines = 0, decSame = 0, decs = 0, possRuns = 0, about = 0;
  const rng = makeRng(4242);
  const T0 = Date.now();
  for (let k = 0; k < 128; k++) {
    const pl = 4 + (k % 3), seat = k % pl;
    const { state, table, profiles, seats } = newMatch(8000 + k, pl, { possessedIndex: k % 2 ? seat : (seat + 1) % pl });
    // the watched bot, twice: its own mind and chatter (A sees the truth, B a scrambled world each time it looks)
    const mk = () => { const t = createBotTable(state, floor, [{ index: seat, profile: profiles[seat] }], 31 + k); return { t, c: createChatter(state, floor, [{ index: seat, profile: profiles[seat] }], 900 + k, BOT_CHAT, t) }; };
    const Aw = mk(), Bw = mk();
    const others = createChatter(state, floor, seats.filter(s => s.index !== seat), 700 + k, BOT_CHAT, table);
    const outA = [], outB = [], dA = [], dB = [];
    let now = 0;
    const deliver = m => { table.hear(m); others.hear(m, now); for (const w of [Aw, Bw]) { w.t.hear(m); w.c.hear(m, now); } };
    const step = () => {
      now += 500;
      for (const m of others.tick(now)) deliver(m);
      const a = Aw.c.tick(now); outA.push(...a);
      const s0 = snapshot(state); scramble(state, seat, rng); const b = Bw.c.tick(now); outB.push(...b); restore(state, s0);
      for (const m of a) deliver(m);     // (the table hears what the true copy said)
    };
    // what each copy of the watched bot would choose now, having heard the table
    const other = (seat + 1) % pl;
    const choose = w => {
      const l = w.t.catchUp(seat);
      const allowed = A.tradeableCards(state.players[seat]).map(c => c.id);
      return JSON.stringify({ give: allowed.length ? l.mind.tradeCard(l.view, other, allowed) : null, accept: l.mind.acceptTrade(l.view, other),
        meet: l.mind.meetWhom(l.view, state.players.map(p => p.index).filter(i => i !== seat)), attack: l.mind.attackWith(l.view, other),
        hearsay: state.players.map(p => (p.index === seat ? 0 : l.mind.hearsay(l.mind.context(l.view), p.index))) });
    };
    if (state.players[seat].possessed) possRuns++;
    for (let t = 0; t < 300 && !state.finished; t++) {
      playBotTurn(state, floor, table);
      for (let i = 0; i < 16; i++) step();
      if (t % 5 === 2 && state.players[seat].alive) {
        dA.push(choose(Aw));
        const s0 = snapshot(state); scramble(state, seat, rng); dB.push(choose(Bw)); restore(state, s0);
      }
    }
    for (let i = 0; i < 40; i++) step();
    runs++; lines += outA.length; about += outA.filter(m => m.about != null).length;
    if (JSON.stringify(outA) === JSON.stringify(outB)) same++;
    decs += dA.length; decSame += dA.filter((x, i) => x === dB[i]).length;
  }
  check(lines > 300 && about > 100, `(${lines} lines said by the watched bots over ${runs} matches, ${about} of them about a guest; ${possRuns} watched bots started possessed; ${((Date.now() - T0) / 1000).toFixed(1)} s)`);
  check(same === runs, `what a bot says never changes when what it could not know is scrambled (${same}/${runs})`);
  check(decSame === decs && decs > 50, `nor any choice it makes, having heard the same lines at the table (${decSame}/${decs})`);
}
{
  // Named at the table ("Stay away from <it>!" / "I don't trust <it>."): the same answers, possessed or clean.
  const answers = { clean: { n: 0, yes: 0, lines: {} }, possessed: { n: 0, yes: 0, lines: {} } };
  for (let k = 0; k < 400; k++) {
    const pl = 4 + (k % 3), X = 1 + (k % (pl - 1)), person = 0;
    for (const role of ['clean', 'possessed']) {
      const { state, table, chatSeats } = newMatch(30000 + k, pl, { possessedIndex: role === 'possessed' ? X : (X + 1) % pl || (X + 2) % pl, botSeats: [...Array(pl).keys()].filter(i => i !== person) });
      if (state.players[X].possessed !== (role === 'possessed')) continue;
      const chatter = createChatter(state, floor, chatSeats, 400 + k, BOT_CHAT, table);
      let now = 0;
      const run = ms => { const out = []; for (let t = 0; t < ms / 250; t++) { now += 250; for (const m of chatter.tick(now)) { out.push(m); table.hear(m); chatter.hear(m, now); } } return out; };
      for (let t = 0; t < 3 + (k % 5) && !state.finished; t++) { playBotTurn(state, floor, table); run(4000); }
      if (state.finished || !state.players[X].alive || state.escaped.has(state.players[X].id)) continue;
      run(25000);                                             // (whatever it was about to say is said)
      const msg = { seat: person, id: k % 2 ? 'stayAway' : 'distrustX', about: X, at: now };
      table.hear(msg); chatter.hear(msg, now);
      const back = run(8000).filter(m => m.seat === X);
      const o = answers[role];
      o.n++;
      if (back.some(m => m.id === 'clean' || (m.id === 'distrustX' && m.about === person))) o.yes++;
      for (const m of back) o.lines[m.id] = (o.lines[m.id] || 0) + 1;
    }
  }
  const rate = o => o.yes / Math.max(1, o.n);
  const pc = x => `${(100 * x).toFixed(1)}%`;
  check(answers.clean.n >= 300 && answers.possessed.n >= 300 && Math.abs(rate(answers.clean) - rate(answers.possessed)) <= 0.05,
    `a bot named at the table answers as often possessed as clean: ${pc(rate(answers.possessed))} of ${answers.possessed.n} / ${pc(rate(answers.clean))} of ${answers.clean.n}`);
}

// --- 4 and 5. the game with and without talk ----------------------------------------------------------
console.log('\nthe game, with and without talk');
{
  let same = 0, det = 0, linesSame = 0, n = 0, total = 0;
  const key = st => JSON.stringify([st.events, st.players.map(p => p.inbox), st.won]);
  for (const [seed, pl] of [[123, 6], [456, 5], [789, 4], [2024, 6], [77, 5]]) {
    n++;
    const off = play(seed, pl, { chat: 'off' }), talk = play(seed, pl, { chat: 'talk' });
    if (key(off.state) === key(talk.state)) same++;
    const a = play(seed, pl), b = play(seed, pl);
    if (key(a.state) === key(b.state)) det++;
    if (a.said.length && JSON.stringify(a.said) === JSON.stringify(b.said)) linesSame++;
    total += talk.said.length;
  }
  check(same === n && total > 50, `talking without listening plays the same match, event for event (${same}/${n}; ${total} lines said)`);
  check(det === n && linesSame === n, `talk and listen: the same seed plays the same match and says the same lines (${det}/${n}, ${linesSame}/${n})`);
  const x = play(2024, 6), z = play(2024, 6, { chatSeed: 4242 });
  check(JSON.stringify(x.said) !== JSON.stringify(z.said), 'another chat seed says other lines');
}

// --- 6. sense and pacing -----------------------------------------------------------------------------
console.log('\nsense and pacing');
{
  const st = { matches: 0, lines: 0, minutes: 0, held: 0, greeted: 0, gg: 0, ggMax: 0, tableFast: 0, botFast: 0, late: 0, thanksBad: 0, watchBad: 0, sorryBad: 0, lanternTrue: 0, lanternBluff: 0,
    tried: 0, triedBad: 0, isPoss: 0, isPossBad: 0, confess: 0, confessBad: 0, aboutLines: 0, aboutBad: 0, accuseCap: 0, frameCap: 0, opinionCap: 0, trust: 0, trustBad: 0, byId: {},
    strongClean: 0, strongCleanTrue: 0, strongPoss: 0, burst: 0 };
  const STYLE = {};
  for (let k = 0; k < 90; k++) {
    const pl = 4 + (k % 3);
    // "I trust <name>.": whom it trusts, when it says it (its own mind, caught up then)
    const trustOk = [];
    const onSaid = (m, state, table) => {
      if (m.id !== 'trustX') return;
      const { mind } = table.catchUp(m.seat);
      const got = mind.mem.gotFrom.get(m.about) || { lantern: 0, useful: 0 };
      trustOk.push(m.speakerPossessed ? mind.mem.allies.has(m.about) || got.lantern > 0 || (mind.mem.friendly.get(m.about) || 0) >= 1
        : !mind.mem.known.has(m.about) && (got.lantern > 0 || got.useful > 0 || mind.mem.cleared.has(m.about) || (mind.mem.trust.get(m.about) || 0) >= 1));
    };
    const { state, said, held, eventTime, finishedAt, clockMs, profiles } = play(9100 + k * 13, pl, { holdEvery: 5, onSaid });
    st.matches++; st.lines += said.length; st.held += held.length; st.minutes += finishedAt / 60000;
    st.trust += trustOk.length; st.trustBad += trustOk.filter(x => !x).length;
    const ev = state.events.map(e => ({ ...e, t: eventTime.get(e.seq)?.t, held: eventTime.get(e.seq)?.held ?? 0 }));
    // (an event shortly before the line, not counting the time a held screen stood the clocks still)
    const recent = (m, test) => ev.some(e => e.t != null && e.t <= m.at && (m.at - e.t) - (m.heldAt - e.held) <= BOT_CHAT.staleMs + 3000 && test(e));
    if (said.some(m => (m.id === 'greet' || m.id === 'wave') && m.at < 15000)) st.greeted++;
    const ggs = said.filter(m => m.id === 'gg').length;
    if (ggs) st.gg++;
    st.ggMax = Math.max(st.ggMax, ggs);
    for (let i = 1; i < said.length; i++) {
      const end = said[i].at >= finishedAt;
      if (said[i].at - said[i - 1].at < (end ? BOT_CHAT.endGapMs : BOT_CHAT.tableGapMs)) st.tableFast++;
    }
    for (let i = 0, j = 0; i < said.length; i++) {       // (the most lines in any 30 s of play)
      if (said[i].at >= finishedAt) break;
      while (said[j].at <= said[i].at - 30000) j++;
      st.burst = Math.max(st.burst, i - j + 1);
    }
    const opinions = new Map(), strong = new Map(), frames = new Map();
    for (let s = 0; s < pl; s++) {
      const mine = said.filter(m => m.seat === s);
      (STYLE[profiles[s].style] ||= { lines: 0, bots: 0 }).bots++;
      STYLE[profiles[s].style].lines += mine.length;
      let last = -Infinity;
      // (each line says whether its moment was a free one: a reply, the start, the end, a death gasp, an
      // accusation, a denial; every other line keeps the bot's own gap)
      for (const m of mine) {
        if (!m.free && m.at < finishedAt && m.at - last < BOT_CHAT.gapMs) st.botFast++;
        last = m.at;
      }
    }
    for (const m of said) {
      st.byId[m.id] = (st.byId[m.id] || 0) + 1;
      const P = state.players[m.seat];
      const before = e => e.seq <= m.ev;
      if (m.at > finishedAt + 30000) st.late++;
      if (m.id === 'thanks' && !recent(m, e => e.type === 'trade' && (e.a === m.seat || e.b === m.seat))) st.thanksBad++;
      if (m.id === 'watch' && !recent(m, e => e.type === 'attack' && e.target === m.seat)) st.watchBad++;
      if (m.id === 'sorry' && !recent(m, e => e.type === 'attack' && e.by === m.seat)) st.sorryBad++;
      if (m.id === 'haveLantern') st[m.lantern ? 'lanternTrue' : 'lanternBluff']++;
      if (m.id === 'iAmPossessed') { st.confess++; if (!m.finished || !m.speakerPossessed) st.confessBad++; }
      if (m.about != null) {
        st.aboutLines++;
        if (m.about === m.seat || !(m.about >= 0 && m.about < pl) || (!m.finished && !m.aboutIn)) st.aboutBad++;
        if (['trustX', 'distrustX', 'stayAway'].includes(m.id)) { const key = `${m.seat}>${m.about}`; opinions.set(key, (opinions.get(key) || 0) + 1); }
      }
      if (m.id === 'triedPossess' || m.id === 'isPossessed') {
        strong.set(m.seat, (strong.get(m.seat) || 0) + 1);
        if (!m.speakerPossessed) {
          st.strongClean++; if (m.aboutPossessed) st.strongCleanTrue++;
          // a clean guest says it only from its own eyes: its Lantern burned that guest's soul / its Hand Mirror showed one
          if (m.id === 'triedPossess') { st.tried++; if (!P.inbox.some(e => before(e) && e.type === 'blockedThem' && e.who === m.about)) st.triedBad++; }
          else { st.isPoss++; if (!P.inbox.some(e => before(e) && e.type === 'mirrorSaw' && e.target === m.about && e.hand.includes('possession'))) st.isPossBad++; }
        } else {
          st.strongPoss++;
          // a possessed guest's lie about anyone but the guest who burned its soul is a frame
          if (!P.inbox.some(e => before(e) && e.type === 'blocked' && e.by === m.about)) frames.set(m.seat, (frames.get(m.seat) || 0) + 1);
        }
      }
    }
    if ([...strong.values()].some(n => n > BOT_CHAT.caps.accuse)) st.accuseCap++;
    if ([...frames.values()].some(n => n > BOT_CHAT.caps.frame)) st.frameCap++;
    if ([...opinions.values()].some(n => n > BOT_CHAT.caps.opinionPerGuest)) st.opinionCap++;
  }
  const per = Object.entries(STYLE).map(([s, v]) => `${s} ${(v.lines / v.bots).toFixed(1)}`).join(', ');
  const top = Object.entries(st.byId).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / st.matches).toFixed(1)}`).join(', ');
  console.log(`         (${st.lines} lines in ${st.matches} matches: ${(st.lines / st.matches).toFixed(1)} a match, ${(st.lines / st.minutes).toFixed(1)} a minute; per bot: ${per}; most said: ${top})`);
  check(st.tried > 20 && st.triedBad === 0, `a clean bot says "<name> tried to possess me!" only after its own Lantern burned that guest's soul (${st.tried} lines, ${st.triedBad} without)`);
  check(st.isPossBad === 0, `...and "<name> is possessed!" only after its own Hand Mirror showed a soul on them (${st.isPoss} lines, ${st.isPossBad} without)`);
  check(st.strongCleanTrue === st.strongClean && st.strongPoss > 10, `so a clean bot's accusations are always true (${st.strongCleanTrue}/${st.strongClean}); possessed bots lie (${st.strongPoss} accusations)`);
  check(st.confessBad === 0, `"I am possessed." only after the end, from a possessed guest (${st.confess} times, ${st.confessBad} otherwise)`);
  check(st.aboutLines > 100 && st.aboutBad === 0, `a line about a guest never names the speaker, always a guest at the table still in the hotel (${st.aboutLines} lines, ${st.aboutBad} not)`);
  check(st.accuseCap === 0 && st.frameCap === 0 && st.opinionCap === 0, `the caps hold: at most ${BOT_CHAT.caps.accuse} accusations and ${BOT_CHAT.caps.frame} false one a match, one opinion per guest`);
  check(st.trust > 10 && st.trustBad === 0, `"I trust <name>." only for a guest who handed it a Lantern or a useful card or was cleared (possessed: an ally, a Lantern given, or a guest it has made a friendly gift to) (${st.trust} lines, ${st.trustBad} not)`);
  check(st.tableFast === 0, `the table never speaks faster than once every ${BOT_CHAT.tableGapMs / 1000} s (at the end, ${BOT_CHAT.endGapMs / 1000} s)`);
  check(st.botFast === 0, `a bot never speaks twice within ${BOT_CHAT.gapMs / 1000} s, but for its free lines (an answer, an accusation, its gasp, the end)`);
  check(st.lines / st.minutes <= 6.5, `about six lines a minute at most (${(st.lines / st.minutes).toFixed(1)})`);
  const most = Math.floor(30000 / BOT_CHAT.tableGapMs) + 1;
  check(st.burst <= most, `never more than ${most} lines in any 30 s of play (${st.burst})`);
  check(st.thanksBad === 0, '"Thank you." only after a trade it was part of');
  check(st.watchBad === 0, '"Watch out!" only after it was attacked');
  check(st.sorryBad === 0, '"Sorry!" only after it attacked someone');
  check(st.held === 0, 'nothing is said while the screen is held');
  check(st.lanternTrue > st.lanternBluff && st.lanternBluff > 0, `"I have a Lantern." is a claim, not proof: mostly true, now and then a bluff (${st.lanternTrue} true, ${st.lanternBluff} not)`);
  check(st.greeted / st.matches > 0.8, `a greeting near the start (${st.greeted}/${st.matches} matches)`);
  check(st.gg / st.matches > 0.7 && st.ggMax <= M.end.max + M.answerGG.max, `"Good game!" at the end (${st.gg}/${st.matches} matches, never more than ${st.ggMax}: at most ${M.end.max} + ${M.answerGG.max} answers)`);
  check(st.late === 0, 'the bots fall quiet after the end');
  check((STYLE.bold?.lines / STYLE.bold?.bots || 0) > (STYLE.careful?.lines / STYLE.careful?.bots || 0), 'bold guests talk more than careful ones');
}

// --- 7. the player at the table ----------------------------------------------------------------------
console.log('\nthe player at the table');
{
  let answered = 0, tooMany = 0, wrongKind = 0, runs = 0, sorryAnswered = 0, sorryWrong = 0, ggAnswered = 0, twice = 0;
  let named = 0, namedAnswered = 0, namedWrong = 0;
  for (let k = 0; k < 60; k++) {
    const pl = 4 + (k % 3), person = k % pl;
    const { state, table, chatSeats } = newMatch(12000 + k, pl, { botSeats: [...Array(pl).keys()].filter(i => i !== person) });
    const chatter = createChatter(state, floor, chatSeats, 500 + k, BOT_CHAT, table);
    let now = 0;
    const run = ms => { const out = []; for (let t = 0; t < ms / 250; t++) { now += 250; for (const m of chatter.tick(now)) { out.push(m); table.hear(m); chatter.hear(m, now); } } return out; };
    const say = msg => { const m = { ...msg, seat: person, at: now }; table.hear(m); chatter.hear(m, now); };
    run(30000);                                   // the start's greetings come and go
    say({ id: 'greet' });
    const out = run(4000);
    runs++;
    if (out.length) answered++;
    if (out.length > M.answerGreet.max) tooMany++;
    if (out.some(m => !['greet', 'wave', 'smile'].includes(m.id))) wrongKind++;
    // the person names a bot: it answers ("I am clean." / "I don't trust <the person>.")
    for (let t = 0; t < 4 && !state.finished; t++) { playBotTurn(state, floor, table); run(3000); }
    run(25000);
    const X = chatSeats.map(s => s.index).find(i => state.players[i].alive && !state.escaped.has(state.players[i].id));
    if (X != null && !state.finished) {
      say({ id: 'stayAway', about: X });
      const back = run(6000).filter(m => m.seat === X);
      named++;
      if (back.length) namedAnswered++;
      if (back.some(m => !(m.id === 'clean' || (m.id === 'distrustX' && m.about === person)))) namedWrong++;
    }
    // the person attacks a bot (a public event), then says "Sorry!"
    const victim = chatSeats[k % chatSeats.length].index;
    S.emitPublic(state, { type: 'attack', by: person, target: victim, weapon: 'knife', damage: 1, killed: false, room: state.players[person].currentRoom });
    run(5000);
    say({ id: 'sorry' });
    const back = run(4000);
    if (back.some(m => m.seat === victim && ['cross', 'smile'].includes(m.id))) sorryAnswered++;
    if (back.some(m => m.seat !== victim && ['cross', 'smile'].includes(m.id))) sorryWrong++;
    // the match ends: the person says "Good game!" as the end screen comes up, while the bots say it too
    // (a "Good game!" is answered whoever says it: the person's, like a bot's, while some are still quiet)
    while (!state.finished) playBotTurn(state, floor, table);
    const ended = run(1500);
    say({ id: 'gg' });
    const gg = run(12000);
    if (gg.some(m => m.moment === 'answerGG' && (m.id === 'gg' || m.id === 'smile'))) ggAnswered++;
    const last = [...ended, ...gg];
    if (chatSeats.some(s => last.filter(m => m.seat === s.index).length > 1)) twice++;
  }
  check(answered / runs > 0.5, `a greeting is often answered (${answered}/${runs})`);
  check(tooMany === 0 && wrongKind === 0, `by at most ${M.answerGreet.max} bots, with a greeting, a wave or a smile`);
  check(namedAnswered / named > 0.5 && namedWrong === 0, `a bot the player names answers, "I am clean." or "I don't trust <you>." (${namedAnswered}/${named})`);
  check(sorryAnswered / runs > 0.25 && sorryWrong === 0, `"Sorry!" is answered only by the guest attacked (${sorryAnswered}/${runs}; others ${sorryWrong})`);
  check(ggAnswered / runs > 0.2, `"Good game!" at the end is answered now and then (${ggAnswered}/${runs})`);
  check(twice === 0, 'at the end each bot has one last word at most (it does not answer "Good game!" after its own)');
}
{
  // The player says "Stay away from <X>!" (a guest may always say that): a clean bot that hears it thinks X
  // more likely possessed; more when it believes the player. "<X> tried to possess me!" with no trade
  // between them is a claim the whole table can see is impossible: it counts against the player instead.
  let n = 0, up = 0, believedMore = 0, baseless = 0, baselessN = 0;
  for (let k = 0; k < 120; k++) {
    const pl = 5 + (k % 2), person = 0;
    const { state, table: play0, profiles } = newMatch(15000 + k, pl);
    for (let t = 0; t < 4 + (k % 6) && !state.finished; t++) playBotTurn(state, floor, play0);
    if (state.finished) continue;
    const L = [...Array(pl).keys()].find(i => i !== person && !state.players[i].possessed && state.players[i].alive);
    const X = [...Array(pl).keys()].find(i => i !== person && i !== L && state.players[i].alive && !state.escaped.has(state.players[i].id));
    if (L == null || X == null) continue;
    const listen = (prep, msg) => {
      const t = createBotTable(state, floor, [{ index: L, profile: profiles[L] }], 77 + k);
      const l0 = t.catchUp(L);
      prep(l0.mind);
      const c0 = l0.mind.context(l0.view), before = l0.mind.pPoss(c0, X), liar0 = l0.mind.mem.liar.get(person) || 0;
      t.hear({ ...msg, at: 0 });
      const l1 = t.catchUp(L), c1 = l1.mind.context(l1.view);
      return { d: l1.mind.pPoss(c1, X) - before, liar: (l1.mind.mem.liar.get(person) || 0) - liar0, known: l1.mind.mem.known.has(X), cleared: l1.mind.isCleared(X), speakerP: l1.mind.pPoss(c1, person, 0) };
    };
    const line = { seat: person, id: 'stayAway', about: X };
    const trusted = listen(m => { m.mem.trust.set(person, 2); }, line);
    const doubted = listen(m => { m.mem.susp.set(person, (m.mem.susp.get(person) || 0) + 0.45); }, line);
    // (a speaker the bot is all but sure is possessed is hardly believed, as it should be: little to compare; and a guest the
    // Switchboard's count proved clean stays at 4% whatever is said about them, so there is nothing for talk to move)
    if (trusted.known || trusted.cleared || trusted.speakerP > 0.7) continue;
    n++;
    if (trusted.d > 0.01) up++;
    if (trusted.d > doubted.d + 1e-9) believedMore++;
    if (!state.events.some(e => e.type === 'trade' && ((e.a === person && e.b === X) || (e.a === X && e.b === person)))) {
      const b = listen(() => {}, { seat: person, id: 'triedPossess', about: X });
      baselessN++;
      if (b.liar >= BOT_HEAR.baseless - 1e-9 && Math.abs(b.d) < 1e-9) baseless++;
    }
  }
  check(n > 60 && up === n, `the player's "Stay away from <name>!" raises a clean bot's estimate of that guest (${up}/${n})`);
  check(believedMore === n, `...more when the bot believes the player than when it suspects them (${believedMore}/${n})`);
  check(baselessN > 20 && baseless === baselessN, `a "<name> tried to possess me!" with no trade between them counts against the speaker, not the guest named (${baseless}/${baselessN})`);
}

// --- 8. no role tells; talk never makes a Lantern magnet ----------------------------------------------
// What a line is, when it comes and who says it must not tell a guest's role (QA 12 Oct 2026: a third guest
// defending the one just named, a late "tried to possess me!", a turn-start line said after the turn,
// "I trust <name>." and "Who has a Lantern?" from one side far more often than the other were all tells),
// and lying in chat must not get a guest handed more Lanterns.
console.log('\nno role tells; talk never makes a Lantern magnet');
{
  const NAMING = new Set(['triedPossess', 'isPossessed', 'stayAway', 'distrustX']);
  const TURN = new Set(['nearby', 'suspects', 'vouches', 'gather', 'checkCount', 'askLantern']);
  const st = { matches: 0, turns: { clean: 0, poss: 0 }, rate: {}, offTurn: 0, third: 0, thirdPoss: 0, contra: 0, tried: 0, triedLate: 0,
    mutual: 0, mutualPossFirst: 0 };
  const T0 = Date.now();
  // (600 matches: "Who vouches" and "Who has a Lantern?" are rare, a few in a thousand turns, so a smaller sample made the
  // rates of the two sides wobble by half again from one bots' tuning to the next)
  for (let k = 0; k < 600; k++) {
    const { state, said, turns, eventTime } = play(40000 + k * 7, 6);
    st.matches++;
    for (const t of turns) st.turns[t.possessed ? 'poss' : 'clean']++;
    const live = said.filter(m => !m.finished);
    for (const m of live) {
      const r = (st.rate[m.moment] ||= { clean: 0, poss: 0 });
      r[m.speakerPossessed ? 'poss' : 'clean']++;
      // a line about its own turn is said in that turn
      if (TURN.has(m.moment) && (m.active !== m.seat || m.turn == null)) st.offTurn++;
      // "I trust <X>." after its own "<X> tried to possess me!" / "<X> is possessed!"
      if (m.id === 'trustX' && live.some(x => x.seat === m.seat && x.about === m.about && (x.id === 'triedPossess' || x.id === 'isPossessed') && x.at < m.at)) st.contra++;
      // "<X> tried to possess me!" comes right after a trade between the two, true or false alike
      if (m.id === 'triedPossess') {
        st.tried++;
        const trade = state.events.filter(e => e.type === 'trade' && ((e.a === m.seat && e.b === m.about) || (e.b === m.seat && e.a === m.about)) && eventTime.get(e.seq)?.t <= m.at).pop();
        if (!trade || m.at - eventTime.get(trade.seq).t > 25000) st.triedLate++;
      }
    }
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (!NAMING.has(a.id) || a.about == null) continue;
      // a third guest, not on its own turn, takes sides within 8 s: "I trust <named>." / "I don't trust <namer>."
      const b = live.find(x => x.at > a.at && x.at - a.at <= 8000 && x.seat !== a.seat && x.seat !== a.about && x.seat !== x.active
        && ((x.id === 'trustX' && x.about === a.about) || (x.id === 'distrustX' && x.about === a.seat)));
      if (b) { st.third++; if (b.speakerPossessed) st.thirdPoss++; }
      // both said "tried to possess me!" of each other (a clean guest and a possessed one): who spoke first?
      if (a.id === 'triedPossess') {
        const back = live.find(x => x.id === 'triedPossess' && x.seat === a.about && x.about === a.seat && x.at > a.at && x.at - a.at <= 20000);
        if (back && back.speakerPossessed !== a.speakerPossessed) { st.mutual++; if (a.speakerPossessed) st.mutualPossFirst++; }
      }
    }
  }
  const per = (id, side) => 1000 * ((st.rate[id]?.[side] || 0) / Math.max(1, st.turns[side]));
  const ratio = id => { const c = per(id, 'clean'), p = per(id, 'poss'); return Math.max(c, p) / Math.max(1e-9, Math.min(c, p)); };
  const show = id => `${id} ${per(id, 'clean').toFixed(1)} / ${per(id, 'poss').toFixed(1)}`;
  console.log(`         (${st.matches} matches of 6, ${((Date.now() - T0) / 1000).toFixed(1)} s; per 1000 turns, clean / possessed: ${['nearby', 'vouches', 'gather', 'checkCount', 'askLantern'].map(show).join(', ')})`);
  check(st.offTurn === 0, `a line about a bot's own turn is said in that turn, never as the next guest plays (${st.offTurn} after it)`);
  check(st.third / st.matches < 0.05, `no third guest takes sides when someone is named (${st.third} times in ${st.matches} matches, ${st.thirdPoss} of them possessed)`);
  check(st.contra === 0, `never "I trust <name>." after the same guest accused them (${st.contra})`);
  check(st.tried > 100 && st.triedLate === 0, `"<name> tried to possess me!", true or false, comes right after a trade between the two (${st.tried} lines, ${st.triedLate} later)`);
  check(st.mutual >= 30 && Math.abs(st.mutualPossFirst / st.mutual - 0.5) <= 0.15,
    `two guests accusing each other: the possessed one speaks first about half the time (${st.mutualPossFirst}/${st.mutual})`);
  // (rates per turn of each side; "Meet me at the Fire Exit." comes from different plans on the two sides,
  // a little more often clean at six players and possessed at four: a looser bound; "Who has a Lantern?" is
  // rare, so its count is noisy)
  // A ratio of two rare counts wobbles by chance (about 100 lines of "Who vouches" in 600 matches: the same bots on another
  // set of 600 matches gave 1.19x where this set gave 1.66x), so a ratio over its limit fails only when the two sides' rates
  // also differ by more than chance could (three standard errors of a difference of two Poisson rates).
  const sure = id => {
    const cn = st.rate[id]?.clean || 0, pn = st.rate[id]?.poss || 0, tc = Math.max(1, st.turns.clean), tp = Math.max(1, st.turns.poss);
    const se = Math.sqrt(cn / (tc * tc) + pn / (tp * tp));
    return se > 0 && Math.abs(cn / tc - pn / tp) / se >= 3;
  };
  const within = (id, limit) => ratio(id) <= limit || !sure(id);
  check(within('nearby', 1.6) && within('vouches', 1.6) && within('checkCount', 1.6) && within('gather', 2) && within('askLantern', 2.5),
    `the plans said at the start of a turn come about as often a turn from either side (nearby ${ratio('nearby').toFixed(2)}x, vouches ${ratio('vouches').toFixed(2)}x, checkCount ${ratio('checkCount').toFixed(2)}x, gather ${ratio('gather').toFixed(2)}x, askLantern ${ratio('askLantern').toFixed(2)}x; a ratio over its limit counts only when the difference is more than chance)`);
}
{
  // Lying in chat ("I am possessed.", or a "<name> tried to possess me!" the table can see is impossible)
  // must not get a clean guest handed more Lanterns (to block with: a Lantern "blocked" against a clean
  // guest is simply theirs) than saying "Good evening!" does: the same matches, played three times.
  const T0 = Date.now();
  const sum = { greet: { n: 0, l: 0, e: 0 }, iAmPossessed: { n: 0, l: 0, e: 0 }, never: { n: 0, l: 0, e: 0 } };
  for (let k = 0; k < 180; k++) {
    const seed = 50000 + k * 11;
    const runs = { greet: play(seed, 6, { inject: { id: 'greet', round: 2 } }), iAmPossessed: play(seed, 6, { inject: { id: 'iAmPossessed', round: 2 } }),
      never: play(seed, 6, { inject: { id: 'triedPossess', about: 'never', round: 2 } }) };
    if (Object.values(runs).some(r => r.exploit.said !== true)) continue;
    for (const [key, r] of Object.entries(runs)) { sum[key].n++; sum[key].l += r.exploit.lanterns; sum[key].e += r.exploit.escaped ? 1 : 0; }
  }
  const L = key => sum[key].l / Math.max(1, sum[key].n), E = key => 100 * sum[key].e / Math.max(1, sum[key].n);
  console.log(`         (${sum.greet.n} matches each, ${((Date.now() - T0) / 1000).toFixed(1)} s: Lanterns handed to the speaker / escaped — "Good evening!" ${L('greet').toFixed(2)} / ${E('greet').toFixed(1)}%, "I am possessed." ${L('iAmPossessed').toFixed(2)} / ${E('iAmPossessed').toFixed(1)}%, an impossible accusation ${L('never').toFixed(2)} / ${E('never').toFixed(1)}%)`);
  check(sum.greet.n >= 150 && L('iAmPossessed') <= L('greet') * 1.15 && L('never') <= L('greet') * 1.15,
    'a guest who lies in chat is handed no more Lanterns than one who says "Good evening!" (within 15%)');
  {
    // (and the reason, exactly: what was said never moves a clean bot's estimate for a Lantern block)
    const { state, table } = newMatch(777, 6);
    for (let t = 0; t < 8 && !state.finished; t++) playBotTurn(state, floor, table);
    const L0 = state.players.find(p => !p.possessed && p.alive).index, X = state.players.find(p => p.index !== L0 && p.alive).index;
    const est = () => { const l = table.catchUp(L0); return l.mind.pPoss(l.mind.context(l.view), X, BOT_HEAR.blockShare); };
    const before = est();
    table.hear({ seat: X, id: 'iAmPossessed', at: 0 });
    table.hear({ seat: X, id: 'triedPossess', about: L0, at: 0 });
    check(Math.abs(est() - before) < 1e-12, 'what was said never moves a clean bot\'s estimate for handing a Lantern to block');
  }
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failures) { console.log(`\n${failures} CHAT CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL CHAT CHECKS PASSED');
