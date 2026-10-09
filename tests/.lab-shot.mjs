// temp helper (deleted at the end): node tests/.lab-shot.mjs <url-path> <out.png> [w] [h]
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const [,, rel, out, W = 1200, H = 700] = process.argv;
const here = path.dirname(new URL(import.meta.url).pathname);
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
page.on('console', m => console.log('console:', m.type(), m.text()));
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.route(`${CDN}**`, route => { const f = path.join(threeDir, route.request().url().slice(CDN.length).split('?')[0]); route.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8125/' + rel);
await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
await page.waitForTimeout(100); await page.screenshot({ path: out });
await browser.close();
