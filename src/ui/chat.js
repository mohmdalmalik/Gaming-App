// Quick chat in a match (src/data/chat.js): the Chat button by the Menu button, its small panel of
// preset lines and emotes (one tap sends and closes it), and how a message shows — a speech bubble over
// the speaker's guest for a few seconds (through the shared tag layer, src/ui/screenTags.js, so it stays
// under the interface and inside the screen) and a line in the table feed ("Henry: Good evening!",
// "You wave."). When the match is over, the end screen shows what is said there and offers a one-tap
// "Good game!". A soft click when someone else speaks.
//
// Not in practice (nobody to talk to), and nothing at all when Settings > Quick chat is Off. The button
// and the panel are there whenever the game is in view — on other guests' turns and while watching
// after death too — but never over a private screen, a meeting or the map. Messages travel through the
// chat channel (src/social/chat.js): { seat, id, at }, public to the whole table, nothing else.
import { CHAT, CHAT_PHRASES, CHAT_EMOTES } from '../data/chat.js';
import { tooSoon } from './tapGuard.js';

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
const PHRASE = new Map(CHAT_PHRASES.map(p => [p.id, p]));
const EMOTE = new Map(CHAT_EMOTES.map(e => [e.id, e]));

// What a message says, in words: "Good evening!", or the emote's line for the feed.
export function chatWords(id, { you = false } = {}) {
  if (PHRASE.has(id)) return { text: PHRASE.get(id).text, emote: false };
  const e = EMOTE.get(id);
  return e ? { text: `${you ? e.you : e.does}.`, emote: true } : null;
}

// `channel`: src/social/chat.js. `feed`: src/ui/feed.js. `nameOf(seat)` / `colorOf(seat)`: the guest's
// name and colour (public). `mySeat()`: the player's seat. `sfx(name, opts)`: the sound cue bus.
export function createChatUI(doc, { channel, feed, nameOf, colorOf, mySeat, sfx = () => {} }) {
  const el = {
    button: doc.getElementById('btn-chat'),
    panel: doc.getElementById('chat-panel'),
  };
  let on = false;               // this match has chat (a match, and Quick chat is On)
  let showing = false;          // the button may show now (nothing covers the game)
  let openedAt = 0, pressedOutAt = -Infinity;   // (when a press outside the panel closed it)
  let coolTimer = 0;
  const bubbles = new Map();    // seat -> { html, cls, until }
  const recent = [];            // (tests) the last messages shown

  // --- the panel: the phrases, then the emotes ------------------------------------------------------
  const kicker = doc.createElement('div'); kicker.className = 'chat-kicker'; kicker.textContent = 'Say to the table';
  const phrases = doc.createElement('div'); phrases.className = 'chat-phrases';
  for (const p of CHAT_PHRASES) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'chat-phrase'; b.dataset.chat = p.id; b.dataset.sfx = 'select';
    b.textContent = p.text;
    phrases.appendChild(b);
  }
  const emotes = doc.createElement('div'); emotes.className = 'chat-emotes';
  for (const e of CHAT_EMOTES) {
    const b = doc.createElement('button');
    b.type = 'button'; b.className = 'chat-emote'; b.dataset.chat = e.id; b.dataset.sfx = 'select';
    b.setAttribute('aria-label', e.label); b.title = e.label;
    b.innerHTML = CHAT_ICONS[e.id];
    emotes.appendChild(b);
  }
  el.panel.replaceChildren(kicker, phrases, emotes);
  el.panel.addEventListener('click', e => {
    const b = e.target.closest?.('[data-chat]');
    if (!b) return;
    e.preventDefault();
    if (tooSoon(e, openedAt)) return;     // (the second tap of a double tap on Chat sends nothing)
    send(b.dataset.chat);
    close();
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
  let endShown = false, endAt = 0;
  gg.addEventListener('click', e => {
    e.preventDefault();
    if (tooSoon(e, endAt) || gg.disabled) return;
    if (send('gg')) gg.disabled = true;
  });

  function open() {
    if (!on || !showing || el.button.disabled) return;
    el.panel.hidden = false;
    el.button.setAttribute('aria-expanded', 'true');
    openedAt = performance.now();
    place();
  }
  function close() {
    if (el.panel.hidden) return;
    el.panel.hidden = true;
    el.button.setAttribute('aria-expanded', 'false');
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
    if (el.panel.hidden) open(); else close();
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

  // The player says something. Returns the message, or null (cooling down).
  function send(id) {
    if (!on) return null;
    const msg = channel.say(mySeat(), id);
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
    const mine = msg.seat === mySeat();
    const words = chatWords(msg.id, { you: mine });
    if (!words) return;
    const who = mine ? 'You' : nameOf(msg.seat);
    const icon = words.emote ? CHAT_ICONS[msg.id] : CHAT_ICONS.speak;
    const html = words.emote
      ? `<span class="cb-dot" style="background:${esc(colorOf(msg.seat))}"></span><span class="cb-icon" role="img" aria-label="${esc(EMOTE.get(msg.id).label)}">${CHAT_ICONS[msg.id]}</span>`
      : `<span class="cb-dot" style="background:${esc(colorOf(msg.seat))}"></span><span class="cb-text">${esc(words.text)}</span>`;
    bubbles.set(msg.seat, { html, cls: `chat-bubble${words.emote ? ' emote' : ''}${mine ? ' mine' : ''}`, until: performance.now() + CHAT.bubbleMs });
    // the feed: "Henry: Good evening!" / "Henry waves."
    const lead = words.emote ? who : `${who}:`;
    feed.chat?.(icon, lead, words.text, `chat${words.emote ? ' emote' : ''}${mine ? ' me' : ''}`);
    if (endShown) addEndLine(icon, lead, words.text, mine);
    if (!mine) sfx('click', { volume: 0.5 });
  }
  function addEndLine(icon, lead, text, mine) {
    const line = doc.createElement('span');
    line.className = `ec-line${mine ? ' me' : ''}`;
    line.innerHTML = `<span class="ec-icon">${icon}</span><span class="ec-who">${esc(lead)}</span> ${esc(text)}`;
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
      close();
      clearTimeout(coolTimer);
      el.button.disabled = false; el.button.classList.remove('cooling');
      el.button.hidden = true;
      channel.reset();
      endLines.replaceChildren(); end.hidden = true; endShown = false; gg.disabled = false;
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
        if (e) { endAt = performance.now(); endLines.replaceChildren(); gg.disabled = false; }
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
    // Tests: the last messages shown ({ seat, id, at }).
    recent: () => [...recent],
  };
}
