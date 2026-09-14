// Movement verification from the REAL game: short walks, a long walk, turns, a doorway crossing and
// consecutive commands. Samples every frame and checks:
//   - the walk phase advances by (distance travelled / stride)  -> no foot sliding by construction
//   - the walk weight rises while moving and settles to 0 within ~0.4 s after stopping
//   - the mesh group sits exactly on the authoritative mover position (no double movement)
//   - every command arrives (mover stops within reach of the target), no console errors
// Also records a webm of the whole run (rec/ -> tools/char-pipeline/victor-walk.webm).
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const recDir = path.join(HERE, 'rec'); fs.mkdirSync(recDir, { recursive: true });

const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
// A smaller viewport keeps the software renderer's frame rate up (the check reports the fps it got).
const VW = 900, VH = 630;
const context = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 1, hasTouch: true, recordVideo: { dir: recDir, size: { width: VW, height: VH } } });
const framesDir = path.join(HERE, 'shots', 'walkframes'); fs.mkdirSync(framesDir, { recursive: true });
let frameNo = 0;
const grab = async () => { await page.screenshot({ path: path.join(framesDir, `f${String(frameNo++).padStart(2, '0')}.png`) }); };
const page = await context.newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 20000 });
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin'); await page.waitForTimeout(1200);
await page.evaluate(() => window.__game.rig.zoomBy(1.3)); await page.waitForTimeout(300);

// Per-frame sampler installed in the page.
await page.evaluate(() => {
  const g = window.__game; const cv = g.characters[g.state.activeIndex]; const m = g.activeMover();
  window.__samples = []; let last = null;
  const tick = () => {
    const d = cv.debug();
    const s = { t: performance.now() / 1000, x: m.x, z: m.z, heading: m.heading, walking: m.walking, w: d.walkW, phase: d.walkPhase, gx: cv.group.position.x, gz: cv.group.position.z, stride: d.strideLength, loaded: d.loaded };
    window.__samples.push(s); last = s; requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const walk = async (dx, dz, label, frames = 0) => {
  await page.evaluate(([x, z]) => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] + x, c[1] + z); }, [dx, dz]);
  for (let i = 0; i < frames; i++) { await page.waitForTimeout(350); await grab(); }   // mid-walk frames to inspect
  await page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);  // let the idle settle (measured below)
  const m = await page.evaluate(([x, z]) => { const c = window.__game.roomCenter('hall'); const m = window.__game.activeMover(); return { dist: Math.hypot(m.x - (c[0] + x), m.z - (c[1] + z)) }; }, [dx, dz]);
  console.log(`walk ${label}: stopped ${m.dist.toFixed(2)} m from target`);
};
await page.waitForTimeout(800);                       // idle first
await walk(0.6, 0.0, 'short (0.6 m)');
await walk(0.6, 0.9, 'short turn (90°)');
await walk(-2.2, 1.6, 'long diagonal', 6);
await walk(-2.2, -1.6, 'reverse (180° turn)');
await walk(2.2, -1.6, 'across');
// consecutive commands: issue a new target mid-walk
await page.evaluate(() => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] - 2.0, c[1] + 1.2); });
await page.waitForTimeout(500);
await walk(0, 0, 'interrupt + return to centre');
// doorway crossing (scripted move through the north door, as the tests do)
const door = 'corridorE';   // adjacent to the hall (the browser test crosses this door too)
await page.evaluate(id => window.__game.moveToRoom(id), door);
await page.waitForTimeout(400);
for (let i = 0; i < 4; i++) { await page.waitForTimeout(400); await grab(); }
await page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log('doorway crossing to', door, '-> room now', await page.evaluate(() => window.__game.activePlayer().currentRoom));

const samples = await page.evaluate(() => window.__samples);
await context.close();
const vp = await page.video().path();
const outVideo = path.join(HERE, 'victor-walk.webm'); fs.copyFileSync(vp, outVideo);
await browser.close();

// ---- analysis ------------------------------------------------------------------------------
const loaded = samples.filter(s => s.loaded);
const stride = loaded.length ? loaded[loaded.length - 1].stride : NaN;
let maxPhaseErr = 0, moving = 0, maxGroupErr = 0, badWeightWhileMoving = 0;
for (let i = 1; i < loaded.length; i++) {
  const a = loaded[i - 1], b = loaded[i];
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  let dphase = b.phase - a.phase; if (dphase < -0.5) dphase += 1;
  if (dist > 0 && dist < stride * 0.5) { moving++; maxPhaseErr = Math.max(maxPhaseErr, Math.abs(dphase - dist / stride)); if (b.w < 0.5 && moving > 20) badWeightWhileMoving++; }
  maxGroupErr = Math.max(maxGroupErr, Math.hypot(b.gx - b.x, b.gz - b.z));
}
// settle time: after each walking->stopped transition, frames until w < 0.05
const settles = [];
for (let i = 1; i < loaded.length; i++) {
  if (loaded[i - 1].walking && !loaded[i].walking) {
    const t0 = loaded[i].t; const j = loaded.findIndex((s, k) => k > i && s.w < 0.05);
    if (j > 0) settles.push(loaded[j].t - t0);
  }
}
const fps = loaded.length > 1 ? (loaded.length - 1) / (loaded[loaded.length - 1].t - loaded[0].t) : 0;
console.log(JSON.stringify({
  frames: samples.length, modelLoadedFrames: loaded.length, headlessFps: +fps.toFixed(1), strideInUse: stride,
  movingFrames: moving, maxPhaseVsDistanceError: +maxPhaseErr.toFixed(4),
  maxMeshVsMoverOffset_m: +maxGroupErr.toFixed(4), weightLowWhileMovingFrames: badWeightWhileMoving,
  settleSeconds: settles.map(s => +s.toFixed(2)), video: outVideo, errors: errs.length ? errs : 'none',
}, null, 1));
