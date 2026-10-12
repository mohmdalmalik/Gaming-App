// Username rules, pure (no DOM, no storage: a server can run the same checks later).
//   3 to 16 characters: letters A-Z / a-z, digits 0-9 and _, starting with a letter. Case is kept for
//   show and ignored when names are compared ("Nora" and "nora" are the same name).
//   Reserved: the hotel's own words and the words of the rules' public log (src/data/names.js), and every
//   card and room name in the game's data, so a name can never read as a card, a room or part of a line
//   in the feed ("nora searched Kitchen.").
//   A light word filter (src/data/names.js). The real check belongs to a server once there is one.
import { SUGGEST, RESERVED, LOG_WORDS, FILTER } from '../data/names.js';
import { rules } from '../data/rules.js';
import { hotel } from '../data/hotel.js';

export const USERNAME = { min: 3, max: 16 };

// What the player reads when a name is refused (plain, short).
export const USERNAME_MESSAGES = {
  empty: 'Type a name first.',
  short: `At least ${USERNAME.min} characters.`,
  long: `At most ${USERNAME.max} characters.`,
  chars: 'Only letters, numbers and _ (no spaces).',
  start: 'Start with a letter.',
  reserved: 'That name belongs to the hotel. Try another.',
  filtered: 'Please choose a different name.',
};

// Case ignored.
export const sameName = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

let reservedCache = null;
// Every reserved word, lowercase: the fixed list, plus the cards' and rooms' names (a name of two words
// is reserved run together and with _: "FireExit", "Fire_Exit").
export function reservedWords() {
  if (reservedCache) return reservedCache;
  const set = new Set([...RESERVED, ...LOG_WORDS].map(w => w.toLowerCase()));
  const add = name => {
    if (typeof name !== 'string') return;
    const words = name.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!words.length) return;
    set.add(words.join(''));
    set.add(words.join('_'));
  };
  for (const c of Object.values(rules.cards || {})) add(c.name);
  for (const t of [hotel.lobby, ...(hotel.tiles || [])]) { add(t?.name); add(t?.short); }
  reservedCache = set;
  return set;
}

// --- The light filter ---
const decode = s => {
  try { return typeof atob === 'function' ? atob(s) : ''; } catch { return ''; }
};
const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's' };
// A word as a pattern that also catches stretched letters ("fuuuck"), never fewer letters than the word.
const pattern = w => w.split('').map(ch => `${ch}+`).join('');
let filterCache = null;
function filters() {
  if (filterCache) return filterCache;
  const words = list => list.map(decode).filter(w => /^[a-z]+$/.test(w));
  filterCache = {
    anywhere: words(FILTER.anywhere).map(w => new RegExp(pattern(w))),
    whole: words(FILTER.whole).map(w => new RegExp(`^${pattern(w)}$`)),
  };
  return filterCache;
}
// Whether a name trips the filter: lowercase, leetspeak read as letters, then the long words anywhere
// in the name (_ and digits taken out) and the short ones only as a whole part of it.
export function isFiltered(name) {
  if (typeof name !== 'string' || !name) return false;
  const split = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[0-9@$]/g, ch => LEET[ch] ?? ch);
  const parts = split.split(/[\s_0-9]+/).filter(Boolean);
  const joined = parts.join('');
  const f = filters();
  if (f.anywhere.some(re => re.test(joined))) return true;
  return parts.some(p => f.whole.some(re => re.test(p)));
}

// Check a name as typed: { ok: true, name } (trimmed) or { ok: false, code, message }.
export function checkUsername(raw, { reserved = reservedWords() } = {}) {
  const fail = code => ({ ok: false, code, message: USERNAME_MESSAGES[code] });
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) return fail('empty');
  if (!/^[A-Za-z0-9_]+$/.test(name)) return fail('chars');
  if (name.length < USERNAME.min) return fail('short');
  if (name.length > USERNAME.max) return fail('long');
  if (!/^[A-Za-z]/.test(name)) return fail('start');
  if (reserved.has(name.toLowerCase())) return fail('reserved');
  if (isFiltered(name)) return fail('filtered');
  return { ok: true, name };
}
export const isValidUsername = raw => checkUsername(raw).ok;

// A ready-made name: adjective_noun from hotel words ("velvet_owl"), always valid, never one of `avoid`.
export function suggestUsername(rng = Math.random, { avoid = [] } = {}) {
  const pick = list => list[Math.floor(rng() * list.length) % list.length];
  for (let tries = 0; tries < 60; tries++) {
    const name = `${pick(SUGGEST.adjectives)}_${pick(SUGGEST.nouns)}`;
    if (name.length > USERNAME.max) continue;
    if (avoid.some(a => sameName(a, name))) continue;
    if (checkUsername(name).ok) return name;
  }
  // (unlucky: a fixed word with a number, still valid and still not one to avoid)
  for (let k = 2; ; k++) {
    const name = `velvet_owl${k}`;
    if (!avoid.some(a => sameName(a, name))) return name;
  }
}
