// The round 2 polish items that are plain logic, in Node (no browser, no three.js). Run: node tests/polish-check.mjs
//   a  the seat colours (src/table.js SEAT_COLORS): six different colours, and no two of them merge for the common
//      kinds of colour blindness (the Machado simulations of protanopia, deuteranopia and tritanopia; the distance is
//      CIELAB, where about 12 or less is hard to tell apart). The old set, with the lime, is the control: it fails.
//   b  the guest's mark (guestMarks): an initial, two letters when two names start alike, the seat number when even
//      those match; never empty
//   c  the "match in progress" marker (src/matchMarker.js): written, taken once, a marker older than 6 hours or
//      damaged ignored and removed, blocked or missing storage never throws
//   d  the lobby roster's colours are the seat colours, and the ring's numbers (src/config.js) are what the audit asked
import { SEAT_COLORS, guestMarks } from '../src/table.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { matchMarker, MAX_AGE_MS } from '../src/matchMarker.js';
import { LOST_MATCH } from '../src/data/lostMatch.js';

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures++; } };

// --- a. colours ---------------------------------------------------------------------------------------------
console.log('a. seat colours and colour blindness');
const SIM = {   // Machado, Oliveira and Fernandes 2009, severity 1.0, applied to linear RGB
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const clamp = c => Math.min(1, Math.max(0, c));
function lab(l) {                                   // linear sRGB -> CIELAB (D65)
  const X = 0.4124564 * l[0] + 0.3575761 * l[1] + 0.1804375 * l[2];
  const Y = 0.2126729 * l[0] + 0.7151522 * l[1] + 0.0721750 * l[2];
  const Z = 0.0193339 * l[0] + 0.1191920 * l[1] + 0.9503041 * l[2];
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const seen = (hex, kind) => {
  const l = rgb(hex).map(lin);
  const m = SIM[kind];
  return lab(m ? m.map(row => clamp(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])) : l);
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function closest(colors) {                          // the smallest distance between two of them, for each way of seeing
  const out = {};
  for (const kind of ['normal', ...Object.keys(SIM)]) {
    let min = Infinity, pair = '';
    for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
      const d = dist(seen(colors[i], kind), seen(colors[j], kind));
      if (d < min) { min = d; pair = `${colors[i]}/${colors[j]}`; }
    }
    out[kind] = { min, pair };
  }
  return out;
}
const MIN_APART = 15;
check(SEAT_COLORS.length === 6 && new Set(SEAT_COLORS).size === 6 && SEAT_COLORS.every(c => /^#[0-9a-f]{6}$/i.test(c)), 'six different colours');
const now = closest(SEAT_COLORS);
for (const [kind, r] of Object.entries(now)) check(r.min >= MIN_APART, `${kind}: the two closest seat colours are ${r.min.toFixed(1)} apart (${r.pair}); at least ${MIN_APART}`);
// the control: the set before (gold, sky, LIME, pink, orange, lilac) has pairs that merge, so this check can fail
const OLD = ['#e6b45a', '#5ac8e6', '#a8e05a', '#e67ab8', '#f0743c', '#b8a2f0'];
const was = closest(OLD);
check(was.deuteranopia.min < 12, `control: the old set, seen with deuteranopia, has two colours ${was.deuteranopia.min.toFixed(1)} apart (${was.deuteranopia.pair}), which this check rejects`);
check(!SEAT_COLORS.includes('#a8e05a'), 'the lime seat colour is gone');
// every colour reads on the dark navy of the interface and carries dark ink (the map's initials)
const luminance = hex => { const l = rgb(hex).map(lin); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
check(SEAT_COLORS.every(c => (luminance(c) + 0.05) / (luminance('#0f1119') + 0.05) >= 4.5), 'every seat colour is at least 4.5:1 against the interface navy');
check(SEAT_COLORS.every(c => (luminance(c) + 0.05) / (luminance('#16110a') + 0.05) >= 4.5), 'every seat colour is at least 4.5:1 against the dark ink of the initials');

// --- b. marks -----------------------------------------------------------------------------------------------
console.log('b. the guest\'s mark');
check(guestMarks(['tester', 'falcon_eye', 'orbit', 'marlowe', 'rio', 'ivy']).join() === 'T,F,O,M,R,I', 'an initial, in capitals');
check(guestMarks(['Hank', 'Henry', 'ivy']).join() === 'Ha,He,I', 'two names that start alike get two letters each');
check(guestMarks(['Al', 'Alex', 'Bo']).join() === '1,2,B', 'if even two letters match, the seat numbers');
check(guestMarks(['_x1', '9lives', '']).join() === 'X,9,?', 'the first letter or digit; a name with none is "?"');
check(guestMarks(['élan', 'Zed']).join() === 'É,Z', 'a letter with an accent stays whole');
check(guestMarks(['a', 'b', 'c', 'd', 'e', 'f']).every(m => m.length >= 1 && m.length <= 2), 'always one or two characters');

// --- c. the match marker -------------------------------------------------------------------------------------
console.log('c. the match marker (src/matchMarker.js)');
const fake = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), map: m }; };
const T0 = Date.UTC(2026, 9, 14, 12, 0, 0);
{
  globalThis.localStorage = fake();
  check(matchMarker.take(T0) === false, 'nothing marked: nothing cut short');
  matchMarker.set(T0);
  check(JSON.parse(globalThis.localStorage.getItem(matchMarker.KEY)).t === T0 && matchMarker.KEY === 'hotelEscape.matchInProgress.v1', 'a match beginning writes the time under hotelEscape.matchInProgress.v1');
  check(!/role|hand|seed|player/i.test(globalThis.localStorage.getItem(matchMarker.KEY)), 'it holds nothing of the match: no role, no hand');
  check(matchMarker.take(T0 + 60_000) === true, 'still there at the next start (a minute later): a match was cut short');
  check(globalThis.localStorage.getItem(matchMarker.KEY) === null && matchMarker.take(T0 + 120_000) === false, 'taken once: it is gone, and the next start says nothing');
  matchMarker.set(T0); matchMarker.clear();
  check(matchMarker.take(T0 + 1000) === false, 'cleared when the match ends or is left: nothing cut short');
  matchMarker.set(T0);
  check(matchMarker.take(T0 + MAX_AGE_MS) === true, 'exactly 6 hours old still counts');
  matchMarker.set(T0);
  check(matchMarker.take(T0 + MAX_AGE_MS + 1) === false && globalThis.localStorage.getItem(matchMarker.KEY) === null, 'older than 6 hours: ignored, and removed');
  matchMarker.set(T0 + 3_600_000);
  check(matchMarker.take(T0) === false, 'a time in the future (a clock that changed) is ignored');
  for (const junk of ['garbage', '{}', '{"t":"x"}', '{"t":0}', 'null', '[]', '']) {
    globalThis.localStorage.setItem(matchMarker.KEY, junk);
    check(matchMarker.take(T0) === false && globalThis.localStorage.getItem(matchMarker.KEY) === null, `a damaged marker (${JSON.stringify(junk)}) is ignored and removed`);
  }
}
{
  delete globalThis.localStorage;
  let threw = false;
  try { matchMarker.set(); matchMarker.clear(); check(matchMarker.take() === false, 'no storage on this page: nothing is marked, nothing is cut short'); } catch { threw = true; }
  check(!threw, 'no storage: nothing throws');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  threw = false;
  try { matchMarker.set(); matchMarker.clear(); matchMarker.take(); } catch { threw = true; }
  check(!threw, 'storage that refuses every call (a private window): nothing throws');
  delete globalThis.localStorage;
}
check(LOST_MATCH.body === 'The game was restarted by your browser. Your last match was not finished and is counted as left early.' && LOST_MATCH.title.length > 0, 'the words say what happened, plainly');

// --- d. the roster and the ring ------------------------------------------------------------------------------
console.log('d. the lobby roster and the floor ring');
check(roster.every((r, i) => r.color === SEAT_COLORS[i]), 'the lobby roster\'s colours are the seat colours');
check(config.character.ringInactiveOpacity >= 0.55 && config.character.ringInactiveOpacity <= 0.65, `the other guests' rings are about 0.6 (${config.character.ringInactiveOpacity}), were 0.35`);
check(config.character.ringEdgeOpacity > 0 && config.character.ringEdgeActiveOpacity >= config.character.ringEdgeOpacity, 'every ring has a dark edge');
check(config.character.ringLightOpacity > 0 && config.character.ringLightActiveOpacity >= config.character.ringLightOpacity, 'and a thin light edge outside it (a dark edge alone shows nothing on the red rug)');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
