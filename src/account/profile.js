// The player's profile, pure (no DOM, no storage: a server account can use the same shape later).
//   { version: 2,
//     id: 'local-3f9c2a7e5b1d4c08',   a random id made on this device; a server account can claim it later
//     username: 'velvet_owl',          as typed (case kept), compared without case (src/account/username.js)
//     avatar: { v: 2, body, face, … }, catalogue ids only (src/data/wardrobe.js, avatar v2)
//     inventory: [],                   item ids owned beyond the free ones ('glasses.monocle', 'extra.lantern'):
//                                      the achievement items earned on this device (account.grant)
//     looks: [null, null, null],       three saved Looks (v2 avatars) for the new wardrobe; empty for now
//     createdAt, updatedAt, nameChangedAt }   ISO dates (updatedAt lets a server merge keep the newer)
// A version 1 profile (an avatar of one of six looks, recoloured) is migrated when it is read: the avatar becomes
// the v2 Look it was (src/data/wardrobe.js avatarFromV1: lossless), the inventory keeps its ids (each keeps its
// meaning), `looks` is added; the repaired profile is then written back once (src/account/account.js).
import { checkUsername } from './username.js';
import { ITEMS, itemId, normaliseAvatar, avatarFromGuest, ownsFrom } from '../data/wardrobe.js';
import { randomAvatar } from '../data/randomAvatar.js';

export const PROFILE_VERSION = 2;
export const SAVED_LOOKS = 3;

// A new random id for this device (crypto when the browser or Node has it).
export function newProfileId() {
  const bytes = new Uint8Array(8);
  try { globalThis.crypto.getRandomValues(bytes); } catch { for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256); }
  return `local-${[...bytes].map(b => b.toString(16).padStart(2, '0')).join('')}`;
}

// The first avatar of a new player: their pick of a pleasant start, rolled from their name
// (src/data/randomAvatar.js, free items only). A player who chose a guest before ("Your guest", the old setting)
// starts in that guest's look; 'random' (or nothing) rolls one.
export function startingAvatar(username, legacyGuest = null) {
  return avatarFromGuest(legacyGuest) || normaliseAvatar(randomAvatar(String(username || 'guest'), { unlockables: false, swapPieces: false }));
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
    looks: Array(SAVED_LOOKS).fill(null),
    createdAt: at, updatedAt: at, nameChangedAt: at,
  };
}

const KNOWN_ITEMS = new Set(ITEMS.map(itemId));
const isDate = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
// The default way an avatar is made safe: owned items are what the profile's own (repaired) inventory says.
const repairWith = (av, { inventory = [] } = {}) => normaliseAvatar(av, { owns: ownsFrom(inventory) });

// A version 1 profile as version 2 (the avatar is migrated by the avatar repair itself: normaliseAvatar reads v1).
export function fromV1(data) {
  return { ...data, version: PROFILE_VERSION, looks: Array(SAVED_LOOKS).fill(null) };
}

// A saved profile made safe: { profile, repaired, readOnly?, kept? }. A valid username is kept and anything
// else damaged (avatar slots, dates, the inventory, the saved Looks) is repaired. Without a valid username there is
// no profile (null: the register screen asks for a name again), but a name that was valid once and is no longer (a
// word reserved since) leaves `kept`: { id, avatar, inventory, looks, createdAt } for the new name to keep. A profile
// saved by a NEWER version is read as well as this one can (`readOnly`: it must not be written over, or the newer
// fields would be lost). `repairAvatar(av, { inventory })`: how avatars are made safe, given the inventory repaired
// first (default: the catalogue's, owning the free items and that inventory). A version 1 profile (or one with no
// version) is migrated to version 2 first.
export function repairProfile(raw, { repairAvatar = repairWith, now } = {}) {
  let data = raw;
  if (typeof data === 'string') { try { data = JSON.parse(data); } catch { return { profile: null, repaired: true }; } }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { profile: null, repaired: raw != null };
  const original = data;
  const readOnly = Number.isFinite(data.version) && data.version > PROFILE_VERSION;
  if (!readOnly && data.version !== PROFILE_VERSION) data = fromV1(data);
  const name = checkUsername(data.username);
  const at = iso(now);
  const created = isDate(data.createdAt) ? data.createdAt : at;
  const inventory = Array.isArray(data.inventory)
    ? [...new Set(data.inventory.filter(id => typeof id === 'string' && KNOWN_ITEMS.has(id)))] : [];
  const id = typeof data.id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(data.id) ? data.id : newProfileId();
  const avatar = repairAvatar(data.avatar && typeof data.avatar === 'object' ? data.avatar : startingAvatar(name.ok ? name.name : 'guest'), { inventory });
  const saved = Array.isArray(data.looks) ? data.looks : [];
  const looks = Array.from({ length: SAVED_LOOKS }, (_, k) => (saved[k] && typeof saved[k] === 'object' ? repairAvatar(saved[k], { inventory }) : null));
  if (!name.ok) {
    const once = typeof data.username === 'string' && data.username.trim().length > 0;
    return { profile: null, repaired: true, readOnly, ...(once ? { kept: { id, avatar, inventory, looks, createdAt: created } } : {}) };
  }
  const profile = {
    version: PROFILE_VERSION,
    id,
    username: name.name,
    avatar,
    inventory,
    looks,
    createdAt: created,
    updatedAt: isDate(data.updatedAt) ? data.updatedAt : created,
    nameChangedAt: isDate(data.nameChangedAt) ? data.nameChangedAt : created,
  };
  if (readOnly) return { profile, repaired: false, readOnly };
  const repaired = JSON.stringify(profile) !== JSON.stringify(original);     // (a migrated v1 profile always is)
  return { profile, repaired };
}
