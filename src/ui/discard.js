// End-of-turn discard: the ONLY place the hand limit is settled (approved rule). During a turn a
// guest keeps everything they find or receive, even past 6; when they end the turn (the button, or the
// clock running out) holding more than 6, they choose cards to discard until they hold 6, before
// control passes on. Possession cards never count and are never offered here, so the screen looks the
// same whatever the guest's role. Two steps, so nothing is thrown away by a
// stray tap: tap a card to pick it (tap it again, or another, to change your mind), then confirm with
// the button, which names the card.
import { rules } from '../data/rules.js';
import { CARDS, countableCards, countableCount } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createDiscard(doc, cfg, { onDiscard }) {
  const overlay = doc.getElementById('discard-overlay');
  const sub = doc.getElementById('discard-sub');
  const kicker = doc.getElementById('discard-kicker');
  const cards = doc.getElementById('discard-cards');
  const doneBtn = doc.getElementById('btn-discard-done');
  let ctx = null;
  let picked = null;              // the card chosen to discard, awaiting the button

  function render() {
    const p = ctx.player;
    // Possession cards don't count and can't be discarded here — only normal item cards.
    const items = countableCards(p.hand);
    const count = items.length;
    const over = count - rules.handLimit;
    if (!items.some(c => c.id === picked)) picked = null;
    sub.textContent = over > 0
      ? `You hold ${count} cards — at the end of your turn the limit is ${rules.handLimit}. Choose ${over} to discard${over === 1 ? '' : ', one at a time'}: tap a card, then the button.`
      : `You are down to ${rules.handLimit} cards.`;
    cards.innerHTML = '';
    for (const card of items) {
      cards.appendChild(cardTile(doc, card, {
        selectable: over > 0,
        selected: card.id === picked,
        onSelect: c => { picked = picked === c.id ? null : c.id; render(); },
      }));
    }
    const pickedCard = items.find(c => c.id === picked);
    if (over > 0) {
      doneBtn.disabled = !pickedCard;
      doneBtn.textContent = pickedCard ? `Discard the ${CARDS[pickedCard.type]?.name ?? 'card'}` : 'Tap a card to discard';
    } else {
      doneBtn.disabled = false;
      doneBtn.textContent = `Keep these ${rules.handLimit}`;
    }
  }

  const api = {
    get isOpen() { return !overlay.hidden; },
    open(player, onComplete) {
      ctx = { player, onComplete }; picked = null;
      if (kicker) { kicker.hidden = true; kicker.textContent = ''; }
      overlay.hidden = false;
      render();
    },
    // Nothing of this guest's hand waits in the hidden screen for the next guest.
    close() { overlay.hidden = true; ctx = null; picked = null; cards.innerHTML = ''; sub.textContent = ''; },
  };
  doneBtn.addEventListener('click', e => {
    e.preventDefault();
    if (!ctx) return;
    if (picked) { const id = picked; picked = null; onDiscard(id); if (ctx) render(); return; }
    if (countableCount(ctx.player.hand) > rules.handLimit) return;
    const done = ctx.onComplete;
    api.close();
    done?.();
  });
  return api;
}
