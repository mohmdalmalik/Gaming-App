// In-game evidence capture from the REAL game page (headless Chromium / SwiftShader).
//
//   node tools/char-pipeline/capture.mjs --out tools/char-pipeline/shots/baseline \
//        --w 1194 --h 834 --dpr 2 --rot 4 [--zoom 1.0] [--walk 2.2,1.6] [--hand] [--map] [--noui]
//
// Produces <out>-r<i>.png for each camera rotation (plus <out>-r<i>-crop.png zoomed on Victor),
// optional <out>-hand.png / <out>-map.png, and <out>.json with the viewport (CSS px), dpr and errors.
// Viewport is CSS pixels; screenshot pixel size = viewport × dpr.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

const argv = process.argv.slice(2);
// --flag value | --flag (boolean, also when it is the last argument)
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  if (i < 0) return d;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const W = +opt('w', 1194), H = +opt('h', 834), DPR = +opt('dpr', 2), ROT = +opt('rot', 1), ZOOM = +opt('zoom', 1);
const OUT = String(opt('out', path.join(HERE, 'shots', 'shot')));
const WALK = opt('walk', null); const HAND = !!opt('hand', false); const MAP = !!opt('map', false); const NOUI = !!opt('noui', false);
const STILL = !!opt('still', false);   // freeze CSS animations/transitions so overlays are captured in their final state
const URL = String(opt('url', 'http://127.0.0.1:8123/'));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, hasTouch: true })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
page.on('requestfailed', r => errs.push('request failed: ' + r.url()));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 20000 });
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin');
await page.waitForTimeout(1600);
if (ZOOM !== 1) { await page.evaluate(z => window.__game.rig.zoomBy(z), ZOOM); await page.waitForTimeout(400); }
if (NOUI) await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
if (STILL) await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; }' });

const settled = () => page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 12000 }).catch(() => {});
if (WALK) {
  const [dx, dz] = String(WALK).split(',').map(Number);
  await page.evaluate(([x, z]) => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] + x, c[1] + z); }, [dx, dz]);
  await settled(); await page.waitForTimeout(300);
}

// Crop box around Victor (the active mover) from his ground position projected to the screen.
async function cropBox() {
  const p = await page.evaluate(() => {
    const m = window.__game.activeMover();
    const r = window.__game.groundToScreen(m.x, m.z);
    return Array.isArray(r) ? { x: r[0], y: r[1] } : { x: r.x, y: r.y };
  });
  const w = 260, h = 340;                     // CSS px around the feet point, biased upward
  return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.78), width: w, height: h };
}

const files = [];
for (let i = 0; i < ROT; i++) {
  const f = `${OUT}-r${i}.png`; await page.screenshot({ path: f }); files.push(f);
  try { const c = await cropBox(); const fc = `${OUT}-r${i}-crop.png`; await page.screenshot({ path: fc, clip: c }); files.push(fc); } catch (e) { errs.push('crop: ' + e.message); }
  if (i < ROT - 1) { await page.evaluate(() => window.__game.rotate(1)); await page.waitForTimeout(700); }
}
if (HAND) { await page.evaluate(() => window.__game.openHand()); await page.waitForTimeout(400); const f = `${OUT}-hand.png`; await page.screenshot({ path: f }); files.push(f); await page.tap('#btn-hand-close'); await page.waitForTimeout(200); }
if (MAP) { await page.evaluate(() => window.__game.toggleMap()); await page.waitForTimeout(400); const f = `${OUT}-map.png`; await page.screenshot({ path: f }); files.push(f); await page.evaluate(() => window.__game.toggleMap()); }

const meta = { viewportCss: { width: W, height: H }, dpr: DPR, screenshotPx: { width: W * DPR, height: H * DPR }, zoom: ZOOM, rotations: ROT, walk: WALK, files, errors: errs };
fs.writeFileSync(`${OUT}.json`, JSON.stringify(meta, null, 2));
console.log(JSON.stringify({ viewportCss: meta.viewportCss, dpr: DPR, files: files.length, errors: errs.length ? errs : 'none' }));
await browser.close();
