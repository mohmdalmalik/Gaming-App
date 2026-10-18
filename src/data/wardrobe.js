// The avatar wardrobe: the catalogue, as data (no three.js, no DOM: a server can validate an avatar with it later).
// Avatar v2 (Wardrobe W1, the contract of 18 Oct 2026): swappable PIECES on shared bodies. The six classic guests
// (Victor, Marcus, Henry, Clara, Eleanor, Beatrice) are ready-made LOOKS; every piece mixes with every other piece of
// the same body: any face, hair, moustache, outfit and colour.
//
// An avatar is ids only (never raw colours: the catalogue can be re-tuned, and a server can check what a player owns):
//   a man    { v: 2, body: 'm', face, hairStyle, facial, glasses, top, neck, legs, feet, extras: [], colours }
//   a woman  { v: 2, body: 'f', face, hairStyle, makeup, glasses, dress, belt, feet, extras: [], colours }
//   colours  { skin, hair, eyes, main, accent, metal, frame, lips }   (today's colour ids, unchanged)
// A v1 avatar ({ v: 1, base, skin, hair, … }: one of the six looks, recoloured) still reads: avatarFromV1 maps it,
// losslessly, to the Look it was (normaliseAvatar does this by itself), so old saves keep their look.
//
// Colours are sRGB hex of the MATERIAL's base colour (the meaning of a GLB's baseColorFactor): the piece's own baked
// shading (COLOR_0: ambient occlusion, grooves, seams) multiplies it. Which pieces exist is the art on disk: the
// pipeline writes src/data/partsIndex.js, and a piece that is not built yet is "pending" (never offered, never
// loaded). Items are 'free', 'achievement' (earned only, never sold) or 'boutique' (real money later, never earned);
// for now every one of them is wearable (UNLOCK_ALL_FOR_TESTING, the one line below).
import { PART_INDEX } from './partsIndex.js';

// ---- The testing switch: false locks every achievement and boutique item (owned ones stay wearable) ----------------
export const UNLOCK_ALL_FOR_TESTING = true;

// ---- Bodies, slots ----------------------------------------------------------------------------------------------------
// Body ids: 'm', the shared female body 'f', or the female fallback (one body per gown). Which of them exist is decided
// by the art (PART_INDEX.bodies); the gender is the first letter.
export const BODY_IDS = ['m', 'f', 'f_column', 'f_ballgown', 'f_aline'];
const MALE = ['m'];
const FEMALE = ['f', 'f_column', 'f_ballgown', 'f_aline'];
const BOTH = [...MALE, ...FEMALE];
const BODY_RE = /^[mf](?:_[a-z][A-Za-z0-9]*)?$/;
export const genderOf = body => (typeof body === 'string' && body[0] === 'f' ? 'f' : 'm');
export const GENDERS = [{ id: 'm', label: 'Male' }, { id: 'f', label: 'Female' }];

export const SLOTS_BY_GENDER = {
  m: ['face', 'hairStyle', 'facial', 'glasses', 'top', 'neck', 'legs', 'feet'],
  f: ['face', 'hairStyle', 'makeup', 'glasses', 'dress', 'belt', 'feet'],
};
export const COLOUR_SLOTS = ['skin', 'hair', 'eyes', 'main', 'accent', 'metal', 'frame', 'lips'];
export const KEY_SLOTS = ['body', 'face', 'hairStyle', 'facial', 'makeup', 'glasses', 'top', 'neck', 'legs', 'dress', 'belt', 'feet'];
// Where an extra sits (at most one per point), in this order.
export const ATTACH = ['ears', 'neck', 'chest', 'waist', 'hands'];
// The wardrobe's areas (W1-B): a slot's area; the sub-tab is the slot.
export const SLOT_AREA = {
  face: 'face', eyes: 'face', hairStyle: 'hair', hair: 'hair', facial: 'moustache', makeup: 'makeup', lips: 'makeup',
  glasses: 'eyewear', frame: 'eyewear', top: 'outfit', neck: 'outfit', legs: 'outfit', dress: 'outfit', belt: 'outfit',
  feet: 'outfit', main: 'outfit', accent: 'outfit', extra: 'extras', metal: 'extras', skin: 'body',
};
export const SLOT_LABELS = {
  look: 'Look', face: 'Face', hairStyle: 'Hairstyle', facial: 'Moustache', makeup: 'Make-up', glasses: 'Glasses',
  top: 'Jacket', neck: 'Neckwear', legs: 'Trousers', dress: 'Dress', belt: 'Belt', feet: 'Shoes', extras: 'Extras',
  skin: 'Skin tone', hair: 'Hair', eyes: 'Eyes', frame: 'Frame', main: 'Outfit', accent: 'Accent', metal: 'Jewellery', lips: 'Lips',
};
const RARITY = { free: 'common', achievement: 'rare', boutique: 'showpiece' };
// The hard cap on a guest's triangles (normaliseAvatar drops extras, then the glasses: only an "everything at once"
// guest ever reaches it).
export const TRIANGLE_CAP = 38000;

// ---- The catalogue ---------------------------------------------------------------------------------------------------
// Every item: { id, slot, bodies, label (or { m, f }), desc, draw: 'part' | 'code' | 'none' | 'colour', unlock,
// achievement (achievement items only; null = "a later honour"), colours (the colour rows shown with it), attach
// (extras), rarity, isNew, sort, core (the six Looks' pieces: never pending before the pipeline has run),
// artPending (held back: its art is not made yet) } and, for colours and code-drawn glasses, `value`.
// The global id is `${slot}.${id}` ('glasses.monocle', 'hair.platinum'): shape slot names never equal a colour slot
// name, so today's ids keep their meaning. Ids are permanent: an item that goes away gets `retired: true`.
const core = { core: true };
const W1B = { artPending: true, isNew: true };       // one of the ten new items: its art comes in W1-B
const ENTRIES = [
  // Faces: the head (skin, ears, eyes, brows, nose, mouth or lips). Named after the guests.
  { slot: 'face', id: 'victor', bodies: MALE, label: 'Victor', desc: "Victor's face: a long jaw and dark brows.", colours: ['skin', 'eyes'], ...core },
  { slot: 'face', id: 'marcus', bodies: MALE, label: 'Marcus', desc: "Marcus's face: a broad, open look.", colours: ['skin', 'eyes'], ...core },
  { slot: 'face', id: 'henry', bodies: MALE, label: 'Henry', desc: "Henry's face: a high forehead and a kind look.", colours: ['skin', 'eyes'], ...core },
  { slot: 'face', id: 'clara', bodies: FEMALE, label: 'Clara', desc: "Clara's face: soft features and a warm smile.", colours: ['skin', 'eyes'], ...core },
  { slot: 'face', id: 'eleanor', bodies: FEMALE, label: 'Eleanor', desc: "Eleanor's face: fine features and a calm look.", colours: ['skin', 'eyes'], ...core },
  { slot: 'face', id: 'beatrice', bodies: FEMALE, label: 'Beatrice', desc: "Beatrice's face: round cheeks and a bright look.", colours: ['skin', 'eyes'], ...core },

  // Hairstyles (the colour is the hair colour row).
  { slot: 'hairStyle', id: 'swept', bodies: MALE, label: 'Swept', desc: "Victor's: a side part on the left, swept right.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'sideSwept', bodies: MALE, label: 'Side-swept', desc: "Marcus's: a soft sweep over the brow.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'quiff', bodies: MALE, label: 'Quiff', desc: "Henry's: brushed up and back.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'sidePart', bodies: MALE, label: 'Side part', desc: 'Neat and short, with a crisp parting.', colours: ['hair'], isNew: true },
  { slot: 'hairStyle', id: 'curlyCrop', bodies: MALE, label: 'Curly crop', desc: 'Tight curls, short at the sides.', colours: ['hair'], isNew: true },
  { slot: 'hairStyle', id: 'waves', bodies: FEMALE, label: 'Hollywood waves', desc: "Clara's: shoulder-length waves with a big side wave.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'chignon', bodies: FEMALE, label: 'Chignon', desc: "Eleanor's: a side-part wave and a twisted bun at the nape.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'wavyBob', bodies: FEMALE, label: 'Wavy bob', desc: "Beatrice's: a full, rounded bob of waves.", colours: ['hair'], ...core },
  { slot: 'hairStyle', id: 'lamplighter', bodies: BOTH, label: { m: 'The Poet', f: 'Braided crown' },
    desc: { m: 'Tousled romantic waves, kept clear of the eyes.', f: 'A plait worn round the head like a crown.' },
    colours: ['hair'], unlock: 'achievement', achievement: 'lamplighter', ...W1B },
  { slot: 'hairStyle', id: 'marcel', bodies: FEMALE, label: 'Marcel waves', desc: 'Sculpted finger waves with a high shine.', colours: ['hair'], unlock: 'boutique', ...W1B },

  // Moustaches (men; the colour is the brows': a little darker than the hair).
  { slot: 'facial', id: 'none', bodies: MALE, label: 'Clean-shaven', desc: 'No moustache.', draw: 'none', ...core },
  { slot: 'facial', id: 'handlebar', bodies: MALE, label: 'Handlebar', desc: "Victor's big curled moustache.", colours: ['hair'], ...core },
  { slot: 'facial', id: 'pencil', bodies: MALE, label: 'Pencil', desc: 'A thin pencil moustache on the upper lip.', colours: ['hair'], isNew: true },
  { slot: 'facial', id: 'dali', bodies: MALE, label: 'Dalí', desc: 'Thin and waxed, with two tall upturned points.', colours: ['hair'], unlock: 'boutique', ...W1B },

  // Make-up (women): none yet (the lip colour follows the skin tone: colours.lips 'natural').
  { slot: 'makeup', id: 'none', bodies: FEMALE, label: 'None', desc: 'No make-up.', draw: 'none', ...core },

  // Glasses: drawn by the game (src/render/avatarGlasses.js), frames only: the lenses are always clear.
  { slot: 'glasses', id: 'none', bodies: BOTH, label: 'None', desc: 'No glasses.', draw: 'none', value: null, ...core },
  { slot: 'glasses', id: 'round', bodies: BOTH, label: 'Round', desc: 'Thin round wire frames.', draw: 'code', value: 'round', tris: 2600, colours: ['frame'], ...core },
  { slot: 'glasses', id: 'oval', bodies: BOTH, label: 'Oval', desc: 'Soft oval frames.', draw: 'code', value: 'oval', tris: 2600, colours: ['frame'], ...core },
  { slot: 'glasses', id: 'deco', bodies: BOTH, label: 'Deco square', desc: 'Rounded-square Art Deco frames.', draw: 'code', value: 'deco', tris: 2600, colours: ['frame'], ...core },
  { slot: 'glasses', id: 'pincenez', bodies: BOTH, label: 'Pince-nez', desc: 'Clip-on lenses with no arms.', draw: 'code', value: 'pincenez', tris: 2600, colours: ['frame'], ...core },
  { slot: 'glasses', id: 'monocle', bodies: BOTH, label: 'Monocle', desc: 'A gilt rim on a fine chain.', draw: 'code', value: 'monocle', tris: 2600, colours: ['frame'],
    unlock: 'achievement', achievement: 'seenThrough', ...W1B },
  { slot: 'glasses', id: 'gilt', bodies: BOTH, label: 'Gold frames', desc: 'Round gilt spectacles.', draw: 'code', value: 'gilt', frameHex: '#d6aa55', tris: 2600,
    unlock: 'boutique', ...W1B },

  // Jackets (men): jacket or waistcoat with the shirt front, collar, sleeves and cuffs.
  { slot: 'top', id: 'tux', bodies: MALE, label: 'Tuxedo', desc: "Victor's: peaked satin lapels, one button.", colours: ['main'], ...core },
  { slot: 'top', id: 'lounge', bodies: MALE, label: 'Lounge suit', desc: "Marcus's: single-breasted, notch lapels.", colours: ['main'], ...core },
  { slot: 'top', id: 'dinner', bodies: MALE, label: 'Dinner jacket', desc: "Henry's: a shawl collar, studs and a pocket square.", colours: ['main'], ...core },
  { slot: 'top', id: 'waistcoat', bodies: MALE, label: 'Waistcoat', desc: 'A pointed waistcoat over shirtsleeves, with sleeve garters and a watch chain.', colours: ['main', 'accent', 'metal'], isNew: true },
  { slot: 'top', id: 'smoking', bodies: MALE, label: 'Smoking jacket', desc: 'Quilted velvet, a satin shawl collar and frogging.', colours: ['main', 'accent'], unlock: 'boutique', ...W1B },

  // Neckwear (men). The open collar ships only once it passes review with every jacket.
  { slot: 'neck', id: 'none', bodies: MALE, label: 'Open collar', desc: 'No tie.', draw: 'none', artPending: true },
  { slot: 'neck', id: 'bow', bodies: MALE, label: 'Bow tie', desc: "Victor's bow tie.", colours: ['accent'], ...core },
  { slot: 'neck', id: 'tie', bodies: MALE, label: 'Tie', desc: "Marcus's long tie.", colours: ['accent'], ...core },
  { slot: 'neck', id: 'bowFull', bodies: MALE, label: 'Butterfly bow tie', desc: "Henry's fuller bow tie.", colours: ['accent'], ...core },

  // Trousers (men).
  { slot: 'legs', id: 'trousers', bodies: MALE, label: 'Trousers', desc: 'Straight trousers, the colour of the jacket.', colours: ['main'], ...core },
  { slot: 'legs', id: 'blackTrousers', bodies: MALE, label: 'Black trousers', desc: "Henry's: always black.", ...core },

  // Dresses (women): bodice, sleeves, skirt. In the fallback each classic gown has its own body.
  { slot: 'dress', id: 'column', bodies: ['f', 'f_column'], label: 'Column dress', desc: "Clara's: fitted, crew neck, straight to the ankle.", colours: ['main'], ...core },
  { slot: 'dress', id: 'ballgown', bodies: ['f', 'f_ballgown'], label: 'Ballgown', desc: "Eleanor's: bateau neck, cap sleeves, a full skirt.", colours: ['main'], ...core },
  { slot: 'dress', id: 'aline', bodies: ['f', 'f_aline'], label: 'A-line gown', desc: "Beatrice's: puff sleeves, an A-line skirt.", colours: ['main'], ...core },
  { slot: 'dress', id: 'decoBeaded', bodies: FEMALE, label: 'Deco beaded gown', desc: 'Art Deco beading and a fringed hem.', colours: ['main', 'metal'], unlock: 'boutique', ...W1B },

  // Belts (women).
  { slot: 'belt', id: 'none', bodies: FEMALE, label: 'No belt', desc: 'No belt.', draw: 'none', ...core },
  { slot: 'belt', id: 'sash', bodies: FEMALE, label: 'Sash', desc: "Clara's wide sash.", colours: ['accent'], ...core },
  { slot: 'belt', id: 'thin', bodies: FEMALE, label: 'Thin belt', desc: 'A thin metal belt.', colours: ['metal'], ...core },

  // Shoes.
  { slot: 'feet', id: 'derby', bodies: MALE, label: 'Derby shoes', desc: 'Plain black lace-ups.', ...core },
  { slot: 'feet', id: 'pumps', bodies: FEMALE, label: 'Pumps', desc: 'Low-heeled evening pumps.', ...core },

  // Extras: small pieces, at most one per attach point.
  { slot: 'extra', id: 'goldDrop', bodies: FEMALE, label: 'Gold drops', desc: "Clara's gold drop earrings.", attach: 'ears', colours: ['metal'], ...core },
  { slot: 'extra', id: 'pearlStud', bodies: FEMALE, label: 'Pearl studs', desc: "Eleanor's pearl studs.", attach: 'ears', ...core },
  { slot: 'extra', id: 'goldBall', bodies: FEMALE, label: 'Gold balls', desc: "Beatrice's gold ball earrings.", attach: 'ears', colours: ['metal'], ...core },
  { slot: 'extra', id: 'lantern', bodies: BOTH, label: { m: 'Lantern fob', f: 'Lantern charm' },
    desc: { m: 'A watch chain with a small brass lantern.', f: 'A small brass lantern on a fine chain.' }, attach: { m: 'waist', f: 'neck' },
    colours: ['metal'], unlock: 'achievement', achievement: 'savedByTheLight', ...W1B },
  { slot: 'extra', id: 'eveningGloves', bodies: BOTH, label: { m: 'Dress gloves', f: 'Opera gloves' },
    desc: { m: 'White evening gloves.', f: 'Long white gloves to the elbow.' }, attach: 'hands', unlock: 'achievement', achievement: 'goodCompany', ...W1B },
  { slot: 'extra', id: 'blackOrchid', bodies: BOTH, label: 'Black orchid', desc: { m: 'A dark orchid buttonhole.', f: 'A dark orchid corsage.' },
    attach: 'chest', unlock: 'achievement', achievement: 'darkHorse', ...W1B },

  // ---- Colours ----
  // Skin tones (8, light to deep). lips: the lip colour that goes with it (colours.lips 'natural').
  { slot: 'skin', id: 'porcelain', label: 'Porcelain', value: '#ffd2b4', lips: '#c4566a' },
  { slot: 'skin', id: 'fair', label: 'Fair', value: '#fcc49a', lips: '#b8546a' },
  { slot: 'skin', id: 'rosy', label: 'Rosy', value: '#ffb08a', lips: '#b04c62' },
  { slot: 'skin', id: 'golden', label: 'Golden', value: '#eaa06a', lips: '#9e4658' },
  { slot: 'skin', id: 'tan', label: 'Tan', value: '#d6895c', lips: '#86404f' },
  { slot: 'skin', id: 'bronze', label: 'Bronze', value: '#b06c44', lips: '#6e3442' },
  { slot: 'skin', id: 'brown', label: 'Brown', value: '#8a5234', lips: '#5a2c36' },
  { slot: 'skin', id: 'deep', label: 'Deep', value: '#643a26', lips: '#46222a' },
  // Hair colours. brow: the brows and moustaches, a little darker.
  { slot: 'hair', id: 'black', label: 'Black', value: '#3c3a42', brow: '#1c1a1c' },
  { slot: 'hair', id: 'darkBrown', label: 'Dark brown', value: '#5a4a44', brow: '#2e201a' },
  { slot: 'hair', id: 'brown', label: 'Brown', value: '#8a6a5a', brow: '#3a2a20' },
  { slot: 'hair', id: 'auburn', label: 'Auburn', value: '#7a4a44', brow: '#3a221c' },
  { slot: 'hair', id: 'copper', label: 'Copper', value: '#a85a38', brow: '#5a2e1c' },
  { slot: 'hair', id: 'blonde', label: 'Blonde', value: '#d0a868', brow: '#7a5a34' },
  { slot: 'hair', id: 'silver', label: 'Silver', value: '#9aa0b2', brow: '#8e868a' },
  { slot: 'hair', id: 'platinum', label: 'Platinum', value: '#efe6d2', brow: '#a89a84', unlock: 'achievement', achievement: null },
  // Eye colours. 'classic' = the models' own black eyes; the others paint an iris (dark rim, colour, brighter low in
  // the middle) with the possessed eyes' shader. Red, pink, violet and amber are never offered: red eyes mean
  // possessed. nearRed: what red-green colour-blind players can confuse with that red (the "Clearer possessed eyes"
  // setting shows them as classic eyes in a match: displayAvatar).
  { slot: 'eyes', id: 'classic', label: 'Classic', value: null },
  { slot: 'eyes', id: 'brownEyes', label: 'Brown', value: ['#140b06', '#24150c', '#553420'], nearRed: true },
  { slot: 'eyes', id: 'hazel', label: 'Hazel', value: ['#161408', '#2c2a12', '#6e6a2e'], nearRed: true },
  { slot: 'eyes', id: 'green', label: 'Green', value: ['#0a1610', '#123222', '#2e7a4e'] },
  { slot: 'eyes', id: 'blue', label: 'Blue', value: ['#0a1222', '#142a4c', '#3a6eb0'] },
  { slot: 'eyes', id: 'grey', label: 'Grey', value: ['#121416', '#2a2e34', '#6a737e'] },
  // Frame colours (the glasses).
  { slot: 'frame', id: 'tortoise', label: 'Tortoiseshell', value: '#3a2218' },
  { slot: 'frame', id: 'jet', label: 'Black', value: '#141416' },
  { slot: 'frame', id: 'silverFrame', label: 'Silver', value: '#b8bcc4' },
  { slot: 'frame', id: 'goldFrame', label: 'Gold', value: '#d6aa55', unlock: 'boutique' },
  // The outfit's main colour (jacket and trousers, or the dress).
  { slot: 'main', id: 'midnight', label: 'Midnight', value: '#36436a' },
  { slot: 'main', id: 'black', label: 'Black', value: '#1c1c22' },
  { slot: 'main', id: 'charcoal', label: 'Charcoal', value: '#4a4a52' },
  { slot: 'main', id: 'ivory', label: 'Ivory', value: '#fbe7d3' },
  { slot: 'main', id: 'claret', label: 'Claret', value: '#5a1e2c' },
  { slot: 'main', id: 'emerald', label: 'Emerald', value: '#36524f' },
  { slot: 'main', id: 'plum', label: 'Plum', value: '#4e2a4c' },
  { slot: 'main', id: 'cocoa', label: 'Cocoa', value: '#5a4032' },
  { slot: 'main', id: 'champagne', label: 'Champagne', value: '#e6cfa0', unlock: 'achievement', achievement: null },
  { slot: 'main', id: 'gatsby', label: 'Gatsby gold', value: '#c8963c', unlock: 'boutique' },
  // Accent: tie / bow tie / sash / trim.
  { slot: 'accent', id: 'black', label: 'Black', value: '#1a1a1e' },
  { slot: 'accent', id: 'claret', label: 'Claret', value: '#843c48' },
  { slot: 'accent', id: 'navy', label: 'Navy', value: '#2a3458' },
  { slot: 'accent', id: 'emerald', label: 'Emerald', value: '#2e5a46' },
  { slot: 'accent', id: 'brass', label: 'Brass', value: '#b48a46' },
  { slot: 'accent', id: 'ivory', label: 'Ivory', value: '#efe6d6' },
  // Metal (earrings, belts, chains).
  { slot: 'metal', id: 'gold', label: 'Gold', value: '#e0b060' },
  { slot: 'metal', id: 'silver', label: 'Silver', value: '#c8ccd4' },
  { slot: 'metal', id: 'roseGold', label: 'Rose gold', value: '#e0a088', unlock: 'achievement', achievement: null },
  // Lips: in W1 only the colour that goes with the skin tone.
  { slot: 'lips', id: 'natural', label: 'Natural', value: null },
];

const deepFreeze = o => {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
// Each entry completed with the contract's fields (defaults: free, a part, no colour rows, sorted as listed).
const placeIn = {};
export const ITEMS = ENTRIES.map(e => {
  const colour = COLOUR_SLOTS.includes(e.slot);
  const unlock = e.unlock || 'free';
  placeIn[e.slot] = (placeIn[e.slot] || 0) + 1;
  const { slot, id, label, desc, draw, bodies, colours, attach, unlock: _unlock, achievement, isNew, core: isCore, artPending, ...rest } = e;
  return deepFreeze({
    id, slot,
    bodies: colour ? BODY_IDS : bodies,
    label, desc: desc || '',
    draw: draw || (colour ? 'colour' : 'part'),
    unlock,
    ...(unlock === 'achievement' ? { achievement: achievement ?? null } : {}),
    colours: colours || [],
    ...(attach ? { attach } : {}),
    rarity: RARITY[unlock],
    isNew: !!isNew,
    sort: placeIn[slot] * 10,
    core: !!isCore,
    artPending: !!artPending,
    ...rest,
  });
});

// ---- Looking items up, owning them, wearing them ----------------------------------------------------------------------
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const BY_ID = new Map(ITEMS.map(it => [`${it.slot}.${it.id}`, it]));
const BY_SLOT = new Map();                 // slot -> (id -> item)
for (const it of ITEMS) { if (!BY_SLOT.has(it.slot)) BY_SLOT.set(it.slot, new Map()); BY_SLOT.get(it.slot).set(it.id, it); }
// (slot names a caller may use for the extras: the avatar's field is `extras`, an item's slot is `extra`)
const slotName = slot => (slot === 'extras' ? 'extra' : slot);
export const item = (slot, id) => (typeof id === 'string' && BY_SLOT.get(slotName(slot))?.get(id)) || null;
// An item's id across the whole catalogue (ids repeat between slots: 'brown' hair, 'brown' skin), the one a player's
// inventory and, later, a store's product list use: 'glasses.monocle'.
export const itemId = it => `${it.slot}.${it.id}`;
export const itemById = id => (typeof id === 'string' ? BY_ID.get(id) || null : null);
// Words that differ by body ('Lantern fob' / 'Lantern charm').
export const labelOf = (it, body = 'm') => (!it ? '' : typeof it.label === 'string' ? it.label : it.label[genderOf(body)] || it.label.m || '');
export const descOf = (it, body = 'm') => (!it ? '' : typeof it.desc === 'string' ? it.desc : it.desc[genderOf(body)] || it.desc.m || '');
export const attachOf = (it, body = 'm') => (!it?.attach ? null : typeof it.attach === 'string' ? it.attach : it.attach[genderOf(body)] || null);

export const isFree = it => !!it && it.unlock === 'free';
// Meant for this body (colour items fit every body).
export const fits = (it, body) => !!it && (it.draw === 'colour' || (Array.isArray(it.bodies) && it.bodies.includes(body)));

// The pieces the art has built (src/data/partsIndex.js, written by the pipeline). Tests and tools may hand in
// another index (usePartIndex); the game always uses the generated one.
let INDEX = PART_INDEX;
let indexGen = 0;
const pendingMemo = new Map();      // item -> { body: pending? } (cleared with the index)
const builtFor = body => {
  const list = INDEX?.parts?.[body];
  return Array.isArray(list) ? list : [];
};
// Not ready to show on this body: held back (artPending), or a 3D piece with no file built for that body yet (the six
// Looks' own pieces stand in while a body has nothing built at all, so nothing changes before the pipeline has run).
export function isPending(it, body) {
  if (!it) return true;
  if (it.artPending) return true;
  if (it.draw !== 'part') return false;
  let byBody = pendingMemo.get(it);
  if (!byBody) pendingMemo.set(it, byBody = {});
  if (body in byBody) return byBody[body];
  const list = builtFor(body);
  const plain = `${it.slot}_${it.id}`;
  return (byBody[body] = !list.length ? !it.core : !list.some(k => k === plain || k.startsWith(`${plain}~`)));
}
// Offered on this body (whoever owns it): meant for it, built for it, not retired.
const offered = (it, body) => fits(it, body) && !isPending(it, body) && !it.retired;

// owns(globalId): REAL ownership, from the account (free -> true; otherwise the inventory has it).
const ownsNothing = () => false;
export function canWear(it, body, owns = ownsNothing) {
  return !!it && fits(it, body) && !isPending(it, body) && (isFree(it) || UNLOCK_ALL_FOR_TESTING || !!owns(itemId(it)));
}
// The tile's small "unlocked for testing" note: wearable only because of the testing switch.
export const unlockedForTesting = (it, owns = ownsNothing) => !!it && !isFree(it) && !owns(itemId(it)) && UNLOCK_ALL_FOR_TESTING;
// Real ownership from an inventory of global ids (the account's, and a server's later): free, or in the list.
export const ownsFrom = (inventory = []) => {
  const have = new Set(Array.isArray(inventory) ? inventory : []);
  return id => { const it = itemById(id); return !!it && (isFree(it) || have.has(id)); };
};

// The bodies the art has built, plus 'm' and/or 'f' for a gender with none built yet (a gender is never changed by
// data: a saved Clara is never repaired into a man while the female art is being made). Men first.
let bodiesMemo = null;
export function availableBodies() {
  if (bodiesMemo?.gen === indexGen) return [...bodiesMemo.list];
  const out = BODY_IDS.filter(b => Array.isArray(INDEX?.bodies) && INDEX.bodies.includes(b));
  if (!out.some(b => genderOf(b) === 'm')) out.push('m');
  if (!out.some(b => genderOf(b) === 'f')) out.push('f');
  out.sort((a, b) => (genderOf(a) === genderOf(b) ? BODY_IDS.indexOf(a) - BODY_IDS.indexOf(b) : genderOf(a) === 'm' ? -1 : 1));
  bodiesMemo = { gen: indexGen, list: out };
  return [...out];
}
const bodiesOf = gender => availableBodies().filter(b => genderOf(b) === gender);

// ---- The six Looks (the classic guests: the default, suggested looks) -------------------------------------------------
// Colours = today's originals. The women's body is the first available female body their dress fits: the shared 'f',
// or (the fallback) their gown's own body.
export const LOOK_IDS = { m: ['victor', 'marcus', 'henry'], f: ['clara', 'eleanor', 'beatrice'] };
export const looksFor = gender => LOOK_IDS[gender === 'f' ? 'f' : 'm'];
export const LOOK_LABELS = { victor: 'Tuxedo', marcus: 'Suit and tie', henry: 'Dinner jacket', clara: 'Column dress', eleanor: 'Ballgown', beatrice: 'A-line gown' };
const colours = (skin, hair, main, accent, more = {}) => ({ skin, hair, eyes: 'classic', main, accent, metal: 'gold', frame: 'tortoise', lips: 'natural', ...more });
const LOOK_PIECES = {
  victor: { body: 'm', face: 'victor', hairStyle: 'swept', facial: 'handlebar', glasses: 'none', top: 'tux', neck: 'bow', legs: 'trousers', feet: 'derby', extras: [], colours: colours('fair', 'black', 'midnight', 'black') },
  marcus: { body: 'm', face: 'marcus', hairStyle: 'sideSwept', facial: 'none', glasses: 'none', top: 'lounge', neck: 'tie', legs: 'trousers', feet: 'derby', extras: [], colours: colours('tan', 'black', 'midnight', 'claret') },
  henry: { body: 'm', face: 'henry', hairStyle: 'quiff', facial: 'none', glasses: 'round', top: 'dinner', neck: 'bowFull', legs: 'blackTrousers', feet: 'derby', extras: [], colours: colours('rosy', 'silver', 'ivory', 'black') },
  clara: { face: 'clara', hairStyle: 'waves', makeup: 'none', glasses: 'none', dress: 'column', belt: 'sash', feet: 'pumps', extras: ['goldDrop'], colours: colours('rosy', 'auburn', 'claret', 'claret') },
  eleanor: { face: 'eleanor', hairStyle: 'chignon', makeup: 'none', glasses: 'none', dress: 'ballgown', belt: 'thin', feet: 'pumps', extras: ['pearlStud'], colours: colours('rosy', 'brown', 'midnight', 'black') },
  beatrice: { face: 'beatrice', hairStyle: 'wavyBob', makeup: 'none', glasses: 'none', dress: 'aline', belt: 'thin', feet: 'pumps', extras: ['goldBall'], colours: colours('tan', 'darkBrown', 'emerald', 'black') },
};
// (in the avatar's own field order)
function shaped(body, src) {
  const out = { v: 2, body };
  for (const s of SLOTS_BY_GENDER[genderOf(body)]) out[s] = src[s];
  out.extras = src.extras ? src.extras.slice() : [];
  const c = src.colours || {};
  out.colours = {};
  for (const s of COLOUR_SLOTS) out.colours[s] = c[s];
  return out;
}
const femaleBodyFor = dress => {
  const it = item('dress', dress), list = bodiesOf('f');
  return list.find(b => offered(it, b)) || list.find(b => fits(it, b)) || list[0];
};
export const LOOKS = {};
function refreshLooks() {
  for (const [id, p] of Object.entries(LOOK_PIECES)) LOOKS[id] = deepFreeze(shaped(p.body || femaleBodyFor(p.dress), p));
}
refreshLooks();
const LOOK_ORDER = [...LOOK_IDS.m, ...LOOK_IDS.f];

// A body's default for a slot: that slot's piece in the first Look of its gender that is available on that body.
const defaultMemo = new Map();
function slotDefault(body, slot) {
  const memo = `${indexGen}|${body}|${slot}`;
  if (defaultMemo.has(memo)) return defaultMemo.get(memo);
  const looks = looksFor(genderOf(body)).map(id => LOOK_PIECES[id]);
  let id = looks.map(L => L[slot]).find(v => offered(item(slot, v), body));
  if (id === undefined) id = ITEMS.find(it => it.slot === slot && offered(it, body))?.id;
  if (id === undefined) id = looks[0][slot];
  defaultMemo.set(memo, id);
  return id;
}
const firstLookOf = body => LOOK_PIECES[looksFor(genderOf(body))[0]];

// ---- Making an avatar safe --------------------------------------------------------------------------------------------
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const isV1 = av => isObj(av) && (Object.prototype.hasOwnProperty.call(av, 'base') || !(Number(av.v) >= 2));
const V1_COLOURS = ['skin', 'hair', 'eyes', 'main', 'accent', 'metal', 'frame'];

// A v1 avatar as the Look it was (lossless): the base's Look, the v1 glasses and colours, lips natural. A value v1
// would not have shown (unknown, or locked and not owned) keeps the Look's own, as v1 did.
export function avatarFromV1(v1, opts = {}) {
  const src = isObj(v1) ? v1 : {};
  const look = LOOKS[own(LOOKS, src.base) ? src.base : 'victor'];
  const out = shaped(look.body, look);
  const takes = it => !!it && (opts.trusted ? offered(it, look.body) : canWear(it, look.body, opts.owns));
  const g = item('glasses', src.glasses);
  if (takes(g)) out.glasses = g.id;
  for (const s of V1_COLOURS) { const c = item(s, src[s]); if (takes(c)) out.colours[s] = c.id; }
  out.colours.lips = 'natural';
  return normaliseAvatar(out, opts);
}

// The body a saved one stands for: an available body; else one of the same gender (the one its dress fits, else that
// gender's first); else 'm'.
function bodyFor(body, dress) {
  if (bodiesMemo?.gen !== indexGen) availableBodies();
  if (bodiesMemo.list.includes(body)) return body;
  if (typeof body !== 'string' || !BODY_RE.test(body)) return 'm';
  const same = bodiesOf(genderOf(body));
  return same.find(b => offered(item('dress', dress), b)) || same[0] || 'm';
}

// The triangles of a worn guest (the pieces in the index, plus code-drawn glasses).
function trisOf(av) {
  const tris = INDEX?.tris || {};
  if (!builtFor(av.body).length) return 0;
  const k = partKeysFor(av);
  let n = tris[k.body] || 0;
  for (const p of k.parts) n += tris[p] || 0;
  if (k.glasses) n += item('glasses', av.glasses)?.tris || 0;
  return n;
}

// Any saved or received avatar made safe (repairs, never rejects, never throws): a missing, unknown, pending or
// not-owned value falls back to the body's default, so a damaged save, an old version or a locked item never reaches
// the screen. `owns(globalId)`: real ownership (the account's). `trusted: true` skips the ownership part only (an
// avatar already checked when it was saved or rolled: the table's seats, the bots).
export function normaliseAvatar(av, { owns = ownsNothing, trusted = false } = {}) {
  if (isV1(av)) return avatarFromV1(av, { owns, trusted });
  const src = isObj(av) ? av : {};
  const body = bodyFor(src.body, src.dress);
  const wearable = it => (trusted ? offered(it, body) : canWear(it, body, owns) && !it.retired);
  const out = { v: 2, body };
  for (const slot of SLOTS_BY_GENDER[genderOf(body)]) {
    const it = item(slot, src[slot]);
    out[slot] = it && wearable(it) ? it.id : slotDefault(body, slot);
  }
  // extras: known, fitting, wearable, once each, one per attach point (the later one goes), in ATTACH order
  const taken = new Set(), points = new Set(), extras = [];
  for (const id of Array.isArray(src.extras) ? src.extras : []) {
    const it = item('extra', id);
    if (!it || taken.has(it.id) || !wearable(it)) continue;
    const at = attachOf(it, body);
    if (!at || points.has(at)) continue;
    taken.add(it.id); points.add(at); extras.push(it);
  }
  extras.sort((a, b) => ATTACH.indexOf(attachOf(a, body)) - ATTACH.indexOf(attachOf(b, body)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  out.extras = extras.map(it => it.id);
  const fallback = firstLookOf(body).colours;
  const given = isObj(src.colours) ? src.colours : {};
  out.colours = {};
  for (const s of COLOUR_SLOTS) {
    const it = item(s, given[s]);
    out.colours[s] = it && wearable(it) ? it.id : fallback[s];
  }
  out.colours.lips = 'natural';            // (W1: the lip colour that goes with the skin tone)
  while (trisOf(out) > TRIANGLE_CAP && (out.extras.length || out.glasses !== 'none')) {
    if (out.extras.length) out.extras.pop(); else out.glasses = 'none';
  }
  return out;
}

// ---- Keys (caches: portraits, soul faces, character views, merged geometry) -------------------------------------------
const asV2 = av => (isObj(av) && !isV1(av) ? av : normaliseAvatar(av));
const pieces = av => `${KEY_SLOTS.map(s => av[s] ?? '').join('|')}|${(av.extras || []).join('+')}`;
// Every piece and every colour: LOOKS.victor ->
// 'v2|m|victor|swept|handlebar||none|tux|bow|trousers|||derby||fair|black|classic|midnight|black|gold|tortoise|natural'
export const avatarKey = av => { const a = asV2(av); return `v2|${pieces(a)}|${COLOUR_SLOTS.map(s => a.colours?.[s] ?? '').join('|')}`; };
// The pieces only: the same key = the same merged geometry (a colour change only repaints).
export const geometryKey = av => `g2|${pieces(asV2(av))}`;
// The portrait framing cache.
export const frameKey = av => { const a = asV2(av); return `${a.body}|${a.face}|${a.hairStyle}`; };

// ---- The wardrobe's helpers -------------------------------------------------------------------------------------------
// Wear one item (a piece, an extra or a colour). An extra toggles, replacing any at its attach point; a dress that fits
// another body of the same gender switches body; the rest is kept where it fits.
export function withItem(av, slot, id, opts = {}) {
  const cur = normaliseAvatar(av, opts);
  if (COLOUR_SLOTS.includes(slot)) return normaliseAvatar({ ...cur, colours: { ...cur.colours, [slot]: id } }, opts);
  const it = item(slot, id);
  if (!it) return cur;
  if (it.slot === 'extra') {
    if (cur.extras.includes(it.id)) return normaliseAvatar({ ...cur, extras: cur.extras.filter(x => x !== it.id) }, opts);
    const at = attachOf(it, cur.body);
    const rest = cur.extras.filter(x => attachOf(item('extra', x), cur.body) !== at);
    return normaliseAvatar({ ...cur, extras: [...rest, it.id] }, opts);
  }
  const next = { ...cur, [it.slot]: it.id };
  if (it.slot === 'dress' && !offered(it, cur.body)) {
    const other = bodiesOf(genderOf(cur.body)).find(b => offered(it, b));
    if (other) next.body = other;
  }
  return normaliseAvatar(next, opts);
}
// The Look whose face this is (the faces are named after the Looks).
const lookOfFace = av => (own(LOOKS, av?.face) ? av.face : null);
// The other gender: the Look at the same place (victor <-> clara, marcus <-> eleanor, henry <-> beatrice), keeping the
// colours and the glasses.
export function withBody(av, gender, opts = {}) {
  const cur = normaliseAvatar(av, opts);
  const from = genderOf(cur.body), to = gender === 'f' ? 'f' : 'm';
  if (from === to) return cur;
  const at = Math.max(0, looksFor(from).indexOf(lookOfFace(cur)));
  const look = LOOKS[looksFor(to)[at]];
  return normaliseAvatar({ ...shaped(look.body, look), glasses: cur.glasses, colours: { ...cur.colours } }, opts);
}
// A classic Look's pieces (and its colours too, unless keepColours).
export function applyLook(av, lookId, { keepColours = false, ...opts } = {}) {
  const look = LOOKS[own(LOOKS, lookId) ? lookId : 'victor'];
  const cur = av ? normaliseAvatar(av, opts) : null;
  return normaliseAvatar({ ...shaped(look.body, look), colours: { ...(keepColours && cur ? cur.colours : look.colours) } }, opts);
}
// The classic Look an avatar is (every piece the same, the glasses and colours aside), or null for a mix of pieces.
export function lookOf(av) {
  const a = asV2(av);
  return LOOK_ORDER.find(id => {
    const L = LOOKS[id];
    return L.body === a.body && SLOTS_BY_GENDER[genderOf(a.body)].every(s => s === 'glasses' || L[s] === a[s])
      && L.extras.join('+') === (a.extras || []).join('+');
  }) || null;
}
// The items of a slot offered on a body (whoever owns them; pending and retired ones never), in their order.
export const itemsFor = (slot, body = null) => ITEMS
  .filter(it => it.slot === slotName(slot) && (body ? offered(it, body) : !it.artPending && !it.retired))
  .sort((a, b) => a.sort - b.sort);
// The wardrobe's rows for an avatar: its gender's piece slots and the extras, then the colour rows its pieces use
// (Frame only while glasses with a frame colour are on; Accent only with a tie, bow tie, sash or trim; Jewellery only
// with something metal; Lips only once there is more than one choice).
export function slotsFor(av) {
  const a = asV2(av);
  const worn = [...SLOTS_BY_GENDER[genderOf(a.body)].map(s => item(s, a[s])), ...(a.extras || []).map(id => item('extra', id))].filter(Boolean);
  const painted = new Set(worn.flatMap(it => it.colours));
  return [...SLOTS_BY_GENDER[genderOf(a.body)], 'extras',
    ...COLOUR_SLOTS.filter(s => (s === 'lips' ? itemsFor('lips').length > 1 : painted.has(s)))];
}

// ---- What the game reads ----------------------------------------------------------------------------------------------
// The sRGB hex of the palette's direct entries (the renderer converts to linear and derives `lapel` and `shade`).
export function paletteHex(av) {
  const a = asV2(av), c = a.colours || {};
  const skin = item('skin', c.skin), hair = item('hair', c.hair), lips = item('lips', c.lips), glasses = item('glasses', a.glasses);
  return {
    skin: skin?.value ?? null,
    lips: lips?.value || skin?.lips || null,
    hair: hair?.value ?? null,
    brow: hair?.brow ?? null,
    main: item('main', c.main)?.value ?? null,
    accent: item('accent', c.accent)?.value ?? null,
    metal: item('metal', c.metal)?.value ?? null,
    frame: glasses?.frameHex || item('frame', c.frame)?.value || null,
  };
}

// The files a guest is assembled from (src/render/avatarParts.js). A worn piece resolves to its first variant (in
// sorted key order) fitted to a piece that is worn, else its plain file, else (extras only) nothing. Items drawn by
// code or 'none' give no file.
export function partKeysFor(av) {
  const a = asV2(av), body = a.body;
  const list = builtFor(body);
  const wears = (slot, id) => (slot === 'extra' ? (a.extras || []).includes(id) : a[slot] === id);
  const resolve = it => {
    const plain = `${it.slot}_${it.id}`;
    for (const k of list.filter(x => x.startsWith(`${plain}~`)).sort()) {
      const fit = k.slice(plain.length + 1), cut = fit.indexOf('_');
      if (cut > 0 && wears(fit.slice(0, cut), fit.slice(cut + 1))) return `${body}/${k}`;
    }
    if (it.slot !== 'extra' || list.includes(plain) || (!list.length && it.core)) return `${body}/${plain}`;
    return null;
  };
  const parts = [];
  let faceKey = null;
  for (const slot of KEY_SLOTS) {
    if (slot === 'body') continue;
    const it = item(slot, a[slot]);
    if (!it || it.draw !== 'part') continue;
    const k = resolve(it);
    if (!k) continue;
    if (slot === 'face') faceKey = k;
    parts.push(k);
  }
  for (const id of a.extras || []) { const it = item('extra', id); const k = it && it.draw === 'part' ? resolve(it) : null; if (k) parts.push(k); }
  const g = item('glasses', a.glasses);
  const style = g?.draw === 'code' ? g.value : null;
  const ownFrames = !!faceKey && !!style && INDEX?.builtInGlasses?.[faceKey] === style;
  return { body: `${body}/body`, parts, eyesFrom: faceKey, glasses: ownFrames ? null : style, builtInGlasses: ownFrames ? faceKey : null };
}

// The avatar as THIS device shows it in a match: with "Clearer possessed eyes" on, eye colours a red-green
// colour-blind player can confuse with the possessed red (nearRed: brown, hazel) show as classic dark eyes. The
// possessed red itself never changes; the wardrobe and the profile keep the true colour.
export function displayAvatar(av, { clearEyes = false } = {}) {
  if (!clearEyes || !isObj(av)) return av;
  if (!item('eyes', av.colours?.eyes)?.nearRed) return av;
  return { ...av, extras: [...(av.extras || [])], colours: { ...av.colours, eyes: 'classic' } };
}

// Two guests look alike: same body, same hairstyle, same jacket (or dress) and main colours closer than delta-E 20
// (CIELAB), in normal vision or as a protan, deutan or tritan colour-blind player sees them (the Machado
// simulations, severity 1). Never two guests alike at one table.
const SIM = {   // Machado, Oliveira and Fernandes 2009, severity 1.0, applied to linear RGB
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const ALIKE_DELTA_E = 20;
const labMemo = new Map();
function labOf(hex, kind) {
  const key = `${hex}|${kind}`;
  if (labMemo.has(key)) return labMemo.get(key);
  const lin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  let l = [1, 3, 5].map(i => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  if (SIM[kind]) l = SIM[kind].map(r => Math.min(1, Math.max(0, r[0] * l[0] + r[1] * l[1] + r[2] * l[2])));
  const X = 0.4124564 * l[0] + 0.3575761 * l[1] + 0.1804375 * l[2];
  const Y = 0.2126729 * l[0] + 0.7151522 * l[1] + 0.0721750 * l[2];
  const Z = 0.0193339 * l[0] + 0.1191920 * l[1] + 0.9503041 * l[2];
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X / 0.95047), fy = f(Y), fz = f(Z / 1.08883);
  const out = [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  labMemo.set(key, out);
  return out;
}
export function coloursClose(hexA, hexB, limit = ALIKE_DELTA_E) {
  if (!hexA || !hexB) return hexA === hexB;
  return ['normal', ...Object.keys(SIM)].some(kind => {
    const p = labOf(hexA, kind), q = labOf(hexB, kind);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < limit;
  });
}
export function lookAlike(a, b) {
  if (!isObj(a) || !isObj(b)) return false;
  const A = asV2(a), B = asV2(b);
  if (A.body !== B.body || A.hairStyle !== B.hairStyle) return false;
  const outfit = genderOf(A.body) === 'f' ? 'dress' : 'top';
  if (A[outfit] !== B[outfit]) return false;
  return coloursClose(item('main', A.colours?.main)?.value, item('main', B.colours?.main)?.value);
}

// The eyes always show (red eyes are how possessed players recognise each other): an eye colour that is not red, pink,
// violet or amber, frames with no lens, only pieces that are in the game, and no piece file below the pipeline's
// red-eye test (piecesShowEyes). Not every built piece passes that test: three women's hair files do not (the Wavy
// bob on Clara's and on Eleanor's face, the chignon on Beatrice's), and neither do today's code-drawn glasses.
const hsv = hex => {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  const h = !d ? 0 : max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { r, g, b, h: (h + 360) % 360, s: max ? d / max : 0, v: max };
};
export function eyeColourSafe(it) {
  if (!it || it.slot !== 'eyes') return false;
  if (it.value == null) return true;                 // (classic: the models' own black eyes)
  return it.value.every(hex => {
    const c = hsv(hex);
    const red = c.r > 2 * c.g && c.r > 2 * c.b;
    const pinkOrViolet = c.b > 1.3 * c.g && c.r > 1.3 * c.g;
    const amber = c.h >= 20 && c.h <= 55 && c.v > 0.55 && c.s > 0.5;
    return !red && !pinkOrViolet && !amber;
  });
}
export function eyesShow(av) {
  if (!isObj(av)) return false;
  const a = asV2(av);
  if (!eyeColourSafe(item('eyes', a.colours?.eyes))) return false;
  const g = item('glasses', a.glasses);
  if (!g || g.lens) return false;
  const worn = [...SLOTS_BY_GENDER[genderOf(a.body)].map(s => item(s, a[s])), ...(a.extras || []).map(id => item('extra', id))];
  return worn.every(it => it && offered(it, a.body)) && piecesShowEyes(a);
}
// The pipeline's red-eye test (contract 9.3: at least 90 % of the possessed red still shows from the game camera; its
// result per piece file is in src/data/partsIndex.js `redEye`). A file below it is kept off the guests the game dresses
// itself (bots, a new player's first look), unless it is a classic Look's own piece: that is today's guest unchanged
// (Beatrice's own bob scores 0.756, as today). So until the lead and the owner decide on the side-view rule, the Wavy
// bob stays off Clara's and Eleanor's faces and the chignon off Beatrice's. Glasses are code-drawn: not scored here.
export const RED_EYE_GATE = 0.9;
let lookKeysMemo = null;
function lookPartKeys() {
  if (lookKeysMemo?.gen !== indexGen) lookKeysMemo = { gen: indexGen, keys: new Set(LOOK_ORDER.flatMap(id => partKeysFor(LOOKS[id]).parts)) };
  return lookKeysMemo.keys;
}
export function piecesShowEyes(av) {
  const scores = INDEX?.redEye;
  if (!isObj(scores)) return true;
  return partKeysFor(av).parts.every(k => !(scores[k] < RED_EYE_GATE) || lookPartKeys().has(k));
}

// The legacy outfit id, for views still keyed by outfit (src/data/characters.js).
const OUTFIT_OF_TOP = { tux: 'tuxedo', lounge: 'suit', dinner: 'dinnerJacket' };
const OUTFIT_OF_DRESS = { column: 'dressBurgundy', ballgown: 'dressMidnight', aline: 'dressEmerald' };
export function outfitOf(av) {
  const a = asV2(av);
  return genderOf(a.body) === 'f' ? OUTFIT_OF_DRESS[a.dress] || 'dressMidnight' : OUTFIT_OF_TOP[a.top] || 'tuxedo';
}

// The picture shipped for the avatar's face (assets/portraits/<the Look whose face it is>.jpg, -possessed.jpg), shown
// until its runtime portrait is drawn (src/render/avatarPortrait.js) and where there is no renderer.
export const shippedPortraitFor = (av, possessed = false) =>
  `assets/portraits/${lookOfFace(isObj(av) && !isV1(av) ? av : normaliseAvatar(av)) || 'victor'}${possessed ? '-possessed' : ''}.jpg`;

// The avatar of last round's "Your guest" choice (the old 'guest' setting: a roster id 'p1'..'p6' or a name), so an
// old player's first avatar is the guest they chose; null for 'random' or anything unknown.
const GUEST_LOOKS = { p1: 'victor', p2: 'eleanor', p3: 'marcus', p4: 'beatrice', p5: 'henry', p6: 'clara' };
export function avatarFromGuest(guest) {
  if (guest == null) return null;
  const v = String(guest).trim().toLowerCase();
  const id = own(GUEST_LOOKS, v) ? GUEST_LOOKS[v] : own(LOOKS, v) ? v : null;
  return id ? normaliseAvatar(LOOKS[id]) : null;
}

// The look anyone without a profile wears (a direct link with no saved profile, a damaged save).
export const DEFAULT_AVATAR = deepFreeze(shaped('m', LOOK_PIECES.victor));

// (tests and tools only) Use another parts index: the bodies and pieces "built". The game uses the generated one.
export function usePartIndex(index = PART_INDEX) {
  INDEX = index || { v: 1, bodies: [], parts: {}, tris: {}, builtInGlasses: {} };
  indexGen++;
  pendingMemo.clear(); defaultMemo.clear();
  refreshLooks();
}

// ---- LEGACY (temporary: for the code not yet switched to v2; the lead removes these at integration) ------------------
// The six v1 looks and their models, as the v1 renderer reads them (src/render/avatar.js, characterView.js).
export const BASES = {
  victor: { label: 'Tuxedo', body: 'm', model: 'assets/characters/victor.glb', accentLabel: 'Bow tie',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow', 'Stache'], main: ['Jacket', 'Trouser'], accent: ['Tie'] },
    derive: { Lapel: { from: 'main', mul: 0.62 }, Shade: { from: 'main', dark: true } },
    original: { skin: 'fair', hair: 'black', main: 'midnight', accent: 'black' } },
  marcus: { label: 'Suit and tie', body: 'm', model: 'assets/characters/marcus.glb', accentLabel: 'Tie',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], main: ['Jacket', 'Trouser'], accent: ['Tie'] },
    derive: { Shade: { from: 'main', dark: true } },
    original: { skin: 'tan', hair: 'black', main: 'midnight', accent: 'claret' } },
  henry: { label: 'Dinner jacket', body: 'm', model: 'assets/characters/henry.glb', accentLabel: 'Bow tie',
    parts: { skin: ['Skin'], hair: ['Hair'], brow: ['Brow'], main: ['Jacket'], accent: ['Tie'] },
    derive: { Shade: { from: 'main', dark: true } },
    builtInGlasses: 'Glasses',
    original: { skin: 'rosy', hair: 'silver', main: 'ivory', accent: 'black', glasses: 'round', frame: 'tortoise' } },
  clara: { label: 'Column dress', body: 'f', model: 'assets/characters/clara.glb', accentLabel: 'Sash',
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
export const isBase = b => own(BASES, b);
export const shippedPortrait = (base, possessed = false) =>
  `assets/portraits/${isBase(base) ? base : 'victor'}${possessed ? '-possessed' : ''}.jpg`;
