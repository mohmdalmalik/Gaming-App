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
//   dial-end.png                                    close-up of the lift's floor dial as the doors have shut (the
//                                                   moment the game starts its fade to black), needle at rest (1024x694)
// Checks: no console errors, draw calls within budget, the boarding resolves in ~4.5-6 s for 1 and 3
// guests, reset() puts everyone back, the floor dial (its marks, their one sweep under a half circle, every
// mark clear of the base, the other marks, the ticks and the rim, the sunburst mirrored about straight up,
// the needle on the hub pointing exactly at each mark, and where and when it comes to rest: on L until the
// doors start to close, then smoothly into the 12/14 gap by the time they have shut, when enter() resolves,
// and still there 0.65 s later, at the end of the game's fade), the wall clock's clearance from the
// pilasters, and a rough frame time with the animation running.
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
    let done = false, needleAt = null;
    // (where the needle is the moment enter() resolves, against the middle of the 12 and the 14 as drawn on the dial)
    let nd, dial; L.debug.set.group.traverse(o => { if (o.name === 'lift-needle') nd = o; if (o.name === 'lift-dial') dial = o; });
    const dm = dial.material.map.userData.dial.marks, gap = (dm.find(k => k.label === '12').angle + dm.find(k => k.label === '14').angle) / 2;
    L.enter({ guests: 3 }).then(() => { done = true; needleAt = nd.rotation.z; });
    let t = 0, k = 0, resolvedAt = null;
    while (t < 9 && (resolvedAt == null || t < resolvedAt + 0.6)) {
      m.advance(1 / 30, 1 / 30); t += 1 / 30;
      await new Promise(r => setTimeout(r, 0));
      if (done && resolvedAt == null) resolvedAt = t;
      if (k < times.length && t >= times[k]) { m.step(0); window.__frame = k; k++; await new Promise(r => { window.__go = r; }); }
    }
    m.step(0);
    return { resolvedAt, stats: m.stats(), needleAt, gap };
  }, times);
  for (let k = 0; k < times.length; k++) {
    await page.waitForFunction(k => window.__frame === k && window.__go, k, { timeout: 60000 });
    await shot(page, `enter-${k}`);
    await page.evaluate(() => { const g = window.__go; window.__go = null; g(); });
  }
  const r = await run;
  await shot(page, 'enter-done');
  check(r.resolvedAt != null && r.resolvedAt >= 4.3 && r.resolvedAt <= 6.5, `enter({ guests: 3 }) resolved after ${r.resolvedAt?.toFixed(2)} s`);
  const D = x => x * 180 / Math.PI;
  check(r.needleAt != null && Math.abs(D(r.needleAt - r.gap)) < 0.5, `...and as it resolves (the doors shut, the game's fade begins) the dial's needle rests in the 12/14 gap (${D(r.needleAt ?? NaN).toFixed(2)} degrees, the gap ${D(r.gap).toFixed(2)})`);
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
    let done = false, needleAt = null;
    let nd, dial; L.debug.set.group.traverse(o => { if (o.name === 'lift-needle') nd = o; if (o.name === 'lift-dial') dial = o; });
    const dm = dial.material.map.userData.dial.marks, gap = (dm.find(k => k.label === '12').angle + dm.find(k => k.label === '14').angle) / 2;
    L.enter({ guests: 1 }).then(() => { done = true; needleAt = nd.rotation.z; });
    let t = 0, k = 0, resolvedAt = null;
    while (t < 9 && (resolvedAt == null || t < resolvedAt + 0.3)) {
      m.advance(1 / 30, 1 / 30); t += 1 / 30;
      await new Promise(r => setTimeout(r, 0));
      if (done && resolvedAt == null) resolvedAt = t;
      if (k < times.length && t >= times[k]) { m.step(0); window.__frame = k; k++; await new Promise(r => { window.__go = r; }); }
    }
    const A = m.lobby.debug.actors;
    return { resolvedAt, needleAt, gap, boarded: ['victor', 'manager'].every(n => A.get(n).z < -6.0), stayed: ['clara', 'henry'].every(n => A.get(n).sitW === 1) };
  }, times);
  for (let k = 0; k < times.length; k++) {
    await page.waitForFunction(k => window.__frame === k && window.__go, k, { timeout: 60000 });
    await shot(page, `practice-${k}`);
    await page.evaluate(() => { const g = window.__go; window.__go = null; g(); });
  }
  const r = await run;
  check(r.resolvedAt != null && r.resolvedAt >= 4.0 && r.resolvedAt <= 6.5, `enter({ guests: 1 }) resolved after ${r.resolvedAt?.toFixed(2)} s`);
  const D = x => x * 180 / Math.PI;
  check(r.needleAt != null && Math.abs(D(r.needleAt - r.gap)) < 0.5, `...and as it resolves the dial's needle rests in the 12/14 gap (${D(r.needleAt ?? NaN).toFixed(2)} degrees, the gap ${D(r.gap).toFixed(2)})`);
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
    // the needle's pivot and tip against the hub and the ring of ticks drawn on the dial (design px, y down)
    dial.geometry.computeBoundingBox(); needle.geometry.computeBoundingBox();
    const pb = dial.geometry.boundingBox, plateW = pb.max.x - pb.min.x, plateH = pb.max.y - pb.min.y;
    const drawn = dial.material.map.userData.dial, map = dial.material.map.image;
    const perPx = plateW / drawn.w;   // metres per design px
    const hubX = dial.position.x - plateW / 2 + drawn.hub[0] * perPx, hubY = dial.position.y + plateH / 2 - drawn.hub[1] * perPx;
    // the needle turned to every mark, then back to L
    const pointsAt = [];
    for (let f = 0; f <= lift.floors; f++) { L.debug.set.lift.setFloor(f); pointsAt.push(needle.rotation.z); }
    L.debug.set.lift.setFloor(0);
    return { marks: lift.dial, sweep: lift.dialSweep, floors: lift.floors, destination: lift.destination, rest: needle.rotation.z, map: [map.width, map.height], drawn, pointsAt,
      pivotOff: Math.hypot(needle.position.x - hubX, needle.position.y - hubY) / perPx, tip: needle.geometry.boundingBox.max.y / perPx };
  });
  const nums = d.marks.slice(1).map(Number);
  check(d.marks[0] === 'L' && nums.every((n, i) => Number.isInteger(n) && (i === 0 || n > nums[i - 1])), `the dial's marks start at L and climb: ${d.marks.join(' ')}`);
  check(nums.at(-1) >= 20, `the dial reaches ${nums.at(-1)} or more (a tall hotel)`);
  check(!d.marks.some(t => /13/.test(t)) && !nums.includes(13), 'no mark of the dial shows the unlucky floor');
  const at12 = d.marks.indexOf('12'), at14 = d.marks.indexOf('14');
  check(at12 > 0 && at14 === at12 + 1 && d.destination === at12 + 0.5 && d.floors === d.marks.length - 1, `the needle's resting place (${d.destination} steps from L) is the gap between the 12 and the 14`);
  check(d.map[0] <= 512 && d.map[1] <= 512, `the dial's picture stays small (${d.map.join(' x ')} px)`);
  // the face: one sweep (lift.dialSweep) under a half circle, the marks drawn evenly along it, every mark clear
  const dr = d.drawn, deg = r => r * 180 / Math.PI, A = dr.marks.map(k => k.angle);
  check(dr.marks.map(k => k.label).join() === d.marks.join() && dr.sweep === d.sweep, 'the dial is drawn with the layout\'s marks and sweep');
  check(d.sweep > 90 && d.sweep < 180 && Math.abs(deg(A[0]) - d.sweep / 2) < 1e-6 && Math.abs(deg(A.at(-1)) + d.sweep / 2) < 1e-6, `the marks sweep ${d.sweep} degrees, L at ${deg(A[0]).toFixed(1)} and ${d.marks.at(-1)} at ${deg(A.at(-1)).toFixed(1)} from straight up (less than a half circle)`);
  const steps = A.slice(1).map((a, i) => A[i] - a);
  check(steps.every(x => Math.abs(x - steps[0]) < 1e-9), `the marks stand evenly, ${deg(steps[0]).toFixed(1)} degrees apart`);
  const [hx, hy] = dr.hub, centre = b => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const offLine = Math.max(...dr.marks.map(k => { const [x, y] = centre(k.box); return Math.abs(deg(Math.atan2(hx - x, hy - y) - k.angle)); }));
  check(offLine < 0.5, `every mark stands on the line from the hub through its tick (at most ${offLine.toFixed(2)} degrees off)`);
  const lowest = Math.min(...dr.marks.map(k => dr.baseTop - k.box[3]));
  check(dr.baseTop - dr.marks[0].box[3] >= 8 && dr.baseTop - dr.marks.at(-1).box[3] >= 8 && lowest >= 8, `L and ${d.marks.at(-1)} sit above the dial's base (L ${(dr.baseTop - dr.marks[0].box[3]).toFixed(1)}, ${d.marks.at(-1)} ${(dr.baseTop - dr.marks.at(-1).box[3]).toFixed(1)} design px; at least 8)`);
  const gap = (p, q) => Math.max(q[0] - p[2], p[0] - q[2], q[1] - p[3], p[1] - q[3]);
  let markGap = Infinity, tickGap = Infinity, rimGap = Infinity;
  dr.marks.forEach((k, i) => {
    dr.marks.forEach((o, j) => { if (j > i) markGap = Math.min(markGap, gap(k.box, o.box)); });
    for (const t of dr.ticks) tickGap = Math.min(tickGap, gap(k.box, t));
    const [x0, y0, x1, y1] = k.box;
    rimGap = Math.min(rimGap, dr.face - Math.hypot(Math.max(Math.abs(x0 - hx), Math.abs(x1 - hx)), Math.max(Math.abs(y0 - hy), Math.abs(y1 - hy))));
  });
  check(markGap >= 2 && tickGap >= 2 && rimGap >= 2, `no mark touches another (${markGap.toFixed(1)}), a tick (${tickGap.toFixed(1)}) or the rim (${rimGap.toFixed(1)} design px; at least 2, x 1.5 on the ${d.map.join(' x ')} picture), marks at ${dr.size}px`);
  // the needle: on the hub, its arrow on the ring of ticks, pointing exactly at each mark
  check(d.pivotOff < 0.5 && d.tip > dr.tickRing[0] && d.tip < dr.tickRing[1], `the needle turns on the hub (${d.pivotOff.toFixed(2)} design px off) and its tip ends on the ring of ticks (${d.tip.toFixed(1)}, ring ${dr.tickRing.join('-')})`);
  const aim = Math.max(...d.pointsAt.map((r, i) => Math.abs(r - A[i])));
  check(aim < 1e-6, `turned to each floor, the needle points exactly at its mark (at most ${deg(aim).toExponential(1)} degrees off)`);
  check(Math.abs(d.rest - A[0]) < 1e-6, `at rest in the calm tableau the needle points at L (${deg(d.rest).toFixed(1)} degrees)`);
  // the sunburst: its wedges mirror about straight up, from the drawing's own record and from the picture's pixels (each
  // pixel round the hub against its mirror image across the hub's upright line; the hub is the canvas's middle column)
  const sh = dr.shade || [];
  const mirrored = sh.length >= 3 && sh.every(([a0, a1]) => sh.some(([b0, b1]) => Math.abs(b0 + a1) < 1e-9 && Math.abs(b1 + a0) < 1e-9));
  check(mirrored, `the sunburst's ${sh.length} wedges mirror about straight up (${sh.map(([a, b]) => `${deg(a).toFixed(1)}..${deg(b).toFixed(1)}`).join(', ')} degrees)`);
  const px = await page.evaluate(() => {
    const L = window.__menu.lobby; let p; L.debug.set.group.traverse(o => { if (o.name === 'lift-dial') p = o; });
    const cv = p.material.map.image, dr = p.material.map.userData.dial, K = cv.width / dr.w;
    const img = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, W = cv.width;
    const [hx, hy] = dr.hub.map(v => v * K), r0 = (11 + 3) * K, r1 = ((dr.shadeR ?? dr.tickRing[0] - 6) - 3) * K;   // (inside the hub's ring and the wedges' tips)
    let n = 0, off = 0, deep = 0;
    for (let y = 0; y < hy - 3 * K; y++) for (let x = 0; x < W; x++) {
      const r = Math.hypot(x + 0.5 - hx, y + 0.5 - hy);
      if (r < r0 || r > r1) continue;
      const i = (y * W + x) * 4, j = (y * W + (W - 1 - x)) * 4;
      n++;
      if (Math.abs(img[i] - img[j]) + Math.abs(img[i + 1] - img[j + 1]) + Math.abs(img[i + 2] - img[j + 2]) > 24) off++;
      if (img[i + 2] < (194 + 170) / 2) deep++;   // (blue: cream 194, the deeper shade 170)
    }
    return { mid: hx === W / 2, n, off: off / n, deep: deep / n };
  });
  check(px.mid && px.off < 0.01 && px.deep > 0.2 && px.deep < 0.6, `...and on the dial's picture: ${(px.deep * 100).toFixed(0)}% of the face round the hub is shaded, and ${(px.off * 100).toFixed(2)}% of it differs from its mirror image (under 1%)`);
  // the boarding: the needle stays on L while the doors are open, leaves it as they start to close and, eased in and out,
  // comes to rest in that gap by the time they have shut, the moment enter() resolves: the game starts its 650 ms fade to
  // black then (src/main.js enterGame), so it is seen resting there. (This used to look only 12 s later, long after the
  // screen had gone black, and passed while the owner saw the needle still on L as the screen faded.)
  const nr = await page.evaluate(async () => {
    const m = window.__menu, L = m.lobby; let n; L.debug.set.group.traverse(o => { if (o.name === 'lift-needle') n = o; });
    let atResolve = null, t = 0;
    L.enter({ guests: 3 }).then(() => { atResolve = { t, a: n.rotation.z, shutAt: L.debug.seq.shutAt }; });
    const series = [];
    while (t < 12 && !atResolve) {
      m.advance(1 / 30, 1 / 30); t += 1 / 30;
      series.push({ t, a: n.rotation.z, closeAt: L.debug.seq.closeAt });
      await new Promise(r => setTimeout(r, 0));
    }
    m.step(0);
    return { atResolve, series, closeAt: L.debug.seq.closeAt };
  });
  const clip = await page.evaluate(() => {   // the dial plate's box on screen, a little padded
    const L = window.__menu.lobby; let p; L.debug.set.group.traverse(o => { if (o.name === 'lift-dial') p = o; });
    p.geometry.computeBoundingBox(); const b = p.geometry.boundingBox, V = b.min.constructor;
    const s = [[b.min.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y], [b.max.x, b.min.y]].map(([x, y]) => new V(x, y, 0).applyMatrix4(p.matrixWorld).project(L.camera)).map(v => [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]);
    const x0 = Math.min(...s.map(q => q[0])), x1 = Math.max(...s.map(q => q[0])), y0 = Math.min(...s.map(q => q[1])), y1 = Math.max(...s.map(q => q[1])), pad = 0.1 * (x1 - x0);
    const x = Math.max(0, x0 - pad), y = Math.max(0, y0 - pad);
    return { x, y, width: Math.min(innerWidth, x1 + pad) - x, height: Math.min(innerHeight, y1 + pad) - y };
  });
  await page.screenshot({ path: path.join(outDir, 'dial-end.png'), clip });
  const needleNow = () => page.evaluate(() => { let n; window.__menu.lobby.debug.set.group.traverse(o => { if (o.name === 'lift-needle') n = o; }); return n.rotation.z; });
  await page.evaluate(() => { const m = window.__menu; for (let k = 0; k < 20; k++) m.advance(1 / 30, 1 / 30); });   // (0.65 s: the end of the fade)
  const fadeEnd = await needleNow();
  await page.evaluate(() => { const m = window.__menu; for (let t = 0; t < 12; t += 1 / 30) m.advance(1 / 30, 1 / 30); });
  const end = await needleNow();
  const want = (A[at12] + A[at14]) / 2, ser = nr.series, res = nr.atResolve;
  const open = ser.filter(x => x.closeAt == null || x.t <= x.closeAt + 1e-9), moving = ser.slice(open.length);
  const ds = moving.map((x, i) => (i ? moving[i - 1].a : open.at(-1).a) - x.a);   // (each frame's turn, toward the 20)
  const moved = ds.filter(d => Math.abs(d) > 1e-9), landed = ser.find(x => Math.abs(x.a - want) < 1e-9);
  check(open.length > 0 && open.every(x => Math.abs(x.a - A[0]) < 1e-9), `while the doors are open (${open.at(-1)?.t.toFixed(2)} s) the needle stays on L`);
  check(moved.length >= 10 && ds.every(d => d >= -1e-9) && deg(Math.max(...ds)) <= 8 && deg(moved[0]) < 1.5 && deg(moved.at(-1)) < 1.5,
    `as they close it climbs smoothly over ${moved.length} frames, never back, at most ${deg(Math.max(...ds)).toFixed(1)} degrees a frame (1/30 s), easing in (${deg(moved[0]).toFixed(2)}) and out (${deg(moved.at(-1)).toFixed(2)})`);
  check(res != null && landed && landed.t <= res.shutAt + 1e-9, `it lands in the gap at ${landed?.t.toFixed(2)} s, no later than the doors shut (${res?.shutAt?.toFixed(2)} s)`);
  check(res != null && Math.abs(deg(res.a - want)) < 0.5, `the moment enter() resolves (${res?.t.toFixed(2)} s; the game's fade to black starts) the needle rests at ${deg(res?.a ?? NaN).toFixed(2)} degrees, halfway between the 12 and the 14 (${deg(want).toFixed(1)})`);
  check(Math.abs(deg(fadeEnd - want)) < 0.5, `...and 0.65 s later, at the end of the fade, it is still there (${deg(fadeEnd).toFixed(2)} degrees)`);
  check(Math.abs(end - want) < 0.01, `long after the doors shut it still rests at ${deg(want).toFixed(1)} degrees (${deg(end).toFixed(1)})`);
  await page.evaluate(() => window.__menu.lobby.reset());
  const back = await page.evaluate(() => { window.__menu.step(0); let n; window.__menu.lobby.debug.set.group.traverse(o => { if (o.name === 'lift-needle') n = o; }); return n.rotation.z; });
  check(Math.abs(back - A[0]) < 1e-6, 'reset() brings the needle back to L');
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
