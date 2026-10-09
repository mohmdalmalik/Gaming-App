// The possessed guest's own reminder of what they can still do: how many Possession cards they hold
// ("souls to trade"). Used ONLY on that guest's own surfaces — the role and turn hand-over screens,
// the card view, and their player panel on the main screen (outside hot-seat always; in hot-seat during
// their own action phase only, as docs/GAME_RULES.md > Possession says; src/main.js possessedTellOnMain).
// Never call it for the public strip, the pass screen, a meeting, the map or another guest.
import { CARD_FACE } from './cards.js';

export const soulsHeld = player => player.hand.filter(c => c.type === 'possession').length;

// One plain sentence for the count; 0 is said calmly, never as an error.
export function soulsText(n) {
  if (n <= 0) return 'No souls left to trade — you still win with the possessed side if dawn breaks first.';
  return `Souls to trade: ${n}`;
}

// A small chip on the crimson plate: a mini Possession card and the count. `compact` drops the 0-souls explanation
// to a short line (the player panel has little room).
export function soulsChip(doc, n, { compact = false } = {}) {
  const chip = doc.createElement('div');
  chip.className = 'souls-chip' + (n <= 0 ? ' none' : '') + (compact ? ' compact' : '');
  const img = doc.createElement('img');
  img.className = 'souls-card'; img.src = CARD_FACE.possession; img.alt = ''; img.draggable = false;
  const text = doc.createElement('span');
  text.className = 'souls-text';
  if (n > 0) text.innerHTML = `Souls to trade: <b>${n}</b>`;
  else text.textContent = compact ? 'No souls left to trade' : soulsText(0);
  chip.append(img, text);
  return chip;
}
