// Browser checks for the round 1 build fixes, in headless Chromium (software WebGL, a few frames a second).
// Serve the repo first, then:
//   node tests/browser-build-fixes.mjs [--url http://127.0.0.1:8123/] [--only a,b,c,d]
//
//   a  accidental taps: End turn asks "You still have 3 actions. End turn?" only while actions are left (not at
//      0, not when the clock runs out, not for a computer guest); the card pick is two steps (a tap lifts the
//      card and says what it does; the button names it; another card switches; Cancel works; the second tap of a
//      double tap never gives it)
//   b  the sounds in the page: Continue and the hand's arrows click (not the long drawer), opening opens,
//      closing closes, and choosing a card makes the 'select' sound (the log of the audio module)
//   c  a one-card find and the map legend at the four iPad sizes (1024x694 with Safari's bars, 1024x768,
//      1180x820, 1366x1024): the note is not behind the button, nothing scrolls, the legend's last row shows
//   d  Reduce Motion (Playwright reducedMotion: 'reduce'): the two flickering corridors hold perfectly steady
//      (and flicker, gently, without it), the CSS motion stops, the lobby behind the menu is held Still
//   e  (the fixer's) a Revolver with one shot left says so wherever its words show (the pick, the hand's card
//      view, the found card), not "Two shots"; and with Reduce Motion on, Settings > Menu background shows
//      Animated dimmed and untappable with the reason on the label (and works normally without it)
// (The Leave and Restart questions' gold button is checked in tests/browser-bots.mjs and browser-practice.mjs;
// the flicker's own numbers, flashes a second, in tests/flicker-check.mjs.)
import { launch, giveCard, GUARD_WAIT } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['a', 'b', 'c', 'd', 'e'];
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots', 'build-fixes');
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const waitFor = (page, fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const quiet = messages => messages.filter(m => !/Failed to load resource|favicon/.test(m));

// A match against bots, past the role screen, on the player's own turn (the player sits first).
async function intoMatch(page, query = 'timer=off') {
  await page.goto(`${baseUrl}?mode=bots&bots=3&role=clean&intro=off&botpace=0.1&seed=11&seat=0${query ? `&${query}` : ''}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
  await page.click('#btn-begin');
  await waitFor(page, () => window.__game.handoffKind() === 'role');
  await page.waitForTimeout(500);
  await page.click('#btn-handoff-next');
  await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 120000);
}
async function intoPractice(page) {
  await page.goto(`${baseUrl}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
  await page.click('#btn-begin');
  await page.waitForTimeout(1200);
}
// Answer what the bots put in front of the player until it is the player's own turn again (up to 7 minutes: the
// computer guests walk at a few frames a second here).
async function untilMyTurn(page, ms = 420000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const s = await page.evaluate(() => { const g = window.__game;
      if (g.isFinished()) return 'finished';
      if (g.myTurn() && g.inActionPhase() && !g.handoffOpen() && !g.meetingOpen()) return 'mine';
      if (g.handoffOpen()) return g.handoffKind();
      if (!document.getElementById('encounter-overlay').hidden) return 'meeting';
      if (g.noticeOpen()) return 'notice';
      if (g.askOpen()) return 'ask';
      return null; });
    if (s === 'mine' || s === 'finished') return s === 'mine';
    try {
      if (s === 'pick') await giveCard(page);
      else if (s === 'choice') await page.click('#offer-intent .btn');
      else if (s === 'meeting') { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click(); }
      else if (s === 'notice') await page.click('#btn-notice-ok');
      else if (s === 'ask') await page.click('#btn-ask-no');
      else if (s) await page.click('#btn-handoff-next');
    } catch { /* the screen changed meanwhile */ }
    await page.waitForTimeout(s ? 300 : 1000);
  }
  return false;
}
const barState = page => page.evaluate(() => ({ open: !document.getElementById('confirm-bar').hidden, text: document.getElementById('confirm-text').textContent,
  yes: document.getElementById('btn-confirm-move').textContent.trim(), no: document.getElementById('btn-confirm-cancel').textContent.trim() }));

// ---------------------------------------------------------------------------------------------------
if (only.includes('a')) {
  console.log('\na. accidental taps');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const me = () => ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; return { ap: p.actionPoints, turn: g.state.turn, active: g.state.activeIndex, seat: g.humanSeat() }; });
  try {
    await intoMatch(page, '');                       // (with the 45-second clock: it is part of the check)
    let s = await me();
    check(s.ap === 4, 'the player starts the turn with 4 actions');

    // --- End turn asks, with the real number
    await page.click('#btn-end-turn');
    await page.waitForTimeout(250);
    let b = await barState(page);
    check(b.open && b.text === 'You still have 4 actions. End turn?' && b.yes === 'End turn' && b.no === 'Keep playing', `4 actions left: "${b.text}" with End turn / Keep playing`);
    check((await me()).active === s.seat, 'and the turn has not ended');
    await page.click('#btn-end-turn'); await page.waitForTimeout(150);      // (the second tap of a double tap on End turn)
    check((await barState(page)).open && (await me()).active === s.seat, 'a second tap on End turn does not answer the question');
    // A double tap on End turn: the question opens, and the second tap, in the same instant, lands on its End turn
    // answer (a press that began on the bar): it is ignored (src/ui/tapGuard.js). Keep playing first, to start afresh.
    await page.click('#btn-confirm-cancel'); await page.waitForTimeout(GUARD_WAIT);
    const soon = await ev(() => {
      const tap = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
      tap(document.getElementById('btn-end-turn'));
      document.getElementById('confirm-bar').dispatchEvent(new Event('pointerdown'));
      tap(document.getElementById('btn-confirm-move'));
      return { mine: window.__game.state.activeIndex === window.__game.humanSeat(), open: !document.getElementById('confirm-bar').hidden };
    });
    check(soon.mine && soon.open, 'a double tap on End turn, whose second tap lands on the answer End turn, does not end the turn');
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-confirm-cancel'); await page.waitForTimeout(150);
    check(!(await barState(page)).open && (await me()).active === s.seat && (await me()).ap === 4, 'Keep playing closes it; nothing is spent');
    // With the question open the actions change (a card played): it follows them, and goes at 0.
    await page.click('#btn-end-turn'); await page.waitForTimeout(200);
    await ev(() => { window.__game.state.players[window.__game.humanSeat()].actionPoints = 1; window.__game.refresh(); });
    check((await barState(page)).text === 'You still have 1 action. End turn?', 'with one left it says "action": "You still have 1 action. End turn?"');
    await ev(() => { window.__game.state.players[window.__game.humanSeat()].actionPoints = 0; window.__game.refresh(); });
    check(!(await barState(page)).open, 'at 0 actions the question goes');
    await page.click('#btn-end-turn');
    await waitFor(page, seat => window.__game.state.activeIndex !== seat, s.seat, 20000);
    check(!(await barState(page)).open, 'with no actions left, End turn ends the turn at once: no question');

    // --- a computer guest's turn never asks; the clock running out never asks
    let bar = false;
    const watch = setInterval(() => { barState(page).then(x => { if (x.open) bar = true; }).catch(() => {}); }, 400);
    const back = await untilMyTurn(page);
    clearInterval(watch);
    check(back, 'the turn came back to the player after the computer guests had played');
    check(!bar, 'the question was never up while the computer guests played');
    s = await me();
    await page.click('#btn-end-turn'); await page.waitForTimeout(250);
    check((await barState(page)).open && s.ap > 0, 'on the next turn it asks again');
    await ev(() => window.__game.forceTimeUp());
    await waitFor(page, seat => window.__game.state.activeIndex !== seat || window.__game.handoffOpen(), s.seat, 30000);
    check(!(await barState(page)).open, 'the clock running out ends the turn with no question (and closes the open one)');
    await untilMyTurn(page);

    // --- the card pick, two steps (the screen is called as the game calls it)
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()];
      window.__picked = null; window.__cancelled = false;
      p.hand = [{ id: 'tL', type: 'lantern' }, { id: 'tB', type: 'bandage' }, { id: 'tK', type: 'knife' }, { id: 'tR', type: 'revolver', shots: 2 }, { id: 'tM', type: 'handMirror' }];
      g.handoff.privatePick(p, { kicker: 'A trade', title: 'Give one card to Henry', sub: '', cards: p.hand,
        onPick: id => { window.__picked = id; }, cancelLabel: 'Cancel', onCancel: () => { window.__cancelled = true; } });
    });
    await page.waitForTimeout(600);
    const pickState = () => ev(() => ({ kind: window.__game.handoffKind(), sel: [...document.querySelectorAll('#offer-cards .card-tile.selected')].map(t => t.dataset.cardId),
      words: document.getElementById('offer-summary').textContent, give: document.getElementById('btn-offer-give').textContent, giveOff: document.getElementById('btn-offer-give').disabled,
      giveShown: !document.getElementById('btn-offer-give').hidden, cancel: document.getElementById('btn-handoff-next').textContent, cancelHidden: document.getElementById('btn-handoff-next').hidden,
      cancelGold: document.getElementById('btn-handoff-next').classList.contains('primary'), picked: window.__picked, cancelled: window.__cancelled, tiles: document.querySelectorAll('#offer-cards .card-tile').length }));
    let p = await pickState();
    check(p.kind === 'pick' && p.tiles === 5 && p.giveShown && p.giveOff && p.give === 'Tap a card to give' && p.cancel === 'Cancel' && !p.cancelGold, `the pick: five cards, a grey "Tap a card to give", a plain Cancel ("${p.give}")`);
    await page.click('#offer-cards .card-tile[data-card-id="tL"]'); await page.waitForTimeout(250);
    p = await pickState();
    check(p.picked === null && p.sel.join() === 'tL' && p.give === 'Give the Lantern' && !p.giveOff, `one tap lifts the Lantern and gives nothing: "${p.give}"`);
    check(/^Lantern /.test(p.words) && /protects you from a Possession card/.test(p.words), `it says what the card does ("${p.words.slice(0, 70)}…")`);
    await page.screenshot({ path: path.join(outDir, 'a-pick-lantern.png') });
    await page.click('#offer-cards .card-tile[data-card-id="tR"]'); await page.waitForTimeout(250);
    p = await pickState();
    check(p.sel.join() === 'tR' && p.give === 'Give the Revolver' && /^Revolver /.test(p.words) && p.picked === null, `another card switches the choice: "${p.give}"`);
    await page.click('#offer-cards .card-tile[data-card-id="tR"]'); await page.waitForTimeout(250);
    p = await pickState();
    check(p.sel.join() === 'tR' && p.picked === null, 'tapping the chosen card again keeps it chosen');
    // a double tap: the second tap, in the same instant, gives nothing
    const early = await ev(() => { const tile = document.querySelector('#offer-cards .card-tile[data-card-id="tM"]'), btn = document.getElementById('btn-offer-give');
      const tap = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 })); tap(tile); tap(btn); return window.__picked; });
    p = await pickState();
    check(early === null && p.picked === null && p.kind === 'pick' && p.sel.join() === 'tM' && p.give === 'Give the Hand Mirror', 'the second tap of a double tap does not give the card');
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-handoff-next'); await page.waitForTimeout(200);
    p = await pickState();
    check(p.cancelled === true && p.picked === null && p.kind === null, 'Cancel works, with a card lifted: nothing is given');
    // ...and giving, with the real taps, on a pick that has no way back (a trade that has begun)
    await ev(() => { const g = window.__game, q = g.state.players[g.humanSeat()]; window.__picked = null;
      g.handoff.privatePick(q, { kicker: 'A trade', title: 'Give one card to Henry', cards: q.hand, onPick: id => { window.__picked = id; } }); });
    await page.waitForTimeout(600);
    p = await pickState();
    check(p.giveShown && p.cancelHidden, 'with no way back there is no Cancel button, only the Give button');
    const label = await giveCard(page, '#offer-cards .card-tile[data-card-id="tK"]');
    p = await pickState();
    check(label === 'Give the Knife' && p.picked === 'tK' && p.kind === null, `the button gives it: "${label}", the screen closes`);
    // a possessed guest's soul
    await ev(() => { const g = window.__game, q = g.state.players[g.humanSeat()]; window.__picked = null;
      const souls = [1, 2, 3].map(i => ({ id: `so${i}`, type: 'possession', owner: q.id }));
      g.handoff.privatePick(q, { kicker: 'A trade', title: 'Give one card to Henry', cards: [...souls, { id: 'tB2', type: 'bandage' }], onPick: id => { window.__picked = id; } }); });
    await page.waitForTimeout(600);
    p = await pickState();
    check(p.tiles === 2, 'the three souls are one card (with a x3 badge) beside the Bandage');
    const soulLabel = await giveCard(page, '#offer-cards .card-tile[data-card-id="so1"]');
    p = await pickState();
    check(soulLabel === 'Give your soul' && p.picked === 'so1', `a soul: "${soulLabel}"`);
  } catch (err) { check(false, `a: ${err.message}`); }
  check(!quiet(messages).length, `a: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('b')) {
  console.log('\nb. sounds');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  try {
    await intoMatch(page);
    const ev = (fn, a) => page.evaluate(fn, a);
    // the cues asked for while `fn` runs (the log of the audio module: also when the browser has not let it sound yet)
    const cue = async fn => { await ev(() => { window.__audioLog.length = 0; }); await fn(); await page.waitForTimeout(150); return ev(() => window.__audioLog.map(l => l.name)); };
    check(await ev(() => Array.isArray(window.__audioLog)), 'the audio log is there');
    // Continue after a private screen: a click, not the drawer
    await ev(() => { const g = window.__game; g.handoff.privateNote(g.state.players[g.humanSeat()], ['A private note.'], () => {}); });
    await page.waitForTimeout(500);
    let log = await cue(() => page.click('#btn-handoff-next'));
    check(log.join() === 'click', `Continue ("I understand") makes the click, not the drawer (${log.join() || 'nothing'})`);
    // the hand: opening opens, the arrows click, closing closes
    log = await cue(() => page.click('#btn-private'));
    check(log[0] === 'open', `Private details opens the drawer (${log.join()})`);
    await page.waitForTimeout(400);
    log = await cue(() => page.click('#btn-hand-next'));
    check(log.join() === 'click', `the hand's arrow clicks (${log.join()})`);
    log = await cue(() => page.click('#btn-hand-prev'));
    check(log.join() === 'click', `and the other one (${log.join()})`);
    log = await cue(() => page.click('#btn-hand-close'));
    check(log.join() === 'close', `Close closes (${log.join()})`);
    await page.waitForTimeout(300);
    log = await cue(() => page.click('#btn-map'));
    check(log[0] === 'open', `Map opens (${log.join()})`);
    await page.waitForTimeout(400);
    log = await cue(() => page.click('#btn-map-close'));
    check(log.join() === 'close', `closing the map closes (${log.join()})`);
    // choosing a card makes the select sound: the pick, the weapon, the discard
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()];
      p.hand = [{ id: 'sL', type: 'lantern' }, { id: 'sK', type: 'knife' }, { id: 'sB', type: 'bandage' }];
      g.handoff.privatePick(p, { kicker: 'A trade', title: 'Give one card', cards: p.hand, onPick: () => {} });
    });
    await page.waitForTimeout(600);
    log = await cue(() => page.click('#offer-cards .card-tile[data-card-id="sL"]'));
    check(log.join() === 'select', `tapping a card to give makes the select sound (${log.join() || 'nothing'})`);
    log = await cue(() => page.click('#offer-cards .card-tile[data-card-id="sL"]'));
    check(log.length === 0, 'tapping the chosen card again, which does nothing, is silent');
    await page.waitForTimeout(GUARD_WAIT);
    log = await cue(() => page.click('#btn-offer-give'));
    // (a computer guest's chat line sounds its own quiet click: one in this window must not fail the check)
    check(log.length >= 1 && log.every(n => n === 'click'), `the Give button clicks (${log.join()})`);
    // the weapon picker
    await ev(() => {
      const g = window.__game, p = g.state.players[g.humanSeat()], q = g.state.players.find(x => x !== p);
      p.hand = [{ id: 'wK', type: 'knife' }];
      g.meeting.attackPick(p, q, id => { window.__weapon = id; }, null);
    });
    await page.waitForTimeout(600);
    log = await cue(() => page.click('#encounter-body .card-tile'));
    check(log[0] === 'select', `choosing a weapon makes the select sound (${log.join() || 'nothing'})`);
    await page.waitForTimeout(300);
    // the discard: End turn over the limit opens it
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()];
      p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `q${i}`, type: t })); g.refresh(); });
    await page.click('#btn-end-turn'); await page.waitForTimeout(GUARD_WAIT + 100);
    await page.click('#btn-confirm-move'); await page.waitForTimeout(400);
    check(await ev(() => !document.getElementById('discard-overlay').hidden), 'End turn over the hand limit opens the discard screen');
    log = await cue(() => page.click('#discard-cards .card-tile'));
    check(log.join() === 'select', `choosing a card to discard makes the select sound (${log.join() || 'nothing'})`);
  } catch (err) { check(false, `b: ${err.message}`); }
  check(!quiet(messages).length, `b: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('c')) {
  console.log('\nc. a one-card find and the map legend, four sizes');
  for (const [W, H] of [[1024, 694], [1024, 768], [1180, 820], [1366, 1024]]) {
    const { browser, page, messages } = await launch({ width: W, height: H });
    try {
      await intoPractice(page);
      // (round 4: the reveal is the card(s), the name and one short line each, and the button: no note under them any more;
      // 'same' is two of one kind, which share one column and one line; Lantern's line is the longer two-sentence one)
      for (const variant of ['one', 'pair', 'same']) {
        await page.evaluate(variant => {
          const g = window.__game, p = g.activePlayer();
          g.rules.cards.lantern.desc = 'Three let you escape through the Fire Exit. One protects you from a Possession card.';
          const cards = variant === 'one' ? [{ id: 'x1', type: 'lantern' }] : variant === 'same' ? [{ id: 'x1', type: 'lantern' }, { id: 'x2', type: 'lantern' }] : [{ id: 'x1', type: 'lantern' }, { id: 'x2', type: 'revolver', shots: 2 }];
          g.handoff.privateFound(p, { kicker: 'You search the room-service trolley', title: variant === 'pair' ? 'You found a Lantern and a Revolver' : variant === 'same' ? 'You found 2 Lanterns' : 'You found a Lantern', cards, soft: true }, () => {});
        }, variant);
        await page.waitForTimeout(2200);      // (the cards fade in; software rendering is slow)
        const m = await page.evaluate(() => {
          const card = document.getElementById('handoff-card'), found = document.getElementById('handoff-found'), btn = document.getElementById('btn-handoff-next');
          const lines = [...document.querySelectorAll('#handoff-found .ft-desc')].length;
          const n = found.getBoundingClientRect(), bt = btn.getBoundingClientRect(), c = card.getBoundingClientRect();
          return { scroll: card.scrollHeight - card.clientHeight, notesBottom: n.bottom, btnTop: bt.top, cardTop: c.top, cardBottom: c.bottom, h: innerHeight, lines, notesText: document.getElementById('handoff-notes').textContent.trim() };
        });
        check(m.notesBottom <= m.btnTop - 4, `${W}x${H} ${variant}: the cards and their words end (${Math.round(m.notesBottom)}) above the button (${Math.round(m.btnTop)})`);
        check(m.lines === (variant === 'pair' ? 2 : 1) && m.notesText === '', `${W}x${H} ${variant}: one short line for each kind of card (${m.lines}), and no note`);
        check(m.scroll <= 0 && m.cardTop >= 0 && m.cardBottom <= m.h, `${W}x${H} ${variant}: the card fits the window without scrolling (${m.scroll} over)`);
        await page.screenshot({ path: path.join(outDir, `c-found-${variant}-${W}x${H}.png`) });
        await page.evaluate(() => window.__game.handoff.close());
      }
      await page.evaluate(() => window.__game.toggleMap());
      await page.waitForTimeout(1200);
      const lg = await page.evaluate(() => {
        const panel = document.querySelector('.map-panel').getBoundingClientRect(), leg = document.querySelector('.map-legend');
        const rows = [...leg.children].map(e => e.getBoundingClientRect());
        return { panelBottom: panel.bottom, last: Math.max(...rows.map(r => r.bottom)), n: rows.length, canvas: document.getElementById('map-canvas').getBoundingClientRect().height, scroll: leg.scrollHeight - leg.clientHeight };
      });
      check(lg.n === 10 && lg.last <= lg.panelBottom - 1 && lg.scroll <= 0, `${W}x${H} map: all ${lg.n} legend entries are inside the panel (the last row ends ${Math.round(lg.last)} of ${Math.round(lg.panelBottom)})`);
      check(lg.canvas >= 300, `${W}x${H} map: the plan keeps room (${Math.round(lg.canvas)} px tall)`);
      await page.screenshot({ path: path.join(outDir, `c-map-${W}x${H}.png`) });
    } catch (err) { check(false, `c ${W}x${H}: ${err.message}`); }
    check(!quiet(messages).length, `c ${W}x${H}: a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('d')) {
  console.log('\nd. Reduce Motion');
  // The two flickering corridors in a real page: the light the page really draws, sampled over time.
  async function sampleFlicker(reducedMotion) {
    const { browser, page, messages } = await launch({ width: 1180, height: 820, reducedMotion });
    let out = {};
    try {
      // the menu first (no direct link): the CSS motion and the lobby's Still setting
      await page.goto(`${baseUrl}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
      out.css = await page.evaluate(async () => {
        const probe = (html, sel) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); const cs = getComputedStyle(d.querySelector(sel)); const r = { name: cs.animationName, dur: cs.animationDuration, op: cs.opacity }; d.remove(); return r; };
        const { settings } = await import('/src/settings.js');
        return {
          media: matchMedia('(prefers-reduced-motion: reduce)').matches,
          menuScreen: probe('<section class="menu-screen"></section>', '.menu-screen'),
          pulse: probe('<span class="search-spot live"><span class="ss-badge"></span></span>', '.ss-badge'),
          dots: probe('<span class="think-dots"><i></i></span>', 'i'),
          deal: probe('<button class="fan-card dealt"></button>', '.fan-card'),
          found: probe('<div class="handoff-found"><div class="big-card"></div></div>', '.big-card'),
          lobby: settings.get('menuMotion'),
        };
      });
      await page.click('#btn-begin');
      await page.waitForTimeout(1500);
      // reveal both flickering corridors, stand the guest in one (the lights nearest the guest are lit), and
      // give the light time to come up
      out.placed = await page.evaluate(() => {
        const g = window.__game, i = g.state.activeIndex, p = g.state.players[i];
        const ok = [g.revealTile('serviceCorridor'), g.revealTile('backCorridor')];
        const c = g.roomCenter('serviceCorridor');
        g.state.discovered.add('serviceCorridor'); p.currentRoom = 'serviceCorridor'; g.movers[i].reset(c[0], c[1]); g.discovery.refresh(); g.refresh();
        return ok;
      });
      await page.waitForTimeout(7000);
      // sample at every drawn frame for a while: the baked light maps of the two rooms and the pool of point
      // lights (src/render/mood.js); software rendering draws only a few frames a second
      const series = await page.evaluate(ms => new Promise(resolve => {
        const g = window.__game, rows = [], t0 = performance.now();
        const views = [...g.roomViews.values()].filter(v => v.room.mood.flicker);
        const lights = g.view.scene.children.filter(c => c.isPointLight);
        const read = () => ({ baked: views.flatMap(v => (v.bakedMats || []).map(b => b.mat.lightMapIntensity / b.base)), lights: lights.reduce((a, l) => a + l.intensity, 0) });
        const tick = () => { rows.push(read()); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve({ rows, rooms: views.map(v => v.room.id), baked: views.reduce((n, v) => n + (v.bakedMats?.length || 0), 0) }); };
        requestAnimationFrame(tick);
      }), 16000);
      const spread = xs => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
      const lights = series.rows.map(r => r.lights);
      out.series = { rooms: series.rooms, frames: series.rows.length, bakedMaps: series.baked,
        bakedSpread: series.baked ? Math.max(...series.rows[0].baked.map((_, i) => spread(series.rows.map(r => r.baked[i])))) : null,
        lightSpread: spread(lights), lightMax: Math.max(...lights), lightMin: Math.min(...lights) };
    } catch (err) { out.error = err.message; }
    out.messages = quiet(messages);
    await browser.close();
    return out;
  }
  const calm = await sampleFlicker('reduce');
  const normal = await sampleFlicker(null);
  for (const [name, r] of [['Reduce Motion on', calm], ['Reduce Motion off', normal]]) {
    if (r.error) { check(false, `${name}: ${r.error}`); continue; }
    console.log(`  (${name}: ${JSON.stringify(r.series)})`);
    check(r.placed?.every(Boolean) && r.series.rooms.length === 2, `${name}: both flickering corridors are on the board (${r.series.rooms.join(', ')})`);
    check(r.series.frames >= 8, `${name}: the light was sampled over ${r.series.frames} frames`);
  }
  if (!calm.error && !normal.error) {
    check(calm.css.media && !normal.css.media, 'Playwright reducedMotion reaches the page: it matches with "reduce", not without');
    check(calm.series.lightSpread === 0 && (calm.series.bakedSpread ?? 0) === 0 && calm.series.lightMax > 0,
      `Reduce Motion on: the corridors' light holds perfectly steady (point lights vary by ${calm.series.lightSpread}, baked light maps by ${calm.series.bakedSpread ?? 'n/a'})`);
    const moves = normal.series.lightSpread > 0.02 * normal.series.lightMax || (normal.series.bakedSpread ?? 0) > 0.05;
    check(moves, `Reduce Motion off: the corridors still flicker (point lights vary by ${normal.series.lightSpread.toFixed(3)} of ${normal.series.lightMax.toFixed(2)}, baked by ${normal.series.bakedSpread?.toFixed?.(3) ?? 'n/a'})`);
    check(normal.series.bakedSpread == null || normal.series.bakedSpread <= 0.5, 'and gently: the baked light never moves by more than half');
    // the CSS and the lobby
    check(calm.css.menuScreen.name === 'none' && normal.css.menuScreen.name === 'menuIn', `the menu pages: slide in normally, not with Reduce Motion (${normal.css.menuScreen.name} / ${calm.css.menuScreen.name})`);
    check(calm.css.pulse.name === 'none' && normal.css.pulse.name === 'ss-pulse', `the search icon: pulses normally, still with Reduce Motion (${normal.css.pulse.name} / ${calm.css.pulse.name})`);
    check(calm.css.dots.name === 'none' && normal.css.dots.name === 'think' && Number(calm.css.dots.op) > 0.5, `the waiting dots: move normally; with Reduce Motion they stay, in view (${normal.css.dots.name} / ${calm.css.dots.name}, opacity ${calm.css.dots.op})`);
    check(calm.css.deal.dur === '0.01s' && normal.css.deal.dur === '0.4s', `the cards dealt into the hand: glide normally, are in place at once with Reduce Motion (${normal.css.deal.dur} / ${calm.css.deal.dur})`);
    check(calm.css.found.name === 'none' && normal.css.found.name === 'found-in', `the found card: slides in normally, not with Reduce Motion (${normal.css.found.name} / ${calm.css.found.name})`);
    check(calm.css.lobby === 'off' && normal.css.lobby === 'on', `the lobby behind the menu: animated normally, held Still with Reduce Motion (${normal.css.lobby} / ${calm.css.lobby})`);
  }
  for (const [name, r] of [['on', calm], ['off', normal]]) check(!r.messages?.length, `Reduce Motion ${name}: a clean console${r.messages?.length ? ` (${r.messages.slice(0, 3).join(' | ')})` : ''}`);
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('e')) {
  console.log('\ne. a Revolver with one shot left; Settings under Reduce Motion');
  {
    const { browser, page, messages } = await launch({ width: 1024, height: 694 });
    try {
      await intoPractice(page);
      const words = await page.evaluate(async () => {
        const g = window.__game, p = g.state.players[g.humanSeat()];
        const { cardDesc, bigCard } = await import('/src/ui/cards.js');
        const out = { fn: { none: cardDesc('revolver'), one: cardDesc('revolver', { type: 'revolver', shots: 1 }), two: cardDesc('revolver', { type: 'revolver', shots: 2 }), knife: cardDesc('knife', { type: 'knife' }) } };
        out.big = bigCard(document, { id: 'b1', type: 'revolver', shots: 1 }).querySelector('.bc-desc').textContent;
        p.hand = [{ id: 'r1', type: 'revolver', shots: 1 }, { id: 'r2', type: 'revolver', shots: 2 }, { id: 'tK', type: 'knife' }];
        window.__picked = null;
        g.handoff.privatePick(p, { kicker: 'A trade', title: 'Give one card to Henry', cards: p.hand, onPick: id => { window.__picked = id; } });
        return out;
      });
      check(/One shot left, then it is gone/.test(words.fn.one) && !/Two shots/.test(words.fn.one) && /Attack: 2 damage/.test(words.fn.one), `the words for a Revolver with one shot: "${words.fn.one}"`);
      check(/Two shots, then it is gone/.test(words.fn.two) && words.fn.none === words.fn.two && words.fn.knife === 'Attack: 1 damage, reusable.', 'a new Revolver (two shots), the type alone and other cards keep the catalogue words');
      check(/One shot left/.test(words.big), `the large card (the found card, the card view) says it too ("${words.big}")`);
      await page.waitForTimeout(600);
      await page.click('#offer-cards .card-tile[data-card-id="r1"]'); await page.waitForTimeout(250);
      let t = await page.evaluate(() => ({ summary: document.getElementById('offer-summary').textContent, give: document.getElementById('btn-offer-give').textContent, badge: document.querySelector('#offer-cards .card-tile[data-card-id="r1"] .face-badge')?.textContent }));
      check(t.badge === '1 shot' && /One shot left, then it is gone/.test(t.summary) && !/Two shots/.test(t.summary) && t.give === 'Give the Revolver', `the pick screen: the badge says "${t.badge}" and so do the words ("${t.summary}")`);
      await page.screenshot({ path: path.join(outDir, 'e-pick-revolver-one-shot.png') });
      await page.click('#offer-cards .card-tile[data-card-id="r2"]'); await page.waitForTimeout(250);
      t = await page.evaluate(() => document.getElementById('offer-summary').textContent);
      check(/Two shots, then it is gone/.test(t), `...and a Revolver with two shots says two ("${t}")`);
      await page.evaluate(() => window.__game.handoff.close());
      // the hand's card view
      await page.evaluate(() => window.__game.openHand('r1'));
      await page.waitForTimeout(600);
      const detail = await page.evaluate(() => document.querySelector('.d-desc')?.textContent);
      check(/One shot left, then it is gone/.test(detail || ''), `the hand's card view: "${detail}"`);
      await page.screenshot({ path: path.join(outDir, 'e-hand-revolver-one-shot.png') });
    } catch (err) { check(false, `e (Revolver): ${err.message}`); }
    check(!quiet(messages).length, `e (Revolver): a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
    await browser.close();
  }
  for (const reduce of [true, false]) {
    const name = reduce ? 'Reduce Motion on' : 'Reduce Motion off';
    const { browser, page, messages } = await launch({ width: 1024, height: 694, reducedMotion: reduce ? 'reduce' : null });
    try {
      await page.goto(`${baseUrl}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
      await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
      // (the direct link's card is up: Settings is on the main menu, so open it from there)
      await page.evaluate(() => window.__game.menuShow('settings'));
      await page.waitForTimeout(800);
      const row = () => page.evaluate(() => { const rows = [...document.querySelectorAll('#set-menuMotion .seg-btn')];
        const why = document.getElementById('set-menuMotion-why'), done = document.getElementById('btn-settings-done').getBoundingClientRect(), ver = document.getElementById('set-version').getBoundingClientRect();
        const lab = why.closest('.mf-label').getBoundingClientRect(), wr = why.getBoundingClientRect();
        return { btns: rows.map(b => ({ text: b.textContent, on: b.classList.contains('on'), disabled: b.disabled })), why: why.hidden ? null : why.textContent, whyOneLine: why.hidden || (wr.height < 22 && wr.right <= lab.right + 1),
          fits: ver.top >= 0 && ver.bottom <= innerHeight && done.bottom <= innerHeight, /* (the version line: on the first line of Settings now) */ stored: JSON.parse(localStorage.getItem('hotelEscape.settings.v1') || '{}').menuMotion ?? null }; });
      let r = await row();
      if (reduce) {
        check(r.btns.length === 2 && r.btns[0].text === 'Animated' && r.btns[0].disabled && !r.btns[1].disabled && r.btns[1].on, `${name}: Still is chosen and Animated is dimmed and cannot be tapped (${JSON.stringify(r.btns)})`);
        check(r.why === 'Reduce Motion is on' && r.whyOneLine, `${name}: the label says why, in one line beside the name ("${r.why}")`);
        await page.click('#set-menuMotion .seg-btn[data-value="on"]', { force: true, timeout: 1500 }).catch(() => {});
        await page.waitForTimeout(400);
        r = await row();
        check(r.stored === null && r.btns[1].on && r.btns[0].disabled, `${name}: tapping Animated does nothing (nothing is stored, Still stays chosen)`);
      } else {
        check(r.btns.every(b => !b.disabled) && r.btns[0].on && r.why === null, `${name}: both choices work and there is no note (${JSON.stringify(r.btns)})`);
        await page.click('#set-menuMotion .seg-btn[data-value="off"]'); await page.waitForTimeout(400);
        r = await row();
        check(r.btns[1].on && r.stored === 'off', `${name}: Still can be chosen and is stored`);
        await page.waitForTimeout(350);
        await page.click('#set-menuMotion .seg-btn[data-value="on"]'); await page.waitForTimeout(400);
        r = await row();
        check(r.btns[0].on && r.stored === 'on', `${name}: Animated can be chosen again`);
      }
      check(r.fits, `${name}: the whole Settings screen, Done and the version line, fits at 1024x694`);
      await page.screenshot({ path: path.join(outDir, `e-settings-${reduce ? 'reduce' : 'normal'}.png`) });
    } catch (err) { check(false, `e (${name}): ${err.message}`); }
    check(!quiet(messages).length, `e (${name}): a clean console${quiet(messages).length ? ` (${quiet(messages).slice(0, 3).join(' | ')})` : ''}`);
    await browser.close();
  }
}

console.log(failures.length ? `\n${failures.length} FAILED:\n  ${failures.join('\n  ')}` : '\nALL BUILD-FIX BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
