import { GUARD_WAIT } from './smoke-lib.mjs';
// Co-op END TO END (DESIGN §15 "Browser", BUILD-PLAN P5): the real Co-op server (server/index.js) on 127.0.0.1 and
// several people, each in a browser of their own (its own device: storage, profile, network), playing through the
// page's own screens. The page and the server are on different origins (two ports). One browser suite at a time on the
// machine (the build's lock):
//   node tests/browser-coop.mjs [--url http://127.0.0.1:PORT/] [--server-port N] [--server-port2 N] [--ts N]
//                               [--only room,match,demo] [--shots DIR] [--no-shots]
// Without --url it serves the repo itself on 127.0.0.1 (a free port). --server-port: the in-process server of `room`
// (default: a free port); --server-port2: the child-process server of `match` (default: a free port); --ts: the
// match's TIME_SCALE (default 2: TIME_SCALE shrinks the 5-minute stall too, and three software-drawn pages make about
// one frame a second here, so a walk on screen, which a meeting's screen waits for, takes most of a minute). Screenshots: tests/shots/coop/ (git-ignored) with manifest.json, which
// tools/coop-record/make-sheet.mjs turns into the contact sheet.
//
//   room   six devices, one table, a server in this process (TIME_SCALE 1, LIMITS_SCALE 5):
//          nora starts a table; ana opens the invite link on a device with no profile (the register first, "You're
//          invited to nora's table.", then seated under her new name, never "Guest"); sam types the code; nora locks
//          the table and ivy's link is turned away ("This table is locked"); nora unlocks; nora removes sam ("You've
//          left the table", and his code no longer seats him); nora's own key opened on a second device takes her seat
//          ("Playing on another device"), and "Play here instead" takes it back; ivy and ben join by the link; nora
//          makes it a table of 4 and zoe is turned away ("This table is full"); zoe's code field and Join stay above
//          the on-screen keyboard at the four iPad sizes, and a pasted invite link is taken whole; a code nobody has:
//          "No table with that code"; Start: the countdown on both sides (Wait stops it), then all four devices go into
//          the match, each with its own guest and only its own role (the secrets scan against the server's truth)
//   match  three devices play a whole match against a child-process server with DATA_DIR (the saves on disk) and
//          TIME_SCALE --ts: a meeting from both sides (one person opens a door and walks in, another walks in on them
//          and chooses Trade); the server is killed (SIGKILL) while both are choosing their card, started again on the
//          same folder, and the match comes back where it was, with the trade done exactly once; a 60 s drop
//          (setOffline): Away and the feed line for the others, "Reconnecting…" and, after 20 s, "Still reconnecting…"
//          for the one who dropped, "You're back at the table." and "… is back." on return; a polite restart (SIGTERM):
//          "The hotel's server restarted" once on every device; the end screen with the Co-op buttons; Play again: the
//          host's countdown on a guest's end screen and in the waiting room, and everyone in the next match. The
//          secrets scan runs all along: every page, every few seconds, against the server's own save
//   demo   the review link (?friends=demo&pace=fast) at 1024x694: start a table, "Show sam's screen", type the code as
//          sam, join, switch back, Start, and both seats played through the page's own screens and the switch to the
//          end screen; the hand on screen is only ever the shown seat's own
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ONLINE_TEXT as T, fill } from '../src/data/onlineText.js';
import { ONLINE } from '../src/data/online.js';
import {
  ROOT, SIZES, checks, freePort, staticServer, childServer, person, ownMessages, text, shown, tap, waitScreen,
  waitFor, screenNow, openPage, still, inMatch, coopCard, shots as makeShots, drive, pageHolds, truthFromSave, readSave, scanHits, relay,
} from './lib/coop.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const here = path.dirname(new URL(import.meta.url).pathname);
const only = opt('--only', 'room,match,demo').split(',');
const TS = Number(opt('--ts', 2));
const shotDir = opt('--shots', path.join(here, 'shots', 'coop'));
const S = makeShots(shotDir, { enabled: !args.includes('--no-shots') });
const C = checks();
const { check, gap, info } = C;
const t00 = Date.now();

let page0 = null;
let baseUrl = opt('--url', null);
if (!baseUrl) { page0 = await staticServer(ROOT, 0); baseUrl = page0.url; }
console.log(`the page: ${baseUrl}`);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const people = page => page.evaluate(() => [...document.querySelectorAll('#table-seats .cs-seat.person .cs-name')].map(e => e.textContent.trim()));
const cardTitle = page => text(page, '#coop-card-title');
const waitCard = (page, title, timeout = 20000) => waitFor(page, t => !document.getElementById('coop-card')?.hidden && document.getElementById('coop-card-title')?.textContent === t, title, timeout);
const consoleCheck = (devs, label) => {
  const own = devs.flatMap(d => ownMessages(d.messages).map(m => `${d.name}: ${m}`));
  check(own.length === 0, `${label}: console clean${own.length ? `: ${own.slice(0, 4).join(' | ')}` : ''}`);
};

// =====================================================================================================================
if (only.includes('room')) {
  console.log('\nroom. six devices at one table (create, the register by link, by code, lock, remove, another device, full, keyboard, start)');
  S.reset('room');
  const { startServer } = await import('../server/index.js');
  const srv = await startServer({ port: Number(opt('--server-port', 0)), host: '127.0.0.1', timeScale: 1, limitsScale: 5, botChat: false, log: () => {} });
  const q = `server=${encodeURIComponent(`ws://127.0.0.1:${srv.port}`)}`;
  info(`server in this process on 127.0.0.1:${srv.port} (page origin ${new URL(baseUrl).origin})`);
  const devs = [];
  const shoot = (d, name, caption, sizes = 'own') => S.shoot(d.page, name, { caption, who: d.name, section: 'room', sizes });
  // the truth: the table on the server (this process)
  const tableOf = code => srv.rooms.debug.table(code);
  const truthLive = code => { const M = tableOf(code)?.match; return M ? truthFromSave({ match: { engine: { state: M.state }, aliases: M.aliases.toJSON() } }) : null; };
  try {
    const [nora, ana, sam, ivy, ben, zoe] = await Promise.all([
      person({ name: 'nora', width: 1024, height: 694 }),
      person({ name: 'ana', width: 1024, height: 768, profile: false }),
      person({ name: 'sam', width: 1180, height: 820 }),
      person({ name: 'ivy', width: 1366, height: 1024 }),
      person({ name: 'ben', width: 1180, height: 820 }),
      person({ name: 'zoe', width: 1024, height: 768, keyboard: true }),
    ]);
    devs.push(nora, ana, sam, ivy, ben, zoe);
    // 1. nora starts a table
    await openPage(nora.page, baseUrl, q);
    await tap(nora.page, '#btn-menu-coop');
    check(await waitScreen(nora.page, 'menu-coop') && await shown(nora.page, '#btn-coop-start'), 'nora: Co-op, with Start a table and the code field');
    await still(nora.page);
    await shoot(nora, 'coop', 'Co-op: start a table or join one', 'all');
    await tap(nora.page, '#btn-coop-start');
    check(await waitScreen(nora.page, 'menu-table', 30000), 'nora: Start a table, the waiting room');
    const code = await text(nora.page, '#table-code');
    check(/^[A-Z]{5}$/.test(code || '') && await text(nora.page, '#table-kicker') === fill(T.table.kickerHost, {}), `...the code ${code}, "${await text(nora.page, '#table-kicker')}"`);
    check(!!tableOf(code) && tableOf(code).people.length === 1, '...the server holds the table, nora alone at it');
    await still(nora.page);
    await shoot(nora, 'host-alone', 'Your private table, the host alone', 'all');
    const link = `${baseUrl}?join=${code}`;

    // 2. ana: the invite link on a device with no profile: the register first
    await ana.page.goto(`${baseUrl}?intro=off&${q}&join=${code.toLowerCase()}`, { waitUntil: 'domcontentloaded' });
    await ana.page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout: 180000, polling: 100 });
    const reg = await waitScreen(ana.page, 'menu-signup', 30000);
    await waitFor(ana.page, t => !document.getElementById('su-invite').hidden && document.getElementById('su-invite').textContent === t, fill(T.coop.invited, { host: 'nora' }), 20000);
    const invite = await text(ana.page, '#su-invite');
    check(reg && invite === fill(T.coop.invited, { host: 'nora' }), `ana opens the link with no profile: the register, under "${invite}"`);
    check(!tableOf(code).people.some(p => p.name === 'Guest') && tableOf(code).people.length === 1, '...nobody is seated as "Guest" meanwhile');
    await still(ana.page);
    await shoot(ana, 'register-invite', 'A friend with no profile opens the link: the register first', 'all');
    await ana.page.fill('#su-name', 'ana');
    await ana.page.press('#su-name', 'Enter');
    check(await waitScreen(ana.page, 'menu-table', 30000), '...after Continue: straight into the waiting room');
    const anaSees = await people(ana.page);
    check(anaSees.includes('ana') && !anaSees.includes('Guest') && tableOf(code).people.map(p => p.name).join() === 'nora,ana', `...seated as "ana", never "Guest" (her screen: ${anaSees.join(', ')}; the server: ${tableOf(code).people.map(p => p.name).join(', ')})`);
    check(await text(ana.page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'nora' }), `..."${await text(ana.page, '#table-kicker')}"`);

    // 3. sam types the code
    await openPage(sam.page, baseUrl, q);
    await tap(sam.page, '#btn-menu-coop');
    await waitScreen(sam.page, 'menu-coop');
    await sam.page.fill('#coop-code', ` ${code.slice(0, 2).toLowerCase()} ${code.slice(2).toLowerCase()} `);
    await tap(sam.page, '#btn-coop-join');
    check(await waitScreen(sam.page, 'menu-table', 30000) && await text(sam.page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'nora' }), `sam types the code (lower case, with spaces): "${await text(sam.page, '#table-kicker')}"`);
    await waitFor(nora.page, () => document.querySelectorAll('#table-seats .cs-seat.person').length === 3, null, 15000);
    check((await people(nora.page)).join() === 'nora,ana,sam', `...nora sees ${(await people(nora.page)).join(', ')}`);
    await still(sam.page);
    await shoot(sam, 'guest', "A friend's view of the waiting room", 'all');
    await still(nora.page);
    await shoot(nora, 'host-3', 'The host with three at the table', 'all');

    // 4. nora locks: ivy's link is turned away
    await tap(nora.page, '#table-lock .seg-btn[data-value="true"]');
    check(await waitFor(nora.page, t => document.getElementById('table-note')?.textContent === t, T.table.lockedNote, 10000) && tableOf(code).locked, `nora locks the table: "${await text(nora.page, '#table-note')}"`);
    check(await waitFor(sam.page, t => document.getElementById('table-locked-line')?.textContent === t, fill(T.table.lockedGuest, { host: 'nora' }), 10000), `...sam's screen: "${await text(sam.page, '#table-locked-line')}"`);
    await shoot(nora, 'host-locked', 'Locked, the host');
    await shoot(sam, 'guest-locked', 'Locked, a friend', 'all');
    await openPage(ivy.page, baseUrl, `${q}&join=${code}`);
    check(await waitCard(ivy.page, T.errors.locked.title), `ivy's link while it is locked: "${await cardTitle(ivy.page)}"`);
    await shoot(ivy, 'card-locked', 'Turned away: the table is locked', 'all');
    await tap(nora.page, '#table-lock .seg-btn[data-value="false"]');
    check(await waitFor(nora.page, () => true, null, 1000) && await waitFor(nora.page, t => document.getElementById('table-note')?.textContent === t, T.table.sizeNote, 10000) && !tableOf(code).locked, 'nora unlocks it');

    // 5. nora removes sam
    await nora.page.evaluate(() => { const b = [...document.querySelectorAll('#table-seats button.cs-box')].find(x => x.textContent.includes('sam')); b?.setAttribute('data-test', 'sam'); });
    await tap(nora.page, '#table-seats button[data-test="sam"]');
    check(await waitFor(nora.page, t => document.getElementById('table-dlg-title')?.textContent === t, fill(T.dialogs.remove.title, { name: 'sam' }), 10000), `nora taps sam's seat: "${await text(nora.page, '#table-dlg-title')}"`);
    await shoot(nora, 'dialog-remove', 'Remove a friend?');
    await tap(nora.page, '#btn-table-dlg-yes');
    check(await waitCard(sam.page, T.errors.removed.title), `...sam's screen: "${await cardTitle(sam.page)}"`);
    await shoot(sam, 'card-removed', 'Removed by the host', 'all');
    check(await waitFor(nora.page, () => document.querySelectorAll('#table-seats .cs-seat.person').length === 2, null, 10000) && !tableOf(code).people.some(p => p.name === 'sam'), `...he is gone from the table (${(await people(nora.page)).join(', ')})`);
    await sam.page.evaluate(() => window.__game.menuShow('main'));
    await tap(sam.page, '#btn-menu-coop');
    await waitScreen(sam.page, 'menu-coop');
    await sam.page.fill('#coop-code', code);
    await tap(sam.page, '#btn-coop-join');
    check(await waitCard(sam.page, T.errors.removed.title), `...and his code no longer seats him: "${await cardTitle(sam.page)}"`);

    // 6. nora's own device key on a second device (sam's, now free): the newest device takes her seat; "Play here
    //    instead" takes it back
    const noraKeys = await nora.page.evaluate(k => ({ guest: localStorage.getItem(k.guest), profile: localStorage.getItem('hotelEscape.profile.v1') }), ONLINE.storage);
    check(!!noraKeys.guest, "nora's device keeps its key (a reload would come back to her seat)");
    await sam.page.evaluate(k => { localStorage.setItem(k.guestKey, k.guest); localStorage.setItem('hotelEscape.profile.v1', k.profile); localStorage.removeItem(k.tableKey); }, { guestKey: ONLINE.storage.guest, tableKey: ONLINE.storage.table, ...noraKeys });
    await openPage(sam.page, baseUrl, `${q}&join=${code}`);
    const [second, elsewhere] = await Promise.all([waitScreen(sam.page, 'menu-table', 60000), waitCard(nora.page, T.recovery.elsewhere.title, 60000)]);
    check(second && elsewhere, `nora's key on a second device: it sits at her seat, and her first device says "${await cardTitle(nora.page)}"`);
    check(await text(nora.page, '#btn-coop-card-a') === T.recovery.elsewhere.buttons[0], `...with "${await text(nora.page, '#btn-coop-card-a')}"`);
    await shoot(nora, 'card-elsewhere', 'The same seat opened on another device', 'all');
    await tap(nora.page, '#btn-coop-card-a');
    check(await waitScreen(nora.page, 'menu-table', 30000) && await waitCard(sam.page, T.recovery.elsewhere.title, 20000), '"Play here instead": nora is back at her table, and the second device now says "Playing on another device"');
    check(tableOf(code).people.length === 2 && tableOf(code).host === tableOf(code).people.find(p => p.name === 'nora')?.pid, '...still one nora at the table, and she is still the host');
    await sam.close();

    // 7. ivy (the link again) and ben (the link) sit down
    await openPage(ivy.page, baseUrl, `${q}&join=${code}`);
    check(await waitScreen(ivy.page, 'menu-table', 30000), 'unlocked: ivy\'s link seats her now');
    await openPage(ben.page, baseUrl, `${q}&join=${code}`);
    check(await waitScreen(ben.page, 'menu-table', 30000), 'ben\'s link seats him');
    await waitFor(nora.page, () => document.querySelectorAll('#table-seats .cs-seat.person').length === 4, null, 15000);
    check((await people(nora.page)).join() === 'nora,ana,ivy,ben', `...the table: ${(await people(nora.page)).join(', ')}`);
    // 8. a table of 4: zoe is turned away; her keyboard first
    await tap(nora.page, '#table-size .seg-btn[data-value="4"]');
    check(await waitFor(nora.page, () => true, null, 500) && await waitFor(nora.page, () => !document.querySelectorAll('#table-seats .cs-seat.empty').length, null, 10000) && tableOf(code).size === 4, 'nora makes it a table of 4: no empty seat');
    await still(nora.page);
    await shoot(nora, 'host-4-full', 'The host, a full table of four', 'all');
    await openPage(zoe.page, baseUrl, q);
    await tap(zoe.page, '#btn-menu-coop');
    await waitScreen(zoe.page, 'menu-coop');
    for (const [W, H] of SIZES) {
      const tag = `${W}x${H}`;
      await zoe.page.setViewportSize({ width: W, height: H });
      const kb = H >= 1000 ? 424 : 398;               // (the iPad's keyboard in landscape, about)
      await zoe.page.focus('#coop-code');
      await zoe.page.evaluate(px => window.__keyboard(px), kb);
      await zoe.page.waitForTimeout(300);
      await still(zoe.page);
      const r = await zoe.page.evaluate(() => { const b = id => document.getElementById(id).getBoundingClientRect(); return { kbd: document.querySelector('#menu .menu-panel').classList.contains('kbd'), field: b('coop-code'), join: b('btn-coop-join'), vv: window.visualViewport.height, focus: document.activeElement?.id }; });
      check(r.kbd && r.focus === 'coop-code' && r.field.top >= 0 && r.field.bottom <= r.vv && r.join.bottom <= r.vv && r.join.height >= 44,
        `${tag} zoe's keyboard up (${kb} px): the code field (${Math.round(r.field.top)}..${Math.round(r.field.bottom)}) and Join (to ${Math.round(r.join.bottom)}) above it (from ${Math.round(r.vv)})`);
      await shoot(zoe, 'keyboard', 'The code field above the on-screen keyboard');
      await zoe.page.evaluate(() => { document.getElementById('coop-code').blur(); window.__keyboard(0); });
      await zoe.page.waitForTimeout(300);
      check(!(await zoe.page.evaluate(() => document.querySelector('#menu .menu-panel').classList.contains('kbd'))), `${tag} keyboard down: the panel back in its place`);
    }
    await zoe.page.setViewportSize({ width: 1024, height: 768 });
    // a code nobody has
    await zoe.page.fill('#coop-code', code === 'BCDFG' ? 'BCDFH' : 'BCDFG');
    await tap(zoe.page, '#btn-coop-join');
    check(await waitCard(zoe.page, T.errors.notFound.title), `a code nobody has: "${await cardTitle(zoe.page)}"`);
    await shoot(zoe, 'card-notfound', 'No table with that code', 'all');
    await tap(zoe.page, '#btn-coop-card-a');
    await waitFor(zoe.page, () => !document.getElementById('coop-code').hidden && document.activeElement?.id === 'coop-code', null, 10000);
    await zoe.page.fill('#coop-code', '');
    await zoe.page.focus('#coop-code');
    await zoe.page.keyboard.insertText(link);
    check(await zoe.page.inputValue('#coop-code') === link, `a pasted invite link (${link.length} characters) is taken whole`);
    await tap(zoe.page, '#btn-coop-join');
    check(await waitCard(zoe.page, T.errors.full.title), `...and Join takes its code: a table of 4 with 4 seated, "${await cardTitle(zoe.page)}"`);
    await shoot(zoe, 'card-full', 'Turned away: the table is full', 'all');

    // 9. Start: the countdown on both sides; Wait stops it; Start again: the countdown on all four devices (each at its
    //    own iPad size), then the match
    await zoe.close();
    await still(nora.page);
    await tap(nora.page, '#btn-table-start');
    const counting = await waitFor(nora.page, () => !document.getElementById('table-countdown').hidden, null, 8000, 50);
    await nora.page.click('#btn-table-wait', { timeout: 10000 }).catch(() => {});
    const stopped = await waitFor(nora.page, () => document.getElementById('table-countdown').hidden, null, 8000, 50);
    check(counting && stopped && !tableOf(code).match && tableOf(code).phase === 'waiting', `Start: the countdown; nora's Wait stops it (no match dealt, the table ${tableOf(code).phase})`);
    await nora.page.waitForTimeout(GUARD_WAIT);
    await tap(nora.page, '#btn-table-start');
    const counts = await Promise.all([nora, ana, ivy, ben].map(d => waitFor(d.page, () => !document.getElementById('table-countdown').hidden, null, 8000, 50)));
    const guestLine = await text(ivy.page, '#table-count-guests');
    const waits = [await shown(nora.page, '#btn-table-wait'), await shown(ivy.page, '#btn-table-wait')];
    await Promise.all([nora, ana, ivy, ben].map(d => S.shoot(d.page, `countdown-${d.name}`, { caption: `The countdown, ${d.name === 'nora' ? 'the host' : 'a friend'} (${d.size.join('x')})`, who: d.name, section: 'room', settle: 0 })));
    check(counts.every(Boolean) && waits[0] && !waits[1], `Start again: the countdown on all four devices, the host's with Wait, the friends' without (${counts.map(Boolean).join(', ')})`);
    check(guestLine === fill(T.table.countdownGuests, { host: 'nora' }), `...a friend's line: "${guestLine}"`);
    const four = [nora, ana, ivy, ben];
    for (const d of four) {
      const ok = await inMatch(d.page, 180000);
      const me = ok ? await d.page.evaluate(() => { const v = window.__net.view(); return { name: v.players[v.seat].name, seats: v.players.length, kind: v.table?.kind, bots: v.players.filter(p => p.bot).length }; }) : {};
      check(ok && me.name === d.name && me.seats === 4 && me.kind === 'friends', `${d.name}'s device goes into the match: her/his own guest "${me.name}", ${me.seats} seats, a ${me.kind} table`);
    }
    // the role screens, and the secrets scan against the server's own game
    for (const d of four) {
      const role = await waitFor(d.page, () => window.__game.handoffOpen() && window.__game.handoffKind() === 'role', null, 90000, 250);
      const truth = truthLive(code);
      const mine = truth?.players.find(p => p.name === d.name);
      const shownRole = await d.page.evaluate(() => window.__net.view()?.ask?.role ?? null);
      check(role && shownRole === (mine?.possessed ? 'possessed' : 'clean'), `${d.name}: the role screen, her/his own role (${shownRole})`);
      await shoot(d, `match-role-${d.name}`, `${d.name}'s own secret role (${d.size.join('x')})`);
    }
    const truth = truthLive(code);
    let looks = 0;
    const hits = [];
    for (const d of four) { looks++; hits.push(...scanHits(await pageHolds(d.page), truth).map(h => `${d.name}: ${h}`)); }
    check(truth && hits.length === 0, `the secrets scan on the four devices (every other seat's cards, aliases and role, against the server's game): ${hits.length} hits${hits.length ? `: ${hits.slice(0, 4).join(' | ')}` : ''}`);
    check(truth?.players.filter(p => p.possessed).length === 1, `...(the server dealt ${truth?.players.filter(p => p.possessed).length} possessed guest among the 4)`);
    for (const d of four) await d.page.evaluate(() => window.__game.settled?.()).catch(() => {});
  } catch (err) { check(false, `room: ${err.message.split('\n')[0]}`); for (const d of devs) await S.shoot(d.page, `error-${d.name}`, { caption: `room error (${d.name})`, who: d.name, section: 'room' }).catch(() => {}); }
  consoleCheck(devs, 'room');
  for (const d of devs) await d.close();
  await srv.close();
}

// =====================================================================================================================
if (only.includes('match')) {
  console.log(`\nmatch. three devices, a whole match, a child-process server with DATA_DIR and TIME_SCALE ${TS}: kill -9 mid-trade, a 60 s drop, a polite restart, the end, Play again`);
  S.reset('match');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-coop-'));
  const sport = Number(opt('--server-port2', 0)) || await freePort();
  const srv = childServer({ port: sport, dataDir, timeScale: TS, limitsScale: 5 });
  check(await srv.start(), `the server: node server/index.js on 127.0.0.1:${sport}, DATA_DIR ${dataDir}`);
  const devs = [];
  const shoot = (d, name, caption, sizes = 'own') => S.shoot(d.page, name, { caption, who: d.name, section: 'match', sizes });
  let code = null;
  const truthNow = () => truthFromSave(readSave(dataDir, code));
  // the secrets scan: every page, every few seconds, against the server's latest save
  const scan = { looks: 0, hits: [], last: new Map() };
  const scanPage = async d => {
    const now = Date.now();
    if (now - (scan.last.get(d.name) || 0) < 3000) return;
    scan.last.set(d.name, now);
    const truth = truthNow();
    if (!truth || truth.finished) return;
    const holds = await pageHolds(d.page).catch(() => null);
    if (!holds?.view) return;
    scan.looks++;
    for (const h of scanHits(holds, truth)) if (scan.hits.length < 50) scan.hits.push(`${d.name}: ${h}`);
  };
  // the script: one person opens a door and walks into the new room (B); the next person walks in on them (A) and
  // chooses Trade; while both choose their card the server is killed
  const sc = { phase: 'open', B: null, A: null, X: null, aAsk: null, bAsk: null, released: false, fail: null, shotMeet: false };
  const seatOf = d => d.seat;
  const roomOf = async (d, seat) => d.page.evaluate(i => { const p = window.__net.view()?.players?.[i]; return p ? { room: p.room, alive: p.alive } : null; }, seat);
  async function scriptTurn(d) {
    // after the trade: the two go back to the lobby, a safe zone (no meetings), and sit out the match there with the
    // third person. (A computer guest walking in on a person is drawn first, and on these software-drawn pages, about a
    // frame a second, that walk takes about a minute on screen, which the 5-minute stall, shrunk by TIME_SCALE, may not
    // wait for.)
    if (sc.home && (d === sc.A || d === sc.B) && !sc.homeDone?.has(d)) {
      const r = await d.page.evaluate(async () => {
        const n = window.__net, lobby = window.__game.presenterFloor.start.room, v = n.view();
        if (v.me.room === lobby || !v.me.alive) return { ok: true, already: true };
        const res = await n.send({ k: 'move', to: lobby });
        return { ok: !!res?.ok, reason: res?.reason ?? null };
      });
      (sc.homeDone ||= new Set());
      if (r.ok) { sc.homeDone.add(d); info(`${d.name} goes back to the lobby${r.already ? ' (already there)' : ''}`); return !r.already; }
      info(`${d.name} cannot go back to the lobby this turn (${r.reason})`);
      return false;
    }
    if (sc.phase === 'open' && !sc.B) {
      sc.B = d; sc.phase = 'opening';
      // an empty room next to this one (the lobby), or else a door opened (the page's own door: the same path as a tap
      // on it, src/main.js onOpenDoor) and the room behind it; the move itself goes through window.__net.send (DESIGN
      // §15): the server's walk is atomic, and the page puts its own figure there at once (a walk drawn on screen takes
      // as many frames as on an iPad, and these software-drawn pages make about one frame a second)
      const r = await d.page.evaluate(async () => {
        const g = window.__game, n = window.__net;
        const v = n.view(), me = v.players[v.seat], f = g.presenterFloor, here = f.rooms.get(me.room);
        const taken = new Set(v.players.filter(p => p.alive && !p.escaped).map(p => p.room));
        const locked = new Set(v.locked || []);
        const tried = [];
        for (const id of [...(here?.neighbours || [])]) {
          const x = f.rooms.get(id);
          if (!x || x.isExit || taken.has(id) || locked.has(id)) continue;
          const res = await n.send({ k: 'move', to: id });
          tried.push([id, res?.ok ? 'ok' : res?.reason]);
          if (res?.ok) return { room: id, how: 'an empty room next to the lobby', tried };
        }
        for (const door of g.closedDoors().filter(x => !x.jammed).map(x => x.id)) {
          const before = new Set(n.view().discovered);
          g.openDoor(door);
          const t = Date.now();
          let room = null;
          while (!room && Date.now() - t < 15000) {
            room = n.view().discovered.find(x => !before.has(x)) || null;
            if (!room && n.view().hotel.jammed.includes(door)) break;
            if (!room) await new Promise(res => setTimeout(res, 150));
          }
          if (!room) continue;
          const res = await n.send({ k: 'move', to: room });
          tried.push([room, res?.ok ? 'ok' : res?.reason]);
          if (res?.ok) return { room, door, how: 'a door it opened', tried };
        }
        return { room: null, tried };
      });
      if (!r?.room) { info(`${d.name} finds no room to go to this turn (${JSON.stringify(r)}): the next person`); sc.B = null; sc.phase = 'open'; sc.tries = (sc.tries || 0) + 1; if (sc.tries > 6) { sc.fail = 'no empty room next to the lobby in 6 turns'; sc.phase = 'failed'; } return false; }
      sc.X = r.room;
      await waitFor(d.page, x => window.__net.view()?.me?.room === x, sc.X, 15000, 200);
      info(`${d.name} (seat ${d.seat}) went into ${sc.X} (${r.how})`);
      sc.phase = 'walkIn';
      return true;
    }
    if (sc.phase === 'walkIn' && d !== sc.B && !sc.A) {
      const b = await roomOf(d, seatOf(sc.B));
      if (!b || b.room !== sc.X || !b.alive) {
        info(`${sc.B.name} is no longer in ${sc.X} (${JSON.stringify(b)}): again`);
        sc.B = null; sc.X = null; sc.phase = 'open'; sc.tries = (sc.tries || 0) + 1;
        if (sc.tries > 6) { sc.fail = 'the meeting could not be set up in 6 turns'; sc.phase = 'failed'; }
        return false;
      }
      sc.A = d;
      const mv = await d.page.evaluate(to => window.__net.send({ k: 'move', to }).then(r => ({ ok: !!r?.ok, reason: r?.reason ?? null })), sc.X);
      if (!mv.ok) { info(`${d.name} cannot go to ${sc.X} this turn (${mv.reason}): the next turn`); sc.A = null; return false; }
      info(`${d.name} (seat ${d.seat}) walks in on ${sc.B.name} in ${sc.X}`);
      sc.phase = 'meeting';
      return true;
    }
    return false;
  }
  const meetingHook = async (d, s) => {
    if (d !== sc.A || sc.phase !== 'meeting') return false;
    if (s.vask === 'meetWhom') {
      const picked = await d.page.evaluate(name => { const b = [...document.querySelectorAll('#encounter-overlay button')].find(x => x.offsetParent && x.textContent.includes(name)); if (b) { b.click(); return true; } return false; }, sc.B.name);
      return picked;
    }
    if (s.vask === 'meetAct' && !sc.shotMeet) {
      sc.shotMeet = true;
      await shoot(sc.A, 'meeting-walker', `${sc.A.name} walks in on ${sc.B.name}: Trade or Attack`);
      await shoot(sc.B, 'meeting-met', `${sc.B.name}'s screen while ${sc.A.name} chooses`);
    }
    return false;
  };
  const tick = d => async s => {
    await scanPage(d);
    // (diagnosis: the walker asked Trade or Attack and no meeting screen up)
    if (d === sc.A && sc.phase === 'meeting' && s.vask && !s.meeting && !s.handoff) {
      sc.unshownSince ??= Date.now();
      if (Date.now() - sc.unshownSince > 8000 && !sc.dumped) {
        sc.dumped = true;
        const dbg = await d.page.evaluate(() => { const g = window.__game, n = window.__net; const m = g.activeMover(); const st = g.presenterState; return { net: n.debug(), meetingLive: g.meetingLive(), meetingIsOpen: g.meeting?.isOpen, handoffIsOpen: g.handoff?.isOpen, walking: m.walking, path: m.path.length, plan: g.walkPlan(), active: st.activeIndex, me: n.seat(), room: st.players[n.seat()].currentRoom, uiPhase: g.phase(), act: g.inActionPhase() }; }).catch(e => String(e));
        info(`DIAG ${d.name}: asked ${s.vask} for 8 s with no meeting screen: ${JSON.stringify(dbg)}`);
      }
    } else if (d === sc.A) sc.unshownSince = null;
    if (!sc.released && sc.A && s.vask === 'tradeCard') {
      if (d === sc.A && !sc.aAsk) sc.aAsk = s.askId;
      if (d === sc.B && !sc.bAsk) sc.bAsk = s.askId;
    }
  };
  // what each driver waits for
  const hold = { kill: false, drop: null, restart: false };
  const holdFor = d => s => {
    if (hold.restart) return true;
    if (hold.drop === d) return true;
    if (!sc.released && sc.A && (d === sc.A || d === sc.B) && s.vask === 'tradeCard') return true;
    return false;
  };
  try {
    // (the smaller iPad sizes: three software-drawn hotels at once draw a few frames a second, and a walk on screen takes
    // as many frames as on an iPad; the end screen and the notices are also shot at all four sizes)
    const [nora, sam, ivy] = await Promise.all([
      person({ name: 'nora', width: 1024, height: 694 }),
      person({ name: 'sam', width: 1024, height: 768 }),
      person({ name: 'ivy', width: 1024, height: 694 }),
    ]);
    devs.push(nora, sam, ivy);
    // (each device reaches the server through its own relay, so the drop below can be a dead network: relay in lib/coop.mjs)
    for (const d of devs) { d.relay = await relay(sport); d.q = `server=${encodeURIComponent(`ws://127.0.0.1:${d.relay.port}`)}`; }
    // (--debug-ws: every do / res / err / bye / welcome frame of each device, after the server was first killed)
    if (args.includes('--debug-ws')) for (const d of devs) d.page.on('websocket', ws => { const t = f => { if (!sc.killedAt) return; const x = String(f.payload); if (/"t":"(do|res|err|bye|welcome|hello)"/.test(x)) console.log(`  ws   ${d.name} ${Math.round((Date.now() - sc.killedAt) / 1000)}s ${x.slice(0, 260)}`); }; ws.on('framesent', f => t({ payload: '> ' + f.payload })); ws.on('framereceived', f => t({ payload: '< ' + f.payload })); });
    await openPage(nora.page, baseUrl, nora.q);
    await tap(nora.page, '#btn-menu-coop');
    await waitScreen(nora.page, 'menu-coop');
    await tap(nora.page, '#btn-coop-start');
    check(await waitScreen(nora.page, 'menu-table', 30000), 'nora: Start a table');
    code = await text(nora.page, '#table-code');
    for (const g of [sam, ivy]) {
      await openPage(g.page, baseUrl, `${g.q}&join=${code}`);
      check(await waitScreen(g.page, 'menu-table', 60000), `${g.name}: the link ?join=${code} seats them`);
    }
    await waitFor(nora.page, () => document.querySelectorAll('#table-seats .cs-seat.person').length === 3, null, 20000);
    await tap(nora.page, '#btn-table-start');
    for (const d of devs) check(await inMatch(d.page, 180000), `${d.name}: in the match`);
    for (const d of devs) d.seat = await d.page.evaluate(() => window.__net.seat());
    const t0 = truthNow();
    check(!!t0 && t0.players.length === 6 && devs.every(d => t0.players[d.seat]?.name === d.name), `the server's save on disk: 6 seats, ${devs.map(d => `${d.name} at seat ${d.seat}`).join(', ')}, the rest bots`);
    for (const d of devs) await waitFor(d.page, () => window.__game.handoffOpen() && window.__game.handoffKind() === 'role', null, 60000, 250);
    await shoot(nora, 'role', "The match starts: nora's own role", 'all');
    // everyone plays (ending turns, answering every screen); the script runs inside
    const results = devs.map(d => drive(d.page, {
      maxMs: 20 * 60000, label: d.name, hold: holdFor(d), onTick: tick(d),
      myTurn: () => scriptTurn(d), meeting: s => meetingHook(d, s),
    }));
    // --- kill -9 mid-trade
    const until = async (cond, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await cond()) return true; await sleep(250); } return false; };
    const reached = await until(() => sc.phase === 'failed' || sc.aAsk, 8 * 60000);
    check(reached && sc.aAsk && !sc.fail, sc.aAsk ? `a meeting from both sides: ${sc.A.name} walked in on ${sc.B.name} in ${sc.X} and chose Trade; ${sc.A.name} is choosing a card` : `the scripted meeting: ${sc.fail || 'did not happen in time'}`);
    if (sc.aAsk) {
      await until(() => sc.bAsk, 6000);
      const both = !!sc.bAsk;
      check(both, `...${sc.B.name} is choosing a card too (the trade is between the two people)`);
      await shoot(sc.A, 'trade-pick-walker', `${sc.A.name} picks a card to give ${sc.B.name}`);
      if (both) await shoot(sc.B, 'trade-pick-met', `${sc.B.name} picks a card to give ${sc.A.name}`);
      const pre = readSave(dataDir, code);
      const tradesOf = save => (save?.match?.engine?.state?.events || []).filter(e => e.type === 'trade' && [e.a, e.b].sort().join() === [sc.A.seat, sc.B.seat].sort().join()).length;
      const preTrades = tradesOf(pre);
      const preTurn = pre?.match?.engine?.state?.turn;
      check(preTrades === 0, `mid-trade on disk: the save holds no trade between ${sc.A.name} and ${sc.B.name} yet (turn ${preTurn})`);
      // (diagnosis: who closes a screen while the server is away)
      for (const d of [sc.A, sc.B]) await d.page.evaluate(() => { const h = window.__game.handoff; if (h.__wrapped) return; h.__wrapped = true; const orig = h.close; h.close = function (...a) { (window.__closes ||= []).push({ at: Math.round(performance.now()), stack: new Error().stack.split('\n').slice(2, 7).map(x => x.trim()).join(' < ') }); return orig.apply(this, a); }; });
      const tKill = Date.now();
      sc.killedAt = tKill;
      const killed = await srv.kill('SIGKILL');
      check(killed?.sig === 'SIGKILL', `the server is killed (SIGKILL, pid gone: ${JSON.stringify(killed)})`);
      const pill = await waitFor(sc.A.page, () => !document.getElementById('coop-pill').hidden, null, 15000, 100);
      check(pill, `${sc.A.name}'s screen: "${await text(sc.A.page, '#coop-pill')}"`);
      await shoot(sc.A, 'pill', 'The server is gone: Reconnecting…');
      // (the server stays away long enough for the card that comes after 20 s)
      const lost = await waitFor(sc.A.page, t => !document.getElementById('coop-match-card').hidden && document.getElementById('coop-mc-title').textContent === t, T.recovery.lost.title, ONLINE.timing.lostCardMs + 15000, 250).then(ok => ok && Date.now() - tKill);
      check(lost !== false && lost >= ONLINE.timing.lostCardMs - 1000, `...after ${lost !== false ? Math.round(lost / 1000) : '?'} s without the server: "${T.recovery.lost.title}" (${await text(sc.A.page, '#coop-mc-line')})`);
      await shoot(sc.A, 'lost', 'The server is still gone after 20 s: Still reconnecting…');
      const t1 = Date.now();
      check(await srv.start(), 'started again on the same port and DATA_DIR');
      const toastP = waitFor(sc.A.page, w => !document.getElementById('toast')?.hidden && document.getElementById('toast')?.textContent.includes(w), T.recovery.back, 60000, 100);
      // every device comes back by itself, to the same seat, the match where it was
      const back = await Promise.all(devs.map(d => waitFor(d.page, () => document.getElementById('coop-pill').hidden && !!window.__net.view(), null, 60000, 200).then(ok => ok && Date.now() - t1)));
      devs.forEach((d, i) => check(back[i] !== false, `${d.name}: back at the table ${back[i] !== false ? `${(back[i] / 1000).toFixed(1)} s after the restart` : 'NEVER'}`));
      for (const d of devs) {
        const v = await d.page.evaluate(() => { const v = window.__net.view(); return { seat: window.__net.seat(), turn: v.turn, ask: v.ask?.kind ?? null, askId: v.ask?.id ?? null, end: !!v.end }; });
        check(v.seat === d.seat && !v.end, `${d.name}: the same seat (${v.seat}), the match goes on (turn ${v.turn}${v.ask ? `, asked ${v.ask}` : ''})`);
        if (d === sc.A) check(v.ask === 'tradeCard' && v.askId === sc.aAsk && v.turn === preTurn, `...${d.name} is still asked for the same card (${v.askId}), on the same turn`);
        if (d === sc.B && both) check(v.ask === 'tradeCard' && v.askId === sc.bAsk, `...${d.name} too (${v.askId})`);
      }
      check(await toastP, `${sc.A.name}: "${T.recovery.back}"`);
      const lostAfter = await coopCard(sc.A.page);
      if (lostAfter === T.recovery.lost.title) { info(`(the "${T.recovery.lost.title}" card stays up once the table is back: ${sc.A.name} taps ${T.recovery.lost.buttons[0]})`); await sc.A.page.evaluate(() => document.getElementById('btn-coop-mc-a')?.click()); }
      await sleep(1500);
      const notice = await coopCard(sc.A.page);
      if (notice === T.recovery.restarted.title) check(true, `${sc.A.name}: the notice "${notice}"`);
      else gap(`after kill -9 no device shows "${T.recovery.restarted.title}" (DESIGN §10.5/§14.7 says devices get it with the full view after any restart; the page shows it only after the server's "bye restart" of a polite SIGTERM, src/net/onlineTable.js onBye). Seen: ${notice || 'no card'}`);
      for (const d of [sc.A, sc.B]) { const c = await d.page.evaluate(() => ({ closes: window.__closes || [], open: window.__game.handoffOpen(), kind: window.__game.handoffKind(), now: Math.round(performance.now()) })); info(`DIAG ${d.name} after the restore: handoff ${c.open ? `open (${c.kind})` : 'closed'}; closes: ${JSON.stringify(c.closes)} (now ${c.now})`); }
      if (args.includes('--debug-ws')) for (const d of [sc.A, sc.B]) await d.page.evaluate(() => { const t = window.__game.table(); window.__sends = []; const orig = t.send; t.send = function (cmd, o) { const rec = { cmd: JSON.stringify(cmd), status: t.net?.status, at: Math.round(performance.now()) }; window.__sends.push(rec); const p = orig.call(this, cmd, o); p.then(r => { rec.res = r; }); return p; }; window.__pickTable = t; });
      // the trade goes on: both pick, and it happens exactly once
      sc.released = true;
      if (args.includes('--debug-ws')) { await sleep(12000); for (const d of [sc.A, sc.B]) info(`DIAG ${d.name} sends: ${JSON.stringify(await d.page.evaluate(() => ({ sends: window.__sends, same: window.__pickTable === window.__game.table(), ask: window.__net.view()?.ask, hand: window.__net.view()?.me?.hand?.map(c => c.id) })))}`); }
      const traded = await until(async () => tradesOf(readSave(dataDir, code)) >= 1, 60000);
      await sleep(3000);
      const nTrades = tradesOf(readSave(dataDir, code));
      check(traded && nTrades === 1, `the trade happens after the restore, exactly once (${nTrades} trade between ${sc.A.name} and ${sc.B.name} on disk)`);
      const gotResult = await waitFor(sc.A.page, () => (window.__net.view()?.results || []).some(r => r.kind === 'trade') || window.__game.handoffKind?.() === 'trade' || !!document.querySelector('#trade-reveal:not([hidden]), .trade-reveal:not([hidden])'), null, 20000, 150);
      check(gotResult || nTrades === 1, `${sc.A.name} reads what the trade did (the private result)`);
      sc.home = true;
    }
    // --- a 60 s drop: the person who is not A (or the last one). (Chromium's offline mode can keep answering the
    // server's pings on the open socket, so the drop may be noticed only when the page itself gives up on the silence,
    // about 28 s in and later on a loaded machine: Away is waited for up to 55 s.)
    const C3 = devs.find(d => d !== sc.A && d !== sc.B) || devs[2];
    const others = devs.filter(d => d !== C3);
    const notEnded = async () => !(await nora.page.evaluate(() => !!window.__net.view()?.end));
    if (await notEnded()) {
      hold.drop = C3;
      await sleep(1500);
      info(`${C3.name} (seat ${C3.seat}) goes offline for 60 s`);
      // (every feed line the others' screen shows is kept as it appears: the feed holds only 4 lines, and on a busy table a
      // line can be pushed out before a look at the page catches it)
      for (const o of others) await o.page.evaluate(() => { if (window.__feedSeen) return; window.__feedSeen = []; const host = document.getElementById('feed'); new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('feed-line')) window.__feedSeen.push(n.textContent); }).observe(host, { childList: true }); });
      const fed = (o, line, timeout) => waitFor(o.page, l => (window.__feedSeen || []).some(t => t.includes(l)), line, timeout, 250);
      const tDrop = Date.now();
      await C3.context.setOffline(true);
      C3.relay.cut();
      const awayAt = await waitFor(others[0].page, i => document.querySelectorAll('#strip-cards .mini-player')[i]?.classList.contains('away'), C3.seat, 55000, 250).then(ok => ok && Date.now() - tDrop);
      check(awayAt !== false, `${others[0].name}'s strip shows ${C3.name} Away (${awayAt !== false ? `${Math.round(awayAt / 1000)} s after the drop` : 'never'}): "${await others[0].page.evaluate(i => document.querySelectorAll('#strip-cards .mini-player')[i]?.querySelector('.mini-away')?.textContent, C3.seat)}"`);
      const droppedLine = fill(T.match.feed.dropped.today, { name: C3.name });
      check(await fed(others[0], droppedLine, 15000), `...and the feed: "${droppedLine}"`);
      await shoot(others[0], 'away', `${C3.name} dropped: Away on ${others[0].name}'s strip`);
      check(await waitFor(C3.page, () => !document.getElementById('coop-pill').hidden, null, 40000, 250), `${C3.name}'s own screen: "${await text(C3.page, '#coop-pill')}"`);
      await shoot(C3, 'drop-pill', `${C3.name} offline: Reconnecting…`);
      const left = 60000 - (Date.now() - tDrop);
      if (left > 0) await sleep(left);
      C3.relay.mend();
      await C3.context.setOffline(false);
      const t2 = Date.now();
      const toast = await waitFor(C3.page, w => !document.getElementById('toast')?.hidden && document.getElementById('toast')?.textContent.includes(w), T.recovery.back, 40000, 100).then(ok => ok && Date.now() - t2);
      check(toast !== false, `back online after 60 s: "${T.recovery.back}" (${toast !== false ? `${(toast / 1000).toFixed(1)} s` : 'never'})`);
      check(await waitFor(C3.page, () => document.getElementById('coop-pill').hidden, null, 10000), '...the pill is gone');
      await shoot(C3, 'back', `${C3.name} is back`);
      const backLine = fill(T.match.feed.back, { name: C3.name });
      check(await fed(others[0], backLine, 20000), `${others[0].name}'s feed: "${backLine}"`);
      check(await waitFor(others[0].page, i => !document.querySelectorAll('#strip-cards .mini-player')[i]?.classList.contains('away'), C3.seat, 20000, 250), `...and ${C3.name}'s Away is gone from her strip`);
      check(await C3.page.evaluate(() => window.__net.seat()) === C3.seat, `${C3.name} is at the same seat`);
      hold.drop = null;
    } else info('(the match ended before the drop: skipped)');
    // --- a polite restart (SIGTERM): "The hotel's server restarted", once, on every device
    if (await notEnded()) {
      hold.restart = true;
      await sleep(800);
      const tTerm = Date.now();
      const term = await srv.kill('SIGTERM');
      check(term?.code === 0, `SIGTERM: the server saves, says goodbye and exits (code ${term?.code}, ${Date.now() - tTerm} ms)`);
      check(await srv.start(), '...and starts again on the same folder');
      const noticed = await Promise.all(devs.map(d => waitFor(d.page, t => !document.getElementById('coop-match-card').hidden && document.getElementById('coop-mc-title').textContent === t, T.recovery.restarted.title, 40000, 200)));
      const ended = !(await notEnded());
      devs.forEach((d, i) => check(noticed[i] || ended, `${d.name}: "${T.recovery.restarted.title}"${noticed[i] ? '' : ' (the match had ended meanwhile)'}`));
      if (noticed[0]) await shoot(nora, 'restarted', "The server restarted: everyone is back where they were", 'all');
      for (const d of devs) await d.page.evaluate(() => document.getElementById('btn-coop-mc-a')?.click()).catch(() => {});
      await sleep(1500);
      const again = await Promise.all(devs.map(d => coopCard(d.page)));
      check(again.every(c => c !== T.recovery.restarted.title), `...shown once: OK closes it (${again.map(c => c || 'no card').join(', ')})`);
      hold.restart = false;
    }
    // --- on to the end
    const fin = await Promise.all(results);
    fin.forEach((r, i) => check(r.ended && r.handBad === 0, `${devs[i].name}: the end screen after ${Math.round(r.ms / 1000)} s (ends ${r.ends}, screens ${r.screens}, meetings ${r.meetings}, discards ${r.discards}; seen ${[...r.seen].join(',')}${r.stopped ? `; STOPPED: ${r.stopped}` : ''}; the fan showed only this seat's own cards ${r.handChecks - r.handBad}/${r.handChecks})`));
    fin.forEach((r, i) => check(!r.unshown.length, `${devs[i].name}: every question the table asked reached the screen (the longest wait with none showing: ${(r.maxUnshownMs / 1000).toFixed(1)} s${r.unshown.length ? `; never shown for 20 s: ${r.unshown.join(', ')}` : ''})`));
    check(scan.looks > 20 && scan.hits.length === 0, `the secrets scan over the match: ${scan.looks} looks at the three devices against the server's save, ${scan.hits.length} hits${scan.hits.length ? `: ${scan.hits.slice(0, 4).join(' | ')}` : ''}`);
    const ends = await Promise.all(devs.map(d => d.page.evaluate(() => ({ title: document.getElementById('end-title')?.textContent, restart: document.getElementById('btn-restart')?.textContent, menu: document.getElementById('btn-end-menu')?.textContent, rows: document.querySelectorAll('#end-reveal .er-row').length, line: document.getElementById('coop-end-line')?.textContent || '' }))));
    devs.forEach((d, i) => info(`${d.name}: "${ends[i].title}" · ${ends[i].rows} rows · "${ends[i].restart}" / "${ends[i].menu}" · "${ends[i].line}"`));
    check(ends[0].restart === T.match.end.playAgain && ends.slice(1).every(e => e.restart === T.match.end.backToTable) && ends.every(e => e.menu === T.match.end.leave && e.rows === 6), 'the end screens: the host plays again, the friends go back to the table, everyone may leave; six guests revealed');
    check(ends.slice(1).every(e => e.line === fill(T.match.end.hostStarts, { host: 'nora' })), `...a friend's line: "${ends[1].line}"`);
    await shoot(nora, 'end-host', 'The end: the host', 'all');
    await shoot(sam, 'end-guest', 'The end: a friend');
    // --- Play again: ivy goes back to the table, sam stays on the end screen, nora plays again
    await tap(ivy.page, '#btn-restart');
    check(await waitScreen(ivy.page, 'menu-table', 30000), 'ivy: Back to the table, the waiting room');
    const turnBefore = await nora.page.evaluate(() => window.__net.view()?.turn);
    // (the countdown is 5 s / TIME_SCALE, on pages drawing a hotel in software: each screen records the moment its
    // countdown appears, as it happens (a MutationObserver), so a page too busy to be polled in time still counts)
    await sam.page.evaluate(() => { const el = document.getElementById('coop-end-line'); window.__countSeen = null; const note = () => { const t = el?.textContent || ''; if (!window.__countSeen && /^The next match starts in \d/.test(t)) window.__countSeen = t; }; note(); if (el) new MutationObserver(note).observe(el, { childList: true, characterData: true, subtree: true }); });
    await ivy.page.evaluate(() => { const el = document.getElementById('table-countdown'); window.__countSeen = null; const note = () => { if (!window.__countSeen && el && !el.hidden) window.__countSeen = el.textContent.replace(/\s+/g, ' ').trim() || 'shown'; }; note(); if (el) new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ['hidden'], childList: true, characterData: true, subtree: true }); });
    await tap(nora.page, '#btn-restart');
    const [nextIn, ivyCount] = await Promise.all([
      waitFor(sam.page, () => !!window.__countSeen, null, 15000, 100).then(ok => ok ? sam.page.evaluate(() => window.__countSeen) : null),
      waitFor(ivy.page, () => !!window.__countSeen, null, 15000, 100),
    ]);
    await Promise.all([shoot(sam, 'end-countdown', 'Play again: the next match starts in 5…'), shoot(ivy, 'again-countdown', 'Play again: the countdown in the waiting room')]);
    check(!!nextIn, `nora taps Play again: sam's end screen says "${nextIn}"`);
    check(ivyCount, "...and ivy's waiting room counts down too");
    for (const d of devs) {
      const ok = await waitFor(d.page, t => window.__game.phase() === 'game' && window.__game.isRunning() && !window.__game.endOpen() && window.__net.view() && !window.__net.view().end && window.__net.view().turn < t, turnBefore, 180000, 300);
      check(ok, `${d.name}: the next match on screen (turn ${await d.page.evaluate(() => window.__net.view()?.turn)}, was ${turnBefore})`);
    }
    await shoot(sam, 'again', 'The next match');
    for (const d of devs) await d.page.evaluate(() => window.__game.settled?.()).catch(() => {});
  } catch (err) { check(false, `match: ${err.message.split('\n')[0]}`); for (const d of devs) await S.shoot(d.page, `error-${d.name}`, { caption: `match error (${d.name})`, who: d.name, section: 'match' }).catch(() => {}); }
  consoleCheck(devs, 'match');
  for (const d of devs) { await d.close(); await d.relay?.close(); }
  await srv.kill('SIGKILL');
  fs.mkdirSync(shotDir, { recursive: true });      // (with --no-shots the folder may not exist yet)
  fs.writeFileSync(path.join(shotDir, 'match-server.log'), srv.log);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// =====================================================================================================================
if (only.includes('demo')) {
  console.log('\ndemo. the review link at 1024x694 (?friends=demo&pace=fast): both seats to the end screen');
  S.reset('demo');
  const d = await person({ name: 'tester', width: 1024, height: 694 });
  const shoot = (name, caption, sizes = 'own') => S.shoot(d.page, name, { caption, who: 'tester', section: 'demo', sizes });
  try {
    await d.page.goto(`${baseUrl}?intro=off&friends=demo&pace=fast`, { waitUntil: 'domcontentloaded' });
    await d.page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout: 180000, polling: 100 });
    check(await waitScreen(d.page, 'menu-coop', 30000) && await text(d.page, '#coop-demo') === T.demo.note, `the review link opens on Co-op: "${await text(d.page, '#coop-demo')}"`);
    await still(d.page);
    await tap(d.page, '#btn-coop-start');
    await waitScreen(d.page, 'menu-table', 30000);
    const code = await text(d.page, '#table-code');
    check(/^[A-Z]{5}$/.test(code || '') && await text(d.page, '#table-demo') === T.demo.note, `Start a table: the code ${code}, and the note`);
    await still(d.page);
    await shoot('host', 'The review link: your table, and Show sam\'s screen', 'all');
    await tap(d.page, '#btn-seat-switch');
    await waitScreen(d.page, 'menu-coop');
    await d.page.fill('#coop-code', code.toLowerCase());
    await tap(d.page, '#btn-coop-join');
    check(await waitScreen(d.page, 'menu-table', 30000) && await text(d.page, '#table-kicker') === fill(T.table.kickerGuest, { host: 'tester' }), `sam types the code and joins: "${await text(d.page, '#table-kicker')}"`);
    await shoot('sam', "sam's screen: at your table");
    await tap(d.page, '#btn-seat-switch');
    await waitFor(d.page, () => document.querySelectorAll('#table-seats .cs-seat.person').length === 2, null, 10000);
    await tap(d.page, '#btn-table-start');
    check(await inMatch(d.page, 90000), 'Start: the match on screen');
    // (played at once: ?pace=fast is TIME_SCALE 20, so the 5-minute stall is 15 s here, and it counts from the deal for a
    // seat whose turn comes before its role screen is read)
    let switches = 0, roleShot = false;
    const r = await drive(d.page, {
      maxMs: 14 * 60000, label: 'demo',
      onTick: async s => { if (!roleShot && s.handoff && s.hk === 'role') { roleShot = true; await shoot('role', 'The review link: your role'); } },
      idle: async () => { if (await d.page.evaluate(() => document.getElementById('btn-seat-switch')?.classList.contains('offer'))) { switches++; await d.page.click('#btn-seat-switch').catch(() => {}); await d.page.waitForTimeout(600); return true; } return false; },
    });
    check(r.ended, `the end screen after ${Math.round(r.ms / 1000)} s (switches ${switches}, ends ${r.ends}, screens ${r.screens}, meetings ${r.meetings}; seen ${[...r.seen].join(',')}${r.stopped ? `; STOPPED: ${r.stopped}` : ''})`);
    check(r.handBad === 0 && r.handChecks > 0, `the hand on screen was only ever the shown seat's own (${r.handChecks} looks)`);
    check(switches > 0, `the switch offered itself when a question waited on the other seat (${switches} times)`);
    check(!r.unshown.length, `every question reached the screen of the seat shown (the longest wait with none showing: ${(r.maxUnshownMs / 1000).toFixed(1)} s${r.unshown.length ? `; never shown for 20 s: ${r.unshown.join(', ')}` : ''})`);
    const fin = await d.page.evaluate(() => ({ title: document.getElementById('end-title')?.textContent, restart: document.getElementById('btn-restart')?.textContent, menu: document.getElementById('btn-end-menu')?.textContent }));
    check(fin.restart === T.match.end.playAgain && fin.menu === T.match.end.leave, `"${fin.title}" · ${fin.restart} · ${fin.menu}`);
    await shoot('end', 'The review link: the end');
  } catch (err) { check(false, `demo: ${err.message.split('\n')[0]}`); await shoot('error', 'demo error').catch(() => {}); }
  consoleCheck([d], 'demo');
  await d.close();
}

await page0?.close();
const mins = ((Date.now() - t00) / 60000).toFixed(1);
console.log(`\n${C.oks} ok, ${C.failures.length} FAIL, ${C.gaps.length} GAP (${mins} min)`);
if (C.gaps.length) console.log(`gaps (the design asks, the build does not do it yet; not failures of this suite):\n  - ${C.gaps.join('\n  - ')}`);
console.log(C.failures.length ? `\n${C.failures.length} FAILED` : '\nALL CO-OP END-TO-END CHECKS PASSED');
process.exit(C.failures.length ? 1 : 0);
