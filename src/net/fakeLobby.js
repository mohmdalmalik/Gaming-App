// DEVELOPMENT ONLY: a pretend Co-op server inside the page, for building and testing the Co-op screens
// (src/ui/coopMenu.js) before the real one exists. Loaded only by a dynamic import() when the page is on localhost
// or 127.0.0.1 with ?coop=fake (src/ui/menu.js), so the live site never even fetches this file.
//
//   openFakeCoop(opts)  has the same shape as openCoop (src/net/onlineTable.js) and answers the same way:
//     opts:   { server, profile: { username, avatar }, intent, storage, remember, setUrl }
//     intent: { create: { size } } | { join: { code } } | { resume: true } | { peek: code }
//     → Promise<coop>, where coop is
//       coop.lobby                 the latest LobbyView (DESIGN §8.4) for this seat, or null
//       coop.status                'connecting' | 'live' | 'reconnecting' | 'lost' | 'closed'
//       coop.on(kind, fn)          → unsubscribe; kind: 'lobby' (LobbyView) · 'status' (status) · 'error' ({ code })
//                                  · 'peeked' ({ code, host }) · 'match' (table) · 'bye' ({ why })
//       coop.lobbyOp(op)           → Promise<{ ok, reason? }>; op: {k:'size',n} · {k:'lock',on} · {k:'remove',pid}
//                                  · {k:'start'} · {k:'wait'} · {k:'again'} · {k:'look',avatar}
//       coop.leave()               leave the table (or stop trying)
//       coop.table                 once a match is dealt: a stand-in { kind: 'online', fake: true } ('match' fires)
//
// One pretend server per page (`fakeHub`), so two seats opened in the same page (the review link's two seats on one
// iPad) sit at the same table. Every waiting-room change and every error the real server can send can be made on
// purpose, from the address bar or from a test (window.__fakeLobby):
//   ?fake=friends    (the default) after you start a table, sam sits down, then ivy, who is Away for a while
//   ?fake=quiet      nobody else comes: everything is driven by hand (the tests use this)
//   ?fakeErr=busy    the next create or join answers that error code (any code of DESIGN §7.2, or 'unreachable')
//   ?fakeDelay=5000  the "server" takes this long to answer (the switchboard waking up)
// Codes that always exist: BKTWM (nora's table, waiting, with ivy), MMMMM (mid-match), FFFFF (full), BBBBB (locked),
// CCCCC (closed), DDDDD (you were removed). Any other code: notFound.
//
// It is pure data and timers; nothing here is a rule. The words the player reads are the screens' (src/data/onlineText.js).
import { ONLINE } from '../data/online.js';
import { newCode } from './codes.js';
import { guestMarks } from '../table.js';
import { randomAvatar } from '../data/randomAvatar.js';
import { normaliseAvatar } from '../data/wardrobe.js';

const randomBytes = b => globalThis.crypto.getRandomValues(b);

// The pretend server: tables by code. Scripted people (sam, ivy, nora…) are seats with no device behind them.
export const fakeHub = {
  tables: new Map(),
  script: 'friends',
  nextError: null,      // the next create/join answers this code
  delayMs: 250,         // how long the "server" takes to answer
  timeScale: 1,         // the countdown and the scripted friends run this many times faster
  pidSeq: 0,
  timers: new Set(),
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.tables.clear();
    this.nextError = null;
    seedTables();
  },
};
const later = (ms, fn) => {
  const t = setTimeout(() => { fakeHub.timers.delete(t); fn(); }, Math.max(0, ms / fakeHub.timeScale));
  fakeHub.timers.add(t);
  return t;
};

function person(name, { token = null, coop = null, away = false } = {}) {
  return { pid: `p${++fakeHub.pidSeq}`, name, avatar: normaliseAvatar(randomAvatar(name), { trusted: true }), token, coop, away };
}
function newTable(code, { size = ONLINE.table.defaultSize, phase = 'waiting', locked = false } = {}) {
  const t = { code, size, phase, locked, people: [], host: null, removed: new Set(), startsAt: null, countdown: null, closed: false };
  fakeHub.tables.set(code, t);
  return t;
}
function seedTables() {
  const nora = newTable('BKTWM');
  nora.people.push(person('nora'), person('ivy'));
  nora.host = nora.people[0].pid;
  const mid = newTable('MMMMM', { phase: 'playing' });
  mid.people.push(person('nora')); mid.host = mid.people[0].pid;
  const full = newTable('FFFFF');
  for (const n of ['nora', 'sam', 'ivy', 'pebble', 'jules', 'ruth']) full.people.push(person(n));
  full.host = full.people[0].pid;
  const locked = newTable('BBBBB', { locked: true });
  locked.people.push(person('nora')); locked.host = locked.people[0].pid;
  newTable('CCCCC').closed = true;
  const removed = newTable('DDDDD');
  removed.people.push(person('nora')); removed.host = removed.people[0].pid;
  removed.removed.add('*');     // (everyone is "removed" here: the card for it)
}
seedTables();

// What one seat sees of a table (DESIGN §8.4).
function lobbyFor(t, me) {
  const marks = guestMarks(t.people.map(p => p.name));
  const people = t.people.map((p, i) => ({ pid: p.pid, name: p.name, avatar: p.avatar, mark: marks[i], host: p.pid === t.host, you: p.pid === me.pid, away: !!p.away }));
  const enough = t.people.length >= ONLINE.table.minPeople;
  return {
    code: t.code, phase: t.phase, startsInMs: t.startsAt ? Math.max(0, Math.round((t.startsAt - performance.now()) * fakeHub.timeScale)) : null,
    size: t.size, locked: t.locked, you: me.pid, host: t.host,
    canStart: t.phase === 'waiting' && enough, why: enough ? null : 'needFriend', people, queued: null,
  };
}
function broadcast(t) {
  for (const p of t.people) if (p.coop) p.coop._lobby(lobbyFor(t, p));
}

function pickHostAfter(t) {
  if (t.people.some(p => p.pid === t.host)) return;
  t.host = t.people[0]?.pid || null;     // (the person seated longest)
  if (!t.people.length) { t.closed = true; t.phase = 'closed'; fakeHub.tables.delete(t.code); }
}

function cancelCountdown(t) {
  if (t.countdown) { clearTimeout(t.countdown); fakeHub.timers.delete(t.countdown); }
  t.countdown = null; t.startsAt = null;
}

// The scripted friends of ?fake=friends: they come and go after you start a table.
function scriptFriends(t) {
  if (fakeHub.script !== 'friends') return;
  const join = (name, ms) => later(ms, () => { if (t.phase === 'waiting' && !t.locked && t.people.length < t.size) { t.people.push(person(name)); broadcast(t); } });
  join('sam', 2500);
  join('ivy', 5000);
  later(9000, () => { const ivy = t.people.find(p => p.name === 'ivy'); if (ivy) { ivy.away = true; broadcast(t); } });
  later(16000, () => { const ivy = t.people.find(p => p.name === 'ivy'); if (ivy) { ivy.away = false; broadcast(t); } });
}

export function openFakeCoop({ profile = null, intent = {}, storage = null } = {}) {
  const listeners = { lobby: new Set(), status: new Set(), error: new Set(), peeked: new Set(), match: new Set(), bye: new Set() };
  const emit = (kind, x) => { for (const fn of [...listeners[kind]]) { try { fn(x); } catch (err) { console.error('fake lobby listener failed:', err); } } };
  let token = null;
  try { token = storage?.getItem?.(ONLINE.storage.guest) || null; } catch { /* none */ }
  if (!token) { token = `fake-${Math.random().toString(36).slice(2, 10)}`; try { storage?.setItem?.(ONLINE.storage.guest, token); } catch { /* fine */ } }
  let me = null;           // my seat (a person) once seated
  let table = null;
  let left = false;
  const name = profile?.username || 'Guest';
  const avatar = profile?.avatar ? normaliseAvatar(profile.avatar, { trusted: true }) : null;

  const coop = {
    lobby: null,
    status: 'connecting',
    table: null,
    on(kind, fn) { listeners[kind]?.add(fn); return () => listeners[kind]?.delete(fn); },
    _lobby(lv) { if (left) return; coop.lobby = lv; emit('lobby', lv); },
    _error(code) { if (left) return; emit('error', { code }); },
    _bye(why) { if (left) return; setStatus('closed'); emit('bye', { why }); },
    _status(st) { if (!left) setStatus(st); },
    _match() { if (left) return; coop.table = { kind: 'online', fake: true, seat: table?.people.findIndex(p => p === me) ?? 0 }; emit('match', coop.table); },
    async lobbyOp(op = {}) {
      await new Promise(r => later(Math.min(fakeHub.delayMs, 150), r));
      if (left || !table || !me) return { ok: false, reason: 'notNow' };
      const t = table, isHost = t.host === me.pid;
      const hostOnly = ['size', 'lock', 'remove', 'start', 'wait', 'again'];
      if (hostOnly.includes(op.k) && !isHost) return { ok: false, reason: 'notHost' };
      switch (op.k) {
        case 'size':
          if (t.phase !== 'waiting' || !ONLINE.table.sizes.includes(op.n) || op.n < t.people.length) return { ok: false, reason: 'notNow' };
          t.size = op.n; break;
        case 'lock': if (t.phase !== 'waiting') return { ok: false, reason: 'notNow' }; t.locked = !!op.on; break;
        case 'remove': {
          const p = t.people.find(x => x.pid === op.pid);
          if (!p || p === me || t.phase !== 'waiting') return { ok: false, reason: 'notNow' };
          t.people.splice(t.people.indexOf(p), 1);
          t.removed.add(p.token || p.name);
          p.coop?._bye('removed');
          break;
        }
        case 'start':
          if (t.phase !== 'waiting' || t.people.length < ONLINE.table.minPeople) return { ok: false, reason: 'notNow' };
          t.phase = 'starting';
          t.startsAt = performance.now() + ONLINE.timing.startCountdownMs / fakeHub.timeScale;
          t.countdown = later(ONLINE.timing.startCountdownMs, () => {
            t.countdown = null; t.startsAt = null; t.phase = 'playing';
            broadcast(t);
            for (const p of t.people) p.coop?._match();
          });
          break;
        case 'wait': if (t.phase !== 'starting') return { ok: false, reason: 'notNow' }; cancelCountdown(t); t.phase = 'waiting'; break;
        case 'again': if (t.phase !== 'playing' && t.phase !== 'ended') return { ok: false, reason: 'notNow' }; t.phase = 'waiting'; break;
        case 'look': if (op.avatar) me.avatar = normaliseAvatar(op.avatar, { trusted: true }); break;
        default: return { ok: false, reason: 'badOp' };
      }
      broadcast(t);
      return { ok: true };
    },
    leave() {
      if (left) return;
      if (table && me) {
        const t = table;
        t.people.splice(t.people.indexOf(me), 1);
        if (t.phase === 'starting' && t.people.length < ONLINE.table.minPeople) { cancelCountdown(t); t.phase = 'waiting'; }
        pickHostAfter(t);
        broadcast(t);
      }
      left = true;
      setStatus('closed');
    },
  };
  function setStatus(s) { if (coop.status === s) return; coop.status = s; emit('status', s); }

  function seat(t) {
    me = person(name, { token, coop });
    if (avatar) me.avatar = avatar;
    t.people.push(me);
    if (!t.host) t.host = me.pid;
    table = t;
    broadcast(t);
  }

  function answer() {
    if (left) return;
    const err = fakeHub.nextError;
    if (err === 'unreachable') { setStatus('reconnecting'); later(ONLINE.timing.lostCardMs, () => setStatus('lost')); return; }
    setStatus('live');
    if (intent.peek != null) {
      const t = fakeHub.tables.get(String(intent.peek));
      if (t && t.phase === 'waiting' && !t.closed) emit('peeked', { code: t.code, host: t.people.find(p => p.pid === t.host)?.name || '' });
      else coop._error('notFound');
      return;
    }
    if ((intent.create || intent.join) && err) { fakeHub.nextError = null; coop._error(err); return; }
    if (intent.create) {
      const t = newTable(newCode(randomBytes), { size: intent.create.size || ONLINE.table.defaultSize });
      seat(t);
      scriptFriends(t);
      return;
    }
    if (intent.join) {
      const t = fakeHub.tables.get(String(intent.join.code || ''));
      if (!t) return coop._error('notFound');
      if (t.closed) return coop._error('closed');
      if (t.removed.has('*') || t.removed.has(token)) return coop._error('removed');
      if (t.phase === 'playing' || t.phase === 'ended') return coop._error('midMatch');
      if (t.locked) return coop._error('locked');
      if (t.people.length >= t.size) return coop._error('full');
      seat(t);
      return;
    }
    if (intent.resume) {
      for (const t of fakeHub.tables.values()) {
        const p = t.people.find(x => x.token === token && !x.coop);
        if (p) { me = p; p.coop = coop; table = t; broadcast(t); return; }
      }
      coop._error('closed');
    }
  }

  setStatus('connecting');
  later(fakeHub.delayMs, answer);
  return Promise.resolve(coop);
}

// Test and development hooks (a page on localhost only: this file is never loaded anywhere else).
function tableOf(code) { return code ? fakeHub.tables.get(code) : [...fakeHub.tables.values()].find(t => t.people.some(p => p.coop)); }
export const fakeHooks = {
  hub: fakeHub,
  reset: () => fakeHub.reset(),
  script: s => { fakeHub.script = s; },
  nextError: code => { fakeHub.nextError = code || null; },
  delay: ms => { fakeHub.delayMs = Math.max(0, +ms || 0); },
  timeScale: n => { fakeHub.timeScale = Math.max(0.01, +n || 1); },     // (below 1: slower, e.g. a countdown that waits for a screenshot)
  // the table you sit at (or the one with that code)
  lobby: code => { const t = tableOf(code); return t ? { code: t.code, phase: t.phase, size: t.size, locked: t.locked, host: t.host, people: t.people.map(p => ({ pid: p.pid, name: p.name, away: p.away, device: !!p.coop })) } : null; },
  addPerson(name, code) { const t = tableOf(code); if (!t || t.people.length >= t.size) return false; t.people.push(person(name)); broadcast(t); return true; },
  removePerson(name, code) { const t = tableOf(code); const p = t?.people.find(x => x.name === name && !x.coop); if (!p) return false; t.people.splice(t.people.indexOf(p), 1); pickHostAfter(t); broadcast(t); return true; },
  setAway(name, on = true, code) { const t = tableOf(code); const p = t?.people.find(x => x.name === name); if (!p) return false; p.away = !!on; broadcast(t); return true; },
  // the host leaves (a scripted host, or the device's own seat when it is the host)
  hostLeaves(code) { const t = tableOf(code); const h = t?.people.find(p => p.pid === t.host); if (!h) return false; if (h.coop) { h.coop.leave(); return true; } t.people.splice(t.people.indexOf(h), 1); pickHostAfter(t); broadcast(t); return true; },
  makeHost(name, code) { const t = tableOf(code); const p = t?.people.find(x => x.name === name); if (!p) return false; t.host = p.pid; broadcast(t); return true; },
  // what a scripted host chooses: lock the table, its size
  lock(on = true, code) { const t = tableOf(code); if (!t) return false; t.locked = !!on; broadcast(t); return true; },
  size(n, code) { const t = tableOf(code); if (!t || !ONLINE.table.sizes.includes(n) || n < t.people.length) return false; t.size = n; broadcast(t); return true; },
  // a scripted host starts or stops the countdown, or every device at the table gets an error or a goodbye
  start(code) { const t = tableOf(code); if (!t) return false; t.phase = 'starting'; t.startsAt = performance.now() + ONLINE.timing.startCountdownMs / fakeHub.timeScale; t.countdown = later(ONLINE.timing.startCountdownMs, () => { t.countdown = null; t.startsAt = null; t.phase = 'playing'; broadcast(t); for (const p of t.people) p.coop?._match(); }); broadcast(t); return true; },
  wait(code) { const t = tableOf(code); if (!t) return false; cancelCountdown(t); t.phase = 'waiting'; broadcast(t); return true; },
  error(code, tableCode) { const t = tableOf(tableCode); for (const p of t?.people || []) p.coop?._error(code); return !!t; },
  // (a goodbye that ends your place there frees your seat, as the real server does: removed for good, or closed)
  bye(why, tableCode) {
    const t = tableOf(tableCode);
    if (!t) return false;
    for (const p of [...t.people]) {
      if (!p.coop) continue;
      p.coop._bye(why);
      if (why === 'removed' || why === 'closed') { t.people.splice(t.people.indexOf(p), 1); if (why === 'removed') t.removed.add(p.token); }
    }
    pickHostAfter(t);
    broadcast(t);
    return true;
  },
  // every device at the table loses (or regains) the "server": 'reconnecting', 'lost', 'live'
  status(s, tableCode) { const t = tableOf(tableCode); for (const p of t?.people || []) p.coop?._status(s); return !!t; },
};
