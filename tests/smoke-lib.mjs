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

// A player profile (src/account/account.js) in every check unless it asks for none (`profile: false`, as
// tests/browser-profile.mjs does for the first-run register): before each page loads, a saved profile
// 'tester' (a fixed free look: the Tuxedo in its own colours) is put in place if there is none yet, so the
// menu opens on the main screen, never on "Sign the register". `profile: { username, avatar }` seeds that.
export const TEST_PROFILE = {
  version: 1, id: 'local-test', username: 'tester',
  avatar: { v: 1, base: 'victor', skin: 'fair', hair: 'black', eyes: 'classic', glasses: 'none', frame: 'tortoise', main: 'midnight', accent: 'black', metal: 'gold' },
  inventory: [], createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z', nameChangedAt: '2026-10-12T00:00:00.000Z',
};
export const profileOn = (profile) => {
  try {
    const key = 'hotelEscape.profile.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(profile));
  } catch { /* no storage on this page */ }
};

export async function launch({ width = 1180, height = 820, touch = true, tips = false, profile = true, reducedMotion = null } = {}) {
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  // (`reducedMotion: 'reduce'`: the device's Reduce Motion setting is on, prefers-reduced-motion: src/motion.js)
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: touch, ...(reducedMotion ? { reducedMotion } : {}) });
  if (!tips) await context.addInitScript(tipsOff);
  if (profile) await context.addInitScript(profileOn, profile === true ? TEST_PROFILE : { ...TEST_PROFILE, ...profile });
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

// Wait until something in the page is true (a function run in the page), for at most `timeout` ms. Resolves true when
// it became true and false when it did not, and never throws: the check that comes next still reports a failure in its
// own words. It replaces a fixed pause that guessed how long a slow (1-3 frames a second) machine needs: the check runs
// the moment the thing is ready, and as late as `timeout`. NOT for "nothing happens" checks: those must wait the whole time.
export const settle = (page, fn, arg, timeout = 15000) =>
  page.waitForFunction(fn, arg, { timeout, polling: 100 }).then(() => true, () => false);
// The same for a condition read in Node (a list of requests the test keeps, say).
export async function settleNode(cond, timeout = 15000, every = 100) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await cond()) return true; await new Promise(r => setTimeout(r, every)); }
  return !!(await cond());
}

// --- Taps that take two steps now (src/ui/handoff.js, src/hud.js) -------------------------------------------
// A screen ignores a second tap that comes within 300 ms of the one before (src/ui/tapGuard.js), so a check
// that taps twice in a row waits a little longer than that between them.
export const GUARD_WAIT = 350;

// Give a card in a trade: tap the card, then the button that names it ("Give the Lantern", "Give your soul").
// `tile`: the card to tap (default: the first). Resolves with the button's words.
export async function giveCard(page, tile = '#offer-cards .card-tile', { timeout = 4000 } = {}) {
  const lifted = () => page.waitForFunction(() => { const b = document.getElementById('btn-offer-give'); return !!b && !b.hidden && !b.disabled; }, null, { timeout: 700, polling: 50 }).then(() => true, () => false);
  // (a tap in the screen's first moments is ignored, so a tap that did not lift the card is tried again)
  let ok = false;
  for (let i = 0; i < 6 && !ok; i++) { await page.click(tile, { timeout }); ok = await lifted(); }
  if (!ok) throw new Error('giveCard: tapping the card did not lift it');
  const label = await page.textContent('#btn-offer-give');
  await page.waitForTimeout(GUARD_WAIT);
  await page.click('#btn-offer-give', { timeout });
  return label;
}

// End turn: tap the button; with actions left it asks first ("You still have 3 actions. End turn?"), so
// answer End turn. Resolves true when it asked. (`answer: 'keep'` taps Keep playing instead.)
export async function endTurn(page, { answer = 'end', timeout = 4000 } = {}) {
  await page.click('#btn-end-turn', { timeout });
  const asked = await page.waitForFunction(() => {
    const bar = document.getElementById('confirm-bar');
    return !!bar && !bar.hidden && /End turn\?$/.test(document.getElementById('confirm-text').textContent);
  }, null, { timeout: 700, polling: 50 }).then(() => true, () => false);
  if (asked) {
    await page.waitForTimeout(GUARD_WAIT);
    await page.click(answer === 'keep' ? '#btn-confirm-cancel' : '#btn-confirm-move', { timeout });
  }
  return asked;
}
