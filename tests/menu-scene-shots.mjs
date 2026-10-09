// Headless check + screenshots of the main-menu lobby background (src/menu/lobbyScene.js), through
// its standalone preview page tools/menu-preview.html. Dev only, not part of the game.
//
// Run from the repo root:   node tests/menu-scene-shots.mjs [--url http://127.0.0.1:8125/]
// (starts `python3 -m http.server 8125 --bind 127.0.0.1` itself if nothing is serving there)
//
// Shots go to tests/shots/menu/ (git-ignored):
//   calm-<size>-sharp.png / calm-<size>-blur.png    the idle tableau, 1024x768, 1366x1024, 1600x900
//   enter-<n>.png                                   frames through the 3-guest boarding (1366x1024)
//   practice-<n>.png                                the 1-guest boarding (1024x768)
//   reset.png                                       back to the calm tableau after a boarding
// Checks: no console errors, draw calls within budget, the boarding resolves in ~4.5-6 s for 1 and 3
// guests, reset() puts everyone back, and a rough frame time with the animation running.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8125/';
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(here, '..');
const outDir = path.join(here, 'shots', 'menu');
fs.mkdirSync(outDir, { recursive: true });
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const MAX_CALLS = 120;

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

// a static server, if none is running
let server = null;
async function reachable() { try { const r = await fetch(baseUrl + 'tools/menu-preview.html'); return r.ok; } catch { return false; } }
if (!(await reachable())) {
  const port = new URL(baseUrl).port || '8125';
  server = spawn('python3', ['-m', 'http.server', port, '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50 && !(await reachable()); i++) await new Promise(r => setTimeout(r, 100));
}

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const consoleMessages = [];
async function openPage(w, h, query) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true })).newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMessages.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleMessages.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => consoleMessages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.route(`${CDN}**`, route => {
    const rel = route.request().url().slice(CDN.length).split('?')[0];
    const file = path.join(threeDir, rel);
    route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
  });
  await page.goto(`${baseUrl}tools/menu-preview.html?controls=0&${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ready, null, { timeout: 120000 });
  return page;
}
const shot = (page, name) => page.screenshot({ path: path.join(outDir, `${name}.png`) });
const step = (page, s) => page.evaluate(s => window.__menu.step(s), s);
console.log('1. the calm tableau at iPad and desktop sizes');
const sizes = [[1024, 768], [1366, 1024], [1600, 900]];
let calls = 0, tris = 0;
for (const [w, h] of sizes) {
  for (const blur of [0, 1]) {
    const page = await openPage(w, h, `pause=1&blur=${blur}`);
    const s = await step(page, 6);
    calls = Math.max(calls, s.calls); tris = Math.max(tris, s.triangles);
    await page.waitForTimeout(blur ? 1200 : 50);   // let the CSS blur transition settle
    await shot(page, `calm-${w}x${h}-${blur ? 'blur' : 'sharp'}`);
    await page.close();
  }
}
check(calls > 0 && calls <= MAX_CALLS, `draw calls ${calls} (budget ${MAX_CALLS}), triangles ${tris}`);

console.log('\n2. the boarding (3 guests, Play) at 1366x1024');
{
  const page = await openPage(1366, 1024, 'pause=1');
  await step(page, 3);
  const before = await page.evaluate(() => [...window.__menu.lobby.debug.actors.values()].map(a => [a.name, +a.x.toFixed(3), +a.z.toFixed(3), +a.sitW.toFixed(2)]));
  const times = [0.4, 1.0, 1.8, 2.6, 3.4, 4.2, 4.9, 5.6];
  // screenshots are taken from node between simulation steps
  const run = page.evaluate(async times => {
    const m = window.__menu, L = m.lobby;
    let done = false;
    L.enter({ guests: 3 }).then(() => { done = true; });
    let t = 0, k = 0, resolvedAt = null;
    while (t < 9 && (resolvedAt == null || t < resolvedAt + 0.6)) {
      m.advance(1 / 30, 1 / 30); t += 1 / 30;
      await new Promise(r => setTimeout(r, 0));
      if (done && resolvedAt == null) resolvedAt = t;
      if (k < times.length && t >= times[k]) { m.step(0); window.__frame = k; k++; await new Promise(r => { window.__go = r; }); }
    }
    m.step(0);
    return { resolvedAt, stats: m.stats() };
  }, times);
  for (let k = 0; k < times.length; k++) {
    await page.waitForFunction(k => window.__frame === k && window.__go, k, { timeout: 60000 });
    await shot(page, `enter-${k}`);
    await page.evaluate(() => { const g = window.__go; window.__go = null; g(); });
  }
  const r = await run;
  await shot(page, 'enter-done');
  check(r.resolvedAt != null && r.resolvedAt >= 4.3 && r.resolvedAt <= 6.5, `enter({ guests: 3 }) resolved after ${r.resolvedAt?.toFixed(2)} s`);
  const inCar = await page.evaluate(() => {
    const A = window.__menu.lobby.debug.actors;
    return ['victor', 'clara', 'henry', 'manager'].map(n => A.get(n)).every(a => a.z < -6.0 && Math.abs(Math.atan2(Math.sin(a.heading), Math.cos(a.heading))) < 0.35);
  });
  check(inCar, 'the three guests and the manager are in the lift, facing out');
  calls = Math.max(calls, r.stats.calls);
  // reset: back to the tableau
  await page.evaluate(() => window.__menu.lobby.reset());
  const after = await page.evaluate(() => { window.__menu.step(0.05); return [...window.__menu.lobby.debug.actors.values()].map(a => [a.name, +a.x.toFixed(3), +a.z.toFixed(3), +a.sitW.toFixed(2)]); });
  const seatedBack = ['victor', 'clara', 'henry', 'marcus'].every(n => { const b = before.find(x => x[0] === n), a = after.find(x => x[0] === n); return Math.hypot(a[1] - b[1], a[2] - b[2]) < 0.02 && a[3] === 1; });
  check(seatedBack, 'reset() puts the boarded guests back on their seats');
  const doors = await page.evaluate(() => { const g = window.__menu.lobby.debug.set.group; let l; g.traverse(o => { if (o.name === 'lift-door-L') l = o; }); return l.position.x; });
  await step(page, 1.5);
  await shot(page, 'reset');
  check(Math.abs(doors - (3.2 - 1.3 / 4)) < 0.01, 'reset() closes the lift doors');
  await page.close();
}

console.log('\n3. practice (1 guest) at 1024x768');
{
  const page = await openPage(1024, 768, 'pause=1');
  await step(page, 3);
  const times = [1.2, 2.8, 3.8];
  const run = page.evaluate(async times => {
    const m = window.__menu, L = m.lobby;
    let done = false;
    L.enter({ guests: 1 }).then(() => { done = true; });
    let t = 0, k = 0, resolvedAt = null;
    while (t < 9 && (resolvedAt == null || t < resolvedAt + 0.3)) {
      m.advance(1 / 30, 1 / 30); t += 1 / 30;
      await new Promise(r => setTimeout(r, 0));
      if (done && resolvedAt == null) resolvedAt = t;
      if (k < times.length && t >= times[k]) { m.step(0); window.__frame = k; k++; await new Promise(r => { window.__go = r; }); }
    }
    const A = m.lobby.debug.actors;
    return { resolvedAt, boarded: ['victor', 'manager'].every(n => A.get(n).z < -6.0), stayed: ['clara', 'henry'].every(n => A.get(n).sitW === 1) };
  }, times);
  for (let k = 0; k < times.length; k++) {
    await page.waitForFunction(k => window.__frame === k && window.__go, k, { timeout: 60000 });
    await shot(page, `practice-${k}`);
    await page.evaluate(() => { const g = window.__go; window.__go = null; g(); });
  }
  const r = await run;
  check(r.resolvedAt != null && r.resolvedAt >= 4.0 && r.resolvedAt <= 6.5, `enter({ guests: 1 }) resolved after ${r.resolvedAt?.toFixed(2)} s`);
  check(r.boarded && r.stayed, 'only Victor boards with the manager; the others stay seated');
  await page.close();
}

console.log('\n4. running for real (rough headless frame time, software rendering)');
{
  const page = await openPage(1366, 1024, '');
  await page.waitForTimeout(1500);
  const perf = await page.evaluate(() => new Promise(res => {
    const ts = []; const f = t => { ts.push(t); if (ts.length < 90) requestAnimationFrame(f); else res(ts); }; requestAnimationFrame(f);
  }).then(ts => { const d = ts.slice(1).map((t, i) => t - ts[i]); d.sort((a, b) => a - b); return { median: d[d.length >> 1], p90: d[Math.floor(d.length * 0.9)], stats: window.__menu.stats() }; }));
  console.log(`  info  frame interval median ${perf.median.toFixed(1)} ms, p90 ${perf.p90.toFixed(1)} ms (SwiftShader CPU rendering, not an iPad figure); render() ${perf.stats.frameMs} ms`);
  check(perf.stats.calls <= MAX_CALLS, `draw calls while animating: ${perf.stats.calls}`);
  await page.close();
}

const errors = consoleMessages.filter(m => !/KHR_parallel_shader_compile|GPU stall due to ReadPixels|Automatic fallback to software WebGL/.test(m));
check(errors.length === 0, `no console errors or warnings${errors.length ? ':\n      ' + errors.slice(0, 8).join('\n      ') : ''}`);

await browser.close();
if (server) server.kill();
console.log(`\nShots in ${path.relative(root, outDir)}/`);
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
process.exit(failures.length ? 1 : 0);
