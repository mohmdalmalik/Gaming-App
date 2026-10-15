import { launch, newPage } from './qa-lib.mjs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
await h.load('seed=4242&timer=off', { pr: 1 });
await h.begin();
await game(() => { for (const t of ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit']) window.__game.revealTile(t); for (const r of [...window.__game.state.lockedRooms]) window.__game.state.lockedRooms.delete(r); window.__game.doorways.sync(); });
for (const id of ['storage', 'serviceCorridor', 'corridorN', 'stairs']) {
  await h.put(id, 4); await h.snapCam(); await page.waitForTimeout(800);
  // tap the first neighbouring room that can be tapped (a move: the confirm bar comes up)
  const spots = await game(() => { const g = window.__game, r = g.floor.rooms.get(g.activePlayer().currentRoom); return [...r.neighbours].map(id => g.tapPointFor({ room: id })).filter(Boolean); });
  let opened = false;
  for (const p of spots) {
    await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(300);
    if (await h.visible('#confirm-bar')) { opened = true; break; }
  }
  const r = await page.evaluate(() => { const b = document.getElementById('btn-confirm-move').getBoundingClientRect(); const s = document.querySelector('#search-spot .ss-badge')?.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2; const el = document.elementFromPoint(cx, cy); return { move: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], icon: s ? [Math.round(s.left), Math.round(s.top), Math.round(s.right), Math.round(s.bottom)] : null, onTop: el ? (el.closest('#search-spot') ? 'SEARCH ICON' : el.closest('button')?.id || el.tagName) : null }; });
  console.log(id, 'confirm open', opened, JSON.stringify(r));
  await h.shot(`confirm-${id}`);
  await page.click('#btn-confirm-cancel', { force: true }).catch(() => {});
}
await browser.close();
