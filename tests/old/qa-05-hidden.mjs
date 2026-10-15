import { launch, newPage } from './qa-lib.mjs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
await h.load('seed=4242&timer=off', { pr: 1 });
await h.begin();
await game(() => {
  const ts = ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit'];
  for (const t of ts) window.__game.revealTile(t);
  for (const r of [...window.__game.state.lockedRooms]) window.__game.state.lockedRooms.delete(r);
  window.__game.doorways.sync();
});
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 120000, polling: 500 }).catch(() => {});
const cases = [[1, 'library', -2.2, -3.3], [1, 'switchboard', -1.1, 3.3], [0, 'storage', -3.3, -1.1], [1, 'suite416', 2.75, 0], [0, 'library', 1.65, 3.3]];
let cur = 0;
for (const [rot, id, dx, dz] of cases) {
  while (cur < rot) { await game(() => window.__game.rotate(1)); cur++; }
  await game(({ id, dx, dz }) => { const g = window.__game, c = g.roomCenter(id), p = g.activePlayer(); p.currentRoom = id; g.movers[0].reset(c[0] + dx, c[1] + dz); g.discovery.refresh(); g.refresh(); }, { id, dx, dz });
  await h.snapCam();
  await page.waitForTimeout(2500);
  const hts = await game(() => { const out = []; window.__game.view.scene.traverse(o => { if (/^W_.*_up/.test(o.name) && o.visible) out.push(o.name + ':' + o.scale.y.toFixed(2) + ':' + o.position.y.toFixed(2)); }); return out.length; });
  await h.shot(`hidden-${id}-r${rot}`);
  console.log(id, rot, dx, dz, hts);
}
await browser.close();
