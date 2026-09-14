// A smooth, deterministic recording of the REAL game: the page's clock (rAF/performance.now) is
// faked and advanced 1/30 s per frame, a screenshot is taken per frame, and the frames are encoded
// to a webm in a second page with MediaRecorder. This removes the software renderer's frame-rate
// from the result: every frame is exactly 33 ms of game time, however long it took to render.
//   node tools/char-pipeline/record_smooth.mjs  -> tools/char-pipeline/victor-walk.webm (+ contact sheet)
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const W = 960, H = 672, FPS = 30, STEP = Math.round(1000 / FPS);
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
await context.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
const page = await context.newPage();
const errs = []; page.on('pageerror', e => errs.push(String(e)));
await page.clock.install({ time: new Date('2026-09-14T12:00:00Z') });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
// let the loader / first frames run under the fake clock
for (let i = 0; i < 12 && !(await page.evaluate(() => !!window.__game && !document.getElementById('btn-begin').disabled)); i++) await page.clock.runFor(200);
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin');
await page.clock.runFor(1500);
await page.evaluate(() => window.__game.rig.zoomBy(1.35));
await page.clock.runFor(400);
// wait for the model to be in the scene (fetch is real, not faked)
await page.waitForFunction(() => { const g = window.__game; return g.characters[g.state.activeIndex].debug().loaded; }, null, { timeout: 20000 });

const frames = [];
const tick = async (n) => { for (let i = 0; i < n; i++) { await page.clock.runFor(STEP); frames.push(await page.screenshot({ type: 'jpeg', quality: 82 })); } };
const goto = (dx, dz) => page.evaluate(([x, z]) => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] + x, c[1] + z); }, [dx, dz]);
const settled = () => page.evaluate(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; });
const walkUntilDone = async (max) => { for (let i = 0; i < max; i++) { await tick(1); if (await settled()) break; } };

await tick(30);                       // 1 s idle
await goto(2.2, 0.2); await walkUntilDone(150);   // walk right, stop
await tick(24);                       // settle
await goto(-1.8, 1.7); await walkUntilDone(200);  // long diagonal with a turn
await tick(24);
await goto(-1.8, -1.4); await walkUntilDone(150); // 180° turn
await tick(15);
await goto(0.4, -3.1); await walkUntilDone(200);  // toward the north door
await tick(30);                       // settle to idle
await page.evaluate(() => window.__game.moveToRoom('corridorE'));   // doorway crossing
await tick(20); await walkUntilDone(260); await tick(30);
console.log('frames:', frames.length, 'errors:', errs.length ? errs : 'none');
await page.close();

// ---- encode: paint frames on a canvas at FPS and record with MediaRecorder -------------------
const enc = await context.newPage();
await enc.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`);
const dataUrls = frames.map(b => 'data:image/jpeg;base64,' + b.toString('base64'));
const webmB64 = await enc.evaluate(async ({ urls, fps }) => {
  const c = document.getElementById('c'); const ctx = c.getContext('2d');
  const imgs = await Promise.all(urls.map(u => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.src = u; })));
  const stream = c.captureStream(0); const track = stream.getVideoTracks()[0];
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
  const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
  const done = new Promise(res => rec.onstop = res);
  rec.start();
  for (const im of imgs) { ctx.drawImage(im, 0, 0); if (track.requestFrame) track.requestFrame(); await new Promise(r => setTimeout(r, 1000 / fps)); }
  await new Promise(r => setTimeout(r, 300)); rec.stop(); await done;
  const blob = new Blob(chunks, { type: 'video/webm' }); const buf = await blob.arrayBuffer();
  let s = ''; const bytes = new Uint8Array(buf); for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, { urls: dataUrls, fps: FPS });
const out = path.join(HERE, 'victor-walk.webm');
fs.writeFileSync(out, Buffer.from(webmB64, 'base64'));
// contact sheet: every 15th frame
const sheetDir = path.join(HERE, 'shots', 'recframes'); fs.rmSync(sheetDir, { recursive: true, force: true }); fs.mkdirSync(sheetDir, { recursive: true });
frames.forEach((b, i) => { if (i % 15 === 0) fs.writeFileSync(path.join(sheetDir, `f${String(i).padStart(3, '0')}.jpg`), b); });
console.log('video:', out, fs.statSync(out).size, 'bytes;', (frames.length / FPS).toFixed(1), 's at', FPS, 'fps; contact frames in', sheetDir);
await browser.close();
