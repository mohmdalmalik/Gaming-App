// Walk a guest through EVERY doorway of every room tile in the real game (headless Chromium):
// the tile is revealed next to the lobby (or, for a locked room the rules keep away from it, next to
// another room), the guest walks in, then each of the tile's other doorways is opened and the guest
// walks through it into the room behind and back again.
//   node tools/room-pipeline/walkcheck.mjs [--rooms library,kitchen] [--seed 3]
// Exits non-zero if any doorway could not be walked through (or the page logged an error).
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const { chromium } = await import(pathToFileURL(path.join(REPO, 'tests/node_modules/playwright-core/index.mjs')).href);
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const ALL = Object.keys(JSON.parse(fs.readFileSync(path.join(HERE, 'rooms.json'), 'utf8')).rooms);
const ROOMS = String(opt('rooms', ALL.join(','))).split(',');
const SEED = +opt('seed', 3), URL = String(opt('url', 'http://127.0.0.1:8123/'));
const threeDir = path.join(REPO, 'tests/node_modules/three'), CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
let failures = 0, walked = 0;
const errs = [];
for (const room of ROOMS) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', e => errs.push(`${room}: ${e}`));
  page.on('console', m => { if (m.type() === 'error') errs.push(`${room}: ${m.text()}`); });
  await page.route(`${CDN}**`, r => { const f = path.join(threeDir, r.request().url().slice(CDN.length).split('?')[0]); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
  await page.goto(`${URL}?seed=${SEED}&timer=off`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000 });
  await page.tap('#btn-begin');
  await page.waitForTimeout(300);
  const game = (fn, arg) => page.evaluate(fn, arg);
  const settle = () => page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000, polling: 50 }).catch(() => {});
  // walk into `dest` through the shared doorway, and report where the guest ended up
  const go = async dest => {
    await game(() => { const g = window.__game; g.activePlayer().actionPoints = 99; g.state.lockedRooms.clear(); g.refresh(); });
    const plan = await game(d => { const r = window.__game.moveToRoom(d); return { ok: r.ok, reason: r.reason || null }; }, dest);
    if (!plan.ok) return `no route (${plan.reason})`;
    await settle();
    const at = await game(() => window.__game.activePlayer().currentRoom);
    return at === dest ? null : `stopped in ${at}`;
  };
  // next to the lobby if the rules allow it (a locked room may not be), else wherever it fits; the guest
  // starts in the room it joins
  const from = await game(r => {
    const g = window.__game;
    let ok = g.revealTile(r, 'hall'), from = 'hall';
    if (!ok) {
      ok = g.revealTile(r);
      const d = ok && (g.floor.rooms.get(r).doorways || [])[0];
      if (!d) return null;
      from = d.a === r ? d.b : d.a;
      const c = g.roomCenter(from); g.activePlayer().currentRoom = from; g.activeMover().reset(c[0], c[1]);
    }
    g.state.lockedRooms.clear(); g.refresh();
    return ok ? from : null;
  }, room);
  if (!from) { console.log(`  FAIL ${room}: could not be placed`); failures++; await ctx.close(); continue; }
  const sides = await game(r => [...window.__game.floor.rooms.get(r).doorSides], room);
  const done = [];
  let bad = await go(room);
  if (bad) { console.log(`  FAIL ${room}: walking in from ${from}: ${bad}`); failures++; await ctx.close(); continue; }
  done.push(`from ${from === 'hall' ? 'the lobby' : from}`);
  // the doorway back to where the guest came from
  bad = await go(from) || await go(room);
  if (bad) { console.log(`  FAIL ${room}: out to ${from} and back: ${bad}`); failures++; } else done.push(`to ${from === 'hall' ? 'the lobby' : from} and back`);
  // every other doorway: open it, walk through, walk back
  for (let k = 0; k < 6; k++) {
    const door = await game(() => (window.__game.closedDoors().find(d => !d.jammed) || null));
    if (!door) break;
    const next = await game(id => { const g = window.__game; const before = new Set(g.hotelRooms()); g.activePlayer().actionPoints = 99; g.openDoor(id);
      g.state.lockedRooms.clear(); g.refresh(); return g.hotelRooms().find(r => !before.has(r)) || null; }, door.id);
    if (!next) { console.log(`  FAIL ${room}: the ${door.side} door would not open`); failures++; break; }
    bad = await go(next) || await go(room);
    if (bad) { console.log(`  FAIL ${room}: through the ${door.side} doorway (${next}) and back: ${bad}`); failures++; }
    else done.push(`${door.side} (${next})`);
  }
  const jammed = await game(() => window.__game.closedDoors().filter(d => d.jammed).map(d => d.side));
  const through = done.length;                 // 'from the lobby' + 'to the lobby and back' count as that one doorway
  const ok = through - 1 >= sides.length;
  if (!ok) { console.log(`  FAIL ${room}: walked ${through - 1} of ${sides.length} doorways${jammed.length ? ` (jammed: ${jammed})` : ''}`); failures++; }
  else console.log(`  ok   ${room}: ${sides.length} doorways — ${done.join(', ')}`);
  walked += through - 1;
  await ctx.close();
}
await browser.close();
if (errs.length) { console.log('console errors:\n  ' + [...new Set(errs)].slice(0, 10).join('\n  ')); failures++; }
console.log(failures ? `\n${failures} FAILED` : `\nALL ${walked} DOORWAYS WALKED`);
process.exit(failures ? 1 : 0);
