// The search icon: a brass magnifier badge floating just above the piece of furniture that holds the
// room's search spot (the one flagged `search: true` in src/data/hotel.js). It is how a guest
// searches — there is no Search button. Tapping it asks main.js to walk there and search.
//
// It is one DOM button positioned over the canvas: crisp at any size and easy to tap. Each frame
// only its transform is written (and only when it moved); its look changes only when its state does.
// What it shows comes from the rules (`searchLeft`, `canSearch`); nothing here decides a rule.
//
//   live   the room can be searched now — the badge gently pulses
//   dark   too dark without a Flashlight — dimmed, with a small flashlight hint
//   ap     no action points left — dimmed
//   empty  nothing left in the deck — dimmed
// No icon at all where there is nothing to search (the lobby, the exit, a searched room).
import * as THREE from 'three';
import { canSearch, searchLeft } from '../game/actions.js';
import { searchSpotOf } from '../game/hotel.js';

const LIFT = 0.45;            // metres above the top of the furniture
const MAGNIFIER = `<svg viewBox="0 0 48 48" aria-hidden="true" class="ss-glass">
  <circle cx="20" cy="20" r="11.5" fill="rgba(255,248,230,0.35)" stroke="currentColor" stroke-width="4.2"/>
  <path d="M14.5 16.5a7 7 0 0 1 5-4.2" fill="none" stroke="#fffaf0" stroke-width="2.4" stroke-linecap="round" opacity="0.9"/>
  <path d="M28.6 28.6 38.5 38.5" stroke="currentColor" stroke-width="6.2" stroke-linecap="round"/>
</svg>`;
const FLASHLIGHT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h8.5l3.5-3v11l-3.5-3H4z" fill="currentColor"/>
  <path d="M18.5 8.5l2.5-1.5M19 12h3M18.5 15.5l2.5 1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;
const CAPTION = { live: 'Search', dark: 'Need a Flashlight', ap: 'No actions left', empty: 'Nothing left' };

export function createSearchSpot(doc, { camera, container, floor, state, onTap }) {
  const el = doc.createElement('button');
  el.type = 'button';
  el.id = 'search-spot';
  el.className = 'search-spot';
  el.hidden = true;
  el.innerHTML = `<span class="ss-badge">${MAGNIFIER}<span class="ss-hint">${FLASHLIGHT}</span></span><span class="ss-caption"></span>`;
  const caption = el.querySelector('.ss-caption');
  (doc.getElementById('hud') || container).appendChild(el);
  el.addEventListener('click', e => { e.preventDefault(); onTap(); });

  const v = new THREE.Vector3();
  let width = container.clientWidth, height = container.clientHeight;
  let limits = { top: 96, bottom: height - 170 };
  const measure = () => {
    width = container.clientWidth; height = container.clientHeight;
    // Keep the icon between the top strip and the hand fan, so it never sits under either.
    const strip = doc.querySelector('.hud-top-center');
    const fan = doc.getElementById('hand-fan');
    const top = strip && !strip.hidden ? strip.getBoundingClientRect().bottom : 60;
    const fanTop = fan && fan.offsetParent ? fan.getBoundingClientRect().top : height - 150;
    limits = { top: Math.max(70, top) + 64, bottom: Math.min(height - 150, fanTop - 8) };
  };
  window.addEventListener('resize', measure);

  let key = '';         // last look written (state + room)
  let tx = NaN, ty = NaN;
  let spot = null, mode = null, roomId = null;

  function setMode(next, room, dimReason) {
    const k = `${next}|${room?.id ?? ''}`;
    if (k === key) return;
    key = k;
    mode = next;
    el.hidden = !next;
    if (!next) return;
    el.className = `search-spot ${next}`;
    caption.textContent = CAPTION[next] || '';
    const where = room?.searchPoint || 'the room';
    el.setAttribute('aria-label', next === 'live' ? `Search ${where}` : `Search ${where} — ${dimReason}`);
    measure();
    tx = ty = NaN;   // re-place at once
  }

  return {
    // Every frame. `active` is the guest whose turn it is; `show` is false whenever the icon must not
    // be up at all (not their action phase, a walk into another room still settling, a screen over it).
    update(active, show) {
      const room = show ? floor.rooms.get(active.currentRoom) : null;
      if (!room || !searchLeft(state, room)) { spot = null; roomId = null; setMode(null); return; }
      if (roomId !== room.id) { roomId = room.id; spot = searchSpotOf(room); }
      if (!spot) { setMode(null); return; }
      const gate = canSearch(state, floor, active);
      const next = gate.ok ? 'live' : gate.reason === 'dark' ? 'dark' : gate.reason === 'ap' ? 'ap' : gate.reason === 'empty' ? 'empty' : null;
      setMode(next, room, CAPTION[next]);
      if (!next) return;
      v.set(spot.center[0], spot.size[1] + LIFT, spot.center[1]).project(camera);
      if (v.z > 1) { el.style.visibility = 'hidden'; tx = NaN; return; }
      el.style.visibility = '';
      const x = Math.round(Math.min(width - 44, Math.max(44, (v.x + 1) / 2 * width)));
      const y = Math.round(Math.min(limits.bottom, Math.max(limits.top, (1 - v.y) / 2 * height)));
      if (x === tx && y === ty) return;
      tx = x; ty = y;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    },
    measure,
    get mode() { return el.hidden ? null : mode; },
    // Screen point the badge's tip marks (tests).
    get point() { return el.hidden ? null : { x: tx, y: ty }; },
    get spot() { return spot; },
  };
}
