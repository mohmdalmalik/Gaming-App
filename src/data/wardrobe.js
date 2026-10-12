// The avatar wardrobe: the catalogue, as data (no three.js, no DOM: a server can
// validate an avatar with it later). Colours are sRGB hex of the MATERIAL's base colour (the same
// meaning as the GLB's baseColorFactor and the lobby's `dress`): the model's own baked shading
// (COLOR_0: ambient occlusion, grooves, seams) multiplies it.
//
// An avatar is ids only:  { v: 1, base, skin, hair, eyes, glasses, frame, main, accent, metal }
// (never raw colours: the catalogue can be re-tuned, and a server can check what a player owns).

// ---- The six looks (the guests' models, plain names; the guests keep their names in the lobby) ----
// parts: which named materials each slot paints. derive: materials that follow a slot's colour,
// darkened (linear multiply), so seams / satin lapels / the sash stay a shade darker than the cloth.
export const BASES = {
  victor: { label: 'Tuxedo', body: 'm', model: 'assets/characters/victor.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow', 'Stache'], main: ['Jacket', 'Trouser'], accent: ['Tie'] },
    derive: { Lapel: { from: 'main', mul: 0.62 }, Shade: { from: 'main', dark: true } },
    original: { skin: 'fair', hair: 'black', main: 'midnight', accent: 'black' } },
  marcus: { label: 'Suit and tie', body: 'm', model: 'assets/characters/marcus.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], main: ['Jacket', 'Trouser'], accent: ['Tie'] },
    derive: { Shade: { from: 'main', dark: true } },
    original: { skin: 'tan', hair: 'black', main: 'midnight', accent: 'claret' } },
  henry: { label: 'Dinner jacket', body: 'm', model: 'assets/characters/henry.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], main: ['Jacket'], accent: ['Tie'] },
    derive: { Shade: { from: 'main', dark: true } },
    builtInGlasses: 'Glasses',           // his own round frames: hidden unless the avatar wears 'round'
    original: { skin: 'rosy', hair: 'silver', main: 'ivory', accent: 'black', glasses: 'round', frame: 'tortoise' } },
  clara: { label: 'Column dress', body: 'f', model: 'assets/characters/clara.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], lips: ['Lips'], main: ['Dress'], accent: ['Sash'], metal: ['Gold'] },
    derive: {},
    original: { skin: 'rosy', hair: 'auburn', main: 'claret', accent: 'claret', metal: 'gold' } },
  eleanor: { label: 'Ballgown', body: 'f', model: 'assets/characters/eleanor.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], lips: ['Lips'], main: ['Dress'], metal: ['Gold'] },
    derive: {},
    original: { skin: 'rosy', hair: 'brown', main: 'midnight', metal: 'gold' } },
  beatrice: { label: 'A-line gown', body: 'f', model: 'assets/characters/beatrice.glb',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], lips: ['Lips'], main: ['Dress'], metal: ['Gold'] },
    derive: {},
    original: { skin: 'tan', hair: 'darkBrown', main: 'emerald', metal: 'gold' } },
};

// ---- Catalogue: one list, every item { id, slot, label, value…, unlock: 'free' | 'earn' | 'shop' } ----
export const ITEMS = [
  // Skin tones (8, light to deep). lips: the women's lip colour that goes with it.
  { id: 'porcelain', slot: 'skin', label: 'Porcelain', value: '#ffd2b4', lips: '#c4566a', unlock: 'free' },
  { id: 'fair', slot: 'skin', label: 'Fair', value: '#fcc49a', lips: '#b8546a', unlock: 'free' },
  { id: 'rosy', slot: 'skin', label: 'Rosy', value: '#ffb08a', lips: '#b04c62', unlock: 'free' },
  { id: 'golden', slot: 'skin', label: 'Golden', value: '#eaa06a', lips: '#9e4658', unlock: 'free' },
  { id: 'tan', slot: 'skin', label: 'Tan', value: '#d6895c', lips: '#86404f', unlock: 'free' },
  { id: 'bronze', slot: 'skin', label: 'Bronze', value: '#b06c44', lips: '#6e3442', unlock: 'free' },
  { id: 'brown', slot: 'skin', label: 'Brown', value: '#8a5234', lips: '#5a2c36', unlock: 'free' },
  { id: 'deep', slot: 'skin', label: 'Deep', value: '#643a26', lips: '#46222a', unlock: 'free' },

  // Hair colours. brow: the brows (and Victor's moustache), a little darker.
  { id: 'black', slot: 'hair', label: 'Black', value: '#3c3a42', brow: '#1c1a1c', unlock: 'free' },
  { id: 'darkBrown', slot: 'hair', label: 'Dark brown', value: '#5a4a44', brow: '#2e201a', unlock: 'free' },
  { id: 'brown', slot: 'hair', label: 'Brown', value: '#8a6a5a', brow: '#3a2a20', unlock: 'free' },
  { id: 'auburn', slot: 'hair', label: 'Auburn', value: '#7a4a44', brow: '#3a221c', unlock: 'free' },
  { id: 'copper', slot: 'hair', label: 'Copper', value: '#a85a38', brow: '#5a2e1c', unlock: 'free' },
  { id: 'blonde', slot: 'hair', label: 'Blonde', value: '#d0a868', brow: '#7a5a34', unlock: 'free' },
  { id: 'silver', slot: 'hair', label: 'Silver', value: '#9aa0b2', brow: '#8e868a', unlock: 'free' },
  { id: 'platinum', slot: 'hair', label: 'Platinum', value: '#efe6d2', brow: '#a89a84', unlock: 'earn' },

  // Eye colours. 'classic' = the models' own black eyes. The others paint an iris (dark rim, colour,
  // brighter low in the middle, white catchlight) with the SAME shader as the possessed red eyes, so no
  // new shader; red, amber and violet are never offered: red eyes mean possessed.
  { id: 'classic', slot: 'eyes', label: 'Classic', value: null, unlock: 'free' },
  { id: 'brownEyes', slot: 'eyes', label: 'Brown', value: ['#140b06', '#24150c', '#553420'], unlock: 'free' },
  { id: 'hazel', slot: 'eyes', label: 'Hazel', value: ['#161408', '#2c2a12', '#6e6a2e'], unlock: 'free' },
  { id: 'green', slot: 'eyes', label: 'Green', value: ['#0a1610', '#123222', '#2e7a4e'], unlock: 'free' },
  { id: 'blue', slot: 'eyes', label: 'Blue', value: ['#0a1222', '#142a4c', '#3a6eb0'], unlock: 'free' },
  { id: 'grey', slot: 'eyes', label: 'Grey', value: ['#121416', '#2a2e34', '#6a737e'], unlock: 'free' },

  // Glasses (shape) and their frame colour.
  { id: 'none', slot: 'glasses', label: 'None', value: null, unlock: 'free' },
  { id: 'round', slot: 'glasses', label: 'Round', value: 'round', unlock: 'free' },
  { id: 'oval', slot: 'glasses', label: 'Oval', value: 'oval', unlock: 'free' },
  { id: 'deco', slot: 'glasses', label: 'Deco square', value: 'deco', unlock: 'free' },
  { id: 'pincenez', slot: 'glasses', label: 'Pince-nez', value: 'pincenez', unlock: 'free' },
  { id: 'monocle', slot: 'glasses', label: 'Monocle', value: 'monocle', unlock: 'shop' },
  { id: 'tortoise', slot: 'frame', label: 'Tortoiseshell', value: '#3a2218', unlock: 'free' },
  { id: 'jet', slot: 'frame', label: 'Black', value: '#141416', unlock: 'free' },
  { id: 'silverFrame', slot: 'frame', label: 'Silver', value: '#b8bcc4', unlock: 'free' },
  { id: 'goldFrame', slot: 'frame', label: 'Gold', value: '#d6aa55', unlock: 'shop' },

  // Outfit: the main colour (jacket and trousers, or the dress).
  { id: 'midnight', slot: 'main', label: 'Midnight', value: '#36436a', unlock: 'free' },
  { id: 'black', slot: 'main', label: 'Black', value: '#1c1c22', unlock: 'free' },
  { id: 'charcoal', slot: 'main', label: 'Charcoal', value: '#4a4a52', unlock: 'free' },
  { id: 'ivory', slot: 'main', label: 'Ivory', value: '#fbe7d3', unlock: 'free' },
  { id: 'claret', slot: 'main', label: 'Claret', value: '#5a1e2c', unlock: 'free' },
  { id: 'emerald', slot: 'main', label: 'Emerald', value: '#36524f', unlock: 'free' },
  { id: 'plum', slot: 'main', label: 'Plum', value: '#4e2a4c', unlock: 'free' },
  { id: 'cocoa', slot: 'main', label: 'Cocoa', value: '#5a4032', unlock: 'free' },
  { id: 'champagne', slot: 'main', label: 'Champagne', value: '#e6cfa0', unlock: 'earn' },
  { id: 'gatsby', slot: 'main', label: 'Gatsby gold', value: '#c8963c', unlock: 'shop' },
  // Accent: tie / bow tie / sash.
  { id: 'black', slot: 'accent', label: 'Black', value: '#1a1a1e', unlock: 'free' },
  { id: 'claret', slot: 'accent', label: 'Claret', value: '#843c48', unlock: 'free' },
  { id: 'navy', slot: 'accent', label: 'Navy', value: '#2a3458', unlock: 'free' },
  { id: 'emerald', slot: 'accent', label: 'Emerald', value: '#2e5a46', unlock: 'free' },
  { id: 'brass', slot: 'accent', label: 'Brass', value: '#b48a46', unlock: 'free' },
  { id: 'ivory', slot: 'accent', label: 'Ivory', value: '#efe6d6', unlock: 'free' },
  // Jewellery metal (the women's earrings, buckles, pins).
  { id: 'gold', slot: 'metal', label: 'Gold', value: '#e0b060', unlock: 'free' },
  { id: 'silver', slot: 'metal', label: 'Silver', value: '#c8ccd4', unlock: 'free' },
  { id: 'roseGold', slot: 'metal', label: 'Rose gold', value: '#e0a088', unlock: 'earn' },
];

export const SLOTS = ['base', 'skin', 'hair', 'eyes', 'glasses', 'frame', 'main', 'accent', 'metal'];
export const item = (slot, id) => ITEMS.find(i => i.slot === slot && i.id === id) || null;
// An item's id across the whole catalogue (ids repeat between slots: 'brown' hair, 'brown' skin), the one
// a player's inventory and, later, a store's product list use: 'glasses.monocle'.
export const itemId = it => `${it.slot}.${it.id}`;
// The body a look is made for ('m' | 'f'): the wardrobe's Male / Female choice.
export const bodyOf = base => BASES[base]?.body || 'm';
export const itemsFor = slot => ITEMS.filter(i => i.slot === slot);

// The avatar a base wears by default (its original look).
export function originalAvatar(base) {
  const o = BASES[base].original;
  return { v: 1, base, skin: o.skin, hair: o.hair, eyes: 'classic', glasses: o.glasses || 'none', frame: o.frame || 'tortoise',
    main: o.main, accent: o.accent || 'black', metal: o.metal || 'gold' };
}

// Starter items are free; everything else must be owned (`owns(globalId)`). Nothing can be owned yet:
// 'earn' and 'shop' items show as locked, "Coming soon".
const freeOwns = () => false;
export const isAvailable = (it, owns = freeOwns) => !!it && (it.unlock === 'free' || owns(itemId(it)));

// Any saved or received avatar made safe: a missing, unknown or not-owned value falls back to the look's
// original (always free), so a damaged save, an old version or a locked item never reaches the screen.
export function normaliseAvatar(av, { owns = freeOwns } = {}) {
  const base = av && BASES[av.base] ? av.base : 'victor';
  const fallback = originalAvatar(base);
  const out = { v: 1, base };
  for (const slot of SLOTS) {
    if (slot === 'base') continue;
    const it = item(slot, av?.[slot]);
    out[slot] = isAvailable(it, owns) ? it.id : fallback[slot];
  }
  return out;
}

// A stable string for an avatar (caches: portraits, soul faces, character views).
export const avatarKey = av => `v1|${SLOTS.map(s => av?.[s] ?? '').join('|')}`;
