// Quick chat in a match (src/data/chat.js): the Chat button by the Menu button, its small panel — two tabs
// of preset lines ("Table" and "Suspicion") and the emotes; one tap sends and closes it, and a line that
// names a guest ("I don't trust <name>.") first asks which guest (the "Choose a guest" step: the other
// guests still in the hotel, with their portraits) — and how a message shows: a speech bubble over the
// speaker's guest for a few seconds (through the shared tag layer, src/ui/screenTags.js, so it stays
// under the interface and inside the screen) and a line in the table feed ("nora: Good evening!",
// "nora: I don't trust felix.", "You wave."). A line that names the player reads as said to them ("I
// don't trust you.") with a brighter edge — never crimson: crimson is only ever the player's own possessed
// look, and a public line must not look like a role. When the match is over, the end screen shows what is
// said there and offers a one-tap "Good game!". A soft click when someone else speaks.
//
// Not in practice (nobody to talk to), and nothing at all when Settings > Quick chat is Off. The button
// and the panel are there whenever the game is in view — on other guests' turns and while watching
// after death too — but never over a private screen, a meeting or the map. Messages travel through the
// chat channel (src/social/chat.js): { seat, id, at } (+ `about`: the seat a line names), public to the
// whole table, nothing else. What a line claims is talk, never proof: nothing here reads a role.
import { CHAT, CHAT_PHRASES, CHAT_EMOTES, CHAT_TABS } from '../data/chat.js';
import { tooSoon } from './tapGuard.js';
import { makePortrait } from './portrait.js';

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="0.95" fill="currentColor" stroke="none"/>`;
const FACE = '<circle cx="12" cy="12" r="8.6"/>';
// The six emotes and the chat button's own mark, drawn as thin brass lines.
export const CHAT_ICONS = {
  wave: svg('<path d="M9.2 11.6V5.8a1.3 1.3 0 0 1 2.6 0v5"/><path d="M11.8 10.6V4.6a1.3 1.3 0 0 1 2.6 0v6"/><path d="M14.4 10.6V5.9a1.3 1.3 0 0 1 2.6 0v6.2"/><path d="M17 12.1V9a1.3 1.3 0 0 1 2.6 0v4.6c0 4.3-2.7 7.2-6.6 7.2-2.5 0-4.1-1-5.5-2.9l-2.7-3.6a1.35 1.35 0 0 1 2.2-1.6l2.2 2.6v-3.7"/><path d="M3.6 7.6c.3-1.5 1.1-2.7 2.4-3.5" stroke-width="1.2"/><path d="M20.4 3.2c.8.6 1.3 1.4 1.5 2.3" stroke-width="1.2"/>'),
  smile: svg(`${FACE}${dot(9.2, 10)}${dot(14.8, 10)}<path d="M8.3 13.7c.9 1.5 2.2 2.3 3.7 2.3s2.8-.8 3.7-2.3"/>`),
  laugh: svg(`${FACE}<path d="M7.7 10.2c.5-.9 1.7-.9 2.2 0M14.1 10.2c.5-.9 1.7-.9 2.2 0"/><path d="M7.9 13.1h8.2c0 2.4-1.8 4.1-4.1 4.1s-4.1-1.7-4.1-4.1z"/>`),
  gasp: svg(`${FACE}<path d="M7.5 7.6l2.1-.8M16.5 7.6l-2.1-.8"/><circle cx="9.3" cy="10.4" r="1.15"/><circle cx="14.7" cy="10.4" r="1.15"/><ellipse cx="12" cy="15.4" rx="1.7" ry="2"/>`),
  suspicious: svg(`${FACE}<path d="M7.4 8.9l3.3.7M16.6 8.9l-3.3.7"/><path d="M7.7 11.2h2.9M13.4 11.2h2.9" stroke-width="1.9"/><path d="M10 15.6h4.6"/>`),
  cross: svg(`${FACE}<path d="M7.5 8l2.8 1.2M16.5 8l-2.8 1.2"/>${dot(9.3, 11)}${dot(14.7, 11)}<path d="M8.6 16.4c.9-1.3 2.1-1.9 3.4-1.9s2.5.6 3.4 1.9"/>`),
  speak: svg('<path d="M5.2 5h13.6c.9 0 1.7.8 1.7 1.7v7.6c0 .9-.8 1.7-1.7 1.7h-7.9l-4.4 3.5V16H5.2c-.9 0-1.7-.8-1.7-1.7V6.7C3.5 5.8 4.3 5 5.2 5z"/><path d="M8.4 10.5h.01M12 10.5h.01M15.6 10.5h.01" stroke-width="2.2"/>'),
};
const BACK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const PHRASE = new Map(CHAT_PHRASES.map(p => [p.id, p]));
const EMOTE = new Map(CHAT_EMOTES.map(e => [e.id, e]));
const TAB_KEY = 'hotelEscape.chatTab.v1';      // (this device: the tab the panel last showed)

// What a message says, in words. `you`: the player said it (an emote reads "You wave."). For a line that
// names a guest: `about` (their seat), `aboutYou` (it names the player: "I don't trust you.") and
// `nameOf(seat)`. Returns { text, emote, parts, names }: `parts` is the text in pieces, strings and
// { name, you } for the guest it names (shown in bright brass), `names` whether it names a guest.
export function chatWords(id, { you = false, about = null, aboutYou = false, nameOf = null } = {}) {
  const p = PHRASE.get(id);
  if (p) {
    if (!p.about) return { text: p.text, emote: false, parts: [p.text], names: false };
    if (aboutYou && p.you) {
      // "You tried to possess me!", "I trust you.": the word "you" stands for the player's name
      const m = /\b[Yy]ou\b/.exec(p.you);
      const parts = m ? [p.you.slice(0, m.index), { name: m[0], you: true }, p.you.slice(m.index + m[0].length)] : [p.you];
      return { text: p.you, emote: false, parts, names: true };
    }
    const name = String((about != null && nameOf ? nameOf(about) : null) ?? 'a guest');
    const [pre, post = ''] = p.text.split('{name}');
    return { text: `${pre}${name}${post}`, emote: false, parts: [pre, { name, you: !!aboutYou }, post], names: true };
  }
  const e = EMOTE.get(id);
  if (!e) return null;
  const text = `${you ? e.you : e.does}.`;
  return { text, emote: true, parts: [text], names: false };
}
// The words as HTML, the guest named in a span of class `cls` (+ ' you' when it is the player).
const partsHtml = (parts, cls) => parts.map(x => (typeof x === 'string' ? esc(x) : `<span class="${cls}${x.you ? ' you' : ''}">${esc(x.name)}</span>`)).join('');
// The panel's label for a line: a line that names a guest shows a dotted blank where the name goes.
const labelHtml = p => (p.about ? esc(p.text).replace('{name}', '<span class="cp-blank">who</span>') : esc(p.text));

// `channel`: src/social/chat.js. `feed`: src/ui/feed.js. `nameOf(seat)` / `colorOf(seat)`: the guest's
// name and colour (public). `mySeat()`: the player's seat. `guests()`: the guests a line may name now
// ([{ seat, player, red }]: the others still in the hotel, in seat order; `red`: shown with red eyes, as
// in the guest strip). `sfx(name, opts)`: the sound cue bus.
export function createChatUI(doc, { channel, feed, nameOf, colorOf, mySeat, guests = () => [], sfx = () => {} }) {
  const el = {
    button: doc.getElementById('btn-chat'),
    panel: doc.getElementById('chat-panel'),
  };
  let on = false;               // this match has chat (a match, and Quick chat is On)
  let showing = false;          // the button may show now (nothing covers the game)
  let openedAt = 0, pressedOutAt = -Infinity;   // (when a press outside the panel, or a line sent, closed it)
  let stepAt = 0;               // when the panel last changed what is under the finger (opened, a step, Back)
  let coolTimer = 0;
  let tab = readTab();          // the tab showing
  let asking = null;            // the line waiting for a guest to be chosen (the second step), or null
  const bubbles = new Map();    // seat -> { html, cls, until }
  const recent = [];            // (tests) the last messages shown

  // --- the panel: the tabs, the lines, the emotes; and the "Choose a guest" step ---------------------
  el.panel.classList.add('cp');
  const tabRow = doc.createElement('div'); tabRow.className = 'cp-tabs'; tabRow.setAttribute('role', 'tablist');
  const pages = new Map();
  for (const t of CHAT_TABS) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'cp-tab'; b.dataset.tab = t.id; b.dataset.sfx = 'select';
    b.setAttribute('role', 'tab'); b.id = `chat-tab-${t.id}`; b.setAttribute('aria-controls', `chat-page-${t.id}`);
    b.textContent = t.label;
    tabRow.appendChild(b);
    const page = doc.createElement('div');
    page.className = 'cp-page'; page.id = `chat-page-${t.id}`; page.dataset.page = t.id;
    page.setAttribute('role', 'tabpanel'); page.setAttribute('aria-labelledby', b.id);
    pages.set(t.id, page);
  }
  for (const p of CHAT_PHRASES) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = `chat-phrase${p.about ? ' about' : ''}`; b.dataset.chat = p.id; b.dataset.sfx = 'select';
    if (p.about) b.setAttribute('aria-label', `${p.text.replace('{name}', '…')} Choose a guest.`);
    b.innerHTML = `<span class="cp-label">${labelHtml(p)}</span>`;
    (pages.get(p.tab) || pages.values().next().value).appendChild(b);
  }
  const emotes = doc.createElement('div'); emotes.className = 'chat-emotes';
  for (const e of CHAT_EMOTES) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'chat-emote'; b.dataset.chat = e.id; b.dataset.sfx = 'select';
    b.setAttribute('aria-label', e.label); b.title = e.label;
    b.innerHTML = CHAT_ICONS[e.id];
    emotes.appendChild(b);
  }
  const main = doc.createElement('div'); main.className = 'cp-main';
  main.append(tabRow, ...pages.values(), emotes);
  const whom = doc.createElement('div'); whom.className = 'cp-whom'; whom.hidden = true;
  whom.innerHTML = `<div class="cp-whom-head"><button type="button" class="cp-back" data-sfx="select" aria-label="Back">${BACK_ICON}</button>`
    + '<div class="cp-whom-line"></div></div><div class="cp-whom-hint">Choose a guest</div><div class="cp-guests"></div>';
  const whomLine = whom.querySelector('.cp-whom-line'), grid = whom.querySelector('.cp-guests'), back = whom.querySelector('.cp-back');
  el.panel.replaceChildren(main, whom);
  showTab(tab);

  function readTab() {
    try { const t = window.localStorage?.getItem(TAB_KEY); if (CHAT_TABS.some(x => x.id === t)) return t; } catch { /* storage blocked */ }
    return CHAT_TABS[0].id;
  }
  function showTab(id) {
    tab = CHAT_TABS.some(t => t.id === id) ? id : CHAT_TABS[0].id;
    for (const b of tabRow.children) { const sel = b.dataset.tab === tab; b.setAttribute('aria-selected', String(sel)); b.tabIndex = sel ? 0 : -1; }
    for (const [k, page] of pages) page.hidden = k !== tab;
  }
  // The lines that name a guest are there only while there is someone else to name.
  function syncAbout() {
    const none = !guests().length;
    for (const b of main.querySelectorAll('.chat-phrase.about')) b.disabled = none;
  }
  // The second step: "<line>", Choose a guest, a tile for each guest a line may name.
  function ask(id) {
    const p = PHRASE.get(id);
    const list = guests();
    if (!p) return;
    // (nobody left to name — the last other guest left the hotel while the step was open: back to the
    // lines, those that name a guest now disabled)
    if (!list.length) { unask(); syncAbout(); return; }
    asking = id;
    whomLine.innerHTML = labelHtml(p);
    grid.replaceChildren(...list.map(g => {
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'cp-guest'; b.dataset.seat = String(g.seat); b.dataset.sfx = 'select';
      b.style.setProperty('--player-color', colorOf(g.seat));      // (the seat's colour under the portrait, as in the strip)
      const port = doc.createElement('span'); port.className = 'mini-portrait cp-portrait';
      port.appendChild(makePortrait(doc, g.player, { possessed: !!g.red }));
      const nm = doc.createElement('span'); nm.className = 'cp-guest-name'; nm.textContent = nameOf(g.seat);
      b.append(port, nm);
      return b;
    }));
    whom.style.minHeight = `${main.offsetHeight}px`;     // (the panel keeps its height: nothing jumps)
    main.hidden = true; whom.hidden = false;
    stepAt = performance.now();
  }
  function unask() {
    if (asking == null) return;
    asking = null;
    whom.hidden = true; main.hidden = false;
    grid.replaceChildren();
    syncAbout();
  }

  el.panel.addEventListener('click', e => {
    const t = e.target.closest?.('.cp-tab');
    if (t) { e.preventDefault(); showTab(t.dataset.tab); try { window.localStorage?.setItem(TAB_KEY, tab); } catch { /* fine */ } return; }
    if (e.target.closest?.('.cp-back')) {
      e.preventDefault();
      if (tooSoon(e, stepAt)) return;
      unask(); stepAt = performance.now();
      return;
    }
    const g = e.target.closest?.('.cp-guest');
    if (g) {
      e.preventDefault();
      if (tooSoon(e, stepAt) || asking == null) return;   // (the second tap of a double tap on a line chooses nobody)
      const seat = Number(g.dataset.seat);
      if (!guests().some(x => x.seat === seat)) { ask(asking); return; }   // (they left the hotel meanwhile)
      send(asking, seat);
      close();
      pressedOutAt = performance.now();
      return;
    }
    const b = e.target.closest?.('[data-chat]');
    if (!b || b.disabled) return;
    e.preventDefault();
    if (tooSoon(e, Math.max(openedAt, stepAt))) return;     // (the second tap of a double tap on Chat, or on Back, sends nothing)
    if (PHRASE.get(b.dataset.chat)?.about) { ask(b.dataset.chat); return; }
    send(b.dataset.chat);
    close();
    pressedOutAt = performance.now();     // (and the second tap of a double tap on a line, now on the hotel, does nothing)
  });

  // --- the end screen: what is said there, and a one-tap "Good game!" -------------------------------
  const end = doc.createElement('div');
  end.id = 'end-chat'; end.className = 'end-chat'; end.hidden = true;
  const endLines = doc.createElement('div'); endLines.className = 'ec-lines';
  const gg = doc.createElement('button');
  gg.type = 'button'; gg.id = 'btn-chat-gg'; gg.className = 'ec-say'; gg.dataset.sfx = 'select';
  gg.innerHTML = `<span class="ec-icon">${CHAT_ICONS.speak}</span><span>${esc(PHRASE.get('gg').text)}</span>`;
  end.append(gg, endLines);
  const endCard = doc.querySelector('#end-overlay .card');
  if (endCard) endCard.insertBefore(end, endCard.querySelector('.end-actions'));
  let endShown = false, endAt = 0, ggTimer = 0;
  gg.addEventListener('click', e => {
    e.preventDefault();
    if (tooSoon(e, endAt) || gg.disabled) return;
    gg.disabled = true;
    // The player spoke a moment ago: it is said when their pause ends (the button resting till then,
    // its thin brass line running down like the Chat button's).
    const wait = on ? channel.waitFor(mySeat()) : 0;
    if (wait > 0) {
      gg.style.setProperty('--chat-cool', `${wait}ms`);
      gg.classList.add('cooling');
      clearTimeout(ggTimer);
      ggTimer = setTimeout(() => { gg.classList.remove('cooling'); if (endShown && !send('gg')) gg.disabled = false; }, wait + 20);
      return;
    }
    if (!send('gg')) gg.disabled = false;
  });
  function ggReady() { clearTimeout(ggTimer); gg.classList.remove('cooling'); gg.disabled = false; }

  function open() {
    if (!on || !showing || el.button.disabled) return;
    unask();
    syncAbout();
    el.panel.hidden = false;
    el.button.setAttribute('aria-expanded', 'true');
    openedAt = stepAt = performance.now();
    place();
  }
  function close() {
    if (el.panel.hidden) return;
    el.panel.hidden = true;
    el.button.setAttribute('aria-expanded', 'false');
    unask();              // (the next time it opens on the lines, on the same tab)
  }
  // Under the top-right buttons, against the right edge — and below the guest strip if it would reach it.
  function place() {
    const cluster = el.button.closest('.hud-top-right')?.getBoundingClientRect() || el.button.getBoundingClientRect();
    const strip = doc.querySelector('.hud-top-center');
    const s = strip && !strip.hidden ? strip.getBoundingClientRect() : null;
    const w = el.panel.offsetWidth;
    let top = cluster.bottom + 8;
    if (s && s.width && cluster.right - w < s.right + 8) top = Math.max(top, s.bottom + 8);
    el.panel.style.top = `${Math.round(top)}px`;
    el.panel.style.right = `${Math.round(Math.max(8, doc.documentElement.clientWidth - cluster.right))}px`;
  }
  el.button.addEventListener('click', e => {
    e.preventDefault();
    if (el.panel.hidden) open(); else if (!tooSoon(e, openedAt)) close();   // (a double tap on Chat leaves it open)
  });
  // A press anywhere else closes the panel (and main.js lets that press do nothing else: swallowTap).
  doc.addEventListener('pointerdown', e => {
    if (el.panel.hidden) return;
    if (el.panel.contains(e.target) || el.button.contains(e.target)) return;
    pressedOutAt = performance.now();
    close();
  }, true);
  doc.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.addEventListener('resize', () => { if (!el.panel.hidden) place(); });

  // The player says something (`about`: the seat of the guest a line names). Returns the message, or null
  // (cooling down, or a line that needs a guest without one).
  function send(id, about = null) {
    if (!on) return null;
    const msg = channel.say(mySeat(), id, about);
    if (msg) cool();
    return msg;
  }
  // After sending, the button rests for the cooldown (a thin brass line runs down under it).
  function cool() {
    const ms = channel.waitFor(mySeat());
    if (ms <= 0) return;
    el.button.disabled = true;
    el.button.style.setProperty('--chat-cool', `${ms}ms`);
    el.button.classList.remove('cooling'); void el.button.offsetWidth; el.button.classList.add('cooling');
    clearTimeout(coolTimer);
    coolTimer = setTimeout(() => { el.button.disabled = false; el.button.classList.remove('cooling'); }, ms);
  }

  // A message reached the table (anyone's): the bubble, the feed line, the end screen, the sound.
  function show(msg) {
    if (!on) return;
    recent.push(msg); if (recent.length > 30) recent.shift();
    const me = mySeat();
    const mine = msg.seat === me;
    const aboutYou = msg.about != null && msg.about === me;
    const words = chatWords(msg.id, { you: mine, about: msg.about ?? null, aboutYou, nameOf });
    if (!words) return;
    const who = mine ? 'You' : nameOf(msg.seat);
    const icon = words.emote ? CHAT_ICONS[msg.id] : CHAT_ICONS.speak;
    const dotHtml = `<span class="cb-dot" style="background:${esc(colorOf(msg.seat))}"></span>`;
    const html = words.emote
      ? `${dotHtml}<span class="cb-icon" role="img" aria-label="${esc(EMOTE.get(msg.id).label)}">${CHAT_ICONS[msg.id]}</span>`
      : `${dotHtml}<span class="cb-text">${partsHtml(words.parts, 'cb-name')}</span>`;
    const cls = `chat-bubble${words.emote ? ' emote' : ''}${mine ? ' mine' : ''}${aboutYou ? ' about-me' : ''}`;
    bubbles.set(msg.seat, { html, cls, until: performance.now() + (words.names ? CHAT.aboutBubbleMs : CHAT.bubbleMs) });
    // the feed: "nora: Good evening!" / "nora waves." / "nora: I don't trust felix."
    const lead = words.emote ? who : `${who}:`;
    const feedParts = words.parts.map(x => (typeof x === 'string' ? x : { ...x, cls: 'feed-name' }));
    feed.chat?.(icon, lead, feedParts, `chat${words.emote ? ' emote' : ''}${mine || aboutYou ? ' me' : ''}`);
    if (endShown) addEndLine(icon, lead, words.parts, mine || aboutYou);
    if (!mine) sfx('click', { volume: 0.5 });
  }
  function addEndLine(icon, lead, parts, me) {
    const line = doc.createElement('span');
    line.className = `ec-line${me ? ' me' : ''}`;
    // (the words in one span, as a bubble's: each piece a flex item of its own would stand 6 px apart,
    // "I don't trust you ." with a gap before the full stop)
    line.innerHTML = `<span class="ec-icon">${icon}</span><span class="ec-who">${esc(lead)}</span> <span class="ec-text">${partsHtml(parts, 'ec-name')}</span>`;
    endLines.appendChild(line);
    while (endLines.children.length > 2) endLines.firstChild.remove();   // (one row: the newest two)
  }
  channel.onMessage(show);

  return {
    get isOpen() { return !el.panel.hidden; },
    // A new game (or back to the menu): `enabled` — a match with Quick chat On.
    reset(enabled) {
      on = !!enabled;
      showing = false;
      bubbles.clear();
      recent.length = 0;
      close();
      clearTimeout(coolTimer);
      el.button.disabled = false; el.button.classList.remove('cooling');
      el.button.hidden = true;
      channel.reset();
      endLines.replaceChildren(); end.hidden = true; endShown = false; ggReady();
    },
    // Every frame. `clear`: nothing covers the game (no private screen, meeting, map, notice or end
    // screen). `ended`: the match's end screen is up.
    update({ clear, ended }) {
      showing = on && !!clear;
      if (el.button.hidden !== !showing) el.button.hidden = !showing;
      if (!showing) close();
      const e = on && !!ended;
      if (e !== endShown) {
        endShown = e; end.hidden = !e;
        if (e) { endAt = performance.now(); endLines.replaceChildren(); }
        ggReady();
      }
      if (bubbles.size) {
        const now = performance.now();
        for (const [seat, b] of bubbles) if (now > b.until) bubbles.delete(seat);
      }
    },
    // Place the speech bubbles over the speakers (`at(seat)`: the point over that guest's head, or null).
    // The player's own first, then the newest: where guests stand close, an older bubble gives way.
    tags(tags, at, show = true) {
      if (!on || !show || !bubbles.size) return;
      const now = performance.now(), mine = mySeat();
      const order = [...bubbles].sort(([a, x], [b, y]) => (b === mine) - (a === mine) || y.until - x.until);
      for (const [seat, b] of order) {
        const p = at(seat);
        if (!p) continue;
        const leaving = b.until - now < 350;
        tags.put(`chat:${seat}`, p, b.html, b.cls + (leaving ? ' leaving' : ''), 'above');
      }
    },
    // A press on the hotel while the panel was open (or that just closed it) does nothing else.
    swallowTap() {
      if (!el.panel.hidden) { close(); return true; }
      return performance.now() - pressedOutAt < 600;
    },
    send,
    close,
    // Tests: the panel's state — the tab showing, the line waiting for a guest (or null), the guests it
    // offers — and the speech bubbles waiting to show (whether or not their guest is on screen).
    panelState: () => ({ open: !el.panel.hidden, tab, asking, guests: [...grid.children].map(b => Number(b.dataset.seat)),
      bubbles: [...bubbles].map(([seat, b]) => ({ seat, cls: b.cls, text: b.html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') })) }),
    // Tests: the last messages shown ({ seat, id, about?, at }).
    recent: () => [...recent],
  };
}
