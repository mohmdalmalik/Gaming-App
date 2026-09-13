// Render a card as a DOM tile, shared by the hand sheet, the encounter modal and the discard
// prompt. Each tile has an illustrated "art" panel (a large tinted glyph placeholder now; a real
// illustration drops in via CARD_ART without touching this code) plus the card's name.
import { CARDS } from '../game/cards.js';

// Drop-in artwork: map a card type to an image path under assets/cards/. Left empty on purpose —
// the glyph placeholder is used until real illustrations are supplied. Add entries like
// `bandage: 'assets/cards/bandage.png'` once the files exist and the art appears automatically.
export const CARD_ART = {
  lantern: 'assets/cards/lantern.jpg',
};

// The art panel for a card type: a real illustration if one is registered, else a big glyph.
function cardArt(doc, type) {
  const meta = CARDS[type] || {};
  const art = doc.createElement('div');
  art.className = 'art';
  if (CARD_ART[type]) {
    const img = doc.createElement('img'); img.alt = meta.name || type; img.src = CARD_ART[type];
    art.appendChild(img);
  } else {
    const g = doc.createElement('span'); g.className = 'glyph'; g.textContent = meta.glyph || '?';
    art.appendChild(g);
  }
  return art;
}

// One card instance as a tile. `opts.selectable` makes it tappable (calls opts.onSelect);
// `opts.action` adds a button (label + onClick); `opts.selected` marks it chosen;
// `opts.hideDesc` drops the small description line (the hand sheet shows it in its detail pane).
export function cardTile(doc, card, opts = {}) {
  const meta = CARDS[card.type] || { name: card.type, glyph: '?', tint: '#fff', desc: '' };
  const el = doc.createElement('div');
  el.className = 'card-tile' + (meta.evil ? ' evil' : '') + (opts.selectable ? ' selectable' : '') + (opts.selected ? ' selected' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.dataset.cardId = card.id;
  const shots = card.type === 'revolver' && card.shots != null ? ` · ${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';

  el.appendChild(cardArt(doc, card.type));
  const nm = doc.createElement('span'); nm.className = 'cname'; nm.textContent = `${meta.name}${shots}`; el.appendChild(nm);
  if (!opts.hideDesc) {
    const d = doc.createElement('span'); d.className = 'cdesc'; d.textContent = opts.desc ?? meta.desc; el.appendChild(d);
  }

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

// A stacked tile summarising N copies of one card type (kept for possible overviews).
export function countTile(doc, type, count) {
  const meta = CARDS[type];
  const el = doc.createElement('div');
  el.className = 'card-tile count' + (meta.evil ? ' evil' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.appendChild(cardArt(doc, type));
  el.innerHTML += `<span class="cname">${meta.name}</span><span class="badge">×${count}</span><span class="cdesc">${meta.desc}</span>`;
  return el;
}
