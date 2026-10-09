// WHO THE COMPUTER GUESTS ARE: a username and a playing style for each, rolled like a random online
// lobby. Pure (no DOM, no THREE, no Node APIs); deterministic for a given random generator.
//
// Most guests are "medium" players; now and then one leans bold (walks in on people, trusts less,
// attacks sooner, tries a Possession card sooner) or careful (avoids company, blocks with a Lantern
// more, heals early, builds trust longer before trying). Every trait is a number from 0 to 1, rolled
// around the style's centre, so no two guests play quite alike:
//   boldness    seeks meetings (0: walks round people; 1: walks in on them)
//   caution     hands over a Lantern to block when unsure; heals early; barricades
//   greed       searches rooms rather than exploring
//   aggression  attacks (clean: only with a reason; possessed: those who know them, or when out of cards)
//   patience    as a possessed guest, how long it builds trust before trying a Possession card
//   trust       how readily it trusts a guest who has been kind to it
//   skill       how rarely it makes a slightly-worse-than-best choice (never an illegal one)
//   pace        thinking speed: 0.7 quick … 1.4 slow (multiplies the pauses in src/bots/index.js)

const NAMES = [
  'nightowl', 'pixelmoth', 'quietfox_', 'bluekettle', 'sam', 'nora', 'theo_22', 'lumen88', 'marlowe',
  'ivy', 'kestrel', 'grumpy_otter', 'tidepool', 'jojo', 'mika_k', 'fennel', 'rook7', 'dustybooks',
  'velvetstorm', 'cobalt_cat', 'sunnyside', 'ottoman_', 'kiwi', 'alder', 'frostbyte', 'pebble', 'zed',
  'luna_m', 'hazel', 'quill', 'nomad_14', 'bramble', 'citrine', 'echo_echo', 'wrenfield', 'glimmer',
  'moth', 'oakhart', 'raindrop', 'sir_waffles', 'cardboardknight', 'nina', 'leo', 'ari_v', 'tomte',
  'beanbag', 'skye', 'juniper', 'mossy', 'drift99', 'kettle_on', 'mabel', 'arlo', 'fig', 'ollie_b',
  'starling', 'clover', 'mint_tea', 'lazy_lynx', 'rio', 'birch', 'hollow_reed', 'pocketfox', 'nimbus',
  'tango_7', 'cinder', 'yuki', 'dex', 'amaya', 'basil', 'wanderer_3', 'plum', 'gus', 'halcyon',
  'snowpea', 'marigold_', 'jt_99', 'orbit', 'tess', 'falcon_eye', 'crumpet', 'vale', 'ziggy', 'rosie',
];
export const USERNAMES = NAMES;

const STYLES = {
  //            centre of each trait (a guest's own value is rolled around it)
  medium: { label: 'Steady',
    boldness: 0.5, caution: 0.5, greed: 0.5, aggression: 0.4, patience: 0.5, trust: 0.5, skill: 0.78, spread: 0.12 },
  bold: { label: 'Bold',
    boldness: 0.8, caution: 0.3, greed: 0.45, aggression: 0.7, patience: 0.3, trust: 0.45, skill: 0.74, spread: 0.1 },
  careful: { label: 'Careful',
    boldness: 0.22, caution: 0.78, greed: 0.6, aggression: 0.2, patience: 0.72, trust: 0.42, skill: 0.8, spread: 0.1 },
};
const TRAITS = ['boldness', 'caution', 'greed', 'aggression', 'patience', 'trust', 'skill'];
export const STYLE_NAMES = Object.keys(STYLES);

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// A rough bell curve from three uniform draws (-1 … 1).
const bell = rng => (rng() + rng() + rng() - 1.5) / 1.5;

// One profile. `style` may be forced ('medium' | 'bold' | 'careful'); otherwise rolled: about 60%
// medium, 20% bold, 20% careful.
export function rollProfile(rng, { style = null, username = null } = {}) {
  const s = style && STYLES[style] ? style : (() => {
    const x = rng();
    return x < 0.6 ? 'medium' : x < 0.8 ? 'bold' : 'careful';
  })();
  const base = STYLES[s];
  const traits = {};
  for (const t of TRAITS) {
    const lo = t === 'skill' ? 0.55 : 0.05, hi = t === 'skill' ? 0.95 : 0.95;
    traits[t] = Math.round(clamp(base[t] + bell(rng) * base.spread * 1.6, lo, hi) * 100) / 100;
  }
  const pace = Math.round(clamp(1.05 + bell(rng) * 0.3 - (s === 'bold' ? 0.12 : s === 'careful' ? -0.1 : 0), 0.7, 1.4) * 100) / 100;
  return { username: username || NAMES[Math.floor(rng() * NAMES.length)], style: s, label: base.label, traits, pace };
}

// `count` profiles for one match: no username twice.
export function rollProfiles(count, rng) {
  const pool = [...NAMES];
  const out = [];
  for (let k = 0; k < count; k++) {
    const name = pool.splice(Math.floor(rng() * pool.length), 1)[0] || `guest_${k + 1}`;
    out.push(rollProfile(rng, { username: name }));
  }
  return out;
}
