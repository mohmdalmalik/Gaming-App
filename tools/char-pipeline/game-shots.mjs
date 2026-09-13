// Real gameplay screenshots of Victor (the glTF guest) at iPad size: idle, walking, near a doorway.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
const GAME = '/home/user/Gaming-App';
const threeDir = path.join(GAME, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = [];
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', e => errs.push(String(e)));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 15000 });
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin'); await page.waitForTimeout(1600);

// 1) Idle at spawn
await page.screenshot({ path: path.join(GAME, 'tools/char-pipeline/game-victor-idle.png') });

// 2) Walking: send Victor across the room, grab a mid-stride frame
await page.evaluate(() => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0] + 2.2, c[1] + 1.6); });
await page.waitForTimeout(320);
await page.screenshot({ path: path.join(GAME, 'tools/char-pipeline/game-victor-walk.png') });
await page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 8000 }).catch(() => {});

// 3) Near the north doorway (fit check) + zoomed in
await page.evaluate(() => { const c = window.__game.roomCenter('hall'); window.__game.walkTo(c[0], c[1] - 3.2); });
await page.waitForFunction(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; }, null, { timeout: 8000 }).catch(() => {});
await page.evaluate(() => window.__game.rig.zoomBy(1.7)); await page.waitForTimeout(500);
await page.screenshot({ path: path.join(GAME, 'tools/char-pipeline/game-victor-door.png') });

console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
