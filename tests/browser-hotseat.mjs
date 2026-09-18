// Headless browser test of the PHASE 1 HOT-SEAT rules sandbox (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-hotseat.mjs [--screens]
//       node tests/browser-hotseat.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// Covers the whole local hot-seat loop: secret roles, the pass-the-device flow, turn structure
// and the timer, pre-committed Offers, every meeting outcome, the exit end-zone, escaping, the
// round limit, and — just as important — that the public interface never leaks a hidden role.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots');
fs.mkdirSync(outDir, { recursive: true });
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) throw new Error('chromium not found: set CHROME_PATH');
  for (const d of fs.readdirSync(root)) for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
    const p = path.join(root, d, sub); if (fs.existsSync(p)) return p;
  }
  throw new Error('chromium not found');
}

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
const consoleMessages = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMessages.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => consoleMessages.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => consoleMessages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.route(`${CDN}**`, route => {
  const rel = route.request().url().slice(CDN.length).split('?')[0];
  const file = path.join(threeDir, rel);
  route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
});

const game = fn => page.evaluate(fn);
const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}.png`) }); };
const settle = async (t = 40000) => page.waitForFunction(
  () => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 });

// Is an element actually painted? (`hidden` alone is not proof — CSS can override it.)
const visible = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  return el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
}, sel);

async function load(query) {
  const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + query;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 40000 });
  // Headless software rendering runs at a few frames a second, so a walk across the hotel would
  // take a real minute. Only the walking speed is changed — no rule, cost or timer is touched.
  await game(() => { window.__game.cfg.player.speed = 16; });
}
const kind = () => game(() => window.__game.handoffKind());
// Stand a player in a room for real — the figure has to move too, or the discovery watcher
// notices the mismatch on the next frame and walks the rules back to where the figure is.
const place = (index, room) => page.evaluate(({ index, room }) => {
  const g = window.__game, p = g.state.players[index], c = g.roomCenter(room);
  g.state.discovered.add(room);
  p.currentRoom = room;
  g.movers[index].reset(c[0], c[1]);
  g.discovery.refresh(); g.refresh();
}, { index, room });
const put = async (room, ap = 4) => {
  await page.evaluate(({ room, ap }) => { window.__game.activePlayer().actionPoints = ap; window.__game.state.discovered.add(room); }, { room, ap });
  await place(await game(() => window.__game.state.activeIndex), room);
};
const tap = async (sel) => { await page.click(sel); await page.waitForTimeout(70); };
const next = () => tap('#btn-handoff-next');

// Click through whatever hand-over screens are up until the active player's turn is running.
async function intoTurn() {
  for (let i = 0; i < 12; i++) {
    if (await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) return true;
    if (await game(() => window.__game.handoffOpen())) { await next(); continue; }
    return false;
  }
  return false;
}
// Click through the six secret-role screens at the start of a match.
async function throughRoles() {
  for (let i = 0; i < 20; i++) {
    if (await game(() => window.__game.handoffKind()) === 'turn') return;
    if (await game(() => window.__game.handoffOpen())) await next(); else return;
  }
}

console.log('\n1. a six-player hot-seat match starts');
await load('mode=hotseat&players=6&seed=4242');
check(await game(() => window.__game.mode) === 'hotseat', 'the page starts in hot-seat mode');
check(await game(() => window.__game.state.players.length) === 6, 'six guests are at the table');
check(await game(() => window.__game.rules.gameMode) === 'hotseatRulesV1', 'the rules are the approved hotseatRulesV1 set');
check(await game(() => window.__game.possessedIndexes().length) === 1, 'exactly one hidden Possessor');
check(await game(() => window.__game.state.players.every(p => p.hand.every(c => c.type !== 'possession'))),
  'no Possession cards exist — possession is an intent, not a card');
check(await game(() => window.__game.state.players.every(p => p.hand.length === 4)), 'four cards each');
check(await game(() => window.__game.state.players.every(p => p.hand.some(c => c.type === 'lantern'))),
  'every starting hand holds at least one Lantern');
await shot('p1-01-start');

console.log('\n2. secret roles are shown one player at a time');
await tap('#btn-begin');
check(await kind() === 'pass', 'the first screen is a neutral hand-over, not a role');
check(!(await visible('#handoff-hand')) && !(await visible('#handoff-role')),
  'the hand-over screen shows no hand and no role');
check((await page.textContent('#handoff-title')).includes('Pass the device to'), 'it says who to pass the device to');
await shot('p1-02-pass');
await next();
check(await kind() === 'role', 'then that player alone sees their role');
check(await visible('#handoff-role'), 'the role badge is on screen');
const firstRole = await page.textContent('#handoff-role');
check(/GUEST|POSSESSED/.test(firstRole), `the role is stated plainly ("${firstRole.trim().split('\n')[0]}")`);
await shot('p1-03-role');
await next();
check(await kind() === 'pass', 'and the device is handed to the next player');
await throughRoles();
check(await game(() => window.__game.state.players.every(p => p.roleSeen)), 'all six acknowledged their role');
check(await kind() === 'turn', "the first player's private turn screen follows");

console.log('\n3. the private turn screen and the Offer');
check(await visible('#handoff-offer'), 'the Offer chooser is on the private screen');
check((await page.textContent('#offer-summary')).includes('Nothing'), 'the Offer starts as Nothing');
check(await game(() => !window.__game.inActionPhase()), 'the turn has not started yet');
check(await game(() => window.__game.timeLeft()) === 0, 'and the timer is not running during the private screen');
await shot('p1-04-private-turn');
// Commit the first card as the Offer by tapping it.
await page.click('#offer-cards .card-tile:nth-child(2)');
await page.waitForTimeout(80);
check(await game(() => window.__game.offerOf(0).offer !== null), 'tapping a card commits it as the Offer');
check(await game(() => !window.__game.offerOf(0).locked), 'it is still changeable before the turn starts');
await next();

console.log('\n4. the action phase and the turn timer');
check(await game(() => window.__game.inActionPhase()), 'the turn is running');
check(await game(() => Math.round(window.__game.timeLeft())) === 45, 'the 45-second timer starts after the hand-over screen');
check(await visible('#turn-timer'), 'the timer is on screen');
check(await game(() => window.__game.rules.actionPointsPerTurn) === 4, 'four action points a turn');
check(await game(() => window.__game.activePlayer().actionPoints) === 4, 'the active player has all four');
await page.waitForFunction(() => window.__game.timeLeft() < 45, null, { timeout: 15000 }).catch(() => {});
const ticked = await game(() => window.__game.timeLeft());
check(ticked < 45, `the timer counts down (${ticked.toFixed(2)}s left)`);
await shot('p1-05-action');

console.log('\n5. the public interface never carries a hidden role');
check(!(await visible('#possess-tint')), 'there is no possessed screen wash in hot-seat');
check(await page.evaluate(() => !document.getElementById('player-panel').classList.contains('possessed')),
  'the active-player panel never styles itself as possessed');
check(!(await visible('#health-row')), 'no health row (health is off in this mode)');
check(!(await visible('#btn-trade')), 'no Trade button');
const hudText = await page.evaluate(() => document.getElementById('hud').innerText);
check(!/POSSESS/i.test(hudText), 'the word "possessed" appears nowhere in the public interface');
check(await visible('#escapes'), 'escape progress is public');
check((await page.textContent('#esc-count')).trim() === '0 / 2', 'two clean guests must get out at six players');
check((await page.textContent('#obj-count')).trim() === '0 / 3', 'three objectives at six players');
check(await visible('#btn-offer'), 'the active player can review their own Offer');
// The top strip carries public facts only.
const strip = await page.evaluate(() => document.getElementById('players-strip').innerText);
check(/cards/.test(strip), 'the strip shows each guest’s room and card count');
check(!/POSSESS|GUEST/i.test(strip), 'and never a role');

console.log('\n6. the Offer locks on the first action');
await put('corridorW', 4);
await page.click('#btn-search');
await page.waitForTimeout(150);
check(await game(() => window.__game.offerOf(0).locked), 'searching locks the Offer for the rest of the turn');
check(await game(() => window.__game.setOffer(null).reason) === 'locked', 'and it can no longer be changed');
check(await game(() => window.__game.state.searchedRooms.has('corridorW')), 'the room is marked searched');
check((await page.textContent('#search-sub')).includes('Already searched'), 'and the Search button says so');
await shot('p1-05b-searched');

console.log('\n7. the timer running out ends the turn with an Offer of Nothing');
await game(() => { const g = window.__game; g.activePlayer().offer = null; g.activePlayer().offerLocked = false; });
await game(() => window.__game.forceTimeUp());
await page.waitForFunction(() => window.__game.state.activeIndex === 1, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(150);
check(await game(() => window.__game.offerOf(0).offer === null && window.__game.offerOf(0).locked),
  'the Offer locks as Nothing when time runs out');
check(await game(() => window.__game.state.activeIndex) === 1, 'and the turn passes on');
check(await kind() === 'pass', 'the next player gets the neutral hand-over screen');
check(await game(() => window.__game.timeLeft()) === 0, 'the timer does not run during the hand-over');

console.log('\n8. meetings resolve from the two stored Offers, with no off-turn prompt');
await load('mode=hotseat&players=6&seed=51');
await tap('#btn-begin');
await throughRoles();
// Stage it: player 0 clean and moving, player 1 holding a Lantern as their Offer, both in a
// normal room, and the Possessor role on player 0 committing a possession attempt.
await game(() => {
  const g = window.__game, s = g.state;
  const A = s.players[0], B = s.players[1];
  s.players.forEach(p => { p.possessed = false; p.knows = new Set(); p.notes = []; });
  A.possessed = true;
  A.hand = [{ id: 'a1', type: 'hint' }];
  B.hand = [{ id: 'b1', type: 'lantern' }];
  s.activeIndex = 1; B.offerLocked = false; g.setOffer('b1', 'trade');
  s.activeIndex = 0; A.offerLocked = false; g.setOffer('a1', 'possess');
  s.discovered.add('corridorE'); s.discovered.add('corridorW');
  g.refresh();
});
await intoTurn();
check(await game(() => window.__game.offerOf(1).offer) === 'b1', 'the other player already committed their Offer on their own turn');
// Stand them in adjacent rooms and walk player 0 onto player 1 through the real movement path.
await place(1, 'corridorE');
await place(0, 'hall');
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
await game(() => window.__game.moveToRoom('corridorE'));
await settle();
await page.waitForTimeout(300);
check(await game(() => window.__game.meetingOpen()), 'arriving on another guest opens the meeting panel');
const publicLine = await page.textContent('#encounter-body');
check(/blocked/i.test(publicLine), `the public result says the attempt was blocked ("${publicLine.trim().slice(0, 80)}")`);
check(!/POSSESSED/.test(publicLine), 'and never names who tried it');
check(await game(() => !window.__game.state.players[1].possessed), 'the Lantern stopped the possession');
check(await game(() => window.__game.state.players[1].hand.every(c => c.type !== 'lantern')), 'the Lantern was spent');
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'a1')), 'no card changed hands');
check(await game(() => window.__game.notesOf(1).length) > 0, "the defender has a PRIVATE note waiting on their own screen");
await shot('p1-06-meeting');
await tap('#encounter-actions .btn.primary');
check(await game(() => window.__game.handoffKind()) === 'note', 'the attacker reads their own private consequence alone');
await next();
check(await game(() => window.__game.state.meetingThisTurn), 'only one forced meeting is allowed this turn');

console.log('\n9. conversion is told to the new Possessor privately, on their own screen');
await load('mode=hotseat&players=6&seed=88');
await tap('#btn-begin');
await throughRoles();
await game(() => {
  const g = window.__game, s = g.state;
  const A = s.players[0], B = s.players[1];
  s.players.forEach(p => { p.possessed = false; p.notes = []; });
  A.possessed = true;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'hint' }];
  s.activeIndex = 1; B.offerLocked = false; g.setOffer('b1', 'trade');
  s.activeIndex = 0; A.offerLocked = false; g.setOffer('a1', 'possess');
  s.discovered.add('corridorE'); s.discovered.add('corridorW');
  g.refresh();
});
await intoTurn();
await place(1, 'corridorE');
await place(0, 'hall');
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
await game(() => window.__game.moveToRoom('corridorE'));
await settle();
await page.waitForTimeout(300);
const convLine = await page.textContent('#encounter-body');
check(/No cards changed hands/i.test(convLine), 'publicly a successful possession looks like an empty meeting');
check(await game(() => window.__game.state.players[1].possessed), 'the target is now possessed');
check(await game(() => window.__game.state.players[1].roleChangePending), 'they have not been told yet');
await tap('#encounter-actions .btn.primary');
if (await game(() => window.__game.handoffKind()) === 'note') await next();
// Hand the turn on until it is the converted player's turn.
await game(() => { window.__game.state.activeIndex = 0; window.__game.endTurn(); });
await page.waitForTimeout(200);
check(await kind() === 'pass', 'the next turn opens with the neutral hand-over');
await next();
check(await kind() === 'role', 'the converted guest gets a PRIVATE role-change screen');
const changed = await page.textContent('#handoff-role');
check(/POSSESSED/.test(changed), 'and it tells them what they now are');
await shot('p1-07-converted');
await next();
check(await game(() => !window.__game.state.players[1].roleChangePending), 'the change is acknowledged once');

console.log('\n10. objectives, the sealed exit and escaping');
await load('mode=hotseat&players=6&seed=9001');
await tap('#btn-begin');
await throughRoles();
await intoTurn();
check(await game(() => !window.__game.exitUnlocked()), 'the exit starts sealed');
await game(() => {
  const g = window.__game;
  g.floor.roomList.filter(r => r.role === 'objective').forEach(r => g.state.objectivesFound.add(r.id));
  g.refresh();
});
check(await game(() => window.__game.exitUnlocked()), 'finding every objective opens the way out');
await game(() => { window.__game.activePlayer().possessed = false; });
// Put another guest in the exit: arriving there must STILL not force a meeting.
await place(1, await game(() => window.__game.floor.exitRoom));
await put('stairs', 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(400);
check(!(await game(() => window.__game.meetingOpen())), 'arriving in the exit forces NO meeting, even with a guest standing there');
check(await game(() => window.__game.escapes().escaped) === 1, 'the clean guest escaped on entry');
check(await game(() => window.__game.noticeOpen()), 'the table is told who is out');
await shot('p1-08-escaped');
await game(() => window.__game.clickNotice());
await page.waitForTimeout(250);
check(await game(() => window.__game.state.escaped.size) === 1, 'the escape is permanent');
check(await game(() => window.__game.state.activeIndex !== 0), 'the escaped guest takes no further turn');
await intoTurn();
check(await game(() => {
  const g = window.__game;
  for (let i = 0; i < 12; i++) { if (g.state.activeIndex === 0) return false; g.endTurn(); }
  return true;
}) !== false, 'the escaped guest is skipped for the rest of the match');

console.log('\n11. the round limit is the clock');
await load('mode=hotseat&players=6&seed=1234');
await tap('#btn-begin');
await throughRoles();
await intoTurn();
check(await game(() => window.__game.rules.roundLimit) === 8, 'eight rounds');
check((await page.textContent('#round')).includes('/ 8'), 'the header counts them down');
await game(() => { window.__game.state.round = window.__game.rules.roundLimit + 1; });
await game(() => window.__game.endTurn());
await page.waitForTimeout(300);
check(await game(() => window.__game.isFinished()), 'running out of rounds ends the match');
check(await game(() => window.__game.state.won) === 'possessed', 'and the hotel keeps them');
check(await visible('#end-overlay'), 'the end screen is shown');
const endText = await page.textContent('#end-summary');
check(/Possessed at the end/.test(endText), 'the end screen finally reveals who was possessed');
check((await page.textContent('#btn-restart')).trim() === 'New match', 'the end screen offers a new match, not "restart practice"');
check((await page.textContent('#round')).trim() === 'Round 8 / 8', 'the round counter never reads past the limit');
await shot('p1-09-end');

console.log('\n12. practice mode is untouched');
await load('');
check(await game(() => window.__game.mode) === 'practice', 'the plain address still starts practice mode');
check(await game(() => window.__game.state.players.length) === 1, 'one guest');
check(await game(() => window.__game.rules.practiceMode === true && window.__game.rules.turnTimerEnabled === false),
  'practice has no turn timer');
await tap('#btn-begin');
check(!(await visible('#handoff-overlay')), 'and no hand-over screens');
check(!(await visible('#turn-timer')), 'and no clock');
check(await visible('#btn-restart-practice'), 'Restart practice is still there');
check(await game(() => window.__game.isRunning()), 'practice runs straight into the hotel');

console.log('\n13. layouts');
for (const [name, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['desktop', 1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await load('mode=hotseat&players=6&seed=7');
  await tap('#btn-begin');
  await page.waitForTimeout(120);
  const fits = await page.evaluate(() => {
    const card = document.getElementById('handoff-card');
    const r = card.getBoundingClientRect();
    return { inView: r.top >= -1 && r.bottom <= window.innerHeight + 1, btn: document.getElementById('btn-handoff-next').getBoundingClientRect() };
  });
  check(fits.inView, `${name}: the hand-over card fits on screen`);
  check(fits.btn.height >= 40 && fits.btn.bottom <= h + 1, `${name}: the Continue button is a comfortable size and reachable`);
  await throughRoles();
  await intoTurn();
  const bars = await page.evaluate(() => {
    const t = document.getElementById('turn-timer').getBoundingClientRect();
    const o = document.getElementById('btn-offer').getBoundingClientRect();
    const e = document.getElementById('btn-end-turn').getBoundingClientRect();
    return { timerIn: t.right <= window.innerWidth + 1 && t.top >= 0, overlap: o.right > e.left + 1, offerH: o.height };
  });
  check(bars.timerIn, `${name}: the turn timer sits inside the screen`);
  check(!bars.overlap, `${name}: the Offer and End turn buttons do not overlap`);
  check(bars.offerH >= 44, `${name}: the Offer button is a comfortable touch size`);
  await shot(`p1-10-${name}`);
}
await page.setViewportSize({ width: 1180, height: 820 });

console.log('\n14. console');
const noisy = consoleMessages.filter(m => !/favicon|Download the React/i.test(m));
check(noisy.length === 0, noisy.length ? `console noise:\n    ${noisy.slice(0, 6).join('\n    ')}` : 'no console errors or failed requests (clean)');

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL HOT-SEAT BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
