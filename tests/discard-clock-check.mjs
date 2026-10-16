// The end-of-turn discard clock (approved rule, 15 Oct 2026; no browser, ~1 s): node tests/discard-clock-check.mjs
//
// The 45-second turn clock keeps running during the discard, but the guest always gets at least
// rules.discardMinSeconds; at zero the game discards random ORDINARY cards for them (never a Possession card, only
// as many as needed) and the turn ends; the same at once when the 45 seconds run out in the action phase while they
// hold more than the limit. Where the clock is off the discard has no limit. The seconds maths and the words are
// src/ui/discardClock.js (pure); the choice of cards is the engine's own discardRandomDown (src/game/actions.js).
// This holds:
//   1. how long the discard screen runs (30 s left -> 30, 2 s left -> 10, nothing left -> 10, clock off -> no limit)
//   2. when a screen opens at all (6 cards: never; 7 or 9: it asks for exactly the number over)
//   3. what a clock reaching zero does, with the engine: 8 cards -> 2 random ordinary cards go, Possession cards
//      stay, nothing public is added, the turn then passes; a hand within the limit is left alone
//   4. the countdown's words: the whole seconds, the urgent last 5, "10 seconds left" and "5 seconds left" said once each
//   5. the notice the guest reads ("Time ran out. The game discarded your Knife and your Lantern."), which never names
//      a Possession card
//   6. the wiring in src/main.js that no browser is needed to see: the clock no longer stands still for the discard
//      screen, the end of the clock goes through the game's discard, and CI runs this suite
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, countableCount, countType } from '../src/game/cards.js';
import { createState, activePlayer, canEndTurn, endTurn } from '../src/game/state.js';
import { overHandLimit, discardRandomDown } from '../src/game/actions.js';
import {
  discardAllowance, discardPlan, atZero, secondsShown, secondsLine, isUrgent, announcement, discardedLine, URGENT_SECONDS, ANNOUNCE_AT,
} from '../src/ui/discardClock.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const floor = createHotel(hotel, config);
const fresh = seed => { applyMode('match', 6); return createState(floor, roster.slice(0, 6), seed, { mode: 'match' }); };
const hand = types => types.map((type, i) => ({ id: `c${i}`, type }));
const souls = (owner, n = rules.possessionSupply) => Array.from({ length: n }, (_, i) => ({ id: `soul${i}`, type: 'possession', owner }));
const MIN = rules.discardMinSeconds;

// --- 1. how long the screen runs -----------------------------------------------------------------------------
console.log('1. how long the discard screen runs');
{
  applyMode('match', 6);
  check(MIN === 10 && rules.turnTimerEnabled === true && rules.turnTimerSeconds === 45, 'a match: the 45-second clock is on and the discard minimum is 10 seconds');
  check(discardAllowance(30) === 30, 'ends the turn with 30 s left: the discard runs 30 s');
  check(discardAllowance(2) === MIN && discardAllowance(3) === MIN && discardAllowance(9.99) === MIN, 'with 2 s (or 3, or just under 10) left: the guest still gets 10 s');
  check(discardAllowance(MIN) === MIN && discardAllowance(10.01) === 10.01 && discardAllowance(45) === 45, 'exactly 10 s left: 10; more than that is all kept, up to the whole 45');
  check([0, null, undefined, NaN, -3].every(v => discardAllowance(v) === MIN), 'nothing left (0, null, not a number, below zero): 10 s, never less');
  check(discardAllowance(30, false) === null && discardAllowance(2, false) === null && discardAllowance(0, false) === null, 'the clock off (Practice, ?timer=off): no limit at all (null), whatever the number');
  applyMode('practice', 1);
  check(rules.turnTimerEnabled === false && discardAllowance(30) === null, 'by default it asks the rules: Practice has the clock off, so no limit');
  applyMode('match', 6);
  check(discardAllowance(30) === 30, '...and a match is back on the clock');
  rules.discardMinSeconds = 12;
  check(discardAllowance(2) === 12 && discardAllowance(30) === 30, 'the minimum is read from rules.discardMinSeconds, not written into the function');
  rules.discardMinSeconds = MIN;
}

// --- 2. when the screen opens ---------------------------------------------------------------------------------
console.log('\n2. when the screen opens at all');
{
  const s = fresh(21);
  const p = s.players[0];
  p.hand = hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade']);
  check(countableCount(p.hand) === 6 && overHandLimit(p) === 0 && discardPlan(overHandLimit(p), 30, true).screen === false, 'exactly 6 cards: no discard screen at all');
  p.hand = hand(['lantern', 'knife', 'bandage', 'flashlight']);
  check(discardPlan(overHandLimit(p), 30, true).screen === false, 'fewer than 6: none');
  p.hand = [...hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade']), ...souls(p.id)];
  check(overHandLimit(p) === 0 && discardPlan(overHandLimit(p), 30, true).screen === false, '6 cards and 3 Possession cards: Possession cards do not count, so no screen (and the screen looks the same whatever the role)');
  p.hand = hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso']);
  let plan = discardPlan(overHandLimit(p), 30, true);
  check(plan.screen && plan.over === 1 && plan.seconds === 30, '7 cards: the screen asks for 1, with the 30 s that are left');
  p.hand = hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso', 'handMirror', 'lockPick']);
  plan = discardPlan(overHandLimit(p), 4, true);
  check(plan.screen && plan.over === 3 && plan.over === countableCount(p.hand) - rules.handLimit && plan.seconds === MIN, '9 cards: it asks for 3 (the number over), and with 4 s left it runs 10 s');
  plan = discardPlan(overHandLimit(p), 30, false);
  check(plan.screen && plan.over === 3 && plan.seconds === null, 'the clock off: the same screen, with no time limit');
  check(JSON.stringify(discardPlan(0, 30, true)) === JSON.stringify({ screen: false, over: 0, seconds: null }) && discardPlan(-2, 30, true).screen === false, 'nothing over: { screen: false }');
}

// --- 3. a clock reaching zero ----------------------------------------------------------------------------------
console.log('\n3. a clock reaching zero (with the engine)');
{
  check(atZero(2) === 'random' && atZero(1) === 'random' && atZero(0) === 'end' && atZero(-1) === 'end', "zero with cards over the limit: 'random' (the game discards for them); within the limit: 'end' (the turn just ends)");
  const snap = s => JSON.stringify({ log: s.log, events: s.events, seq: s.eventSeq, boxes: s.players.map(q => [q.inbox, q.notes]) });

  // the discard screen's clock runs out: the guest holds 8 and picked nothing
  const s = fresh(22);
  const p = activePlayer(s);
  p.hand = hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso', 'handMirror']);
  const ids = new Set(p.hand.map(c => c.id));
  const over = overHandLimit(p);
  check(over === 2 && atZero(over) === 'random', 'the guest holds 8: 2 over, and zero means a random discard');
  check(!canEndTurn(s).ok && canEndTurn(s).over === 2, 'the engine does not let the turn pass over the limit (the discard has to happen first)');
  const before = snap(s), pile = s.discardPile.length, turn = s.turn, from = s.activeIndex;
  const gone = discardRandomDown(s, p, makeRng(9));
  check(gone.length === over && gone.length === 2, 'exactly the number over goes: 2');
  check(gone.every(c => ids.has(c.id)) && new Set(gone.map(c => c.id)).size === 2, 'the cards chosen are cards that were in the guest\'s hand (two different ones)');
  check(gone.every(c => !p.hand.includes(c) && s.discardPile.includes(c)) && s.discardPile.length === pile + 2 && countableCount(p.hand) === rules.handLimit, 'they are out of the hand, on the discard pile, and 6 are left');
  check(snap(s) === before, 'nothing public is added: no log line, no event, no note for anyone');
  const turnEnd = endTurn(s, floor);
  check(turnEnd.ok && s.turn === turn + 1 && s.activeIndex !== from, 'and then the turn passes to the next guest, the same way a normal end of turn does');

  // the 45 s clock runs out in the action phase: the same, with no screen at all
  const t = fresh(23);
  const q = activePlayer(t);
  q.hand = hand(['knife', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso', 'handMirror']);
  check(atZero(overHandLimit(q)) === 'random', 'the 45 s clock out in the action phase with 8 cards: a random discard at once');
  const g2 = discardRandomDown(t, q, makeRng(4));
  check(g2.length === 2 && overHandLimit(q) === 0 && canEndTurn(t).ok && endTurn(t, floor).ok, '...2 go, and the turn can pass');

  // a possessed guest: the Possession cards are never touched
  const u = fresh(24);
  const r = u.players.find(x => x.possessed) || u.players[0];
  r.hand = [...hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso']), ...souls(r.id)];
  const nSouls = countType(r.hand, 'possession');
  let touched = false;
  for (let seed = 1; seed <= 30; seed++) {
    r.hand = [...hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso']), ...souls(r.id)];
    const g = discardRandomDown(u, r, makeRng(seed));
    if (g.length !== 1 || g.some(c => c.type === 'possession') || countType(r.hand, 'possession') !== nSouls) touched = true;
  }
  check(nSouls === rules.possessionSupply && !touched, `a guest holding ${nSouls} Possession cards: over 30 different dice, one ordinary card goes each time and the Possession cards are all still there`);
  // within the limit nothing is discarded
  const w = fresh(25);
  w.players[0].hand = hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade']);
  check(atZero(overHandLimit(w.players[0])) === 'end' && discardRandomDown(w, w.players[0], makeRng(1)).length === 0 && w.players[0].hand.length === 6, 'within the limit when the clock runs out: nothing is discarded, the turn simply ends');
}

// --- 4. the countdown's words -----------------------------------------------------------------------------------
console.log('\n4. the countdown');
{
  check(secondsShown(30) === 30 && secondsShown(29.01) === 30 && secondsShown(0.2) === 1 && secondsShown(0) === 0 && secondsShown(-1) === 0, 'the number shows whole seconds, rounded up, and never reads 0 until time is really up');
  check(secondsLine(30) === '30 seconds left' && secondsLine(1) === '1 second left' && secondsLine(0.4) === '1 second left' && secondsLine(10) === '10 seconds left', 'the words: "30 seconds left", "1 second left"');
  check(URGENT_SECONDS === 5 && isUrgent(5) && isUrgent(4.2) && isUrgent(0) && !isUrgent(5.01) && !isUrgent(30), 'urgent in the last 5 seconds');
  check(ANNOUNCE_AT.join() === '10,5', 'a screen reader is told at 10 and at 5');
  // run a 30-second countdown frame by frame (a frame is at most 50 ms: main.js) and collect what is said
  const run = (from, dt = 0.05) => {
    const said = []; let before = Infinity;
    for (let left = from; left > -0.5; left = Math.round((left - dt) * 1000) / 1000) { const a = announcement(before, left); if (a) said.push(a); before = left; if (left <= 0) break; }
    return said;
  };
  check(run(30).join('|') === '10 seconds left|5 seconds left', 'from 30 s: "10 seconds left" once, then "5 seconds left" once, nothing in between');
  check(run(10).join('|') === '10 seconds left|5 seconds left', 'a screen opened with the 10-second minimum says so at once, then says 5');
  check(run(45, 0.016).join('|') === '10 seconds left|5 seconds left', '...whatever the frame rate (60 fps)');
  check(run(7).join('|') === '7 seconds left|5 seconds left', 'opened with 7 s (cannot happen: the minimum is 10): it says the true 7, then 5');
  check(announcement(Infinity, 30) === null && announcement(12, 11.9) === null && announcement(10.2, 10) === '10 seconds left' && announcement(10, 9.9) === null,
    'it speaks when the number shown passes 10 (not before, not twice)');
}

// --- 5. the notice ----------------------------------------------------------------------------------------------
console.log('\n5. the notice the guest reads');
{
  const c = (...types) => types.map((type, i) => ({ id: `n${i}`, type }));
  check(discardedLine(c('knife', 'lantern')) === 'Time ran out. The game discarded your Knife and your Lantern.', 'two cards: "Time ran out. The game discarded your Knife and your Lantern."');
  check(discardedLine(c('bandage')) === 'Time ran out. The game discarded your Bandage.', 'one card');
  check(discardedLine(c('knife', 'lantern', 'lockPick')) === 'Time ran out. The game discarded your Knife, your Lantern and your Lock Pick.', 'three cards: a comma, then "and"');
  check(discardedLine(c('lantern', 'knife', 'lantern')) === 'Time ran out. The game discarded your 2 Lanterns and your Knife.', 'two of a kind are counted ("your 2 Lanterns"), never "your Lantern and your Lantern"');
  check(discardedLine(c('knife', 'knife')) === 'Time ran out. The game discarded your 2 Knives.', 'two Knives read "your 2 Knives", not "Knifes"');
  check(discardedLine(c('handMirror', 'masterKey', 'espresso', 'revolver')) === 'Time ran out. The game discarded your Hand Mirror, your Master Key, your Espresso and your Revolver.', 'the card names are the cards\' own');
  // whatever the engine really discards for a possessed guest never names a Possession card
  const s = fresh(31);
  const p = s.players[0];
  p.hand = [...hand(['lantern', 'knife', 'bandage', 'flashlight', 'lantern', 'barricade', 'espresso', 'handMirror', 'lockPick']), ...souls(p.id)];
  const line = discardedLine(discardRandomDown(s, p, makeRng(6)));
  check(!/possess|soul/i.test(line) && /^Time ran out\. The game discarded your [A-Z][\w ]+(, your [A-Z][\w ]+)* and your [A-Z][\w ]+\.$/.test(line.replace(/your (\d) /g, 'your ')), `the line from a real random discard names ordinary cards only ("${line}")`);
}

// --- 6. the wiring in src/main.js --------------------------------------------------------------------------------
console.log('\n6. the wiring (read from the code: no browser here)');
{
  const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const def = name => new RegExp(`${name}[^]*?;\\n`).exec(main)?.[0] || '';
  const paused = def('const timerPaused = ');
  check(paused.includes('askUp()') && paused.includes('meeting.isOpen') && paused.includes('handoff.isOpen') && paused.includes('meetingLive'), 'the clock still waits for the Menu panel and questions, meetings and private screens');
  check(!/discard\.isOpen/.test(paused) && /discard\.finishing/.test(paused), 'the discard screen is no longer one of them: the clock runs on (it stands still only for the half second the last card leaves)');
  const onUp = /function onTimeUp\(\) \{[^]*?\n\}/.exec(main)?.[0] || '';
  check(/atZero\(overHandLimit\(/.test(onUp) && /endTurnByClock\(/.test(onUp), 'the end of the clock asks the rule (atZero) and ends the turn through endTurnByClock');
  const byClock = /function endTurnByClock\([^)]*\) \{[^]*?\n\}/.exec(main)?.[0] || '';
  check(/discardRandomDown\(state, /.test(byClock) && /passTurn\(\)/.test(byClock) && /discard\.note\(/.test(byClock) && !/endTurnByTimeout|Math\.random/.test(byClock), "it discards with the engine's own discardRandomDown (no choice of its own), passes the turn through passTurn and shows the guest the notice");
  const endNow = /function endTurnNow\(\) \{[^]*?\n\}/.exec(main)?.[0] || '';
  check(/discardAllowance\(timerLeft, rules\.turnTimerEnabled\)/.test(endNow) && /discard\.open\(p, passTurn, \{ seconds \}\)/.test(endNow) && /botDiscardDown\(p\)/.test(endNow), 'ending the turn over the limit opens the screen with the allowance; a computer guest still discards by itself');
  check(/function showEnd\(\) \{[^]*?discard\.close\(\)/.test(main), 'the end of the match closes an open discard screen');
  const flow = fs.readFileSync(path.join(root, '.github/workflows/tests.yml'), 'utf8');
  check(/suite: \[[^\]]*\bdiscard-clock-check\b/.test(flow), 'CI (and tests/run-fast.mjs) runs this suite');
  const mod = fs.readFileSync(path.join(root, 'src/ui/discardClock.js'), 'utf8');
  check(!/\bdocument\b|\bwindow\b|performance\.now|setTimeout|Math\.random/.test(mod.replace(/\/\/.*$/gm, '')), 'src/ui/discardClock.js is pure: no page, no clock, no dice of its own');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL DISCARD CLOCK CHECKS PASSED');
process.exit(failures ? 1 : 0);
