// QA: play complete PRACTICE matches with a simple bot, through the real UI where possible.
// node qa-02-practice.mjs <count> <firstSeed> [vp] [shots]
import { launch, newPage, HUD_SELS } from './qa-lib.mjs';
import fs from 'node:fs';

const COUNT = +(process.argv[2] || 3), SEED0 = +(process.argv[3] || 1001), VP = process.argv[4] || 'air', SHOTS = process.argv[5] === 'shots';
const browser = await launch();
const h = await newPage(browser, VP);
const { page, game } = h;
const findings = [];
const note = (seed, msg) => { findings.push({ seed, msg }); console.log(`   [${seed}] ${msg}`); };

// Decide the next thing to do, from the live state (in the page).
const decide = () => game(() => {
  const g = window.__game, s = g.state, f = g.floor, p = g.activePlayer();
  const room = f.rooms.get(p.currentRoom);
  const lan = p.hand.filter(c => c.type === 'lantern').length;
  const hasFlash = p.hand.some(c => c.type === 'flashlight');
  const searchable = r => r.searchable !== false && r.role !== 'lobby' && !r.isExit && (!s.searchedRooms.has(r.id) || (s.roomDrops.get(r.id) || []).length) && (!r.dark || hasFlash) && !s.lockedRooms.has(r.id);
  const esp = p.hand.find(c => c.type === 'espresso');
  if (s.finished) return { a: 'done' };
  if (room.isExit && lan >= 3) return p.actionPoints > 0 ? { a: 'escape' } : { a: 'end' };
  if (p.actionPoints <= 0) return esp ? { a: 'espresso', id: esp.id } : { a: 'end' };
  // unlock a locked neighbour
  const key = p.hand.find(c => c.type === 'masterKey') || p.hand.find(c => c.type === 'lockPick');
  const lockedNext = [...room.neighbours].find(id => s.lockedRooms.has(id));
  if (key && lockedNext) return { a: 'unlock', id: key.id, room: lockedNext };
  if (searchable(room) && g.searchSpot().mode === 'live') return { a: 'search' };
  const openable = room.frontier.filter(d => !d.jammed);
  if (openable.length && !(lan >= 3 && f.roomList.some(r => r.isExit))) { const b = g.doorways.views.get(openable[0].id)?.blink?.position; return { a: 'open', id: openable[0].id, center: b ? [b.x, b.z] : openable[0].center }; }
  // BFS to a goal room
  const exitKnown = f.roomList.some(r => r.isExit);
  const goal = r => (lan >= 3 && exitKnown ? r.isExit : (searchable(r) || r.frontier.some(d => !d.jammed)));
  const prev = new Map([[room.id, null]]); const q = [room.id]; let hit = null;
  while (q.length) {
    const id = q.shift(); const r = f.rooms.get(id);
    if (id !== room.id && goal(r)) { hit = id; break; }
    for (const d of r.doorways) {
      const o = d.a === id ? d.b : d.a;
      if (prev.has(o) || s.lockedRooms.has(o) || (s.barricades && [...(s.barricades.values?.() || [])].some(b => b.doorwayId === d.id))) continue;
      prev.set(o, id); q.push(o);
    }
  }
  if (!hit && lan >= 3) return { a: 'stuck', why: 'no path to exit / exit not found', rooms: f.roomList.length };
  if (!hit) return { a: 'stuck', why: `nothing left to explore with ${lan} lanterns`, rooms: f.roomList.length, locked: [...s.lockedRooms], deck: s.drawPile.length };
  let step = hit; while (prev.get(step) !== room.id) step = prev.get(step);
  const door = room.doorways.find(d => d.a === step || d.b === step);
  const bl = g.doorways.views.get(door.id)?.blink?.position; return { a: 'move', to: step, center: bl && g.doorways.views.get(door.id).blink.visible ? [bl.x, bl.z] : door.center };
});

async function handlePrompts(seed) {
  for (let i = 0; i < 12; i++) {
    if (await game(() => window.__game.handoffOpen())) {
      const k = await h.kind();
      await h.tap('#btn-handoff-next'); continue;
    }
    if (await h.visible('#discard-overlay')) {
      const n = await page.$$eval('#discard-cards .card-tile', els => els.findIndex(x => !/Lantern/i.test(x.textContent)));
      if (n >= 0) await page.click(`#discard-cards .card-tile:nth-child(${n + 1})`);
      if (!(await page.$eval('#btn-discard-done', b => b.disabled))) await h.tap('#btn-discard-done');
      continue;
    }
    if (await game(() => window.__game.noticeOpen())) { await h.tap('#btn-notice-ok'); continue; }
    return;
  }
  note(seed, 'prompt loop did not clear after 12 steps');
}

// Tap a ground point through the real canvas; returns false if a HUD element sits on top of it.
async function tapGround(x, z) {
  const pt = await game(([x, z]) => window.__game.groundToScreen(x, z), [x, z]);
  const top = await page.evaluate(({ x, y }) => { const el = document.elementFromPoint(x, y); if (!el) return 'none'; if (el.tagName === 'CANVAS') return 'canvas'; const c = el.closest('[id]'); return (el.tagName + '.' + (typeof el.className === 'string' ? el.className : '') + ' in #' + (c ? c.id : '?')); }, pt);
  if (top !== 'canvas') return { ok: false, top, pt };
  if (h.vp === 'desk') await page.mouse.click(pt.x, pt.y); else await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(90);
  return { ok: true, pt };
}

const summary = [];
for (let m = 0; m < COUNT; m++) {
  const seed = SEED0 + m;
  const t0 = Date.now();
  await h.load(`seed=${seed}`, { pr: SHOTS ? 1 : 0.3 });
  await h.begin();
  let steps = 0, result = 'timeout', covered = 0, seenRooms = new Set();
  const fts = [];
  while (steps++ < 400) {
    await handlePrompts(seed);
    if (await game(() => window.__game.cardViewOpen())) { note(seed, 'card view open unexpectedly at step ' + steps); await h.shot(`p-${seed}-cardview-unexpected`); await h.tap('#btn-hand-close'); }
    const d = await decide();
    if (d.a === 'done') { result = 'escaped'; break; }
    if (d.a === 'stuck') { result = 'stuck: ' + d.why; note(seed, `STUCK ${JSON.stringify(d)}`); break; }
    if (d.a === 'end') { await h.tap('#btn-end-turn'); await handlePrompts(seed); continue; }
    if (d.a === 'espresso') { await game(id => window.__game.useEspresso(id), d.id); continue; }
    if (d.a === 'escape') {
      if (!(await h.visible('#btn-room'))) note(seed, 'in the Fire Exit with 3 Lanterns but no Escape button visible');
      await h.tap('#btn-room'); await page.waitForTimeout(300);
      if (!(await game(() => window.__game.isFinished()))) { note(seed, 'Escape tapped but game not finished'); await game(() => window.__game.escape()); }
      continue;
    }
    if (d.a === 'unlock') { await game(({ id, room }) => window.__game.unlock(id, room), d); await page.waitForTimeout(100); continue; }
    if (d.a === 'search') {
      const cover = await page.evaluate(() => { const b = document.querySelector('#search-spot'); const r = b.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el && !b.contains(el) ? { what: el.id || el.className, x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
      if (cover) { note(seed, `search icon covered by "${cover.what}" at ${Math.round(cover.x)},${Math.round(cover.y)}`); await h.shot(`p-${seed}-searchcovered`); }
      await h.searchHere();
      if (await game(() => window.__game.cardViewOpen())) { note(seed, 'tapping the search icon opened the card view instead'); await h.tap('#btn-hand-close'); }
      if (!(await game(() => window.__game.handoffOpen()))) {
        // tap might have been swallowed
        await page.waitForTimeout(300);
        if (!(await game(() => window.__game.handoffOpen()))) { note(seed, 'tapping the search icon gave no reveal; using hook'); await game(() => window.__game.tapSearchSpot()); await h.settle(); }
      }
      await handlePrompts(seed); continue;
    }
    if (d.a === 'open' || d.a === 'move') {
      await h.snapCam();
      const r = await tapGround(d.center[0], d.center[1]);
      let viaUI = false;
      if (r.ok && await h.visible('#confirm-bar')) {
        const onTop = await page.evaluate(() => { const b = document.getElementById('btn-confirm-move').getBoundingClientRect(); const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return el && el.closest('#search-spot') ? 'search-spot' : null; });
        if (onTop) { note(seed, 'SEARCH ICON COVERS the Move/Open confirm button'); if (!global.__coverShot) { global.__coverShot = 1; await h.shot(`p-${seed}-icon-over-confirm`); } }
        await page.$eval('#btn-confirm-move', b => b.click()); await page.waitForTimeout(80); viaUI = true;
      } else {
        covered++;
        if (covered <= 3) note(seed, `door ring for ${d.a} not tappable (covered by "${r.top}" at ${Math.round(r.pt.x)},${Math.round(r.pt.y)}); used hook`);
        if (d.a === 'open') await game(id => window.__game.openDoor(id), d.id);
        else await game(to => window.__game.moveToRoom(to), d.to);
      }
      if (d.a === 'move') {
        await h.settle(); await h.frames(3);
        const room = await game(() => window.__game.activePlayer().currentRoom);
        if (room !== d.to) note(seed, `move to ${d.to} ended in ${room}`);
        if (SHOTS && !seenRooms.has(room)) { seenRooms.add(room); await h.snapCam(); await h.shot(`p-${seed}-${String(steps).padStart(3, '0')}-${room}`); }
      } else { await page.waitForTimeout(150); }
      continue;
    }
  }
  await page.waitForTimeout(300);
  const end = await game(() => ({ fin: window.__game.isFinished(), round: window.__game.state.round, turn: window.__game.state.turn, rooms: window.__game.floor.roomList.length, endShown: !document.getElementById('end-overlay').hidden, endTitle: document.getElementById('end-title').textContent, endSum: document.getElementById('end-summary').textContent }));
  if (end.fin && !end.endShown) note(seed, 'finished but no end screen');
  if (m < 2 || !end.fin) await h.shot(`p-${seed}-end-${VP}`);
  summary.push({ seed, result, steps, round: end.round, rooms: end.rooms, secs: Math.round((Date.now() - t0) / 1000), end: end.endTitle });
  console.log(JSON.stringify(summary.at(-1)));
  if (h.log.length) { note(seed, 'console: ' + h.log.splice(0).slice(0, 5).join(' | ')); }
}
fs.writeFileSync(new URL(`./shots/qa/practice-${SEED0}-${VP}.json`, import.meta.url), JSON.stringify({ summary, findings }, null, 1));
await browser.close();
