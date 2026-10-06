// Render a card as a DOM tile, shared by the hand sheet, the encounter modal and the discard
// prompt. Each tile has an illustrated "art" panel (a large tinted glyph placeholder now; a real
// illustration drops in via CARD_ART without touching this code) plus the card's name.
import { CARDS, countableCount } from '../game/cards.js';
import { rules } from '../data/rules.js';
import { cardIcon } from './cardIcons.js';

// Over the hand limit DURING a turn is allowed (approved rule: the limit is settled only when the turn
// ends). This is the gentle reminder shown wherever the count is: '' when within the limit, otherwise
// "Cards 8/6 · discard 2 at end of turn" (short, so it stays on one line above the fan on an iPad).
// Possession cards never count (and never show here), so it reads the same whatever the guest's role.
export function handLimitWarning(player) {
  const n = countableCount(player.hand);
  const over = n - rules.handLimit;
  return over > 0 ? `Cards ${n}/${rules.handLimit} · discard ${over} at end of turn` : '';
}

// Drop-in artwork: map a card type to an image path under assets/cards/. Left empty on purpose —
// the glyph placeholder is used until real illustrations are supplied. Add entries like
// `bandage: 'assets/cards/bandage.png'` once the files exist and the art appears automatically.
export const CARD_ART = {
  lantern: 'assets/cards/lantern.jpg',
  // Rendered in Blender to match the Lantern (tools/card-pipeline/make_cards.py).
  bandage: 'assets/cards/bandage.jpg',
  flashlight: 'assets/cards/flashlight.jpg',
  knife: 'assets/cards/knife.jpg',
  revolver: 'assets/cards/revolver.jpg',
  barricade: 'assets/cards/barricade.jpg',
  lockPick: 'assets/cards/lockPick.jpg',
  masterKey: 'assets/cards/masterKey.jpg',
  handMirror: 'assets/cards/handMirror.jpg',
  espresso: 'assets/cards/espresso.jpg',
  possession: 'assets/cards/possession.jpg',
};

// Finished card faces (the owner's designs: frame, illustration and name in one image, 2:3). A card with a
// face is shown as that image; the name stays in the DOM for screen readers and the revolver's shot
// count is overlaid. tools/card-pipeline/import_owner_cards.py makes these from tools/card-pipeline/owner/.
export const CARD_FACE = {
  lantern: 'assets/cards/face/lantern.jpg',
  bandage: 'assets/cards/face/bandage.jpg',
  flashlight: 'assets/cards/face/flashlight.jpg',
  knife: 'assets/cards/face/knife.jpg',
  revolver: 'assets/cards/face/revolver.jpg',
  barricade: 'assets/cards/face/barricade.jpg',
  lockPick: 'assets/cards/face/lockPick.jpg',     // assembled in the same style (make_lockpick_face.py)
  masterKey: 'assets/cards/face/masterKey.jpg',
  handMirror: 'assets/cards/face/handMirror.jpg',
  espresso: 'assets/cards/face/espresso.jpg',
  possession: 'assets/cards/face/possession.jpg',
};
export const CARD_BACK = 'assets/cards/back.jpg';

// Practice is one guest alone — no trades, no possessed guest — so card words that talk about those
// are swapped for these there (main.js switches it on in practice only). The rules' own words are in
// src/data/rules.js and are unchanged.
const PRACTICE_DESC = {
  lantern: 'Three of them let you escape through the fire exit.',
};
let practiceWording = false;
export function usePracticeWording(on) { practiceWording = !!on; }
// What a card does, in words for this mode.
export function cardDesc(type) {
  return (practiceWording && PRACTICE_DESC[type]) || CARDS[type]?.desc || '';
}

// The art panel for a card type: a real illustration if one is registered, else a big glyph.
function cardArt(doc, type) {
  const meta = CARDS[type] || {};
  const art = doc.createElement('div');
  art.className = 'art';
  if (CARD_ART[type]) {
    const img = doc.createElement('img'); img.alt = meta.name || type; img.src = CARD_ART[type];
    art.appendChild(img);
  } else if (cardIcon(type)) {
    art.innerHTML = cardIcon(type);                      // drawn vector icon (src/ui/cardIcons.js)
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
  const face = CARD_FACE[card.type];
  el.className = 'card-tile' + (face ? ' face' : '') + (meta.evil ? ' evil' : '') + (opts.selectable ? ' selectable' : '') + (opts.selected ? ' selected' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.dataset.cardId = card.id;
  const shots = card.type === 'revolver' && card.shots != null ? ` · ${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';

  if (face) {
    const f = doc.createElement('div'); f.className = 'face-img';
    const img = doc.createElement('img'); img.alt = `${meta.name}${shots}`; img.src = face; f.appendChild(img);
    if (shots) { const b = doc.createElement('span'); b.className = 'face-badge'; b.textContent = `${card.shots} shot${card.shots === 1 ? '' : 's'}`; f.appendChild(b); }
    el.appendChild(f);
  } else {
    el.appendChild(cardArt(doc, card.type));
  }
  const nm = doc.createElement('span'); nm.className = 'cname'; nm.textContent = `${meta.name}${shots}`; el.appendChild(nm);
  if (!opts.hideDesc) {
    const d = doc.createElement('span'); d.className = 'cdesc'; d.textContent = opts.desc ?? (CARDS[card.type] ? cardDesc(card.type) : meta.desc); el.appendChild(d);
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

// The order a hand is shown in (the fan, the card view): Possession cards first, then the rest
// grouped by type in catalogue order (Lanterns lead). Returns a new array.
export function sortHand(hand) {
  const order = Object.keys(CARDS);
  const rank = c => (c.type === 'possession' ? -1 : order.indexOf(c.type));
  return [...hand].sort((a, b) => rank(a) - rank(b));
}

// One card shown large: its face, then its name and what it does in plain text (the found-card
// reveal and the card view). `opts.text` false leaves the words out.
export function bigCard(doc, card, opts = {}) {
  const meta = CARDS[card.type] || { name: card.type, desc: '' };
  const el = doc.createElement('div');
  el.className = 'big-card' + (meta.evil ? ' evil' : '');
  el.dataset.cardId = card.id;
  const shots = card.type === 'revolver' && card.shots != null ? `${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';
  const face = doc.createElement('div');
  face.className = 'bc-face';
  if (CARD_FACE[card.type]) {
    const img = doc.createElement('img'); img.src = CARD_FACE[card.type]; img.alt = meta.name; face.appendChild(img);
  } else {
    face.appendChild(cardArt(doc, card.type));
  }
  if (shots) { const b = doc.createElement('span'); b.className = 'face-badge'; b.textContent = shots; face.appendChild(b); }
  el.appendChild(face);
  if (opts.text !== false) {
    const nm = doc.createElement('div'); nm.className = 'bc-name'; nm.textContent = meta.name; el.appendChild(nm);
    const d = doc.createElement('div'); d.className = 'bc-desc'; d.textContent = CARDS[card.type] ? cardDesc(card.type) : meta.desc; el.appendChild(d);
  }
  return el;
}

// A stacked tile summarising N copies of one card type (kept for possible overviews).
export function countTile(doc, type, count) {
  const meta = CARDS[type];
  const el = doc.createElement('div');
  el.className = 'card-tile count' + (meta.evil ? ' evil' : '');
  el.style.setProperty('--card-tint', meta.tint);
  el.appendChild(cardArt(doc, type));   // (overview tile: keeps the small art panel)
  el.innerHTML += `<span class="cname">${meta.name}</span><span class="badge">×${count}</span><span class="cdesc">${meta.desc}</span>`;
  return el;
}
