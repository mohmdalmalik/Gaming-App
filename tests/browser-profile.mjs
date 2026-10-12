// Browser checks for profiles: the first-run "Sign the register", the profile card, Change name, a
// device that keeps nothing, and usernames at the table (headless Chromium, software WebGL). No saved
// profile to start with (launch({ profile: false })). Serve the repo first:
//   (cd /home/user/Gaming-App && python3 -m http.server 8123 --bind 127.0.0.1)
//   node tests/browser-profile.mjs [--url http://127.0.0.1:8123/] [--screens] [--sizes 1024x768,1366x1024]
//
// 1. first run (every size): only the register shows, anchored to the top, its field and buttons above
//    the on-screen keyboard; empty, short, reserved and spaced names; Suggest a name; no page scroll
// 2. Continue: the main menu with the profile card (your name), Settings and Your record side by side, the
//    panel on the screen; a reload goes straight to the menu with the same profile
// 3. Change name (from the avatar screen): the register in rename mode, Cancel and Save, back to the avatar
//    screen; the card follows
// 4. a device that keeps nothing (storage refuses writes): the note shows, sign-up and practice still work
// 5. a match from the menu: the matchmaking list by username ("You" marked); the strip, the player panel,
//    End turn, the feed ("You") and the end screen by username; no bot with your name; no named guest
// 6. a direct link with ?user=: never the register, the name for the visit only (not saved), no bot with
//    that name (case ignored) even where the seed would have dealt one; long names stay inside their
//    boxes (strip, panel, End turn); names put into the meeting panel are text, never markup
import { launch } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { makeRng } from '../src/game/cards.js';
import { rollProfiles } from '../src/bots/profiles.js';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const SIZES = (args.includes('--sizes') ? args[args.indexOf('--sizes') + 1] : '1024x768').split(',').map(s => s.split('x').map(Number));
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots', 'profile');
fs.mkdirSync(outDir, { recursive: true });
const NAMED = /\b(Victor|Eleanor|Marcus|Beatrice|Henry|Clara)\b/;

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const allMessages = [];

async function open(opts = {}) {
  const [width, height] = opts.size || SIZES[0];
  const run = await launch({ width, height, profile: false, ...opts.launch });
  const { page } = run;
  if (opts.init) await page.context().addInitScript(opts.init);
  const game = (fn, arg) => page.evaluate(fn, arg);
  const tap = async sel => { await page.click(sel); await page.waitForTimeout(400); };
  const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
  const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}-${width}x${height}.png`) }); };
  const box = sel => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { t: r.top, b: r.bottom, l: r.left, r: r.right, w: r.width, h: r.height }; }, sel);
  const settled = () => page.waitForFunction(() => !window.__game || (window.__game.dressingDone() && (!window.__game.settled || window.__game.settled())), null, { timeout: 90000, polling: 200 }).catch(() => {});
  return { ...run, game, tap, waitFor, shot, box, settled, width, height };
}
const noScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.documentElement.scrollHeight <= innerHeight + 1 && scrollX === 0 && scrollY === 0);
const hint = page => page.textContent('#su-hint');

// ------------------------------------------------------------------------------------------------
console.log('1-3. first run, the main menu, Change name');
for (const [W, H] of SIZES) {
  console.log(`\n  at ${W}x${H}`);
  const s = await open({ size: [W, H] });
  const { page, game, tap, waitFor, shot, box } = s;
  await page.goto(`${baseUrl}?intro=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('menu').hidden);
  await page.waitForTimeout(800);
  check(await game(() => window.__game.menuScreen()) === 'signup' && await game(() => window.__game.profile()) === null, 'a first visit opens on "Sign the register" (no profile yet)');
  check(await game(() => [...document.querySelectorAll('#menu .menu-screen')].filter(e => !e.hidden).map(e => e.id).join()) === 'menu-signup', 'only the register shows (no main menu behind it)');
  check(await page.textContent('#su-title') === 'Sign the register' && await page.textContent('#btn-su-go') === 'Continue' && await page.textContent('#btn-su-suggest') === 'Suggest a name', 'its words: Sign the register · Suggest a name · Continue');
  const input = await box('#su-name'), go = await box('#btn-su-go'), panel = await box('#menu .menu-panel');
  const kb = H >= 1000 ? 424 : 398;           // (the on-screen keyboard in landscape, about)
  check(panel.t <= 40 && go.b <= H - kb - 8 && input.b <= H - kb, `anchored to the top: field and Continue clear of the keyboard (Continue ends at ${Math.round(go.b)}, keyboard from ${H - kb})`);
  check(input.h >= 44 && go.h >= 44 && await game(() => parseFloat(getComputedStyle(document.getElementById('su-name')).fontSize)) >= 16, 'a 44 px field and buttons, text 16 px or more (Safari does not zoom in)');
  check(await game(() => { const i = document.getElementById('su-name'); return i.maxLength === 16 && i.getAttribute('autocapitalize') === 'off' && i.getAttribute('autocorrect') === 'off' && i.spellcheck === false; }), 'the field: 16 characters at most, no autocapitalise or autocorrect');
  check(await noScroll(page), 'the page does not scroll');
  await shot('01-register');
  await tap('#btn-su-go');
  check(await hint(page) === 'Type a name first.' && await game(() => window.__game.menuScreen()) === 'signup', 'Continue with nothing typed: "Type a name first."');
  await page.fill('#su-name', 'jo'); await tap('#btn-su-go');
  check(await hint(page) === 'At least 3 characters.' && await game(() => document.getElementById('su-hint').classList.contains('bad')), 'a short name: "At least 3 characters." in red');
  await shot('02-register-error');
  await page.fill('#su-name', 'jon');
  check(!(await game(() => document.getElementById('su-hint').classList.contains('bad'))), 'once refused, the check runs while typing (fixed: the hint is back to normal)');
  await page.fill('#su-name', 'Kitchen'); await tap('#btn-su-go');
  check(/belongs to the hotel/.test(await hint(page)), 'a room name is refused: "That name belongs to the hotel"');
  await page.fill('#su-name', ''); await page.type('#su-name', 'two words');
  check(await game(() => document.getElementById('su-name').value) === 'two_words' && await page.textContent('#su-count') === '9 / 16', 'a typed space becomes _ (and the count follows)');
  await tap('#btn-su-suggest');
  const suggested = await game(() => document.getElementById('su-name').value);
  check(/^[a-z]+_[a-z]+$/.test(suggested) && suggested.length <= 16 && !(await game(() => document.getElementById('su-hint').classList.contains('bad'))), `Suggest a name fills a good one ("${suggested}")`);
  const name = `nightowl_${W % 100}`;
  await page.fill('#su-name', name);
  await page.press('#su-name', 'Enter');
  await waitFor(() => window.__game.menuScreen() === 'main');
  check((await game(() => window.__game.profile()))?.username === name, `Enter signs the register: the profile is "${name}"`);
  check(await game(() => window.__game.storageKept()), 'this device keeps it (storage works here)');
  await waitFor(() => !document.getElementById('btn-menu-bots').disabled, null, 90000);
  await page.waitForTimeout(900);
  check(await page.textContent('#pc-name') === name && await page.isVisible('#btn-profile') && /Playing as/i.test(await page.textContent('#btn-profile')) && /Adjust avatar/.test(await page.textContent('#btn-profile')), 'the main menu\'s card: "Playing as <name> · Adjust avatar ›"');
  const set = await box('#btn-menu-settings'), rec = await box('#btn-menu-record'), main = await box('#menu .menu-panel');
  check(Math.abs(set.t - rec.t) < 1 && set.h >= 44 && rec.h >= 44 && rec.l > set.r, 'Settings and Your record side by side');
  check(main.t >= 8 && main.b <= H - 8 && await noScroll(page), `the main menu fits the screen (${Math.round(main.t)}-${Math.round(main.b)} of ${H})`);
  check(!NAMED.test(await page.textContent('#menu-main')), 'no named guest in the menu (they stay in the lobby)');
  await shot('03-main');
  // the reload: straight to the menu
  await s.settled();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('menu').hidden);
  await page.waitForTimeout(600);
  check(await game(() => window.__game.menuScreen()) === 'main' && (await game(() => window.__game.profile()))?.username === name && await page.textContent('#pc-name') === name, 'a reload opens straight on the main menu, the same profile');
  // the card opens the avatar screen; Change name; Cancel; Save
  await waitFor(() => !document.getElementById('btn-menu-bots').disabled, null, 90000);
  await tap('#btn-profile');
  check(await game(() => window.__game.menuScreen()) === 'avatar', 'the profile card opens the avatar screen');
  const renameBtn = await page.$('#btn-av-rename');
  if (renameBtn) await tap('#btn-av-rename'); else await game(() => window.__game.showRename());
  check(await game(() => window.__game.menuScreen()) === 'signup' && await page.textContent('#su-title') === 'Change your name'
    && await game(() => document.getElementById('su-name').value) === name && await page.textContent('#btn-su-go') === 'Save' && await page.textContent('#btn-su-suggest') === 'Cancel',
    'Change name: the register in rename mode (Change your name, filled in, Cancel / Save)');
  await shot('04-rename');
  await page.fill('#su-name', 'something_else');
  await tap('#btn-su-suggest');           // Cancel
  check(await game(() => window.__game.menuScreen()) === 'avatar' && (await game(() => window.__game.profile())).username === name, 'Cancel: back to the avatar screen, the name unchanged');
  await game(() => window.__game.showRename());
  await page.waitForTimeout(400);
  await page.fill('#su-name', 'Fire_Exit'); await tap('#btn-su-go');
  check(/belongs to the hotel/.test(await hint(page)) && await game(() => window.__game.menuScreen()) === 'signup', 'the same rules apply to a new name');
  const renamed = `Velvet_${W % 1000}`;
  await page.fill('#su-name', renamed); await tap('#btn-su-go');
  const p2 = await game(() => window.__game.profile());
  check(await game(() => window.__game.menuScreen()) === 'avatar' && p2.username === renamed && p2.nameChangedAt >= p2.createdAt, `Save: back to the avatar screen as "${renamed}"`);
  await game(() => window.__game.menuShow('main'));
  await page.waitForTimeout(400);
  check(await page.textContent('#pc-name') === renamed, 'the card shows the new name');
  allMessages.push(...s.messages);
  await s.settled();
  await s.browser.close();
}

// ------------------------------------------------------------------------------------------------
console.log('\n4. a device that keeps nothing');
{
  const s = await open({ init: () => { try { Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); }; } catch { /* fine */ } } });
  const { page, game, tap, waitFor, shot } = s;
  await page.goto(`${baseUrl}?intro=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('menu').hidden);
  await page.waitForTimeout(600);
  check(await game(() => window.__game.storageKept()) === false, 'storage refuses writes: the account knows (not persistent)');
  check(await page.isVisible('#su-private') && /isn't keeping your name/.test(await page.textContent('#su-private')), `the register says so ("${(await page.textContent('#su-private')).trim()}")`);
  await shot('05-private');
  await page.fill('#su-name', 'pebble_x'); await tap('#btn-su-go');
  await waitFor(() => window.__game.menuScreen() === 'main');
  check((await game(() => window.__game.profile()))?.username === 'pebble_x' && await page.textContent('#pc-name') === 'pebble_x', 'sign-up still works for this visit');
  await waitFor(() => !document.getElementById('btn-menu-practice').disabled, null, 90000);
  await tap('#btn-menu-practice');
  await waitFor(() => window.__game.phase() === 'game' && window.__game.isRunning(), null, 90000);
  check(await game(() => window.__game.state.players.length === 1 && window.__game.state.players[0].name === 'pebble_x'), 'practice starts, as pebble_x');
  check(await page.textContent('#active-player') === 'pebble_x', 'the player panel shows the name');
  allMessages.push(...s.messages);
  await s.settled();
  await s.browser.close();
}

// ------------------------------------------------------------------------------------------------
console.log('\n5. a match from the menu');
{
  const s = await open({ launch: { profile: { username: 'Marlowe_x' } } });
  const { page, game, tap, waitFor, shot } = s;
  await page.goto(`${baseUrl}?seed=2024&botpace=0.1&intro=off&timer=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 90000);
  check(await game(() => window.__game.menuScreen()) === 'main', 'a saved profile: the menu opens on the main screen');
  await tap('#btn-menu-bots');
  check(await game(() => !document.getElementById('opt-guest') && !document.querySelector('.guest-btn')), 'the table screen has no "Your guest" row any more');
  await page.click('#opt-bots .seg-btn[data-value="3"]');
  await tap('#btn-bots-find');
  await waitFor(() => !document.getElementById('menu-matchmaking').hidden, null, 20000);
  await waitFor(() => document.querySelectorAll('#mm-seats .mm-seat.joined').length >= 3, null, 20000);
  await shot('06-matchmaking');
  await waitFor(() => document.querySelectorAll('#mm-seats .mm-seat.joined').length === 4, null, 20000);
  const rows = await game(() => [...document.querySelectorAll('#mm-seats .mm-seat')].map(r => ({ name: r.querySelector('.mm-name').textContent, tag: r.querySelector('.mm-guest').textContent, you: r.classList.contains('you') })));
  check(rows[0].you && rows[0].name === 'Marlowe_x' && rows[0].tag === 'You', 'matchmaking: your row by your username, marked "You"');
  check(rows.slice(1).every(r => r.name && !r.you && r.tag === '' && r.name.toLowerCase() !== 'marlowe_x' && !NAMED.test(r.name)), `the others by username only (${rows.slice(1).map(r => r.name).join(', ')})`);
  await waitFor(() => window.__game.phase() === 'game' && window.__game.isRunning(), null, 90000);
  const seats = await game(() => window.__game.seats());
  check(seats.length === 4 && seats.every((x, i) => x.id === `p${i + 1}`), 'seat ids p1..p4 by seat');
  check(seats.filter(x => x.you).length === 1 && seats.find(x => x.you).name === 'Marlowe_x', 'your seat carries your username');
  check(new Set(seats.map(x => x.avatar?.base)).size === 4 && seats.every(x => x.avatar?.v === 1), 'every seat has an avatar; no two in one look');
  check(await game(() => window.__game.state.players.every((p, i) => p.avatar && p.avatar.base === window.__game.seats()[i].avatar.base)), 'the rules\' players carry the avatar (display only)');
  if (await game(() => window.__game.handoffKind()) === 'role') await page.click('#btn-handoff-next');
  await page.waitForTimeout(500);
  const strip = await game(() => [...document.querySelectorAll('#players-strip .mini-name')].map(e => e.textContent));
  check(strip.length === 4 && strip.includes('Marlowe_x') && strip.every(n => !NAMED.test(n)) && !(await game(() => !!document.querySelector('.mini-user'))), `the strip: one username per guest (${strip.join(', ')})`);
  check(await page.textContent('#active-player') === 'Marlowe_x', 'the player panel: your username');
  // play on until a bot has done something public, then the end
  await game(() => { window.__game.cfg.player.speed = 30; window.__game.setPixelRatio(0.5); });
  const t0 = Date.now();
  let sawTurnOf = '', feedSeen = [];
  while (Date.now() - t0 < 200000) {
    const st = await game(() => ({ mine: window.__game.myTurn() && window.__game.inActionPhase(), fin: window.__game.isFinished(), end: document.querySelector('#btn-end-turn .btn-main').textContent, hand: window.__game.handoffOpen(), meet: !document.getElementById('encounter-overlay').hidden, notice: window.__game.noticeOpen(), ask: window.__game.askOpen() }));
    if (st.fin) break;
    if (/’s turn$/.test(st.end)) sawTurnOf = st.end;
    if (st.hand) await page.click('#btn-handoff-next').catch(() => {});
    else if (st.meet) { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click().catch(() => {}); }
    else if (st.notice) await page.click('#btn-notice-ok').catch(() => {});
    else if (st.ask) await page.click('#btn-ask-no').catch(() => {});
    else if (st.mine) await game(() => window.__game.endTurn());
    feedSeen = [...new Set([...feedSeen, ...await game(() => window.__game.feedLines())])];
    if (sawTurnOf && feedSeen.length >= 3) break;
    await page.waitForTimeout(300);
  }
  const botNames = seats.filter(x => !x.you).map(x => x.name);
  check(botNames.some(n => sawTurnOf === `${n}’s turn`), `End turn names the guest playing by username ("${sawTurnOf}")`);
  check(feedSeen.length > 0 && feedSeen.every(l => !NAMED.test(l) && !/Marlowe_x/.test(l)), `the feed: usernames, and you as "You" / "you", never your name (${feedSeen.slice(0, 3).join(' | ')})`);
  await shot('07-match');
  await game(() => window.__game.skipToEnd());
  await waitFor(() => window.__game.endOpen(), null, 60000);
  const ends = await game(() => [...document.querySelectorAll('#end-reveal .er-row')].map(r => ({ name: r.querySelector('.er-name').textContent, who: r.querySelector('.er-who').textContent })));
  check(ends.length === 4 && ends.filter(r => r.who === 'You').length === 1 && ends.find(r => r.who === 'You').name === 'Marlowe_x' && ends.every(r => !NAMED.test(r.name)), `the end screen: every guest by username, yours marked "You" (${ends.map(r => r.name + (r.who ? ` (${r.who})` : '')).join(', ')})`);
  await shot('08-end');
  allMessages.push(...s.messages);
  await s.settled();
  await s.browser.close();
}

// ------------------------------------------------------------------------------------------------
console.log('\n6. a direct link with ?user=');
{
  // a seed whose table would deal a bot called "nora" (the same draws as src/main.js planGame)
  let seed = 0;
  for (let k = 1; k < 2000 && !seed; k++) {
    const r = makeRng((k * 7919 + 13) >>> 0);
    for (let j = 0; j < 5; j++) r();
    Math.floor(r() * 6);
    if (rollProfiles(5, r).some(p => p.username === 'nora')) seed = k;
  }
  check(seed > 0, `a seed that would seat a bot called nora: ${seed}`);
  const s = await open();
  const { page, game, waitFor, shot, box } = s;
  await page.goto(`${baseUrl}?mode=bots&bots=5&seed=${seed}&user=NoRa&timer=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 90000);
  check(await game(() => document.getElementById('menu').hidden) && await game(() => window.__game.menuScreen()) === null, 'a direct link never shows the register (nor the menu)');
  const seats = await game(() => window.__game.seats());
  check(seats.find(x => x.you)?.name === 'NoRa', '?user=NoRa: you play as NoRa');
  check(!seats.some(x => !x.you && x.name.toLowerCase() === 'nora'), `no bot is called nora, case ignored (${seats.filter(x => !x.you).map(x => x.name).join(', ')})`);
  check(await game(() => window.__game.profile()) === null, '?user= is for this visit only: nothing saved');
  await page.click('#btn-begin');
  await waitFor(() => window.__game.isRunning(), null, 30000);
  if (await game(() => window.__game.handoffKind()) === 'role') await page.click('#btn-handoff-next');
  await page.waitForTimeout(500);
  // names are text in the meeting panel, never markup
  await game(() => window.__game.meeting.notice('<b id="inj">bold</b> declined.', () => {}));
  check(await game(() => !document.getElementById('inj') && /<b id="inj">bold<\/b> declined\./.test(document.getElementById('encounter-body').textContent)), 'a name put into the meeting panel shows as text, never as markup');
  await game(() => window.__game.meeting.close());
  // long names: 16 wide letters in the strip, the panel and End turn stay inside their boxes
  const W16 = 'WWWWWWWWWWWWWWWW';
  await game(n => { const g = window.__game; for (const p of g.state.players) p.name = n; g.rebuildHud(); }, W16);
  await page.waitForTimeout(400);
  const caps = await game(() => {
    const r = s => document.querySelector(s)?.getBoundingClientRect();
    const names = [...document.querySelectorAll('#players-strip .mini-name')].map(e => e.getBoundingClientRect().width);
    const end = document.querySelector('#btn-end-turn .end-name');
    return { strip: Math.max(...names), panel: r('#active-player').width, end: end ? end.getBoundingClientRect().width : 0, endBtn: r('#btn-end-turn').width, endText: document.querySelector('#btn-end-turn .btn-main').textContent };
  });
  check(caps.strip <= 76 && caps.panel <= 201, `a 16-letter name is cut with "…" in the strip (${Math.round(caps.strip)} px) and the panel (${Math.round(caps.panel)} px)`);
  check(!caps.end || caps.end <= 151, `End turn's name is capped (${Math.round(caps.end)} px, the button ${Math.round(caps.endBtn)} px: "${caps.endText}")`);
  const overlaps = await game(() => {
    const sels = ['#player-panel', '#hand-fan', '.hud-bottom-right'];
    const bs = sels.map(s => document.querySelector(s)).filter(e => e && e.offsetParent).map(e => e.getBoundingClientRect());
    let n = 0;
    for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) { const a = bs[i], b = bs[j]; if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2) n++; }
    return n;
  });
  check(overlaps === 0 && await noScroll(page), 'the bottom bar does not overlap or scroll with long names');
  await shot('09-long-names');
  allMessages.push(...s.messages);
  await s.settled();
  await s.browser.close();
}

const bad = allMessages.filter(m => !/favicon/.test(m) && !/net::ERR_ABORTED/.test(m));
check(!bad.length, `no console errors or warnings${bad.length ? `:\n    ${bad.slice(0, 12).join('\n    ')}` : ''}`);
console.log(failures.length ? `\n${failures.length} PROFILE BROWSER CHECK(S) FAILED` : '\nALL PROFILE BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
