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
// guests, reset() puts everyone back, the floor dial's marks and where its needle comes to rest, the wall
// clock's clearance from the pilasters, and a rough frame time with the animation running.
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

console.log('\n4. the floor dial over the lift, and the wall clock between the pilasters');
{
  const page = await openPage(1024, 694, 'pause=1');
  await step(page, 2);
  const d = await page.evaluate(() => {
    const m = window.__menu, L = m.lobby, lay = L.debug.layout, lift = lay.lift;
    const named = n => { let f; L.debug.set.group.traverse(o => { if (o.name === n) f = o; }); return f; };
    const needle = named('lift-needle'), dial = named('lift-dial');
    return { marks: lift.dial, floors: lift.floors, destination: lift.destination, rest: needle.rotation.z, map: [dial.material.map.image.width, dial.material.map.image.height] };
  });
  const nums = d.marks.slice(1).map(Number);
  check(d.marks[0] === 'L' && nums.every((n, i) => Number.isInteger(n) && (i === 0 || n > nums[i - 1])), `the dial's marks start at L and climb: ${d.marks.join(' ')}`);
  check(nums.at(-1) >= 20, `the dial reaches ${nums.at(-1)} or more (a tall hotel)`);
  check(!d.marks.some(t => /13/.test(t)) && !nums.includes(13), 'no mark of the dial shows the unlucky floor');
  const at12 = d.marks.indexOf('12'), at14 = d.marks.indexOf('14');
  check(at12 > 0 && at14 === at12 + 1 && d.destination === at12 + 0.5 && d.floors === d.marks.length - 1, `the needle's resting place (${d.destination} steps from L) is the gap between the 12 and the 14`);
  check(Math.abs(d.rest - Math.PI / 2) < 1e-6, 'at rest in the calm tableau the needle points at L');
  check(d.map[0] <= 512 && d.map[1] <= 512, `the dial's picture stays small (${d.map.join(' x ')} px)`);
  // the boarding: after the doors shut the needle swings round and stops in that gap
  await page.evaluate(() => window.__menu.enter(3));
  await page.evaluate(() => { const m = window.__menu; for (let t = 0; t < 12; t += 1 / 30) m.advance(1 / 30, 1 / 30); });
  const end = await page.evaluate(() => { const m = window.__menu; m.step(0); let n; m.lobby.debug.set.group.traverse(o => { if (o.name === 'lift-needle') n = o; }); return n.rotation.z; });
  const want = Math.PI / 2 - (d.destination / d.floors) * Math.PI;
  check(Math.abs(end - want) < 0.01, `after the doors shut the needle rests at ${(want * 180 / Math.PI).toFixed(1)} degrees, between the 12 and the 14 (${(end * 180 / Math.PI).toFixed(1)})`);
  await page.evaluate(() => window.__menu.lobby.reset());
  const back = await page.evaluate(() => { window.__menu.step(0); let n; window.__menu.lobby.debug.set.group.traverse(o => { if (o.name === 'lift-needle') n = o; }); return n.rotation.z; });
  check(Math.abs(back - Math.PI / 2) < 1e-6, 'reset() brings the needle back to L');
  // the clock: centred between its two pilasters, off the brass frieze, and a clear gap to each pilaster on screen
  // from the idle camera and all the way through the camera's push toward the lift (1024x694, the shortest iPad view)
  const c = await page.evaluate(() => {
    const m = window.__menu, L = m.lobby, lay = L.debug.layout, cam = L.camera, V = cam.position.constructor;
    const ck = lay.reception.clock, z = lay.room.z0, b = ck.burst;
    const pl = Math.max(...lay.pilasters.filter(p => p < ck.x)), pr = Math.min(...lay.pilasters.filter(p => p > ck.x));
    const pts = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 11 - 0.5) * Math.PI * 0.9, cx = ck.x + Math.sin(a) * (ck.r + b.gap), cy = ck.y + Math.cos(a) * (ck.r + b.gap);
      for (const [dx, dy] of [[-0.0175, -b.len / 2], [0.0175, -b.len / 2], [-0.0175, b.len / 2], [0.0175, b.len / 2]]) pts.push([cx + dx * Math.cos(a) + dy * Math.sin(a), cy - dx * Math.sin(a) + dy * Math.cos(a)]);
    }
    const x0 = Math.min(...pts.map(p => p[0]), ck.x - ck.r - 0.07), x1 = Math.max(...pts.map(p => p[0]), ck.x + ck.r + 0.07);
    const sx = (x, y, zz) => { const v = new V(x, y, zz).project(cam); return (v.x + 1) / 2 * innerWidth; };
    const gaps = [];
    const sample = () => {
      m.step(0);
      const left = sx(pl + 0.3, ck.y, z + 0.2), right = sx(pr - 0.3, ck.y, z + 0.2);
      const cl = Math.min(...pts.map(p => sx(p[0], p[1], z + 0.1))), cr = Math.max(...pts.map(p => sx(p[0], p[1], z + 0.1)));
      const face = sx(ck.x + ck.r, ck.y, z + 0.1) - sx(ck.x - ck.r, ck.y, z + 0.1);
      gaps.push({ l: (cl - left) / face, r: (right - cr) / face, offL: cl < 0, offR: cr > innerWidth });
    };
    for (let t = 0; t < 46; t += 4.6) { m.advance(4.6, 0.1); sample(); }
    m.lobby.reset(); L.enter({ guests: 3 });
    for (let t = 0, next = 0.9; t < 9; t += 1 / 30) { m.advance(1 / 30, 1 / 30); if (t >= next) { sample(); next += 0.9; } }
    return { pl, pr, x: ck.x, x0, x1, bottom: ck.y - ck.r - 0.07, frieze: lay.room.panelTop + 0.12, gaps };
  });
  const mid = (c.pl + c.pr) / 2;
  check(Math.abs(c.x - mid) < 0.03, `the clock is centred between its two pilasters (${c.x} against ${mid})`);
  check(c.x0 - (c.pl + 0.3) >= 0.6 && (c.pr - 0.3) - c.x1 >= 0.6, `its sunburst stands ${(c.x0 - (c.pl + 0.3)).toFixed(2)} m and ${((c.pr - 0.3) - c.x1).toFixed(2)} m from the pilasters (at least 0.6)`);
  check(c.bottom >= c.frieze + 0.1, `its brass rim clears the frieze below it by ${(c.bottom - c.frieze).toFixed(2)} m`);
  const seen = c.gaps.filter(g => !g.offL && !g.offR), minL = Math.min(...seen.map(g => g.l)), minR = Math.min(...seen.map(g => g.r));
  check(seen.length >= 10 && minL >= 0.7 && minR >= 0.7, `on screen (idle drift and the push-in, ${seen.length} looks) it keeps a gap of ${minL.toFixed(2)} and ${minR.toFixed(2)} clock faces to the pilasters (at least 0.7)`);
  await page.close();
}

console.log('\n5. running for real (rough headless frame time, software rendering)');
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
