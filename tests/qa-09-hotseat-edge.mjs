// QA: hot-seat edge cases with screenshots. node qa-09-hotseat-edge.mjs
import { launch, newPage } from './qa-lib.mjs';
const browser = await launch();
const h = await newPage(browser, 'air');
const { page, game } = h;
const log = (...a) => console.log(...a);
const S = n => h.shot(`he-${n}`);
const toast = () => page.evaluate(() => { const t = document.getElementById('toast'); return t.hidden ? '' : t.textContent; });
const C = (id, type) => ({ id, type, ...(type === 'revolver' ? { shots: 2 } : {}) });
const hand = (i, types, pre = 'x') => h.setHand(i, types.map((t, k) => C(`${pre}${i}${k}`, t)));
const act = () => game(() => window.__game.state.activeIndex);
const clickText = async (sel, txt) => { const els = await page.$$(sel); for (const e of els) if ((await e.textContent()).includes(txt)) { await e.click({ force: true }); await page.waitForTimeout(120); return true; } return false; };
const next = () => page.click('#btn-handoff-next', { force: true }).then(() => page.waitForTimeout(100));
const kind = () => h.kind();
const title = () => page.textContent('#handoff-title').catch(() => '');

async function fresh(q) {
  await h.load(`mode=hotseat&players=4&seed=5150${q ? '&' + q : ''}`, { pr: 0.75 });
  await game(() => { window.__game.revealTile('corridorE', 'hall'); window.__game.revealTile('exit', 'corridorE') || window.__game.revealTile('exit'); window.__game.revealTile('switchboard'); });
  await h.begin();
  for (let i = 0; i < 12 && (await kind()) !== 'turn'; i++) await next();
  await next();   // start my turn
  await page.waitForTimeout(300);
}
const walkInto = async (mover, other, room = 'corridorE', from = 'hall') => {
  await h.place(other, room); await h.place(mover, from, 4);
  await game(r => window.__game.moveToRoom(r), room); await h.settle();
  await page.waitForFunction(() => window.__game.meetingOpen(), null, { timeout: 8000 }).catch(() => {});
};

// a. empty-hand forced trade
await fresh('timer=off');
let P = await act();
let Q = (P + 1) % 4;
await game(() => { window.__game.state.players.forEach(p => { p.possessed = false; p.hand = p.hand.filter(c => c.type !== 'possession'); }); });
await hand(P, []); await hand(Q, ['bandage']);
await walkInto(P, Q);
log('a. meeting open', await game(() => window.__game.meetingOpen()), await page.textContent('#encounter-body'));
await S('a-meeting-emptyhand');
await clickText('#encounter-actions .btn', 'Trade');
log('a2. pick kind', await kind(), await title(), 'offer text', (await page.textContent('#offer-cards')).trim(), 'next visible', await h.visible('#btn-handoff-next'));
await S('a-emptyhand-pick');

// b. lobby: no meeting / no trade
await fresh('timer=off');
P = await act(); Q = (P + 1) % 4;
await h.place(Q, 'corridorE'); await h.place(P, 'corridorE', 4);
await h.place(Q, 'hall');
await game(() => window.__game.moveToRoom('hall')); await h.settle(); await page.waitForTimeout(400);
log('b. lobby: meeting?', await game(() => window.__game.meetingOpen()), 'trade btn visible', await h.visible('#btn-trade'));
await S('b-lobby-two-guests');

// c. fire exit voluntary trade + d/e escape
await h.place(Q, 'exit'); await h.place(P, 'exit', 4); await h.snapCam(); await page.waitForTimeout(500);
log('c. exit trade btn', await h.visible('#btn-trade'), await page.textContent('#btn-trade').catch(() => ''));
await S('c-exit-two-guests');
if (await h.visible('#btn-trade')) {
  await page.click('#btn-trade', { force: true }); await page.waitForTimeout(200);
  log('c2.', await kind(), await title()); await S('c-exit-trade-pass');
  await next(); log('c3.', await kind(), await title()); await S('c-exit-trade-choice');
  await clickText('#offer-intent .btn', 'Accept');
  log('c4.', await kind(), await title());
  for (let i = 0; i < 10 && await h.handoffOpen(); i++) {
    const k = await kind();
    if (k === 'pick') await page.click('#offer-cards .card-tile', { force: true }).then(() => page.waitForTimeout(100)); else await next();
  }
  log('c5. meeting', await game(() => window.__game.meetingOpen()), await page.textContent('#encounter-body').catch(() => ''));
  await S('c-exit-trade-done');
  if (await game(() => window.__game.meetingOpen())) await page.click('#encounter-actions .btn', { force: true });
}
// d: possessed with 3 lanterns tries to escape
await game(p => { const g = window.__game; g.state.players[p].possessed = true; g.state.players[p].hand = [{ id: 'L1', type: 'lantern' }, { id: 'L2', type: 'lantern' }, { id: 'L3', type: 'lantern' }, { id: 'X1', type: 'possession' }]; g.state.players[p].actionPoints = 4; g.refresh(); }, P);
await page.waitForTimeout(300);
log('d. possessed escape btn', await page.textContent('#btn-room').catch(() => ''), 'disabled', await page.$eval('#btn-room', b => b.disabled).catch(() => 'n/a'));
await page.click('#btn-room', { force: true }); await page.waitForTimeout(250);
log('d2. toast', await toast(), 'finished', await game(() => window.__game.isFinished()));
await S('d-possessed-escape');
// e: clean escape
await game(p => { const g = window.__game; g.state.players[p].possessed = false; g.state.players[p].hand = g.state.players[p].hand.filter(c => c.type !== 'possession'); g.refresh(); }, P);
log('e. clean escape btn', await page.textContent('#btn-room').catch(() => ''));
await page.click('#btn-room', { force: true }); await page.waitForTimeout(600);
log('e2. finished', await game(() => window.__game.isFinished()), await page.textContent('#end-title'), '|', await page.textContent('#end-summary'));
await S('e-clean-escape-end');

// f. hand mirror + g. switchboard + h. conversion + k. death
await fresh('timer=off');
P = await act(); Q = (P + 1) % 4;
await h.place(Q, 'corridorE'); await h.place(P, 'corridorE', 4);
await hand(P, ['handMirror']); await h.snapCam(); await page.waitForTimeout(400);
await page.click('#hand-fan .fan-card[data-type="handMirror"]', { force: true }); await page.waitForTimeout(300);
await S('f-mirror-cardview');
await page.click('#hand-detail .d-targets .btn', { force: true }); await page.waitForTimeout(300);
log('f. mirror', await kind(), await title());
await S('f-mirror-private');
await next(); await page.waitForTimeout(200); log('f2. toast', await toast());
await h.place(P, 'switchboard', 4); await h.snapCam(); await page.waitForTimeout(400);
await page.click('#btn-room', { force: true }); await page.waitForTimeout(300);
log('g. switchboard', await page.textContent('#notice-body').catch(() => ''));
await S('g-switchboard');
if (await game(() => window.__game.noticeOpen())) await page.click('#btn-notice-ok', { force: true });
// k. death by revolver
await hand(P, ['revolver']); await game(q => { window.__game.state.players[q].health = 2; }, Q);
await h.place(P, 'hall', 4);
await game(r => window.__game.moveToRoom(r), 'corridorE'); await h.settle();
await page.waitForFunction(() => window.__game.meetingOpen(), null, { timeout: 8000 }).catch(() => {});
await S('k-meeting-with-weapon');
await clickText('#encounter-actions .btn', 'Attack');
await page.click('#encounter-body .card-tile', { force: true }); await page.waitForTimeout(300);
log('k. attack result', await page.textContent('#encounter-body'));
await S('k-attack-kill');
await page.click('#encounter-actions .btn', { force: true }); await page.waitForTimeout(600);
await h.snapCam(); await page.waitForTimeout(500);
await S('k-corpse');
log('k2. search spot mode on the body', await game(() => window.__game.searchSpot().mode));
await h.searchHere(); await page.waitForTimeout(300);
log('k3. pick up', await kind(), await title(), await page.textContent('#handoff-notes').catch(() => ''));
await S('k-pickup');
if (await h.handoffOpen()) await next();
// h. conversion: possessed P gives Possession to Q (clean, no lantern)
await fresh('timer=off');
P = await act(); Q = (P + 1) % 4;
await game(({ P, Q }) => { const g = window.__game; g.state.players.forEach(p => { p.possessed = false; p.hand = p.hand.filter(c => c.type !== 'possession'); }); g.state.players[P].possessed = true; g.state.players[P].hand.push({ id: 'PX', type: 'possession' }); g.state.players[Q].hand = [{ id: 'qb', type: 'bandage' }]; }, { P, Q });
await walkInto(P, Q);
await clickText('#encounter-actions .btn', 'Trade');
await page.click('#offer-cards .card-tile[data-card-id="PX"]', { force: true }); await page.waitForTimeout(200);
for (let i = 0; i < 8 && await h.handoffOpen(); i++) {
  const k = await kind(); const t = await title();
  if (k === 'pick') { await S('h-victim-pick'); await page.click('#offer-cards .card-tile', { force: true }); await page.waitForTimeout(150); continue; }
  log('h. screen', k, t, (await page.textContent('#handoff-notes').catch(() => '')).slice(0, 200));
  if (k === 'note') await S('h-note');
  await next();
}
if (await game(() => window.__game.meetingOpen())) { await S('h-trade-done-public'); await page.click('#encounter-actions .btn', { force: true }); }
// end turns until Q's turn to see the "something has changed" screen
for (let i = 0; i < 10; i++) {
  if (await game(q => window.__game.state.activeIndex === q && window.__game.handoffOpen(), Q)) break;
  if (await h.handoffOpen()) { await next(); continue; }
  await page.click('#btn-end-turn', { force: true }); await page.waitForTimeout(200);
}
for (let i = 0; i < 5 && await h.handoffOpen(); i++) {
  const k = await kind(); log('h2. Q screens', k, await title(), await page.textContent('#handoff-kicker'));
  await S(`h-victim-${k}`);
  await next();
}
await page.waitForTimeout(300);
await S('h-victim-action-phase');
log('h3. tint visible in public?', await h.visible('#possess-tint'), 'panel possessed class', await page.$eval('#player-panel', e => e.className));
// i. timer + j. final round
await fresh('');
await page.waitForTimeout(1500);
log('i. timer', await page.textContent('#tt-seconds'));
await S('i-timer');
await game(() => window.__game.forceTimeUp()); await page.waitForTimeout(600);
log('i2. after time up', await kind(), await title(), 'toast', await toast());
await S('i-timeup');
await game(() => { window.__game.state.round = 8; window.__game.refresh(); });
for (let i = 0; i < 6 && await h.handoffOpen(); i++) await next();
await page.click('#btn-end-turn', { force: true }).catch(() => {}); await page.waitForTimeout(300);
log('j. pass kicker', await page.textContent('#handoff-kicker'), 'round label', await page.textContent('#round'));
await S('j-final-round-pass');
// l. double tap end turn in hot-seat
for (let i = 0; i < 6 && await h.handoffOpen(); i++) await next();
const t0 = await game(() => window.__game.state.turn);
await page.dblclick('#btn-end-turn', { force: true }); await page.waitForTimeout(400);
log('l. hot-seat double End turn: turn', t0, '->', await game(() => window.__game.state.turn), await kind());
// m. three guests in a room: choose
await fresh('timer=off');
P = await act();
await h.place((P + 1) % 4, 'corridorE'); await h.place((P + 2) % 4, 'corridorE'); await h.place(P, 'hall', 4);
await game(() => window.__game.moveToRoom('corridorE')); await h.settle();
await page.waitForFunction(() => window.__game.meetingOpen(), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(400);
await S('m-choose-guest');
log('m. choose', await page.textContent('#encounter-title'), await page.$$eval('#encounter-actions .btn', b => b.map(x => x.textContent)));
log('console', h.log.slice(0, 8));
await browser.close();
