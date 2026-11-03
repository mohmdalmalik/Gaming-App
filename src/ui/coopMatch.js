// Co-op in the match: the few things a Co-op table adds to today's screens (DESIGN §14.6-§14.7). Every word is
// src/data/onlineText.js's and every number src/data/online.js's; the match itself is drawn by the same screens as Single
// player (src/main.js presents the table's view). This file only draws, and only what the table is allowed to show:
//   - Away on a guest of the strip (hidden for a while, or disconnected: view.players[i].away);
//   - the stall banner (TP3): "Waiting for nora…" with the live count of how long the match still waits, after 60 s;
//   - the reconnect pill ("Reconnecting…", after a second without the server) and, after 20 s, its card;
//   - one card at a time for what ends or interrupts a match: stopped by the stall, a table fault, a slow server, an
//     update, a server that restarted (with or without the match), another device;
//   - the seconds ring on a question that has a time limit (only under the owner's pending rules: today none has);
//   - the end screen's buttons: the host plays again, a guest goes back to the table; either may leave it.
//
//   const ui = createCoopMatch(doc, { text, sfx })
//   ui.update(view, net)      every view: Away tags, the stall banner, the ring (net: { status } or nothing)
//   ui.pill(status)           the connection: 'live' | 'connecting' | 'reconnecting' | 'lost' | 'closed'
//   ui.card(kind, actions)    kind: 'stopped' | 'fault' | 'slow' | 'update' | 'restartLost' | 'restarted' | 'lost' |
//                             'elsewhere'; actions: { [button]: fn } by the button's role (below); returns true if shown
//   ui.stall(view)            the banner alone (update calls it)
//   ui.ring(ask)              the ring alone (update calls it)
//   ui.endButtons(view, isHost, host)   the end screen's words; returns { primary, secondary } (what each does)
//   ui.hide()                 everything away (the match left the screen)
//   ui.cardOpen               a card is up
import { ONLINE } from '../data/online.js';
import { ONLINE_TEXT, fill, byRules } from '../data/onlineText.js';
import { ONLINE_RULES } from '../data/online.js';

// What each card's buttons do, in order (the words: text.match.stall.stopped, text.recovery[kind]).
const CARD_BUTTONS = {
  stopped: ['back'], fault: ['back'], slow: ['back'], update: ['back'], restartLost: ['main'], restarted: ['ok'],
  lost: ['retry', 'leave'], elsewhere: ['here', 'main'],
};
const clock = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function createCoopMatch(doc, { text = ONLINE_TEXT, sfx = () => {}, approved = ONLINE_RULES.approved, now = () => performance.now() } = {}) {
  const app = doc.getElementById('app') || doc.body;
  const mk = (tag, cls, parent, id = null) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (id) e.id = id; parent?.appendChild(e); return e; };
  // the pill, top centre
  const pill = mk('div', 'coop-pill', app, 'coop-pill');
  pill.hidden = true; pill.setAttribute('role', 'status'); pill.textContent = text.recovery.pill;
  // the stall banner, top centre under the strip
  const banner = mk('div', 'coop-stall', app, 'coop-stall');
  banner.hidden = true; banner.setAttribute('role', 'status');
  const bannerA = mk('div', 'cst-who', banner), bannerB = mk('div', 'cst-count', banner);
  // the card (the game's own overlay and card styles)
  const overlay = mk('div', 'overlay center coop-match-card', app, 'coop-match-card');
  overlay.hidden = true;
  const card = mk('div', 'card notice', overlay);
  card.setAttribute('role', 'alertdialog'); card.setAttribute('aria-labelledby', 'coop-mc-title');
  mk('div', 'notice-rule', card);
  const cTitle = mk('h1', '', card, 'coop-mc-title');
  const cLine = mk('p', 'muted', card, 'coop-mc-line');
  const cActs = mk('div', 'end-actions', card);
  const cB = mk('button', 'btn big', cActs);
  cB.id = 'btn-coop-mc-b';
  const cA = mk('button', 'btn primary big', cActs);
  cA.id = 'btn-coop-mc-a';
  const cBtns = [cB, cA];
  cBtns.forEach(b => { b.type = 'button'; });
  let cardKind = null, cardActions = {};
  cBtns.forEach(b => b.addEventListener('click', e => {
    e.preventDefault();
    const role = b.dataset.role;
    const fn = cardActions[role];
    hideCard();
    try { fn?.(); } catch (err) { console.error('a Co-op card button failed:', err); }
  }));
  // the line under the end screen's summary ("nora starts the next match.")
  const endSummary = doc.getElementById('end-summary');
  const endLine = mk('p', 'coop-end-line muted', null, 'coop-end-line');
  endLine.hidden = true;
  endSummary?.after(endLine);

  let status = 'live', notLiveAt = null, lastView = null, pillTimer = null;

  function wordsFor(kind) {
    const s = text.match.stall.stopped;
    switch (kind) {
      case 'stopped': return { title: s.title, line: fill(s.line, { minutes: Math.round((ONLINE_RULES.today.stallMs || 300000) / 60000) }), buttons: s.buttons };
      case 'fault': case 'slow': return text.recovery.fault;
      case 'update': return text.recovery.updated;
      case 'restartLost': return text.recovery.restartLost;
      case 'restarted': return text.recovery.restarted;
      case 'lost': return { ...text.recovery.lost, line: byRules(text.recovery.lost.line, approved) };
      case 'elsewhere': return text.recovery.elsewhere;
      default: return null;
    }
  }
  function showCard(kind, actions = {}) {
    const w = wordsFor(kind);
    if (!w) return false;
    cardKind = kind; cardActions = actions;
    cTitle.textContent = w.title; cLine.textContent = w.line || '';
    const roles = CARD_BUTTONS[kind] || ['ok'];
    // (one button: the primary alone; two: the first is the primary, as the design lists them)
    const order = roles.length === 1 ? [null, 0] : [1, 0];
    order.forEach((k, i) => {
      const b = cBtns[i];
      if (k == null || roles[k] == null) { b.hidden = true; return; }
      b.hidden = false; b.dataset.role = roles[k]; b.textContent = w.buttons[k] ?? '';
    });
    overlay.hidden = false;
    return true;
  }
  function hideCard() { overlay.hidden = true; cardKind = null; cardActions = {}; }

  // --- Away on the strip -------------------------------------------------------------------------------------------
  function presence(view) {
    const cells = [...doc.querySelectorAll('#strip-cards .mini-player')];
    (view?.players || []).forEach((p, i) => {
      const cell = cells[i];
      if (!cell) return;
      const away = !!p.away && !view.finished;
      if (cell.classList.contains('away') === away && (!away || cell.querySelector('.mini-away'))) return;
      cell.classList.toggle('away', away);
      let tag = cell.querySelector('.mini-away');
      if (away && !tag) { tag = mk('div', 'mini-away', null); tag.textContent = text.match.away; cell.querySelector('.mini-pwrap')?.after(tag) ?? cell.appendChild(tag); }
      if (!away && tag) tag.remove();
    });
  }

  // --- the stall banner (TP3): after 60 s of one wait --------------------------------------------------------------
  let stallAt = null, stallLeft = 0;
  function stall(view) {
    const s = view?.stall;
    if (!s || !Number.isFinite(s.leftMs) || view.finished || view.end) { banner.hidden = true; stallAt = null; return; }
    const total = ONLINE_RULES.today.stallMs || 300000;
    stallLeft = s.leftMs; stallAt = now();
    if (total - s.leftMs < ONLINE.timing.stallBannerMs) { banner.hidden = true; return; }
    const ph = view.phase?.kind;
    const who = view.players?.[view.activeSeat]?.name || '';
    bannerA.textContent = ph === 'meeting' || ph === 'offer' ? text.match.stall.waitingMeeting : fill(text.match.stall.waitingFor, { name: who });
    renderStall();
    banner.hidden = false;
  }
  function renderStall() {
    if (stallAt == null) return;
    bannerB.textContent = fill(text.match.stall.countdown, { time: clock(stallLeft - (now() - stallAt)) });
  }

  // --- the ring on a question with a time limit (pending rules only) ----------------------------------------------
  let ringEl = null;
  function ring(ask) {
    const ms = ask?.leftMs;
    const host = doc.querySelector('#handoff-overlay:not([hidden]) .card, #encounter-overlay:not([hidden]) .card');
    if (!Number.isFinite(ms) || !host) { ringEl?.remove(); ringEl = null; return; }
    if (!ringEl || ringEl.parentNode !== host) { ringEl?.remove(); ringEl = mk('div', 'coop-ring', host); }
    const s = Math.ceil(ms / 1000);
    ringEl.textContent = String(s);
    ringEl.classList.toggle('crimson', s <= 5);
  }

  // --- the connection -----------------------------------------------------------------------------------------------
  function setPill(s) {
    status = s;
    if (s === 'live' || s === 'closed') {
      notLiveAt = null; pill.hidden = true; clearTimeout(pillTimer);
      return;
    }
    if (notLiveAt == null) notLiveAt = now();
    clearTimeout(pillTimer);
    const wait = Math.max(0, ONLINE.timing.reconnectPillMs - (now() - notLiveAt));
    pillTimer = setTimeout(() => { if (status !== 'live' && status !== 'closed') pill.hidden = false; }, wait);
  }
  // (the stall count ticks between views)
  const ticker = setInterval(() => { if (!banner.hidden) renderStall(); }, 500);

  return {
    update(view, net = null) {
      lastView = view;
      presence(view);
      stall(view);
      ring(view?.ask);
      if (net?.status) setPill(net.status);
    },
    pill: setPill,
    card: showCard,
    hideCard,
    get cardOpen() { return !overlay.hidden; },
    get cardKind() { return cardKind; },
    stall,
    ring,
    endButtons(view, isHost, host = '') {
      const w = text.match.end;
      const restart = doc.getElementById('btn-restart'), menu = doc.getElementById('btn-end-menu');
      if (restart) restart.textContent = isHost ? w.playAgain : w.backToTable;
      if (menu) menu.textContent = w.leave;
      endLine.textContent = isHost || !host ? '' : fill(w.hostStarts, { host });
      endLine.hidden = !endLine.textContent;
      return { primary: isHost ? 'again' : 'table', secondary: 'leave' };
    },
    // (the end screen's next-match line: "The next match starts in 5…")
    endNote(line) { endLine.textContent = line || ''; endLine.hidden = !line; },
    hide() {
      pill.hidden = true; banner.hidden = true; stallAt = null; hideCard(); ring(null);
      endLine.hidden = true; endLine.textContent = '';
      for (const c of doc.querySelectorAll('#strip-cards .mini-player.away')) { c.classList.remove('away'); c.querySelector('.mini-away')?.remove(); }
      clearTimeout(pillTimer); notLiveAt = null; status = 'live';
    },
    destroy() { clearInterval(ticker); },
    get status() { return status; },
    get view() { return lastView; },
    sfx,
  };
}
