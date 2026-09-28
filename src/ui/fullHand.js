// "Your hand is full": shown when a search turns up a card the player has no room for.
// The card is never dropped silently — the player chooses to take it (dropping one they
// already hold), use it on the spot if it can be used, or leave it behind.
//
// Two steps, so a touch screen only ever asks one question at a time:
//   1. what do you want to do with this card?
//   2. (only if taking) which card do you drop? (tap it, then confirm)
import { rules } from '../data/rules.js';
import { countableCards } from '../game/cards.js';
import { CARDS } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createFullHand(doc) {
  const overlay = doc.getElementById('fullhand-overlay');
  const sub = doc.getElementById('fullhand-sub');
  const found = doc.getElementById('fullhand-found');
  const step = doc.getElementById('fullhand-step');
  const handEl = doc.getElementById('fullhand-hand');
  const takeBtn = doc.getElementById('btn-fullhand-take');
  const useBtn = doc.getElementById('btn-fullhand-use');
  const leaveBtn = doc.getElementById('btn-fullhand-leave');
  const backBtn = doc.getElementById('btn-fullhand-cancel');
  const dropBtn = doc.getElementById('btn-fullhand-drop');
  let ctx = null;
  let picked = null;              // the card chosen to make room, awaiting the button

  function renderChoice() {
    const meta = CARDS[ctx.card.type];
    const a = /^[aeiou]/i.test(meta.name) ? 'an' : 'a';            // "an Espresso"
    sub.textContent = `You are carrying the most you can (${rules.handLimit}). You found ${a} ${meta.name}.`;
    found.innerHTML = '';
    found.appendChild(cardTile(doc, ctx.card, { hideDesc: false }));
    step.textContent = '';
    handEl.hidden = true;
    takeBtn.hidden = false;
    leaveBtn.hidden = false;
    backBtn.hidden = true;
    dropBtn.hidden = true;
    useBtn.hidden = !ctx.canUse;
  }

  // Which card makes room: tap one to pick it (tap again, or another, to change your mind), then
  // confirm with the button, which names it. Nothing is thrown away by a single stray tap.
  function renderDrop() {
    const items = countableCards(ctx.player.hand);
    if (!items.some(c => c.id === picked)) picked = null;
    step.textContent = 'Tap a card to discard to make room for it.';
    handEl.hidden = false;
    handEl.innerHTML = '';
    for (const card of items) {
      handEl.appendChild(cardTile(doc, card, {
        hideDesc: true,
        selectable: true,
        selected: card.id === picked,
        onSelect: c => { picked = picked === c.id ? null : c.id; renderDrop(); },
      }));
    }
    const pickedCard = items.find(c => c.id === picked);
    dropBtn.hidden = false;
    dropBtn.disabled = !pickedCard;
    dropBtn.textContent = pickedCard ? `Discard the ${CARDS[pickedCard.type]?.name ?? 'card'}` : 'Tap a card to discard';
    takeBtn.hidden = true;
    useBtn.hidden = true;
    leaveBtn.hidden = true;
    backBtn.hidden = false;
  }

  function close() { overlay.hidden = true; ctx = null; picked = null; }

  const api = {
    get isOpen() { return !overlay.hidden; },
    // handlers: onTake(dropCardId), onUse(), onLeave()
    open(state, player, card, handlers) {
      ctx = { state, player, card, ...handlers }; picked = null;
      overlay.hidden = false;
      renderChoice();
    },
    close,
  };

  takeBtn.addEventListener('click', e => { e.preventDefault(); if (ctx) renderDrop(); });
  backBtn.addEventListener('click', e => { e.preventDefault(); if (ctx) { picked = null; renderChoice(); } });
  dropBtn.addEventListener('click', e => { e.preventDefault(); if (!ctx || !picked) return; const done = ctx.onTake, id = picked; close(); done(id); });
  leaveBtn.addEventListener('click', e => { e.preventDefault(); if (!ctx) return; const done = ctx.onLeave; close(); done(); });
  useBtn.addEventListener('click', e => { e.preventDefault(); if (!ctx) return; const done = ctx.onUse; close(); done(); });
  return api;
}
