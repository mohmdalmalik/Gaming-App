// The hand, held like a hand of cards (the owner asked for Hearthstone's layout): the active guest's
// cards face up in a gentle fan at the bottom centre, overlapping a little, each turned a few degrees
// along an arc. A card lifts when the pointer is over it or a finger presses it; tapping one opens
// the large card view (src/ui/hand.js) with what it does and what can be done with it.
//
// The fan sits in the middle of the bottom bar (.hud-bottom), between the guest's panel and the
// action buttons, so it can never cover either; its empty space lets taps through to the floor.
// Cards shrink and overlap more as the hand grows (six cards plus a few found ones still fit).
//
// Privacy (hot-seat): main.js shows the fan only during the active guest's own action phase, and CSS
// hides it whenever a hand-over, private or public screen is up. A Possession card is never put on
// this always-on strip in hot-seat — on a shared device it would tell the table who is possessed; it is
// seen, as before, only by opening the card view ("Private details"). Practice has nobody to hide from.
//
// Cheap on the iPad: the cards are rebuilt only when the hand changes; positions are CSS transforms.
import { CARDS } from '../game/cards.js';
import { CARD_FACE, sortHand } from './cards.js';

const STEP = 0.62;       // spacing between card centres, as a share of the card width, when there is room
const MIN_STEP = 0.36;   // closest the cards may crowd before they shrink instead
const MIN_W = 58;        // smallest card width (px)
const SUNK = 0.27;       // share of each card's height held below the screen edge at rest (as in
                         // Hearthstone): the art shows, the floor near the camera stays free to tap

export function createHandFan(doc, { onOpen }) {
  const root = doc.getElementById('hand-fan');
  let sig = '';                 // what is drawn now: whose hand, which cards
  let shownIds = new Set();     // cards already drawn for this guest (new ones deal in)
  let shownFor = -1;
  let visible = false;
  let cards = [];               // [{ card, el }]

  const cardWidth = () => Math.round(Math.max(72, Math.min(108, window.innerHeight * 0.115)));

  // A tap opens the card on the finger's RELEASE, on the card the finger went down on. Touch pointers
  // are captured by the element they press (and the mouse is captured explicitly), so the release
  // reaches that card even if the fan re-laid itself out, or the card was still dealing in, under the
  // finger — the browser's own click is hit-tested where the finger lifts and could miss it. The click
  // that follows is swallowed (it would land on the card view just opened and close it). A plain
  // click with no pointer before it (a keyboard, a script) still opens the card.
  let openedAt = -1e9;
  function swallowClick() {
    const off = () => doc.removeEventListener('click', eat, true);
    const eat = e => { e.stopPropagation(); e.preventDefault(); off(); };   // that one click only
    doc.addEventListener('click', eat, true);
    setTimeout(off, 350);
  }
  const shotsText = card => (card.type === 'revolver' && card.shots != null ? `${card.shots} shot${card.shots === 1 ? '' : 's'}` : '');

  // The Revolver's shots: a badge at the top LEFT (the next card covers each card's right-hand side).
  // When the fan is crowded only the number shows (.hand-fan.tight).
  function setShots(b, card) {
    const meta = CARDS[card.type] || { name: card.type };
    const shots = shotsText(card);
    b.setAttribute('aria-label', `${meta.name}${shots ? ` · ${shots}` : ''} — show this card`);
    let badge = b.querySelector('.fan-badge');
    if (!shots) { badge?.remove(); return; }
    if (!badge) { badge = doc.createElement('span'); badge.className = 'fan-badge'; b.appendChild(badge); }
    badge.innerHTML = `<b>${card.shots}</b><span class="unit"> shot${card.shots === 1 ? '' : 's'}</span>`;
  }

  function makeCard(card, dealt) {
    const meta = CARDS[card.type] || { name: card.type };
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'fan-card' + (meta.evil ? ' evil' : '') + (dealt ? ' dealt' : '');
    b.dataset.cardId = card.id;
    b.dataset.type = card.type;
    const face = CARD_FACE[card.type];
    if (face) {
      const img = doc.createElement('img'); img.src = face; img.alt = ''; img.draggable = false; b.appendChild(img);
    } else {
      const n = doc.createElement('span'); n.className = 'fan-name'; n.textContent = meta.name; b.appendChild(n);
    }
    setShots(b, card);
    let press = null;
    // Touch has no hover: lift the card while a finger is on it.
    b.addEventListener('pointerdown', e => {
      if (e.button > 0) return;
      b.classList.add('lift');
      press = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch { /* not capturable: the click still works */ }
    });
    b.addEventListener('pointerup', e => {
      b.classList.remove('lift');
      const p = press; press = null;
      if (!e.isTrusted || !p || p.id !== e.pointerId || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 28) return;
      openedAt = performance.now();
      swallowClick();
      onOpen(card.id);
    });
    b.addEventListener('click', e => { e.preventDefault(); if (performance.now() - openedAt > 350) onOpen(card.id); });
    for (const t of ['pointercancel', 'lostpointercapture']) b.addEventListener(t, () => { press = null; b.classList.remove('lift'); });
    b.addEventListener('pointerleave', () => { if (!press) b.classList.remove('lift'); });
    if (dealt) b.addEventListener('animationend', () => b.classList.remove('dealt'), { once: true });
    return b;
  }

  // Place the cards along the arc for the width available now.
  function layout() {
    const n = cards.length;
    if (!n) { root.style.removeProperty('--fan-h'); return; }
    const avail = Math.max(120, root.clientWidth - 24);
    let w = cardWidth();
    if (n > 1 && w + (n - 1) * w * MIN_STEP > avail) w = Math.max(MIN_W, Math.floor(avail / (1 + MIN_STEP * (n - 1))));
    const step = n > 1 ? Math.min(w * STEP, (avail - w) / (n - 1)) : 0;
    const h = Math.round(w * 1.5);
    const mid = (n - 1) / 2;
    const turn = n > 1 ? Math.min(5, 20 / (n - 1)) : 0;        // degrees between neighbours
    const drop = w * 0.12;                                      // how far the outer cards sit lower
    root.style.setProperty('--fan-w', `${w}px`);
    root.classList.toggle('tight', n > 1 && step < w * 0.55);    // little of each card shows: the badge drops its word
    // The cards rest partly below the bottom edge of the screen and rise fully when pressed or hovered.
    // `edge` is the gap between the strip and the bottom of the screen (margin + safe area).
    const edge = Math.max(0, window.innerHeight - root.getBoundingClientRect().bottom);
    const sunk = Math.round(h * SUNK);
    root.style.setProperty('--fan-h', `${h - sunk + Math.round(drop) + 4}px`);
    root.style.setProperty('--fan-drop', `${Math.round(drop)}px`);            // the middle card sits this much higher than the outer ones
    root.style.setProperty('--fan-sink', `${sunk + Math.round(edge)}px`);     // how far below the strip a card's foot rests
    root.style.setProperty('--fan-lift', `${sunk + Math.round(edge) + 10}px`); // how far a lifted card rises
    // New places are taken at once (the glide is only for lifting a card): no half-finished slide
    // can leave a card over the buttons after the strip changed width.
    root.classList.add('settling');
    const cx = root.clientWidth / 2;
    cards.forEach(({ el }, i) => {
      const d = i - mid;
      const x = cx - w / 2 + d * step;
      const y = mid ? (d / mid) ** 2 * drop : 0;
      el.style.setProperty('--x', `${x.toFixed(1)}px`);
      el.style.setProperty('--y', `${y.toFixed(1)}px`);
      el.style.setProperty('--r', `${(d * turn).toFixed(2)}deg`);
      el.style.zIndex = String(10 + i);
    });
    void root.offsetWidth;                 // apply the new places now, with transitions off
    root.classList.remove('settling');
  }

  // The cards already on screen are KEPT (only new ones are made, only gone ones removed), so a card
  // being pressed is never swapped for a copy mid-tap. Their stacking is z-index, not page order.
  const els = new Map();          // `${id}|${type}` -> the card's element
  const keyOf = c => `${c.id}|${c.type}`;
  function render(player, withPossession) {
    const hand = sortHand(player.hand).filter(c => withPossession || c.type !== 'possession');
    const fresh = shownFor === player.index;   // same guest as last time: new cards deal in
    const keep = new Set(hand.map(keyOf));
    for (const [k, el] of els) if (!keep.has(k)) { el.remove(); els.delete(k); }
    cards = hand.map(card => {
      let el = els.get(keyOf(card));
      if (!el) {
        el = makeCard(card, fresh && !shownIds.has(card.id));
        root.appendChild(el);
        els.set(keyOf(card), el);
      } else setShots(el, card);
      return { card, el };
    });
    shownIds = new Set(hand.map(c => c.id));
    shownFor = player.index;
    root.classList.toggle('empty', !hand.length);
    layout();
  }

  // Re-place the cards whenever the strip's own width changes, not only when the window does: a room
  // button (Infirmary, Escape, Trade) appearing on the right narrows the strip, and a resize can be
  // reported before the new width has settled. (The card size follows the window height.)
  window.addEventListener('resize', () => { if (visible) layout(); });
  let lastWidth = -1;
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      const w = root.clientWidth;
      if (visible && w && w !== lastWidth) { lastWidth = w; layout(); }
    }).observe(root);
  }

  return {
    // Every frame (cheap): `show` says whether the fan may be up at all right now.
    update(player, show, { withPossession = false } = {}) {
      const appeared = show && !visible;
      if (show !== visible) { visible = show; root.hidden = !show; }
      if (!show) return;
      const s = `${player.index}|${withPossession}|${player.hand.map(c => `${c.id}:${c.shots ?? ''}`).join(',')}`;
      if (s !== sig) { sig = s; render(player, withPossession); }
      else if (appeared) layout();     // the width may have changed while it was hidden
    },
    // A new match: forget what was drawn (no deal-in animation for a fresh deal).
    reset() { sig = ''; shownIds = new Set(); shownFor = -1; els.clear(); root.innerHTML = ''; cards = []; },
    get visible() { return visible; },
    get ids() { return cards.map(c => c.card.id); },
    layout,
  };
}
