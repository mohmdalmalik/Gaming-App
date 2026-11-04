// The shared data's fingerprint: an 8-hex FNV-1a (32 bits) of a canonical JSON of what the page and the server must
// hold alike to play one table: the hotel's tiles and lobby (src/data/hotel.js), the rule numbers
// (src/data/rules.js) without the four fields applyMode changes per match (gameMode, playerCount, practiceMode,
// turnTimerEnabled), the quick-chat line and emote ids (src/data/chat.js) and the username rule constants
// (src/account/username.js). A device sends it in `hello`; a server holding other data answers "Update needed".
//
// Computed ONCE, when this module loads, so later runtime changes to `rules` (applyMode, ?timer=off) can never make
// it drift; dataHash() returns that value. The same in Node and in the browser (no DOM, no Node API; TextEncoder
// exists in both). Pure.
import { hotel } from '../data/hotel.js';
import { rules } from '../data/rules.js';
import { CHAT_PHRASES, CHAT_EMOTES } from '../data/chat.js';
import { USERNAME } from '../account/username.js';

const PER_MATCH = new Set(['gameMode', 'playerCount', 'practiceMode', 'turnTimerEnabled']);

// JSON with every object's keys in sorted order (arrays keep their order), so equal data always reads the same.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined || typeof v === 'function' ? 'null' : canonicalJson(v))).join(',')}]`;
  const keys = Object.keys(value).filter(k => value[k] !== undefined && typeof value[k] !== 'function').sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

// FNV-1a, 32 bits, over the UTF-8 bytes of `text`, as 8 lowercase hex digits.
export function fnv1a(text) {
  const bytes = new TextEncoder().encode(String(text));
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// What the fingerprint is taken over, as it stands right now (tests compare it with the value fixed at load).
export function dataHashInput() {
  const shared = Object.fromEntries(Object.entries(rules).filter(([k]) => !PER_MATCH.has(k)));
  return {
    hotel: { tiles: hotel.tiles, lobby: hotel.lobby },
    rules: shared,
    chat: { phrases: CHAT_PHRASES.map(p => (p.about ? [p.id, 'about'] : [p.id])), emotes: CHAT_EMOTES.map(e => e.id) },
    username: USERNAME,
  };
}

export const computeDataHash = () => fnv1a(canonicalJson(dataHashInput()));

const HASH = computeDataHash();
export const dataHash = () => HASH;
