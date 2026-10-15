// The top guest strip shows only what its viewer may know, and counts the round honestly (no browser, ~2 s).
//   node tests/strip-check.mjs
//
// src/ui/stripModel.js works out, as plain data, what the strip draws for each guest: whose turn it is, who is next,
// and whether the VIEWER certainly knows that guest is possessed (the "Possessed" marker). src/ui/roundLabel.js
// roundReadout() works out the round line ("3 turns left in Round 2"). Both are the viewer's own knowledge and
// the public turn order, nothing else. This holds them to that:
//   1. The marker is exactly what the rules engine says the viewer knows (src/game/knowledge.js), on either side, never
//      on a guest the viewer is unsure of, never on the viewer, never in practice, and nothing in a row says a role.
//   2. A clean viewer sees the marker (no red eyes: those stay for a possessed viewer, src/ui/allies.js), a guest the trade
//      scene is still holding back is not marked until it lets go, and a guest never marked is never marked later by a guess.
//   3. The turns left in the round are counted from the real turn order: the same wrap the engine does (src/game/state.js
//      endTurn), skipping the dead, the final round says dawn, and practice and a finished game have no line.
import { applyMode, rules } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import { knownPossessed } from '../src/game/knowledge.js';
import { knownPossessedIds, redEyedAllies, holdAlly, releaseAlly } from '../src/ui/allies.js';
import { stripGuests } from '../src/ui/stripModel.js';
import { roundReadout, roundLabel } from '../src/ui/roundLabel.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);
const fresh = (n, seed = 1) => { applyMode('match', n); return S.createState(floor, roster.slice(0, n), seed, { mode: 'match' }); };
const marked = rows => rows.filter(r => r.known).map(r => r.seat);

// --- 1. Who is marked -----------------------------------------------------------------------------------
console.log('1. who is marked');
{
  const s = fresh(6, 3);
  const poss = s.players.find(p => p.possessed), clean = s.players.filter(p => !p.possessed);
  // Nobody knows anything at the start: no marker for anyone, for either side.
  check(s.players.every(v => marked(stripGuests(s, v)).length === 0), 'at the start nobody is marked on anyone\'s strip (the possessed guest\'s own role is on their panel, not the strip)');
  // A clean viewer's Hand Mirror shows a guest holding a Possession card: that guest, and only that guest, is marked.
  const V = clean[0], T = poss, other = clean[1];
  V.inbox.push({ seq: 900, type: 'mirrorSaw', target: T.index, hand: ['possession'] });
  check(JSON.stringify(marked(stripGuests(s, V))) === JSON.stringify([T.index]), 'a Hand Mirror that showed a Possession card marks that guest on a clean viewer\'s strip');
  check(!stripGuests(s, V)[other.index].known && !stripGuests(s, V)[V.index].known, 'no other guest, and not the viewer, is marked');
  check(redEyedAllies(s, V).size === 0, 'a clean viewer gets no red eyes (they stay for a possessed viewer)');
  // The same mirror showing no Possession card marks nobody; being mirrored, or blocked, is no knowledge.
  const W = clean[2];
  W.inbox.push({ seq: 901, type: 'mirrorSaw', target: other.index, hand: ['lantern', 'bandage'] }, { seq: 902, type: 'mirroredBy', by: T.index }, { seq: 903, type: 'blocked', by: T.index });
  check(marked(stripGuests(s, W)).length === 0, 'a mirror that showed no Possession card, being mirrored and being blocked mark nobody');
  // A possessed viewer sees the allies they know, no more: a second possessed guest they were not told about stays unmarked.
  const P = poss, third = clean[3], fourth = clean[4];
  third.possessed = true; fourth.possessed = true;      // (the engine would have to possess them through a trade; here the strip must still not know)
  P.knows.add(third.id);
  check(JSON.stringify(marked(stripGuests(s, P))) === JSON.stringify([third.index]), 'a possessed viewer sees the one ally they know, not the other possessed guest they were not told about');
  check(redEyedAllies(s, P).has(third.id) && !redEyedAllies(s, P).has(fourth.id) && !redEyedAllies(s, P).has(P.id), 'their red eyes follow the same guests');
  // The viewer is never marked on their own tile, even when their own record says they know of themselves.
  P.knows.add(P.id);
  check(!stripGuests(s, P)[P.index].known, 'a viewer is never marked on their own tile');
  // What a row may carry: no role, no hand, no card count.
  const KEYS = ['seat', 'id', 'active', 'next', 'dead', 'out', 'me', 'flag', 'known'].sort().join();
  check(stripGuests(s, P).every(r => Object.keys(r).sort().join() === KEYS), 'a row holds only seat, id, turn flags, out/dead, "known" and the flag words: no role, hand or card count');
  check(!/possess|clean|role|soul/i.test(JSON.stringify(stripGuests(s, W).map(r => r.flag))), 'the flag words never say a role');
  // Practice: no strip markers at all.
  applyMode('practice', 1);
  const pr = S.createState(floor, roster.slice(0, 1), 5, { mode: 'practice' });
  pr.players[0].knows.add('p9');
  check(knownPossessedIds(pr, pr.players[0]).size === 0, 'practice has nobody to mark');
}

// --- 1b. Over whole matches: the marker is always the engine's own knowledge, and always true ---------------
console.log('\n1b. over played matches');
{
  let looks = 0, seen = 0, wrong = 0, mismatched = 0, selfMarked = 0, cleanSaw = 0;
  for (const n of [4, 5, 6]) for (let seed = 1; seed <= 30; seed++) {
    const s = fresh(n, seed * 7 + n);
    const rng = makeRng(seed);
    // Make a messy table: possess some guests, tell some players about them, now and then a death.
    for (let step = 0; step < 60 && !s.finished; step++) {
      const a = s.players[Math.floor(rng() * n)], b = s.players[Math.floor(rng() * n)];
      if (a !== b && rng() < 0.3) {
        if (rng() < 0.5) { b.possessed = true; a.inbox.push({ seq: 1000 + step, type: 'traded', with: b.index, gave: 'lantern', got: 'possession' }); }
        else if (a.possessed) { a.knows.add(b.id); b.possessed = true; }
        else {
          // (a Hand Mirror: a Possession card in the hand means the guest really is possessed)
          const showed = rng() < 0.5;
          if (showed) b.possessed = true;
          a.inbox.push({ seq: 1000 + step, type: 'mirrorSaw', target: b.index, hand: showed ? ['possession'] : ['lantern'] });
        }
      }
      if (rng() < 0.04 && s.players.filter(p => p.alive).length > 2) s.players[Math.floor(rng() * n)].alive = false;
      if (!S.activePlayer(s).alive) { S.endTurn(s, floor); continue; }
      if (rng() < 0.5) S.endTurn(s, floor);
      for (const v of s.players) {
        const rows = stripGuests(s, v), known = knownPossessed(s, v);
        looks++;
        for (const r of rows) {
          if (r.known) { seen++; if (!known.has(r.id)) mismatched++; if (!s.players[r.seat].possessed) wrong++; if (r.id === v.id) selfMarked++; if (!v.possessed) cleanSaw++; }
          else if (known.has(r.id) && r.id !== v.id) mismatched++;
        }
      }
    }
  }
  check(looks > 1000 && seen > 100, `looked at ${looks} strips, ${seen} markers`);
  check(mismatched === 0, `every marker is a guest the engine says the viewer knows, and every such guest is marked (${mismatched} differences)`);
  check(selfMarked === 0, 'no viewer was ever marked on their own tile');
  check(cleanSaw > 0, `clean viewers saw markers too (${cleanSaw})`);
  check(wrong === 0, 'every marked guest really is possessed (a marker is a certainty, never a guess)');
}

// --- 2. The trade scene's hold ----------------------------------------------------------------------------
console.log('\n2. a guest the trade scene is still holding back');
{
  const s = fresh(5, 9);
  const P = s.players.find(p => p.possessed), X = s.players.find(p => !p.possessed);
  P.inbox.push({ seq: 800, type: 'converted', who: X.index });
  check(marked(stripGuests(s, P)).includes(X.index), 'a guest the viewer possessed is marked once known');
  holdAlly(X.id);
  check(!marked(stripGuests(s, P)).includes(X.index), 'held back by the trade scene: not marked yet (the strip behind the scene must not give it away)');
  releaseAlly(X.id);
  check(marked(stripGuests(s, P)).includes(X.index), 'let go: marked');
  releaseAlly(null);
}

// --- 3. The turns left in the round ------------------------------------------------------------------------
console.log('\n3. the round line');
{
  const s = fresh(6, 2);
  const at = (active, round = 2) => { s.activeIndex = active; s.round = round; return roundReadout(s); };
  check(at(0).text === '6 turns left in Round 2' && at(0).left === 6, 'first of six: "6 turns left in Round 2"');
  check(at(3).text === '3 turns left in Round 2', 'fourth of six: "3 turns left in Round 2"');
  check(at(4).text === '2 turns left in Round 2' && !at(4).last, 'fifth of six: 2 left, not the last turn');
  check(at(5).text === 'Last turn of Round 2' && at(5).last, 'sixth of six: "Last turn of Round 2"');
  check(roundLabel(s).includes('Round 2'), 'it uses the same round number as the header label (roundLabel)');
  // The dead take no turn and are not counted.
  s.players[5].alive = false;
  check(at(4).text === 'Last turn of Round 2', 'with the last seat dead, the fifth guest has the last turn');
  s.players[2].alive = false;
  check(at(0).left === 4 && at(3).left === 2, 'a dead guest in the middle is skipped in the count');
  s.players[5].alive = true; s.players[2].alive = true;
  // Out of the game (escaped) is skipped as well.
  s.escaped.add(s.players[4].id);
  check(at(3).text === '2 turns left in Round 2', 'a guest who escaped is skipped');
  s.escaped.clear();
  // The final round: dawn follows.
  const final = at(1, rules.roundLimit);
  check(final.final && final.text === '5 turns left · Dawn after this round' && final.capWord === 'Dawn', 'final round: "5 turns left · Dawn after this round"');
  check(at(5, rules.roundLimit).text === 'Last turn · Dawn after this round', 'final round, last turn: "Last turn · Dawn after this round"');
  check(at(1, 3).capWord === 'Round ends' && !at(1, 3).final, 'an ordinary round marks "Round ends" where the round does');
  // "Next" on the strip: the next living guest; after the last turn of an ordinary round that is the first guest, after the
  // last turn of the final round it is nobody (dawn follows).
  const nextOf = (active, round) => { s.activeIndex = active; s.round = round; return stripGuests(s, s.players[0]).filter(r => r.next).map(r => r.seat); };
  check(JSON.stringify(nextOf(2, 2)) === '[3]' && JSON.stringify(nextOf(5, 2)) === '[0]', '"Next" is the next guest, and after the last turn of a round the first guest');
  check(nextOf(5, rules.roundLimit).length === 0 && JSON.stringify(nextOf(4, rules.roundLimit)) === '[5]', 'in the final round nobody is "Next" after the last turn: dawn follows');
  // Nothing to count: practice, a finished game.
  s.finished = true;
  check(roundReadout(s) === null, 'a finished game has no round line');
  s.finished = false;
  applyMode('practice', 1);
  const pr = S.createState(floor, roster.slice(0, 1), 5, { mode: 'practice' });
  check(roundReadout(pr) === null, 'practice (one guest, no deadline) has no round line');
}

// --- 3b. The count is the engine's own wrap ------------------------------------------------------------------
console.log('\n3b. against the engine\'s own turns');
{
  let rounds = 0, off = 0, lastWrongly = 0, textWrong = 0;
  for (const n of [4, 5, 6]) for (let seed = 1; seed <= 25; seed++) {
    const s = fresh(n, seed + 100 * n);
    const rng = makeRng(seed);
    for (let step = 0; step < 90 && !s.finished; step++) {
      if (rng() < 0.05 && s.players.filter(p => p.alive).length > 2) {
        const v = s.players[Math.floor(rng() * n)];
        if (v !== S.activePlayer(s)) v.alive = false;       // (a death between turns)
      }
      const ro = roundReadout(s);
      if (!ro) break;
      // Take real turns until the round number changes: it must take exactly `left` turns, and the last of them is the one that says "Last turn".
      const r0 = s.round; let taken = 0, sawLast = false;
      while (s.round === r0 && !s.finished && taken < 20) {
        const now = roundReadout(s);
        if (!now) break;
        if (now.last) sawLast = true;
        if (now.last !== (S.nextPlayer(s) && S.nextPlayer(s).index <= s.activeIndex)) lastWrongly++;
        if (!now.text.includes(`Round ${Math.min(s.round, rules.roundLimit)}`) && !now.final) textWrong++;
        S.endTurn(s, floor); taken++;
      }
      if (s.finished || !sawLast) break;
      rounds++;
      if (taken !== ro.left) off++;
    }
  }
  check(rounds > 100, `followed ${rounds} whole rounds with real turns (4, 5 and 6 guests, some dead)`);
  check(off === 0, `a round took exactly as many turns as the line said at its start (${off} off)`);
  check(lastWrongly === 0, '"Last turn" is shown exactly when ending the turn wraps to the next round');
  check(textWrong === 0, 'the line always names the round the header shows');
}

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
