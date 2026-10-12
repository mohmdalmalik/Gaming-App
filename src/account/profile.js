// The player's profile, pure (no DOM, no storage: a server account can use the same shape later).
//   { version: 1,
//     id: 'local-3f9c2a7e5b1d4c08',   a random id made on this device; a server account can claim it later
//     username: 'velvet_owl',          as typed (case kept), compared without case (src/account/username.js)
//     avatar: { v: 1, base, skin, … }, catalogue ids only (src/data/wardrobe.js)
//     inventory: [],                   item ids owned beyond the free ones ('glasses.monocle'). Nothing can
//                                      be had yet: the locked items say "Coming soon".
//     createdAt, updatedAt, nameChangedAt }   ISO dates (updatedAt lets a server merge keep the newer)
import { checkUsername } from './username.js';
import { ITEMS, itemId, normaliseAvatar, avatarFromGuest } from '../data/wardrobe.js';
import { randomAvatar } from '../data/randomAvatar.js';

export const PROFILE_VERSION = 1;

// A new random id for this device (crypto when the browser or Node has it).
export function newProfileId() {
  const bytes = new Uint8Array(8);
  try { globalThis.crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return `local-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// The first avatar of a new player: their pick of a pleasant start, rolled from their name
// (src/data/randomAvatar.js). A player who chose a guest before ("Your guest", the old setting) starts
// in that guest's look; 'random' (or nothing) rolls one.
export function startingAvatar(username, legacyGuest = null) {
  return avatarFromGuest(legacyGuest) || normaliseAvatar(randomAvatar(String(username || 'guest')));
}

const iso = now => new Date(now ?? Date.now()).toISOString();
export function newProfile({ username, avatar, now, id } = {}) {
  const at = iso(now);
  return {
    version: PROFILE_VERSION,
    id: id || newProfileId(),
    username,
    avatar: normaliseAvatar(avatar || startingAvatar(username)),
    inventory: [],
    createdAt: at, updatedAt: at, nameChangedAt: at,
  };
}

const KNOWN_ITEMS = new Set(ITEMS.map(itemId));
const isDate = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));

// A saved profile made safe: { profile, repaired, readOnly?, kept? }. A valid username is kept and anything
// else damaged (avatar slots, dates, the inventory) is repaired. Without a valid username there is no
// profile (null: the register screen asks for a name again), but a name that was valid once and is no
// longer (a word reserved since) leaves `kept`: { id, avatar, inventory, createdAt } for the new name to
// keep. A profile saved by a NEWER version is read as well as this one can (`readOnly`: it must not be
// written over, or the newer fields would be lost). `repairAvatar(av)`: how avatars are made safe
// (default: the catalogue's, free items only). Older versions would be migrated here (there are none yet).
export function repairProfile(raw, { repairAvatar = av => normaliseAvatar(av), now } = {}) {
  let data = raw;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return { profile: null, repaired: true }; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { profile: null, repaired: raw != null };
  const readOnly = Number.isFinite(data.version) && data.version > PROFILE_VERSION;
  // (version migrations go here: if (data.version === 1) data = fromV1(data) …)
  const name = checkUsername(data.username);
  const at = iso(now);
  const created = isDate(data.createdAt) ? data.createdAt : at;
  const inventory = Array.isArray(data.inventory)
    ? [...new Set(data.inventory.filter(id => typeof id === 'string' && KNOWN_ITEMS.has(id)))] : [];
  const id = typeof data.id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(data.id) ? data.id : newProfileId();
  const avatar = repairAvatar(data.avatar && typeof data.avatar === 'object' ? data.avatar : startingAvatar(name.ok ? name.name : 'guest'));
  if (!name.ok) {
    const once = typeof data.username === 'string' && data.username.trim().length > 0;
    return { profile: null, repaired: true, readOnly, ...(once ? { kept: { id, avatar, inventory, createdAt: created } } : {}) };
  }
  const profile = {
    version: PROFILE_VERSION,
    id,
    username: name.name,
    avatar,
    inventory,
    createdAt: created,
    updatedAt: isDate(data.updatedAt) ? data.updatedAt : created,
    nameChangedAt: isDate(data.nameChangedAt) ? data.nameChangedAt : created,
  };
  if (readOnly) return { profile, repaired: false, readOnly };
  const repaired = JSON.stringify(profile) !== JSON.stringify(data);
  return { profile, repaired };
}
