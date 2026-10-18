// A random, plausible avatar for a computer guest (and a new player's first one). Pure (no three, no DOM): the same in
// a browser, in Node and on a server. Deterministic: seeded from the bot's USERNAME, so "nightowl" always looks like
// nightowl (like a real returning player), and it never touches the match's own random numbers (the table, the deal
// and the bots' choices stay exactly as they are).
//
// How a look is rolled (avatar v2, src/data/wardrobe.js): one of the six classic Looks to start from, then each piece
// kept or swapped for another piece of that body (about half of them: most players change a few things), then the
// colours (weighted towards the usual ones). Only pieces that are in the game (never a pending one), and only looks
// whose eyes show (src/data/wardrobe.js eyesShow).
//
// Unlockable items (achievement and boutique): about ONE BOT IN THREE wears one, so a rare item never shows who is a
// real person (the owner's fairness rule, BUILD-BRIEF 18 Oct 2026). Achievement items are twice as likely as boutique
// ones (more players earn than buy). Only an unlockable that would show is chosen (a frame colour needs glasses on).
// Bots wear them whether or not the switch UNLOCK_ALL_FOR_TESTING is on: they are seated `trusted` (src/table.js).
//
// At one table (`taken`: the avatars already seated, the player's own among them): never a look that `lookAlike`s
// one already there (same body, hairstyle, jacket or dress and a main colour a colour-blind player could confuse);
// a clash re-rolls with a salt, so it stays deterministic.
import { ITEMS, LOOKS, SLOTS_BY_GENDER, looksFor, genderOf, itemsFor, item, isFree, slotsFor, withItem, normaliseAvatar,
  lookAlike, eyesShow } from './wardrobe.js';

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

// The tuning (documented in docs/DECISIONS.md, "Wardrobe W1-A, data").
export const BOT_LOOKS = {
  swap: 0.5,                             // the chance each piece is swapped for another of that body
  lockedRate: 1 / 3,                     // the share of bots wearing one unlockable item
  rarityWeight: { rare: 2, showpiece: 1 },   // achievement items : boutique items
  glasses: 0.3,                          // the share of bots in glasses
  // weights within a slot (an id not listed weighs 1)
  weights: {
    facial: { none: 2.5, handlebar: 1, pencil: 1.2 },
    glasses: { round: 3, oval: 2, deco: 2, pincenez: 1 },
    hair: { black: 3, darkBrown: 3, brown: 3, auburn: 1.5, copper: 1, blonde: 1.5, silver: 1.2 },
    frame: { tortoise: 3, jet: 2, silverFrame: 1 },
    metal: { gold: 7, silver: 3 },
  },
  tries: 40,                             // salted re-rolls before giving up on a clash (never needed in 2000 tables)
};
const W = BOT_LOOKS.weights;
// The free choices of a slot on a body, weighted.
const freeOf = (slot, body) => itemsFor(slot, body).filter(isFree).map(it => [it.id, W[slot]?.[it.id] ?? 1]);

// The unlockable items this avatar could show one of: every non-free item offered on its body whose colour row the
// avatar uses (a colour) or that is a piece of its gender (a piece, an extra).
function unlockablesFor(av) {
  const rows = new Set(slotsFor(av));
  return ITEMS.filter(it => !isFree(it) && itemsFor(it.slot, av.body).includes(it)
    && (it.draw === 'colour' ? rows.has(it.slot) && it.slot !== 'lips' : rows.has(it.slot === 'extra' ? 'extras' : it.slot)));
}

// taken: the avatars already at the table. unlockables: false for a new player's first look (free items only).
// swapPieces: false keeps the classic Look's own pieces and earrings (a new player's first look, until the new
// wardrobe screen can show other pieces: today's stand-in offers only the six Looks, so a mix would be lost on a tap).
export function randomAvatar(username, { taken = [], salt = 0, unlockables = true, swapPieces = true } = {}) {
  const rng = mulberry32(hashString(`${username}#${salt}`));
  const trusted = { trusted: true };
  const gender = rng() < 0.5 ? 'm' : 'f';
  const look = LOOKS[pick(rng, looksFor(gender))];
  let av = normaliseAvatar(look, trusted);
  // the pieces: each kept, or swapped for a free piece of that body (the dress first: in the fallback it picks the body)
  const order = gender === 'f' ? ['dress', ...SLOTS_BY_GENDER.f.filter(s => s !== 'dress')] : SLOTS_BY_GENDER.m;
  for (const slot of order) {
    if (slot === 'glasses') continue;
    const swap = rng() < BOT_LOOKS.swap;
    const choices = freeOf(slot, av.body);
    if (swap && swapPieces && choices.length > 1) av = withItem(av, slot, weighted(rng, choices), trusted);
  }
  // earrings (the women's Looks wear one pair): kept, or another free pair
  const ears = itemsFor('extra', av.body).filter(it => isFree(it) && (it.attach === 'ears'));
  if (gender === 'f' && ears.length > 1 && rng() < BOT_LOOKS.swap && swapPieces) {
    const pair = pick(rng, ears);
    if (!av.extras.includes(pair.id)) av = withItem(av, 'extra', pair.id, trusted);
  }
  // the colours
  const main = weighted(rng, freeOf('main', av.body).map(([id]) => [id, 1]));
  const colours = {
    skin: weighted(rng, freeOf('skin', av.body).map(([id]) => [id, 1])),
    hair: weighted(rng, freeOf('hair', av.body)),
    eyes: rng() < 0.5 ? 'classic' : weighted(rng, freeOf('eyes', av.body).filter(([id]) => id !== 'classic').map(([id]) => [id, 1])),
    main,
    accent: weighted(rng, freeOf('accent', av.body).filter(([id]) => id !== main).map(([id]) => [id, 1])),
    metal: weighted(rng, freeOf('metal', av.body)),
    frame: weighted(rng, freeOf('frame', av.body)),
    lips: 'natural',
  };
  av = normaliseAvatar({ ...av, colours }, trusted);
  if (rng() < BOT_LOOKS.glasses) av = withItem(av, 'glasses', weighted(rng, freeOf('glasses', av.body).filter(([id]) => id !== 'none')), trusted);
  else if (av.glasses !== 'none') av = withItem(av, 'glasses', 'none', trusted);
  // one unlockable, for about one bot in three
  if (unlockables && rng() < BOT_LOOKS.lockedRate) {
    const can = unlockablesFor(av);
    if (can.length) {
      const it = weighted(rng, can.map(x => [x, BOT_LOOKS.rarityWeight[x.rarity] ?? 1]));
      av = withItem(av, it.slot, it.id, trusted);
    }
  }
  const seated = taken.filter(Boolean);
  const clash = seated.some(t => lookAlike(t, av)) || !eyesShow(av);
  if (clash && salt < BOT_LOOKS.tries) return randomAvatar(username, { taken, salt: salt + 1, unlockables, swapPieces });
  return av;
}

// The avatars of a table's computer guests, in seat order: each from its username, none alike to one already at the
// table (`taken`: the player's own avatar first).
export function tableAvatars(usernames, { taken = [] } = {}) {
  const seated = [...taken];
  return usernames.map(u => { const av = randomAvatar(u, { taken: seated }); seated.push(av); return av; });
}

// (tests) how many unlockable items an avatar wears
export const unlockablesWorn = av => {
  const a = normaliseAvatar(av, { trusted: true });
  const ids = [...SLOTS_BY_GENDER[genderOf(a.body)].map(s => item(s, a[s])), ...a.extras.map(id => item('extra', id)),
    ...Object.entries(a.colours).map(([s, id]) => item(s, id))];
  return ids.filter(it => it && !isFree(it)).length;
};
