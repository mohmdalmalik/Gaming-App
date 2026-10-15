// End-of-turn discard: the ONLY place the hand limit is settled (approved rule). During a turn a
// guest keeps everything they find or receive, even past 6; when they end the turn (the button, the
// turn passing by itself when the actions run out, or the clock running out) holding more than 6, they
// choose cards to discard until they hold 6, before control passes on. Possession cards never count and
// are never offered here, so the screen looks the same whatever the guest's role. Two steps for each
// card, so nothing is thrown away by a stray tap: tap a card to pick it (tap it again, or another, to
// change your mind), then confirm with the button, which names the card.
// The discard that brings the hand down to the limit finishes the screen by itself: the card is seen
// leaving for a moment, then the screen closes and the turn goes on (there is no "Keep these 6" step).
import { rules } from '../data/rules.js';
import { CARDS, countableCards, countableCount } from '../game/cards.js';
import { cardTile } from './cards.js';

// From more cards than this the tiles are drawn smaller (styles.css #discard-cards.dense): 11 cards fit on the
// shortest iPad window (1024x694) without scrolling; up to 8 fit at the usual size on every iPad.
const DENSE_FROM = 8;
// How long the last discarded card is seen leaving before the screen closes (ms). The card's own exit
// animation (styles.css, "Turn flow") lasts the same time; with Reduce Motion it only fades.
const LEAVE_MS = 520;

export function createDiscard(doc, cfg, { onDiscard }) {
  const overlay = doc.getElementById('discard-overlay');
  const sub = doc.getElementById('discard-sub');
  const kicker = doc.getElementById('discard-kicker');
  const cards = doc.getElementById('discard-cards');
  const doneBtn = doc.getElementById('btn-discard-done');
  let ctx = null;                 // { player, onComplete, leaving } while the screen is open
  let picked = null;              // the card chosen to discard, awaiting the button

  function render() {
    const p = ctx.player;
    // Possession cards don't count and can't be discarded here — only normal item cards.
    const items = countableCards(p.hand);
    const count = items.length;
    const over = count - rules.handLimit;
    if (!items.some(c => c.id === picked)) picked = null;
    sub.textContent = `You hold ${count} cards — at the end of your turn the limit is ${rules.handLimit}. Choose ${over} to discard${over === 1 ? '' : ', one at a time'}: tap a card, then the button.`;
    cards.innerHTML = '';
    cards.classList.toggle('dense', items.length > DENSE_FROM);      // (a big hand: smaller cards, so it fits without scrolling)
    for (const card of items) {
      cards.appendChild(cardTile(doc, card, {
        selectable: true,
        selected: card.id === picked,
        // (while the last card is leaving, a tap does nothing and makes no sound)
        onSelect: c => { if (!ctx || ctx.leaving) return false; picked = picked === c.id ? null : c.id; render(); },
      }));
    }
    const pickedCard = items.find(c => c.id === picked);
    doneBtn.disabled = !pickedCard;
    doneBtn.textContent = pickedCard ? `Discard the ${CARDS[pickedCard.type]?.name ?? 'card'}` : 'Tap a card to discard';
  }

  // The hand is down to the limit: show the last card leaving (its tile stays on the screen a moment,
  // greyed out of reach), then close and carry on with the turn passing. The screen is not drawn again
  // here, so the tile that was just discarded is still the one that leaves.
  function finish(tile, name) {
    const mine = ctx;
    mine.leaving = true;
    overlay.classList.add('leaving');
    tile?.classList.remove('selected');
    tile?.classList.add('leaving');
    sub.textContent = `Down to ${rules.handLimit} cards.`;
    doneBtn.disabled = true;
    doneBtn.textContent = `Discarded the ${name}`;
    setTimeout(() => {
      if (ctx !== mine) return;          // (closed or reopened meanwhile: a new game, the menu)
      const done = mine.onComplete;
      api.close();
      done?.();
    }, LEAVE_MS);
  }

  const api = {
    get isOpen() { return !overlay.hidden; },
    open(player, onComplete) {
      // A guest already at or under the limit never sees this screen (the callers only open it when over).
      if (countableCount(player.hand) <= rules.handLimit) { onComplete?.(); return; }
      ctx = { player, onComplete, leaving: false }; picked = null;
      if (kicker) { kicker.hidden = true; kicker.textContent = ''; }
      overlay.classList.remove('leaving');
      overlay.hidden = false;
      const modal = overlay.querySelector('.modal'); if (modal) modal.scrollTop = 0;
      render();
    },
    // Nothing of this guest's hand waits in the hidden screen for the next guest.
    close() { overlay.hidden = true; overlay.classList.remove('leaving'); ctx = null; picked = null; cards.innerHTML = ''; sub.textContent = ''; },
  };
  doneBtn.addEventListener('click', e => {
    e.preventDefault();
    if (!ctx || ctx.leaving || !picked) return;
    const id = picked;
    const card = ctx.player.hand.find(c => c.id === id);
    const tile = cards.querySelector(`.card-tile[data-card-id="${id}"]`);
    picked = null;
    onDiscard(id);
    if (!ctx) return;
    if (countableCount(ctx.player.hand) > rules.handLimit) { render(); return; }
    finish(tile, CARDS[card?.type]?.name ?? 'card');
  });
  return api;
}
