// The wardrobe's Looks page, as data: three Looks of the player's own (saved, renamed, worn, deleted) and the six
// classic Looks (Victor, Marcus, Henry, Clara, Eleanor, Beatrice) as read-only presets. Pure (no DOM, no storage):
// src/account/account.js keeps the saved ones in the profile, and a server can check them with the same code later.
//
//   a saved Look  { name: 'Opening night', avatar: { v: 2, … }, savedAt: '2026-10-19T20:15:00.000Z' }   (an empty slot: null)
//   a preset      { id: 'victor', name: 'Victor', label: 'Tuxedo', avatar: LOOKS.victor, preset: true }
//
// A saved Look keeps what it was saved with, owned or not (made safe as a shape only: known pieces that fit its body
// and are in the game). Ownership is checked when it is WORN (wearing): an item the player does not have (any more)
// is listed as missing and the body's default is worn in its place, so nothing unowned ever reaches the profile's
// avatar or a match, and the page can say what is missing instead of failing silently (the screen spec, section 7).
import { LOOKS, LOOK_IDS, LOOK_LABELS, SLOTS_BY_GENDER, COLOUR_SLOTS, genderOf, item, itemId, labelOf, normaliseAvatar,
  ownsFrom } from '../data/wardrobe.js';

export const SAVED_LOOKS = 3;
export const LOOK_NAME = { max: 24 };
export const LOOK_NAME_MESSAGES = {
  empty: 'Give this look a name.',
  long: `At most ${LOOK_NAME.max} characters.`,
  chars: 'Letters, numbers, spaces and simple punctuation only.',
};
export const defaultLookName = index => `Look ${index + 1}`;

// A Look's name: what the player typed, tidied (spaces collapsed and trimmed), 1 to 24 characters of letters (any
// language), numbers, spaces and simple punctuation. It is shown only to its owner (a saved Look never reaches another
// player), so no word filter. -> { ok, name } or { ok: false, code, error }
export function checkLookName(raw) {
  if (typeof raw !== 'string') return { ok: false, code: 'empty', error: LOOK_NAME_MESSAGES.empty };
  const name = raw.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (!name) return { ok: false, code: 'empty', error: LOOK_NAME_MESSAGES.empty };
  if ([...name].length > LOOK_NAME.max) return { ok: false, code: 'long', error: LOOK_NAME_MESSAGES.long };
  if (!/^[\p{L}\p{M}\p{N} .,'’&!?()\-:;/#+]+$/u.test(name)) return { ok: false, code: 'chars', error: LOOK_NAME_MESSAGES.chars };
  return { ok: true, name };
}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isDate = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
// The shape-only repair of a saved Look's avatar (no ownership: that is checked when it is worn).
export const lookAvatar = av => normaliseAvatar(av, { trusted: true });

// One saved slot made safe: a saved Look, or null. Accepts the contract's first form too (a bare v2 avatar in the
// slot, before Looks had names): it is given the slot's default name.
export function repairSavedLook(raw, index = 0) {
  if (!isObj(raw)) return null;
  const bare = !Object.prototype.hasOwnProperty.call(raw, 'avatar');
  const av = bare ? raw : raw.avatar;
  if (!isObj(av)) return null;
  const named = bare ? null : checkLookName(raw.name);
  return {
    name: named?.ok ? named.name : defaultLookName(index),
    avatar: lookAvatar(av),
    savedAt: !bare && isDate(raw.savedAt) ? raw.savedAt : null,
  };
}
// The three slots made safe (always exactly three).
export function repairSavedLooks(list) {
  const saved = Array.isArray(list) ? list : [];
  return Array.from({ length: SAVED_LOOKS }, (_, k) => repairSavedLook(saved[k], k));
}
export const emptyLooks = () => Array(SAVED_LOOKS).fill(null);
// A slot number the player can write: 0, 1 or 2.
export const isSlot = i => Number.isInteger(i) && i >= 0 && i < SAVED_LOOKS;

// The six classic Looks, read-only, men first (in the order of the Looks: Victor, Marcus, Henry, Clara, Eleanor,
// Beatrice). Built when asked, from the catalogue's current Looks.
const NAMES = { victor: 'Victor', marcus: 'Marcus', henry: 'Henry', clara: 'Clara', eleanor: 'Eleanor', beatrice: 'Beatrice' };
export const PRESET_IDS = [...LOOK_IDS.m, ...LOOK_IDS.f];
export const isPreset = id => typeof id === 'string' && PRESET_IDS.includes(id);
export function presetLook(id) {
  if (!isPreset(id)) return null;
  return { id, name: NAMES[id], label: LOOK_LABELS[id], avatar: normaliseAvatar(LOOKS[id], { trusted: true }), preset: true };
}
export const presetLooks = (gender = null) => PRESET_IDS
  .filter(id => !gender || genderOf(LOOKS[id].body) === (gender === 'f' ? 'f' : 'm')).map(presetLook);

// What a Look is, in a few words for its card ("Tuxedo · Midnight · Swept").
export function lookSummary(av) {
  const a = lookAvatar(av), g = genderOf(a.body);
  const outfit = item(g === 'f' ? 'dress' : 'top', g === 'f' ? a.dress : a.top);
  return [labelOf(outfit, a.body), item('main', a.colours.main)?.label, labelOf(item('hairStyle', a.hairStyle), a.body)].filter(Boolean).join(' · ');
}

// A Look as the player can wear it now: { avatar (made safe with what they own), missing: [{ id, slot, label }] (each
// item of the Look they do not have, or that is not in the game any more; the default is worn in its place) }.
// `owns(globalId)`: the account's (default: free items only).
export function wearing(av, owns = ownsFrom([])) {
  const look = lookAvatar(av);
  const worn = normaliseAvatar(look, { owns });
  const missing = [];
  const note = (slot, id) => { const it = item(slot, id); if (it && it.draw !== 'none') missing.push({ id: itemId(it), slot: it.slot, label: labelOf(it, look.body) }); };
  for (const s of SLOTS_BY_GENDER[genderOf(look.body)]) if (worn[s] !== look[s]) note(s, look[s]);
  for (const x of look.extras) if (!worn.extras.includes(x)) note('extra', x);
  for (const s of COLOUR_SLOTS) if (worn.colours[s] !== look.colours[s]) note(s, look.colours[s]);
  return { avatar: worn, missing };
}
