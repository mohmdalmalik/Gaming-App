// QA: play complete small HOT-SEAT matches with a bot through the real UI screens.
// node qa-07-hotseat.mjs <count> <firstSeed> <players> [vp] [shots] [timer]
import { launch, newPage } from './qa-lib.mjs';
import fs from 'node:fs';

const COUNT = +(process.argv[2] || 1), SEED0 = +(process.argv[3] || 2001), PLAYERS = +(process.argv[4] || 4);
const VP = process.argv[5] || 'air', SHOTS = process.argv[6] === 'shots', TIMER = process.argv[7] === 'timer';
const browser = await launch();
const h = await newPage(browser, VP);
const { page, game } = h;
const findings = [];
const note = (seed, msg) => { findings.push({ seed, msg }); console.log(`   [${seed}] ${msg}`); };
let shotN = 0;
const snap = async (seed, what) => { if (SHOTS && shotN < 60) { shotN++; await h.shot(`hs-${seed}-${String(shotN).padStart(2, '0')}-${what}`); } };
const seenKinds = new Set();
let curSeed = 0;
const origClick = page.click.bind(page);
page.click = async (sel, opts = {}) => {
  try { return await origClick(sel, { timeout: 6000, force: true, ...opts }); }
  catch (e) {
    const state = await page.evaluate(() => ({ handoff: window.__game.handoffKind(), meeting: window.__game.meetingOpen(), full: window.__game.fullHandOpen(), notice: window.__game.noticeOpen(), cardview: window.__game.cardViewOpen(), phase: window.__game.inActionPhase() }));
    note(curSeed, `click ${sel} failed (${e.message.split('\n')[0].slice(0, 60)}) screens=${JSON.stringify(state)}`);
    await h.shot(`hs-${curSeed}-clickfail-${Date.now() % 100000}`);
  }
};

// Public screen leak check: during an action phase, nothing on screen may name a hidden role.
async function leakCheck(seed) {
  const r = await page.evaluate(() => {
    const g = window.__game, p = g.activePlayer();
    const vis = el => { if (!el) return false; const cs = getComputedStyle(el); return el.offsetParent !== null && cs.display !== 'none' && cs.visibility !== 'hidden' && !el.closest('[hidden]'); };
    const texts = [...document.querySelectorAll('#hud *')].filter(el => vis(el) && el.children.length === 0).map(el => el.textContent).join(' | ');
    const fanPoss = [...document.querySelectorAll('#hand-fan .fan-card')].some(c => c.dataset.type === 'possession');
    const tint = vis(document.getElementById('possess-tint'));
    const panelPoss = document.getElementById('player-panel').classList.contains('possessed');
    const imgPoss = [...document.querySelectorAll('#hud img')].some(i => /possessed/.test(i.src) && vis(i));
    return { words: /possess/i.test(texts) ? texts.match(/[^|]*possess[^|]*/i)[0] : null, fanPoss, tint, panelPoss, imgPoss, possessed: p.possessed };
  });
  if (r.words) note(seed, `public HUD mentions possession: "${r.words.trim()}" (active possessed=${r.possessed})`);
  if (r.fanPoss || r.tint || r.panelPoss || r.imgPoss) note(seed, `ROLE LEAK on public screen: ${JSON.stringify(r)}`);
}

async function clearScreens(seed) {
  for (let i = 0; i < 40; i++) {
    if (await game(() => window.__game.isFinished()) && await h.visible('#end-overlay')) return 'end';
    if (await game(() => window.__game.handoffOpen())) {
      const k = await h.kind();
      if (!seenKinds.has(k)) { seenKinds.add(k); await snap(seed, 'handoff-' + k); }
      if (k === 'pick') {
        const choice = await page.evaluate(() => {
          const g = window.__game;
          const tiles = [...document.querySelectorAll('#offer-cards .card-tile')];
          if (!tiles.length) return -1;
          const names = tiles.map(t => t.textContent);
          let i = names.findIndex(n => /Possession/i.test(n));
          if (i < 0 || Math.random() < 0.3) i = names.findIndex(n => !/Lantern|Possession/i.test(n));
          if (i < 0) i = 0;
          return i;
        });
        if (choice < 0) {
          note(seed, 'SOFTLOCK: private trade pick with no card to give and no button');
          await h.shot(`hs-${seed}-softlock-empty-pick`);
          return 'stuck';
        }
        await page.click(`#offer-cards .card-tile:nth-child(${choice + 1})`); await page.waitForTimeout(60); continue;
      }
      if (k === 'choice') { await page.click('#offer-intent .btn'); await page.waitForTimeout(60); continue; }
      if (await h.visible('#btn-handoff-next')) { await h.tap('#btn-handoff-next'); continue; }
      note(seed, `handoff kind ${k} without a visible button`); return 'stuck';
    }
    if (await game(() => window.__game.meetingOpen())) {
      const btns = await page.$$eval('#encounter-actions .btn', bs => bs.map(b => ({ t: b.textContent.trim(), d: b.disabled })));
      const bodyCards = await page.$$('#encounter-body .card-tile');
      if (!seenKinds.has('meet:' + (btns[0]?.t || 'cards'))) { seenKinds.add('meet:' + (btns[0]?.t || 'cards')); await snap(seed, 'meeting'); }
      if (bodyCards.length && !btns.length) { await bodyCards[0].click(); await page.waitForTimeout(80); continue; }
      const att = btns.findIndex(b => b.t === 'Attack' && !b.d);
      const poss = await game(() => window.__game.activePlayer().possessed);
      let pick = btns.findIndex(b => b.t === 'Trade');
      if (att >= 0 && Math.random() < (poss ? 0.6 : 0.25)) pick = att;
      if (pick < 0) pick = btns.findIndex(b => !b.d);
      if (pick < 0) { note(seed, 'meeting with no enabled button'); return 'stuck'; }
      await page.click(`#encounter-actions .btn:nth-child(${pick + 1})`); await page.waitForTimeout(80); continue;
    }
    if (await game(() => window.__game.fullHandOpen())) {
      const isLan = await page.evaluate(() => /Lantern/.test(document.getElementById('fullhand-sub').textContent));
      if (isLan) {
        await h.tap('#btn-fullhand-take');
        const n = await page.$$eval('#fullhand-hand .card-tile', els => els.findIndex(x => !/Lantern/i.test(x.textContent)));
        if (n >= 0) await page.click(`#fullhand-hand .card-tile:nth-child(${n + 1})`);
        if (await game(() => window.__game.fullHandOpen())) { if (await h.visible('#btn-fullhand-cancel')) await h.tap('#btn-fullhand-cancel'); await h.tap('#btn-fullhand-leave'); }
      } else await h.tap('#btn-fullhand-leave');
      continue;
    }
    if (await h.visible('#discard-overlay')) {
      if (!seenKinds.has('discard')) { seenKinds.add('discard'); await snap(seed, 'discard'); }
      const n = await page.$$eval('#discard-cards .card-tile', els => els.findIndex(x => !/Lantern/i.test(x.textContent)));
      await page.click(`#discard-cards .card-tile:nth-child(${Math.max(0, n) + 1})`);
      if (!(await page.$eval('#btn-discard-done', b => b.disabled))) await h.tap('#btn-discard-done');
      continue;
    }
    if (await game(() => window.__game.noticeOpen())) { if (!seenKinds.has('notice')) { seenKinds.add('notice'); await snap(seed, 'notice'); } await h.tap('#btn-notice-ok'); continue; }
    if (await game(() => window.__game.cardViewOpen())) { await h.tap('#btn-hand-close'); continue; }
    return 'clear';
  }
  return 'loop';
}

const decide = () => game(() => {
  const g = window.__game, s = g.state, f = g.floor, p = g.activePlayer();
  const room = f.rooms.get(p.currentRoom);
  const lan = p.hand.filter(c => c.type === 'lantern').length;
  const hasFlash = p.hand.some(c => c.type === 'flashlight');
  const others = s.players.filter(q => q.alive && q.index !== p.index && !s.escaped?.has(q.id));
  const searchable = r => r.searchable !== false && r.role !== 'lobby' && !r.isExit && (!s.searchedRooms.has(r.id) || (s.roomDrops.get(r.id) || []).length) && (!r.dark || hasFlash) && !s.lockedRooms.has(r.id);
  if (s.finished) return { a: 'done' };
  if (room.isExit && lan >= 3 && !p.possessed) return p.actionPoints > 0 ? { a: 'escape' } : { a: 'end' };
  if (p.actionPoints <= 0) return { a: 'end' };
  const key = p.hand.find(c => c.type === 'masterKey') || p.hand.find(c => c.type === 'lockPick');
  const lockedNext = [...room.neighbours].find(id => s.lockedRooms.has(id));
  if (key && lockedNext) return { a: 'unlock', id: key.id, room: lockedNext };
  if (searchable(room) && g.searchSpot().mode === 'live') return { a: 'search' };
  const bandage = p.hand.find(c => c.type === 'bandage');
  if (bandage && p.health < 3) return { a: 'bandage', id: bandage.id };
  if (room.job === 'switchboard' && Math.random() < 0.5 && g.roomJob().ok) return { a: 'room' };
  if (room.job === 'infirmary' && p.health < 3 && g.roomJob().ok) return { a: 'room' };
  const exitKnown = f.roomList.some(r => r.isExit);
  const openable = room.frontier.filter(d => !d.jammed);
  if (openable.length && !(lan >= 3 && exitKnown) && Math.random() < 0.7) return { a: 'open', id: openable[0].id };
  const huntFor = p.possessed ? new Set(others.map(q => q.currentRoom).filter(r => r !== f.start.room)) : new Set();
  const goal = r => (!p.possessed && lan >= 3 && exitKnown ? r.isExit : (huntFor.has(r.id) || searchable(r) || r.frontier.some(d => !d.jammed)));
  const prev = new Map([[room.id, null]]); const q = [room.id]; let hit = null;
  while (q.length) {
    const id = q.shift(); const r = f.rooms.get(id);
    if (id !== room.id && goal(r)) { hit = id; break; }
    for (const d of r.doorways) { const o = d.a === id ? d.b : d.a; if (prev.has(o) || s.lockedRooms.has(o)) continue; prev.set(o, id); q.push(o); }
  }
  if (!hit) { if (openable.length) return { a: 'open', id: openable[0].id }; const nb = [...room.neighbours].filter(n => !s.lockedRooms.has(n)); return nb.length ? { a: 'move', to: nb[Math.floor(Math.random() * nb.length)] } : { a: 'end' }; }
  let step = hit; while (prev.get(step) !== room.id) step = prev.get(step);
  return { a: 'move', to: step };
});

const summary = [];
for (let m = 0; m < COUNT; m++) {
  const seed = SEED0 + m; curSeed = seed;
  shotN = 0; seenKinds.clear();
  const t0 = Date.now();
  await h.load(`mode=hotseat&players=${PLAYERS}&seed=${seed}${TIMER ? '' : '&timer=off'}`, { pr: SHOTS ? 0.75 : 0.3 });
  await snap(seed, 'start');
  await h.begin();
  let steps = 0, result = 'timeout', lastRound = 0;
  while (steps++ < 900) {
    const c = await clearScreens(seed);
    if (c === 'end') { result = 'end'; break; }
    if (c === 'stuck' || c === 'loop') { result = c; break; }
    const phase = await game(() => window.__game.inActionPhase());
    if (!phase) { await page.waitForTimeout(100); continue; }
    const round = await game(() => window.__game.state.round);
    if (round !== lastRound) { lastRound = round; await leakCheck(seed); if (round === 1 || round % 3 === 0) await snap(seed, `r${round}-action`); }
    const d = await decide();
    if (d.a === 'done') { result = 'end'; break; }
    try {
      if (d.a === 'end') { await h.tap('#btn-end-turn'); continue; }
      if (d.a === 'escape') { await h.tap('#btn-room'); await page.waitForTimeout(200); continue; }
      if (d.a === 'room') { await h.tap('#btn-room'); continue; }
      if (d.a === 'unlock') { await game(({ id, room }) => window.__game.unlock(id, room), d); continue; }
      if (d.a === 'bandage') { await game(id => window.__game.useBandage(id), d.id); continue; }
      if (d.a === 'search') { await h.searchHere(); continue; }
      if (d.a === 'open') { await game(id => window.__game.openDoor(id), d.id); await page.waitForTimeout(80); continue; }
      if (d.a === 'move') { await game(to => window.__game.moveToRoom(to), d.to); await h.settle(); await page.waitForTimeout(150); continue; }
    } catch (e) { note(seed, `action ${d.a} failed: ${e.message.split('\n')[0]}`); await h.shot(`hs-${seed}-actionfail-${steps}`); result = 'error'; break; }
  }
  await page.waitForTimeout(300);
  const end = await game(() => ({ fin: window.__game.isFinished(), round: window.__game.state.round, won: window.__game.state.won, dawn: !!window.__game.state.dawn,
    dead: window.__game.state.players.filter(p => !p.alive).length, poss: window.__game.possessedIndexes().length,
    title: document.getElementById('end-title').textContent, sum: document.getElementById('end-summary').textContent, endShown: !document.getElementById('end-overlay').hidden }));
  if (end.fin && !end.endShown) note(seed, 'finished but no end screen');
  if (end.endShown) await h.shot(`hs-${seed}-end-${PLAYERS}p`);
  summary.push({ seed, players: PLAYERS, result, steps, ...end, secs: Math.round((Date.now() - t0) / 1000), kinds: [...seenKinds].join(',') });
  console.log(JSON.stringify(summary.at(-1)));
  if (h.log.length) note(seed, 'console: ' + h.log.splice(0).slice(0, 5).join(' | '));
}
fs.writeFileSync(new URL(`./shots/qa/hotseat-${SEED0}-${PLAYERS}p.json`, import.meta.url), JSON.stringify({ summary, findings }, null, 1));
await browser.close();
