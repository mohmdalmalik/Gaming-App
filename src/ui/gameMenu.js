// The in-match Menu panel: what the Menu button (#btn-leave) opens. Resume, Sound (Music and Sound effects,
// the same Off / Low / Medium / High choices and the same saved settings as the main menu's Settings:
// src/settings.js), How to play (src/ui/howToPlay.js), Cards (src/ui/cardsGuide.js: what every card does, a
// read-only list that opens above the panel like How to play) and Leave, which asks the game's own question
// ("Leave the match?", main.js) with its safe answer in gold, as it always did.
//
// THE TURN CLOCK, exactly as it was. Before this panel, the Menu button opened that question, and while a
// question is up the game holds the clock and the computer guests still (main.js: timerPaused, botTick,
// uiBusy). The panel is the same: while it is open (and the question after it) the clock stands still and
// the computer guests wait; Resume and the question's Keep playing hand it all back. main.js counts the
// panel wherever it counts a question (`gameMenu.isOpen`). Nothing here starts, stops or changes the clock;
// whether it should run while the Menu is open (online, nobody's clock can be held) is the owner's decision,
// still pending.
//
// Only ever opened from the match screen with nothing else up (main.js hud.on('leave'). On the end screen the
// Menu button still goes straight to the main menu).
import { GAME_MENU as W } from '../data/gameMenu.js';
import { SETTING_CHOICES } from '../settings.js';
import { tooSoon, GUARD_MS } from './tapGuard.js';

export function createGameMenu(doc, { settings, howTo = null, cards = null, practice = () => false, onSettingChanged = null, onLeave = null } = {}) {
  const $ = id => doc.getElementById(id);
  const el = {
    root: $('gamemenu-overlay'), title: $('gm-title'), resume: $('btn-gm-resume'), howto: $('btn-gm-howto'), cards: $('btn-gm-cards'), leave: $('btn-gm-leave'),
    music: $('gm-music'), sound: $('gm-sound'), musicLabel: $('gm-music-label'), soundLabel: $('gm-sound-label'),
  };
  if (!el.root) return { open() {}, close() {}, swallowTap() { return false; }, get isOpen() { return false; } };
  let shownAt = 0;           // when the panel opened (the double-tap guard)
  let closedAt = -Infinity;  // when it last closed (swallowTap)
  let cameFrom = null;

  // A row of Off / Low / Medium / High: the settings' own choices; a pick is saved and applied at once.
  function segment(host, name) {
    host.replaceChildren(...SETTING_CHOICES[name].map(o => {
      const on = settings.choice(name)?.value === o.value;
      const b = doc.createElement('button');
      b.type = 'button'; b.className = 'seg-btn' + (on ? ' on' : '');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(on));
      b.dataset.value = o.value; b.textContent = o.label;
      b.addEventListener('click', e => {
        e.preventDefault();
        if (tooSoon(e, shownAt)) return;
        settings.set(name, o.value);
        render();
        onSettingChanged?.(name, o.value);
        // (the row is drawn again, so the button the keyboard was on is a new one: it keeps the focus)
        try { host.querySelector(`[data-value="${o.value}"]`)?.focus({ preventScroll: true }); } catch { /* no focus */ }
      });
      return b;
    }));
  }
  function render() {
    el.title.textContent = W.title;
    el.resume.textContent = W.resume;
    el.howto.textContent = W.howTo;
    if (el.cards) el.cards.textContent = W.cards;
    el.leave.textContent = W.leave(practice());
    el.musicLabel.textContent = W.music; el.soundLabel.textContent = W.sound;
    segment(el.music, 'music'); segment(el.sound, 'sound');
  }

  const api = {
    get isOpen() { return !el.root.hidden; },
    open() {
      if (!el.root.hidden) return;
      cameFrom = doc.activeElement !== doc.body ? doc.activeElement : null;
      shownAt = performance.now();
      render();
      el.root.hidden = false;
      try { el.resume.focus({ preventScroll: true }); } catch { /* no focus here */ }
    },
    // Resume (or Escape, or Leave on its way to the question): the panel goes and the match is as it was.
    // (`restoreFocus: false`: main.js, when a new match or the main menu takes over.)
    close({ restoreFocus = true } = {}) {
      if (el.root.hidden) return;
      cards?.close();
      howTo?.close();
      el.root.hidden = true;
      closedAt = performance.now();
      const back = cameFrom; cameFrom = null;
      try { if (restoreFocus && back && back.isConnected && !back.closest('[hidden]')) back.focus({ preventScroll: true }); } catch { /* nothing to focus */ }
    },
    // The second tap of a double tap on the dark round the card (or on Resume) lands on the hotel, which the panel no
    // longer covers: a tap on the hotel just after it closed does nothing (main.js onTap), as after a tip's button.
    swallowTap() { return performance.now() - closedAt < GUARD_MS + 50; },
  };

  const guarded = fn => e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; fn(); };
  el.resume.addEventListener('click', guarded(() => api.close()));
  // A tap on the dark round the card resumes, as it closes the question (src/overlays.js), under the same guard.
  el.root.addEventListener('click', e => { if (e.target === el.root && !tooSoon(e, shownAt)) api.close(); });
  el.howto.addEventListener('click', guarded(() => howTo?.open({ focusBack: el.howto })));
  el.cards?.addEventListener('click', guarded(() => cards?.open({ focusBack: el.cards })));
  // (Leave: the focus goes back to the Menu button first, so the question that opens next remembers it and gives it
  // back on Keep playing, as it did before the panel existed: src/ui/focus.js)
  el.leave.addEventListener('click', guarded(() => { api.close(); onLeave?.(); }));

  // The keyboard: Escape resumes (while How to play or Cards is up, Escape closes that first), Tab stays in the panel.
  doc.addEventListener('keydown', e => {
    if (el.root.hidden || e.defaultPrevented || howTo?.isOpen || cards?.isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); api.close(); return; }
    if (e.key !== 'Tab') return;
    const ring = [...el.root.querySelectorAll('button:not([disabled])')].filter(b => b.getClientRects().length);
    if (!ring.length) return;
    const at = ring.indexOf(doc.activeElement);
    const to = e.shiftKey ? (at <= 0 ? ring.length - 1 : at - 1) : (at < 0 || at === ring.length - 1 ? 0 : at + 1);
    e.preventDefault(); ring[to].focus({ preventScroll: true });
  }, true);

  return api;
}
