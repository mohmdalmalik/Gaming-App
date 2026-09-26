// Performance with a big hotel: reveal N rooms, then read the renderer's counters and time frames.
//   node tools/room-pipeline/perf.mjs [--rooms 12] [--all]
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(REPO, 'tests/node_modules/playwright-core/index.mjs')).href);
const argv = process.argv.slice(2);
const N = argv.includes('--all') ? 99 : +(argv[argv.indexOf('--rooms') + 1] || 12);
const threeDir = path.join(REPO, 'tests/node_modules/three'), CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.route(`${CDN}**`, r => { const f = path.join(threeDir, r.request().url().slice(CDN.length).split('?')[0]); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/?seed=5', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled);
await page.tap('#btn-begin'); await page.waitForTimeout(500);
const placed = await page.evaluate((N) => {
  const g = window.__game; let n = 0;
  for (let k = 0; k < 60 && g.hotelRooms().length - 1 < N; k++) {
    const d = g.floor.frontier.find(d => !d.jammed); if (!d) break;
    g.openDoor ? null : null;
    const rooms = g.hotelRooms().length;
    // open the door as the game would, standing in its room
    const p = g.activePlayer(); p.currentRoom = d.room; p.actionPoints = 4;
    g.openDoor(d.id);
    if (g.hotelRooms().length > rooms) n++;
  }
  const p = g.activePlayer(); p.currentRoom = 'hall'; g.refresh();
  return g.hotelRooms().length;
}, N);
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(3000);
const out = [];
for (const zoom of [1, 0.55]) {
  await page.evaluate(z => window.__game.rig.zoomBy(z), zoom);
  await page.waitForTimeout(1500);
  const r = await page.evaluate(async () => {
    const g = window.__game, info = g.view.renderer.info;
    const t = []; let last = performance.now();
    for (let i = 0; i < 30; i++) { await new Promise(requestAnimationFrame); const now = performance.now(); t.push(now - last); last = now; }
    t.sort((a, b) => a - b);
    const cpu = []; for (let i = 0; i < 10; i++) { const a = performance.now(); g.view.renderer.render(g.view.scene, g.view.camera); cpu.push(performance.now() - a); }
    cpu.sort((a, b) => a - b);
    return { calls: info.render.calls, tris: info.render.triangles, programs: info.programs.length, textures: info.memory.textures, geometries: info.memory.geometries, frameMedianMs: t[15].toFixed(1), renderCallMs: cpu[5].toFixed(1) };
  });
  out.push({ zoom, ...r });
}
console.log(JSON.stringify({ rooms: placed, views: out }, null, 1));
console.log(errs.length ? 'console:\n  ' + [...new Set(errs)].slice(0, 8).join('\n  ') : 'console clean');
await browser.close();
