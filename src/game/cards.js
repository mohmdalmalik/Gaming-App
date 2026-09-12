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

// The searchable draw pile (Possession cards are excluded — they are the possessed supply).
export function buildDrawDeck() {
  const deck = [];
  for (const [type, count] of Object.entries(rules.deck)) {
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

// Deal `handSize` cards to each of `playerCount` players, guaranteeing one Lantern each
// when the rules ask for it. Mutates and returns the remaining draw pile.
export function deal(deck, playerCount) {
  const hands = Array.from({ length: playerCount }, () => []);
  if (rules.guaranteedLantern) {
    for (let p = 0; p < playerCount; p++) {
      const i = deck.findIndex(c => c.type === 'lantern');
      if (i >= 0) hands[p].push(deck.splice(i, 1)[0]);
    }
  }
  for (let p = 0; p < playerCount; p++) {
    while (hands[p].length < rules.handSize && deck.length) hands[p].push(deck.shift());
  }
  return { hands, deck };
}

// --- Hand helpers ------------------------------------------------------------------------
// Possession cards are the possessed side's hidden supply. They do NOT count toward the hand
// limit and are hidden from the public card count, so no-one can deduce who is possessed from
// the number of cards on screen. They remain fully tradeable.
export const isCountable = card => card.type !== 'possession';
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
