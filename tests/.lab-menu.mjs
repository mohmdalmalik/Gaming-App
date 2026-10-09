// temp helper (deleted at the end): node tests/.lab-menu.mjs <query> <out-prefix> [w] [h] [steps...]
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const [,, query, out, W = 1366, H = 1024, ...steps] = process.argv;
const here = path.dirname(new URL(import.meta.url).pathname);
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })).newPage();
page.on('console', m => { if (m.type() !== 'log') console.log('console:', m.type(), m.text()); });
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.route(`${CDN}**`, route => { const f = path.join(threeDir, route.request().url().slice(CDN.length).split('?')[0]); route.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8125/tools/menu-preview.html?pause=1&controls=0&' + query);
await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
if (!steps.length) steps.push('0');
let k = 0;
for (const st of steps) {
  if (st.startsWith('enter')) { await page.evaluate(g => { window.__seq = window.__menu.enter(g); }, +(st.slice(5) || 3)); continue; }
  const s = await page.evaluate(sec => window.__menu.step(sec), +st);
  const info = await page.evaluate(() => ({ t: window.__menu.time.toFixed(2), done: window.__seq ? window.__seq.done : null }));
  console.log(`shot ${k}`, JSON.stringify(s), JSON.stringify(info));
  await page.screenshot({ path: `${out}-${k}.png` });
  k++;
}
await browser.close();
