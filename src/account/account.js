// The player's account: who they are (a username) and how they look (an avatar). For now it lives on
// this device only (localStorage, key 'hotelEscape.profile.v1'), behind an interface that is already
// asynchronous, so a server account (Sign in with Apple / Google) can replace the store later with the
// same calls. Callers (the menu, main.js) never touch storage.
//
//   account.ready                  a Promise (resolved at once on the device)
//   account.profile                a frozen copy of the profile (src/account/profile.js), or null before
//                                  sign-up
//   account.persistent             false when this device keeps nothing (blocked or full storage): the
//                                  profile then lasts for this visit only
//   account.signUp(username)       -> Promise<{ ok, error? }>   error: the reason, in plain words
//   account.rename(username)       -> Promise<{ ok, error? }>
//   account.setAvatar(avatar)      -> Promise<{ ok, avatar }>   made safe (normaliseAvatar, owned items only)
//   account.owns(itemId)           -> boolean ('glasses.monocle'): the free items, nothing else yet
//   account.onChange(fn)           -> unsubscribe; fn(profile) after every change (here or in another tab)
//
// Like src/record.js, every read and write is guarded: a private window or blocked storage still plays.
import { checkUsername } from './username.js';
import { newProfile, repairProfile, startingAvatar } from './profile.js';
import { ITEMS, itemId, isAvailable, normaliseAvatar } from '../data/wardrobe.js';

export const PROFILE_KEY = 'hotelEscape.profile.v1';

// Nothing can be unlocked yet (the locked items say "Coming soon"): an item id in the inventory grants
// nothing until unlocking exists, and then a server must check it (never trust the device's list).
const UNLOCKING = false;

const deepFreeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
const copy = p => (p ? deepFreeze(JSON.parse(JSON.stringify(p))) : null);

// The device's store: localStorage, every access guarded. load() -> the saved text, null (nothing saved)
// or undefined (storage cannot be read); save(text) -> true when kept; works() -> whether writes stick.
export function deviceStore(key = PROFILE_KEY) {
  const ls = () => { try { return globalThis.localStorage || null; } catch { return null; } };
  return {
    load() { try { const s = ls(); return s ? s.getItem(key) : undefined; } catch { return undefined; } },
    save(text) { try { const s = ls(); if (!s) return false; s.setItem(key, text); return true; } catch { return false; } },
    works() {
      try {
        const s = ls(); if (!s) return false;
        const probe = `${key}.probe`;
        s.setItem(probe, '1'); s.removeItem(probe);
        return true;
      } catch { return false; }
    },
    // (another tab of the game changed the profile)
    watch(fn) {
      try {
        const on = e => { if (e.key === key || e.key === null) fn(); };
        globalThis.addEventListener?.('storage', on);
        return () => globalThis.removeEventListener?.('storage', on);
      } catch { return () => {}; }
    },
  };
}

// A memory-only store (tests, and a device that keeps nothing).
export function memoryStore(initial = null, { broken = false } = {}) {
  let text = initial;
  return {
    load: () => (broken ? undefined : text),
    save: t => { if (broken) return false; text = t; return true; },
    works: () => !broken,
    watch: () => () => {},
  };
}

export function createAccount({ store = deviceStore(), now = () => Date.now() } = {}) {
  let profile = null;
  let persistent = store.works();
  const listeners = new Set();

  function read() {
    const raw = store.load();
    if (raw === undefined) return { profile: null, readable: false };
    if (raw === null || raw === '') return { profile: null, readable: true };
    const out = repairProfile(raw, { repairAvatar: av => normaliseAvatar(av, { owns }) });
    return { profile: out.profile, repaired: out.repaired, readable: true };
  }
  function write() {
    const ok = store.save(JSON.stringify(profile));
    if (!ok) persistent = false;
    return ok;
  }
  function emit() {
    const p = copy(profile);
    for (const fn of [...listeners]) { try { fn(p); } catch (err) { console.error('account listener failed:', err); } }
  }

  const loaded = read();
  profile = loaded.profile;
  if (!loaded.readable) persistent = false;
  if (profile && loaded.repaired && persistent) write();      // (a repaired profile is saved back)

  store.watch?.(() => {
    const again = read();
    if (!again.readable) return;
    if (JSON.stringify(again.profile) === JSON.stringify(profile)) return;
    profile = again.profile;
    emit();
  });

  function owns(id) {
    const it = ITEMS.find(i => itemId(i) === id);
    if (!it) return false;
    if (it.unlock === 'free') return true;
    return UNLOCKING && !!profile?.inventory?.includes(id);
  }
  const stamp = () => new Date(now()).toISOString();

  const account = {
    ready: Promise.resolve(),
    get profile() { return copy(profile); },
    get persistent() { return persistent; },
    owns,

    // Sign the register. `avatar` (optional): the first look; otherwise rolled from the name.
    async signUp(username, { avatar = null } = {}) {
      const check = checkUsername(username);
      if (!check.ok) return { ok: false, error: check.message, code: check.code };
      if (profile) return account.rename(check.name);
      profile = newProfile({ username: check.name, avatar: normaliseAvatar(avatar || startingAvatar(check.name), { owns }), now: now() });
      write();
      try { globalThis.navigator?.storage?.persist?.()?.catch?.(() => {}); } catch { /* best effort */ }
      emit();
      return { ok: true };
    },

    async rename(username) {
      const check = checkUsername(username);
      if (!check.ok) return { ok: false, error: check.message, code: check.code };
      if (!profile) return account.signUp(check.name);
      if (check.name !== profile.username) {
        const at = stamp();
        profile = { ...profile, username: check.name, updatedAt: at, nameChangedAt: at };
        write();
        emit();
      }
      return { ok: true };
    },

    async setAvatar(avatar) {
      const safe = normaliseAvatar(avatar, { owns });
      if (!profile) return { ok: false, avatar: safe };
      if (JSON.stringify(safe) !== JSON.stringify(profile.avatar)) {
        profile = { ...profile, avatar: safe, updatedAt: stamp() };
        write();
        emit();
      }
      return { ok: true, avatar: copy(safe) };
    },

    onChange(fn) {
      if (typeof fn !== 'function') return () => {};
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return account;
}

// (whether an item may be worn by this player: free, or owned)
export const wearable = (acct, it) => isAvailable(it, id => acct.owns(id));

// The device's account (the game's one).
export const account = createAccount();
