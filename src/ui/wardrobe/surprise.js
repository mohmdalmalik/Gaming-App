// "Surprise me" (the wardrobe's dice): a new mix of pieces and colours from what the player OWNS (free items and the
// ones in their inventory: never an item they would have to take off again, whatever the testing switch says), and
// only a look whose eyes show (src/data/wardrobe.js eyesShow: the possessed red must always be visible). Pure (no DOM,
// no three.js): tests/browser-wardrobe.mjs runs it in Node as well as on the screen.
//
//   surprise(avatar, area, { owns, rng })  -> a new avatar (normalised), different from the one given when possible
// `area`: the area open on the screen: only its own pieces and colours change ('hair': the hairstyle and the hair
// colour; 'outfit': the clothes and their colours...). 'body' and 'looks' change the whole look (every piece, the
// clothes' colours, glasses now and then, an extra now and then) but never the body or the skin tone: those are the
// player's own. The eye colour changes only in the Face area.
import { SLOTS_BY_GENDER, genderOf, itemsFor, item, itemId, canWear, isFree, normaliseAvatar, eyesShow, attachOf,
  avatarKey, coloursClose } from '../../data/wardrobe.js';

const AREA_SLOTS = {
  face: ['face', 'eyes'], hair: ['hairStyle', 'hair'], moustache: ['facial'], makeup: ['makeup'],
  eyewear: ['glasses', 'frame'], outfit: ['top', 'neck', 'legs', 'dress', 'belt', 'feet', 'main', 'accent'],
  extras: ['extra', 'metal'],
};
const WHOLE = ['hairStyle', 'facial', 'makeup', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'hair', 'main', 'accent', 'metal', 'glasses', 'frame', 'extra'];
// (colour ids the dice leans towards: the usual hair colours, a dark suit more often than a light one)
const WEIGHT = { hair: { black: 3, darkBrown: 3, brown: 3, auburn: 2, copper: 1.2, blonde: 2, silver: 1.2 }, main: { ivory: 0.6 } };

export const slotsOfArea = area => (AREA_SLOTS[area] || WHOLE);

export function surprise(av, area, { owns = () => false, rng = Math.random, tries = 16 } = {}) {
  const start = normaliseAvatar(av, { owns: () => true });
  const body = start.body, gender = genderOf(body);
  const mine = it => !!it && canWear(it, body, owns) && (isFree(it) || !!owns(itemId(it)));
  const pick = (list, weights = {}) => {
    const total = list.reduce((s, it) => s + (weights[it.id] ?? 1), 0);
    let x = rng() * total;
    for (const it of list) { if ((x -= weights[it.id] ?? 1) < 0) return it; }
    return list[list.length - 1];
  };
  const whole = !AREA_SLOTS[area];
  const slots = slotsOfArea(area).filter(s => s === 'extra' || s === 'eyes' || ['hair', 'main', 'accent', 'metal', 'frame', 'skin'].includes(s)
    || SLOTS_BY_GENDER[gender].includes(s));
  const startKey = avatarKey(start);
  let best = start;
  for (let n = 0; n < tries; n++) {
    const next = { ...start, colours: { ...start.colours }, extras: [...start.extras] };
    for (const slot of slots) {
      if (slot === 'extra') {
        // (the whole look: an extra now and then; the Extras area: a new one, or none)
        if (whole && rng() > 0.35) continue;
        const list = itemsFor('extra', body).filter(mine);
        next.extras = [];
        if (list.length && (!whole || rng() < 0.7)) next.extras = [pick(list).id];
        continue;
      }
      if (slot === 'glasses' && whole && rng() > 0.3) { next.glasses = 'none'; continue; }
      const list = itemsFor(slot, body).filter(mine);
      if (!list.length) continue;
      const it = pick(list, WEIGHT[slot]);
      if (['hair', 'main', 'accent', 'metal', 'frame', 'eyes'].includes(slot)) next.colours[slot] = it.id;
      else next[slot] = it.id;
    }
    // colours that go together: an accent never (almost) the cloth's own colour
    if (slots.includes('accent')) {
      const main = item('main', next.colours.main)?.value;
      const accents = itemsFor('accent', body).filter(mine).filter(it => !coloursClose(it.value, main, 12));
      if (accents.length && coloursClose(item('accent', next.colours.accent)?.value, main, 12)) next.colours.accent = pick(accents).id;
    }
    const out = normaliseAvatar(next, { owns: id => mine(itemFromId(id)) });
    // (an extra that sits where another is: the later one goes, as normaliseAvatar says; nothing else to check)
    if (!eyesShow(out)) continue;
    if (avatarKey(out) !== startKey) return out;
    best = out;
  }
  return best;
}
// (owns() takes global ids; the item behind one)
function itemFromId(id) {
  const at = typeof id === 'string' ? id.indexOf('.') : -1;
  return at > 0 ? item(id.slice(0, at), id.slice(at + 1)) : null;
}
export { attachOf };
