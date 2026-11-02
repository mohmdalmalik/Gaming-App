// THE SERVER'S BRAIN (DESIGN §7-§12): every Co-op table by its code, the waiting room, who is here, the deal, the
// match (through the referee, src/net/referee.js), each person's own view (src/net/playerView.js), saving after
// every step and coming back after a restart. Pure: no DOM, no Node APIs, no clock, no timers, no global randomness.
// Sending, closing, the clock, randomness and the store are handed in, so the same file runs on the server
// (server/index.js), inside one page for the review link (src/net/loopback.js) and in the Node tests.
//
//   const rooms = createRooms({ send, close, now, random, randomBytes, store, rules, log, hotelData, cfg, hashToken,
//                               timeScale, limits, tablesOpen, botChat })
//     send(conn, msg)        deliver one message object to a device (the wire turns it into JSON text)
//     close(conn, code, why) close that device's socket with this close code
//     now()                  server milliseconds
//     random()               [0, 1) from crypto (the deal, seats, bots' seeds, time-out choices)
//     randomBytes(buf)       fills a Uint8Array from crypto (codes, tokens, aliases)
//     store                  createMemoryStore() (src/net/store.js) or createFileStore(dir) (server/fileStore.js)
//     rules                  activeOnlineRules() (src/data/online.js): today's rules online, or the pending ones
//     log(line)              one line per table event (no tokens, names, hands or roles)
//     hotelData, cfg         src/data/hotel.js's hotel and src/config.js's config
//     hashToken(text)        a device key -> what the server keeps of it (server: sha256 hex; the loopback: FNV-1a)
//     timeScale              TESTS ONLY (BUILD-PLAN rule 14): divides bot pace, walk time, every rule limit (turn,
//                            discard, start, stall), the start countdown and every close timer. 1 for people.
//     limits                 ONLINE.limits (the server multiplies the per-IP and per-token ones by LIMITS_SCALE in tests)
//     tablesOpen             false: nobody can start a new table (err busy; the TABLES_OPEN=false switch)
//     botChat                the computer guests' quick chat (src/bots/chatter.js); tests of exact traffic turn it off
//   ->
//   rooms.connect(conn, { ip })     a socket opened (ip: the client address, IPv6 grouped by /64, server/clientIp.js)
//   rooms.message(conn, msg)        one message, already checked by protocol.validate (src/net/protocol.js)
//   rooms.disconnect(conn)          the socket closed
//   rooms.tick(now)                 every ONLINE.timing.tickMs: deadlines, bots, countdowns, presence, close timers
//   rooms.restore(now)              at boot, before listening: every saved table back (DESIGN §10.5)
//   rooms.shutdown(now)             SIGTERM: save every table, tell every device `bye restart` and close (1012)
//   rooms.health(now)            -> { ok, protocol: [min, max], data, tables, matches, people, uptimeS }
//   rooms.debug                     tests only: the live tables and guests (never reachable from a device)
//
// THE COMMIT RULE (§10.1): every change runs one step (a referee or waiting-room step), SAVES the table, and only
// then tells anybody. A step that throws is caught per table: the table goes back to its last save and the input is
// dropped; a second fault within ONLINE.timing.faultWindowMs ends that match politely (§10.4). One table never stops
// the others.
//
// WHAT A DEVICE IS SENT (§7.2): welcome, peeked, lobby (a LobbyView, §8.4), view (a PlayerView, §6.1, with the new
// events of that seat's own stream since the last view and the table's own events: away, back, left), res (the
// reply to a do or lobby request: { rooms } for a move, nothing else, §6.3), chat, err, bye, pong. A seat whose view
// did not change except in time (the leftMs fields) is sent nothing, so nobody's traffic tells what happened in
// private elsewhere (fairness-check). Card ids in a view are the seat's own aliases (src/net/aliases.js); a command's
// aliases are mapped back here before the referee sees them, and an unknown one is refused as notYourCard.
//
// Not built tonight (DESIGN §5.7, §8.10): stand-ins and idle time-outs (R6/R7, not approved), "Wait here" for a
// table that is mid-match (join answers midMatch), quick chat in the waiting room (chat is a match's: say needs a seat).
import { ONLINE, ONLINE_RULES, activeOnlineRules } from '../data/online.js';
import { CHAT, BOT_CHAT } from '../data/chat.js';
import { PROTOCOL, MIN_PROTOCOL, ERR, BYE } from './protocol.js';
import { dataHash } from './dataHash.js';
import { newCode, normaliseCode } from './codes.js';
import { createAliases } from './aliases.js';
import { createReferee } from './referee.js';
import { playerView, seatEvents } from './playerView.js';
import { toSnapshot, fromSnapshot } from './snapshot.js';
import { createMemoryStore } from './store.js';
import { createHotel } from '../game/hotel.js';
import { createState } from '../game/state.js';
import { createBotTable } from '../bots/index.js';
import { rollProfiles } from '../bots/profiles.js';
import { createChatter } from '../bots/chatter.js';
import { cleanMessage } from '../social/chat.js';
import { SEAT_COLORS, botAvatars, guestMarks } from '../table.js';
import { normaliseAvatar, outfitOf, DEFAULT_AVATAR } from '../data/wardrobe.js';
import { checkUsername, USERNAME, sameName } from '../account/username.js';

export const ROOMS_VERSION = 1;          // the saved table's format (DESIGN §10.2)

const MINUTE = 60000;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const CHECK_EVERY_MS = 1000;             // a playing table's views are looked at least this often (a banner, a pause end)
const CHATTER_EVERY_MS = 500;            // the bots' chatter is asked this often
const CHATTER_AFTER_END_MS = 60000;      // ...and for this long after the match ends (their last words)
const PRUNE_EVERY_MS = MINUTE;           // forgotten guests and old rate counters are swept this often
const GUEST_FORGET_MS = 30 * MINUTE;     // a guest with no socket and no seat is forgotten after this
const LOBBY_OPS_KEPT = 16;
const TIMED = ['turnMs', 'discardMinMs', 'meetMs', 'cardMs', 'offerMs', 'screenCapMs', 'startAckMs', 'stallMs', 'standInGraceMs'];

const copy = x => (x == null ? x : JSON.parse(JSON.stringify(x)));

// The rule limits a referee is given: the rules divided by the test-only time scale (rule 14).
export function scaledRules(rules, timeScale = 1) {
  const out = { ...rules };
  for (const k of TIMED) if (Number.isFinite(out[k])) out[k] = out[k] / timeScale;
  return out;
}

export function createRooms({
  send, close, now: clock, random, randomBytes, store = createMemoryStore(), rules = activeOnlineRules(), log = () => {},
  hotelData, cfg, hashToken, timeScale = 1, limits = ONLINE.limits, tablesOpen = true, botChat = true,
} = {}) {
  for (const [name, fn] of Object.entries({ send, close, now: clock, random, randomBytes, hashToken })) {
    if (typeof fn !== 'function') throw new Error(`createRooms needs ${name}`);
  }
  if (!hotelData || !cfg) throw new Error('createRooms needs hotelData and cfg');
  const ts = Number.isFinite(timeScale) && timeScale >= 1 ? timeScale : 1;
  const T_ = ONLINE.timing;
  const scaled = ms => ms / ts;
  const refLimits = scaledRules(rules, ts);
  const rulesName = rules === ONLINE_RULES.pending ? 'approved' : 'today';
  const L = { ...ONLINE.limits, ...limits };

  const clients = new Map();      // conn -> C { conn, ip, at, guest, n, vis, sent }
  const guests = new Map();       // tokenHash -> G { th, conn: C | null, name, avatar, code, seenAt, ops }
  const tables = new Map();       // code -> T (a closed table stays a day, so its code is not given out again)
  const ipLog = new Map();        // ip -> { wrong: [t], creates: [t] }
  const tokenLog = new Map();     // tokenHash -> { hellos: [t], creates: [t] }
  const bornAt = clock();
  let prunedAt = bornAt;

  // --- small tools ---------------------------------------------------------------------------------------------
  const bytes = n => { const b = new Uint8Array(n); randomBytes(b); return b; };
  function base64url(b) {
    let s = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
      const k = Math.min(4, Math.ceil(((b.length - i) * 8) / 6));
      for (let j = 0; j < k; j++) s += B64URL[(n >> (18 - 6 * j)) & 63];
    }
    return s;
  }
  const newToken = () => base64url(bytes(24));
  const newId = (prefix, n) => prefix + [...bytes(n)].map(x => ID_CHARS[x & 31]).join('');
  const seed32 = () => (Math.floor(random() * 4294967296) >>> 0) || 1;
  function shuffled(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  // A rolling count of events in a time window: how long until one more is allowed (0: allowed now, and counted).
  function within(list, at, ms) { while (list.length && list[0] <= at - ms) list.shift(); return list.length; }
  function waitFor(list, at, ms, max) { return within(list, at, ms) >= max ? Math.max(1, list[list.length - max] + ms - at) : 0; }
  const ipOf = ip => { let r = ipLog.get(ip); if (!r) { r = { wrong: [], creates: [] }; ipLog.set(ip, r); } return r; };
  const tokOf = th => { let r = tokenLog.get(th); if (!r) { r = { hellos: [], creates: [] }; tokenLog.set(th, r); } return r; };

  function out(C, msg, numbered = false) {
    if (!C) return;
    const m = numbered ? { t: msg.t, n: ++C.n, ...msg } : msg;
    try { send(C.conn, m); } catch { /* a socket that cannot take it closes on its own */ }
  }
  function shut(C, code, why = '') { try { close(C.conn, code, why); } catch { /* already gone */ } }
  function bye(C, why, extra = {}) { out(C, { t: 'bye', why, ...extra }); shut(C, BYE[why] ?? 1000, why); }
  const err = (C, code, extra = {}) => out(C, { t: 'err', code, ...extra });

  // --- who is where ----------------------------------------------------------------------------------------------
  const seatedAt = G => (G?.code ? tables.get(G.code) ?? null : null);
  const personOf = (T, G) => (T && G ? T.people.find(P => P.th === G.th) ?? null : null);
  const live = P => !P.left;
  const peopleIn = T => T.people.filter(live);
  function presenceOf(T, P) {
    if (P.left) return 'gone';
    const G = guests.get(P.th);
    if (!G || G.code !== T.code || !G.conn) return 'gone';
    return G.conn.vis === 'hidden' ? 'hidden' : 'here';
  }
  function awayNow(T, P, at) {
    const pr = presenceOf(T, P);
    if (pr === 'gone') return true;
    if (pr === 'hidden') return P.hiddenAt != null && at - P.hiddenAt >= T_.awayAfterHiddenMs;
    return false;
  }
  // Presence changed (a socket came or went, the page was hidden or shown, a person left): tell the referee, and
  // flip the Away flag (gone: at once; hidden: after ONLINE.timing.awayAfterHiddenMs). Returns true if anything
  // anybody sees changed.
  function touchPresence(T, P, at) {
    const pr = presenceOf(T, P);
    if (pr === 'hidden') P.hiddenAt ??= at; else P.hiddenAt = null;
    const M = T.match;
    if (M && P.seat != null && M.people.includes(P.seat)) M.ref.setPresence(P.seat, pr, at);
    const away = awayNow(T, P, at);
    if (away === P.away) return false;
    P.away = away;
    P.awaySince = away ? at : null;
    if (M && P.seat != null) M.tevents.push({ type: away ? 'away' : 'back', seat: P.seat });
    return true;
  }
  const clientOf = (T, P) => { const G = guests.get(P.th); return G && G.code === T.code && !P.left ? G.conn : null; };

  // --- what each device is sent ------------------------------------------------------------------------------------
  function lobbyFor(T, P, at) {
    const ps = peopleIn(T);
    const marks = guestMarks(ps.map(p => p.name));
    const enough = ps.length >= ONLINE.table.minPeople;
    return {
      code: T.code,
      phase: T.phase,
      startsInMs: T.phase === 'starting' && T.startsAt != null ? Math.max(0, Math.round(T.startsAt - at)) : null,
      size: T.size, locked: T.locked, you: P.pid, host: T.host,
      canStart: T.phase === 'waiting' && enough, why: enough ? null : 'needFriend',
      people: ps.map((p, i) => ({ pid: p.pid, name: p.name, avatar: p.avatar, mark: marks[i], host: p.pid === T.host, you: p.pid === P.pid, away: !!p.away })),
      queued: null,
    };
  }
  function sendLobby(T, P, at) { const C = clientOf(T, P); if (C) out(C, { t: 'lobby', lobby: lobbyFor(T, P, at) }, true); }
  function broadcastLobby(T, at) { for (const P of peopleIn(T)) sendLobby(T, P, at); }

  const tableInfo = T => ({ kind: 'friends', code: T.code, rules: rulesName, clockOn: true, relaxed: false });
  function viewFor(T, seat, at) {
    const M = T.match;
    const presence = {};
    for (let s = 0; s < M.state.players.length; s++) presence[s] = { away: false, bot: !M.people.includes(s) };
    for (const P of T.people) if (P.seat != null && M.people.includes(P.seat)) presence[P.seat] = { away: !!P.away, bot: false };
    let extras = { ...M.ref.extras(seat, at), table: tableInfo(T), presence };
    if (M.stopped) extras = { ...extras, phase: { kind: 'ended', seats: [] }, clock: null, stall: null, ask: null, end: { won: null, dawn: false, stopped: M.stopped } };
    return playerView(M.state, M.floor, seat, extras, { aliasOf: M.aliases.aliasFor });
  }
  // A view as compared between two sends: the same apart from time (every leftMs) is the same.
  const viewKey = v => JSON.stringify(v, (k, x) => (k === 'leftMs' ? undefined : x));

  // Send `P` their view if it changed (or always, `force`). The first view of a match on a socket is `fresh` and
  // carries the seat's whole event stream; later ones only the new events.
  function sendView(T, P, C, at, force = false) {
    const M = T.match;
    if (!M || P.seat == null) return false;
    const fresh = !C.sent || C.sent.t !== T.id || C.sent.m !== M.n;
    const view = viewFor(T, P.seat, at);
    const key = viewKey(view);
    const ev = seatEvents(M.state, P.seat, fresh ? 0 : C.sent.o);
    const tev = fresh ? [] : M.tevents.slice(C.sent.te);
    if (!fresh && !force && key === C.sent.key && !ev.events.length && !tev.length) return false;
    C.sent = { t: T.id, m: M.n, o: ev.lastO, key, te: M.tevents.length };
    const events = tev.length ? [...ev.events, ...tev.map(e => ({ ...e }))] : ev.events;
    out(C, fresh ? { t: 'view', view, events, fresh: true } : { t: 'view', view, events }, true);
    return true;
  }
  function fanOut(T, at) {
    const M = T.match;
    if (!M) return;
    for (const P of T.people) {
      if (P.seat == null || P.left) continue;
      const C = clientOf(T, P);
      if (C) sendView(T, P, C, at);
    }
    M.checkAt = at + CHECK_EVERY_MS;
    M.due = M.ref.nextDue();
  }

  // --- saving (DESIGN §10.2) ------------------------------------------------------------------------------------------
  function serialise(T, at) {
    const M = T.match;
    return {
      v: ROOMS_VERSION, id: T.id, code: T.code, created: T.created, phase: T.phase, size: T.size, locked: T.locked,
      host: T.host,
      people: T.people.map(P => ({ pid: P.pid, tokenHash: P.th, name: P.name, avatar: P.avatar, joinedAt: P.joinedAt, seat: P.seat, away: !!P.away, left: !!P.left })),
      removed: [...T.removed], queued: [], closedAt: T.closedAt, startsAt: T.startsAt, waitingSince: T.waitingSince,
      endedAt: T.endedAt, lastUsed: T.lastUsed, pidSeq: T.pidSeq, matchCount: T.matchCount, creator: T.creator ?? null,
      savedAt: at,
      match: M ? {
        n: M.n, dataHash: M.dataHash, startedAt: M.startedAt, people: [...M.people], stopped: M.stopped ?? null,
        engine: toSnapshot(M.state, M.floor),
        referee: M.ref.toJSON(),
        aliases: M.aliases.toJSON(),
        doIds: copy(M.doIds),
        bots: copy(M.botSeats),
      } : null,
    };
  }
  function save(T, at) {
    const obj = serialise(T, at);
    store.save(T.id, obj);
    T.saved = obj;
  }

  // A match back from its save: the engine and the hotel (snapshot), new bot minds with fresh crypto seeds (they catch
  // up from what their guest may know), the referee where it was, the aliases, the replies kept.
  function rebuildMatch(T, sm) {
    const { state, floor } = fromSnapshot(sm.engine, { hotelData, cfg, rng: random, hotelRng: random });
    const M = newMatchShell(T, { n: sm.n, dataHash: sm.dataHash, startedAt: sm.startedAt, state, floor, people: sm.people, botSeats: sm.bots });
    M.stopped = sm.stopped ?? null;
    M.bots = createBotTable(state, floor, M.botSeats, seed32());
    M.ref = createReferee.restore(sm.referee, refereeOpts(M));
    M.aliases = createAliases(randomBytes);
    M.aliases.restore(sm.aliases);
    M.doIds = copy(sm.doIds) || {};
    M.chatter = null;          // (a restored match's bots stay quiet: a new chatter would comment on old news)
    return M;
  }
  function tableFromSave(s) {
    const T = {
      id: s.id, code: s.code, created: s.created, phase: s.phase, size: s.size, locked: !!s.locked, host: s.host,
      people: (s.people || []).map(p => ({ pid: p.pid, th: p.tokenHash, name: p.name, avatar: p.avatar, joinedAt: p.joinedAt, seat: p.seat ?? null, away: !!p.away, left: !!p.left, awaySince: null, hiddenAt: null })),
      removed: [...(s.removed || [])], closedAt: s.closedAt ?? null, startsAt: s.startsAt ?? null, waitingSince: s.waitingSince ?? s.created,
      endedAt: s.endedAt ?? null, lastUsed: s.lastUsed ?? s.created, pidSeq: s.pidSeq || 0, matchCount: s.matchCount || 0, creator: s.creator ?? null,
      match: null, faults: [], slow: 0, emptySince: null, saved: s,
    };
    return T;
  }

  // --- the match ---------------------------------------------------------------------------------------------------------
  function newMatchShell(T, { n, dataHash: dh, startedAt, state, floor, people, botSeats }) {
    return { n, dataHash: dh, startedAt, state, floor, people: [...people], botSeats: botSeats.map(b => ({ index: b.index, profile: b.profile })),
      bots: null, ref: null, aliases: null, chatter: null, chatAt: 0, doIds: {}, tevents: [], lastSaid: {}, stopped: null, checkAt: 0, due: null };
  }
  function refereeOpts(M) {
    return {
      state: M.state, floor: M.floor, bots: M.bots, people: M.people, mode: 'online', walkMode: 'atomic', botRules: 'page',
      limits: refLimits, random, maxStepsPerTick: L.maxBotStepsPerTick,
      pace: (seat, kind) => { const ms = M.bots?.thinkMs?.(seat, kind); return (Number.isFinite(ms) ? ms : 600) / ts; },
      walkMs: (seat, rooms) => (Math.max(0, (rooms?.length ?? 1) - 1) * T_.walkMsPerRoom) / ts,
    };
  }

  // The deal, in one step (DESIGN §8.7): people into random seats, bots in the rest (names never a person's, looks
  // never a person's), every role Random (TP1), every random number from crypto.
  function deal(T, at) {
    const ps = peopleIn(T);
    const seats = shuffled([...Array(T.size).keys()]);
    ps.forEach((P, k) => { P.seat = seats[k]; });
    const nBots = T.size - ps.length;
    const profiles = rollProfiles(nBots, random, { avoid: ps.map(P => P.name) });
    const looks = botAvatars(profiles.map(p => p.username), { avoid: ps.map(P => P.avatar) });
    const roster = [], botSeats = [];
    for (let i = 0, b = 0; i < T.size; i++) {
      const P = ps.find(x => x.seat === i);
      let name, avatar;
      if (P) { name = P.name; avatar = normaliseAvatar(P.avatar, { trusted: true }); }
      else { name = profiles[b].username; avatar = looks[b]; botSeats.push({ index: i, profile: profiles[b] }); b++; }
      roster.push({ id: `p${i + 1}`, name, color: SEAT_COLORS[i % SEAT_COLORS.length], avatar, outfit: outfitOf(avatar) });
    }
    const floor = createHotel(hotelData, cfg);
    const state = createState(floor, roster, null, { mode: 'match', rng: random, hotelRng: random, perTableIds: true });
    T.matchCount = (T.matchCount || 0) + 1;
    const M = newMatchShell(T, { n: T.matchCount, dataHash: dataHash(), startedAt: at, state, floor, people: ps.map(P => P.seat).sort((a, b) => a - b), botSeats });
    M.bots = createBotTable(state, floor, M.botSeats, seed32());
    M.ref = createReferee({ ...refereeOpts(M), now: at });
    M.aliases = createAliases(randomBytes);
    M.chatter = botChat && botSeats.length ? createChatter(state, floor, M.botSeats, seed32(), BOT_CHAT, M.bots) : null;
    T.match = M;
    T.phase = 'playing';
    T.startsAt = null;
    T.endedAt = null;
    T.lastUsed = at;
    for (const P of ps) touchPresence(T, P, at);
    M.tevents.length = 0;      // (the first views carry everyone's Away flag; nothing to replay)
    log(`table ${T.id} match ${M.n} dealt: ${T.size} seats, ${ps.length} people`);
  }

  // After every step: the aliases follow the hands; a match that ended moves the table on.
  function afterStep(T, at) {
    const M = T.match;
    if (!M) return false;
    M.aliases.sync(M.state);
    if (T.phase === 'playing' && M.ref.stage === 'ended') {
      T.phase = 'ended';
      T.endedAt = at;
      T.lastUsed = at;
      M.endedAt = at;
      log(`table ${T.id} match ${M.n} ended: ${M.state.finished ? (M.state.won || 'over') : (M.ref.extras(M.people[0] ?? 0, at).end?.stopped || 'stopped')}`);
      return true;
    }
    return false;
  }

  // One step at one table, the commit rule: run it, save, then (the caller) send. A throw: back to the last save.
  // `ifChanged`: fn returns whether anything changed, and the table is saved only then (a clock tick).
  function commit(T, at, fn, { ifChanged = false } = {}) {
    const t0 = clock();
    let r;
    try {
      r = fn();
      const phaseMoved = afterStep(T, at);
      if (!ifChanged || r || phaseMoved) save(T, at);
      if (phaseMoved) broadcastLobby(T, at);
    } catch (e) {
      fault(T, at, e);
      return { ok: false, reason: 'error', fault: true };
    }
    watch(T, at, clock() - t0);
    return r;
  }

  // A table whose steps keep taking over ONLINE.limits.slowStepMs: its match is ended politely (§10.4 watchdog).
  function watch(T, at, ms) {
    if (!(ms > L.slowStepMs)) return;
    T.slow = (T.slow || 0) + 1;
    log(`table ${T.id}: a step took ${Math.round(ms)} ms`);
    if (T.slow >= 2 && T.match) { T.slow = 0; endPolitely(T, at, 'slow'); }
  }

  function fault(T, at, e) {
    log(`table ${T.id}: fault: ${String(e?.message || e).slice(0, 160)}`);
    T.faults = (T.faults || []).filter(t => at - t < T_.faultWindowMs);
    T.faults.push(at);
    try {
      if (T.faults.length >= 2 && T.match) { endPolitely(T, at, 'fault'); return; }
      reload(T, at);
    } catch (e2) {
      log(`table ${T.id}: could not recover: ${String(e2?.message || e2).slice(0, 160)}`);
      try { T.match = null; closeTable(T, at); } catch { tables.delete(T.code); }
    }
  }
  // Back to the last save (the input that threw is dropped). Nothing was sent after that save, so every device still
  // holds exactly what the table now holds.
  function reload(T, at) {
    const s = T.saved;
    if (!s) throw new Error('nothing saved');
    const R = tableFromSave(s);
    const M = s.match ? rebuildMatch(R, s.match) : null;
    const keep = { faults: T.faults, slow: T.slow };
    const oldMatch = T.match;
    Object.assign(T, R, keep);
    T.match = M;
    if (M && oldMatch) { M.tevents = oldMatch.tevents; M.chatter = oldMatch.chatter; M.checkAt = 0; }
    for (const P of T.people) if (live(P)) touchPresence(T, P, at);   // (the saved Away flags stand; the referee is told who is here)
  }

  // The match stops without a result (a second fault, a slow table, a restore under other rules data): everyone sees
  // the end, and the table goes back to the waiting room.
  function endPolitely(T, at, why) {
    const M = T.match;
    log(`table ${T.id} match ${M?.n ?? '-'} stopped: ${why}`);
    if (M) {
      M.stopped = why;
      try { fanOut(T, at); } catch { /* the lobby below still tells them */ }
    }
    toWaiting(T, at);
    save(T, at);
    broadcastLobby(T, at);
  }
  function toWaiting(T, at) {
    T.match = null;
    T.phase = 'waiting';
    T.startsAt = null;
    T.waitingSince = at;
    T.lastUsed = at;
    T.people = T.people.filter(live);
    for (const P of T.people) P.seat = null;
    if (!T.people.some(P => P.pid === T.host)) T.host = T.people[0]?.pid ?? null;
  }

  function closeTable(T, at, why = 'closed') {
    if (T.phase === 'closed') return;
    for (const P of T.people) {
      const G = guests.get(P.th);
      if (G && G.code === T.code) {
        G.code = null;
        if (G.conn && !P.left) bye(G.conn, 'closed');
      }
    }
    T.phase = 'closed';
    T.closedAt = at;
    T.match = null;
    T.startsAt = null;
    save(T, at);
    log(`table ${T.id} closed (${why})`);
  }

  // --- the waiting room ------------------------------------------------------------------------------------------------
  function uniqueName(T, name) {
    const taken = T.people.filter(live).map(P => P.name);
    if (!taken.some(n => sameName(n, name))) return name;
    for (let k = 2; k < 1000; k++) {
      const d = String(k);
      const n = name.slice(0, USERNAME.max - d.length) + d;
      if (!taken.some(x => sameName(x, n))) return n;
    }
    return name;
  }
  function seatPerson(T, G, at) {
    const P = { pid: `u${++T.pidSeq}`, th: G.th, name: uniqueName(T, G.name), avatar: G.avatar, joinedAt: at, seat: null,
      away: false, left: false, awaySince: null, hiddenAt: null };
    T.people.push(P);
    G.code = T.code;
    if (!T.host || !T.people.some(x => x.pid === T.host && live(x))) T.host = P.pid;
    T.lastUsed = at;
    touchPresence(T, P, at);
    return P;
  }
  // The person seated longest who is here becomes host (or simply the longest seated).
  function passHost(T) {
    const ps = peopleIn(T);
    const next = ps.find(P => P.pid !== T.host && !P.away) ?? ps.find(P => P.pid !== T.host) ?? null;
    if (next) T.host = next.pid;
  }
  function removePerson(T, P) {
    T.people = T.people.filter(x => x !== P);
    if (T.host === P.pid) T.host = peopleIn(T)[0]?.pid ?? null;
  }
  function cancelCountdownIfShort(T) {
    if (T.phase === 'starting' && peopleIn(T).length < ONLINE.table.minPeople) { T.phase = 'waiting'; T.startsAt = null; }
  }

  // --- requests ---------------------------------------------------------------------------------------------------------
  function onHello(C, m, at) {
    if (C.guest || C.helloDone) { err(C, ERR.notNow); return; }
    C.helloDone = true;
    if (!Number.isInteger(m.v) || m.v < MIN_PROTOCOL) { bye(C, 'update'); return; }
    if (m.v > PROTOCOL) { bye(C, 'serverOld'); return; }
    if (m.data !== dataHash()) { bye(C, 'update'); return; }
    let token = typeof m.token === 'string' && TOKEN_RE.test(m.token) ? m.token : null;
    if (token) {
      const wait = waitFor(tokOf(hashToken(token)).hellos, at, MINUTE, L.hellosPerTokenPerMin);
      if (wait) { err(C, ERR.tooMany, { retryMs: wait }); C.helloDone = false; return; }
    }
    if (!token) token = newToken();
    const th = hashToken(token);
    tokOf(th).hellos.push(at);
    let G = guests.get(th);
    if (!G) { G = { th, conn: null, name: null, avatar: null, code: null, seenAt: at, ops: [] }; guests.set(th, G); }
    if (G.conn && G.conn !== C) {               // the newest socket wins (§11.4)
      const old = G.conn;
      old.guest = null;
      G.conn = null;
      bye(old, 'elsewhere');
    }
    G.conn = C;
    G.seenAt = at;
    C.guest = G;
    C.vis = m.vis === 'hidden' ? 'hidden' : 'visible';
    if (m.name != null) {
      const ok = checkUsername(m.name);
      if (ok.ok) G.name = ok.name; else err(C, ERR.badName);
    }
    if (m.avatar && typeof m.avatar === 'object') G.avatar = normaliseAvatar(m.avatar, { trusted: true });
    G.avatar ??= normaliseAvatar(DEFAULT_AVATAR, { trusted: true });
    const T = seatedAt(G);
    const P = personOf(T, G);
    const place = !T || !P || P.left || T.phase === 'closed' ? 'none' : (T.match ? 'match' : 'lobby');
    out(C, { t: 'welcome', v: PROTOCOL, token, server: at, place });
    if (place === 'none') { if (T && (!P || P.left || T.phase === 'closed')) G.code = null; return; }
    const changed = touchPresence(T, P, at);
    sendLobby(T, P, at);
    if (T.match && P.seat != null) sendView(T, P, C, at, true);
    if (changed) { if (T.match) fanOut(T, at); if (T.phase !== 'playing') broadcastLobby(T, at); }
  }

  // A code guessed or peeked: the wrong-code limits (§7.5) of this address. Returns the wait (ms), 0 when allowed.
  function codeLimit(C, at) {
    const r = ipOf(C.ip).wrong;
    return Math.max(waitFor(r, at, MINUTE, L.wrongCodesPerIpPerMin), waitFor(r, at, 10 * MINUTE, L.wrongCodesPerIpPer10Min));
  }
  const countWrong = (C, at) => ipOf(C.ip).wrong.push(at);

  function onPeek(C, m, at) {
    const wait = codeLimit(C, at);
    if (wait) return err(C, ERR.tooMany, { retryMs: wait });
    countWrong(C, at);                        // (every peek counts: §8.3)
    const code = normaliseCode(m.code);
    if (!code) return err(C, ERR.badCode);
    const T = tables.get(code);
    if (!T || (T.phase !== 'waiting' && T.phase !== 'starting')) return err(C, ERR.notFound);
    const host = T.people.find(P => P.pid === T.host);
    out(C, { t: 'peeked', code, host: host?.name ?? '' });
  }

  function onCreate(C, m, at) {
    const G = C.guest;
    if (!G.name) return err(C, ERR.badName);
    const here = seatedAt(G);
    if (here && personOf(here, G) && here.phase !== 'closed') return err(C, ERR.notNow);
    const open = [...tables.values()].filter(T => T.phase !== 'closed');
    const ip = ipOf(C.ip), tok = tokOf(G.th);
    if (!tablesOpen || open.length >= L.maxTables
      || waitFor(ip.creates, at, MINUTE, L.createsPerIpPerMin) || waitFor(tok.creates, at, MINUTE, L.createsPerTokenPerMin)
      || open.filter(T => T.creator === G.th).length >= L.openTablesPerToken
      || open.filter(T => T.creatorIp === C.ip).length >= L.openTablesPerIp) return err(C, ERR.busy);
    ip.creates.push(at); tok.creates.push(at);
    let code = null;
    for (let tries = 0; tries < 50 && !code; tries++) { const c = newCode(randomBytes); if (!tables.has(c)) code = c; }
    if (!code) return err(C, ERR.busy);
    const size = ONLINE.table.sizes.includes(m.size) ? m.size : ONLINE.table.defaultSize;
    const T = {
      id: newId('t_', 10), code, created: at, phase: 'waiting', size, locked: false, host: null, people: [], removed: [],
      closedAt: null, startsAt: null, waitingSince: at, endedAt: null, lastUsed: at, pidSeq: 0, matchCount: 0,
      creator: G.th, creatorIp: C.ip, match: null, faults: [], slow: 0, emptySince: null, saved: null,
    };
    tables.set(code, T);
    const P = seatPerson(T, G, at);
    T.host = P.pid;
    save(T, at);
    log(`table ${T.id} created (size ${size})`);
    sendLobby(T, P, at);
  }

  function onJoin(C, m, at) {
    const G = C.guest;
    const wait = codeLimit(C, at);
    if (wait) return err(C, ERR.tooMany, { retryMs: wait });
    const code = normaliseCode(m.code);
    if (!code) { countWrong(C, at); return err(C, ERR.badCode); }
    const T = tables.get(code);
    if (!T) { countWrong(C, at); return err(C, ERR.notFound); }
    if (T.phase === 'closed') return err(C, ERR.closed);
    const P0 = personOf(T, G);
    // Already seated here: straight back to that seat, at any time (a left guest comes back to their own guest).
    if (P0 && (live(P0) || T.match)) {
      const elsewhere = seatedAt(G);
      if (elsewhere && elsewhere !== T && personOf(elsewhere, G) && live(personOf(elsewhere, G))) return err(C, ERR.notNow);
      P0.left = false;
      G.code = T.code;
      return commitJoin(T, P0, C, at);
    }
    if (!G.name) return err(C, ERR.badName);
    const elsewhere = seatedAt(G);
    if (elsewhere && elsewhere !== T && elsewhere.phase !== 'closed' && personOf(elsewhere, G) && live(personOf(elsewhere, G))) return err(C, ERR.notNow);
    if (T.removed.includes(G.th)) return err(C, ERR.removed);
    if (T.phase === 'playing') return err(C, ERR.midMatch);
    if (T.locked) return err(C, ERR.locked);
    if (peopleIn(T).length >= T.size) return err(C, ERR.full);
    const P = seatPerson(T, G, at);
    return commitJoin(T, P, C, at);
  }
  function commitJoin(T, P, C, at) {
    commit(T, at, () => { touchPresence(T, P, at); T.lastUsed = at; });
    sendLobby(T, P, at);
    if (T.match && P.seat != null) sendView(T, P, C, at, true);
    broadcastLobby(T, at);
    if (T.match) fanOut(T, at);
  }

  function onLobby(C, m, at) {
    const G = C.guest;
    const reply = (ok, reason) => {
      const r = ok ? { ok: true } : { ok: false, reason };
      G.ops.push([m.id, r]);
      if (G.ops.length > LOBBY_OPS_KEPT) G.ops.shift();
      out(C, { t: 'res', id: m.id, ...r });
    };
    const seen = G.ops.find(([id]) => id === m.id);
    if (seen) return out(C, { t: 'res', id: m.id, ...seen[1] });
    const T = seatedAt(G);
    const P = personOf(T, G);
    if (!T || !P || P.left || T.phase === 'closed') return reply(false, ERR.notNow);
    const op = m.op;
    const host = T.host === P.pid;
    if (['size', 'lock', 'remove', 'start', 'wait', 'again'].includes(op.k) && !host) return reply(false, ERR.notHost);
    const waiting = T.phase === 'waiting' || T.phase === 'starting';
    let removed = null;
    let res = null;
    const r = commit(T, at, () => {
      switch (op.k) {
        case 'size':
          if (T.phase !== 'waiting' || op.n < peopleIn(T).length) return res = 'notNow';
          T.size = op.n; break;
        case 'lock': if (!waiting) return res = 'notNow'; T.locked = !!op.on; break;
        case 'remove': {
          const X = T.people.find(x => x.pid === op.pid && live(x));
          if (!waiting || !X || X === P) return res = 'notNow';
          removePerson(T, X);
          if (!T.removed.includes(X.th)) T.removed.push(X.th);
          removed = X;
          cancelCountdownIfShort(T);
          break;
        }
        case 'start':
          if (T.phase !== 'waiting' || peopleIn(T).length < ONLINE.table.minPeople) return res = 'notNow';
          T.phase = 'starting';
          T.startsAt = at + scaled(T_.startCountdownMs);
          break;
        case 'wait': if (T.phase !== 'starting') return res = 'notNow'; T.phase = 'waiting'; T.startsAt = null; break;
        case 'again':
          if (T.phase !== 'ended') return res = 'notNow';
          toWaiting(T, at);
          break;
        case 'look': {
          const av = normaliseAvatar(op.avatar, { trusted: true });
          P.avatar = av; G.avatar = av;
          break;
        }
        default: return res = 'unknown';
      }
      T.lastUsed = at;
      return null;
    });
    if (r?.fault) return reply(false, 'error');
    if (res) return reply(false, res);
    reply(true);
    if (removed) {
      const RG = guests.get(removed.th);
      if (RG && RG.code === T.code) { RG.code = null; if (RG.conn) bye(RG.conn, 'removed'); }
    }
    if (op.k !== 'look' || T.phase !== 'playing') broadcastLobby(T, at);
  }

  function onDo(C, m, at) {
    const G = C.guest;
    const T = seatedAt(G);
    const P = personOf(T, G);
    const M = T?.match;
    if (!M || !P || P.left || P.seat == null || T.phase === 'closed' || M.stopped) return out(C, { t: 'res', id: m.id, ok: false, reason: 'notNow' });
    const seat = P.seat;
    const kept = (M.doIds[seat] ||= []);
    const seen = kept.find(([id]) => id === m.id);
    if (seen) return out(C, { t: 'res', id: m.id, ...seen[1] });
    const r = commit(T, at, () => {
      const cmd = fromAliases(M, seat, m.cmd);
      const res = cmd.reason ? { ok: false, reason: cmd.reason } : M.ref.do(seat, { ...cmd, turn: m.turn }, at);
      const reply = res.ok ? (res.result ? { ok: true, result: { rooms: [...res.result.rooms] } } : { ok: true }) : { ok: false, reason: res.reason ?? 'notNow' };
      kept.push([m.id, reply]);
      if (kept.length > L.doIdsKept) kept.shift();
      return reply;
    });
    out(C, { t: 'res', id: m.id, ...(r.fault ? { ok: false, reason: 'error' } : r) });
    if (!r.fault) fanOut(T, at);
  }
  // A command's card aliases back to the engine's ids (§6.5): `card` (a card, a discard), and an answer that names a
  // card (a trade card, an attack's weapon). An alias this seat does not hold: notYourCard.
  function fromAliases(M, seat, cmd) {
    const id = a => M.aliases.idFor(seat, a);
    const c = { ...cmd };
    if (c.k === 'card' || c.k === 'discard') { const x = id(c.card); if (x == null) return { reason: 'notYourCard' }; c.card = x; }
    if (c.k === 'answer') {
      if (typeof c.value === 'string' && c.value !== 'trade') { const x = id(c.value); if (x == null) return { reason: 'notYourCard' }; c.value = x; }
      else if (c.value && typeof c.value === 'object') { const x = id(c.value.attack); if (x == null) return { reason: 'notYourCard' }; c.value = { attack: x }; }
    }
    return c;
  }

  function onSay(C, m, at) {
    const G = C.guest;
    const T = seatedAt(G);
    const P = personOf(T, G);
    const M = T?.match;
    if (!M || !P || P.left || P.seat == null || M.stopped) return err(C, ERR.notNow);
    const last = M.lastSaid[P.seat];
    if (last != null && at - last < CHAT.cooldownMs) return;      // (the device waits too; a quick repeat is dropped)
    const msg = cleanMessage({ seat: P.seat, id: m.id, about: m.about, at }, M.state.players.length, at);
    if (!msg) return;
    M.lastSaid[P.seat] = at;
    chatAll(T, msg, at);
  }
  function chatAll(T, msg, at) {
    const M = T.match;
    for (const P of T.people) {
      if (P.seat == null || P.left) continue;
      const C = clientOf(T, P);
      if (C) out(C, { t: 'chat', msg: { ...msg } }, true);
    }
    try { M.bots?.hear(msg); } catch { /* a bot that cannot listen still plays */ }
    try { M.chatter?.hear(msg, at); } catch { /* nor talk */ }
  }

  function onVis(C, m, at) {
    C.vis = m.v === 'hidden' ? 'hidden' : 'visible';
    const G = C.guest;
    const T = seatedAt(G);
    const P = personOf(T, G);
    if (!T || !P || P.left || G.conn !== C) return;
    if (touchPresence(T, P, at)) { if (T.match) fanOut(T, at); if (T.phase !== 'playing') broadcastLobby(T, at); }
  }

  function onLeave(C, at) {
    const G = C.guest;
    const T = seatedAt(G);
    const P = personOf(T, G);
    if (!T || !P || P.left) { if (G) G.code = null; return; }
    G.code = null;
    if (T.phase === 'waiting' || T.phase === 'starting') {
      commit(T, at, () => {
        removePerson(T, P);
        cancelCountdownIfShort(T);
        T.lastUsed = at;
      });
      if (!peopleIn(T).length) closeTable(T, at, 'everyone left');
      else broadcastLobby(T, at);
      return;
    }
    commit(T, at, () => {
      P.left = true;
      if (T.match && P.seat != null) T.match.tevents.push({ type: 'left', seat: P.seat });
      touchPresence(T, P, at);
      if (T.host === P.pid) passHost(T);
      T.lastUsed = at;
    });
    if (!peopleIn(T).length) { closeTable(T, at, 'everyone left'); return; }
    if (T.match) fanOut(T, at);
    if (T.phase === 'ended') broadcastLobby(T, at);
  }

  // --- the clock (every ONLINE.timing.tickMs) ------------------------------------------------------------------------------
  function stepTable(T, at) {
    switch (T.phase) {
      case 'waiting': case 'starting': return waitingTick(T, at);
      case 'playing': return playingTick(T, at);
      case 'ended': return endedTick(T, at);
      case 'closed':
        if (at - T.closedAt >= scaled(T_.closedFilesKeepMs)) { tables.delete(T.code); try { store.remove(T.id); } catch { /* gone */ } }
        return;
      default: return;
    }
  }

  function awayFlags(T, at) {
    let changed = false;
    for (const P of T.people) if (live(P) && awayNow(T, P, at) !== !!P.away) changed = touchPresence(T, P, at) || changed;
    return changed;
  }

  function waitingTick(T, at) {
    let changed = awayFlags(T, at);
    // A person away this long loses their seat; a host away this long hands it on (§8.5, §8.6).
    for (const P of [...T.people]) {
      if (live(P) && P.away && P.awaySince != null && at - P.awaySince >= scaled(T_.lobbyAwayFreeMs)) {
        removePerson(T, P);
        const G = guests.get(P.th);
        if (G && G.code === T.code) G.code = null;
        changed = true;
      }
    }
    const H = T.people.find(P => P.pid === T.host);
    if (!H || (H.away && H.awaySince != null && at - H.awaySince >= scaled(T_.hostAwayMs))) {
      const before = T.host;
      passHost(T);
      if (T.host !== before) changed = true;
    }
    if (!peopleIn(T).length) return closeTable(T, at, 'everyone left');
    if (at - T.waitingSince >= scaled(T_.idleWaitingCloseMs)) return closeTable(T, at, 'unused');
    const before = T.phase;
    cancelCountdownIfShort(T);
    if (T.phase !== before) changed = true;
    if (T.phase === 'starting' && at >= T.startsAt) {
      const r = commit(T, at, () => deal(T, at));
      if (!r?.fault) { broadcastLobby(T, at); fanOut(T, at); }
      return;
    }
    if (changed) { save(T, at); broadcastLobby(T, at); }
  }

  function playingTick(T, at) {
    const M = T.match;
    let moved = false;
    const r = commit(T, at, () => {
      moved = awayFlags(T, at);
      moved = M.ref.tick(at) || moved;
      return moved;
    }, { ifChanged: true });
    if (r?.fault) return;
    if (T.match !== M || T.phase === 'closed') return;
    if (moved || at >= M.checkAt || (M.due != null && at >= M.due)) fanOut(T, at);
    talk(T, at);
    // Nobody connected for ONLINE.timing.emptyMatchCloseMs: the match ends without a result and the table closes.
    const anyone = T.people.some(P => live(P) && presenceOf(T, P) !== 'gone');
    if (anyone) T.emptySince = null;
    else {
      T.emptySince ??= at;
      if (at - T.emptySince >= scaled(T_.emptyMatchCloseMs)) closeTable(T, at, 'nobody connected');
    }
  }

  function endedTick(T, at) {
    const M = T.match;
    if (awayFlags(T, at)) { save(T, at); broadcastLobby(T, at); if (M) fanOut(T, at); }
    if (M && at - (M.endedAt ?? T.endedAt ?? at) < CHATTER_AFTER_END_MS) talk(T, at);
    if (!peopleIn(T).length) return closeTable(T, at, 'everyone left');
    if (at - Math.max(T.endedAt ?? 0, T.lastUsed ?? 0) >= scaled(T_.afterMatchCloseMs)) closeTable(T, at, 'unused');
  }

  // The bots' quick chat: at most one line now and then (src/bots/chatter.js), heard by everyone and every bot.
  function talk(T, at) {
    const M = T.match;
    if (!M?.chatter || M.stopped || at - M.chatAt < CHATTER_EVERY_MS) return;
    M.chatAt = at;
    let lines = [];
    try { lines = M.chatter.tick(at, { hold: false }) || []; } catch { M.chatter = null; return; }
    for (const line of lines) {
      const msg = cleanMessage(line, M.state.players.length, at);
      if (msg) chatAll(T, msg, at);
    }
  }

  function prune(at) {
    prunedAt = at;
    for (const [th, G] of guests) if (!G.conn && !G.code && at - G.seenAt > GUEST_FORGET_MS) guests.delete(th);
    for (const [ip, r] of ipLog) { within(r.wrong, at, 10 * MINUTE); within(r.creates, at, MINUTE); if (!r.wrong.length && !r.creates.length) ipLog.delete(ip); }
    for (const [th, r] of tokenLog) { within(r.hellos, at, MINUTE); within(r.creates, at, MINUTE); if (!r.hellos.length && !r.creates.length) tokenLog.delete(th); }
  }

  // --- the interface ---------------------------------------------------------------------------------------------------------
  const rooms = {
    connect(conn, { ip = 'unknown' } = {}) {
      const at = clock();
      clients.set(conn, { conn, ip: String(ip), at, guest: null, n: 0, vis: 'visible', sent: null, helloDone: false });
    },

    message(conn, msg) {
      const C = clients.get(conn);
      if (!C || !msg || typeof msg.t !== 'string') return;
      const at = clock();
      try {
        if (msg.t === 'ping') return out(C, { t: 'pong', at: msg.at, server: at });
        if (msg.t === 'hello') return onHello(C, msg, at);
        if (!C.guest) return;                                   // (nothing else before a hello)
        C.guest.seenAt = at;
        switch (msg.t) {
          case 'peek': return onPeek(C, msg, at);
          case 'create': return onCreate(C, msg, at);
          case 'join': return onJoin(C, msg, at);
          case 'lobby': return onLobby(C, msg, at);
          case 'do': return onDo(C, msg, at);
          case 'say': return onSay(C, msg, at);
          case 'vis': return onVis(C, msg, at);
          case 'leave': return onLeave(C, at);
          default: return undefined;
        }
      } catch (e) {
        log(`a ${msg.t} request failed: ${String(e?.message || e).slice(0, 160)}`);
        return undefined;
      }
    },

    disconnect(conn) {
      const C = clients.get(conn);
      if (!C) return;
      clients.delete(conn);
      const G = C.guest;
      if (!G || G.conn !== C) return;
      G.conn = null;
      const at = clock();
      G.seenAt = at;
      const T = seatedAt(G);
      const P = personOf(T, G);
      if (!T || !P || P.left) return;
      try {
        if (touchPresence(T, P, at)) { if (T.match) fanOut(T, at); if (T.phase !== 'playing') broadcastLobby(T, at); }
      } catch (e) { fault(T, at, e); }
    },

    tick(at = clock()) {
      for (const C of [...clients.values()]) {
        if (!C.guest && !C.helloDone && at - C.at >= T_.helloTimeoutMs) { clients.delete(C.conn); shut(C, BYE.noHello, 'no hello'); }
      }
      for (const T of [...tables.values()]) {
        try { stepTable(T, at); } catch (e) { fault(T, at, e); }
      }
      if (at - prunedAt >= PRUNE_EVERY_MS) prune(at);
    },

    // Every saved table back, before the server listens (§10.5). Matches move every time they hold later by the
    // outage plus ONLINE.timing.restoreGraceMs (whoever was playing gets their time back); everyone is `gone` until
    // their device reconnects. A match saved under other rules data ends politely instead.
    restore(at = clock()) {
      let n = 0, matches = 0, stopped = 0;
      for (const s of store.load()) {
        try {
          if (!s || s.v !== ROOMS_VERSION || !s.code) continue;
          const T = tableFromSave(s);
          T.creatorIp = null;
          if (T.phase === 'starting') { T.phase = 'waiting'; T.startsAt = null; }
          tables.set(T.code, T);
          n++;
          if (T.phase === 'closed') continue;
          for (const P of T.people) {
            P.away = true; P.awaySince = at; P.hiddenAt = null;
            if (!live(P)) continue;
            let G = guests.get(P.th);
            if (!G) { G = { th: P.th, conn: null, name: P.name, avatar: P.avatar, code: null, seenAt: at, ops: [] }; guests.set(P.th, G); }
            G.code = T.code;
          }
          if (s.match && s.match.dataHash !== dataHash()) {
            T.match = rebuildMatchSafe(T, s.match);
            endPolitely(T, at, 'update');
            stopped++;
            continue;
          }
          if (s.match) {
            const M = rebuildMatch(T, s.match);
            M.ref.shift(Math.max(0, at - (s.savedAt ?? at)) + scaled(T_.restoreGraceMs));
            T.match = M;
            for (const seat of M.people) M.ref.setPresence(seat, 'gone', at);
            M.due = M.ref.nextDue();
            if (T.phase === 'playing') matches++;
          }
          save(T, at);
        } catch (e) {
          log(`a saved table could not be restored: ${String(e?.message || e).slice(0, 160)}`);
        }
      }
      log(`restored ${n} tables (${matches} matches running, ${stopped} stopped for new rules data)`);
      return { tables: n, matches, stopped };
    },

    // SIGTERM (§10.5): save every table now (so the outage is measured from here), then tell every device to come
    // back in ONLINE.timing.restartRetryMs and close its socket (1012).
    shutdown(at = clock()) {
      for (const T of tables.values()) { try { save(T, at); } catch (e) { log(`table ${T.id}: not saved at shutdown: ${String(e?.message || e).slice(0, 120)}`); } }
      for (const C of [...clients.values()]) { out(C, { t: 'bye', why: 'restart', retryMs: T_.restartRetryMs }); shut(C, BYE.restart, 'restart'); }
      clients.clear();
    },

    health(at = clock()) {
      const open = [...tables.values()].filter(T => T.phase !== 'closed');
      return {
        ok: true, protocol: [MIN_PROTOCOL, PROTOCOL], data: dataHash(),
        tables: open.length, matches: open.filter(T => T.phase === 'playing').length,
        people: [...guests.values()].filter(G => G.conn).length,
        uptimeS: Math.round((at - bornAt) / 1000),
      };
    },

    // Tests only (fairness-check, protocol-check): the live objects. A device can never reach these.
    debug: {
      tables, guests, clients,
      table: code => tables.get(code) ?? null,
      // After a test has changed a match by hand: the aliases follow, the table is saved and everyone's view sent.
      refresh(code, at = clock()) {
        const T = tables.get(code);
        if (!T?.match) return false;
        afterStep(T, at); save(T, at); fanOut(T, at);
        return true;
      },
      timeScale: ts,
      limits: L,
      refLimits,
    },
  };

  function rebuildMatchSafe(T, sm) {
    try { return rebuildMatch(T, sm); } catch { return null; }
  }

  return rooms;
}
