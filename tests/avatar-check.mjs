// Checks for the avatars: the catalogue (src/data/wardrobe.js), the computer guests' looks
// (src/data/randomAvatar.js), the models, glasses and runtime portraits (src/render/avatar.js,
// avatarGlasses.js, avatarPortrait.js), the wardrobe screen (src/ui/avatarEditor.js) and your avatar in
// the menu's lobby (src/menu/lobbyScene.js). Run from tests/ with the static server on 8123:
//   node avatar-check.mjs [--url http://127.0.0.1:8123/] [--shots DIR] [--skip node,render,portraits,eyes,wardrobe,lift,games]
//
//   1. node       the catalogue: unique ids, valid colours, exactly the six locked "Coming soon" items, an
//                 avatar made safe (unknown, locked or damaged values back to the look's own), another
//                 look or body keeps what it can, the wardrobe's slots per look
//   2. node       the bots' looks: the same name always gives the same look, free items only, never a
//                 look already at the table (the player's included) over 2000 tables, all six looks used
//   3. render     every look takes every value of every slot (the right parts painted, the iris or the
//                 model's own eyes, the glasses: fitted ones or Henry's own), no console errors; glasses
//                 for every look and style (built, a sensible size, round the eyes)
//   4. portraits  each look in its own colours, drawn at run time, matches the shipped picture
//                 (assets/portraits/*.jpg, normal and possessed): mean error under 3 levels of 255
//   5. eyes       the red eyes on every look with every eye colour (pixels at the eyes of a portrait), the
//                 iris colour back when not possessed, and the possessed switch kept through a change of
//                 eye colour (setAvatar while possessed); the shader programs stay within the budget
//   6. wardrobe   at 1024x768, 1180x820 and 1366x1024: the page never scrolls, the panel and Done are on
//                 screen, your avatar stands in the space right of the panel, head to feet; the rows in
//                 order; the locked items carry a lock and "Coming soon" and cannot be chosen; a pick shows
//                 on your avatar in the lobby at once; Done keeps it (your profile); Change name opens the
//                 register in rename mode
//   7. lift       practice: your avatar boards alone; a match: you, Victor and Clara
//   8. games      four tables in a row (Play again): one character view per seat, built from the seats'
//                 avatars, the others let go; the strip's portraits are the seats' own; geometry, shader
//                 programs and draw calls stay bounded
import fs from 'node:fs';
import { launch } from './smoke-lib.mjs';
import { BASES, ITEMS, SLOTS, item, itemId, itemsFor, normaliseAvatar, originalAvatar, slotsFor, withBase, withBody,
  avatarKey, avatarFromGuest, isAvailable, basesFor } from '../src/data/wardrobe.js';
import { randomAvatar, tableAvatars } from '../src/data/randomAvatar.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg('--url', 'http://127.0.0.1:8123/');
const shots = arg('--shots', null);
const skip = new Set((arg('--skip', '') || '').split(',').filter(Boolean));
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const BASE_IDS = Object.keys(BASES);
const LOCKED = ['hair.platinum', 'glasses.monocle', 'frame.goldFrame', 'main.champagne', 'main.gatsby', 'metal.roseGold'];
const PROGRAM_BUDGET = 28;      // a six-seat match (measured 22; 18 before avatars)

// ---------------------------------------------------------------------------------------------------
if (!skip.has('node')) {
  console.log('\n1. the catalogue');
  const ids = ITEMS.map(itemId);
  check(new Set(ids).size === ids.length, `every item has its own id (${ids.length} items)`);
  const hexOk = v => /^#[0-9a-f]{6}$/i.test(v);
  check(ITEMS.every(it => it.value == null || (Array.isArray(it.value) ? it.value.every(hexOk) : hexOk(it.value) || ['round', 'oval', 'deco', 'pincenez', 'monocle'].includes(it.value))), 'every colour is a 6-digit hex');
  check(JSON.stringify(ITEMS.filter(it => it.unlock !== 'free').map(itemId).sort()) === JSON.stringify([...LOCKED].sort()), `exactly the six locked items: ${LOCKED.join(', ')}`);
  check(ITEMS.filter(it => it.slot === 'eyes' && it.value).every(it => { const [r, g, b] = [1, 3, 5].map(i => parseInt(it.value[2].slice(i, i + 2), 16)); return !(r > 2 * g && r > 2 * b) && !(b > 1.3 * g && r > 1.3 * g); }), 'no eye colour is red, pink or violet (red eyes mean possessed)');
  for (const b of BASE_IDS) {
    const o = originalAvatar(b);
    check(JSON.stringify(normaliseAvatar(o)) === JSON.stringify(o), `${b}: its own look is already safe`);
  }
  const bad = normaliseAvatar({ base: 'clara', skin: 'nope', hair: 'platinum', eyes: 'red', glasses: 'monocle', frame: 'goldFrame', main: 'gatsby', accent: 12, metal: 'roseGold' });
  check(bad.base === 'clara' && bad.hair === originalAvatar('clara').hair && bad.glasses === 'none' && bad.main === originalAvatar('clara').main && bad.metal === 'gold' && bad.skin === originalAvatar('clara').skin,
    `unknown and locked values fall back to the look's own (${JSON.stringify(bad)})`);
  check(normaliseAvatar(null).base === 'victor' && normaliseAvatar('junk').v === 1, 'nothing at all gives a whole avatar');
  check(normaliseAvatar({ ...originalAvatar('marcus'), glasses: 'monocle' }, { owns: id => id === 'glasses.monocle' }).glasses === 'monocle', 'an owned locked item is kept (for later: nothing is owned yet)');
  const m = { ...originalAvatar('marcus'), skin: 'deep', eyes: 'green', glasses: 'oval', main: 'plum', accent: 'brass' };
  const f = withBody(m, 'f');
  check(f.base === 'eleanor' && f.skin === 'deep' && f.eyes === 'green' && f.glasses === 'oval' && f.main === 'plum', `Female keeps skin, eyes, glasses and outfit (${f.base})`);
  check(withBody(f, 'm').base === 'marcus', 'and Male goes back to the same place among the looks');
  check(withBase(m, 'henry').accent === 'brass' && withBase(m, 'eleanor').accent === originalAvatar('eleanor').accent, 'the accent is kept only where the look has one');
  check(JSON.stringify(basesFor('m')) === '["victor","marcus","henry"]' && JSON.stringify(basesFor('f')) === '["clara","eleanor","beatrice"]', 'Male: Tuxedo, Suit and tie, Dinner jacket; Female: Column dress, Ballgown, A-line gown');
  check(JSON.stringify(slotsFor(originalAvatar('victor'))) === '["skin","hair","eyes","glasses","main","accent"]', 'Tuxedo: Skin tone, Hair, Eyes, Glasses, Outfit, Accent');
  check(JSON.stringify(slotsFor({ ...originalAvatar('eleanor'), glasses: 'round' })) === '["skin","hair","eyes","glasses","frame","main","metal"]', 'Ballgown with glasses: … Glasses, Frame, Outfit, Jewellery (no accent)');
  check(itemsFor('accent', 'beatrice').length === 0 && itemsFor('metal', 'marcus').length === 0 && itemsFor('metal', 'clara').length === 3, 'accent and jewellery only where the look has them');
  check(avatarKey(m) !== avatarKey({ ...m, eyes: 'blue' }) && avatarKey(m) === avatarKey({ ...m }), 'the avatar key follows every slot');
  check(avatarFromGuest('p6')?.base === 'clara' && avatarFromGuest('random') === null, "last round's guest choice gives that look (Clara), Random none");

  console.log('\n2. the computer guests\' looks');
  const names = ['nightowl', 'fennel', 'velvet_owl', 'brass_lark', 'Mabel', 'cardboardknight', 'grumpy_otter', 'pocketfox', 'echo_echo', 'bramble', 'hollow_reed', 'plum'];
  check(names.every(n => JSON.stringify(randomAvatar(n)) === JSON.stringify(randomAvatar(n))), 'the same name always gives the same look');
  let clash = 0, locked = 0, mineTaken = 0;
  const seen = new Set();
  const pool = Array.from({ length: 84 }, (_, i) => `guest${i}_${(i * 7919) % 97}`);
  for (let t = 0; t < 2000; t++) {
    const me = normaliseAvatar(randomAvatar(`player${t}`));
    const us = Array.from({ length: 3 + (t % 3) }, (_, k) => pool[(t * 11 + k * 17) % pool.length]);
    const avs = tableAvatars(us, { taken: [me] });
    const looks = [me, ...avs].map(a => a.base);
    if (new Set(looks).size !== looks.length) clash++;
    if (avs.some(a => a.base === me.base)) mineTaken++;
    for (const a of avs) { seen.add(a.base); for (const s of SLOTS) if (s !== 'base' && !isAvailable(item(s, a[s]))) locked++; }
  }
  check(clash === 0, `2000 tables: never two guests in the same look (${clash})`);
  check(mineTaken === 0, `never a bot in your look (${mineTaken})`);
  check(locked === 0, `free items only: no bot wears a locked item (${locked})`);
  check(seen.size === 6, `all six looks are worn (${[...seen].join(', ')})`);
}

// ---------------------------------------------------------------------------------------------------
// The render checks run in the game's own page (a direct link: no menu), small and at a low resolution so
// the game's own frames do not slow the software renderer down.
async function renderPage() {
  const { browser, page, messages } = await launch({ width: 640, height: 480 });
  await page.goto(`${base}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.portraits, null, { timeout: 120000 });
  await page.evaluate(() => window.__game.setPixelRatio(0.5));
  return { browser, page, messages };
}

if (!skip.has('render') || !skip.has('portraits') || !skip.has('eyes')) {
  const { browser, page, messages } = await renderPage();

  if (!skip.has('render')) {
    console.log('\n3. every look, every value; glasses');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const A = await import('./src/render/avatar.js');
      const G = await import('./src/render/avatarGlasses.js');
      const THREE = await import('three');
      const near = (c, hex) => { const t = new THREE.Color(hex); return Math.abs(c.r - t.r) + Math.abs(c.g - t.g) + Math.abs(c.b - t.b) < 1e-4; };
      const out = { bad: [], applied: 0, glasses: [] };
      for (const b of Object.keys(W.BASES)) {
        const base = await A.loadBase(b);
        const def = W.BASES[b];
        const model = A.createAvatarModel(base, W.originalAvatar(b));
        for (const it of W.ITEMS) {
          if (!W.itemsFor(it.slot, b).length) continue;
          const av = { ...W.originalAvatar(b), [it.slot]: it.id, ...(it.slot === 'frame' ? { glasses: 'oval' } : {}) };
          model.setAvatar(av);
          out.applied++;
          const part = n => model.parts[n]?.material;
          let ok = true;
          if (it.slot === 'skin') ok = def.parts.skin.every(n => near(part(n).color, it.value)) && (def.parts.lips || []).every(n => near(part(n).color, it.lips));
          if (it.slot === 'hair') ok = def.parts.hair.every(n => near(part(n).color, it.value)) && def.parts.brow.every(n => !part(n) || near(part(n).color, it.brow));
          if (it.slot === 'main' || it.slot === 'accent' || it.slot === 'metal') ok = (def.parts[it.slot] || []).every(n => near(part(n).color, it.value));
          if (it.slot === 'eyes') {
            const m = model.parts.Eye.mesh.material;
            ok = it.value ? m.userData.possessedUniforms && near(m.userData.possessedUniforms.uIrisCore.value, it.value[2]) && m.userData.possessedUniforms.uGlow.value === 0
              : m === model.parts.Eye.material;
          }
          if (it.slot === 'glasses') {
            const builtIn = def.builtInGlasses && model.parts[def.builtInGlasses];
            if (!it.value) ok = !model.glasses && (!builtIn || !builtIn.mesh.visible);
            else if (builtIn && it.value === 'round') ok = builtIn.mesh.visible && !model.glasses;
            else ok = !!model.glasses && model.glasses.parent === model.headBone && (!builtIn || !builtIn.mesh.visible);
          }
          if (it.slot === 'frame') ok = !!model.glasses && near(model.glasses.material.color, it.value);
          if (!ok) out.bad.push(`${b}:${it.slot}.${it.id}`);
        }
        model.dispose();
        for (const style of ['round', 'oval', 'deco', 'pincenez', 'monocle']) {
          const geo = G.buildGlasses(base, style);
          const tris = geo ? (geo.index ? geo.index.count : geo.attributes.position.count) / 3 : 0;
          const e = base.eyes;
          if (!geo.boundingBox) geo.computeBoundingBox();
          const bb = geo.boundingBox, front = Math.max(e.left.centre.z, e.right.centre.z);
          // in front of the eyes (the bridge over the big noses: at most 9 cm), across both eyes (one for the
          // monocle), at eye height
          const ok = bb.max.z > front && bb.max.z < front + 0.09
            && bb.min.x < e.left.centre.x && (style === 'monocle' || bb.max.x > e.right.centre.x)
            && bb.min.y < e.left.centre.y && bb.max.y > e.left.centre.y
            && (style === 'pincenez' || style === 'monocle' || bb.min.z < front - 0.08);   // (temples back toward the ears)
          out.glasses.push({ b, style, tris: Math.round(tris), ok, box: [bb.min.toArray().map(v => +v.toFixed(3)), bb.max.toArray().map(v => +v.toFixed(3))] });
        }
      }
      return out;
    });
    check(r.bad.length === 0, `${r.applied} values applied on the six looks, each painting what it should${r.bad.length ? ` (wrong: ${r.bad.join(', ')})` : ''}`);
    const gBad = r.glasses.filter(g => !(g.tris > 300 && g.tris < 6000 && g.ok));
    check(gBad.length === 0, `glasses for every look and style: built, ${Math.min(...r.glasses.map(g => g.tris))}-${Math.max(...r.glasses.map(g => g.tris))} triangles, in front of the eyes, temples back to the ears${gBad.length ? ` (odd: ${JSON.stringify(gBad)})` : ''}`);
  }

  if (!skip.has('portraits')) {
    console.log('\n4. runtime portraits vs the shipped pictures');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const P = window.__game.portraits();
      const pixels = (src, w, h) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0, w, h); res(g.getImageData(0, 0, w, h).data); }; i.onerror = rej; i.src = src; });
      const out = [];
      for (const b of Object.keys(W.BASES)) for (const possessed of [false, true]) {
        const canvas = await P.draw(W.originalAvatar(b), { possessed, original: true, w: 576, h: 768 });
        const mine = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 576, 768).data;
        const ref = await pixels(W.shippedPortrait(b, possessed), 576, 768);
        let sum = 0;
        for (let i = 0; i < mine.length; i += 4) sum += Math.abs(mine[i] - ref[i]) + Math.abs(mine[i + 1] - ref[i + 1]) + Math.abs(mine[i + 2] - ref[i + 2]);
        out.push({ b, possessed, mae: +(sum / (576 * 768 * 3)).toFixed(2) });
      }
      return out;
    });
    for (const x of r) check(x.mae < 3, `${x.b}${x.possessed ? ' possessed' : ''}: mean error ${x.mae} of 255`);
  }

  if (!skip.has('eyes')) {
    console.log('\n5. red eyes on every look with every eye colour');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const A = await import('./src/render/avatar.js');
      const P = window.__game.portraits();
      const w = 288, h = 384;
      const sample = (canvas, pts) => {
        const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        let red = 0, n = 0; const mean = [0, 0, 0];
        for (const [x0, y0] of pts) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(x0 + dx), y = Math.round(y0 + dy), j = (y * w + x) * 4;
          const [rr, g, b] = [d[j], d[j + 1], d[j + 2]];
          if (rr > 2.2 * g && rr > 1.8 * b && rr > 60) red++;
          mean[0] += rr; mean[1] += g; mean[2] += b; n++;
        }
        return { red: red / n, mean: mean.map(v => Math.round(v / n)) };
      };
      const out = [];
      for (const b of Object.keys(W.BASES)) {
        for (const e of W.ITEMS.filter(it => it.slot === 'eyes')) {
          const av = { ...W.originalAvatar(b), eyes: e.id };
          const red = await P.draw(av, { possessed: true, w, h });
          const pts = P.eyesAt(b, w, h);
          const normal = await P.draw(av, { possessed: false, w, h });
          out.push({ b, eyes: e.id, poss: sample(red, pts), norm: sample(normal, pts) });
        }
      }
      // the switch through a change of eye colour while possessed (the wardrobe, a reused view)
      const base = await A.loadBase('clara');
      const m = A.createAvatarModel(base, { ...W.originalAvatar('clara'), eyes: 'blue' });
      const eyeMat = () => m.parts.Eye.mesh.material;
      m.setPossessed(true);
      const s1 = eyeMat().name;
      m.setAvatar({ ...W.originalAvatar('clara'), eyes: 'green' });
      const s2 = eyeMat().name, s2red = eyeMat().userData.possessedUniforms?.uIrisCore.value.getHexString();
      m.setPossessed(false);
      const s3 = eyeMat().userData.possessedUniforms?.uIrisCore.value.getHexString();
      m.setAvatar({ ...W.originalAvatar('clara'), eyes: 'classic' });
      m.setPossessed(true); m.setPossessed(false);
      const s4 = eyeMat() === m.parts.Eye.material;
      m.dispose();
      return { out, sw: { s1, s2, s2red, s3, s4 }, programs: window.__game.programCount() };
    });
    const redBad = r.out.filter(x => !(x.poss.red >= 0.3));
    check(redBad.length === 0, `possessed: red at the eyes on all ${r.out.length} looks x eye colours${redBad.length ? ` (not red: ${redBad.map(x => `${x.b}/${x.eyes} ${x.poss.red.toFixed(2)}`).join(', ')})` : ''}`);
    const normBad = r.out.filter(x => x.norm.red > 0.05);
    check(normBad.length === 0, `not possessed: no red at the eyes${normBad.length ? ` (red: ${normBad.map(x => `${x.b}/${x.eyes}`).join(', ')})` : ''}`);
    const hue = { blue: m => m[2] > m[0], green: m => m[1] > m[0] && m[1] > m[2] };
    const hueBad = r.out.filter(x => hue[x.eyes] && !hue[x.eyes](x.norm.mean));
    check(hueBad.length === 0, `blue eyes read blue and green eyes green${hueBad.length ? ` (${hueBad.map(x => `${x.b}/${x.eyes} ${x.norm.mean}`).join(', ')})` : ''}`);
    check(/possessed/.test(r.sw.s1) && /possessed/.test(r.sw.s2) && r.sw.s2red === 'a51d2a',
      `red eyes stay on through a change of eye colour (${r.sw.s1} -> ${r.sw.s2}, core #${r.sw.s2red})`);
    const green = item('eyes', 'green').value[2].slice(1);
    check(r.sw.s3 === green, `un-possessed: the new iris comes back (core #${r.sw.s3}, green is #${green})`);
    check(r.sw.s4, "back to classic eyes, red on and off: the model's own eyes return");
    check(r.programs <= PROGRAM_BUDGET, `shader programs within the budget (${r.programs} <= ${PROGRAM_BUDGET})`);
  }
  check(!messages.filter(m => !/GPU stall|ReadPixels/i.test(m)).length, `no console errors (render checks)${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
async function menuPage(w, h) {
  const { browser, page, messages } = await launch({ width: w, height: h });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.lobbyReady() && window.__game.lobbyPlayer() && !document.getElementById('btn-menu-bots').disabled, null, { timeout: 180000 });
  return { browser, page, messages };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!skip.has('wardrobe')) {
  console.log('\n6. the wardrobe');
  for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) {
    const { browser, page, messages } = await menuPage(w, h);
    const tag = `${w}x${h}`;
    const idle = await page.evaluate(() => window.__game.lobbyPlayer());
    check(!!idle && Math.abs(idle.x - 2.05) < 0.05 && Math.abs(idle.z + 4.3) < 0.05, `${tag}: your avatar stands by the lift in the lobby (${idle?.base})`);
    await page.click('#btn-profile');
    await page.waitForFunction(() => window.__game.menuScreen() === 'avatar' && window.__game.lobbyWardrobe()?.k >= 1, null, { timeout: 90000 });
    await sleep(700);
    const lay = await page.evaluate(() => {
      const se = document.scrollingElement, panel = document.querySelector('#menu .menu-panel').getBoundingClientRect();
      const done = document.getElementById('btn-av-done').getBoundingClientRect();
      const hit = document.elementFromPoint(done.left + done.width / 2, done.top + done.height / 2);
      return { scroll: [se.scrollHeight, innerHeight, se.scrollWidth, innerWidth], panel: panel.toJSON(), done: done.toJSON(), doneHit: hit?.id || hit?.closest('button')?.id,
        blurred: document.getElementById('view').classList.contains('blurred'), you: window.__game.lobbyPlayer().screen, ed: window.__game.avatarEditor() };
    });
    check(lay.scroll[0] <= lay.scroll[1] && lay.scroll[2] <= lay.scroll[3], `${tag}: the page does not scroll (${lay.scroll.join(' ')})`);
    check(lay.panel.top >= 0 && lay.panel.bottom <= h && lay.done.bottom <= h && lay.doneHit === 'btn-av-done', `${tag}: the panel and Done are on screen (panel ${Math.round(lay.panel.top)}-${Math.round(lay.panel.bottom)})`);
    const [fx, fy] = lay.you.feet, [hx, hy] = lay.you.head;
    check(Math.min(fx, hx) > lay.panel.right + 20 && Math.max(fx, hx) < w - 20 && hy > 0 && fy < h, `${tag}: your avatar stands right of the panel, head to feet on screen (head ${hx.toFixed(0)},${hy.toFixed(0)} feet ${fx.toFixed(0)},${fy.toFixed(0)}; panel ends ${lay.panel.right.toFixed(0)})`);
    check(!lay.blurred, `${tag}: the lobby is sharp behind the wardrobe`);
    const order = lay.ed.rows.map(r => r.slot).join(',');
    check(order === 'body,base,skin,hair,eyes,glasses,main,accent', `${tag}: the rows in order (${order})`);
    const bodyRow = lay.ed.rows[0];
    check(bodyRow.label === 'Body' && await page.evaluate(() => [...document.querySelectorAll('#av-body button[data-slot="body"]')].map(b => b.textContent.trim()).join('/')) === 'Male/Female', `${tag}: the first choice is Male / Female`);
    if (shots) await page.screenshot({ path: `${shots}/wardrobe-${tag}.png` });
    if (w === 1180) {
      const lockedShown = lay.ed.rows.flatMap(r => r.locked.map(id => `${r.slot}.${id}`));
      check(['hair.platinum', 'glasses.monocle', 'main.champagne', 'main.gatsby'].every(id => lockedShown.includes(id)), `locked items shown with a lock (${lockedShown.join(', ')})`);
      check(await page.evaluate(() => [...document.querySelectorAll('#av-body button.locked')].every(b => b.querySelector('.av-lock') && /coming soon/i.test(b.getAttribute('aria-label') || b.textContent))), 'each says "Coming soon"');
      const tapOpt = async (slot, id) => { await page.click(`#av-body button[data-slot="${slot}"][data-id="${id}"]`); await sleep(350); };
      const before = await page.evaluate(() => window.__game.avatarEditor().avatar);
      await tapOpt('glasses', 'monocle');
      const after = await page.evaluate(() => ({ av: window.__game.avatarEditor().avatar, cap: window.__game.avatarEditor().rows.find(r => r.slot === 'glasses').caption }));
      check(JSON.stringify(after.av) === JSON.stringify(before) && /Monocle · Coming soon/.test(after.cap), `a locked item cannot be chosen ("${after.cap}")`);
      await tapOpt('main', 'claret');
      check(await page.evaluate(() => window.__game.lobbyPlayer().avatar.main) === 'claret', 'a new outfit colour shows on your avatar at once');
      await tapOpt('glasses', 'round');
      const rows = await page.evaluate(() => window.__game.avatarEditor().rows.map(r => r.slot).join(','));
      check(/glasses,frame,main/.test(rows) && await page.evaluate(() => window.__game.lobbyPlayer().glasses), `glasses on: Frame appears, the glasses show in the lobby (${rows})`);
      await tapOpt('frame', 'goldFrame');
      check(await page.evaluate(() => window.__game.avatarEditor().avatar.frame) !== 'goldFrame', 'gold frames are locked too');
      await tapOpt('body', 'f');
      await page.waitForFunction(() => ['clara', 'eleanor', 'beatrice'].includes(window.__game.lobbyPlayer()?.base), null, { timeout: 60000 });
      const fem = await page.evaluate(() => ({ ed: window.__game.avatarEditor(), pl: window.__game.lobbyPlayer() }));
      check(fem.ed.rows[1].options.join(',') === 'clara,eleanor,beatrice' && fem.pl.avatar.main === 'claret' && fem.pl.avatar.glasses === 'round', `Female: the three gowns; outfit and glasses kept, rebuilt in the lobby (${fem.pl.base})`);
      await tapOpt('base', 'eleanor');
      await page.waitForFunction(() => window.__game.lobbyPlayer()?.base === 'eleanor', null, { timeout: 60000 });
      const gown = await page.evaluate(() => window.__game.avatarEditor().rows.map(r => r.slot).join(','));
      check(/main,metal$/.test(gown) && !/accent/.test(gown), `Ballgown: Jewellery, no Accent (${gown})`);
      check(await page.evaluate(() => window.__game.avatarEditor().rows.find(r => r.slot === 'metal').locked.join()) === 'roseGold', 'rose gold jewellery is locked');
      await tapOpt('eyes', 'hazel');
      await sleep(1500);
      if (shots) await page.screenshot({ path: `${shots}/wardrobe-gown-${tag}.png` });
      await page.click('#btn-av-done');
      await page.waitForFunction(() => window.__game.menuScreen() === 'main', null, { timeout: 10000 });
      await sleep(400);
      const saved = await page.evaluate(() => window.__game.profile().avatar);
      check(saved.base === 'eleanor' && saved.main === 'claret' && saved.glasses === 'round' && saved.eyes === 'hazel', `Done keeps your avatar in your profile (${JSON.stringify(saved)})`);
      check(await page.evaluate(() => document.getElementById('view').classList.contains('blurred')), 'back on the main menu, the lobby is soft again');
      await page.waitForFunction(() => window.__game.lobbyWardrobe()?.k === 0, null, { timeout: 60000 });
      await page.click('#btn-profile');
      await page.waitForFunction(() => window.__game.menuScreen() === 'avatar', null, { timeout: 10000 });
      await sleep(500);
      await page.click('#btn-av-rename');
      await page.waitForFunction(() => window.__game.menuScreen() === 'signup', null, { timeout: 10000 });
      check(await page.evaluate(() => document.getElementById('su-name').value) === 'tester', 'Change name opens the register, your name filled in');
      check(!(await page.evaluate(() => window.__game.lobbyWardrobe()?.want)), 'and the wardrobe camera lets go');
      await sleep(500);
      await page.click('#btn-su-suggest');      // (Cancel, in rename mode)
      await page.waitForFunction(() => window.__game.menuScreen() === 'avatar', null, { timeout: 10000 }).catch(() => {});
      const back = await page.evaluate(() => ({ screen: window.__game.menuScreen(), want: window.__game.lobbyWardrobe()?.want, av: window.__game.avatarEditor().avatar }));
      check(back.screen === 'avatar' && back.want === 1 && back.av.base === 'eleanor', `Cancel goes back to the wardrobe, its camera and your avatar (${back.screen}, ${back.av.base})`);
    }
    check(!messages.length, `${tag}: no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
}

if (!skip.has('lift')) {
  console.log('\n7. the lift');
  {
    const { browser, page, messages } = await menuPage(1180, 820);
    await sleep(600);
    await page.click('#btn-menu-practice');
    await page.waitForFunction(() => window.__game.lobbyBoarders(), null, { timeout: 20000 });
    check(JSON.stringify(await page.evaluate(() => window.__game.lobbyBoarders())) === '["you"]', 'practice: your avatar boards alone');
    await sleep(2600);
    if (shots) await page.screenshot({ path: `${shots}/lift-practice.png` });
    await page.waitForFunction(() => window.__game.phase() === 'game', null, { timeout: 60000 });
    check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
  {
    const { browser, page, messages } = await menuPage(1180, 820);
    await sleep(600);
    await page.click('#btn-menu-bots');
    await sleep(500);
    await page.click('#btn-bots-find');
    await page.waitForFunction(() => window.__game.lobbyBoarders(), null, { timeout: 60000 });
    check(JSON.stringify(await page.evaluate(() => window.__game.lobbyBoarders())) === '["you","victor","clara"]', 'a match: you board first, with Victor and Clara');
    await sleep(3000);
    if (shots) await page.screenshot({ path: `${shots}/lift-match.png` });
    await page.waitForFunction(() => window.__game.phase() === 'game', null, { timeout: 60000 });
    check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
}

if (!skip.has('games')) {
  console.log('\n8. four tables in a row');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  // (no ?seed=: Play again deals a new table each time, with new computer guests in new looks)
  await page.goto(`${base}?mode=bots&bots=5&timer=off&botpace=0.1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.settled() && !document.getElementById('btn-begin')?.disabled, null, { timeout: 240000 });
  await page.click('#btn-begin');
  const tables = [];
  let prevSeats = '';
  for (let t = 0; t < 4; t++) {
    // (a new table: the role screen of a new game, its seats not the last table's, every guest loaded)
    await page.waitForFunction(prev => { const g = window.__game; return g.isRunning() && !g.endOpen() && g.handoffKind() === 'role' && JSON.stringify(g.seats().map(s => s.name)) !== prev
      && g.characters.every(c => c.debug().loaded); }, prevSeats, { timeout: 180000 });
    prevSeats = await page.evaluate(() => JSON.stringify(window.__game.seats().map(s => s.name)));
    await page.waitForFunction(() => window.__game.portraits().pending() === 0, null, { timeout: 180000 }).catch(() => {});
    await sleep(1200);
    // (one plain frame of the game: the counts of the hotel's own frame, not a portrait's)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    tables.push(await page.evaluate(() => {
      const g = window.__game;
      const seats = g.seats();
      return {
        seats: seats.map(s => `${s.name}:${s.avatar.base}`),
        views: g.characterViewCount(), viewLooks: g.characters.map(c => c.debug().avatar?.base),
        sameLooks: seats.every((s, i) => JSON.stringify(g.characters[i].debug().avatar) === JSON.stringify(s.avatar)),
        strip: [...document.querySelectorAll('#players-strip .mini-portrait img')].map(i => i.dataset.portrait || ''),
        info: g.renderInfo(), heap: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6),
        cached: g.portraits().cached(),
      };
    }));
    const T = tables[t];
    check(T.views === T.seats.length && T.sameLooks, `table ${t + 1}: one view per seat, each in its seat's avatar (${T.seats.join(', ')})`);
    check(T.strip.length === T.seats.length && T.strip.every(Boolean), `table ${t + 1}: the strip shows each seat's own portrait`);
    if (t < 3) {
      await page.evaluate(() => window.__game.skipToEnd());
      await page.waitForFunction(() => window.__game.endOpen(), null, { timeout: 60000 });
      await page.waitForSelector('#btn-restart', { state: 'visible', timeout: 60000 });
      await sleep(600);
      await page.click('#btn-restart');
    }
  }
  const g0 = tables[0].info, gN = tables[3].info;
  console.log('   ', tables.map(T => `geo ${T.info.geometries} tex ${T.info.textures} prog ${T.info.programs} calls ${T.info.calls} heap ${T.heap} MB portraits ${T.cached}`).join(' | '));
  // (measured before avatars, the same four tables: textures 21-27, draw calls 129-213 at the role screen,
  // geometry 149 -> 494: the hotel's own room pieces, kept as new rooms are seen; it levels off)
  check(Math.max(...tables.map(T => T.info.textures)) <= g0.textures + 20, `textures stay level over four tables (${tables.map(T => T.info.textures).join(', ')}): one bone texture per guest, let go with the view`);
  check(gN.geometries < 800, `geometry stays within bounds (${tables.map(T => T.info.geometries).join(', ')})`);
  check(gN.programs <= PROGRAM_BUDGET, `shader programs within the budget (${gN.programs})`);
  check(Math.max(...tables.map(T => T.info.calls)) < 260, `draw calls as before avatars (${tables.map(T => T.info.calls).join(', ')})`);
  check(Math.max(...tables.map(T => T.heap)) < 160, `memory stays bounded (${tables.map(T => T.heap).join(', ')} MB)`);
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall avatar checks passed');
process.exit(failures.length ? 1 : 0);
