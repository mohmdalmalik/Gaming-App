// Headless check of the first-match tips (src/ui/tips.js; the words: src/data/tips.js), with tips ON — every
// other check starts with them Off (smoke-lib.mjs). Run from tests/ with the static server on 8123:
//   node tips-check.mjs [--url http://127.0.0.1:8123/] [--size 1024x768] [--shots DIR]
//
// One browser, its storage kept from step to step (as one iPad would):
//   a match     no tip over the "Tap to begin" card or the role screen; then "Your turn" beside the player
//               panel: inside the screen, over no part of the interface, End turn still under the finger,
//               the screen round it still the game's (a tap on a fogged room opens its door), the turn clock
//               still running; Got it puts it away and it is remembered (and the second tap of a double
//               tap on it opens no door). The next tip hides itself in time.
//               The Move bar's tip sits clear of Move and Cancel and goes when the bar does. A card that
//               arrives while the card view (a private screen) is open waits for it to close. Only one tip
//               at a time. A clean player never sees a possessed tip, and the tips are never handed the
//               game state (only the player's own situation and public facts).
//   once        a new match on the same device: "Your turn" does not come again.
//   Hide tips   the card says tips are off (a double tap opens no door; the shorter card keeps its edge
//               toward what it explained), goes, the setting is saved, and nothing more shows.
//   Settings    Tips reads Off; "Show tips again" forgets the tips seen and turns tips on.
//   practice    no tip while a question is up; then "Your turn" is back (it was forgotten).
// And a clean console.
import { launch } from './smoke-lib.mjs';
import { TIPS_TIMING } from '../src/data/tips.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg('--url', 'http://127.0.0.1:8123/');
const [W, H] = arg('--size', '1024x768').split('x').map(Number);
const shots = arg('--shots', null);
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const { browser, page, messages } = await launch({ width: W, height: H, tips: true });
const ev = (fn, a) => page.evaluate(fn, a);
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/tips-${name}-${W}x${H}.png` }); };
const poll = async (fn, a, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await ev(fn, a); if (v) return v; await page.waitForTimeout(200); } return null; };
const tips = () => ev(() => window.__game.tips());
const showing = id => poll(i => window.__game.tips().showing === i, id, 25000);
const tipHidden = () => ev(() => document.getElementById('tip').hidden);
const saved = () => ev(() => ({ seen: JSON.parse(localStorage.getItem('hotelEscape.tips.v1') || '{}').seen || [], tips: JSON.parse(localStorage.getItem('hotelEscape.settings.v1') || '{}').tips }));
// The interface a tip must never cover, and whether the card is whole on screen.
const PARTS = ['.hud-top-left', '#feed', '.hud-top-center', '.hud-top-right', '#player-panel', '#hand-fan .fan-card', '#hand-fan .fan-limit',
  '.hud-bottom-right', '#btn-end-turn', '#confirm-bar', '#toast', '#search-spot', '.path-label', '#chat-panel'];
const where = () => ev(parts => {
  const t = document.getElementById('tip');
  if (!t || t.hidden) return null;
  const a = t.getBoundingClientRect();
  const hit = b => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  const over = [];
  for (const s of parts) for (const e of document.querySelectorAll(s)) if (!e.hidden && !e.closest('[hidden]') && e.getClientRects().length && hit(e.getBoundingClientRect())) over.push(s);
  return { over: [...new Set(over)], inside: a.left >= 0 && a.top >= 0 && a.right <= innerWidth && a.bottom <= innerHeight, box: { l: a.left, t: a.top, r: a.right, b: a.bottom } };
}, PARTS);
// What a finger at the middle of `sel` lands on (true: that element or something inside it).
const underFinger = sel => ev(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const at = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return !!at && e.contains(at); }, sel);
async function begin(query) {
  await page.goto(`${base}?${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 90000, polling: 250 });
  await ev(() => { window.__game.setPixelRatio(0.75); window.__game.cfg.player.speed = 16; });
  check(await tipHidden(), 'no tip over the "Tap to begin" card');
  await page.click('#btn-begin');
}
// A double tap on a tip's button (two clicks 140 ms apart at its middle): the card goes (or shrinks) at the
// first, and the second must not reach the hotel under it and open a door. On a machine so slow that the
// two taps arrive further apart than a double tap, the hotel check is skipped (said so).
async function doubleTap(sel, what) {
  const b = await ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; }, sel);
  const state = () => ev(() => ({ rooms: window.__game.hotelRooms().length, ap: window.__game.activePlayer().actionPoints }));
  const b0 = await state();
  // (the times of the two presses, and the card's box at the first: what it looked like when it was tapped)
  await ev(() => { window.__taps = []; window.__tipAtTap = null; document.addEventListener('pointerdown', () => { window.__taps.push(performance.now()); window.__tipAtTap ||= document.getElementById('tip').getBoundingClientRect().toJSON(); }, { capture: true }); });
  await page.mouse.click(b.x, b.y); await page.waitForTimeout(140); await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(600);
  const b1 = await state(), gap = await ev(() => (window.__taps.length > 1 ? window.__taps[1] - window.__taps[0] : Infinity));
  if (gap < TIPS_TIMING.guardMs - 50) check(b1.rooms === b0.rooms && b1.ap === b0.ap, `...a double tap on ${what}: the second tap does nothing on the hotel (rooms ${b0.rooms} -> ${b1.rooms}, actions ${b0.ap} -> ${b1.ap})`);
  else console.log(`  (skipped: the double tap on ${what} arrived ${Math.round(gap)} ms apart on this slow machine)`);
  return ev(() => window.__tipAtTap);
}
const closeScreens = async () => { for (let i = 0; i < 4; i++) { if (await ev(() => window.__game.handoffOpen())) { await ev(() => window.__game.handoffNext()); await page.waitForTimeout(700); } } };

try {
  // --- a match ---------------------------------------------------------------------------------------------
  console.log(`\na match (${W}x${H})`);
  await begin('mode=bots&bots=3&role=clean&seed=7&seat=0&intro=off&botpace=0.1');
  await poll(() => window.__game.handoffOpen(), null, 20000);
  await page.waitForTimeout(2500);
  check(await ev(() => window.__game.handoffKind()) === 'role' && await tipHidden(), 'no tip while the role screen is up');
  await closeScreens();
  check(!!await showing('firstTurn'), '"Your turn" comes up once the role screen has gone');
  await page.waitForTimeout(800);
  let w = await where();
  check(!!w && w.inside && !w.over.length, `...whole on screen, over no part of the interface${w?.over.length ? `: ${w.over.join(', ')}` : ''}`);
  const panel = await ev(() => document.getElementById('player-panel').getBoundingClientRect().toJSON());
  check(!!w && w.box.b <= panel.top && panel.top - w.box.b < 200 && w.box.l < panel.right + 40, `...just above the player panel it explains (card ${Math.round(w?.box.t)}-${Math.round(w?.box.b)}, panel from ${Math.round(panel.top)})`);
  check(await ev(() => document.querySelectorAll('.tip').length) === 1, 'one tip card, never more');
  check(await underFinger('#btn-end-turn') && await underFinger('#btn-map'), 'End turn and Map are still under the finger');
  await shot('first-turn');
  // the clock runs on under it (online, nobody's tips may hold up the table)
  const t0 = await ev(() => window.__game.timeLeft());
  await page.waitForTimeout(2500);
  const t1 = await ev(() => window.__game.timeLeft());
  check(t1 < t0, `the turn clock keeps running while it shows (${t0.toFixed(2)} -> ${t1.toFixed(2)} s)`);
  await ev(() => window.__game.setTimeLeft(9999));     // (the rest of the check happens in this turn)
  // the screen round it is still the game's: a tap on a fogged room next door opens its door
  const fog = await ev(() => { const g = window.__game; const d = g.closedDoors().find(x => !x.jammed); return d ? d.fog : null; });
  const spot = fog && await ev(f => window.__game.tapPointFor({ fog: f }), fog);
  if (spot) {
    const before = await ev(() => ({ rooms: window.__game.hotelRooms().length, ap: window.__game.activePlayer().actionPoints }));
    check(await ev(p => document.elementFromPoint(p.x, p.y)?.tagName, spot) === 'CANVAS', 'a point of the hotel beside it is the hotel, not the tip');
    await page.mouse.click(spot.x, spot.y);
    const after = await poll(b => { const g = window.__game; return g.hotelRooms().length > b.rooms && { rooms: g.hotelRooms().length, ap: g.activePlayer().actionPoints }; }, before, 15000);
    check(!!after && after.ap === before.ap - 1, `...and a tap there opens the door (rooms ${before.rooms} -> ${after?.rooms}, actions ${before.ap} -> ${after?.ap})`);
  } else check(false, 'no fogged room to tap');
  // Got it: put away, and remembered on this device. (On a slow machine "Your turn" may have had its
  // time already: then the clock's tip, brought on by its last 20 seconds, is the one put away.)
  let gotIt = await ev(() => window.__game.tips().showing);
  if (!gotIt) {
    await ev(() => window.__game.setTimeLeft(20));
    gotIt = await showing('timer') && 'timer';
  }
  if (gotIt) {
    await page.waitForTimeout(TIPS_TIMING.guardMs + 100);
    await doubleTap('#tip .tip-ok', 'Got it');
    check(!!await poll(id => window.__game.tips().showing !== id, gotIt, 3000), `Got it puts it away ("${gotIt}")`);
    check((await saved()).seen.includes(gotIt), '...and it is remembered on this device');
  } else check(false, 'a tip to put away with Got it');
  await ev(() => window.__game.setTimeLeft(9999));
  // the next tip hides itself in time, untouched (quick chat, or the map once five rooms are found)
  await ev(() => { const g = window.__game; for (const id of ['library', 'ballroom', 'kitchen', 'dining']) if (g.hotelRooms().length < 6) g.revealTile(id); });
  const next = await poll(() => window.__game.tips().showing, null, 25000);
  if (next) {
    const up = Date.now();
    await shot(`next-${next}`);
    const gone = await poll(id => window.__game.tips().showing !== id, next, TIPS_TIMING.showMs + 15000);
    check(!!gone, `the next tip ("${next}") hides itself, untouched (after ${((Date.now() - up) / 1000).toFixed(1)} s)`);
  } else check(false, 'a second tip came up');
  // the Move bar: its tip clear of Move and Cancel, gone with the bar
  const here = await ev(() => window.__game.activePlayer().currentRoom);
  const opened = (await ev(() => window.__game.hotelRooms())).find(id => id !== here);
  const to = opened && await ev(id => window.__game.tapPointFor({ room: id }), opened);
  if (to) {
    await page.mouse.click(to.x, to.y);
    check(!!await poll(() => !document.getElementById('confirm-bar').hidden, null, 8000), 'a tap on a room opens the Move bar');
    if (await showing('moveBar')) {
      await page.waitForTimeout(600);
      w = await where();
      check(!!w && w.inside && !w.over.length, `the Move bar's tip is over no part of the interface${w?.over.length ? `: ${w.over.join(', ')}` : ''}`);
      check(await underFinger('#btn-confirm-move') && await underFinger('#btn-confirm-cancel'), '...and Move and Cancel are still under the finger');
      await shot('move-bar');
      await page.waitForTimeout(TIPS_TIMING.seenMs);
      await page.click('#btn-confirm-cancel');
      check(!!await poll(() => window.__game.tips().showing !== 'moveBar', null, 4000), '...it goes when the bar does (Cancel)');
    } else check(false, 'the Move bar\'s tip came up');
  } else check(false, 'a room to tap for the Move bar');
  // a card arrives while the card view (private) is open: no tip until it closes
  await poll(() => !window.__game.tips().showing, null, 12000);
  await ev(() => { const g = window.__game; g.openHand(); const p = g.state.players[g.humanSeat()]; p.hand.push({ id: 'tipsCheckCard', type: 'bandage' }); g.refresh(); });
  await page.waitForTimeout(3000);
  check(await ev(() => window.__game.cardViewOpen()) && await tipHidden() && (await tips()).queued.includes('cardFound'), 'a new card while the card view is open: its tip waits');
  await page.click('#btn-hand-close');
  check(!!await showing('cardFound'), '...and comes up once the card view has closed');
  await page.waitForTimeout(600);
  w = await where();
  check(!!w && w.inside && !w.over.length, `...over no part of the interface${w?.over.length ? `: ${w.over.join(', ')}` : ''}`);
  await shot('card');
  const seenNow = await tips();
  check(!seenNow.seen.some(id => /^possessed/.test(id)) && !seenNow.queued.some(id => /^possessed/.test(id)), 'a clean player is never shown a possessed tip');
  const facts = seenNow.facts || [];
  check(facts.includes('me') && !facts.some(k => ['state', 'floor', 'players', 'bots', 'deck'].includes(k)),
    `the tips are told only the player's own situation and public facts, never the game state (${facts.join(', ')})`);

  // --- once per device ----------------------------------------------------------------------------------------
  console.log('\nonce per device');
  await begin('mode=bots&bots=3&role=clean&seed=8&seat=0&intro=off&botpace=0.1&timer=off');
  await poll(() => window.__game.handoffOpen(), null, 20000);
  await closeScreens();
  await poll(() => window.__game.inActionPhase(), null, 10000);
  await page.waitForTimeout(6000);
  const again = await tips();
  check(again.showing !== 'firstTurn' && again.seen.includes('firstTurn'), `a new match on this device: "Your turn" does not come again (showing ${again.showing})`);

  // --- Hide tips -------------------------------------------------------------------------------------------------
  console.log('\nHide tips');
  await poll(() => !window.__game.tips().showing, null, 15000);
  await ev(() => { const g = window.__game; const p = g.state.players[g.humanSeat()]; for (let i = 0; i < 3; i++) p.hand.push({ id: `tipsFull${i}`, type: 'bandage' }); g.refresh(); });
  const any = await poll(() => window.__game.tips().showing, null, 20000);
  check(!!any, `a tip comes up (${any})`);
  await page.waitForTimeout(TIPS_TIMING.guardMs + 100);
  const side = await ev(() => document.getElementById('tip').dataset.side);
  const card0 = await doubleTap('#tip .tip-hide', 'Hide tips');
  const card1 = await ev(() => document.getElementById('tip').getBoundingClientRect().toJSON());
  const kept = side === 'above' ? Math.abs(card0.bottom - card1.bottom) < 2 : side === 'below' ? Math.abs(card0.top - card1.top) < 2 : Math.abs((card0.top + card0.bottom) - (card1.top + card1.bottom)) < 4;
  check(kept, `...the shorter "Tips are off" card keeps its edge toward what it explained (${side}: ${Math.round(card0.top)}-${Math.round(card0.bottom)} -> ${Math.round(card1.top)}-${Math.round(card1.bottom)})`);
  check(/Settings can turn them back on/.test(await ev(() => document.querySelector('#tip .tip-text').textContent)) && !await tipHidden(), 'Hide tips: the card says tips are off');
  await shot('hidden');
  check(!!await poll(() => document.getElementById('tip').hidden, null, TIPS_TIMING.hiddenMs + 4000), '...then goes');
  check((await saved()).tips === 'off', '...and Settings > Tips is saved as Off');
  await ev(() => { const g = window.__game; g.state.round = g.rules.roundLimit; g.refresh(); });
  await page.waitForTimeout(5000);
  check(await tipHidden() && !(await tips()).showing, 'with tips off nothing more shows (the final round has come)');

  // --- Settings: Show tips again ---------------------------------------------------------------------------------
  console.log('\nSettings');
  await ev(() => window.__game.backToMenu());
  await poll(() => window.__game.menuScreen() === 'main', null, 15000);
  await page.click('#btn-menu-settings');
  await page.waitForTimeout(800);
  const row = () => ev(() => ({ seg: [...document.querySelectorAll('#set-tips .seg-btn')].map(b => `${b.textContent}${b.classList.contains('on') ? '*' : ''}`).join(' '), again: document.getElementById('btn-tips-again').textContent, disabled: document.getElementById('btn-tips-again').disabled }));
  let r = await row();
  check(r.seg === 'On Off*' && r.again === 'Show tips again' && !r.disabled, `Settings: Tips reads Off, "Show tips again" ready (${JSON.stringify(r)})`);
  await page.click('#btn-tips-again');
  await page.waitForTimeout(500);
  r = await row();
  const s = await saved();
  check(s.seen.length === 0 && s.tips === 'on', `"Show tips again" forgets the tips seen and turns tips on (seen ${s.seen.length}, tips ${s.tips})`);
  check(r.seg === 'On* Off' && r.again === 'Tips will show again' && r.disabled, `...the row now reads On, "Tips will show again" (${JSON.stringify(r)})`);
  const fit = await ev(() => { const b = document.getElementById('menu-settings').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: innerHeight }; });
  check(fit.top >= 0 && fit.bottom <= fit.h, `the Settings screen fits (${Math.round(fit.top)}..${Math.round(fit.bottom)} of ${fit.h})`);
  await shot('settings');

  // --- practice: no tip while a question is up; the tips seen before are back ------------------------------------
  console.log('\npractice');
  await begin('mode=practice&intro=off');
  await page.waitForTimeout(600);
  await page.click('#btn-leave');
  await poll(() => window.__game.askOpen(), null, 5000);
  await page.waitForTimeout(3000);
  check(await ev(() => window.__game.askOpen()) && await tipHidden(), 'no tip while a question is up ("Leave practice?")');
  await page.click('#btn-ask-no');
  check(!!await showing('firstTurn'), '"Your turn" is back: Show tips again brought it back');
  await page.waitForTimeout(600);
  w = await where();
  check(!!w && w.inside && !w.over.length, `...over no part of the interface${w?.over.length ? `: ${w.over.join(', ')}` : ''}`);
  await shot('practice');
} catch (err) {
  check(false, `tips check: ${err.message.split('\n')[0]}`);
} finally {
  const bad = messages.filter(m => !/favicon|ERR_ABORTED/.test(m));
  check(bad.length === 0, `console clean${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}
console.log(failures.length ? `\n${failures.length} TIPS CHECK(S) FAILED` : '\nALL TIPS CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
