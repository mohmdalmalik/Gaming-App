// Record a short clip of Victor walking around the hall (webm).
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const GAME = '/home/user/Gaming-App';
const threeDir = path.join(GAME, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const outDir = path.join(GAME, 'tools/char-pipeline/rec');
fs.mkdirSync(outDir, { recursive: true });
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1, hasTouch: true, recordVideo: { dir: outDir, size: { width: 960, height: 640 } } });
const page = await context.newPage();
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 15000 });
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin'); await page.waitForTimeout(1400);
await page.evaluate(() => window.__game.rig.zoomBy(1.35)); await page.waitForTimeout(400);
const goto = async (x, z) => {
  await page.evaluate(([x, z]) => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] + x, c[1] + z); }, [x, z]);
  await page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
};
await page.waitForTimeout(1000);   // idle a beat
await goto(2.4, 1.8); await goto(-2.4, 1.8); await goto(-2.4, -1.6); await goto(2.2, -1.6); await goto(0, 0);
await page.waitForTimeout(600);
await context.close();
const vp = await page.video().path();
console.log('video:', vp);
await browser.close();
