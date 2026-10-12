// The table's quick-chat channel: the one road every chat message takes, from whoever says it to
// everyone at the table. Pure (no DOM): a message is { seat, id, at } — who, which preset line or emote
// (src/data/chat.js), and when — or { seat, id, about, at } for a line that names a guest (`about`: that
// guest's seat). Nothing else rides along, so a message can never carry a role, a card or a private result.
//
// Today the whole table is on this device: the player's own messages (say) and the computer guests'
// (post) are delivered straight to the listeners. Online, say() would send to the server and the
// server's relay would come back through post() — the interface (src/ui/chat.js) would not change. The
// cooldown is the sender's own manners, and cleanMessage the shape every message must have; a server
// would check both again (never trust the client).
import { CHAT, CHAT_PHRASES, CHAT_EMOTES, ABOUT_IDS } from '../data/chat.js';

const IDS = new Set([...CHAT_PHRASES, ...CHAT_EMOTES].map(x => x.id));
export const isChatId = id => IDS.has(id);
// Does this line name a guest (and so need `about`)?
export const needsAbout = id => ABOUT_IDS.has(id);

// The message as it may travel, or null. `seats`: how many seats the table has. A line that names a guest
// must name another seat at the table (never the speaker's own); any other line carries no `about`; any
// other field is dropped.
export function cleanMessage(msg, seats = Infinity, now = 0) {
  if (!msg || !Number.isInteger(msg.seat) || msg.seat < 0 || msg.seat >= seats || !isChatId(msg.id)) return null;
  const m = { seat: msg.seat, id: msg.id, at: Number.isFinite(msg.at) ? msg.at : now };
  if (needsAbout(msg.id)) {
    if (!Number.isInteger(msg.about) || msg.about < 0 || msg.about >= seats || msg.about === msg.seat) return null;
    m.about = msg.about;
  }
  return m;
}

// `seats()`: how many seats the table has now (a message naming a seat beyond it is refused).
export function createChatChannel({ now = () => Date.now(), cooldownMs = CHAT.cooldownMs, seats = () => Infinity } = {}) {
  const listeners = new Set();
  const lastSent = new Map();     // seat -> when it last sent (this device's own seats)

  const deliver = msg => { for (const fn of listeners) { try { fn(msg); } catch (err) { console.warn('chat listener failed:', err); } } };

  return {
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // How long `seat` still has to wait before it may send again (ms; 0: it may).
    waitFor(seat) { const t = lastSent.get(seat); return t == null ? 0 : Math.max(0, cooldownMs - (now() - t)); },
    // The player at `seat` says line `id` (about the guest at seat `about`, for a line that names one):
    // delivered to everyone, or null (cooling down, an unknown line, a missing or wrong `about`).
    say(seat, id, about = null) {
      if (this.waitFor(seat) > 0) return null;
      const t = now();
      const msg = cleanMessage({ seat, id, about, at: t }, seats(), t);
      if (!msg) return null;
      lastSent.set(seat, msg.at);
      deliver(msg);
      return msg;
    },
    // A message from elsewhere at the table (a computer guest; later, the server's relay).
    post(msg) {
      const m = cleanMessage(msg, seats(), now());
      if (!m) return null;
      deliver(m);
      return m;
    },
    // A new table: nobody is cooling down.
    reset() { lastSent.clear(); },
  };
}
