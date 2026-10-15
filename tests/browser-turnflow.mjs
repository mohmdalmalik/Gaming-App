// Headless browser test of the turn flow (dev only, not part of the game): the turn passing BY ITSELF when the
// player's actions run out (auto end turn), the end-of-turn discard that finishes by itself (no "Keep these 6"),
// the short found-card reveal, and the walking speed.
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-turnflow.mjs [--url http://127.0.0.1:8123/] [--only a,b,c,d]
//   a  the discard screen: pick, confirm, the last discard closes it by itself and the turn passes
//   b  the found-card reveal: kicker, title, the card and ONE short line per kind; the fan says "Cards 7/6 ..." at once
//   c  auto end turn in Practice: after the last action, not with an action left, not while a reveal / the card view is open,
//      not with an Espresso (End turn glows), once only, an End turn tap in the beat passes only one turn, the off switch
//   d  auto end turn in a match with bots: to the next guest, never on a bot's turn, waits for a meeting, not with a free Trade
//   e  the walking speed: a room-to-room walk (8 m) takes about 2.8 s of game time
// (The other browser suites switch auto end off, tests/smoke-lib.mjs autoEndOff, because they tap End turn themselves.)
import { launch, giveCard } from './smoke-lib.mjs';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['a', 'b', 'c', 'd', 'e'];
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const quiet = messages => messages.filter(m => !/favicon/i.test(m));

// A game page: practice (alone) or a match with bots, auto end turn ON. `speed` hurries the walking (software
// rendering draws a few frames a second); the walking speed itself is measured in (e) without it.
async function open(mode, { speed = 16 } = {}) {
  const run = await launch({ width: 1024, height: 768, autoEnd: true });
  const { page } = run;
  const q = ['mode=' + mode, mode === 'practice' ? 'seed=20260917' : ''].filter(Boolean).join('&');
  await page.goto(`${baseUrl}?${q}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 90000, polling: 200 });
  await page.evaluate(s => { window.__game.setPixelRatio(0.5); if (s) window.__game.cfg.player.speed = s; }, speed);
  await page.click('#btn-begin');
  await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 20000 });
  return run;
}
const place = (page, room, ap = null) => page.evaluate(({ room, ap }) => {
  const g = window.__game, i = g.state.activeIndex, p = g.state.players[i], c = g.roomCenter(room);
  g.state.discovered.add(room); p.currentRoom = room;
  if (ap != null) p.actionPoints = ap;
  g.movers[i].reset(c[0], c[1]); g.discovery.refresh(); g.refresh();
}, { room, ap });
const hand = (page, types, prefix = 'h') => page.evaluate(({ types, prefix }) => {
  const g = window.__game, p = g.state.players[g.humanSeat()];
  p.hand = p.hand.filter(c => c.type === 'possession').concat(types.map((t, i) => ({ id: `${prefix}${i}`, type: t }))); g.refresh();
}, { types, prefix });
const turn = page => page.evaluate(() => window.__game.state.turn);
const waitTurn = (page, t, timeout = 8000) => page.waitForFunction(n => window.__game.state.turn > n, t, { timeout, polling: 50 }).then(() => true, () => false);
const settleWalk = page => page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000, polling: 50 });

// --- a. the discard screen ------------------------------------------------------------------------
if (only.includes('a')) {
  console.log('a. the discard screen finishes by itself');
  const { browser, page, messages } = await open('practice');
  try {
    await page.evaluate(() => window.__game.autoEnd(false));          // (the turn is ended with the hook here)
    await place(page, 'hall', 4);
    await hand(page, ['knife', 'knife', 'bandage', 'lantern', 'flashlight', 'espresso', 'masterKey', 'barricade'], 'd');
    const t0 = await turn(page);
    await page.evaluate(() => window.__game.endTurn());
    await page.waitForFunction(() => !document.getElementById('discard-overlay').hidden, null, { timeout: 5000 });
    const st = () => page.evaluate(() => ({ open: !document.getElementById('discard-overlay').hidden, leaving: document.getElementById('discard-overlay').classList.contains('leaving'),
      btn: document.getElementById('btn-discard-done').textContent.trim(), dis: document.getElementById('btn-discard-done').disabled, n: window.__game.activePlayer().hand.length, turn: window.__game.state.turn }));
    let s = await st();
    check(s.open && s.dis && /Tap a card/.test(s.btn) && s.n === 8, 'End turn over the limit opens it; nothing is chosen, the button waits');
    await page.evaluate(() => document.getElementById('btn-discard-done').click());
    check((await st()).n === 8, 'a stray tap on the button throws nothing away');
    await page.click('#discard-cards .card-tile[data-card-id="d0"]'); await page.waitForTimeout(120);
    s = await st();
    check(!s.dis && /Discard the Knife/.test(s.btn) && s.n === 8, `a tap only picks a card, the button names it ("${s.btn}")`);
    await page.click('#btn-discard-done'); await page.waitForTimeout(150);
    s = await st();
    check(s.n === 7 && s.open && !s.leaving && s.dis, 'confirming discards it (7 left); still choosing, the screen stays');
    await page.click('#discard-cards .card-tile[data-card-id="d2"]'); await page.waitForTimeout(120);
    // the discard that reaches the limit: watched from inside the page (a frame takes a long time here)
    const run = await page.evaluate(() => new Promise(res => {
      const t0 = performance.now();
      document.getElementById('btn-discard-done').click();
      const leaving = !!document.querySelector('#discard-cards .card-tile.leaving') && document.getElementById('discard-overlay').classList.contains('leaving');
      document.querySelector('#discard-cards .card-tile:not(.leaving)')?.click(); document.getElementById('btn-discard-done').click();     // (taps while it leaves)
      const mid = { n: window.__game.state.players[0].hand.length, picked: document.querySelectorAll('#discard-cards .card-tile.selected').length, turn: window.__game.state.turn, btn: document.getElementById('btn-discard-done').textContent.trim() };
      const tick = () => { const t = performance.now() - t0; if (document.getElementById('discard-overlay').hidden || t > 4000) res({ closedAt: Math.round(t), leaving, mid }); else setTimeout(tick, 20); };
      tick();
    }));
    check(run.leaving && run.mid.n === 6 && run.mid.picked === 0 && run.mid.turn === t0, `the last discard: the card is seen leaving, nothing else can be tapped ("${run.mid.btn}")`);
    check(run.closedAt >= 450 && run.closedAt <= 1500, `then the screen closes by itself after about half a second (${run.closedAt} ms)`);
    await page.waitForTimeout(300);
    s = await st();
    check(!s.open && s.turn === t0 + 1 && s.n === 6, 'and the turn passes, with 6 cards kept');
    check(!(await page.evaluate(() => /Keep these/.test(document.getElementById('discard-overlay').textContent))), 'there is no "Keep these 6" step');
  } catch (err) { check(false, `a: ${err.message}`); }
  check(!quiet(messages).length, `a: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// --- b. the found-card reveal ---------------------------------------------------------------------
if (only.includes('b')) {
  console.log('\nb. the found-card reveal is short');
  const { browser, page, messages } = await open('practice');
  try {
    await page.evaluate(() => { window.__game.autoEnd(false); window.__game.revealTile('lounge'); });
    await place(page, 'lounge', 4);
    await hand(page, ['knife', 'knife', 'bandage', 'flashlight', 'masterKey', 'barricade'], 's');
    await page.evaluate(() => { window.__game.state.drawPile.unshift({ id: 'n1', type: 'lantern' }); });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__game.search());
    await page.waitForFunction(() => window.__game.handoffOpen(), null, { timeout: 15000 });
    const r = await page.evaluate(() => ({ kicker: document.getElementById('handoff-kicker').textContent, title: document.getElementById('handoff-title').textContent,
      lines: [...document.querySelectorAll('#handoff-found .ft-desc')].map(e => e.textContent), cards: document.querySelectorAll('#handoff-found .big-card').length,
      notes: document.getElementById('handoff-notes').textContent.trim(), text: document.getElementById('handoff-card').innerText }));
    check(/^You search /.test(r.kicker) && r.title === 'You found a Lantern', `kicker and title ("${r.kicker}" / "${r.title}")`);
    check(r.cards === 1 && r.lines.length === 1 && r.lines[0].length > 5, `one card and one short line ("${r.lines[0]}")`);
    check(r.notes === '' && !/You now hold|more than 6|keep them all|find a Lantern/.test(r.text), 'no "you search ... and find" sentence, no Lantern tally, no limit note');
    await page.click('#btn-handoff-next');
    const strip = await page.waitForFunction(() => { const el = document.querySelector('#hand-fan .fan-limit'); return el && !el.hidden && el.textContent; }, null, { timeout: 4000, polling: 30 }).then(h => h.jsonValue(), () => null);
    check(strip === 'Cards 7/6 · discard 1 at end of turn', `the moment it closes, the hand fan says "${strip}"`);
    // two of one kind share one line; two kinds have a line each
    for (const [types, title, lines] of [[['lantern', 'lantern'], 'You found 2 Lanterns', 1], [['bandage', 'knife'], 'You found a Bandage and a Knife', 2]]) {
      await page.evaluate(types => { const g = window.__game; g.handoff.privateFound(g.activePlayer(), { kicker: 'You search the desk', title: 'x', cards: types.map((t, i) => ({ id: `z${i}`, type: t })), soft: true }, () => {}); }, types);
      const got = await page.evaluate(() => ({ cards: document.querySelectorAll('#handoff-found .big-card').length, lines: document.querySelectorAll('#handoff-found .ft-desc').length }));
      check(got.cards === 2 && got.lines === lines, `${types.join(' + ')}: two cards, ${lines} line${lines === 1 ? '' : 's'} (${got.lines})`);
      await page.evaluate(() => window.__game.handoff.close());
    }
  } catch (err) { check(false, `b: ${err.message}`); }
  check(!quiet(messages).length, `b: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// --- c. auto end turn in Practice -----------------------------------------------------------------
if (only.includes('c')) {
  console.log('\nc. auto end turn in Practice');
  const { browser, page, messages } = await open('practice');
  const g = fn => page.evaluate(fn);
  try {
    check(await g(() => window.__game.autoEnd()) === true, 'auto end is on');
    await g(() => { const G = window.__game, p = G.state.players[0]; p.hand = p.hand.filter(c => c.type !== 'espresso'); G.refresh(); });
    await g(() => window.__game.openDoor(window.__game.closedDoors()[0].id));
    const t0 = await turn(page);
    await g(() => { const G = window.__game, w = (window.__w = { zeroAt: null, passAt: null, turn0: G.state.turn }); const iv = setInterval(() => {
      const quiet = !G.activeMover().walking && !G.activeMover().path.length;
      if (w.zeroAt === null && G.activePlayer().actionPoints === 0 && quiet && !G.handoffOpen()) w.zeroAt = performance.now();
      if (w.passAt === null && G.state.turn > w.turn0) { w.passAt = performance.now(); clearInterval(iv); } }, 20); });
    await g(() => window.__game.moveToRoom(window.__game.hotelRooms()[1])); await settleWalk(page);
    await g(() => window.__game.moveToRoom('hall')); await settleWalk(page);
    await page.waitForTimeout(1500);
    check(await g(() => window.__game.activePlayer().actionPoints) === 1 && await turn(page) === t0, 'with an action left nothing passes by itself (1.5 s)');
    await g(() => window.__game.moveToRoom(window.__game.hotelRooms()[1])); await settleWalk(page);
    check(await waitTurn(page, t0), 'the last action spent: the turn passes by itself');
    const w = await g(() => window.__w);
    check(w.passAt - w.zeroAt >= 800 && w.passAt - w.zeroAt < 2600, `about a beat after the walk ended (${Math.round(w.passAt - w.zeroAt)} ms)`);
    await page.waitForTimeout(2500);
    check(await g(() => window.__game.autoEndFired()) === 1 && await turn(page) === t0 + 1 && await g(() => window.__game.activePlayer().actionPoints) === 4, 'once only, and the new turn has all 4 actions');

    // an Espresso: free, +2 actions, so the turn waits for the player and End turn glows
    await place(page, 'hall', 0);
    await g(() => { const G = window.__game; G.state.players[0].hand.push({ id: 'esp1', type: 'espresso' }); G.refresh(); });
    const tB = await turn(page);
    await page.waitForTimeout(2500);
    check(await turn(page) === tB && await g(() => document.getElementById('btn-end-turn').classList.contains('nudge')), 'with an Espresso in hand the turn does not pass, and End turn glows');
    await g(() => { const G = window.__game; G.state.players[0].hand = G.state.players[0].hand.filter(c => c.type !== 'espresso'); G.refresh(); });
    check(await waitTurn(page, tB, 6000) && !(await g(() => document.getElementById('btn-end-turn').classList.contains('nudge'))), 'without it the turn passes and the glow is gone');

    // the last action is a search: the reveal is read first; over the limit, the discard screen opens by itself
    await g(() => window.__game.revealTile('lounge'));
    await place(page, 'lounge', 1);
    await hand(page, ['knife', 'knife', 'bandage', 'flashlight', 'masterKey', 'barricade'], 's');
    await g(() => { window.__game.state.drawPile.unshift({ id: 'new1', type: 'lantern' }); });
    await page.waitForTimeout(700);
    const tC = await turn(page);
    await g(() => window.__game.search());
    await page.waitForFunction(() => window.__game.handoffOpen(), null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    check(await turn(page) === tC && await g(() => window.__game.handoffKind()) === 'found', 'while the reveal is open the turn does not pass (2.5 s)');
    await page.click('#btn-handoff-next');
    check(await page.waitForFunction(() => !document.getElementById('discard-overlay').hidden, null, { timeout: 6000, polling: 50 }).then(() => true, () => false) && await turn(page) === tC,
      'a beat after the reveal closes, the discard screen opens by itself (7 cards), the turn waits');
    await page.click('#discard-cards .card-tile[data-card-id="s0"]'); await page.waitForTimeout(150);
    await page.click('#btn-discard-done');
    check(await waitTurn(page, tC, 8000), 'one discard, and the screen closes by itself and the turn passes');

    // End turn tapped inside the beat: one turn passes, not two
    await place(page, 'hall', 0);
    await g(() => { const G = window.__game; G.state.players[0].hand = G.state.players[0].hand.filter(c => c.type !== 'espresso'); G.refresh(); });
    const tD = await turn(page);
    await page.waitForTimeout(300);
    await g(() => window.__game.endTurn());
    await page.waitForTimeout(3000);
    check(await turn(page) === tD + 1, `End turn tapped in the beat: exactly one turn passed (${tD} -> ${await turn(page)})`);

    // an open card view holds the beat
    await place(page, 'hall', 4);
    const tE = await turn(page);
    await hand(page, ['knife'], 'v');
    await page.waitForTimeout(500);
    await page.click('#hand-fan .fan-card[data-card-id="v0"]'); await page.waitForTimeout(300);
    await g(() => { window.__game.activePlayer().actionPoints = 0; window.__game.refresh(); });
    await page.waitForTimeout(2500);
    check(await g(() => window.__game.cardViewOpen()) && await turn(page) === tE, 'with the card view open the turn does not pass');
    await page.click('#btn-hand-close');
    check(await waitTurn(page, tE, 6000), 'closing it: a beat later the turn passes');

    // the off switch
    await g(() => window.__game.autoEnd(false));
    await place(page, 'hall', 0);
    const tF = await turn(page);
    await page.waitForTimeout(2500);
    check(await turn(page) === tF, 'switched off, nothing passes by itself');
    await g(() => window.__game.autoEnd(true));
    check(await waitTurn(page, tF, 6000), 'switched on again, it passes');
  } catch (err) { check(false, `c: ${err.message}`); }
  check(!quiet(messages).length, `c: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// --- d. auto end turn in a match with bots --------------------------------------------------------
if (only.includes('d')) {
  console.log('\nd. auto end turn in a match with bots');
  const { browser, page, messages } = await open('bots', { speed: 30 });
  const g = (fn, a) => page.evaluate(fn, a);
  const myTurn = () => g(() => { const G = window.__game; return G.myTurn() && G.inActionPhase() && !G.handoffOpen() && !G.meetingOpen(); });
  async function answerScreens() {
    for (let i = 0; i < 10; i++) {
      const s = await g(() => { const G = window.__game; if (G.handoffOpen()) return G.handoffKind(); if (!document.getElementById('encounter-overlay').hidden) return 'meeting'; if (G.noticeOpen()) return 'notice'; if (G.askOpen()) return 'ask'; return null; });
      if (!s) return;
      if (s === 'pick') await giveCard(page);
      else if (s === 'choice') await page.click('#offer-intent .btn');
      else if (s === 'meeting') { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click(); else await page.waitForTimeout(250); }
      else if (s === 'notice') await page.click('#btn-notice-ok');
      else if (s === 'ask') await page.click('#btn-ask-no');
      else await page.click('#btn-handoff-next');
      await page.waitForTimeout(200);
    }
  }
  async function untilMyTurn(timeout = 200000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) { if (await myTurn()) return true; await answerScreens(); await page.waitForTimeout(300); }
    return false;
  }
  try {
    check(await untilMyTurn(), 'my turn has come');
    const me = await g(() => window.__game.humanSeat());
    await g(() => { const G = window.__game, p = G.state.players[G.humanSeat()]; p.hand = p.hand.filter(c => c.type !== 'espresso'); p.actionPoints = 1; G.refresh(); for (const r of ['lounge', 'dining', 'library']) G.revealTile(r); });     // (a few rooms to walk to and meet in)
    // the last action is a move: the turn passes to the next guest by itself
    const t0 = await turn(page);
    const nb = await g(() => { const G = window.__game, p = G.state.players[G.humanSeat()]; return [...G.floor.rooms.get(p.currentRoom).neighbours].find(r => !G.lockedRooms().includes(r) && G.state.discovered.has(r)); });
    await g(r => window.__game.moveToRoom(r), nb); await settleWalk(page); await answerScreens();
    check(await waitTurn(page, t0, 8000) && await g(() => window.__game.state.activeIndex) !== me, 'the last action was a move: the turn passed by itself to the next guest');
    // never on another guest's turn
    const f0 = await g(() => window.__game.autoEndFired());
    await g(() => { const G = window.__game; G.state.players[G.humanSeat()].actionPoints = 0; });
    await page.waitForTimeout(3500);
    check(await g(() => window.__game.autoEndFired()) === f0, "my actions at 0 while a bot plays: auto end did not fire on the bot's turn");
    // a forced meeting on the last action
    check(await untilMyTurn(), 'my turn again');
    await g(() => { const G = window.__game, p = G.state.players[G.humanSeat()]; p.hand = p.hand.filter(c => c.type !== 'espresso'); p.actionPoints = 1; G.refresh(); });
    const setup = await g(() => {
      const G = window.__game, p = G.state.players[G.humanSeat()], here = G.floor.rooms.get(p.currentRoom);
      const to = [...here.neighbours].find(r => !G.floor.rooms.get(r).safe && !G.lockedRooms().includes(r) && G.state.discovered.has(r));
      if (!to) return null;
      const q = G.state.players.find(x => x.index !== G.humanSeat() && x.alive), c = G.roomCenter(to);
      q.currentRoom = to; G.movers[q.index].reset(c[0], c[1]); G.discovery.refresh(); G.refresh();
      return to;
    });
    if (setup) {
      const tM = await turn(page);
      await g(r => window.__game.moveToRoom(r), setup);
      await page.waitForFunction(() => window.__game.meetingOpen() || window.__game.handoffOpen(), null, { timeout: 30000, polling: 100 }).catch(() => {});
      check(await g(() => window.__game.meetingOpen()), 'the last action walked into a bot: the meeting opens');
      await page.waitForTimeout(2500);
      check(await turn(page) === tM, 'the turn does not pass while the meeting is open');
      for (let i = 0; i < 12 && await turn(page) === tM; i++) { await answerScreens(); await page.waitForTimeout(400); }
      check(await waitTurn(page, tM, 10000), 'after the meeting the turn passes by itself');
    } else check(false, 'no neighbouring room to put a bot in');
    // the Fire Exit with a guest there: a Trade costs nothing, so the player ends the turn themselves
    check(await untilMyTurn(), 'my turn again');
    const ex = await g(() => {
      const G = window.__game, p = G.state.players[G.humanSeat()];
      G.revealTile('exit');                                  // (the Fire Exit is part of the hotel only once revealed)
      const id = G.floor.roomList.find(r => r.isExit)?.id;
      if (!id) return null;
      const c = G.roomCenter(id);
      G.state.discovered.add(id); p.currentRoom = id; p.actionPoints = 0; G.movers[G.humanSeat()].reset(c[0], c[1]);
      p.hand = p.hand.filter(c => c.type !== 'espresso');
      const q = G.state.players.find(x => x.index !== G.humanSeat() && x.alive);
      q.currentRoom = id; G.movers[q.index].reset(c[0] + 0.5, c[1] + 0.5); G.discovery.refresh(); G.refresh();
      return id;
    });
    if (ex) {
      const tX = await turn(page);
      await page.waitForTimeout(3000);
      const st = await g(() => ({ turn: window.__game.state.turn, glow: document.getElementById('btn-end-turn').classList.contains('nudge'), trade: !document.getElementById('btn-trade').hidden }));
      check(st.turn === tX && st.glow && st.trade, 'at the Fire Exit with a guest (a free Trade): no auto end, End turn glows');
      await g(() => window.__game.endTurn());
      check(await waitTurn(page, tX, 6000), 'End turn still ends it');
    } else check(false, 'no Fire Exit found');
  } catch (err) { check(false, `d: ${err.message}`); }
  check(!quiet(messages).length, `d: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// --- e. the walking speed -------------------------------------------------------------------------
if (only.includes('e')) {
  console.log('\ne. the walking speed');
  const { browser, page, messages } = await open('practice', { speed: 0 });      // (speed 0: the real configured speed)
  try {
    await page.evaluate(() => window.__game.autoEnd(false));
    const speed = await page.evaluate(() => window.__game.cfg.player.speed);
    check(speed >= 2.8 && speed <= 3.1, `the walking speed is ${speed} m/s (was 2.5: about 15-20% faster)`);
    await page.evaluate(() => window.__game.openDoor(window.__game.closedDoors()[0].id));
    // one real room-to-room walk, stepped by hand in 1/120 s: the game seconds it takes
    const t = await page.evaluate(() => {
      const G = window.__game, m = G.activeMover(), room = G.hotelRooms()[1];
      G.moveToRoom(room);
      let steps = 0;
      while ((m.walking || m.path.length) && steps < 100000) { m.update(1 / 120); steps++; }
      const c = G.roomCenter(room);
      return { seconds: steps / 120, near: Math.hypot(m.x - c[0], m.z - c[1]) };
    });
    check(t.seconds > 2.2 && t.seconds < 3.1, `a room-to-room walk takes ${t.seconds.toFixed(2)} s of game time (about 3.2 s at the old speed)`);
    check(await page.evaluate(() => !window.__game.activeMover().walking), 'and the guest has arrived');
  } catch (err) { check(false, `e: ${err.message}`); }
  check(!quiet(messages).length, `e: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL TURN-FLOW BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
