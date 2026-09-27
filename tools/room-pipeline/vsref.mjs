// Side-by-side with the owner's references: each room in the REAL game, seen the way its reference is
// (tools/room-pipeline/ref/<room>.jpg: the entrance, the tile's south doorway, at the bottom), with the
// game's own camera (pitch, field of view, default zoom), then pasted next to the reference.
//   node tools/room-pipeline/vsref.mjs [--rooms library,kitchen] [--out tools/room-pipeline/shots]
// Writes build/vsref/<room>-game.png (the game alone, full size) and, via vsref_sheet.py,
// <out>/<room>-vs-ref.png and the contact sheet <out>/rooms-vs-refs.png (out: tools/room-pipeline/shots).
//
// The camera is turned (in 90° steps, as the game does) so the tile's default south faces it; the
// neighbouring rooms and the guest are hidden, and the backdrop is the references' grey. `yaw` below can
// turn the view off the 90° steps for study; the published sheet uses 0 (the real in-game view).
import fs from 'node:fs'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(REPO, 'tests/node_modules/playwright-core/index.mjs')).href);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
// Tile -> reference, the view's yaw (degrees east of south) and the camera distance (11.5 = the game's default).
export const REFS = {
  ballroom: ['ballroom', 0, 11.5], lounge: ['lounge', 0, 11.5], grandCorridor: ['grandCorridor', 0, 11.5],
  dining: ['dining', 0, 11.5], switchboard: ['switchboard', 0, 11.5], library: ['library', 0, 11.5],
  kitchen: ['kitchen', 0, 11.5], serviceCorridor: ['serviceCorridor', 0, 11.5], storage: ['storage', 0, 11.5],
  corridorE: ['corridorE', 0, 11.5], corridorW: ['corridorW', 0, 11.5], corridorN: ['corridorN', 0, 11.5],
  corridorS: ['corridorS', 0, 11.5], stairs: ['stairs', 0, 11.5], infirmary2: ['infirmary', 0, 11.5],
  infirmary1: ['infirmary', 0, 11.5], cloakroom: ['cloakroom', 0, 11.5], backCorridor: ['backCorridor', 0, 11.5],
  // no reference: shown alone in the same view
  cornerCorridor: [null, 0, 11.5], linenStore1: [null, 0, 11.5], linenStore2: [null, 0, 11.5],
  suite416: [null, 0, 11.5], housekeeping: [null, 0, 11.5], exit: [null, 0, 11.5],
};
const ROOMS = String(opt('rooms', Object.keys(REFS).join(','))).split(',');
const OUT = String(opt('out', path.join(HERE, 'shots')));
const RAW = String(opt('raw', path.join(HERE, 'build', 'vsref')));      // the full-size game shots (not kept in git)
const URL = String(opt('url', 'http://127.0.0.1:8123/'));
const W = 1448, H = 1086;
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(RAW, { recursive: true });
const threeDir = path.join(REPO, 'tests/node_modules/three'), CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errs = [];
for (const room of ROOMS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  await page.route(`${CDN}**`, r => { const f = path.join(threeDir, r.request().url().slice(CDN.length).split('?')[0]); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
  const [, yawRef, dist] = REFS[room];
  const yawDeg = opt('yaw', null) != null ? Number(opt('yaw')) : yawRef;   // --yaw 35: a corner-on trial view
  await page.goto(`${URL}?seed=7`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && !document.getElementById("btn-begin").disabled, null, { timeout: 60000 });
  await page.tap('#btn-begin');
  await page.waitForTimeout(300);
  const ok = await page.evaluate(({ room, yawDeg, dist }) => {
    const g = window.__game;
    if (!g.revealTile(room)) return false;
    g.state.lockedRooms.delete(room);
    const p = g.activePlayer(); p.currentRoom = room;
    const r = g.floor.rooms.get(room), c = r.center;
    // the camera follows the active guest: stand them in the middle (hidden below), the rest far away
    g.movers.forEach((m, i) => (i === g.state.activeIndex ? m.reset(c[0], c[1] - 0.25) : m.reset(c[0] + 40, c[1] + 40)));
    g.rig.setFocus(c[0], c[1] - 0.25, true);
    g.refresh();
    // model yaw -> world yaw: the tile is turned a quarter clockwise per rotation step
    const yaw = yawDeg * Math.PI / 180 - (r.rotation || 0) * Math.PI / 2;
    g.rig.rotate(yaw / (Math.PI / 2));
    g.rig.zoomBy(g.rig.distance / dist);
    for (const [id, v] of g.roomViews) {
      if (id !== room) v.group.visible = false;
      else for (const w of v.walls) w.wall.neighbour = null;
    }
    g.characters.forEach(cv => { cv.group.visible = false; });
    if (r.mood?.flicker) r.mood = { ...r.mood, flicker: null };                      // a still frame of a flickering room
    g.view.scene.background = new g.view.scene.background.constructor('#7a6b62');   // the references' backdrop
    return true;
  }, { room, yawDeg, dist });
  if (!ok) { console.log(room, 'could not be placed'); await ctx.close(); continue; }
  await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 60000 }).catch(() => {});
  // (headless frames are slow and the camera turns a little each frame: wait until it has finished)
  await page.waitForFunction(() => window.__game.rig.debug.yawT >= 1, null, { timeout: 60000, polling: 100 });
  await page.waitForTimeout(2500);
  if (argv.includes('--debug')) await page.screenshot({ path: path.join(RAW, `${room}-debug.png`) });
  await page.evaluate(() => {
    document.getElementById('hud').style.visibility = 'hidden';
    window.__game.characters.forEach(cv => { cv.group.visible = false; });
    for (const el of document.querySelectorAll('body > *:not(canvas)')) if (el.id !== 'app' && !el.querySelector('canvas')) el.style.visibility = 'hidden';
  });
  await page.waitForTimeout(400);
  const f = path.join(RAW, `${room}-game.png`);
  await page.screenshot({ path: f });
  console.log(room, 'shot');
  await ctx.close();
}
console.log(errs.length ? 'console:\n  ' + [...new Set(errs)].slice(0, 12).join('\n  ') : 'console clean');
await browser.close();
if (!argv.includes('--noSheet')) {
  const pairs = ROOMS.map(r => `${r}:${REFS[r][0] || ''}`);
  console.log(execFileSync('python3', [path.join(HERE, 'vsref_sheet.py'), RAW, OUT, ...pairs], { encoding: 'utf8' }));
}
