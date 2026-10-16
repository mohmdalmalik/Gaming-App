// The How to play screen: five short pages (src/data/howToPlay.js has every word; the numbers in them come
// from the rules), Back / Next / Close, in the hotel's own look. It opens from the main menu and from the
// in-match Menu (src/ui/gameMenu.js), above whichever is under it, and gives the player back to it on Close.
// What each card does is not taught here: the last page has a small Cards button that opens the Cards screen
// (src/ui/cardsGuide.js, passed in as `cards`) above this one, and Close there comes back to this page.
//
//   - It is only reading: it touches no game state, and a match goes on exactly as it did under whatever
//     opened it (it can only be opened from the main menu, or from the Menu panel, which already holds the
//     clock still: see src/ui/gameMenu.js).
//   - Under the tap guard (src/ui/tapGuard.js): the second tap of a double tap on the button that opened it
//     answers nothing, and the second tap of a double tap on Next does not skip a page.
//   - The keyboard: focus moves in when it opens (to Next), Tab stays inside it, the arrow keys turn the
//     pages, Escape closes it, and focus goes back to where it came from. While the Cards screen is up
//     over it, the keys belong to that screen.
import { HOW_TO_PLAY as H } from '../data/howToPlay.js';
import { rules } from '../data/rules.js';
import { tooSoon } from './tapGuard.js';

export function createHowToPlay(doc, { onClose = null, cards = null } = {}) {
  const $ = id => doc.getElementById(id);
  const el = {
    root: $('howto-overlay'), kicker: $('howto-kicker'), title: $('howto-title'), lines: $('howto-lines'),
    dots: $('howto-dots'), back: $('btn-howto-back'), next: $('btn-howto-next'), close: $('btn-howto-close'),
  };
  if (!el.root) return { open() {}, close() {}, get isOpen() { return false; }, get page() { return 0; } };
  let page = 0;
  let shownAt = 0;           // when the screen opened or the page last turned (the double-tap guard)
  let cameFrom = null;       // where the focus was before it opened, so Close gives it back

  const guarded = fn => e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; fn(); };
  // The small Cards button under the last page's lines (made once, put under the lines of a page that has `cardsLink`).
  const more = doc.createElement('li'); more.className = 'howto-more';
  const cardsBtn = doc.createElement('button');
  cardsBtn.type = 'button'; cardsBtn.id = 'btn-howto-cards'; cardsBtn.className = 'btn'; cardsBtn.dataset.sfx = 'open';
  cardsBtn.addEventListener('click', guarded(() => cards?.open({ focusBack: cardsBtn })));
  more.appendChild(cardsBtn);

  const last = H.pages.length - 1;
  function render() {
    const p = H.pages[page];
    el.kicker.textContent = `${H.title} · ${H.words.of(page + 1, H.pages.length)}`;
    el.title.textContent = p.title;
    el.lines.replaceChildren(...p.lines.map(line => { const li = doc.createElement('li'); li.textContent = line(rules); return li; }));
    cardsBtn.textContent = H.words.cards;
    if (p.cardsLink) el.lines.appendChild(more);
    el.lines.scrollTop = 0;
    el.dots.replaceChildren(...H.pages.map((_, i) => { const d = doc.createElement('span'); d.className = 'howto-dot' + (i === page ? ' on' : ''); return d; }));
    el.back.disabled = page === 0;
    el.next.disabled = page === last;
    // (the last page: Close is the way on, so it is the gold button)
    el.close.classList.toggle('primary', page === last);
    el.back.textContent = H.words.back; el.next.textContent = H.words.next; el.close.textContent = H.words.close;
  }
  // Every page gets the height of the tallest one, so Back and Next stay where the finger found them
  // while the pages turn (measured when it opens, and again if the window changes shape).
  function fit() {
    const keep = page, had = doc.activeElement;
    el.lines.style.height = '';
    let tallest = 0;
    for (let i = 0; i <= last; i++) { page = i; render(); tallest = Math.max(tallest, el.lines.scrollHeight); }
    page = keep; render();
    el.lines.style.height = `${tallest}px`;
    // (measuring turned Next off on the last page, and a button that goes dim drops the focus: the one that had it gets it back)
    if (had && had !== doc.body && had !== doc.activeElement && had.isConnected && !had.disabled) { try { had.focus({ preventScroll: true }); } catch { /* no focus here */ } }
  }
  function turn(to) {
    if (to < 0 || to > last || to === page) return;
    page = to; shownAt = performance.now(); render();
    // (a button that has just gone dim cannot keep the focus: the one that is left takes it)
    if (doc.activeElement === el.next && el.next.disabled) el.close.focus();
    else if (doc.activeElement === el.back && el.back.disabled) el.next.focus();
  }

  const api = {
    get isOpen() { return !el.root.hidden; },
    get page() { return page; },
    // Open at the first page. `focusBack` (an element): where the focus goes when it closes.
    open({ focusBack = null } = {}) {
      cameFrom = focusBack || (doc.activeElement !== doc.body ? doc.activeElement : null);
      page = 0; shownAt = performance.now(); render();
      el.root.hidden = false;
      fit();
      try { el.next.focus({ preventScroll: true }); } catch { /* no focus here */ }
    },
    close() {
      if (el.root.hidden) return;
      el.root.hidden = true;
      const back = cameFrom; cameFrom = null;
      try { if (back && back.isConnected && !back.hidden && !back.closest('[hidden]')) back.focus({ preventScroll: true }); } catch { /* nothing to focus */ }
      onClose?.();
    },
  };

  doc.defaultView?.addEventListener('resize', () => { if (!el.root.hidden) fit(); });
  el.next.addEventListener('click', guarded(() => turn(page + 1)));
  el.back.addEventListener('click', guarded(() => turn(page - 1)));
  el.close.addEventListener('click', guarded(() => api.close()));

  // The keyboard (a computer, or an iPad with one). It listens on the whole page while it is open, so Escape
  // works even if a tap has left the focus on the page behind it.
  doc.addEventListener('keydown', e => {
    if (el.root.hidden || e.defaultPrevented || cards?.isOpen) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.close(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); turn(page + 1); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); turn(page - 1); return; }
    if (e.key !== 'Tab') return;
    // (Tab stays inside: the Cards button on the last page, Close, Back, Next, and round again)
    const ring = [more.isConnected ? cardsBtn : null, el.close, el.back, el.next].filter(b => b && !b.disabled);
    if (!ring.length) { e.preventDefault(); return; }
    const at = ring.indexOf(doc.activeElement);
    const to = e.shiftKey ? (at <= 0 ? ring.length - 1 : at - 1) : (at < 0 || at === ring.length - 1 ? 0 : at + 1);
    e.preventDefault(); ring[to].focus({ preventScroll: true });
  }, true);

  return api;
}
