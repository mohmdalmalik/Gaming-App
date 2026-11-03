// THE CO-OP MESSAGE PROTOCOL: JSON text frames between a device and the server (wss://; ws:// only on localhost).
// Every message has `t`. This file names the message types, the error codes and the close codes, and checks every
// message a device sends (types, lengths and enums) before the server looks at it. Pure: the page, the server and
// the tests import it.
//
//   validate(raw)  ->  { ok: true, msg }               msg: a clean copy holding only the known fields
//                  ->  { ok: false, close: 1003 | 1007 }
//     raw is the text of a text frame. Not text (a binary frame), or not an object with a known `t`: 1003.
//     Bad JSON, or a known `t` with a field of the wrong type, length or value: 1007.
//   (Oversized messages never get here: the socket's maxPayload closes them with 1009; too many: 1008.)
//
// Device -> server (DESIGN §7.1):
//   hello { v, app, data, token, name, avatar, vis }   first on every socket, within ONLINE.timing.helloTimeoutMs
//   peek { code } · create { size? } · join { code, wait? } · lobby { id, op } · do { id, turn, cmd }
//   say { id, about? } · vis { v } · leave {} · ping { at }
// Server -> device (DESIGN §7.2):
//   welcome { v, token, server, place, restored? } · peeked { code, host } · lobby { n, lobby } · view { n, view, events, fresh? }
//   res { id, ok, reason?, result? } · chat { n, msg } · err { code, retryMs? } · bye { why, retryMs? } · pong { at, server }
//   (welcome.restored: the first welcome after a server restart that brought this seat's table back: 'match' (the
//   match goes on) or 'update' (it was stopped, the rules data changed). Older devices ignore it.)
// Never accepted from a device: a seat for itself, a role, a seed, a result, a roll or a time (only `ping.at`,
// which the server echoes and never trusts).
import { ONLINE } from '../data/online.js';
import { rules } from '../data/rules.js';

export const PROTOCOL = ONLINE.protocol;
export const MIN_PROTOCOL = ONLINE.minProtocol;

export const C2S = ['hello', 'peek', 'create', 'join', 'lobby', 'do', 'say', 'vis', 'leave', 'ping'];
export const S2C = ['welcome', 'peeked', 'lobby', 'view', 'res', 'chat', 'err', 'bye', 'pong'];

// `err` codes (the server's answer to a request it refuses; the device shows the matching card, src/data/onlineText.js).
export const ERR = Object.freeze({
  notFound: 'notFound', full: 'full', midMatch: 'midMatch', locked: 'locked', removed: 'removed', closed: 'closed',
  tooMany: 'tooMany', badCode: 'badCode', badName: 'badName', notHost: 'notHost', notNow: 'notNow', busy: 'busy',
  update: 'update', serverOld: 'serverOld',
});

// `bye.why` -> the WebSocket close code that follows it (a page can't read an HTTP status, so the reason is a
// message first). No hello in time: 4010. Bad JSON / unknown type: 1007 / 1003; rate: 1008; too big: 1009.
export const BYE = Object.freeze({
  elsewhere: 4001, removed: 4002, closed: 4003, update: 4004, serverOld: 4005, busy: 4009, noHello: 4010, restart: 1012,
});
export const CLOSE = Object.freeze({ badData: 1007, badType: 1003, rate: 1008, tooBig: 1009, pageHide: 1001 });

// --- the shapes ---------------------------------------------------------------------------------------------------
const MAX_ID = 64;               // a room, door, doorway, card alias, ask or result id, a person's pid
const MAX_TEXT = 400;            // one line of a note
const MAX_LINES = 30;            // lines in one ack
const MAX_APP = 24;              // 'v0.12'
const MAX_TOKEN = 128;           // a guest key (24 bytes base64url: 32 characters)
const MAX_NAME = 32;             // a username (checkUsername allows 16; the server checks it properly)
const CARD_TYPES = new Set(Object.keys(rules.cards));

const isObj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const isStr = (x, max = MAX_ID, min = 1) => typeof x === 'string' && x.length >= min && x.length <= max;
const isInt = (x, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isInteger(x) && x >= min && x <= max;
const isSeat = x => isInt(x, 0, ONLINE.table.maxPeople - 1);
const isNum = x => typeof x === 'number' && Number.isFinite(x);
const isDoId = x => isStr(x, ONLINE.limits.doIdMaxChars);
const opt = (x, test) => x === undefined || test(x);

class Bad extends Error {}
const need = cond => { if (!cond) throw new Bad(); };
// Copy only the fields that are present (an absent optional field stays absent).
const pick = (src, keys) => { const o = {}; for (const k of keys) if (src[k] !== undefined) o[k] = src[k]; return o; };

// A command inside `do` (DESIGN §6.3). Returns the clean copy.
function cleanCmd(c) {
  need(isObj(c) && typeof c.k === 'string');
  switch (c.k) {
    case 'move': need(isStr(c.to)); return { k: 'move', to: c.to };
    case 'open': need(isStr(c.door)); return { k: 'open', door: c.door };
    case 'search': case 'job': case 'escape': case 'end': case 'back': return { k: c.k };
    case 'card':
      need(CARD_TYPES.has(c.type) && isStr(c.card) && opt(c.target, t => isSeat(t) || isStr(t)));
      return pick(c, ['k', 'type', 'card', 'target']);
    case 'trade': need(isSeat(c.with)); return { k: 'trade', with: c.with };
    case 'discard': need(isStr(c.card)); return { k: 'discard', card: c.card };
    case 'answer': {
      const v = c.value;
      const okValue = typeof v === 'boolean' || isSeat(v) || isStr(v) || (isObj(v) && Object.keys(v).length === 1 && isStr(v.attack));
      need(isStr(c.ask) && okValue);
      return { k: 'answer', ask: c.ask, value: isObj(v) ? { attack: v.attack } : v };
    }
    case 'ack':
      need(['role', 'notes', 'result'].includes(c.what) && opt(c.id, isStr)
        && opt(c.lines, l => Array.isArray(l) && l.length <= MAX_LINES && l.every(s => isStr(s, MAX_TEXT, 0))));
      return pick(c, ['k', 'what', 'id', 'lines']);
    default: throw new Bad();
  }
}

// A waiting-room operation inside `lobby` (DESIGN §7.1).
function cleanOp(op) {
  need(isObj(op) && typeof op.k === 'string');
  switch (op.k) {
    case 'size': need(ONLINE.table.sizes.includes(op.n)); return { k: 'size', n: op.n };
    case 'lock': need(typeof op.on === 'boolean'); return { k: 'lock', on: op.on };
    case 'remove': need(isStr(op.pid)); return { k: 'remove', pid: op.pid };
    case 'start': case 'wait': case 'again': return { k: op.k };
    case 'look': need(isObj(op.avatar)); return { k: 'look', avatar: op.avatar };   // the server checks it (normaliseAvatar)
    default: throw new Bad();
  }
}

const CLEAN = {
  hello(m) {
    need(isInt(m.v, 0, 1e6) && isStr(m.app, MAX_APP) && typeof m.data === 'string' && /^[0-9a-f]{8}$/.test(m.data)
      && (m.token === null || isStr(m.token, MAX_TOKEN)) && (m.name === null || isStr(m.name, MAX_NAME))
      && (m.avatar === null || isObj(m.avatar)) && (m.vis === 'visible' || m.vis === 'hidden'));
    return pick(m, ['t', 'v', 'app', 'data', 'token', 'name', 'avatar', 'vis']);
  },
  peek(m) { need(isStr(m.code, ONLINE.code.inputMax)); return pick(m, ['t', 'code']); },
  create(m) { need(opt(m.size, s => ONLINE.table.sizes.includes(s))); return pick(m, ['t', 'size']); },
  join(m) { need(isStr(m.code, ONLINE.code.inputMax) && opt(m.wait, w => typeof w === 'boolean')); return pick(m, ['t', 'code', 'wait']); },
  lobby(m) { need(isDoId(m.id)); return { t: 'lobby', id: m.id, op: cleanOp(m.op) }; },
  do(m) { need(isDoId(m.id) && isInt(m.turn, 0, 1e6)); return { t: 'do', id: m.id, turn: m.turn, cmd: cleanCmd(m.cmd) }; },
  say(m) { need(isStr(m.id) && opt(m.about, isSeat)); return pick(m, ['t', 'id', 'about']); },
  vis(m) { need(m.v === 'visible' || m.v === 'hidden'); return { t: 'vis', v: m.v }; },
  leave() { return { t: 'leave' }; },
  ping(m) { need(isNum(m.at)); return { t: 'ping', at: m.at }; },
};

export function validate(raw) {
  if (typeof raw !== 'string') return { ok: false, close: CLOSE.badType };
  let m;
  try { m = JSON.parse(raw); } catch { return { ok: false, close: CLOSE.badData }; }
  if (!isObj(m) || typeof m.t !== 'string' || !Object.hasOwn(CLEAN, m.t)) return { ok: false, close: CLOSE.badType };
  try {
    return { ok: true, msg: CLEAN[m.t](m) };
  } catch (e) {
    if (e instanceof Bad) return { ok: false, close: CLOSE.badData };
    throw e;
  }
}
