// Look at baked rooms in the REAL game (headless Chromium), from the four camera angles.
//   node tools/room-pipeline/shoot.mjs --rooms lounge,library [--out dir] [--w 1180 --h 820] [--seed 7]
// Writes <out>/<room>-r<0..3>.png and a contact sheet <out>/<room>.png. The room is put on the board
// (opened into the hotel the way the game does), the guest stands in it and the camera looks at it.
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
// playwright-core comes with the tests (tests/node_modules)
const { chromium } = await import(pathToFileURL(path.join(REPO, 'tests/node_modules/playwright-core/index.mjs')).href);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const ROOMS = String(opt('rooms', 'lounge')).split(',');
const OUT = String(opt('out', path.join(HERE, 'build', 'shots')));
const W = +opt('w', 1180), H = +opt('h', 820), SEED = +opt('seed', 7), URL = String(opt('url', 'http://127.0.0.1:8123/'));
const ZOOM = +opt('zoom', 1);
fs.mkdirSync(OUT, { recursive: true });
const threeDir = path.join(REPO, 'tests/node_modules/three'), CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
await page.route(`${CDN}**`, r => { const f = path.join(threeDir, r.request().url().slice(CDN.length).split('?')[0]); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
for (const room of ROOMS) {
  await page.goto(`${URL}?seed=${SEED}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 30000 });
  await page.tap('#btn-begin');
  await page.waitForTimeout(300);
  const ok = await page.evaluate(async (room) => {
    const g = window.__game;
    if (!g.revealTile(room)) return false;
    g.state.lockedRooms.delete(room);
    const p = g.activePlayer(); p.currentRoom = room;
    const c = g.roomCenter(room); g.movers[0].reset(c[0] + 0.6, c[1] + 0.9); g.rig.setFocus(c[0], c[1], true);
    g.refresh();
    return true;
  }, room);
  if (!ok) { console.log(room, 'could not be placed'); continue; }
  if (ZOOM !== 1) await page.evaluate(z => window.__game.rig.zoomBy(z), ZOOM);
  await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
  const files = [];
  for (let r = 0; r < 4; r++) {
    const f = path.join(OUT, `${room}-r${r}.png`);
    await page.screenshot({ path: f }); files.push(f);
    await page.evaluate(() => window.__game.rotate(1));
    await page.waitForTimeout(1200);
  }
  const info = await page.evaluate(room => { const r = window.__game.floor.rooms.get(room); return { rot: r.rotation, doors: [...r.doorSides] }; }, room);
  console.log(room, JSON.stringify(info));
}
console.log(errs.length ? 'console:\n  ' + [...new Set(errs)].slice(0, 12).join('\n  ') : 'console clean');
await browser.close();
