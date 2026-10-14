// Render a card as a DOM tile, shared by the hand sheet, the encounter modal and the discard
// prompt. Each tile has an illustrated "art" panel (a large tinted glyph placeholder now; a real
// illustration drops in via CARD_ART without touching this code) plus the card's name.
import { CARDS, countableCount } from '../game/cards.js';
import { rules } from '../data/rules.js';
import { cardIcon } from './cardIcons.js';
import { soulFaceSrc, markSoul, prepareSoulFaces } from './soulFace.js';
import { sfx } from '../audio/bus.js';

// Over the hand limit DURING a turn is allowed (approved rule: the limit is settled only when the turn
// ends). This is the gentle reminder shown wherever the count is: '' when within the limit, otherwise
// "Cards 8/6 · discard 2 at end of turn" (short, so it stays on one line above the fan on an iPad).
// It is the guest's own count, for their own screens only (card counts are private). Possession cards
// never count (and never show here), so it reads the same whatever the guest's role.
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

// The face of one card. A Possession card is its owner's own soul (soul cards, approved 10 Oct 2026): it
// shows their possessed face in the card's mirror (card.owner, drawn by src/ui/soulFace.js), or the plain
// face while that is being drawn and for a card whose owner is unknown. Every other card: its type's face.
export function cardFaceSrc(card) {
  const plain = CARD_FACE[card?.type];
  return card?.type === 'possession' ? soulFaceSrc(card.owner, plain) : plain;
}
// Put a card's face on an <img>. A soul's own face replaces the plain one by itself once it is drawn.
export function setCardFace(img, card) {
  img.src = cardFaceSrc(card) || '';
  markSoul(img, card?.type === 'possession' ? card.owner : null);
  return img;
}
// Draw these guests' soul faces ahead, one at a time (main.js, when a game is set up).
export const prepareSoulCards = (ids, opts) => prepareSoulFaces(ids, CARD_FACE.possession, opts);

// Practice is one guest alone — no trades, no possessed guest — so card words that talk about those
// are swapped for these there (main.js switches it on in practice only). The rules' own words are in
// src/data/rules.js and are unchanged.
const PRACTICE_DESC = {
  lantern: 'Three of them let you escape through the fire exit.',
};
let practiceWording = false;
export function usePracticeWording(on) { practiceWording = !!on; }
// What a card does, in words for this mode. Give the card itself where there is one: a Revolver's words
// then say how many shots IT has left (the catalogue's own words say two, which is true only of a new one).
export function cardDesc(type, card = null) {
  const full = CARDS.revolver?.shots;
  if (type === 'revolver' && card && card.shots > 0 && card.shots < full) {
    return `Attack: ${CARDS.revolver.damage} damage. ${card.shots === 1 ? 'One shot' : `${card.shots} shots`} left, then it is gone.`;
  }
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
    const img = doc.createElement('img'); img.alt = `${meta.name}${shots}`; setCardFace(img, card); f.appendChild(img);
    if (shots) { const b = doc.createElement('span'); b.className = 'face-badge'; b.textContent = `${card.shots} shot${card.shots === 1 ? '' : 's'}`; f.appendChild(b); }
    el.appendChild(f);
  } else {
    el.appendChild(cardArt(doc, card.type));
  }
  const nm = doc.createElement('span'); nm.className = 'cname'; nm.textContent = `${meta.name}${shots}`; el.appendChild(nm);
  if (!opts.hideDesc) {
    const d = doc.createElement('span'); d.className = 'cdesc'; d.textContent = opts.desc ?? (CARDS[card.type] ? cardDesc(card.type, card) : meta.desc); el.appendChild(d);
  }

  // A tap on a card to choose it makes the 'select' sound (the screens that ignore a tap that is too soon
  // say so by returning false: a tap that did nothing is silent).
  if (opts.selectable && opts.onSelect) {
    el.addEventListener('click', e => { e.preventDefault(); if (opts.onSelect(card, el, e) !== false) sfx('select'); });
    // A card that can be chosen is a button for the keyboard and for a screen reader too (Tab to it, Enter or Space
    // to choose it); src/ui/focus.js keeps Tab inside the screen it is on.
    el.tabIndex = 0; el.setAttribute('role', 'button'); el.setAttribute('aria-pressed', String(!!opts.selected));
    el.setAttribute('aria-label', `${meta.name}${shots}`);
    el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); el.click(); } });
  }
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
    const img = doc.createElement('img'); setCardFace(img, card); img.alt = meta.name; face.appendChild(img);
  } else {
    face.appendChild(cardArt(doc, card.type));
  }
  if (shots) { const b = doc.createElement('span'); b.className = 'face-badge'; b.textContent = shots; face.appendChild(b); }
  el.appendChild(face);
  if (opts.text !== false) {
    const nm = doc.createElement('div'); nm.className = 'bc-name'; nm.textContent = meta.name; el.appendChild(nm);
    const d = doc.createElement('div'); d.className = 'bc-desc'; d.textContent = CARDS[card.type] ? cardDesc(card.type, card) : meta.desc; el.appendChild(d);
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
