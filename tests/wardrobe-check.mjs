// Checks for avatar v2 (src/data/wardrobe.js, src/data/randomAvatar.js, the account's ownership and the table's seats)
// — fast, no browser, no three.js.
//   node tests/wardrobe-check.mjs [--only catalogue,looks,v1,safe,index,switch,bots,game]
//   node tests/wardrobe-check.mjs --only switch --root DIR    (the bug A / B checks against another copy of the game:
//                                                              DIR holds its src/; the proof that they failed before)
//
//   1. catalogue  every item: its id, slot, bodies, words, kind and colour rows; colours are hex; no eye colour is red,
//                 pink, violet or amber (red eyes mean possessed), brown and hazel marked nearRed; frames only (no lens);
//                 the ten new items with their final ids, words (per body where they differ), kinds, achievements and
//                 rarity: a 3D one pending until its file is in the parts index, then wearable with no other change
//                 (the two drawn in code held back until their drawing passes review); the
//                 achievement and Boutique sets never overlap, and the five achievements give exactly the five
//                 achievement items; today's locked colours keep a lock; the classic pieces core and free, the new free
//                 pieces free; the testing switch is ONE line and nothing else in src/ reads it; the parts index (and
//                 the manifest, once the pipeline has written it) agree with the catalogue
//   2. looks      the six classic Looks exactly as the contract's table, each already safe; the default is Victor; the
//                 keys (avatarKey, geometryKey, frameKey) and partKeysFor, its variants and Henry's own frames
//   3. v1         v1 -> v2 for EVERY v1 combination of today's catalogue (6 looks x 8 skins x 8 hairs x 6 eyes x 6
//                 glasses x 4 frames x 10 outfits x 6 accents x 3 metals): the Look it was, its own glasses and
//                 colours, nothing lost; damaged v1 values back to the look's own; the browser suites' v1 test profile
//   4. safe       normaliseAvatar repairs and never throws: unknown, pending, other-body and other-gender values,
//                 extras (once each, one per attach point, in order), colours, the triangle cap, trusted
//   5. index      pending pieces by the parts index; the fallback gown bodies (a dress picks its body); a saved body
//                 that no longer exists maps by gender; a gender is never changed by data
//   6. switch     the testing switch on (today) and off (a copy of src/ with the one line flipped): owns, canWear,
//                 "unlocked for testing"; bug A (an owned item worn is kept at load, also from another tab) and
//                 bug B (it stays on at the table); turning the switch off changes nothing else
//   7. bots       the same name gives the same look; 2000 tables: never two guests alike (nor like you), the eyes
//                 always show (the red-eye gate on the eye NEAREST the camera, the owner's rule of 19 Oct 2026: the
//                 Wavy bob on Clara's and Eleanor's faces and the chignon on Beatrice's are back), about one bot in
//                 three wears an unlockable item, both bodies and every Look's pieces worn, never a pending piece; a new
//                 player's first look is free items only
//   8. game       paletteHex, displayAvatar (Clearer possessed eyes), lookAlike (as colour-blind players see it),
//                 outfitOf, shippedPortraitFor, withItem / withBody / applyLook / lookOf / slotsFor (the wardrobe)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as W from '../src/data/wardrobe.js';
import { ACHIEVEMENTS } from '../src/data/achievements.js';
import { randomAvatar, tableAvatars, unlockablesWorn } from '../src/data/randomAvatar.js';
import { PART_INDEX } from '../src/data/partsIndex.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const only = new Set((arg('--only', '') || '').split(',').filter(Boolean));
const want = s => !only.size || only.has(s);
const otherRoot = arg('--root', null);
const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const { ITEMS, LOOKS, item, itemId, normaliseAvatar } = W;
const ids = slot => ITEMS.filter(i => i.slot === slot).map(i => i.id);
const BASE_IDS = ['victor', 'marcus', 'henry', 'clara', 'eleanor', 'beatrice'];
const EMPTY_INDEX = { v: 1, bodies: [], parts: {}, tris: {}, builtInGlasses: {} };
// (the Monocle and Gold frames are drawn in code and held back until their drawing passes review: the checks follow
// that one flag, so letting them in needs no change here)
const MONOCLE_HELD = !!item('glasses', 'monocle')?.artPending;

// ---------------------------------------------------------------------------------------------------------------------
if (want('catalogue')) {
  console.log('1. the catalogue');
  const SHAPE = ['face', 'hairStyle', 'facial', 'makeup', 'glasses', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'extra'];
  check(ITEMS.every(it => SHAPE.includes(it.slot) || W.COLOUR_SLOTS.includes(it.slot)), 'every item is in a known slot');
  check(!SHAPE.some(s => W.COLOUR_SLOTS.includes(s)), 'no shape slot is named like a colour slot (so a v1 id such as hair.platinum keeps its meaning)');
  const gids = ITEMS.map(itemId);
  check(new Set(gids).size === gids.length, `every item has its own global id (${gids.length} items)`);
  check(ITEMS.every(it => /^[a-z][A-Za-z0-9]{0,23}$/.test(it.id)), 'ids are camelCase ASCII, start lower-case, at most 24 characters');
  const bad = ITEMS.filter(it => !(Array.isArray(it.bodies) && it.bodies.length && it.bodies.every(b => W.BODY_IDS.includes(b))
    && ['part', 'code', 'none', 'colour'].includes(it.draw) && ['free', 'achievement', 'boutique'].includes(it.unlock)
    && it.rarity === { free: 'common', achievement: 'rare', boutique: 'showpiece' }[it.unlock]
    && Array.isArray(it.colours) && it.colours.every(c => W.COLOUR_SLOTS.includes(c))
    && typeof it.sort === 'number' && typeof it.core === 'boolean' && typeof it.artPending === 'boolean' && typeof it.isNew === 'boolean'
    && (it.unlock === 'achievement') === Object.prototype.hasOwnProperty.call(it, 'achievement')
    && (typeof it.label === 'string' ? it.label.length > 0 : ['m', 'f'].every(g => !it.bodies.some(b => W.genderOf(b) === g) || it.label[g]))
    && (typeof it.desc === 'string' || ['m', 'f'].every(g => !it.bodies.some(b => W.genderOf(b) === g) || it.desc[g]))));
  check(!bad.length, `every item has the contract's fields: bodies, label (per body where it differs), desc, draw, unlock, rarity from the kind, colour rows, sort, core, artPending${bad.length ? ` (not: ${bad.map(itemId).join(', ')})` : ''}`);
  check(ITEMS.filter(it => it.slot === 'extra').every(it => ['m', 'f'].every(g => !it.bodies.some(b => W.genderOf(b) === g) || W.ATTACH.includes(W.attachOf(it, g)))), 'every extra sits on one attach point for each body it is meant for');
  check(ITEMS.every(it => Object.isFrozen(it)), 'the catalogue is frozen (nothing changes an item behind its back)');
  const hex = v => /^#[0-9a-f]{6}$/i.test(v);
  const colourBad = ITEMS.filter(it => it.draw === 'colour' && !(
    it.slot === 'eyes' ? it.value === null ? it.id === 'classic' : Array.isArray(it.value) && it.value.length === 3 && it.value.every(hex)
      : it.slot === 'lips' ? it.value === null : hex(it.value)));
  check(!colourBad.length, `every colour is a 6-digit hex (classic eyes and natural lips: the model's own)${colourBad.length ? ` (not: ${colourBad.map(itemId)})` : ''}`);
  check(ids('skin').every(id => hex(item('skin', id).lips)) && ids('hair').every(id => hex(item('hair', id).brow)), 'every skin tone has its lip colour, every hair colour its brow colour');
  check(ITEMS.filter(it => it.slot === 'eyes').every(W.eyeColourSafe), 'no eye colour is red, pink, violet or amber (red eyes mean possessed)');
  check(!W.eyeColourSafe({ slot: 'eyes', value: ['#200404', '#601010', '#c02020'] }) && !W.eyeColourSafe({ slot: 'eyes', value: ['#100810', '#3a1040', '#a040c0'] })
    && !W.eyeColourSafe({ slot: 'eyes', value: ['#201000', '#603000', '#f0a020'] }), '(the control: a red, a violet and an amber iris are refused)');
  check(same(ITEMS.filter(it => it.nearRed).map(itemId), ['eyes.brownEyes', 'eyes.hazel']), 'brown and hazel eyes are the ones marked nearRed (red-green colour blindness)');
  check(ITEMS.filter(it => it.slot === 'glasses').every(it => !it.lens && (it.draw === 'none' || ['round', 'oval', 'deco', 'pincenez', 'monocle', 'gilt'].includes(it.value))), 'glasses are frames only (no lens: the eyes always show), drawn by the game');
  check(item('glasses', 'gilt').frameHex && !item('glasses', 'gilt').colours.includes('frame'), 'Gold frames: a fixed gold, no frame colour row');
  // the ten new items (the contract, section 6.4)
  const TEN = [
    ['glasses.monocle', 'code', 'achievement', 'seenThrough', ['m', 'f']], ['extra.lantern', 'part', 'achievement', 'savedByTheLight', ['m', 'f']],
    ['hairStyle.lamplighter', 'part', 'achievement', 'lamplighter', ['m', 'f']], ['extra.eveningGloves', 'part', 'achievement', 'goodCompany', ['m', 'f']],
    ['extra.blackOrchid', 'part', 'achievement', 'darkHorse', ['m', 'f']], ['top.smoking', 'part', 'boutique', undefined, ['m']],
    ['dress.decoBeaded', 'part', 'boutique', undefined, ['f']], ['facial.dali', 'part', 'boutique', undefined, ['m']],
    ['hairStyle.marcel', 'part', 'boutique', undefined, ['f']], ['glasses.gilt', 'code', 'boutique', undefined, ['m', 'f']],
  ];
  const tenBad = TEN.filter(([gid, draw, unlock, ach, genders]) => {
    const it = W.itemById(gid);
    return !it || it.draw !== draw || it.unlock !== unlock || it.achievement !== ach || !it.isNew
      || it.rarity !== (unlock === 'achievement' ? 'rare' : 'showpiece') || (draw === 'part' && it.artPending)
      || !same([...new Set(it.bodies.map(W.genderOf))].sort(), [...genders].sort());
  });
  check(!tenBad.length, `the ten new items: ids, bodies, drawing, kind, achievement and rarity (rare: earned; showpiece: Boutique); the 3D ones wait for the parts index (never held back by a flag)${tenBad.length ? ` (not: ${tenBad.map(t => t[0])})` : ''}`);
  // their final words (BUILD-BRIEF A1-A5, B1-B5): one id, the name per body where it differs, a one-line description
  const WORDS = {
    'glasses.monocle': ['Monocle'], 'extra.lantern': ['Lantern fob', 'Lantern charm'], 'hairStyle.lamplighter': ['The Poet', 'Braided crown'],
    'extra.eveningGloves': ['Evening gloves'], 'extra.blackOrchid': ['Black orchid'], 'top.smoking': ['Smoking jacket'],
    'dress.decoBeaded': ['Deco beaded gown'], 'facial.dali': ['Dalí moustache'], 'hairStyle.marcel': ['Marcel waves'], 'glasses.gilt': ['Gold frames'],
  };
  const wordsBad = Object.entries(WORDS).filter(([gid, [m, f = m]]) => {
    const it = W.itemById(gid), g = new Set(it.bodies.map(W.genderOf));
    const lines = [...g].map(x => W.descOf(it, x));
    return (g.has('m') && W.labelOf(it, 'm') !== m) || (g.has('f') && W.labelOf(it, 'f') !== f)
      || !lines.every(d => d.length >= 20 && d.length <= 90 && /^[A-Z]/.test(d) && /\.$/.test(d) && !/\n/.test(d));
  });
  check(!wordsBad.length, `their final names (per body where they differ: Lantern fob / charm, The Poet / Braided crown) and a one-line description for each body${wordsBad.length ? ` (not: ${wordsBad.map(w => w[0])})` : ''}`);
  // nothing in their words names a role, a side or what earned them (cosmetics never reveal a role)
  const tells = /\b(possess\w*|clean|innocent|guilty|lies?|liar|traitor|demon|souls?|red eyes?|villain|wins?|won|winner)\b/i;
  check(Object.keys(WORDS).every(gid => { const it = W.itemById(gid); return ['m', 'f'].every(x => !tells.test(W.labelOf(it, x)) && !tells.test(W.descOf(it, x))); }),
    'no word of theirs names a role, a side or a win (a cosmetic never tells what its wearer is or did)');
  check(W.attachOf(item('extra', 'lantern'), 'm') === 'waist' && W.attachOf(item('extra', 'lantern'), 'f') === 'neck' && W.attachOf(item('extra', 'eveningGloves'), 'f') === 'hands'
    && W.attachOf(item('extra', 'blackOrchid'), 'm') === 'chest', 'where the new extras sit: the fob at the waist, the charm at the neck, gloves on the hands, the orchid on the chest');
  check(['glasses.monocle', 'glasses.gilt'].every(g => W.itemById(g).frameHex && !W.itemById(g).colours.includes('frame')), 'the Monocle and Gold frames are gilt (a fixed gold, no Frame colour row)');
  const ach = ITEMS.filter(it => it.unlock === 'achievement'), shop = ITEMS.filter(it => it.unlock === 'boutique');
  check(!ach.some(it => shop.includes(it)) && shop.every(it => !('achievement' in it)), 'the achievement and Boutique sets never overlap (an earned item is never sold)');
  check(ACHIEVEMENTS.length === 5 && same(ACHIEVEMENTS.map(a => a.item).sort(), ach.filter(it => it.achievement).map(itemId).sort())
    && ACHIEVEMENTS.every(a => W.itemById(a.item)?.achievement === a.id), 'the five achievements give exactly the five achievement items, each naming its own');
  check(['hair.platinum', 'main.champagne', 'metal.roseGold'].every(g => W.itemById(g).unlock === 'achievement' && W.itemById(g).achievement === null)
    && ['main.gatsby', 'frame.goldFrame'].every(g => W.itemById(g).unlock === 'boutique'), "today's other locked colours keep a lock: platinum, champagne, rose gold (a later honour); Gatsby gold, gold frames (Boutique)");
  const CLASSIC = { face: ['victor', 'marcus', 'henry', 'clara', 'eleanor', 'beatrice'], hairStyle: ['swept', 'sideSwept', 'quiff', 'waves', 'chignon', 'wavyBob'],
    facial: ['none', 'handlebar'], makeup: ['none'], glasses: ['none', 'round', 'oval', 'deco', 'pincenez'], top: ['tux', 'lounge', 'dinner'],
    neck: ['bow', 'tie', 'bowFull'], legs: ['trousers', 'blackTrousers'], dress: ['column', 'ballgown', 'aline'], belt: ['none', 'sash', 'thin'],
    feet: ['derby', 'pumps'], extra: ['goldDrop', 'pearlStud', 'goldBall'] };
  const classicBad = Object.entries(CLASSIC).flatMap(([s, list]) => list.filter(id => { const it = item(s, id); return !it || !it.core || !W.isFree(it) || it.artPending; }).map(id => `${s}.${id}`));
  check(!classicBad.length, `the classic pieces (from the six guests) are core and free${classicBad.length ? ` (not: ${classicBad})` : ''}`);
  check(item('neck', 'none') && item('neck', 'none').artPending && W.isFree(item('neck', 'none')), 'the open collar (neck none) is free but held back until it passes review with every jacket');
  check(['hairStyle.sidePart', 'hairStyle.curlyCrop', 'facial.pencil', 'top.waistcoat'].every(g => { const it = W.itemById(g); return it && W.isFree(it) && !it.core && !it.artPending && it.draw === 'part'; })
    && W.isFree(item('facial', 'none')), 'the proven new free pieces: Side part, Curly crop, Pencil, Waistcoat (pending only until the pipeline builds them), Clean-shaven');
  check(ITEMS.filter(it => it.slot === 'extra' && it.core).every(it => W.attachOf(it, 'f') === 'ears'), 'the classic earrings sit on the ears');
  check(Object.keys(W.SLOT_AREA).length && [...SHAPE, ...W.COLOUR_SLOTS].every(s => W.SLOT_AREA[s]), 'every slot has a wardrobe area');
  // the testing switch: one line, read nowhere else
  const src = fs.readFileSync(path.join(repo, 'src/data/wardrobe.js'), 'utf8');
  check(W.UNLOCK_ALL_FOR_TESTING === true && src.split('\n').filter(l => /UNLOCK_ALL_FOR_TESTING\s*=/.test(l)).length === 1
    && /^export const UNLOCK_ALL_FOR_TESTING = true;$/m.test(src), 'the testing switch is on, in one line: export const UNLOCK_ALL_FOR_TESTING = true;');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const readers = walk(path.join(repo, 'src')).filter(f => f.endsWith('.js') && !f.endsWith(path.join('data', 'wardrobe.js')))
    .filter(f => fs.readFileSync(f, 'utf8').split('\n').some(l => !/^\s*\/\//.test(l) && l.includes('UNLOCK_ALL_FOR_TESTING')));
  check(!readers.length, `nothing else in src/ reads the switch (canWear and unlockedForTesting do)${readers.length ? ` (read in: ${readers.map(f => path.relative(repo, f))})` : ''}`);
  // the parts index (and the manifest) against the catalogue
  check(PART_INDEX && PART_INDEX.v === 1 && Array.isArray(PART_INDEX.bodies) && typeof PART_INDEX.parts === 'object' && typeof PART_INDEX.tris === 'object'
    && typeof PART_INDEX.builtInGlasses === 'object', `src/data/partsIndex.js has the index's shape (bodies: ${JSON.stringify(PART_INDEX.bodies)})`);
  const unknownParts = [];
  for (const [body, keys] of Object.entries(PART_INDEX.parts || {})) for (const k of keys) {
    const [plain] = k.split('~'), cut = plain.indexOf('_');
    const it = item(plain.slice(0, cut), plain.slice(cut + 1));
    if (!it || !it.bodies.includes(body)) unknownParts.push(`${body}/${k}`);
  }
  check(!unknownParts.length, `every piece in the index is a catalogue item meant for that body${unknownParts.length ? ` (not: ${unknownParts.slice(0, 8)})` : ''}`);
  const manifestFile = path.join(repo, 'assets/characters/parts/manifest.json');
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    const notSubset = Object.values(manifest.parts || {}).filter(p => {
      const it = item(p.slot, p.id);
      return it && !it.colours.every(c => (p.colourSlots || []).includes(c));
    }).map(p => `${p.body}/${p.slot}_${p.id}${p.fit ? `~${p.fit}` : ''}`);
    check(!notSubset.length, `the manifest: every piece's catalogue colour rows are colours that really paint it${notSubset.length ? ` (not: ${notSubset.slice(0, 8)})` : ''}`);
  } else console.log('  NOTE  no assets/characters/parts/manifest.json yet (the pipeline has not run): its colour check is skipped');
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('looks')) {
  console.log('\n2. the six Looks and the keys');
  W.usePartIndex(EMPTY_INDEX);
  const C = (skin, hair, main, accent) => ({ skin, hair, eyes: 'classic', main, accent, metal: 'gold', frame: 'tortoise', lips: 'natural' });
  const TABLE = {
    victor: { v: 2, body: 'm', face: 'victor', hairStyle: 'swept', facial: 'handlebar', glasses: 'none', top: 'tux', neck: 'bow', legs: 'trousers', feet: 'derby', extras: [], colours: C('fair', 'black', 'midnight', 'black') },
    marcus: { v: 2, body: 'm', face: 'marcus', hairStyle: 'sideSwept', facial: 'none', glasses: 'none', top: 'lounge', neck: 'tie', legs: 'trousers', feet: 'derby', extras: [], colours: C('tan', 'black', 'midnight', 'claret') },
    henry: { v: 2, body: 'm', face: 'henry', hairStyle: 'quiff', facial: 'none', glasses: 'round', top: 'dinner', neck: 'bowFull', legs: 'blackTrousers', feet: 'derby', extras: [], colours: C('rosy', 'silver', 'ivory', 'black') },
    clara: { v: 2, body: 'f', face: 'clara', hairStyle: 'waves', makeup: 'none', glasses: 'none', dress: 'column', belt: 'sash', feet: 'pumps', extras: ['goldDrop'], colours: C('rosy', 'auburn', 'claret', 'claret') },
    eleanor: { v: 2, body: 'f', face: 'eleanor', hairStyle: 'chignon', makeup: 'none', glasses: 'none', dress: 'ballgown', belt: 'thin', feet: 'pumps', extras: ['pearlStud'], colours: C('rosy', 'brown', 'midnight', 'black') },
    beatrice: { v: 2, body: 'f', face: 'beatrice', hairStyle: 'wavyBob', makeup: 'none', glasses: 'none', dress: 'aline', belt: 'thin', feet: 'pumps', extras: ['goldBall'], colours: C('tan', 'darkBrown', 'emerald', 'black') },
  };
  for (const id of BASE_IDS) check(same(LOOKS[id], TABLE[id]) && same(normaliseAvatar(LOOKS[id]), LOOKS[id]), `${id}: the contract's Look (pieces and colours), already safe`);
  check(same(W.DEFAULT_AVATAR, LOOKS.victor) && Object.isFrozen(W.DEFAULT_AVATAR) && Object.isFrozen(W.DEFAULT_AVATAR.colours), 'the default (no profile, a damaged save) is Victor, frozen');
  check(W.avatarKey(LOOKS.victor) === 'v2|m|victor|swept|handlebar||none|tux|bow|trousers|||derby||fair|black|classic|midnight|black|gold|tortoise|natural', `avatarKey(Victor) as the contract (${W.avatarKey(LOOKS.victor)})`);
  check(W.geometryKey(LOOKS.victor) === 'g2|m|victor|swept|handlebar||none|tux|bow|trousers|||derby|', 'geometryKey(Victor) as the contract');
  check(W.frameKey(LOOKS.clara) === 'f|clara|waves' && W.geometryKey(LOOKS.clara).endsWith('|goldDrop'), "frameKey: body, face, hairstyle; the extras end the geometry key");
  const recoloured = W.withItem(LOOKS.victor, 'main', 'plum');
  check(W.geometryKey(recoloured) === W.geometryKey(LOOKS.victor) && W.avatarKey(recoloured) !== W.avatarKey(LOOKS.victor), 'a colour changes the avatar key, never the geometry key (a repaint, no new merge)');
  check(W.geometryKey(W.withItem(LOOKS.victor, 'glasses', 'oval')) !== W.geometryKey(LOOKS.victor), 'glasses change the geometry key (they are merged into the guest)');
  check(same(W.partKeysFor(LOOKS.henry), { body: 'm/body', parts: ['m/face_henry', 'm/hairStyle_quiff', 'm/top_dinner', 'm/neck_bowFull', 'm/legs_blackTrousers', 'm/feet_derby'],
    eyesFrom: 'm/face_henry', glasses: 'round', builtInGlasses: null }), 'partKeysFor(Henry) before anything is built: his pieces, the code-drawn round frames');
  W.usePartIndex({ v: 1, bodies: ['m', 'f'], parts: {
    m: ['body', 'extra_blackOrchid~top_tux', 'face_henry', 'face_marcus', 'face_victor', 'feet_derby', 'hairStyle_quiff', 'hairStyle_sideSwept', 'hairStyle_swept', 'hairStyle_swept~face_marcus',
      'legs_blackTrousers', 'legs_trousers', 'neck_bow', 'neck_bowFull', 'neck_tie', 'top_dinner', 'top_lounge', 'top_tux', 'top_waistcoat', 'facial_handlebar'],
    f: ['face_clara'] }, tris: { 'm/body': 2900 }, builtInGlasses: { 'm/face_henry': 'round' } });
  check(same(W.partKeysFor(LOOKS.henry), { body: 'm/body', parts: ['m/face_henry', 'm/hairStyle_quiff', 'm/top_dinner', 'm/neck_bowFull', 'm/legs_blackTrousers', 'm/feet_derby'],
    eyesFrom: 'm/face_henry', glasses: null, builtInGlasses: 'm/face_henry' }), "partKeysFor(Henry) as the contract: Henry's own frames for 'round' (no code-drawn pair)");
  check(W.partKeysFor(W.withItem(LOOKS.henry, 'glasses', 'oval', { trusted: true })).glasses === 'oval' && W.partKeysFor(W.withItem(LOOKS.henry, 'glasses', 'oval', { trusted: true })).builtInGlasses === null, '...and code-drawn frames for any other style');
  const mix = normaliseAvatar({ ...LOOKS.marcus, hairStyle: 'swept' }, { trusted: true });
  check(W.partKeysFor(mix).parts.includes('m/hairStyle_swept~face_marcus') && W.partKeysFor(LOOKS.victor).parts.includes('m/hairStyle_swept'), 'a variant fitted to a worn piece wins (Swept on Marcus\'s face), else the plain file');
  const orchid = { ...LOOKS.victor, extras: ['blackOrchid'] };
  check(W.partKeysFor(orchid).parts.at(-1) === 'm/extra_blackOrchid~top_tux' && !W.partKeysFor({ ...orchid, top: 'waistcoat' }).parts.some(k => k.includes('blackOrchid')), 'an extra with no variant for the worn piece is simply not drawn');
  check(same(W.partKeysFor(LOOKS.victor).parts, ['m/face_victor', 'm/hairStyle_swept', 'm/facial_handlebar', 'm/top_tux', 'm/neck_bow', 'm/legs_trousers', 'm/feet_derby']), 'the order of the parts: the key slots, then the extras; nothing for code-drawn or none');
  W.usePartIndex();
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('v1')) {
  console.log('\n3. v1 -> v2: every v1 combination');
  W.usePartIndex(EMPTY_INDEX);
  // today's (v1) catalogue: its slots and every value, locked ones included
  const V1 = { skin: ids('skin'), hair: ids('hair'), eyes: ids('eyes'), glasses: ['none', 'round', 'oval', 'deco', 'pincenez', 'monocle'], frame: ids('frame'), main: ids('main'), accent: ids('accent'), metal: ids('metal') };
  check(V1.skin.length === 8 && V1.hair.length === 8 && V1.eyes.length === 6 && V1.frame.length === 4 && V1.main.length === 10 && V1.accent.length === 6 && V1.metal.length === 3,
    "today's v1 values are all in the catalogue under the same ids (8 skins, 8 hairs, 6 eyes, 4 frames, 10 outfits, 6 accents, 3 metals)");
  const expected = (v1) => {
    const L = LOOKS[v1.base];
    const glasses = v1.glasses === 'monocle' && MONOCLE_HELD ? L.glasses : v1.glasses;     // (while the Monocle is held back)
    return { ...L, glasses, extras: [...L.extras], colours: { skin: v1.skin, hair: v1.hair, eyes: v1.eyes, main: v1.main, accent: v1.accent, metal: v1.metal, frame: v1.frame, lips: 'natural' } };
  };
  let n = 0, wrong = 0, unstable = 0, firstWrong = null;
  const v1 = { v: 1 };
  for (const base of BASE_IDS) for (const glasses of V1.glasses) for (const skin of V1.skin) for (const hair of V1.hair) for (const eyes of V1.eyes)
    for (const frame of V1.frame) for (const main of V1.main) for (const accent of V1.accent) for (const metal of V1.metal) {
      Object.assign(v1, { base, skin, hair, eyes, glasses, frame, main, accent, metal });
      const got = normaliseAvatar(v1);
      n++;
      const want = expected(v1);
      if (got.body !== want.body || got.face !== want.face || got.hairStyle !== want.hairStyle || got.glasses !== want.glasses
        || got.colours.skin !== skin || got.colours.hair !== hair || got.colours.eyes !== eyes || got.colours.frame !== frame || got.colours.main !== main
        || got.colours.accent !== accent || got.colours.metal !== metal || got.colours.lips !== 'natural'
        || (n % 997 === 0 && !same(got, want))) { wrong++; firstWrong ||= { v1: { ...v1 }, got }; }
      if (n % 4999 === 0 && !same(normaliseAvatar(got), got)) unstable++;
    }
  check(n === 6 * 8 * 8 * 6 * 6 * 4 * 10 * 6 * 3 && wrong === 0, `all ${n.toLocaleString('en')} v1 combinations become the Look they were, with their own glasses and every colour kept${wrong ? ` (${wrong} wrong, e.g. ${JSON.stringify(firstWrong)})` : ''}`);
  check(unstable === 0, 'a migrated avatar is already safe (made safe again, it does not change)');
  // the whole avatar for every look x every value of every slot, the rest the look's own
  let whole = 0;
  for (const base of BASE_IDS) for (const [slot, values] of Object.entries(V1)) for (const v of values) {
    const o = { v: 1, base, ...Object.fromEntries(Object.entries(LOOKS[base].colours).filter(([k]) => k !== 'lips')), glasses: LOOKS[base].glasses, [slot]: v };
    if (!same(normaliseAvatar(o), expected(o))) whole++;
  }
  check(whole === 0, 'every look x every value of every slot gives exactly the whole expected v2 avatar (pieces, glasses, extras, colours)');
  // nothing lost: distinct v1 avatars stay distinct (apart from the Monocle, which no v1 player could own)
  const keys = new Set();
  let pairs = 0;
  for (const base of BASE_IDS) for (const a of ['skin', 'hair', 'eyes', 'glasses', 'frame', 'main', 'accent', 'metal']) for (const va of V1[a]) {
    if (a === 'glasses' && va === 'monocle') continue;
    const o = { v: 1, base, skin: 'fair', hair: 'black', eyes: 'classic', glasses: 'none', frame: 'tortoise', main: 'midnight', accent: 'black', metal: 'gold', [a]: va };
    keys.add(JSON.stringify(o)); pairs++;
  }
  const migrated = new Set([...keys].map(k => W.avatarKey(normaliseAvatar(JSON.parse(k)))));
  check(migrated.size === keys.size, `lossless: ${keys.size} different v1 avatars give ${migrated.size} different v2 avatars (an accent or metal a look does not draw is kept too)`);
  // damaged v1 data: back to the look's own, as v1 did
  const dmg = normaliseAvatar({ v: 1, base: 'marcus', skin: 'green', hair: 42, eyes: 'red', glasses: 'monocle', frame: null, main: { x: 1 }, accent: 'navy', metal: 'tin' });
  check(dmg.face === 'marcus' && dmg.colours.skin === 'tan' && dmg.colours.hair === 'black' && dmg.colours.eyes === 'classic' && dmg.glasses === (MONOCLE_HELD ? 'none' : 'monocle') && dmg.colours.frame === 'tortoise'
    && dmg.colours.main === 'midnight' && dmg.colours.accent === 'navy' && dmg.colours.metal === 'gold', 'damaged v1 values go back to the look\'s own (never another look\'s), good ones stay');
  let crash = 0;
  for (const base of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 7, null]) { try { if (normaliseAvatar({ v: 1, base }).face !== 'victor') crash++; } catch { crash++; } }
  check(crash === 0, 'a v1 look called "constructor", "__proto__", "toString" (any built-in name), a number or null is Victor, never a crash');
  const TEST_PROFILE_AVATAR = { v: 1, base: 'victor', skin: 'fair', hair: 'black', eyes: 'classic', glasses: 'none', frame: 'tortoise', main: 'midnight', accent: 'black', metal: 'gold' };
  const smoke = fs.readFileSync(path.join(here, 'smoke-lib.mjs'), 'utf8');
  check(smoke.includes(JSON.stringify(TEST_PROFILE_AVATAR).replace(/"(\w+)":/g, '$1: ').replace(/"/g, "'").replace(/,/g, ', ').replace(/^\{/, '{ ').replace(/\}$/, ' }'))
    && same(normaliseAvatar(TEST_PROFILE_AVATAR), LOOKS.victor), "the browser suites' v1 test profile (tests/smoke-lib.mjs, kept v1 on purpose) migrates to Victor exactly");
  W.usePartIndex();
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('safe')) {
  console.log('\n4. making an avatar safe');
  W.usePartIndex(EMPTY_INDEX);
  const fields = av => Object.keys(av).join();
  check(fields(normaliseAvatar(LOOKS.victor)) === 'v,body,face,hairStyle,facial,glasses,top,neck,legs,feet,extras,colours'
    && fields(normaliseAvatar(LOOKS.clara)) === 'v,body,face,hairStyle,makeup,glasses,dress,belt,feet,extras,colours', 'a man and a woman: exactly the contract\'s fields, in order');
  let thrown = 0, shapeBad = 0;
  for (const junk of [null, undefined, 0, 'junk', [], [1, 2], { v: 2 }, { v: 2, body: 7 }, { v: 2, body: 'm', face: {}, extras: 'x', colours: 'red' },
    { v: 2, body: '__proto__', face: '__proto__', colours: { skin: '__proto__', eyes: 'constructor' } }, { v: 2, extras: [null, 1, {}, 'goldDrop', 'goldDrop'] }, { v: '2', body: 'f' }, { v: 3, body: 'f', face: 'clara' }]) {
    try { const a = normaliseAvatar(junk); if (a.v !== 2 || !W.BODY_IDS.includes(a.body) || !Array.isArray(a.extras) || Object.keys(a.colours).length !== 8) shapeBad++; } catch { thrown++; }
  }
  check(thrown === 0 && shapeBad === 0, 'anything at all (null, numbers, strings, arrays, built-in names, wrong types) gives a whole v2 avatar, never a crash');
  check(normaliseAvatar({ v: 3, body: 'f', face: 'eleanor', dress: 'ballgown' }).face === 'eleanor', "a newer avatar version is read as well as v2 can (best effort, a newer profile's)");
  const m = normaliseAvatar({ v: 2, body: 'm', face: 'clara', hairStyle: 'waves', facial: 'pencil', top: 'smoking', neck: 'tie', dress: 'column', makeup: 'none', glasses: 'monocle', extras: ['goldDrop'], colours: { main: 'plum' } });
  check(m.face === 'victor' && m.hairStyle === 'swept' && m.neck === 'tie' && m.colours.main === 'plum' && !('dress' in m) && !('makeup' in m) && m.extras.length === 0,
    "on a man: a woman's face, hair and earrings go back to the man's defaults (Victor's), the dress and make-up fields go, good values stay");
  check(m.facial === 'handlebar' && m.top === 'tux' && m.glasses === (MONOCLE_HELD ? 'none' : 'monocle'), 'pieces not built yet (Pencil before the pipeline) and held back ones (the smoking jacket, the Monocle) go back to the default');
  const f = normaliseAvatar({ v: 2, body: 'f', face: 'beatrice', hairStyle: 'lamplighter', dress: 'aline', belt: 'nope', extras: ['pearlStud', 'goldBall', 'goldBall', 'lantern'], colours: { lips: 'red', eyes: 'blue', hair: 'copper' } });
  check(f.face === 'beatrice' && f.dress === 'aline' && f.hairStyle === 'waves' && f.belt === 'sash' && same(f.extras, ['pearlStud']) && f.colours.lips === 'natural' && f.colours.eyes === 'blue',
    "a woman: the defaults are Clara's pieces; one pair of earrings only (the later one goes, a duplicate too), a held-back extra goes; lips 'natural'");
  check(f.colours.skin === 'rosy' && f.colours.main === 'claret', "a missing colour: the body's default (Clara's colours for a woman, Victor's for a man)");
  W.usePartIndex({ v: 1, bodies: ['m', 'f'], parts: { m: ['body', 'face_victor', 'hairStyle_swept', 'facial_handlebar', 'top_tux', 'neck_bow', 'legs_trousers', 'feet_derby', 'extra_lanternX'], f: ['body', 'face_clara', 'hairStyle_waves', 'dress_column', 'belt_sash', 'feet_pumps', 'extra_goldDrop', 'extra_pearlStud'] },
    tris: { 'm/body': 3000, 'm/face_victor': 6000, 'm/hairStyle_swept': 8544, 'm/facial_handlebar': 976, 'm/top_tux': 9000, 'm/neck_bow': 700, 'm/legs_trousers': 2700, 'm/feet_derby': 2400,
      'f/body': 4000, 'f/face_clara': 7000, 'f/hairStyle_waves': 12700, 'f/dress_column': 8500, 'f/belt_sash': 800, 'f/feet_pumps': 1200, 'f/extra_goldDrop': 1400, 'f/extra_pearlStud': 1400 }, builtInGlasses: {} });
  // (Clara 34,200 + earrings 1,400 + glasses 2,600 = 38,200: the earrings go, and that is enough)
  const over = normaliseAvatar({ ...LOOKS.clara, glasses: 'deco', extras: ['goldDrop'] }, { trusted: true });
  check(over.glasses === 'deco' && same(over.extras, []), `the triangle cap (${W.TRIANGLE_CAP}): a guest just over it loses its extras first (${JSON.stringify([over.glasses, over.extras])})`);
  W.usePartIndex({ v: 1, bodies: ['m', 'f'], parts: { m: [], f: ['body', 'face_clara', 'hairStyle_waves', 'dress_column', 'belt_sash', 'feet_pumps', 'extra_goldDrop'] },
    tris: { 'f/body': 4000, 'f/face_clara': 7000, 'f/hairStyle_waves': 14000, 'f/dress_column': 8500, 'f/belt_sash': 800, 'f/feet_pumps': 1200, 'f/extra_goldDrop': 1400 }, builtInGlasses: {} });
  const far = normaliseAvatar({ ...LOOKS.clara, glasses: 'deco', extras: ['goldDrop'] }, { trusted: true });
  check(far.glasses === 'none' && same(far.extras, []) && same(normaliseAvatar(LOOKS.clara, { trusted: true }).extras, ['goldDrop']),
    `...then its glasses, when that is not enough (${JSON.stringify([far.glasses, far.extras])}); the same guest without glasses keeps its earrings`);
  const light = normaliseAvatar({ ...LOOKS.victor, glasses: 'deco' }, { trusted: true });
  check(light.glasses === 'deco', 'an everyday guest under the cap keeps everything');
  W.usePartIndex(EMPTY_INDEX);
  check(same(normaliseAvatar(W.withItem(LOOKS.victor, 'main', 'gatsby'), { trusted: true }), W.withItem(LOOKS.victor, 'main', 'gatsby')), 'trusted: the same result while the switch is on (it only skips the ownership part)');
  W.usePartIndex();
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('index')) {
  console.log('\n5. pending pieces and bodies, by the parts index');
  W.usePartIndex(EMPTY_INDEX);
  const pend = (slot, id, body) => W.isPending(item(slot, id), body);
  check(!pend('face', 'marcus', 'm') && !pend('dress', 'ballgown', 'f') && pend('hairStyle', 'sidePart', 'm') && pend('top', 'waistcoat', 'm') && pend('facial', 'pencil', 'm'),
    'nothing built yet: the classic pieces stand in (core), the new pieces wait for the pipeline');
  check(ITEMS.filter(it => it.artPending).every(it => it.bodies.every(b => W.isPending(it, b) && !W.itemsFor(it.slot, b).includes(it))), 'held-back items are pending on every body and never offered');
  check(same(W.availableBodies(), ['m', 'f']), "no body built: 'm' and 'f' (a gender is never left without one)");
  W.usePartIndex({ v: 1, bodies: ['m'], parts: { m: ['body', 'face_victor', 'face_marcus', 'face_henry', 'hairStyle_swept', 'hairStyle_sidePart~face_victor'] }, tris: {}, builtInGlasses: {} });
  check(!pend('hairStyle', 'sidePart', 'm') && pend('hairStyle', 'curlyCrop', 'm') && pend('top', 'tux', 'm'), 'men built: a piece is offered when its file (or a variant of it) is built; a classic piece not built yet is pending on that body');
  check(same(W.availableBodies(), ['m', 'f']) && normaliseAvatar(LOOKS.clara).body === 'f' && normaliseAvatar(LOOKS.clara).face === 'clara',
    'the men built and the women not yet: a saved Clara stays a woman, in her own pieces (never repaired into a man)');
  // the female fallback: one body per gown
  W.usePartIndex({ v: 1, bodies: ['m', 'f_column', 'f_ballgown', 'f_aline'], parts: {
    m: [], f_column: ['body', 'face_clara', 'hairStyle_waves', 'dress_column', 'belt_sash', 'feet_pumps', 'extra_goldDrop', 'face_eleanor'],
    f_ballgown: ['body', 'face_eleanor', 'hairStyle_chignon', 'dress_ballgown', 'belt_thin', 'feet_pumps', 'extra_pearlStud'],
    f_aline: ['body', 'face_beatrice', 'hairStyle_wavyBob', 'dress_aline', 'belt_thin', 'feet_pumps', 'extra_goldBall'] }, tris: {}, builtInGlasses: {} });
  check(LOOKS.clara.body === 'f_column' && LOOKS.eleanor.body === 'f_ballgown' && LOOKS.beatrice.body === 'f_aline', "the fallback: each classic woman's Look is on her gown's own body");
  check(same(W.availableBodies(), ['m', 'f_column', 'f_ballgown', 'f_aline']), 'the bodies offered are the built ones');
  const saved = { v: 2, body: 'f', face: 'eleanor', hairStyle: 'chignon', makeup: 'none', glasses: 'none', dress: 'ballgown', belt: 'thin', feet: 'pumps', extras: ['pearlStud'], colours: LOOKS.eleanor.colours };
  check(same(normaliseAvatar(saved), LOOKS.eleanor), "a saved shared-body woman (body 'f') maps to the gown body her dress fits");
  const swapped = W.withItem(LOOKS.clara, 'dress', 'ballgown');
  check(swapped.body === 'f_ballgown' && swapped.dress === 'ballgown' && swapped.face === 'eleanor' && same(swapped.colours, LOOKS.clara.colours),
    'choosing a gown that fits another gown body switches to it; what is not built there goes back to the default; the colours stay');
  check(W.withItem(LOOKS.clara, 'face', 'eleanor').face === 'eleanor' && W.withItem(LOOKS.clara, 'face', 'eleanor').body === 'f_column', 'a face refitted to a gown body is offered there');
  W.usePartIndex({ v: 1, bodies: ['m', 'f'], parts: { m: [], f: ['body', 'face_eleanor', 'dress_ballgown'] }, tris: {}, builtInGlasses: {} });
  check(normaliseAvatar({ ...LOOKS.eleanor, body: 'f_ballgown' }).body === 'f' && normaliseAvatar({ ...LOOKS.eleanor, body: 'f_mermaid' }).body === 'f' && normaliseAvatar({ ...LOOKS.eleanor, body: 'q' }).body === 'm',
    "the shared body built: a saved gown body maps to 'f' (same gender), an unknown body name of the grammar too; anything else is 'm'");
  // the ten new items: a 3D one is pending until the pipeline puts its file in the index, then wearable with no change
  W.usePartIndex();
  const NEW3D = [['top', 'smoking'], ['dress', 'decoBeaded'], ['facial', 'dali'], ['hairStyle', 'marcel'], ['hairStyle', 'lamplighter'], ['extra', 'lantern'], ['extra', 'eveningGloves'], ['extra', 'blackOrchid']];
  const built = (slot, id, b) => (PART_INDEX.parts?.[b] || []).some(k => k === `${slot}_${id}` || k.startsWith(`${slot}_${id}~`));
  const waiting = NEW3D.flatMap(([slot, id]) => item(slot, id).bodies.filter(b => PART_INDEX.bodies.includes(b) && !built(slot, id, b)).map(b => [slot, id, b]));
  check(waiting.every(([slot, id, b]) => W.isPending(item(slot, id), b) && !W.itemsFor(slot, b).includes(item(slot, id)) && !W.canWear(item(slot, id), b)),
    `the new 3D items not built yet are pending: never offered, never worn (${waiting.length ? waiting.map(([s, i, b]) => `${b}/${s}_${i}`).join(', ') : 'none: all built'})`);
  W.usePartIndex({ ...PART_INDEX, parts: { m: [...(PART_INDEX.parts.m || []), 'top_smoking', 'facial_dali', 'hairStyle_lamplighter', 'extra_lantern', 'extra_eveningGloves', 'extra_blackOrchid~top_tux', 'extra_blackOrchid~top_lounge'],
    f: [...(PART_INDEX.parts.f || []), 'dress_decoBeaded', 'hairStyle_marcel', 'hairStyle_lamplighter', 'extra_lantern', 'extra_eveningGloves', 'extra_blackOrchid'] } });
  const landed = NEW3D.flatMap(([slot, id]) => item(slot, id).bodies.filter(b => ['m', 'f'].includes(b)).map(b => [slot, id, b]));
  check(landed.every(([slot, id, b]) => !W.isPending(item(slot, id), b) && W.itemsFor(slot, b).includes(item(slot, id)) && W.canWear(item(slot, id), b)),
    `...and once their files are in the index, all ${landed.length} (item, body) pairs are offered and wearable (unlocked for testing) with no other change`);
  const tr = { trusted: true };
  const dressed = W.withItem(W.withItem(W.withItem(LOOKS.victor, 'top', 'smoking', tr), 'facial', 'dali', tr), 'extra', 'lantern', tr);
  const gowned = W.withItem(W.withItem(LOOKS.clara, 'dress', 'decoBeaded', tr), 'hairStyle', 'marcel', tr);
  check(dressed.top === 'smoking' && dressed.facial === 'dali' && same(dressed.extras, ['lantern']) && gowned.dress === 'decoBeaded' && gowned.hairStyle === 'marcel'
    && W.partKeysFor(dressed).parts.includes('m/top_smoking') && W.partKeysFor(gowned).parts.includes('f/dress_decoBeaded'), 'they are worn and drawn from their own files (Smoking jacket, Dalí moustache, Lantern fob; Deco beaded gown, Marcel waves)');
  check(['monocle', 'gilt'].every(id => W.itemsFor('glasses', 'm').includes(item('glasses', id)) === !item('glasses', id).artPending),
    `...the two drawn in code (Monocle, Gold frames) are offered exactly when their one flag is lifted (held back now: ${['monocle', 'gilt'].filter(id => item('glasses', id).artPending).join(', ') || 'none'})`);
  const rolled = Array.from({ length: 1500 }, (_, k) => randomAvatar(`newitems${k}`));
  const rolledNew = rolled.filter(a => NEW3D.some(([slot, id]) => (slot === 'extra' ? a.extras.includes(id) : a[slot] === id))).length;
  check(rolledNew > 0 && rolled.every(a => W.eyesShow(a)), `bots roll them too, at the unlockable rate (${rolledNew} of 1500 bots wear one), their eyes always showing`);
  W.usePartIndex();
}

// ---------------------------------------------------------------------------------------------------------------------
// The testing switch off: a copy of the game's src/ with that one line flipped (and, in an old copy of the game, its
// own switch `const UNLOCKING = false` turned on, so the bugs it hid show).
async function srcWith({ root = repo, unlockAll }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wardrobe-check-'));
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  const wf = path.join(dir, 'src/data/wardrobe.js'), af = path.join(dir, 'src/account/account.js');
  fs.writeFileSync(wf, fs.readFileSync(wf, 'utf8').replace('export const UNLOCK_ALL_FOR_TESTING = true;', `export const UNLOCK_ALL_FOR_TESTING = ${unlockAll};`));
  fs.writeFileSync(af, fs.readFileSync(af, 'utf8').replace('const UNLOCKING = false;', 'const UNLOCKING = true;'));
  const load = rel => import(pathToFileURL(path.join(dir, 'src', rel)).href);
  return { dir, W: await load('data/wardrobe.js'), A: await load('account/account.js'), T: await load('table.js'), done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const hairOf = av => av?.colours?.hair ?? av?.hair;        // (v2, or an old copy's v1)
if (want('switch')) {
  console.log('\n6. the testing switch, and bugs A and B');
  if (!otherRoot) {
    const it = item('hair', 'platinum');
    check(W.canWear(it, 'm') && W.unlockedForTesting(it) && !W.ownsFrom([])('hair.platinum'), 'switch on (today): an unlockable item is wearable without owning it, marked "unlocked for testing"; owning it is still real ownership');
    check(!W.canWear(item('neck', 'none'), 'm') && !W.canWear(item('face', 'clara'), 'm'), '...but never a held-back item (the open collar) or one meant for another body');
  }
  const off = await srcWith({ root: otherRoot || repo, unlockAll: false });
  try {
    const OW = off.W;
    if (!otherRoot) {
      const it = OW.item('hair', 'platinum'), owns = OW.ownsFrom(['hair.platinum']);
      check(OW.UNLOCK_ALL_FOR_TESTING === false && !OW.canWear(it, 'm') && OW.canWear(it, 'm', owns) && !OW.unlockedForTesting(it), 'switch off: not owned, locked; owned, wearable; no "for testing" note');
      check(OW.normaliseAvatar(OW.withItem(OW.LOOKS.victor, 'hair', 'platinum', { trusted: true })).colours.hair === 'black'
        && OW.normaliseAvatar(OW.withItem(OW.LOOKS.victor, 'hair', 'platinum', { trusted: true }), { owns }).colours.hair === 'platinum', 'switch off: a saved unlockable not owned falls back at the next load; an owned one stays');
      const free = [...BASE_IDS.map(id => LOOKS[id]), ...Array.from({ length: 60 }, (_, k) => randomAvatar(`free${k}`, { unlockables: false }))];
      check(free.every(av => same(OW.normaliseAvatar(av), normaliseAvatar(av)) && OW.avatarKey(av) === W.avatarKey(av)), 'switch off changes nothing else: the same safe avatars and keys for free looks');
      check(OW.ITEMS.filter(i => !OW.isFree(i)).every(i => !OW.canWear(i, i.bodies[0])), 'switch off: every achievement and Boutique item is locked (nothing owned)');
    }
    // bug A: an owned item worn was taken off at every load (owns() asked before the profile was read)
    const v1 = { version: 1, id: 'local-0123456789abcdef', username: 'nora', inventory: ['hair.platinum'],
      avatar: { v: 1, base: 'marcus', skin: 'tan', hair: 'platinum', eyes: 'classic', glasses: 'none', frame: 'tortoise', main: 'midnight', accent: 'claret', metal: 'gold' },
      createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', nameChangedAt: '2026-10-12T00:00:00.000Z' };
    const store = off.A.memoryStore(JSON.stringify(v1));
    const acct = off.A.createAccount({ store });
    check(hairOf(acct.profile?.avatar) === 'platinum' && hairOf(JSON.parse(store.load()).avatar) === 'platinum', `bug A: an owned item worn (Platinum hair) is kept when the profile loads, and saved back with it (${hairOf(acct.profile?.avatar)})`);
    // ...and from another tab: its save brings a new inventory and the item worn
    let fire = null;
    const tabStore = { ...off.A.memoryStore(JSON.stringify({ ...v1, inventory: [], avatar: { ...v1.avatar, hair: 'black' } })), watch: fn => { fire = fn; return () => {}; } };
    let text = tabStore.load();
    tabStore.load = () => text; tabStore.save = t => { text = t; return true; };
    const tab = off.A.createAccount({ store: tabStore });
    text = JSON.stringify(v1);
    fire?.();
    check(hairOf(tab.profile?.avatar) === 'platinum', `bug A, another tab: a save with a new inventory keeps its owned item (${hairOf(tab.profile?.avatar)})`);
    // bug B: every seat was made safe with free items only, so an owned item never showed in a match
    const seats = off.T.seatTable({ me: { username: 'nora', avatar: acct.profile?.avatar }, seat: 0 });
    check(hairOf(seats[0].avatar) === 'platinum', `bug B: the owned item stays on at the table (${hairOf(seats[0].avatar)})`);
    if (!otherRoot) {
      const bots = off.T.botAvatars(Array.from({ length: 60 }, (_, k) => `bot${k}`), { avoid: [] });
      check(bots.some(b => unlockablesWorn(b) > 0), "switch off: bots still wear unlockable items (seated trusted), so a rare item never shows who is a person");
    }
  } finally { off.done(); }
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('bots')) {
  console.log("\n7. the computer guests' looks");
  W.usePartIndex();
  const names = ['nightowl', 'fennel', 'velvet_owl', 'brass_lark', 'Mabel', 'cardboardknight', 'grumpy_otter', 'pocketfox', 'echo_echo', 'bramble', 'hollow_reed', 'plum'];
  check(names.every(nm => same(randomAvatar(nm), randomAvatar(nm))), 'the same name always gives the same look');
  let alike = 0, mine = 0, hidden = 0, unsafe = 0, pending = 0, worn = 0, n = 0, women = 0, lowEye = 0, backAgain = 0;
  const lookKeys = new Set(BASE_IDS.flatMap(id => W.partKeysFor(LOOKS[id]).parts));
  const belowGate = a => W.partKeysFor(a).parts.some(k => W.redEyeScore(k) < W.RED_EYE_GATE && !lookKeys.has(k));
  // (the pieces the both-eye test kept off bots before the owner's nearer-eye rule: the Wavy bob on Clara's and on
  // Eleanor's face, the chignon on Beatrice's)
  const RETURNED = ['f/hairStyle_wavyBob', 'f/hairStyle_wavyBob~face_eleanor', 'f/hairStyle_chignon~face_beatrice'];
  const faces = new Set(), mixes = [0, 0];
  const pool = Array.from({ length: 84 }, (_, i) => `guest${i}_${(i * 7919) % 97}`);
  for (let t = 0; t < 2000; t++) {
    const me = t % 4 === 0 ? normaliseAvatar(LOOKS[BASE_IDS[t % 6]]) : normaliseAvatar(randomAvatar(`player${t}`));
    const us = Array.from({ length: 3 + (t % 3) }, (_, k) => pool[(t * 11 + k * 17) % pool.length]);
    const avs = tableAvatars(us, { taken: [me] });
    for (let i = 0; i < avs.length; i++) {
      const a = avs[i];
      n++;
      if (avs.some((b, j) => j > i && W.lookAlike(a, b))) alike++;
      if (W.lookAlike(a, me)) mine++;
      if (!W.eyesShow(a)) hidden++;
      if (belowGate(a)) lowEye++;
      if (W.partKeysFor(a).parts.some(k => RETURNED.includes(k))) backAgain++;
      if (!same(normaliseAvatar(a, { trusted: true }), a)) unsafe++;
      if ([...W.SLOTS_BY_GENDER[W.genderOf(a.body)].map(s => item(s, a[s])), ...a.extras.map(x => item('extra', x))].some(it => W.isPending(it, a.body))) pending++;
      worn += unlockablesWorn(a);
      if (W.genderOf(a.body) === 'f') women++;
      faces.add(a.face);
      mixes[W.lookOf(a) ? 0 : 1]++;
    }
  }
  check(alike === 0, `2000 tables: never two guests alike (same body, hairstyle and jacket or dress, a main colour a colour-blind player could confuse) (${alike})`);
  check(mine === 0, `never a bot like you (${mine})`);
  check(hidden === 0 && pending === 0, `the eyes always show: no red-like eye colour, no lens, never a pending piece (${hidden} / ${pending})`);
  // the red-eye test's results (partsIndex.js, written by manifest.py from review.mjs --record): scored on the eye
  // NEAREST the camera (redEyeNear, the owner's rule of 19 Oct 2026; a piece measured before it: the both-eye redEye).
  // A piece file below the gate is never on a bot, unless it is a classic Look's own (today's guest unchanged).
  const RE = PART_INDEX.redEye || {}, NEAR = PART_INDEX.redEyeNear || {};
  const scored = Object.keys(RE), low = scored.filter(k => W.redEyeScore(k) < W.RED_EYE_GATE).sort();
  const tr = { trusted: true };
  const bobOn = look => W.withItem(LOOKS[look], 'hairStyle', 'wavyBob', tr);
  check(lowEye === 0 && BASE_IDS.every(id => W.eyesShow(LOOKS[id])),
    `no bot wears a piece below the red-eye gate ${W.RED_EYE_GATE} on the nearer eye (${lowEye}); every classic Look passes (below: ${low.join(', ') || 'none'})`);
  // every built piece the test applies to (contract 9.3: all but legs, feet, belts and the body) carries a result:
  // the gate lets an unmeasured piece through, so a piece shipped without its review.mjs --record run shows here
  const tested = Object.entries(PART_INDEX.parts || {}).flatMap(([b, keys]) => keys.map(k => `${b}/${k}`)).filter(k => !/\/(legs|feet|belt)_/.test(k) && !/\/body$/.test(k));
  const unmeasured = tested.filter(k => W.redEyeScore(k) === undefined);
  check(!unmeasured.length, `every built piece the red-eye test applies to has its result recorded (${tested.length - unmeasured.length} of ${tested.length})${unmeasured.length ? ` (not yet: ${unmeasured.join(', ')})` : ''}`);
  const unscored = scored.filter(k => typeof NEAR[k] !== 'number');
  check(Object.keys(NEAR).length > 0 && unscored.every(k => RE[k] >= W.RED_EYE_GATE),
    `the nearer-eye score is recorded for ${Object.keys(NEAR).length} of ${scored.length} measured piece files; any without it pass on the stricter both-eye score${unscored.length ? ` (${unscored.join(', ')})` : ''}`);
  check(RETURNED.every(k => NEAR[k] >= W.RED_EYE_GATE) && W.eyesShow(bobOn('clara')) && W.eyesShow(bobOn('eleanor')) && W.eyesShow(W.withItem(LOOKS.beatrice, 'hairStyle', 'chignon', tr)),
    `the nearer-eye rule lets the Wavy bob on Clara's and Eleanor's faces and the chignon on Beatrice's back (nearer eye ${RETURNED.map(k => NEAR[k]).join(' / ')}; both eyes ${RETURNED.map(k => RE[k]).join(' / ')}, reported)`);
  check(backAgain > 0, `...and bots wear them again (${backAgain} of ${n} bots over 2000 tables)`);
  W.usePartIndex({ ...PART_INDEX, redEyeNear: { ...NEAR, 'f/hairStyle_wavyBob': 0.5 } });
  check(!W.eyesShow(bobOn('clara')) && W.eyesShow(LOOKS.beatrice), '(the control: a piece whose NEARER eye is hidden is kept off; a classic Look\'s own piece never is)');
  const noNear = { ...NEAR }; delete noNear['f/hairStyle_wavyBob'];
  W.usePartIndex({ ...PART_INDEX, redEyeNear: noNear });
  check(!W.eyesShow(bobOn('clara')) === (RE['f/hairStyle_wavyBob'] < W.RED_EYE_GATE), '(a piece measured before the nearer-eye rule falls back to its both-eye score)');
  W.usePartIndex({ ...PART_INDEX, redEye: {}, redEyeNear: {} });
  check(W.eyesShow(bobOn('clara')), '...and with no red-eye results recorded, nothing is kept off by them');
  W.usePartIndex();
  check(unsafe === 0, "every bot's avatar is already safe (seated trusted, nothing to repair)");
  check(worn / n > 0.28 && worn / n < 0.39, `about one bot in three wears an unlockable item (${(worn / n).toFixed(3)} a bot, ${n} bots)`);
  check(women / n > 0.42 && women / n < 0.58, `both bodies (${Math.round(100 * women / n)} % women)`);
  check(BASE_IDS.every(id => faces.has(id)) && mixes[0] > n * 0.05 && mixes[1] > n * 0.4, `every classic face worn; classic Looks and mixes of pieces (${mixes[0]} / ${mixes[1]})`);
  const firsts = Array.from({ length: 300 }, (_, k) => randomAvatar(`newplayer${k}`, { unlockables: false }));
  check(firsts.every(a => unlockablesWorn(a) === 0), "a new player's first look (rolled from the name) wears free items only");
  // the men's new pieces built (as once the pipeline has run): bots wear them, still never alike
  W.usePartIndex({ v: 1, bodies: ['m'], parts: { m: ['body', 'face_victor', 'face_marcus', 'face_henry', 'hairStyle_swept', 'hairStyle_sideSwept', 'hairStyle_quiff', 'hairStyle_sidePart', 'hairStyle_curlyCrop',
    'facial_handlebar', 'facial_pencil', 'top_tux', 'top_lounge', 'top_dinner', 'top_waistcoat', 'neck_bow', 'neck_tie', 'neck_bowFull', 'legs_trousers', 'legs_blackTrousers', 'feet_derby'] }, tris: {}, builtInGlasses: {} });
  let newWorn = 0, clash2 = 0;
  for (let t = 0; t < 400; t++) {
    const avs = tableAvatars(Array.from({ length: 5 }, (_, k) => `m${t}_${k}`), { taken: [normaliseAvatar(randomAvatar(`p${t}`))] });
    if (avs.some((a, i) => avs.some((b, j) => j > i && W.lookAlike(a, b)))) clash2++;
    newWorn += avs.filter(a => ['sidePart', 'curlyCrop'].includes(a.hairStyle) || a.facial === 'pencil' || a.top === 'waistcoat').length;
  }
  check(newWorn > 200 && clash2 === 0, `with the new men's pieces built, bots wear them (${newWorn} of 2000) and are still never alike`);
  W.usePartIndex();
}

// ---------------------------------------------------------------------------------------------------------------------
if (want('game')) {
  console.log("\n8. what the game reads, and the wardrobe's helpers");
  W.usePartIndex(EMPTY_INDEX);
  const p = W.paletteHex(LOOKS.clara);
  check(p.skin === item('skin', 'rosy').value && p.lips === item('skin', 'rosy').lips && p.hair === item('hair', 'auburn').value && p.brow === item('hair', 'auburn').brow
    && p.main === item('main', 'claret').value && p.accent === item('accent', 'claret').value && p.metal === item('metal', 'gold').value && p.frame === item('frame', 'tortoise').value,
  "paletteHex: the colours' own hex; lips 'natural' = the skin tone's lip colour; brows from the hair colour");
  check(W.paletteHex({ ...LOOKS.victor, glasses: 'gilt' }).frame === item('glasses', 'gilt').frameHex, 'Gold frames paint with their own fixed gold');
  const brown = W.withItem(LOOKS.marcus, 'eyes', 'brownEyes'), hazel = W.withItem(LOOKS.clara, 'eyes', 'hazel'), green = W.withItem(LOOKS.clara, 'eyes', 'green');
  const clearB = W.displayAvatar(brown, { clearEyes: true });
  check(clearB.colours.eyes === 'classic' && W.displayAvatar(hazel, { clearEyes: true }).colours.eyes === 'classic' && same({ ...clearB, colours: { ...clearB.colours, eyes: 'brownEyes' } }, brown),
    'Clearer possessed eyes on: brown and hazel eyes show as classic dark eyes, nothing else changes');
  check(W.displayAvatar(green, { clearEyes: true }) === green && W.displayAvatar(brown, { clearEyes: false }) === brown && W.displayAvatar(brown) === brown && brown.colours.eyes === 'brownEyes',
    'other eye colours, and the setting off, leave the avatar as it is (the profile keeps the true colour)');
  const v = LOOKS.victor;
  check(W.lookAlike(v, { ...v }) && W.lookAlike(v, W.withItem(v, 'main', 'plum')) && !W.lookAlike(v, W.withItem(v, 'main', 'ivory'))
    && !W.lookAlike(v, W.withItem(v, 'hairStyle', 'quiff')) && !W.lookAlike(v, W.withItem(v, 'top', 'lounge')) && !W.lookAlike(v, LOOKS.clara),
  'lookAlike: the same pieces in midnight and plum are alike; in ivory, or another hairstyle, jacket or body, not');
  check(W.coloursClose('#5a1e2c', '#36524f') && !W.coloursClose('#5a1e2c', '#36524f', 5), 'claret and emerald, which a red-green colour-blind player can confuse, count as close');
  check(BASE_IDS.every(a => BASE_IDS.every(b => W.lookAlike(LOOKS[a], LOOKS[b]) === (a === b))), 'the six classic Looks are never alike to each other');
  check(['tuxedo', 'suit', 'dinnerJacket', 'dressBurgundy', 'dressMidnight', 'dressEmerald'].every((o, i) => W.outfitOf(LOOKS[BASE_IDS[i]]) === o)
    && W.outfitOf(W.withItem(v, 'top', 'waistcoat', { trusted: true })) === 'tuxedo', 'outfitOf: the legacy outfit of each Look');
  check(W.shippedPortraitFor(W.withItem(LOOKS.marcus, 'hairStyle', 'quiff'), true) === 'assets/portraits/marcus-possessed.jpg' && W.shippedPortraitFor(LOOKS.beatrice) === 'assets/portraits/beatrice.jpg',
    "the stock picture follows the face (the Look whose face it is)");
  check(same(W.avatarFromGuest('p6'), LOOKS.clara) && W.avatarFromGuest('random') === null && same(W.avatarFromGuest('Henry'), LOOKS.henry), "last round's guest choice gives that Look (p6 Clara, Henry); Random none");
  // the wardrobe's helpers
  const order = ['skin', 'hair', 'eyes', 'glasses', 'frame', 'main', 'accent', 'metal'];
  const rows = av => order.filter(s => W.slotsFor(av).includes(s)).join();
  check(rows(v) === 'skin,hair,eyes,glasses,main,accent' && rows(W.withItem(LOOKS.eleanor, 'glasses', 'round')) === 'skin,hair,eyes,glasses,frame,main,metal' && rows(LOOKS.clara) === 'skin,hair,eyes,glasses,main,accent,metal',
    "the wardrobe's colour rows as today: Tuxedo (no Frame without glasses), Ballgown with glasses (Frame, Jewellery, no Accent), Column dress (Accent: the sash)");
  const toF = W.withBody(W.withItem(W.withItem(LOOKS.marcus, 'skin', 'deep'), 'glasses', 'oval'), 'f');
  check(toF.face === 'eleanor' && toF.dress === 'ballgown' && toF.colours.skin === 'deep' && toF.glasses === 'oval' && W.withBody(toF, 'm').face === 'marcus',
    'Female: the Look at the same place (Suit and tie -> Ballgown), colours and glasses kept; and back');
  const look = W.applyLook(W.withItem(v, 'hair', 'copper'), 'henry', { keepColours: true });
  check(look.face === 'henry' && look.colours.hair === 'copper' && W.lookOf(look) === 'henry' && W.applyLook(v, 'henry').colours.hair === 'silver', 'a classic Look: its pieces, the colours kept or its own');
  const toggled = W.withItem(W.withItem(LOOKS.clara, 'extra', 'goldBall'), 'extra', 'goldBall');
  check(same(W.withItem(LOOKS.clara, 'extra', 'goldBall').extras, ['goldBall']) && same(toggled.extras, []), 'an extra toggles, replacing the one at its attach point');
  check(W.lookOf(W.withItem(v, 'hairStyle', 'quiff')) === null && W.lookOf(W.withItem(v, 'glasses', 'round')) === 'victor', 'lookOf: a mix of pieces is no classic Look; glasses and colours do not count');
  const offeredGlasses = ['none', 'round', 'oval', 'deco', 'pincenez', 'monocle', 'gilt'].filter(id => !item('glasses', id).artPending).join();
  check(W.itemsFor('glasses', 'm').map(it => it.id).join() === offeredGlasses && W.itemsFor('hair', 'f').length === 8, `itemsFor: what is offered on a body, in order, no held-back item (${offeredGlasses})`);
  W.usePartIndex();
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
