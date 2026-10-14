// Browser checks for start-up and failures (headless Chromium, software WebGL: slow, about 4-6 minutes).
// Serve the repo first:
//   (cd /home/user/Gaming-App && python3 -m http.server 8123 --bind 127.0.0.1)
//   node tests/browser-reliability.mjs [--url http://127.0.0.1:8123/] [--screens]
//
// 1. the browser's answer about import maps is only a hint: a browser that says "no" wrongly still starts the
//    game; a browser with no import maps (the page's import map taken out) says "Hotel Escape needs iPadOS 16.4
//    or newer." when the game fails to load, with a Reload button and no automatic reload
// 2. a game file that cannot load: ONE automatic reload, then "The game could not load. Try again." with a
//    Reload button and the technical text in small print; never a loop; no automatic reload if the tab
//    cannot keep its marker (sessionStorage blocked); a failure that goes away on the reload starts the game
//    and clears the marker; no WebGL says so (and does not reload for nothing); offline: no automatic reload
//    (the browser's own error page would replace the game), the card and its Reload button instead
// 3. slow loading: no "check the internet" alarm after 20 s, what is loading is shown (files and MB), the
//    menu comes up, the Settings screen's Version line (not on the main menu); a load that stalls for 30 s
//    gets a plain Reload button on the loading screen
// 4. a step of the frame that throws: the picture goes on drawing and the camera on moving, a one-off shows
//    nothing, repeated failure shows "Something went wrong" (Back to menu, Reload, the version and the last
//    message in small print), Back to menu works, a failing main picture shows it sooner, the same
//    uncaught error again and again shows it, rejected promises and a ResizeObserver notice never do
// 5. the graphics context lost and back: a portrait cut off by the loss is drawn again (never the stock
//    picture), also when the loss lands in the middle of the read-back; lost and never back (while the page is
//    in view): the "Something went wrong" card after a few seconds, and gone again if it does come back
// 6. "turn sideways" only in a window taller than wide on a device held upright; "make this window wider" in a
//    wide small one, and in a narrow one on a device held sideways (Split View)
import { launch } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { versionLine } from '../src/version.js';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots', 'reliability');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIRECT = 'mode=practice&intro=off&timer=off';

// A page of its own for each scenario; `docs` counts how many times index.html was fetched (an automatic
// reload shows as a second one).
async function open(opts = {}) {
  const run = await launch({ width: 1180, height: 820, profile: false, ...opts });
  const { page } = run;
  run.docs = 0;
  page.on('request', r => { if (r.resourceType() === 'document') run.docs++; });
  run.shot = async name => { if (shots) await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
  run.cardText = () => page.evaluate(() => { const e = document.getElementById('error-overlay'); return e.hidden ? null : e.innerText; });
  run.cardShown = () => page.evaluate(() => !document.getElementById('error-overlay').hidden);
  run.visible = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0; }, sel);
  return run;
}
const gameReady = (page, ms = 150000) => page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: ms, polling: 250 });
const frameNo = page => page.evaluate(() => window.__game.view.renderer.info.render.frame);

// ---- 1. a browser too old for the game ----------------------------------------------------------------
// The browser's own answer to "do you have import maps?" is only a hint (index.html): the game is always tried,
// and the "needs iPadOS 16.4" card shows only when it then fails to load AND the hint said no.
console.log('1. a browser without import maps');
const NO_MAPS = [['supports("importmap") is false', () => { HTMLScriptElement.supports = () => false; }], ['no HTMLScriptElement.supports at all', () => { HTMLScriptElement.supports = undefined; }]];
// (a) the browser answers "no" wrongly, as a Safari that did so would: it has import maps, so the game starts anyway
for (const [label, script] of NO_MAPS) {
  const run = await open();
  await run.page.addInitScript(script);
  await run.page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await gameReady(run.page, 120000).catch(() => {});
  const started = await run.page.evaluate(() => !!window.__game);
  check(started && !(await run.cardShown()), `(${label}, but the browser does have import maps) the game starts: the answer is a hint, never a gate`);
  check(!run.messages.length, `...with no console messages${run.messages.length ? `: ${run.messages[0]}` : ''}`);
  await run.browser.close();
}
// (b) a real browser without import maps: the page's import map is taken out, so 'three' cannot be found
for (const [label, script] of NO_MAPS) {
  const run = await open();
  await run.page.addInitScript(script);
  await run.page.route(baseUrl, async route => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()).replace(/<script type="importmap">[\s\S]*?<\/script>/, '') });
  });
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 60000 });
  await sleep(2500);
  const text = await run.cardText();
  const parts = await run.page.evaluate(() => ({ message: document.getElementById('error-message').textContent, detail: document.getElementById('error-detail').textContent }));
  check(/Update needed/.test(text) && /Hotel Escape needs iPadOS 16\.4 or newer\./.test(text), `(${label}, and no import map) the card says "Hotel Escape needs iPadOS 16.4 or newer."`);
  check(!/internet|module|specifier|three/i.test(parts.message) && /specifier|three|module/i.test(parts.detail), '...the message is plain words and the technical text is small print');
  check(await run.visible('#btn-error-reload') && !(await run.visible('#btn-error-menu')), '...with a Reload button (the answer might be wrong) and no Back to menu');
  check(run.docs === 1, `...and no automatic reload (the page was fetched ${run.docs} time)`);
  check(!(await run.visible('#boot')) && !(await run.visible('#menu')), 'no loading screen or menu behind the card');
  if (label.startsWith('supports("importmap")')) await run.shot('1-old-browser');
  await run.browser.close();
}

// ---- 2. a real load failure ---------------------------------------------------------------------------
console.log('\n2. a game file that cannot load');
{
  const run = await open();
  await run.page.route('**/src/ui/crash.js', r => r.abort());       // (a deep module: any of the 90 files)
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000 });
  await sleep(2500);
  const text = await run.cardText();
  check(run.docs === 2, `the page reloaded once by itself, and only once (the page was fetched ${run.docs} times)`);
  check(/Could not start/.test(text) && /The game could not load\. Try again\./.test(text), 'then the card says "The game could not load. Try again."');
  check(await run.visible('#btn-error-reload'), 'with a Reload button');
  const parts = await run.page.evaluate(() => ({ message: document.getElementById('error-message').textContent, detail: document.getElementById('error-detail').textContent, detailBox: document.getElementById('error-detail').getBoundingClientRect().height }));
  check(!/crash\.js|module|http/i.test(parts.message), 'the message itself is plain words, no technical text');
  check(/module|fetch|main\.js/i.test(parts.detail) && parts.detailBox > 0, `the technical text is in small print under it ("${parts.detail.slice(0, 70)}…")`);
  check(!/internet/i.test(text), 'and it does not tell the player to check the internet');
  check(await run.page.evaluate(() => !!sessionStorage.getItem('hotelEscape.reloadedOnce')), 'a marker in sessionStorage says it already reloaded once');
  await run.shot('2-load-failed');
  await run.page.click('#btn-error-reload');
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000 });
  await sleep(1500);
  check(run.docs === 3, `Reload reloads the page (fetched ${run.docs} times), and the failure then shows the card again without a loop`);
  await run.browser.close();
}
{
  // a failure that goes away on the reload (old and new files mixed just after a publish)
  const run = await open();
  let hits = 0;
  await run.page.route('**/src/ui/crash.js', r => (hits++ === 0 ? r.abort() : r.continue()));
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 250 });
  await sleep(500);
  check(run.docs === 2 && !(await run.cardShown()), `a file missing once: the automatic reload starts the game, no card (page fetched ${run.docs} times)`);
  check(await run.page.evaluate(() => !sessionStorage.getItem('hotelEscape.reloadedOnce')), 'and the marker is cleared, so a later publish can reload once again');
  await run.browser.close();
}
{
  // a tab that cannot keep the marker: no automatic reload (it could loop)
  const run = await open();
  await run.page.addInitScript(() => { Object.defineProperty(window, 'sessionStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); });
  await run.page.route('**/src/ui/crash.js', r => r.abort());
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000 });
  await sleep(2000);
  check(run.docs === 1 && /The game could not load\. Try again\./.test(await run.cardText()), `sessionStorage blocked: no automatic reload (fetched ${run.docs} time), the card shows`);
  await run.browser.close();
}
{
  // a tab whose sessionStorage reads but cannot be written (full, or private): the marker would never stick, so no reload
  const run = await open();
  await run.page.addInitScript(() => { Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
  await run.page.route('**/src/ui/crash.js', r => r.abort());
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000 });
  await sleep(2000);
  check(run.docs === 1 && /The game could not load\. Try again\./.test(await run.cardText()), `sessionStorage that cannot be written: no automatic reload (fetched ${run.docs} time), the card shows`);
  await run.browser.close();
}
{
  // no WebGL (Lockdown Mode, an old GPU): said plainly, and no pointless reload
  const run = await open();
  await run.page.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return /webgl/i.test(type) ? null : get.call(this, type, ...rest); };
  });
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 60000 });
  await sleep(1500);
  const text = await run.cardText();
  check(/cannot show 3D graphics/.test(text) && run.docs === 1, `no WebGL: "This browser cannot show 3D graphics, which Hotel Escape needs." and no reload (fetched ${run.docs} time)`);
  check(!/internet/i.test(text), '...without blaming the internet');
  await run.browser.close();
}

{
  // offline when the file fails: a reload cannot help, and it would put the browser's own error page where the
  // game was (no card, no button, a tab with no toolbar in a Home Screen app). The card and its Reload button instead.
  const run = await open();
  const ctx = run.page.context();
  let failing = true;
  await run.page.route('**/src/ui/crash.js', async r => { if (failing) { await ctx.setOffline(true); r.abort(); } else r.continue(); });
  await run.page.goto(baseUrl, { waitUntil: 'load' });
  await run.page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000 });
  await sleep(2500);
  const url = run.page.url();
  check(run.docs === 1 && url.startsWith('http://127.0.0.1') && /The game could not load\. Try again\./.test(await run.cardText()), `offline: no automatic reload (fetched ${run.docs} time), still on the game's page, the card shows`);
  check(await run.visible('#btn-error-reload') && !(await run.page.evaluate(() => !!sessionStorage.getItem('hotelEscape.reloadedOnce'))), '...with its Reload button, and no marker used up');
  await run.shot('2-offline');
  failing = false; await ctx.setOffline(false);
  await run.page.click('#btn-error-reload');
  await run.page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 250 });
  check(!(await run.cardShown()), 'back online, Reload starts the game');
  await run.browser.close();
}

// ---- 3. slow loading, the menu, Settings' Version line -------------------------------------------------
console.log('\n3. slow loading: no false alarm, real progress');
{
  const run = await open({ profile: true });
  const { page } = run;
  await page.route('**/src/main.js', async r => { await sleep(24000); r.continue(); });     // (the old alarm fired at 20 s)
  const t0 = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await sleep(Math.max(0, 22500 - (Date.now() - t0)));
  const mid = await page.evaluate(() => { const b = document.getElementById('boot'); return { card: !document.getElementById('error-overlay').hidden, shown: !b.hidden && getComputedStyle(b).display !== 'none' && getComputedStyle(b).opacity === '1', text: b.innerText.replace(/\s+/g, ' ').trim() }; });
  check(!mid.card, 'after 22 s of waiting there is no "check the internet" card (the file is only slow)');
  check(mid.shown && /Loading the game/.test(mid.text), `what is loading is shown instead ("${mid.text}")`);
  await run.shot('3-loading');
  await page.waitForFunction(() => window.__game, null, { timeout: 120000, polling: 250 });
  let counted = '';
  const t1 = Date.now();
  while (Date.now() - t1 < 150000) {
    const s = await page.evaluate(() => ({ ready: !document.getElementById('btn-menu-bots').disabled, c: document.getElementById('menu-loading-count').textContent, menu: !document.getElementById('menu').hidden }));
    if (s.c) counted = s.c;
    if (s.ready) break;
    await sleep(250);
  }
  check(/\d+ files/.test(counted), `on the menu, while the hotel opens, the count goes on ("Opening the hotel…${counted}")`);
  const p = await page.evaluate(() => window.__hotelBoot.progress());
  check(p.stage === 'hotel' && p.files > 60 && /\d+ files/.test(p.text), `the count is real: ${p.text}`);
  check(!(await run.cardShown()) && !(await run.visible('#boot')), 'the menu is up: no card, no loading screen');
  check(!/Version/.test(await page.evaluate(() => document.getElementById('menu-main').innerText)), 'the main menu shows no version');
  await page.evaluate(() => window.__game.menuShow('settings'));
  await sleep(700);
  const ver = await page.textContent('#set-version');
  check(ver === versionLine() && /^Version v\d+\.\d+ · \d/.test(ver), `Settings ends with the quiet line "${ver}" (src/version.js)`);
  const at = await page.evaluate(() => { const v = document.getElementById('set-version').getBoundingClientRect(), d = document.getElementById('btn-settings-done').getBoundingClientRect(); return { below: v.top >= d.bottom - 1, inside: v.bottom <= innerHeight }; });
  check(at.below && at.inside, 'it sits below the Done button and on the screen');
  await run.shot('3-settings');
  for (const [w, h] of [[1024, 768], [1024, 694], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(500);
    const r = await page.evaluate(() => { const v = document.getElementById('set-version').getBoundingClientRect(), s = document.querySelector('.menu-panel').getBoundingClientRect(); return { top: s.top, bottom: v.bottom, h: innerHeight }; });
    check(r.top >= 0 && r.bottom <= r.h, `${w}x${h}: the whole Settings screen, version line included, fits (${Math.round(r.top)}..${Math.round(r.bottom)} of ${r.h})`);
  }
  check(!run.messages.length, `no console errors or warnings${run.messages.length ? `: ${run.messages[0]}` : ''}`);
  await run.browser.close();
}

{
  // a load that stalls (a connection that never fails and never finishes): after 30 s with nothing new, a Reload button
  const run = await open();
  const { page } = run;
  await page.route('**/src/main.js', async r => { await sleep(60000); try { await r.continue(); } catch { /* the page has gone */ } });
  const t0 = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await sleep(Math.max(0, 22000 - (Date.now() - t0)));
  check(!(await run.visible('#boot-reload')) && await run.visible('#boot'), 'a load that is only slow: after 22 s the loading screen has no Reload button yet');
  await sleep(Math.max(0, 33500 - (Date.now() - t0)));
  const stall = await page.evaluate(() => { const b = document.getElementById('boot-reload'), r = b.getBoundingClientRect(), at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return { shown: !b.hidden && r.width > 0, tappable: at === b, text: document.getElementById('boot').innerText.replace(/\s+/g, ' ').trim(), card: !document.getElementById('error-overlay').hidden }; });
  check(stall.shown && stall.tappable && !stall.card, `stalled for 30 s: a Reload button is on the loading screen and can be tapped ("${stall.text}")`);
  await run.shot('3-stalled');
  await page.click('#boot-reload');
  await sleep(1500);
  check(run.docs === 2, `...and it reloads the page (fetched ${run.docs} times)`);
  await run.browser.close();
}

// ---- 4 / 5 / 6. a running game ---------------------------------------------------------------------------
console.log('\n4. a step of the frame that throws');
const run = await open({ profile: true });
const { page } = run;
await page.goto(`${baseUrl}?${DIRECT}`, { waitUntil: 'domcontentloaded' });
await gameReady(page);
await page.click('#btn-begin');
await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 30000 });
await sleep(1500);
const g = fn => page.evaluate(fn);
check(!(await run.visible('#boot')) && !(await run.cardShown()), 'a direct link: once the game runs, the loading screen is gone for good (it does not come back behind the game)');
{
  // a one-off
  await g(() => { const G = window.__game; let n = 0; const real = G.fog.update; G.fog.update = function (...a) { if (n++ === 0) throw new TypeError('one-off'); return real.apply(this, a); }; });
  await sleep(3000);
  const s = await g(() => ({ ring: window.__game.crash.ring(), shown: window.__game.crash.shown }));
  check(s.ring.some(e => e.step === 'fog' && /one-off/.test(e.text) && e.count === 1) && !s.shown && !(await run.cardShown()), 'one failure of one step is written down and nothing is shown');
}
{
  // a decoration that keeps failing: the picture goes on, the camera moves, the card comes after repeats
  await g(() => { const G = window.__game; G.crash.limits.step = { frames: 6, ms: 800 }; G.fog.update = () => { throw new TypeError('x.y is not a function'); }; });
  const f0 = await frameNo(page);
  const cam0 = await g(() => window.__game.view.camera.position.toArray());
  await g(() => window.__game.rotate(1));
  await page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 90000, polling: 200 });
  await sleep(1500);
  const f1 = await frameNo(page);
  const cam1 = await g(() => window.__game.view.camera.position.toArray());
  check(f1 - f0 >= 5, `the main picture kept drawing while a step failed (${f1 - f0} frames)`);
  check(cam0.some((v, i) => Math.abs(v - cam1[i]) > 0.01), 'and the camera still turned when asked (the rest of the frame ran)');
  const text = await run.cardText();
  check(/Something went wrong/.test(text) && /Back to menu/.test(text) && /Reload/.test(text), 'then "Something went wrong" shows, with Back to menu and Reload');
  check(/v\d+\.\d+ · \d/.test(text) && /fog: TypeError: x\.y is not a function/.test(text), `the small print has the version and the last message ("${text.split('\n').pop()}")`);
  check(await run.visible('#btn-error-menu') && await run.visible('#btn-error-reload'), 'both buttons are on the card');
  await run.shot('4-something-went-wrong');
  await sleep(500);
  check(await g(() => window.__game.crash.shown), 'the net knows the card is up (the clock and the computer guests wait behind it)');
  // Back to menu
  await page.click('#btn-error-menu');
  await page.waitForFunction(() => window.__game.phase() === 'menu' && !document.getElementById('menu').hidden, null, { timeout: 60000, polling: 250 });
  check(!(await run.cardShown()) && !(await g(() => window.__game.crash.shown)), 'Back to menu closes the card and opens the main menu');
}
{
  // a failing main picture comes sooner
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout: 120000, polling: 250 });
  await g(() => { window.__game.crash.limits.render = { frames: 4, ms: 300 }; window.__game.view.renderer.render = () => { throw new Error('GL: render failed'); }; });
  await page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 60000, polling: 200 });
  const text = await run.cardText();
  check(/Something went wrong/.test(text) && /render: Error: GL: render failed|render: GL: render failed/.test(text), `the main picture failing raises the card (the small print: "${text.split('\n').pop()}")`);
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout: 120000, polling: 250 });
}
{
  // the page's own errors (the menu is showing; nothing of the game runs)
  await g(() => { for (let i = 0; i < 3; i++) setTimeout(() => { throw new Error('tap failed once or twice'); }, i * 1500); });
  await sleep(4500);
  check(!(await run.cardShown()), 'a few uncaught errors a second or more apart show nothing');
  await g(() => { window.dispatchEvent(Object.assign(new Event('error'), { message: 'ResizeObserver loop completed with undelivered notifications.' })); for (let i = 0; i < 40; i++) Promise.reject(new Error('benign rejection')); });
  await sleep(1500);
  const s = await g(() => ({ shown: window.__game.crash.shown, steps: window.__game.crash.ring().map(e => e.step) }));
  check(!s.shown && !(await run.cardShown()) && s.steps.includes('promise'), 'forty rejected promises and a ResizeObserver notice show nothing (the rejections are only written down)');
  await g(() => { for (let i = 0; i < 9; i++) setTimeout(() => { throw new Error('the same error again'); }, i * 30); });
  await page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 20000, polling: 100 });
  check(/the same error again/.test(await run.cardText()), 'the same uncaught error nine times in a moment shows the card');
  await page.click('#btn-error-menu');
  await page.waitForFunction(() => document.getElementById('error-overlay').hidden, null, { timeout: 20000 });
  check(!(await run.cardShown()), 'Back to menu from the main menu closes it too');
}

console.log('\n5. the graphics context lost and back');
{
  await page.goto(`${baseUrl}?${DIRECT}`, { waitUntil: 'domcontentloaded' });
  await gameReady(page);
  await page.click('#btn-begin');
  await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 30000 });
  await sleep(1500);
  const av = await g(() => window.__game.seats()[0].avatar);
  const warnings0 = run.messages.length;
  // (a) asked just before the loss, then a loss
  const a = await page.evaluate(async av => {
    const G = window.__game, gl = G.view.renderer.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    const wait = p => Promise.race([p, new Promise(r => setTimeout(() => r('TIMEOUT'), 90000))]);
    const asked = G.portraits().url({ ...av, skin: 'bronze' });
    ext.loseContext();
    await new Promise(r => setTimeout(r, 500));
    const lost = gl.isContextLost();
    const during = G.portraits().url({ ...av, skin: 'brown' });
    ext.restoreContext();
    await new Promise(r => setTimeout(r, 1200));
    return { lost, restored: !gl.isContextLost(), asked: String(await wait(asked)), during: String(await wait(during)), after: String(await wait(G.portraits().url({ ...av, skin: 'golden' }))) };
  }, av);
  check(a.lost && a.restored, 'the context was lost and came back');
  check(a.asked.startsWith('blob:'), 'a portrait asked just before the loss is drawn again afterwards (not the stock picture)');
  check(a.during.startsWith('blob:') && a.after.startsWith('blob:'), 'so are one asked during the loss and one asked after it');
  // (b) the loss in the middle of the read-back
  const b = await page.evaluate(async av => {
    const G = window.__game, r = G.view.renderer, gl = r.getContext(), ext = gl.getExtension('WEBGL_lose_context');
    const real = r.readRenderTargetPixelsAsync;
    let cut = 0;
    r.readRenderTargetPixelsAsync = function (...a) {
      const p = real.apply(this, a);
      if (!cut++) { ext.loseContext(); setTimeout(() => ext.restoreContext(), 400); }
      return p;
    };
    const url = await Promise.race([G.portraits().url({ ...av, skin: 'tan', hair: 'silver' }), new Promise(res => setTimeout(() => res('TIMEOUT'), 90000))]);
    r.readRenderTargetPixelsAsync = real;
    return { cut, url: String(url), lost: gl.isContextLost() };
  }, av);
  check(b.cut >= 2 && b.url.startsWith('blob:') && !b.lost, `a loss in the middle of the read-back: that portrait was drawn again (${b.cut} read-backs), not cut off or the stock picture`);
  const f0 = await frameNo(page); await sleep(2500); const f1 = await frameNo(page);
  check(f1 - f0 >= 2, `the hotel draws again afterwards (${f1 - f0} frames in 2.5 s)`);
  const ring = await g(() => window.__game.crash.ring().filter(e => e.step === 'graphics').map(e => e.text));
  check(ring.some(t => /lost/.test(t)) && ring.some(t => /came back/.test(t)) && !(await run.cardShown()), 'the loss and the return are in the small print\'s record, with no card');
  const bad = run.messages.slice(warnings0).filter(m => /shipped picture is used instead|does not belong to this context/.test(m));
  check(!bad.length, `no "the shipped picture is used instead" warning${bad.length ? `: ${bad[0]}` : ''}`);
}

{
  // lost and never back: a still picture under a live interface is a freeze like any other
  await page.goto(`${baseUrl}?${DIRECT}`, { waitUntil: 'domcontentloaded' });
  await gameReady(page);
  await page.click('#btn-begin');
  await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 30000 });
  await sleep(1500);
  await g(() => { window.__lose = window.__game.view.renderer.getContext().getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
  await sleep(2500);
  check(!(await run.cardShown()), 'lost for 2.5 s: no card yet (it may come back by itself)');
  await g(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); });
  await sleep(8000);
  check(!(await run.cardShown()), 'a loss while the page is hidden is not counted (Safari restores it on return): still no card after 8 s more');
  await g(() => { delete document.visibilityState; });
  await page.waitForFunction(() => !document.getElementById('error-overlay').hidden, null, { timeout: 30000, polling: 200 });
  const text = await run.cardText();
  check(/Something went wrong/.test(text) && /graphics: The graphics context was lost and did not come back\./.test(text) && await run.visible('#btn-error-reload'), `lost and never back: "Something went wrong" with Reload (the small print: "${text.split('\n').pop()}")`);
  await run.shot('5-graphics-lost');
  // it does come back, late: the card was only for that, and goes
  await g(() => window.__lose.restoreContext());
  await page.waitForFunction(() => document.getElementById('error-overlay').hidden, null, { timeout: 20000, polling: 200 });
  check(!(await run.cardShown()) && !(await g(() => window.__game.view.renderer.getContext().isContextLost())), 'if the graphics come back after all, the card goes by itself');
  const f0 = await frameNo(page); await sleep(2500); const f1 = await frameNo(page);
  check(f1 - f0 >= 2, `...and the hotel draws again (${f1 - f0} frames in 2.5 s)`);
}

console.log('\n6. "turn sideways" or "make the window wider"');
{
  // (Chromium cannot say how a device is held: the page is given what an iPad's Safari gives, window.orientation 0
  // when upright and 90 when sideways, and screen.orientation as it is here, always "landscape-primary", which on
  // an upright iPad the page must not trust alone. 'computer': no window.orientation at all.)
  const held = o => page.evaluate(o => { if (o === 'computer') delete window.orientation; else Object.defineProperty(window, 'orientation', { configurable: true, get: () => o }); window.dispatchEvent(new Event('orientationchange')); }, o);
  const rot = () => page.evaluate(() => { const el = document.getElementById('rotate-overlay'); const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { shown: cs.display !== 'none', covers: !!hit && el.contains(hit), text: el.innerText.replace(/\s+/g, ' ').trim() }; });
  const tall = r => r.shown && r.covers && /Please turn your iPad sideways/.test(r.text) && !/reduce page zoom/.test(r.text);
  const wide = r => r.shown && r.covers && /Make this window wider, or reduce page zoom\./.test(r.text) && !/turn your iPad/.test(r.text);
  await held(0);
  for (const [w, h] of [[820, 1180], [768, 1024], [800, 800], [600, 900], [678, 834]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(250);
    const r = await rot();
    check(tall(r), `${w}x${h} (taller than wide, or square; the iPad held upright): "Please turn your iPad sideways" covers the game`);
    if (w === 820) await run.shot('6-turn-sideways');
  }
  await held(90);
  for (const [w, h] of [[900, 700], [860, 700], [700, 500], [500, 400]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(250);
    const r = await rot();
    check(wide(r), `${w}x${h} (wide but small): "Make this window wider, or reduce page zoom."`);
    if (w === 860) await run.shot('6-wider');
  }
  // Split View on an iPad held sideways: the window is narrow and tall, the iPad is already turned
  for (const [w, h] of [[678, 834], [438, 834], [1000, 1000], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(250);
    const r = await rot();
    check(wide(r), `${w}x${h} on an iPad held sideways (Split View): "Make this window wider", not "turn your iPad"`);
    if (w === 678) await run.shot('6-split-view');
  }
  await held('computer');
  for (const [w, h] of [[600, 900], [820, 1180]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(250);
    check(wide(await rot()), `${w}x${h} on a computer (a landscape screen, no window.orientation): "Make this window wider"`);
  }
  // two answers that disagree are not trusted: the iPad held upright, whatever screen.orientation says
  await held(0);
  await page.setViewportSize({ width: 820, height: 1180 }); await sleep(250);
  check(tall(await rot()) && await page.evaluate(() => /landscape/.test(screen.orientation.type) && !document.documentElement.classList.contains('device-landscape')), 'screen.orientation saying "landscape" while window.orientation says upright is not trusted: still "turn sideways"');
  await held(90);
  for (const [w, h] of [[901, 700], [1024, 694], [1024, 768], [1180, 820], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h }); await sleep(250);
    check(!(await rot()).shown, `${w}x${h}: no card`);
  }
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL RELIABILITY CHECKS PASSED');
await run.browser.close();
process.exit(failures.length ? 1 : 0);
