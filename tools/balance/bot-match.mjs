// ALL-BOT MATCHES with the game's own computer guests (src/bots/) — dev tool, not part of the game.
//
//   node tools/balance/bot-match.mjs [--n 400] [--players 4,5,6] [--seed 1] [--trace] [--json out.json] [--tune k=v,...]
//
// Each match: a new random hotel, random bot profiles (src/bots/profiles.js), the possessed seat dealt at
// random by the engine, every turn played through the pure rules engine by src/bots/autoplay.js, exactly
// as the interface carries out a bot's choices. The bots only ever see what their guest could know
// (src/bots/view.js); this tool sees everything, to measure.
//
// Reports, per table size: who wins and how, match length, when the first conversion happens, possession
// attempts / successes / blocks, how often a possessed bot's FIRST trade with a guest was a friendly one and
// how often a later attempt on that guest followed, kills (clean-on-clean vs other), escapes, the Fire Exit
// found, Lantern blocks by clean bots, results per playing style, and an estimate of the waiting time per
// bot turn (actions per turn × the bots' thinking pauses, before the player's speed setting).
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

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : def; };
const N = parseInt(arg('n', '400'), 10);
const SIZES = String(arg('players', '6,5,4')).split(',').map(Number).filter(Boolean);
const SEED = parseInt(arg('seed', '1'), 10);
const TRACE = process.argv.includes('--trace');
const JSON_OUT = arg('json', null);

const floor = createHotel(hotel, config);
// --tune key=value[,key=value]: change a bot behaviour knob (src/bots/brain.js TUNING) for this run only.
for (const kv of String(arg('tune', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in TUNING)) throw new Error(`unknown knob ${k}; knobs: ${Object.keys(TUNING).join(', ')}`);
  TUNING[k] = Number(v);
}

export function playMatch(seed, players, { trace = false } = {}) {
  applyMode('hotseat', players);
  const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'hotseat' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const table = createBotTable(state, floor, profiles.map((profile, index) => ({ index, profile })), seed);
  const startPossessed = state.players.findIndex(p => p.possessed);
  let turns = 0, actions = 0, waitMs = 0, refusals = 0, maxRefusalTurn = 0, jammed = 0;
  const kinds = {};
  while (!state.finished && turns < 400) {
    const who = S.activePlayer(state);
    const s = playBotTurn(state, floor, table, { maxSteps: 40 });
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
  return collect(state, table, profiles, { seed, players, turns, actions, waitMs, refusals, maxRefusalTurn, jammed, startPossessed, kinds });
}

function collect(state, table, profiles, base) {
  const P = state.players;
  const inbox = P.map(p => p.inbox || []);
  const conv = [];                // { seat, by, round, seq }
  for (const p of P) for (const e of p.inbox) if (e.type === 'possessed') conv.push({ seat: p.index, by: e.by, round: e.round, seq: e.seq });
  const possessedAt = (seat, seq) => seat === base.startPossessed || conv.some(c => c.seat === seat && c.seq < seq);
  let attempts = 0, successes = 0, blocks = 0;
  for (const box of inbox) for (const e of box) {
    if (e.type === 'traded' && e.gave === 'possession' && e.got !== 'possession') attempts++;
    if (e.type === 'converted') successes++;
    if (e.type === 'blockedThem') blocks++;
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
    attempts, successes, blocks,
    kills, attacks,
    firstTrades, firstFriendly, friendlyThenAttempt, firstAttempt, early,
    blockDecisions,
    exitFound: floor.exitRoom != null,
    seats,
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
    firstFriendlyRate: ft ? ff / ft : 0, firstAttemptRate: ft ? fa / ft : 0, friendlyThenAttemptRate: ff ? fta / ff : 0,
    early: (() => { const e = list.reduce((a, m) => ({ n: a.n + m.early.n, f: a.f + m.early.friendly, t: a.t + m.early.attempt }), { n: 0, f: 0, t: 0 }); return { friendly: e.n ? e.f / e.n : 0, attempt: e.n ? e.t / e.n : 0 }; })(),
    kills: kills.length / n, cleanOnCleanKills: kills.filter(k => !k.byPossessed && !k.victimPossessed).length / n,
    attacks: attacks.length / n,
    escapes: list.filter(m => m.how === 'escape').length / n,
    exitFound: list.filter(m => m.exitFound).length / n,
    blockRate: bt ? bd / bt : 0, blocksDecidedPerMatch: bd / n,
    actionsPerTurn: actions / turns, waitPerTurnMs: wait / turns,
    refusals: list.reduce((a, m) => a + m.refusals, 0), maxRefusalTurn: Math.max(...list.map(m => m.maxRefusalTurn)),
    jammed: list.reduce((a, m) => a + m.jammed, 0) / n,
    unfinished: list.filter(m => !m.finished).length,
    kinds: (() => { const o = {}; for (const m of list) for (const [k, v] of Object.entries(m.kinds)) o[k] = (o[k] || 0) + v / n; return o; })(),
    styles,
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
  line("Possessed bot's first trade with a guest: friendly / attempt", `${pct(s.firstFriendlyRate, 1)} / ${pct(s.firstAttemptRate, 1)}`);
  line('  … in rounds 1-3 only: friendly / attempt', `${pct(s.early.friendly, 1)} / ${pct(s.early.attempt, 1)}`);
  line('  … friendly first, later an attempt on the same guest', pct(s.friendlyThenAttemptRate, 1));
  line('Attacks / kills per match (clean-on-clean kills)', `${s.attacks.toFixed(2)} / ${s.kills.toFixed(2)} (${s.cleanOnCleanKills.toFixed(2)})`);
  line('Escapes', pct(s.escapes * s.n, s.n));
  line('Fire Exit found', pct(s.exitFound * s.n, s.n));
  line('Clean bots handing over a Lantern to block (of their trades)', `${pct(s.blockRate, 1)} (${s.blocksDecidedPerMatch.toFixed(2)} per match)`);
  line('Actions per bot turn; estimated thinking time per bot turn', `${s.actionsPerTurn.toFixed(2)}; ${(s.waitPerTurnMs / 1000).toFixed(1)} s`);
  line('Refused actions (all matches); most in one turn; unfinished', `${s.refusals}; ${s.maxRefusalTurn}; ${s.unfinished}`);
  line('Doors tried that turned out jammed, per match (not a refusal)', s.jammed.toFixed(2));
  line('Bot actions per match', Object.entries(s.kinds).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', '));
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
    out[players] = s;
    print(players, s);
  }
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  if (JSON_OUT) { const fs = await import('node:fs'); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); }
}
