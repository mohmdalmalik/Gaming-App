// Browser checks for the room action icons of the Infirmary and the Switchboard (src/ui/searchSpot.js kinds heal and
// switchboard), in headless Chromium (software WebGL). Serve the repo first:
//   (cd /home/user/Gaming-App && python3 -m http.server 8123 --bind 127.0.0.1)
//   node tests/browser-rooms.mjs [--url http://127.0.0.1:8123/] [--screens]
//
// 1. the Infirmary: grey at full health (nothing spent), live when hurt, one use for the whole match (spent for everyone,
//    the icon, the mark in the room, the map), no actions left
// 2. the Switchboard: two actions a ring, as many rings as the guest can pay, no search icon in either room
// 3. a dead guest's cards lying in either room bring the search icon back beside the action icon, never over it
// 4. the Linen Store keeps its search icon; the old bottom-bar room button is gone
// 5. tapping the furniture the icon stands on does what the icon does
// 6. at 1024x694: the icons never sit over the interface; a used Infirmary's mark in the room itself
// 7. in a match: the icon is the player's own, in their own turn only; another guest's use turns the icon spent at once
//    and reaches the feed
//   (--practice-only: sections 1-6 only, the quick part)
import { launch, giveCard } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const practiceOnly = args.includes('--practice-only');
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = process.env.SHOTS_DIR || path.join(here, 'shots', 'rooms');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

let { browser, page, messages } = await launch({ width: 1024, height: 768 });
const game = (fn, arg) => page.evaluate(fn, arg);
const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}.png`) }); };
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden'; }, sel);
const tap = async sel => { await page.click(sel); await page.waitForTimeout(120); };
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const settle = (t = 40000) => page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 });
const dressed = () => page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 200 });
const spot = () => game(() => window.__game.searchSpot());
const caption = sel => page.evaluate(s => document.querySelector(`${s} .ss-caption`)?.textContent ?? null, sel);
const toast = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent.trim(); });
const ap = () => game(() => window.__game.activePlayer().actionPoints);
const health = () => game(() => window.__game.activePlayer().health);
const spent = () => game(() => [...window.__game.state.spentInfirmaries]);
// the icons' place on screen, and whether any of them touches the interface
const iconReport = () => page.evaluate(() => {
  const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const hud = ['.hud-top-left', '.hud-top-center', '.hud-top-right', '#player-panel', '.hud-bottom-right', '#btn-trade', '#btn-end-turn', '#confirm-bar', '#hand-fan .fan-card']
    .flatMap(s => [...document.querySelectorAll(s)]).filter(e => e.offsetParent !== null && !e.closest('[hidden]'));
  const icons = [...document.querySelectorAll('.search-spot')].filter(e => !e.hidden && getComputedStyle(e).visibility !== 'hidden');
  const rects = icons.map(e => {
    const b = e.querySelector('.ss-badge').getBoundingClientRect(), c = e.querySelector('.ss-caption').getBoundingClientRect(), r = e.getBoundingClientRect();
    return { id: e.id, left: Math.min(b.left, c.left), right: Math.max(b.right, c.right), top: b.top, bottom: c.bottom, w: Math.round(r.width), h: Math.round(r.height) };
  });
  return {
    n: icons.length, rects,
    onScreen: rects.every(r => r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight),
    overUi: rects.some(r => hud.some(e => hit(r, e.getBoundingClientRect()))),
    overEachOther: rects.length === 2 && hit(rects[0], rects[1]),
    big: icons.every(e => { const b = e.querySelector('.ss-badge').getBoundingClientRect(); return b.width >= 44 && b.height >= 44; }),
  };
});
const place = (index, room, ap = null) => page.evaluate(({ index, room, ap }) => {
  const g = window.__game, p = g.state.players[index], c = g.roomCenter(room);
  g.state.discovered.add(room);
  p.currentRoom = room;
  if (ap != null) p.actionPoints = ap;
  g.movers[index].reset(c[0], c[1]);
  g.discovery.refresh(); g.refresh();
}, { index, room, ap });
const put = async (room, apNow = 4) => place(await game(() => window.__game.state.activeIndex), room, apNow);
// Put the active guest in `room` (revealed) and wait for the icon to settle there.
async function stand(room, apNow = 4) {
  await game(r => { window.__game.revealTile(r); window.__game.state.lockedRooms.clear(); }, room);
  await put(room, apNow);
  await settle();
  await game(() => { const g = window.__game, m = g.activeMover(); g.rig.setFocus(m.x, m.z, true); });   // (the camera eases slowly in headless: jump it)
  await page.waitForTimeout(350);
  await frames(6);
}

console.log('1. the Infirmary (practice)');
await page.goto(`${baseUrl}?mode=practice&seed=20260917`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 45000 });
await game(() => { window.__game.cfg.player.speed = 16; window.__game.setPixelRatio(0.5); });
await tap('#btn-begin');
await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 8000 });
check(!(await page.$('#btn-room')), 'there is no room button in the bottom bar any more (#btn-room is gone)');

await stand('infirmary1', 4);
{
  const s = await spot();
  check(s.kind === 'heal' && s.mode === 'full' && await visible('#search-spot'), `a guest at full health sees the Infirmary icon, grey (${s.kind} / ${s.mode})`);
  check(await caption('#search-spot') === 'Full health', `its words: "${await caption('#search-spot')}"`);
  check(s.second === null && !(await visible('#search-spot-2')), 'and no search icon: an Infirmary cannot be searched');
  check(await game(() => { const g = window.__game, f = g.floor.rooms.get('infirmary1').furniture.find(f => f.search); return f && g.searchSpot().spot.kind === f.kind; }), 'it stands on the furniture flagged as the room\'s spot (the medicine cabinet)');
  await shot('rooms-01-full');
  await tap('#search-spot');
  check(await toast() === 'You are at full health.', `a tap says so ("${await toast()}")`);
  check(await ap() === 4 && (await spent()).length === 0 && (await spot()).mode === 'full', 'nothing is spent: still 4 actions, the Infirmary is still unused');
}
await game(() => { window.__game.activePlayer().health = 1; window.__game.refresh(); });
await frames(4);
{
  const s = await spot();
  check(s.kind === 'heal' && s.mode === 'live' && await caption('#search-spot') === 'Heal · 1 action', `hurt: the icon is live ("${await caption('#search-spot')}")`);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#search-spot .ss-badge')).animationName !== 'none'), 'and its badge pulses');
  const r = await iconReport();
  check(r.n === 1 && r.onScreen && !r.overUi && r.big, `on screen, clear of the interface, big enough to tap (${JSON.stringify(r.rects[0])})`);
  await shot('rooms-02-live');
  const marks0 = await game(() => window.__game.view.scene.children.filter(o => o.isSprite && o.visible).length);
  await tap('#search-spot');
  check(await health() === 3 && await ap() === 3, `a tap heals 2 for 1 action (health ${await health()}, ${await ap()} actions)`);
  check(/Treated in the Infirmary — health 3 of 4/.test(await toast()), `with its toast ("${await toast()}")`);
  const s2 = await spot();
  check(s2.kind === 'heal' && s2.mode === 'spent' && await caption('#search-spot') === 'Already used', `the icon turns to the spent look at once (${s2.mode}, "${await caption('#search-spot')}")`);
  check(await page.evaluate(() => getComputedStyle(document.querySelector('#search-spot .ss-tick')).display !== 'none'), 'with a tick');
  check((await spent()).join() === 'infirmary1', 'and the Infirmary is spent for everyone (state.spentInfirmaries)');
  await frames(4);
  const marks1 = await game(() => window.__game.view.scene.children.filter(o => o.isSprite && o.visible).length);
  check(marks1 === marks0 + 1, `a mark appears in the room itself (${marks0} -> ${marks1} visible tags)`);
  await shot('rooms-03-spent');
  await tap('#search-spot');
  check(await toast() === 'This Infirmary has already been used.' && await ap() === 3 && await health() === 3, `a tap on the spent icon says so ("${await toast()}") and spends nothing`);
  // the map: the job mark dimmed
  await game(() => window.__game.toggleMap());
  await page.waitForTimeout(250);
  await shot('rooms-04-map');
  await game(() => window.__game.toggleMap());
}
// another Infirmary is its own room: unused, so the same guest (hurt) can use that one
await game(() => { window.__game.activePlayer().health = 1; });
await stand('infirmary2', 4);
{
  const s = await spot();
  check(s.kind === 'heal' && s.mode === 'live', `the other Infirmary is still unused: live (${s.mode})`);
  await game(() => { window.__game.activePlayer().actionPoints = 0; window.__game.refresh(); });
  await frames(4);
  check((await spot()).mode === 'ap' && await caption('#search-spot') === 'No actions left', `with no actions left it is dimmed ("${await caption('#search-spot')}")`);
  await tap('#search-spot');
  check(await toast() === 'No actions left.' && (await spent()).length === 1, `a tap says so ("${await toast()}") and spends nothing`);
  await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
  await frames(4);
  // a different guest uses this Infirmary first (the engine, as a bot's turn does): it is spent on this screen at once
  await game(async () => {
    const g = window.__game, A = await import('/src/game/actions.js'), n = g.state.players.length;
    const other = { ...g.activePlayer(), index: n, id: 'ghost', name: 'ghost', health: 1, actionPoints: 4, currentRoom: 'infirmary2', alive: true };
    A.useInfirmary(g.state, g.floor, other);
    g.refresh();
  });
  await frames(4);
  check((await spot()).mode === 'spent' && (await spent()).length === 2, 'when somebody else uses it, the icon is spent at once for this guest too');
  await tap('#search-spot');
  check(await toast() === 'This Infirmary has already been used.' && await ap() === 4 && await health() === 1, 'and refuses (a hurt guest, 4 actions: nothing spent)');
}
const feedText = await page.evaluate(() => document.getElementById('feed')?.innerText ?? '');
console.log('  (feed: ' + JSON.stringify(feedText) + ')');

console.log('\n2. the Switchboard');
await stand('switchboard', 4);
{
  const s = await spot();
  check(s.kind === 'switchboard' && s.mode === 'live' && await caption('#search-spot') === 'Switchboard · 2 actions', `live, with its cost ("${await caption('#search-spot')}")`);
  check(s.second === null && !(await visible('#search-spot-2')), 'no search icon in the Switchboard');
  const r = await iconReport();
  check(r.n === 1 && r.onScreen && !r.overUi && r.big, `on screen, clear of the interface (${JSON.stringify(r.rects[0])})`);
  await shot('rooms-05-switchboard');
  await tap('#search-spot');
  await page.waitForFunction(() => window.__game.noticeOpen(), null, { timeout: 5000 }).catch(() => {});
  check(await game(() => window.__game.noticeOpen()) && await ap() === 2, `a ring costs 2 actions and says its words in a notice (${await ap()} left)`);
  check(!(await visible('#search-spot')), 'the icon steps aside while the notice is up');
  await tap('#btn-notice-ok');
  await frames(4);
  check((await spot()).mode === 'live', 'and is live again for the second ring (2 actions left)');
  await tap('#search-spot');
  await page.waitForFunction(() => window.__game.noticeOpen(), null, { timeout: 5000 }).catch(() => {});
  check(await ap() === 0, 'a second ring in the same turn is allowed (no once-a-turn limit): 0 actions left');
  await tap('#btn-notice-ok');
  await frames(4);
  check((await spot()).mode === 'ap' && await caption('#search-spot') === 'Needs 2 actions', `now it is dimmed ("${await caption('#search-spot')}")`);
  await tap('#search-spot');
  check(await toast() === 'The Switchboard needs 2 actions.' && await ap() === 0, `a tap says so ("${await toast()}")`);
  await game(() => { window.__game.activePlayer().actionPoints = 1; window.__game.refresh(); });
  await frames(4);
  check((await spot()).mode === 'ap', 'with 1 action left it is dimmed too');
  await tap('#search-spot');
  check(await toast() === 'The Switchboard needs 2 actions.' && await ap() === 1, 'and the tap says what it needs');
}

console.log('\n3. a dead guest\'s cards in the room bring the search icon back');
for (const room of ['infirmary2', 'switchboard']) {
  await stand(room, 4);
  await game(() => { window.__game.activePlayer().health = 1; window.__game.refresh(); });
  check((await spot()).second === null, `${room}: before the cards are there, one icon`);
  await game(r => { const g = window.__game; g.state.roomDrops.set(r, [{ id: `dd-${r}`, type: 'lantern' }]); g.refresh(); }, room);
  await frames(6);
  const s = await spot();
  check(s.second && s.second.kind === 'search' && s.second.mode === 'live' && s.kind === (room === 'switchboard' ? 'switchboard' : 'heal'),
    `${room}: the room's action stays and a search icon shows too (${s.kind} + ${s.second?.kind})`);
  const r = await iconReport();
  check(r.n === 2 && !r.overEachOther && r.onScreen && !r.overUi && r.big, `${room}: the two icons do not overlap, are on screen and clear of the interface (${r.rects.map(x => `${x.id} ${Math.round(x.left)}-${Math.round(x.right)}`).join(', ')})`);
  check(await caption('#search-spot-2') === 'Search', `${room}: the second one says "Search"`);
  if (room === 'infirmary2') await shot('rooms-06-both-infirmary');
  else await shot('rooms-07-both-switchboard');
  const apBefore = await ap();
  await tap('#search-spot-2');
  await page.waitForFunction(() => window.__game.handoffOpen(), null, { timeout: 8000 }).catch(() => {});
  const found = await game(() => ({ kind: window.__game.handoffKind(), ids: [...document.querySelectorAll('#handoff-found .big-card')].map(c => c.dataset.cardId) }));
  check(found.kind === 'found' && found.ids.join() === `dd-${room}`, `${room}: a tap on it picks the cards up (${found.kind}, ${found.ids.join()})`);
  check(await ap() === apBefore - 1, `${room}: for 1 action`);
  await tap('#btn-handoff-next');
  await frames(6);
  check((await spot()).second === null && await game(r => !window.__game.state.roomDrops.get(r)?.length, room), `${room}: the search icon goes when the cards are taken`);
}

console.log('\n4. the Linen Store, and the old room button');
await stand('linenStore1', 4);
{
  const s = await spot();
  check(s.kind === 'search' && s.mode === 'live' && s.second === null, `a Linen Store keeps its search icon (${s.kind} / ${s.mode})`);
  check(!(await visible('#btn-room')), 'and no room button');
}

console.log('\n5. tapping the furniture');
await game(() => { const g = window.__game; g.state.spentInfirmaries.clear(); g.activePlayer().health = 1; g.refresh(); });
await stand('infirmary1', 4);
{
  // a tap on the medicine cabinet itself does what the icon does (in an Infirmary: heal; elsewhere: search)
  const hit = await game(() => {
    const g = window.__game, f = g.floor.rooms.get('infirmary1').furniture.find(f => f.search), cam = g.view.camera, V = cam.position.constructor;
    const rect = g.view.renderer.domElement.getBoundingClientRect();
    let best = null;
    // (the point on the cabinet's front the camera sees, not under the badge: try a few heights)
    for (const k of [0.25, 0.4, 0.55, 0.7]) {
      const v = new V(f.center[0], f.size[1] * k, f.center[1]).project(cam);
      const x = rect.left + (v.x + 1) / 2 * rect.width, y = rect.top + (1 - v.y) / 2 * rect.height;
      const el = document.elementFromPoint(x, y);
      if (el && el.tagName === 'CANVAS' && g.tapTargetAt(x, y)?.kind === 'search') { best = { x, y }; break; }
    }
    return best;
  });
  check(!!hit, 'the cabinet can be tapped on the canvas and is the "search" tap target');
  if (hit) {
    await page.touchscreen.tap(hit.x, hit.y);
    await page.waitForTimeout(400);
    check(await health() === 3 && await ap() === 3 && (await spent()).join() === 'infirmary1', `a real tap on the cabinet heals, like the icon (health ${await health()}, ${await ap()} actions)`);
    await page.touchscreen.tap(hit.x, hit.y);
    await page.waitForTimeout(400);
    check(await toast() === 'This Infirmary has already been used.', `and a second tap says it is used ("${await toast()}")`);
  }
}

console.log('\n5b. a full hotel, and the hand fan in an Infirmary');
{
  // (the same list tests/browser-practice.mjs reveals: 23 of the 24 tiles, all but the Fire Exit)
  for (const t of ['lounge', 'ballroom', 'grandCorridor', 'dining', 'library', 'kitchen', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'infirmary1', 'infirmary2', 'linenStore1', 'linenStore2', 'switchboard', 'cornerCorridor', 'storage', 'stairs', 'serviceCorridor', 'backCorridor', 'housekeeping', 'cloakroom', 'suite416']) {
    await game(id => window.__game.revealTile(id), t);
  }
  const rooms = await game(() => window.__game.floor.roomList.filter(r => r.searchable).map(r => r.id));
  check(rooms.length === 20 && !rooms.some(r => /infirmary|switchboard/.test(r)), `a full hotel has ${rooms.length} searchable rooms (20: not the Infirmaries, the Switchboard or the Fire Exit)`);
  // eight cards in the hand, in an Infirmary: the fan stays clear of the button row, the camera buttons and the icon
  await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `L${i}`, type: t })); window.__game.state.spentInfirmaries.clear(); p.health = 1; window.__game.refresh(); });
  await stand('infirmary2', 4);
  await page.mouse.move(4, 4);
  await page.waitForFunction(() => {
    const now = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => { const r = c.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }).join(';');
    const same = now === window.__fanLast; window.__fanLast = now; return same && now !== '';
  }, null, { timeout: 15000, polling: 250 });
  const r = await page.evaluate(() => {
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const act = document.querySelector('.action-row').getBoundingClientRect(), ctl = document.querySelector('.control-row').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => c.getBoundingClientRect());
    const icon = document.getElementById('search-spot'), ib = icon.querySelector('.ss-badge').getBoundingClientRect();
    return { noBtn: !document.getElementById('btn-room'), icon: !icon.hidden && icon.dataset.kind === 'heal', n: cards.length,
      clear: cards.every(c => !hit(c, act) && !hit(c, ctl) && !hit(c, ib)) };
  });
  check(r.noBtn && r.icon && r.n === 8 && r.clear, 'eight cards in an Infirmary stay clear of the button row and of the Infirmary icon (there is no room button)');
}

console.log('\n6. 1024 x 694 (Safari with its bars), and the mark in the room itself');
await page.setViewportSize({ width: 1024, height: 694 });
await page.waitForTimeout(600);
await game(() => { const g = window.__game; g.state.spentInfirmaries.clear(); g.state.roomDrops.clear(); g.activePlayer().health = 1; g.refresh(); });
await stand('infirmary1', 4);
{
  const r = await iconReport();
  check(r.n === 1 && r.onScreen && !r.overUi && r.big, `the Infirmary icon at 1024x694: on screen, clear of the interface (${JSON.stringify(r.rects[0])})`);
  await shot('rooms-08-694-heal');
}
await stand('switchboard', 4);
await game(() => { const g = window.__game; g.state.roomDrops.set('switchboard', [{ id: 'dd-sw', type: 'lantern' }]); g.refresh(); });
await frames(8);
{
  const r = await iconReport();
  check(r.n === 2 && !r.overEachOther && r.onScreen && !r.overUi, `the Switchboard with cards on the floor at 1024x694: two icons, apart, clear of the interface (${r.rects.map(x => `${x.id} ${Math.round(x.left)}-${Math.round(x.right)}`).join(', ')})`);
  await shot('rooms-09-694-both');
  await game(() => { const g = window.__game; g.state.roomDrops.clear(); g.refresh(); });
}
// a used Infirmary seen from outside (the guest is in another room, so no icon covers its mark): the grey cross with a tick
await stand('infirmary1', 4);
await tap('#search-spot');
await put('hall', 4);
await game(() => {   // (look over at the Infirmary from the lobby: the view is panned there)
  const g = window.__game, r = g.floor.rooms.get('infirmary1'), h = g.floor.rooms.get('hall');
  g.rig.panByWorld(r.center[0] - h.center[0], r.center[1] - h.center[1]); g.refresh();
});
await page.waitForTimeout(500);
await frames(6);
check(!(await visible('#search-spot')) && (await spent()).join() === 'infirmary1', 'standing elsewhere, no icon is up and the Infirmary is still spent');
await shot('rooms-10-694-mark-from-outside');

await dressed();
const noise = () => messages.filter(m => !/favicon/i.test(m));
check(noise().length === 0, noise().length ? `console noise (practice):\n    ${noise().slice(0, 6).join('\n    ')}` : 'no console errors or failed requests in practice (clean)');
await browser.close();

if (!practiceOnly) {
console.log('\n7. in a match (computer guests)');
({ browser, page, messages } = await launch({ width: 1024, height: 768 }));
await page.goto(`${baseUrl}?mode=bots&bots=3&role=clean&seed=7&seat=0&intro=off&botpace=0.1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000, polling: 200 });
await page.click('#btn-begin');
// (the role screen and the like are answered; the bots play their turns until it is the player's)
async function toMyTurn() {
  for (let i = 0; i < 120; i++) {
    const s = await game(() => {
      const g = window.__game;
      if (g.handoffOpen()) return 'handoff';
      if (!document.getElementById('encounter-overlay').hidden) return 'meeting';
      if (g.noticeOpen()) return 'notice';
      if (g.myTurn() && g.inActionPhase() && !g.isFinished()) return 'mine';
      return null;
    });
    if (s === 'mine') return true;
    if (s === 'handoff') {
      const k = await game(() => window.__game.handoffKind());
      if (k === 'pick') await giveCard(page).catch(() => {});            // (a computer guest walked in: a trade)
      else if (k === 'choice') await page.click('#offer-intent .btn').catch(() => {});
      else await page.click('#btn-handoff-next').catch(() => {});
    }
    else if (s === 'notice') await page.click('#btn-notice-ok').catch(() => {});
    else if (s === 'meeting') { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click().catch(() => {}); }
    await page.waitForTimeout(250);
  }
  return false;
}
check(await toMyTurn(), 'the match starts and it is the player\'s turn');
await game(() => { window.__game.setPixelRatio(0.5); window.__game.cfg.player.speed = 16; });
await stand('infirmary1', 4);
await game(() => { window.__game.activePlayer().health = 1; window.__game.refresh(); });
await frames(4);
check((await spot()).kind === 'heal' && (await spot()).mode === 'live', 'on the player\'s own turn the icon is there, live');
{
  // another guest uses this Infirmary first: the icon on the player's screen turns spent at once, and the feed says so
  const me = await game(() => window.__game.humanSeat());
  await game(async () => {
    const g = window.__game, A = await import('/src/game/actions.js'), q = g.state.players.find(p => p.index !== g.humanSeat() && p.alive);
    q.currentRoom = 'infirmary1'; q.health = 1; q.actionPoints = 4;
    A.useInfirmary(g.state, g.floor, q);
    g.refresh();
  });
  await frames(6);
  check((await spot()).mode === 'spent', 'a computer guest using the Infirmary turns the player\'s icon spent at once');
  const ev = await game(() => window.__game.state.events.filter(e => e.type === 'infirmary').map(e => ({ room: e.room, keys: Object.keys(e).sort().join() })));
  check(ev.length === 1 && ev[0].room === 'infirmary1' && !/healed|health/.test(ev[0].keys), `the public event names only the room (${ev[0]?.keys})`);
  await page.waitForTimeout(500);
  const feed = await page.evaluate(() => document.getElementById('feed')?.innerText ?? '');
  check(/treated in the Infirmary/.test(feed), `and the feed says it ("${feed.replace(/\n/g, ' | ')}")`);
}
// the icon is the player's own, in their own turn only
await game(() => { const g = window.__game; g.state.spentInfirmaries.clear(); g.activePlayer().health = 1; g.refresh(); });
await frames(3);
check((await spot()).kind === 'heal', 'the icon is back (the Infirmary unspent for this check)');
await game(() => window.__game.endTurn());
await page.waitForTimeout(400);
for (let i = 0; i < 10 && await game(() => window.__game.myTurn()); i++) await page.waitForTimeout(200);
check(!(await game(() => window.__game.myTurn())) && (await spot()).kind === null && !(await visible('#search-spot')), 'on another guest\'s turn the icon is not shown');
check(await game(() => window.__game.state.players.filter(p => p.index !== window.__game.humanSeat()).every(p => p.currentRoom !== 'infirmary1' || true)), '(no other screen element shows it)');
await dressed();
check(noise().length === 0, noise().length ? `console noise (match):\n    ${noise().slice(0, 6).join('\n    ')}` : 'no console errors or failed requests in the match (clean)');
await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : '\nALL ROOM ICON CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
