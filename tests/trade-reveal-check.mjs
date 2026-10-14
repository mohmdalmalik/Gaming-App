// Headless check of the trade scene (src/ui/tradeReveal.js) and the soul cards: real voluntary trades in a
// match, one for each outcome the player can see, played through the interface (the card picked with a
// real tap). Run from tests/ with the static server on 8123:
//   node trade-reveal-check.mjs [--url http://127.0.0.1:8123/] [--size 1180x820] [--shots DIR] [--only a,b]
//
//   possessed         the possessed guest hands you their soul: you are possessed, their card is used up and
//                     you get rules.soulsOnConvert souls of your own (with YOUR face), then your role screen
//   blocked           you give a Lantern as they hand you their soul: both burn, you learn who it was
//   swap              you and a clean guest exchange ordinary cards
//   possessedThem     (playing possessed) you hand a clean guest your soul
//   soulSpent         (playing possessed) another possessed guest hands you their soul for your ordinary card
//   alreadyPossessed  (playing possessed) you hand your soul to a guest already possessed
//   soulsCrossed      (playing possessed) you both hand over a soul
// For each: the scene's outcome and caption, the faces on the soul cards (card.owner: in the pick screen,
// the scene, the role screen and the hand fan), the hands afterwards, the trade's own private note taken off
// the player's notes (the scene said it), what comes after Continue, a clean console — and the red eyes on
// a known ally (the guest strip's portrait and the guest in the hotel, characterView debug().possessedEyes):
// absent before the trade and while the scene has not yet shown it, present after, and never for a clean
// player. The second possessed guest of the last three is made so by the test (their own soul in hand);
// the computer guests' choices are scripted (window.__game.bots()), nothing else.
import { launch, giveCard } from './smoke-lib.mjs';
import { rules } from '../src/data/rules.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg('--url', 'http://127.0.0.1:8123/');
const [W, H] = arg('--size', '1180x820').split('x').map(Number);
const shots = arg('--shots', null);
const only = arg('--only', null)?.split(',');
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

// Who the player is, who they trade with, and what each gives.
const PLAN = {
  possessed:        { role: 'clean',     partner: 'possessed', theyGive: 'soul',     iGive: 'ordinary', reveals: true },
  blocked:          { role: 'clean',     partner: 'possessed', theyGive: 'soul',     iGive: 'lantern',  reveals: false },
  swap:             { role: 'clean',     partner: 'clean',     theyGive: 'ordinary', iGive: 'ordinary', reveals: false },
  possessedThem:    { role: 'possessed', partner: 'clean',     theyGive: 'ordinary', iGive: 'soul',     reveals: true },
  soulSpent:        { role: 'possessed', partner: 'made',      theyGive: 'soul',     iGive: 'ordinary', reveals: true },
  alreadyPossessed: { role: 'possessed', partner: 'made',      theyGive: 'ordinary', iGive: 'soul',     reveals: true },
  soulsCrossed:     { role: 'possessed', partner: 'made',      theyGive: 'soul',     iGive: 'soul',     reveals: true },
};
const CAPTION = {
  possessed: /^You are possessed — two souls of your own to pass on\.$/,
  blocked: T => new RegExp(`^Your Lantern burned it away — ${T} is possessed\\. Now you know\\.$`),
  possessedThem: T => new RegExp(`^${T} is now possessed\\.$`),
  soulSpent: T => new RegExp(`^${T} is possessed too — their soul is spent\\.$`),
  alreadyPossessed: T => new RegExp(`^${T} is possessed too — your soul is spent\\.$`),
  soulsCrossed: T => new RegExp(`^${T} is possessed too — both souls are spent\\.$`),
  swap: /^You got an? .+\.$/,
};

async function trade(mode) {
  const plan = PLAN[mode];
  console.log(`\n${mode} (${W}x${H})`);
  const { browser, page, messages } = await launch({ width: W, height: H });
  const ev = (fn, a) => page.evaluate(fn, a);
  const waitFor = (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 150 });
  try {
    await page.goto(`${base}?mode=bots&bots=3&role=${plan.role}&intro=off&botpace=0.1&seed=7&seat=0&timer=off`, { waitUntil: 'domcontentloaded' });
    await waitFor(() => window.__game && !document.getElementById('btn-begin').disabled, null, 90000);
    await page.click('#btn-begin');
    await waitFor(() => window.__game.handoffKind() === 'role');
    await page.waitForTimeout(400);
    await page.click('#btn-handoff-next');
    await waitFor(() => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 120000);
    // The partner, alone with the player on a landing that allows a trade (for the test); their card is
    // scripted. 'made': a second possessed guest, holding a soul of their own.
    const T = await ev(plan => {
      const g = window.__game, st = g.state, me = st.players[g.humanSeat()];
      const T = plan.partner === 'possessed' ? st.players.find(p => p.possessed && p !== me)
        : plan.partner === 'clean' ? st.players.find(p => p !== me && !p.possessed) : st.players.find(p => p !== me);
      if (plan.partner === 'made') { T.possessed = true; T.hand.push({ id: 'test-soul', type: 'possession', owner: T.id }); }
      g.floor.rooms.get(me.currentRoom).noTrade = false;
      for (const p of st.players) if (p !== me && p !== T) p.currentRoom = '__away';
      T.currentRoom = me.currentRoom;
      const b = g.bots(), orig = b.tradeCard.bind(b);
      b.acceptTrade = () => true;
      b.tradeCard = (x, y, ids) => {
        const P = st.players[x];
        if (x !== T.index) return orig(x, y, ids);
        if (plan.theyGive === 'soul') return P.hand.find(c => c.type === 'possession').id;
        return P.hand.find(c => c.type !== 'lantern' && c.type !== 'possession').id;
      };
      g.refresh();
      return T.index;
    }, plan);
    // (the guest in the hotel: its model has to be in for its eyes to be read — else the 3D half of the
    // red-eye checks below would pass without looking)
    const modelIn = await waitFor(T => window.__game.characters[T]?.debug().loaded, T, 120000).then(() => true, () => false);
    check(modelIn, "the partner's model has loaded, so the eyes of the guest in the hotel can be read");
    await page.waitForTimeout(600);
    const eyes = () => ev(T => {
      const g = window.__game, img = document.querySelectorAll('#players-strip .mini-player')[T]?.querySelector('.mini-portrait img');
      // (the portrait's look: img.dataset.look, src/ui/portrait.js — a runtime portrait's address says nothing)
      return { strip: !!img && img.dataset.look === 'possessed', hotel: !!g.characters[T].debug().possessedEyes, loaded: !!g.characters[T].debug().loaded };
    }, T);
    const pre = await eyes();
    check(!pre.strip && !pre.hotel, `before the trade: no red eyes on the partner (strip ${pre.strip}, hotel ${pre.hotel})`);
    const before = await ev(T => { const g = window.__game, me = g.state.players[g.humanSeat()], t = g.state.players[T];
      return { me: me.hand.map(c => c.id), them: t.hand.map(c => c.id), lanterns: me.hand.filter(c => c.type === 'lantern').length, souls: me.hand.filter(c => c.type === 'possession').length,
        theirSouls: t.hand.filter(c => c.type === 'possession').map(c => c.id), meId: me.id, tId: t.id, tName: t.name }; }, T);

    await ev(() => window.__game.trade());
    await waitFor(() => window.__game.handoffKind() === 'pick');
    // The pick screen: your souls carry your own face.
    const pick = await ev(() => [...document.querySelectorAll('#offer-cards .card-tile')].map(t => ({ id: t.dataset.cardId, soul: t.querySelector('img')?.dataset.soul ?? null, badge: t.querySelector('.face-badge.souls')?.textContent ?? null })));
    const give = await ev(plan => {
      const me = window.__game.state.players[window.__game.humanSeat()];
      const want = plan.iGive === 'lantern' ? c => c.type === 'lantern' : plan.iGive === 'soul' ? c => c.type === 'possession' : c => c.type !== 'lantern' && c.type !== 'possession';
      return me.hand.find(want).id;
    }, plan);
    if (plan.role === 'possessed') {
      // (your souls are one tile with a ×N badge, as in your hand: a tap gives one)
      const souls = pick.filter(p => p.soul != null);
      check(souls.length === 1 && souls[0].soul === before.meId && souls[0].badge === (before.souls > 1 ? `×${before.souls}` : null),
        `the pick screen shows your ${before.souls} soul${before.souls === 1 ? '' : 's'} as one card with your own face (${JSON.stringify(souls)})`);
    } else check(pick.every(p => p.soul == null), 'a clean guest has no souls to pick');
    await page.waitForTimeout(400);          // (a screen ignores taps in its first moments: src/ui/tapGuard.js)
    // Giving a card is two steps (src/ui/handoff.js privatePick): a tap lifts the card and says what it is,
    // another card switches the choice, and the button, which names the card, gives it.
    const tileSel = `#offer-cards .card-tile[data-card-id="${give}"]`;
    const giveType = await ev(id => window.__game.state.players[window.__game.humanSeat()].hand.find(c => c.id === id).type, give);
    const wantBtn = giveType === 'possession' ? 'Give your soul' : `Give the ${rules.cards[giveType].name}`;
    const lifted = () => ev(() => ({ kind: window.__game.handoffKind(), sel: [...document.querySelectorAll('#offer-cards .card-tile.selected')].map(t => t.dataset.cardId),
      words: document.getElementById('offer-summary').textContent, btn: document.getElementById('btn-offer-give').textContent, off: document.getElementById('btn-offer-give').disabled,
      cards: window.__game.state.players[window.__game.humanSeat()].hand.length }));
    const before1 = await lifted();
    check(before1.off && before1.btn === 'Tap a card to give' && before1.sel.length === 0, `before a card is chosen the button says what to do and cannot be pressed ("${before1.btn}")`);
    await page.click(tileSel);
    await page.waitForTimeout(200);
    const one = await lifted();
    check(one.kind === 'pick' && one.sel.join() === give && one.cards === before.me.length, 'one tap only lifts the card: nothing is given away yet');
    check(one.words.includes(rules.cards[giveType].name) && one.words.includes(rules.cards[giveType].desc), `its name and what it does are shown ("${one.words.slice(0, 60)}…")`);
    check(one.btn === wantBtn && !one.off, `the button names it: "${one.btn}"`);
    const other = pick.find(p => p.id !== give);
    if (other) {
      await page.click(`#offer-cards .card-tile[data-card-id="${other.id}"]`);
      await page.waitForTimeout(200);
      const two = await lifted();
      check(two.kind === 'pick' && two.sel.join() === other.id && two.btn !== wantBtn, `another card switches the choice ("${two.btn}")`);
      // The double-tap guard: a Give tapped in the same instant as the tap that lifted the card is ignored
      // (src/ui/tapGuard.js; the clicks are made in one go, as a double tap's would be).
      const early = await ev(([a, b]) => {
        const tile = document.querySelector(`#offer-cards .card-tile[data-card-id="${a}"]`), btn = document.getElementById('btn-offer-give');
        const tap = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
        tap(tile); tap(btn);
        return { kind: window.__game.handoffKind(), sel: [...document.querySelectorAll('#offer-cards .card-tile.selected')].map(t => t.dataset.cardId) };
      }, [give, other.id]);
      check(early.kind === 'pick' && early.sel.join() === give, 'a Give tapped in the same instant as the card (a double tap) does not give it');
    }
    const label = await giveCard(page, tileSel);
    check(label === wantBtn, `after a moment the button gives it ("${label}")`);
    await waitFor(() => window.__game.tradeRevealOutcome() !== null);
    check(await ev(() => window.__game.tradeRevealOutcome()) === mode, `the scene plays "${mode}"`);
    // While the scene has not yet shown it: still no red eyes on them, anywhere behind it.
    const during = await eyes();
    check(!during.strip && !during.hotel, `as the scene starts: no red eyes on the partner yet (strip ${during.strip}, hotel ${during.hotel})`);
    // The faces on the soul cards in the scene.
    const faces = await ev(() => ({
      mine: document.querySelector('.tr-rail.mine .tr-front img')?.dataset.soul ?? null,
      theirs: document.querySelector('.tr-rail.theirs .tr-front img')?.dataset.soul ?? null,
      held: [...document.querySelectorAll('.tr-extra .tr-front img')].map(i => ({ soul: i.dataset.soul ?? null, drawn: /^(data:image\/|blob:)/.test(i.getAttribute('src') || '') })),
    }));
    if (plan.iGive === 'soul') check(faces.mine === before.meId, `your soul in the scene shows your face (${faces.mine})`);
    if (plan.theyGive === 'soul') check(faces.theirs === before.tId, `their soul in the scene shows ${before.tName}'s face (${faces.theirs})`);
    await waitFor(() => !window.__game.tradeReveal.playing, null, 60000);
    await page.waitForTimeout(1500);
    // (their red eyes fade in; on a slow machine give the fade time to finish)
    if (plan.reveals) await waitFor(() => [...(document.querySelectorAll('.tr-seat.them .tr-port img'))]
      .some(i => i.dataset.look === 'possessed' && getComputedStyle(i).opacity === '1'), null, 10000).catch(() => {});
    if (shots) await page.screenshot({ path: `${shots}/trade-${mode}-${W}x${H}.png` });
    const after = await ev(T => {
      const g = window.__game, st = g.state, me = st.players[g.humanSeat()], t = st.players[T];
      const themSeat = document.querySelector('.tr-seat.them');
      return { caption: document.querySelector('.tr-caption')?.textContent || '', me: me.hand.map(c => c.id), types: me.hand.map(c => c.type),
        souls: me.hand.filter(c => c.type === 'possession').map(c => ({ id: c.id, owner: c.owner })), possessed: me.possessed,
        themPossessed: t.possessed, them: t.hand.map(c => c.id), theirSouls: t.hand.filter(c => c.type === 'possession').map(c => ({ id: c.id, owner: c.owner })),
        everywhere: st.players.flatMap(p => p.hand.map(c => c.id)), notes: [...me.notes], knows: [...(me.knows || [])],
        themRedSrc: [...(themSeat?.querySelectorAll('.tr-port img') || [])].some(i => i.dataset.look === 'possessed' && getComputedStyle(i).opacity === '1') };
    }, T);
    check(after.notes.length === 0, `the trade's own private note is not left waiting (the scene said it): ${JSON.stringify(after.notes)}`);
    const cap = CAPTION[mode];
    check((typeof cap === 'function' ? cap(before.tName) : cap).test(after.caption), `caption, one short line: "${after.caption}"`);
    check(after.themRedSrc === plan.reveals, `in the scene, ${before.tName}'s red eyes ${plan.reveals ? 'show at the end' : 'never show'} (${after.themRedSrc})`);
    const gaveSoulGone = !after.everywhere.includes(give);
    if (mode === 'swap') {
      check(!after.me.includes(give) && after.me.length === before.me.length && after.me.some(id => before.them.includes(id)), 'your card went, theirs came');
    }
    if (mode === 'possessed') {
      check(after.possessed && after.souls.length === rules.soulsOnConvert && after.souls.every(s => s.owner === before.meId),
        `you are possessed, holding ${after.souls.length} souls, all your own (rules.soulsOnConvert: ${rules.soulsOnConvert})`);
      check(!after.everywhere.includes(before.theirSouls[0]), "the soul that possessed you is used up (in nobody's hand)");
      check(faces.held.length === rules.soulsOnConvert && faces.held.every(h => h.soul === before.meId && h.drawn), `the scene raises ${faces.held.length} new souls with your own face (${JSON.stringify(faces.held)})`);
      check(after.them.includes(give), 'your card went to them');
    }
    if (mode === 'blocked') {
      check(!after.possessed && after.souls.length === 0 && after.types.filter(t => t === 'lantern').length === before.lanterns - 1, 'you stay clean; your Lantern and their soul are both gone');
      check(after.knows.includes(before.tId), 'you now know who tried');
    }
    if (mode === 'possessedThem') {
      check(after.themPossessed && gaveSoulGone, 'they are possessed; your soul is used up');
      check(after.theirSouls.length === rules.soulsOnConvert && after.theirSouls.every(s => s.owner === before.tId), `they now hold ${after.theirSouls.length} souls of their own`);
    }
    if (mode === 'soulSpent') {
      check(after.souls.length === before.souls && after.souls.every(s => s.owner === before.meId), `your own ${before.souls} souls are untouched, and you hold nobody else's`);
      check(!after.everywhere.includes(before.theirSouls[0]) && after.me.length === before.me.length - 1, 'their soul is spent: nothing came to you');
      check(after.them.includes(give), 'your card went to them');
      check(after.knows.includes(before.tId), 'you now know they are possessed');
    }
    if (mode === 'alreadyPossessed') {
      check(gaveSoulGone && after.souls.length === before.souls - 1, 'your soul is spent (in nobody\'s hand)');
      check(after.me.length === before.me.length && after.me.some(id => before.them.includes(id)), 'their card came to you');
      check(after.knows.includes(before.tId), 'you now know they are possessed');
    }
    if (mode === 'soulsCrossed') {
      check(gaveSoulGone && !after.everywhere.includes(before.theirSouls[0]), 'both souls are spent');
      check(after.souls.length === before.souls - 1 && after.theirSouls.length === 0 && after.me.length === before.me.length - 1, 'nobody received anything');
      check(after.knows.includes(before.tId), 'you now know they are possessed');
    }
    await page.click('#btn-handoff-next');
    await page.waitForTimeout(900);
    const next = await ev(() => ({ kind: window.__game.handoffKind(), role: document.getElementById('handoff-role').textContent, stages: document.querySelectorAll('.tr-stage').length,
      chip: document.querySelector('#handoff-role .souls-chip img')?.dataset.soul ?? null }));
    if (mode === 'possessed') {
      check(next.kind === 'role' && /POSSESSED/.test(next.role) && /Souls to trade: ?2/.test(next.role), `Continue: your new role, with two souls to trade (${next.kind}: "${next.role.replace(/\s+/g, ' ').slice(0, 60)}…")`);
      check(next.chip === before.meId, `the role screen's souls chip carries your own face (${next.chip})`);
      check(next.stages === 0, 'the role screen carries none of the trade scene');
      if (shots) await page.screenshot({ path: `${shots}/trade-${mode}-role-${W}x${H}.png` });
      await page.click('#btn-handoff-next');
      await page.waitForTimeout(900);
    } else check(next.kind === null, `Continue: back to the game (${next.kind ?? 'no private screen'})`);
    // Back in the game: red eyes on a guest the player now knows is possessed (and only while possessed).
    await page.waitForTimeout(1200);
    const post = await eyes();
    check(post.loaded && post.strip === plan.reveals && post.hotel === plan.reveals,
      `after it: red eyes on ${before.tName} ${plan.reveals ? 'in the strip and in the hotel' : 'nowhere (a clean player never sees them)'} (strip ${post.strip}, hotel ${post.hotel}, model loaded ${post.loaded})`);
    if (plan.reveals || plan.role === 'possessed') {
      // Your own souls on the hand fan: one stack, your own face, the drawn picture.
      const fan = await ev(() => { const i = document.querySelector('#hand-fan .fan-card[data-type="possession"] img'); return i ? { soul: i.dataset.soul ?? null, drawn: /^(data:image\/|blob:)/.test(i.getAttribute('src') || '') } : null; });
      const meNow = await ev(() => window.__game.state.players[window.__game.humanSeat()].hand.filter(c => c.type === 'possession').length);
      if (meNow > 0) check(fan && fan.soul === before.meId && fan.drawn, `the hand fan's souls show your own face (${JSON.stringify(fan)})`);
      if (shots && mode === 'possessed') await page.screenshot({ path: `${shots}/trade-${mode}-fan-${W}x${H}.png` });
    }
    const bad = messages.filter(m => !/favicon|ERR_ABORTED/.test(m));
    check(bad.length === 0, `console clean${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`);
  } catch (err) {
    check(false, `${mode}: ${err.message.split('\n')[0]}`);
  } finally {
    await browser.close();
  }
}

for (const mode of Object.keys(PLAN)) if (!only || only.includes(mode)) await trade(mode);
console.log(failures.length ? `\n${failures.length} TRADE SCENE CHECK(S) FAILED` : '\nALL TRADE SCENE CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
