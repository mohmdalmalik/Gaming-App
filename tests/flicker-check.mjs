// The flicker of the two spooky corridors, measured (no browser): node tests/flicker-check.mjs
//
// Photosensitive viewers: the light of a whole room must not flash more than 3 times in any second (a
// flash: a pair of opposite changes of 10 % or more of the light), and with Reduce Motion on it must not
// move at all. This runs the game's own function (src/render/flicker.js) with the corridors' own settings
// (src/data/hotel.js) for 60 different bulbs over ten minutes each, and counts. The browser side (that the
// real page reads the setting and holds the real lights steady) is checked by section d of
// tests/browser-build-fixes.mjs, with Playwright's reducedMotion: 'reduce'.
import { hotel } from '../src/data/hotel.js';
import { flickerLevel, bakedScale } from '../src/render/flicker.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

// Which rooms flicker, with which numbers.
const flickering = [hotel.lobby, ...hotel.tiles].filter(r => r.mood?.flicker);
check(flickering.map(r => r.id).sort().join() === 'backCorridor,serviceCorridor', `the rooms that flicker: ${flickering.map(r => r.name).join(', ')}`);
const F = flickering[0].mood.flicker;
check(flickering.every(r => r.mood.flicker === F || JSON.stringify(r.mood.flicker) === JSON.stringify(F)), 'both flicker the same way');
console.log(`  (their flicker: ${JSON.stringify(F)})`);

// The most "flashes" any second of the whole room's light has: the light is sampled 120 times a second;
// a SWING is a move from one extreme to the opposite one of at least `min` of the full light (1.0); a flash
// is two swings, so 3 flashes a second = 6 swings in any 1-second window.
function measure(cfg, calm, { seeds = 60, seconds = 600, hz = 120, min = 0.10 } = {}) {
  let worstSwings = 0, biggestStep = 0, lowest = 1, highest = 0, movement = 0;
  for (let k = 0; k < seeds; k++) {
    const seed = k * 7.31;              // (a room view's own seed: src/render/roomView.js)
    const swingAt = [];                 // the times of the swings
    let pivot = null, cur = 0, dir = 0, prev = null;     // (a zigzag filter: the last extreme, and the way the light is going)
    for (let i = 0; i < seconds * hz; i++) {
      const t = i / hz;
      const L = bakedScale(flickerLevel(t, cfg, seed, calm));    // the share of the room's light the walls get
      lowest = Math.min(lowest, L); highest = Math.max(highest, L);
      if (prev != null) { biggestStep = Math.max(biggestStep, Math.abs(L - prev)); movement += Math.abs(L - prev); }
      prev = L;
      if (pivot == null) { pivot = cur = L; continue; }
      if (dir === 0) { if (Math.abs(L - pivot) >= min) { dir = Math.sign(L - pivot); cur = L; swingAt.push(t); } continue; }
      if (dir > 0) { if (L > cur) cur = L; else if (cur - L >= min) { dir = -1; cur = L; swingAt.push(t); } }
      else if (L < cur) cur = L; else if (L - cur >= min) { dir = 1; cur = L; swingAt.push(t); }
    }
    // the busiest second: swings in [t, t + 1)
    for (let a = 0, b = 0; a < swingAt.length; a++) {
      while (b < swingAt.length && swingAt[b] < swingAt[a] + 1) b++;
      worstSwings = Math.max(worstSwings, b - a);
    }
  }
  return { worstSwings, flashes: worstSwings / 2, biggestStep, lowest, highest, movement };
}

console.log('\nthe flicker everyone sees');
const now = measure(F, false);
console.log(`  (worst second: ${now.worstSwings} big swings = ${now.flashes} flashes; light between ${now.lowest.toFixed(3)} and ${now.highest.toFixed(3)}; biggest single step ${now.biggestStep.toFixed(3)})`);
check(now.flashes <= 3, `no second has more than 3 flashes of the whole room's light (the worst: ${now.flashes})`);
check(F.speed <= 6, `the light steps at most 6 times a second (it steps ${F.speed})`);
check(F.min >= 0.5 && F.max <= 1, `and stays between half and all of its normal light (${F.min} to ${F.max})`);
check(now.lowest >= bakedScale(0.5) - 1e-9, `the baked walls never go below ${bakedScale(0.5).toFixed(3)} of their light (they reach ${now.lowest.toFixed(3)})`);
check(now.highest - now.lowest > 0.1, 'it still flickers: the swing of the light is visible (the mood stays spooky)');

// The measure itself can tell the difference: the old setting (10 steps a second, down to 0.3) was over the line.
const old = measure({ min: 0.3, max: 1.0, speed: 10 }, false);
console.log(`  (control, the setting before this fix: worst second ${old.worstSwings} swings = ${old.flashes} flashes)`);
check(old.flashes > 3, 'control: the old setting (10 a second, down to 0.3) does show more than 3 flashes in a second, so this check can fail');

console.log('\nReduce Motion');
const calm = measure(F, true, { seeds: 10, seconds: 120 });
check(calm.movement === 0 && calm.lowest === calm.highest, `the light never moves at all (${calm.movement} of movement over 20 minutes)`);
const mid = (F.min + F.max) / 2;
check([0, 0.017, 1, 3.3, 99.9, 12345.6].every(t => flickerLevel(t, F, 7.31, true) === mid), `it is held at the middle of its range (${mid}), whatever the time`);
check(flickerLevel(1, F, 0, true) === flickerLevel(1, F, 99, true), 'the same for every bulb');

console.log(failures ? `\n${failures} FAILED` : '\nALL FLICKER CHECKS PASSED');
process.exit(failures ? 1 : 0);
