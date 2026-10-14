// Browser checks for the round 2 polish items (audit G5, G7, G12, G13, G14), in headless Chromium (software WebGL, a
// few frames a second). Serve the repo first, then:
//   node tests/browser-polish.mjs [--url http://127.0.0.1:8123/] [--only head,reload,focus,scroll,text,seats] [--control]
//   (--control: the focus section against a focus.js that does nothing, as the game was before: it must FAIL)
//
//   head    the app icon (G13): the page names its icon, apple-touch-icon and manifest with RELATIVE paths and they load
//           from a sub-path (/Gaming-App/, where GitHub Pages serves the game); the icons are the sizes they say; the
//           manifest has its name, standalone, landscape, navy colours and icons that load; nothing 404s
//   reload  a match cut short (G14): a real match (started from the menu) marks itself; a reload mid-match shows the
//           card once and counts one "Left early"; leaving by the Menu, a finished match and a stale or damaged marker
//           show nothing; a direct link (?mode=) neither reads nor writes the marker
//   focus   keyboard focus (G12): each private screen takes the focus on its main button, Tab stays inside (never
//           reaching "Main menu" under the secret role), Escape does not skip it, it is a labelled modal dialog, and
//           focus goes back where it was; a card can be chosen with the keyboard
//   scroll  tall pop-ups (G12): a finger can scroll the four containers marked data-scrolls (checked with real touch
//           swipes through the DevTools protocol, and without the attribute they do not move: the check can fail);
//           11 cards in the discard screen fit at 1024x694 without scrolling
//   text    small text (G5): nothing visible is under 11 px on the screens checked, the key labels are the sizes asked
//           for, and no HUD block overlaps another or clips its words at 1024x768 and 1024x694
//   seats   guests easier to tell apart (G7): each guest's initial in the strip's portrait and in the plan's dot, the
//           six seat colours, and the floor rings (about 0.6 for the other guests, with a dark edge)
import { launch, GUARD_WAIT } from './smoke-lib.mjs';
import { guestMarks } from '../src/table.js';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['head', 'reload', 'focus', 'scroll', 'text', 'seats'];
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const outDir = path.join(here, 'shots', 'polish');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const waitFor = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
// (a page left or reloaded while a model is still downloading aborts that download: not a failure, and the reload
// section does exactly that on purpose)
const quiet = messages => messages.filter(m => !/Failed to load resource|requestfailed: .*ERR_ABORTED/.test(m));
const MARKER = 'hotelEscape.matchInProgress.v1';

// A match against bots from a direct link, past the role screen, on the player's own turn.
async function intoMatch(page, { role = 'clean', bots = 3, keepRole = false } = {}) {
  await page.goto(`${baseUrl}?mode=bots&bots=${bots}&role=${role}&intro=off&botpace=0.1&seed=11&seat=0&timer=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 180000);
  await page.click('#btn-begin');
  await waitFor(page, () => window.__game.handoffKind() === 'role');
  await page.waitForTimeout(500);
  if (keepRole) return;
  await page.click('#btn-handoff-next');
  await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 180000);
  await page.waitForTimeout(800);
}
// A real match from the main menu (not a direct link), to the role screen: the menu, "Play with bots", "Find a table".
async function matchFromMenu(page, extra = '') {
  await page.goto(`${baseUrl}?intro=off&botpace=0.1&timer=off&seed=5${extra}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 180000);
  await page.waitForTimeout(600);
  await page.click('#btn-menu-bots'); await page.waitForTimeout(500);
  await page.click('#btn-bots-find');
  await waitFor(page, () => window.__game.handoffKind() === 'role', null, 240000);
  await page.waitForTimeout(300);
}
const marker = page => page.evaluate(k => localStorage.getItem(k), MARKER);
const menuUp = page => waitFor(page, () => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 180000);

// ---------------------------------------------------------------------------------------------------
if (only.includes('head')) {
  console.log('\nhead. the app icon, the manifest, the sub-path');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  const origin = new URL(baseUrl).origin;
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary' };
  const served = [];
  // The game at /Gaming-App/ (its place on GitHub Pages): this page's files, from disk, under that path.
  await page.route(`${origin}/Gaming-App/**`, route => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname.replace(/^\/Gaming-App\//, '')) || 'index.html';
    const file = path.join(root, rel);
    served.push(rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: types[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  });
  try {
    await page.goto(`${origin}/Gaming-App/`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 180000);
    const links = await page.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]')]
      .map(l => ({ rel: l.rel, href: l.getAttribute('href'), abs: l.href, sizes: l.getAttribute('sizes'), type: l.getAttribute('type') })));
    const find = (rel, sizes = null) => links.find(l => l.rel.split(' ').includes(rel) && (sizes ? l.sizes === sizes : true));
    check(find('icon', '32x32') && find('icon', '16x16') && links.some(l => l.rel.includes('icon') && l.type === 'image/svg+xml'), 'the page names a 32 px and a 16 px favicon and an SVG one');
    check(find('apple-touch-icon')?.sizes === null || !!find('apple-touch-icon'), 'and an apple-touch-icon');
    check(!!find('manifest'), 'and a manifest');
    check(links.every(l => /^\.\//.test(l.href) && l.abs.startsWith(`${origin}/Gaming-App/`)), `every one is a relative path that resolves under the sub-path (${links.map(l => l.href).join(', ')})`);
    const metas = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('meta[name]')].map(m => [m.name, m.content])));
    check(metas['apple-mobile-web-app-capable'] === 'yes' && metas['apple-mobile-web-app-status-bar-style'] === 'black-translucent' && metas['apple-mobile-web-app-title'] === 'Hotel Escape' && /^#[0-9a-f]{6}$/i.test(metas['theme-color']), `the Home Screen meta tags: capable, translucent status bar, title "${metas['apple-mobile-web-app-title']}", theme colour ${metas['theme-color']}`);

    // The icons: each loads and is the size it is named for (read from the PNG's own header).
    const png = rel => { const b = fs.readFileSync(path.join(root, rel)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ok: b.subarray(1, 4).toString() === 'PNG' }; };
    for (const [rel, n] of [['assets/icons/icon-180.png', 180], ['assets/icons/icon-192.png', 192], ['assets/icons/icon-512.png', 512], ['assets/icons/icon-maskable-512.png', 512], ['assets/icons/favicon-32.png', 32], ['assets/icons/favicon-16.png', 16]]) {
      const p = png(rel); check(p.ok && p.w === n && p.h === n, `${rel} is a ${n}x${n} PNG`);
    }
    check(fs.statSync(path.join(root, 'assets/icons/icon.svg')).size > 500 && fs.statSync(path.join(root, 'assets/icons/favicon.svg')).size > 200, 'the master icon and the SVG favicon are there');
    const loaded = await page.evaluate(async hrefs => Promise.all(hrefs.map(h => new Promise(res => { const i = new Image(); i.onload = () => res([h, i.naturalWidth]); i.onerror = () => res([h, 0]); i.src = h; }))), links.filter(l => l.rel !== 'manifest').map(l => l.abs));
    check(loaded.every(([, w]) => w > 0), `every icon the page names loads in the browser (${loaded.map(([h, w]) => `${h.split('/').pop()} ${w}px`).join(', ')})`);

    // The manifest.
    const mUrl = find('manifest').abs;
    const m = await page.evaluate(async u => { const r = await fetch(u); return { status: r.status, json: await r.json() }; }, mUrl);
    const j = m.json;
    check(m.status === 200 && j.name === 'Hotel Escape' && j.short_name === 'Hotel Escape', 'the manifest is named Hotel Escape');
    check(j.display === 'standalone' && j.orientation === 'landscape', `standalone and landscape (${j.display}, ${j.orientation})`);
    check(/^#0[0-9a-f]{5}$/i.test(j.theme_color) && /^#0[0-9a-f]{5}$/i.test(j.background_color) && j.theme_color === metas['theme-color'], `navy theme and background colours that match the page (${j.theme_color}, ${j.background_color})`);
    check(j.start_url === './' && j.scope === './', 'start_url and scope are relative (./), so they stay under the sub-path');
    const iconUrls = j.icons.map(i => new URL(i.src, mUrl).href);
    check(j.icons.every(i => !i.src.startsWith('/') && !/^https?:/.test(i.src)) && iconUrls.every(u => u.startsWith(`${origin}/Gaming-App/assets/icons/`)), 'every manifest icon is a relative path that resolves under the sub-path');
    check(j.icons.some(i => i.sizes === '192x192') && j.icons.some(i => i.sizes === '512x512') && j.icons.some(i => i.purpose === 'maskable'), 'icons of 192 and 512 px, and a maskable one');
    const fetched = await page.evaluate(async urls => Promise.all(urls.map(async u => (await fetch(u)).status)), iconUrls);
    check(fetched.every(s => s === 200), `every manifest icon loads (${fetched.join(', ')})`);
    check(!served.some(r => /favicon\.ico|apple-touch-icon\.png/.test(r)), 'nothing asks for /favicon.ico or /apple-touch-icon.png any more');
    const missing = messages.filter(m => /404|Failed to load resource|requestfailed/.test(m) && !/\.(mp3|glb)/.test(m));
    check(!missing.length, `no request failed${missing.length ? ` (${missing.slice(0, 3).join(' | ')})` : ''}`);
    // A look at the icon at the two sizes it is used at: the Home Screen's 180 px, and the tab's 32 px.
    await page.setContent(`<body style="margin:0;background:#2a2a2a"><div style="display:flex;gap:30px;align-items:center;padding:20px">
      <img src="${origin}/Gaming-App/assets/icons/icon-180.png" width="180" height="180" style="border-radius:40px">
      <img src="${origin}/Gaming-App/assets/icons/favicon-32.png" width="32" height="32">
      <img src="${origin}/Gaming-App/assets/icons/favicon-32.png" width="128" height="128" style="image-rendering:pixelated">
      <img src="${origin}/Gaming-App/assets/icons/favicon-16.png" width="16" height="16">
      <img src="${origin}/Gaming-App/assets/icons/icon-512.png" width="256" height="256"></div></body>`);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, 'icon-sizes.png'), clip: { x: 0, y: 0, width: 780, height: 240 } });
  } catch (err) { check(false, `head: ${err.message}`); }
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('reload')) {
  console.log('\nreload. a match cut short');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const left = () => ev(() => window.__game.record().left);
  const played = () => ev(() => window.__game.record().played);
  const noticeText = () => ev(() => ({ open: window.__game.noticeOpen(), title: document.getElementById('notice-title').textContent, body: document.getElementById('notice-body').textContent }));
  try {
    // 1. a real match marks itself, and a reload in the middle of it is noticed once
    await matchFromMenu(page);
    const m1 = JSON.parse((await marker(page)) || 'null');
    check(m1 && m1.t > Date.now() - 120000 && m1.t <= Date.now(), `a match started from the menu writes the marker with the time (${m1 && Math.round((Date.now() - m1.t) / 1000)} s ago)`);
    check(!/role|possess|hand|seed|clean/i.test(await marker(page)), 'and the marker says nothing of the match (no role, no hand)');
    const before = await left();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page);
    await page.waitForTimeout(900);
    let n = await noticeText();
    check(n.open && n.body === 'The game was restarted by your browser. Your last match was not finished.', `a reload mid-match: the card says "${n.body}"`);
    check((await left()) === before + 1, `and counts one Left early (${before} -> ${await left()})`);
    check((await marker(page)) === null, 'and the marker is gone');
    check(await ev(() => !document.getElementById('menu').hidden && document.getElementById('notice-overlay').getBoundingClientRect().width > 0
      && document.elementFromPoint(innerWidth / 2, innerHeight / 2)?.closest('#notice-overlay') != null), 'the card is above the main menu (the menu cannot be tapped through it)');
    check(await ev(() => document.activeElement?.id === 'btn-notice-ok'), 'and its Continue button has the keyboard focus');
    await page.screenshot({ path: path.join(outDir, 'reload-note.png') });
    await page.click('#btn-notice-ok'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.noticeOpen()), 'Continue closes it');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(700);
    check(!(await noticeText()).open && (await left()) === before + 1, 'a second reload says nothing and counts nothing more: once only');

    // 2. leaving by the Menu: nothing is said at the next start, and it counted one Left early then (the old way)
    await matchFromMenu(page);
    check(!!(await marker(page)), 'a second match is marked');
    const l2 = await left();
    await page.evaluate(() => { const g = window.__game; g.state.players[g.humanSeat()].roleSeen = true; });
    await page.click('#btn-handoff-next');
    await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 180000);
    await page.waitForTimeout(500);
    check(!!(await marker(page)), 'still marked while it is played');
    await page.click('#btn-leave'); await page.waitForTimeout(GUARD_WAIT + 150);
    if (await ev(() => !!document.getElementById('gamemenu-overlay') && !document.getElementById('gamemenu-overlay').hidden)) { await page.click('#btn-gm-leave'); await page.waitForTimeout(GUARD_WAIT + 150); }
    await waitFor(page, () => window.__game.askOpen(), null, 10000);
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-ask-yes');
    await waitFor(page, () => window.__game.phase() === 'menu' && !window.__game.askOpen(), null, 30000);
    check((await marker(page)) === null, 'Leave > Main menu clears the marker');
    check((await left()) === l2 + 1, `and counted one Left early on the spot (${l2} -> ${await left()})`);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(700);
    check(!(await noticeText()).open && (await left()) === l2 + 1, 'a reload after leaving on purpose says nothing and counts nothing more');

    // 3. a finished match
    await matchFromMenu(page);
    await page.click('#btn-handoff-next');
    await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 180000);
    check(!!(await marker(page)), 'a third match is marked');
    const l3 = await left(), p3 = await played();
    await ev(() => window.__game.skipToEnd());
    await waitFor(page, () => window.__game.endOpen(), null, 120000);
    check((await marker(page)) === null, 'the end screen clears the marker');
    check((await played()) === p3 + 1 && (await left()) === l3, 'the match is counted as played, not as left early');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(700);
    check(!(await noticeText()).open && (await left()) === l3, 'a reload after a finished match says nothing');

    // 4. a marker that is too old, or damaged, is ignored (and removed)
    const l4 = await left();
    await ev(k => localStorage.setItem(k, JSON.stringify({ v: 1, t: Date.now() - 6.5 * 3600 * 1000 })), MARKER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(700);
    check(!(await noticeText()).open && (await left()) === l4 && (await marker(page)) === null, 'a marker 6.5 hours old is ignored and removed');
    await ev(k => localStorage.setItem(k, '{not json'), MARKER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(700);
    check(!(await noticeText()).open && (await left()) === l4 && (await marker(page)) === null, 'a damaged marker is ignored and removed');
    await ev(k => localStorage.setItem(k, JSON.stringify({ v: 1, t: Date.now() - 5 * 3600 * 1000 })), MARKER);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(900);
    check((await noticeText()).open && (await left()) === l4 + 1, 'a marker 5 hours old still counts (the limit is 6)');
    await page.click('#btn-notice-ok');

    // 5. a direct link neither reads nor writes the marker
    await ev(k => localStorage.setItem(k, JSON.stringify({ v: 1, t: Date.now() - 60000 })), MARKER);
    const l5 = await left();
    await intoMatch(page, { keepRole: true });
    check((await marker(page)) !== null && JSON.parse(await marker(page)).t > Date.now() - 120000 && JSON.parse(await marker(page)).t < Date.now() - 30000, 'a direct link (?mode=bots) leaves a marker that is there exactly as it was');
    check(!(await noticeText()).open, 'and shows no card');
    await ev(() => window.__game.skipToEnd()); await waitFor(page, () => window.__game.endOpen() || window.__game.handoffOpen(), null, 60000);
    await ev(() => window.__game.backToMenu());
    await page.waitForTimeout(2500);
    check((await marker(page)) !== null, 'and ending or leaving a direct-link match does not clear it');
    await ev(k => localStorage.removeItem(k), MARKER);
    await intoMatch(page);
    check((await marker(page)) === null, 'a match started from a direct link writes no marker');
    await page.goto(`${baseUrl}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 180000);
    await page.click('#btn-begin'); await page.waitForTimeout(1500);
    check((await marker(page)) === null, 'practice (also a direct link) writes none either');
    void l5;

    // 6. practice from the menu is not a match: no marker
    await ev(k => localStorage.removeItem(k), MARKER);
    await page.goto(`${baseUrl}?intro=off&botpace=0.1&timer=off`, { waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(600);
    await page.click('#btn-menu-practice');
    await waitFor(page, () => window.__game.phase() === 'game', null, 120000);
    await page.waitForTimeout(1500);
    check((await marker(page)) === null, 'practice started from the menu writes no marker (it is not a match)');
  } catch (err) { check(false, `reload: ${err.message}`); }
  check(!quiet(messages).length, `reload: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('focus')) {
  console.log('\nfocus. keyboard focus on the screens over the game');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  // --control: the page gets a focus.js that does nothing (the game as it was): the checks below must FAIL, so they can
  if (args.includes('--control')) await page.route('**/src/ui/focus.js', r => r.fulfill({ contentType: 'application/javascript', body: 'export const DIALOGS = []; export function watchDialogs() { return []; } export function watchDialog() { return { release() {} }; }' }));
  const ev = (fn, a) => page.evaluate(fn, a);
  const active = () => ev(() => { const a = document.activeElement; return a ? (a.id || `${a.tagName.toLowerCase()}.${a.className}`) : null; });
  const inside = sel => ev(s => { const a = document.activeElement; return !!a && !!document.querySelector(s)?.contains(a); }, sel);
  // Tab (or Shift+Tab) `n` times; every stop must be inside `sel`, and none may be one of `never`.
  async function tabs(sel, n, { shift = false, never = ['btn-leave', 'btn-chat', 'btn-end-turn', 'btn-map'] } = {}) {
    const stops = [];
    for (let i = 0; i < n; i++) { await page.keyboard.press(shift ? 'Shift+Tab' : 'Tab'); stops.push({ id: await active(), in: await inside(sel) }); }
    return { stops, ok: stops.every(s => s.in && !never.includes(s.id)), ids: stops.map(s => s.id).join(' > ') };
  }
  try {
    await intoMatch(page, { keepRole: true });
    // --- the secret role
    check(await ev(() => document.activeElement?.id === 'btn-handoff-next'), `the secret role: focus is on its button (${await active()})`);
    const card = await ev(() => { const c = document.getElementById('handoff-card'); const t = document.getElementById(c.getAttribute('aria-labelledby')); return { role: c.getAttribute('role'), modal: c.getAttribute('aria-modal'), name: t?.textContent.trim() }; });
    check(card.role === 'dialog' && card.modal === 'true' && /You are (clean|possessed)/.test(card.name), `it is a modal dialog named "${card.name}"`);
    let t = await tabs('#handoff-card', 6);
    check(t.ok, `Tab stays inside it and never reaches Main menu or the game (${t.ids})`);
    t = await tabs('#handoff-card', 4, { shift: true });
    check(t.ok, `and so does Shift+Tab (${t.ids})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(250);
    check(await ev(() => window.__game.handoffKind() === 'role'), 'Escape does not skip the secret role');
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 180000);
    check(await ev(() => !window.__game.handoffOpen()), 'Enter on its button goes on');

    // --- the private card pick, with the keyboard only
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()];
      p.hand = [{ id: 'k1', type: 'knife' }, { id: 'l1', type: 'lantern' }, { id: 'b1', type: 'bandage' }]; g.refresh();
      window.__picked = undefined; window.__cancelled = false;
      g.handoff.privatePick(p, { title: 'Give a card', cards: p.hand, onPick: id => { window.__picked = id; }, cancelLabel: 'Cancel', onCancel: () => { window.__cancelled = true; } });
    });
    await page.waitForTimeout(500);
    check(await ev(() => document.activeElement?.classList.contains('card-tile') && document.activeElement.closest('#offer-cards') != null), `the card pick: focus starts on the first card (Give waits for a choice): ${await active()}`);
    check(await ev(() => document.activeElement.getAttribute('role') === 'button' && document.activeElement.getAttribute('aria-pressed') === 'false' && /Knife|Lantern|Bandage/.test(document.activeElement.getAttribute('aria-label'))), 'a card is a labelled button for the keyboard and a screen reader');
    t = await tabs('#handoff-card', 8);
    check(t.ok, `Tab stays inside the pick (${t.ids})`);
    // back to the second card, choose it with Enter
    await ev(() => document.querySelector('#offer-cards .card-tile[data-card-id="l1"]').focus());
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter'); await page.waitForTimeout(250);
    check(await ev(() => document.querySelector('#offer-cards .card-tile[data-card-id="l1"]').getAttribute('aria-pressed') === 'true' && !document.getElementById('btn-offer-give').disabled), 'Enter lifts the card (pressed) and the Give button wakes');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(await ev(() => window.__game.handoffKind() === 'pick' && !window.__cancelled), 'Escape does not skip the pick, nor cancel it');
    await ev(() => document.getElementById('btn-offer-give').focus()); await page.waitForTimeout(GUARD_WAIT);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
    check(await ev(() => window.__picked === 'l1' && !window.__game.handoffOpen()), 'and Enter on Give gives that card: all with the keyboard');

    // --- the end-of-turn discard: focus stays on the card chosen, Done wakes
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()];
      p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((ty, i) => ({ id: `q${i}`, type: ty })); g.refresh();
      g.endTurn();
    });
    await page.waitForTimeout(600);
    check(await ev(() => !document.getElementById('discard-overlay').hidden && document.activeElement?.closest('#discard-cards') != null), `the discard screen takes the focus (first card: Done waits for a choice): ${await active()}`);
    t = await tabs('#discard-overlay .modal', 5);
    check(t.ok, `Tab stays inside it (${t.ids})`);
    await ev(() => document.querySelector('#discard-cards .card-tile[data-card-id="q2"]').focus()); await page.waitForTimeout(350);
    await page.keyboard.press('Enter'); await page.waitForTimeout(400);
    check(await ev(() => document.activeElement?.dataset?.cardId === 'q2' && document.activeElement.getAttribute('aria-pressed') === 'true'), 'Enter picks a card and the focus stays on it (the screen draws itself again)');
    check(await ev(() => !document.getElementById('btn-discard-done').disabled && /Discard the Bandage/.test(document.getElementById('btn-discard-done').textContent)), 'and the button names it');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(await ev(() => !document.getElementById('discard-overlay').hidden), 'Escape does not skip the discard');
    await ev(() => { document.getElementById('btn-discard-done').focus(); }); await page.waitForTimeout(GUARD_WAIT);
    await page.keyboard.press('Enter'); await page.waitForTimeout(500);
    check(await ev(() => !document.getElementById('discard-overlay').hidden && document.querySelectorAll('#discard-cards .card-tile').length === 7), 'Enter on Discard throws that card away (7 left, the screen stays)');
    await ev(() => { const p = window.__game.state.players[window.__game.humanSeat()]; p.hand = p.hand.slice(0, 6); window.__game.refresh(); });
    await ev(() => { window.__game.state.players[window.__game.humanSeat()].actionPoints = 4; });
    // close it the plain way (to carry on with the next checks)
    await ev(() => { document.querySelector('#btn-discard-done').disabled = false; });

    // --- every dialog's attributes (static: set when the page starts)
    const dialogs = await ev(() => [['handoff-overlay', '#handoff-card'], ['discard-overlay', '.modal'], ['encounter-overlay', '.modal'], ['ask-overlay', '.card'], ['notice-overlay', '.card'],
      ['end-overlay', '.card'], ['error-overlay', null], ['hand-overlay', '.cv-panel'], ['map-overlay', '.map-panel']].map(([id, sel]) => {
      const o = document.getElementById(id), d = sel ? o.querySelector(sel) : o;
      const nameId = d.getAttribute('aria-labelledby');
      const name = (nameId && document.getElementById(nameId)?.textContent.trim()) || d.getAttribute('aria-label') || '';
      return { id, role: d.getAttribute('role'), modal: d.getAttribute('aria-modal'), named: name.length > 0 || nameId != null };
    }));
    check(dialogs.every(d => /^(alert)?dialog$/.test(d.role) && d.modal === 'true' && d.named), `all nine screens are modal dialogs with a name (${dialogs.map(d => `${d.id.replace('-overlay', '')}:${d.role}`).join(' ')})`);

    // --- the map, opened with the keyboard: focus in, Tab inside, Escape closes, focus goes back
    // (the discard screen is still up: close it first)
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; p.hand = p.hand.slice(0, 6); });
    await ev(() => { document.getElementById('discard-overlay').hidden = true; });
    await page.waitForTimeout(300);
    await ev(() => document.getElementById('btn-map').focus());
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    check(await ev(() => window.__game.isMapOpen() && document.activeElement?.id === 'btn-map-close'), `the map: focus moves to its close button (${await active()})`);
    t = await tabs('#map-overlay', 4);
    check(t.ok, `and Tab stays inside it (${t.ids})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    check(await ev(() => !window.__game.isMapOpen() && document.activeElement?.id === 'btn-map'), `Escape closes the map and the focus goes back to the Map button (${await active()})`);

    // --- the card view
    await ev(() => document.getElementById('btn-map').focus());
    await ev(() => { const g = window.__game; g.openHand(g.state.players[g.humanSeat()].hand[0].id); });
    await page.waitForTimeout(700);
    check(await ev(() => window.__game.cardViewOpen() && document.getElementById('hand-overlay').contains(document.activeElement)), `the card view takes the focus (${await active()})`);
    t = await tabs('#hand-overlay', 4);
    check(t.ok, `and Tab stays inside it (${t.ids})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(400);
    check(await ev(() => !window.__game.cardViewOpen() && document.activeElement?.id === 'btn-map'), `Escape closes it and the focus goes back (${await active()})`);

    // --- the yes/no question: the safe answer has the focus, Escape takes it; the notice
    await ev(() => document.getElementById('btn-end-turn').focus());
    await page.click('#btn-leave'); await page.waitForTimeout(GUARD_WAIT + 150);
    if (await ev(() => !!document.getElementById('gamemenu-overlay') && !document.getElementById('gamemenu-overlay').hidden)) { await page.click('#btn-gm-leave'); await page.waitForTimeout(GUARD_WAIT + 150); }
    await waitFor(page, () => window.__game.askOpen(), null, 10000);
    await page.waitForTimeout(200);
    check(await ev(() => document.activeElement?.id === 'btn-ask-no'), `the question "Leave the match?": the safe answer, Keep playing, has the focus (${await active()})`);
    t = await tabs('#ask-overlay .card', 3);
    check(t.ok, `Tab stays on its two buttons (${t.ids})`);
    await page.waitForTimeout(GUARD_WAIT);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.askOpen() && window.__game.phase() === 'game'), 'Escape is Keep playing: the match goes on');

    // --- the end screen
    await ev(() => window.__game.skipToEnd());
    await waitFor(page, () => window.__game.endOpen(), null, 60000);
    await page.waitForTimeout(400);
    check(await ev(() => document.getElementById('end-overlay').contains(document.activeElement) && /^btn-/.test(document.activeElement.id)), `the end screen takes the focus (${await active()})`);
    t = await tabs('#end-overlay', 5);
    check(t.ok, `and Tab stays inside it (${t.ids})`);
  } catch (err) { check(false, `focus: ${err.message}`); }
  check(!quiet(messages).length, `focus: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('scroll')) {
  console.log('\nscroll. tall pop-ups, by touch');
  const { browser, page, messages } = await launch({ width: 1024, height: 694 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const cdp = await page.context().newCDPSession(page);
  // A real finger swipe up from (x, y): touchstart, twenty small touchmoves, touchend, through the browser's own touch
  // handling, as on an iPad (the wardrobe's list scrolls 185 px with this, the control that shows the method works).
  const swipe = async (x, y, dist = 200) => {
    const send = (type, yy) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: yy, id: 1 }] });
    await send('touchStart', y);
    for (let i = 1; i <= 20; i++) { await send('touchMove', y - (dist / 20) * i); await page.waitForTimeout(30); }
    await send('touchEnd', y - dist);
  };
  const centre = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 14, top: r.top }; }, sel);
  // Make `sel` taller than its box (a spacer), swipe from a spot that is not a button, and say how far it scrolled.
  async function scrolled(sel, label, withAttr = true) {
    await ev(([s, on]) => {
      const el = document.querySelector(s);
      if (!el.querySelector(':scope > .__spacer')) { const sp = document.createElement('div'); sp.className = '__spacer'; sp.style.cssText = 'height:900px;flex:none'; el.appendChild(sp); }
      if (on) el.setAttribute('data-scrolls', ''); else el.removeAttribute('data-scrolls');
      el.scrollTop = 0;
    }, [sel, withAttr]);
    const over = await ev(s => { const e = document.querySelector(s); return [e.scrollHeight, e.clientHeight, getComputedStyle(e).overflowY]; }, sel);
    const c = await centre(sel);
    await swipe(c.x, c.y);
    await page.waitForTimeout(400);
    const top = await ev(s => document.querySelector(s).scrollTop, sel);
    return { over, top, label };
  }
  try {
    // the control that the method works: the wardrobe's list, which has always had data-scrolls, scrolls under it
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await menuUp(page); await page.waitForTimeout(800);
    await page.click('#btn-profile'); await page.waitForTimeout(2500);
    const wr = await ev(() => { const b = document.getElementById('av-body'); b.scrollTop = 0; const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + 60, over: b.scrollHeight - b.clientHeight }; });
    await swipe(wr.x, wr.y); await page.waitForTimeout(500);
    const wtop = await ev(() => document.getElementById('av-body').scrollTop);
    check(wr.over > 100 && wtop > 100, `control: a finger swipe scrolls the wardrobe's list (${wtop} px of ${wr.over})`);
    await intoMatch(page);
    // the four containers carry the attribute in the page itself
    const attr = await ev(() => ['#discard-overlay .modal', '#encounter-overlay .modal', '#handoff-card', '#hand-detail'].map(s => [s, document.querySelector(s).hasAttribute('data-scrolls')]));
    check(attr.every(([, has]) => has), `the four tall pop-ups carry data-scrolls (${attr.map(([s, h]) => `${s} ${h}`).join(', ')})`);
    // the discard screen, with a hand of 22 (more than any real hand): it scrolls by touch; without the attribute it does not
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()], types = ['lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade', 'flashlight', 'lockPick', 'revolver', 'lantern'];
      p.hand = Array.from({ length: 22 }, (_, i) => ({ id: `z${i}`, type: types[i % types.length], ...(types[i % types.length] === 'revolver' ? { shots: 2 } : {}) })); g.refresh(); g.endTurn();
    });
    await page.waitForTimeout(900);
    const d22 = await ev(() => { const m = document.querySelector('#discard-overlay .modal'); return { scroll: m.scrollHeight, client: m.clientHeight, vh: innerHeight, dense: document.getElementById('discard-cards').classList.contains('dense') }; });
    check(d22.scroll > d22.client && d22.dense, `a hand of 22 is taller than its box at 1024x694 (${d22.scroll} > ${d22.client}) and uses the small cards`);
    await ev(() => { document.querySelector('#discard-overlay .modal').scrollTop = 0; });
    const noAttr = await scrolled('#discard-overlay .modal', 'discard without data-scrolls', false);
    check(noAttr.top === 0, `control: without data-scrolls a finger swipe from the title does not scroll it (scrollTop ${noAttr.top})`);
    const yes = await scrolled('#discard-overlay .modal', 'discard', true);
    check(yes.top > 40, `with data-scrolls the same swipe scrolls it (scrollTop ${yes.top})`);
    // a swipe that starts on a card scrolls it too
    await ev(() => { document.querySelector('#discard-overlay .modal').scrollTop = 0; });
    const onCard = await ev(() => { const r = document.querySelector('#discard-cards .card-tile').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await swipe(onCard.x, onCard.y); await page.waitForTimeout(400);
    check(await ev(() => document.querySelector('#discard-overlay .modal').scrollTop > 40), 'a swipe that starts on a card scrolls it too');
    await ev(() => document.querySelector('#discard-overlay .modal .__spacer')?.remove());

    // the other three (a spacer makes each taller than its box)
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()];
      document.getElementById('discard-overlay').hidden = true;
      g.handoff.privateHand(p, { title: 'A long screen', cards: p.hand.slice(0, 6), lines: ['one', 'two'] }, () => {});
    });
    await page.waitForTimeout(500);
    const h1 = await scrolled('#handoff-card', 'handoff', false);
    check(h1.top === 0, `control: the hand-over card does not scroll without the attribute (${h1.top})`);
    const h2 = await scrolled('#handoff-card', 'handoff', true);
    check(h2.over[2] === 'auto' && h2.top > 40, `the private screen (hand-over card) scrolls by touch (${h2.top})`);
    await ev(() => { window.__game.handoff.close(); document.querySelector('#handoff-card .__spacer')?.remove(); });
    await ev(() => { const g = window.__game; g.meeting.chooseAction(g.state.players[g.humanSeat()], g.state.players.find((q, i) => i !== g.humanSeat()), { canAttack: false, onTrade() {}, onAttack() {} }); });
    await page.waitForTimeout(500);
    const e1 = await scrolled('#encounter-overlay .modal', 'encounter', true);
    check(e1.over[2] === 'auto' && e1.top > 40, `the meeting pop-up scrolls by touch (${e1.top})`);
    await ev(() => { document.getElementById('encounter-overlay').hidden = true; });
    await ev(() => { const g = window.__game; g.openHand(g.state.players[g.humanSeat()].hand[0].id); });
    await page.waitForTimeout(700);
    const c1 = await scrolled('#hand-detail', 'hand detail', true);
    check(c1.over[2] === 'auto' && c1.top > 40, `the card view's text column scrolls by touch (${c1.top})`);
    await ev(() => { document.getElementById('btn-hand-close').click(); });

    // 11 cards in the discard screen fit at 1024x694 without scrolling, and so do 8 and 9
    for (const n of [8, 9, 11]) {
      await ev(k => {
        const g = window.__game, p = g.state.players[g.humanSeat()], types = ['lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade', 'flashlight', 'lockPick', 'revolver', 'lantern'];
        document.getElementById('discard-overlay').hidden = true;
        p.hand = Array.from({ length: k }, (_, i) => ({ id: `y${i}`, type: types[i % types.length], ...(types[i % types.length] === 'revolver' ? { shots: 2 } : {}) }));
        p.actionPoints = 3; g.refresh(); g.endTurn();
      }, n);
      await page.waitForTimeout(800);
      const m = await ev(() => { const o = document.querySelector('#discard-overlay .modal'), b = document.getElementById('btn-discard-done').getBoundingClientRect(); return { scroll: o.scrollHeight, client: o.clientHeight, doneBottom: Math.round(b.bottom), vh: innerHeight, dense: document.getElementById('discard-cards').classList.contains('dense'), w: Math.round(document.querySelector('#discard-cards .card-tile').getBoundingClientRect().width) }; });
      check(m.scroll <= m.client + 1 && m.doneBottom <= m.vh, `${n} cards at 1024x694: no scrolling, Done is fully on the screen (bottom ${m.doneBottom} of ${m.vh}; cards ${m.w}px wide${m.dense ? ', small' : ''})`);
      if (n === 11) await page.screenshot({ path: path.join(outDir, 'discard-11-1024x694.png') });
      if (n === 8) check(!m.dense && m.w === 112, 'up to 8 cards keep the usual size (112 px)');
      if (n === 11) check(m.dense && m.w < 112, 'and a bigger hand uses the small cards');
    }
  } catch (err) { check(false, `scroll: ${err.message}`); }
  check(!quiet(messages).length, `scroll: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('text')) {
  console.log('\ntext. small text and the tight HUD');
  // every visible element with its own words under 12 px, as { sel, fs, text }
  const smallText = page => page.evaluate(() => {
    const res = [];
    const sel = el => el.tagName.toLowerCase() + (el.id ? `#${el.id}` : '') + [...el.classList].slice(0, 3).map(c => `.${c}`).join('');
    for (const el of document.querySelectorAll('body *')) {
      const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).map(n => n.textContent.trim()).join(' ');
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      let hid = false;
      for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (e.hidden || cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) { hid = true; break; } }
      if (hid) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 12) res.push({ sel: sel(el), fs, text: own.slice(0, 30) });
    }
    return res;
  });
  const sizeOf = (page, selector) => page.evaluate(s => [...document.querySelectorAll(s)].filter(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden').map(e => parseFloat(getComputedStyle(e).fontSize)), selector);
  for (const [w, h] of [[1024, 768], [1024, 694]]) {
    const tag = `${w}x${h}`;
    const { browser, page, messages } = await launch({ width: w, height: h, tips: false });
    const ev = (fn, a) => page.evaluate(fn, a);
    const seenSmall = new Map();
    const note = (screen, list) => { for (const e of list) seenSmall.set(`${e.sel} ${e.fs}`, { ...e, screen }); };
    try {
      // the menu screens
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await menuUp(page); await page.waitForTimeout(1200);
      note('menu', await smallText(page));
      check((await sizeOf(page, '.pc-kicker')).every(s => s >= 12), `${tag} menu: "Playing as" is 12 px or more (${await sizeOf(page, '.pc-kicker')})`);
      for (const [btn, back, name] of [['#btn-menu-settings', '#btn-settings-done', 'settings'], ['#btn-menu-record', '#btn-record-back', 'record']]) {
        await page.click(btn); await page.waitForTimeout(700);
        note(name, await smallText(page));
        const fit = await ev(() => { const p = document.querySelector('#menu .menu-screen:not([hidden])').getBoundingClientRect(); return [Math.round(p.top), Math.round(p.bottom), innerHeight]; });
        check(fit[0] >= 0 && fit[1] <= fit[2], `${tag} ${name}: the panel fits the screen (${fit[0]}..${fit[1]} of ${fit[2]})`);
        await page.click(back); await page.waitForTimeout(500);
      }
      await page.click('#btn-profile'); await page.waitForTimeout(2200);
      const soon = await ev(() => [...document.querySelectorAll('.av-chip-soon')].map(e => { const cs = getComputedStyle(e); return { fs: parseFloat(cs.fontSize), color: cs.color }; }));
      await ev(() => { const b = document.getElementById('av-body'); b.scrollTop = b.scrollHeight; });
      await page.waitForTimeout(400);
      const soon2 = await ev(() => [...document.querySelectorAll('.av-chip-soon')].map(e => { const cs = getComputedStyle(e); return { fs: parseFloat(cs.fontSize), color: cs.color }; }));
      const chips = [...soon, ...soon2];
      check(chips.length > 0 && chips.every(c => c.fs >= 11), `${tag} wardrobe: "Coming soon" is 11 px or more (${chips[0]?.fs}), was 9.5`);
      // contrast of "Coming soon" against the wardrobe's panel (the lock chip's plate): 4.5:1 or more
      const rgbOf = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bg = await ev(() => { const e = document.querySelector('.av-chip-soon'); let n = e; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba?\(0, 0, 0, 0\)/.test(c) && !/, 0\)$/.test(c)) return c; n = n.parentElement; } return 'rgb(20, 24, 36)'; });
      const L1 = lum(rgbOf(chips[0].color)), L2 = lum(rgbOf(bg));
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      check(ratio >= 4.5, `${tag} wardrobe: "Coming soon" reads at ${ratio.toFixed(1)}:1 against its plate (was 3.85:1)`);
      note('wardrobe', await smallText(page));
      await page.screenshot({ path: path.join(outDir, `${tag}-wardrobe-bottom.png`) });
      await page.click('#btn-av-done').catch(() => {});
      await page.waitForTimeout(500);

      // the match HUD, a possessed guest (the widest panel), the chat, the map, tips off
      await intoMatch(page, { role: 'possessed', bots: 5 });
      await page.waitForTimeout(1500);
      const hud = await smallText(page); note('hud', hud);
      const want = [['.mini-flag', 11], ['.mini-room', 12], ['.mini-stats', 12], ['.safe-badge', 12], ['.stat-label', 12], ['.tell-pill', 12], ['.tell-note', 12], ['.private-link', 13], ['.fan-badge', 12], ['.ss-caption', 12]];
      const got = [];
      for (const [s, min] of want) {
        const sizes = await sizeOf(page, s);
        if (sizes.length) got.push(`${s} ${sizes[0]}`);
        check(sizes.every(z => z >= min), `${tag} HUD: ${s} is ${min} px or more (${sizes.slice(0, 2).join(', ') || 'not showing'})`);
      }
      // no HUD block overlaps another, and no key label is cut off
      const geo = await ev(() => {
        const R = s => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const blocks = { 'top-left': R('.hud-top-left'), strip: R('.players-strip'), 'top-right': R('.hud-top-right'), panel: R('#player-panel'), fan: R('#hand-fan'), 'bottom-right': R('.hud-bottom-right') };
        const clip = [...document.querySelectorAll('.mini-flag, .stat-label, .tell-pill, .tell-note, .safe-badge, .private-link, .ap-count, .souls-chip')]
          .filter(e => e.getClientRects().length).filter(e => e.scrollWidth > e.clientWidth + 1).map(e => `${e.className} ${e.scrollWidth}>${e.clientWidth}`);
        const inView = Object.entries(blocks).filter(([, r]) => r && (r.l < -1 || r.t < -1 || r.r > innerWidth + 1 || r.b > innerHeight + 1)).map(([k]) => k);
        return { blocks, clip, inView };
      });
      const names = Object.keys(geo.blocks).filter(k => geo.blocks[k]);
      const overlaps = [];
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
        const a = geo.blocks[names[i]], b = geo.blocks[names[j]];
        const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t);
        if (ox > 2 && oy > 2) overlaps.push(`${names[i]} x ${names[j]} (${Math.round(ox)}x${Math.round(oy)})`);
      }
      check(!overlaps.length, `${tag} HUD: no block overlaps another${overlaps.length ? ` (${overlaps.join('; ')})` : ` (${names.join(', ')})`}`);
      check(!geo.clip.length, `${tag} HUD: no key label is cut off${geo.clip.length ? ` (${geo.clip.join('; ')})` : ''}`);
      check(!geo.inView.length, `${tag} HUD: every block is on the screen${geo.inView.length ? ` (${geo.inView.join(', ')})` : ''}`);
      await page.screenshot({ path: path.join(outDir, `${tag}-hud.png`) });
      // the chat panel, the map
      await page.click('#btn-chat'); await page.waitForTimeout(900);
      note('chat', await smallText(page));
      const chatFit = await ev(() => { const p = document.getElementById('chat-panel').getBoundingClientRect(); return [Math.round(p.top), Math.round(p.bottom), innerHeight, Math.round(p.right), innerWidth]; });
      check(chatFit[0] >= 0 && chatFit[1] <= chatFit[2] && chatFit[3] <= chatFit[4], `${tag} chat panel: inside the screen (${chatFit.join(' ')})`);
      check((await sizeOf(page, '.cp-tab')).every(z => z >= 12) && (await sizeOf(page, '.chat-kicker')).every(z => z >= 11), `${tag} chat panel: the tabs are 12 px or more, the heading 11`);
      await page.screenshot({ path: path.join(outDir, `${tag}-chat.png`) });
      await page.click('#btn-chat'); await page.waitForTimeout(500);
      await page.click('#btn-map'); await page.waitForTimeout(1100);
      note('map', await smallText(page));
      const mapFit = await ev(() => { const p = document.querySelector('.map-panel').getBoundingClientRect(), l = document.querySelector('.map-legend'); return { legendBottom: Math.round(l.getBoundingClientRect().bottom), panelBottom: Math.round(p.bottom), over: l.scrollHeight > l.clientHeight + 1 }; });
      check(mapFit.legendBottom <= mapFit.panelBottom + 1 && !mapFit.over, `${tag} map: the whole legend shows (${mapFit.legendBottom} of ${mapFit.panelBottom})`);
      await page.screenshot({ path: path.join(outDir, `${tag}-map.png`) });
      await page.click('#btn-map-close'); await page.waitForTimeout(400);
    } catch (err) { check(false, `${tag}: ${err.message}`); }
    // what is still under 12 px anywhere, by screen: nothing under 11
    const rows = [...seenSmall.values()].sort((a, b) => a.fs - b.fs);
    console.log(`  (${tag}: text still under 12 px: ${rows.length ? rows.map(r => `${r.sel} ${r.fs}px "${r.text}" [${r.screen}]`).join('; ') : 'none'})`);
    check(rows.every(r => r.fs >= 11), `${tag}: nothing visible is under 11 px on the screens checked${rows.some(r => r.fs < 11) ? ` (${rows.filter(r => r.fs < 11).map(r => `${r.sel} ${r.fs}`).join(', ')})` : ''}`);
    check(!quiet(messages).length, `${tag}: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('seats')) {
  console.log('\nseats. guests easier to tell apart');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  const ev = (fn, a) => page.evaluate(fn, a);
  try {
    await intoMatch(page, { role: 'clean', bots: 5 });
    await page.waitForTimeout(1500);
    const seats = await ev(() => window.__game.seats());
    const cols = ['#e6bc5c', '#73d4e6', '#2f8cff', '#e673ac', '#e6652e', '#b6b2ff'];
    check(seats.length === 6 && seats.every((s, i) => s.color === cols[i]), `six seats in the six seat colours (${seats.map(s => s.color).join(' ')})`);
    // the strip: each portrait carries its guest's initial, drawn in the seat colour
    const strip = await ev(() => [...document.querySelectorAll('#players-strip .mini-player')].map(c => {
      const p = c.querySelector('.mini-portrait'), cs = getComputedStyle(p, '::before');
      return { mark: p.dataset.mark, content: cs.content, bg: cs.backgroundColor, name: c.querySelector('.mini-name').textContent, color: c.style.getPropertyValue('--player-color') };
    }));
    const hex = c => '#' + c.match(/\d+/g).slice(0, 3).map(n => (+n).toString(16).padStart(2, '0')).join('');
    const want = guestMarks(strip.map(s => s.name));     // (the rule: the initial, two letters where two names start alike; the rule itself is checked in tests/polish-check.mjs)
    check(strip.length === 6 && strip.every((s, i) => s.mark === want[i] && s.mark[0] === s.name[0].toUpperCase() && s.content === `"${s.mark}"`)
      && new Set(strip.map(s => s.mark)).size === 6, `the strip's portraits carry each guest's own mark, all different (${strip.map(s => `${s.name} ${s.mark}`).join(', ')})`);
    check(strip.every((s, i) => hex(s.bg) === cols[i]), 'each initial sits on its seat colour');
    // two names that start alike get two letters (the strip is built again after renaming)
    await ev(() => { const ps = window.__game.state.players; ps[1].name = 'Hank'; ps[2].name = 'Henry'; window.__game.rebuildHud(); });
    await page.waitForTimeout(500);
    check((await ev(() => [...document.querySelectorAll('#players-strip .mini-portrait')].map(p => p.dataset.mark))).slice(1, 3).join() === 'Ha,He', 'two guests whose names start alike show two letters (Ha, He)');
    await ev(() => { const ps = window.__game.state.players; ps[1].name = 'falcon_eye'; ps[2].name = 'orbit'; window.__game.rebuildHud(); });
    await page.screenshot({ path: path.join(outDir, 'seats-strip.png'), clip: { x: 260, y: 0, width: 660, height: 160 } });
    // the plan: the initials are drawn in the dots (what the canvas is told to write), the dots are in the seat colours
    await ev(() => {
      window.__texts = [];
      const proto = CanvasRenderingContext2D.prototype, orig = proto.fillText;
      proto.fillText = function (t, ...a) { window.__texts.push(String(t)); return orig.call(this, t, ...a); };
    });
    await page.click('#btn-map'); await page.waitForTimeout(1200);
    const texts = await ev(() => window.__texts);
    const marks = guestMarks(await ev(() => window.__game.state.players.map(p => p.name)));
    check(marks.every(m => texts.includes(m)), `the plan writes every guest's mark in their dot (${marks.join(' ')})`);
    const dots = await ev(cs => {
      const c = document.getElementById('map-canvas'), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, c.height).data;
      const out = cs.map(h => { const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - r) < 8 && Math.abs(d[i + 1] - g) < 8 && Math.abs(d[i + 2] - b) < 8) n++; return n; });
      return out;
    }, cols);
    check(dots.every(n => n > 60), `every seat colour is on the plan as a dot of some size (pixels: ${dots.join(', ')})`);
    await page.screenshot({ path: path.join(outDir, 'seats-map.png') });
    await page.click('#btn-map-close'); await page.waitForTimeout(400);
    // the floor rings
    const rings = await ev(() => window.__game.characters.map(cv => cv.debug().ring));
    const me = await ev(() => window.__game.state.activeIndex);
    check(rings.every((r, i) => r.color === cols[i]), 'each ring is its seat\'s colour');
    check(rings.every((r, i) => i === me ? r.opacity >= 0.9 : Math.abs(r.opacity - 0.6) < 0.01), `the other guests' rings are at 0.6 (was 0.35), the active guest's at 0.95 (${rings.map(r => r.opacity.toFixed(2)).join(' ')})`);
    check(rings.every(r => r.edgeOpacity >= 0.45 && r.visible), 'every ring has a dark edge under it');
    await page.screenshot({ path: path.join(outDir, 'seats-crowd.png'), clip: { x: 300, y: 150, width: 560, height: 420 } });
  } catch (err) { check(false, `seats: ${err.message}`); }
  check(!quiet(messages).length, `seats: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED:\n - ${failures.join('\n - ')}` : '\nAll checks passed.');
process.exit(failures.length ? 1 : 0);
