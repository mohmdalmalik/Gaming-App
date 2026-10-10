// Headless check of the trade scene (src/ui/tradeReveal.js): real voluntary trades in a match, one for
// each outcome the player can see, played through the interface (the card picked with a real tap).
// Run from tests/ with the static server on 8123:  node trade-reveal-check.mjs [--url http://127.0.0.1:8123/]
//
//   swap           you and a clean guest exchange ordinary cards
//   possessed      the possessed guest hands you a Possession card: you are possessed, keep it and get
//                  rules.possessionOnConvert more ("two tries"), and your role screen follows
//   blocked        you give a Lantern as they hand you a Possession card: both burn, you learn who it was
//   possessedThem  (playing possessed) you hand a guest a Possession card
// For each: the scene's outcome and caption, the hand afterwards, the trade's own private note taken off
// the player's notes (the scene said it), what comes after Continue, and a clean console. The computer
// guests' choices are scripted for the test (window.__game.bots()), nothing else.
import { launch } from './smoke-lib.mjs';
import { rules } from '../src/data/rules.js';

const args = process.argv.slice(2);
const base = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

async function trade(mode) {
  console.log(`\n${mode}`);
  const role = mode === 'possessedThem' ? 'possessed' : 'clean';
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 150 });
  try {
    await page.goto(`${base}?mode=bots&bots=3&role=${role}&intro=off&botpace=0.1&seed=7&seat=0&timer=off`, { waitUntil: 'domcontentloaded' });
    await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 90000);
    await page.click('#btn-begin');
    await waitFor(() => window.__game.handoffKind() === 'role');
    await page.waitForTimeout(400);
    await page.click('#btn-handoff-next');
    await waitFor(() => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 120000);
    // The partner: the possessed guest (swap: a clean one; playing possessed: seat 1). The others leave the
    // landing so Trade asks the partner straight away; the landing allows a trade for the test.
    const T = await ev(mode => {
      const g = window.__game, st = g.state, me = st.players[g.humanSeat()];
      const T = mode === 'possessedThem' ? st.players[1] : mode === 'swap' ? st.players.find(p => p !== me && !p.possessed) : st.players.find(p => p.possessed);
      g.floor.rooms.get(me.currentRoom).noTrade = false;
      for (const p of st.players) if (p !== me && p !== T) p.currentRoom = '__away';
      T.currentRoom = me.currentRoom;
      const b = g.bots(), orig = b.tradeCard.bind(b);
      b.acceptTrade = () => true;
      b.tradeCard = (x, y, ids) => {
        const P = st.players[x];
        if (x !== T.index) return orig(x, y, ids);
        if (mode === 'possessed' || mode === 'blocked') return P.hand.find(c => c.type === 'possession').id;
        return P.hand.find(c => c.type !== 'lantern' && c.type !== 'possession').id;
      };
      g.refresh();
      return T.index;
    }, mode);
    const before = await ev(T => { const g = window.__game, me = g.state.players[g.humanSeat()], t = g.state.players[T]; return { me: me.hand.map(c => c.id), them: t.hand.map(c => c.id), lanterns: me.hand.filter(c => c.type === 'lantern').length }; }, T);
    await ev(() => window.__game.trade());
    await waitFor(() => window.__game.handoffKind() === 'pick');
    const give = await ev(mode => {
      const me = window.__game.state.players[window.__game.humanSeat()];
      const want = mode === 'blocked' ? 'lantern' : mode === 'possessedThem' ? 'possession' : null;
      return (want ? me.hand.find(c => c.type === want) : me.hand.find(c => c.type !== 'lantern' && c.type !== 'possession')).id;
    }, mode);
    await page.waitForTimeout(400);          // (a screen ignores taps in its first moments: src/ui/tapGuard.js)
    await page.click(`#offer-cards .card-tile[data-card-id="${give}"]`);
    await waitFor(() => window.__game.tradeRevealOutcome() !== null);
    check(await ev(() => window.__game.tradeRevealOutcome()) === mode, `the scene plays "${mode}"`);
    await waitFor(() => !window.__game.tradeReveal.playing, null, 30000);
    await page.waitForTimeout(800);
    const after = await ev(T => {
      const g = window.__game, me = g.state.players[g.humanSeat()], t = g.state.players[T];
      return { caption: document.querySelector('.tr-caption')?.textContent || '', me: me.hand.map(c => c.id), types: me.hand.map(c => c.type), possessed: me.possessed,
        themPossessed: t.possessed, notes: [...me.notes], knows: [...(me.knows || [])], tName: t.name, tId: t.id, extra: document.querySelectorAll('.tr-extra').length };
    }, T);
    const souls = after.types.filter(t => t === 'possession').length;
    check(after.notes.length === 0, `the trade's own private note is not left waiting (the scene said it): ${JSON.stringify(after.notes)}`);
    if (mode === 'swap') {
      check(/./.test(after.caption), `a caption: "${after.caption}"`);
      check(!after.me.includes(give) && after.me.length === before.me.length && after.me.some(id => before.them.includes(id)), 'your card went, theirs came');
    }
    if (mode === 'possessed') {
      const tries = 1 + rules.possessionOnConvert;
      check(/You are possessed — two tries to pass it on\./.test(after.caption), `caption: "${after.caption}"`);
      check(after.possessed && souls === tries, `you are possessed, holding ${souls} Possession cards (the one you received + ${rules.possessionOnConvert})`);
      check(after.extra === rules.possessionOnConvert, `the extra card is shown arriving (${after.extra})`);
    }
    if (mode === 'blocked') {
      check(new RegExp(`Your Lantern burned it away — ${after.tName} is possessed\\. Only you know\\.`).test(after.caption), `caption: "${after.caption}"`);
      check(!after.possessed && souls === 0 && after.types.filter(t => t === 'lantern').length === before.lanterns - 1, 'you stay clean; your Lantern and their Possession card are both gone');
      check(after.knows.includes(after.tId), 'you now know who tried');
    }
    if (mode === 'possessedThem') {
      check(new RegExp(`${after.tName} is now possessed\\.`).test(after.caption), `caption: "${after.caption}"`);
      check(after.themPossessed && !after.me.includes(give), 'they are possessed; your Possession card went to them');
    }
    await page.click('#btn-handoff-next');
    await page.waitForTimeout(700);
    const next = await ev(() => ({ kind: window.__game.handoffKind(), role: document.getElementById('handoff-role').textContent, stages: document.querySelectorAll('.tr-stage').length }));
    if (mode === 'possessed') {
      check(next.kind === 'role' && /POSSESSED/.test(next.role) && /Souls to trade: ?2/.test(next.role), `Continue: your new role, with two souls to trade (${next.kind}: "${next.role.replace(/\s+/g, ' ').slice(0, 60)}…")`);
      check(next.stages === 0, 'the role screen carries none of the trade scene');
      await page.click('#btn-handoff-next');
      await page.waitForTimeout(500);
    } else check(next.kind === null, `Continue: back to the game (${next.kind ?? 'no private screen'})`);
    const bad = messages.filter(m => !/favicon|ERR_ABORTED/.test(m));
    check(bad.length === 0, `console clean${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
  } catch (err) {
    check(false, `${mode}: ${err.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

for (const mode of ['possessed', 'blocked', 'swap', 'possessedThem']) await trade(mode);
console.log(failures.length ? `\n${failures.length} TRADE SCENE CHECK(S) FAILED` : '\nALL TRADE SCENE CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
