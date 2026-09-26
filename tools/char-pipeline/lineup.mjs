// All six guests side by side in the REAL game (hot-seat, lobby, hotel lighting), for checking the
// models against each other and under the game's light.
//   node tools/char-pipeline/lineup.mjs [out.png] [--zoom 1.8] [--rot 0..3]
// Needs the static server on :8123 (see README). Writes the full screenshot and a crop on the guests.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : path.join(HERE, 'shots', 'lineup.png');
const ZOOM = +opt('zoom', 1.8), ROT = +opt('rot', 0);
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/?mode=hotseat&players=6&seed=4242', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000 });
await page.click('#btn-begin');
for (let i = 0; i < 20; i++) {
  if (await page.evaluate(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) break;
  if (await page.evaluate(() => window.__game.handoffOpen())) await page.click('#btn-handoff-next');
  await page.waitForTimeout(150);
}
// every guest's model loaded, then line them up facing the camera
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(({ ROT, ZOOM }) => {
  const g = window.__game;
  g.rotate(ROT);
  g.movers.forEach((m, i) => { m.reset(-2.5 + i * 1.0, 1.2); });
  g.refresh(); g.rig.setFocus(0, 1.2, true);
}, { ROT, ZOOM });
await page.waitForTimeout(800);
await page.evaluate(z => window.__game.rig && window.__game.rig.zoomBy ? window.__game.rig.zoomBy(z) : null, ZOOM);
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT });
console.log(JSON.stringify({ out: OUT, errors: errs.length ? errs : 'none' }));
await browser.close();
