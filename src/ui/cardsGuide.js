// The Cards screen: every kind of card in the game, each with its face, its name and ONE short line of what it
// does (the words: src/data/rules.js through src/data/cardsGuide.js). It opens from the main menu, from the
// in-match Menu (src/ui/gameMenu.js) and from the last How to play page (src/ui/howToPlay.js), above whichever is
// under it, and gives the player back to it on Close, the way How to play does.
//
//   - It is only reading: it touches no game state and shows no one's hand, only the KINDS of cards (a
//     Possession card is drawn plain, with no guest's face on it). A match goes on exactly as it did under
//     whatever opened it (the Menu panel holds the clock still: see src/ui/gameMenu.js).
//   - Under the tap guard (src/ui/tapGuard.js): the second tap of a double tap on the button that opened it
//     answers nothing.
//   - Eleven cards are more than a short window shows, so the list scrolls by touch inside the card (the
//     buttons stay put). The keyboard: focus moves in when it opens (to Close), Tab stays inside it (the list
//     takes arrow keys), Escape closes it, and focus goes back to where it came from.
import { CARDS_GUIDE as G, cardEntries } from '../data/cardsGuide.js';
import { CARDS } from '../game/cards.js';
import { cardTile } from './cards.js';
import { tooSoon } from './tapGuard.js';

export function createCardsGuide(doc) {
  const $ = id => doc.getElementById(id);
  const el = { root: $('cards-overlay'), kicker: $('cards-kicker'), title: $('cards-title'), list: $('cards-list'), close: $('btn-cards-close') };
  if (!el.root) return { open() {}, close() {}, get isOpen() { return false; } };
  let shownAt = 0;           // when the screen opened (the double-tap guard)
  let cameFrom = null;       // where the focus was before it opened, so Close gives it back
  let built = false;

  // The list is drawn the first time it opens (the card pictures are only fetched then) and kept: the cards do not change.
  function build() {
    if (built) return;
    built = true;
    el.kicker.textContent = G.kicker; el.title.textContent = G.title; el.close.textContent = G.close;
    el.list.replaceChildren(...cardEntries(CARDS).map(e => {
      const li = doc.createElement('li');
      li.className = 'cg-item';
      li.dataset.type = e.type;
      // (the face carries no guest's picture: no owner is given to a Possession card; the words beside it name the card)
      const tile = cardTile(doc, { id: `guide-${e.type}`, type: e.type }, { hideDesc: true });
      tile.setAttribute('aria-hidden', 'true');
      for (const img of tile.querySelectorAll('img')) { img.decoding = 'async'; img.draggable = false; }
      const words = doc.createElement('div'); words.className = 'cg-words';
      const name = doc.createElement('div'); name.className = 'cg-name'; name.textContent = e.name;
      const desc = doc.createElement('div'); desc.className = 'cg-desc'; desc.textContent = e.desc;
      words.append(name, desc);
      li.append(tile, words);
      return li;
    }));
  }

  const api = {
    get isOpen() { return !el.root.hidden; },
    // `focusBack` (an element): where the focus goes when it closes.
    open({ focusBack = null } = {}) {
      if (!el.root.hidden) return;
      cameFrom = focusBack || (doc.activeElement !== doc.body ? doc.activeElement : null);
      shownAt = performance.now();
      build();
      el.root.hidden = false;
      el.list.scrollTop = 0;
      try { el.close.focus({ preventScroll: true }); } catch { /* no focus here */ }
    },
    close() {
      if (el.root.hidden) return;
      el.root.hidden = true;
      const back = cameFrom; cameFrom = null;
      try { if (back && back.isConnected && !back.hidden && !back.closest('[hidden]')) back.focus({ preventScroll: true }); } catch { /* nothing to focus */ }
    },
  };

  const guarded = fn => e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; fn(); };
  el.close.addEventListener('click', guarded(() => api.close()));
  // A tap on the dark round the card closes it, as on the Menu panel, under the same guard.
  el.root.addEventListener('click', e => { if (e.target === el.root && !tooSoon(e, shownAt)) api.close(); });

  // The keyboard (a computer, or an iPad with one). It listens on the whole page while it is open, so Escape
  // works even if a tap has left the focus on the page behind it, and it comes before the screens under it
  // (How to play, the Menu panel), which stand still while this one is up.
  doc.addEventListener('keydown', e => {
    if (el.root.hidden || e.defaultPrevented) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
    if (e.key !== 'Tab') return;
    // (Tab stays inside: the list, Close, and round again)
    const ring = [el.list, el.close];
    const at = ring.indexOf(doc.activeElement);
    const to = e.shiftKey ? (at <= 0 ? ring.length - 1 : at - 1) : (at < 0 || at === ring.length - 1 ? 0 : at + 1);
    e.preventDefault(); ring[to].focus({ preventScroll: true });
  }, true);

  return api;
}
