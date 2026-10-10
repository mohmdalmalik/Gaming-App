// Headless check of the music and sound effects (src/audio/). Run from tests/ with the static server
// on 8123:  node audio-check.mjs [--url http://127.0.0.1:8123/] [--quick]
//
// 1. the menu: no sound before a tap; the first tap starts the lobby waltz; every effect decodes
// 2. Settings: Music / Sound effects rows, saved on the device and applied at once
// 3. Play with bots through the menu: the reception bell per guest, the lift bell and doors, the
//    lobby music fading with the picture, the night music in the game
// 4. a direct-link match: your-turn chime, a search (rummage + card found), the clock's last seconds,
//    the computer guests' doors / searches heard from the public events, footsteps, the final-round
//    music in round 8, the end screen's stinger
// 5. practice: the game music, a walk with footsteps
// The console must stay clean, and no audio file may 404.
import { launch } from './smoke-lib.mjs';

const args = process.argv.slice(2);
const base = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const quick = args.includes('--quick');
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const { browser, page, messages } = await launch({ width: 1180, height: 820 });
const bad = [];
page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
const audioFiles = new Set();
page.on('response', r => { if (/assets\/audio\//.test(r.url())) audioFiles.add(r.url().split('/').pop()); });
const ev = (fn, a) => page.evaluate(fn, a);
const st = () => ev(() => window.__audio?.state());
const cues = () => ev(() => (window.__audioLog || []).map(l => `${l.name}:${l.why}`));
const played = async () => (await ev(() => (window.__audioLog || []).filter(l => l.why === 'played').map(l => l.name)));
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 200 });

// Answer whatever private or public screen is up (as tests/browser-bots.mjs does): a card to trade,
// a choice, the meeting's first button, a notice, a question (no), or Continue.
async function answerScreens() {
  for (let i = 0; i < 12; i++) {
    const k = await ev(() => {
      const g = window.__game;
      if (g.handoffOpen()) return g.handoffKind();
      if (!document.getElementById('encounter-overlay').hidden) return 'meeting';
      if (g.noticeOpen()) return 'notice';
      if (g.askOpen()) return 'ask';
      if (document.getElementById('discard-overlay') && !document.getElementById('discard-overlay').hidden) return 'discard';
      return null;
    });
    if (!k) return;
    try {
      if (k === 'pick') await page.click('#offer-cards .card-tile', { timeout: 3000 });
      else if (k === 'choice') await page.click('#offer-intent .btn', { timeout: 3000 });
      else if (k === 'meeting') { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click(); else await page.waitForTimeout(250); }
      else if (k === 'notice') await page.click('#btn-notice-ok', { timeout: 3000 });
      else if (k === 'ask') await page.click('#btn-ask-no', { timeout: 3000 });
      else if (k === 'discard') { await page.click('#discard-cards .card-tile', { timeout: 3000 }); await page.click('#btn-discard-done', { timeout: 3000 }); }
      else await page.click('#btn-handoff-next', { timeout: 3000 });
    } catch { /* the screen changed meanwhile */ }
    await page.waitForTimeout(150);
  }
}

// --- 1. the menu ------------------------------------------------------------------------------------
console.log('1. the menu');
await page.goto(base, { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__audio && window.__game, null, 45000);
let s = await st();
check(s.ok && s.context === 'none' && !s.unlocked, `no audio context before a tap (${s.context})`);
check(s.scene === 'menu', `scene is the menu (${s.scene})`);
await waitFor(() => !document.getElementById('btn-menu-bots').disabled, null, 90000);
// the first tap: Settings
await page.click('#btn-menu-settings');
await waitFor(() => window.__audio.state().unlocked, null, 10000);
await waitFor(() => window.__audio.state().playing.includes('lobby'), null, 20000);
s = await st();
check(s.context === 'running', `context running after the first tap (${s.context}, ${s.sampleRate} Hz)`);
check(s.playing.includes('lobby'), 'the lobby waltz plays');
await waitFor(() => window.__audio.state().decoded.length >= 30, null, 30000);
s = await st();
check(s.failed.length === 0, `every file decoded (${s.decoded.length} decoded, failed: ${s.failed.join(', ') || 'none'})`);

// --- 2. Settings ------------------------------------------------------------------------------------
console.log('2. Settings');
const rows = await ev(() => ['music', 'sound'].map(n => [...document.querySelectorAll(`#set-${n} .seg-btn`)].map(b => `${b.textContent}${b.classList.contains('on') ? '*' : ''}`).join(' ')));
check(rows[0] === 'Off Low Medium* High', `Music row: ${rows[0]}`);
check(rows[1] === 'Off Low Medium High*', `Sound effects row: ${rows[1]}`);
await page.click('#set-music .seg-btn[data-value="low"]');
await page.click('#set-sound .seg-btn[data-value="medium"]');
await page.waitForTimeout(300);
s = await st();
const saved = await ev(() => JSON.parse(localStorage.getItem('hotelEscape.settings.v1') || '{}'));
check(s.music === 0.22 && s.sound === 0.6, `levels applied at once (music ${s.music}, sound ${s.sound})`);
check(saved.music === 'low' && saved.sound === 'medium', `saved on the device (${saved.music}, ${saved.sound})`);
const selLog = await played();
check(selLog.includes('select'), 'the settings buttons click (select)');
await page.click('#set-music .seg-btn[data-value="off"]');
await page.waitForTimeout(1500);
s = await st();
check(!s.playing.includes('lobby') && s.music === 0, `Music Off stops the waltz (${s.playing.join(',') || 'nothing'} playing)`);
await page.click('#set-music .seg-btn[data-value="medium"]');
await waitFor(() => window.__audio.state().playing.includes('lobby'), null, 20000);
check(true, 'Music back on: the waltz again');
await page.click('#set-sound .seg-btn[data-value="high"]');
// the screenshot of the settings screen
await page.screenshot({ path: 'shots/audio/settings.png' });
await page.setViewportSize({ width: 1024, height: 700 });
await page.waitForTimeout(400);
await page.screenshot({ path: 'shots/audio/settings-1024x700.png' });
const fit = await ev(() => { const r = document.querySelector('#menu-settings').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
check(fit.top >= 0 && fit.bottom <= fit.h, `settings fit a 1024x700 screen (${Math.round(fit.top)}..${Math.round(fit.bottom)} of ${fit.h})`);
await page.setViewportSize({ width: 1180, height: 820 });
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(() => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 90000);
const kept = await ev(() => [...document.querySelectorAll('#set-music .seg-btn.on, #set-sound .seg-btn.on')].map(b => b.dataset.value));
await page.click('#btn-menu-settings');
await page.waitForTimeout(400);     // (a menu screen ignores taps in its first moments: src/ui/tapGuard.js)
const kept2 = await ev(() => [...document.querySelectorAll('#set-music .seg-btn.on, #set-sound .seg-btn.on')].map(b => b.dataset.value));
check(kept2.join(',') === 'medium,high', `settings kept after a reload (${kept2.join(',')})`);
await page.click('#btn-settings-done');

// --- 3. Play with bots, through the menu and the lift ----------------------------------------------
console.log('3. Play with bots (menu, matchmaking, the lift)');
await waitFor(() => window.__audio.state().unlocked && window.__game.lobbyReady(), null, 60000);
await page.click('#btn-menu-bots');
await page.waitForTimeout(400);
await page.click('#opt-bots .seg-btn[data-value="3"]');
await page.click('#btn-bots-find');
await waitFor(() => window.__game.phase() === 'intro', null, 30000);
const mmPlayed = await played();
check(mmPlayed.filter(n => n === 'joined').length >= 2, `the reception bell as guests join (${mmPlayed.filter(n => n === 'joined').length}x)`);
await waitFor(() => window.__game.phase() === 'game', null, 30000);
await page.waitForTimeout(1500);     // (headless: the slow lift may shut its doors as the picture fades)
const liftPlayed = await played();
check(liftPlayed.includes('liftDing'), 'the lift bell');
// (the doors close ~4.6 s in; the headless lift is slow and may be cut short by the 9 s cap first)
check(liftPlayed.filter(n => n === 'liftDoors').length >= 1, `the lift doors (${liftPlayed.filter(n => n === 'liftDoors').length}x: open${liftPlayed.filter(n => n === 'liftDoors').length > 1 ? ' and close' : ''})`);
await waitFor(() => window.__audio.state().playing.includes('game'), null, 30000);
s = await st();
check(s.playing.includes('game'), `the night music in the game (${s.playing.join(',')})`);
const sceneLog = (await cues()).filter(c => c.startsWith('scene:') || c.startsWith('music:'));
console.log('     ', sceneLog.join('  '));
check(sceneLog.join(' ').includes('scene:intro') && sceneLog.join(' ').includes('scene:none') && sceneLog.join(' ').includes('scene:game'), 'scenes: menu -> intro -> none -> game');
await page.waitForTimeout(3000);
s = await st();
check(!s.playing.includes('lobby'), `the lobby music has gone (${s.playing.join(',')})`);
// back to the menu
await ev(() => window.__game.backToMenu());
await waitFor(() => window.__game.phase() === 'menu', null, 20000);
await waitFor(() => window.__audio.state().playing.includes('lobby'), null, 20000);
check(true, 'back to the menu: the lobby waltz again');
await page.waitForTimeout(4000);
s = await st();
check(!s.playing.includes('game') && !s.decoded.some(f => f === 'music-game.mp3'), `the game music stopped and released (${s.playing.join(',')})`);

// --- 4. a direct-link match ---------------------------------------------------------------------------
console.log('4. a match (direct link, 3 bots, clean, seed 5)');
await ev(() => window.__game.dressingDone());
await page.goto(`${base}?mode=bots&bots=3&role=clean&intro=off&botpace=0.1&seed=5`, { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 90000);
await ev(() => { window.__game.cfg.player.speed = 30; });
await page.click('#btn-begin');
await waitFor(() => window.__game.handoffOpen(), null, 20000);
await page.click('#btn-handoff-next');
await waitFor(() => window.__audio.state().playing.includes('game'), null, 30000);
check(true, 'the night music after Begin');
// play some turns: the player searches and ends; the bots play
const seen = new Set();
const deadline = Date.now() + (quick ? 60000 : 150000);
let myTurns = 0, searched = false;
while (Date.now() < deadline && myTurns < (quick ? 2 : 3)) {
  await page.waitForTimeout(400);
  const g = await ev(() => ({ my: window.__game.myTurn(), act: window.__game.inActionPhase(), ho: window.__game.handoffOpen(), meet: window.__game.meetingOpen(), notice: window.__game.noticeOpen(), fin: window.__game.isFinished() }));
  if (g.fin) break;
  if (g.ho || g.notice || g.meet) { await answerScreens(); continue; }
  if (g.my && g.act) {
    myTurns++;
    if (!searched) {
      await ev(() => window.__game.search());
      await page.waitForTimeout(800);
      searched = true;
      await answerScreens();
    }
    await page.waitForTimeout(300);
    await ev(() => window.__game.endTurn());
    await page.waitForTimeout(500);
  }
}
const matchPlayed = await played();
matchPlayed.forEach(n => seen.add(n));
console.log('      cues played:', [...new Set(matchPlayed)].join(' '));
check(seen.has('yourTurn'), 'your-turn chime');
check(seen.has('search'), 'the rummage of a search');
check(seen.has('step'), 'footsteps');
// (another guest's sounds are played quieter, at most 0.8; the player's own at 1)
const heard = await ev(() => (window.__audioLog || []).filter(l => l.why === 'played' && ['doorOpen', 'doorJammed', 'search'].includes(l.name) && l.vol < 1).map(l => l.name));
check(heard.length > 0, `a computer guest heard (door / search: ${[...new Set(heard)].join(', ') || 'none'})`);
const locked = (await cues()).filter(c => c.endsWith(':locked'));
check(locked.length === 0, `no cue dropped for want of a tap after the first one (${locked.length})`);

// the clock's last seconds, on the player's own turn (the clock jumped to 4.5 s left)
if (!(await ev(() => window.__game.isFinished()))) {
  const before = (await played()).filter(n => n === 'tick').length;
  const t0 = Date.now();
  let set = false;
  while (Date.now() - t0 < 240000) {
    await page.waitForTimeout(300);
    const g = await ev(() => ({ my: window.__game.myTurn(), act: window.__game.inActionPhase(), fin: window.__game.isFinished(), alive: window.__game.state.players[window.__game.humanSeat()].alive, up: (window.__audioLog || []).some(l => l.name === 'timeUp' && l.why === 'played') }));
    if (g.fin || g.up || !g.alive) break;
    if (g.my && g.act && !set && await ev(() => window.__game.timeLeft() > 5)) { await ev(() => window.__game.setTimeLeft(4.5)); set = true; continue; }
    await answerScreens();
  }
  const after = await played();
  const ticks = after.filter(n => n === 'tick').length - before;
  const why = await ev(() => ({ alive: window.__game.state.players[window.__game.humanSeat()].alive, fin: window.__game.isFinished(), round: window.__game.state.round }));
  if (!why.alive || why.fin) console.log('      (the player is out or the match is over before their next turn:', JSON.stringify(why), ')');
  if (why.alive && !why.fin) {
    check(ticks >= 3, `the clock ticks its last seconds (${ticks} ticks)`);
    check(after.includes('timeUp'), 'time up: the clock strikes');
  }
}

// round 8 of 8: the final-round music crossfades in (decoded ahead, in round 7)
if (!(await ev(() => window.__game.isFinished()))) {
  await ev(() => { window.__game.state.round = window.__game.rules.roundLimit - 1; });
  await page.waitForTimeout(2500);
  const pre = await ev(() => window.__audio.state().decoded.includes('music-final.mp3'));
  await ev(() => { window.__game.state.round = window.__game.rules.roundLimit; });
  await waitFor(() => window.__audio.state().playing.includes('final'), null, 30000);
  check(pre, 'round 7: the final-round music is decoded ahead');
  check(true, 'round 8: the final-round music plays');
}

// the end of the match: the rest is played out at once; the end screen's stinger
await ev(() => window.__game.skipToEnd());
await waitFor(() => window.__game.endOpen() || window.__game.isFinished(), null, 60000);
await page.waitForTimeout(2500);
const endLog = await ev(() => (window.__audioLog || []).filter(l => l.why === 'stinger').map(l => l.name));
s = await st();
check(s.scene === 'end' && endLog.length >= 1, `the end screen: a stinger (${endLog.join(', ')}), scene ${s.scene}`);
check(!s.playing.includes('game'), `the night music gives way to it (${s.playing.join(',') || 'nothing looping'})`);

// --- 5. practice -------------------------------------------------------------------------------------
console.log('5. practice');
await page.goto(`${base}?mode=practice`, { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 90000);
await ev(() => { window.__game.cfg.player.speed = 30; });
await page.click('#btn-begin');
await waitFor(() => window.__audio.state().playing.includes('game'), null, 30000);
check(true, 'practice: the night music');
await ev(() => window.__game.noticeOpen() && window.__game.clickNotice());
// open a door and walk into the new room
const door = await ev(() => window.__game.closedDoors().find(d => !d.jammed)?.id);
if (door) {
  await ev(id => window.__game.openDoor(id), door);
  await page.waitForTimeout(600);
}
// walk into a known, lit room (the Lounge, put next to the landing) and search it
await ev(() => window.__game.revealTile('lounge', 'hall'));
await ev(() => window.__game.moveToRoom('lounge'));
await waitFor(() => window.__game.activePlayer().currentRoom === 'lounge' && !window.__game.activeMover().walking, null, 60000);
await page.waitForTimeout(500);
// search the new room: the rummage, and the card found (if any)
const handBefore = await ev(() => window.__game.state.players[0].hand.length);
await ev(() => window.__game.search());
await page.waitForTimeout(1500);
const found = (await ev(() => window.__game.state.players[0].hand.length)) > handBefore;
if (await ev(() => window.__game.handoffOpen())) await ev(() => window.__game.handoffNext());
await page.waitForTimeout(400);
const srch = await played();
check(srch.includes('search'), 'practice search: the rummage');
check(!found || srch.includes('cardFound'), `practice search: a card found sparkles (${found ? 'found something' : 'nothing found'})`);
const prPlayed = await played();
console.log('      cues played:', [...new Set(prPlayed)].join(' '));
check(prPlayed.includes('doorOpen'), 'the door creaks open');
check(prPlayed.includes('step'), 'footsteps on the walk');

// --- the console and the network -----------------------------------------------------------------------
const audioBad = bad.filter(b => /assets\/audio/.test(b));
check(audioBad.length === 0, `no audio file failed to load (${audioBad.join(', ') || 'none'}); ${audioFiles.size} audio files fetched`);
const noise = messages.filter(m => !/GPU stall due to ReadPixels|Automatic fallback to software WebGL|WebGL/.test(m));
check(noise.length === 0, `console clean (${noise.length})`);
if (noise.length) console.log(noise.slice(0, 20).join('\n'));
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
process.exit(failures.length ? 1 : 0);
