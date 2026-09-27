// QA: every room tile on the board, the guest standing in it, in 4 camera rotations; check the search
// icon sits over its furniture, and screenshot each. node qa-03-tiles.mjs [vp] [rotations]
import { launch, newPage } from './qa-lib.mjs';
import fs from 'node:fs';
const VP = process.argv[2] || 'air', ROTS = +(process.argv[3] || 1), ONLY = process.argv[4] ? process.argv[4].split(',') : null;
const browser = await launch();
const h = await newPage(browser, VP);
const { page, game } = h;
await h.load('seed=4242&timer=off', { pr: 1 });
await h.begin();
const ids = await game(() => {
  const ts = ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit'];
  const out = {};
  for (const t of ts) { try { out[t] = window.__game.revealTile(t); } catch (e) { out[t] = 'ERR ' + e.message; } }
  return out;
});
console.log('reveal', JSON.stringify(ids));
const rooms = await game(() => window.__game.hotelRooms());
console.log('rooms on board', rooms.length, rooms.join(','));
await h.page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 120000, polling: 500 }).catch(() => console.log('dressing not done'));
const results = [];
for (const id of rooms) {
  if (id === 'hall' || (ONLY && !ONLY.includes(id))) continue;
  // unlock so the guest can stand there
  await game(id => { const g = window.__game; g.state.lockedRooms.delete(id); g.doorways.sync(); g.activePlayer().hand.push({ id: 'fl' + id, type: 'flashlight' }); }, id);
  await h.put(id, 4);
  await game(() => window.__game.refresh());
  await h.snapCam();
  for (let r = 0; r < ROTS; r++) {
    if (r) { await game(() => window.__game.rotate(1)); await page.waitForTimeout(900); await h.snapCam(); }
    await page.waitForTimeout(700);
    await h.frames(4);
    const info = await game(id => {
      const g = window.__game, room = g.floor.rooms.get(id), f = room.furniture.find(x => x.search), cam = g.view.camera;
      const s = g.searchSpot();
      if (!f) return { id, noSpot: true, mode: s.mode };
      const V = cam.position.constructor, W = innerWidth, H = innerHeight;
      const scr = (x, y, z) => { const v = new V(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
      const top = f.size[1];
      const pts = [[f.min[0], f.min[1]], [f.max[0], f.min[1]], [f.min[0], f.max[1]], [f.max[0], f.max[1]]].flatMap(([x, z]) => [scr(x, top, z), scr(x, 0, z)]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const ic = s.point;
      // HUD element on top of the icon?
      const b = document.querySelector('#search-spot .ss-badge')?.getBoundingClientRect();
      const topEl = b ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
      const m = g.activeMover();
      const guest = scr(m.x, 0.9, m.z);
      return { id, kind: f.kind, mode: s.mode, icon: ic, box: box.map(Math.round), inX: ic ? ic.x >= box[0] - 6 && ic.x <= box[2] + 6 : null,
        dy: ic ? Math.round(box[1] - ic.y) : null, covered: topEl && !document.getElementById('search-spot').contains(topEl) ? (topEl.id || topEl.className) : null,
        guest: guest.map(Math.round) };
    }, id);
    info.rot = r;
    results.push(info);
    console.log(JSON.stringify(info));
    await h.shot(`t-${id}-r${r}-${VP}`);
  }
  await game(() => { const g = window.__game; g.rig.reset?.(); });
}
fs.writeFileSync(`shots/qa/tiles-${VP}.json`, JSON.stringify(results, null, 1));
console.log('log', h.log);
await browser.close();
