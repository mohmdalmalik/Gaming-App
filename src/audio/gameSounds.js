// The sounds of the hotel during a game, without touching the game code. Every frame it reads what
// the engine has just announced to the WHOLE table (state.events: a door opened, a search, an attack,
// the Switchboard...) and plays the matching cue: full for the player's own actions, quieter and to
// the side for a guest further away. It also plays the footsteps of whoever is walking, on the floor
// of the room they are in. Private results (what a search found, a trade) are cued by the screens
// that show them, so a sound never tells anyone more than the table already knows.
//
//   const sounds = createGameSounds({ state, humanSeat, positionOf, listener, panOf, mover, walkPhase });
//   (walkPhase(i): { phase 0..1, stride m } of guest i's walk animation, or null)
//   sounds.update(running);     // each frame
import { sfx } from './bus.js';
import { FLOORS } from './sounds.js';

const ONE_SHOT = {
  open: e => (e.jammed ? 'doorJammed' : 'doorOpen'),
  search: () => 'search',
  unlock: e => (e.opened ? 'unlock' : 'lockFail'),
  barricade: () => 'barricade',
  infirmary: () => 'infirmary',
  switchboard: () => 'switchboard',
  mirror: () => 'mirror',
  escape: () => 'escape',
};
const WEAPON = { knife: 'knife', revolver: 'revolver' };
const seatOf = e => e.seat ?? e.by ?? e.a ?? null;

export function createGameSounds({ state, humanSeat, positionOf, listener, panOf, mover, walkPhase, skipAttack = () => false }) {
  let list = null;
  let idx = 0;
  let lastSeq = 0;
  const steps = { seat: -1, phase: null, dist: 0, x: 0, z: 0 };

  // How a guest's action sounds from where the view is: [volume, pan].
  function where(seat) {
    if (seat === humanSeat()) return [1, 0];
    const p = positionOf(seat);
    const l = listener();
    if (!p || !l) return [0.5, 0];
    const d = Math.hypot(p[0] - l[0], p[1] - l[1]);
    const vol = Math.max(0.16, Math.min(0.8, 0.95 / (1 + Math.max(0, d - 3) / 7)));
    return [vol, Math.max(-0.7, Math.min(0.7, (panOf?.(p[0], p[1]) ?? 0) * 0.7))];
  }

  function onEvent(e) {
    const make = ONE_SHOT[e.type];
    if (make) {
      const [volume, pan] = where(seatOf(e));
      sfx(make(e), { volume, pan });
      return;
    }
    if (e.type === 'relock') { sfx('doorLocked', { volume: 0.35 }); return; }
    if (e.type === 'attack') {
      if (skipAttack(e)) return;
      const mine = e.by === humanSeat() || e.target === humanSeat();
      const [v, pan] = where(e.by);
      const volume = mine ? 1 : v;
      sfx(WEAPON[e.weapon] || 'knife', { volume, pan });
      sfx(e.killed ? 'death' : 'hurt', { volume: volume * (e.killed ? 1 : 0.85), pan, delay: e.weapon === 'revolver' ? 0.3 : 0.2 });
    }
  }

  function reset() {
    list = state.events;
    idx = list ? list.length : 0;
    lastSeq = list?.length ? list[list.length - 1].seq : 0;
    steps.seat = -1;
  }

  function footsteps() {
    const i = state.activeIndex;
    const m = mover(i);
    if (!m) return;
    if (steps.seat !== i) { steps.seat = i; steps.phase = null; steps.dist = 0; steps.x = m.x; steps.z = m.z; }
    const moved = Math.hypot(m.x - steps.x, m.z - steps.z);
    steps.x = m.x; steps.z = m.z;
    if (!m.walking || moved > 4) { steps.phase = null; steps.dist = 0; return; }   // (a jump is a teleport)
    let step = false;
    // A real guest: a foot lands twice per walk cycle of its animation. (When a frame covers a good part
    // of a stride - a slow device - the phase cannot be followed: count the distance instead.)
    const w = walkPhase(i);
    const stride = w && w.stride > 0.2 ? w.stride : 1.44;
    if (w && Number.isFinite(w.phase) && moved < stride * 0.3) {
      if (steps.phase != null) {
        const a = steps.phase, b = w.phase;
        const crossed = x => (a <= b ? a < x && b >= x : a < x || b >= x);
        step = crossed(0.02) || crossed(0.52);
      }
      steps.phase = w.phase;
      steps.dist = 0;
    } else {
      steps.phase = null;
      steps.dist += moved;
      if (steps.dist >= stride / 2) { steps.dist -= stride / 2; step = true; }
    }
    if (!step) return;
    const p = state.players[i];
    const surface = FLOORS[p?.currentRoom] || FLOORS.default;
    const [v, pan] = where(i);
    sfx('step', { volume: (i === humanSeat() ? 0.8 : 0.75) * v, pan, surface });
  }

  return {
    reset,
    update(running) {
      if (state.events !== list || (list && list.length < idx)) reset();
      if (!running || !list) return;
      // only what is new since the last frame (in order). A flood of events in one frame is the rest
      // of a match played out at once (Skip to the result): not live play, so not heard.
      if (list.length - idx > 8) { idx = list.length; lastSeq = list[idx - 1]?.seq ?? lastSeq; }
      while (idx < list.length) {
        const e = list[idx++];
        if (e.seq <= lastSeq) continue;
        lastSeq = e.seq;
        try { onEvent(e); } catch (err) { console.warn('game sound:', err); }
      }
      footsteps();
    },
  };
}
