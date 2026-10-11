// Shared launcher for quick headless checks (tests/*.mjs): Chromium with SwiftShader, the three.js
// CDN served from tests/node_modules/three, console errors collected.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);

// First-match tips (src/ui/tips.js) are Off in every check unless it asks for them (`tips: true`, as
// tests/tips-check.mjs does): before each page loads, the saved settings get tips 'off' (if they say
// nothing about tips yet), so no tip card ever sits over what a check looks at or taps.
export const tipsOff = () => {
  try {
    const key = 'hotelEscape.settings.v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
    if (saved.tips == null) localStorage.setItem(key, JSON.stringify({ ...saved, tips: 'off' }));
  } catch { /* no storage on this page */ }
};

export async function launch({ width = 1180, height = 820, touch = true, tips = false } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch });
  if (!tips) await context.addInitScript(tipsOff);
  const page = await context.newPage();
  const messages = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) messages.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => messages.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => messages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  await page.route(`${CDN}**`, route => {
    const rel = route.request().url().slice(CDN.length).split('?')[0];
    const file = path.join(threeDir, rel);
    route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
  });
  return { browser, page, messages };
}
