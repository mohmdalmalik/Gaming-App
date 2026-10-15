// QA: a walk at the real speed (feet, facing), filmstrip frames; zoomed-in close-ups of the guests;
// a busy 6-guest scene with ?stats=1 for draw calls. node qa-08-walk.mjs
import { launch, newPage } from './qa-lib.mjs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
await h.load('mode=hotseat&players=6&seed=909&timer=off&stats=1', { fast: false, pr: 1 });
await h.begin();
await h.intoTurn();
await page.waitForTimeout(600);
await h.shot('w-00-six-in-lobby');
// zoom in on the lobby group
await game(() => { const g = window.__game; g.rig.zoomBy(1.6); });
await page.waitForTimeout(1500);
await h.shot('w-01-six-zoomed');
await game(() => { const g = window.__game; g.rig.zoomBy(1 / 1.6); });
// Walk to a new room at real speed and take a filmstrip
const door = await game(() => window.__game.closedDoors()[0].id);
await game(d => window.__game.openDoor(d), door);
const dest = await game(() => window.__game.hotelRooms().find(r => r !== 'hall'));
await game(() => window.__game.rig.zoomBy(1.5));
await page.waitForTimeout(800);
await game(d => window.__game.moveToRoom(d), dest);
const t0 = Date.now();
const samples = [];
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(250);
  const s = await game(() => { const m = window.__game.activeMover(); return { x: +m.x.toFixed(2), z: +m.z.toFixed(2), heading: +(m.heading ?? 0).toFixed(2), walking: m.walking }; });
  samples.push(s);
  await page.screenshot({ path: `shots/qa/w-walk-${String(i).padStart(2, '0')}.png` });
  if (i === 4) await game(() => window.__game.rotate(1));
}
console.log('walk samples', JSON.stringify(samples), 'ms', Date.now() - t0);
await h.settle(60000);
await page.waitForTimeout(1500);
await h.shot('w-02-arrived-after-rotate');
// Busy scene: reveal everything, all guests spread in rooms
await game(() => {
  const g = window.__game;
  for (const t of ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit']) g.revealTile(t);
});
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 120000, polling: 500 }).catch(() => {});
await game(() => window.__game.rig.zoomBy(0.4));
await page.waitForTimeout(2500);
const perf = await game(() => new Promise(res => {
  const g = window.__game, r = g.view.renderer;
  let n = 0, t0 = performance.now(), worst = 0, last = t0, calls = [], tris = [];
  const f = () => { const now = performance.now(); worst = Math.max(worst, now - last); last = now; calls.push(r.info.render.calls); tris.push(r.info.render.triangles); if (++n >= 30) res({ fps: +(n * 1000 / (now - t0)).toFixed(1), worst: Math.round(worst), calls: Math.max(...calls), tris: Math.max(...tris), geos: r.info.memory.geometries, tex: r.info.memory.textures, programs: r.info.programs.length, lights: (() => { let k = 0; g.view.scene.traverse(o => { if (o.isLight) k++; }); return k; })(), meshes: (() => { let k = 0; g.view.scene.traverse(o => { if (o.isMesh) k++; }); return k; })(), pr: r.getPixelRatio() }); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
}));
console.log('busy scene zoomed out', JSON.stringify(perf), 'readout:', await page.evaluate(() => document.querySelector('.perf-stats')?.textContent));
await h.shot('w-03-busy-zoomed-out');
await game(() => window.__game.rig.zoomBy(2.5));
await page.waitForTimeout(1500);
const perf2 = await game(() => new Promise(res => { const r = window.__game.view.renderer; let n = 0; const t0 = performance.now(); const f = () => { if (++n >= 20) res({ fps: +(n * 1000 / (performance.now() - t0)).toFixed(1), calls: r.info.render.calls, tris: r.info.render.triangles }); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
console.log('busy scene normal zoom', JSON.stringify(perf2), 'readout:', await page.evaluate(() => document.querySelector('.perf-stats')?.textContent));
await h.shot('w-04-busy-normal');
console.log('log', h.log.slice(0, 5));
await browser.close();
