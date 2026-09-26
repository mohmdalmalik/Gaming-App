// "Your hands are full": shown when a search turns up a card the player has no room for.
// The card is never dropped silently — the player chooses to take it (dropping one they
// already hold), use it on the spot if it can be used, or leave it behind.
//
// Two steps, so a touch screen only ever asks one question at a time:
//   1. what do you want to do with this card?
//   2. (only if taking) which card do you drop?
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
  let ctx = null;

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
    useBtn.hidden = !ctx.canUse;
  }

  function renderDrop() {
    step.textContent = 'Which card do you leave behind?';
    handEl.hidden = false;
    handEl.innerHTML = '';
    for (const card of countableCards(ctx.player.hand)) {
      handEl.appendChild(cardTile(doc, card, {
        hideDesc: true,
        selectable: true,
        onSelect: c => { const done = ctx.onTake; close(); done(c.id); },
      }));
    }
    takeBtn.hidden = true;
    useBtn.hidden = true;
    leaveBtn.hidden = true;
    backBtn.hidden = false;
  }

  function close() { overlay.hidden = true; ctx = null; }

  const api = {
    get isOpen() { return !overlay.hidden; },
    // handlers: onTake(dropCardId), onUse(), onLeave()
    open(state, player, card, handlers) {
      ctx = { state, player, card, ...handlers };
      overlay.hidden = false;
      renderChoice();
    },
    close,
  };

  takeBtn.addEventListener('click', e => { e.preventDefault(); if (ctx) renderDrop(); });
  backBtn.addEventListener('click', e => { e.preventDefault(); if (ctx) renderChoice(); });
  leaveBtn.addEventListener('click', e => { e.preventDefault(); if (!ctx) return; const done = ctx.onLeave; close(); done(); });
  useBtn.addEventListener('click', e => { e.preventDefault(); if (!ctx) return; const done = ctx.onUse; close(); done(); });
  return api;
}
