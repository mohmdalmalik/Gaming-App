// The achievements ("Hotel Honours": src/data/achievements.js, the match summary src/matchSummary.js and the tracker
// src/honours.js) in Node, from matches played through the real rules engine (no browser, ~1 s).
//   node tests/honours-check.mjs
//
//   1. the five achievements, each earned from a scripted match: Seen through (your Hand Mirror shows a Possession
//      card), Saved by the light (your Lantern stops a possession), Lamplighter (3 Lanterns you found, each card
//      once), Good company (5 clean wins), Dark horse (5 wins as the guest who started possessed); progress counted
//      as it goes; each earned once, with its date; the end screen's words
//   2. the rules against abuse: practice, a test link (every forcing parameter; intro, camera and stats allowed),
//      an idle match (fewer than 3 actions) and an unfinished one earn nothing and save nothing; a win counts only for
//      the side you started on and stayed on; the Mirror and the Lantern block count only while you were clean;
//      choosing your role in the menu still counts
//   3. storage: on the device, progress only goes up, a damaged or blocked store never stops the game, a second tab
//      counts on top, the record's reset never touches it; main.js checks it only on the end screen, once per game
//      (the same guard as Your record), and never during a match
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeCard } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import { useHandMirror, resolveTrade } from '../src/game/actions.js';
import { ACHIEVEMENTS, honoursLine } from '../src/data/achievements.js';
import { matchSummary, isTestLink, TEST_PARAMS, MIN_ACTIONS } from '../src/matchSummary.js';
import { createHonours, HONOURS_KEY } from '../src/honours.js';
import { createRecord } from '../src/record.js';
import { showEndHonours } from '../src/ui/honoursEnd.js';
import { itemById, isPending } from '../src/data/wardrobe.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const t0 = Date.now();

// --- a scripted match -------------------------------------------------------------------------------------------------
// Six guests in the lobby (the start room), `you` in seat 0, the possessed guest forced (the menu's role choice does
// the same), then what the script does through the real rules; `actions` public moves of yours (enter events, as a
// walk makes them); the end as given.
const floor = createHotel(hotel, config);
let seedNo = 100;
function match({ possessed = 1, practice = false } = {}) {
  applyMode(practice ? 'practice' : 'match', practice ? 1 : 6);
  const state = S.createState(floor, roster.slice(0, practice ? 1 : 6), seedNo, { mode: practice ? 'practice' : 'match' });
  state.setup = { possessedIndex: practice ? null : possessed };
  S.resetState(state, floor, seedNo++);
  return state;
}
const you = state => state.players[0];
function moves(state, n, seat = 0) { for (let k = 0; k < n; k++) S.emitPublic(state, { type: 'enter', seat, from: 'a', to: 'b' }); }
function finish(state, won) { state.finished = true; state.won = won; }
// your Hand Mirror on a guest (all start in the same room)
function mirror(state, target, by = 0) {
  const P = state.players[by];
  const card = makeCard('handMirror'); P.hand.push(card); P.actionPoints = Math.max(P.actionPoints, 1);
  return useHandMirror(state, floor, P, card.id, state.players[target].id);
}
// a trade where `possessedSeat` hands over a soul and `seat` hands over `give` ('lantern': a block; else possessed)
function soulTrade(state, possessedSeat, seat, give) {
  const G = state.players[possessedSeat], R = state.players[seat];
  const soul = G.hand.find(c => c.type === 'possession' && c.owner === G.id) || (() => { const c = makeCard('possession', { owner: G.id }); G.hand.push(c); return c; })();
  const mine = makeCard(give); R.hand.push(mine);
  if (!G.hand.some(c => c.type !== 'possession')) G.hand.push(makeCard('bandage'));
  return resolveTrade(state, floor, G, R, soul.id, mine.id);
}
const lantern = () => makeCard('lantern');
function memoryStore() {
  const data = new Map();
  return { data, writes: 0, getItem(k) { return data.has(k) ? data.get(k) : null; }, setItem(k, v) { this.writes++; data.set(k, String(v)); } };
}
const fresh = () => { const store = memoryStore(); return { store, h: createHonours({ store, now: () => Date.UTC(2026, 9, 19, 20, 15) }) }; };
const earnedIds = list => list.map(a => a.id);

// --- 1. the five achievements -----------------------------------------------------------------------------------------
console.log('1. the five achievements');
check(ACHIEVEMENTS.map(a => a.id).join() === 'seenThrough,savedByTheLight,lamplighter,goodCompany,darkHorse', 'five achievements, the brief\'s');
{
  const { h } = fresh();
  const st = match({ possessed: 1 });
  moves(st, 3);
  const r = mirror(st, 1);
  check(r.ok && r.unmasked, '(the script: your Hand Mirror on the possessed guest shows a Possession card)');
  finish(st, 'possessed');
  const s = matchSummary(st, 0, { found: [] });
  check(s.counts && s.mirrorSawPossession && !s.startedPossessed && s.actions === 4, `the summary: counts, the Mirror saw a Possession card, ${s.actions} actions (3 moves and the Mirror)`);
  const got = h.evaluate(s);
  check(same(earnedIds(got), ['seenThrough']) && got[0].item === 'glasses.monocle' && got[0].label === 'Seen through', 'Seen through is earned (the Monocle), even in a match your side lost');
  check(h.get().earned.seenThrough === '2026-10-19T20:15:00.000Z' && h.progressOf('seenThrough').earned, '...with the date it was earned');
  const st2 = match({ possessed: 1 }); moves(st2, 3); mirror(st2, 1); finish(st2, 'humans');
  check(h.evaluate(matchSummary(st2, 0)).length === 0, 'earned once: the next mirror on a possessed guest earns nothing more');
  const st3 = match({ possessed: 1 }); moves(st3, 3); mirror(st3, 2); finish(st3, 'humans');
  check(!matchSummary(st3, 0).mirrorSawPossession, 'a Mirror on a clean guest shows no Possession card: no progress');
}
{
  const { h } = fresh();
  const st = match({ possessed: 2 });
  moves(st, 3);
  const r = soulTrade(st, 2, 0, 'lantern');
  check(r.ok && r.blocks.length === 1 && !you(st).possessed, '(the script: the possessed guest hands you a soul, you hand over a Lantern: blocked)');
  finish(st, 'humans');
  const s = matchSummary(st, 0);
  check(s.lanternBlocks === 1 && s.counts, 'the summary: one Lantern block of yours');
  const got = h.evaluate(s);
  check(same(earnedIds(got), ['savedByTheLight']) && got[0].item === 'extra.lantern' && h.progressOf('savedByTheLight').have === 1, 'Saved by the light is earned (the Lantern fob / charm)');
}
{
  const { h } = fresh();
  const st = match(); moves(st, 3); finish(st, 'possessed');
  const L = [lantern(), lantern()];
  const two = matchSummary(st, 0, { found: [...L, L[0], makeCard('bandage')] });
  check(two.lanternsFound === 2, 'Lanterns found: each card once (the same Lantern twice is one), other cards not counted');
  check(h.evaluate(two).length === 0 && h.progressOf('lamplighter').have === 2, 'two Lanterns: progress 2 of 3, nothing earned');
  const st2 = match(); moves(st2, 3); finish(st2, 'possessed');
  check(h.evaluate(matchSummary(st2, 0, { found: [lantern()] })).length === 0 && h.progressOf('lamplighter').have === 2, 'one in another match: not added up (it is "in one match"); the best match is kept');
  const st3 = match(); moves(st3, 3); finish(st3, 'possessed');
  const got = h.evaluate(matchSummary(st3, 0, { found: [lantern(), lantern(), lantern()] }));
  check(same(earnedIds(got), ['lamplighter']) && got[0].item === 'hairStyle.lamplighter', 'three Lanterns you found in one match: Lamplighter (The Poet / Braided crown)');
}
{
  const { h } = fresh();
  let earned = [];
  for (let k = 1; k <= 6; k++) {
    const st = match({ possessed: 3 }); moves(st, 3); finish(st, 'humans');
    const s = matchSummary(st, 0);
    if (k === 1) check(s.cleanWin && !s.possessedWin && s.sideWon === 'clean', 'the summary of a clean win');
    const got = h.evaluate(s);
    if (k < 5) check(!got.length && h.progressOf('goodCompany').have === k, `clean win ${k}: progress ${k} of 5`);
    if (k === 5) earned = got;
    if (k === 6) check(!got.length && h.get().counters.goodCompany === 6, 'a sixth: still counted, never earned twice');
  }
  check(same(earnedIds(earned), ['goodCompany']) && earned[0].item === 'extra.eveningGloves', 'the fifth clean win: Good company (the evening gloves)');
}
{
  const { h } = fresh();
  let earned = [];
  for (let k = 1; k <= 5; k++) {
    const st = match({ possessed: 0 }); moves(st, 3); finish(st, 'possessed');
    const s = matchSummary(st, 0);
    if (k === 1) check(s.startedPossessed && s.possessedWin && !s.cleanWin, 'the summary of a win as the guest who started possessed');
    earned = h.evaluate(s);
    if (k < 5) check(!earned.length && h.progressOf('darkHorse').have === k, `possessed win ${k}: progress ${k} of 5`);
  }
  check(same(earnedIds(earned), ['darkHorse']) && earned[0].item === 'extra.blackOrchid', 'the fifth: Dark horse (the black orchid)');
}
check(honoursLine([{ label: 'Seen through', itemLabel: 'Monocle' }]) === 'Achievement earned: Seen through · Monocle'
  && honoursLine([{ label: 'Lamplighter', itemLabel: 'The Poet' }, { label: 'Good company', itemLabel: 'Dress gloves' }]) === 'Achievements earned: Lamplighter · The Poet; Good company · Dress gloves'
  && honoursLine([]) === '', 'the end screen\'s line: "Achievement earned: Seen through · Monocle" (nothing when none)');
{
  // the line on the page (src/ui/honoursEnd.js): an item whose art is not in the game yet says so
  const el = { textContent: '', hidden: true };
  const doc = { getElementById: id => (id === 'end-honours' ? el : null) };
  const pending = isPending(itemById('glasses.monocle'), 'm');
  showEndHonours(doc, [ACHIEVEMENTS.find(a => a.id === 'seenThrough')], { body: 'm' });
  check(pending && !el.hidden && el.textContent === 'Achievement earned: Seen through · Monocle (arrives with the new wardrobe)',
    'an earned item not wearable yet (the Monocle, art in W1-B) is named with "(arrives with the new wardrobe)"');
  showEndHonours(doc, [], { body: 'm' });
  check(el.hidden && el.textContent === '', '...and with nothing earned the line is hidden');
}

// --- 2. the rules against abuse ---------------------------------------------------------------------------------------
console.log('\n2. the rules against abuse');
{
  const { store, h } = fresh();
  const writes0 = store.writes;
  // practice: nothing, whatever happened
  const pr = match({ practice: true }); moves(pr, 10); finish(pr, null); pr.finished = true;
  const sp = matchSummary(pr, 0, { found: [lantern(), lantern(), lantern()] });
  check(!sp.counts && sp.why === 'practice' && h.evaluate(sp).length === 0, 'practice earns nothing (three Lanterns found or not)');
  // a test link
  const st = match({ possessed: 1 }); moves(st, 3); mirror(st, 1); finish(st, 'humans');
  const tl = matchSummary(st, 0, { testLink: true });
  check(!tl.counts && tl.why === 'testLink' && tl.mirrorSawPossession && h.evaluate(tl).length === 0, 'a test link earns nothing (the Mirror did see a soul)');
  check(TEST_PARAMS.every(p => isTestLink(new URLSearchParams(`${p}=1`))) && same(TEST_PARAMS, ['mode', 'seed', 'timer', 'botpace', 'role', 'seat', 'bots', 'user']),
    `every forcing parameter makes a test link: ${TEST_PARAMS.join(', ')}`);
  check(!isTestLink(new URLSearchParams('intro=off&camera=square&stats=1')) && !isTestLink(new URLSearchParams('')), 'intro, camera and stats change nothing in play: allowed (and no parameter at all)');
  // idle
  const idle = match({ possessed: 1 }); moves(idle, MIN_ACTIONS - 2); mirror(idle, 1); finish(idle, 'humans');
  const si = matchSummary(idle, 0);
  check(MIN_ACTIONS === 3 && si.actions === 2 && !si.counts && si.why === 'idle' && h.evaluate(si).length === 0, 'idle (fewer than 3 actions: here 2) earns nothing');
  const three = match({ possessed: 1 }); moves(three, 1, 0); moves(three, 6, 2); S.emitPublic(three, { type: 'search', seat: 0, room: 'x' }); mirror(three, 1); finish(three, 'humans');
  check(matchSummary(three, 0).actions === 3 && matchSummary(three, 0).counts, "3 actions count (only yours: another guest's moves are not)");
  // unfinished: never mid-match
  const mid = match({ possessed: 1 }); moves(mid, 5); mirror(mid, 1);
  const sm = matchSummary(mid, 0);
  check(!sm.counts && sm.why === 'unfinished' && h.evaluate(sm).length === 0, 'a match not finished (left early, or still being played) earns nothing');
  check(store.writes === writes0 && !store.data.has(HONOURS_KEY), 'and none of these saved anything');
  check(h.evaluate(null).length === 0 && h.evaluate({ counts: 'yes', mirrorSawPossession: true }).length === 0, 'a missing or odd summary earns nothing');
}
{
  // a win counts only for the side you started on and stayed on
  const turned = match({ possessed: 1 }); moves(turned, 3);
  const r = soulTrade(turned, 1, 0, 'bandage');
  check(r.ok && you(turned).possessed, '(the script: you take a soul without a Lantern: possessed mid-match)');
  finish(turned, 'possessed');
  const s1 = matchSummary(turned, 0);
  check(s1.counts && !s1.startedPossessed && s1.endedPossessed && !s1.possessedWin && !s1.cleanWin, 'possessed mid-match, the possessed side wins: no win for either achievement (not the side you started on)');
  const turned2 = match({ possessed: 1 }); moves(turned2, 3); soulTrade(turned2, 1, 0, 'bandage'); finish(turned2, 'humans');
  const s2 = matchSummary(turned2, 0);
  check(!s2.cleanWin && !s2.possessedWin, 'possessed mid-match, the clean side wins: not a clean win (you did not stay clean)');
  const started = match({ possessed: 0 }); moves(started, 3); finish(started, 'humans');
  check(!matchSummary(started, 0).cleanWin && !matchSummary(started, 0).possessedWin, 'started possessed, the clean side wins: nothing');
  // the Mirror and the block only while clean
  const ally = match({ possessed: 1 }); moves(ally, 3); soulTrade(ally, 1, 0, 'bandage');
  const m2 = mirror(ally, 1);
  check(m2.ok && m2.unmasked, '(the script: possessed now, your Mirror looks at the one who possessed you)');
  const before = match({ possessed: 1 }); moves(before, 3); mirror(before, 1); soulTrade(before, 1, 0, 'bandage'); finish(before, 'possessed');
  finish(ally, 'possessed');
  check(!matchSummary(ally, 0).mirrorSawPossession && matchSummary(before, 0).mirrorSawPossession, 'the Mirror counts only while you were clean (after you are possessed, an ally\'s soul does not count; before, it does)');
  const blockAfter = match({ possessed: 1 }); moves(blockAfter, 3); soulTrade(blockAfter, 1, 0, 'bandage');
  // (possessed now, you are handed another possessed guest's soul and give a Lantern: the rules block it even so)
  blockAfter.players[2].possessed = true;
  const rb = soulTrade(blockAfter, 2, 0, 'lantern');
  finish(blockAfter, 'possessed');
  check(rb.ok && rb.blocks.length === 1 && matchSummary(blockAfter, 0).lanternBlocks === 0, 'a Lantern block while possessed does not count (a possessed player could farm it on allies)');
  const startedBlock = match({ possessed: 0 }); moves(startedBlock, 3);
  startedBlock.players[3].possessed = true;
  soulTrade(startedBlock, 3, 0, 'lantern'); finish(startedBlock, 'possessed');
  check(matchSummary(startedBlock, 0).lanternBlocks === 0 && !matchSummary(startedBlock, 0).mirrorSawPossession, 'started possessed: no block or Mirror counts at all');
  // the menu's role choice is a normal option
  const chose = match({ possessed: 0 }); moves(chose, 3); finish(chose, 'possessed');
  check(matchSummary(chose, 0, { testLink: false }).counts, 'choosing Possessed in the menu (not a link) still counts');
}

// --- 3. storage, and where main.js checks it -----------------------------------------------------------------------------
console.log('\n3. on the device');
{
  const { store, h } = fresh();
  const win = () => { const st = match({ possessed: 3 }); moves(st, 3); finish(st, 'humans'); return matchSummary(st, 0); };
  h.evaluate(win()); h.evaluate(win());
  const saved = JSON.parse(store.data.get(HONOURS_KEY));
  check(saved.v === 1 && saved.counters.goodCompany === 2 && saved.matches === 2 && typeof saved.best === 'object' && typeof saved.earned === 'object', `saved on the device (key ${HONOURS_KEY}): ${JSON.stringify(saved)}`);
  // a second tab counted one in between
  const other = createHonours({ store });
  other.evaluate(win());
  h.evaluate(win());
  check(h.get().counters.goodCompany === 4 && h.get().matches === 4, 'a second tab: each counts on top of what is saved now');
  // the record's reset never touches it (both on the same storage)
  const record = createRecord({ store });
  record.countMatch({ won: true, possessed: false, escaped: false });
  record.reset();
  check(createHonours({ store }).get().counters.goodCompany === 4, "Your record's reset leaves the achievements alone");
  // progress only goes up; a damaged save is made sane
  store.data.set(HONOURS_KEY, JSON.stringify({ v: 1, counters: { goodCompany: -7, darkHorse: 'x', bogus: 99 }, best: { lamplighter: 99, seenThrough: 1 }, earned: { seenThrough: 'yesterday', lamplighter: '2026-10-01T00:00:00.000Z', nope: '2026-10-01T00:00:00.000Z' }, matches: 1e12 }));
  const d = createHonours({ store }).get();
  check(d.counters.goodCompany === 0 && d.counters.darkHorse === 0 && !('bogus' in d.counters) && d.best.lamplighter === 3 && !d.earned.seenThrough && d.earned.lamplighter && !d.earned.nope && d.matches === 1e6,
    'a damaged save: counts made whole and sane, only the five achievements, dates checked');
  store.data.set(HONOURS_KEY, '{not json');
  check(createHonours({ store }).get().matches === 0, 'unreadable JSON: starts from nothing, never a crash');
  const blocked = createHonours({ store: { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } } });
  const got = blocked.evaluate((() => { const st = match({ possessed: 1 }); moves(st, 3); mirror(st, 1); finish(st, 'humans'); return matchSummary(st, 0); })());
  check(got.length === 1 && blocked.progressOf('seenThrough').earned, 'blocked storage: kept for this visit, never a crash');
  const h2 = fresh().h;
  const s5 = win();
  for (let k = 0; k < 3; k++) h2.evaluate(s5);
  const after = h2.get().counters.goodCompany;
  h2.evaluate({ ...s5, counts: false });
  check(h2.get().counters.goodCompany === after, 'progress only goes up (a match that does not count changes nothing)');
}
{
  // main.js: checked in showEnd only, once per game (its own gameToken guard), never during a match
  const main = fs.readFileSync(path.join(here, '..', 'src', 'main.js'), 'utf8');
  const body = name => { const a = main.indexOf(`function ${name}(`); const b = main.indexOf('\n}\n', a); return a < 0 ? '' : main.slice(a, b); };
  const calls = [...main.matchAll(/(?<!function )countHonours\(\)/g)].length;
  const inEnd = [...body('showEnd').matchAll(/(?<!function )countHonours\(\)/g)].length;
  check(calls > 0 && calls === inEnd, `main.js asks for the achievements only from showEnd, the end screen (${inEnd} of ${calls} calls)`);
  check(/honouredGame !== gameToken/.test(body('countHonours')) && /matchSummary\(state, humanSeat/.test(body('countHonours')) && /account\.grant\(/.test(body('countHonours')),
    'once per game (the same gameToken guard as Your record), from your own seat, and an earned item goes into your profile');
  check(!/honours\.evaluate|matchSummary\(/.test(main.replace(body('countHonours'), '')), 'nothing else in main.js evaluates a match (nothing mid-match)');
  check(/foundThisGame\.push\(\.\.\.found\)/.test(body('onSearch')) && /foundThisGame = \[\]/.test(body('resetWorld')), 'your own finds are logged by your own searches, and cleared for every new game');
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
