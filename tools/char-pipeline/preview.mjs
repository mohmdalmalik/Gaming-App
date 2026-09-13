// Load the exported test_guest.glb in a headless Three.js preview and screenshot it.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const GAME = '/home/user/Gaming-App';
const threeDir = path.join(GAME, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/tools/char-pipeline/preview.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__loaded, null, { timeout: 15000 });
await page.waitForTimeout(700);   // let the idle animation play a little
await page.screenshot({ path: path.join(GAME, 'tools/char-pipeline/glb-preview.png') });
const info = await page.evaluate(() => window.__loaded);
console.log('loaded:', JSON.stringify(info));
console.log('console errors:', errs.length ? errs.join('\n') : 'none');
await browser.close();
