// Co-op (the label is ONLINE_TEXT.label, owner decision D1): the menu's screens for playing with friends, each on their
// own device (DESIGN §14.4-§14.8). Two screens of the menu (src/ui/menu.js shows them; index.html holds them):
//   coop    "A private table": Start a table, or type a code and Join. The same screen holds ONE card at a time
//           (#coop-card: title, line, buttons) for Coming soon and every can't-join case (§14.8).
//   table   "Your private table", the waiting room (#menu-table): the code with Invite friends and Copy link, the seats
//           (portrait, name, Host · You · Away), the host's size and lock, Start with its 5-second countdown, Leave,
//           the Wardrobe; the remove / alone / away questions; toasts as friends come and go.
// Every word is src/data/onlineText.js's (`text`), every number src/data/online.js's. Nothing here knows how the
// server is reached: `openCoop` (src/net/onlineTable.js; the fake lobby in development, src/net/fakeLobby.js; the
// in-page loopback on the review link) is handed in, with `resolveServer` (src/net/serverUrl.js). It returns a coop:
//   coop.on('lobby' | 'status' | 'error' | 'peeked' | 'match' | 'bye', fn) → unsubscribe · coop.lobby (LobbyView,
//   DESIGN §8.4) · coop.lobbyOp(op) → Promise<{ ok, reason? }> · coop.leave() · coop.table (once dealt)
// A match being dealt calls `onMatch(coop)` (src/main.js passes it once the match itself is built); until then the
// waiting room says so in one line (demo.dealt).
//
// The review link (?friends=demo, DESIGN §16) holds TWO seats on one device: `startDemo()` makes a second seat (sam,
// with its own device key in a memory storage) and the switch "Show sam's screen" (src/ui/seatSwitch.js). Each seat
// keeps its own screen, table and connection; only the seat shown draws, and a switch redraws it fresh.
import { ONLINE, ONLINE_RULES } from '../data/online.js';
import { ONLINE_TEXT, fill, byRules } from '../data/onlineText.js';
import { normaliseCode, codeProblem } from '../net/codes.js';
import { makePortrait } from './portrait.js';
import { outfitOf } from '../data/wardrobe.js';
import { SEAT_COLORS } from '../table.js';
import { createSeatSwitch } from './seatSwitch.js';
import { holdWakeLock } from '../net/wakeLock.js';

// What each can't-join card's buttons do, in order (the words: text.errors[kind].buttons, text.soon, text.recovery).
const CARD_ACTIONS = {
  notFound: ['edit', 'back'], full: ['create', 'back'], midMatch: ['retry', 'main'], locked: ['back'], removed: ['main'],
  closed: ['create', 'main'], tooMany: ['back'], busy: ['retry', 'single'], offline: ['single', 'retry'],
  unreachable: ['retry', 'single'], update: ['update'], serverOld: ['retry'], elsewhere: ['resume', 'main'],
  soon: ['single', 'main'], soonJoin: ['single', 'main'],     // (Coming soon's Back: there is no Co-op screen to go back to)
};
const CLOSERS = new Set(['back', 'main']);   // (they sound like a closing drawer: src/audio/buttonCues.js)
const BYE_CARDS = { removed: 'removed', closed: 'closed', elsewhere: 'elsewhere', update: 'update', serverOld: 'serverOld', busy: 'busy' };

// A memory storage, for a seat that must not share the device's key (the review link's second seat).
export function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } };
}

export function createCoopMenu(doc, {
  text = ONLINE_TEXT,
  resolveServer = () => ({ comingSoon: true }),
  openCoop = () => Promise.reject({ code: 'comingSoon' }),
  transport = null,
  onMatch = null,
  onSeat = null,              // (the review link, in a match) (i, coop) → true when the match shows seat i now
  onSinglePlayer = null,
  account = null,
  sfx = () => {},
  go = () => {},              // ask the menu for a screen: 'main' | 'single' | 'bots' | 'coop' | 'table' | 'avatar'
  menuScreen = () => null,    // the screen the menu shows now (null: the menu is away, a match is on)
  guard = () => false,        // the menu's tap guard (src/ui/tapGuard.js): true for the second tap of a double tap
  win = globalThis.window,
  nav = globalThis.navigator,
  rules = ONLINE_RULES,
} = {}) {
  const $ = id => doc.getElementById(id);
  const words = (path, vars) => fill(path.split('.').reduce((o, k) => (o == null ? o : o[k]), text), vars);
  const el = {
    coop: $('menu-coop'), table: $('menu-table'), form: $('coop-form'), card: $('coop-card'), panel: doc.querySelector('#menu .menu-panel'),
    code: $('coop-code'), start: $('btn-coop-start'), join: $('btn-coop-join'), status: $('coop-status'), cancel: $('btn-coop-cancel'),
    startMain: doc.querySelector('#btn-coop-start .mb-main'), cardA: $('btn-coop-card-a'), cardB: $('btn-coop-card-b'),
    seats: $('table-seats'), size: $('table-size'), lock: $('table-lock'), tStatus: $('table-status'), dialog: $('table-dialog'),
    body: $('table-body'), toast: $('coop-toast'),
  };
  if (!el.coop || !el.table) return { show() {}, openJoin() {}, resume() {}, peek: async () => null, look() {}, startDemo: async () => false, get hasTable() { return false; }, get demo() { return false; } };

  // Fill every fixed word of the two screens (data-ot="coop.heading" …): renaming "Co-op" is one line of onlineText.js.
  for (const node of doc.querySelectorAll('[data-ot]')) {
    const w = words(node.dataset.ot, { length: ONLINE.code.length });
    if (typeof w === 'string') { if (node.tagName === 'INPUT') node.placeholder = w; else node.textContent = w; }
  }
  if (el.code) el.code.maxLength = ONLINE.code.inputMax;
  // (going offline, or back online, redraws the screen shown: its buttons dim and its line says so)
  win?.addEventListener?.('online', () => draw(S()));
  win?.addEventListener?.('offline', () => draw(S()));

  // --- seats: one normally; two on the review link -----------------------------------------------------------------
  const seats = [newSeat({ main: true })];
  let active = 0;
  let demo = false;
  let switcher = null;
  const S = () => seats[active];
  function newSeat({ main = false, profile = null, storage, remember = true, setUrl = true } = {}) {
    return { main, profile, storage, remember, setUrl, coop: null, lobby: null, screen: 'coop', card: null, codeText: '', pending: null,
      lastIntent: null, slow: 0, status: 'closed', dealt: false, gen: 0, unsubs: [], timers: [], fieldError: '', toast: null, countEnd: 0 };
  }
  const profileOf = seat => (seat.main ? account?.profile || null : seat.profile);
  const nameOf = seat => profileOf(seat)?.username || '';

  // --- small helpers -------------------------------------------------------------------------------------------------
  const offline = () => nav && nav.onLine === false;
  const later = (seat, ms, fn) => { const t = setTimeout(fn, ms); seat.timers.push(t); return t; };
  const stopWaiting = seat => { seat.timers.forEach(clearTimeout); seat.timers = []; seat.slow = 0; };
  const tap = (node, fn) => node?.addEventListener('click', e => { e.preventDefault(); if (guard(e)) return; fn(e); });
  const hostOf = lv => lv?.people.find(p => p.pid === lv.host) || null;
  const linkFor = code => {
    const loc = win?.location;
    return loc ? `${loc.origin}${loc.pathname}?join=${code}` : `?join=${code}`;
  };

  function detach(seat) {
    seat.unsubs.forEach(u => { try { u?.(); } catch { /* gone */ } });
    seat.unsubs = [];
  }
  // Close a seat's connection (Leave table, Back while opening, a card that ends it).
  function drop(seat, { leave = true } = {}) {
    seat.gen++;
    stopWaiting(seat);
    detach(seat);
    if (leave) { try { seat.coop?.leave?.(); } catch { /* gone */ } }
    seat.coop = null; seat.lobby = null; seat.pending = null; seat.dealt = false; seat.status = 'closed'; seat.screen = 'coop';
    stopCount(seat);
    if (seat === seats[0]) switcher?.show(false);
    awake();
  }
  // (the screen stays awake while this device sits at a table: the waiting room and the match, src/net/wakeLock.js)
  const awake = () => holdWakeLock(seats.some(s => !!s.lobby));

  // --- opening a table, joining one, coming back to one -----------------------------------------------------------
  async function open(seat, intent, kind) {
    drop(seat);
    seat.card = null; seat.fieldError = '';
    const server = resolveServer();
    if (server?.comingSoon) { seat.card = { kind: kind === 'join' && seat.fromLink ? 'soonJoin' : 'soon' }; return draw(seat, 'coop'); }
    if (offline()) { seat.card = { kind: 'offline' }; return draw(seat, 'coop'); }
    const gen = seat.gen;
    seat.pending = kind; seat.lastIntent = { intent, kind };
    later(seat, ONLINE.timing.reconnectPillMs, () => { seat.slow = 1; if (seat.gen === gen) draw(seat); });
    later(seat, ONLINE.timing.wakeSlowMs, () => { seat.slow = 2; if (seat.gen === gen) draw(seat); });
    draw(seat, 'coop');
    let coop;
    try {
      coop = await openCoop({ server, profile: profileOf(seat), intent, transport, storage: seat.storage, remember: seat.remember, setUrl: seat.setUrl });
    } catch (err) {
      if (seat.gen !== gen) return;
      stopWaiting(seat); seat.pending = null;
      seat.card = { kind: err?.code === 'comingSoon' ? 'soon' : CARD_ACTIONS[err?.code] ? err.code : 'unreachable', vars: { code: intent.join?.code } };
      return draw(seat, 'coop');
    }
    if (seat.gen !== gen) { try { coop?.leave?.(); } catch { /* gone */ } return; }
    seat.coop = coop;
    seat.status = coop.status || 'connecting';
    seat.unsubs.push(
      coop.on('lobby', lv => onLobby(seat, lv)),
      coop.on('status', s => onStatus(seat, s)),
      coop.on('error', e => onError(seat, e || {})),
      coop.on('bye', b => onBye(seat, b || {})),
      coop.on('match', () => onDealt(seat)),
    );
    if (coop.lobby) onLobby(seat, coop.lobby);
  }

  function onLobby(seat, lv) {
    if (!lv) return;
    const prev = seat.lobby;
    seat.lobby = lv;
    if (!prev) {
      stopWaiting(seat);
      const joined = seat.pending === 'join';
      seat.pending = null; seat.card = null; seat.screen = 'table';
      if (joined && lv.host !== lv.you) toast(seat, words('toasts.joinedYou', { host: hostOf(lv)?.name || '' }));
      if (seat === seats[0] && demo) switcher?.show(true);
    } else {
      // who came and went (the bell rings for people: bots are never in a LobbyView's people)
      const before = new Map(prev.people.map(p => [p.pid, p]));
      const now = new Set(lv.people.map(p => p.pid));
      for (const p of lv.people) if (!before.has(p.pid) && p.pid !== lv.you) { toast(seat, words('toasts.joined', { name: p.name })); if (seat === S()) sfx('joined'); }
      for (const p of prev.people) {
        if (now.has(p.pid)) continue;
        if (p.pid === prev.host && lv.host !== prev.host) toast(seat, words('toasts.hostLeft', { name: p.name, host: hostOf(lv)?.name || '' }));
        else toast(seat, words('toasts.left', { name: p.name }));
      }
    }
    if (lv.phase === 'starting' && lv.startsInMs != null) startCount(seat, lv.startsInMs); else stopCount(seat);
    if (lv.phase === 'waiting') seat.dealt = false;
    if (!prev) awake();
    draw(seat, 'table');
  }

  function onStatus(seat, s) {
    seat.status = s;
    // (still opening, and the server can't be reached for a long while: the card says so; waiting rooms say Reconnecting…)
    if (!seat.lobby && seat.pending && s === 'lost') { drop(seat); seat.card = { kind: 'unreachable' }; return draw(seat, 'coop', { force: true }); }
    if (seat.lobby) draw(seat);
  }

  function onError(seat, { code }) {
    if (!seat.lobby) {
      if (code === 'badCode') { drop(seat); seat.fieldError = words('coop.codeLetters'); return draw(seat, 'coop'); }
      const kind = CARD_ACTIONS[code] ? code : 'unreachable';
      const vars = { code: seat.lastIntent?.intent?.join?.code || '', size: ONLINE.table.maxPeople };
      drop(seat);
      seat.card = { kind, vars };
      return draw(seat, 'coop', { force: true });
    }
    // in the waiting room: a refused op says nothing (the screen is redrawn from the next LobbyView); an ending one shows its card
    if (['removed', 'closed', 'update', 'serverOld', 'busy'].includes(code)) { drop(seat); seat.card = { kind: code }; draw(seat, 'coop', { force: true }); }
  }

  function onBye(seat, { why }) {
    const kind = BYE_CARDS[why];
    if (!kind) return;           // (restart and the silent closes: the connection comes back by itself)
    drop(seat, { leave: false });
    seat.card = { kind };
    draw(seat, 'coop', { force: true });
  }

  function onDealt(seat) {
    seat.dealt = true;
    stopCount(seat);
    // (onMatch answers false for a match it cannot show: the pretend server's has no table to play)
    seat.shown = false;
    if (onMatch) { try { seat.shown = onMatch(seat.coop, { seat: seats.indexOf(seat), demo }) !== false; } catch (err) { console.error('starting the Co-op match failed:', err); } }
    draw(seat);
  }

  // --- the countdown ("The lift is on its way… 5") -------------------------------------------------------------------
  let countTimer = null;
  function startCount(seat, ms) {
    seat.countEnd = performance.now() + ms;
    if (!countTimer) countTimer = setInterval(() => { const s = S(); if (s.countEnd) renderCount(s); }, 200);
  }
  function stopCount(seat) {
    seat.countEnd = 0;
    if (countTimer && !seats.some(s => s.countEnd)) { clearInterval(countTimer); countTimer = null; }
  }
  const countLeft = seat => Math.max(1, Math.ceil((seat.countEnd - performance.now()) / 1000));

  // --- toasts ---------------------------------------------------------------------------------------------------------
  let toastTimer = null;
  function toast(seat, msg) {
    if (seat !== S() || !el.toast || !msg) return;
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  // --- drawing ----------------------------------------------------------------------------------------------------------
  // `screen`: move the seat to it. The menu follows only while it shows one of the two Co-op screens (a table that
  // changes while you are in the Wardrobe waits for you there); `force` (a card that ends your table) follows from any
  // menu screen. With the menu away (a match on), nothing moves: the screen is drawn when the menu shows it again.
  function draw(seat, screen = null, { force = false } = {}) {
    if (screen) seat.screen = screen;
    if (seat !== S()) return;
    const now = menuScreen();
    const ours = now === 'coop' || now === 'table';
    if (screen && now !== screen && (ours || (force && now))) { go(screen); return; }   // (the menu calls show() back, which draws)
    if (ours) render();
  }
  function render() {
    const seat = S();
    if (seat.screen === 'table' && seat.lobby) renderTable(seat); else renderCoop(seat);
  }

  function renderCoop(seat) {
    const demoNote = $('coop-demo');
    if (demoNote) { demoNote.textContent = demo ? words('demo.note') : ''; demoNote.hidden = !demo; }
    if (seat.card) return renderCard(seat);
    el.form.hidden = false; el.card.hidden = true;
    const off = offline();
    const busy = !!seat.pending;
    el.start.disabled = off || busy; el.join.disabled = off || busy; el.code.disabled = off;
    el.coop.classList.toggle('offline', off);
    if (el.startMain) el.startMain.textContent = seat.pending === 'create' && seat.slow ? words('coop.opening') : words('coop.start');
    el.join.textContent = seat.pending === 'join' && seat.slow ? words('coop.looking') : words('coop.join');
    if (doc.activeElement !== el.code) el.code.value = seat.codeText;
    const rejoining = seat.pending === 'resume';
    let line = '';
    if (off) line = words('coop.offline');
    else if (rejoining) line = words('coop.rejoining');
    else if (seat.slow === 2) line = words('coop.waking');
    else if (seat.fieldError) line = seat.fieldError;
    el.status.textContent = line;
    el.status.classList.toggle('bad', !!seat.fieldError && !off && !busy);
    if (el.cancel) el.cancel.hidden = !rejoining;
  }

  function renderCard(seat) {
    el.form.hidden = true; el.card.hidden = false;
    const { kind, vars = {} } = seat.card;
    const v = { size: ONLINE.table.maxPeople, ...vars };
    let title, line, buttons;
    if (kind === 'soon') { title = words('soon.heading'); line = `${words('soon.line')} ${words('soon.ready')}`; buttons = [words('soon.single'), words('soon.back')]; }
    else if (kind === 'soonJoin') { title = words('soon.joinHeading'); line = words('soon.joinLine'); buttons = [words('soon.single'), words('soon.mainMenu')]; }
    else if (kind === 'elsewhere') { const e = text.recovery.elsewhere; title = fill(e.title, v); line = fill(e.line, v); buttons = e.buttons; }
    else {
      const e = text.errors[kind] || text.errors.unreachable;
      title = fill(e.title, v); line = fill(e.line, v); buttons = e.buttons;
    }
    $('coop-card-title').textContent = title;
    $('coop-card-line').textContent = line;
    const acts = CARD_ACTIONS[kind] || CARD_ACTIONS.unreachable;
    [el.cardA, el.cardB].forEach((b, i) => {
      b.hidden = !acts[i];
      b.textContent = buttons?.[i] ? fill(buttons[i], v) : '';
      b.dataset.act = acts[i] || '';
      b.classList.toggle('primary', i === 0 && !CLOSERS.has(acts[i]));
      if (CLOSERS.has(acts[i])) b.dataset.sfx = 'close'; else delete b.dataset.sfx;
    });
  }

  function renderTable(seat) {
    const lv = seat.lobby;
    const host = hostOf(lv);
    const isHost = lv.host === lv.you;
    const others = lv.people.filter(p => p.pid !== lv.you).length;
    const hostName = host?.name || '';
    $('table-kicker').textContent = isHost ? words('table.kickerHost') : words('table.kickerGuest', { host: hostName });
    $('table-title').textContent = isHost ? words(others ? 'table.ready' : 'table.waiting') : words('table.waitingGuest', { host: hostName });
    const demoNote = $('table-demo');
    demoNote.textContent = demo ? words('demo.note') : ''; demoNote.hidden = !demo;
    // the code card
    const letters = [...lv.code];
    $('table-code').textContent = lv.code;
    $('table-code').setAttribute('aria-label', words('table.codeAria', { letters: letters.join(', ') }));
    const lockedForMe = lv.locked && !isHost;
    $('table-invite-row').hidden = lockedForMe;
    const lockedLine = $('table-locked-line');
    lockedLine.hidden = !lockedForMe; lockedLine.textContent = lockedForMe ? words('table.lockedGuest', { host: hostName }) : '';
    $('table-link').hidden = true;
    // the seats
    renderSeats(seat, lv, isHost);
    // the host's choices, or the guest's line
    $('table-host-opts').hidden = !isHost;
    if (isHost) {
      segment(el.size, ONLINE.table.sizes.map(n => ({ value: n, label: String(n), off: n < lv.people.length })), lv.size,
        n => op(seat, { k: 'size', n }), lv.phase !== 'waiting');
      segment(el.lock, [{ value: false, label: words('table.welcome') }, { value: true, label: words('table.locked') }], !!lv.locked,
        on => op(seat, { k: 'lock', on }), lv.phase !== 'waiting');
    }
    $('table-note').textContent = isHost ? words(lv.locked ? 'table.lockedNote' : 'table.sizeNote') : words('table.guestLine', { size: lv.size, host: hostName });
    // the status line: seats taken; the server gone a moment; the match dealt
    let status = isHost ? words('table.seatsTaken', { n: lv.people.length, size: lv.size }) : '';
    if (seat.status && !['live', 'closed'].includes(seat.status)) status = words('recovery.pill');
    if (seat.dealt && !seat.shown) status = words('demo.dealt');
    el.tStatus.textContent = status;
    // the buttons, or the countdown
    const starting = lv.phase === 'starting';
    $('table-actions').hidden = starting;
    $('btn-table-start').hidden = !isHost || lv.phase !== 'waiting';
    $('btn-table-wardrobe').hidden = lv.phase === 'playing';
    $('table-countdown').hidden = !starting;
    $('btn-table-wait').hidden = !isHost;
    $('table-count-guests').hidden = isHost;
    $('table-count-guests').textContent = isHost ? '' : words('table.countdownGuests', { host: hostName });
    renderCount(seat);
    $('table-storage').hidden = account?.persistent !== false || !seat.main;
  }
  function renderCount(seat) {
    if (seat !== S() || !seat.countEnd) return;
    const n = countLeft(seat);
    const t = $('table-count-n');
    if (t && t.textContent !== String(n)) t.textContent = String(n);
    const line = $('table-count-text');
    const want = words('table.countdown', { n: '' }).replace(/\s*$/, '');
    if (line && line.textContent !== want) line.textContent = want;
  }

  function renderSeats(seat, lv, isHost) {
    const list = el.seats;
    list.replaceChildren();
    const tags = text.table.tags;
    lv.people.forEach((p, i) => {
      const li = doc.createElement('li');
      li.className = 'cs-seat person' + (p.you ? ' you' : '') + (p.away ? ' away' : '');
      li.style.setProperty('--player-color', SEAT_COLORS[i % SEAT_COLORS.length]);
      const canRemove = isHost && !p.you && lv.phase === 'waiting';
      const box = doc.createElement(canRemove ? 'button' : 'div');
      box.className = 'cs-box';
      if (canRemove) { box.type = 'button'; box.setAttribute('aria-label', words('table.removeAria', { name: p.name })); tap(box, () => askRemove(seat, p)); }
      const ring = doc.createElement('span'); ring.className = 'cs-ring'; ring.textContent = p.mark || (p.name[0] || '?').toUpperCase();
      const face = doc.createElement('span'); face.className = 'cs-face';
      if (p.avatar) {
        try {
          const pic = makePortrait(doc, { id: p.pid, name: p.name, color: SEAT_COLORS[i % SEAT_COLORS.length], avatar: p.avatar, outfit: outfitOf(p.avatar) }, { plate: true });
          if (pic.tagName === 'IMG') { pic.alt = ''; pic.draggable = false; }
          face.appendChild(pic);
        } catch { /* a plain plate */ }
      }
      const txt = doc.createElement('span'); txt.className = 'cs-text';
      const nm = doc.createElement('span'); nm.className = 'cs-name'; nm.textContent = p.name;
      const tg = doc.createElement('span'); tg.className = 'cs-tags';
      const list2 = [];
      if (p.host) list2.push(tags.host);
      if (p.you) list2.push(tags.you);
      if (p.away) list2.push(tags.away);
      tg.textContent = list2.join(' · ');
      // (Away, then "reconnecting…" in small lower-case letters: it fits the seat)
      if (p.away) { const why = doc.createElement('span'); why.className = 'cs-why'; why.textContent = ` ${tags.reconnecting}`; tg.appendChild(why); }
      txt.append(nm, tg);
      box.append(ring, face, txt);
      li.appendChild(box);
      list.appendChild(li);
    });
    for (let i = lv.people.length; i < lv.size; i++) {
      const li = doc.createElement('li');
      li.className = 'cs-seat empty';
      const box = doc.createElement('div'); box.className = 'cs-box';
      const ring = doc.createElement('span'); ring.className = 'cs-ring';
      const txt = doc.createElement('span'); txt.className = 'cs-text'; txt.textContent = words('table.empty');
      box.append(ring, txt);
      li.appendChild(box);
      list.appendChild(li);
    }
  }

  // A row of buttons where exactly one is chosen (the menu's segmented look). `off(option)`: dimmed and not tappable.
  function segment(host, options, value, onPick, frozen = false) {
    host.replaceChildren();
    for (const o of options) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (o.value === value ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.dataset.value = String(o.value);
      b.textContent = o.label;
      if (o.off || frozen) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      tap(b, () => { if (o.value !== value) onPick(o.value); });
      host.appendChild(b);
    }
  }

  async function op(seat, o) {
    if (!seat.coop) return { ok: false };
    try { return await seat.coop.lobbyOp(o); } catch { return { ok: false }; }
  }

  // --- the waiting room's questions -------------------------------------------------------------------------------------
  let dialogYes = null, dialogNo = null;
  function ask(entry, vars, yes, no = null) {
    $('table-dlg-title').textContent = fill(entry.title, vars);
    $('table-dlg-line').textContent = fill(byRules(entry.line, rules.approved), vars);
    $('btn-table-dlg-no').textContent = fill(entry.buttons[0], vars);
    $('btn-table-dlg-yes').textContent = fill(entry.buttons[1], vars);
    dialogYes = yes; dialogNo = no;
    el.body.hidden = true; el.dialog.hidden = false;
    el.table.classList.add('asking');
    shown = performance.now();
    try { $('btn-table-dlg-no').focus({ preventScroll: true }); } catch { /* fine */ }   // (a keyboard user lands in the question, on its safe answer)
  }
  function closeDialog() { el.dialog.hidden = true; el.body.hidden = false; el.table.classList.remove('asking'); dialogYes = dialogNo = null; shown = performance.now(); }
  let shown = 0;
  const tooSoonHere = e => e && e.detail > 0 && performance.now() - shown < 300;
  function askRemove(seat, p) { ask(text.dialogs.remove, { name: p.name }, () => op(seat, { k: 'remove', pid: p.pid })); }
  function tapStart(seat) {
    const lv = seat.lobby;
    if (!lv) return;
    if (lv.people.length < ONLINE.table.minPeople) {
      return ask(text.dialogs.alone, {}, () => { drop(seat); go('bots'); });
    }
    const away = lv.people.find(p => p.away && p.pid !== lv.you);
    if (away) return ask(text.dialogs.away, { name: away.name }, () => op(seat, { k: 'start' }));
    op(seat, { k: 'start' });
  }

  // --- invite ---------------------------------------------------------------------------------------------------------
  // navigator.share is called INSIDE the tap (Safari refuses a share after any wait). Cancel shows nothing.
  function invite(seat) {
    const code = seat.lobby?.code; if (!code) return;
    const url = linkFor(code);
    if (typeof nav?.share === 'function') {
      try {
        nav.share({ title: words('table.shareTitle'), text: words('table.shareText', { code }), url }).catch(err => { if (err?.name !== 'AbortError') copy(seat); });
        return;
      } catch { /* no share sheet after all: copy */ }
    }
    copy(seat);
  }
  function copy(seat) {
    const code = seat.lobby?.code; if (!code) return;
    const url = linkFor(code);
    const byHand = () => {
      const f = $('table-link');
      f.value = url; f.hidden = false;
      try { f.focus(); f.select(); f.setSelectionRange(0, url.length); } catch { /* fine */ }
    };
    try {
      const w = nav?.clipboard?.writeText?.(url);
      if (w && typeof w.then === 'function') { w.then(() => toast(seat, words('toasts.linkCopied')), byHand); return; }
    } catch { /* below */ }
    byHand();
  }

  // --- the code field above the on-screen keyboard (DESIGN §14.3) --------------------------------------------------------
  const vv = win?.visualViewport || null;
  function keyboard() {
    const focused = doc.activeElement === el.code;
    const up = !!(focused && vv && vv.height < (win.innerHeight || 0) - 100);
    el.panel?.classList.toggle('kbd', up);
  }
  el.code?.addEventListener('focus', keyboard);
  el.code?.addEventListener('blur', () => setTimeout(keyboard, 0));
  vv?.addEventListener?.('resize', keyboard);
  el.code?.addEventListener('input', () => {
    S().codeText = el.code.value;
    if (S().fieldError) { S().fieldError = ''; render(); }
  });

  // --- the buttons ----------------------------------------------------------------------------------------------------
  function tryJoin() {
    const seat = S();
    const typed = el.code.value;
    seat.codeText = typed;
    const problem = codeProblem(typed);
    if (problem) {
      seat.fieldError = problem === 'letters' ? words('coop.codeLetters') : words('coop.codeLength', { length: ONLINE.code.length });
      render();
      return;
    }
    const code = normaliseCode(typed);
    seat.codeText = code;
    el.code.value = code;
    el.code.blur();
    seat.fromLink = false;
    open(seat, { join: { code } }, 'join');
  }
  tap(el.start, () => { S().fromLink = false; open(S(), { create: { size: ONLINE.table.defaultSize } }, 'create'); });
  tap(el.join, tryJoin);
  $('coop-join-form')?.addEventListener('submit', e => { e.preventDefault(); tryJoin(); });
  tap($('btn-coop-back'), () => { const s = S(); drop(s); s.card = null; s.fieldError = ''; go('main'); });
  tap(el.cancel, () => { const s = S(); drop(s); go('main'); });
  const cardAct = act => {
    const seat = S();
    const last = seat.lastIntent;
    switch (act) {
      case 'edit': case 'back': seat.card = null; render(); if (act === 'edit') { try { el.code.focus(); el.code.select(); } catch { /* fine */ } } break;
      case 'create': seat.card = null; open(seat, { create: { size: ONLINE.table.defaultSize } }, 'create'); break;
      case 'retry': if (last) { seat.card = null; open(seat, last.intent, last.kind); } else { seat.card = null; render(); } break;
      case 'resume': seat.card = null; open(seat, { resume: true }, 'resume'); break;
      case 'main': seat.card = null; go('main'); break;
      case 'single': seat.card = null; if (onSinglePlayer) onSinglePlayer(); else go('single'); break;
      case 'update': {
        try { const u = new URL(win.location.href); u.searchParams.set('u', String(Date.now())); win.location.replace(u.toString()); } catch { win?.location?.reload?.(); }
        break;
      }
      default: break;
    }
  };
  tap(el.cardA, () => cardAct(el.cardA.dataset.act));
  tap(el.cardB, () => cardAct(el.cardB.dataset.act));
  // the waiting room
  tap($('btn-table-invite'), () => invite(S()));
  tap($('btn-table-copy'), () => copy(S()));
  tap($('btn-table-start'), () => tapStart(S()));
  tap($('btn-table-leave'), () => { const s = S(); drop(s); go('coop'); });
  tap($('btn-table-wardrobe'), () => go('avatar'));
  tap($('btn-table-wait'), () => op(S(), { k: 'wait' }));
  $('btn-table-dlg-no')?.addEventListener('click', e => { e.preventDefault(); if (guard(e) || tooSoonHere(e)) return; const f = dialogNo; closeDialog(); f?.(); });
  $('btn-table-dlg-yes')?.addEventListener('click', e => { e.preventDefault(); if (guard(e) || tooSoonHere(e)) return; const f = dialogYes; closeDialog(); f?.(); });

  // --- the review link: two seats on one device (DESIGN §16) -----------------------------------------------------------
  // `opts`: { openCoop, resolveServer, transport, second: { profile } } — the loopback's, handed in by the menu.
  async function startDemo(opts = {}) {
    if (opts.openCoop) openCoop = opts.openCoop;
    if (opts.resolveServer) resolveServer = opts.resolveServer;
    if (opts.transport !== undefined) transport = opts.transport;
    demo = true;
    const name = opts.second?.profile?.username || words('demo.secondName');
    seats[1] = newSeat({ profile: opts.second?.profile || { username: name, avatar: null }, storage: memoryStorage(), remember: false, setUrl: false });
    switcher = createSeatSwitch(doc, {
      clients: seats,
      names: () => seats.map(nameOf),
      text,
      guard,
      // (in a match the page presents that seat's table, src/main.js; in the menu, its screen)
      onSwitch: i => {
        active = i;
        closeDialogQuiet();
        if (menuScreen() == null && onSeat && seats[i].coop?.table) { try { if (onSeat(i, seats[i].coop)) return; } catch (err) { console.error('showing the other seat failed:', err); } }
        go(seats[i].lobby ? 'table' : 'coop');
      },
    });
    switcher.show(!!seats[0].lobby);
    return true;
  }
  function closeDialogQuiet() { if (el.dialog && !el.dialog.hidden) closeDialog(); }

  return {
    // The menu is showing (or about to show) this screen: draw the seat shown. Returns the screen to show instead,
    // if any ('table' asked with no table: 'coop'; 'coop' asked while seated: 'table').
    screenFor(name) {
      const seat = S();
      if (name === 'table' && !seat.lobby) return 'coop';
      if (name === 'coop' && seat.lobby) return 'table';
      return name;
    },
    show(name) {
      const seat = S();
      if (name === 'coop' && !seat.card && !seat.pending && resolveServer()?.comingSoon) seat.card = { kind: 'soon' };
      seat.screen = name === 'table' && seat.lobby ? 'table' : 'coop';
      if (el.dialog && !el.dialog.hidden && name !== 'table') closeDialog();
      render();
    },
    // The main menu's Co-op button: a fresh Co-op screen (the last card and field error forgotten).
    enter() { const seat = S(); if (!seat.pending) { seat.card = null; seat.fieldError = ''; } },
    // (tests, on localhost) show one card: a can't-join code, 'soon', 'soonJoin', 'offline', 'unreachable', 'elsewhere'
    showCard(kind, vars = {}) { const seat = S(); if (seat.lobby) return false; seat.card = { kind, vars }; draw(seat, 'coop', { force: true }); return true; },
    // A ?join= link (after the register when there was no profile): straight to that table.
    openJoin(raw) {
      const seat = S();
      const code = normaliseCode(String(raw ?? '')) || String(raw ?? '');
      seat.codeText = code;
      seat.fromLink = true;
      seat.card = null;
      seat.fieldError = normaliseCode(code) ? '' : words(codeProblem(code) === 'letters' ? 'coop.codeLetters' : 'coop.codeLength', { length: ONLINE.code.length });
      go('coop');
      if (!seat.fieldError) open(seat, { join: { code } }, 'join');
    },
    // A reload with a remembered table: "Rejoining your table…" · Cancel.
    resume() { go('coop'); open(S(), { resume: true }, 'resume'); },
    // "You're invited to nora's table": the host's name for the register, or null (no server, not found, too slow).
    async peek(code) {
      const server = resolveServer();
      if (server?.comingSoon) return null;
      let coop = null;
      try {
        coop = await openCoop({ server, profile: null, intent: { peek: code }, transport, storage: seats[0].storage, remember: false, setUrl: false });
        return await new Promise(res => {
          const done = v => { clearTimeout(t); res(v); };
          const t = setTimeout(() => done(null), ONLINE.timing.wakeSlowMs * 2);
          coop.on('peeked', p => done(p?.host || null));
          coop.on('error', () => done(null));
        });
      } catch { return null; } finally { try { coop?.leave?.(); } catch { /* gone */ } }
    },
    // A new look (the Wardrobe's Save look) reaches everyone at the table.
    look(avatar) { const seat = seats[0]; if (seat.coop && seat.lobby && avatar) op(seat, { k: 'look', avatar }); },
    startDemo,
    // Leave the table with every seat this device holds (the match's Leave, Leave table, "You are out").
    leaveAll() { for (const seat of seats) drop(seat); active = 0; switcher?.show(false); },
    get switcher() { return switcher; },
    get hasTable() { return !!S().lobby; },
    get demo() { return demo; },
    get seat() { return active; },
    // (tests) the state of the seat shown
    debug: () => { const s = S(); return { seat: active, screen: s.screen, card: s.card?.kind || null, pending: s.pending, status: s.status, code: s.lobby?.code || null, phase: s.lobby?.phase || null, dealt: s.dealt }; },
  };
}
