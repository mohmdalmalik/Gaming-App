// Browser checks for the main menu and a match against computer guests (bots), in headless Chromium
// (software WebGL). Serve the repo first:
//   (cd /home/user/Gaming-App && python3 -m http.server 8123 --bind 127.0.0.1)
//   node tests/browser-bots.mjs [--url http://127.0.0.1:8123/] [--screens] [--matches 3]
//
// 1. the main menu: buttons, settings remembered, the bots screen, the table filling up, the lift, the game
// 2. a match: the player's role screen, bots playing their turns by themselves, the turn coming back
// 3. privacy: nothing on screen ever shows another guest's role or hand
// 3b. quick chat: the two tabs, "Choose a guest" (Back, the double-tap guard), a line about a guest in the
//    feed and a bubble, a line about you, the bots hearing it; the end screen's chat row (in 5)
// 4. meetings: the player walks in on a bot (trade); a bot walks in on the player (trade, attack)
// 5. playing possessed: the role screen and the reminder; trading a Possession card to a bot
// 6. out of the match: "You are out", skip to the result, the end screen with every role, Play again,
//    Main menu, the Menu button mid-match
// 7. whole matches with a simple stand-in player: no stalls, no errors, every match ends
import { launch, giveCard } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const MATCHES = args.includes('--matches') ? parseInt(args[args.indexOf('--matches') + 1], 10) : 3;
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots', 'bots');
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const { browser, page, messages } = await launch({ width: 1180, height: 820 });
const game = (fn, arg) => page.evaluate(fn, arg);
const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}.png`) }); };
const visible = sel => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && !!e.offsetParent; }, sel);
// (a screen ignores taps in its first moments, so a double tap cannot answer it: src/ui/tapGuard.js)
const tap = async sel => { await page.click(sel); await page.waitForTimeout(400); };
const settle = () => page.waitForTimeout(400);
const waitFor = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const dressed = () => page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 200 });

// Everything on screen that is not the player's own private screens: the HUD, toasts, the feed, the
// meeting panel, notices. None of it may name another guest's role or show a card they hold. (What the
// guests SAY is left out: "nora is possessed!" in the chat is a claim, true or a lie, never a role shown —
// the chat panel, its lines in the feed, the end screen's chat row; the speech bubbles are not in #hud.)
async function publicText() {
  return page.evaluate(() => {
    const parts = [];
    for (const sel of ['#hud', '#encounter-overlay', '#notice-overlay', '#ask-overlay']) {
      const el = document.querySelector(sel);
      if (!el || el.hidden) continue;
      let text = el.innerText;
      for (const c of el.querySelectorAll('#chat-panel, .feed-line.chat, #end-chat')) { const t = c.innerText; if (t) text = text.split(t).join(''); }
      parts.push(text);
    }
    return parts.join('\n');
  });
}
async function noLeak(where) {
  const info = await game(() => {
    const g = window.__game, me = g.humanSeat();
    return { me, names: g.state.players.filter(p => p.index !== me).map(p => p.name), possessedOthers: g.state.players.filter(p => p.index !== me && p.possessed).map(p => p.name) };
  });
  const text = await publicText();
  const bad = info.names.filter(n => new RegExp(`${n}[^.\\n]{0,24}(is POSSESSED|is possessed|possessed —)`).test(text));
  check(!bad.length, `${where}: no other guest's role shows on the public screen${bad.length ? ` (${bad.join(', ')})` : ''}`);
}

// Headless software rendering draws a few frames a second, so walks (which follow the frames) are slow:
// the walking speed is raised and the picture made smaller.
const quick = () => game(() => { window.__game.cfg.player.speed = 30; window.__game.setPixelRatio(0.5); });
// The player's turn has started (no private screen up), or the match is over.
// (Screens put in front of the player meanwhile — a trade, a note waiting at the start of their turn —
// are answered as they come.)
async function untilMyTurn(timeout = 400000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await game(() => { const g = window.__game; return g.isFinished() || (g.myTurn() && g.inActionPhase() && !g.handoffOpen() && !g.meetingOpen()); })) return;
    await answerScreens();
    await page.waitForTimeout(300);
  }
  const why = await game(() => { const g = window.__game, a = g.state.activeIndex, m = g.movers[a]; return JSON.stringify({ turn: g.state.turn, active: a, me: g.humanSeat(), handoff: g.handoffKind(), meeting: g.meetingOpen(), live: g.meetingLive(), walking: m.walking, path: m.path.length, notice: g.noticeOpen(), ask: g.askOpen(), time: g.timeLeft(), log: g.publicLog().slice(-4) }); });
  throw new Error(`untilMyTurn: the turn did not come back ${why}`);
}
// Answer whatever the bots put in front of the player: a card to give (the first one), a private note,
// a yes/no (accept), an attack result, a notice, the "You are out" question (watch).
async function answerScreens() {
  for (let i = 0; i < 12; i++) {
    const s = await game(() => {
      const g = window.__game;
      if (g.handoffOpen()) return g.handoffKind();
      if (!document.getElementById('encounter-overlay').hidden) return 'meeting';
      if (g.noticeOpen()) return 'notice';
      if (g.askOpen()) return 'ask';
      return null;
    });
    if (!s) return;
    if (s === 'pick') await giveCard(page);
    else if (s === 'choice') await page.click('#offer-intent .btn');
    else if (s === 'meeting') { const b = await page.$('#encounter-actions .btn:not([disabled])'); if (b) await b.click(); else await page.waitForTimeout(250); }
    else if (s === 'notice') await page.click('#btn-notice-ok');
    else if (s === 'ask') await page.click('#btn-ask-no');
    else await page.click('#btn-handoff-next');
    await page.waitForTimeout(150);
  }
}

// ------------------------------------------------------------------------------------------------
console.log('\n1. main menu');
await page.goto(`${baseUrl}?seed=31337&botpace=0.15`, { waitUntil: 'load' });
await page.evaluate(() => { try { localStorage.clear(); } catch { /* fine */ } });
await waitFor(() => window.__game && !document.getElementById('btn-menu-bots').disabled && window.__game.lobbyReady() && window.__game.settled(), null, 90000);
await page.goto(`${baseUrl}?seed=31337&botpace=0.15`, { waitUntil: 'domcontentloaded' });
await waitFor(() => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 60000);
check(await visible('#menu-main'), 'the page opens on the main menu');
check(await visible('#btn-menu-bots') && await visible('#btn-menu-practice') && await visible('#btn-menu-settings'), 'Play with bots, Practice alone, Settings');
check(await visible('#btn-profile') && await game(() => document.getElementById('pc-name').textContent) === 'tester', 'the profile card says who you play as (the test profile, tester)');
check(!(await visible('#hud')) && !(await visible('#start-overlay')), 'no game interface behind the menu');
check(await game(() => document.getElementById('view').classList.contains('blurred')), 'the lobby behind it is blurred');
await page.waitForTimeout(1200);
await shot('01-menu');

await tap('#btn-menu-settings');
check(await visible('#menu-settings'), 'Settings opens');
await page.click('#set-botSpeed .seg-btn[data-value="fast"]');
await page.click('#set-follow .seg-btn[data-value="stay"]');
await shot('02-settings');
await tap('#btn-settings-done');
// (let the lobby finish loading its guests first, and the hotel behind it, which loads after the lobby:
// leaving mid-download cuts the downloads off)
await waitFor(() => window.__game.lobbyReady() && window.__game.settled(), null, 90000);
await page.reload({ waitUntil: 'domcontentloaded' });
await waitFor(() => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 60000);
await tap('#btn-menu-settings');
check(await game(() => document.querySelector('#set-botSpeed .seg-btn.on')?.dataset.value) === 'fast'
  && await game(() => document.querySelector('#set-follow .seg-btn.on')?.dataset.value) === 'stay', 'settings are remembered after a reload');
await page.click('#set-follow .seg-btn[data-value="follow"]');
await tap('#btn-settings-done');

await tap('#btn-menu-bots');
check(await visible('#menu-bots'), 'Play with bots opens the table screen');
await page.click('#opt-bots .seg-btn[data-value="3"]');
await page.click('#opt-role .seg-btn[data-value="clean"]');
check(/table of 4 guests/.test(await page.textContent('#opt-bots-note')), 'choosing 3 others says "a table of 4 guests"');
await shot('03-table');
await tap('#btn-bots-find');
await waitFor(() => !document.getElementById('menu-matchmaking').hidden, null, 20000);
check(await game(() => document.querySelectorAll('#mm-seats .mm-seat').length) === 4, 'four seats wait to be filled');
check(await game(() => document.querySelector('#mm-seats .mm-seat.you .mm-name')?.textContent) === 'tester'
  && await game(() => document.querySelector('#mm-seats .mm-seat.you .mm-guest')?.textContent) === 'You', 'you are in the first seat at once, by your username, marked "You"');
await page.waitForTimeout(900);
await shot('04-joining');
await waitFor(() => document.querySelectorAll('#mm-seats .mm-seat.joined').length === 4, null, 20000);
const usernames = await game(() => [...document.querySelectorAll('#mm-seats .mm-seat.joined:not(.you) .mm-name')].map(e => e.textContent));
check(usernames.length === 3 && new Set(usernames).size === 3 && usernames.every(u => u && u !== 'You' && u.toLowerCase() !== 'tester'), `three guests join, each with their own name (${usernames.join(', ')})`);
// The lift, then the game.
await waitFor(() => window.__game.phase() === 'intro', null, 20000);
check(true, 'the lift sequence starts once the table is full');
await page.waitForTimeout(1500);
await shot('05-lift');
await waitFor(() => window.__game.phase() === 'game' && window.__game.isRunning(), null, 60000);
check(await game(() => window.__game.mode()) === 'match' && await game(() => window.__game.state.players.length) === 4, 'a match of 4 guests starts');
check(await game(() => { const g = window.__game; return !g.state.players[g.humanSeat()].possessed && g.state.players.filter(p => p.possessed).length === 1; }), 'role "Clean guest": you are clean, one other guest is possessed');
check(await game(() => window.__game.handoffKind()) === 'role', 'your secret role is shown first');
check(/CLEAN GUEST/.test(await page.textContent('#handoff-role')), 'it says CLEAN GUEST');
await shot('06-role');
await page.click('#btn-handoff-next');
await page.waitForTimeout(400);

// ------------------------------------------------------------------------------------------------
console.log('\n2. the bots play');
await dressed();
await quick();
const t0 = Date.now();
let sawBotTurn = false, myTurns = 0;
while (Date.now() - t0 < 400000 && myTurns < 2) {
  await answerScreens();
  const s = await game(() => ({ mine: window.__game.myTurn(), fin: window.__game.isFinished(), bot: window.__game.isBot(window.__game.state.activeIndex) }));
  if (s.fin) break;
  if (s.bot) sawBotTurn = true;
  if (s.mine && await game(() => window.__game.inActionPhase())) {
    myTurns++;
    await noLeak(`your turn ${myTurns}`);
    if (myTurns === 1) await shot('07-my-turn');
    await game(() => window.__game.endTurn());
  }
  await page.waitForTimeout(500);
}
check(sawBotTurn, 'the computer guests take their turns by themselves');
check(myTurns >= 2, `the turn comes back to you (${myTurns} turns in ${Math.round((Date.now() - t0) / 1000)} s)`);
const feed = await game(() => window.__game.publicLog());
check(feed.length > 2, `the bots act: ${feed.slice(-3).join(' | ')}`);
await shot('08-feed');

// ------------------------------------------------------------------------------------------------
console.log('\n3. privacy');
const strip = await game(() => document.getElementById('players-strip').innerText);
check(!/possess/i.test(strip), 'the guest strip never says who is possessed');
check(/\btester\b/.test(strip) && !/\b(Victor|Eleanor|Marcus|Beatrice|Henry|Clara)\b/.test(strip), `the strip shows the players' usernames, yours among them, and none of the lobby's named guests (${strip.replace(/\s+/g, ' ').slice(0, 80)})`);
check(!(await visible('#panel-role')) && !(await visible('#possess-tint')), 'a clean player sees no possessed reminder');
const fanIds = await game(() => window.__game.fanIds());
const myIds = await game(() => window.__game.state.players[window.__game.humanSeat()].hand.map(c => c.id));
check(fanIds.every(id => myIds.includes(id)), 'the hand shown is your own');

// ------------------------------------------------------------------------------------------------
console.log('\n3b. quick chat: two tabs, a line about a guest, bubbles and the feed');
{
  await untilMyTurn();
  await answerScreens();
  const me = await game(() => window.__game.humanSeat());
  await waitFor(() => !document.getElementById('btn-chat').hidden && !document.getElementById('btn-chat').disabled, null, 20000);
  await tap('#btn-chat');
  await tap('#chat-tab-table');
  check(await game(() => document.querySelectorAll('#chat-page-table .chat-phrase').length === 10 && document.getElementById('chat-page-suspicion').hidden),
    'Chat opens on two tabs: Table shows ten lines');
  await tap('#chat-tab-suspicion');
  check(await game(() => document.querySelectorAll('#chat-page-suspicion .chat-phrase').length === 10 && document.getElementById('chat-page-table').hidden
    && document.querySelectorAll('#chat-page-suspicion .chat-phrase.about .cp-blank').length === 6), 'Suspicion shows ten more, six of them with a blank for a guest');
  const sizes = await game(() => [...document.querySelectorAll('#chat-panel button')].filter(b => b.getClientRects().length && !b.closest('[hidden]')).filter(b => b.offsetHeight < 44 || b.offsetWidth < 44).length);
  check(sizes === 0, 'every button in the panel is at least 44 px');
  await shot('08b-chat-suspicion');
  // A double tap on a line about a guest opens "Choose a guest" and chooses nobody.
  const at = sel => game(s => { const b = document.querySelector(s).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; }, sel);
  const line = await at('[data-chat="distrustX"]');
  await page.mouse.click(line[0], line[1]);
  await page.waitForTimeout(50);
  const tile = await game(() => { const t = document.querySelector('.cp-guest'); if (!t) return null; const b = t.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; });
  if (tile) await page.mouse.click(tile[0], tile[1]);
  await settle();
  const st = await game(() => window.__game.chatPanel());
  const alive = await game(() => { const g = window.__game; return g.state.players.filter(p => p.index !== g.humanSeat() && p.alive && !g.state.escaped.has(p.id)).map(p => p.index); });
  check(st.open && st.asking === 'distrustX' && !(await game(s => window.__game.chatRecent().some(m => m.seat === s), me)), 'a double tap on a line about a guest opens "Choose a guest" and chooses nobody');
  check(JSON.stringify(st.guests) === JSON.stringify(alive), `"Choose a guest" lists the other guests still in the hotel (${st.guests})`);
  await shot('08c-chat-choose');
  await tap('.cp-back');
  const back = await game(() => window.__game.chatPanel());
  check(back.open && back.asking == null && back.tab === 'suspicion', 'Back returns to the Suspicion tab');
  // Send "I don't trust <them>." about the first guest.
  await tap('[data-chat="distrustX"]');
  const them = alive[0];
  await tap(`.cp-guest[data-seat="${them}"]`);
  const sent = await game(() => window.__game.chatRecent().slice(-1)[0]);
  const name = await game(s => window.__game.state.players[s].name, them);
  check(sent && sent.seat === me && sent.id === 'distrustX' && sent.about === them && !(await game(() => window.__game.chatOpen())), `choosing a guest says it to the table and closes the panel ({ seat, id: ${sent?.id}, about: ${sent?.about} })`);
  await page.waitForTimeout(300);
  const feedMine = await game(() => [...document.querySelectorAll('#feed .feed-line.chat.me')].map(e => e.textContent));
  check(feedMine.includes(`You: I don't trust ${name}.`), `the feed: "You: I don't trust ${name}."`);
  // Another guest's lines: about you, and "<them> is possessed!" (a claim: never taken for a leaked role).
  const other = alive.find(s => s !== them) ?? them;
  await game(([s, me2]) => window.__game.chatPost({ seat: s, id: 'triedPossess', about: me2 }), [other, me]);
  await page.waitForTimeout(200);
  await game(([s, t]) => window.__game.chatPost({ seat: s, id: 'isPossessed', about: t }), [them, other === them ? alive[1] ?? other : other]);
  await page.waitForTimeout(1200);
  const otherName = await game(s => window.__game.state.players[s].name, other);
  const lines = await game(() => [...document.querySelectorAll('#feed .feed-line.chat')].map(e => ({ text: e.textContent, me: e.classList.contains('me') })));
  check(lines.some(l => l.text === `${otherName}: You tried to possess me!` && l.me), `a line about you reads "${otherName}: You tried to possess me!"`);
  // (the bubble over the speaker, whether or not they are on screen just now)
  const bubbles = await game(() => window.__game.chatPanel().bubbles);
  check(bubbles.some(b => b.seat === other && b.text === 'You tried to possess me!' && /\babout-me\b/.test(b.cls)), 'its speech bubble says "You tried to possess me!" with the brighter edge');
  check(await game(() => window.__game.botsHeard()) >= 3, 'the computer guests heard every line');
  await shot('08d-chat-bubbles');
  await noLeak('after "… is possessed!" in the chat');
}

// ------------------------------------------------------------------------------------------------
console.log('\n4. meetings');
// A bot walks in on the player: its next move is scripted to the player's room (tests only).
{
  await untilMyTurn();
  const info = await game(() => {
    const g = window.__game, me = g.state.players[g.humanSeat()];
    return { room: me.currentRoom, hall: me.currentRoom === g.floor.start.room };
  });
  // Get out of the lobby (a safe zone, no meetings there): open a door and step through.
  if (info.hall) {
    const door = await game(() => window.__game.closedDoors().find(d => !d.jammed)?.id);
    if (door) await game(id => window.__game.openDoor(id), door);
    await page.waitForTimeout(300);
    const to = await game(() => { const g = window.__game, me = g.state.players[g.humanSeat()]; return [...g.floor.rooms.get(me.currentRoom).neighbours].find(r => !g.floor.rooms.get(r).safe && !g.lockedRooms().includes(r)); });
    if (to) { await game(r => window.__game.moveToRoom(r), to); await waitFor(() => !window.__game.walkPlan(), null, 20000); }
  }
  await answerScreens();
  const myRoom = await game(() => window.__game.state.players[window.__game.humanSeat()].currentRoom);
  // Script the next bot to walk to the player and trade.
  await game(room => {
    const g = window.__game, t = g.bots(), me = g.humanSeat();
    const orig = t.nextAction.bind(t), origAttack = t.attackWith.bind(t);
    window.__scripted = { done: false };
    t.nextAction = i => {
      const p = g.state.players[i];
      if (!window.__scripted.done && p.currentRoom !== room && p.actionPoints >= 1) { window.__scripted.done = true; window.__scripted.by = i; return { k: 'move', to: room }; }
      return orig(i);
    };
    t.attackWith = (i, j) => (j === me ? null : origAttack(i, j));
  }, myRoom);
  await game(() => window.__game.endTurn());
  await waitFor(() => window.__game.handoffKind() === 'pick' || window.__game.isFinished() || window.__game.myTurn(), null, 400000);
  const picked = await game(() => window.__game.handoffKind() === 'pick');
  check(picked, 'a bot walks in on you and asks for a trade: you choose a card in private');
  if (picked) {
    await shot('09-bot-trade-pick');
    const before = await game(() => window.__game.state.players[window.__game.humanSeat()].hand.map(c => c.id).sort().join());
    await settle();
    await giveCard(page);
    await waitFor(() => window.__game.handoffKind() === 'note', null, 20000);
    check(true, 'after a short wait you read what you received, in private');
    await shot('10-trade-result');
    await page.click('#btn-handoff-next');
    const after = await game(() => window.__game.state.players[window.__game.humanSeat()].hand.map(c => c.id).sort().join());
    check(before !== after, 'the cards changed hands');
    check(/traded/.test((await game(() => window.__game.publicLog())).slice(-3).join(' ')), 'the public log says only that you traded');
  }
  await answerScreens();
}
// The player walks in on a bot.
{
  await untilMyTurn();
  await answerScreens();
  const target = await game(() => {
    const g = window.__game, me = g.state.players[g.humanSeat()];
    const room = g.floor.rooms.get(me.currentRoom);
    return g.state.players.find(q => q.index !== me.index && q.alive && room.neighbours.has(q.currentRoom) && !g.floor.rooms.get(q.currentRoom).safe && !g.lockedRooms().includes(q.currentRoom))?.currentRoom ?? null;
  });
  if (target) {
    await game(r => window.__game.moveToRoom(r), target);
    await waitFor(() => window.__game.meetingOpen() || window.__game.handoffOpen(), null, 30000).catch(() => {});
    const meet = await game(() => window.__game.meetingOpen());
    check(meet, 'walking into a bot\'s room forces a meeting');
    if (meet) {
      await shot('11-you-meet');
      let label = await game(() => document.getElementById('encounter-title').innerText);
      // Several guests in the room: first choose whom to meet.
      if (/You are not alone/.test(label)) {
        check(await game(() => document.querySelectorAll('#encounter-actions .btn').length) >= 2, 'several guests there: "You are not alone" — you choose whom to meet');
        await settle();
        await page.click('#encounter-actions .btn');
        await page.waitForTimeout(300);
        label = await game(() => document.getElementById('encounter-title').innerText);
      }
      check(/^You meet/.test(label), `the panel speaks to you ("${label.replace(/\s+/g, ' ')}")`);
      await settle();
      await page.click('#encounter-actions .btn.primary');      // Trade
      await waitFor(() => window.__game.handoffKind() === 'pick', null, 10000);
      await settle();
      await giveCard(page);
      await waitFor(() => window.__game.handoffKind() === 'note', null, 20000);
      check(true, 'you trade with the bot, and read the result in private');
      await page.click('#btn-handoff-next');
    }
  } else check(true, '(no bot next door this time: skipped)');
  await answerScreens();
}

// ------------------------------------------------------------------------------------------------
console.log('\n5. out of the match, the end screen');
{
  await untilMyTurn();
  // Make the player easy to kill and script a bot attack (tests only).
  await game(() => {
    const g = window.__game, me = g.state.players[g.humanSeat()];
    me.health = 1;
    const t = g.bots(), room = () => me.currentRoom;
    const orig = t.nextAction.bind(t), origAttack = t.attackWith.bind(t);
    window.__killer = null;
    // The killer starts next door: the next guest to act, with a knife, in a room beside the player's (the lobby will do:
    // it is only the player's room that must not be a safe one). The computer guests roam widely now: a killer picked by
    // whoever happened to act first could be far away, or already in the player's room (a guest who is there already is not
    // forced to meet them again, and walks off). This check is about what an attack looks like on the player's screen,
    // not about how far a bot walks or where it starts.
    {
      const k = g.nextPlayer(), here = g.floor.rooms.get(room());
      const nb = [...here.neighbours].find(id => g.state.discovered.has(id) && !g.lockedRooms().includes(id));
      if (k && k.index !== me.index && k.alive && nb) {
        k.currentRoom = nb;
        const mid = g.roomCenter(nb); g.movers[k.index].reset(mid[0], mid[1]);
        if (!k.hand.some(card => card.type === 'knife')) k.hand.push({ id: `test-knife-${k.index}`, type: 'knife' });
        window.__killer = k.index;
      }
    }
    // A guest of the clean side must be left alive when the player dies, or the match is over at once and there is no
    // "You are out" question to check (by round 4 the computer guests may have possessed everyone else).
    if (!me.possessed && !g.state.players.some(q => q.index !== me.index && q.alive && !q.possessed)) {
      const spare = g.state.players.find(q => q.index !== me.index && q.index !== window.__killer && q.alive);
      if (spare) { spare.possessed = false; spare.hand = spare.hand.filter(card => card.type !== 'possession'); }
    }
    t.nextAction = i => {
      const p = g.state.players[i];
      if (window.__killer == null && p.alive && !g.floor.rooms.get(room()).safe) {
        if (!p.hand.some(c => c.type === 'knife')) p.hand.push({ id: `test-knife-${i}`, type: 'knife' });
        window.__killer = i;
      }
      if (window.__killer === i && p.currentRoom !== room() && p.actionPoints >= 2 && me.alive) return { k: 'move', to: room() };
      return orig(i);
    };
    t.attackWith = (i, j) => (i === window.__killer && j === me.index ? p_knife(i) : origAttack(i, j));
    function p_knife(i) { return g.state.players[i].hand.find(c => c.type === 'knife')?.id ?? null; }
  });
  const safeNow = await game(() => { const g = window.__game; return g.floor.rooms.get(g.state.players[g.humanSeat()].currentRoom).safe; });
  if (!safeNow) {
    await game(() => window.__game.endTurn());
    await waitFor(() => !document.getElementById('encounter-overlay').hidden || window.__game.isFinished(), null, 400000).catch(() => {});
    const hit = await game(() => /hit you/.test(document.getElementById('encounter-body').innerText));
    check(hit, 'a bot attacks you: the result says "hit you"');
    await shot('12-attacked');
    if (hit) {
      await settle();
      await page.click('#encounter-actions .btn');
      await waitFor(() => window.__game.askOpen() || window.__game.isFinished(), null, 10000);
      check(await game(() => window.__game.askOpen() && /You are out/.test(document.getElementById('ask-title').textContent)), 'dead: "You are out" — watch or skip to the result');
      await shot('13-out');
      await page.click('#btn-ask-yes');      // Skip to the result
      await waitFor(() => window.__game.endOpen(), null, 30000);
    }
  } else check(true, '(the player is in a safe zone: skipped the attack)');
  if (!(await game(() => window.__game.endOpen()))) { await game(() => window.__game.skipToEnd()); await waitFor(() => window.__game.endOpen(), null, 30000).catch(() => {}); }
  check(await game(() => window.__game.endOpen()), 'the match ends with the end screen');
  {
    // what is said there shows on its own row: a line about you reads as said to you
    const [s, me] = await game(() => { const g = window.__game, me = g.humanSeat(); return [g.state.players.find(p => p.index !== me).index, me]; });
    await waitFor(() => !document.getElementById('end-chat').hidden, null, 10000).catch(() => {});
    await game(([s2, me2]) => window.__game.chatPost({ seat: s2, id: 'isClean', about: me2 }), [s, me]);
    await page.waitForTimeout(300);
    const n = await game(i => window.__game.state.players[i].name, s);
    const ec = await game(() => [...document.querySelectorAll('#end-chat .ec-line')].map(e => e.textContent.trim()));
    check(ec.includes(`${n}: You are clean.`), `the end screen's chat row: "${n}: You are clean."`);
  }
  const rows = await game(() => [...document.querySelectorAll('#end-reveal .er-row')].map(r => r.innerText.replace(/\s+/g, ' ')));
  check(rows.length === 4 && rows.filter(r => /possessed/i.test(r)).length >= 1 && rows.some(r => /\bYou\b/.test(r)), `the end screen shows every guest's role (${rows.join(' / ')})`);
  check(rows.some(r => /\btester\b/.test(r) && /\bYou\b/.test(r)) && !rows.some(r => /\b(Victor|Eleanor|Marcus|Beatrice|Henry|Clara)\b/.test(r)), 'the end screen lists the players by username, yours marked "You"');
  await shot('14-end');
  await tap('#btn-restart');      // Play again
  await waitFor(() => window.__game.isRunning() && !window.__game.endOpen() && window.__game.handoffKind() === 'role', null, 30000);
  await quick();
  check(true, 'Play again starts a new match at a new table (your role first)');
  await page.click('#btn-handoff-next');
  // The Menu button mid-match.
  await waitFor(() => !window.__game.handoffOpen(), null, 30000);
  await answerScreens();
  await tap('#btn-leave');
  check(await game(() => window.__game.menuPanelOpen() && !window.__game.askOpen()), 'the Menu button opens the Menu panel (Resume, Sound, How to play, Leave)');
  await tap('#btn-gm-leave');
  check(await game(() => window.__game.askOpen() && !window.__game.menuPanelOpen()), 'Leave asks before leaving the match');
  await tap('#btn-ask-yes');
  await waitFor(() => window.__game.phase() === 'menu' && !document.getElementById('menu').hidden, null, 20000);
  check(true, 'and goes back to the main menu');
}

// ------------------------------------------------------------------------------------------------
console.log('\n6. playing possessed');
{
  await tap('#btn-menu-bots');
  await page.click('#opt-bots .seg-btn[data-value="5"]');
  await page.click('#opt-role .seg-btn[data-value="possessed"]');
  await tap('#btn-bots-find');
  await waitFor(() => window.__game.phase() === 'game' && window.__game.handoffKind() === 'role', null, 90000);
  await quick();
  check(await game(() => window.__game.state.players.length) === 6 && await game(() => window.__game.state.players[window.__game.humanSeat()].possessed), 'role "Possessed": a table of 6, and you start possessed');
  check(/POSSESSED/.test(await page.textContent('#handoff-role')), 'the role screen says POSSESSED');
  await shot('15-possessed-role');
  await page.click('#btn-handoff-next');
  await untilMyTurn();
  check(await visible('#panel-role') && await visible('#panel-souls'), 'your panel shows POSSESSED and your souls to trade');
  check(await game(() => window.__game.fanIds().some(id => window.__game.state.players[window.__game.humanSeat()].hand.find(c => c.id === id)?.type === 'possession')), 'your Possession cards are in your hand');
  await shot('16-possessed-turn');
  await tap('#btn-leave');
  await tap('#btn-gm-leave');      // (Leave, on the Menu panel, asks the question)
  check(await game(() => { const q = document.getElementById('ask-title').textContent, no = document.getElementById('btn-ask-no'), yes = document.getElementById('btn-ask-yes');
    return q === 'Leave the match?' && no.textContent === 'Keep playing' && no.classList.contains('primary') && yes.textContent === 'Main menu' && !yes.classList.contains('primary'); }),
    '"Leave the match?": the safe answer, Keep playing, is the gold button; Main menu, which loses the match, is the plain one');
  await tap('#btn-ask-yes');
  await waitFor(() => window.__game.phase() === 'menu', null, 20000);
}

// ------------------------------------------------------------------------------------------------
console.log(`\n7. whole matches (${MATCHES}) with a stand-in player`);
for (let m = 0; m < MATCHES; m++) {
  const role = ['random', 'clean', 'possessed'][m % 3];
  const bots = [5, 4, 3][m % 3];
  await dressed().catch(() => {});
  await waitFor(() => !window.__game || window.__game.characters.every(c => c.debug().loaded || !c.debug().model), null, 60000).catch(() => {});
  await page.goto(`${baseUrl}?mode=bots&bots=${bots}&role=${role}&botpace=0.1&intro=off&seed=${9000 + m}`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 60000);
  await quick();
  await page.click('#btn-begin');
  const start = Date.now();
  let lastTurn = -1, lastChange = Date.now(), stalled = false, turnsPlayed = 0;
  while (Date.now() - start < 1200000) {
    await answerScreens();
    const s = await game(() => { const g = window.__game; return { fin: g.isFinished(), turn: g.state.turn, mine: g.myTurn() && g.inActionPhase() && !g.handoffOpen() && !g.meetingOpen(), alive: g.state.players[g.humanSeat()].alive }; });
    if (s.fin) break;
    if (s.turn !== lastTurn) { lastTurn = s.turn; lastChange = Date.now(); turnsPlayed++; }
    if (Date.now() - lastChange > 150000) { stalled = true; break; }
    if (s.mine) {
      // The stand-in: open a door or step to a room next door, search if it can, then end the turn.
      await game(() => {
        const g = window.__game, me = g.state.players[g.humanSeat()];
        const doors = g.closedDoors().filter(d => !d.jammed);
        if (me.actionPoints >= 2 && doors.length && Math.random() < 0.5) g.openDoor(doors[0].id);
        else {
          const next = [...g.floor.rooms.get(me.currentRoom).neighbours].filter(r => g.state.discovered.has(r) && !g.lockedRooms().includes(r));
          if (next.length && me.actionPoints >= 1) g.moveToRoom(next[Math.floor(Math.random() * next.length)]);
        }
      });
      await page.waitForTimeout(400);
      await waitFor(() => !window.__game.walkPlan() || window.__game.meetingOpen() || window.__game.handoffOpen(), null, 30000).catch(() => {});
      await answerScreens();
      if (await game(() => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.isFinished())) {
        await game(() => window.__game.endTurn());
        // over the hand limit: discard the first card until the turn passes
        for (let d = 0; d < 6 && await visible('#discard-overlay'); d++) {
          await page.click('#discard-cards .card-tile'); await page.click('#btn-discard-done'); await page.waitForTimeout(150);
        }
      }
    }
    if (!s.alive && await game(() => window.__game.askOpen())) await page.click('#btn-ask-yes');
    await page.waitForTimeout(250);
  }
  const end = await game(() => ({ fin: window.__game.isFinished(), won: window.__game.state.won, dawn: window.__game.state.dawn, round: window.__game.state.round, end: window.__game.endOpen() }));
  check(!stalled && end.fin, `match ${m + 1} (${bots + 1} guests, role ${role}): ends — ${end.won}${end.dawn ? ' at dawn' : ''}, round ${end.round}, ${turnsPlayed} turns, ${Math.round((Date.now() - start) / 1000)} s${stalled ? ' — STALLED' : ''}`);
  if (end.fin) await waitFor(() => window.__game.endOpen(), null, 15000).catch(() => {});
  check(await game(() => window.__game.endOpen()), `match ${m + 1}: the end screen is up`);
  if (m === 0) await shot('17-autoplay-end');
}

// ------------------------------------------------------------------------------------------------
await dressed().catch(() => {});
// (A download cut off because the test itself moved to another page is not the game's fault.)
const bad = messages.filter(m => !/favicon/.test(m) && !/net::ERR_ABORTED/.test(m));
check(!bad.length, `no console errors or warnings${bad.length ? `:\n    ${bad.slice(0, 12).join('\n    ')}` : ''}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} BOTS BROWSER CHECK(S) FAILED` : '\nALL BOTS BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
