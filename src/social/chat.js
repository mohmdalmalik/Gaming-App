// The table's quick-chat channel: the one road every chat message takes, from whoever says it to
// everyone at the table. Pure (no DOM): a message is { seat, id, at } — who, which preset line or emote
// (src/data/chat.js), and when. Nothing else rides along, so a message can never carry a role, a card or
// a private result.
//
// Today the whole table is on this device: the player's own messages (say) and the computer guests'
// (post) are delivered straight to the listeners. Online, say() would send to the server and the
// server's relay would come back through post() — the interface (src/ui/chat.js) would not change. The
// cooldown is the sender's own manners; a server would check it again (never trust the client).
import { CHAT, CHAT_PHRASES, CHAT_EMOTES } from '../data/chat.js';

const IDS = new Set([...CHAT_PHRASES, ...CHAT_EMOTES].map(x => x.id));
export const isChatId = id => IDS.has(id);

export function createChatChannel({ now = () => Date.now(), cooldownMs = CHAT.cooldownMs } = {}) {
  const listeners = new Set();
  const lastSent = new Map();     // seat -> when it last sent (this device's own seats)

  const deliver = msg => { for (const fn of listeners) { try { fn(msg); } catch (err) { console.warn('chat listener failed:', err); } } };
  const valid = msg => !!msg && Number.isInteger(msg.seat) && msg.seat >= 0 && isChatId(msg.id);

  return {
    onMessage(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // How long `seat` still has to wait before it may send again (ms; 0: it may).
    waitFor(seat) { const t = lastSent.get(seat); return t == null ? 0 : Math.max(0, cooldownMs - (now() - t)); },
    // The player at `seat` says line `id`: delivered to everyone, or null (cooling down, unknown line).
    say(seat, id) {
      if (!isChatId(id) || this.waitFor(seat) > 0) return null;
      const msg = { seat, id, at: now() };
      lastSent.set(seat, msg.at);
      deliver(msg);
      return msg;
    },
    // A message from elsewhere at the table (a computer guest; later, the server's relay).
    post(msg) {
      if (!valid(msg)) return null;
      const m = { seat: msg.seat, id: msg.id, at: Number.isFinite(msg.at) ? msg.at : now() };
      deliver(m);
      return m;
    },
    // A new table: nobody is cooling down.
    reset() { lastSent.clear(); },
  };
}
