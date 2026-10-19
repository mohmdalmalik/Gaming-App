// The Wardrobe (src/ui/wardrobe/) and the Hotel Honours page (src/ui/honours.js), in headless Chromium (software WebGL),
// plus a Node part that needs no browser. Serve the repo first:
//   (cd /home/user/Gaming-App && python3 -m http.server 8123 --bind 127.0.0.1)
//   node tests/browser-wardrobe.mjs [--url http://127.0.0.1:8123/] [--shots DIR] [--sizes 1024x694,1180x820] [--skip sizes,flow,locked,motion]
//
// 0. node      the areas' data (at most four tabs, every cue in the mix table); Surprise me: owned items only, only the
//              open area's pieces and colours, never the body or the skin tone, the eyes always show, never the same
//              look; the tile pictures: every one listed in src/data/thumbsIndex.js is on disk, and every piece the
//              catalogue offers on a built body has one (else: run tools/char-pipeline/parts/thumbs.mjs)
// 1. sizes     at 1024x694, 1024x768, 1180x820 and 1366x1024: the page never scrolls; the rail, the panel and Save look
//              on screen; every button, tab, tile and colour dot at least 44 px; your guest on the stage between the
//              rail and the panel; the camera close for the hair, to the knees for the extras, full length for the
//              outfit; the tiles carry pictures; the Hotel Honours page fits
// 2. flow      (1180x820) a tile worn at once (Undo puts it back); an Achievement tile (its rosette, the task, "unlocked
//              for testing") and its card: See achievement opens the Honours page at it, Try it on from there; Take it off;
//              a Boutique tile ("Opens later"); a colour dot; drag (and the arrow keys) to turn, and the guest turns back;
//              a double tap on the stage changes the shot; keyboard along the rail; Surprise me; the Looks (save, rename,
//              wear a classic and a saved one, delete, and Undo after a delete or a save over); too much at once (the
//              guest's triangle cap) said on the stage; Cancel asks, then puts back the look you came in with; Save
//              look keeps it (the lift bell); the end screen's achievement line opens the Honours page; no console errors
// 3. locked    the testing switch OFF (src/data/wardrobe.js served with UNLOCK_ALL_FOR_TESTING = false): no "unlocked
//              for testing" notes; an Achievement item can be tried on ("Trying on" on the stage and the tile) but not
//              kept: Save look asks, and "Take it off and save" saves your own look; a Look saved with a try-on in it
//              says so, and wearing it names what is not yours (and wears your own instead)
// 4. motion    Reduce Motion: the camera cuts between the shots (no glide)
import { launch, settle } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { AREAS, tabsFor } from '../src/ui/wardrobe/areas.js';
import { surprise, slotsOfArea } from '../src/ui/wardrobe/surprise.js';
import { LOOKS, ITEMS, itemsFor, ownsFrom, avatarKey, eyesShow, isFree, item, COLOUR_SLOTS, SLOTS_BY_GENDER, genderOf } from '../src/data/wardrobe.js';
import { PART_INDEX } from '../src/data/partsIndex.js';
import { THUMBS } from '../src/data/thumbsIndex.js';

const args = process.argv.slice(2);
const opt = k => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : null);
const base = opt('url') || 'http://127.0.0.1:8123/';
const shots = opt('shots');
const skip = new Set((opt('skip') || '').split(',').filter(Boolean));
const SIZES = (opt('sizes') || '1024x694,1024x768,1180x820,1366x1024').split(',').map(s => s.split('x').map(Number));
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- 0. no browser -----------------------------------------------------------------------------------------------
console.log('0. the areas, Surprise me and the tile pictures (no browser)');
{
  check(AREAS.map(a => a.id).join(',') === 'body,face,hair,moustache,makeup,eyewear,outfit,extras,looks', 'the areas, in the rail\'s order');
  check(AREAS.every(a => ['m', 'f'].every(g => tabsFor(a.id, g).length <= 4)), 'no area has more than four tabs');
  const owns = ownsFrom([]);
  let bad = [];
  for (const look of Object.keys(LOOKS)) {
    for (const a of AREAS.map(x => x.id)) {
      for (let i = 0; i < 8; i++) {
        let seed = (i + 1) * 9301 + a.length * 49297 + look.length;
        const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        const start = LOOKS[look], out = surprise(start, a, { owns, rng });
        const g = genderOf(out.body);
        const worn = [...SLOTS_BY_GENDER[g].map(s => item(s, out[s])), ...out.extras.map(x => item('extra', x)), ...COLOUR_SLOTS.map(s => item(s, out.colours[s]))];
        if (worn.some(it => it && !isFree(it))) bad.push(`${look}/${a}: wears something not owned`);
        if (!eyesShow(out)) bad.push(`${look}/${a}: eyes hidden`);
        if (out.body !== start.body || out.colours.skin !== start.colours.skin) bad.push(`${look}/${a}: body or skin changed`);
        const allowed = new Set(slotsOfArea(a));
        for (const s of SLOTS_BY_GENDER[g]) if (out[s] !== start[s] && !allowed.has(s)) bad.push(`${look}/${a}: ${s} changed`);
        for (const s of COLOUR_SLOTS) if (out.colours[s] !== start.colours[s] && !allowed.has(s)) bad.push(`${look}/${a}: colour ${s} changed`);
        if (['hair', 'outfit', 'looks', 'body', 'eyewear'].includes(a) && avatarKey(out) === avatarKey(start)) bad.push(`${look}/${a}: nothing changed`);
      }
    }
  }
  check(!bad.length, `Surprise me (6 Looks x 9 areas x 8 rolls): owned items only, the open area only, body and skin kept, eyes always showing, never the same look${bad.length ? `: ${bad.slice(0, 5).join('; ')}` : ''}`);
  const keys = Object.keys(THUMBS);
  const gone = keys.filter(k => !fs.existsSync(path.join(root, 'assets/characters/parts/thumbs', `${k}.webp`)));
  check(keys.length > 0 && !gone.length, `every picture in src/data/thumbsIndex.js is on disk (${keys.length}${gone.length ? `; missing: ${gone.join(', ')}` : ''})`);
  const want = [];
  for (const b of PART_INDEX.bodies || []) {
    want.push(`${b}/body`);
    for (const s of ['face', 'hairStyle', 'facial', 'makeup', 'glasses', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'extra']) for (const it of itemsFor(s, b)) want.push(`${b}/${s}_${it.id}`);
  }
  const without = want.filter(k => !THUMBS[k]);
  check(!without.length, `every piece offered on a built body has its picture (${want.length})${without.length ? `; none yet for ${without.join(', ')}: run node tools/char-pipeline/parts/thumbs.mjs` : ''}`);
  const big = keys.filter(k => fs.existsSync(path.join(root, 'assets/characters/parts/thumbs', `${k}.webp`)) && fs.statSync(path.join(root, 'assets/characters/parts/thumbs', `${k}.webp`)).size > 30000);
  check(!big.length, `every picture is small (under 30 kB)${big.length ? `: ${big.join(', ')}` : ''}`);
  check(ITEMS.filter(it => it.unlock === 'achievement' && it.achievement).length === 5, 'five achievement items, each with its achievement');
}

// ---- helpers ----------------------------------------------------------------------------------------------------------
async function open(w, h, extra = {}) {
  const run = await launch({ width: w, height: h, ...extra });
  const { page } = run;
  if (extra.route) await extra.route(page);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.lobbyReady?.() && window.__game.lobbyPlayer() && !document.getElementById('btn-menu-bots').disabled, null, { timeout: 180000 });
  await sleep(500);
  await page.click('#btn-profile');
  await stageStill(page);
  return run;
}
// the wardrobe's camera at rest and the look on the stage built
const stageStill = page => settle(page, () => {
  const w = window.__game.lobbyWardrobe();
  return window.__game.menuScreen() === 'avatar' && w && w.k === 1 && w.shotK === 1 && document.getElementById('wd-fitting')?.hidden;
}, null, 120000);
const ed = page => page.evaluate(() => window.__game.avatarEditor());
const area = async (page, id, tab = null) => {
  await page.click(`#wd-rail button[data-area="${id}"]`); await sleep(380);
  if (tab) { await page.click(`#wd-tabs button[data-tab="${tab}"]`); await sleep(380); }
};
const tap = async (page, slot, id) => { await page.click(`#av-body button[data-slot="${slot}"][data-id="${id}"]`); await sleep(380); };
// (a tap, then the details card closed if one opened: the next tile is not under it)
const tapX = async (page, slot, id) => { await tap(page, slot, id); if (await page.isVisible('#btn-wd-card-close')) { await page.click('#btn-wd-card-close'); await sleep(200); } };
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) }); };
const player = page => page.evaluate(() => window.__game.lobbyPlayer()?.avatar || null);

// ---- 1. the four iPad sizes -------------------------------------------------------------------------------------------
if (!skip.has('sizes')) {
  console.log('\n1. the four iPad sizes');
  for (const [w, h] of SIZES) {
    const tag = `${w}x${h}`;
    const { browser, page, messages } = await open(w, h);
    for (const [id, want] of [['hair', 'close'], ['extras', 'half'], ['outfit', 'full']]) {
      await area(page, id);
      await stageStill(page);
      check((await page.evaluate(() => window.__game.lobbyWardrobe().shot)) === want, `${tag}: ${id}: the camera's shot is ${want}`);
      await shot(page, `wardrobe-${id}-${tag}`);
    }
    const lay = await page.evaluate(() => {
      const r = e => e.getBoundingClientRect().toJSON();
      const se = document.scrollingElement, panel = r(document.getElementById('wd-panel')), rail = r(document.getElementById('wd-rail'));
      const save = document.getElementById('btn-wd-save'), sr = save.getBoundingClientRect();
      const hit = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2);
      const targets = [...document.querySelectorAll('#menu-avatar button')].filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')
        .map(b => ({ id: b.id || b.className, w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height }));
      const fobs = [...document.querySelectorAll('#wd-rail button')].map(r);
      return { scroll: [se.scrollHeight, innerHeight, se.scrollWidth, innerWidth], panel, rail, save: sr.toJSON(), saveHit: hit?.closest('button')?.id, targets, fobs,
        you: window.__game.lobbyPlayer().screen, pics: document.querySelectorAll('#av-body .wd-pic img').length, tiles: document.querySelectorAll('#av-body .wd-tile').length };
    });
    check(lay.scroll[0] <= lay.scroll[1] && lay.scroll[2] <= lay.scroll[3], `${tag}: the page never scrolls (${lay.scroll.join(' ')})`);
    check(lay.fobs.every(f => f.bottom <= h && f.top >= 0) && lay.panel.bottom <= h && lay.saveHit === 'btn-wd-save', `${tag}: the eight fobs, the panel and Save look on screen (rail to ${Math.round(lay.rail.bottom)}, panel to ${Math.round(lay.panel.bottom)})`);
    const small = lay.targets.filter(t => t.w < 44 || t.h < 44);
    check(!small.length, `${tag}: every button is 44 px or more (${lay.targets.length})${small.length ? `: ${small.slice(0, 4).map(t => `${t.id} ${t.w.toFixed(0)}x${t.h.toFixed(0)}`).join(', ')}` : ''}`);
    const [fx, fy] = lay.you.feet, [hx, hy] = lay.you.head;
    check(Math.min(fx, hx) > lay.rail.right + 20 && Math.max(fx, hx) < lay.panel.left - 20 && hy > 0 && fy < h, `${tag}: your guest stands on the stage, head to feet (head ${hx.toFixed(0)},${hy.toFixed(0)} feet ${fx.toFixed(0)},${fy.toFixed(0)})`);
    check(lay.tiles >= 4 && lay.pics === lay.tiles, `${tag}: the outfit's tiles carry their pictures (${lay.pics} of ${lay.tiles})`);
    // the grid scrolls inside the panel, never the page (the Looks: three of your own and the six classic guests)
    await area(page, 'looks');
    const grid = await page.evaluate(() => {
      const g = document.getElementById('av-body'), se = document.scrollingElement;
      const out = { sh: g.scrollHeight, ch: g.clientHeight, ov: getComputedStyle(g).overflowY };
      g.scrollTop = 100000;
      Object.assign(out, { top: g.scrollTop, page: se.scrollTop, pageH: se.scrollHeight, inner: innerHeight });
      g.scrollTop = 0;
      return out;
    });
    check(grid.ov === 'auto' && grid.page === 0 && grid.pageH <= grid.inner && (grid.sh <= grid.ch ? grid.top === 0 : grid.top > 0),
      `${tag}: the grid scrolls inside its panel, the page stays put (${grid.sh} in ${grid.ch}: ${grid.sh > grid.ch ? `scrolled ${grid.top}` : 'all in view'})`);
    // the Honours page fits
    await page.click('#btn-wd-honours'); await sleep(600);
    const hn = await page.evaluate(() => { const s = document.querySelector('#honours-overlay .hn-sheet').getBoundingClientRect(), d = document.getElementById('btn-hn-done').getBoundingClientRect(); return { s: s.toJSON(), d: d.toJSON(), rows: window.__game.honoursPage().rows.length, focus: document.activeElement?.id }; });
    check(hn.s.top >= 0 && hn.s.bottom <= h && hn.d.bottom <= h && hn.rows === 5, `${tag}: the Hotel Honours page fits, its five achievements (${hn.rows}), Done on screen`);
    check(hn.focus === 'btn-hn-done', `${tag}: the page takes the keyboard focus (on Done)`);
    await shot(page, `honours-${tag}`);
    await page.keyboard.press('Escape'); await sleep(300);
    check(!(await page.evaluate(() => window.__game.honoursPage().open)), `${tag}: Escape closes the Honours page`);
    check(!messages.length, `${tag}: no console errors${messages.length ? `: ${messages.slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
  }
}

// ---- 2. the flow ------------------------------------------------------------------------------------------------------
if (!skip.has('flow')) {
  console.log('\n2. the wardrobe, tile by tile (1180x820)');
  const { browser, page, messages } = await open(1180, 820);
  const start = await page.evaluate(() => window.__game.profile().avatar);
  await area(page, 'hair', 'hairStyle');
  let d = await ed(page);
  const swept = d.tiles.find(t => t.id === 'swept'), poet = d.tiles.find(t => t.id === 'lamplighter');
  check(swept?.wearing && swept.status === 'Wearing', 'Hair: the hairstyle you wear is marked Wearing');
  check(poet && poet.kind === 'achievement' && poet.testing && /of 3 Lanterns/.test(poet.status), `The Poet: an Achievement tile, its task's progress (${poet?.status}) and "unlocked for testing"`);
  check(d.tiles.some(t => t.isNew), 'a new piece carries its NEW tag');
  check(d.row && d.row.length >= 7 && d.row.some(r => r.on), 'the hair colour row, the worn colour ringed');
  await tap(page, 'hairStyle', 'sidePart');
  await settle(page, () => window.__game.lobbyPlayer()?.avatar?.hairStyle === 'sidePart', null, 60000);
  check((await player(page))?.hairStyle === 'sidePart', 'a tile tapped: the guest wears it at once');
  await page.click('#btn-wd-undo'); await sleep(400);
  await settle(page, () => window.__game.lobbyPlayer()?.avatar?.hairStyle === 'swept', null, 60000);
  check((await player(page))?.hairStyle === 'swept' && (await ed(page)).undo === 0, 'Undo puts it back');
  // an achievement item: worn, and its card
  await tap(page, 'hairStyle', 'lamplighter');
  d = await ed(page);
  check(d.card?.id === 'lamplighter' && d.avatar.hairStyle === 'lamplighter', 'The Poet tapped: worn on the stage, its card opens');
  const card = await page.evaluate(() => ({ text: document.getElementById('wd-card').textContent, see: !!document.getElementById('btn-wd-see'), focus: document.activeElement?.closest('#wd-card') ? document.activeElement.id : null }));
  check(/Find 3 Lanterns yourself in one match/.test(card.text) && /Lamplighter/.test(card.text) && card.see, 'the card: the task in words, the achievement and See achievement');
  check(/Unlocked for testing/.test(card.text), 'the card says it is unlocked for testing');
  await shot(page, 'flow-card-achievement');
  await page.click('#btn-wd-see'); await sleep(600);
  let hp = await page.evaluate(() => window.__game.honoursPage());
  check(hp.open && hp.at === 'lamplighter' && hp.rows.find(r => r.id === 'lamplighter')?.at, 'See achievement: the Hotel Honours page opens at Lamplighter');
  await page.click('#btn-hn-done'); await sleep(400);
  await page.click('#btn-wd-takeoff').catch(() => {}); await sleep(400);
  check((await ed(page)).avatar.hairStyle === 'swept' && !(await ed(page)).card, 'Take it off: your own hairstyle back, the card closed');
  // the Honours pill, then Try it on from the page
  await page.click('#btn-wd-honours'); await sleep(600);
  hp = await page.evaluate(() => window.__game.honoursPage());
  check(hp.open && hp.rows.length === 5 && hp.rows.every(r => !r.earned), 'the Honours pill opens the page: five achievements, none earned yet');
  const tryable = hp.rows.find(r => r.canTry && r.id === 'goodCompany');
  if (tryable) {
    await page.click('#hn-list [data-ach="goodCompany"] [data-try]'); await sleep(700);
    d = await ed(page);
    check(!(await page.evaluate(() => window.__game.honoursPage().open)) && d.area === 'extras' && d.avatar.extras.includes('eveningGloves'), 'Try it on from the page: it closes onto the stage, the Evening gloves worn in Extras');
    await page.click('#btn-wd-takeoff').catch(() => {}); await sleep(300);
  } else check(false, 'the Evening gloves can be tried on from the Honours page');
  // a Boutique item
  await area(page, 'outfit', 'top');
  d = await ed(page);
  const smoking = d.tiles.find(t => t.id === 'smoking');
  if (smoking) {
    check(smoking.kind === 'boutique' && smoking.status === 'Opens later' && smoking.testing, 'the Smoking jacket: a Boutique tile, "Opens later", unlocked for testing');
    await tap(page, 'top', 'smoking');
    const bc = await page.evaluate(() => document.getElementById('wd-card').textContent);
    check(/Boutique opens later/.test(bc) && /Keep it on/.test(bc), 'its card: the Boutique opens later; Keep it on');
    await shot(page, 'flow-card-boutique');
    await page.click('#btn-wd-keepon'); await sleep(300);
    check(!(await ed(page)).card && (await ed(page)).avatar.top === 'smoking', 'Keep it on: the card closes, the jacket stays on');
  } else console.log('  (the Smoking jacket is not in the parts index yet: skipped)');
  // a colour dot
  await page.click('#wd-row button[data-slot="main"][data-id="claret"]'); await sleep(400);
  check((await player(page))?.colours.main === 'claret', 'a cloth colour dot: the guest repainted at once');
  // drag to turn, and back
  const box = await page.evaluate(() => { const r = document.getElementById('wd-drag').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height * 0.55 }; });
  await page.mouse.move(box.x, box.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) { await page.mouse.move(box.x + i * 18, box.y); await sleep(30); }
  await page.mouse.up();
  const turned = await page.evaluate(() => window.__game.lobbyWardrobe().yawWant);
  check(turned > 1, `a drag turns the guest (${turned.toFixed(2)} rad)`);
  check(await page.evaluate(() => document.getElementById('wd-stage').classList.contains('turned')), 'and the "Drag to turn" hint goes');
  await settle(page, () => window.__game.lobbyWardrobe().yawWant === 0, null, 8000);
  check((await page.evaluate(() => window.__game.lobbyWardrobe().yawWant)) === 0, 'let go: after a few seconds the guest turns back to face you');
  await page.focus('#wd-drag'); await page.keyboard.press('ArrowRight'); await sleep(200);
  check((await page.evaluate(() => window.__game.lobbyWardrobe().yawWant)) > 0.4, 'the arrow keys turn the guest too');
  // a double tap on the stage: close-up <-> full length
  const before = await page.evaluate(() => window.__game.lobbyWardrobe().shot);
  await page.mouse.click(box.x, box.y); await sleep(60); await page.mouse.click(box.x, box.y); await sleep(300);
  check((await page.evaluate(() => window.__game.lobbyWardrobe().shot)) !== before, `a double tap on the stage changes the shot (${before} -> ${await page.evaluate(() => window.__game.lobbyWardrobe().shot)})`);
  // the keyboard along the rail
  await page.focus('#wd-rail button[data-area="outfit"]'); await page.keyboard.press('ArrowDown'); await sleep(400);
  check((await ed(page)).area === 'extras' && await page.evaluate(() => document.activeElement?.dataset?.area) === 'extras', 'the arrow keys move along the rail');
  // Surprise me
  await area(page, 'hair');
  const was = (await ed(page)).avatar;
  await page.click('#btn-wd-surprise'); await sleep(500);
  const now = (await ed(page)).avatar;
  check(JSON.stringify(now) !== JSON.stringify(was) && now.top === was.top && now.colours.main === was.colours.main, `Surprise me in Hair: a new hairstyle or colour, the rest kept (${now.hairStyle}, ${now.colours.hair})`);
  // the Looks
  await area(page, 'looks');
  d = await ed(page);
  check(d.looks.length === 3 && d.looks.every(l => l.empty) && d.tiles.filter(t => t.slot === 'look').length === 6, 'Looks: three empty slots of your own, the six classic guests');
  await page.click('#av-body button[data-act="save"][data-look="0"]'); await sleep(400);
  check(await page.evaluate(() => document.activeElement?.id) === 'wd-look-name', 'Save this look here: saved, and its name field takes the focus');
  await page.fill('#wd-look-name', 'Opening night');
  await page.click('#av-body button[data-act="rename-ok"]'); await sleep(400);
  d = await ed(page);
  check(d.looks[0].name === 'Opening night' && (await page.evaluate(() => window.__game.profile().looks[0]?.name)) === 'Opening night', 'renamed: "Opening night", kept in your profile');
  const saved0 = await page.evaluate(() => window.__game.profile().looks[0].avatar);
  await tap(page, 'look', 'clara');
  await settle(page, () => window.__game.lobbyPlayer()?.avatar?.face === 'clara', null, 60000);
  check((await player(page))?.face === 'clara' && (await ed(page)).areas.some(a => a.id === 'makeup'), 'a classic Look: Clara worn at once, the rail now has Make-up');
  // too much at once (the guest's triangle cap): said on the stage, never a tap that silently does nothing
  await area(page, 'eyewear');
  await tapX(page, 'glasses', 'round');
  await area(page, 'extras');
  await tapX(page, 'extra', 'lantern'); await tapX(page, 'extra', 'blackOrchid');
  const denyBefore = await page.evaluate(() => (window.__audioLog || []).filter(l => l.name === 'deny').length);
  await tap(page, 'extra', 'eveningGloves');
  d = await ed(page);
  check(!d.avatar.extras.includes('eveningGloves') && /Too much at once to add the Evening gloves/.test(d.note || '')
    && await page.evaluate(n => (window.__audioLog || []).filter(l => l.name === 'deny').length > n, denyBefore),
  `too much at once: the Evening gloves do not fit with earrings, glasses, charm and corsage, and the stage says so ("${d.note}")`);
  await shot(page, 'flow-cap-note');
  await tapX(page, 'extra', 'blackOrchid');
  await tapX(page, 'extra', 'eveningGloves');
  check((await ed(page)).avatar.extras.includes('eveningGloves'), 'with the corsage off, the gloves go on');
  await tapX(page, 'extra', 'blackOrchid');
  d = await ed(page);
  check(/came off to make room/.test(d.note || '') && d.avatar.extras.includes('blackOrchid') !== d.avatar.extras.includes('eveningGloves'),
    `putting the corsage back takes another extra off, and the stage says which ("${d.note}")`);
  await area(page, 'looks');
  await page.click('#av-body button[data-act="wear"][data-look="0"]'); await sleep(500);
  await settle(page, () => window.__game.lobbyPlayer()?.avatar?.body === 'm', null, 60000);
  check(JSON.stringify((await ed(page)).avatar) === JSON.stringify(saved0), 'Wear: your saved look back on the stage');
  await page.click('#av-body button[data-act="delete"][data-look="0"]'); await sleep(300);
  await page.click('#av-body button[data-act="delete-ok"][data-look="0"]'); await sleep(300);
  check((await ed(page)).looks[0].empty && !(await page.evaluate(() => window.__game.profile().looks[0])), 'Delete asks, then the slot is empty again');
  check((await ed(page)).lookUndo === 0 && await page.evaluate(() => document.activeElement?.id) === 'btn-wd-look-undo', 'and offers Undo for a few seconds (it takes the focus)');
  await page.click('#btn-wd-look-undo'); await sleep(400);
  d = await ed(page);
  check(d.looks[0].name === 'Opening night' && (await page.evaluate(() => window.__game.profile().looks[0]?.name)) === 'Opening night', 'Undo: "Opening night" is back in its slot and in your profile');
  await page.click('#av-body button[data-act="over"][data-look="0"]'); await sleep(300);
  await page.click('#av-body button[data-act="over-ok"][data-look="0"]'); await sleep(300);
  check((await ed(page)).lookUndo === 0, 'Save over asks, then offers Undo too');
  await page.click('#btn-wd-look-undo'); await sleep(400);
  check(JSON.stringify(await page.evaluate(() => window.__game.profile().looks[0]?.avatar)) === JSON.stringify(saved0), 'Undo of a save over: the look saved before is back');
  await shot(page, 'flow-looks');
  // Cancel: several changes, it asks; Put it back
  await page.click('#btn-wd-cancel'); await sleep(300);
  check((await ed(page)).ask === 'cancel', 'Cancel after several changes asks first');
  await page.click('#btn-wd-putback'); await sleep(600);
  await settle(page, () => window.__game.menuScreen() === 'main', null, 10000);
  check(JSON.stringify(await page.evaluate(() => window.__game.profile().avatar)) === JSON.stringify(start), 'Put it back: the look you came in with, unchanged in your profile');
  // Save look keeps a change, with the lift bell
  await settle(page, () => window.__game.lobbyWardrobe()?.k === 0, null, 60000);
  await page.click('#btn-profile'); await stageStill(page);
  await area(page, 'moustache');
  await tap(page, 'facial', 'pencil');
  await page.click('#btn-wd-save'); await sleep(600);
  await settle(page, () => window.__game.menuScreen() === 'main', null, 10000);
  check((await page.evaluate(() => window.__game.profile().avatar.facial)) === 'pencil', 'Save look keeps the change in your profile');
  check(await page.evaluate(() => (window.__audioLog || []).some(l => l.name === 'liftDing')) && await page.evaluate(() => (window.__audioLog || []).some(l => l.name === 'snip')),
    'the lift bell on Save look, the snip on a moustache');
  // the end screen's achievement line opens the Honours page (from the end screen: no Try it on)
  await page.evaluate(() => { const b = document.getElementById('end-honours'); b.hidden = false; b.click(); });
  await sleep(500);
  hp = await page.evaluate(() => window.__game.honoursPage());
  check(hp.open && hp.rows.every(r => !r.canTry), 'the end screen\'s achievement line opens the Honours page (no Try it on there)');
  await page.click('#btn-hn-done').catch(() => {});
  await page.evaluate(() => { document.getElementById('end-honours').hidden = true; });
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---- 3. the testing switch off ------------------------------------------------------------------------------------------
if (!skip.has('locked')) {
  console.log('\n3. the testing switch off (UNLOCK_ALL_FOR_TESTING = false)');
  const route = page => page.route(/\/src\/data\/wardrobe\.js(\?.*)?$/, async r => {
    const res = await r.fetch();
    const body = (await res.text()).replace('export const UNLOCK_ALL_FOR_TESTING = true;', 'export const UNLOCK_ALL_FOR_TESTING = false;');
    r.fulfill({ response: res, body, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
  });
  const { browser, page, messages } = await open(1180, 820, { route });
  await area(page, 'hair', 'hairStyle');
  let d = await ed(page);
  check(d.tiles.every(t => !t.testing), 'no tile says "unlocked for testing"');
  await tap(page, 'hairStyle', 'lamplighter');
  d = await ed(page);
  const tile = d.tiles.find(t => t.id === 'lamplighter');
  check(d.avatar.hairStyle === 'lamplighter' && tile?.trying && d.tryingOn.includes('hairStyle.lamplighter'), 'The Poet can be tried on: the tile says Trying on');
  check(await page.evaluate(() => !document.getElementById('wd-tryon').hidden && /Trying on/i.test(document.getElementById('wd-tryon').textContent)), 'and "Trying on" shows on the stage');
  await shot(page, 'locked-trying');
  await page.click('#btn-wd-card-close').catch(() => {}); await sleep(200);
  await page.click('#btn-wd-save'); await sleep(400);
  check((await ed(page)).ask === 'save', 'Save look asks first: it is not yours yet');
  await page.click('#btn-wd-takesave'); await sleep(600);
  await settle(page, () => window.__game.menuScreen() === 'main', null, 10000);
  check((await page.evaluate(() => window.__game.profile().avatar.hairStyle)) === 'swept', 'Take it off and save: your own hairstyle saved');
  // a Look saved with a try-on in it: said when it is saved, and named plainly ("Not yours") when it is worn
  await settle(page, () => window.__game.lobbyWardrobe()?.k === 0, null, 60000);
  await page.click('#btn-profile'); await stageStill(page);
  await area(page, 'hair', 'hairStyle'); await tapX(page, 'hairStyle', 'lamplighter');
  await area(page, 'looks');
  await page.click('#av-body button[data-act="save"][data-look="0"]'); await sleep(400);
  const note = () => page.evaluate(() => [...document.querySelectorAll('#av-body .wd-looknote:not(.wd-lookundo)')].map(e => e.textContent).join(' '));
  check(/not yours yet/.test(await note()), `a Look saved while trying on says so ("${await note()}")`);
  await page.click('#av-body button[data-act="rename-cancel"]'); await sleep(300);
  await tap(page, 'look', 'clara');
  await settle(page, () => window.__game.lobbyPlayer()?.avatar?.face === 'clara', null, 60000);
  await page.click('#av-body button[data-act="wear"][data-look="0"]'); await sleep(600);
  d = await ed(page);
  check(d.avatar.hairStyle !== 'lamplighter' && /^Not yours: The Poet\./.test(await note()), `worn, it names what is not yours and wears your own instead ("${await note()}")`);
  await shot(page, 'locked-look-worn');
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---- 4. Reduce Motion -----------------------------------------------------------------------------------------------
if (!skip.has('motion')) {
  console.log('\n4. Reduce Motion');
  const { browser, page, messages } = await open(1180, 820, { reducedMotion: 'reduce' });
  await area(page, 'outfit');
  await sleep(150);
  await page.click('#wd-rail button[data-area="hair"]');
  // (two frames later: a still room steps with no time, so the camera is already there)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const w = await page.evaluate(() => window.__game.lobbyWardrobe());
  check(w.shot === 'close' && w.shotK === 1, `the camera cuts to the close-up (no glide: ${w.shotK})`);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('.wd-fob.on')).transform === 'none'), 'the chosen fob does not slide out');
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL WARDROBE CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
