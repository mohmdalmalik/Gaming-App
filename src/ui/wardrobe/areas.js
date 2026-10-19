// The wardrobe screen's areas, as data (no DOM: tests read it in Node). The left rail is these areas, in this order;
// each area's options come from the catalogue (src/data/wardrobe.js) by slot, in tabs (at most four) and, inside a
// tab, sections (a heading row in the grid). A tab may have a colour row above its tiles: the colour that paints what
// the tab shows (the hair colour over the hairstyles, the cloth colour over the jackets...).
//
//   area   { id, label, icon, shot, gender? }   shot: the stage's camera ('close' head and shoulders, 'half' to the
//                                              knees, 'full' length; src/menu/lobbyScene.js setWardrobe)
//   tab    { id, label, short, sections: [{ slot, label }], row }   row: a colour slot, or a function of the avatar
//                                              (the belt's colour is its sash's accent or its buckle's metal)
// A slot named here that offers nothing on the body (a woman has no moustache) is simply left out; a tab left with
// nothing is left out too. 'gender' is the body choice (Man / Woman), 'look' and 'saved' are the Looks page.

export const AREAS = [
  { id: 'body', label: 'Body', icon: 'i-body', shot: 'full' },
  { id: 'face', label: 'Face', icon: 'i-face', shot: 'close' },
  { id: 'hair', label: 'Hair', icon: 'i-hair', shot: 'close' },
  { id: 'moustache', label: 'Moustache', icon: 'i-stache', shot: 'close', gender: 'm' },
  { id: 'makeup', label: 'Make-up', icon: 'i-lips', shot: 'close', gender: 'f' },
  { id: 'eyewear', label: 'Eyewear', icon: 'i-glasses', shot: 'close' },
  { id: 'outfit', label: 'Outfit', icon: 'i-outfit', shot: 'full' },
  { id: 'extras', label: 'Extras', icon: 'i-extras', shot: 'half' },
  { id: 'looks', label: 'Looks', icon: 'i-looks', shot: 'full' },
];
export const areasFor = gender => AREAS.filter(a => !a.gender || a.gender === gender);
export const areaById = id => AREAS.find(a => a.id === id) || null;

// The belt's colour row follows what paints the belt worn (the sash: accent; the thin belt: metal).
const beltRow = (av, it) => (it?.colours?.includes('accent') ? 'accent' : it?.colours?.includes('metal') ? 'metal' : null);

const TABS = {
  body: { m: [{ id: 'body', label: 'Body', sections: [{ slot: 'gender', label: 'Body' }, { slot: 'skin', label: 'Skin tone' }] }] },
  face: { m: [{ id: 'face', label: 'Faces', sections: [{ slot: 'face', label: 'Face' }, { slot: 'eyes', label: 'Eye colour' }] }] },
  hair: { m: [{ id: 'hairStyle', label: 'Styles', sections: [{ slot: 'hairStyle' }], row: 'hair' },
              { id: 'hair', label: 'Colours', sections: [{ slot: 'hair' }] }] },
  moustache: { m: [{ id: 'facial', label: 'Moustache', sections: [{ slot: 'facial' }], row: 'hair', rowLabel: 'Colour · with your hair' }] },
  makeup: { f: [{ id: 'makeup', label: 'Make-up', sections: [{ slot: 'makeup', label: 'Make-up' }, { slot: 'lips', label: 'Lips' }] }] },
  eyewear: { m: [{ id: 'glasses', label: 'Glasses', sections: [{ slot: 'glasses' }], row: 'frame' }] },
  outfit: {
    m: [
      { id: 'top', label: 'Jackets', short: 'Jackets', sections: [{ slot: 'top' }], row: 'main' },
      { id: 'neck', label: 'Neckwear', short: 'Ties', sections: [{ slot: 'neck' }], row: 'accent' },
      { id: 'legs', label: 'Trousers', short: 'Trousers', sections: [{ slot: 'legs', label: 'Trousers' }, { slot: 'feet', label: 'Shoes' }], row: 'main' },
      { id: 'colours', label: 'Colours', short: 'Colours', sections: [{ slot: 'main', label: 'Cloth' }, { slot: 'accent', label: 'Accent' }] },
    ],
    f: [
      { id: 'dress', label: 'Gowns', sections: [{ slot: 'dress' }], row: 'main' },
      { id: 'belt', label: 'Belts', sections: [{ slot: 'belt' }], row: beltRow },
      { id: 'feet', label: 'Shoes', sections: [{ slot: 'feet' }] },
      { id: 'colours', label: 'Colours', sections: [{ slot: 'main', label: 'Cloth' }, { slot: 'accent', label: 'Accent' }] },
    ],
  },
  extras: { m: [{ id: 'extras', label: 'Extras', sections: [{ slot: 'extra' }], row: 'metal', rowLabel: 'Metal' }] },
  looks: { m: [{ id: 'looks', label: 'Looks', sections: [{ slot: 'saved', label: 'Your looks' }, { slot: 'look', label: 'The classic guests' }] }] },
};
// The tabs of an area for a gender (an area with one table for both lists it under 'm').
export const tabsFor = (areaId, gender) => (TABS[areaId]?.[gender] || TABS[areaId]?.m || []);

// The extras are grouped by where they sit (src/data/wardrobe.js ATTACH), under these headings.
export const ATTACH_LABELS = {
  ears: 'Earrings', neck: { m: 'At the neck', f: 'Necklace' }, chest: { m: 'Buttonhole', f: 'Corsage' }, waist: 'Watch chain', hands: 'Gloves',
};
// The colour rows' words.
export const ROW_LABELS = {
  skin: 'Skin tone', hair: 'Hair colour', eyes: 'Eyes', frame: 'Frame', main: 'Cloth colour', accent: 'Accent', metal: 'Metal', lips: 'Lips',
};

// The sound of a choice (cues of src/audio/sounds.js; a tile says it with data-sfx, so the click sound is not added):
// a snip for hair and moustaches, a rustle for clothes, a clink for glasses and jewellery, a tick for a colour, the
// mirror's chime for an item tried on that is not yours yet, the lift bell when the look is saved.
export const WARDROBE_CUES = {
  hairStyle: 'snip', facial: 'snip', face: 'select', makeup: 'select', gender: 'select',
  top: 'rustle', neck: 'rustle', legs: 'rustle', dress: 'rustle', belt: 'rustle', feet: 'rustle',
  glasses: 'clink', extra: 'clink',
  colour: 'tick', look: 'tradeSwap', area: 'select', tab: 'select',
  tryOn: 'mirror', save: 'liftDing', surprise: 'cardFlip', undo: 'click',
};

// How each achievement's progress reads on a tile ("2 of 3 Lanterns"); a goal of one reads "Not earned yet".
// (short enough for a tile: the card and the Honours page say the whole task)
export const PROGRESS_WORDS = {
  lamplighter: { one: 'Lantern', many: 'Lanterns' },
  goodCompany: { one: 'clean win', many: 'clean wins' },
  darkHorse: { one: 'win', many: 'wins' },
};
export function progressText(ach, p) {
  if (!ach) return 'A later honour';
  if (p?.earned) return 'Earned';
  const words = PROGRESS_WORDS[ach.id];
  if (!words || ach.goal <= 1) return 'Not earned yet';
  return `${Math.min(p?.have || 0, ach.goal)} of ${ach.goal} ${ach.goal === 1 ? words.one : words.many}`;
}
