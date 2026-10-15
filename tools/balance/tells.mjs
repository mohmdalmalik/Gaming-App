// CAN A PLAYER TELL THE POSSESSED COMPUTER GUESTS APART BY HOW THEY MOVE? Dev tool, not part of the game.
//
//   node tools/balance/tells.mjs [--n 1500] [--players 6] [--seed 3] [--tune k=v,...] [--json out.json]
//
// Plays all-bot matches with the game's own computer guests (src/bots/) and, for each thing a person
// at the table can SEE (the feed names who opens a door and who searches; the top strip shows where
// every guest stands), measures how often a guest showing it is possessed. 50% would be a coin toss;
// the share of possessed guests among all living guests (the "base") is what a signal that tells
// nothing would show. Doors opened, rooms entered, searches and positions are all public.
//
//   (a) zero doors opened by the end of round 2 / 3 (the guest "who has not opened a door yet")
//   (a2) after round 3, the one guest who has opened the fewest doors (if there is only one) is the guest
//        who started possessed (the guess "the one who never explores")
//   (b) standing still: the same ordinary room at the end of three turns in a row (round 3 on), and a turn with no
//       action at all (round 3 on)
//   (c) parked beside the Fire Exit at the end of two / three turns in a row; inside the Fire Exit
//   (d) one-guess tests at the end of rounds 2, 3 and 5: "the guest with the most / fewest X is the guest who
//       started possessed", for X = doors opened, searches, rooms entered, turns with no action
//
// Also: doors per turn in rounds 1-3 and what each role does in rounds 4 on, and the clean side's win rate
// of the matches played (the full balance report is tools/balance/bot-match.mjs).
// The target of the retune (docs/DECISIONS.md, "Computer guests give less away by how they move"): no single
// signal above about 65-70% (a), (b), (c); the one-guess tests near the chance of picking a guest at random.
import { config } from '../../src/config.js';
import { applyMode } from '../../src/data/rules.js';
import { hotel } from '../../src/data/hotel.js';
import { roster } from '../../src/data/characters.js';
import { createHotel } from '../../src/game/hotel.js';
import { makeRng } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import { createBotTable } from '../../src/bots/index.js';
import { TUNING } from '../../src/bots/brain.js';
import { rollProfiles } from '../../src/bots/profiles.js';
import { playBotTurn } from '../../src/bots/autoplay.js';

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : d; };
const N = +arg('n', 1500), PLAYERS = +arg('players', 6), SEED = +arg('seed', 3), JSON_OUT = arg('json', null);
for (const kv of String(arg('tune', '')).split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  if (!(k in TUNING)) throw new Error(`unknown knob ${k}; knobs: ${Object.keys(TUNING).join(', ')}`);
  TUNING[k] = Number(v);
}
const floor = createHotel(hotel, config);
const pct = (k, n) => (n ? (100 * k / n).toFixed(1) + '%' : '-');

const rows = [];                                   // one per turn
const cum = { doors: { 2: [0, 0], 3: [0, 0] } };   // zero doors through round R: [possessed, all]
const guess = {};                                  // 'doors.min@3' -> [right, tried]
const bump = (key, ok) => { const g = (guess[key] ||= [0, 0]); g[1]++; if (ok) g[0]++; };
let cleanWins = 0, finished = 0, refusals = 0, attempts = 0, successes = 0, turns = 0, rounds = 0;

for (let k = 0; k < N; k++) {
  const seed = SEED * 1000003 + k * 7919 + PLAYERS;
  applyMode('match', PLAYERS);
  const state = S.createState(floor, roster.slice(0, PLAYERS), seed, { mode: 'match' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(PLAYERS, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const table = createBotTable(state, floor, profiles.map((profile, index) => ({ index, profile })), seed);
  const startP = state.players.findIndex(p => p.possessed);
  const f = Array.from({ length: PLAYERS }, () => ({ doors: 0, searches: 0, rooms: 0, zero: 0 }));
  const still = new Array(PLAYERS).fill(0), last = new Array(PLAYERS).fill(null);
  const done = {};
  let g = 0;
  while (!state.finished && g++ < 400) {
    const who = S.activePlayer(state);
    const isPoss = who.possessed;                          // role as the turn starts
    const s = playBotTurn(state, floor, table, { maxSteps: 40 });
    turns++; refusals += s.refusals.filter(r => r.reason !== 'jammed').length;
    const room = who.currentRoom;
    const exitRoom = floor.exitRoom;
    const exitDoor = exitRoom ? floor.rooms.get(exitRoom).doorways[0] : null;
    const campRoom = exitDoor ? exitDoor.otherRoom(exitRoom) : null;
    still[who.index] = last[who.index] === room ? still[who.index] + 1 : 0;
    last[who.index] = room;
    const acts = s.actions.filter(a => a.k !== 'end').length;
    const opens = s.actions.filter(a => a.k === 'open').length;
    const searches = s.actions.filter(a => a.k === 'search').length;
    const moves = s.actions.filter(a => a.k === 'move').length;
    f[who.index].doors += opens; f[who.index].searches += searches; f[who.index].rooms += moves; if (!acts) f[who.index].zero++;
    rows.push({ round: s.round, poss: isPoss, acts, opens, moves, searches, inExit: room === exitRoom, inCamp: room === campRoom,
      still: still[who.index], inLobby: room === floor.start.room, alive: who.alive });
    for (const R of [2, 3, 5]) {
      if (done[R] || state.round <= R) continue;
      done[R] = true;
      const alive = state.players.filter(p => p.alive && !state.escaped.has(p.id));
      if (R <= 3) for (const p of alive) if (f[p.index].doors === 0) { cum.doors[R][1]++; if (p.possessed) cum.doors[R][0]++; }
      if (alive.length < 3) continue;
      for (const key of ['doors', 'searches', 'rooms', 'zero']) {
        const vals = alive.map(p => f[p.index][key]);
        for (const [which, v] of [['min', Math.min(...vals)], ['max', Math.max(...vals)]]) {
          const who1 = alive.filter(p => f[p.index][key] === v);
          if (who1.length === 1 && vals.some(x => x !== v)) bump(`${key}.${which}@${R}`, who1[0].index === startP);
          else bump(`${key}.${which}@${R}`, false);        // no single guest stands out: the guess fails
        }
      }
    }
  }
  if (state.finished) { finished++; if (state.won === 'humans') cleanWins++; }
  rounds += Math.min(state.round, 8);
  for (const p of state.players) for (const e of p.inbox) { if (e.type === 'traded' && e.gave === 'possession') attempts++; if (e.type === 'converted') successes++; }
}

const rule = (name, f, filt = () => true) => {
  const all = rows.filter(r => r.alive && filt(r));
  const sel = all.filter(f);
  const p = sel.filter(r => r.poss).length / Math.max(1, sel.length);
  const base = all.filter(r => r.poss).length / Math.max(1, all.length);
  return { name, n: sel.length, p, base };
};
const signals = [
  { name: '(a) zero doors opened by the end of round 2', n: cum.doors[2][1], p: cum.doors[2][0] / Math.max(1, cum.doors[2][1]) },
  { name: '(a) zero doors opened by the end of round 3', n: cum.doors[3][1], p: cum.doors[3][0] / Math.max(1, cum.doors[3][1]) },
  rule('(b) same ordinary room at the end of 3 turns in a row (round 3 on)', r => r.still >= 2 && !r.inExit && !r.inLobby, r => r.round >= 3),
  rule('(b) same ordinary room at the end of 4 turns in a row (round 3 on)', r => r.still >= 3 && !r.inExit && !r.inLobby, r => r.round >= 3),
  rule('(b) a turn with no action at all (round 3 on)', r => r.acts === 0, r => r.round >= 3),
  rule('(b) a turn with no action at all (round 4 on)', r => r.acts === 0, r => r.round >= 4),
  rule('(c) beside the Fire Exit at the end of 2 turns in a row (round 3 on)', r => r.inCamp && r.still >= 1, r => r.round >= 3),
  rule('(c) beside the Fire Exit at the end of 3 turns in a row (round 3 on)', r => r.inCamp && r.still >= 2, r => r.round >= 3),
  rule('(c) ends a turn beside the Fire Exit (round 4 on)', r => r.inCamp, r => r.round >= 4),
  rule('(c) ends a turn inside the Fire Exit (round 4 on)', r => r.inExit, r => r.round >= 4),
];
const role = (poss, lo, hi) => {
  const rs = rows.filter(r => r.poss === poss && r.round >= lo && r.round <= hi && r.alive);
  const mean = fn => rs.reduce((a, r) => a + fn(r), 0) / Math.max(1, rs.length);
  return { opens: mean(r => r.opens), moves: mean(r => r.moves), searches: mean(r => r.searches), acts: mean(r => r.acts), zero: mean(r => (r.acts === 0 ? 1 : 0)) };
};
const out = {
  players: PLAYERS, n: N, finished, turns, refusals, cleanWin: cleanWins / Math.max(1, finished), rounds: rounds / N,
  attempts: attempts / N, successes: successes / N,
  signals: signals.map(s => ({ name: s.name, n: s.n, p: s.p, base: s.base ?? null })),
  guess: Object.fromEntries(Object.entries(guess).map(([k, v]) => [k, v[0] / Math.max(1, v[1])])),
  early: { possessed: role(true, 1, 3), clean: role(false, 1, 3) }, late: { possessed: role(true, 4, 9), clean: role(false, 4, 9) },
};
console.log(`${PLAYERS} players, ${N} matches (seed ${SEED}${arg('tune', '') ? ', tune ' + arg('tune', '') : ''}): clean side wins ${pct(cleanWins, finished)}, ${(rounds / N).toFixed(2)} rounds, ` +
  `possession attempts / successes ${out.attempts.toFixed(2)} / ${out.successes.toFixed(2)}, refused actions ${refusals}, unfinished ${N - finished}`);
console.log('  signal                                                          n       P(possessed)  [all living guests: ' + pct(rows.filter(r => r.alive && r.poss).length, rows.filter(r => r.alive).length) + ']');
for (const s of signals) console.log(`  ${s.name.padEnd(66)} ${String(s.n).padStart(6)}  ${pct(s.p, 1)}`);
console.log(`  one-guess tests: the single guest with the most / fewest X is the one who started possessed (a guess at random is right ${pct(1, PLAYERS)})`);
for (const key of ['doors', 'searches', 'rooms', 'zero']) {
  console.log(`    ${key.padEnd(9)} ` + [2, 3, 5].map(R => `end of round ${R}: fewest ${pct(guess[`${key}.min@${R}`]?.[0] ?? 0, guess[`${key}.min@${R}`]?.[1] ?? 0)} / most ${pct(guess[`${key}.max@${R}`]?.[0] ?? 0, guess[`${key}.max@${R}`]?.[1] ?? 0)}`).join('   '));
}
for (const [label, key] of [['rounds 1-3', 'early'], ['rounds 4 on', 'late']]) {
  for (const who of ['possessed', 'clean']) {
    const r = out[key][who];
    console.log(`  ${label}, ${who.padEnd(9)} per turn: doors opened ${r.opens.toFixed(2)}, rooms entered ${r.moves.toFixed(2)}, searches ${r.searches.toFixed(2)}, actions ${r.acts.toFixed(2)}, no action at all ${pct(r.zero, 1)}`);
  }
}
if (JSON_OUT) { const fs = await import('node:fs'); fs.writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); }
