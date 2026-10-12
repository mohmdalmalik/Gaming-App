// A random, plausible avatar for a computer guest (and a new player's first one). Pure (no three,
// no DOM): the same in a browser, in Node and on a server. Deterministic: seeded from the bot's USERNAME,
// so "nightowl" always looks like nightowl (like a real returning player), and it never touches the
// match's own random numbers (the table, the deal and the bots' choices stay exactly as they are).
// At one table: never two guests with the same look AND outfit colour, and at most two with the same
// look (a clash re-rolls with a salt: still deterministic).
import { BASES, ITEMS } from './wardrobe.js';

function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function hashString(s) {          // FNV-1a, 32 bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
function weighted(rng, entries) {        // [[value, weight], ...]
  const total = entries.reduce((s, e) => s + e[1], 0);
  let x = rng() * total;
  for (const [v, w] of entries) { if ((x -= w) < 0) return v; }
  return entries[entries.length - 1][0];
}
const free = slot => ITEMS.filter(i => i.slot === slot && i.unlock === 'free').map(i => i.id);

// taken: the avatars already at the table.
export function randomAvatar(username, { taken = [], salt = 0 } = {}) {
  const rng = mulberry32(hashString(`${username}#${salt}`));
  const base = pick(rng, Object.keys(BASES));
  const hasAccent = !!BASES[base].parts.accent, hasMetal = !!BASES[base].parts.metal;
  const main = pick(rng, free('main'));
  const av = {
    v: 1, base,
    skin: pick(rng, free('skin')),
    hair: weighted(rng, [['black', 3], ['darkBrown', 3], ['brown', 3], ['auburn', 1.5], ['copper', 1], ['blonde', 1.5], ['silver', 1.2]]),
    eyes: rng() < 0.5 ? 'classic' : pick(rng, free('eyes').filter(e => e !== 'classic')),
    glasses: rng() < 0.7 ? 'none' : weighted(rng, [['round', 3], ['oval', 2], ['deco', 2], ['pincenez', 1]]),
    frame: weighted(rng, [['tortoise', 3], ['jet', 2], ['silverFrame', 1]]),
    main,
    accent: hasAccent ? pick(rng, free('accent').filter(a => a !== main)) : 'black',
    metal: hasMetal ? (rng() < 0.7 ? 'gold' : 'silver') : 'gold',
  };
  // never the same look in the same colour as someone already at the table
  const clash = taken.some(t => t.base === av.base && t.main === av.main) || taken.filter(t => t.base === av.base).length >= 2;
  if (clash && salt < 12) return randomAvatar(username, { taken, salt: salt + 1 });
  return av;
}
