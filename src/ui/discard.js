// End-of-turn discard: when a player is over the hand limit they choose cards to drop until
// they are back to the limit, before control passes on. Tapping a card discards it.
import { rules } from '../data/rules.js';
import { cardTile } from './cards.js';

export function createDiscard(doc, cfg, { onDiscard }) {
  const overlay = doc.getElementById('discard-overlay');
  const sub = doc.getElementById('discard-sub');
  const cards = doc.getElementById('discard-cards');
  const doneBtn = doc.getElementById('btn-discard-done');
  let ctx = null;

  function render() {
    const p = ctx.player;
    const over = p.hand.length - rules.handLimit;
    sub.textContent = over > 0
      ? `${p.name} holds ${p.hand.length} cards — discard ${over} to get down to ${rules.handLimit}.`
      : `${p.name} is at the ${rules.handLimit}-card limit.`;
    cards.innerHTML = '';
    for (const card of p.hand) {
      cards.appendChild(cardTile(doc, card, {
        selectable: over > 0,
        onSelect: c => { onDiscard(c.id); render(); },
      }));
    }
    doneBtn.disabled = over > 0;
    doneBtn.textContent = `Keep these ${rules.handLimit}`;
  }

  const api = {
    get isOpen() { return !overlay.hidden; },
    open(player, onComplete) {
      ctx = { player, onComplete };
      overlay.hidden = false;
      render();
    },
    close() { overlay.hidden = true; ctx = null; },
  };
  doneBtn.addEventListener('click', e => {
    e.preventDefault();
    if (ctx.player.hand.length > rules.handLimit) return;
    const done = ctx.onComplete;
    api.close();
    done?.();
  });
  return api;
}
