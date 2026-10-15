// "Your record" (src/record.js) in Node: counting, "Left early", reset, saving, a damaged save, blocked or
// missing storage, a second tab (no browser, ~1 s).
//   node tests/record-check.mjs
//
// src/record.js takes an injected store (anything with getItem / setItem, the shape of localStorage), so
// these run on plain objects. What main.js does with it (count a game once, when its end screen shows; a
// match left before its end counts as left early) is checked in a real browser by tests/browser-bots.mjs;
// here: the counting itself, and what the screen's words and win rate make of the numbers.
import { createRecord, record as deviceRecord, winRate, KEY } from '../src/record.js';
import { RECORD_WORDS as W } from '../src/data/record.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const t0 = Date.now();

// --- stores ---------------------------------------------------------------------------------------------
// A working store (like localStorage: a missing key answers null) that also keeps a count of its writes.
function memoryStore(initial) {
  const data = new Map(initial === undefined ? [] : [[KEY, initial]]);
  return {
    data, writes: 0,
    getItem(k) { return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { this.writes++; data.set(k, String(v)); },
  };
}
const saved = store => JSON.parse(store.data.get(KEY));
const blockedStore = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
const noStorage = { getItem: () => undefined, setItem: () => undefined };       // a page with no localStorage at all
const ZERO = { played: 0, won: 0, lost: 0, clean: { played: 0, won: 0, lost: 0 }, possessed: { played: 0, won: 0, lost: 0 }, escaped: 0, practiceEscapes: 0, left: 0 };

// --- 1. counting ------------------------------------------------------------------------------------------
console.log('counting');
{
  const st = memoryStore();
  const r = createRecord({ store: st });
  check(same(r.get(), ZERO), 'a new device starts at nothing');
  check(st.writes === 0, '...and writes nothing until a game is counted');
  r.countMatch({ won: true, possessed: false, escaped: true });
  check(same(r.get(), { ...ZERO, played: 1, won: 1, clean: { played: 1, won: 1, lost: 0 }, escaped: 1 }), 'a clean win that got out: played 1, won 1, clean 1/1, escaped 1');
  r.countMatch({ won: false, possessed: false, escaped: false });
  r.countMatch({ won: true, possessed: true, escaped: false });
  r.countMatch({ won: false, possessed: true, escaped: false });
  const g = r.get();
  check(g.played === 4 && g.won === 2 && g.lost === 2, 'four matches: 2 won, 2 lost');
  check(same(g.clean, { played: 2, won: 1, lost: 1 }) && same(g.possessed, { played: 2, won: 1, lost: 1 }), 'by side: clean 1 won / 1 lost, possessed 1 won / 1 lost');
  check(g.escaped === 1, 'escaped counts only the match you got out of yourself (a win by your side does not count)');
  check(g.left === 0 && g.practiceEscapes === 0, 'nothing was counted as left early or as practice');
  check(winRate(g) === 50, 'the win rate is 50%');
  // a won match by your side while you were dead or did not escape is still a win (the side won)
  r.countMatch({ won: true, possessed: false, escaped: false });
  const h = r.get();
  check(h.won === 3 && h.escaped === 1, 'a win for your side counts as a win whether or not you escaped');
  check(h.played === h.clean.played + h.possessed.played && h.won === h.clean.won + h.possessed.won && h.lost === h.clean.lost + h.possessed.lost, 'the totals are always the two sides added up');
  // each call counts once
  const before = r.get().played;
  r.countMatch({ won: false, possessed: false, escaped: false });
  check(r.get().played === before + 1, 'one call counts one match (not two)');
  const copy = r.get(); copy.played = 999; copy.clean.won = 999;
  check(r.get().played === before + 1, 'get() hands out a copy: changing it changes nothing');
}

// --- 2. Left early and practice -------------------------------------------------------------------------------
console.log('\nleft early, practice');
{
  const r = createRecord({ store: memoryStore() });
  r.countMatch({ won: true, possessed: false, escaped: true });
  r.countLeft(); r.countLeft();
  const g = r.get();
  check(g.left === 2, 'a match left early counts as left early');
  check(g.played === 1 && g.won === 1 && g.lost === 0, '...never as played, won or lost');
  check(g.clean.played === 1 && g.possessed.played === 0, '...and not in either side');
  r.countPractice(); r.countPractice(); r.countPractice();
  const p = r.get();
  check(p.practiceEscapes === 3 && p.played === 1 && p.left === 2, 'practice escapes are their own count: not matches, not left early');
  check(winRate(createRecord({ store: memoryStore() }).get()) === null, 'no win rate before the first match (left early alone gives none)');
  const onlyLeft = createRecord({ store: memoryStore() }); onlyLeft.countLeft();
  check(winRate(onlyLeft.get()) === null, '...even after a match left early');
  check(W.left(0) === 'None' && W.left(1) === '1 match' && W.left(2) === '2 matches', `the words: Left early reads "${W.left(0)}", "${W.left(1)}", "${W.left(2)}"`);
  check(W.rate(null) === '–' && W.rate(50) === '50%', 'the win rate reads "–" before the first match and "50%" after');
  check(W.endMatch({ won: 1, lost: 1 }) === 'Your record: 1 win · 1 loss' && W.endMatch({ won: 7, lost: 4 }) === 'Your record: 7 wins · 4 losses', 'the end screen line: "1 win · 1 loss", "7 wins · 4 losses"');
  check(W.endPractice({ practiceEscapes: 2 }) === 'Practice escapes on this device: 2', 'the practice line');
}

// --- 3. saved on the device ----------------------------------------------------------------------------------
console.log('\nsaving');
{
  const st = memoryStore();
  const a = createRecord({ store: st });
  a.countMatch({ won: true, possessed: true, escaped: false });
  a.countLeft();
  a.countPractice();
  check(st.writes === 3, 'each counted game is saved once (3 games, 3 writes)');
  const s = saved(st);
  check(s.played === 1 && s.won === 1 && s.possessed.won === 1 && s.left === 1 && s.practiceEscapes === 1, 'the saved text holds the numbers');
  check(Object.keys(s).sort().join() === 'clean,escaped,left,lost,played,possessed,practiceEscapes,won', 'and only the numbers (no name, no role, no match detail)');
  const b = createRecord({ store: st });         // the next visit
  check(same(b.get(), a.get()), 'a new visit starts from what was saved');
  a.reset();
  check(same(a.get(), ZERO) && same(saved(st), ZERO), 'Reset puts every number back to 0, in storage too');
  check(same(createRecord({ store: st }).get(), ZERO), '...and the next visit starts at nothing');
  a.countMatch({ won: false, possessed: false, escaped: false });
  check(a.get().played === 1 && a.get().won === 0, 'counting goes on after a reset');
}

// --- 4. a second tab -----------------------------------------------------------------------------------------
console.log('\ntwo tabs');
{
  const st = memoryStore();
  const a = createRecord({ store: st }), b = createRecord({ store: st });
  a.countMatch({ won: true, possessed: false, escaped: true });
  b.countMatch({ won: false, possessed: true, escaped: false });
  a.countLeft();
  const g = a.get();
  check(g.played === 2 && g.won === 1 && g.lost === 1 && g.left === 1 && g.escaped === 1, 'two tabs count on top of each other (nothing is lost)');
  check(same(b.get(), g), 'and both tabs read the same record');
}

// --- 5. a damaged save ---------------------------------------------------------------------------------------
console.log('\ndamaged saves');
{
  const read = text => createRecord({ store: memoryStore(text) }).get();
  const never = r => [r.played, r.won, r.lost, r.escaped, r.practiceEscapes, r.left, ...['clean', 'possessed'].flatMap(s => [r[s].played, r[s].won, r[s].lost])]
    .every(n => Number.isInteger(n) && n >= 0 && n <= 1e6);
  const garbage = ['{not json', 'null', 'true', '42', '"text"', '[]', '[1,2,3]', '{}', '', '{"played":"many"}', 'undefined', '{"won":{"a":1}}', '\u0000\u0000'];
  for (const text of garbage) {
    let r, threw = false;
    try { r = read(text); } catch { threw = true; }
    check(!threw && r && never(r) && same(r, ZERO), `saved ${JSON.stringify(text)} starts from nothing, no error`);
  }
  const odd = read(JSON.stringify({ played: 99, won: 5, lost: 2, clean: { won: 3, lost: -4 }, possessed: { won: '2', lost: 'x' }, escaped: -1, practiceEscapes: 2.9, left: null }));
  check(odd.won === 5 && odd.lost === 2 && odd.played === 7, 'played is always won + lost: a saved "99" cannot show more matches than were won or lost');
  check(same(odd.clean, { played: 3, won: 3, lost: 0 }), 'a negative number reads as 0');
  check(same(odd.possessed, { played: 2, won: 2, lost: 0 }), 'a number saved as text is read; text that is not a number reads as 0');
  check(odd.escaped === 0 && odd.practiceEscapes === 2 && odd.left === 0, 'a negative, a fraction (rounded down) and a null: 0, 2, 0');
  const big = read(JSON.stringify({ won: 1e12, lost: 1e12, left: 1e30, escaped: Infinity }));
  check(big.won === 1e6 && big.lost === 1e6 && big.left === 1e6 && big.escaped === 0, 'a huge number is held to a million (Infinity reads as 0), so the screen cannot overflow');
  // counting on top of a damaged save repairs it
  const st = memoryStore('{"won": 4, "lost": "x", "played": 900, "clean": 5}');
  const r = createRecord({ store: st });
  r.countMatch({ won: true, possessed: false, escaped: false });
  check(saved(st).played === 5 && saved(st).won === 5 && saved(st).lost === 0, 'counting on a damaged save writes a sound one back');
}

// --- 6. blocked or missing storage --------------------------------------------------------------------------
console.log('\nblocked or missing storage');
{
  for (const [name, store] of [['blocked (every access throws, a private window)', blockedStore], ['missing (no localStorage on the page)', noStorage]]) {
    let threw = false, r;
    try {
      r = createRecord({ store });
      r.countMatch({ won: true, possessed: false, escaped: true });
      r.countLeft(); r.countPractice();
      r.countMatch({ won: false, possessed: true, escaped: false });
    } catch { threw = true; }
    check(!threw, `${name}: nothing throws`);
    const g = r?.get();
    check(g && g.played === 2 && g.won === 1 && g.lost === 1 && g.left === 1 && g.practiceEscapes === 1 && g.escaped === 1, `${name}: the visit still counts what happens`);
    r?.reset();
    check(r && same(r.get(), ZERO), `${name}: Reset works for this visit`);
  }
  // reads work but writes are refused: the count of this visit must not be replaced by the older saved one
  const st = memoryStore(JSON.stringify({ ...ZERO, played: 1, won: 1, clean: { played: 1, won: 1, lost: 0 } }));
  st.setItem = () => { throw new Error('QuotaExceededError'); };
  const r = createRecord({ store: st });
  r.countMatch({ won: true, possessed: false, escaped: false });
  r.countMatch({ won: true, possessed: false, escaped: false });
  check(r.get().played === 3 && r.get().won === 3, 'storage that refuses writes: the count of this visit goes on from what was saved (3), and is not set back by the older saved text');
  // storage that works again later
  let refuse = true;
  const flaky = memoryStore();
  const realSet = flaky.setItem.bind(flaky);
  flaky.setItem = (k, v) => { if (refuse) throw new Error('blocked'); realSet(k, v); };
  const f = createRecord({ store: flaky });
  f.countLeft();
  refuse = false;
  f.countLeft();
  check(f.get().left === 2 && saved(flaky).left === 2, 'when storage works again the next count saves the whole record');
}

// --- 7. the one the game uses ----------------------------------------------------------------------------------
console.log('\nthe game\'s own record');
{
  // In Node there is no window, so the device's store cannot be read: it behaves like blocked storage.
  let threw = false, g;
  try { deviceRecord.countMatch({ won: true, possessed: false, escaped: false }); deviceRecord.countLeft(); g = deviceRecord.get(); } catch { threw = true; }
  check(!threw && g?.played === 1 && g?.left === 1, 'src/record.js `record` (the device\'s own localStorage) counts in memory when there is none, as before');
  check(KEY === 'hotelEscape.record.v1', 'the saved key is unchanged: hotelEscape.record.v1 (a record kept on a device stays)');
  // and with a window that has localStorage, the device store is the one used (looked up at each call)
  const mem = new Map();
  globalThis.window = { localStorage: { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)) } };
  const viaWindow = createRecord();
  viaWindow.countMatch({ won: true, possessed: true, escaped: false });
  check(JSON.parse(mem.get(KEY) || '{}').possessed?.won === 1, 'with window.localStorage the default store writes to it');
  delete globalThis.window;
}

console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
