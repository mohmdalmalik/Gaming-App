import { launch, GUARD_WAIT, openSinglePlayer } from './smoke-lib.mjs';
// Browser checks of the menu split and every Co-op screen (DESIGN §14; src/ui/menu.js, src/ui/coopMenu.js,
// src/ui/seatSwitch.js, coop.css), in headless Chromium (software WebGL: a few frames a second), against the pretend
// server of development (src/net/fakeLobby.js, ?coop=fake, localhost only). One browser at a time (the build's lock):
//   node tests/coop-menu-check.mjs [--url http://127.0.0.1:PORT/] [--only menu,fit,keyboard,link,soon,live,demo,flows]
//                                  [--sizes 1024x694,1024x768,1180x820,1366x1024] [--shots DIR] [--no-shots]
// Without --url it serves the repo itself on 127.0.0.1 (a free port). Screenshots: tests/shots/coop-menu/ (git-ignored).
//
//   menu      the main menu: Single player (gold) and Co-op; Single player holds Play with bots, Practice alone and the
//             hint, with Back; Play with bots' Back comes back to Single player
//   fit       at the four iPad sizes, every Co-op screen fits: Co-op, a field error, the slow "switchboard" line, the
//             waiting room as host with 1 to 6 people and as a guest with 2 to 6, Away, Locked (both views), the
//             countdown (both views), the three questions and every card (Coming soon, every can't-join case). Fits:
//             nothing outside the screen, no sideways scroll, the panel never scrolls, every button 44 px or more
//   keyboard  at the four sizes, the code field and Join stay above the on-screen keyboard (an emulated
//             visualViewport); a pasted invite link (53 characters) is taken whole and joins that table
//   link      a join link on a device with no profile: the register first, with "You're invited to nora's table." (or
//             "…a table." when the table can't be asked), then straight into the waiting room under the new name, never
//             as "Guest"; with a profile, straight in
//   soon      ?coop=soon on localhost: Coming soon, its buttons; a join link while Co-op isn't open
//   live      the page as on the live site (a host that is not localhost, through Chromium's host-resolver rules): it
//             loads without a console error, Co-op says Coming soon, the test links (?coop=fake, ?server=,
//             ?friends=demo) do nothing there and the pretend server is never even fetched
//   demo      the review link's two seats on one device (?friends=demo, here with the pretend server): start a table,
//             "Show sam's screen", type the code as sam, join, switch back, Start, the match dealt
//   flows     the waiting room's working parts: Invite friends (the share sheet asked inside the tap) and Copy link (and
//             the link to copy by hand when copying fails), size and lock, the joined / left / new host toasts, Remove,
//             Start alone (Play with bots), the Wardrobe and back, a guest's countdown, being removed, every error
//             while opening (with Try again keeping the code), the switchboard waking up, Back while opening, offline
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ONLINE_TEXT, fill } from '../src/data/onlineText.js';
import { ONLINE } from '../src/data/online.js';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const only = opt('--only', 'menu,fit,keyboard,link,soon,live,demo,flows').split(',');
const SIZES = opt('--sizes', '1024x694,1024x768,1180x820,1366x1024').split(',').map(s => s.split('x').map(Number));
const shots = args.includes('--no-shots') ? null : opt('--shots', path.join(here, 'shots', 'coop-menu'));
if (shots) fs.mkdirSync(shots, { recursive: true });
const T = ONLINE_TEXT;
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const quiet = messages => messages.filter(m => !/Failed to load resource|favicon/.test(m));

// --- the page's server: ours (a free port on 127.0.0.1) unless --url names one ----------------------------------------
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
let server = null;
let baseUrl = opt('--url', null);
if (!baseUrl) {
  server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${server.address().port}/`;
}
const port = new URL(baseUrl).port;
console.log(`the page: ${baseUrl}`);

// --- helpers ------------------------------------------------------------------------------------------------------------
async function openPage(page, query, { fake = query.includes('coop=fake'), screen = null, timeout = 180000 } = {}) {
  await page.goto(`${baseUrl}?intro=off${query ? `&${query}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(f => window.__game && !document.getElementById('menu').hidden && (!f || window.__fakeLobby), fake, { timeout, polling: 100 });
  if (screen) await page.waitForFunction(s => !document.getElementById(s).hidden, screen, { timeout: 30000, polling: 100 });
  await page.waitForTimeout(700);
}
const screenNow = page => page.evaluate(() => [...document.querySelectorAll('#menu .menu-screen')].find(s => !s.hidden)?.id || null);
const waitScreen = (page, id, timeout = 15000) => page.waitForFunction(s => !document.getElementById(s).hidden, id, { timeout, polling: 50 }).then(() => true, () => false);
const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
// a tap the way a finger makes it, after the moment a new screen ignores taps (src/ui/tapGuard.js)
const tap = async (page, sel) => { await page.waitForTimeout(GUARD_WAIT); await page.click(sel, { timeout: 30000 }); await page.waitForTimeout(150); };
const hooks = (page, fn, arg) => page.evaluate(([f, a]) => new Function('h', 'a', `return (${f})(h, a);`)(window.__fakeLobby, a), [fn.toString(), arg]);
// the screen's own animations (it slides in) finished, never the ones that loop
// (a busy machine draws a frame every second or so: up to 20 s, then the check reports what it sees)
const still = page => page.waitForFunction(() => !document.getAnimations().some(a => ['running', 'pending'].includes(a.playState) && a.effect?.getTiming?.().iterations !== Infinity && a.effect?.target?.closest?.('#menu')), null, { timeout: 20000, polling: 100 }).catch(() => {});

// Does the screen shown fit? Nothing outside the window, no sideways scroll, the panel never scrolls, every button
// 44 px or more (the toast and the seat switch count too).
async function fit(page, label, tag) {
  await still(page);
  const r = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const screen = [...document.querySelectorAll('#menu .menu-screen')].find(s => !s.hidden);
    const panel = document.querySelector('#menu .menu-panel');
    const on = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const extra = ['coop-toast', 'btn-seat-switch'].map(id => document.getElementById(id)).filter(e => e && !e.hidden);
    const els = [...(screen ? screen.querySelectorAll('*') : []), ...extra].filter(on);
    const name = e => e.id || (typeof e.className === 'string' && e.className.split(' ')[0]) || e.tagName.toLowerCase();
    const out = [];
    for (const e of els) {
      const b = e.getBoundingClientRect();
      if (b.width < 1 && b.height < 1) continue;
      if (b.left < -1 || b.top < -1 || b.right > vw + 1 || b.bottom > vh + 1) out.push(`${name(e)} ${Math.round(b.left)},${Math.round(b.top)}..${Math.round(b.right)},${Math.round(b.bottom)}`);
    }
    const small = els.filter(e => e.tagName === 'BUTTON').map(e => [name(e), e.getBoundingClientRect()]).filter(([, b]) => b.width < 44 || b.height < 44).map(([n, b]) => `${n} ${Math.round(b.width)}x${Math.round(b.height)}`);
    const pb = panel.getBoundingClientRect();
    return { screen: screen?.id, out, small, sideways: document.documentElement.scrollWidth > vw + 1 || scrollX !== 0,
      scrolls: panel.scrollHeight > panel.clientHeight + 1 || (screen && screen.scrollHeight > screen.clientHeight + 1) ? `${panel.scrollHeight}/${panel.clientHeight}, ${screen?.scrollHeight}/${screen?.clientHeight}` : null,
      panel: [Math.round(pb.top), Math.round(pb.bottom), Math.round(pb.right)], vh };
  });
  const ok = !r.out.length && !r.small.length && !r.sideways && !r.scrolls;
  check(ok, `${tag} ${label}: fits (${r.screen}, panel ${r.panel[0]}..${r.panel[1]} of ${r.vh}${r.out.length ? `; outside: ${r.out.slice(0, 3).join(' | ')}` : ''}${r.small.length ? `; under 44 px: ${r.small.slice(0, 3).join(' | ')}` : ''}${r.sideways ? '; scrolls sideways' : ''}${r.scrolls ? `; the panel scrolls (${r.scrolls})` : ''})`);
  if (shots) await page.screenshot({ path: path.join(shots, `${tag}-${label}.png`) });
  return r;
}

const NAMES = ['sam', 'ivy', 'pebble', 'jules', 'ruth'];
const CARD_KINDS = ['notFound', 'full', 'midMatch', 'locked', 'removed', 'closed', 'tooMany', 'busy', 'offline', 'unreachable', 'update', 'serverOld', 'elsewhere', 'soon', 'soonJoin'];
const cardTitle = kind => (kind === 'soon' ? T.soon.heading : kind === 'soonJoin' ? fill(T.soon.joinHeading) : kind === 'elsewhere' ? T.recovery.elsewhere.title : fill(T.errors[kind].title));

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('menu')) {
  console.log('\nmenu. the main menu split: Single player and Co-op');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  try {
    await openPage(page, '');
    await page.waitForFunction(() => !document.getElementById('btn-menu-single').disabled, null, { timeout: 180000 });
    const main = await page.evaluate(() => [...document.querySelectorAll('#menu-main .menu-buttons > .menu-btn')].map(b => ({ id: b.id, main: b.querySelector('.mb-main')?.textContent, sub: b.querySelector('.mb-sub')?.textContent, gold: b.classList.contains('primary') })));
    check(main.length === 2 && main[0].id === 'btn-menu-single' && main[0].gold && main[1].id === 'btn-menu-coop' && !main[1].gold,
      `the main menu's two ways to play: ${main.map(b => `${b.main}${b.gold ? ' (gold)' : ''}`).join(' · ')}`);
    check(main[0]?.main === T.menu.single && main[0]?.sub === T.menu.singleLine && main[1]?.main === fill(T.menu.coop) && main[1]?.sub === T.menu.coopLine, `...their words: "${main[0]?.sub}" / "${main[1]?.sub}"`);
    check(!(await shown(page, '#btn-menu-bots')) && !(await shown(page, '#btn-menu-practice')) && await shown(page, '#btn-menu-settings') && await shown(page, '#btn-menu-howto'), 'Play with bots and Practice alone are no longer on the main menu; How to play and Settings still are');
    await fit(page, 'main', '1180x820');
    check(await openSinglePlayer(page), 'Single player opens');
    const single = await page.evaluate(() => ({ kicker: document.querySelector('#menu-single .menu-kicker').textContent, h2: document.querySelector('#menu-single .menu-h2').textContent,
      ids: [...document.querySelectorAll('#menu-single .menu-btn')].map(b => b.id), bots: document.querySelector('#btn-menu-bots .mb-main').textContent, practice: document.querySelector('#btn-menu-practice .mb-main').textContent,
      hint: !document.getElementById('menu-hint').hidden && document.getElementById('menu-hint').closest('#menu-single') != null }));
    check(single.kicker === T.single.kicker && single.h2 === T.single.heading, `...kicker "${single.kicker}", heading "${single.h2}"`);
    check(single.ids.join() === 'btn-menu-bots,btn-menu-practice,btn-single-back' && single.bots === 'Play with bots' && single.practice === 'Practice alone', `...it holds today's two buttons with today's words, and Back (${single.ids.join(', ')})`);
    check(single.hint, '...and the new-player hint under Practice alone');
    await fit(page, 'single', '1180x820');
    await tap(page, '#btn-menu-bots');
    check(await waitScreen(page, 'menu-bots'), 'Play with bots opens today\'s table screen');
    await tap(page, '#btn-bots-back');
    check(await waitScreen(page, 'menu-single'), "...whose Back comes back to Single player");
    await tap(page, '#btn-single-back');
    check(await waitScreen(page, 'menu-main'), "Single player's Back: the main menu");
    await tap(page, '#btn-menu-coop');
    check(await waitScreen(page, 'menu-coop') && await shown(page, '#btn-coop-start') && await shown(page, '#coop-code'), 'Co-op opens its screen (here, on 127.0.0.1, with a server address: Start a table and the code field)');
    const coopWords = await page.evaluate(() => ({ kicker: document.querySelector('#menu-coop .menu-kicker').textContent, h2: document.querySelector('#coop-form .menu-h2').textContent, ph: document.getElementById('coop-code').placeholder, max: document.getElementById('coop-code').maxLength,
      attrs: ['autocapitalize', 'autocomplete', 'autocorrect', 'spellcheck', 'enterkeyhint'].map(a => document.getElementById('coop-code').getAttribute(a)).join(' ') }));
    check(coopWords.kicker === fill(T.coop.kicker) && coopWords.h2 === T.coop.heading && coopWords.ph === fill(T.coop.codePlaceholder, { length: ONLINE.code.length }), `...its words: "${coopWords.kicker}", "${coopWords.h2}", placeholder "${coopWords.ph}"`);
    check(coopWords.max === ONLINE.code.inputMax && coopWords.attrs === 'characters off off false go', `...the code field: maxlength ${coopWords.max}, ${coopWords.attrs}`);
  } catch (err) { check(false, `menu: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-menu.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('fit')) {
  console.log('\nfit. every Co-op screen at the four iPad sizes');
  const { browser, page, messages } = await launch({ width: SIZES[0][0], height: SIZES[0][1] });
  try {
    await openPage(page, 'coop=fake&fake=quiet');
    await page.waitForFunction(() => !document.getElementById('btn-menu-single').disabled, null, { timeout: 180000 });
    for (const [W, H] of SIZES) {
      const tag = `${W}x${H}`;
      console.log(`\n  ${tag}`);
      await page.setViewportSize({ width: W, height: H });
      await hooks(page, h => { h.reset(); h.delay(250); });
      await page.evaluate(() => window.__game.menuShow('main'));
      await page.waitForTimeout(400);
      await fit(page, 'main', tag);
      await openSinglePlayer(page);
      await fit(page, 'single', tag);
      await page.evaluate(() => window.__game.menuShow('main'));
      await tap(page, '#btn-menu-coop');
      await waitScreen(page, 'menu-coop');
      await fit(page, 'coop', tag);
      await page.fill('#coop-code', 'aeiou');
      await tap(page, '#btn-coop-join');
      check(await text(page, '#coop-status') === T.coop.codeLetters, `${tag} a code with vowels: "${await text(page, '#coop-status')}", the typed code kept (${await page.inputValue('#coop-code')})`);
      await fit(page, 'coop-letters', tag);
      await page.fill('#coop-code', '');
      // the switchboard waking up (Render's free plan sleeps): the button after 1 s, the line after 4 s
      await hooks(page, h => h.delay(5200));
      await tap(page, '#btn-coop-start');
      await page.waitForTimeout(ONLINE.timing.wakeSlowMs + 300);
      check(await text(page, '#btn-coop-start .mb-main') === T.coop.opening && await text(page, '#coop-status') === T.coop.waking, `${tag} a slow server: "${T.coop.opening}" on the button, then "${T.coop.waking.slice(0, 40)}…"`);
      await fit(page, 'coop-waking', tag);
      check(await waitScreen(page, 'menu-table', 10000), `${tag} then the waiting room`);
      await hooks(page, h => h.delay(150));
      // the host, alone: Start asks first
      await fit(page, 'table-host-1', tag);
      await tap(page, '#btn-table-start');
      check(await text(page, '#table-dlg-title') === T.dialogs.alone.title, `${tag} Start alone: "${await text(page, '#table-dlg-title')}"`);
      await fit(page, 'dialog-alone', tag);
      await tap(page, '#btn-table-dlg-no');
      for (let n = 2; n <= 6; n++) {
        await hooks(page, (h, a) => h.addPerson(a), NAMES[n - 2]);
        await page.waitForTimeout(150);
        await fit(page, `table-host-${n}`, tag);
      }
      await hooks(page, h => h.setAway('ivy', true));
      check(/Away/i.test(await text(page, '#table-seats .cs-seat.away .cs-tags') || ''), `${tag} ivy Away (reconnecting…): "${await text(page, '#table-seats .cs-seat.away .cs-tags')}"`);
      await fit(page, 'table-host-away', tag);
      await tap(page, '#table-seats button.cs-box');
      check(/^Remove .+ from the table\?$/.test(await text(page, '#table-dlg-title') || ''), `${tag} tapping a friend's seat: "${await text(page, '#table-dlg-title')}"`);
      await fit(page, 'dialog-remove', tag);
      await tap(page, '#btn-table-dlg-no');
      await tap(page, '#btn-table-start');
      check(await text(page, '#table-dlg-title') === fill(T.dialogs.away.title, { name: 'ivy' }), `${tag} Start with ivy away: "${await text(page, '#table-dlg-title')}"`);
      await fit(page, 'dialog-away', tag);
      await hooks(page, h => h.timeScale(0.05));        // (the countdown waits for the checks: 100 s instead of 5)
      await tap(page, '#btn-table-dlg-yes');
      await page.waitForFunction(() => !document.getElementById('table-countdown').hidden, null, { timeout: 5000 }).catch(() => {});
      await fit(page, 'table-host-countdown', tag);
      await tap(page, '#btn-table-wait');
      await page.waitForFunction(() => document.getElementById('table-countdown').hidden, null, { timeout: 5000 }).catch(() => {});
      check(await shown(page, '#btn-table-start'), `${tag} Wait stops the countdown`);
      await hooks(page, h => h.timeScale(1));
      await tap(page, '#table-lock .seg-btn[data-value="true"]');
      await page.waitForTimeout(400);
      check(await text(page, '#table-note') === T.table.lockedNote, `${tag} Locked: "${await text(page, '#table-note')}"`);
      await fit(page, 'table-host-locked', tag);
      await tap(page, '#btn-table-leave');
      await waitScreen(page, 'menu-coop');
      // a guest at nora's table (nora and ivy are there): 3 people, then 4-6, then down to 2
      await page.fill('#coop-code', 'BKTWM');
      await tap(page, '#btn-coop-join');
      check(await waitScreen(page, 'menu-table', 8000) && await text(page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'nora' }), `${tag} joined nora's table as a guest: "${await text(page, '#table-kicker')}"`);
      await fit(page, 'table-guest-3', tag);
      for (let n = 4; n <= 6; n++) { await hooks(page, (h, a) => h.addPerson(a, 'BKTWM'), NAMES[n - 2]); await page.waitForTimeout(150); await fit(page, `table-guest-${n}`, tag); }
      for (const nm of ['ruth', 'jules', 'pebble', 'ivy']) await hooks(page, (h, a) => h.removePerson(a, 'BKTWM'), nm);
      await page.waitForTimeout(200);
      await fit(page, 'table-guest-2', tag);
      await hooks(page, h => h.lock(true, 'BKTWM'));
      await page.waitForTimeout(150);
      check(await text(page, '#table-locked-line') === fill(T.table.lockedGuest, { host: 'nora' }) && !(await shown(page, '#btn-table-invite')), `${tag} locked, a guest's view: "${await text(page, '#table-locked-line')}" (no Invite)`);
      await fit(page, 'table-guest-locked', tag);
      await hooks(page, h => h.lock(false, 'BKTWM'));
      await hooks(page, h => { h.timeScale(0.05); h.start('BKTWM'); });
      await page.waitForTimeout(300);
      check(await shown(page, '#table-countdown') && !(await shown(page, '#btn-table-wait')) && await text(page, '#table-count-guests') === fill(T.table.countdownGuests, { host: 'nora' }), `${tag} the countdown, a guest's view: "${await text(page, '#table-countdown')}" (no Wait)`);
      await fit(page, 'table-guest-countdown', tag);
      await hooks(page, h => { h.wait('BKTWM'); h.timeScale(1); });
      await tap(page, '#btn-table-leave');
      await waitScreen(page, 'menu-coop');
      // every card
      for (const kind of CARD_KINDS) {
        await page.evaluate(([k, v]) => window.__coop.card(k, v), [kind, { code: 'BKTWM' }]);
        await page.waitForTimeout(120);
        const title = await text(page, '#coop-card-title');
        check(title === cardTitle(kind), `${tag} card ${kind}: "${title}"`);
        await fit(page, `card-${kind}`, tag);
      }
    }
  } catch (err) { check(false, `fit: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-fit.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('keyboard')) {
  console.log('\nkeyboard. the code field above the on-screen keyboard; a pasted invite link');
  const { browser, page, messages } = await launch({ width: SIZES[0][0], height: SIZES[0][1] });
  // An emulated keyboard: visualViewport's height is the window's less the keyboard's (window.__keyboard(px)).
  await page.context().addInitScript(() => {
    const vv = new EventTarget();
    let kb = 0;
    for (const [k, get] of Object.entries({ height: () => innerHeight - kb, width: () => innerWidth, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => 0, pageLeft: () => 0, scale: () => 1 })) Object.defineProperty(vv, k, { get });
    Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
    window.__keyboard = px => { kb = px; vv.dispatchEvent(new Event('resize')); };
  });
  try {
    await openPage(page, 'coop=fake&fake=quiet');
    for (const [W, H] of SIZES) {
      const tag = `${W}x${H}`;
      await page.setViewportSize({ width: W, height: H });
      await page.evaluate(() => window.__game.menuShow('main'));
      await tap(page, '#btn-menu-coop');
      await waitScreen(page, 'menu-coop');
      const kb = H >= 1000 ? 424 : 398;               // (the iPad's keyboard in landscape, about)
      await page.focus('#coop-code');
      await page.evaluate(px => window.__keyboard(px), kb);
      await page.waitForTimeout(300);
      await still(page);
      const r = await page.evaluate(() => { const b = id => document.getElementById(id).getBoundingClientRect(); return { kbd: document.querySelector('#menu .menu-panel').classList.contains('kbd'), field: b('coop-code'), join: b('btn-coop-join'), vv: window.visualViewport.height, focus: document.activeElement?.id }; });
      check(r.kbd && r.focus === 'coop-code' && r.field.top >= 0 && r.field.bottom <= r.vv && r.join.bottom <= r.vv && r.join.height >= 44,
        `${tag} keyboard up (${kb} px): the code field (${Math.round(r.field.top)}..${Math.round(r.field.bottom)}) and Join (to ${Math.round(r.join.bottom)}) above it (from ${Math.round(r.vv)})`);
      if (shots) await page.screenshot({ path: path.join(shots, `${tag}-keyboard.png`) });
      await page.evaluate(() => { document.getElementById('coop-code').blur(); window.__keyboard(0); });
      await page.waitForTimeout(300);
      check(!(await page.evaluate(() => document.querySelector('#menu .menu-panel').classList.contains('kbd'))), `${tag} keyboard down: the panel back in its place`);
    }
    const link = 'https://mohmdalmalik.github.io/Gaming-App/?join=BKTWM';
    await page.focus('#coop-code');
    await page.keyboard.insertText(link);
    const v = await page.inputValue('#coop-code');
    check(link.length === 53 && v === link, `a pasted invite link (${link.length} characters) is taken whole (${v.length})`);
    await tap(page, '#btn-coop-join');
    check(await waitScreen(page, 'menu-table', 8000) && await text(page, '#table-code') === 'BKTWM', `...and Join takes its code: at table ${await text(page, '#table-code')}`);
  } catch (err) { check(false, `keyboard: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-keyboard.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('link')) {
  console.log('\nlink. a join link: the register first on a new device, never "Guest"');
  for (const [code, host] of [['BKTWM', 'nora'], ['NNNNN', null]]) {
    const { browser, page, messages } = await launch({ width: 1024, height: 768, profile: false });
    try {
      await openPage(page, `coop=fake&fake=quiet&join=${code.toLowerCase()}`);
      await waitScreen(page, 'menu-signup');
      await page.waitForFunction(() => !document.getElementById('su-invite').hidden, null, { timeout: 10000 }).catch(() => {});
      const invite = await text(page, '#su-invite');
      check(await screenNow(page) === 'menu-signup' && invite === (host ? fill(T.coop.invited, { host }) : T.coop.invitedAny) && await text(page, '#su-title') === 'Sign the register',
        `?join=${code.toLowerCase()} on a device with no profile: the register, under "${invite}"`);
      const pageNow = await hooks(page, (h, a) => h.lobby(a), code);
      check(!pageNow || !pageNow.people.some(p => p.name === 'Guest'), 'nobody has been seated as "Guest" meanwhile');
      if (shots) await page.screenshot({ path: path.join(shots, `1024x768-register-invite-${code}.png`) });
      await page.fill('#su-name', 'newbie_x');
      await page.press('#su-name', 'Enter');
      if (host) {
        check(await waitScreen(page, 'menu-table', 10000), 'after Continue: straight into the waiting room');
        const people = await page.evaluate(() => [...document.querySelectorAll('#table-seats .cs-seat.person .cs-name')].map(e => e.textContent));
        const atTable = (await hooks(page, (h, a) => h.lobby(a), code)).people.map(p => p.name);
        check(people.includes('newbie_x') && !people.includes('Guest') && atTable.includes('newbie_x') && !atTable.includes('Guest'), `...seated as newbie_x, never "Guest" (${people.join(', ')})`);
        check(await text(page, '#table-kicker') === fill(T.table.kickerGuest, { host }) && await text(page, '#coop-toast') === fill(T.toasts.joinedYou, { host }), `..."${await text(page, '#table-kicker')}", toast "${await text(page, '#coop-toast')}"`);
        await fit(page, 'link-joined', '1024x768');
      } else {
        await waitScreen(page, 'menu-coop', 10000);
        await page.waitForFunction(() => !document.getElementById('coop-card').hidden, null, { timeout: 10000 }).catch(() => {});
        check(await text(page, '#coop-card-title') === T.errors.notFound.title, `after Continue: "${await text(page, '#coop-card-title')}"`);
      }
    } catch (err) { check(false, `link ${code}: ${err.message.split('\n')[0]}`); }
    check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
  }
  {
    const { browser, page, messages } = await launch({ width: 1180, height: 820 });
    try {
      await openPage(page, 'coop=fake&fake=quiet&join=BKTWM');
      check(await waitScreen(page, 'menu-table', 10000) && await text(page, '#table-code') === 'BKTWM', 'with a profile: the link goes straight into the waiting room');
      const url = await page.evaluate(() => location.search);
      check(/join=BKTWM/.test(url), `...and the address keeps ?join= (${url})`);
    } catch (err) { check(false, `link with a profile: ${err.message.split('\n')[0]}`); }
    check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('soon')) {
  console.log('\nsoon. Coming soon (?coop=soon on localhost), and a join link while Co-op is not open');
  const { browser, page, messages } = await launch({ width: 1024, height: 694 });
  try {
    await openPage(page, 'coop=soon');
    await tap(page, '#btn-menu-coop');
    await waitScreen(page, 'menu-coop');
    check(await text(page, '#coop-card-title') === T.soon.heading && await text(page, '#coop-card-line') === `${T.soon.line} ${T.soon.ready}` && !(await shown(page, '#btn-coop-start')),
      `Co-op: "${await text(page, '#coop-card-title')}" — "${(await text(page, '#coop-card-line'))?.slice(0, 50)}…", no Start a table`);
    check(await text(page, '#btn-coop-card-a') === T.soon.single && await text(page, '#btn-coop-card-b') === T.soon.back, `...its buttons: ${await text(page, '#btn-coop-card-a')} · ${await text(page, '#btn-coop-card-b')}`);
    await fit(page, 'soon', '1024x694');
    await page.waitForFunction(() => !document.getElementById('btn-menu-single').disabled, null, { timeout: 180000 });
    await tap(page, '#btn-coop-card-a');
    check(await waitScreen(page, 'menu-single'), 'its Single player button opens Single player');
    await page.evaluate(() => window.__game.menuShow('main'));
    await tap(page, '#btn-menu-coop');
    await tap(page, '#btn-coop-card-b');
    check(await waitScreen(page, 'menu-main'), 'its Back: the main menu');
    await openPage(page, 'coop=soon&join=BKTWM');
    check(await waitScreen(page, 'menu-coop', 10000) && await text(page, '#coop-card-title') === fill(T.soon.joinHeading) && await text(page, '#btn-coop-card-b') === T.soon.mainMenu,
      `a join link while Co-op isn't open: "${await text(page, '#coop-card-title')}" · ${await text(page, '#btn-coop-card-a')} · ${await text(page, '#btn-coop-card-b')}`);
    await fit(page, 'soon-join', '1024x694');
  } catch (err) { check(false, `soon: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-soon.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('live')) {
  console.log(`\nlive. the page as on the live site: http://hotel.test:${port}/ (no localhost, no ?server)`);
  const { browser, page, messages } = await launch({ width: 1180, height: 820, args: ['--host-resolver-rules=MAP hotel.test 127.0.0.1'] });
  const fetched = [];
  page.on('request', r => fetched.push(new URL(r.url()).pathname));
  try {
    for (const q of ['', '?coop=fake&fake=quiet&friends=demo&server=ws://localhost:9&coop=preview']) {
      fetched.length = 0;
      await page.goto(`http://hotel.test:${port}/${q}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout: 180000, polling: 100 });
      await page.waitForFunction(() => !document.getElementById('btn-menu-single').disabled, null, { timeout: 180000 });
      await page.waitForTimeout(1500);
      check(await screenNow(page) === 'menu-main' && !(await shown(page, '#btn-seat-switch')), `${q || '(no query)'}: the main menu, no seat switch`);
      await tap(page, '#btn-menu-coop');
      await waitScreen(page, 'menu-coop');
      check(await text(page, '#coop-card-title') === T.soon.heading && !(await shown(page, '#btn-coop-start')), `...Co-op says "${await text(page, '#coop-card-title')}"`);
      check(!fetched.some(p => /fakeLobby\.js$/.test(p)) && await page.evaluate(() => window.__fakeLobby === undefined && window.__coop === undefined), '...the pretend server is never fetched, and no test hooks exist');
      if (shots) await page.screenshot({ path: path.join(shots, `live-coming-soon${q ? '-links' : ''}.png`) });
    }
  } catch (err) { check(false, `live: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-live.png') }).catch(() => {}); }
  check(messages.length === 0, `no console error or warning at all${messages.length ? `: ${messages.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('demo')) {
  console.log('\ndemo. two seats on one device (?friends=demo, the pretend server)');
  const { browser, page, messages } = await launch({ width: 1024, height: 694 });
  try {
    await openPage(page, 'coop=fake&fake=quiet&friends=demo', { screen: 'menu-coop' });
    check(await text(page, '#coop-demo') === T.demo.note, `the review link opens on Co-op, with "${await text(page, '#coop-demo')}" under the heading`);
    check(!(await shown(page, '#btn-seat-switch')), 'no seat switch before the waiting room');
    await tap(page, '#btn-coop-start');
    await waitScreen(page, 'menu-table', 8000);
    const code = await text(page, '#table-code');
    check(/^[A-Z]{5}$/.test(code) && await text(page, '#table-demo') === T.demo.note, `1. Start a table: the code ${code}, the note under the heading`);
    check(await text(page, '#btn-seat-switch') === fill(T.demo.showSeat, { name: T.demo.secondName }), `2. the switch: "${await text(page, '#btn-seat-switch')}"`);
    await fit(page, 'demo-host', '1024x694');
    await tap(page, '#btn-seat-switch');
    check(await waitScreen(page, 'menu-coop') && await page.inputValue('#coop-code') === '' && await shown(page, '#btn-coop-start'), "...sam's screen: his own Co-op screen, an empty code field");
    check(await text(page, '#btn-seat-switch') === fill(T.demo.showSeat, { name: 'tester' }), `...the switch now: "${await text(page, '#btn-seat-switch')}"`);
    await page.fill('#coop-code', code.toLowerCase());
    await tap(page, '#btn-coop-join');
    check(await waitScreen(page, 'menu-table', 8000) && await text(page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'tester' }), `3. sam types the code and joins: "${await text(page, '#table-kicker')}"`);
    const samYou = await text(page, '#table-seats .cs-seat.you .cs-name');
    check(samYou === T.demo.secondName && !(await shown(page, '#btn-table-start')), `...on his screen "You" is ${samYou}, and he has no Start`);
    await fit(page, 'demo-sam', '1024x694');
    await tap(page, '#btn-seat-switch');
    await waitScreen(page, 'menu-table');
    const back = await page.evaluate(() => ({ you: document.querySelector('#table-seats .cs-seat.you .cs-name')?.textContent, n: document.querySelectorAll('#table-seats .cs-seat.person').length, title: document.getElementById('table-title').textContent }));
    check(back.you === 'tester' && back.n === 2 && back.title === T.table.ready, `4. back to your screen: you are tester, ${back.n} at the table, "${back.title}"`);
    await tap(page, '#btn-table-start');
    await page.waitForFunction(() => !document.getElementById('table-countdown').hidden, null, { timeout: 5000 }).catch(() => {});
    check(await shown(page, '#table-countdown'), '...Start: the countdown');
    await page.waitForFunction(t => document.getElementById('table-status').textContent === t, T.demo.dealt, { timeout: 12000 }).catch(() => {});
    check(await text(page, '#table-status') === T.demo.dealt, `...then "${await text(page, '#table-status')}"`);
    await fit(page, 'demo-dealt', '1024x694');
  } catch (err) { check(false, `demo: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-demo.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------------------------
if (only.includes('flows')) {
  console.log('\nflows. the waiting room and the Co-op screen at work');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  // the share sheet and the clipboard, recorded (Safari: a share must be asked inside the tap)
  await page.context().addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: d => { window.__shared = { d, active: !!navigator.userActivation?.isActive }; return Promise.resolve(); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: t => (window.__copyFails ? Promise.reject(new Error('no')) : (window.__copied = t, Promise.resolve())) } });
  });
  const toast = () => text(page, '#coop-toast');
  const atTable = () => hooks(page, h => h.lobby());
  const newTable = async () => {
    await page.evaluate(() => window.__game.menuShow('main'));
    await tap(page, '#btn-menu-coop');
    await tap(page, '#btn-coop-start');
    return waitScreen(page, 'menu-table', 8000);
  };
  try {
    await openPage(page, 'coop=fake&fake=quiet');
    await page.waitForFunction(() => !document.getElementById('btn-menu-single').disabled, null, { timeout: 180000 });
    check(await newTable(), 'Start a table: the waiting room');
    const code = await text(page, '#table-code');
    const link = `${baseUrl}?join=${code}`;
    check(await page.evaluate(() => document.getElementById('table-code').getAttribute('aria-label')) === fill(T.table.codeAria, { letters: code.split('').join(', ') }), `the code is read out letter by letter ("${await page.evaluate(() => document.getElementById('table-code').getAttribute('aria-label'))}")`);
    await tap(page, '#btn-table-invite');
    const shared = await page.evaluate(() => window.__shared);
    check(shared?.active && shared.d.url === link && shared.d.text === fill(T.table.shareText, { code }) && shared.d.title === T.table.shareTitle, `Invite friends: the share sheet, asked inside the tap (${shared?.d?.url})`);
    await tap(page, '#btn-table-copy');
    check(await page.evaluate(() => window.__copied) === link && await toast() === T.toasts.linkCopied, `Copy link: copied, "${await toast()}"`);
    await page.evaluate(() => { window.__copyFails = true; });
    await tap(page, '#btn-table-copy');
    await page.waitForTimeout(200);
    const byHand = await page.evaluate(() => { const f = document.getElementById('table-link'); return { shown: !f.hidden, value: f.value, focus: document.activeElement === f, all: f.selectionStart === 0 && f.selectionEnd === f.value.length }; });
    check(byHand.shown && byHand.value === link && byHand.focus && byHand.all, 'copying refused: the link shows, selected, for copying by hand');
    await page.evaluate(() => { window.__copyFails = false; });
    // size and lock
    await tap(page, '#table-size .seg-btn[data-value="4"]');
    await page.waitForTimeout(400);
    check((await atTable()).size === 4 && await text(page, '#table-status') === fill(T.table.seatsTaken, { n: 1, size: 4 }), `Guests at the table 4: "${await text(page, '#table-status')}"`);
    await hooks(page, h => { h.addPerson('sam'); });
    await page.waitForTimeout(150);
    check(await toast() === fill(T.toasts.joined, { name: 'sam' }), `a friend sits down: "${await toast()}"`);
    await hooks(page, h => { h.addPerson('ivy'); h.addPerson('pebble'); });
    await page.waitForTimeout(150);
    check(await page.evaluate(() => document.querySelector('#table-size .seg-btn[data-value="4"]').disabled === false && document.querySelectorAll('#table-seats .cs-seat.empty').length === 0), 'four people at a table of 4: no empty seat');
    await tap(page, '#table-size .seg-btn[data-value="5"]');
    await page.waitForTimeout(300);
    await hooks(page, h => h.addPerson('jules'));
    await page.waitForTimeout(150);
    check(await page.evaluate(() => document.querySelector('#table-size .seg-btn[data-value="4"]').disabled), 'five people: 4 can no longer be chosen');
    await tap(page, '#table-lock .seg-btn[data-value="true"]');
    await page.waitForTimeout(300);
    check((await atTable()).locked && await text(page, '#table-note') === T.table.lockedNote, 'Locked: the table is locked, and the note says what that means');
    await tap(page, '#table-lock .seg-btn[data-value="false"]');
    await page.waitForTimeout(300);
    check(!(await atTable()).locked && await text(page, '#table-note') === T.table.sizeNote, 'Welcome: open again');
    // remove
    await page.evaluate(() => { const b = [...document.querySelectorAll('#table-seats button.cs-box')].find(x => x.textContent.includes('sam')); b.setAttribute('data-test', 'sam'); });
    await tap(page, '#table-seats button[data-test="sam"]');
    check(await text(page, '#table-dlg-title') === fill(T.dialogs.remove.title, { name: 'sam' }) && await text(page, '#btn-table-dlg-yes') === T.dialogs.remove.buttons[1], `Remove: "${await text(page, '#table-dlg-title')}" · ${await text(page, '#btn-table-dlg-no')} · ${await text(page, '#btn-table-dlg-yes')}`);
    await tap(page, '#btn-table-dlg-yes');
    await page.waitForTimeout(400);
    check(!(await atTable()).people.some(p => p.name === 'sam') && !(await text(page, '#table-seats')).includes('sam'), '...sam is no longer at the table');
    // a guest's seat can't be tapped by a guest; the host's own seat can't be tapped
    check(await page.evaluate(() => !document.querySelector('#table-seats .cs-seat.you button')), 'your own seat is not a button');
    // the match dealt (no match screens yet): the line says so
    await tap(page, '#btn-table-start');
    await page.waitForFunction(t => document.getElementById('table-status').textContent === t, T.demo.dealt, { timeout: 12000 }).catch(() => {});
    check(await text(page, '#table-status') === T.demo.dealt, `Start: the countdown, then "${await text(page, '#table-status')}"`);
    await tap(page, '#btn-table-leave');
    check(await waitScreen(page, 'menu-coop') && !(await atTable()), 'Leave table: back to Co-op, the seat freed');
    // Start alone: Play with bots
    await newTable();
    await tap(page, '#btn-table-start');
    await tap(page, '#btn-table-dlg-yes');
    check(await waitScreen(page, 'menu-bots') && !(await atTable()), `Start alone, "${T.dialogs.alone.buttons[1]}": Play with bots' screen, the table left`);
    // the Wardrobe and back
    await newTable();
    await tap(page, '#btn-table-wardrobe');
    check(await waitScreen(page, 'menu-avatar', 15000), 'the Wardrobe from the waiting room');
    await hooks(page, h => h.addPerson('sam'));
    await page.waitForTimeout(300);
    check(await screenNow(page) === 'menu-avatar', '...a friend sitting down meanwhile does not pull you out of it');
    await page.waitForTimeout(800);
    await page.evaluate(() => window.__game.menuShow('main'));       // (what its Done asks for: src/main.js)
    check(await waitScreen(page, 'menu-table'), '...its Done comes back to the waiting room, not the main menu');
    await tap(page, '#btn-table-leave');
    // a guest: the host leaves; a scripted host starts; being removed
    await page.fill('#coop-code', 'bktwm');
    await tap(page, '#btn-coop-join');
    await waitScreen(page, 'menu-table', 8000);
    check(await toast() === fill(T.toasts.joinedYou, { host: 'nora' }), `joined: "${await toast()}"`);
    await page.waitForTimeout(300);
    await hooks(page, h => h.hostLeaves('BKTWM'));
    await page.waitForTimeout(200);
    check(await toast() === fill(T.toasts.hostLeft, { name: 'nora', host: 'ivy' }) && await text(page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'ivy' }), `the host leaves: "${await toast()}"`);
    await hooks(page, h => h.bye('removed', 'BKTWM'));
    check(await waitScreen(page, 'menu-coop') && await text(page, '#coop-card-title') === T.errors.removed.title && await text(page, '#btn-coop-card-a') === T.errors.removed.buttons[0], `removed: "${await text(page, '#coop-card-title')}" · ${await text(page, '#btn-coop-card-a')}`);
    await tap(page, '#btn-coop-card-a');
    check(await waitScreen(page, 'menu-main'), '...Main menu');
    // every error while opening a table or joining one
    await tap(page, '#btn-menu-coop');
    const joinCards = { NNNNN: 'notFound', FFFFF: 'full', MMMMM: 'midMatch', BBBBB: 'locked', CCCCC: 'closed', DDDDD: 'removed' };
    for (const [c, kind] of Object.entries(joinCards)) {
      if (await shown(page, '#coop-card')) await page.evaluate(() => window.__game.menuShow('main')).then(() => tap(page, '#btn-menu-coop'));
      await page.fill('#coop-code', c);
      await tap(page, '#btn-coop-join');
      await page.waitForFunction(() => !document.getElementById('coop-card').hidden, null, { timeout: 5000 }).catch(() => {});
      check(await text(page, '#coop-card-title') === fill(T.errors[kind].title), `join ${c}: "${await text(page, '#coop-card-title')}"`);
    }
    for (const kind of ['busy', 'tooMany', 'update', 'serverOld']) {
      await page.evaluate(() => window.__game.menuShow('main'));
      await tap(page, '#btn-menu-coop');
      await hooks(page, (h, a) => h.nextError(a), kind);
      await tap(page, '#btn-coop-start');
      await page.waitForFunction(() => !document.getElementById('coop-card').hidden, null, { timeout: 5000 }).catch(() => {});
      check(await text(page, '#coop-card-title') === T.errors[kind].title, `Start a table, the server says ${kind}: "${await text(page, '#coop-card-title')}"`);
    }
    // notFound's Try again: back to the code, kept, to fix the letters
    await page.evaluate(() => window.__game.menuShow('main'));
    await tap(page, '#btn-menu-coop');
    await page.fill('#coop-code', 'NNNNN');
    await tap(page, '#btn-coop-join');
    await page.waitForFunction(() => !document.getElementById('coop-card').hidden, null, { timeout: 5000 }).catch(() => {});
    check(await text(page, '#coop-card-line') === fill(T.errors.notFound.line, { code: 'NNNNN' }), `"${await text(page, '#coop-card-line')}"`);
    await tap(page, '#btn-coop-card-a');
    check(await shown(page, '#coop-code') && await page.inputValue('#coop-code') === 'NNNNN' && await page.evaluate(() => document.activeElement?.id) === 'coop-code', 'Try again: the code field, the code kept, ready to fix');
    // the server can't be reached: the card after a while (the pretend server's 20 s, made 1 s)
    await hooks(page, h => { h.timeScale(20); h.nextError('unreachable'); });
    await page.fill('#coop-code', '');
    await tap(page, '#btn-coop-start');
    await page.waitForFunction(() => !document.getElementById('coop-card').hidden, null, { timeout: 8000 }).catch(() => {});
    check(await text(page, '#coop-card-title') === T.errors.unreachable.title, `the server can't be reached: "${await text(page, '#coop-card-title')}"`);
    await hooks(page, h => { h.timeScale(1); h.nextError(null); });
    // Back while opening: nothing is opened behind your back
    await page.evaluate(() => window.__game.menuShow('main'));
    await tap(page, '#btn-menu-coop');
    await hooks(page, h => h.delay(15000));
    await tap(page, '#btn-coop-start');
    // (Back pressed at once, whatever the machine's speed: a click from the page itself, as a keyboard's would be)
    const opening = await text(page, '#btn-coop-start .mb-main');
    await page.evaluate(() => document.getElementById('btn-coop-back').click());
    await page.waitForTimeout(16000);
    const after = { screen: await screenNow(page), table: await atTable() };
    check(after.screen === 'menu-main' && !after.table, `Back while the table opens (${opening}): the main menu, and no table is left open (${after.screen}, ${after.table ? `table ${after.table.code}` : 'no table'})`);
    await hooks(page, h => h.delay(150));
    // offline
    await tap(page, '#btn-menu-coop');
    await page.context().setOffline(true);
    await page.waitForTimeout(400);
    check(await text(page, '#coop-status') === T.coop.offline && await page.evaluate(() => document.getElementById('btn-coop-start').disabled && document.getElementById('btn-coop-join').disabled), `offline: "${await text(page, '#coop-status')}", the buttons dimmed`);
    if (shots) await page.screenshot({ path: path.join(shots, '1180x820-offline.png') });
    await page.context().setOffline(false);
    await page.waitForTimeout(400);
    check(await page.evaluate(() => !document.getElementById('btn-coop-start').disabled) && await text(page, '#coop-status') === '', 'back online: the buttons work again');
  } catch (err) { check(false, `flows: ${err.message.split('\n')[0]}`); if (shots) await page.screenshot({ path: path.join(shots, 'error-flows.png') }).catch(() => {}); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

server?.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL CO-OP MENU CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
