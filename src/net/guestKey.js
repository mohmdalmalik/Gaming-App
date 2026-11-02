// THE DEVICE KEY (DESIGN §11.4): who this device is to the Co-op server, so it can come back to its seat after a
// drop, a reload or an app switch. The server makes the key (24 random bytes, base64url) and sends it in `welcome`;
// the device keeps it here and sends it back only in `hello`, never in a URL. It is separate from the profile
// (hotelEscape.profile.v1): the key says which device, the profile what the player is called and wears.
//
//   guestKey({ storage, key })  ->  { token, persistent, storage, set(token) }
//     storage     where the key lives. Default: localStorage, then sessionStorage, then memory (a private window or
//                 blocked storage still plays, it just can't come back after a reload). The review link's second seat
//                 and the Node tests hand in their own memory storage, so two seats on one device have two keys.
//     key         the storage key (ONLINE.storage.guest)
//     token       the kept key, or null (the server then makes one)
//     persistent  true when the key survives a reload of this page (the browser's own localStorage)
//     set(token)  keep the key the server sent (a value that isn't a key is ignored)
//
//   pickStorage(storage)  ->  { storage, persistent }   the same choice, for the table record (src/net/onlineTable.js)
//   memoryStorage()       ->  a storage that lives as long as this page (getItem / setItem / removeItem)
//
// Every read and write is guarded: blocked storage never stops a page.
import { ONLINE } from '../data/online.js';

// The shape of a key the server hands out and accepts back (src/net/rooms.js keeps one matching this).
export const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(String(k)); },
  };
}

// Does writing to this storage stick? (Safari's private mode used to throw on setItem; blocked storage throws on access.)
function works(s) {
  try {
    if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return false;
    const probe = `${ONLINE.storage.guest}.probe`;
    s.setItem(probe, '1');
    const ok = s.getItem(probe) === '1';
    s.removeItem?.(probe);
    return ok;
  } catch { return false; }
}
const browserStore = name => { try { return globalThis[name] || null; } catch { return null; } };

export function pickStorage(storage) {
  if (storage) {
    let local = null;
    try { local = globalThis.localStorage || null; } catch { /* blocked */ }
    return { storage, persistent: storage === local && works(storage) };
  }
  const local = browserStore('localStorage');
  if (works(local)) return { storage: local, persistent: true };
  const session = browserStore('sessionStorage');
  if (works(session)) return { storage: session, persistent: false };
  return { storage: memoryStorage(), persistent: false };
}

export function guestKey({ storage, key = ONLINE.storage.guest } = {}) {
  const picked = pickStorage(storage);
  let token = null;
  try {
    const t = picked.storage.getItem(key);
    token = typeof t === 'string' && TOKEN_RE.test(t) ? t : null;
  } catch { /* unreadable: a new guest */ }
  const g = {
    token,
    persistent: picked.persistent,
    storage: picked.storage,
    set(next) {
      if (typeof next !== 'string' || !TOKEN_RE.test(next) || next === g.token) return;
      g.token = next;
      try { picked.storage.setItem(key, next); } catch { /* kept for this page only */ }
    },
  };
  return g;
}
