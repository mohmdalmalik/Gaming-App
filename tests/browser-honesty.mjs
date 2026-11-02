import { launch, giveCard } from './smoke-lib.mjs';
// SINGLE PLAYER, HONEST SCREENS (DESIGN §6.8 test 11; multiplayer build plan P1C). A real match in a real page
// (?mode=bots&bots=5&seed=…&timer=off), played by its hooks to round 2-3. The screens read only the presenter state
// (src/net/viewAsState.js, written from the table's view of the player's seat) and their own copy of the hotel
// (src/net/floorCopy.js); the real game is the table's (src/net/localTable.js). Checked, at two moments of the match:
//   1. the presenter state (window.__game.presenterState) is not the real game (window.__game.state), and the screens'
//      hotel (presenterFloor) is not the table's real hotel (window.__game.floor);
//   2. the presenter holds nothing of another guest's: no hand, no role, no knowledge, notes or private events; no pile,
//      no floor's contents, no room deck order;
//   3. scrambling every hidden field of the REAL game (the others' hands, roles, knows, notes, inbox, action points;
//      the draw and discard piles, keeping whether they are empty; what lies on each floor; the room deck's order) and
//      calling refresh() changes NOTHING in the presenter state (its JSON) or in the page's visible text;
//   then the match is played out (Skip to the result) and the end screen reveals the roles from the table's end;
//   4. Practice: the screens read their own state and hotel too, and (from P1C S3) the table's referee runs the game:
//      End turn passes the turn there.
// (P1C S5 adds the write trap: no write into the presenter state outside applyView over a whole match.)
//   node tests/browser-honesty.mjs [--url http://127.0.0.1:8123/] [--seed 4242] [--bots 5]
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const base = arg('--url', 'http://127.0.0.1:8123/');
const seed = parseInt(arg('--seed', '4242'), 10);
const nBots = parseInt(arg('--bots', '5'), 10);

let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

const { browser, page, messages } = await launch({ width: 1180, height: 820 });
// (Quick chat off: the computer guests' chatter reads their own hands, so a scrambled hand could change what they say)
await page.context().addInitScript(() => {
  try {
    const key = 'hotelEscape.settings.v1';
    const saved = JSON.parse(localStorage.getItem(key) || '{}') || {};
    localStorage.setItem(key, JSON.stringify({ ...saved, chat: 'off' }));
  } catch { /* no storage */ }
});
const game = (fn, a) => page.evaluate(fn, a);
const waitFor = (fn, a, timeout = 60000) => page.waitForFunction(fn, a, { timeout, polling: 150 });
const frames = n => page.evaluate(k => new Promise(r => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// Answer whatever the computer guests put in front of the player (the first card to give, a note, Accept, an attack
// result, a notice, "You are out": Watch).
async function answerScreens() {
  for (let i = 0; i < 12; i++) {
    const s = await game(() => {
      const g = window.__game, panel = document.getElementById('encounter-overlay');
      if (g.handoffOpen()) return g.handoffKind();
      if (!panel.hidden) return 'meeting';
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
    await page.waitForTimeout(450);
  }
}
async function untilMyTurn(timeout = 400000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await game(() => { const g = window.__game; return g.isFinished() || (g.myTurn() && g.inActionPhase() && !g.handoffOpen() && !g.meetingOpen() && !g.meetingLive()); })) return true;
    await answerScreens();
    await page.waitForTimeout(300);
  }
  return false;
}

// The presenter state as canonical JSON (Sets and Maps sorted), and the page's visible text (the toast and the feed left
// out: they fade by themselves; the feed's lines are the presenter's log, compared in its JSON).
const presenterJSON = () => game(() => {
  const canon = x => {
    if (x instanceof Set) return { $set: [...x].map(canon).sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1)) };
    if (x instanceof Map) return { $map: [...x].map(([k, v]) => [canon(k), canon(v)]).sort((a, b) => (JSON.stringify(a[0]) < JSON.stringify(b[0]) ? -1 : 1)) };
    if (Array.isArray(x)) return x.map(canon);
    if (x && typeof x === 'object') { const o = {}; for (const k of Object.keys(x).sort()) { if (typeof x[k] !== 'function') o[k] = canon(x[k]); } return o; }
    return x;
  };
  return JSON.stringify(canon(window.__game.presenterState));
});
const visibleText = () => game(() => {
  // (read with the two of them out of the way for the moment of reading: no frame is drawn in between)
  const out = ['#toast', '#feed'].map(sel => document.querySelector(sel)).filter(Boolean);
  const was = out.map(e => e.style.display);
  out.forEach(e => { e.style.display = 'none'; });
  const text = document.body.innerText;
  out.forEach((e, i) => { e.style.display = was[i]; });
  return text;
});

// Every hidden field of the real game, scrambled (and kept, to put back). `on`: true scrambles, false restores.
async function scramble(on) {
  return game(on => {
    const g = window.__game, S = g.state, F = g.floor, me = g.humanSeat();
    if (on) {
      const kept = { players: {}, drawPile: S.drawPile, discardPile: S.discardPile, drops: [...S.roomDrops], deck: [...F.deck] };
      const types = ['lantern', 'knife', 'bandage', 'flashlight', 'masterKey', 'espresso', 'handMirror', 'barricade', 'lockPick'];
      let k = 0;
      const card = () => ({ id: `zz${++k}`, type: types[k % types.length] });
      const cards = n => Array.from({ length: n }, card);
      for (const p of S.players) {
        if (p.index === me) continue;
        kept.players[p.index] = { hand: p.hand, possessed: p.possessed, convertedBy: p.convertedBy, knows: p.knows, notes: p.notes, inbox: p.inbox,
          roleChangePending: p.roleChangePending, roleSeen: p.roleSeen, actionPoints: p.actionPoints };
        p.hand = cards(p.hand.length + 3);
        p.possessed = !p.possessed;
        p.convertedBy = p.possessed ? S.players[(p.index + 1) % S.players.length].id : null;
        p.knows = new Set(S.players.map(q => q.id));
        p.notes = ['A secret note nobody else may see.'];
        p.inbox = [{ seq: 999999, type: 'traded', round: 1, turn: 1, gave: 'lantern', got: 'knife' }];
        p.roleChangePending = true; p.roleSeen = !p.roleSeen; p.actionPoints = 9;
      }
      S.drawPile = S.drawPile.length ? cards(S.drawPile.length + 5) : [];
      S.discardPile = S.discardPile.length ? cards(1) : [];
      for (const [room, list] of S.roomDrops) S.roomDrops.set(room, list.length ? cards(list.length + 2) : list);
      F.deck.reverse(); if (F.deck.length > 2) F.deck.push(F.deck.shift());
      window.__honestyKept = kept;
      return { others: Object.keys(kept.players).length, draw: S.drawPile.length, drops: S.roomDrops.size, deck: F.deck.length };
    }
    const kept = window.__honestyKept;
    for (const [i, v] of Object.entries(kept.players)) Object.assign(S.players[i], v);
    S.drawPile = kept.drawPile; S.discardPile = kept.discardPile;
    S.roomDrops.clear(); for (const [r, l] of kept.drops) S.roomDrops.set(r, l);
    F.deck.length = 0; F.deck.push(...kept.deck);
    delete window.__honestyKept;
    return true;
  }, on);
}

// What the presenter holds of the other guests and of the hidden parts of the game.
const presenterHolds = () => game(() => {
  const g = window.__game, P = g.presenterState, me = g.humanSeat();
  const others = P.players.filter(p => p.index !== me);
  return {
    notReal: P !== g.state && g.presenterFloor !== g.floor,
    sameRooms: g.presenterFloor.roomList.map(r => r.id).join() === g.floor.roomList.map(r => r.id).join(),
    hands: others.reduce((n, p) => n + p.hand.length, 0),
    roles: others.filter(p => p.possessed || p.convertedBy != null || p.roleChangePending).length,
    knows: others.reduce((n, p) => n + p.knows.size + p.notes.length + p.inbox.length, 0),
    ap: others.reduce((n, p) => n + p.actionPoints, 0),
    piles: P.drawPile.filter(c => !c.hidden).length + P.discardPile.length,
    drops: [...P.roomDrops.values()].flat().filter(c => !c.hidden).length,
    deckIds: g.presenterFloor.deck.filter(t => t.id != null).length,
    deckLen: g.presenterFloor.deck.length === g.floor.deck.length,
    myHand: P.players[me].hand.map(c => c.id).join() === g.state.players[me].hand.map(c => c.id).join(),
    log: P.log.length <= 30,
  };
});

// The visible text once it has settled (two readings three frames apart agree): a fading hint or a button's glow
// finishing its change is not the scramble's doing.
async function settledText() {
  let last = await visibleText();
  for (let i = 0; i < 8; i++) {
    await frames(3);
    const now = await visibleText();
    if (now === last) return now;
    last = now;
  }
  return last;
}

async function honestyAt(label) {
  const h = await presenterHolds();
  check(h.notReal, `${label}: the screens' state and hotel are not the table's real ones (presenterState !== state, presenterFloor !== floor)`);
  check(h.sameRooms && h.deckLen, `${label}: the screens' hotel holds the same rooms and as many unseen room tiles as the real one`);
  check(h.hands === 0 && h.roles === 0 && h.knows === 0 && h.ap === 0,
    `${label}: no other guest's hand, role, knowledge, notes, private events or actions in the presenter (cards ${h.hands}, roles ${h.roles}, private ${h.knows}, actions ${h.ap})`);
  check(h.piles === 0 && h.drops === 0 && h.deckIds === 0, `${label}: no card of a pile or a floor, no room tile of the deck, only placeholders`);
  check(h.myHand, `${label}: the player's own hand is theirs, card for card`);
  check(h.log, `${label}: the log is the view's window (at most 30 lines)`);
  // the scramble
  await frames(2);
  const beforeT = await settledText(), beforeJ = await presenterJSON();
  const s = await scramble(true);
  await game(() => window.__game.refresh());
  await frames(3);
  const afterJ = await presenterJSON(), afterT = await settledText();
  check(beforeJ === afterJ, `${label}: scrambling every hidden field of the real game (${s.others} guests, ${s.draw}-card draw pile, ${s.drops} floors, ${s.deck} room tiles) leaves the presenter state byte-identical (${beforeJ.length} bytes)`);
  if (beforeJ !== afterJ) {
    let i = 0; while (i < beforeJ.length && beforeJ[i] === afterJ[i]) i++;
    console.log(`     first difference at ${i}: …${beforeJ.slice(Math.max(0, i - 120), i + 80)}… vs …${afterJ.slice(Math.max(0, i - 120), i + 80)}…`);
  }
  check(beforeT === afterT, `${label}: ...and the page's visible text identical (${beforeT.length} characters)`);
  if (beforeT !== afterT) {
    let i = 0; while (i < beforeT.length && beforeT[i] === afterT[i]) i++;
    console.log(`     first difference at ${i} (${beforeT.length} vs ${afterT.length} characters): ${JSON.stringify(beforeT.slice(Math.max(0, i - 40), i + 80))} vs ${JSON.stringify(afterT.slice(Math.max(0, i - 40), i + 80))}`);
  }
  await scramble(false);
  await game(() => window.__game.refresh());
  await frames(2);
  check((await presenterJSON()) === beforeJ, `${label}: put back, the presenter is as it was`);
}

try {
  await page.goto(`${base}?mode=bots&bots=${nBots}&seed=${seed}&seat=0&timer=off&intro=off&botpace=0.1`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
  await game(() => { window.__game.cfg.player.speed = 30; window.__game.setPixelRatio(0.5); });
  await page.click('#btn-begin');
  await waitFor(() => window.__game.handoffKind() === 'role');
  await page.waitForTimeout(400);
  await page.click('#btn-handoff-next');
  check(await untilMyTurn(), 'the first turn is the player\'s');
  // Play by the hooks: open a door when one is there (the hotel grows), then end the turn; until round 2.
  const playTurn = async () => {
    await game(() => {
      const g = window.__game, d = g.closedDoors().find(x => !x.jammed);
      if (d && g.activePlayer().actionPoints > 0) g.openDoor(d.id);
    });
    await page.waitForTimeout(500);
    await answerScreens();
    await game(() => window.__game.endTurn());
    await page.waitForTimeout(300);
    await answerScreens();
  };
  let guard = 0;
  while (guard++ < 8 && !(await game(() => window.__game.isFinished())) && (await game(() => window.__game.presenterState.round)) < 2) {
    await playTurn();
    if (!(await untilMyTurn())) break;
  }
  const r1 = await game(() => ({ round: window.__game.presenterState.round, finished: window.__game.isFinished(), rooms: window.__game.hotelRooms().length }));
  check(r1.round >= 2 && !r1.finished, `played to round ${r1.round} (${r1.rooms} rooms on the board)`);
  if (!r1.finished) await honestyAt(`round ${r1.round}`);
  while (guard++ < 14 && !(await game(() => window.__game.isFinished())) && (await game(() => window.__game.presenterState.round)) < 3) {
    await playTurn();
    if (!(await untilMyTurn())) break;
  }
  const r2 = await game(() => ({ round: window.__game.presenterState.round, finished: window.__game.isFinished() }));
  if (!r2.finished) await honestyAt(`round ${r2.round}`);
  // The rest at once, then the end screen: every role is revealed from the table's end, as the real game has them.
  if (!r2.finished) await game(() => window.__game.skipToEnd());
  const ended = await waitFor(() => window.__game.isFinished() && window.__game.endOpen(), null, 60000).then(() => true, () => false);
  check(ended, 'the match was played out and the end screen shows');
  const end = await game(() => {
    const g = window.__game, P = g.presenterState;
    return { same: P.players.every((p, i) => !!p.possessed === !!g.state.players[i].possessed), won: P.won === g.state.won, end: !!P.end };
  });
  check(end.same && end.won && end.end, 'at the end the presenter reveals every role and the result exactly as the real game has them');

  // Practice: the same honest screens, the game itself run by the table (its referee, from P1C S3).
  await page.goto(`${base}?mode=practice&seed=${seed}&intro=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
  await game(() => { window.__game.cfg.player.speed = 30; window.__game.setPixelRatio(0.5); });
  await page.click('#btn-begin');
  await waitFor(() => window.__game.isRunning());
  await answerScreens();
  const pr = await game(() => {
    const g = window.__game, t = g.table(), ref = t?.local.debug.referee;
    return { kind: t?.kind, ref: !!ref, stage: ref?.stage ?? null, apart: g.presenterState !== g.state && g.presenterFloor !== g.floor,
      same: JSON.stringify(g.presenterState.players[0].hand.map(c => c.id)) === JSON.stringify(g.state.players[0].hand.map(c => c.id)) };
  });
  check(pr.kind === 'local' && pr.apart && pr.same, 'Practice: a local table; the screens read their own state and hotel, the hand card for card');
  if (pr.ref) {
    // a turn ended through the table: the next turn begins, the screens follow
    const t0 = await game(() => window.__game.presenterState.turn);
    await game(() => window.__game.endTurn());
    const passed = await waitFor(t => window.__game.presenterState.turn === t + 1 && window.__game.state.turn === t + 1, t0, 20000).then(() => true, () => false);
    check(pr.stage === 'turn' && passed, `Practice runs through the table's referee (stage ${pr.stage}); End turn passes the turn there, and the screens follow (turn ${t0} -> ${t0 + 1})`);
  } else console.log('     (Practice is not yet run by the referee at this step: P1C S3)');
  const errs = messages.filter(m => !/favicon|ERR_ABORTED/.test(m));
  check(!errs.length, `no console errors${errs.length ? `: ${errs.slice(0, 3).join(' | ')}` : ''}`);
} catch (err) {
  console.log(`FAIL ${err.message}`);
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : '\nALL HONESTY CHECKS PASSED');
process.exit(failures ? 1 : 0);
