// The lock choice: the small card that comes up when the padlock of a locked door (or the door itself) is tapped
// by the guest standing next to it. It offers what they hold to open it with — one button for each KIND of card,
// "Use Master Key" and/or "Use Lock Pick", each with one honest line under it (the key always opens it, the pick
// may snap; the number comes from src/data/rules.js) — and "Not now". The cost is said once: "1 action". Nothing is
// spent until a button is pressed; the card only carries the choice back (`onChoose(cardId, roomId)`), and
// src/main.js runs the rules (useUnlock) and shows the outcome on the door itself.
// Private to the player: it names the cards they hold (only they look at this screen). The room stays in view
// behind a light veil, and the card sits near the padlock when the caller knows where it is.
// A modal like the others (src/ui/focus.js: focus stays inside, Escape is "Not now"). A double tap cannot spend two
// cards: a click in the card's first moments is ignored, the card answers once, and a tap that lands on the door
// just after it closed is swallowed (`swallowTap`, src/main.js onTap).
import { rules } from '../data/rules.js';
import { CARDS } from '../game/cards.js';
import { moveCostInto } from '../game/state.js';
import { actionsWord } from './actionsWord.js';
import { cardIcon } from './cardIcons.js';
import { watchDialog } from './focus.js';
import { GUARD_MS, tooSoon } from './tapGuard.js';

// One line on what a card does here, in words: the numbers are the rules' own ("half the time" when the chance is
// one in two, the way the Lock Pick card says it).
export function lockHint(type) {
  if (type === 'lockPick') {
    const chance = rules.lockPickChance === 0.5 ? 'half the time' : `${Math.round(rules.lockPickChance * 100)}% of the time`;
    return `Opens it ${chance}, or snaps. Used up either way.`;
  }
  return 'Always opens it. Used up.';
}

// Said under the choice (and in the hand's Open button) when using a card here would leave no action to go through
// the door with: it locks again when the turn ends. null when there is nothing to warn of.
export function lockWarning(state, player, roomId) {
  const short = player.actionPoints - rules.actionCost.useCard < moveCostInto(state, roomId) && !player.hand.some(c => c.type === 'espresso');
  return short ? 'You will have no action left to go in: the door locks again when your turn ends.' : null;
}

const M = 12, TOP = 100, BOTTOM = 130;       // the card keeps this far (px) from the screen's edges, the top strip and the hand
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createLockChoice(doc, { onChoose, onCancel = () => {} }) {
  const overlay = doc.getElementById('lock-overlay');
  const card = overlay.querySelector('.lock-card');
  const title = doc.getElementById('lock-title');
  const cost = doc.getElementById('lock-cost');
  const options = doc.getElementById('lock-options');
  const warn = doc.getElementById('lock-warn');
  const cancelBtn = doc.getElementById('btn-lock-cancel');
  let open = false;
  let openedAt = 0;
  let closedAt = -Infinity;
  let answered = false;          // the card has been answered: nothing more is taken from it
  let ctx = null;                // { roomId }

  // Near the padlock (below it, or above when there is no room below), else in the middle; always on screen.
  function place(anchor) {
    const o = overlay.getBoundingClientRect(), w = card.offsetWidth, h = card.offsetHeight;
    let x = (o.width - w) / 2, y = (o.height - h) / 2;
    if (anchor) {
      x = anchor.x - o.left - w / 2;
      y = anchor.y - o.top + 46;
      if (y + h > o.height - BOTTOM) y = anchor.y - o.top - 46 - h;
    }
    card.style.left = `${Math.round(clamp(x, M, o.width - w - M))}px`;
    card.style.top = `${Math.round(clamp(y, TOP, Math.max(TOP, o.height - h - BOTTOM)))}px`;
  }

  function close() {
    if (!open) return;
    open = false; overlay.hidden = true; closedAt = performance.now();
    options.innerHTML = ''; warn.hidden = true; warn.textContent = ''; ctx = null;
  }
  function answer(fn) { if (!open || answered) return; answered = true; fn(); }

  const api = {
    get isOpen() { return open; },
    // info: { roomId, roomName, options: [{ type, cardId }], cost: 'N action(s)', warn: string | null, anchor: { x, y } | null }
    open(info) {
      if (open) close();
      ctx = { roomId: info.roomId }; answered = false;
      title.textContent = `Open the ${info.roomName} door?`;
      cost.textContent = `Costs ${info.cost ?? actionsWord(rules.actionCost.useCard)}.`;
      options.innerHTML = '';
      for (const o of info.options) {
        const meta = CARDS[o.type] || { name: o.type };
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'btn primary lock-opt'; btn.dataset.card = o.type;
        const art = doc.createElement('span'); art.className = 'lock-opt-art'; art.innerHTML = cardIcon(o.type) || meta.glyph || '';
        const words = doc.createElement('span'); words.className = 'lock-opt-words';
        const name = doc.createElement('span'); name.className = 'lock-opt-name'; name.textContent = `Use ${meta.name}`;
        const hint = doc.createElement('span'); hint.className = 'lock-opt-hint'; hint.textContent = lockHint(o.type);
        words.append(name, hint); btn.append(art, words);
        btn.addEventListener('click', e => {
          e.preventDefault();
          if (tooSoon(e, openedAt)) return;
          answer(() => { const at = ctx.roomId; close(); onChoose(o.cardId, at); });
        });
        options.appendChild(btn);
      }
      warn.textContent = info.warn || ''; warn.hidden = !info.warn;
      open = true; openedAt = performance.now();
      overlay.hidden = false;           // (shown first: the card is measured to place it)
      place(info.anchor);
    },
    close,
    // A tap that lands on the hotel just after the card closed (the second tap of a double tap) does nothing.
    swallowTap() { return performance.now() - closedAt < GUARD_MS + 50; },
  };

  cancelBtn.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, openedAt)) return; answer(() => { close(); onCancel(); }); });
  // a tap on the veil is "Not now" too
  overlay.addEventListener('click', e => { if (e.target === overlay && !tooSoon(e, openedAt)) answer(() => { close(); onCancel(); }); });
  window.addEventListener('resize', () => { if (open) place(null); });
  // Focus stays in the card; Escape presses Not now. It opens on Not now, never on a card, so a stray Enter spends nothing.
  watchDialog(doc, { overlay, dialog: '.lock-card', labelledby: 'lock-title', escape: 'click:#btn-lock-cancel', main: ['#btn-lock-cancel'] });
  return api;
}
