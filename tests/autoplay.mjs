// Automatic playtester for HOT-SEAT mode (dev only, not part of the game).
//
// Plays full 4-6 guest matches through the real game in headless Chromium, the way people would:
// tapping door rings and Confirm to open doors and move, the in-room search icon, cards in the hand
// fan and the card view, Trade / Attack in meetings, private card picks, pass-the-device screens,
// hand-limit discards at the end of a turn, room jobs and Escape. `window.__game` is used to READ
// state (to check the rules and to let the bots choose sensibly); a hook is used to ACT only when a
// tap is impractical or failed, and every such fallback is logged.
//
// After every step it checks invariants (action points, health, hand limit, privacy of the shared
// screen, who holds the device, soft-locks, figures on walkable floor, the round limit, card
// conservation, console errors) and a few layout checks, and records each problem with the seed,
// player count, round, turn, the last actions, a screenshot and a state excerpt.
//
// Setup once:  npm --prefix tests install
// Run:         node tests/autoplay.mjs --url http://127.0.0.1:8125/ [--matches 100] [--first 0]
//              [--seed-base 7000] [--seed 1234 --players 5 --profile smart]  (one match)
// Personalities (tools/balance/personalities.mjs — the same decision rules the fast simulator uses):
//              --personalities rusher,slow,safe,aggressive,killer,team --seed 1234   (one match, one per seat)
//              --persona-study [--first 0 --matches 30]   the planned study: 18 six-player, 6 five-player and
//              6 four-player matches, seats rotated and seeds chosen so each personality starts possessed
//              (results: tests/personality-results.jsonl unless --results is given)
// Output:      tests/autoplay-results.jsonl (one line per match), tests/shots/autoplay/*.jpg
//
// Speed: headless software WebGL draws only a few frames a second on this machine, and the game's
// logic runs in its animation loop. So between screenshots the harness skips the 3D draw call itself
// (the camera matrices are still updated, so taps land where they would); every `--render-every`
// frames, and for every screenshot, real frames are drawn.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import * as PERS from '../tools/balance/personalities.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = name => args.includes(`--${name}`);
const baseUrl = opt('url', 'http://127.0.0.1:8125/');
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots/autoplay');
fs.mkdirSync(outDir, { recursive: true });
const PERSONA_STUDY = flag('persona-study');
const PERSONA_LIST = opt('personalities', null)?.split(',').map(x => x.trim());
const PERSONA_MODE = PERSONA_STUDY || !!PERSONA_LIST;
if (PERSONA_LIST) for (const x of PERSONA_LIST) if (!PERS.PERSONALITIES.includes(x)) throw new Error(`unknown personality ${x}`);
const resultsFile = opt('results', path.join(here, PERSONA_MODE ? 'personality-results.jsonl' : 'autoplay-results.jsonl'));
const MATCHES = +opt('matches', 100);
const FIRST = +opt('first', 0);
const SEED_BASE = +opt('seed-base', 7000);
const RENDER_EVERY = +opt('render-every', 400);
const MATCH_MS = +opt('match-ms', 15 * 60 * 1000);
const SPEED = +opt('speed', 36);
const verbose = flag('verbose');
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

// ---------------------------------------------------------------------------------------------
// Match schedule: player count, seed, bot profile and input device vary by match.
const PROFILES = ['smart', 'mixed', 'smart', 'chaos', 'mixed', 'smart', 'mixed', 'smart'];
// Which seat the game makes possessed for a seed (the same pure rules code the page runs).
let _engine = null;
async function possessedSeatFor(seed, players) {
  if (!_engine) {
    const [{ applyMode }, S, { hotel }, { config }, { roster }, { createHotel }] = await Promise.all([
      import('../src/data/rules.js'), import('../src/game/state.js'), import('../src/data/hotel.js'),
      import('../src/config.js'), import('../src/data/characters.js'), import('../src/game/hotel.js')]);
    _engine = { applyMode, S, roster, floor: createHotel(hotel, config) };
  }
  _engine.applyMode('hotseat', players);
  const st = _engine.S.createState(_engine.floor, _engine.roster.slice(0, players), seed, { mode: 'hotseat' });
  return st.players.findIndex(p => p.possessed);
}
// The personality study: match k has 6 players (k < 18), 5 (k < 24) or 4; the personality that starts
// possessed rotates through all six (each is possessed 3 times at six players and twice at 4-5);
// smaller tables draw their other personalities without replacement, rotating with k; the seats are
// rotated every match.
async function personaSchedule(k) {
  const P6 = PERS.PERSONALITIES;
  const players = k < 18 ? 6 : k < 24 ? 5 : 4;
  const target = P6[k % 6];
  const rest = P6.filter(x => x !== target);
  const rot = (a, r) => a.map((_, i) => a[(i + r) % a.length]);
  const others = rot(rest, k % rest.length).slice(0, players - 1);
  const seed = 9100 + k * 131;
  const seat = await possessedSeatFor(seed, players);
  const order = rot(others, Math.floor(k / 6) % others.length);
  const personas = [];
  for (let i = 0; i < players; i++) personas.push(i === seat ? target : order.shift());
  return { k, seed, players, profile: 'persona', personas, touch: k % 2 === 1, restartCheck: false };
}
async function scheduleAsync(k) {
  if (PERSONA_STUDY) return personaSchedule(k);
  if (PERSONA_LIST) {
    return { k, seed: +opt('seed', 9100 + k * 131), players: PERSONA_LIST.length, profile: 'persona', personas: [...PERSONA_LIST], touch: flag('touch'), restartCheck: false };
  }
  return schedule(k);
}
function schedule(k) {
  if (opt('seed', null)) {
    return { k, seed: +opt('seed'), players: +opt('players', 6), profile: opt('profile', 'smart'), touch: flag('touch'), restartCheck: false };
  }
  return {
    k,
    players: [4, 5, 6][k % 3],
    seed: SEED_BASE + k * 97,
    profile: PROFILES[Math.floor(k / 3) % PROFILES.length],
    touch: k % 2 === 1,
    restartCheck: k % 10 === 9,
  };
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------------------------------------
function findChrome() {
  const c = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const p of c) if (fs.existsSync(p)) return p;
  throw new Error('chromium not found: set CHROME_PATH');
}

let browser = null, context = null, page = null;
let cur = null;                       // the match being played
const consoleSink = [];

async function openBrowser() {
  if (browser) await browser.close().catch(() => {});
  browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
  page = await context.newPage();
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleSink.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => consoleSink.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => consoleSink.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400 && !/favicon/.test(r.url())) consoleSink.push(`http ${r.status()}: ${r.url()}`); });
  await page.route(`${CDN}**`, route => {
    const rel = route.request().url().slice(CDN.length).split('?')[0];
    const file = path.join(threeDir, rel);
    route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const frames = (n = 2) => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

// ---------------------------------------------------------------------------------------------
// One read of everything the harness looks at. Runs in the page.
function SNAP() {
  const g = window.__game, s = g.state, d = document;
  const vis = el => {
    if (!el || el.hidden) return false;
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  };
  const byId = id => d.getElementById(id);
  const txt = id => (byId(id)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const tiles = sel => [...d.querySelectorAll(sel)].filter(vis).map(e => e.dataset.cardId);
  const buttons = sel => [...d.querySelectorAll(sel)].filter(vis).map(b => ({ text: b.textContent.replace(/\s+/g, ' ').trim(), disabled: b.disabled }));
  const types = {};
  const cardType = c => { types[c.id] = c.type; return c; };
  const players = s.players.map(p => ({
    i: p.index, id: p.id, name: p.name, room: p.currentRoom, ap: p.actionPoints, health: p.health, alive: p.alive,
    possessed: p.possessed, hand: p.hand.map(c => cardType(c)).map(c => ({ id: c.id, type: c.type, shots: c.shots })),
    knows: [...p.knows], escaped: s.escaped.has(p.id), roleChangePending: !!p.roleChangePending,
  }));
  let drops = 0;
  for (const [, cards] of s.roomDrops) { drops += cards.length; cards.forEach(cardType); }
  const movers = g.movers.map((m, i) => {
    const c = g.grid.cellAt(m.x, m.z);
    return { x: +m.x.toFixed(2), z: +m.z.toFixed(2), walking: m.walking, path: m.path.length, cellOk: c >= 0 && !!g.grid.walkable[c], cellRoom: c >= 0 ? g.grid.roomIdOf(c) : null };
  });
  const rooms = g.floor.roomList.map(r => ({
    id: r.id, name: r.name, center: r.center, dark: r.dark, searchable: r.searchable, job: r.job, isExit: r.isExit, safe: r.safe,
    locked: s.lockedRooms.has(r.id), searched: s.searchedRooms.has(r.id), drops: (s.roomDrops.get(r.id) || []).length,
    doors: r.doorways.map(dw => ({ id: dw.id, to: dw.a === r.id ? dw.b : dw.a, center: dw.center, axis: dw.axis, barricaded: s.barricades.has(dw.id) })),
    frontier: (r.frontier || []).map(f => ({ id: f.id, jammed: !!f.jammed, center: f.center, axis: f.axis })),
  }));
  const ss = g.searchSpot();
  const spotEl = byId('search-spot');
  const endBtn = byId('btn-end-turn');
  let endReach = null;
  if (vis(endBtn)) {
    const r = endBtn.getBoundingClientRect();
    const hit = d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    endReach = !!hit && (hit === endBtn || endBtn.contains(hit)) ? 'ok' : (hit ? (hit.id || hit.className || hit.tagName) : 'none');
  }
  const overlays = ['handoff-overlay', 'encounter-overlay', 'notice-overlay', 'discard-overlay', 'hand-overlay', 'map-overlay', 'end-overlay', 'start-overlay', 'error-overlay']
    .filter(id => vis(byId(id)));
  const strip = [...d.querySelectorAll('#players-strip .mini-where')].map(e => e.textContent);
  return {
    t: performance.now(),
    names: s.players.map(p => p.name),
    round: s.round, turn: s.turn, active: s.activeIndex, finished: s.finished, won: s.won, dawn: s.dawn,
    players, types, drops, draw: s.drawPile.length, discardN: s.discardPile.length,
    locks: [...s.encounterLocks],
    lanternPiles: {
      draw: s.drawPile.filter(c => c.type === 'lantern').length, discard: s.discardPile.filter(c => c.type === 'lantern').length,
      floor: [...s.roomDrops.values()].reduce((n, cs) => n + cs.filter(c => c.type === 'lantern').length, 0),
    },
    exitRoom: g.floor.exitRoom, rooms, movers,
    inAction: g.inActionPhase(), walking: g.activeMover().walking || g.activeMover().path.length > 0, searchPending: g.searchPending(),
    overlays,
    handoff: {
      open: g.handoffOpen(), kind: g.handoffKind(), title: txt('handoff-title'), kicker: txt('handoff-kicker'), sub: txt('handoff-sub'),
      text: vis(byId('handoff-overlay')) ? byId('handoff-card').innerText : '',
      role: vis(byId('handoff-role')), roleText: txt('handoff-role'), hand: vis(byId('handoff-hand')), found: vis(byId('handoff-found')),
      handTiles: [...d.querySelectorAll('#handoff-hand .card-tile')].length,
      offer: vis(byId('handoff-offer')), offerCards: tiles('#offer-cards .card-tile'), intents: buttons('#offer-intent .btn'),
      offerClipped: [...d.querySelectorAll('#offer-cards .card-tile')].filter(vis).filter(t => { const r = t.getBoundingClientRect(); const h = d.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !h || !(h === t || t.contains(h)); }).map(t => t.dataset.cardId),
      next: vis(byId('btn-handoff-next')), nextText: txt('btn-handoff-next'), notes: txt('handoff-notes'),
    },
    meeting: { open: g.meetingOpen(), title: txt('encounter-title'), body: txt('encounter-body'), actions: buttons('#encounter-actions .btn'), cards: tiles('#encounter-body .card-tile') },
    notice: { open: g.noticeOpen(), title: txt('notice-title'), body: txt('notice-body') },
    discard: { open: vis(byId('discard-overlay')), sub: txt('discard-sub'), cards: tiles('#discard-cards .card-tile'), doneDisabled: byId('btn-discard-done').disabled },
    cardView: { open: g.cardViewOpen(), id: g.cardViewId(), buttons: buttons('#hand-detail .btn'), text: txt('hand-detail') },
    map: g.isMapOpen(),
    confirm: { open: vis(byId('confirm-bar')), text: txt('confirm-text') },
    toast: vis(byId('toast')) ? txt('toast') : '',
    end: { open: vis(byId('end-overlay')), title: txt('end-title'), summary: txt('end-summary') },
    start: vis(byId('start-overlay')), error: vis(byId('error-overlay')) ? txt('error-message') : null,
    fan: { visible: vis(byId('hand-fan')), cards: [...d.querySelectorAll('#hand-fan .fan-card')].map(e => ({ id: e.dataset.cardId, type: e.dataset.type })) },
    spot: { mode: ss.mode, visible: vis(spotEl), rect: vis(spotEl) ? rect(spotEl) : null },
    roomBtn: { visible: vis(byId('btn-room')), disabled: byId('btn-room').disabled, text: txt('btn-room') },
    tradeBtn: vis(byId('btn-trade')),
    endBtn: { visible: vis(endBtn), disabled: endBtn.disabled, text: txt('btn-end-turn'), reach: endReach },
    timerVisible: vis(byId('turn-timer')),
    hudVisible: vis(byId('hud')),
    hudText: vis(byId('hud')) ? byId('hud').innerText : '',
    // The possessed guest's own reminder on the main screen (approved: during their own action phase only).
    tell: { on: !!g.cfg.ui.hotseatPossessedOnMainScreen, label: vis(byId('panel-role')), souls: vis(byId('panel-souls')),
      labelText: vis(byId('panel-role')) ? byId('panel-role').innerText : '', soulsText: vis(byId('panel-souls')) ? byId('panel-souls').innerText : '',
      tint: vis(byId('possess-tint')), portrait: !!byId('player-panel')?.classList.contains('possessed') },
    roundText: txt('round'), roomName: txt('room-name'), strip,
    log: g.publicLog().slice(-3),
  };
}

// Layout / legibility checks (UX), run once per turn and on each new kind of screen.
function LAYOUT() {
  const d = document, out = [];
  const vis = el => {
    if (!el || el.hidden || !el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05;
  };
  const name = el => el.id ? `#${el.id}` : `${el.tagName.toLowerCase()}.${String(el.className).trim().split(/\s+/).join('.')}`;
  const W = innerWidth, H = innerHeight;
  const R = el => el.getBoundingClientRect();
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  // Text cut off: a box whose text is wider than the box, and which clips it.
  const scope = [...d.querySelectorAll('#hud *, .overlay:not([hidden]) *')];
  for (const el of scope) {
    if (!vis(el) || el.closest('#hand-fan') || el.tagName === 'svg' || el.closest('svg') || el.tagName === 'IMG') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'inline' || el.clientWidth < 4) continue;
    const text = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    if (!text) continue;
    const clips = cs.overflow !== 'visible' || cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
    if (clips && (el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 3) && !['auto', 'scroll'].includes(cs.overflowY)) {
      out.push({ k: 'cut', el: name(el), text: text.slice(0, 70), detail: `${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight}` });
    }
    const r = R(el);
    if (r.width > 0 && (r.right > W + 1 || r.left < -1 || r.top < -1 || r.bottom > H + 1)) {
      out.push({ k: 'offscreen', el: name(el), text: text.slice(0, 70), detail: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)} (viewport ${W}x${H})` });
    }
  }
  // Panels that do not fit the screen and cannot scroll.
  for (const el of d.querySelectorAll('.overlay:not([hidden]) .modal, .overlay:not([hidden]) .card, .overlay:not([hidden]) .cv-panel, .overlay:not([hidden]) .map-panel')) {
    if (!vis(el)) continue;
    const r = R(el), cs = getComputedStyle(el);
    const scrolls = ['auto', 'scroll'].includes(cs.overflowY) || ['auto', 'scroll'].includes(getComputedStyle(el.parentElement).overflowY);
    if ((r.bottom > H + 1 || r.top < -1) && !scrolls) out.push({ k: 'panel-overflow', el: name(el), text: (el.innerText || '').trim().slice(0, 60), detail: `top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} of ${H}` });
    if (el.scrollHeight > el.clientHeight + 4 && ['hidden', 'clip'].includes(cs.overflowY)) out.push({ k: 'panel-clipped', el: name(el), text: (el.innerText || '').trim().slice(0, 60), detail: `${el.scrollHeight} in ${el.clientHeight}` });
  }
  // Overlapping controls on the shared screen.
  const hud = d.getElementById('hud');
  if (vis(hud) && !d.querySelector('.overlay:not([hidden]):not(#hand-overlay)')) {
    const ctrls = [...d.querySelectorAll('#hud button, #hud .mini-player, #round, #room-name, #toast, #confirm-bar, #player-panel')].filter(vis).filter(el => !el.closest('#hand-fan')).filter(el => !el.closest('#confirm-bar') || el.id === 'confirm-bar');
    const fanCards = [...d.querySelectorAll('#hand-fan .fan-card')].filter(vis);
    const spot = d.getElementById('search-spot');
    const list = [...ctrls.filter(e => !e.classList.contains('fan-card') && e.id !== 'search-spot'), ...(vis(spot) ? [spot] : [])];
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = R(a), rb = R(b);
      const ov = inter(ra, rb);
      if (ov > 60) out.push({ k: 'overlap', el: `${name(a)} / ${name(b)}`, text: '', detail: `${Math.round(ov)} px²` });
    }
    // The fan's cards at rest must not sit over the panel or the buttons.
    for (const c of fanCards) {
      const rc = R(c);
      for (const b of ctrls) {
        if (b.closest('.hud-top-center') || b.id === 'toast' || b.id === 'round' || b.id === 'room-name') continue;
        const ov = inter(rc, R(b));
        if (ov > 80) out.push({ k: 'overlap', el: `fan-card[${c.dataset.type}] / ${name(b)}`, text: '', detail: `${Math.round(ov)} px²` });
      }
      if (vis(spot)) { const ov = inter(rc, R(spot)); if (ov > 40) out.push({ k: 'overlap', el: `fan-card / #search-spot`, text: '', detail: `${Math.round(ov)} px²` }); }
    }
    // Small tap targets (Apple asks for about 44 pt).
    for (const b of d.querySelectorAll('#hud button')) {
      if (!vis(b) || b.closest('#hand-fan')) continue;
      const r = R(b);
      if (Math.min(r.width, r.height) < 34) out.push({ k: 'small-target', el: name(b), text: b.innerText.trim().slice(0, 30), detail: `${Math.round(r.width)}x${Math.round(r.height)}` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Recording.
const slug = s => s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48).toLowerCase();
function excerpt(s) {
  if (!s) return null;
  return {
    round: s.round, turn: s.turn, active: s.names[s.active], finished: s.finished, won: s.won,
    players: s.players.map(p => `${p.name}${p.possessed ? '*' : ''} ${p.alive ? `${p.room} ap${p.ap} hp${p.health}` : 'dead'} [${p.hand.map(c => c.type).join(',')}]`),
    overlays: s.overlays, handoff: s.handoff.open ? `${s.handoff.kind}: ${s.handoff.title}` : null,
    meeting: s.meeting.open ? `${s.meeting.title} | ${s.meeting.body.slice(0, 100)}` : null, toast: s.toast,
  };
}
async function shot(label, { force = false } = {}) {
  if (!cur) return null;
  if (!force && cur.shots.length >= 14) return null;
  const file = `m${String(cur.k).padStart(3, '0')}-s${cur.seed}-p${cur.players}-r${cur.lastSnap?.round ?? 0}t${cur.lastSnap?.turn ?? 0}-${slug(label)}.jpg`;
  const t0s = Date.now();
  try {
    // Draw real frames for the picture.
    await page.evaluate(() => { window.__ap.force = 3; });
    await page.waitForFunction(r => window.__ap.rendered >= r + 2, await page.evaluate(() => window.__ap.rendered), { timeout: 15000, polling: 50 }).catch(() => {});
    await page.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 70 });
    cur.profShots += Date.now() - t0s;
    cur.shots.push(file);
    return `tests/shots/autoplay/${file}`;
  } catch (e) { return null; }
}
async function violation(sev, key, msg, s = cur.lastSnap, extra = {}) {
  const k = `${key}`;
  const seen = cur.seen.get(k);
  if (seen) { seen.count++; return; }
  const rec = { sev, key: k, msg, count: 1, round: s?.round, turn: s?.turn, active: s ? s.names[s.active] : null, lastActions: cur.actions.slice(-10), state: excerpt(s), ...extra };
  cur.seen.set(k, rec);
  cur.violations.push(rec);
  console.log(`   !! [${sev}] ${key}: ${msg}`);
  rec.shot = await shot(`V-${key}`, { force: cur.violations.length <= 8 });
}
async function ux(key, msg, s = cur.lastSnap, extra = {}) {
  const seen = cur.uxSeen.get(key);
  if (verbose) console.log(`   ux ${key}: ${msg}`);
  if (seen) { seen.count++; return; }
  const rec = { key, msg, count: 1, round: s?.round, turn: s?.turn, active: s ? s.names[s.active] : null, lastActions: cur.actions.slice(-6), ...extra };
  cur.uxSeen.set(key, rec);
  cur.ux.push(rec);
  if (verbose) console.log(`   ux ${key}: ${msg}`);
  if (cur.ux.length <= 6) rec.shot = await shot(`UX-${key}`);
}
function act(text) {
  const s = cur.lastSnap;
  cur.actions.push(`r${s?.round}t${s?.turn} ${s ? s.names[s.active] : ''}: ${text}`);
  if (cur.actions.length > 60) cur.actions.shift();
  if (verbose) console.log('     ', cur.actions.at(-1));
}
function fallback(what, why) {
  cur.fallbacks.push(`${what} (${why})`);
  act(`FALLBACK ${what} — ${why}`);
}

// ---------------------------------------------------------------------------------------------
// Tapping like a person.
async function tapSel(sel, what = sel) {
  try {
    if (cur.touch) await page.tap(sel, { timeout: 3000 }); else await page.click(sel, { timeout: 3000 });
    return true;
  } catch (e) {
    const exists = await page.$(sel);
    if (!exists) { await violation('medium', `missing-${slug(what)}`, `Expected control ${what} (${sel}) is not on the page`); return false; }
    const why = String(e.message).split('\n').filter(l => /intercepts|not stable|not visible|outside|detached|disabled/.test(l)).slice(-2).join(' / ').trim();
    await ux(`tap-failed-${slug(what)}`, `Tapping ${what} did not work as a tap: ${String(e.message).split('\n')[0].slice(0, 120)} ${why.slice(0, 200)}`);
    fallback(`DOM click ${what}`, 'tap was not accepted');
    await page.$eval(sel, el => el.click()).catch(() => {});
    return false;
  }
}
// Tap an element that other elements partly cover (the overlapping fan cards): find a point on it
// that is really on top, as a finger would.
async function tapVisiblePart(sel, what) {
  if (sel === '#search-spot') await settleCamera();
  const pt = await page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    for (const fy of [0.3, 0.2, 0.45, 0.6]) for (const fx of [0.2, 0.12, 0.35, 0.5, 0.65, 0.8]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === el || el.contains(hit))) return { x, y };
    }
    return { none: true };
  }, sel);
  if (!pt) return false;
  if (pt.none) {
    await ux(`untappable-${slug(what)}`, `No visible, uncovered point to tap on ${what}`);
    fallback(`DOM click ${what}`, 'no uncovered point');
    await page.$eval(sel, el => el.click()).catch(() => {});
    return false;
  }
  if (cur.touch) await page.touchscreen.tap(pt.x, pt.y); else await page.mouse.click(pt.x, pt.y);
  return true;
}
// Tap a spot on the floor (a door ring): must be on screen and not under the interface.
// Wait until the camera has stopped gliding after the guest (a person taps what they see).
async function settleCamera() {
  let last = null;
  for (let k = 0; k < 40; k++) {
    const c = await page.evaluate(() => { const p = window.__game.view.camera.position; return [p.x, p.y, p.z]; });
    if (last && Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]) < 0.002) return;
    last = c;
    await frames(2);
  }
}
async function tapGround(x, z, what) {
  await settleCamera();
  for (let attempt = 0; attempt < 4; attempt++) {
    const sp = await page.evaluate(([x, z]) => {
      window.__ev.length = 0;
      const p = window.__game.groundToScreen(x, z);
      const onScreen = p.x >= 2 && p.y >= 2 && p.x < innerWidth - 2 && p.y < innerHeight - 2;
      const hit = onScreen ? document.elementFromPoint(p.x, p.y) : null;
      const blocker = hit && hit.tagName !== 'CANVAS' ? (hit.id ? `#${hit.id}` : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`) : null;
      return { ...p, onScreen, blocker };
    }, [x, z]);
    if (sp.onScreen && !sp.blocker) {
      if (cur.touch) await page.touchscreen.tap(sp.x, sp.y); else await page.mouse.click(sp.x, sp.y);
      return { ok: true, rotated: attempt };
    }
    await ux(`ring-hidden-${sp.onScreen ? 'covered' : 'offscreen'}${sp.blocker ? '-' + slug(sp.blocker) : ''}`,
      `The ring of ${what} is ${sp.onScreen ? `under ${sp.blocker}` : 'off screen'}; a player has to rotate the view to reach it`);
    await tapSel('#btn-rotate-left', 'rotate view');
    await frames(12);
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------------------------
// Bot knowledge helpers (node side, from a snapshot).
const VALUE = { barricade: 1, handMirror: 2, lockPick: 2, espresso: 3, bandage: 4, masterKey: 4, knife: 5, flashlight: 6, revolver: 7, lantern: 10, possession: 0 };
const lanternsOf = p => p.hand.filter(c => c.type === 'lantern').length;
const countable = p => p.hand.filter(c => c.type !== 'possession').length;
const roomById = (s, id) => s.rooms.find(r => r.id === id);
const worst = (cards, exclude = []) => [...cards].filter(c => !exclude.includes(c.type)).sort((a, b) => VALUE[a.type] - VALUE[b.type])[0];

function seatStyle(i) {
  if (cur.personas) return 'persona';
  if (cur.profile === 'chaos') return 'random';
  if (cur.profile === 'mixed') return (i + cur.seed) % 3 === 0 ? 'random' : 'smart';
  return 'smart';
}
// Who the clean bots pool Lanterns on. Most matches the table "talks" and trusts the right guest;
// in some the carrier is simply the lowest seat not known to be possessed (so a possessed guest can
// collect them).
function carrierOf(s, viewer) {
  const trustsTable = (cur.seed % 10) < 7;
  const cands = s.players.filter(p => p.alive && !p.escaped && !(viewer?.knows || []).includes(p.id) && (trustsTable ? !p.possessed : true));
  if (!cands.length) return null;
  return [...cands].sort((a, b) => lanternsOf(b) - lanternsOf(a) || a.i - b.i)[0];
}
// Breadth-first route over open, passable doorways. Returns [firstDoor, distance] toward the nearest
// room satisfying `goal`.
function route(s, from, goal) {
  const prev = new Map([[from, null]]);
  const q = [from];
  while (q.length) {
    const id = q.shift();
    if (id !== from && goal(roomById(s, id))) {
      let at = id, dist = 0; const steps = [];
      while (prev.get(at)) { steps.unshift(prev.get(at)); at = prev.get(at).from; dist++; }
      return { door: steps[0].door, to: steps[0].to, dist, dest: id };
    }
    const r = roomById(s, id);
    for (const d of r.doors) {
      if (d.barricaded) continue;
      const other = roomById(s, d.to);
      if (!other || other.locked || r.locked) continue;
      if (prev.has(d.to)) continue;
      prev.set(d.to, { from: id, door: d, to: d.to });
      q.push(d.to);
    }
  }
  return null;
}
const ringPoint = (room, center, axis, inset = 0.15 + 0.62) => {
  const along = axis === 'x';
  const sx = along ? 0 : Math.sign(room.center[0] - center[0]) || 1;
  const sz = along ? Math.sign(room.center[1] - center[1]) || 1 : 0;
  return [center[0] + sx * inset, center[1] + sz * inset];
};

// ---------------------------------------------------------------------------------------------
// Invariants, checked after every step.
async function checkInvariants(s) {
  const me = s.players[s.active];
  // Console errors / failed requests.
  while (consoleSink.length) {
    const m = consoleSink.shift();
    if (/favicon/i.test(m)) continue;
    cur.console.push(m);
    await violation(/pageerror|error/.test(m) ? 'high' : 'low', `console-${slug(m.replace(/https?:\S+/g, 'URL').replace(/\d+/g, 'N')).slice(0, 40)}`, `Console: ${m.slice(0, 300)}`, s);
  }
  if (s.error) await violation('critical', 'error-overlay', `The error screen is showing: ${s.error}`, s);
  // Action points.
  for (const p of s.players) {
    if (p.ap < 0) await violation('high', 'ap-negative', `${p.name} has ${p.ap} action points`, s);
  }
  if (!s.finished && me) {
    const allow = 4 + 2 * (cur.turnEspresso || 0);
    if (me.ap > allow) await violation('high', 'ap-too-many', `${me.name} has ${me.ap} action points (allowed ${allow}; ${cur.turnEspresso || 0} Espresso this turn)`, s);
  }
  // Health.
  for (const p of s.players) {
    if (p.health < 0 || p.health > 3) await violation('high', 'health-range', `${p.name} health ${p.health}`, s);
    if (p.alive !== (p.health > 0)) await violation('high', 'health-alive-mismatch', `${p.name} alive=${p.alive} with health ${p.health}`, s);
    if (!p.alive && p.hand.length) await violation('medium', 'dead-holds-cards', `${p.name} is dead but holds ${p.hand.map(c => c.type).join(',')}`, s);
  }
  if (!s.finished && me && !me.alive) await violation('critical', 'dead-active', `Dead guest ${me.name} is the active guest`, s);
  // Hand limit, at the moment a turn passes.
  if (cur.prevTurn != null && s.turn !== cur.prevTurn && cur.prevSnap) {
    const prev = s.players[cur.prevSnap.active];
    if (prev && countable(prev) > 6) await violation('high', 'hand-limit', `${prev.name} ended a turn holding ${countable(prev)} ordinary cards (limit 6)`, s);
    const expectedNext = (() => { const n = s.players.length; for (let k = 1; k <= n; k++) { const q = cur.prevSnap.players[(cur.prevSnap.active + k) % n]; if (q.alive) return q.i; } return -1; })();
    if (!s.finished && s.active !== expectedNext && s.turn === cur.prevTurn + 1) await violation('high', 'turn-order', `Turn went from ${cur.prevSnap.names[cur.prevSnap.active]} to ${s.names[s.active]}, expected ${s.names[expectedNext]}`, s);
    cur.turnEspresso = 0;
    cur.turnStartChecked = false;
    cur.turns++;
  }
  if (s.inAction && !cur.turnStartChecked && !s.handoff.open && me) {
    cur.turnStartChecked = true;
    if (me.ap !== 4 && !cur.turnEspresso) await violation('high', 'ap-turn-start', `${me.name} starts the action phase with ${me.ap} action points (expected 4)`, s);
  }
  // Round limit.
  if (!s.finished && s.round > 8) await violation('critical', 'past-dawn', `Round ${s.round} is running; the match should have ended at dawn`, s);
  // Card conservation: every ordinary card is in the deck, the discard pile, a hand or on a floor.
  const ordinary = s.draw + s.discardN + s.drops + s.players.reduce((n, p) => n + countable(p), 0);
  // (Found cards go straight into the hand — the hand limit is settled at the end of the turn.)
  const limbo = s.handoff.open && s.handoff.kind === 'found';
  if (cur.cardTotal == null) cur.cardTotal = ordinary;
  else if (ordinary !== cur.cardTotal && !limbo) await violation('critical', 'cards-not-conserved', `Ordinary cards total ${ordinary}, was ${cur.cardTotal} (deck ${s.draw}, discard ${s.discardN}, floor ${s.drops})`, s);
  const poss = s.players.reduce((n, p) => n + p.hand.filter(c => c.type === 'possession').length, 0);
  if (poss > 3 || (cur.possTotal != null && poss > cur.possTotal)) await violation('critical', 'possession-count', `Possession cards in play went from ${cur.possTotal} to ${poss}`, s);
  cur.possTotal = poss;
  // Possessed count never goes down; a possessed guest holding none of the 3 supply can still exist.
  const possessedNow = s.players.filter(p => p.possessed).length;
  if (cur.possessedCount != null && possessedNow < cur.possessedCount) await violation('critical', 'unpossessed', `A guest stopped being possessed (${cur.possessedCount} -> ${possessedNow})`, s);
  if (cur.possessedCount != null && possessedNow > cur.possessedCount) cur.stats.conversions += possessedNow - cur.possessedCount;
  cur.possessedCount = possessedNow;
  // Timer off.
  if (s.timerVisible) await violation('low', 'timer-visible', 'The turn clock shows although ?timer=off', s);

  // --- Privacy on the shared screen (hot-seat) -------------------------------------------------
  // The approved main-screen reminder (docs/GAME_RULES.md > Possession): a POSSESSED label, "Souls to
  // trade" and the Possession cards as ONE ×N fan card, only while the possessed guest's own action phase
  // runs — never on a pass, private, meeting, public notice (the Switchboard) or end screen, never for a
  // clean guest, never a portrait or tint, and never before the guest has been told in private that they
  // were converted.
  const tellAllowed = s.tell.on && !!me?.possessed && s.inAction && !s.finished && !s.handoff.open && !s.meeting.open && !s.end.open
    && !s.notice.open && !me?.roleChangePending;
  const fanSouls = s.fan.cards.filter(c => c.type === 'possession').length;
  if (fanSouls && !tellAllowed) await violation('critical', 'fan-shows-possession', 'A Possession card is on the always-on hand fan outside the possessed guest\'s own action phase', s);
  if (fanSouls > 1) await violation('high', 'fan-possession-not-stacked', `${fanSouls} Possession cards on the fan (should be one ×N card)`, s);
  if ((s.tell.label || s.tell.souls) && !tellAllowed) await violation('critical', 'tell-out-of-turn', `The POSSESSED label / souls count is on the main screen for ${me?.name} (possessed ${me?.possessed}, in action ${s.inAction}, ${s.overlays.join(', ') || 'no screen'})`, s);
  if (s.tell.tint || s.tell.portrait) await violation('critical', 'tell-portrait-or-tint', 'The possessed portrait or violet tint is on the hot-seat main screen', s);
  if (s.fan.visible && (s.handoff.open || s.meeting.open || s.end.open || s.notice.open || s.discard.open)) {
    await violation('high', `fan-over-${s.overlays.filter(o => o !== 'hand-overlay')[0] || 'screen'}`, `The hand fan is visible over ${s.overlays.join(', ')}`, s);
  }
  if (s.spot.visible && (s.handoff.open || s.meeting.open || s.end.open || s.notice.open)) await violation('medium', 'spot-over-screen', `Search icon visible over ${s.overlays.join(', ')}`, s);
  if (s.fan.visible && me && !s.finished) {
    const want = me.hand.filter(c => c.type !== 'possession').map(c => c.id).sort().join();
    const got = s.fan.cards.filter(c => c.type !== 'possession').map(c => c.id).sort().join();
    const wantSouls = tellAllowed && me.hand.some(c => c.type === 'possession') ? 1 : 0;
    if (fanSouls !== wantSouls && tellAllowed) await violation('medium', 'fan-souls-mismatch', `Fan shows ${fanSouls} Possession card(s); ${me.name} holds ${me.hand.filter(c => c.type === 'possession').length}`, s);
    if (want !== got) await violation('medium', 'fan-mismatch', `Fan shows [${s.fan.cards.map(c => c.type)}] but ${me.name} holds [${me.hand.map(c => c.type)}]`, s);
    if (cur.holder && cur.holder !== me.name) await violation('critical', 'fan-wrong-holder', `${me.name}'s hand fan is on screen while the device was last handed to ${cur.holder}`, s);
  }
  if (s.handoff.open && s.handoff.kind === 'pass') {
    if (s.handoff.role || s.handoff.hand || s.handoff.found || s.handoff.offer) await violation('critical', 'pass-screen-private', `The pass-the-device screen shows private content (role ${s.handoff.role}, hand ${s.handoff.hand}, found ${s.handoff.found}, offer ${s.handoff.offer})`, s);
    if (/POSSESS|CLEAN GUEST|Lantern|Possession/i.test(s.handoff.text)) await violation('critical', 'pass-screen-words', `The pass screen text gives something away: "${s.handoff.text.slice(0, 200)}"`, s);
  }
  // Only the end screen, the Switchboard's public count and the rules text may say "possessed" publicly.
  // (The possessed guest's own reminder is allowed during their own action phase: its words are left out here.)
  const hudPublic = tellAllowed ? s.hudText.replace(s.tell.labelText, '').replace(s.tell.soulsText, '') : s.hudText;
  const publicText = [hudPublic, s.meeting.open ? `${s.meeting.title} ${s.meeting.body}` : ''].join(' ');
  if (!s.finished && /possess/i.test(publicText)) await violation('critical', 'public-possessed-word', `The shared screen mentions possession: "${publicText.match(/.{0,60}possess.{0,60}/i)?.[0]}"`, s);
  if (s.meeting.open && /Trade complete/.test(s.meeting.title) && /Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key|Hand Mirror|Espresso/.test(s.meeting.body)) await violation('critical', 'trade-result-public', `The public trade result names a card: "${s.meeting.body}"`, s);
  if (/searched/.test(s.toast) && /Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key|Hand Mirror|Espresso|find/.test(s.toast)) await violation('critical', 'search-toast-leak', `Search toast leaks the result: "${s.toast}"`, s);
  // Strip: public card count and hearts.
  if (s.inAction && !s.overlays.length && !s.walking) s.players.forEach((p, i) => {
    const t = s.strip[i] || '';
    if (p.alive && !p.escaped && !t.includes(`${countable(p)} cards`)) cur.pendingUx.push([`strip-count`, `Strip for ${p.name} says "${t}" but they hold ${countable(p)} ordinary cards`]);
  });
  // Who holds the device when a private screen is up.
  if (s.handoff.open && s.handoff.kind !== 'pass') {
    const owner = ownerOf(s);
    if (!owner) await violation('medium', `private-no-owner-${s.handoff.kind}`, `Cannot tell whose private ${s.handoff.kind} screen this is: "${s.handoff.kicker}" / "${s.handoff.title}"`, s);
    else if (cur.holder && owner !== cur.holder) await violation('critical', `private-wrong-holder-${s.handoff.kind}`, `${owner}'s private ${s.handoff.kind} screen is shown while the device was handed to ${cur.holder}`, s);
    if (s.handoff.kind === 'role' || s.handoff.kind === 'turn') {
      const p = s.players.find(q => q.name === owner);
      if (p && /POSSESSED/.test(s.handoff.roleText) !== p.possessed) await violation('critical', 'role-screen-wrong', `${p.name}'s role screen says "${s.handoff.roleText.slice(0, 40)}" but possessed=${p.possessed}`, s);
      // (The Possession cards are one tile with a ×N badge.)
      const tilesWanted = p ? countable(p) + (p.hand.some(c => c.type === 'possession') ? 1 : 0) : 0;
      if (p && s.handoff.kind === 'turn' && s.handoff.handTiles !== Math.max(1, tilesWanted) && !(p.hand.length === 0)) await violation('medium', 'turn-screen-hand', `${p.name}'s private turn screen shows ${s.handoff.handTiles} tiles; they hold ${p.hand.length} cards (${tilesWanted} tiles with the Possession cards as one)`, s);
    }
  }
  // Two screens at once.
  const stacked = s.overlays.filter(o => !['start-overlay'].includes(o));
  if (stacked.length > 1) await ux(`stacked-${stacked.join('+')}`, `Two screens are up at once: ${stacked.join(' + ')}`, s);
  // Figures on walkable floor, in the room the rules say they are in.
  for (const p of s.players) {
    if (!p.alive || p.escaped) continue;
    const m = s.movers[p.i];
    if (m.walking || m.path) continue;
    if (!m.cellOk) await violation('high', 'figure-off-floor', `${p.name}'s figure stands on non-walkable space at (${m.x}, ${m.z}) in ${p.room}`, s);
    else if (m.cellRoom !== p.room) await violation('high', 'figure-wrong-room', `${p.name}'s figure is in ${m.cellRoom} but the rules put them in ${p.room}`, s);
  }
  if (s.inAction && !s.overlays.length && s.endBtn.visible && s.endBtn.reach !== 'ok') await ux(`end-turn-covered-${slug(String(s.endBtn.reach))}`, `The End turn button is covered by ${s.endBtn.reach}`, s);
  if (s.inAction && !s.endBtn.visible && !s.handoff.open && !s.meeting.open && !s.finished) await violation('high', 'no-end-turn', 'In the action phase with no End turn button', s);
  for (const [k, m] of cur.pendingUx.splice(0)) await ux(k, m, s);
}

function ownerOf(s) {
  const { kind, title, kicker } = s.handoff;
  for (const n of s.names) {
    if (kind === 'role' && (title === n || title.startsWith(`${n},`))) return n;
    if (kind === 'turn' && title === `${n}'s turn`) return n;
    if (kind === 'note' && title === `For ${n} only`) return n;
    if (['pick', 'choice', 'found', 'mirror'].includes(kind) && kicker.includes(`— ${n} only`)) return n;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Screens.
async function onHandoff(s) {
  const h = s.handoff;
  const kindSeen = `handoff-${h.kind}`;
  if (!cur.layoutSeen.has(kindSeen)) { cur.layoutSeen.add(kindSeen); await layoutCheck(s, kindSeen); if (cur.sampleShots && ['pick', 'found', 'mirror', 'turn', 'note', 'choice'].includes(h.kind)) await shot(`screen-${h.kind}`); }
  if (h.kind === 'pass') {
    const m = h.title.match(/Pass the device to (.+)$/);
    act(`pass screen → ${m?.[1]} (${h.kicker})`);
    if (!(await tapSel('#btn-handoff-next', 'Continue (pass)'))) { /* fell back */ }
    cur.holder = m?.[1] || null;
    return;
  }
  if (h.kind === 'pick') {
    const owner = ownerOf(s);
    const picker = s.players.find(p => p.name === owner);
    const other = s.players.find(p => p.name !== owner && h.title.includes(p.name));
    if (!h.offerCards.length) {
      await violation('critical', 'trade-pick-empty-softlock', `${owner} must pick a card to give ${other?.name} but has none they may give ("${h.text.replace(/\s+/g, ' ').slice(0, 160)}") — no button, the match cannot continue`, s);
      cur.abort = 'trade pick with no cards';
      return;
    }
    const cards = h.offerCards.map(id => ({ id, type: s.types[id] }));
    if (h.offerClipped.length) await violation('medium', 'trade-pick-cards-clipped', `${owner}'s trade pick shows ${cards.length} cards in one row; ${h.offerClipped.length} (${h.offerClipped.map(id => s.types[id]).join(', ')}) are cut off at the panel edge and cannot be tapped at their centre`, s);
    const c = pickTradeCard(s, picker, other, cards);
    act(`private pick: ${owner} gives ${c.type} to ${other?.name}`);
    cur.lastTrade = { a: owner, b: other?.name };
    await tapVisiblePart(`#offer-cards .card-tile[data-card-id="${c.id}"]`, `trade card ${c.type}`);
    return;
  }
  if (h.kind === 'choice') {
    const owner = ownerOf(s);
    const yes = rng() < (seatStyle(s.players.find(p => p.name === owner)?.i ?? 0) === 'random' ? 0.5 : 0.75);
    act(`private choice: ${owner} ${yes ? 'accepts' : 'declines'}`);
    const labels = h.intents.map(b => b.text);
    const want = labels.find(t => (yes ? /Accept/ : /Decline/).test(t)) || labels[0];
    const idx = labels.indexOf(want);
    await tapSel(`#offer-intent .btn:nth-child(${idx + 1})`, `choice ${want}`);
    return;
  }
  if (h.kind === 'note' && /POSSESSED/.test(h.notes) && /now POSSESSED/.test(h.notes)) cur.stats.convertNotes++;
  if (h.kind === 'note' && /burned away/.test(h.notes)) {
    cur.stats.blocks++;
    const owner = ownerOf(s);
    const who = s.players.find(p => p.name === owner);
    if (cur.seats && who && /Your Lantern burned away/.test(h.notes)) { cur.seats[who.i].blocks++; cur.blocks.push({ by: owner, round: s.round }); }
  }
  if (h.kind === 'found') cur.stats.searchesRevealed++;
  if (h.kind === 'turn') cur.holderTurn = ownerOf(s);
  if (!h.next) {
    await violation('critical', `handoff-${h.kind}-no-button`, `The ${h.kind} screen has no button to continue`, s);
    cur.abort = `${h.kind} screen without button`;
    return;
  }
  act(`${h.kind} screen (${ownerOf(s)}): ${h.nextText}`);
  await tapSel('#btn-handoff-next', `Continue (${h.kind})`);
}

function pickTradeCard(s, picker, other, cards) {
  const style = seatStyle(picker.i);
  if (style === 'persona') {
    const id = PERS.decideTradeCard(fullFromSnap(s), picker.i, other.i, cards.map(c => c.id), cur.mem, rng);
    const c = cards.find(x => x.id === id) || cards[0];
    const seat = cur.seats[picker.i];
    seat.trades++;
    if (c.type === 'possession') { seat.attempts++; cur.attempts.push({ by: picker.name, to: other.name, round: s.round }); }
    return c;
  }
  if (style === 'random') return cards[Math.floor(rng() * cards.length)];
  const poss = cards.find(c => c.type === 'possession');
  if (picker.possessed) {
    if (poss && other && !other.possessed && rng() < 0.85) return poss;
    return worst(cards, ['possession']) || cards[0];
  }
  const lantern = cards.find(c => c.type === 'lantern');
  const carrier = carrierOf(s, picker);
  if (lantern && other && (picker.knows || []).includes(other.id)) return lantern;           // block a known possessed guest
  if (lantern && carrier && other && carrier.id === other.id && lanternsOf(picker) <= lanternsOf(other)) return lantern;  // pool on the carrier
  if (lantern && rng() < 0.25) return lantern;                                                  // "just in case"
  return worst(cards, ['lantern']) || worst(cards) || cards[0];
}

async function onMeeting(s) {
  const m = s.meeting;
  if (!cur.layoutSeen.has('meeting')) { cur.layoutSeen.add('meeting'); await layoutCheck(s, 'meeting'); if (cur.sampleShots) await shot('screen-meeting'); }
  const me = s.players[s.active];
  const style = seatStyle(me.i);
  // Choose a weapon.
  if (m.cards.length) {
    const target = cur.attackTarget && s.players.find(p => p.name === cur.attackTarget);
    const ws = m.cards.map(id => ({ id, type: s.types[id] }));
    const rev = ws.find(w => w.type === 'revolver');
    const planned = style === 'persona' && cur.plannedWeapon ? ws.find(x => x.id === cur.plannedWeapon) : null;
    const w = planned || (style === 'random' ? ws[Math.floor(rng() * ws.length)] : (rev && target && target.health <= 2 ? rev : ws.find(x => x.type === 'knife') || ws[0]));
    act(`attack with ${w.type}`);
    cur.pendingAttack = { target: target?.name, before: target?.health, weapon: w.type, attacker: me.name };
    await tapSel(`#encounter-body .card-tile[data-card-id="${w.id}"]`, 'weapon');
    return;
  }
  const labels = m.actions.map(a => a.text);
  const has = t => m.actions.find(a => a.text.startsWith(t) && !a.disabled);
  const click = async text => {
    const idx = m.actions.findIndex(a => a.text.startsWith(text));
    await tapSel(`#encounter-actions .btn:nth-child(${idx + 1})`, `meeting ${text}`);
  };
  if (has('Trade') || /Attack/.test(labels.join())) {
    const q = s.players.find(p => p.name !== me.name && m.title.includes(p.name));
    cur.stats.meetings++;
    let attack = false;
    if (has('Attack')) {
      if (style === 'persona') {
        cur.plannedWeapon = q ? PERS.decideAttack(fullFromSnap(s), me.i, q.i, cur.mem, rng) : null;
        attack = !!cur.plannedWeapon;
        if (attack) { cur.seats[me.i].attacks++; PERS.observe(cur.mem, { type: 'attack', by: me.id, target: q.id }); }
      } else if (style === 'random') attack = rng() < 0.4;
      else if (me.possessed) attack = q && !q.possessed && (rng() < 0.45 || q.health <= 1);
      else attack = q && me.knows.includes(q.id) ? true : rng() < 0.04;
    }
    cur.attackTarget = q?.name;
    act(`meeting ${me.name} meets ${q?.name}: ${attack ? 'ATTACK' : 'TRADE'}`);
    if (attack) { cur.stats.attacks++; await click('Attack'); } else { cur.stats.trades++; await click('Trade'); }
    return;
  }
  if (/not alone|may trade/.test(m.title)) {
    // Choose whom to meet.
    const cands = m.actions.filter(a => a.text !== 'Cancel');
    let pickIdx = Math.floor(rng() * cands.length);
    if (style === 'persona') {
      const idx = cands.map(a => s.players.find(p => p.name === a.text)?.i).filter(x => x != null);
      const j = PERS.decideMeetWhom(fullFromSnap(s), me.i, idx, cur.mem, rng);
      const k = cands.findIndex(a => a.text === s.players[j].name);
      if (k >= 0) pickIdx = k;
    } else if (style === 'smart' && me.possessed) {
      const k = cands.findIndex(a => s.players.some(p => p.name === a.text && !p.possessed));
      if (k >= 0) pickIdx = k;
    }
    act(`choose whom to meet: ${cands[pickIdx].text}`);
    await tapSel(`#encounter-actions .btn:nth-child(${m.actions.indexOf(cands[pickIdx]) + 1})`, 'meet whom');
    return;
  }
  if (has('Continue')) {
    if (cur.pendingAttack) {
      const pa = cur.pendingAttack; cur.pendingAttack = null;
      const t = s.players.find(p => p.name === pa.target);
      const dmg = pa.weapon === 'revolver' ? 2 : 1;
      if (t && pa.before != null && t.health !== Math.max(0, pa.before - dmg)) await violation('high', 'attack-damage', `${pa.attacker} hit ${pa.target} with a ${pa.weapon}: health ${pa.before} -> ${t.health}`, s);
      if (t && !t.alive) {
        cur.stats.deaths++;
        if (cur.seats) {
          const a = s.players.find(p => p.name === pa.attacker);
          cur.seats[a.i].kills++; cur.seats[t.i].killedBy = a.name;
          cur.kills.push({ by: a.name, byPersona: cur.personas[a.i], byPossessed: a.possessed, victim: t.name, victimPersona: cur.personas[t.i], victimPossessed: t.possessed, weapon: pa.weapon, round: s.round });
        }
        if (cur.sampleShots) await shot('attack-death');
      }
    }
    act(`meeting: Continue (${m.title})`);
    await click('Continue');
    return;
  }
  await violation('high', 'meeting-no-choice', `Meeting panel with no usable button: ${labels.join(' | ')}`, s);
  cur.abort = 'meeting without buttons';
}

async function onDiscard(s) {
  if (!cur.layoutSeen.has('discard')) { cur.layoutSeen.add('discard'); await layoutCheck(s, 'discard'); if (cur.sampleShots) await shot('screen-discard'); }
  const me = s.players[s.active];
  cur.stats.discards++;
  if (s.discard.cards.some(id => s.types[id] === 'possession')) await violation('critical', 'discard-shows-possession', 'The discard prompt offers a Possession card', s);
  if (!s.discard.doneDisabled) { act('discard: Keep these'); await tapSel('#btn-discard-done', 'Keep these 6'); return; }
  const cards = s.discard.cards.map(id => ({ id, type: s.types[id] }));
  const c = seatStyle(me.i) === 'persona' ? (cards.find(x => x.id === PERS.decideDiscard(fullFromSnap(s), me.i, cards.map(y => y.id))) || cards[0])
    : seatStyle(me.i) === 'random' ? cards[Math.floor(rng() * cards.length)] : worst(cards, ['lantern']) || worst(cards);
  act(`discard ${c.type}`);
  // Two steps since the playtest fix round: tap the card to pick it, then confirm with the button.
  await tapSel(`#discard-cards .card-tile[data-card-id="${c.id}"]`, 'discard card');
  await tapSel('#btn-discard-done', 'Discard (confirm)');
}

async function layoutCheck(s, where) {
  let issues;
  try { issues = await page.evaluate(LAYOUT); } catch { return; }
  for (const i of issues) {
    const key = `${i.k}-${slug(i.el)}`;
    await ux(key, `${i.k} (${where}): ${i.el}${i.text ? ` "${i.text}"` : ''} — ${i.detail}`, s);
  }
}

// ---------------------------------------------------------------------------------------------
// The active guest's action phase: choose one thing to do and do it through the interface.
async function takeAction(s) {
  const me = s.players[s.active];
  const style = seatStyle(me.i);
  const room = roomById(s, me.room);
  const tk = `${s.turn}`;
  if (cur.failTurn !== tk) { cur.failTurn = tk; cur.fails = new Set(); cur.turnActions = 0; }
  cur.turnActions++;
  if (!cur.layoutSeen.has(`turn-${s.turn}`)) {
    cur.layoutSeen.add(`turn-${s.turn}`);
    if (s.turn % 3 === 1) await layoutCheck(s, 'action phase');
    if (cur.sampleShots && [1, 4, 8].includes(s.round) && !cur.layoutSeen.has(`round-shot-${s.round}`)) { cur.layoutSeen.add(`round-shot-${s.round}`); await shot(`round${s.round}-action`); }
  }
  if (cur.turnActions > 25) { act('end turn (action budget)'); return endTurn(s); }
  const options = style === 'persona' ? personaOptions(s, me, room) : style === 'random' ? randomOptions(s, me, room) : smartOptions(s, me, room);
  for (const o of options) {
    if (cur.fails.has(o.key)) continue;
    const ok = await o.run();
    if (ok === false) { cur.fails.add(o.key); continue; }
    return;
  }
  return endTurn(s);
}

async function endTurn(s) {
  const me = s.players[s.active];
  act(`End turn (${me.ap} AP left, ${countable(me)} cards)`);
  const before = s.turn;
  await tapSel('#btn-end-turn', 'End turn');
  await frames(3);
  const after = await page.evaluate(() => ({ turn: window.__game.state.turn, disc: document.getElementById('discard-overlay').hidden === false, fin: window.__game.state.finished }));
  if (after.turn === before && !after.disc && !after.fin) {
    await sleep(300);
    const again = await page.evaluate(() => window.__game.state.turn);
    if (again === before) {
      await ux('end-turn-no-effect', 'Tapping End turn did nothing', s);
      fallback('__game.endTurn()', 'End turn tap had no effect');
      await page.evaluate(() => window.__game.endTurn());
    }
  }
}

function hasCard(me, type) { return me.hand.find(c => c.type === type); }

// --- personalities (tools/balance/personalities.mjs) -------------------------------------------------
// The common view the personality rules read, from a snapshot (the module masks what a guest may not know).
function fullFromSnap(s) {
  return {
    round: s.round, turn: s.turn, exitRoom: s.exitRoom, lobby: s.rooms[0].id, locks: s.locks,
    players: s.players.map(p => ({ ...p, persona: cur.personas[p.i] })),
    rooms: s.rooms.map(r => ({
      id: r.id, name: r.name, isExit: r.isExit, safe: r.safe, dark: r.dark, searchable: r.searchable, searched: r.searched,
      locked: r.locked, job: r.job, drops: r.drops, doors: r.doors.map(d => ({ id: d.id, to: d.to, barricaded: d.barricaded })), frontier: r.frontier,
    })),
  };
}
const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function personaOptions(s, me, room) {
  const plan = PERS.decideAction(fullFromSnap(s), me.i, cur.mem, rng);
  return plan.map(a => ({ key: JSON.stringify(a), run: () => runPersona(s, me, room, a) }));
}
async function runPersona(s, me, room, a) {
  const seat = cur.seats[me.i];
  switch (a.k) {
    case 'end': await endTurn(s); return true;
    case 'escape': return roomJob(s, 'Escape');
    case 'search': {
      if (!(s.spot.visible && s.spot.mode === 'live')) return false;
      cur.searchWatch = { i: me.i, lanterns: lanternsOf(me), turn: s.turn };
      const ok = await doSearch(s);
      if (ok) seat.searches++; else cur.searchWatch = null;
      return ok;
    }
    case 'open': {
      const f = room.frontier.find(x => x.id === a.door);
      if (!f) return false;
      const ok = await openDoor(s, f);
      if (ok) seat.opens++;
      return ok;
    }
    case 'move': {
      const d = room.doors.find(x => x.id === a.door);
      if (!d) return false;
      const ok = await moveThrough(s, d, a.to, `${me.possessed ? 'possessed ' : ''}${cur.personas[me.i]} → ${a.goal ?? a.to}`);
      if (ok) seat.moves++;
      return ok;
    }
    case 'job': return roomJob(s, room.job === 'infirmary' ? 'Infirmary' : 'Switchboard');
    case 'card': {
      const card = me.hand.find(c => c.id === a.card);
      if (!card) return false;
      let re;
      if (a.type === 'bandage') re = /^Use/;
      else if (a.type === 'espresso') return useCard(s, card, /^Drink/, () => { cur.turnEspresso++; cur.stats.espresso++; });
      else if (a.type === 'handMirror') re = new RegExp(`^${reEsc(s.players.find(p => p.id === a.target)?.name ?? '?')}$`);
      else if (a.type === 'masterKey' || a.type === 'lockPick') re = new RegExp(`^Open ${reEsc(roomById(s, a.target)?.name ?? '?')} ·`);
      else if (a.type === 'barricade') {
        const d = room.doors.find(x => x.id === a.target);
        const other = d && roomById(s, d.to);
        re = new RegExp(`^Seal the door to ${reEsc(other ? other.name : 'the unknown room')} ·`);
      } else return false;
      const ok = await useCard(s, card, re, () => {
        if (a.type === 'handMirror') cur.stats.mirror++;
        if (a.type === 'barricade') cur.stats.barricade++;
        if (a.type === 'masterKey' || a.type === 'lockPick') cur.stats.unlock++;
      });
      return ok;
    }
    default: return false;
  }
}

function smartOptions(s, me, room) {
  const o = [];
  const ap = me.ap;
  const others = s.players.filter(p => p.alive && !p.escaped && p.i !== me.i && p.room === me.room);
  // Escape.
  if (room.isExit && !me.possessed && lanternsOf(me) >= 3 && ap >= 1) o.push({ key: 'escape', run: () => roomJob(s, 'Escape') });
  if (room.isExit && !me.possessed && lanternsOf(me) >= 3 && ap < 1) return [];    // wait for next turn in the exit
  // Heal.
  if (me.health <= 2 && room.job === 'infirmary' && ap >= 1) o.push({ key: 'infirmary', run: () => roomJob(s, 'Infirmary') });
  if (me.health <= 1 && hasCard(me, 'bandage') && ap >= 1) o.push({ key: 'bandage', run: () => useCard(s, hasCard(me, 'bandage'), /^Use/) });
  // Espresso when running low with things still to do.
  if (hasCard(me, 'espresso') && ap <= 1 && rng() < 0.7) o.push({ key: 'espresso', run: () => useCard(s, hasCard(me, 'espresso'), /^Drink/, () => { cur.turnEspresso++; cur.stats.espresso++; }) });
  // Search where you stand.
  if (s.spot.visible && s.spot.mode === 'live') o.push({ key: 'search', run: () => doSearch(s) });
  if (s.spot.visible && s.spot.mode === 'dark' && rng() < 0.15) o.push({ key: 'search-dark', run: () => doSearch(s, true) });
  // Keys and picks on a locked neighbour.
  const lockedNext = room.doors.filter(d => roomById(s, d.to)?.locked);
  const key = hasCard(me, 'masterKey') || hasCard(me, 'lockPick');
  if (lockedNext.length && key && ap >= 1 && rng() < 0.85) o.push({ key: 'unlock', run: () => useCard(s, key, /^Open /, () => cur.stats.unlock++) });
  // Look into a hand.
  if (others.length && hasCard(me, 'handMirror') && ap >= 1 && rng() < 0.6) {
    const t = others[Math.floor(rng() * others.length)];
    o.push({ key: 'mirror', run: () => useCard(s, hasCard(me, 'handMirror'), new RegExp(`^${t.name}$`), () => cur.stats.mirror++) });
  }
  // Switchboard.
  if (room.job === 'switchboard' && s.roomBtn.visible && !s.roomBtn.disabled && rng() < 0.6) o.push({ key: 'switchboard', run: () => roomJob(s, 'Switchboard') });
  // Barricade now and then.
  if (hasCard(me, 'barricade') && ap >= 2 && rng() < 0.12) o.push({ key: 'barricade', run: () => useCard(s, hasCard(me, 'barricade'), /^Seal/, () => cur.stats.barricade++) });
  // Voluntary trade in the Fire Exit.
  if (s.tradeBtn && rng() < 0.4) o.push({ key: 'voltrade', run: () => voluntaryTrade(s) });
  // Bandage when hurt and nothing better.
  if (me.health <= 2 && hasCard(me, 'bandage') && ap >= 2 && rng() < 0.5) o.push({ key: 'bandage2', run: () => useCard(s, hasCard(me, 'bandage'), /^Use/) });
  if (ap < 1) return o;
  // Where to go.
  const exitKnown = s.exitRoom && roomById(s, s.exitRoom);
  if (!me.possessed && lanternsOf(me) >= 3 && exitKnown) {
    const r = route(s, me.room, x => x.isExit);
    if (r) o.push({ key: 'to-exit', run: () => moveThrough(s, r.door, r.to, 'to the exit') });
  }
  if (!me.possessed && lanternsOf(me) >= 1) {
    const carrier = carrierOf(s, me);
    if (carrier && carrier.i !== me.i && carrier.room !== me.room && rng() < 0.6) {
      const r = route(s, me.room, x => x.id === carrier.room && !x.safe);
      if (r && r.dist <= ap) o.push({ key: 'to-carrier', run: () => moveThrough(s, r.door, r.to, `toward ${carrier.name}`) });
    }
  }
  if (me.possessed) {
    const victims = s.players.filter(p => p.alive && !p.escaped && !p.possessed && p.i !== me.i);
    if (victims.length && rng() < 0.75) {
      const r = route(s, me.room, x => !x.safe && victims.some(v => v.room === x.id));
      if (r && r.dist <= ap) o.push({ key: 'hunt', run: () => moveThrough(s, r.door, r.to, 'hunting') });
    }
  }
  // Explore: open a closed door here, or head for the nearest room with something left.
  const closed = room.frontier.filter(f => !f.jammed);
  if (closed.length && rng() < 0.8) {
    const f = closed[Math.floor(rng() * closed.length)];
    o.push({ key: `open-${f.id}`, run: () => openDoor(s, f) });
  }
  const hasLight = !!hasCard(me, 'flashlight');
  const interesting = x => !x.locked && ((x.searchable && !x.searched && (!x.dark || hasLight)) || x.drops > 0 || x.frontier.some(f => !f.jammed) || (x.isExit && !me.possessed && lanternsOf(me) >= 3));
  const r = route(s, me.room, interesting);
  if (r) o.push({ key: `explore-${r.to}`, run: () => moveThrough(s, r.door, r.to, `exploring toward ${r.dest}`) });
  // Otherwise wander.
  const doors = room.doors.filter(d => !d.barricaded && !roomById(s, d.to)?.locked);
  if (doors.length && rng() < 0.4) { const d = doors[Math.floor(rng() * doors.length)]; o.push({ key: `wander-${d.to}`, run: () => moveThrough(s, d, d.to, 'wandering') }); }
  return o;
}

function randomOptions(s, me, room) {
  const o = [];
  const add = (w, key, run) => o.push({ w: w * rng(), key, run });
  if (s.spot.visible) add(2, 'search', () => doSearch(s, s.spot.mode !== 'live'));
  for (const f of room.frontier) add(1.5, `open-${f.id}`, () => openDoor(s, f));
  for (const d of room.doors) add(1.5, `move-${d.to}`, () => moveThrough(s, d, d.to, 'random'));
  for (const c of me.hand.filter(c => c.type !== 'possession')) add(0.6, `card-${c.id}`, () => useCard(s, c, null));
  if (s.roomBtn.visible) add(1, 'roomjob', () => roomJob(s, null));
  if (s.tradeBtn) add(1, 'voltrade', () => voluntaryTrade(s));
  add(0.3, 'floor', () => tapFloor(s));
  add(0.15, 'rotate', async () => { act('rotate view'); await tapSel(rng() < 0.5 ? '#btn-rotate-left' : '#btn-rotate-right', 'rotate'); await frames(4); });
  add(0.15, 'map', async () => { act('open map'); await tapSel('#btn-map', 'Map'); await frames(3); if (cur.sampleShots && !cur.layoutSeen.has('map')) { cur.layoutSeen.add('map'); await layoutCheck(s, 'map'); await shot('screen-map'); } await tapSel('#btn-map-close', 'close map'); await frames(2); });
  add(me.ap === 0 ? 3 : 0.5, 'end', async () => { await endTurn(s); });
  return o.sort((a, b) => b.w - a.w);
}

// --- concrete interface actions ---------------------------------------------------------------
async function afterWait(pred, ms = 8000) {
  try { await page.waitForFunction(pred, null, { timeout: ms, polling: 40 }); return true; } catch { return false; }
}

async function openDoor(s, f) {
  const me = s.players[s.active];
  const room = roomById(s, me.room);
  const [x, z] = ringPoint(room, f.center, f.axis);
  const nRooms = s.rooms.length;
  act(`tap closed door ${f.id}${me.ap < 1 ? ' (no AP left)' : ''}`);
  const t = await tapGround(x, z, `closed door ${f.id}`);
  await frames(1);
  if (me.ap < 1 || f.jammed) return refusalCheck(s, t, f.jammed ? /jammed/ : /No action points/, `closed door with ${f.jammed ? 'a jam' : 'no AP'}`);
  let c = await page.evaluate(() => ({ open: !document.getElementById('confirm-bar').hidden, text: document.getElementById('confirm-text').textContent, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent }));
  if (t.ok && c.open && /Open this door/.test(c.text)) {
    await tapSel('#btn-confirm-move', 'Open (confirm)');
  } else {
    if (t.ok) await ux(`door-tap-no-confirm`, `Tapping the ring of a closed door did not offer "Open" (confirm: ${c.open ? c.text : 'none'}; toast: "${c.toast}")`, s);
    fallback(`__game.openDoor(${f.id})`, 'tap did not offer Open');
    await page.evaluate(() => { document.getElementById('btn-confirm-cancel')?.click(); });
    await page.evaluate(id => window.__game.openDoor(id), f.id);
  }
  await frames(2);
  const after = await page.evaluate(SNAP);
  const me2 = after.players[after.active];
  if (after.rooms.length === nRooms + 1) {
    cur.stats.opens++;
    if (me2.ap !== me.ap - 1) await violation('high', 'open-cost', `Opening a door cost ${me.ap - me2.ap} AP`, after);
    if (me2.room !== me.room) await violation('high', 'open-moved', 'Opening a door moved the guest', after);
    if (after.meeting.open) await violation('high', 'open-meeting', 'Opening a door started a meeting', after);
    const nr = after.rooms.at(-1);
    if (nr.isExit && cur.sampleShots) await shot('exit-revealed');
    if (nr.id === s.rooms[0].id) await violation('high', 'open-dup', 'Opened room duplicated the lobby', after);
    return true;
  }
  const jam = after.rooms.find(r => r.id === me.room)?.frontier.find(ff => ff.id === f.id)?.jammed;
  if (jam) { cur.stats.jammed++; if (me2.ap !== me.ap) await violation('medium', 'jam-cost', `A jammed door cost ${me.ap - me2.ap} AP (should be free)`, after); return false; }
  await violation('medium', 'open-nothing', `Opening door ${f.id} revealed nothing and is not jammed (toast "${after.toast}")`, after);
  return false;
}

// A tap the game should refuse, with a message where the tap was, and nothing spent.
async function refusalCheck(s, t, re, what) {
  const me = s.players[s.active];
  const r = await page.evaluate(() => ({ confirm: !document.getElementById('confirm-bar').hidden, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent, ap: window.__game.activePlayer().actionPoints, walking: window.__game.activeMover().walking || window.__game.activeMover().path.length > 0 }));
  if (r.confirm) { await violation('medium', `refusal-offered-${slug(what)}`, `Tapping a ${what} offered "${await page.textContent('#confirm-text')}"`, s); await tapSel('#btn-confirm-cancel', 'Cancel'); }
  else if (t.ok && !re.test(r.toast)) await ux(`refusal-silent-${slug(what)}`, `Tapping a ${what} gave ${r.walking ? 'a walk to that spot' : 'no response'} (toast "${r.toast}")`, s);
  if (r.ap !== me.ap) await violation('high', `refusal-cost-${slug(what)}`, `A refused tap on a ${what} changed AP ${me.ap} → ${r.ap}`, s);
  await afterWait(`(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; })()`, 6000);
  return false;
}

async function moveThrough(s, door, to, why) {
  const me = s.players[s.active];
  const room = roomById(s, me.room);
  const dest = roomById(s, to);
  const [x, z] = ringPoint(room, door.center, door.axis);
  const others = s.players.filter(p => p.alive && !p.escaped && p.i !== me.i && p.room === to);
  const locks = await page.evaluate(() => [...window.__game.state.encounterLocks]);
  const unmet = others.filter(q => { const [a, b] = me.i < q.i ? [me.i, q.i] : [q.i, me.i]; return !locks.includes(`${to}:${a}-${b}`); });
  const expectMeeting = !dest.safe && unmet.length > 0;
  act(`move ${me.room} → ${to} (${why})${expectMeeting ? ` [meeting expected with ${unmet.map(q => q.name).join(',')}]` : ''}`);
  if (!cur.ringProbed && me.ap >= 1) {
    // Probe once a match: tap the inner edge of the painted ring (0.28 m further into the room than
    // its centre; the ring's outer radius is 0.33 m). A person tapping the ring there expects "Move".
    cur.ringProbed = true;
    const inner = ringPoint(room, door.center, door.axis, 0.77 + 0.28);
    const pt = await tapGround(inner[0], inner[1], `inner edge of the ring to ${to}`);
    await frames(1);
    const r = await page.evaluate(() => ({ confirm: !document.getElementById('confirm-bar').hidden, walking: window.__game.activeMover().walking || window.__game.activeMover().path.length > 0 }));
    cur.stats.ringProbe = r.confirm ? 'move offered' : r.walking ? 'walked instead' : 'nothing';
    const zone = await page.evaluate(() => window.__game.doorTapAcross?.() ?? null);
    if (pt.ok && !r.confirm) await ux('ring-inner-edge-miss', `Tapping the inner edge of a doorway's ring (still on the painted ring) ${r.walking ? 'walks the guest to that spot' : 'does nothing'} instead of offering "Move" (ring centre 0.77 m from the doorway, tap 1.05 m in, the game's tap zone ends at ${zone == null ? '?' : zone.toFixed(2)} m, ring radius 0.33 m)`, s);
    if (r.confirm) await tapSel('#btn-confirm-cancel', 'Cancel');
    await afterWait(`(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; })()`, 6000);
    await frames(2);
  }
  const t = await tapGround(x, z, `doorway to ${to}`);
  await frames(1);
  if (me.ap < 1 || door.barricaded || dest.locked) return refusalCheck(s, t, door.barricaded ? /barricaded/ : dest.locked ? /locked/ : /Not enough action points/, `doorway (${door.barricaded ? 'barricaded' : dest.locked ? 'locked' : 'no AP'})`);
  const c = await page.evaluate(() => ({ open: !document.getElementById('confirm-bar').hidden, text: document.getElementById('confirm-text').textContent, toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent, ev: window.__ev.splice(0), busy: [window.__game.activeMover().walking, window.__game.meetingOpen(), window.__game.handoffOpen(), window.__game.cardViewOpen(), window.__game.isMapOpen()].join() }));
  if (t.ok && c.open && /^Move to/.test(c.text)) {
    if (!c.text.includes(dest.name)) await ux('move-confirm-name', `Confirm says "${c.text}" for a move into ${dest.name}`, s);
    await tapSel('#btn-confirm-move', 'Move (confirm)');
  } else {
    if (t.ok) await ux(me.ap < 1 ? 'door-tap-no-ap' : 'door-tap-no-move', `Tapping the ring of an open doorway did not offer a move (AP ${me.ap}; confirm: ${c.open ? c.text : 'none'}; toast: "${c.toast}"; events ${c.ev.join(' ')}; busy ${c.busy})`, s);
    await page.evaluate(() => { document.getElementById('btn-confirm-cancel')?.click(); });
    fallback(`__game.moveToRoom(${to})`, 'tap did not offer Move');
    const plan = await page.evaluate(to => { const p = window.__game.moveToRoom(to); return { ok: p.ok, reason: p.reason }; }, to);
    if (!plan.ok) { await violation('medium', 'move-plan-failed', `Cannot plan a move ${me.room} → ${to}: ${plan.reason}`, s); return false; }
  }
  const arrived = await afterWait(`(() => { const g = window.__game; const m = g.activeMover(); return (!m.walking && m.path.length === 0) || g.meetingOpen(); })()`, 15000);
  await frames(3);
  const after = await page.evaluate(SNAP);
  const me2 = after.players[after.active];
  if (!arrived) { await violation('high', 'walk-stuck', `${me.name}'s walk ${me.room} → ${to} never finished`, after); return true; }
  if (me2.room !== to) { await violation('high', 'move-wrong-room', `After moving ${me.room} → ${to} the guest is in ${me2.room}`, after); return true; }
  cur.stats.moves++;
  if (me2.ap !== me.ap - 1) await violation('high', 'move-cost', `Moving cost ${me.ap - me2.ap} AP (${me.ap} → ${me2.ap})`, after);
  const meetingNow = after.meeting.open || (after.handoff.open && after.handoff.kind === 'pick');
  if (expectMeeting && !meetingNow) await violation('high', 'meeting-not-forced', `${me.name} walked into ${to} with ${unmet.map(q => q.name).join(', ')} (not met there this round) and no meeting started`, after);
  if (!expectMeeting && after.meeting.open) await violation('high', 'meeting-unexpected', `A meeting started in ${to} (${dest.safe ? 'a safe zone' : 'already met / nobody there'}): ${after.meeting.title}`, after);
  if (dest.isExit) cur.stats.exitVisits++;
  return true;
}

async function doSearch(s, expectRefusal = false) {
  const me = s.players[s.active];
  act(`tap search icon (${s.spot.mode}) in ${me.room}`);
  const before = me.ap;
  const ok = await tapVisiblePart('#search-spot', 'search icon');
  // Walk to the furniture, then a private reveal (or a refusal toast).
  const done = await afterWait(`(() => { const g = window.__game; return g.handoffOpen() || (!g.searchPending() && !g.activeMover().walking && g.activeMover().path.length === 0 && !document.getElementById('toast').hidden); })()`, 12000);
  await frames(2);
  const after = await page.evaluate(SNAP);
  const me2 = after.players[after.active];
  if (expectRefusal || s.spot.mode !== 'live') {
    if (me2.ap !== before) await violation('high', 'search-refused-cost', `A refused search (${s.spot.mode}) cost AP`, after);
    return false;
  }
  if (!done) { await violation('high', 'search-no-result', 'Tapping the live search icon produced nothing within 12 s', after); return false; }
  if (after.handoff.open && after.handoff.kind === 'found') {
    cur.stats.searches++;
    if (me2.ap !== before - 1) await violation('high', 'search-cost', `Searching cost ${before - me2.ap} AP`, after);
    if (!/searched\.?$/.test(after.toast.trim()) && after.toast) cur.pendingUx.push(['search-toast', `Search toast reads "${after.toast}"`]);
    return true;
  }
  await ux('search-tap-nothing', `Tapping the search icon gave: toast "${after.toast}", no private reveal`, after);
  return false;
}

async function useCard(s, card, buttonRe, onDone) {
  const me = s.players[s.active];
  act(`tap ${card.type} in the fan`);
  const sel = `#hand-fan .fan-card[data-card-id="${card.id}"]`;
  if (!(await page.$(sel))) { await violation('medium', 'card-not-in-fan', `${card.type} is in ${me.name}'s hand but not in the fan`, s); return false; }
  await tapVisiblePart(sel, `fan card ${card.type}`);
  const opened = await afterWait('window.__game.cardViewOpen()', 3000);
  if (!opened) {
    await ux('fan-tap-no-view', `Tapping ${card.type} in the fan did not open the card view`, s);
    fallback('__game.openHand', 'fan tap did not open the card view');
    await page.evaluate(id => { window.__game.openHand(); }, card.id);
    await frames(2);
  }
  let v = await page.evaluate(SNAP);
  if (!cur.layoutSeen.has('cardview')) { cur.layoutSeen.add('cardview'); await layoutCheck(v, 'card view'); if (cur.sampleShots) await shot('screen-cardview'); }
  // Step to the card with ‹ › if needed.
  for (let k = 0; k < 10 && v.cardView.id !== card.id; k++) { await tapSel('#btn-hand-next', 'next card'); await frames(1); v = await page.evaluate(SNAP); }
  if (v.cardView.id !== card.id) { await ux('cardview-wrong-card', `Card view shows ${v.cardView.id} not ${card.id}`, v); await tapSel('#btn-hand-close', 'close card view'); return false; }
  const btns = v.cardView.buttons.map((b, i) => ({ ...b, i })).filter(b => !b.disabled);
  let b = buttonRe ? btns.find(x => buttonRe.test(x.text)) : btns[Math.floor(rng() * (btns.length + 1))];
  if (!b) {
    act(`card view ${card.type}: nothing to do (${v.cardView.buttons.map(x => x.text).join('|') || 'no buttons'}) → close`);
    await tapSel('#btn-hand-close', 'close card view');
    await frames(1);
    return false;
  }
  const beforeAp = v.players[v.active].ap;
  act(`card view ${card.type}: ${b.text}`);
  const all = await page.$$('#hand-detail .btn');
  const handles = [];
  for (const h of all) if (await h.isVisible()) handles.push(h);
  let clicked = false;
  for (const h of handles) if ((await h.evaluate(el => el.textContent.replace(/\s+/g, ' ').trim())) === b.text) { try { if (cur.touch) await h.tap({ timeout: 3000 }); else await h.click({ timeout: 3000 }); clicked = true; } catch (e) { await ux('cardview-button-tap', `Card view button "${b.text}" not tappable: ${String(e.message).split('\n')[0]}`, v); await h.evaluate(el => el.click()); fallback('DOM click card button', 'tap failed'); clicked = true; } break; }
  if (!clicked) return false;
  await frames(3);
  onDone?.();
  if (card.type === 'espresso' && !onDone) { cur.turnEspresso++; cur.stats.espresso++; }
  let a = await page.evaluate(SNAP);
  const me2 = a.players[a.active];
  const cost = card.type === 'espresso' ? -2 : 1;
  if (me2.ap !== beforeAp - cost && !(a.handoff.open && a.handoff.kind === 'mirror' && me2.ap === beforeAp - 1)) await violation('high', `card-cost-${card.type}`, `Using ${card.type} changed AP ${beforeAp} → ${me2.ap} (expected ${beforeAp - cost})`, a);
  if (me2.hand.some(c => c.id === card.id)) await violation('high', `card-not-used-${card.type}`, `${card.type} is still in hand after "${b.text}"`, a);
  if (card.type === 'handMirror' && !(a.handoff.open && a.handoff.kind === 'mirror')) await violation('high', 'mirror-no-screen', 'The Hand Mirror did not show a private hand screen', a);
  if (a.cardView.open && !a.handoff.open) { await tapSel('#btn-hand-close', 'close card view'); await frames(1); }
  return true;
}

async function roomJob(s, expect) {
  const me = s.players[s.active];
  if (!s.roomBtn.visible || s.roomBtn.disabled) return false;
  act(`tap room button "${s.roomBtn.text.replace(/\s+/g, ' ')}"`);
  if (expect && !s.roomBtn.text.includes(expect)) await ux('roombtn-label', `Room button reads "${s.roomBtn.text}" (expected ${expect})`, s);
  await tapSel('#btn-room', 'room button');
  await frames(3);
  const a = await page.evaluate(SNAP);
  const me2 = a.players[a.active];
  const job = roomById(s, me.room);
  if (job.isExit) {
    const can = !me.possessed && lanternsOf(me) >= 3;
    if (can && !a.finished) await violation('critical', 'escape-refused', `${me.name} (clean, ${lanternsOf(me)} Lanterns, ${me.ap} AP) pressed Escape in the exit and did not escape (toast "${a.toast}")`, a);
    if (!can && a.finished && a.won === 'humans') await violation('critical', 'escape-illegal', `${me.name} escaped without being allowed (possessed=${me.possessed}, lanterns ${lanternsOf(me)})`, a);
    if (a.finished) cur.stats.escapes++;
    return can;
  }
  cur.stats.jobs[job.job] = (cur.stats.jobs[job.job] || 0) + 1;
  if (me2.ap !== me.ap - 1) await violation('high', `job-cost-${job.job}`, `${job.job} cost ${me.ap - me2.ap} AP`, a);
  if (job.job === 'infirmary' && me2.health !== Math.min(3, me.health + 2)) await violation('high', 'infirmary-heal', `Infirmary: health ${me.health} → ${me2.health}`, a);
  if (job.job === 'switchboard') {
    const n = a.players.filter(p => p.alive && p.possessed).length;
    if (!a.notice.open) await violation('medium', 'switchboard-no-notice', 'Switchboard used but no public notice', a);
    else if (!a.notice.body.includes(n === 0 ? 'No guest' : `${n} guest`)) await violation('high', 'switchboard-count', `Switchboard says "${a.notice.body}" but ${n} living guests are possessed`, a);
    if (cur.sampleShots && !cur.layoutSeen.has('notice')) { cur.layoutSeen.add('notice'); await shot('switchboard'); }
  }
  return true;
}

async function voluntaryTrade(s) {
  act('tap Trade (safe zone)');
  cur.stats.voluntary++;
  await tapSel('#btn-trade', 'Trade');
  await frames(2);
  return true;
}

async function tapFloor(s) {
  const me = s.players[s.active];
  const room = roomById(s, me.room);
  const x = room.center[0] + (rng() - 0.5) * 5, z = room.center[1] + (rng() - 0.5) * 5;
  act('tap the floor (reposition)');
  const t = await tapGround(x, z, 'the floor');
  if (!t.ok) return false;
  await afterWait(`(() => { const m = window.__game.activeMover(); return !m.walking && m.path.length === 0; })()`, 6000);
  await frames(2);
  const a = await page.evaluate(SNAP);
  if (a.players[a.active].ap !== me.ap && !a.meeting.open && !a.handoff.open) await violation('high', 'reposition-cost', `Repositioning inside ${me.room} changed AP ${me.ap} → ${a.players[a.active].ap}`, a);
  if (a.confirm.open) { await tapSel('#btn-confirm-cancel', 'Cancel'); }
  return true;
}

// ---------------------------------------------------------------------------------------------
let rng = Math.random;

async function loadMatch(M, query) {
  if (page.url().startsWith('http')) {
    await page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 60000, polling: 250 }).catch(() => {});
  }
  consoleSink.length = 0;
  await page.goto(baseUrl + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000 });
  await page.evaluate(({ every, speed }) => {
    const g = window.__game;
    g.cfg.player.speed = speed; g.setPixelRatio(0.5);
    g.cfg.camera.followLerp = 25; g.cfg.camera.rotateDuration = 0.1;   // the camera catches up at once (feel only)
    const v = g.view; const real = v.render.bind(v); let n = 0;
    window.__ap = { every, force: 0, rendered: 0 };
    window.__ev = [];
    const cv = document.querySelector('#view canvas');
    for (const t of ['pointerdown', 'pointerup', 'pointercancel']) cv.addEventListener(t, e => { window.__ev.push(`${t}:${e.pointerType}@${Math.round(performance.now())}`); if (window.__ev.length > 20) window.__ev.shift(); }, true);
    v.render = () => {
      n++;
      const a = window.__ap;
      a.frames = (a.frames || 0) + 1;
      if (a.force > 0 || (a.every && n % a.every === 0)) { if (a.force > 0) a.force--; real(); a.rendered++; } else v.camera.updateMatrixWorld();
    };
  }, { every: RENDER_EVERY, speed: SPEED });
}

async function playMatch(M) {
  rng = mulberry32((M.seed * 2654435761) >>> 0);
  cur = {
    ...M, t0: Date.now(), violations: [], ux: [], fallbacks: [], actions: [], console: [], shots: [], seen: new Map(), uxSeen: new Map(), pendingUx: [],
    layoutSeen: new Set(), holder: null, prof: {}, profShots: 0, turnEspresso: 0, turns: 0, sampleShots: M.k % 6 === 0,
    stats: { meetings: 0, trades: 0, attacks: 0, deaths: 0, searches: 0, searchesRevealed: 0, opens: 0, jammed: 0, moves: 0, discards: 0, mirror: 0, espresso: 0, unlock: 0, barricade: 0, escapes: 0, voluntary: 0, jobs: {}, conversions: 0, convertNotes: 0, blocks: 0, exitVisits: 0 },
    personas: M.personas || null, mem: PERS.newMemory(), kills: [], attempts: [], blocks: [], conversionLog: [], exitRound: null,
    seats: M.personas ? M.personas.map(persona => ({ persona, searches: 0, lanternsFound: 0, opens: 0, moves: 0, attacks: 0, kills: 0, killedBy: null, trades: 0, attempts: 0, blocks: 0 })) : null,
  };
  const query = `?mode=hotseat&players=${M.players}&seed=${M.seed}&timer=off`;
  console.log(`\n#${M.k} seed ${M.seed} · ${M.players} players · ${M.profile}${M.personas ? ` [${M.personas.join(',')}]` : ''} · ${M.touch ? 'touch' : 'mouse'}`);
  await loadMatch(M, query);
  cur.pageT0 = await page.evaluate(() => performance.now() - (window.__ap.frames ? 0 : 0));
  await page.evaluate(() => { window.__ap.frames = 0; });
  const init = await page.evaluate(SNAP);
  cur.lastSnap = init;
  cur.possessedStart = init.players.filter(p => p.possessed).map(p => p.name);
  cur.possSet = new Set(cur.possessedStart);
  if (M.personas) console.log(`   possessed at the start: ${cur.possessedStart.join(', ')} (${init.players.filter(p => p.possessed).map(p => M.personas[p.i]).join(', ')})`);
  // Start state sanity.
  if (init.players.length !== M.players) await violation('high', 'player-count', `${init.players.length} guests for players=${M.players}`, init);
  if (init.players.filter(p => p.possessed).length !== 1) await violation('critical', 'possessed-start', `${init.players.filter(p => p.possessed).length} possessed at start`, init);
  // Approved deal: every guest (the possessed one too) starts with exactly 1 Lantern + 3 other cards.
  if (init.players.some(p => p.hand.filter(c => c.type === 'lantern').length !== 1)) await violation('high', 'lantern-deal', `Lanterns dealt: ${init.players.map(p => p.hand.filter(c => c.type === 'lantern').length).join(',')} (each guest should start with 1)`, init);
  if (init.players.some(p => countable(p) !== 4)) await violation('high', 'start-hand', `Starting hands: ${init.players.map(p => countable(p)).join(',')}`, init);
  act('tap "Tap to begin"');
  await tapSel('#btn-begin', 'Tap to begin');
  let lastSig = '', same = 0, steps = 0;
  while (true) {
    steps++;
    if (Date.now() - cur.t0 > MATCH_MS) { await violation('high', 'match-timeout', `Match still running after ${Math.round(MATCH_MS / 1000)} s (round ${cur.lastSnap.round})`); cur.abort = 'time limit'; break; }
    if (steps > 5000) { cur.abort = 'step limit'; break; }
    let s;
    const tSnap = Date.now();
    try { s = await page.evaluate(SNAP); } catch (e) { await violation('critical', 'snapshot-failed', `Page not readable: ${e.message.slice(0, 200)}`); cur.abort = 'page broken'; break; }
    cur.prevSnap = cur.lastSnap; cur.prevTurn = cur.prevSnap?.turn;
    cur.lastSnap = s;
    await checkInvariants(s);
    if (cur.seats) personaWatch(s);
    cur.prof.snap = (cur.prof.snap || 0) + (Date.now() - tSnap);
    if (cur.abort) break;
    // Soft-lock watchdog: nothing changes for many steps in a row.
    const me = s.players[s.active];
    const sig = JSON.stringify([s.turn, s.active, s.overlays, s.handoff.kind, s.handoff.title, s.meeting.title, s.meeting.body.length, s.discard.cards.length, s.cardView.id, me?.ap, me?.room, s.players.map(p => p.hand.length), s.movers[s.active], s.rooms.length, s.finished, s.walking]);
    if (sig === lastSig) same++; else { same = 0; lastSig = sig; }
    if (same >= 30) {
      await violation('critical', 'soft-lock', `Nothing has changed for ${same} steps (${s.overlays.join(', ') || 'no screen'}; inAction ${s.inAction}; walking ${s.walking})`, s);
      cur.abort = 'soft-lock';
      break;
    }
    if (s.end.open) { await finishMatch(s); break; }
    if (s.finished && !s.end.open && !s.overlays.length) {
      if (same > 5) { await violation('high', 'finished-no-end-screen', `The match is finished (${s.won}) but no end screen shows`, s); cur.abort = 'no end screen'; break; }
      await frames(3); continue;
    }
    const tStep = Date.now();
    const cat = s.handoff.open ? `handoff-${s.handoff.kind}` : s.meeting.open ? 'meeting' : s.inAction && !s.walking ? 'action' : 'other';
    try {
      if (s.start) { await tapSel('#btn-begin', 'Tap to begin'); }
      else if (s.handoff.open) await onHandoff(s);
      else if (s.notice.open) { act(`notice "${s.notice.title}": Continue`); await tapSel('#btn-notice-ok', 'notice Continue'); }
      else if (s.discard.open) await onDiscard(s);
      else if (s.meeting.open) await onMeeting(s);
      else if (s.cardView.open) { act('close card view'); await tapSel('#btn-hand-close', 'close card view'); }
      else if (s.map) { act('close map'); await tapSel('#btn-map-close', 'close map'); }
      else if (s.confirm.open) { act('cancel stray confirm'); await tapSel('#btn-confirm-cancel', 'Cancel'); }
      else if (s.walking || s.searchPending) await frames(3);
      else if (s.inAction) {
        if (cur.holder && me && cur.holder !== me.name) { /* checked in invariants */ }
        await takeAction(s);
      } else await frames(3);
    } catch (e) {
      await violation('medium', `harness-${slug(e.message).slice(0, 30)}`, `Harness step failed: ${e.message.split('\n')[0].slice(0, 200)}`, s);
      await frames(3);
    }
    cur.prof[cat] = (cur.prof[cat] || 0) + (Date.now() - tStep);
    if (cur.abort) break;
    await frames(1);
  }
  if (verbose || flag('timing')) console.log('   time by step kind (ms):', JSON.stringify(cur.prof), 'shots', cur.profShots, 'fps', await page.evaluate(t => window.__ap.frames / ((performance.now() - t) / 1000), cur.pageT0).catch(() => 0));
  if (cur.abort && !cur.ended) {
    await shot(`ABORT-${cur.abort}`, { force: true });
  }
  if (M.restartCheck && cur.ended) await restartCheck();
  const res = {
    k: M.k, seed: M.seed, players: M.players, profile: M.profile, touch: M.touch,
    outcome: cur.ended ? cur.outcome : `aborted: ${cur.abort}`, won: cur.lastSnap?.won, dawn: cur.lastSnap?.dawn,
    round: cur.lastSnap?.round, turns: cur.lastSnap?.turn, seconds: Math.round((Date.now() - cur.t0) / 1000),
    possessedStart: cur.possessedStart, possessedEnd: cur.lastSnap?.players.filter(p => p.possessed).map(p => p.name),
    dead: cur.lastSnap?.players.filter(p => !p.alive).map(p => p.name), rooms: cur.lastSnap?.rooms.length,
    stats: cur.stats, violations: cur.violations, ux: cur.ux, fallbacks: cur.fallbacks, console: cur.console, shots: cur.shots,
  };
  if (cur.seats && cur.lastSnap) {
    const L = cur.lastSnap;
    res.personas = cur.personas;
    res.seats = cur.seats.map((x, i) => {
      const p = L.players[i];
      return { name: p.name, ...x, startPossessed: cur.possessedStart.includes(p.name), endPossessed: p.possessed, alive: p.alive, escaped: p.escaped, lanternsHeld: lanternsOf(p), health: p.health };
    });
    res.kills = cur.kills; res.attempts = cur.attempts; res.blocks = cur.blocks; res.conversionLog = cur.conversionLog; res.exitRound = cur.exitRound;
    res.lanternsEnd = {
      clean: L.players.filter(p => p.alive && !p.possessed).reduce((n, p) => n + lanternsOf(p), 0),
      possessed: L.players.filter(p => p.alive && p.possessed).reduce((n, p) => n + lanternsOf(p), 0),
      escaped: L.players.filter(p => p.escaped).reduce((n, p) => n + lanternsOf(p), 0),
      ...L.lanternPiles,
    };
    res.lanternsFound = res.seats.reduce((n, x) => n + x.lanternsFound, 0);
    res.lanternsDrawnFromDeck = 14 - L.lanternPiles.draw;
  }
  fs.appendFileSync(resultsFile, JSON.stringify(res) + '\n');
  console.log(`   → ${res.outcome} · round ${res.round} · ${res.turns} turns · ${res.seconds}s · ${cur.violations.length} bugs, ${cur.ux.length} ux, ${cur.fallbacks.length} fallbacks`);
  return res;
}

// Personality runs: who became possessed (and after trading with whom), Lanterns found by searching,
// when the Fire Exit turned up.
function personaWatch(s) {
  for (const p of s.players) {
    if (p.possessed && !cur.possSet.has(p.name)) {
      cur.possSet.add(p.name);
      const by = cur.lastTrade && (cur.lastTrade.a === p.name ? cur.lastTrade.b : cur.lastTrade.b === p.name ? cur.lastTrade.a : null);
      cur.conversionLog.push({ who: p.name, persona: cur.personas[p.i], by, byPersona: by ? cur.personas[s.players.find(q => q.name === by).i] : null, round: s.round });
    }
  }
  const w = cur.searchWatch;
  if (w && s.inAction && !s.handoff.open && !s.searchPending && s.active === w.i) {
    cur.seats[w.i].lanternsFound += Math.max(0, lanternsOf(s.players[w.i]) - w.lanterns);
    cur.searchWatch = null;
  } else if (w && s.turn !== w.turn) cur.searchWatch = null;
  if (s.exitRoom && cur.exitRound == null) cur.exitRound = s.round;
}

async function finishMatch(s) {
  cur.ended = true;
  const e = s.end;
  const possessed = s.players.filter(p => p.possessed).map(p => p.name);
  cur.outcome = s.won === 'humans' ? 'escape' : s.dawn ? 'dawn' : s.won === 'possessed' ? 'hotel' : `unknown(${s.won})`;
  act(`END: ${e.title} — ${e.summary}`);
  await shot(`end-${cur.outcome}`, { force: true });
  await layoutCheck(s, 'end screen');
  if (s.won === 'humans') {
    const out = s.players.filter(p => p.escaped);
    if (!/got out/i.test(e.title)) await violation('high', 'end-title-escape', `Escape win but end title "${e.title}"`, s);
    if (out.length !== 1 || out[0].possessed || lanternsOf(out[0]) < 3) await violation('critical', 'escape-invalid', `Escaped: ${out.map(p => `${p.name} possessed=${p.possessed} L${lanternsOf(p)}`).join(', ')}`, s);
  } else if (s.dawn) {
    if (!/Dawn breaks/.test(e.title)) await violation('high', 'end-title-dawn', `Dawn but end title "${e.title}"`, s);
    if (s.round !== 9) await violation('high', 'dawn-round', `Dawn broke with state.round ${s.round}`, s);
  } else if (s.won === 'possessed') {
    if (!/keeps them/.test(e.title)) await violation('high', 'end-title-hotel', `Hotel win but title "${e.title}"`, s);
    const cleanAlive = s.players.filter(p => p.alive && !p.possessed);
    if (cleanAlive.length) await violation('critical', 'hotel-win-invalid', `Hotel won with clean guests alive: ${cleanAlive.map(p => p.name)}`, s);
  } else await violation('high', 'end-unknown', `End screen with won=${s.won}`, s);
  // (the summary is one fact per line since the playtest fix round; older builds used " · ")
  const listed = (/Possessed: (.+?)(?= · |\s+Dead: |\s+Round \d|\n|$)/.exec(e.summary)?.[1] || '').trim();
  const want = possessed.length ? possessed.join(', ') : 'nobody';
  if (listed !== want) await violation('high', 'end-possessed-list', `End screen lists possessed "${listed}", state says "${want}"`, s);
  if (s.fan.visible || s.spot.visible) await violation('medium', 'end-fan', 'Fan or search icon on the end screen', s);
  if (!/Round \d of 8/.test(e.summary)) await ux('end-no-round', `End summary has no round: "${e.summary}"`, s);
}

// Every tenth match: "New match" must give a clean new match (round 1, all alive, roles again).
async function restartCheck() {
  act('tap "New match"');
  await tapSel('#btn-restart', 'New match');
  await frames(4);
  const s = await page.evaluate(SNAP);
  const bad = [];
  if (s.end.open) bad.push('end screen still up');
  if (s.round !== 1 || s.turn !== 1) bad.push(`round ${s.round} turn ${s.turn}`);
  if (s.players.some(p => !p.alive || p.health !== 3 || p.ap !== 4 || p.room !== s.rooms[0].id)) bad.push('guests not reset');
  if (s.players.filter(p => p.possessed).length !== 1) bad.push(`${s.players.filter(p => p.possessed).length} possessed`);
  if (s.rooms.length !== 1) bad.push(`${s.rooms.length} rooms`);
  if (!(s.handoff.open && s.handoff.kind === 'pass' && /Secret roles/.test(s.handoff.kicker))) bad.push(`first screen is ${s.handoff.kind} "${s.handoff.kicker}"`);
  if (s.players.some(p => p.escaped)) bad.push('escaped set not cleared');
  const moversHome = s.players.every(p => { const m = s.movers[p.i]; return m.cellRoom === s.rooms[0].id; });
  if (!moversHome) bad.push('figures not back in the lobby');
  if (bad.length) await violation('high', 'restart-dirty', `After "New match": ${bad.join('; ')}`, s);
  else act('New match: clean');
  await shot('after-new-match');
  cur.stats.restartChecked = bad.length ? 'dirty' : 'clean';
}

// ---------------------------------------------------------------------------------------------
await openBrowser();
const all = [];
const count = (opt('seed', null) && !PERSONA_STUDY) ? 1 : MATCHES;
for (let n = 0; n < count; n++) {
  const M = await scheduleAsync(FIRST + n);
  if (n > 0 && n % 20 === 0) await openBrowser();   // a fresh browser now and then (memory)
  try { all.push(await playMatch(M)); }
  catch (e) {
    console.log(`   match crashed: ${e.message.split('\n')[0]}`);
    fs.appendFileSync(resultsFile, JSON.stringify({ k: M.k, seed: M.seed, players: M.players, profile: M.profile, outcome: `crashed: ${e.message.split('\n')[0].slice(0, 200)}` }) + '\n');
    await openBrowser();
  }
}
await browser.close();
const outcomes = {};
for (const r of all) outcomes[r.outcome] = (outcomes[r.outcome] || 0) + 1;
console.log('\nSummary:', JSON.stringify(outcomes), `avg ${Math.round(all.reduce((a, r) => a + r.seconds, 0) / Math.max(1, all.length))} s/match`);
