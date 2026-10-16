// ALL-BOT MATCHES with the game's own computer guests (src/bots/) — dev tool, not part of the game.
//
//   node tools/balance/bot-match.mjs [--n 400] [--players 4,5,6] [--seed 1] [--trace] [--json out.json] [--tune k=v,...]
//                                    [--chat off|talk|on] [--hear k=v,...] [--say moment.key=v,...] [--inject id[:partner]@round]
//
// Each match: a new random hotel, random bot profiles (src/bots/profiles.js), the possessed seat dealt at
// random by the engine, every turn played through the pure rules engine by src/bots/autoplay.js, exactly
// as the interface carries out a bot's choices. The bots only ever see what their guest could know
// (src/bots/view.js); this tool sees everything, to measure.
//
// Reports, per table size: who wins and how, match length, when the first conversion happens, possession
// attempts / successes / blocks, souls spent between possessed guests (soul cards), how often a possessed bot's FIRST trade with a guest was a friendly one and
// how often a later attempt on that guest followed, kills (clean-on-clean vs other), escapes, the Fire Exit
// found, Lantern blocks by clean bots, results per playing style, and an estimate of the waiting time per
// bot turn (actions per turn × the bots' thinking pauses, before the player's speed setting).
//
// Quick chat (src/data/chat.js, src/bots/chatter.js, src/bots/brain.js): with --chat talk or on, the bots'
// chatter runs alongside each match on a clock — each bot's thinking pause plus the time each action
// takes on screen (ANIM, MEET), ticking every 250 ms as the game asks it — and every line is heard by the
// bots (and, with --chat on, weighed: listening). --chat talk must play exactly the matches of --chat off
// (talk alone never changes the game). The report adds: lines per match and by line, strong accusations
// by the speaker's true role and how often they are true, "I am clean." by role, and what the listeners
// did with a guest they heard named (Lantern blocks, attacks, Fire Exit trades accepted, souls tried).
//   --hear k=v,...         listening knobs (BOT_HEAR.weight.<k>, a top-level number, or a.b for a nested one)
//   --say moment.key=v,... talking knobs (BOT_CHAT.moments.<moment>.<key>)
//   --inject id[:partner]@round   one clean seat says this line at the start of its first turn in that
//                          round, as a person might (the exploit tests; partner: about a guest it traded with)
import { rules, applyMode } from '../../src/data/rules.js';
import { hotel } from '../../src/data/hotel.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { createHotel } from '../../src/game/hotel.js';
import { makeRng } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import { createBotTable } from '../../src/bots/index.js';
import { TUNING } from '../../src/bots/brain.js';
import { rollProfiles } from '../../src/bots/profiles.js';
import { playBotTurn } from '../../src/bots/autoplay.js';
import { createChatter } from '../../src/bots/chatter.js';
import { BOT_CHAT, BOT_HEAR } from '../../src/data/chat.js';

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const N = parseInt(arg('n', '400'), 10);
const SIZES = String(arg('players', '6,5,4')).split(',').map(Number).filter(Boolean);
const SEED = parseInt(arg('seed', '1'), 10);
const TRACE = process.argv.includes('--trace');
const JSON_OUT = arg('json', null);
// --chat off | talk | on: the bots' quick chat runs alongside each match on a clock (their thinking pauses
// plus the time each action takes on screen), the same chatter as in the game. talk: they talk but do not
// listen (the match must play exactly as with off); on: they talk and listen.
const CHAT_MODE = String(arg('chat', 'off'));
if (CHAT_MODE === 'talk') BOT_HEAR.on = false;
// --hear k=v,...: listening weights (BOT_HEAR.weight.<k>, or a top-level number of BOT_HEAR)
for (const kv of String(arg('hear', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (k.includes('.')) { const [a, b] = k.split('.'); BOT_HEAR[a][b] = Number(v); } else if (k in BOT_HEAR.weight) BOT_HEAR.weight[k] = Number(v); else if (k in BOT_HEAR) BOT_HEAR[k] = Number(v); else throw new Error('unknown hear knob ' + k);
}
// --say moment.key=v,...: talk knobs (BOT_CHAT.moments.<moment>.<key>)
for (const kv of String(arg('say', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  const [mo, key] = k.split('.');
  if (!BOT_CHAT.moments[mo]) throw new Error('unknown moment ' + mo);
  BOT_CHAT.moments[mo][key] = Number(v);
}
const TICK = 250;
// --inject <id>[:about]@<round>: one clean seat (the one after the first possessed guest) says this line at the
// start of its first turn in that round, as a person might (an exploit test). about: 'partner' = a guest it traded with.
const INJECT = (() => { const v = arg('inject', null); if (!v) return null; const [line, round] = v.split('@'); const [id, about] = line.split(':'); return { id, about: about || null, round: Number(round || 2) }; })();
// How long each action takes on screen (ms), on top of the bot's thinking pause (src/bots/index.js thinkMs).
const ANIM = { move: 900, open: 800, search: 900, card: 900, job: 900, escape: 1500, trade: 900, end: 300 };
const MEET = { trade: 2600, attack: 2000, noTrade: 1200 };

const floor = createHotel(hotel, config);
// --tune key=value[,key=value]: change a bot behaviour knob (src/bots/brain.js TUNING) for this run only.
for (const kv of String(arg('tune', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in TUNING)) throw new Error(`unknown knob ${k}; knobs: ${Object.keys(TUNING).join(', ')}`);
  TUNING[k] = Number(v);
}

export function playMatch(seed, players, { trace = false } = {}) {
  applyMode('match', players);
  const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'match' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const table = createBotTable(state, floor, profiles.map((profile, index) => ({ index, profile })), seed);
  const startPossessed = state.players.findIndex(p => p.possessed);
  // the chat, on its clock
  const said = [];
  const chatter = CHAT_MODE !== 'off' ? createChatter(state, floor, profiles.map((profile, index) => ({ index, profile })), ((seed * 2246822519) >>> 0) || 1, BOT_CHAT, table) : null;
  let now = 0, lastTick = 0;
  const advance = ms => {
    if (!chatter) return;
    const end = now + ms;
    for (let t = lastTick + TICK; t <= end; t += TICK) {
      for (const msg of chatter.tick(t)) {
        if (trace) console.log(`        ${(t / 1000).toFixed(1)} s  ${state.players[msg.seat].name}${state.players[msg.seat].possessed ? '*' : ''}: ${msg.id}${msg.about != null ? ' ' + state.players[msg.about].name + (state.players[msg.about].possessed ? '*' : '') : ''}`);
        said.push({ ...msg, round: state.round, seq: state.eventSeq, speakerPossessed: state.players[msg.seat].possessed,
          aboutPossessed: msg.about != null ? state.players[msg.about].possessed : null });
        table.hear(msg);
        chatter.hear(msg, t);
      }
      lastTick = t;
    }
    now = end;
  };
  const onStep = chatter ? (a, r, meets) => {
    const kind = a.k === 'card' ? 'card' : a.k;
    let ms = table.thinkMs(S.activePlayer(state).index, a.k === 'move' ? 'move' : 'act') + (ANIM[kind] || 1000);
    for (const m of meets) ms += MEET[m.kind] || 2000;
    advance(ms);
  } : null;
  let injected = false;
  const exploit = { seat: (startPossessed + 1) % players, said: false };
  let turns = 0, actions = 0, waitMs = 0, refusals = 0, maxRefusalTurn = 0, jammed = 0;
  const kinds = {};
  while (!state.finished && turns < 400) {
    const who = S.activePlayer(state);
    if (INJECT && chatter && !injected && who.index === (startPossessed + 1) % players && state.round >= INJECT.round) {
      injected = true;
      if (!who.possessed) {
        let about = null;
        if (INJECT.about === 'partner') { const t = [...state.events].reverse().find(e => e.type === 'trade' && (e.a === who.index || e.b === who.index)); about = t ? (t.a === who.index ? t.b : t.a) : null; }
        if (!INJECT.about || about != null) {
          const msg = { seat: who.index, id: INJECT.id, at: now, ...(about != null ? { about } : {}) };
          table.hear(msg); chatter.hear(msg, now); exploit.said = true; exploit.about = about; exploit.aboutPossessed = about != null ? state.players[about].possessed : null;
        }
      }
    }
    advance(chatter ? table.thinkMs(who.index, 'turn') : 0);
    const s = playBotTurn(state, floor, table, { maxSteps: 40, onStep });
    advance(chatter ? 600 : 0);
    turns++;
    actions += s.actions.length;
    for (const a of s.actions) { const k = a.k === 'card' ? a.type : a.k; kinds[k] = (kinds[k] || 0) + 1; }
    for (const m of s.meetings) { const k = 'meet:' + m.kind; kinds[k] = (kinds[k] || 0) + 1; }
    const real = s.refusals.filter(r => r.reason !== 'jammed');
    jammed += s.refusals.length - real.length;
    refusals += real.length;
    maxRefusalTurn = Math.max(maxRefusalTurn, real.length);
    // Thinking pauses the interface would add for this turn (the bot's own pace).
    waitMs += table.thinkMs(who.index, 'turn');
    for (const a of s.actions) waitMs += table.thinkMs(who.index, a.k === 'move' ? 'move' : 'act');
    for (const m of s.meetings) waitMs += table.thinkMs(who.index, 'meet') + (m.kind === 'trade' ? table.thinkMs(m.with, 'trade') : 0);
    if (trace) {
      console.log(`r${s.round} ${who.name}${who.possessed ? '*' : ''} [${profiles[who.index].style}] hp${who.health} ` +
        `${s.actions.map(a => a.k + (a.to ? '>' + a.to : a.type ? ':' + a.type : '')).join(' ')}` +
        `${s.meetings.length ? '  meet ' + s.meetings.map(m => `${m.kind}@${state.players[m.with].name}`).join(',') : ''}` +
        `${s.refusals.length ? '  REFUSED ' + s.refusals.map(r => r.action.k + ':' + r.reason).join(',') : ''}  hand[${who.hand.map(c => c.type).join(',')}]`);
    }
  }
  advance(chatter ? 20000 : 0);
  if (exploit.said) {
    const X = state.players[exploit.seat];
    exploit.lanternsIn = X.inbox.filter(e => e.type === 'traded' && e.got === 'lantern' && e.seq > 0).length;
    exploit.attacked = state.events.filter(e => e.type === 'attack' && e.target === exploit.seat).length;
    exploit.died = !X.alive; exploit.escaped = state.escaped.has(X.id); exploit.converted = X.possessed;
    exploit.cleanWon = state.won === 'humans';
    if (exploit.about != null) { const Y = state.players[exploit.about]; exploit.aboutLanterns = Y.inbox.filter(e => e.type === 'traded' && e.got === 'lantern').length; exploit.aboutEscaped = state.escaped.has(Y.id); exploit.aboutAttacked = state.events.filter(e => e.type === 'attack' && e.target === exploit.about).length; }
  }
  return collect(state, table, profiles, { seed, players, turns, actions, waitMs, refusals, maxRefusalTurn, jammed, startPossessed, kinds, said, clockMs: now, exploit });
}

function collect(state, table, profiles, base) {
  const P = state.players;
  const inbox = P.map(p => p.inbox || []);
  const conv = [];                // { seat, by, round, seq }
  for (const p of P) for (const e of p.inbox) if (e.type === 'possessed') conv.push({ seat: p.index, by: e.by, round: e.round, seq: e.seq });
  const possessedAt = (seat, seq) => seat === base.startPossessed || conv.some(c => c.seat === seat && c.seq < seq);
  let attempts = 0, successes = 0, blocks = 0, spentOnPossessed = 0, crossed = 0;
  for (const box of inbox) for (const e of box) {
    if (e.type === 'traded' && e.gave === 'possession') attempts++;
    if (e.type === 'converted') successes++;
    if (e.type === 'blockedThem') blocks++;
    // Soul cards: a soul handed to a guest already possessed is spent; two possessed guests who both hand
    // over a soul spend both (each of the two is told: counted once per pair, and not as attempts).
    if (e.type === 'alreadyPossessed') spentOnPossessed++;
    if (e.type === 'soulsCrossed') { crossed += 0.5; attempts--; }
  }
  const kills = state.events.filter(e => e.type === 'attack' && e.killed).map(e => ({
    byPossessed: possessedAt(e.by, e.seq), victimPossessed: possessedAt(e.target, e.seq), round: e.round,
  }));
  const attacks = state.events.filter(e => e.type === 'attack').map(e => ({ byPossessed: possessedAt(e.by, e.seq), victimPossessed: possessedAt(e.target, e.seq) }));
  // Trust building: a possessed bot's FIRST trade with each guest it was not knowingly allied to.
  let firstTrades = 0, firstFriendly = 0, friendlyThenAttempt = 0, firstAttempt = 0;
  const early = { n: 0, friendly: 0, attempt: 0 };      // first trades in rounds 1-3
  const blockDecisions = { clean: 0, cleanTrades: 0 };
  for (const p of P) {
    const seen = new Map();
    for (const d of table.decisions(p.index)) {
      if (d.k !== 'give') continue;
      if (!d.possessed) { blockDecisions.cleanTrades++; if (d.intent === 'block') blockDecisions.clean++; continue; }
      if (d.intent === 'ally') continue;
      if (!seen.has(d.with)) {
        if (d.possCards === 0) { seen.set(d.with, 'none'); continue; }
        seen.set(d.with, d.intent);
        firstTrades++;
        if (d.intent === 'friendly') firstFriendly++;
        if (d.intent === 'attempt') firstAttempt++;
        if (d.round <= 3) { early.n++; if (d.intent === 'friendly') early.friendly++; if (d.intent === 'attempt') early.attempt++; }
      } else if (seen.get(d.with) === 'friendly' && d.intent === 'attempt') { friendlyThenAttempt++; seen.set(d.with, 'friendly+attempt'); }
    }
  }
  // --- chat: what was said, how true it was, and what the listeners did with it
  const possAtSeq = (seat, seq) => seat === base.startPossessed || conv.some(c => c.seat === seat && c.seq <= seq);
  const chat = { lines: base.said.length, byId: {}, strong: { clean: 0, cleanTrue: 0, poss: 0, possTrue: 0 }, weak: { n: 0, true: 0 },
    deny: { clean: 0, poss: 0 }, give: { hsN: 0, hsBlock: 0, hsTrue: 0, n: 0, block: 0 }, attack: { hs: 0, hsTrue: 0, all: 0, allTrue: 0 },
    accept: { hsN: 0, hsYes: 0, n: 0, yes: 0 }, possGive: { hintN: 0, hintAttempt: 0, hintTrue: 0, n: 0, attempt: 0 } };
  for (const m of base.said) {
    chat.byId[m.id] = (chat.byId[m.id] || 0) + 1;
    if (m.id === 'triedPossess' || m.id === 'isPossessed') {
      if (m.speakerPossessed) { chat.strong.poss++; if (m.aboutPossessed) chat.strong.possTrue++; } else { chat.strong.clean++; if (m.aboutPossessed) chat.strong.cleanTrue++; }
    }
    if (m.id === 'stayAway' || m.id === 'distrustX') { chat.weak.n++; if (m.aboutPossessed) chat.weak.true++; }
    if (m.id === 'clean') chat.deny[m.speakerPossessed ? 'poss' : 'clean']++;
  }
  for (const p of P) for (const d of table.decisions(p.index)) {
    const truth = d.with != null ? possAtSeq(d.with, d.seq ?? 0) : null;
    if (d.k === 'give' && !d.possessed) {
      chat.give.n++; if (d.intent === 'block') chat.give.block++;
      if ((d.hs || 0) > 0.15) { chat.give.hsN++; if (d.intent === 'block') chat.give.hsBlock++; if (truth) chat.give.hsTrue++; }
    }
    if (d.k === 'give' && d.possessed && d.intent !== 'ally' && d.possCards > 0) {
      chat.possGive.n++; if (d.intent === 'attempt') chat.possGive.attempt++;
      if ((d.hs || 0) > 0.3) { chat.possGive.hintN++; if (d.intent === 'attempt') chat.possGive.hintAttempt++; if (truth) chat.possGive.hintTrue++; }
    }
    if (d.k === 'attack' && !d.possessed) { chat.attack.all++; if (truth) chat.attack.allTrue++; if ((d.hs || 0) > 0.15) { chat.attack.hs++; if (truth) chat.attack.hsTrue++; } }
    if (d.k === 'accept' && !d.possessed) { chat.accept.n++; if (d.yes) chat.accept.yes++; if ((d.hs || 0) > 0.15) { chat.accept.hsN++; if (d.yes) chat.accept.hsYes++; } }
  }
  const seats = P.map((p, i) => ({
    style: profiles[i].style, startPossessed: i === base.startPossessed, endPossessed: p.possessed, alive: p.alive,
    escaped: state.escaped.has(p.id),
  }));
  return {
    ...base,
    won: state.won === 'humans' ? 'clean' : 'possessed',
    how: state.won === 'humans' ? 'escape' : state.dawn ? 'dawn' : 'allGone',
    finished: state.finished,
    rounds: Math.min(state.round, rules.roundLimit),
    firstConv: conv.length ? Math.min(...conv.map(c => c.round)) : null,
    convRounds: conv.map(c => c.round),
    attempts, successes, blocks, spentOnPossessed, crossed,
    kills, attacks,
    firstTrades, firstFriendly, friendlyThenAttempt, firstAttempt, early,
    blockDecisions,
    exitFound: floor.exitRoom != null,
    infirmaryUses: state.events.filter(e => e.type === 'infirmary').length,      // each Infirmary works once a match
    switchboardRings: state.events.filter(e => e.type === 'switchboard').length,  // 2 actions each, as often as a guest likes
    seats,
    chat, clockMs: base.clockMs, exploit: base.exploit,
  };
}

// --- summary ------------------------------------------------------------------------------------------
const pct = (k, n) => (n ? `${(100 * k / n).toFixed(1)}%` : '—');
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

export function summarise(list) {
  const n = list.length;
  const cleanWins = list.filter(m => m.won === 'clean').length;
  const allGone = list.filter(m => m.how === 'allGone').length;
  const dawn = list.filter(m => m.how === 'dawn').length;
  const convRounds = list.flatMap(m => m.convRounds);
  const byRound = r => convRounds.filter(x => x === r).length;
  const kills = list.flatMap(m => m.kills);
  const attacks = list.flatMap(m => m.attacks);
  const ft = list.reduce((a, m) => a + m.firstTrades, 0);
  const ff = list.reduce((a, m) => a + m.firstFriendly, 0);
  const fa = list.reduce((a, m) => a + m.firstAttempt, 0);
  const fta = list.reduce((a, m) => a + m.friendlyThenAttempt, 0);
  const bd = list.reduce((a, m) => a + m.blockDecisions.clean, 0);
  const bt = list.reduce((a, m) => a + m.blockDecisions.cleanTrades, 0);
  const turns = list.reduce((a, m) => a + m.turns, 0);
  const actions = list.reduce((a, m) => a + m.actions, 0);
  const wait = list.reduce((a, m) => a + m.waitMs, 0);
  const styles = {};
  for (const m of list) for (const s of m.seats) {
    const key = `${s.style}/${s.startPossessed ? 'possessed' : 'clean'}`;
    const o = (styles[key] ||= { n: 0, won: 0, converted: 0, died: 0, escaped: 0 });
    o.n++;
    const sideWon = s.startPossessed ? m.won === 'possessed' : m.won === 'clean';
    if (sideWon) o.won++;
    if (!s.startPossessed && s.endPossessed) o.converted++;
    if (!s.alive) o.died++;
    if (s.escaped) o.escaped++;
  }
  return {
    n, cleanWin: cleanWins / n, possessedAllGone: allGone / n, possessedDawn: dawn / n,
    medRounds: med(list.map(m => m.rounds)), medTurns: med(list.map(m => m.turns)),
    firstConvMed: med(list.filter(m => m.firstConv != null).map(m => m.firstConv)),
    noConversion: list.filter(m => m.firstConv == null).length / n,
    convByRound: [1, 2, 3, 4, 5, 6, 7, 8].map(r => byRound(r) / Math.max(1, convRounds.length)),
    attempts: mean(list.map(m => m.attempts)), successes: mean(list.map(m => m.successes)), blocks: mean(list.map(m => m.blocks)),
    spentOnPossessed: mean(list.map(m => m.spentOnPossessed)), crossed: mean(list.map(m => m.crossed)),
    firstFriendlyRate: ft ? ff / ft : 0, firstAttemptRate: ft ? fa / ft : 0, friendlyThenAttemptRate: ff ? fta / ff : 0,
    early: (() => { const e = list.reduce((a, m) => ({ n: a.n + m.early.n, f: a.f + m.early.friendly, t: a.t + m.early.attempt }), { n: 0, f: 0, t: 0 }); return { friendly: e.n ? e.f / e.n : 0, attempt: e.n ? e.t / e.n : 0 }; })(),
    kills: kills.length / n, cleanOnCleanKills: kills.filter(k => !k.byPossessed && !k.victimPossessed).length / n,
    attacks: attacks.length / n,
    attackSplit: {
      cleanOnClean: attacks.filter(a => !a.byPossessed && !a.victimPossessed).length / n,
      cleanOnPossessed: attacks.filter(a => !a.byPossessed && a.victimPossessed).length / n,
      possessedOnClean: attacks.filter(a => a.byPossessed && !a.victimPossessed).length / n,
      possessedOnPossessed: attacks.filter(a => a.byPossessed && a.victimPossessed).length / n,
    },
    escapes: list.filter(m => m.how === 'escape').length / n,
    infirmaryUses: mean(list.map(m => m.infirmaryUses)), switchboardRings: mean(list.map(m => m.switchboardRings)),
    exitFound: list.filter(m => m.exitFound).length / n,
    blockRate: bt ? bd / bt : 0, blocksDecidedPerMatch: bd / n,
    actionsPerTurn: actions / turns, waitPerTurnMs: wait / turns,
    refusals: list.reduce((a, m) => a + m.refusals, 0), maxRefusalTurn: Math.max(...list.map(m => m.maxRefusalTurn)),
    jammed: list.reduce((a, m) => a + m.jammed, 0) / n,
    unfinished: list.filter(m => !m.finished).length,
    kinds: (() => { const o = {}; for (const m of list) for (const [k, v] of Object.entries(m.kinds)) o[k] = (o[k] || 0) + v / n; return o; })(),
    styles,
    chat: (() => {
      const sum = (f) => list.reduce((a, m) => a + f(m.chat), 0);
      const byId = {};
      for (const m of list) for (const [k, v] of Object.entries(m.chat.byId)) byId[k] = (byId[k] || 0) + v / n;
      return {
        lines: sum(c => c.lines) / n, minutes: mean(list.map(m => m.clockMs)) / 60000, byId,
        strongClean: sum(c => c.strong.clean) / n, strongCleanTrue: sum(c => c.strong.cleanTrue) / Math.max(1, sum(c => c.strong.clean)),
        strongPoss: sum(c => c.strong.poss) / n, strongPossTrue: sum(c => c.strong.possTrue) / Math.max(1, sum(c => c.strong.poss)),
        weak: sum(c => c.weak.n) / n, weakTrue: sum(c => c.weak.true) / Math.max(1, sum(c => c.weak.n)),
        denyClean: sum(c => c.deny.clean) / n, denyPoss: sum(c => c.deny.poss) / n,
        give: { n: sum(c => c.give.n), block: sum(c => c.give.block), hsN: sum(c => c.give.hsN), hsBlock: sum(c => c.give.hsBlock), hsTrue: sum(c => c.give.hsTrue) },
        attack: { all: sum(c => c.attack.all), allTrue: sum(c => c.attack.allTrue), hs: sum(c => c.attack.hs), hsTrue: sum(c => c.attack.hsTrue) },
        accept: { n: sum(c => c.accept.n), yes: sum(c => c.accept.yes), hsN: sum(c => c.accept.hsN), hsYes: sum(c => c.accept.hsYes) },
        possGive: { n: sum(c => c.possGive.n), attempt: sum(c => c.possGive.attempt), hintN: sum(c => c.possGive.hintN), hintAttempt: sum(c => c.possGive.hintAttempt), hintTrue: sum(c => c.possGive.hintTrue) },
      };
    })(),
  };
}

function print(players, s) {
  const line = (k, v) => console.log(`  ${k.padEnd(58)} ${v}`);
  console.log(`\n### ${players} players — ${s.n} all-bot matches`);
  line('Clean side wins (an escape)', pct(s.cleanWin * s.n, s.n));
  line('Possessed side wins: everyone possessed or dead', pct(s.possessedAllGone * s.n, s.n));
  line('Possessed side wins: dawn', pct(s.possessedDawn * s.n, s.n));
  line('Match length, median rounds / turns', `${s.medRounds} / ${s.medTurns}`);
  line('First conversion, median round (no conversion at all)', `${s.firstConvMed} (${pct(s.noConversion * s.n, s.n)})`);
  line('Conversions by round 1..8', s.convByRound.map(x => (100 * x).toFixed(0) + '%').join(' '));
  line('Possession attempts / successes / blocks per match', `${s.attempts.toFixed(2)} / ${s.successes.toFixed(2)} / ${s.blocks.toFixed(2)}`);
  line('Souls spent: on a guest already possessed / both handed over', `${s.spentOnPossessed.toFixed(2)} / ${s.crossed.toFixed(2)} per match`);
  line("Possessed bot's first trade with a guest: friendly / attempt", `${pct(s.firstFriendlyRate, 1)} / ${pct(s.firstAttemptRate, 1)}`);
  line('  … in rounds 1-3 only: friendly / attempt', `${pct(s.early.friendly, 1)} / ${pct(s.early.attempt, 1)}`);
  line('  … friendly first, later an attempt on the same guest', pct(s.friendlyThenAttemptRate, 1));
  line('Attacks / kills per match (clean-on-clean kills)', `${s.attacks.toFixed(2)} / ${s.kills.toFixed(2)} (${s.cleanOnCleanKills.toFixed(2)})`);
  line('  … attacks clean→clean / clean→possessed / possessed→clean / possessed→possessed',
    `${s.attackSplit.cleanOnClean.toFixed(2)} / ${s.attackSplit.cleanOnPossessed.toFixed(2)} / ${s.attackSplit.possessedOnClean.toFixed(2)} / ${s.attackSplit.possessedOnPossessed.toFixed(2)}`);
  line('Escapes', pct(s.escapes * s.n, s.n));
  line('Fire Exit found', pct(s.exitFound * s.n, s.n));
  line('Infirmary treatments / Switchboard rings per match', `${s.infirmaryUses.toFixed(2)} / ${s.switchboardRings.toFixed(2)}`);
  line('Clean bots handing over a Lantern to block (of their trades)', `${pct(s.blockRate, 1)} (${s.blocksDecidedPerMatch.toFixed(2)} per match)`);
  line('Actions per bot turn; estimated thinking time per bot turn', `${s.actionsPerTurn.toFixed(2)}; ${(s.waitPerTurnMs / 1000).toFixed(1)} s`);
  line('Refused actions (all matches); most in one turn; unfinished', `${s.refusals}; ${s.maxRefusalTurn}; ${s.unfinished}`);
  line('Doors tried that turned out jammed, per match (not a refusal)', s.jammed.toFixed(2));
  line('Bot actions per match', Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
  if (CHAT_MODE !== 'off') {
    const c = s.chat;
    line('Chat: lines per match; match length on the clock', `${c.lines.toFixed(1)}; ${c.minutes.toFixed(1)} min`);
    line('  ... by line', Object.entries(c.byId).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '));
    line('  Strong accusations by clean bots per match (true)', `${c.strongClean.toFixed(2)} (${pct(c.strongCleanTrue, 1)})`);
    line('  Strong accusations by possessed bots per match (true)', `${c.strongPoss.toFixed(2)} (${pct(c.strongPossTrue, 1)})`);
    line("  Weak lines (stay away / don't trust) per match (true)", `${c.weak.toFixed(2)} (${pct(c.weakTrue, 1)})`);
    line('  "I am clean." per match: clean / possessed speakers', `${c.denyClean.toFixed(2)} / ${c.denyPoss.toFixed(2)}`);
    line('  Clean bot trades: Lantern to block, all / with a guest it heard named', `${pct(c.give.block, c.give.n)} / ${pct(c.give.hsBlock, c.give.hsN)} (${(c.give.hsN / s.n).toFixed(2)} a match, ${pct(c.give.hsTrue, c.give.hsN)} of them possessed)`);
    line('  Clean bot attacks: all (on possessed) / heard named (on possessed)', `${(c.attack.all / s.n).toFixed(2)} (${pct(c.attack.allTrue, c.attack.all)}) / ${(c.attack.hs / s.n).toFixed(2)} (${pct(c.attack.hsTrue, c.attack.hs)})`);
    line('  Clean bot accepts a Fire Exit trade: all / heard named', `${pct(c.accept.yes, c.accept.n)} / ${pct(c.accept.hsYes, c.accept.hsN)} (${c.accept.hsN})`);
    line('  Possessed bot tries a soul: all / on a guest it heard named', `${pct(c.possGive.attempt, c.possGive.n)} / ${pct(c.possGive.hintAttempt, c.possGive.hintN)} (${(c.possGive.hintN / s.n).toFixed(2)} a match, ${pct(c.possGive.hintTrue, c.possGive.hintN)} already possessed)`);
  }
  {
    const ex = s.exploitList || [];
    if (ex.length) {
      const m = f => (ex.reduce((a, x) => a + (typeof f(x) === 'boolean' ? +f(x) : f(x) || 0), 0) / ex.length);
      line(`Exploit seat (${ex.length} matches): Lanterns received / attacked / died / converted / escaped / clean won`,
        `${m(x => x.lanternsIn).toFixed(2)} / ${m(x => x.attacked).toFixed(2)} / ${pct(m(x => x.died), 1)} / ${pct(m(x => x.converted), 1)} / ${pct(m(x => x.escaped), 1)} / ${pct(m(x => x.cleanWon), 1)}`);
      if (ex.some(x => x.about != null)) line('  ... the guest it named: Lanterns received / attacked / escaped / was possessed', `${m(x => x.aboutLanterns).toFixed(2)} / ${m(x => x.aboutAttacked).toFixed(2)} / ${pct(m(x => x.aboutEscaped), 1)} / ${pct(m(x => x.aboutPossessed), 1)}`);
    }
  }
  console.log('  Per style (seats): side won / converted / died / escaped');
  for (const [k, o] of Object.entries(s.styles).sort()) {
    console.log(`    ${k.padEnd(20)} n=${String(o.n).padStart(5)}  won ${pct(o.won, o.n).padStart(6)}  converted ${pct(o.converted, o.n).padStart(6)}  died ${pct(o.died, o.n).padStart(6)}  escaped ${pct(o.escaped, o.n).padStart(6)}`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const out = {};
  const t0 = Date.now();
  if (TRACE) { playMatch(SEED, SIZES[0], { trace: true }); process.exit(0); }
  for (const players of SIZES) {
    const list = [];
    for (let k = 0; k < N; k++) list.push(playMatch(SEED * 1000003 + k * 7919 + players, players));
    const s = summarise(list);
    s.exploitList = list.map(m => m.exploit).filter(x => x && x.said);
    out[players] = s;
    print(players, s);
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (JSON_OUT) { const fs = await import('node:fs'); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); }
}
