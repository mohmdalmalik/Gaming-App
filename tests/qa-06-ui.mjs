// QA: practice-mode UI edge cases with screenshots. node qa-06-ui.mjs [vp]
import { launch, newPage, HUD_SELS } from './qa-lib.mjs';
const VP = process.argv[2] || 'air';
const browser = await launch();
const h = await newPage(browser, VP);
const { page, game } = h;
const log = (...a) => console.log(...a);
const S = n => h.shot(`ui-${n}-${VP}`);
const st = () => game(() => { const g = window.__game, p = g.activePlayer(); return { room: p.currentRoom, ap: p.actionPoints, hp: p.health, turn: g.state.turn, round: g.state.round, hand: p.hand.map(c => c.type).join(','), fin: g.isFinished() }; });
const toast = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });
const audit = async tag => { const a = await h.audit(); const o = await h.overlaps(HUD_SELS); if (a.length || o.length) log(`  [${tag}] audit`, JSON.stringify(a), JSON.stringify(o)); };
const C = (id, type) => ({ id, type, ...(type === 'revolver' ? { shots: 2 } : {}) });
const fan = async () => page.$$eval('#hand-fan .fan-card', els => els.map(e => { const r = e.getBoundingClientRect(); return [e.dataset.type, Math.round(r.left), Math.round(r.top), Math.round(r.width)]; }));

await h.load('seed=31337', { pr: 1 });
await h.begin();
await page.waitForTimeout(800);
log('1. lobby', JSON.stringify(await st()));
// lobby doors: are their rings reachable?
const doors = await game(() => window.__game.closedDoors().map(d => ({ id: d.id, side: d.side, s: window.__game.groundToScreen(d.center[0], d.center[1]) })));
for (const d of doors) {
  const top = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !el ? 'offscreen' : el.tagName === 'CANVAS' ? 'canvas' : (el.closest('[id]')?.id || el.className); }, d.s);
  log(`  lobby door ${d.side} ring at ${Math.round(d.s.x)},${Math.round(d.s.y)} -> ${top}`);
}
await S('01-lobby');
await audit('lobby');

// 2. Restart practice: is there a confirmation?
await game(() => window.__game.openDoor(window.__game.closedDoors()[0].id));
const before = await st();
await h.tap('#btn-restart-practice');
await page.waitForTimeout(300);
const after = await st();
log('2. restart button: before', JSON.stringify(before), 'after', JSON.stringify(after), 'confirm visible?', await h.visible('.overlay:not([hidden]) .modal'));
await S('02-after-restart');

// 3. Hand fan with 1, 4, 8 cards + card view
for (const n of [1, 4, 8]) {
  const types = ['lantern', 'flashlight', 'bandage', 'revolver', 'masterKey', 'espresso', 'handMirror', 'barricade'].slice(0, n);
  await h.setHand(0, types.map((t, i) => C(`f${i}`, t)));
  await page.waitForTimeout(700);
  log(`3. fan ${n}`, JSON.stringify(await fan()));
  await S(`03-fan-${n}`);
  await audit(`fan${n}`);
}
// hover/press a card
const fc = await page.$('#hand-fan .fan-card:nth-child(4)');
const bb = await fc.boundingBox();
await page.mouse.move(bb.x + bb.width / 2, bb.y + 20); await page.mouse.down(); await page.waitForTimeout(250);
await S('03-fan-pressed');
await page.mouse.up(); await page.waitForTimeout(300);
if (!(await game(() => window.__game.cardViewOpen()))) await page.click('#hand-fan .fan-card:nth-child(4)');
await page.waitForTimeout(300);
log('3b. card view open', await game(() => window.__game.cardViewOpen()), await game(() => window.__game.cardViewId()));
await S('03-cardview');
await audit('cardview');
await h.tap('#btn-hand-next'); await h.tap('#btn-hand-next');
await S('03-cardview-next2');
// tap outside to close
await page.mouse.click(20, 20); await page.waitForTimeout(200);
log('3c. closed by tapping outside?', !(await game(() => window.__game.cardViewOpen())));
if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');

// 4. Map with several rooms
for (const t of ['lounge', 'infirmary1', 'switchboard', 'linenStore1', 'storage', 'cloakroom', 'exit']) await game(t => window.__game.revealTile(t), t);
await h.tap('#btn-map'); await page.waitForTimeout(500);
await S('04-map');
await audit('map');
await h.tap('#btn-map-close'); await page.waitForTimeout(200);

// 5. Camera rotations (mid-rotation + after)
await h.tap('#btn-rotate-right'); await page.waitForTimeout(90); await S('05-rot-mid');
await page.waitForTimeout(1200); await S('05-rot-after');
await h.tap('#btn-rotate-left'); await page.waitForTimeout(1200);

// 6. Walk to lounge and search via the icon; reveal
const walkTo = await game(() => { const g = window.__game; const n = [...g.floor.rooms.get('hall').neighbours].map(id => g.floor.rooms.get(id)).find(r => r.searchable !== false && !r.dark && !g.state.lockedRooms.has(r.id) && !r.isExit); if (n) return n.id; g.openDoor(g.closedDoors()[0].id); return [...g.floor.rooms.get('hall').neighbours].find(id => !g.state.lockedRooms.has(id)); });
console.log('6. walking to', walkTo);
await h.setHand(0, [C('b1', 'bandage')]);
const r6 = await game(id => window.__game.moveToRoom(id), walkTo);
await h.settle(); await page.waitForTimeout(600); await h.snapCam();
log('6. in dining', JSON.stringify(await st()), 'spot', JSON.stringify(await game(() => window.__game.searchSpot())));
await S('06-dining-icon');
await h.searchHere();
await page.waitForTimeout(400);
log('6b. reveal kind', await h.kind(), await page.evaluate(() => document.getElementById('handoff-title').textContent));
await S('06-found-reveal');
await audit('reveal');
// double tap "Add to my hand"
await page.dblclick('#btn-handoff-next'); await page.waitForTimeout(300);
log('6c. after double tap Add', JSON.stringify(await st()), 'handoff', await h.kind());

// 7. Dark room with and without a Flashlight
await game(() => { window.__game.revealTile('serviceCorridor'); });
await h.put('serviceCorridor', 4); await h.setHand(0, [C('b1', 'bandage')]); await h.snapCam(); await page.waitForTimeout(700);
log('7. dark no flashlight', JSON.stringify(await game(() => window.__game.searchSpot().mode)));
await S('07-dark-noflash');
await page.click('#search-spot'); await page.waitForTimeout(250);
log('7b. toast', await toast(), JSON.stringify(await st()));
await S('07-dark-tap-toast');
await h.setHand(0, [C('b1', 'bandage'), C('fl', 'flashlight')]); await page.waitForTimeout(400);
log('7c. dark with flashlight', await game(() => window.__game.searchSpot().mode));
await S('07-dark-flash');

// 8. Locked rooms: master key and lock pick
await h.put('hall', 4);
const lk = await game(() => { const g = window.__game; const n = g.floor.rooms.get('hall').neighbours; return [...n].filter(id => g.state.lockedRooms.has(id)); });
log('8. locked next to hall', lk, 'all locked', await game(() => window.__game.lockedRooms()));
const lockedId = (await game(() => window.__game.lockedRooms()))[0];
if (lockedId) {
  const nb = await game(id => [...window.__game.floor.rooms.get(id).neighbours][0], lockedId);
  await h.put(nb, 4); await h.setHand(0, [C('mk', 'masterKey'), C('lp', 'lockPick')]); await h.snapCam(); await page.waitForTimeout(600);
  await S('08-locked-next-door');
  // tap on the locked doorway ring
  const dc = await game(({ nb, id }) => { const g = window.__game; const d = g.floor.rooms.get(nb).doorways.find(d => d.a === id || d.b === id); const c = g.roomCenter(nb); const k = 0.7 / Math.hypot(c[0] - d.center[0], c[1] - d.center[1]); return { door: g.groundToScreen(d.center[0], d.center[1]), inside: g.groundToScreen(d.center[0] + (c[0] - d.center[0]) * k, d.center[1] + (c[1] - d.center[1]) * k) }; }, { nb, id: lockedId });
  const topAt = p => page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); return !el ? 'offscreen' : el.tagName === 'CANVAS' ? 'canvas' : (el.closest('[id]')?.id || el.className); }, p);
  log('8a. locked door centre', JSON.stringify(dc.door), await topAt(dc.door), 'inside point', JSON.stringify(dc.inside), await topAt(dc.inside));
  await page.touchscreen.tap(dc.inside.x, dc.inside.y); await page.waitForTimeout(250);
  log('8b. tap locked door toast:', await toast(), 'cardview?', await game(() => window.__game.cardViewOpen()));
  if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');
  await S('08-locked-tap');
  await page.click('#hand-fan .fan-card[data-type="lockPick"]'); await page.waitForTimeout(300);
  await S('08-cardview-lockpick');
  const btns = await page.$$eval('#hand-detail .btn', bs => bs.map(b => b.textContent));
  log('8c. lock pick buttons', btns);
  if (btns.length) { await page.click('#hand-detail .btn'); await page.waitForTimeout(300); log('8d. pick result toast:', await toast(), 'locked now', await game(() => window.__game.lockedRooms())); }
  await S('08-after-pick');
  if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');
  if ((await game(() => window.__game.lockedRooms())).includes(lockedId)) {
    await page.click('#hand-fan .fan-card[data-type="masterKey"]'); await page.waitForTimeout(300);
    await page.click('#hand-detail .btn'); await page.waitForTimeout(300);
    log('8e. master key toast:', await toast(), 'locked now', await game(() => window.__game.lockedRooms()));
    await S('08-after-key');
  }
  if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');
}

// 9. Barricade
await h.put('hall', 4); await h.setHand(0, [C('bc', 'barricade')]); await h.snapCam(); await page.waitForTimeout(400);
await page.click('#hand-fan .fan-card[data-type="barricade"]'); await page.waitForTimeout(300);
log('9. barricade options', await page.$$eval('#hand-detail .btn', bs => bs.map(b => b.textContent)));
await S('09-barricade-options');
await page.click('#hand-detail .btn'); await page.waitForTimeout(400);
log('9b. toast', await toast(), JSON.stringify(await st()));
await S('09-barricaded');
if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');

// 10. Hand-limit discard at end of turn
await h.setHand(0, ['lantern', 'lantern', 'bandage', 'knife', 'flashlight', 'espresso', 'lockPick', 'barricade'].map((t, i) => C(`d${i}`, t)));
await page.waitForTimeout(400); await S('10-fan-8');
await h.tap('#btn-end-turn'); await page.waitForTimeout(400);
log('10. discard open', await h.visible('#discard-overlay'), await page.textContent('#discard-sub'));
await S('10-discard');
await audit('discard');
await page.click('#discard-cards .card-tile:nth-child(3)'); await page.waitForTimeout(150);
await S('10-discard-one');
await page.click('#discard-cards .card-tile:nth-child(3)'); await page.waitForTimeout(150);
await h.tap('#btn-discard-done'); await page.waitForTimeout(300);
log('10b. after', JSON.stringify(await st()));

// 11. Full-hand search prompt
await game(() => window.__game.revealTile('kitchen'));
await h.put('kitchen', 4); await h.setHand(0, ['bandage', 'knife', 'flashlight', 'espresso', 'lockPick', 'barricade'].map((t, i) => C(`e${i}`, t)));
await game(() => window.__game.stackDeck?.('x')); await h.snapCam(); await page.waitForTimeout(500);
await h.searchHere(); await page.waitForTimeout(300);
log('11. fullhand open', await game(() => window.__game.fullHandOpen()), await page.textContent('#fullhand-sub').catch(() => ''));
await S('11-fullhand');
if (await game(() => window.__game.fullHandOpen())) { await h.tap('#btn-fullhand-take'); await S('11-fullhand-drop'); await audit('fullhand-drop'); await h.tap('#btn-fullhand-cancel'); await h.tap('#btn-fullhand-leave'); log('11b. leave toast', await toast()); }
if (await h.handoffOpen()) { log('11c. reveal after full', await h.kind()); await S('11-reveal-after'); await h.tap('#btn-handoff-next'); }

// 12. Espresso
await h.put('hall', 1); await h.setHand(0, [C('es', 'espresso')]);
await page.click('#hand-fan .fan-card[data-type="espresso"]'); await page.waitForTimeout(300);
await S('12-espresso-card');
await page.click('#hand-detail .btn'); await page.waitForTimeout(300);
log('12. espresso', await toast(), JSON.stringify(await st()), await page.textContent('#action-points'));
if (await game(() => window.__game.cardViewOpen())) await h.tap('#btn-hand-close');
await S('12-espresso-ap');
await page.evaluate(() => document.querySelector('#ap-pips').outerHTML).then(x => log('   pips', x.slice(0, 300)));

// 13. Infirmary low and full health
await h.put('infirmary1', 4); await game(() => { window.__game.activePlayer().health = 1; window.__game.refresh(); }); await h.snapCam(); await page.waitForTimeout(500);
await S('13-infirmary-low');
await h.tap('#btn-room'); await page.waitForTimeout(300);
log('13. infirmary', await toast(), JSON.stringify(await st()));
await h.tap('#btn-room'); await page.waitForTimeout(300);
log('13b. infirmary again', await toast(), JSON.stringify(await st()), await page.textContent('#btn-room'));
await S('13-infirmary-full');

// 14. Switchboard in practice
await h.put('switchboard', 4); await h.snapCam(); await page.waitForTimeout(400);
await h.tap('#btn-room'); await page.waitForTimeout(300);
log('14. switchboard notice', await game(() => window.__game.noticeOpen()), await page.textContent('#notice-body').catch(() => ''));
await S('14-switchboard');
if (await game(() => window.__game.noticeOpen())) await h.tap('#btn-notice-ok');

// 15. Linen Store double draw
await h.put('linenStore1', 4); await h.setHand(0, [C('b', 'bandage')]); await h.snapCam(); await page.waitForTimeout(400);
await h.searchHere(); await page.waitForTimeout(300);
log('15. linen reveal', await page.textContent('#handoff-title').catch(() => ''), await page.$$eval('#handoff-found .big-card', e => e.length));
await S('15-linen-pair');
if (await h.handoffOpen()) await h.tap('#btn-handoff-next');

// 16. Rapid double taps: End turn double click, search double tap, confirm double tap
await h.put('hall', 4);
let s0 = await st();
await page.dblclick('#btn-end-turn'); await page.waitForTimeout(500);
let s1 = await st();
log('16. double End turn: turn', s0.turn, '->', s1.turn);
const cn = await game(() => { const g = window.__game; g.revealTile('corridorN'); return 'corridorN'; });
await h.put('corridorN', 4); await h.snapCam(); await page.waitForTimeout(400);
s0 = await st();
await page.dblclick('#search-spot').catch(e => log('dbl search err', e.message.split('\n')[0]));
await page.waitForFunction(() => !window.__game.searchPending() && !window.__game.activeMover().walking, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(400);
s1 = await st();
log('16b. double tap search: ap', s0.ap, '->', s1.ap, 'handoff', await h.kind());
if (await h.handoffOpen()) await h.tap('#btn-handoff-next');
// confirm-move double tap
await h.put('hall', 4); await h.snapCam(); await page.waitForTimeout(300);
const dN = await game(id => { const g = window.__game, d = g.floor.rooms.get('hall').doorways.find(d => d.a === id || d.b === id); const b = g.doorways.views.get(d.id)?.blink?.position; return b ? g.groundToScreen(b.x, b.z) : g.groundToScreen(d.center[0], d.center[1]); }, walkTo);
await page.touchscreen.tap(dN.x, dN.y); await page.waitForTimeout(200);
log('16c. confirm bar', await h.visible('#confirm-bar'), await page.textContent('#confirm-text'));
await S('16-confirm-bar');
s0 = await st();
if (await h.visible('#confirm-bar')) { await page.dblclick('#btn-confirm-move'); }
await h.settle(); await page.waitForTimeout(400);
s1 = await st();
log('16d. double confirm: ap', s0.ap, '->', s1.ap, s1.room);

// 17. rotate camera mid-walk
await h.put('hall', 4); await h.snapCam();
await game(id => window.__game.moveToRoom(id), walkTo);
await page.waitForTimeout(150); await h.tap('#btn-rotate-right'); await page.waitForTimeout(150); await S('17-rot-midwalk');
await h.settle(); await page.waitForTimeout(1200);
log('17. after rotate mid-walk', JSON.stringify(await st()));
await S('17-after');
await h.tap('#btn-rotate-left'); await page.waitForTimeout(1000);

// 18. resize / rotate device mid-game
await h.setHand(0, ['lantern', 'bandage', 'knife', 'flashlight', 'espresso'].map((t, i) => C(`r${i}`, t)));
for (const [w, hh] of [[820, 1180], [768, 1024], [1366, 1024], [1180, 820]]) {
  await page.setViewportSize({ width: w, height: hh }); await page.waitForTimeout(900);
  await S(`18-resize-${w}x${hh}`);
  await audit(`resize ${w}x${hh}`);
}
// mid-walk resize
await game(() => window.__game.moveToRoom('hall'));
await page.waitForTimeout(100); await page.setViewportSize({ width: 1024, height: 768 }); await h.settle(); await page.waitForTimeout(600);
log('18b. walked during resize', JSON.stringify(await st()));
await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(600);

// 19. Fire exit: arrive with 3 lanterns and 1 AP, then 0 AP
const nbExit = await game(() => [...window.__game.floor.rooms.get('exit').neighbours][0]);
await h.put(nbExit, 1); await h.setHand(0, [C('l1', 'lantern'), C('l2', 'lantern'), C('l3', 'lantern')]); await h.snapCam();
await game(() => window.__game.moveToRoom('exit')); await h.settle(); await page.waitForTimeout(600);
log('19. exit with 0 AP', JSON.stringify(await st()), 'toast', await toast(), 'btn', await page.textContent('#btn-room').catch(() => ''));
await S('19-exit-0ap');
await h.tap('#btn-room'); await page.waitForTimeout(200); log('19b. escape at 0 AP toast', await toast());
await h.tap('#btn-end-turn'); await page.waitForTimeout(400);
log('19c. next turn', JSON.stringify(await st()), await page.textContent('#btn-room').catch(() => ''));
await S('19-exit-next-turn');
await h.tap('#btn-room'); await page.waitForTimeout(800);
log('19d. finished', JSON.stringify(await st()), await page.textContent('#end-title'));
await S('19-end');
await audit('end');
// keep exploring? restart
await h.tap('#btn-restart'); await page.waitForTimeout(600);
log('20. after restart', JSON.stringify(await st()));
await S('20-restarted');
log('console', h.log);
await browser.close();
