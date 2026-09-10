// Small helpers to render a card as a DOM tile, shared by the hand panel and the
// encounter modal. Purely presentational.
import { CARDS } from '../game/cards.js';

// One card instance as a tile. `opts.selectable` makes it tappable (calls opts.onSelect);
// `opts.action` adds a button (label + onClick); `opts.selected` marks it chosen.
export function cardTile(doc, card, opts = {}) {
  const meta = CARDS[card.type] || { name: card.type, glyph: '?', tint: '#fff', desc: '' };
  const el = doc.createElement('div');
  el.className = 'card-tile' + (meta.evil ? ' evil' : '') + (opts.selectable ? ' selectable' : '') + (opts.selected ? ' selected' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.dataset.cardId = card.id;
  const shots = card.type === 'revolver' && card.shots != null ? ` · ${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';
  el.innerHTML = `<span class="glyph">${meta.glyph}</span><span class="cname">${meta.name}${shots}</span><span class="cdesc">${opts.desc ?? meta.desc}</span>`;
  if (opts.selectable && opts.onSelect) el.addEventListener('click', e => { e.preventDefault(); opts.onSelect(card, el); });
  if (opts.action) {
    const btn = doc.createElement('button');
    btn.className = 'btn' + (opts.action.primary ? ' primary' : '');
    btn.type = 'button';
    btn.textContent = opts.action.label;
    if (opts.action.disabled) btn.disabled = true;
    btn.addEventListener('click', e => { e.preventDefault(); opts.action.onClick(card); });
    el.appendChild(btn);
  }
  return el;
}

// A stacked tile summarising N copies of one card type (for the hand overview).
export function countTile(doc, type, count) {
  const meta = CARDS[type];
  const el = doc.createElement('div');
  el.className = 'card-tile count' + (meta.evil ? ' evil' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.innerHTML = `<span class="glyph">${meta.glyph}</span><span class="cname">${meta.name}</span>` +
    `<span class="badge">×${count}</span><span class="cdesc">${meta.desc}</span>`;
  return el;
}
