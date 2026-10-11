// Tips during your first matches (the words and the numbers: src/data/tips.js). A small Art Deco card
// near the thing it explains, the first time that thing comes up, once per device, in a match and in
// practice. "Got it" puts it away; "Hide tips" turns tips off (Settings > Tips turns them back on, and
// "Show tips again" forgets the ones already seen).
//
// A tip never gets in the way:
//   - it sits BESIDE the thing it explains, never on top of it, and never over a part of the interface
//     the player taps (the strip, the panel, the hand, the buttons, the Move bar, the magnifier, a toast,
//     the chat panel); it also keeps off the "Go" / "Explore" tags over the hotel when it can. With no
//     clear place it waits.
//   - only the card itself takes taps; the screen round it is the game's as always.
//   - one at a time (the others wait their turn); each puts itself away after a few seconds.
//   - it never stops the turn clock: online, nobody's own tips may hold up the table.
//   - none shows over a private screen, the trade scene, the card view, a notice or question, the map,
//     the chat panel or the end screen: it waits until they close. A tip cut off by one comes back later
//     — unless that screen is the very thing it explains (the map, the chat panel, the card view): the
//     player did what it said.
//   - the lessons that can wait (the map, quick chat) wait for the player's own first turn in the game,
//     so the first thing a new player learns is how to act.
//
// Privacy: a tip goes ONLY by the player's own situation (their turn, their room, their own hand and
// role) and by what the whole table sees (the round, the rooms found, a meeting they are in, what is
// said in the chat) — never by anything hidden from them, so a tip can never hint at another guest's
// role or hand. main.js hands over exactly that (`situation`, below).
import * as THREE from 'three';
import { TIPS, TIPS_WORDS, TIPS_TIMING as T } from '../data/tips.js';
import { rules } from '../data/rules.js';
import { countableCount } from '../game/cards.js';
import { interfaceRects } from './screenTags.js';

// --- Which tips have been seen on this device (localStorage; every read and write guarded, so a private
// window or blocked storage simply shows each tip once per visit) -------------------------------------
const KEY = 'hotelEscape.tips.v1';
function load() {
  try {
    const raw = window.localStorage?.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : null;
    return new Set(Array.isArray(saved?.seen) ? saved.seen.filter(id => typeof id === 'string') : []);
  } catch { return new Set(); }
}
let seen = load();
function save() {
  try { window.localStorage?.setItem(KEY, JSON.stringify({ seen: [...seen] })); } catch { /* storage blocked: kept for this visit */ }
}
// Forget every tip seen, so each comes up again.
export function forgetTips() { seen = new Set(); save(); }

// Settings > Tips: the "Show tips again" button. It forgets the tips seen and turns tips on; for a
// moment it then reads "Tips will show again". src/ui/menu.js calls this whenever it draws the Settings
// screen; `guard(e)` is that screen's double-tap guard, `after()` draws the screen again.
let againUntil = 0, againTimer = 0;
export function renderTipsAgain(button, settings, { guard = () => false, after = () => {} } = {}) {
  if (!button) return;
  const done = performance.now() < againUntil;
  button.textContent = done ? TIPS_WORDS.againDone : TIPS_WORDS.again;
  // (nothing to bring back: every tip is still to come, and tips are on)
  button.disabled = done || (!seen.size && settings.get('tips') !== 'off');
  button.onclick = e => {
    e.preventDefault();
    if (guard(e) || button.disabled) return;
    forgetTips();
    settings.set('tips', 'on');
    againUntil = performance.now() + T.againMs;
    clearTimeout(againTimer);
    againTimer = setTimeout(() => renderTipsAgain(button, settings, { guard, after }), T.againMs + 30);
    after();
  };
}

// --- When each tip comes up, and where it sits ----------------------------------------------------------
// `when(s)`: the situation in which it comes up (see `situation` below and in main.js; s.match, s.heard —
// another guest has spoken in this game —, s.turnBegun — the player's own first turn in this game has
// begun — and the events s.gained / s.lanternGained are added here). `at`: the part of the screen it
// sits beside; `point`: what its little arrow points at (default `at`); `sides`: where it may sit,
// nearest first; `prio`: which goes first when several are waiting (lowest first); `done(s)`: the
// screen that covers it is the one it explains (the player did what it said), so it counts as seen.
//   now     about something happening at this very moment (the Move bar is up, the magnifier is there):
//           dropped once the moment passes, and it may take over from a tip that has been up a while.
//   latch   about something that has just happened (a card arrived): it waits for a clear moment, for
//           up to staleMs.
//   meeting shown beside an open meeting (every other tip waits for the meeting to end).
const DEFS = [
  { id: 'possessedStart', prio: 0, at: '#player-panel', point: '#panel-souls', sides: ['above', 'right'],
    when: s => s.match && s.me.alive && s.me.possessed && s.startedPossessed },
  { id: 'possessedMid', prio: 0, at: '#player-panel', point: '#panel-souls', sides: ['above', 'right'],
    when: s => s.match && s.me.alive && s.me.possessed && !s.startedPossessed && !s.me.roleChangePending },
  { id: 'out', prio: 0, at: '#btn-end-turn', sides: ['above', 'left'], when: s => s.match && !s.me.alive },
  { id: 'meeting', prio: 1, at: '#encounter-overlay .modal', sides: ['right', 'left', 'below', 'above'], now: true, meeting: true,
    clear: ['#encounter-overlay .modal'], when: s => s.meeting },
  { id: 'firstTurn', prio: 2, at: '#player-panel', point: '#ap-pips', sides: ['above', 'right'], when: s => s.acting },
  { id: 'moveBar', prio: 3, at: '#confirm-bar', sides: ['above', 'below'], now: true, when: s => s.myTurn && s.moveBar },
  { id: 'search', prio: 3, at: '#search-spot', sides: ['right', 'left', 'above', 'below'], now: true, when: s => s.acting && s.search === 'live' },
  { id: 'finalRound', prio: 3, at: '#round', sides: ['below', 'left'], when: s => s.match && s.final },
  { id: 'cardFound', prio: 4, at: '#hand-fan', sides: ['above'], latch: true, when: s => s.gained, done: s => s.cardOpen },
  { id: 'timer', prio: 4, at: '#turn-timer', sides: ['below', 'left'], now: true,
    when: s => s.match && s.myTurn && s.clock != null && s.clock <= T.clockAt && s.clock > 5 },
  { id: 'handLimit', prio: 4, at: '#hand-fan', sides: ['above'], when: s => countableCount(s.me.hand) >= rules.handLimit },
  { id: 'lantern', prio: 5, at: '#hand-fan', sides: ['above'], latch: true, when: s => s.match && (s.lanternGained || s.exitFound) },
  { id: 'lanternPractice', prio: 5, at: '#hand-fan', sides: ['above'], latch: true, when: s => !s.match && (s.lanternGained || s.exitFound) },
  { id: 'switchboard', prio: 5, at: '#btn-room', sides: ['above', 'left'], now: true, when: s => s.match && s.acting && s.job === 'switchboard' },
  { id: 'switchboardPractice', prio: 5, at: '#btn-room', sides: ['above', 'left'], now: true, when: s => !s.match && s.acting && s.job === 'switchboard' },
  { id: 'infirmary', prio: 5, at: '#btn-room', sides: ['above', 'left'], now: true, when: s => s.acting && s.job === 'infirmary' },
  { id: 'map', prio: 7, at: '#btn-map', sides: ['above', 'left'], when: s => s.turnBegun && s.rooms >= T.mapRooms, done: s => s.mapOpen },
  { id: 'chat', prio: 8, at: '#btn-chat', sides: ['below', 'left'], when: s => s.match && s.turnBegun && (s.heard || s.round >= 2), done: s => s.chatOpen },
];

// The parts of the interface a tip keeps clear of (whichever are showing), and the tags over the hotel
// it keeps off when it can (and the player's own guest, see guestBox).
const CLEAR = ['.hud-top-left', '#feed', '.hud-top-center', '.hud-top-right', '#player-panel', '#hand-fan .fan-card',
  '#hand-fan .fan-limit', '.hud-bottom-right', '#confirm-bar', '#toast', '#search-spot', '.path-label', '#chat-panel'];
const SOFT = ['.tag-layer > div'];
const GAP = 12;          // px between the card and what it explains
const EDGE = 10;         // px kept from the screen's edges
const PAD = 6;           // px kept from the interface
const TICK_MS = 200;     // how often the tips look at the game
const ARROW = 18;        // px: the arrow stays this far inside the card's corners
const RETRY_MS = 1000;   // a tip with no clear place (or no place off the tags) looks again after this long

const shown = el => !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0;
const overlaps = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

// `situation()` (main.js) — the player's own situation and public facts only, never the game state itself:
// { on, game, practice, me (the player's own guest), self (where it stands), myTurn, acting, clock, moveBar,
// search, meeting, heard (when another guest last spoke, ms), covered, mapOpen, chatOpen, cardOpen (the
// player's own screens), round, final, rooms, exitFound, job }.
// `settings`: src/settings.js (Settings > Tips). `camera`: the hotel's camera, to find the player's own
// guest on the screen. `tagBoxes()`: the tags over the hotel showing now, as the tag layer placed them
// (src/ui/screenTags.js list(): no need to measure them again).
export function createTips(doc, { situation, settings, camera = null, tagBoxes = null }) {
  const app = doc.getElementById('app') || doc.body;
  const el = doc.createElement('div');
  el.id = 'tip'; el.className = 'tip'; el.hidden = true;
  el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<span class="tip-arrow" aria-hidden="true"></span><div class="tip-kicker"></div><div class="tip-title"></div>'
    + '<p class="tip-text"></p><div class="tip-actions"><button type="button" class="tip-hide" data-sfx="close"></button>'
    + '<button type="button" class="tip-ok" data-sfx="close"></button></div><span class="tip-time" aria-hidden="true"></span>';
  app.appendChild(el);
  const part = sel => el.querySelector(sel);
  const ui = { kicker: part('.tip-kicker'), title: part('.tip-title'), text: part('.tip-text'), actions: part('.tip-actions'), hide: part('.tip-hide'), ok: part('.tip-ok') };
  ui.kicker.textContent = TIPS_WORDS.kicker;
  ui.hide.textContent = TIPS_WORDS.hide;
  ui.ok.textContent = TIPS_WORDS.gotIt;

  let cur = null;               // the tip on screen: { def, at (ms), side, box, anchor }
  const queue = new Map();      // id -> { def, at }: tips that have come up, waiting for a clear moment
  let quietUntil = 0;           // no new tip before this
  let byeUntil = 0;             // "Tips are off" is on the card until then
  let lastTick = 0;
  let facts = [];               // (tests) what the situation is made of: never the game state itself
  // This game's own memory: whether the player started it possessed, and their hand last time looked.
  let game = null, startedPossessed = false, hand = null, lanterns = 0, heardAt = 0, turnBegun = false;
  let self = null;              // where the player's own guest stands ({ x, z }), from the last look

  // The player's own guest on the screen, feet to head (the figure they watch): a tip keeps off it when
  // it can, like the tags.
  const v = new THREE.Vector3();
  function guestBox(W, H) {
    if (!camera || !self) return [];
    const at = y => { v.set(self.x, y, self.z).project(camera); return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H, z: v.z }; };
    const feet = at(0), head = at(1.9);
    if (feet.z > 1 || head.z > 1) return [];
    const tall = Math.max(24, feet.y - head.y);
    return [{ l: feet.x - tall * 0.38, r: feet.x + tall * 0.38, t: head.y - 8, b: feet.y + 8 }];
  }

  // The tags over the hotel showing now: as the tag layer placed them this frame when it says, else measured.
  const softRects = () => (tagBoxes ? tagBoxes().map(b => ({ l: b.l - 2, r: b.r + 2, t: b.t - 2, b: b.b + 2 })) : interfaceRects(doc, app, SOFT, 2));
  // The interface's boxes, measured once per look (the check under the card and a new place share them).
  let hardAt = -1, hardSel = null, hardBoxes = null;
  const hardRects = sel => {
    if (hardAt !== lastTick || hardSel !== sel) { hardAt = lastTick; hardSel = sel; hardBoxes = interfaceRects(doc, app, sel, PAD); }
    return hardBoxes;
  };
  const tooSoon = e => !!e && e.detail > 0 && cur && performance.now() - cur.at < T.guardMs;
  // When a button on the card was last pressed: the second tap of a double tap, which the card no longer
  // covers (it has gone, or shrunk), must not reach the hotel and open a door (swallowTap, main.js).
  let pressedAt = -Infinity;
  ui.ok.addEventListener('click', e => {
    e.preventDefault();
    if (tooSoon(e)) return;
    pressedAt = performance.now();
    putAway(pressedAt);
  });
  ui.hide.addEventListener('click', e => {
    e.preventDefault();
    if (tooSoon(e) || !cur) return;
    pressedAt = performance.now();
    settings.set('tips', 'off');
    queue.clear();
    // (a moment of "Tips are off" on the card itself, then it goes; the card is shorter now, so its edge
    // that faces what it explained stays where it was, the arrow still on it)
    const was = el.getBoundingClientRect();
    ui.title.textContent = TIPS_WORDS.hiddenTitle;
    ui.text.textContent = TIPS_WORDS.hidden;
    ui.actions.hidden = true;
    el.classList.add('bye');
    keepFacing(was);
    byeUntil = performance.now() + T.hiddenMs;
  });

  function rectOf(sel) {
    for (const e of doc.querySelectorAll(sel)) {
      if (!shown(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.height) return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2 };
    }
    return null;
  }

  // The places beside `a` on one side, nearest first: straight out from the thing (`p`, the arrow's
  // target) or along `a`'s edge, then a little further out.
  function* spots(side, a, p, w, h, W, H) {
    const along = side === 'above' || side === 'below';
    const line = along
      ? [p.cx - w / 2, a.l, a.r - w, p.cx - w / 2 - 60, p.cx - w / 2 + 60, p.cx - w / 2 - 130, p.cx - w / 2 + 130, p.cx - w / 2 - 220, p.cx - w / 2 + 220]
      : [p.cy - h / 2, a.t, a.b - h, p.cy - h / 2 - 40, p.cy - h / 2 + 40, p.cy - h / 2 - 90, p.cy - h / 2 + 90];
    const lo = EDGE, hi = (along ? W - w : H - h) - EDGE;
    for (let out = 0; out <= 160; out += 20) {
      const done = new Set();
      for (const raw of line) {
        const v = Math.round(Math.max(lo, Math.min(hi, raw)));
        if (done.has(v)) continue;
        done.add(v);
        let l, t;
        if (side === 'above') { l = v; t = a.t - GAP - h - out; }
        else if (side === 'below') { l = v; t = a.b + GAP + out; }
        else if (side === 'left') { t = v; l = a.l - GAP - w - out; }
        else { t = v; l = a.r + GAP + out; }
        if (l < EDGE || t < EDGE || l + w > W - EDGE || t + h > H - EDGE) continue;
        yield { l, t, r: l + w, b: t + h };
      }
    }
  }

  // Where the card can sit for `def` (keeping to side `prefer` if it can), or null if nowhere is clear.
  // Clear of the interface always; clear of the tags and the player's guest too, unless that would take
  // it noticeably further from what it explains (then near wins: its arrow must point at the right thing).
  // A spot from which the arrow cannot reach what it points at (it stays ARROW px inside the corners) is
  // taken only when no spot can.
  const NEAR = 60;
  const away = (box, p) => Math.hypot(Math.max(box.l - p.cx, 0, p.cx - box.r), Math.max(box.t - p.cy, 0, p.cy - box.b));
  function place(def, prefer = null) {
    const a = rectOf(def.at);
    if (!a) return null;
    const p = (def.point && rectOf(def.point)) || a;
    const W = doc.documentElement.clientWidth || innerWidth, H = doc.documentElement.clientHeight || innerHeight;
    const w = el.offsetWidth, h = el.offsetHeight;
    const hard = hardRects(def.clear || CLEAR);
    const soft = def.clear ? [] : [...softRects(), ...guestBox(W, H)];
    const sides = prefer ? [prefer, ...def.sides.filter(x => x !== prefer)] : def.sides;
    const reaches = (box, side) => (side === 'above' || side === 'below'
      ? box.l + ARROW < p.r && box.r - ARROW > p.l : box.t + ARROW < p.b && box.b - ARROW > p.t);
    let near = null, clean = null, far = null;
    for (const side of sides) {
      for (const box of spots(side, a, p, w, h, W, H)) {
        if (hard.some(o => overlaps(box, o))) continue;
        if (!reaches(box, side)) { far ||= { box, side }; continue; }
        near ||= { box, side };
        if (!soft.some(o => overlaps(box, o))) { clean = { box, side }; break; }
      }
      if (clean) break;
    }
    near ||= far;
    const pick = clean && (clean === near || away(clean.box, p) <= away(near.box, p) + NEAR) ? clean : near;
    return pick && { ...pick, p, a, clean: pick === clean };
  }

  // Put the card at `spot`, its arrow on the side facing what it explains.
  function setAt(spot, animate) {
    const { box, side, p } = spot;
    el.classList.toggle('moving', !!animate);
    el.style.translate = `${box.l}px ${box.t}px`;     // (moved by translate, not left/top: no layout while it glides)
    el.dataset.side = side;
    const w = box.r - box.l, h = box.b - box.t;
    const along = side === 'above' || side === 'below';
    const k = along ? Math.max(ARROW, Math.min(w - ARROW, p.cx - box.l)) : Math.max(ARROW, Math.min(h - ARROW, p.cy - box.t));
    el.style.setProperty('--tip-arrow', `${Math.round(k)}px`);
  }
  // The card on screen changed height (its words changed; `was`: its box before): the edge facing what it
  // explains stays put.
  function keepFacing(was) {
    if (!cur) return;
    const h = el.offsetHeight, b = { l: cur.box.l, r: cur.box.r, t: was.top, b: was.bottom };
    const t = cur.side === 'above' ? b.b - h : cur.side === 'below' ? b.t : Math.round((b.t + b.b - h) / 2);
    const p = (cur.def.point && rectOf(cur.def.point)) || rectOf(cur.def.at);
    cur.box = { l: b.l, r: b.r, t, b: t + h };
    if (p) setAt({ box: cur.box, side: cur.side, p }, false);
  }

  function show(entry, now, s) {
    const { def } = entry;
    const words = TIPS[def.id];
    if (!words) { queue.delete(def.id); return false; }
    if (!rectOf(def.at)) return false;             // (what it explains is not on screen now)
    ui.title.textContent = words.title;
    ui.text.textContent = words.text(rules, { practice: s.practice, possessed: !!s.me?.possessed });
    ui.actions.hidden = false;
    el.classList.remove('bye', 'moving');
    // (measured where nobody sees it, then placed)
    el.style.visibility = 'hidden';
    el.hidden = false;
    const spot = place(def);
    if (!spot) { el.hidden = true; el.style.visibility = ''; entry.retryAt = now + RETRY_MS; return false; }
    setAt(spot, false);
    el.style.visibility = '';
    el.style.setProperty('--tip-ms', `${T.showMs}ms`);
    el.classList.remove('in'); void el.offsetWidth; el.classList.add('in');
    queue.delete(def.id);
    cur = { def, at: now, side: spot.side, box: spot.box, anchor: spot.a, retryAt: 0 };
    seen.add(def.id); save();
    return true;
  }

  // Put the tip on screen away. `cut`: a screen opened over it, or its moment passed — if that came
  // too soon to read it, it is not counted as seen and comes back when it next comes up. (Not cut when
  // the screen that opened is the one it explains: see `done`.)
  function putAway(now, { cut = false, gap = T.gapMs } = {}) {
    if (!cur) return;
    if (cut && now - cur.at < T.seenMs) { seen.delete(cur.def.id); save(); if (cur.def.latch) queue.set(cur.def.id, { def: cur.def, at: now }); }
    cur = null;
    el.hidden = true;
    el.classList.remove('in', 'bye', 'moving');
    quietUntil = Math.max(quietUntil, now + gap);
  }

  // A new game: its own memory starts again; a tip still up from the last game goes.
  function newGame(s, now) {
    game = s.game;
    startedPossessed = !!s.me?.possessed;
    hand = new Set((s.me?.hand || []).filter(c => c.type !== 'possession').map(c => c.id));
    lanterns = (s.me?.hand || []).filter(c => c.type === 'lantern').length;
    heardAt = s.heard || 0;
    turnBegun = false;
    queue.clear();
    putAway(now, { cut: true, gap: T.settleMs });
  }

  return {
    // Called every frame by main.js; looks at the game a few times a second.
    update(now) {
      if (now - lastTick < TICK_MS) return;
      lastTick = now;
      const raw = situation();
      facts = raw ? Object.keys(raw) : [];
      if (byeUntil) {                              // ("Tips are off" on the card for a moment, then it goes)
        if (now >= byeUntil || !raw?.on || raw.covered) { byeUntil = 0; putAway(now); }
        return;
      }
      if (!raw?.on || !raw.me) { putAway(now, { cut: true, gap: T.settleMs }); return; }
      if (raw.game !== game) newGame(raw, now);
      if (settings.get('tips') === 'off') { queue.clear(); putAway(now); return; }
      const me = raw.me;
      self = raw.self || null;
      // What has just happened to the player's own hand (their own cards only).
      const ids = me.hand.filter(c => c.type !== 'possession').map(c => c.id);
      const gained = ids.some(id => !hand.has(id));
      const lit = me.hand.filter(c => c.type === 'lantern').length;
      const lanternGained = lit > lanterns;
      hand = new Set(ids); lanterns = lit;
      if (raw.myTurn) turnBegun = true;
      const s = { ...raw, match: !raw.practice, startedPossessed, gained, lanternGained, turnBegun, heard: (raw.heard || 0) > heardAt };
      // Tips that come up now join the queue; ones whose moment has passed leave it.
      for (const def of DEFS) {
        if (seen.has(def.id) || queue.has(def.id) || cur?.def === def) continue;
        if (def.when(s)) queue.set(def.id, { def, at: now });
      }
      for (const [id, q] of queue) {
        if (q.def.latch ? now - q.at > T.staleMs : !q.def.when(s)) queue.delete(id);
      }
      // A screen over the game: no tip until it has gone (and a moment after).
      const blocked = s.covered;
      const fits = def => (def.meeting ? s.meeting : !s.meeting);
      if (blocked) quietUntil = Math.max(quietUntil, now + T.settleMs);
      if (cur) {
        const still = !blocked && fits(cur.def) && (cur.def.latch || cur.def.when(s));
        const anchor = still && rectOf(cur.def.at);
        if (!anchor) putAway(now, { cut: !cur.def.done?.(s) });
        else if (now - cur.at >= T.showMs) putAway(now);
        else if (now - cur.at >= T.yieldMs && [...queue.values()].some(q => q.def.now && fits(q.def))) putAway(now, { gap: 300 });
        else {
          // Keep it beside the thing it explains: placed again if that moved, or if something now
          // showing (a toast, the Move bar) would be under it — with no clear place left it goes — or,
          // if there is a place just as good clear of them, off a "Go" / "Explore" tag that came up.
          const moved = Math.abs(anchor.l - cur.anchor.l) > 6 || Math.abs(anchor.t - cur.anchor.t) > 6
            || Math.abs(anchor.r - cur.anchor.r) > 6 || Math.abs(anchor.b - cur.anchor.b) > 6;
          const under = hardRects(cur.def.clear || CLEAR).some(o => overlaps(cur.box, o));
          const W = doc.documentElement.clientWidth || innerWidth, H = doc.documentElement.clientHeight || innerHeight;
          // (on a tag with no clean place last time: it looks again only after a while)
          const onTag = !cur.def.clear && now >= cur.retryAt && [...softRects(), ...guestBox(W, H)].some(o => overlaps(cur.box, o));
          if (moved || under || onTag) {
            const spot = place(cur.def, cur.side);
            if (!spot) { if (moved || under) putAway(now, { cut: true }); else cur.retryAt = now + RETRY_MS; }
            else if (moved || under || spot.clean) { setAt(spot, true); cur.side = spot.side; cur.box = spot.box; cur.anchor = spot.a; cur.retryAt = 0; }
            else cur.retryAt = now + RETRY_MS;
          }
        }
      }
      if (cur || blocked || now < quietUntil || !queue.size) return;
      const waiting = [...queue.values()].filter(q => fits(q.def)).sort((x, y) => x.def.prio - y.def.prio || x.at - y.at);
      for (const q of waiting) if (now >= (q.retryAt || 0) && show(q, now, s)) return;
    },
    // A tap on the hotel just after a button on the card was pressed does nothing (main.js onTap).
    swallowTap() { return performance.now() - pressedAt < T.guardMs; },
    // (tests) the tip on screen, the ones waiting, the ones seen on this device, what the tips are told
    debug() {
      return {
        showing: cur?.def.id ?? null, side: cur?.side ?? null,
        box: cur ? { ...cur.box } : null, queued: [...queue.keys()], seen: [...seen], facts: [...facts],
      };
    },
  };
}
