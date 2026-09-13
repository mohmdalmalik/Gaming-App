// Screenshot Victor in Three.js: an elevated 3/4 "game" view (Idle + a mid-Walk frame) and a
// front view for the face. Prints clip list + measured height/width/min-Y (grounding).
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const GAME = '/home/user/Gaming-App';
const threeDir = path.join(GAME, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
async function shot(name, view, clip, waitMs) {
  const page = await (await browser.newContext({ viewport: { width: 700, height: 760 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
  await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
  await page.goto(`http://127.0.0.1:8123/tools/char-pipeline/preview_victor.html?view=${view}&clip=${clip}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__info, null, { timeout: 15000 });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(GAME, `tools/char-pipeline/${name}.png`) });
  const info = await page.evaluate(() => window.__info);
  console.log(name, JSON.stringify(info), 'errors:', errs.length ? errs.join(' | ') : 'none');
  await page.close();
}
await shot('victor-game-idle', 'game', 'Idle', 600);
await shot('victor-game-walk', 'game', 'Walk', 380);   // mid-stride frame
await shot('victor-front', 'front', 'Idle', 300);
await browser.close();
