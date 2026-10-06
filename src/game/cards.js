// Cards, the draw deck and dealing. Pure logic (no rendering, no global randomness): all
// shuffling goes through a seeded generator passed in, so a game is reproducible in tests.
import { rules } from '../data/rules.js';

export const CARDS = rules.cards;

// A small deterministic PRNG (mulberry32). Returns a function giving floats in [0, 1).
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let nextId = 1;
export function makeCard(type) {
  const meta = CARDS[type];
  const card = { id: `c${nextId++}`, type };
  if (meta?.shots != null) card.shots = meta.shots; // per-instance ammo (revolver)
  return card;
}

// The draw pile (Possession cards are never in it).
export function buildDrawDeck(spec = rules.deck) {
  const deck = [];
  for (const [type, count] of Object.entries(spec)) {
    for (let i = 0; i < count; i++) deck.push(makeCard(type));
  }
  return deck;
}

export function buildPossessionSupply() {
  return Array.from({ length: rules.possessionSupply }, () => makeCard('possession'));
}


// Fisher–Yates using the seeded rng.
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Deal the starting hands. The Lanterns are taken out first; every guest gets
// rules.lanternsDealtEach (1, approved) of them, and the rest of each hand (up to handSize, 4) comes
// from the shuffled deck without Lanterns — so 1 Lantern + 3 other cards each. The remaining Lanterns
// are then shuffled back into what is left. `rng` shuffles that remainder. (The possessed guest's
// Possession cards are added on top by resetState in state.js.)
export function deal(deck, playerCount, rng) {
  const hands = Array.from({ length: playerCount }, () => []);
  const lanterns = deck.filter(c => c.type === 'lantern');
  const rest = deck.filter(c => c.type !== 'lantern');
  for (let p = 0; p < playerCount; p++) {
    for (let k = 0; k < (rules.lanternsDealtEach || 0) && lanterns.length; k++) hands[p].push(lanterns.shift());
  }
  for (let p = 0; p < playerCount; p++) {
    while (hands[p].length < rules.handSize && rest.length) hands[p].push(rest.shift());
  }
  const remaining = shuffle([...rest, ...lanterns], rng);
  return { hands, deck: remaining };
}

// --- Hand helpers ------------------------------------------------------------------------
// Possession cards are the possessed side's hidden supply: they never count toward the hand limit,
// can't be discarded and never show in the public card count, so the number of cards on screen
// never gives away a role. Lanterns are ordinary cards and count like any other.
export const isCountable = card => card.type !== 'possession';
export const hasEscapeLanterns = hand =>
  hand.filter(c => c.type === 'lantern').length >= rules.lanternsToEscape;
export const countableCards = hand => hand.filter(isCountable);
export const countableCount = hand => hand.reduce((n, c) => n + (isCountable(c) ? 1 : 0), 0);

export const countType = (hand, type) => hand.reduce((n, c) => n + (c.type === type ? 1 : 0), 0);
export const hasType = (hand, type) => hand.some(c => c.type === type);
export const lanternCount = hand => countType(hand, 'lantern');
export const weaponsIn = hand => hand.filter(c => CARDS[c.type]?.weapon);
export const isWeapon = card => !!CARDS[card?.type]?.weapon;
export const isEvil = card => !!CARDS[card?.type]?.evil;

export function takeCard(hand, cardId) {
  const i = hand.findIndex(c => c.id === cardId);
  return i >= 0 ? hand.splice(i, 1)[0] : null;
}
