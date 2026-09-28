import { launch, newPage } from './qa-lib.mjs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
await h.load('seed=4242&timer=off', { pr: 1 });
await h.begin();
await game(() => { for (const t of ['lounge', 'ballroom', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor', 'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'backCorridor', 'cloakroom', 'cornerCorridor', 'infirmary1', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit']) window.__game.revealTile(t); for (const r of [...window.__game.state.lockedRooms]) window.__game.state.lockedRooms.delete(r); window.__game.doorways.sync(); });
for (const id of ['storage', 'serviceCorridor', 'corridorN', 'stairs']) {
  await h.put(id, 4); await h.snapCam(); await page.waitForTimeout(800);
  // tap the first usable/closed door ring that is on screen
  const rings = await game(() => { const g = window.__game; const out = []; for (const v of g.doorways.views.values()) if (v.blink.visible) { const p = g.groundToScreen(v.blink.position.x, v.blink.position.z); out.push(p); } return out; });
  let opened = false;
  for (const p of rings) {
    if (p.x < 10 || p.y < 10 || p.x > 1170 || p.y > 810) continue;
    const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName, p);
    if (top !== 'CANVAS') continue;
    await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(300);
    if (await h.visible('#confirm-bar')) { opened = true; break; }
  }
  const r = await page.evaluate(() => { const b = document.getElementById('btn-confirm-move').getBoundingClientRect(); const s = document.querySelector('#search-spot .ss-badge')?.getBoundingClientRect(); const cx = b.left + b.width / 2, cy = b.top + b.height / 2; const el = document.elementFromPoint(cx, cy); return { move: [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)], icon: s ? [Math.round(s.left), Math.round(s.top), Math.round(s.right), Math.round(s.bottom)] : null, onTop: el ? (el.closest('#search-spot') ? 'SEARCH ICON' : el.closest('button')?.id || el.tagName) : null }; });
  console.log(id, 'confirm open', opened, JSON.stringify(r));
  await h.shot(`confirm-${id}`);
  await page.click('#btn-confirm-cancel', { force: true }).catch(() => {});
}
await browser.close();
