// The Wardrobe: the avatar screen of the main menu (#menu-avatar; src/ui/menu.js shows it as 'avatar'; the look:
// wardrobe.css). Over the live 3D lobby, where your guest stands large by the lift (src/menu/lobbyScene.js: the
// wardrobe camera), three parts:
//   - left, the RAIL: one brass key fob per area (Body, Face, Hair, Moustache or Make-up, Eyewear, Outfit, Extras,
//     Looks: src/ui/wardrobe/areas.js); a dot on a fob = new items there not seen yet;
//   - middle, the STAGE: your name (the pencil: Change name), the Hotel Honours pill (src/ui/honours.js), Undo and
//     Surprise me, and your guest: the camera comes close for the face, hair, moustache and eyewear, to the knees for
//     the extras, full length for the rest; drag (or the arrow keys) to turn the guest round;
//   - right, the PANEL: the area's tabs, a colour row and a grid of picture tiles (the pictures:
//     assets/characters/parts/thumbs/, made by tools/char-pipeline/parts/thumbs.mjs; a placeholder until one is
//     made), then Cancel and Save look.
// Tap a tile and the guest wears it at once (a try-on: nothing is saved until Save look). Each tile says what the item
// is to you: Wearing, Yours, NEW, an Achievement item (a rosette, the task and how far you have come: "2 of 3
// Lanterns"), a Boutique item (a champagne frame: "Opens later"). An item that is not yours opens a details card
// (how to get it; "See achievement" opens the Hotel Honours page at it). While the catalogue's testing switch is on
// (src/data/wardrobe.js UNLOCK_ALL_FOR_TESTING) every item can be worn and kept, and its tile still shows what it will
// be, with a small "unlocked for testing" note. With the switch off an item that is not yours can be tried on but not
// kept: Save look asks to take it off first ("Trying on" shows on the stage meanwhile).
// Looks: the six classic guests as ready-made looks (one tap wears one) and three of your own (save, rename, wear,
// delete: src/account/account.js). Undo goes back one change (up to 20); Surprise me mixes owned pieces only, and
// only into a look whose eyes show (src/ui/wardrobe/surprise.js). Cancel puts back the look you came in with (it asks
// first when more than one thing changed). Plain words, no emoji; every target is at least 44 px; at 1024 x 694 the
// page never scrolls (only the grid does). Nothing here touches the game: cosmetics never change play or show a role.
import { unlockedForTesting, COLOUR_SLOTS, SLOTS_BY_GENDER, LOOKS, LOOK_LABELS, genderOf, item, itemId, itemsFor, labelOf,
  descOf, attachOf, isFree, canWear, normaliseAvatar, withItem, withBody, slotsFor, avatarKey, geometryKey,
  availableBodies, shippedPortraitFor, ATTACH } from '../../data/wardrobe.js';
import { ACHIEVEMENTS, achievement } from '../../data/achievements.js';
import { THUMBS } from '../../data/thumbsIndex.js';
import { lookSummary, presetLooks } from '../../account/looks.js';
import { CUES } from '../../audio/sounds.js';
import { sfx } from '../../audio/bus.js';
import { reducedMotion } from '../../motion.js';
import { tooSoon } from '../tapGuard.js';
import { watchDialog } from '../focus.js';
import { AREAS, areasFor, areaById, tabsFor, ATTACH_LABELS, ROW_LABELS, WARDROBE_CUES, progressText } from './areas.js';
import { ensureIcons, ic } from './icons.js';
import { surprise } from './surprise.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const copy = v => JSON.parse(JSON.stringify(v));
const UNDO_MAX = 20;
const LOOK_UNDO_MS = 8000;                              // a Look saved over or deleted: its Undo shows this long
const SEEN_KEY = 'hotelEscape.wardrobeSeen.v1';        // the NEW items this device has shown (their tag then goes)
const TURNED_KEY = 'hotelEscape.wardrobeTurned.v1';    // the "Drag to turn" hint goes after the first turn
const TURN_BACK_MS = 3000;                              // let go: the guest turns back to face you after this
const MAX_TURN = Math.PI;                               // up to a full turn round, either way
const THUMB_DIR = 'assets/characters/parts/thumbs/';
const SLOT_WORDS = {
  face: 'Face', hairStyle: 'Hairstyle', facial: 'Moustache', makeup: 'Make-up', glasses: 'Eyewear', top: 'Jacket',
  neck: 'Neckwear', legs: 'Trousers', dress: 'Gown', belt: 'Belt', feet: 'Shoes', extra: 'Extra', skin: 'Skin tone',
  hair: 'Hair colour', eyes: 'Eye colour', frame: 'Frame colour', main: 'Cloth colour', accent: 'Accent colour',
  metal: 'Metal', lips: 'Lips',
};
const store = {
  get(key) { try { return JSON.parse(globalThis.localStorage?.getItem(key) || 'null'); } catch { return null; } },
  set(key, v) { try { globalThis.localStorage?.setItem(key, JSON.stringify(v)); } catch { /* the device keeps nothing: fine */ } },
};
// A cue of the mix table (src/audio/sounds.js), or a near one that is there.
const NEAR = { snip: 'cardFlip', rustle: 'tradeSwap', clink: 'tick' };
const cue = name => (CUES[name] ? name : CUES[NEAR[name]] ? NEAR[name] : 'click');
const isColour = slot => COLOUR_SLOTS.includes(slot);

// The picture of an item on a body ('m/hairStyle_swept'), or null (none made yet: the placeholder shows).
export function thumbFor(body, slot, id) {
  const keys = [`${body}/${slot}_${id}`, `${genderOf(body)}/${slot}_${id}`];
  for (const k of keys) if (THUMBS[k]) return `${THUMB_DIR}${k}.webp?v=${THUMBS[k]}`;
  return null;
}

export function createWardrobe(doc, { account, honours = null, onPreview, onDone, onRename, onShot, onTurn, onHonours,
  preload = () => {}, portraitUrl = null } = {}) {
  const $ = id => doc.getElementById(id);
  const host = $('menu-avatar');
  const menuRoot = $('menu');
  const el = {
    rail: $('wd-rail'), stage: $('wd-stage'), drag: $('wd-drag'), name: $('av-name'), note: $('av-note'),
    pill: $('btn-wd-honours'), pillCount: $('wd-honours-count'), tryon: $('wd-tryon'), turn: $('wd-turn'), fitting: $('wd-fitting'),
    undo: $('btn-wd-undo'), surprise: $('btn-wd-surprise'), rename: $('btn-av-rename'),
    panel: $('wd-panel'), kicker: $('wd-kicker'), title: $('wd-title'), count: $('wd-count'), tabs: $('wd-tabs'), row: $('wd-row'),
    grid: $('av-body'), foot: $('wd-foot'), cancel: $('btn-wd-cancel'), save: $('btn-wd-save'), card: $('wd-card'),
    ask: $('wd-ask'), curtain: $('wd-curtain'),
  };
  if (!host || !el.grid || !el.rail) return { open() {}, close() { return Promise.resolve(); }, get isOpen() { return false; }, debug: () => null };
  ensureIcons(doc);

  // ---- state ----
  let working = null, saved = null, isOpen = false, openedAt = 0, previewSeq = 0, loading = false, previewBad = false;
  let area = 'hair';
  const tabOf = {};                 // area -> the tab chosen there
  let undo = [];                    // earlier avatars (the newest last)
  let card = null;                  // { slot, id, before } the details card's item
  let cardShown = null;             // (the item the card on screen is about)
  let ask = null;                   // { kind: 'save' | 'cancel', items } the footer's question
  let lookEdit = null;              // { slot, mode: 'rename' | 'delete' | 'over', error }
  let lookNote = '';                // a line under the Looks ("Not yours: the Monocle; your own frames are worn instead")
  let lookUndo = null;              // { slot, previous, words, timer } a Look just saved over or deleted: its Undo
  let capNote = '';                 // on the stage: an extra or the glasses that did not fit with everything else worn
  let capTimer = 0;
  let resume = false;               // Change name was pressed: the look being chosen waits for the screen to come back
  let shot = 'full';
  const seen = new Set(store.get(SEEN_KEY) || []);
  const seenNow = new Set();        // NEW items shown since this screen opened (they lose the tag when it closes)

  const owns = id => !!account?.owns?.(id);                 // REAL ownership: free, or in the inventory
  const tryAll = () => true;                                // the stage may show anything offered (a try-on)
  const norm = av => normaliseAvatar(av, { owns: tryAll });
  const gender = () => genderOf(working?.body);
  const body = () => working?.body || 'm';
  const owned = it => !!it && (isFree(it) || owns(itemId(it)));
  const keepable = it => !!it && canWear(it, body(), owns);  // can be saved (the switch on: everything offered)
  const progressOf = id => { try { return honours?.progressOf?.(id) || null; } catch { return null; } };

  // ---- what is worn ----
  function wornValue(slot) {
    if (slot === 'gender') return gender();
    if (isColour(slot)) return working.colours[slot];
    return working[slot];
  }
  const isWorn = (slot, id) => (slot === 'extra' ? working.extras.includes(id) : wornValue(slot) === id);
  // Every item the stage shows, with its slot ('extra' for extras): the pieces, the extras and the colours it uses.
  function wornItems(av = working) {
    const g = genderOf(av.body), shown = slotsFor(av);
    const list = SLOTS_BY_GENDER[g].map(s => item(s, av[s])).filter(Boolean);
    for (const x of av.extras) { const it = item('extra', x); if (it) list.push(it); }
    for (const s of COLOUR_SLOTS) if (shown.includes(s) || s === 'skin' || s === 'eyes' || s === 'hair') { const it = item(s, av.colours[s]); if (it) list.push(it); }
    return list;
  }
  // Worn and not yours to keep (only ever with the testing switch off): what "Trying on" names.
  const tryingOn = (av = working) => wornItems(av).filter(it => !keepable(it));

  // ---- the stage's guest ----
  function preview() {
    const seq = ++previewSeq;
    let r = null;
    try { r = onPreview?.(working); } catch (err) { console.warn('wardrobe preview failed:', err); }
    loading = !!(r && typeof r.then === 'function');
    renderStage();
    if (!loading) return;
    r.then(ok => {
      if (seq !== previewSeq) return;
      loading = false;
      if (ok === true || ok === false) previewBad = !ok;
      if (isOpen) { renderStage(); renderNote(); }
    }, () => { if (seq === previewSeq) { loading = false; previewBad = true; if (isOpen) { renderStage(); renderNote(); } } });
  }
  // A change: remembered for Undo, shown at once.
  function change(next, { sound = null, keepCard = false } = {}) {
    const n = norm(next);
    if (avatarKey(n) === avatarKey(working)) return false;
    undo.push(working);
    if (undo.length > UNDO_MAX) undo.shift();
    working = n;
    if (!keepCard) card = null;
    ask = null; lookNote = ''; lookEdit = null; capNote = '';
    if (sound) sfx(cue(sound));
    preview();
    render();
    return true;
  }
  // The guest's triangle cap (src/data/wardrobe.js normaliseAvatar) takes extras, then the glasses, off a look that
  // would be too heavy to draw. Said on the stage in plain words, never silently: what did not go on, or what came off.
  function capWords(before, after, slot, id, wasWorn) {
    const b = before.body, name = x => labelOf(x, b);
    const tapped = item(slot === 'extra' ? 'extra' : slot, id);
    const putOn = (slot === 'extra' && !wasWorn) || (slot === 'glasses' && !wasWorn && id !== 'none');
    if (putOn && tapped && !(slot === 'extra' ? after.extras.includes(id) : after.glasses === id)) {
      return { denied: true, words: `Too much at once to add the ${name(tapped)}: take off your ${slot === 'glasses' ? 'extras' : 'glasses or another extra'} first.` };
    }
    const at = slot === 'extra' && tapped ? attachOf(tapped, b) : null;
    const lost = before.extras.filter(x => x !== id && !after.extras.includes(x) && !(at && attachOf(item('extra', x), b) === at)).map(x => item('extra', x)).filter(Boolean);
    if (slot !== 'glasses' && before.glasses !== 'none' && after.glasses === 'none') { const g = item('glasses', before.glasses); if (g) lost.push(g); }
    if (!lost.length) return null;
    const list = lost.map(name);
    const what = list.length === 1 ? list[0] : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
    return { denied: false, words: `Your ${what} came off to make room: a guest can’t wear everything at once.` };
  }
  function showCap(words) {
    capNote = words;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { if (capNote === words) { capNote = ''; renderNote(); } }, 7000);
    renderNote();
  }

  // ---- the camera follows the area ----
  function setShot(next, { force = false } = {}) {
    if (!force && next === shot) return;
    shot = next;
    try { onShot?.(shot); } catch (err) { console.warn('wardrobe camera:', err); }
  }

  // ---- render: the rail ----
  function newIn(areaId) {
    return tabsFor(areaId, gender()).some(t => t.sections.some(sec => itemsOfSection(sec).some(it => it.isNew && !seen.has(itemId(it)))));
  }
  // (a part drawn anew keeps the keyboard's place: the same button, found again by its data)
  function keepFocus(box, attrs, draw) {
    const at = doc.activeElement;
    const had = at && box.contains(at) ? attrs.map(k => [k, at.getAttribute(k)]) : null;
    draw();
    if (!had) return;
    const sel = `button${had.map(([k, v]) => (v == null ? '' : `[${k}="${CSS.escape(v)}"]`)).join('')}`;
    const again = box.querySelector(sel);
    if (again) { try { again.focus({ preventScroll: true }); } catch { /* fine */ } }
  }
  function renderRail() { keepFocus(el.rail, ['data-area'], drawRail); }
  function drawRail() {
    const list = areasFor(gender());
    el.rail.innerHTML = list.map(a => {
      const on = a.id === area, dot = newIn(a.id);
      return `<button type="button" class="wd-fob${on ? ' on' : ''}" data-area="${a.id}" data-sfx="none"${on ? ' aria-current="true"' : ''}
        aria-label="${esc(a.label)}${dot ? ', new items' : ''}">${ic(a.icon)}<span class="wd-fob-l">${esc(a.label)}</span>${dot ? '<span class="wd-dot" aria-hidden="true"></span>' : ''}</button>`;
    }).join('');
  }

  // ---- the items of a section ----
  function itemsOfSection(sec, av = working) {
    const b = av?.body || 'm';
    if (sec.slot === 'gender' || sec.slot === 'saved' || sec.slot === 'look') return [];
    let list = itemsFor(sec.slot, b);
    if (sec.slot === 'lips' && list.length < 1) return [];
    // (owned first, then earned items, then the Boutique; the catalogue's order inside each)
    const rank = it => (owned(it) ? 0 : it.unlock === 'achievement' ? 1 : 2);
    list = list.map((it, i) => [it, i]).sort((a, b2) => rank(a[0]) - rank(b2[0]) || a[1] - b2[1]).map(x => x[0]);
    return list;
  }
  // The tabs of the area now (the ones with something in them).
  function tabsNow() {
    return tabsFor(area, gender()).filter(t => t.sections.some(sec => ['gender', 'saved', 'look'].includes(sec.slot) || itemsOfSection(sec).length));
  }
  function currentTab() {
    const tabs = tabsNow();
    return tabs.find(t => t.id === tabOf[area]) || tabs[0] || null;
  }

  // ---- render: a tile ----
  function tileState(slot, it) {
    const worn = isWorn(slot, it.id);
    const mine = owned(it);
    return { worn, mine, kind: isFree(it) ? 'free' : it.unlock, testing: !mine && unlockedForTesting(it, owns), locked: !mine && !keepable(it),
      isNew: it.isNew && !seen.has(itemId(it)) };
  }
  function art(slot, it, areaIcon) {
    if (isColour(slot)) return `<span class="wd-disc" style="background:${esc(discOf(it))}"></span>`;
    const src = thumbFor(body(), it.slot, it.id);
    if (src) return `<img src="${esc(src)}" alt="" draggable="false">`;
    return `<span class="wd-ph">${ic(areaIcon)}</span>`;
  }
  function discOf(it) {
    if (it.slot === 'eyes') {
      if (!it.value) return 'radial-gradient(circle at 38% 34%, #3a3440 0 8%, #120e14 9% 100%)';
      const [rim, mid, core] = it.value;
      return `radial-gradient(circle at 36% 30%, #fff8f0 0 9%, transparent 10%), radial-gradient(circle at 56% 62%, ${core} 0 22%, ${mid} 48%, ${rim} 76%)`;
    }
    if (it.slot === 'frame') return `radial-gradient(circle, #14161e 0 44%, ${it.value} 46% 72%, #14161e 74%)`;
    if (it.slot === 'lips') return item('skin', working.colours.skin)?.lips || '#b8546a';
    return it.value || '#777';
  }
  function statusOf(st, it) {
    if (st.worn && (st.mine || st.testing)) return 'Wearing';
    if (st.worn && st.locked) return 'Trying on';
    if (st.mine) return 'Yours';
    if (st.kind === 'achievement') return progressText(achievement(it.achievement), progressOf(it.achievement));
    return 'Opens later';
  }
  function tile(slot, it, areaIcon) {
    const st = tileState(slot, it);
    const name = labelOf(it, body());
    const cls = ['wd-tile', isColour(slot) ? 'colour' : 'piece'];
    if (st.worn) cls.push(st.locked ? 'trying' : 'wearing');
    if (!st.mine) cls.push(st.kind === 'achievement' ? 'ach' : 'boutique');
    if (st.testing) cls.push('testing');
    if (st.isNew) { cls.push('new'); seenNow.add(itemId(it)); }
    const ach = st.kind === 'achievement' && !st.mine ? achievement(it.achievement) : null;
    const prog = ach ? progressOf(ach.id) : null;
    let badges = '';
    if (st.worn && !st.locked) badges += `<span class="wd-check">${ic('i-check')}</span>`;
    else if (st.worn && st.locked) badges += '<span class="wd-ttag">Trying on</span>';
    else if (st.isNew && st.mine) badges += '<span class="wd-new">New</span>';
    if (!st.mine && st.kind === 'achievement') badges += `<span class="wd-lockb" title="Earned by an achievement">${ic('i-rosette')}</span>`;
    if (!st.mine && st.kind === 'boutique') badges += `${ic('i-corner', 'wd-corner tl')}${ic('i-corner', 'wd-corner tr')}<span class="wd-ribbon">Boutique</span>`;
    const bar = ach && ach.goal > 1 && !prog?.earned ? `<span class="wd-bar"><i style="width:${Math.max(4, Math.round(100 * Math.min(prog?.have || 0, ach.goal) / ach.goal))}%"></i></span>` : '';
    const status = statusOf(st, it);
    const kindWords = st.mine ? '' : st.kind === 'achievement' ? `, earned by an achievement${ach ? `: ${ach.label}, ${status}` : ', a later honour'}` : ', Boutique, opens later';
    const label = `${name}${st.worn ? (st.locked ? ', trying on' : ', wearing') : st.mine ? ', yours' : ''}${kindWords}${st.testing ? ', unlocked for testing' : ''}${st.isNew ? ', new' : ''}`;
    const sound = !st.mine && !st.worn ? cue(WARDROBE_CUES.tryOn) : cue(isColour(slot) ? WARDROBE_CUES.colour : WARDROBE_CUES[slot] || 'click');
    const pressed = slot === 'extra' || slot === 'glasses' ? ` aria-pressed="${st.worn}"` : '';
    return `<button type="button" class="${cls.join(' ')}" data-slot="${slot}" data-id="${esc(it.id)}" data-sfx="${sound}"${pressed}
      aria-label="${esc(label)}" title="${esc(st.mine ? descOf(it, body()) : `${name}: ${howWords(it)}${st.testing ? ' (unlocked for testing)' : ''}`)}">${badges}
      <span class="wd-pic">${art(slot, it, areaIcon)}${st.testing ? `<span class="wd-test">${ic('i-unlock')}Test</span>` : ''}</span>
      <span class="wd-txt"><span class="wd-nm">${esc(name)}</span><span class="wd-mt">${esc(status)}</span></span>${bar}</button>`;
  }
  // How an item is had, in a few words (the tile's tooltip, the card).
  function howWords(it) {
    if (owned(it)) return 'yours';
    if (it.unlock === 'achievement') { const a = achievement(it.achievement); return a ? `earned by the achievement ${a.label}: ${a.desc}` : 'earned by a later honour'; }
    return 'a Boutique piece; the Boutique opens later';
  }
  function genderTile(g) {
    const on = gender() === g;
    const b = availableBodies().find(x => genderOf(x) === g) || g;
    const src = THUMBS[`${b}/body`] ? `${THUMB_DIR}${b}/body.webp?v=${THUMBS[`${b}/body`]}` : null;
    const name = g === 'f' ? 'Woman' : 'Man';
    return `<button type="button" class="wd-tile piece body${on ? ' wearing' : ''}" data-slot="gender" data-id="${g}" data-sfx="${cue(WARDROBE_CUES.gender)}" aria-pressed="${on}"
      aria-label="${name}${on ? ', chosen' : ''}">${on ? `<span class="wd-check">${ic('i-check')}</span>` : ''}
      <span class="wd-pic">${src ? `<img src="${esc(src)}" alt="" draggable="false">` : `<span class="wd-ph">${ic('i-body')}</span>`}</span>
      <span class="wd-txt"><span class="wd-nm">${name}</span><span class="wd-mt">${on ? 'Chosen' : 'Yours'}</span></span></button>`;
  }

  // ---- render: the panel ----
  function sectionHtml(sec, a) {
    if (sec.slot === 'gender') return `${heading(sec.label)}${['m', 'f'].map(genderTile).join('')}`;
    if (sec.slot === 'saved') {
      const undoLine = lookUndo ? `<p class="wd-looknote wd-lookundo" role="status"><span>${esc(lookUndo.words)}</span>
        <button type="button" id="btn-wd-look-undo" class="wd-mini" data-act="undo-look" data-look="${lookUndo.slot}" data-sfx="click">${ic('i-undo')}Undo</button></p>` : '';
      return `${heading(sec.label, 'saved')}${[0, 1, 2].map(savedCard).join('')}${undoLine}${lookNote ? `<p class="wd-looknote" role="status">${esc(lookNote)}</p>` : ''}`;
    }
    if (sec.slot === 'look') return `${heading(sec.label)}${presetLooks().map(presetTile).join('')}`;
    const list = itemsOfSection(sec);
    if (!list.length) return '';
    if (sec.slot === 'extra') {
      // (grouped by where they sit, one at a time on each: the earrings together; where there is only one piece, the
      // pieces share a row, under their places' names)
      const word = at => { const w = ATTACH_LABELS[at]; return typeof w === 'string' ? w : w[gender()]; };
      const groups = ATTACH.map(at => ({ at, list: list.filter(it => attachOf(it, body()) === at) })).filter(g => g.list.length);
      const many = groups.filter(g => g.list.length > 1), single = groups.filter(g => g.list.length === 1);
      if (!many.length) return single.flatMap(g => g.list).map(it => tile('extra', it, a.icon)).join('') + '<p class="wd-sectionnote">Tap one you wear to take it off.</p>';
      const out = many.flatMap(g => [heading(word(g.at)), ...g.list.map(it => tile('extra', it, a.icon))]);
      if (single.length) out.push(heading(single.map(g => word(g.at)).join(' · ')), ...single.flatMap(g => g.list).map(it => tile('extra', it, a.icon)));
      return out.join('') + '<p class="wd-sectionnote">One in each place. Tap one you wear to take it off.</p>';
    }
    const extra = sec.slot === 'lips' ? '<p class="wd-sectionnote">More make-up comes later.</p>' : '';
    return `${sec.label && currentTab()?.sections.length > 1 ? heading(sec.label) : ''}${list.map(it => tile(sec.slot, it, a.icon)).join('')}${extra}`;
  }
  const heading = (words, cls = '') => `<div class="wd-sec${cls ? ` ${cls}` : ''}" role="presentation"><span>${esc(words)}</span></div>`;

  function presetTile(p) {
    const worn = geometryKey(working) === geometryKey(p.avatar) && avatarKey(working) === avatarKey(p.avatar);
    return `<button type="button" class="wd-tile piece look${worn ? ' wearing' : ''}" data-slot="look" data-id="${p.id}" data-sfx="${cue(WARDROBE_CUES.look)}"
      aria-label="${esc(p.name)}, ${esc(p.label)}${worn ? ', wearing' : ''}">${worn ? `<span class="wd-check">${ic('i-check')}</span>` : ''}
      <span class="wd-pic portrait"><img src="${esc(shippedPortraitFor(p.avatar))}" alt="" draggable="false"></span>
      <span class="wd-txt"><span class="wd-nm">${esc(p.name)}</span><span class="wd-mt">${esc(p.label)}</span></span></button>`;
  }
  function savedCard(slot) {
    const look = account?.looks?.[slot] || null;
    const edit = lookEdit?.slot === slot ? lookEdit : null;
    if (!look) {
      return `<div class="wd-look empty" data-look="${slot}"><button type="button" class="wd-look-save" data-act="save" data-look="${slot}" data-sfx="none">
        <span class="wd-look-plus">${ic('i-plus')}</span><span><b>Save this look here</b><span class="wd-look-sub">Slot ${slot + 1} of 3 is free</span></span></button></div>`;
    }
    const pic = `<span class="wd-look-pic"><img data-portrait="${slot}" src="${esc(shippedPortraitFor(look.avatar))}" alt="" draggable="false"></span>`;
    if (edit?.mode === 'rename') {
      return `<div class="wd-look editing" data-look="${slot}">${pic}<form class="wd-look-form" data-look="${slot}" novalidate autocomplete="off">
        <label class="wd-look-k" for="wd-look-name">Name this look</label>
        <input id="wd-look-name" class="wd-look-input" type="text" maxlength="24" value="${esc(look.name)}" enterkeyhint="done" autocapitalize="words" spellcheck="false">
        ${edit.error ? `<span class="wd-look-err" role="alert">${esc(edit.error)}</span>` : ''}
        <span class="wd-look-btns"><button type="button" class="wd-mini" data-act="rename-cancel" data-look="${slot}">Cancel</button>
        <button type="submit" class="wd-mini primary" data-act="rename-ok" data-look="${slot}">Save name</button></span></form></div>`;
    }
    if (edit?.mode === 'delete' || edit?.mode === 'over') {
      const q = edit.mode === 'delete' ? `Delete “${esc(look.name)}”?` : `Save the look on the stage over “${esc(look.name)}”?`;
      return `<div class="wd-look asking" data-look="${slot}">${pic}<div class="wd-look-body"><b class="wd-look-q">${q}</b>
        <span class="wd-look-btns"><button type="button" class="wd-mini" data-act="keep" data-look="${slot}">Keep it</button>
        <button type="button" class="wd-mini primary" data-act="${edit.mode}-ok" data-look="${slot}">${edit.mode === 'delete' ? 'Delete' : 'Save over'}</button></span></div></div>`;
    }
    const worn = avatarKey(working) === avatarKey(look.avatar);
    return `<div class="wd-look${worn ? ' wearing' : ''}" data-look="${slot}">${pic}<div class="wd-look-body">
      <b class="wd-look-name">${esc(look.name)}</b><span class="wd-look-sub">${esc(lookSummary(look.avatar))}</span>
      <span class="wd-look-btns"><button type="button" class="wd-mini primary" data-act="wear" data-look="${slot}" data-sfx="none"${worn ? ' aria-pressed="true"' : ''}>${worn ? 'Wearing' : 'Wear'}</button>
      <button type="button" class="wd-mini icon" data-act="rename" data-look="${slot}" aria-label="Rename ${esc(look.name)}" title="Rename">${ic('i-pencil')}</button>
      <button type="button" class="wd-mini icon" data-act="over" data-look="${slot}" aria-label="Save the look on the stage over ${esc(look.name)}" title="Save the look on the stage here">${ic('i-save')}</button>
      <button type="button" class="wd-mini icon" data-act="delete" data-look="${slot}" aria-label="Delete ${esc(look.name)}" title="Delete">${ic('i-trash')}</button></span></div></div>`;
  }

  function renderTabs(tabs, tab) { keepFocus(el.tabs, ['data-tab'], () => drawTabs(tabs, tab)); }
  function drawTabs(tabs, tab) {
    if (tabs.length < 2) { el.tabs.hidden = true; el.tabs.innerHTML = ''; return; }
    el.tabs.hidden = false;
    el.tabs.innerHTML = tabs.map(t => {
      const n = t.sections.reduce((s, sec) => s + itemsOfSection(sec).length, 0);
      const on = t === tab;
      return `<button type="button" class="wd-tab${on ? ' on' : ''}" role="tab" id="wd-tab-${t.id}" aria-selected="${on}" tabindex="${on ? 0 : -1}" data-tab="${t.id}" data-sfx="none"
        aria-controls="av-body"><span class="l">${esc(t.label)}</span>${t.short ? `<span class="s">${esc(t.short)}</span>` : ''}${n ? `<span class="n">${n}</span>` : ''}</button>`;
    }).join('');
  }
  function rowSlotOf(tab) {
    if (!tab?.row) return null;
    const slot = typeof tab.row === 'function' ? tab.row(working, item('belt', working.belt)) : tab.row;
    if (!slot || !slotsFor(working).includes(slot)) return null;
    return slot;
  }
  function renderRow(tab) { keepFocus(el.row, ['data-slot', 'data-id'], () => drawRow(tab)); }
  function drawRow(tab) {
    const slot = rowSlotOf(tab);
    if (!slot) { el.row.hidden = true; el.row.innerHTML = ''; return; }
    const list = itemsOfSection({ slot });
    const cur = item(slot, working.colours[slot]);
    el.row.hidden = false;
    el.row.innerHTML = `<div class="wd-row-l"><span class="wd-row-k">${esc(tab.rowLabel || ROW_LABELS[slot] || slot)}</span><span class="wd-row-c">${esc(labelOf(cur, body()))}</span></div>
      <div class="wd-dots" role="radiogroup" aria-label="${esc(ROW_LABELS[slot] || slot)}" data-scrolls>${list.map(it => {
        const st = tileState(slot, it);
        const badge = st.mine ? '' : `<span class="wd-swb">${ic(it.unlock === 'achievement' ? 'i-rosette' : 'i-diamond')}</span>`;
        const words = `${labelOf(it, body())}${st.mine ? '' : it.unlock === 'achievement' ? ', earned by an achievement' : ', Boutique'}${st.testing ? ', unlocked for testing' : ''}`;
        return `<button type="button" class="wd-sw${st.worn ? ' on' : ''}${st.mine ? '' : ' unlockable'}" role="radio" aria-checked="${st.worn}" data-slot="${slot}" data-id="${esc(it.id)}"
          data-sfx="${st.mine || st.worn ? cue(WARDROBE_CUES.colour) : cue(WARDROBE_CUES.tryOn)}" aria-label="${esc(words)}" title="${esc(words)}"><span class="wd-sw-d" style="background:${esc(discOf(it))}"></span>${badge}</button>`;
      }).join('')}</div>`;
  }
  function renderHead(a, tab) {
    el.title.textContent = a.label;
    // "5 of 7 yours": the tiles of this tab that are really yours (free, or earned)
    const list = tab ? tab.sections.flatMap(sec => itemsOfSection(sec)) : [];
    if (a.id === 'looks') {
      const n = (account?.looks || []).filter(Boolean).length;
      el.count.innerHTML = `<b>${n}</b> of 3 saved`;
    } else if (list.length && !tab.sections.some(sec => sec.slot === 'gender')) {
      const mine = list.filter(owned).length;
      const words = list.every(it => isColour(it.slot)) ? 'colours yours' : 'yours';
      el.count.innerHTML = `<b>${mine}</b> of ${list.length} ${words}`;
    } else el.count.textContent = '';
  }
  function renderGrid(a, tab) { keepFocus(el.grid, ['data-slot', 'data-id', 'data-act', 'data-look'], () => drawGrid(a, tab)); }
  function drawGrid(a, tab) {
    const keep = el.grid.scrollTop;
    const html = tab ? tab.sections.map(sec => sectionHtml(sec, a)).join('') : '';
    el.grid.innerHTML = html || '<p class="wd-empty">Nothing to choose here yet.</p>';
    el.grid.classList.toggle('looks', a.id === 'looks');
    el.grid.setAttribute('aria-labelledby', tab && tabsNow().length > 1 ? `wd-tab-${tab.id}` : 'wd-title');
    el.grid.scrollTop = keep;
    // the saved looks' portraits, drawn by the game (the shipped picture of their face shows meanwhile)
    if (a.id === 'looks' && portraitUrl) {
      for (const img of el.grid.querySelectorAll('img[data-portrait]')) {
        const look = account?.looks?.[+img.dataset.portrait];
        if (!look) continue;
        Promise.resolve(portraitUrl(look.avatar)).then(u => { if (u && img.isConnected) img.src = u; }).catch(() => {});
      }
    }
  }
  function renderPanel() {
    const a = areaById(area) || AREAS[0];
    const tab = currentTab();
    renderHead(a, tab);
    renderTabs(tabsNow(), tab);
    renderRow(tab);
    renderGrid(a, tab);
    renderCard();
    renderAsk();
  }

  // ---- render: the details card (an item that is not yours) ----
  function renderCard() {
    if (!card) {
      // (closed with the keyboard's focus in it: the focus goes back to the tile, or the colour dot, it was about)
      const inCard = el.card.contains(doc.activeElement), was = cardShown;
      el.card.hidden = true; el.card.innerHTML = ''; el.panel.classList.remove('carded'); el.grid.style.paddingBottom = '';
      cardShown = null;
      if (inCard && was) {
        const back = host.querySelector(`#av-body button[data-slot="${was.slot}"][data-id="${CSS.escape(was.id)}"], #wd-row button[data-slot="${was.slot}"][data-id="${CSS.escape(was.id)}"]`);
        if (back) { try { back.focus({ preventScroll: true }); } catch { /* fine */ } }
      }
      return;
    }
    cardShown = { slot: card.slot, id: card.id };
    const it = item(card.slot === 'extra' ? 'extra' : card.slot, card.id);
    if (!it) { card = null; renderCard(); return; }
    const a = areaById(area) || AREAS[0];
    const name = labelOf(it, body());
    const ach = it.unlock === 'achievement' ? achievement(it.achievement) : null;
    const prog = ach ? progressOf(ach.id) : null;
    const testing = !owned(it) && unlockedForTesting(it, owns);
    const kicker = `${SLOT_WORDS[it.slot] || 'Item'} · ${it.unlock === 'achievement' ? 'Earned only' : 'Boutique'}`;
    let how;
    if (it.unlock === 'achievement') {
      const pct = ach ? Math.round(100 * Math.min(prog?.have || 0, ach.goal) / ach.goal) : 0;
      how = ach
        ? `<span class="wd-medal">${ic('i-rosette')}</span><div class="wd-how-b"><div class="wd-how-t">${esc(ach.desc)}</div>
           <div class="wd-how-s">Achievement “${esc(ach.label)}” · <b>${prog?.earned ? 'earned' : `${Math.min(prog?.have || 0, ach.goal)} of ${ach.goal}`}</b></div>
           <div class="wd-prog"><i style="width:${Math.max(3, pct)}%"></i></div></div>`
        : `<span class="wd-medal">${ic('i-rosette')}</span><div class="wd-how-b"><div class="wd-how-t">A later honour</div>
           <div class="wd-how-s">The achievement that earns it comes later. It is never sold.</div></div>`;
    } else {
      how = `<span class="wd-medal champagne">${ic('i-diamond')}</span><div class="wd-how-b"><div class="wd-how-t">The Boutique opens later</div>
        <div class="wd-how-s">Boutique pieces are bought, never earned.</div></div>`;
    }
    const pic = isColour(it.slot) ? `<span class="wd-disc big" style="background:${esc(discOf(it))}"></span>`
      : (thumbFor(body(), it.slot, it.id) ? `<img src="${esc(thumbFor(body(), it.slot, it.id))}" alt="">` : `<span class="wd-ph">${ic(a.icon)}</span>`);
    const right = ach ? `<button type="button" id="btn-wd-see" class="wd-btn grow" data-act="see" data-sfx="open">${ic('i-rosette')}See achievement</button>`
      : `<button type="button" id="btn-wd-keepon" class="wd-btn primary grow" data-act="close">${testing ? 'Keep it on' : 'Keep trying on'}</button>`;
    el.card.innerHTML = `<button type="button" id="btn-wd-card-close" class="wd-x" data-act="close" aria-label="Close">${ic('i-x')}</button>
      <div class="wd-card-top"><div class="wd-art${it.unlock === 'boutique' ? ' boutique' : ''}">${pic}</div>
        <div class="wd-info"><div class="wd-k">${esc(kicker)}</div><h3 id="wd-card-title">${esc(name)}</h3><div class="wd-d">${esc(descOf(it, body()))}</div></div></div>
      <div class="wd-how">${how}</div>
      ${testing ? `<div class="wd-testline">${ic('i-check')}Unlocked for testing: you can wear and keep it for now.</div>` : ''}
      <div class="wd-card-btns"><button type="button" id="btn-wd-takeoff" class="wd-btn ghost" data-act="takeoff">Take it off</button>${right}</div>`;
    el.card.setAttribute('aria-labelledby', 'wd-card-title');
    el.card.hidden = false;
    el.panel.classList.add('carded');
    // (the tile tried on stays in sight, above the card: the grid gets room to scroll it up)
    el.grid.style.paddingBottom = `${el.card.offsetHeight + 16}px`;
    const t = el.grid.querySelector(`.wd-tile[data-slot="${card.slot}"][data-id="${CSS.escape(card.id)}"], .wd-sw[data-slot="${card.slot}"][data-id="${CSS.escape(card.id)}"]`);
    if (t && el.grid.contains(t)) {
      const top = el.card.getBoundingClientRect().top, r = t.getBoundingClientRect(), g = el.grid.getBoundingClientRect();
      if (r.bottom > top - 6) el.grid.scrollTop += r.bottom - top + 10;
      else if (r.top < g.top) el.grid.scrollTop -= g.top - r.top + 6;
    }
  }
  // ---- render: the footer's question (Save with things not yours on; Cancel after several changes) ----
  function renderAsk() {
    if (!ask) { el.ask.hidden = true; el.ask.innerHTML = ''; el.foot.hidden = false; return; }
    el.foot.hidden = true;
    el.ask.hidden = false;
    if (ask.kind === 'save') {
      const n = ask.items.length;
      el.ask.innerHTML = `<p class="wd-ask-q">You’re trying on ${n === 1 ? `${esc(labelOf(ask.items[0], body()))}, which isn’t yours yet` : `${n} things that aren’t yours yet`}.</p>
        <div class="wd-ask-b"><button type="button" id="btn-wd-keeplooking" class="wd-btn ghost" data-act="ask-no">Keep looking</button>
        <button type="button" id="btn-wd-takesave" class="wd-btn primary" data-act="ask-yes" data-sfx="none">Take ${n === 1 ? 'it' : 'them'} off and save</button></div>`;
    } else {
      el.ask.innerHTML = `<p class="wd-ask-q">Put back the look you came in with?</p>
        <div class="wd-ask-b"><button type="button" id="btn-wd-keepchanging" class="wd-btn ghost" data-act="ask-no">Keep changing</button>
        <button type="button" id="btn-wd-putback" class="wd-btn primary" data-act="ask-yes" data-sfx="close">Put it back</button></div>`;
    }
  }

  // ---- render: the stage ----
  function renderStage() {
    if (el.name) { const n = account?.profile?.username || ''; el.name.textContent = n; el.name.title = n; }
    // the Honours pill: "Hotel Honours 1/5"
    if (el.pillCount && honours) {
      try {
        const h = honours.get();
        const n = Object.keys(h.earned || {}).length, total = ACH_TOTAL();
        el.pillCount.textContent = `${n}/${total}`;
        el.pill.setAttribute('aria-label', `Hotel Honours, ${n} of ${total} earned`);
      } catch { /* no storage: the pill still opens the page */ }
    }
    const trying = tryingOn();
    if (el.tryon) {
      el.tryon.hidden = !trying.length;
      // (two names at most: the box stays clear of the guest's head)
      const names = trying.map(it => labelOf(it, body()));
      const what = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`;
      el.tryon.innerHTML = trying.length ? `<span class="wd-tag">Trying on</span><b>${esc(what)}</b><span class="wd-muted">not yours yet</span>` : '';
      el.tryon.title = names.join(', ');
    }
    if (el.undo) { el.undo.disabled = !undo.length; el.undo.setAttribute('aria-label', undo.length ? 'Undo the last change' : 'Undo (nothing to undo)'); }
    if (el.fitting) el.fitting.hidden = !loading;
    el.stage.classList.toggle('close', shot === 'close');
    el.stage.classList.toggle('half', shot === 'half');
    el.stage.classList.toggle('turned', !!store.get(TURNED_KEY));
  }
  const ACH_TOTAL = () => ACHIEVEMENTS.length;
  function renderNote() {
    if (!el.note) return;
    el.note.textContent = account?.readOnly
      ? 'Hotel Escape has been updated: please reload the page. Until then, changes are not kept.'
      : account && account.persistent === false
        ? 'This device is not keeping your choices (private browsing?): they last until you close the page.'
        : previewBad ? 'Preview unavailable: your choices are still saved.' : capNote;
    el.note.hidden = !el.note.textContent;
  }
  function render() {
    if (!working) return;
    renderRail();
    renderPanel();
    renderStage();
    renderNote();
  }

  // ---- areas and tabs ----
  function goArea(id, { tab = null, sound = true } = {}) {
    const a = areaById(id);
    if (!a || (a.gender && a.gender !== gender())) return;
    if (id === area && (!tab || tab === currentTab()?.id)) return;
    markSeen();
    if (area !== id) el.grid.scrollTop = 0;
    area = id;
    if (tab) tabOf[area] = tab;
    card = null; ask = null; lookEdit = null; lookNote = ''; dropLookUndo();
    if (sound) sfx(cue(WARDROBE_CUES.area));
    setShot(a.shot);
    render();
    preloadArea();
  }
  function goTab(id) {
    if (currentTab()?.id === id) return;
    markSeen();
    tabOf[area] = id;
    card = null; ask = null;
    el.grid.scrollTop = 0;
    sfx(cue(WARDROBE_CUES.tab));
    renderPanel();
    renderRail();
    preloadArea();
  }
  // The area's pieces download as it opens (each tile tried on is then quick).
  function preloadArea() {
    const tab = currentTab();
    if (!tab) return;
    const list = [];
    for (const sec of tab.sections) {
      for (const it of itemsOfSection(sec)) {
        if (isColour(sec.slot) || it.draw !== 'part') continue;
        try { list.push(withItem(working, sec.slot === 'extra' ? 'extra' : sec.slot, it.id, { owns: tryAll })); } catch { /* skip */ }
      }
    }
    if (list.length) { try { preload(list); } catch { /* only an optimisation */ } }
  }
  function markSeen() {
    if (!seenNow.size) return;
    let grew = false;
    for (const id of seenNow) if (!seen.has(id)) { seen.add(id); grew = true; }
    seenNow.clear();
    if (grew) store.set(SEEN_KEY, [...seen]);
  }

  // ---- choosing ----
  function choose(slot, id) {
    if (slot === 'gender') {
      if (id === gender()) return;
      const next = withBody(working, id, { owns: tryAll });
      // (an area that the other body has no fob for: the nearest one it has)
      if (area === 'moustache' || area === 'makeup') area = id === 'f' ? 'makeup' : 'moustache';
      change(next);
      return;
    }
    if (slot === 'look') { wearPreset(id); return; }
    const it = item(slot === 'extra' ? 'extra' : slot, id);
    if (!it) return;
    const mine = owned(it);
    const before = working;
    const worn = isWorn(slot, id);
    if (worn && slot !== 'extra' && !(slot === 'glasses' && id !== 'none')) {
      // (tapping what is worn again: its card again if it is not yours; nothing else)
      if (!mine) { card = { slot, id, before: card?.before || before }; render(); }
      return;
    }
    // glasses: tapping the worn pair takes them off
    const next = worn && slot === 'glasses' ? withItem(working, 'glasses', 'none', { owns: tryAll }) : withItem(working, slot, id, { owns: tryAll });
    const capped = capWords(before, norm(next), slot, id, worn);
    const took = change(next, { keepCard: true });
    if (capped) {
      if (capped.denied) sfx(cue('deny'));
      showCap(capped.words);
    }
    if (!took) return;
    card = !mine && isWorn(slot, id) ? { slot, id, before } : null;
    render();
  }
  async function wearPreset(id) {
    let av = null;
    try { av = (await account?.wearLook?.(id, { save: false }))?.avatar || null; } catch { av = null; }
    if (!av) av = LOOKS[id] ? normaliseAvatar(LOOKS[id], { owns }) : null;
    if (!av) return;
    if (change(av)) curtain();
  }
  function curtain() {
    if (!el.curtain) return;
    el.curtain.classList.remove('on'); void el.curtain.offsetWidth; el.curtain.classList.add('on');
  }

  // ---- the saved Looks ----
  // (a Look saved with things not yours on, the testing switch off: said, so wearing it later is no surprise)
  function savedWithTryOns() {
    const n = tryingOn().length;
    return n ? `Saved with ${n === 1 ? 'one thing' : `${n} things`} not yours yet: when you wear this look, your own ${n === 1 ? 'piece stands' : 'pieces stand'} in.` : '';
  }
  // A Look just saved over or deleted can come back for a few seconds (account.restoreLook).
  function setLookUndo(slot, previous, words) {
    dropLookUndo();
    if (!previous) return;
    const u = { slot, previous, words };
    u.timer = setTimeout(() => {
      if (lookUndo !== u) return;
      const had = el.grid.contains(doc.activeElement) && doc.activeElement?.id === 'btn-wd-look-undo';
      lookUndo = null;
      if (isOpen && area === 'looks') { renderPanel(); if (had) focusIn(el.grid, `button[data-act="wear"][data-look="${slot}"], button[data-act="save"][data-look="${slot}"]`); }
    }, LOOK_UNDO_MS);
    lookUndo = u;
  }
  function dropLookUndo() { if (lookUndo) { clearTimeout(lookUndo.timer); lookUndo = null; } }
  async function lookAct(act, slot) {
    const look = account?.looks?.[slot] || null;
    const name = look?.name || '';
    const fail = r => { lookNote = r?.error || 'That could not be saved.'; render(); };
    if (act !== 'undo-look') dropLookUndo();
    switch (act) {
      case 'save': {
        const r = await account?.saveLook?.(slot, working);
        if (!r?.ok) return fail(r);
        sfx(cue('select'));
        lookEdit = { slot, mode: 'rename' };            // a name for it straight away (Cancel keeps "Look 2")
        lookNote = savedWithTryOns();
        render();
        focusLookInput();
        return;
      }
      case 'wear': {
        const r = await account?.wearLook?.(slot, { save: false });
        if (!r?.ok) return fail(r);
        const missing = r.missing || [];
        if (change(r.avatar, { sound: WARDROBE_CUES.look })) curtain();
        if (missing.length) {
          lookNote = `Not yours: ${missing.map(m => m.label).join(', ')}. Your own ${missing.length === 1 ? 'piece is' : 'pieces are'} worn in ${missing.length === 1 ? 'its' : 'their'} place.`;
          render();
        }
        return;
      }
      case 'undo-look': {
        const u = lookUndo;
        if (!u || u.slot !== slot) return;
        dropLookUndo();
        const r = await account?.restoreLook?.(slot, u.previous);
        if (!r?.ok) return fail(r);
        lookNote = `“${u.previous.name}” is back.`;
        render();
        focusIn(el.grid, `button[data-act="wear"][data-look="${slot}"]`);
        return;
      }
      case 'rename': lookEdit = { slot, mode: 'rename' }; render(); focusLookInput(); return;
      case 'rename-cancel': lookEdit = null; render(); return;
      case 'rename-ok': {
        const input = el.grid.querySelector('#wd-look-name');
        const r = await account?.renameLook?.(slot, input ? input.value : name);
        if (!r?.ok) { lookEdit = { slot, mode: 'rename', error: r?.error || 'That name cannot be used.' }; render(); focusLookInput(); return; }
        lookEdit = null; render(); return;
      }
      case 'delete': case 'over': lookEdit = { slot, mode: act }; render(); return;
      case 'keep': lookEdit = null; render(); return;
      case 'delete-ok': {
        const r = await account?.deleteLook?.(slot);
        if (!r?.ok) return fail(r);
        lookEdit = null;
        setLookUndo(slot, r.previous, `“${name}” deleted.`);
        render();
        focusNow(el.grid, '#btn-wd-look-undo');
        return;
      }
      case 'over-ok': {
        const r = await account?.saveLook?.(slot, working);
        if (!r?.ok) return fail(r);
        lookEdit = null; sfx(cue('select'));
        setLookUndo(slot, r.previous, `Saved over “${name}”.`);
        lookNote = savedWithTryOns();
        render();
        focusNow(el.grid, '#btn-wd-look-undo');
        return;
      }
      default:
    }
  }
  function focusLookInput() {
    const input = el.grid.querySelector('#wd-look-name');
    if (input) { try { input.focus({ preventScroll: true }); input.select(); } catch { /* fine */ } }
  }

  // ---- Undo, Surprise me, Cancel, Save look ----
  function doUndo() {
    if (!undo.length) return;
    working = undo.pop();
    card = null; ask = null; lookNote = ''; capNote = '';
    preview();
    render();
  }
  function doSurprise() {
    let next = surprise(working, area, { owns });
    // (an area with nothing else of yours to choose: the whole look instead)
    if (avatarKey(next) === avatarKey(working)) next = surprise(working, 'looks', { owns });
    if (avatarKey(next) === avatarKey(working)) { sfx(cue('deny')); return; }
    if (change(next, { sound: WARDROBE_CUES.surprise }) && (area === 'looks' || area === 'body')) curtain();
  }
  function doCancel() {
    if (ask?.kind === 'cancel') return;
    if (undo.length > 1 && avatarKey(working) !== avatarKey(saved || working)) { ask = { kind: 'cancel' }; card = null; renderPanel(); focusIn(el.ask, '#btn-wd-keepchanging'); return; }
    putBack();
  }
  function putBack() {
    if (saved) working = saved;
    undo = []; ask = null; card = null;
    preview();
    leaving = 'cancel';
    onDone?.();
  }
  async function doSave() {
    const not = tryingOn();
    if (not.length) { ask = { kind: 'save', items: not }; card = null; renderPanel(); focusIn(el.ask, '#btn-wd-takesave'); return; }
    sfx(cue(WARDROBE_CUES.save));
    leaving = 'save';
    onDone?.();
  }
  function takeOffAndSave() {
    const next = normaliseAvatar(working, { owns });
    undo.push(working);
    working = next;
    ask = null;
    preview();
    sfx(cue(WARDROBE_CUES.save));
    leaving = 'save';
    onDone?.();
  }
  let leaving = null;               // how the screen is being left: 'save' | 'cancel' | null (anything else: saved)
  const focusIn = (box, sel) => requestAnimationFrame(() => focusNow(box, sel));
  function focusNow(box, sel) { const b = box?.querySelector(sel); if (b) { try { b.focus({ preventScroll: true }); } catch { /* fine */ } } }

  // ---- taps ----
  const guard = e => tooSoon(e, openedAt);
  el.rail.addEventListener('click', e => {
    const b = e.target.closest('button[data-area]');
    if (!b || !working || guard(e)) return;
    e.preventDefault();
    goArea(b.dataset.area);
  });
  // (the rail and the tabs: arrow keys move along them)
  const arrows = (box, sel, keys) => box?.addEventListener('keydown', e => {
    const dir = keys[e.key];
    if (!dir) return;
    const list = [...box.querySelectorAll(sel)];
    const at = list.indexOf(doc.activeElement);
    if (at < 0) return;
    e.preventDefault();
    const next = list[(at + dir + list.length) % list.length];
    next.focus(); next.click();
  });
  arrows(el.rail, 'button[data-area]', { ArrowDown: 1, ArrowUp: -1 });
  arrows(el.tabs, 'button[data-tab]', { ArrowRight: 1, ArrowLeft: -1 });
  el.tabs.addEventListener('click', e => {
    const b = e.target.closest('button[data-tab]');
    if (!b || !working || guard(e)) return;
    e.preventDefault();
    goTab(b.dataset.tab);
  });
  el.row.addEventListener('click', e => {
    const b = e.target.closest('button[data-slot]');
    if (!b || !working || guard(e)) return;
    e.preventDefault();
    choose(b.dataset.slot, b.dataset.id);
  });
  el.grid.addEventListener('click', e => {
    if (!working || guard(e)) return;
    const act = e.target.closest('button[data-act]');
    if (act && act.dataset.look != null) { if (act.type === 'submit') return; e.preventDefault(); lookAct(act.dataset.act, +act.dataset.look); return; }
    const b = e.target.closest('button[data-slot]');
    if (!b) return;
    e.preventDefault();
    choose(b.dataset.slot, b.dataset.id);
  });
  el.grid.addEventListener('submit', e => {
    const f = e.target.closest('form[data-look]');
    if (!f) return;
    e.preventDefault();
    lookAct('rename-ok', +f.dataset.look);
  });
  el.grid.addEventListener('keydown', e => {
    if (e.key === 'Escape' && e.target.id === 'wd-look-name') { e.preventDefault(); lookAct('rename-cancel', lookEdit?.slot ?? 0); }
  });
  el.card.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !card || guard(e)) return;
    e.preventDefault();
    const act = b.dataset.act;
    if (act === 'close') { card = null; renderPanel(); return; }
    if (act === 'takeoff') {
      // back to how it was before this item went on
      const back = card.before;
      card = null;
      if (back) { if (undo[undo.length - 1] && avatarKey(undo[undo.length - 1]) === avatarKey(back)) undo.pop(); working = norm(back); preview(); }
      render();
      return;
    }
    if (act === 'see') {
      const it = item(card.slot === 'extra' ? 'extra' : card.slot, card.id);
      onHonours?.({ at: it?.achievement || null });
    }
  });
  el.ask.addEventListener('click', e => {
    const b = e.target.closest('button[data-act]');
    if (!b || !ask || guard(e)) return;
    e.preventDefault();
    const kind = ask.kind;
    if (b.dataset.act === 'ask-no') { ask = null; renderPanel(); focusIn(el.foot, kind === 'save' ? '#btn-wd-save' : '#btn-wd-cancel'); return; }
    if (kind === 'save') takeOffAndSave(); else putBack();
  });
  const click = (b, fn) => b?.addEventListener('click', e => { e.preventDefault(); if (!working || guard(e)) return; fn(e); });
  click(el.undo, doUndo);
  click(el.surprise, doSurprise);
  click(el.cancel, doCancel);
  click(el.save, doSave);
  click(el.pill, () => onHonours?.({ at: null }));
  click(el.rename, () => { resume = true; onRename?.(); });
  // the details card: a small dialog (focus kept in it while it is open; Escape closes it)
  watchDialog(doc, { overlay: el.card, labelledby: 'wd-card-title', escape: 'click:#btn-wd-card-close',
    main: ['#btn-wd-see', '#btn-wd-keepon', '#btn-wd-takeoff'] });

  // ---- turning the guest: a drag on the stage (or the arrow keys on it); let go, and it turns back after a while ----
  let yaw = 0, drag = null, backTimer = 0, lastTap = 0;
  const turnTo = (y, ease = false) => { yaw = Math.max(-MAX_TURN, Math.min(MAX_TURN, y)); try { onTurn?.(yaw, { ease }); } catch { /* fine */ } };
  const turnedOnce = () => { if (!store.get(TURNED_KEY)) { store.set(TURNED_KEY, true); renderStage(); } };
  const scheduleBack = () => {
    clearTimeout(backTimer);
    backTimer = setTimeout(() => { if (isOpen && !drag) turnTo(0, !reducedMotion()); }, TURN_BACK_MS);
  };
  if (el.drag) {
    el.drag.addEventListener('pointerdown', e => {
      if (!working || e.button > 0) return;
      clearTimeout(backTimer);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw, moved: 0 };
      try { el.drag.setPointerCapture(e.pointerId); } catch { /* fine */ }
    });
    el.drag.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      drag.moved = Math.max(drag.moved, Math.abs(dx), Math.abs(e.clientY - drag.y));
      if (drag.moved < 4) return;
      turnTo(drag.yaw + dx * 0.0125);
    });
    const up = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      if (moved >= 4) { turnedOnce(); scheduleBack(); return; }
      // a double tap on the stage: close-up or full length, whatever the area
      const now = performance.now();
      if (now - lastTap < 350) { lastTap = 0; setShot(shot === 'close' ? 'full' : 'close'); renderStage(); } else lastTap = now;
    };
    el.drag.addEventListener('pointerup', up);
    el.drag.addEventListener('pointercancel', e => { if (drag && e.pointerId === drag.id) { drag = null; scheduleBack(); } });
    el.drag.addEventListener('keydown', e => {
      const d = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (!d) return;
      e.preventDefault();
      turnTo(yaw + d * Math.PI / 6, !reducedMotion());
      turnedOnce();
      scheduleBack();
    });
  }

  // ---- the screen ----
  const anchor = on => {
    if (!menuRoot || menuRoot.classList.contains('avatar') === on) return;
    menuRoot.classList.add('snap');
    menuRoot.classList.toggle('avatar', on);
    void menuRoot.offsetWidth;
    requestAnimationFrame(() => menuRoot.classList.remove('snap'));
  };
  async function save() {
    if (!working || !account?.setAvatar) return;
    const safe = normaliseAvatar(working, { owns });
    if (saved && avatarKey(safe) === avatarKey(saved)) return;
    const res = await account.setAvatar(safe);
    if (res?.avatar) saved = working = normaliseAvatar(res.avatar, { owns });
  }
  account?.onChange?.(() => { if (isOpen) { renderStage(); if (area === 'looks') renderPanel(); } });

  return {
    // The screen opened (menu 'avatar'): your saved avatar, or the look you were choosing before Change name.
    open() {
      const profileAv = account?.profile?.avatar;
      if (!(resume && working)) {
        working = norm(profileAv);
        saved = profileAv ? normaliseAvatar(profileAv, { owns }) : null;
        undo = [];
        area = gender() === 'f' && area === 'moustache' ? 'makeup' : gender() === 'm' && area === 'makeup' ? 'moustache' : area;
      }
      resume = false;
      isOpen = true;
      leaving = null;
      openedAt = performance.now();
      card = null; ask = null; lookEdit = null; lookNote = ''; dropLookUndo(); capNote = '';
      previewBad = false;
      anchor(true);
      const a = areaById(area);
      setShot(a?.shot || 'full', { force: true });
      preview();
      render();
      el.grid.scrollTop = 0;
      preloadArea();
    },
    // The screen left: Save look keeps the look; Cancel puts back the one you came in with; Change name keeps the look
    // being chosen for when the screen comes back; anything else (another tab cleared the profile...) keeps it too.
    close() {
      if (!isOpen) return Promise.resolve();
      isOpen = false;
      markSeen();
      clearTimeout(backTimer); drag = null;
      if (yaw) turnTo(0);
      anchor(false);
      const how = leaving; leaving = null;
      if (resume) return Promise.resolve();
      if (how === 'cancel') { working = null; return Promise.resolve(); }
      return save().catch(err => console.warn('your avatar could not be saved:', err));
    },
    get isOpen() { return isOpen; },
    get avatar() { return working ? copy(working) : null; },
    get shot() { return shot; },
    // (the Hotel Honours page: wear an item from it; it closes onto the stage)
    tryOn(globalId) {
      if (!working) return false;
      const at = typeof globalId === 'string' ? globalId.indexOf('.') : -1;
      if (at < 0) return false;
      const slot = globalId.slice(0, at), id = globalId.slice(at + 1);
      const it = item(slot, id);
      if (!it || !canWear(it, body(), tryAll)) return false;
      const a = AREAS.find(x => tabsFor(x.id, gender()).some(t => t.sections.some(s => s.slot === slot)));
      if (a) {
        const t = tabsFor(a.id, gender()).find(x => x.sections.some(s => s.slot === slot));
        goArea(a.id, { tab: t?.id, sound: false });
      }
      if (!isWorn(slot, id)) { sfx(cue(isColour(slot) ? WARDROBE_CUES.colour : WARDROBE_CUES[slot] || 'click')); choose(slot, id); }
      return true;
    },
    // (tests) what the screen shows
    debug() {
      const tab = working ? currentTab() : null;
      return {
        open: isOpen, area, tab: tab?.id || null, shot, avatar: working ? copy(working) : null, undo: undo.length,
        areas: [...el.rail.querySelectorAll('button[data-area]')].map(b => ({ id: b.dataset.area, on: b.classList.contains('on'), dot: !!b.querySelector('.wd-dot') })),
        tabs: [...el.tabs.querySelectorAll('button[data-tab]')].map(b => ({ id: b.dataset.tab, on: b.classList.contains('on') })),
        row: el.row.hidden ? null : [...el.row.querySelectorAll('button[data-slot]')].map(b => ({ slot: b.dataset.slot, id: b.dataset.id, on: b.classList.contains('on') })),
        tiles: [...el.grid.querySelectorAll('.wd-tile')].map(b => ({
          slot: b.dataset.slot, id: b.dataset.id, name: b.querySelector('.wd-nm')?.textContent || '', status: b.querySelector('.wd-mt')?.textContent || '',
          wearing: b.classList.contains('wearing'), trying: b.classList.contains('trying'), kind: b.classList.contains('ach') ? 'achievement' : b.classList.contains('boutique') ? 'boutique' : 'free',
          testing: b.classList.contains('testing'), isNew: b.classList.contains('new'), picture: !!b.querySelector('.wd-pic img'), placeholder: !!b.querySelector('.wd-ph'),
        })),
        looks: [...el.grid.querySelectorAll('.wd-look')].map(d => ({ slot: +d.dataset.look, empty: d.classList.contains('empty'), name: d.querySelector('.wd-look-name')?.textContent || null })),
        card: card ? { slot: card.slot, id: card.id } : null, ask: ask?.kind || null,
        note: el.note && !el.note.hidden ? el.note.textContent : null, lookUndo: lookUndo ? lookUndo.slot : null,
        tryingOn: tryingOn().map(it => itemId(it)),
      };
    },
  };
}
