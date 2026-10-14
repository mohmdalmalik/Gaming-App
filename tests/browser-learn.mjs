// Browser checks for "teach new players" (Round 2, build-learn), in headless Chromium (software WebGL, a few frames a
// second). Serve the repo first, then:
//   node tests/browser-learn.mjs [--url http://127.0.0.1:8123/] [--only a,b,c,d] [--sizes 1024x694,1024x768,1180x820,1366x1024]
//
//   a  the main menu: the hint under Practice alone (until a match is played or a practice finished; a match left early
//      does not count), the How to play button beside Settings and Your record, the menu still fitting; How to play:
//      five pages with Back / Next / Close, Back and Next where the finger left them from page to page, touch targets
//      of 44 px, the keyboard (focus moves in, Tab stays inside, the arrow keys turn pages, Escape closes, the focus
//      goes back), the second tap of a double tap on Next turns one page; at the four iPad sizes
//   b  a match (at each size, with the 45-second clock on): the role screen's headline, its text size and its one line
//      about the other side, fitting; the Lanterns chip (the same for both sides, following the hand, in no one's
//      way); the in-match Menu panel (Resume, the Music and Sound effects rows saved in Settings' own place, How to
//      play, Leave and its question with the safe answer in gold) and what the CLOCK does while it is open (it
//      stands still, exactly as it did while the Leave question was open, and goes on after); the end screen:
//      Victory or Defeat for your side whether or not you are alive or got out, the recap, fitting, both sides
//   c  a possessed player's role screen, chip and end screen (the same form and words as a clean guest's)
//   d  practice: the Menu panel says Leave practice, the end screen has no Victory or Defeat
import { launch, GUARD_WAIT } from './smoke-lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const baseUrl = opt('--url', 'http://127.0.0.1:8123/');
const only = opt('--only', 'a,b,c,d').split(',');
const SIZES = opt('--sizes', '1024x694,1024x768,1180x820,1366x1024').split(',').map(s => s.split('x').map(Number));
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = opt('--shots', path.join(here, 'shots', 'learn'));
fs.mkdirSync(outDir, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const waitFor = (page, fn, arg, timeout = 90000) => page.waitForFunction(fn, arg, { timeout, polling: 100 });
const quiet = messages => messages.filter(m => !/Failed to load resource|favicon/.test(m));
const near = (a, b, d = 1.5) => Math.abs(a - b) <= d;
// The turn clock over `ms` of real time, counting the frames drawn meanwhile (so "it did not move" is only believed
// when the game really had the chance to move it: a slow machine draws a frame in a second or two).
const clockOver = (page, ms) => page.evaluate(ms => new Promise(res => {
  const g = window.__game, a = g.timeLeft(), t0 = performance.now(); let frames = 0;
  const f = () => { frames++; if (performance.now() - t0 < ms || frames < 4) requestAnimationFrame(f); else res({ a, b: g.timeLeft(), frames }); };
  requestAnimationFrame(f);
}), ms);

async function openMenu(page) {
  await page.goto(`${baseUrl}?intro=off`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-menu-bots').disabled, null, 120000);
  await page.waitForTimeout(900);
}
async function intoMatch(page, role = 'clean', { timer = true } = {}) {
  await page.goto(`${baseUrl}?mode=bots&bots=5&role=${role}&seed=11&seat=0&intro=off&botpace=0.1${timer ? '' : '&timer=off'}`, { waitUntil: 'domcontentloaded' });
  await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
  await page.click('#btn-begin');
  await waitFor(page, () => window.__game.handoffKind() === 'role', null, 120000);
  await page.waitForTimeout(700);
}
async function pastRole(page) {
  await page.click('#btn-handoff-next');
  await waitFor(page, () => window.__game.myTurn() && window.__game.inActionPhase() && !window.__game.handoffOpen(), null, 180000);
  await page.waitForTimeout(600);
}
// The box of an element, rounded.
const box = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }, sel);
const visible = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
const overlap = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

// ---------------------------------------------------------------------------------------------------
if (only.includes('a')) {
  console.log('\na. the main menu and How to play');
  for (const [W, H] of SIZES) {
    console.log(`\n  ${W}x${H}`);
    const { browser, page, messages } = await launch({ width: W, height: H });
    try {
      await openMenu(page);
      const hint = await page.evaluate(() => { const h = document.getElementById('menu-hint'); return h.hidden ? null : h.textContent; });
      check(hint === 'New to Hotel Escape? Practice alone is the best place to start.', `a new player sees the hint: "${hint}"`);
      const hb = await box(page, '#menu-hint'), pb = await box(page, '#btn-menu-practice'), rb = await box(page, '.menu-row2');
      check(hb && pb && rb && hb.t >= pb.b - 6 && hb.b <= rb.t + 2, `...under Practice alone, above the row of three (hint ${Math.round(hb?.t)}-${Math.round(hb?.b)}, Practice ends ${Math.round(pb?.b)}, the row starts ${Math.round(rb?.t)})`);
      const panel = await box(page, '.menu-panel');
      check(panel.t >= 0 && panel.b <= H, `the main menu still fits (${Math.round(panel.t)}-${Math.round(panel.b)} of ${H})`);
      const row = await page.evaluate(() => [...document.querySelectorAll('.menu-row2 .menu-btn')].map(b => { const r = b.getBoundingClientRect(); return { id: b.id, w: r.width, h: r.height, y: Math.round(r.top), over: b.scrollWidth > b.clientWidth + 1 }; }));
      check(row.map(b => b.id).join() === 'btn-menu-howto,btn-menu-settings,btn-menu-record' && row.every(b => b.y === row[0].y), 'How to play, Settings and Your record share one row');
      check(row.every(b => b.h >= 44 && b.w >= 44 && !b.over), `...each a touch target of 44 px or more, its words inside (${row.map(b => `${Math.round(b.w)}x${Math.round(b.h)}`).join(' ')})`);
      await page.screenshot({ path: `${outDir}/a-menu-${W}x${H}.png` });

      // --- How to play ---
      await page.click('#btn-menu-howto');
      await page.waitForTimeout(500);
      check(await page.evaluate(() => window.__game.howToOpen()) && await visible(page, '.howto-card'), 'How to play opens over the main menu');
      const titles = [], nextAt = [], fits = [];
      for (let i = 0; i < 5; i++) {
        const st = await page.evaluate(() => ({
          kicker: document.getElementById('howto-kicker').textContent, title: document.getElementById('howto-title').textContent,
          lines: document.querySelectorAll('#howto-lines li').length, back: document.getElementById('btn-howto-back').disabled, next: document.getElementById('btn-howto-next').disabled,
          closeGold: document.getElementById('btn-howto-close').classList.contains('primary'),
          scroll: (l => l.scrollHeight > l.clientHeight + 1)(document.getElementById('howto-lines')),
          btns: ['btn-howto-close', 'btn-howto-back', 'btn-howto-next'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, w: r.width, h: r.height, x: r.left, y: r.top }; }),
          card: (r => ({ t: r.top, b: r.bottom, l: r.left, r: r.right }))(document.querySelector('.howto-card').getBoundingClientRect()),
        }));
        titles.push(st.title); nextAt.push(st.btns[2]); fits.push(st);
        check(st.kicker.toUpperCase() === `HOW TO PLAY · ${i + 1} OF 5` && st.lines >= 3 && st.back === (i === 0) && st.next === (i === 4) && st.closeGold === (i === 4),
          `page ${i + 1} "${st.title}": ${st.lines} lines, Back ${st.back ? 'dim' : 'on'}, Next ${st.next ? 'dim' : 'on'}${i === 4 ? ', Close in gold' : ''}`);
        if (i === 2) await page.screenshot({ path: `${outDir}/a-howto-3-${W}x${H}.png` });
        if (i === 0) await page.screenshot({ path: `${outDir}/a-howto-1-${W}x${H}.png` });
        if (i < 4) { await page.waitForTimeout(GUARD_WAIT); await page.click('#btn-howto-next'); await page.waitForTimeout(150); }
      }
      check(titles.join('|') === 'The goal|Your turn|Meetings and trades|Possession and Lanterns|Staying alive', `the five pages: ${titles.join(' / ')}`);
      check(fits.every(s => s.card.t >= 0 && s.card.b <= H && s.card.l >= 0 && s.card.r <= W && !s.scroll), `every page fits the screen with nothing to scroll (card ${Math.round(Math.min(...fits.map(s => s.card.t)))}-${Math.round(Math.max(...fits.map(s => s.card.b)))} of ${H})`);
      check(nextAt.every(b => near(b.x, nextAt[0].x, 1) && near(b.y, nextAt[0].y, 1)), 'Next stays where it was while the pages turn');
      check(fits[0].btns.every(b => b.w >= 44 && b.h >= 44), `Close, Back and Next are touch targets of 44 px or more (${fits[0].btns.map(b => `${Math.round(b.w)}x${Math.round(b.h)}`).join(' ')})`);
      await page.waitForTimeout(GUARD_WAIT);
      await page.click('#btn-howto-back'); await page.waitForTimeout(150);
      check(await page.evaluate(() => document.getElementById('howto-title').textContent) === 'Possession and Lanterns', 'Back goes to the page before');
      // a double tap on Next turns one page, not two
      await page.waitForTimeout(GUARD_WAIT);
      await page.click('#btn-howto-back'); await page.waitForTimeout(GUARD_WAIT); await page.click('#btn-howto-back'); await page.waitForTimeout(GUARD_WAIT);
      await page.click('#btn-howto-back'); await page.waitForTimeout(GUARD_WAIT);
      const at = await page.evaluate(() => document.getElementById('howto-title').textContent);
      await page.mouse.click(nextAt[0].x + nextAt[0].w / 2, nextAt[0].y + nextAt[0].h / 2); await page.waitForTimeout(90);
      await page.mouse.click(nextAt[0].x + nextAt[0].w / 2, nextAt[0].y + nextAt[0].h / 2); await page.waitForTimeout(500);
      const after = await page.evaluate(() => document.getElementById('howto-kicker').textContent);
      check(at === 'The goal' && /2 OF 5/i.test(after), `the second tap of a double tap on Next does not skip a page (${at} -> ${after})`);
      await page.waitForTimeout(GUARD_WAIT);
      await page.click('#btn-howto-close'); await page.waitForTimeout(300);
      check(!(await page.evaluate(() => window.__game.howToOpen())) && await page.evaluate(() => document.activeElement?.id) === 'btn-menu-howto', 'Close puts it away and the focus goes back to the How to play button');
      await page.waitForTimeout(GUARD_WAIT);
      await page.click('#btn-menu-howto'); await page.waitForTimeout(400);
      check(/1 OF 5/i.test(await page.textContent('#howto-kicker')), 'it opens at the first page again');
      await page.click('#btn-howto-close');

      // --- the keyboard (once: the layout does not change with the size) ---
      if (W === SIZES[0][0] && H === SIZES[0][1]) {
        await page.waitForTimeout(GUARD_WAIT);
        await page.focus('#btn-menu-howto');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(400);
        check(await page.evaluate(() => window.__game.howToOpen() && document.activeElement?.id === 'btn-howto-next'), 'keyboard: Enter on the button opens it and the focus moves in (to Next)');
        await page.keyboard.press('ArrowRight'); await page.waitForTimeout(100);
        check(/2 OF 5/i.test(await page.textContent('#howto-kicker')), 'the right arrow key turns a page');
        await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(100);
        check(/1 OF 5/i.test(await page.textContent('#howto-kicker')), 'the left arrow key turns back');
        const ring = [];
        for (let i = 0; i < 5; i++) { await page.keyboard.press('Tab'); ring.push(await page.evaluate(() => document.activeElement?.id)); }
        check(ring.every(id => /^btn-howto-/.test(id)) && new Set(ring).size >= 2, `Tab stays inside it (${ring.join(' > ')})`);
        await page.keyboard.press('Escape'); await page.waitForTimeout(300);
        check(!(await page.evaluate(() => window.__game.howToOpen())) && await page.evaluate(() => document.activeElement?.id) === 'btn-menu-howto', 'Escape closes it and the focus goes back');
      }

      // --- the hint: gone once a match is played or a practice finished (a match left early does not count) ---
      const hintNow = async rec => {
        await page.evaluate(r => { localStorage.setItem('hotelEscape.record.v1', JSON.stringify(r)); window.__game.menuShow('settings'); window.__game.menuShow('main'); }, rec);
        await page.waitForTimeout(200);
        return page.evaluate(() => { const h = document.getElementById('menu-hint'); return !h.hidden && h.textContent.length > 0; });
      };
      check(await hintNow({ played: 0, won: 0, lost: 0, left: 3 }) === true, 'matches left early do not hide the hint (nothing has been played to the end)');
      check(await hintNow({ played: 1, won: 1, lost: 0, clean: { played: 1, won: 1, lost: 0 }, possessed: {}, escaped: 0, practiceEscapes: 0, left: 0 }) === false, 'once a match is finished the hint is gone');
      check(await hintNow({ practiceEscapes: 1 }) === false, 'once a practice is finished the hint is gone');
      check(await hintNow({}) === true, 'with a record of nothing it is back');
    } catch (err) { check(false, `${W}x${H}: ${err.message.split('\n')[0]}`); }
    check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
    await browser.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// One match per size: the role screen, the chip, the Menu panel and the clock, the end screens.
async function matchChecks(W, H, role) {
  console.log(`\n  ${role}, ${W}x${H}`);
  const { browser, page, messages } = await launch({ width: W, height: H });
  const ev = (fn, a) => page.evaluate(fn, a);
  const mine = role === 'possessed';
  try {
    await intoMatch(page, role, { timer: true });
    // --- the role screen
    const rs = await ev(() => {
      const card = document.getElementById('handoff-card'), r = card.getBoundingClientRect(), line = document.querySelector('#handoff-role .role-line'), other = document.querySelector('#handoff-role .role-other');
      const b = document.getElementById('btn-handoff-next').getBoundingClientRect();
      return { head: document.getElementById('handoff-title').textContent, kicker: document.getElementById('handoff-kicker').textContent, badge: document.querySelector('#handoff-role .role-word')?.textContent,
        size: parseFloat(getComputedStyle(line).fontSize), other: other?.textContent, top: r.top, bottom: r.bottom, scroll: card.scrollHeight > card.clientHeight + 1, btnBottom: b.bottom, btnTop: b.top,
        sub: document.getElementById('handoff-sub').textContent };
    });
    check(rs.head === (mine ? 'You are possessed' : 'You are clean') && rs.kicker === 'Your secret role', `the role screen's headline: "${rs.head}"`);
    check(/^(POSSESSED|CLEAN GUEST)$/.test(rs.badge), `...the badge stays ("${rs.badge}")`);
    check(rs.size >= 15.5 && rs.size <= 17, `...the paragraph is about 16 px (${rs.size}px; it was 13)`);
    check(rs.other === (mine ? 'The clean guests win if one of them escapes with 3 Lanterns.' : 'The possessed win if everyone is possessed, or dawn breaks before anyone escapes.'), `...and ONE line about how the other side wins: "${rs.other}"`);
    check(rs.top >= 0 && rs.bottom <= H && !rs.scroll && rs.btnBottom <= H, `...and it fits (card ${Math.round(rs.top)}-${Math.round(rs.bottom)} of ${H}, the button ends at ${Math.round(rs.btnBottom)}, no scrolling)`);
    await page.screenshot({ path: `${outDir}/b-role-${role}-${W}x${H}.png` });
    await pastRole(page);

    // --- the Lanterns chip
    const chip = () => ev(() => {
      const c = document.getElementById('lantern-chip'), r = c.getBoundingClientRect(), p = document.getElementById('player-panel').getBoundingClientRect();
      const p2 = window.__game.state.players[window.__game.humanSeat()];
      const owned = p2.hand.filter(x => x.type === 'lantern').length;
      return { text: [...c.children].map(e => e.textContent).join(' '), aria: c.getAttribute('aria-label'), owned, need: window.__game.rules.lanternsToEscape, box: { l: r.left, t: r.top, r: r.right, b: r.bottom }, panel: { l: p.left, t: p.top, r: p.right, b: p.bottom }, shown: c.getClientRects().length > 0 };
    });
    let c = await chip();
    check(c.shown && c.text === `✦ Lanterns ${c.owned}/${c.need}`, `the Lanterns chip shows your own count out of ${c.need}: "${c.text}"`);
    check(c.box.l >= c.panel.l && c.box.r <= c.panel.r && c.box.t >= c.panel.t && c.box.b <= c.panel.b, '...inside the player panel');
    const others = await ev(() => ['.hud-bottom-right', '.hud-top-left', '.hud-top-center', '.hud-top-right', '#hand-fan .fan-card', '#toast'].flatMap(s => [...document.querySelectorAll(s)].filter(e => !e.hidden && e.getClientRects().length).map(e => { const r = e.getBoundingClientRect(); return { s, l: r.left, t: r.top, r: r.right, b: r.bottom }; })));
    const hit = others.filter(o => overlap(c.box, o)).map(o => o.s);
    check(!hit.length && c.box.t >= 0 && c.box.b <= H, `...and in the way of nothing (not the strip, the hand, the buttons, the room name)${hit.length ? `: ${hit.join(', ')}` : ''}`);
    check(/^You hold \d Lanterns? of the 3 needed to escape\.$/.test(c.aria), `...and says so aloud ("${c.aria}")`);
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; for (let i = 0; i < 2; i++) p.hand.push({ id: `learnL${i}`, type: 'lantern' }); g.refresh(); });
    await page.waitForTimeout(300);
    const c2 = await chip();
    check(c2.owned === c.owned + 2 && c2.text === `✦ Lanterns ${c2.owned}/${c2.need}`, `it follows the hand (now ${c2.text})`);
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; p.hand = p.hand.filter(x => x.type !== 'lantern'); g.refresh(); });
    await page.waitForTimeout(300);
    check((await chip()).text === '✦ Lanterns 0/3', '...and shows 0 with none');
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; for (let i = 0; i < 3; i++) p.hand.push({ id: `learnM${i}`, type: 'lantern' }); g.refresh(); });
    await page.waitForTimeout(300);
    check((await chip()).text === '✦ Lanterns 3/3', 'and 3/3 with three: the same words for a clean and a possessed guest');
    await page.screenshot({ path: `${outDir}/b-hud-${role}-${W}x${H}.png` });
    await ev(() => { const g = window.__game, p = g.state.players[g.humanSeat()]; p.hand = p.hand.filter(x => !/^learn[LM]/.test(x.id)); g.refresh(); });

    // --- the Menu panel, and the clock
    await ev(() => window.__game.setTimeLeft(40));
    const t0 = await ev(() => window.__game.timeLeft());
    check(t0 > 0 && t0 <= 40, `the turn clock is running (${t0.toFixed(1)} s)`);
    await page.click('#btn-leave');
    await page.waitForTimeout(500);
    const panelState = () => ev(() => {
      const root = document.getElementById('gamemenu-overlay'), card = document.querySelector('.gamemenu-card').getBoundingClientRect();
      const rows = ['gm-music', 'gm-sound'].map(id => [...document.querySelectorAll(`#${id} .seg-btn`)].map(b => `${b.textContent}${b.classList.contains('on') ? '*' : ''}`).join(' '));
      const targets = [...root.querySelectorAll('button')].map(b => { const r = b.getBoundingClientRect(); return { id: b.id || b.textContent, w: r.width, h: r.height }; });
      return { open: window.__game.menuPanelOpen(), ask: window.__game.askOpen(), title: document.getElementById('gm-title').textContent, rows, targets, card: { t: card.top, b: card.bottom, l: card.left, r: card.right },
        main: [...root.querySelectorAll('.gm-actions .btn')].map(b => b.textContent), focus: document.activeElement?.id, resumeGold: document.getElementById('btn-gm-resume').classList.contains('primary') };
    });
    let ps = await panelState();
    check(ps.open && !ps.ask && ps.title === 'Menu', 'the Menu button opens the Menu panel (not the question)');
    check(ps.main.join('|') === 'Resume|How to play|Leave the match' && ps.resumeGold, `...Resume (in gold), How to play, Leave the match (${ps.main.join(' | ')})`);
    check(ps.rows.join('|') === 'Off Low Medium* High|Off Low Medium High*', `...Music and Sound effects, with the same Off / Low / Medium / High as Settings (${ps.rows.join(' / ')})`);
    check(ps.card.t >= 0 && ps.card.b <= H && ps.card.l >= 0 && ps.card.r <= W, `...it fits (${Math.round(ps.card.t)}-${Math.round(ps.card.b)} of ${H})`);
    check(ps.targets.every(b => b.w >= 44 && b.h >= 44), `...every button a touch target of 44 px or more (smallest ${Math.round(Math.min(...ps.targets.map(b => b.h)))} px tall)`);
    check(ps.focus === 'btn-gm-resume', 'the keyboard focus is in the panel (on Resume)');
    await page.screenshot({ path: `${outDir}/b-menu-${role}-${W}x${H}.png` });
    // the clock stands still while it is open (as it did while the Leave question was open), and goes on after Resume
    const held1 = await clockOver(page, 2500);
    check(near(held1.a, held1.b, 0.0005) && held1.frames >= 4, `THE CLOCK, as before: it stands still while the Menu is open (${held1.a.toFixed(3)} -> ${held1.b.toFixed(3)} s over ${held1.frames} frames)`);
    check(!(await visible(page, '#hand-fan .fan-card')) && !(await visible(page, '#btn-chat')), 'the game under it is held, as under the question: the hand and the Chat button step aside');
    // sound rows: saved in Settings' own place, applied at once
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#gm-music .seg-btn[data-value="low"]'); await page.waitForTimeout(150);
    await page.click('#gm-sound .seg-btn[data-value="off"]'); await page.waitForTimeout(150);
    const stored = await ev(() => JSON.parse(localStorage.getItem('hotelEscape.settings.v1') || '{}'));
    ps = await panelState();
    check(stored.music === 'low' && stored.sound === 'off', `a pick is saved where Settings keeps it (music ${stored.music}, sound ${stored.sound})`);
    check(/^Off Low\* Medium High$/.test(ps.rows[0]) && /^Off\* Low Medium High$/.test(ps.rows[1]), `...and the rows show it (${ps.rows.join(' / ')})`);
    await page.click('#gm-music .seg-btn[data-value="medium"]'); await page.waitForTimeout(150);
    await page.click('#gm-sound .seg-btn[data-value="high"]'); await page.waitForTimeout(150);
    // How to play from here: over the panel; Escape closes only it
    await page.click('#btn-gm-howto'); await page.waitForTimeout(450);
    check(await ev(() => window.__game.howToOpen() && window.__game.menuPanelOpen()), 'How to play opens from the panel');
    const hb = await box(page, '.howto-card');
    check(hb.t >= 0 && hb.b <= H, `...and fits (${Math.round(hb.t)}-${Math.round(hb.b)} of ${H})`);
    await page.screenshot({ path: `${outDir}/b-menu-howto-${role}-${W}x${H}.png` });
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.howToOpen() && window.__game.menuPanelOpen()), 'Escape closes How to play and leaves the Menu panel open');
    const held2 = await clockOver(page, 1500);
    check(near(held2.a, held2.b, 0.0005) && held2.frames >= 4, `...and the clock is still held (${held2.frames} frames)`);
    // Leave asks the game's own question; Keep playing is the gold one and brings the game back
    await page.click('#btn-gm-leave'); await page.waitForTimeout(400);
    const q = await ev(() => ({ panel: window.__game.menuPanelOpen(), ask: window.__game.askOpen(), title: document.getElementById('ask-title').textContent, no: document.getElementById('btn-ask-no'), yes: document.getElementById('btn-ask-yes'),
      noGold: document.getElementById('btn-ask-no').classList.contains('primary'), yesGold: document.getElementById('btn-ask-yes').classList.contains('primary'), noText: document.getElementById('btn-ask-no').textContent, yesText: document.getElementById('btn-ask-yes').textContent }));
    check(!q.panel && q.ask && q.title === 'Leave the match?' && q.noText === 'Keep playing' && q.noGold && q.yesText === 'Main menu' && !q.yesGold, `Leave asks "${q.title}" with Keep playing in gold, as it always did`);
    const held3 = await clockOver(page, 1500);
    check(near(held3.a, held3.b, 0.0005) && held3.frames >= 4, `THE CLOCK, as before: still held while that question is open (${held3.frames} frames)`);
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-ask-no'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.askOpen() && !window.__game.menuPanelOpen() && window.__game.phase() === 'game'), 'Keep playing: back in the game');
    const t5 = await ev(() => window.__game.timeLeft());
    const ran = await page.waitForFunction(t => window.__game.timeLeft() < t - 0.01, t5, { timeout: 30000, polling: 200 }).then(() => true, () => false);
    check(ran, `...and the clock runs again (${t5.toFixed(2)} -> ${(await ev(() => window.__game.timeLeft())).toFixed(2)} s)`);
    // Resume, and Escape
    await page.click('#btn-leave'); await page.waitForTimeout(500);
    await page.click('#btn-gm-resume'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.menuPanelOpen()) && await ev(() => document.activeElement?.id) === 'btn-leave', 'Resume closes the panel and the focus goes back to the Menu button');
    await page.click('#btn-leave'); await page.waitForTimeout(500);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.menuPanelOpen()), 'Escape resumes too');
    await page.click('#btn-leave'); await page.waitForTimeout(500);
    await page.mouse.click(8, Math.round(H / 2)); await page.waitForTimeout(300);
    check(await ev(() => !window.__game.menuPanelOpen()), 'a tap on the dark round the card resumes too');
    await ev(() => window.__game.setTimeLeft(9999));

    // --- the end screens (the match's own state set to how it could have ended; the end screen is the game's own)
    const endCase = async (name, setup, want) => {
      await ev(`(${setup.toString()})(window.__game)`);
      await ev(() => { document.getElementById('end-overlay').hidden = true; window.__game.showEnd(); });
      await page.waitForTimeout(700);
      const e = await ev(() => {
        const card = document.querySelector('#end-overlay .card'), r = card.getBoundingClientRect();
        const bs = [...document.querySelectorAll('#end-overlay .end-actions .btn')].filter(x => !x.hidden).map(x => x.getBoundingClientRect());
        return { verdict: document.getElementById('end-verdict').hidden ? '' : document.getElementById('end-verdict').textContent, title: document.getElementById('end-title').textContent,
          recap: document.getElementById('end-recap').hidden ? '' : document.getElementById('end-recap').textContent, top: r.top, bottom: r.bottom, scroll: card.scrollHeight > card.clientHeight + 1,
          btnBottom: Math.max(...bs.map(x => x.bottom)), won: document.getElementById('end-overlay').classList.contains('won'), lost: document.getElementById('end-overlay').classList.contains('lost'),
          rows: document.querySelectorAll('#end-reveal .er-row').length };
      });
      check(e.verdict === want.verdict && (want.title ? e.title === want.title : true), `${name}: "${e.verdict}" above "${e.title}"`);
      check(want.recap.test(e.recap), `...with the recap "${e.recap}"`);
      check(e.top >= 0 && e.btnBottom <= H && e.bottom <= H && !e.scroll && e.rows === 6, `...it fits at ${W}x${H} (${Math.round(e.top)}-${Math.round(e.bottom)}, buttons end ${Math.round(e.btnBottom)}, ${e.rows} guests listed)`);
      await page.screenshot({ path: `${outDir}/b-end-${name.replace(/\W+/g, '-')}-${W}x${H}.png` });
      return e;
    };
    // (each case starts from the match as it is: a helper in the page puts the game back to "not over")
    await ev(() => { window.__learnReset = g => { const s = g.state; s.finished = false; s.won = null; s.dawn = false; s.escaped.clear(); for (const p of s.players) p.alive = true; }; });
    if (!mine) {
      const e1 = await endCase('clean got out', g => { const s = g.state; window.__learnReset(g); const you = s.players[g.humanSeat()]; s.won = 'humans'; s.finished = true; s.escaped.add(you.id); }, { verdict: 'Victory', title: 'You got out!', recap: /was possessed first and possessed/ });
      check(e1.won && !e1.lost, '...the title is gold (won)');
      await endCase('clean, a guest got out', g => { const s = g.state; window.__learnReset(g); const other = s.players.find(p => !p.possessed && p.index !== g.humanSeat()); s.won = 'humans'; s.finished = true; s.escaped.add(other.id); }, { verdict: 'Victory', title: 'The guests got out', recap: /possessed/ });
      const e3 = await endCase('clean, dawn', g => { const s = g.state; window.__learnReset(g); s.won = 'possessed'; s.dawn = true; s.finished = true; s.round = 8; }, { verdict: 'Defeat', title: 'Dawn breaks', recap: /possessed/ });
      check(e3.lost && !e3.won, '...the title is salmon (lost)');
      await endCase('clean, dead', g => { const s = g.state; window.__learnReset(g); const you = s.players[g.humanSeat()]; you.alive = false; s.won = 'possessed'; s.finished = true; }, { verdict: 'Defeat', title: 'The hotel keeps them', recap: /possessed/ });
      await endCase('clean, dead, but a guest got out', g => { const s = g.state; window.__learnReset(g); const you = s.players[g.humanSeat()]; you.alive = false; const other = s.players.find(p => !p.possessed && p.index !== g.humanSeat()); s.won = 'humans'; s.finished = true; s.escaped.add(other.id); }, { verdict: 'Victory', title: 'The guests got out', recap: /possessed/ });
    } else {
      await endCase('possessed, dawn', g => { const s = g.state; s.won = 'possessed'; s.dawn = true; s.finished = true; s.round = 8; }, { verdict: 'Victory', title: 'Dawn breaks', recap: /^You were possessed first and possessed/ });
      await endCase('possessed, a clean guest got out', g => { const s = g.state; window.__learnReset(g); const other = s.players.find(p => !p.possessed); s.won = 'humans'; s.finished = true; s.dawn = false; s.escaped.add(other.id); }, { verdict: 'Defeat', title: 'The guests got out', recap: /^You were possessed first/ });
    }
    // the Menu button on the end screen: straight to the main menu, no panel (its old behaviour)
    await ev(() => document.getElementById('btn-leave').click());      // (the end screen covers the button: the keyboard's click, as the code allows)
    await waitFor(page, () => window.__game.phase() === 'menu', null, 30000);
    check(await ev(() => !window.__game.menuPanelOpen()) && await ev(() => !document.getElementById('menu').hidden), 'on the end screen the Menu button still goes straight to the main menu');
  } catch (err) { check(false, `${role} ${W}x${H}: ${err.message.split('\n')[0]}`); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

if (only.includes('b')) {
  console.log('\nb. a match: the role screen, the chip, the Menu panel and the clock, the end screens');
  for (const [W, H] of SIZES) await matchChecks(W, H, 'clean');
}
if (only.includes('c')) {
  console.log('\nc. a possessed player');
  const [W, H] = SIZES.find(s => s[0] === 1024 && s[1] === 694) || SIZES[0];
  await matchChecks(W, H, 'possessed');
}

// ---------------------------------------------------------------------------------------------------
if (only.includes('d')) {
  console.log('\nd. practice');
  const [W, H] = SIZES.find(s => s[0] === 1180) || SIZES[0];
  const { browser, page, messages } = await launch({ width: W, height: H });
  const ev = (fn, a) => page.evaluate(fn, a);
  try {
    await page.goto(`${baseUrl}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
    await waitFor(page, () => window.__game && !document.getElementById('btn-begin').disabled, null, 120000);
    await page.click('#btn-begin');
    await page.waitForTimeout(1500);
    const c = await ev(() => ({ text: [...document.getElementById('lantern-chip').children].map(e => e.textContent).join(' '), shown: document.getElementById('lantern-chip').getClientRects().length > 0 }));
    check(c.shown && /^✦ Lanterns \d\/3$/.test(c.text), `practice has the Lanterns chip too ("${c.text}")`);
    await page.click('#btn-leave'); await page.waitForTimeout(500);
    check(await ev(() => window.__game.menuPanelOpen() && document.getElementById('btn-gm-leave').textContent === 'Leave practice'), 'the Menu panel in practice says Leave practice');
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-gm-leave'); await page.waitForTimeout(400);
    check(await ev(() => window.__game.askOpen() && document.getElementById('ask-title').textContent === 'Leave practice?' && document.getElementById('btn-ask-no').classList.contains('primary')), '...and its question is "Leave practice?", Keep playing in gold');
    await page.waitForTimeout(GUARD_WAIT);
    await page.click('#btn-ask-no'); await page.waitForTimeout(300);
    // the end of a practice: its own words, no sides
    await ev(() => { const g = window.__game; g.state.finished = true; g.showEnd(); });
    await page.waitForTimeout(600);
    const e = await ev(() => ({ verdict: !document.getElementById('end-verdict').hidden, recap: !document.getElementById('end-recap').hidden, title: document.getElementById('end-title').textContent, won: document.getElementById('end-overlay').classList.contains('won') }));
    check(!e.verdict && !e.recap && /fire exit/i.test(e.title) && !e.won, `the end of a practice keeps its own words and shows no Victory or Defeat ("${e.title}")`);
  } catch (err) { check(false, `practice: ${err.message.split('\n')[0]}`); }
  check(quiet(messages).length === 0, `console clean${quiet(messages).length ? `: ${quiet(messages).slice(0, 3).join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} CHECK(S) FAILED` : '\nALL LEARN CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
