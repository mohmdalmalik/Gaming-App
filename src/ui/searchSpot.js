// The room action icon: a round brass badge floating just above the piece of furniture where a room's
// action is done. Four kinds (the table KINDS below): the magnifier, in a room that can be searched (the piece
// flagged `search: true` in src/data/hotel.js; there is no Search button); the door-with-an-arrow in the Fire Exit
// (leaving the hotel; there is no Escape button); the cross in an Infirmary (heal); the headset in the Switchboard
// (ring it). The Infirmary and the Switchboard cannot be searched (their action takes the search's place), so the
// magnifier is not shown there: the room's own icon is, on the same furniture. Tapping an icon asks main.js to do
// that kind's action: a guest searches (or heals, or rings) from where they stand, in the middle of the room
// (docs/GAME_RULES.md > Turn), and only turns to face the furniture.
//
// It is one DOM button positioned over the canvas: crisp at any size and easy to tap. Each frame
// only its transform is written (and only when it moved); its look changes only when its state does.
// What it shows comes from the rules (`searchLeft`, `canSearch`, `canEscape`, `canUseRoom`); nothing here decides a rule.
//
// To add a kind: one entry in KINDS (the drawing, the furniture it rests on, when it is offered, its looks and their
// words), the colours of its looks in styles.css (the "exiticon" and "rooms" blocks at the end show how: one class per
// look), and its tap in main.js (the `onTap` table). Where it sits, its size, tap area, tag text, press and hover, and its
// sound (a button's click) are the same for every kind.
//
// Looks (the state of the icon: its class, its colours, the words under the badge):
//   search  live   the room can be searched now — the badge gently pulses
//           dark   too dark without a Flashlight — dimmed, with a small flashlight hint
//           ap     no actions left — dimmed
//           empty  nothing left in the deck — dimmed
//   exit    ready  this guest can leave now — green, the badge gently pulses
//           grey   they cannot (too few Lanterns, or the Fire Exit will not open for them) — dimmed, still tappable
//           ap     no actions left — dimmed
//   heal    live   an Infirmary nobody has used, and the guest is hurt — the badge gently pulses
//           full   they are at full health — dimmed, still tappable; nothing is spent (a tap says why)
//           spent  somebody has used this Infirmary already (it works once per match, for everyone) — dimmed, with a tick
//           ap     no actions left — dimmed
//   switchboard   live   the guest can pay for a ring — the badge gently pulses (and again after each ring, while they can pay)
//                 ap     too few actions left — dimmed
// No icon at all where there is nothing to do (the lobby, a searched room). The Fire Exit's icon is shown to EVERY guest
// standing there, grey or green, and its words are the same for all of them: a guest the exit will not open
// for (a possessed one) sees what a clean guest short of Lanterns sees, and nothing here says why (main.js
// onEscape says what a tap on grey says). The Infirmary's and the Switchboard's icons are the active guest's own, on
// their own screen, in their own turn; what they say (health, actions, "used") is public anyway.
//
// A room can offer two things at once: an Infirmary or the Switchboard with a dead guest's cards lying on its floor
// (picking them up is an ordinary search). Then both icons show side by side: the room's action on the furniture, the
// magnifier in the nearest clear place beside it (a second button, `#search-spot-2`; never over the first).
//
// Where it sits: on the furniture — the badge's foot rests on the piece's room-facing edge, at its top
// (or at chest height on a tall piece, like the Fire Exit's door). It never covers the interface: the top bar, the player panel,
// the hand, the rotate / centre / Map / End turn buttons, the Move-Cancel bar, a toast, the
// path tag or an "Explore" tag over a fogged room. If its spot is taken (or the furniture is off the screen), it moves to the
// nearest clear place — kept whole on screen, caption included — and a small brass arrow on the badge
// points at the furniture. If there is no clear place at all, it hides until there is.
import * as THREE from 'three';
import { canSearch, searchLeft, canUseRoom } from '../game/actions.js';
import { canEscape } from '../game/state.js';
import { searchSpotOf } from '../game/hotel.js';
import { rules } from '../data/rules.js';
import { xraySpot } from '../render/xray.js';
import { actionsWord } from './actionsWord.js';

const TALL = 1.1;             // on a piece taller than this the icon sits on its front, at this height
const LIFT = 0.06;            // metres above that point
// Parts of the interface the icon must stay clear of (whichever are showing).
const HUD = ['.hud-top-left', '.hud-top-center', '.hud-top-right', '#player-panel', '.hud-bottom-right',
  '#btn-trade', '#btn-end-turn', '#confirm-bar', '#toast', '.path-label', '.fog-label', '#hand-fan .fan-card'];
const MAGNIFIER = `<svg viewBox="0 0 48 48" aria-hidden="true" class="ss-glass">
  <circle cx="20" cy="20" r="11.5" fill="rgba(255,248,230,0.35)" stroke="currentColor" stroke-width="4.2"/>
  <path d="M14.5 16.5a7 7 0 0 1 5-4.2" fill="none" stroke="#fffaf0" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>
  <path d="M28.6 28.6 38.5 38.5" stroke="currentColor" stroke-width="6.2" stroke-linecap="round"/>
</svg>`;
// A doorway with its door standing open (the leaf in perspective, a knob) and an arrow going out through it.
const DOOR = `<svg viewBox="0 0 48 48" aria-hidden="true" class="ss-glass">
  <path d="M10 6.5h14.5v35H10z" fill="rgba(255,248,230,0.35)" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>
  <path d="M10 6.5 22 10v31l-12 .5z" fill="currentColor" opacity="0.8"/>
  <circle cx="19" cy="25" r="1.7" fill="#e8fff0"/>
  <path d="M27 24H42M36 17 42.5 24 36 31" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
// A plain medical cross with soft corners and a pale glint along its top-left arms (red on the live badge; styles.css).
const CROSS = `<svg viewBox="0 0 48 48" aria-hidden="true" class="ss-glass">
  <path d="M18 7h12v11h11v12H30v11H18V30H7V18h11z" fill="currentColor" stroke="currentColor" stroke-width="3.4" stroke-linejoin="round"/>
  <path d="M20.4 13.5v7.4h-7.2M20.4 13.5h5" fill="none" stroke="#fffaf0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
</svg>`;
// An operator's headset: the band over the head, two ear cups and the microphone on its arm.
const HEADSET = `<svg viewBox="0 0 48 48" aria-hidden="true" class="ss-glass">
  <path d="M10 27v-5a14 14 0 0 1 28 0v5" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round"/>
  <rect x="5.5" y="25" width="10" height="14" rx="4" fill="currentColor"/>
  <rect x="32.5" y="25" width="10" height="14" rx="4" fill="currentColor"/>
  <path d="M10.5 28.5v4.5" stroke="#fffaf0" stroke-width="2" stroke-linecap="round" opacity="0.8"/>
  <path d="M37.5 39c0 4-3.4 6-9.5 6" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>
  <circle cx="26" cy="45" r="2.7" fill="currentColor"/>
</svg>`;
// A torch seen side-on, pointing up and to the right: a long ribbed handle, a slightly wider head, a
// bright lens and a pale beam (the old hint, a cone on a short body, read as a megaphone).
const FLASHLIGHT = `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:21px;height:21px"><g transform="rotate(-38 12 12)">
  <path d="M15.6 9.6 24.5 5.2v13.6l-8.9-4.4z" fill="#fff0bf" opacity="0.62"/>
  <rect x="0.8" y="9.9" width="9.6" height="4.2" rx="1.2" fill="currentColor"/>
  <path d="M3.4 10.2v3.6M5.4 10.2v3.6M7.4 10.2v3.6" stroke="#1b1c24" stroke-width="0.9"/>
  <rect x="10" y="8.9" width="4.8" height="6.2" rx="0.9" fill="currentColor"/>
  <rect x="14.6" y="9.3" width="1.5" height="5.4" rx="0.5" fill="#fff6d6"/></g></svg>`;
// The tick on a spent Infirmary's badge ("this is done").
const TICK = `<svg viewBox="0 0 16 16" aria-hidden="true" width="16" height="16"><path d="M3.2 8.6 6.6 12 12.8 4.4" fill="none" stroke="#0d4326" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// The arrow shown on the badge's rim when the icon had to move away from its furniture.
const ARROW = `<svg viewBox="0 0 16 16" aria-hidden="true" width="16" height="16"><path d="M2 3 14 8 2 13 5 8z" fill="#e8ca80" stroke="#1b1408" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

// The furniture a room's action rests on: the piece flagged as its search spot (an Infirmary and the Switchboard keep
// that piece for their icon), or the middle of the room if it has none.
const pieceOf = room => searchSpotOf(room) || { center: room.center, size: [0.2, 0.9, 0.2] };

// The kinds of room action, one entry each (in the order they are tried for a room: the room's own action first, the
// search last, so a room that offers both puts the action on the furniture and the search beside it):
//   icon      the drawing on the badge (an <svg class="ss-glass">, `currentColor` for the strokes)
//   piece     (room) the furniture the icon rests on in that room, or null if it has none (looked up once per room)
//   offered   (state, room) whether the room has something of this kind to do now (a searched room has no more to search)
//   look      (state, floor, player) the guest's look right now: a key of `looks`, or null for no icon
//   looks     { look: the words under the badge (a string, or a function for numbers read from the rules) }
//   label     (room, look) what a screen reader says
//   hidesWhenWalking   optional: the icon is down while the guest is walking (the exit, the Infirmary, the Switchboard: for standing in the room)
const KINDS = {
  // The Fire Exit: leave the hotel (1 action, a clean guest carrying the Lanterns). It rests on the exit's door (or, if a
  // Fire Exit has none, in the middle of the room). It is there for everyone standing in the room; green or grey is
  // the only difference, and the words are the same for both.
  exit: {
    icon: DOOR,
    hidesWhenWalking: true,
    piece: room => (room.isExit ? room.furniture.find(f => f.kind === 'exitDoor') || { center: room.center, size: [0.2, 0.9, 0.2] } : null),
    offered: (state, room) => !!room.isExit,
    look: (state, floor, player) => (player.actionPoints < rules.actionCost.escape ? 'ap' : canEscape(state, floor, player) ? 'ready' : 'grey'),
    looks: {
      ready: () => `Exit the hotel · ${actionsWord(rules.actionCost.escape)}`,
      grey: () => `Exit the hotel · ${actionsWord(rules.actionCost.escape)}`,
      ap: 'No actions left',
    },
    label: (room, look) => (look === 'ready' ? `Exit the hotel, ${actionsWord(rules.actionCost.escape)}` : look === 'ap' ? 'Exit the hotel — No actions left' : 'Exit the hotel — you cannot leave yet'),
  },
  // An Infirmary: heal (1 action, 2 health), once per match for the whole table: the first guest to use it spends it for
  // everyone. A guest at full health is refused without spending it (grey, not spent). It rests on the medicine cabinet.
  heal: {
    icon: CROSS,
    hidesWhenWalking: true,
    piece: room => (room.job === 'infirmary' ? pieceOf(room) : null),
    offered: (state, room) => room.job === 'infirmary',
    look(state, floor, player) {
      const gate = canUseRoom(state, floor, player);
      return gate.ok ? 'live' : gate.reason === 'spent' || gate.reason === 'full' || gate.reason === 'ap' ? gate.reason : null;
    },
    looks: { live: () => `Heal · ${actionsWord(rules.actionCost.infirmary)}`, full: 'Full health', spent: 'Already used', ap: 'No actions left' },
    label(room, look) {
      return look === 'live' ? `Heal, ${actionsWord(rules.actionCost.infirmary)}`
        : look === 'spent' ? 'This Infirmary has already been used' : `Heal — ${this.looks[look]}`;
    },
  },
  // The Switchboard: ring it (2 actions, as often as the guest can pay) to tell the table how many guests are possessed.
  // It rests on the operator's desk.
  switchboard: {
    icon: HEADSET,
    hidesWhenWalking: true,
    piece: room => (room.job === 'switchboard' ? pieceOf(room) : null),
    offered: (state, room) => room.job === 'switchboard',
    look(state, floor, player) {
      const gate = canUseRoom(state, floor, player);
      return gate.ok ? 'live' : gate.reason === 'ap' ? 'ap' : null;
    },
    looks: { live: () => `Switchboard · ${actionsWord(rules.actionCost.switchboard)}`, ap: () => `Needs ${actionsWord(rules.actionCost.switchboard)}` },
    label: (room, look) => (look === 'live' ? `Ring the Switchboard, ${actionsWord(rules.actionCost.switchboard)}` : `Ring the Switchboard — needs ${actionsWord(rules.actionCost.switchboard)}`),
  },
  search: {
    icon: MAGNIFIER,
    piece: room => searchSpotOf(room),
    offered: (state, room) => searchLeft(state, room),
    look(state, floor, player) {
      const gate = canSearch(state, floor, player);
      return gate.ok ? 'live' : gate.reason === 'dark' || gate.reason === 'ap' || gate.reason === 'empty' ? gate.reason : null;
    },
    looks: { live: 'Search', dark: 'Need a Flashlight', ap: 'No actions left', empty: 'Nothing left' },
    label(room, look) { const where = room.searchPoint || 'the room'; return look === 'live' ? `Search ${where}` : `Search ${where} — ${this.looks[look]}`; },
  },
};
const LIST = Object.keys(KINDS).map(name => ({ name, ...KINDS[name] }));   // (a plain list, so a frame loops over it without making anything)
const SLOTS = 2;              // the icons one room can show at once: its action, and a search beside it

export function createSearchSpot(doc, { camera, container, floor, state, onTap }) {
  const parent = doc.getElementById('hud') || container;
  const v = new THREE.Vector3();
  let width = container.clientWidth, height = container.clientHeight;
  let blocked = [];     // screen rectangles the icons must not cover (refreshed every few frames)
  let frame = 0;
  const shown = e => e && !e.hidden && !e.closest('[hidden]') && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';

  // The interface on screen right now.
  function collect() {
    blocked = [];
    const cr = container.getBoundingClientRect();
    for (const sel of HUD) {
      for (const e of doc.querySelectorAll(sel)) {
        if (!shown(e)) continue;
        const r = e.getBoundingClientRect();
        if (r.width && r.height) blocked.push({ l: r.left - cr.left - 6, r: r.right - cr.left + 6, t: r.top - cr.top - 6, b: r.bottom - cr.top + 6 });
      }
    }
  }
  // Is an icon of extent `box` centred on (x, y) wholly on screen, clear of the interface and of `other` (the rectangle of
  // the icon beside it, or null)?
  const free = (x, y, box, other) => {
    if (x - box.l < 4 || x + box.r > width - 4 || y - box.t < 4 || y + box.b > height - 4) return false;
    for (const q of blocked) if (x - box.l < q.r && x + box.r > q.l && y - box.t < q.b && y + box.b > q.t) return false;
    return !(other && x - box.l < other.r && x + box.r > other.l && y - box.t < other.b && y + box.b > other.t);
  };
  // The clear place nearest to (x, y), or null.
  function place(x, y, box, other) {
    if (free(x, y, box, other)) return { x, y };
    const cx = Math.min(width - box.r - 4, Math.max(box.l + 4, x)), cy = Math.min(height - box.b - 4, Math.max(box.t + 4, y));
    let best = null, bestD = Infinity;
    const lean = other ? 2.4 : 1.2;   // (prefer sliding sideways a little over up or down; beside another icon, a good deal: below it lies the guest)
    for (let dy = -420; dy <= 420; dy += 12) {
      for (let dx = -480; dx <= 480; dx += 16) {
        const d = Math.hypot(dx, dy * lean);
        if (d >= bestD) continue;
        if (free(cx + dx, cy + dy, box, other)) { best = { x: cx + dx, y: cy + dy }; bestD = d; }
      }
    }
    return best;
  }

  // The point on the furniture the icon rests on: its edge facing the middle of the room, on top
  // (or at chest height on a tall piece: a bookcase, a desk with a switchboard behind it, the exit's door).
  function anchorOf(f, room) {
    const [cx, cz] = f.center, hx = f.size[0] / 2, hz = f.size[2] / 2;
    const x = Math.min(cx + hx - 0.12, Math.max(cx - hx + 0.12, room.center[0]));
    const z = Math.min(cz + hz - 0.12, Math.max(cz - hz + 0.12, room.center[1]));
    return [x, Math.min(f.size[1], TALL) + LIFT, z];
  }

  // One icon: a button with its badge, caption, tick (a spent Infirmary) and arrow. The second one (`#search-spot-2`) is the
  // same button; it only shows when a room offers a search beside its own action.
  function makeIcon(id) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.id = id;
    el.className = 'search-spot';
    el.hidden = true;
    el.innerHTML = `<span class="ss-badge"><span class="ss-hint">${FLASHLIGHT}</span></span><span class="ss-caption"></span>`
      + `<span class="ss-tick">${TICK}</span>`
      + `<span class="ss-arrow" style="position:absolute;left:50%;top:30px;width:0;height:0;display:none;pointer-events:none">`
      + `<span style="position:absolute;left:-8px;top:-8px;width:16px;height:16px;transform:translateX(39px)">${ARROW}</span></span>`;
    const badge = el.querySelector('.ss-badge');
    const caption = el.querySelector('.ss-caption');
    const arrow = el.querySelector('.ss-arrow');
    parent.appendChild(el);
    let kind = null;      // the kind showing now (an entry of LIST)
    let mode = null;      // its look
    let key = '';         // last look written (kind + look + room)
    let glyphOf = '';     // the kind whose drawing is on the badge
    let box = { l: 40, r: 40, t: 34, b: 60 };   // the icon's extent around its badge centre, caption included
    let tx = NaN, ty = NaN, ax = NaN, ay = NaN, arrowAt = null, hidden = false;
    let spot = null, anchor = null;
    let moves = 0, seen = 0;                    // (how often this icon's place changed; the value of the neighbour's count it was last placed against)
    const rect = { l: 0, r: 0, t: 0, b: 0, on: false };   // where it is now, for the icon beside it
    // `onTap`: { kind: function } — what a tap does for each kind (main.js).
    el.addEventListener('click', e => { e.preventDefault(); if (kind) onTap[kind.name]?.(); });

    const measure = () => {
      const cw = Math.max(64, caption.offsetWidth || 0);
      box = { l: Math.max(34, cw / 2) + 4, r: Math.max(34, cw / 2) + 4, t: 36, b: 60 };
    };

    // Show `next` in `look` (null: hide it). True when what it shows changed.
    function setMode(next, look, room) {
      const k = next ? `${next.name}|${look}|${room?.id ?? ''}` : '';
      if (k === key) return false;
      key = k;
      kind = next;
      mode = next ? look : null;
      el.hidden = !next;
      moves++; rect.on = false;
      if (!next) return true;
      if (glyphOf !== next.name) {       // (another kind: its drawing on the badge)
        glyphOf = next.name;
        badge.querySelector('.ss-glass')?.remove();
        badge.insertAdjacentHTML('afterbegin', next.icon);
      }
      el.className = `search-spot ${next.name} ${look}`;
      el.dataset.kind = next.name;
      const words = next.looks[look];
      caption.textContent = (typeof words === 'function' ? words() : words) || '';
      el.setAttribute('aria-label', next.label(room, look));
      measure();
      tx = ty = ax = ay = NaN;   // re-place at once
      return true;
    }

    return {
      el, measure, rect,
      // Every frame: this icon is of kind `next` on the furniture `at` of `room` (or null for none) for the guest `active`.
      // True when its look changed.
      show(next, at, room, active, walking) {
        if (!next) { spot = null; return setMode(null); }
        if (at !== spot) { spot = at; anchor = anchorOf(spot, room); }
        const look = next.hidesWhenWalking && walking ? null : next.look(state, floor, active);
        return setMode(look ? next : null, look, room);
      },
      // Every frame it is up: put it where the furniture is on screen (the badge's foot rests on that point), in the nearest
      // clear place if that is taken. `fresh`: the interface was just measured. `beside`: the icon next to this one, or null.
      place(fresh, beside) {
        v.set(anchor[0], anchor[1], anchor[2]).project(camera);
        const behind = v.z > 1;
        const px = behind ? width / 2 : (v.x + 1) / 2 * width, py = behind ? height : (1 - v.y) / 2 * height;
        const wantX = Math.round(px), wantY = Math.round(py - 34);
        const moved = Math.abs(wantX - ax) > 1 || Math.abs(wantY - ay) > 1;
        const near = beside ? beside.moves : 0;
        if (!fresh && !moved && near === seen) return;
        seen = near;
        ax = wantX; ay = wantY;
        const here = place(wantX, wantY, box, beside?.rect.on ? beside.rect : null);
        hidden = !here;
        el.style.visibility = here ? '' : 'hidden';
        if (!here) { tx = ty = NaN; if (rect.on) { rect.on = false; moves++; } return; }
        // moved off its furniture: a small arrow on the badge's rim points back at it
        const off = Math.hypot(here.x - wantX, here.y - wantY) > 40 || behind;
        const ang = off ? Math.round(Math.atan2(py - here.y, px - here.x) * 180 / Math.PI) : null;
        if (ang !== arrowAt) {
          arrowAt = ang;
          arrow.style.display = off ? 'block' : 'none';
          if (off) arrow.style.transform = `rotate(${ang}deg)`;
        }
        if (here.x === tx && here.y === ty) return;
        tx = here.x; ty = here.y;
        el.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
        rect.l = tx - box.l - 6; rect.r = tx + box.r + 6; rect.t = ty - box.t - 6; rect.b = ty + box.b + 6; rect.on = true;
        moves++;
      },
      get moves() { return moves; },
      get up() { return !el.hidden; },
      get mode() { return el.hidden ? null : mode; },
      get kind() { return el.hidden || !kind ? null : kind.name; },
      get point() { return el.hidden || hidden ? null : { x: tx, y: ty }; },
      get anchor() { return el.hidden ? null : { x: ax, y: ay + 34 }; },
      get displaced() { return arrowAt !== null; },
      get spot() { return spot; },
    };
  }

  const icons = [makeIcon('search-spot'), makeIcon('search-spot-2')];
  const measure = () => {
    width = container.clientWidth; height = container.clientHeight;
    for (const i of icons) i.measure();
  };
  window.addEventListener('resize', measure);

  // The room the guest stands in, and (for each kind, in LIST order) the furniture the icon would rest on there.
  let inRoom = null;
  const pieces = LIST.map(() => null);
  const picked = icons.map(() => null), pickedAt = icons.map(() => null);   // the kinds this room shows now, and their furniture

  return {
    // Every frame. `active` is the guest whose turn it is; `show` is false whenever the icon must not
    // be up at all (not their action phase, a walk into another room still settling, a screen over it).
    // `walking`: the guest is on a walk now (a kind with `hidesWhenWalking` is down until they have arrived).
    update(active, show, walking = false) {
      const room = show ? floor.rooms.get(active.currentRoom) : null;
      if (room !== inRoom) { inRoom = room; for (let i = 0; i < LIST.length; i++) pieces[i] = room ? LIST[i].piece(room) : null; }
      // the kinds this room offers (and has furniture for): the first is on the first icon, a second one on the second
      let n = 0;
      if (room) for (let i = 0; i < LIST.length && n < SLOTS; i++) if (pieces[i] && LIST[i].offered(state, room)) { picked[n] = LIST[i]; pickedAt[n] = pieces[i]; n++; }
      let changed = false;
      for (let s = 0; s < SLOTS; s++) changed = icons[s].show(s < n ? picked[s] : null, s < n ? pickedAt[s] : null, room, active, walking) || changed;
      if (changed) frame = 0;
      xraySpot(icons[0].up ? icons[0].spot : null);   // nothing in the next room may hide this furniture (xray.js)
      if (!icons[0].up && !icons[1].up) return;
      const fresh = frame++ % 4 === 0;
      if (fresh) collect();
      if (icons[0].up) icons[0].place(fresh, null);
      if (icons[1].up) icons[1].place(fresh, icons[0]);
    },
    measure,
    // The look the first icon shows now ('live', 'dark', 'ap', 'empty' for a search; 'ready', 'grey', 'ap' for the exit;
    // 'live', 'full', 'spent', 'ap' for an Infirmary; 'live', 'ap' for the Switchboard), or null.
    get mode() { return icons[0].mode; },
    // Which kind of room action the first icon shows ('search', 'exit', 'heal', 'switchboard'), or null.
    get kind() { return icons[0].kind; },
    // Screen point of the badge's centre, the furniture point it rests on, and whether it had to
    // move away from it (tests).
    get point() { return icons[0].point; },
    get anchor() { return icons[0].anchor; },
    get displaced() { return icons[0].displaced; },
    get spot() { return icons[0].spot; },
    // The second icon (a search beside the room's own action: a dead guest's cards in an Infirmary or the Switchboard), or null (tests).
    get second() { const i = icons[1]; return i.up ? { kind: i.kind, mode: i.mode, point: i.point, displaced: i.displaced } : null; },
  };
}
