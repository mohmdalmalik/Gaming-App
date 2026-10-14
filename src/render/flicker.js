// The flicker of the two spooky corridors' light (Service Corridor, Back Stairs Passage: `flicker` in
// src/data/hotel.js), as plain functions of time so tests/flicker-check.mjs can measure it without a
// browser. Photosensitive viewers: the light steps `speed` times a second, never more than about 3 flashes
// a second of a large area (a flash: a pair of opposite changes of 10 % or more of the light), and with
// Reduce Motion (src/motion.js) it holds perfectly steady.
function hash(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// The room's light level now, between f.min and f.max (1 = normal light). `calm`: Reduce Motion is on:
// the middle of the range, the same at every moment.
export function flickerLevel(time, f, seed, calm = false) {
  if (calm) return (f.min + f.max) / 2;
  const step = Math.floor(time * f.speed) + Math.floor(seed * 100);
  const noise = hash(step);
  const slow = 0.5 + 0.5 * Math.sin(time * 2.3 + seed);
  return f.min + (f.max - f.min) * (0.65 * noise + 0.35 * slow);
}

// A baked room's light is in its light map: the whole map is dimmed by the bulb, but never below this
// share of its light (0.45), so a flickering room still shows its shapes. 1 at level 1.
export const bakedScale = level => 0.45 + 0.55 * level;
