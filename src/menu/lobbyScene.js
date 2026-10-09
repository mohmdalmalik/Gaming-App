// The animated 3D background of the main menu: a grand Art Deco hotel lobby at night, with the
// guests seated, chatting and strolling, a concierge at the desk and the manager pacing in the back.
// On Play, the manager leads a few of the seated guests into the lift, the doors close and the dial
// swings up toward the fourth floor (the game's starting room).
//
//   const lobby = createLobbyScene({ renderer, cfg });
//   await lobby.ready;                       // models loaded (resolves even if some failed)
//   lobby.setSize(w, h);                     // CSS pixels, on every resize
//   lobby.update(dt, time);                  // every frame while the menu shows
//   renderer.render(lobby.scene, lobby.camera);
//   await lobby.enter({ guests: 3 });        // boarding; resolves when the lift doors have shut
//   lobby.reset();                           // back to the calm tableau
//   lobby.dispose();
//
// It renders with the game's own renderer and never changes its settings. Everything placed in the
// room comes from src/menu/lobbyLayout.js (data); the room is built by src/menu/lobbySet.js and the
// people are src/menu/lobbyCast.js.
import * as THREE from 'three';
import { lobbyLayout } from './lobbyLayout.js';
import { buildLobbySet } from './lobbySet.js';
import { createActor, preloadCast } from './lobbyCast.js';
import { disposeTextures } from './lobbyTextures.js';

const D2R = Math.PI / 180;
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeInOut = t => (t <= 0 ? 0 : t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Soft contact shadows (one instanced draw call for every person and piece of furniture).
function makeShadows(max) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,0.6)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.3)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: '#000000', fog: false });
  const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  mesh.count = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  return {
    mesh,
    set(i, x, z, w, d, yaw = 0, y = 0.013) {
      m.compose(p.set(x, y, z), q.setFromAxisAngle(Y, yaw), s.set(w, 1, d));
      mesh.setMatrixAt(i, m);
      if (i >= mesh.count) mesh.count = i + 1;
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); tex.dispose(); },
  };
}

export function createLobbyScene({ renderer, cfg, layout = lobbyLayout } = {}) {
  const L = layout;
  const scene = new THREE.Scene();
  scene.name = 'menu-lobby';
  scene.background = new THREE.Color(L.room.background);
  scene.fog = new THREE.Fog(L.room.fog.color, L.room.fog.near, L.room.fog.far);

  const C = L.camera;
  const camera = new THREE.PerspectiveCamera(C.fov, 16 / 9, 0.1, 60);
  const basePos = new THREE.Vector3(...C.pos), baseTarget = new THREE.Vector3(...C.target);
  const endPos = new THREE.Vector3(...C.enterPos), endTarget = new THREE.Vector3(...C.enterTarget);
  let aspect = 16 / 9, baseFov = C.fov;

  const set = buildLobbySet(L);
  scene.add(set.group);

  const shadows = makeShadows(48);
  scene.add(shadows.mesh);
  // furniture shadows (static)
  let nShadow = 0;
  for (const so of L.sofas) {
    const w = so.seats * 0.62 + 0.6;
    shadows.set(nShadow++, so.x - Math.sin(so.heading * D2R) * 0.12, so.z - Math.cos(so.heading * D2R) * 0.12, w + 0.4, 1.3, so.heading * D2R);
  }
  for (const t of L.tables) shadows.set(nShadow++, t.x, t.z, t.r * 2.6, t.r * 2.6);
  for (const p of L.palms) shadows.set(nShadow++, p.x, p.z, 1.1 * p.s, 1.1 * p.s);
  for (const c of L.columns) shadows.set(nShadow++, c.x, c.z, 1.8, 1.8);
  shadows.set(nShadow++, (L.reception.x0 + L.reception.x1) / 2, L.reception.front - L.reception.depth / 2, L.reception.x1 - L.reception.x0 + 1.4, 1.5);
  shadows.set(nShadow++, L.trolley.x, L.trolley.z, 1.4, 0.95, L.trolley.heading * D2R);
  const firstActorShadow = nShadow;

  // ---- people ---------------------------------------------------------------------------------
  const actors = new Map();          // name -> Actor
  const specs = new Map(L.cast.map(c => [c.name, c]));
  const strolls = new Map();         // name -> { route, i, pause }
  let loaded = false;

  const seatOf = spec => {
    const [id, idx] = spec.seat;
    const sp = set.seats[`${id}:${idx}`];
    return sp ? { x: sp.x, z: sp.z, y: sp.y, heading: sp.heading } : null;
  };

  function placeActor(a) {
    const spec = a.spec;
    a.path = null; a.turnTo = null; a.onArrive = null; a.curSpeed = 0;
    a.headYaw = a.headYawTarget = 0; a.headPitch = spec.headPitch || 0;
    a.walkW = 0; a.speed = spec.speed || 1.15;
    a.group.visible = true;
    if (spec.seat) { const s = seatOf(spec); if (s) a.sitAt(s, true); }
    else if (spec.at) { a.sitW = a.sitTarget = 0; a.place(spec.at[0], spec.at[1], spec.at[2] * D2R); }
    const route = L.strolls[spec.stroll || (spec.name === 'manager' ? 'manager' : '')];
    if (route) {
      a.sitW = a.sitTarget = 0;
      const start = spec.name === 'manager' ? 0 : 1;
      const p = route[start];
      a.place(p[0], p[1], (p[3] ?? 0) * D2R);
      strolls.set(spec.name, { route, i: start, pause: (p[2] || 0) * 0.5, walking: false });
    }
  }

  const ready = (async () => {
    try {
      const models = [...new Set(L.cast.map(c => c.model))];
      await preloadCast(models);
      for (const spec of L.cast) {
        try { actors.set(spec.name, await createActor(spec, scene)); }
        catch (e) { console.warn('lobby: could not create', spec.name, e && e.message); }
      }
      for (const a of actors.values()) placeActor(a);
      loaded = true;
      // settle the poses, then build the shaders up front so the first frame does not stall
      for (const a of actors.values()) a.update(0.016);
      try { if (renderer) await (renderer.compileAsync ? renderer.compileAsync(scene, camera) : renderer.compile(scene, camera)); }
      catch (e) { /* compiling ahead is only an optimisation */ }
    } catch (e) {
      console.warn('lobby: the menu lobby loaded with errors:', e && e.message);
    }
  })();

  // ---- idle behaviour ---------------------------------------------------------------------------
  // who looks at whom (glances are re-chosen every few seconds)
  const lookAt = (a, x, z, max = 1.2) => {
    const want = Math.atan2(x - a.x, z - a.z);
    a.headYawTarget = THREE.MathUtils.clamp(wrap(want - a.heading), -max, max);
  };
  const glanceTimers = new Map();
  function idleGlances(a, dt, time) {
    if (a.path) { a.headYawTarget = 0; return; }
    let t = (glanceTimers.get(a) ?? Math.random() * 3) - dt;
    if (t <= 0) {
      t = 2.5 + Math.random() * 4.5;
      const name = a.spec.name;
      const others = { victor: ['clara', 'henry'], clara: ['victor', 'henry'], henry: ['victor', 'clara'], extraM: ['extraF'], extraF: ['extraM'], eleanor: ['concierge'], concierge: ['eleanor', 'manager'], marcus: [null, 'beatrice'] }[name];
      const pick = others ? others[(Math.random() * others.length) | 0] : null;
      const o = pick && actors.get(pick);
      if (o && Math.random() < 0.8) lookAt(a, o.x, o.z);
      else a.headYawTarget = (Math.random() - 0.5) * 0.7;
    }
    glanceTimers.set(a, t);
  }

  function updateStroll(a, st, dt) {
    if (a.path) return;
    if (st.pause > 0) {
      st.pause -= dt;
      const p = st.route[st.i];
      if (p[4]) a.headYawTarget = p[4] * D2R;
      if (st.pause > 0) return;
    }
    // next waypoint
    st.i = (st.i + 1) % st.route.length;
    const p = st.route[st.i];
    a.headYawTarget = 0;
    a.walkPath([[p[0], p[1]]], {
      speed: a.spec.speed || 0.9,
      face: p[3] != null ? p[3] * D2R : null,
      onArrive: () => { st.pause = p[2] || 0; },
    });
  }

  // ---- the boarding sequence ----------------------------------------------------------------------
  let seq = null;
  const lift = L.lift;

  function enter({ guests = 3 } = {}) {
    if (seq) return seq.promise;
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    const n = Math.max(0, Math.min(3, guests | 0));
    const boarders = L.cast.filter(c => c.boards).sort((a, b) => a.boards - b.boards).slice(0, n)
      .map(c => actors.get(c.name)).filter(Boolean);
    const slots = lift.slots[boarders.length] || [];
    seq = { t: 0, promise, resolve, boarders, inside: 0, managerIn: false, closeAt: null, shutAt: null, done: false, ding: 0 };
    const manager = actors.get('manager');
    strolls.delete('manager');
    // the guests: stand up one after another, walk round the furniture to the lift, turn to face out
    boarders.forEach((a, i) => {
      a.board = { delay: 0.15 + i * 0.3, started: false, slot: slots[i], inside: false };
    });
    // the manager goes to the side of the doors, ushers them in, then follows them
    if (manager) {
      manager.path = null; manager.turnTo = null; manager.onArrive = null;
      const [dx, dz] = lift.doorSide;
      const dist = Math.hypot(dx - manager.x, dz - manager.z);
      manager.walkPath([[dx, dz]], { speed: THREE.MathUtils.clamp(dist / 2.6, 0.9, 1.7), face: 35 * D2R, onArrive: () => { seq && (seq.managerWaiting = true); } });
    }
    return promise;
  }

  function startBoarder(a) {
    const b = a.board;
    b.started = true;
    a.standUp();
    const route = (L.boardingPaths[a.spec.name] || []).map(p => [...p]);
    route.push([...lift.front], [b.slot[0], lift.front[1] - 0.95], [...b.slot]);
    // speed: be inside by ~3.9 s whatever the distance (cadence follows the ground speed)
    let len = 0, px = a.x, pz = a.z;
    for (const [x, z] of route) { len += Math.hypot(x - px, z - pz); px = x; pz = z; }
    const timeLeft = Math.max(1.6, 3.9 - seq.t - 0.6);
    a.walkPath(route, { speed: THREE.MathUtils.clamp(len / timeLeft, 0.95, 1.65), face: 0, onArrive: () => { b.inside = true; } });
  }

  function updateSequence(dt) {
    const s = seq;
    s.t += dt;
    const manager = actors.get('manager');
    for (const a of s.boarders) if (!a.board.started && s.t >= a.board.delay) startBoarder(a);
    // the manager follows the last guest in once every guest is past him
    const allIn = s.boarders.every(a => a.board.inside || (a.path && a.z < lift.front[1] - 0.6));
    if (manager && !s.managerIn && (allIn || s.t > 4.3) && s.t > 1.2) {
      s.managerIn = true;
      const [mx, mz] = lift.managerSlot;
      manager.walkPath([[lift.front[0] - 0.1, lift.front[1]], [mx, lift.front[1] - 0.9], [mx, mz]], { speed: 1.35, face: 0, onArrive: () => { s.managerInside = true; } });
    }
    // doors: open straight away (with a ding), close once everyone is in the car
    const everyoneIn = s.boarders.every(a => a.board.inside || a.z < -6.0) && (!manager || s.managerInside || manager.z < -5.95);
    if (s.closeAt == null && ((everyoneIn && s.t > 2.0) || s.t > 6.2)) s.closeAt = s.t + 0.15;
    let open = ease((s.t - 0.2) / 1.1);
    if (s.closeAt != null) open *= 1 - ease((s.t - s.closeAt) / 1.05);
    set.lift.setOpen(open);
    s.ding = Math.max(0, s.ding - dt * 1.2);
    if (s.t > 0.2 && !s.dinged) { s.dinged = true; s.ding = 1; }
    set.lift.setDing(s.ding);
    // shut: the needle starts to climb toward the fourth floor; the promise resolves
    if (s.closeAt != null && s.t >= s.closeAt + 1.05) {
      if (s.shutAt == null) s.shutAt = s.t;
      const up = ease((s.t - s.shutAt - 0.2) / 3.2);
      set.lift.setFloor(up * lift.destination);
      if (!s.done) { s.done = true; s.resolve(); }
    }
    // the manager turns to face out at the door while ushering
    if (manager && s.managerWaiting && !s.managerIn) {
      const next = s.boarders.find(a => !a.board.inside);
      if (next) lookAt(manager, next.x, next.z, 1.0);
    }
  }

  // ---- camera ------------------------------------------------------------------------------------
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  let cameraOverride = null;     // debug: { pos: [x,y,z], target: [x,y,z], fov }
  function updateCamera(time) {
    if (cameraOverride) {
      camera.position.set(...cameraOverride.pos);
      camera.lookAt(...cameraOverride.target);
      if (cameraOverride.fov && camera.fov !== cameraOverride.fov) { camera.fov = cameraOverride.fov; camera.updateProjectionMatrix(); }
      return;
    }
    const d = C.drift;
    const w = (2 * Math.PI) / d.period;
    const push = seq ? easeInOut(Math.min(1, seq.t / 5.4)) : 0;
    const driftK = 1 - push;
    camPos.copy(basePos).lerp(endPos, push);
    camPos.x += Math.sin(time * w) * d.x * driftK;
    camPos.y += Math.sin(time * w * 1.7 + 1) * d.y * driftK;
    camPos.z += Math.cos(time * w * 0.8) * d.z * driftK;
    camTgt.copy(baseTarget).lerp(endTarget, push);
    camTgt.x += Math.sin(time * w * 0.6 + 2) * d.x * 0.3 * driftK;
    camera.position.copy(camPos);
    camera.lookAt(camTgt);
    const fov = THREE.MathUtils.lerp(baseFov, Math.min(baseFov, C.enterFov * baseFov / C.fov), push);
    if (Math.abs(camera.fov - fov) > 1e-3) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }

  function setSize(width, height) {
    aspect = Math.max(0.2, (width || 1) / (height || 1));
    camera.aspect = aspect;
    // keep at least `minHFov` across: narrower (4:3) screens get a taller view instead of losing the sides
    const vForH = 2 * Math.atan(Math.tan((C.minHFov * D2R) / 2) / aspect) / D2R;
    baseFov = Math.max(C.fov, vForH);
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  setSize(16, 9);

  // ---- per frame -------------------------------------------------------------------------------
  let clock = 0;
  function update(dt, time) {
    dt = Math.min(Math.max(dt || 0, 0), 0.1);
    clock = time ?? clock + dt;
    if (seq) updateSequence(dt);
    if (loaded) {
      for (const [name, st] of strolls) { const a = actors.get(name); if (a) updateStroll(a, st, dt); }
      // conversations: the speakers take turns
      const conv = (a, b, speed, off) => {
        const k = Math.sin(clock * speed + off);
        if (a) a.talk += ((k > 0.15 ? (a.spec.talk || 0.6) : 0) - a.talk) * Math.min(1, dt * 2);
        if (b) b.talk += ((k < -0.15 ? (b.spec.talk || 0.6) : 0) - b.talk) * Math.min(1, dt * 2);
      };
      conv(actors.get('eleanor'), actors.get('concierge'), 0.45, 0);
      conv(actors.get('extraM'), actors.get('extraF'), 0.38, 1.3);
      let i = firstActorShadow;
      for (const a of actors.values()) {
        if (!seq || !a.board) idleGlances(a, dt, clock);
        if (seq && a.board && a.path) a.headYawTarget = 0;
        a.update(dt);
        // contact shadow: under the feet when standing, under the seat when sitting
        const seat = a.sitW > 0.5 && a.seat;
        shadows.set(i++, seat ? a.seat.x : a.x, seat ? a.seat.z : a.z, 0.85, 0.85, 0, seat ? -1 : 0.013);
      }
    }
    set.update(clock, camera);
    updateCamera(clock);
  }

  function reset() {
    if (seq && !seq.done) { seq.done = true; seq.resolve(); }
    seq = null;
    strolls.clear();
    for (const a of actors.values()) { a.board = null; placeActor(a); }
    set.lift.setOpen(0);
    set.lift.setFloor(0);
    set.lift.setDing(0);
    for (const a of actors.values()) a.update(0.016);
    updateCamera(clock);
  }

  function dispose() {
    if (seq && !seq.done) { seq.done = true; seq.resolve(); }
    for (const a of actors.values()) a.dispose();
    actors.clear();
    set.dispose();
    shadows.dispose();
    disposeTextures();
  }

  updateCamera(0);

  return {
    scene, camera, ready, setSize, update, enter, reset, dispose,
    // for the preview page and tests
    debug: { actors, set, get seq() { return seq; }, layout: L, setCamera(c) { cameraOverride = c; updateCamera(clock); } },
  };
}
