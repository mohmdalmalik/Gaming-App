// QA scratch helpers (visual/UX pass). Not part of the game or the regular test suites.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const BASE = process.env.QA_URL || 'http://127.0.0.1:8125/';
const here = path.dirname(new URL(import.meta.url).pathname);
export const SHOTS = path.join(here, 'shots/qa');
fs.mkdirSync(SHOTS, { recursive: true });
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

export const VIEWPORTS = {
  ipad: { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true },
  air: { viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true },
  pro: { viewport: { width: 1366, height: 1024 }, deviceScaleFactor: 2, hasTouch: true },
  desk: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, hasTouch: false },
};

export async function launch() {
  return chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
}

export async function newPage(browser, vp = 'air') {
  const context = await browser.newContext(VIEWPORTS[vp]);
  const page = await context.newPage();
  const log = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => log.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => { if (!/favicon/.test(r.url())) log.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`); });
  await page.route(`${CDN}**`, route => {
    const rel = route.request().url().slice(CDN.length).split('?')[0];
    const file = path.join(threeDir, rel);
    route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
  });
  const h = helpers(page);
  h.log = log; h.context = context; h.vp = vp;
  return h;
}

export function helpers(page) {
  const game = (fn, arg) => page.evaluate(fn, arg);
  const h = {
    page, game,
    async load(query = '', { fast = true, pr = 0.75 } = {}) {
      if (page.url().startsWith('http')) await page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 250 }).catch(() => {});
      await page.goto(BASE + (query ? '?' + query : ''), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000 });
      await game(({ fast, pr }) => { if (fast) window.__game.cfg.player.speed = 16; window.__game.setPixelRatio(pr); }, { fast, pr });
    },
    async begin() { await page.click('#btn-begin'); await page.waitForTimeout(150); },
    async shot(name, opts = {}) {
      await h.frames(3);
      const p = path.join(SHOTS, `${name}.png`);
      await page.screenshot({ path: p, ...opts });
      return p;
    },
    frames: n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n),
    settle: (t = 40000) => page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 }).catch(() => 'timeout'),
    visible: sel => page.evaluate(s => {
      const el = document.querySelector(s);
      return !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
    }, sel),
    kind: () => game(() => window.__game.handoffKind()),
    handoffOpen: () => game(() => window.__game.handoffOpen()),
    async tap(sel) { await page.click(sel); await page.waitForTimeout(80); },
    async snapCam() { await game(() => { const g = window.__game, m = g.activeMover(); g.rig.setFocus(m.x, m.z, true); }); await page.waitForTimeout(150); },
    place: (index, room, ap = null) => page.evaluate(({ index, room, ap }) => {
      const g = window.__game, p = g.state.players[index], c = g.roomCenter(room);
      g.state.discovered.add(room); p.currentRoom = room;
      if (ap != null) p.actionPoints = ap;
      g.movers[index].reset(c[0], c[1]);
      g.discovery.refresh(); g.refresh();
    }, { index, room, ap }),
    async put(room, ap = 4) { return h.place(await game(() => window.__game.state.activeIndex), room, ap); },
    setHand: (index, cards) => page.evaluate(({ index, cards }) => { const g = window.__game; g.state.players[index].hand = cards; g.refresh(); }, { index, cards }),
    async searchHere() {
      await page.click('#search-spot');
      await page.waitForFunction(() => !window.__game.searchPending() && !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000, polling: 50 }).catch(() => {});
      await page.waitForTimeout(100);
    },
    async intoTurn() {
      for (let i = 0; i < 20; i++) {
        if (await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) return true;
        if (await game(() => window.__game.handoffOpen())) { await h.tap('#btn-handoff-next'); continue; }
        if (await game(() => window.__game.noticeOpen())) { await h.tap('#btn-notice-ok'); continue; }
        return false;
      }
      return false;
    },
    // Geometry audit: any visible button/interactive element under 44px, text overflowing, elements off-screen.
    audit: () => page.evaluate(() => {
      const out = [];
      const vis = el => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && el.closest('[hidden]') == null; };
      for (const el of document.querySelectorAll('button, [role=button], .fan-card, #search-spot .ss-badge, .card-tile')) {
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        const id = el.id ? '#' + el.id : (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ').join('.') : el.tagName);
        if ((r.width < 44 || r.height < 44) && el.tagName === 'BUTTON') out.push(`small ${id} ${Math.round(r.width)}x${Math.round(r.height)} "${el.textContent.trim().slice(0, 30)}"`);
        if (r.right > innerWidth + 1 || r.bottom > innerHeight + 1 || r.left < -1 || r.top < -1) {
          if (!el.classList.contains('fan-card')) out.push(`offscreen ${id} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}] "${el.textContent.trim().slice(0, 30)}"`);
        }
      }
      for (const el of document.querySelectorAll('#app *')) {
        if (!vis(el)) continue;
        if (el.children.length === 0 && el.textContent.trim() && (el.scrollWidth > el.clientWidth + 2) && getComputedStyle(el).overflow !== 'visible') {
          out.push(`text-clipped ${el.id ? '#' + el.id : el.className} "${el.textContent.trim().slice(0, 40)}" ${el.scrollWidth}>${el.clientWidth}`);
        }
      }
      return out;
    }),
    // Overlap audit between key HUD boxes.
    overlaps: (sels) => page.evaluate(sels => {
      const boxes = sels.map(s => { const el = document.querySelector(s); if (!el || el.offsetParent === null || el.closest('[hidden]')) return null; const r = el.getBoundingClientRect(); return r.width && r.height ? { s, r, el } : null; }).filter(Boolean);
      const out = [];
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r, b = boxes[j].r;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2 && !boxes[i].el.contains(boxes[j].el) && !boxes[j].el.contains(boxes[i].el)) out.push(`${boxes[i].s} overlaps ${boxes[j].s} by ${Math.round(ox)}x${Math.round(oy)}`);
      }
      return out;
    }, sels),
  };
  return h;
}

export const HUD_SELS = ['.hud-top-left', '.hud-top-center', '.hud-top-right', '#player-panel', '#hand-fan', '.hud-bottom-right', '#confirm-bar', '#toast', '#search-spot', '#btn-room', '#btn-trade', '#btn-end-turn', '#btn-map', '#btn-rotate-left', '#btn-rotate-right', '#btn-restart-practice', '#round', '#turn-timer', '#safe-badge', '#room-name'];
