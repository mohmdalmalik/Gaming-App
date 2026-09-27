// QA: can the guest be hidden behind furniture / walls? For every room and the 4 camera rotations,
// stand the guest on a grid of walkable spots and raycast from the camera to the guest's head and chest.
import { launch, newPage } from './qa-lib.mjs';
import fs from 'node:fs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
await h.load('seed=4242&timer=off', { pr: 0.5 });
await h.begin();
await game(() => {
  const ts = ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit'];
  for (const t of ts) window.__game.revealTile(t);
  for (const r of [...window.__game.state.lockedRooms]) window.__game.state.lockedRooms.delete(r);
  window.__game.doorways.sync();
});
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 120000, polling: 500 }).catch(() => {});
const rooms = await game(() => window.__game.hotelRooms());
const out = [];
for (let rot = 0; rot < 4; rot++) {
  if (rot) { await game(() => window.__game.rotate(1)); }
  for (const id of rooms) {
    await h.put(id, 4);
    await h.snapCam();
    await page.waitForTimeout(rot && id === rooms[0] ? 1500 : 450);   // walls ease down
    const res = await page.evaluate(async id => {
      const THREE = await import('three');
      const g = window.__game, room = g.floor.rooms.get(id), cam = g.view.camera, grid = g.grid;
      const ray = new THREE.Raycaster();
      const me = g.characters[g.state.activeIndex].group;
      const hidden = [];
      let n = 0;
      const [cx, cz] = room.center;
      for (let dx = -3.3; dx <= 3.31; dx += 0.55) for (let dz = -3.3; dz <= 3.31; dz += 0.55) {
        const x = cx + dx, z = cz + dz, c = grid.cellAt(x, z);
        if (c < 0 || !grid.walkable[c] || grid.roomIdOf(c) !== id) continue;
        n++;
        let blocked = 0, by = null;
        for (const y of [1.45, 1.0]) {
          const target = new THREE.Vector3(x, y, z);
          const dir = target.clone().sub(cam.position); const dist = dir.length(); dir.normalize();
          ray.set(cam.position, dir); ray.far = dist - 0.35;
          const hits = ray.intersectObjects(g.view.scene.children, true).filter(hh => {
            let o = hh.object; while (o) { if (o === me) return false; if (o.visible === false) return false; o = o.parent; } return hh.object.isMesh && !(hh.object.material && hh.object.material.transparent && hh.object.material.opacity < 0.5);
          });
          if (hits.length) { blocked++; by = by || (hits[0].object.name || hits[0].object.parent?.name || hits[0].object.geometry?.type); }
        }
        if (blocked === 2) hidden.push({ x: +dx.toFixed(2), z: +dz.toFixed(2), by });
      }
      return { id, n, hidden };
    }, id);
    res.rot = rot;
    if (res.hidden.length) console.log(rot, id, `${res.hidden.length}/${res.n} spots fully hidden`, JSON.stringify(res.hidden.slice(0, 4)));
    out.push(res);
  }
}
fs.writeFileSync('shots/qa/occlusion.json', JSON.stringify(out, null, 1));
console.log('log', h.log.slice(0, 5));
await browser.close();
