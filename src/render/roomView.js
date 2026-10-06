// Greybox visuals for rooms and doorways. Everything here is placeholder geometry driven by the
// hotel model; swapping in real models later means replacing this file, not the game logic.
//
// The hotel grows during a match, so room views are made one at a time as rooms are revealed
// (`addRoomView`) and all dropped when a new match starts (`clearRoomViews`). Rooms carry no lights
// of their own: each lists where its lights would be, and the mood light pool (mood.js) lights the
// ones nearest the camera, so the light count — and every shader — stays fixed.
import * as THREE from 'three';
import { unitBox, unitPlane, lambert, tinted, makeShadow, easeOutCubic } from './materials.js';
import { applyXray } from './xray.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let seedCounter = 0;

export function addRoomView(views, room, cfg, scene, { animate = true } = {}) {
  if (views.has(room.id)) return views.get(room.id);
  const H = cfg.walls.height;
  const pal = cfg.palette;
  const group = new THREE.Group();
  group.name = `room:${room.id}`;

  // Each room's greys are nudged toward its mood colour so the warm→cold shift also reads in the
  // surfaces, not only in the light.
  const tint = room.mood.color || '#ffffff';
  const floorMesh = new THREE.Mesh(unitPlane, tinted(pal.floor, tint, cfg.render.moodTint));
  floorMesh.scale.set(room.size[0], 1, room.size[1]);
  floorMesh.position.set(room.center[0], 0, room.center[1]);
  group.add(floorMesh);

  const wallMat = tinted(pal.wall, tint, cfg.render.moodTint);
  const walls = room.walls.map(wall => {
    const mesh = new THREE.Mesh(unitBox, wallMat);
    mesh.scale.set(wall.size[0], H, wall.size[1]);
    mesh.position.set(wall.center[0], 0, wall.center[1]);
    group.add(mesh);
    return { wall, mesh, height: H };
  });

  // Furniture is tinted toward the room's mood like the walls (unless it carries its own colour,
  // e.g. the exit door), with a soft contact shadow to ground it.
  const furniture = room.furniture.map(f => {
    const mat = f.color ? lambert(f.color, f.emissive) : tinted(pal.furniture, tint, cfg.render.moodTint);
    const mesh = new THREE.Mesh(unitBox, mat);
    mesh.scale.set(f.size[0], f.size[1], f.size[2]);
    mesh.position.set(f.center[0], 0, f.center[1]);
    group.add(mesh);
    const shadow = makeShadow(f.size[0] + 0.35, f.size[2] + 0.35);
    shadow.position.set(f.center[0], 0.012, f.center[1]);
    group.add(shadow);
    return { data: f, mesh, height: f.size[1] };
  });

  // Where this room's lights are (lit by the pool in mood.js when they are near the camera).
  const reach = Math.hypot(room.size[0], room.size[1]) * 0.75;
  const lights = (room.mood.lights || [[0, 0]]).map(([lx, lz]) => ({
    pos: new THREE.Vector3(room.center[0] + lx, H - 0.4, room.center[1] + lz),
    color: new THREE.Color(room.mood.color),
    base: (room.mood.intensity ?? 1) * cfg.render.pointLightScale,
    reach,
  }));

  const view = {
    room,
    group,
    floorMesh,
    walls,
    furniture,
    lights,
    revealed: false,
    revealT: 0,
    seed: seedCounter++ * 7.31,
    setRevealed(revealed, anim = true) {
      this.revealed = revealed;
      if (!revealed) this.revealT = 0;
      else if (!anim) this.revealT = 1;
      this.apply();
    },
    apply() {
      const k = easeOutCubic(this.revealT);
      this.group.visible = this.revealed && this.revealT > 0;
      for (const f of this.furniture) f.mesh.scale.y = Math.max(0.02, f.height * k);
      for (const w of this.walls) this.setWallHeight(w, w.height);
    },
    // The only place wall meshes are resized (cutaway decides, this applies).
    setWallHeight(w, height) {
      w.height = height;
      w.mesh.scale.y = Math.max(0.02, height * easeOutCubic(this.revealT));
    },
    // The height a side's walls are currently shown at (for the door leaves in that side).
    sideHeight(side) {
      let h = H;
      for (const w of this.walls) if (w.wall.side === side) h = Math.min(h, w.height);
      return h * easeOutCubic(this.revealT);
    },
    update(dt) {
      if (this.revealed && this.revealT < 1) {
        this.revealT = Math.min(1, this.revealT + dt / cfg.render.revealDuration);
        this.apply();
      }
    },
  };
  scene.add(group);
  views.set(room.id, view);
  view.setRevealed(true, animate);
  return view;
}

// A new match: every room view goes (the hotel is rebuilt from scratch).
export function clearRoomViews(views, scene) {
  for (const v of views.values()) scene.remove(v.group);
  views.clear();
}

// Soft gradient textures for the doorway cues (built once, shared by every doorway).
function gradientTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A walnut door face (two raised panels and a thin brass line), painted once and shared by every
// door leaf, so a closed door reads as a door like the lobby's lift and not as a flat dark slab.
function doorTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#5a3a24';
  g.fillRect(0, 0, W, H);
  const panel = (x, y, w, h) => {
    g.fillStyle = '#3a2416'; g.fillRect(x - 3, y - 3, w + 6, h + 6);       // shadowed groove
    g.fillStyle = '#6b4529'; g.fillRect(x, y, w, h);                      // raised panel
    g.fillStyle = '#7a5231'; g.fillRect(x + 6, y + 6, w - 12, h - 12);    // its lit face
    g.strokeStyle = '#c9a24e'; g.lineWidth = 2; g.strokeRect(x + 10.5, y + 10.5, w - 21, h - 21);
  };
  panel(18, 18, W - 36, 120);
  panel(18, 158, W - 36, 80);
  g.fillStyle = '#b8923f';
  g.fillRect(0, H - 8, W, 8);                                               // brass kick plate
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A LOCKED door's face: dark oxblood boards held by two riveted iron straps, with a brass lock plate
// and keyhole — so a locked room reads as locked from across the hotel, not as another walnut door.
function lockedDoorTexture() {
  const W = 128, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#4a1814'; g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 32) {                                       // vertical boards
    g.fillStyle = x % 64 ? '#55201a' : '#461612'; g.fillRect(x + 1, 0, 30, H);
    g.fillStyle = '#2a0d0a'; g.fillRect(x, 0, 2, H);
  }
  for (const y of [46, 196]) {                                            // iron straps with rivets
    g.fillStyle = '#26262b'; g.fillRect(0, y, W, 20);
    g.fillStyle = '#3c3c44'; g.fillRect(0, y, W, 4);
    g.fillStyle = '#8a8a94';
    for (let x = 10; x < W; x += 24) { g.beginPath(); g.arc(x, y + 10, 3, 0, Math.PI * 2); g.fill(); }
  }
  g.fillStyle = '#c9a24e'; g.fillRect(W / 2 - 18, 108, 36, 52);          // brass lock plate
  g.fillStyle = '#8c6c2c'; g.fillRect(W / 2 - 18, 156, 36, 4);
  g.fillStyle = '#1a0c06';                                                 // keyhole
  g.beginPath(); g.arc(W / 2, 126, 6, 0, Math.PI * 2); g.fill();
  g.fillRect(W / 2 - 3, 126, 6, 18);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The padlock sign over a locked door: a brass padlock on a dark round plate, readable from afar.
// `open`: the shackle lifted and swung aside — a locked door a key has opened for the rest of this turn.
function padlockTexture(open = false) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20, 16, 12, 0.82)';
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#c9a24e'; g.lineWidth = 5;
  g.beginPath(); g.arc(64, 64, 57, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#b9bcc4'; g.lineWidth = 10; g.lineCap = 'round';          // steel shackle
  if (open) { g.beginPath(); g.moveTo(44, 48); g.lineTo(44, 30); g.arc(64, 30, 20, Math.PI, 0); g.lineTo(84, 40); g.stroke(); }
  else { g.beginPath(); g.moveTo(44, 62); g.lineTo(44, 44); g.arc(64, 44, 20, Math.PI, 0); g.lineTo(84, 62); g.stroke(); }
  const grad = g.createLinearGradient(0, 58, 0, 104);                         // brass body
  grad.addColorStop(0, '#f0d27a'); grad.addColorStop(1, '#b08a36');
  g.fillStyle = grad;
  g.beginPath(); g.roundRect ? g.roundRect(32, 58, 64, 46, 8) : g.rect(32, 58, 64, 46); g.fill();
  g.fillStyle = '#2a1a08';                                                    // keyhole
  g.beginPath(); g.arc(64, 76, 6, 0, Math.PI * 2); g.fill();
  g.fillRect(61, 78, 6, 14);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Raw pale timber for the boards of a barricade (grain along the plank, a nail head at each end
// and one in the middle), so a sealed doorway reads against the dark walnut walls at a glance.
function plankTexture() {
  const W = 256, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#b57c42'; g.fillRect(0, 0, W, H);
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9; i++) {                                           // grain
    const y = 2 + rnd() * (H - 4);
    g.strokeStyle = `rgba(110, 66, 30, ${0.25 + rnd() * 0.3})`; g.lineWidth = 1 + rnd();
    g.beginPath(); g.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) g.lineTo(x, y + (rnd() - 0.5) * 3);
    g.stroke();
  }
  g.fillStyle = 'rgba(60, 32, 12, 0.8)'; g.fillRect(0, 0, W, 3); g.fillRect(0, H - 3, W, 3);     // edges
  for (const x of [12, W / 2, W - 12]) {                                  // nail heads
    g.fillStyle = '#3a3634'; g.beginPath(); g.arc(x, H / 2, 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#8d8a86'; g.beginPath(); g.arc(x - 1, H / 2 - 1, 1.6, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The barricade sign over a sealed doorway: boards nailed in an X on a dark plate ringed in red,
// matching the mark on the map.
function barricadeSignTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(20, 16, 12, 0.85)';
  g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#d9604f'; g.lineWidth = 6;
  g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke();
  const board = (angle, y = 0) => {
    g.save(); g.translate(64, 64 + y); g.rotate(angle);
    g.fillStyle = '#5a3a1e'; g.fillRect(-46, -11, 92, 22);
    g.fillStyle = '#d2a265'; g.fillRect(-44, -9, 88, 18);
    g.fillStyle = '#3a3634';
    for (const x of [-36, 36]) { g.beginPath(); g.arc(x, 0, 3.5, 0, Math.PI * 2); g.fill(); }
    g.restore();
  };
  board(Math.PI / 4); board(-Math.PI / 4); board(0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// The boards of a barricade, nailed across BOTH faces of the doorway (so it reads from either room):
// on each face two crossed boards with two across them. One merged geometry (one draw call) per
// doorway width, in a frame where the opening runs along x and the wall line is z = 0; front faces
// are full brightness and the plank edges darker (vertex colours), so the boards have depth unlit.
const barricadeGeos = new Map();
function barricadeGeometry(width, t) {
  const key = `${width.toFixed(3)}|${t}`;
  if (barricadeGeos.has(key)) return barricadeGeos.get(key);
  const parts = [];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
  const board = (len, x, y, z, angle, thick = 0.2) => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    q.setFromAxisAngle(zAxis, angle);
    geo.applyMatrix4(m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(len, thick, 0.05)));
    const n = geo.attributes.normal, col = [];
    for (let i = 0; i < n.count; i++) { const k = Math.abs(n.getZ(i)) > 0.5 ? 1 : 0.45; col.push(k, k, k); }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(geo);
  };
  const span = width + 0.34;                            // reaches over the jambs, nailed to the frame
  const lo = 0.3, hi = 1.85, rise = hi - lo;
  const diag = Math.hypot(width + 0.1, rise), ang = Math.atan2(rise, width + 0.1);
  for (const f of [1, -1]) {
    const z = f * (t + 0.03);
    board(diag, 0, (lo + hi) / 2, z, ang);
    board(diag, 0, (lo + hi) / 2, z + f * 0.02, -ang);
    board(span, 0, 0.62, z + f * 0.045, 0, 0.22);
    board(span, 0, 1.5, z + f * 0.045, 0.06, 0.22);     // a little askew: hammered up in a hurry
  }
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  barricadeGeos.set(key, merged);
  return merged;
}
const BARRICADE_H = 1.95;
const BAR_SIGN_Y = 0.8;      // the sign's height at full size: on the boards, a little below their middle
const BAR_SIGN_OUT = 0.45;   // and how far it hangs out from the doorway, on the side facing the camera

const INTO = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };   // into the room from its wall

// Doors and doorways. A CLOSED door (one that leads to a room not yet revealed) is a walnut door
// leaf standing in the opening, with a soft warm glow on the floor in front of it. Opening it
// swings the leaf into the new room, and from then on it is an open doorway. A gold ring (a slow
// pulse; the tests know it as `blink`) sits on the active guest's side of every door they can use
// this turn — to open, or to walk through. A jammed door keeps its leaf, and no cue.
// `isLocked(roomId)`: whether that room's door is locked right now. `standingIn()`: the room the active
// guest stands in — a locked door opens for a guest INSIDE the locked room (the way out is always open;
// the padlock stays on it, since it is still locked against anyone going in). `openedNow(roomId)`: that
// room's door is locked, but a key has it open until the end of this turn (an open padlock hangs there).
// `isBarricaded(doorwayId)`: a Barricade seals that doorway right now — boards are nailed across it on
// both faces, a red glow lies on the floor either side and a barricade sign hangs over it.
// `camera` (optional): the barricade sign hangs out on the side of the doorway facing it.
export function createDoorwayViews(floor, cfg, scene, { isLocked = () => false, standingIn = () => null, openedNow = () => false, isBarricaded = () => false, camera = null } = {}) {
  const views = new Map();
  const t = cfg.walls.thickness, H = cfg.walls.height;
  const warm = new THREE.Color(cfg.palette.frontier);
  const radial = gradientTexture();
  const glowMat = new THREE.MeshBasicMaterial({ map: radial, color: warm, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const haloMat = glowMat.clone();
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.palette.usable), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const ringGeo = new THREE.RingGeometry(0.27, 0.33, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const stripMat = lambert(cfg.palette.doorStrip);
  // Door leaves are unlit, a fixed dark walnut like the lobby's baked panelling: a lamp beside a
  // door would otherwise blow a lit leaf out to bright orange.
  const doorFace = doorTexture();
  const leafMat = new THREE.MeshBasicMaterial({ map: doorFace, color: new THREE.Color('#ffffff') });
  const leafJammedMat = new THREE.MeshBasicMaterial({ map: doorFace, color: new THREE.Color('#8a7a70') });
  const knobMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b8923f') });
  const lockedMat = new THREE.MeshBasicMaterial({ map: lockedDoorTexture() });
  // A padlock hung on each face of a locked door: brass body and a steel shackle.
  const padBodyGeo = new THREE.BoxGeometry(0.16, 0.17, 0.06);
  const padShackleGeo = new THREE.TorusGeometry(0.055, 0.014, 6, 14, Math.PI);
  const padBodyMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#d4aa4f') });
  const padShackleMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9da0a8') });
  const lockGlowMat = new THREE.MeshBasicMaterial({ map: radial, color: new THREE.Color('#c0392b'), transparent: true, opacity: 0.35, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
  const padlockMat = new THREE.SpriteMaterial({ map: padlockTexture(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const padlockOpenMat = new THREE.SpriteMaterial({ map: padlockTexture(true), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  // A barricade's boards (unlit like the door leaves; vertex colours shade the plank edges) and its sign.
  const plankMat = new THREE.MeshBasicMaterial({ map: plankTexture(), vertexColors: true });
  const barGlowMat = lockGlowMat.clone();
  barGlowMat.opacity = 0.6;
  const barSignMat = new THREE.SpriteMaterial({ map: barricadeSignTexture(), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  // (door leaves fade like the room models where they would hide the guest: xray.js)
  for (const m of [leafMat, leafJammedMat, knobMat, lockedMat, padBodyMat, padShackleMat, plankMat]) applyXray(m);
  const LEAF_H = 2.02;

  // A door leaf hinged at one jamb: a pivot group so it can swing open.
  function makeLeaf(d, room) {
    const along = d.axis === 'x';
    const w = d.width - 0.04;
    const pivot = new THREE.Group();
    const leaf = new THREE.Mesh(unitBox, leafMat);
    leaf.scale.set(along ? w : 0.05, LEAF_H, along ? 0.05 : w);
    const knob = new THREE.Mesh(unitBox, knobMat);
    knob.scale.set(0.06, 0.06, 0.06);
    pivot.add(leaf, knob);
    // The padlocks (shown only while the room behind is locked), one on each face at hand height.
    const pads = [1, -1].map(f => {
      const g = new THREE.Group();
      const body = new THREE.Mesh(padBodyGeo, padBodyMat);
      const shackle = new THREE.Mesh(padShackleGeo, padShackleMat);
      shackle.position.y = 0.085;
      if (!along) { body.rotation.y = Math.PI / 2; shackle.rotation.y = Math.PI / 2; }
      g.add(body, shackle);
      g.userData.f = f;
      g.visible = false;
      pivot.add(g);
      return g;
    });
    pivot.userData = { leaf, knob, pads, swing: 0, target: 0, room: room.id, side: d.side, along, d, w, hinge: 1 };
    setHinge(pivot, 1);
    scene.add(pivot);
    return pivot;
  }

  // Hinge the leaf at the "low" jamb (s = 1) or the "high" one (s = -1), on the owning room's side
  // of the wall line.
  function setHinge(pivot, s) {
    const u = pivot.userData, { d, w, along } = u, [ix, iz] = INTO[u.side];
    u.hinge = s;
    pivot.position.set(d.center[0] - (along ? s * w / 2 : 0) + ix * t * 0.5, 0, d.center[1] - (along ? 0 : s * w / 2) + iz * t * 0.5);
    u.leaf.position.set(along ? s * w / 2 : 0, 0, along ? 0 : s * w / 2);
    u.knob.position.set(along ? s * (w - 0.12) : ix * 0.05, 1.0, along ? iz * 0.05 : s * (w - 0.12));
    for (const g of u.pads) g.position.set(along ? s * w / 2 : g.userData.f * 0.06, 1.05, along ? g.userData.f * 0.06 : s * w / 2);
  }
  // The angle an open leaf ends at (swing away from the room it belongs to, into the next one).
  const OPEN = 1.75;
  const swingAngle = (u, k) => k * OPEN * u.hinge * (u.along ? INTO[u.side][1] : -INTO[u.side][0]);
  // Before a door swings open: hinge it on whichever jamb lets it open without passing through
  // furniture in the room it opens into (a corner table, a cabinet), if one does.
  function chooseHinge(pivot, intoRoom) {
    const furniture = floor.rooms.get(intoRoom)?.furniture || [];
    if (!furniture.length) return;
    const hits = s => {
      setHinge(pivot, s);
      const u = pivot.userData, a = swingAngle(u, 1), px = pivot.position.x, pz = pivot.position.z;
      let n = 0;
      for (let k = 1; k <= 8; k++) {                      // points along the open leaf, and its sweep
        for (const frac of [0.35, 0.7, 1]) {
          const r = (k / 8) * u.w, ang = a * frac;
          const lx = u.along ? s * r : 0, lz = u.along ? 0 : s * r;
          const x = px + lx * Math.cos(ang) + lz * Math.sin(ang), z = pz - lx * Math.sin(ang) + lz * Math.cos(ang);
          for (const f of furniture) {
            if (Math.abs(x - f.center[0]) < f.size[0] / 2 + 0.06 && Math.abs(z - f.center[1]) < f.size[2] / 2 + 0.06) n++;
          }
        }
      }
      return n;
    };
    const low = hits(1);
    if (low && hits(-1) >= low) setHinge(pivot, 1);
  }

  // `inside`: the side of a closed door (the room it belongs to); its glow then stays on that side,
  // since nothing has been revealed beyond it yet. An open doorway's glow reaches into both rooms.
  function makeCues(d, inside) {
    const along = d.axis === 'x';
    const glow = new THREE.Mesh(unitPlane, glowMat);
    const deep = inside ? 1.2 : 1.9, [ix, iz] = inside ? INTO[inside] : [0, 0];
    glow.scale.set(along ? d.width + 0.9 : deep, 1, along ? deep : d.width + 0.9);
    glow.position.set(d.center[0] + ix * (t / 2 + deep / 2), 0.035, d.center[1] + iz * (t / 2 + deep / 2));
    glow.renderOrder = 2;
    glow.visible = false;
    scene.add(glow);
    const blink = new THREE.Group();
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = 0.03;
    const halo = new THREE.Mesh(unitPlane, haloMat);
    halo.scale.set(1.1, 1, 1.1);
    halo.position.y = 0.028;
    blink.add(halo, ring);
    blink.renderOrder = 3;
    blink.visible = false;
    scene.add(blink);
    return { glow, blink };
  }

  function placeRing(blink, d, fromRoom) {
    const room = fromRoom && floor.rooms.get(fromRoom);
    if (!room) return;
    const along = d.axis === 'x', inset = t + 0.62;
    const sx = along ? 0 : Math.sign(room.center[0] - d.center[0]) || 1;
    const sz = along ? Math.sign(room.center[1] - d.center[1]) || 1 : 0;
    blink.position.set(d.center[0] + sx * inset, 0, d.center[1] + sz * inset);
  }

  // A closed door.
  function addFrontier(d) {
    const room = floor.rooms.get(d.room);
    const leaf = makeLeaf(d, room);
    const { glow, blink } = makeCues(d, d.side);
    let usable = false;
    const view = {
      kind: 'closed', doorway: d, leaf, glow, blink,
      sync() {
        leaf.userData.leaf.material = d.jammed ? leafJammedMat : leafMat;
        glow.visible = !d.jammed;
        blink.visible = usable && !d.jammed;
      },
      setState() { this.sync(); },
      setUsable(v, fromRoom) { usable = v; placeRing(blink, d, fromRoom || d.room); this.sync(); },
      dispose() { scene.remove(leaf, glow, blink); },
    };
    view.sync();
    return view;
  }

  // An open doorway between two revealed rooms. `leaf` is the door that was opened, if there was
  // one here (it swings open and stays so).
  function addOpen(d, leaf) {
    const along = d.axis === 'x';
    const strip = new THREE.Mesh(unitPlane, stripMat);
    strip.scale.set(along ? d.width : t * 2, 1, along ? t * 2 : d.width);
    strip.position.set(d.center[0], 0.02, d.center[1]);
    scene.add(strip);
    const { glow, blink } = makeCues(d);
    // A doorway into a LOCKED room keeps a door in it — the locked kind, shut — until the door is
    // opened with a key or a pick; then it swings open like any other, and it swings shut again, padlock
    // and all, when it locks again at the end of that turn. It also stands open (still padlocked) while
    // the active guest is INSIDE the locked room: from inside the way out is always open.
    const lockedRoom = () => (isLocked(d.a) ? d.a : isLocked(d.b) ? d.b : null);
    const lockedNow = () => !!lockedRoom();
    if (!leaf && lockedNow()) leaf = makeLeaf({ ...d, side: d.sideA }, floor.rooms.get(d.a));
    // a red warning glow on the floor on the unlocked side
    const warn = new THREE.Mesh(unitPlane, lockGlowMat);
    warn.renderOrder = 2;
    scene.add(warn);
    // and a padlock sign in front of the locked door, seen from anywhere (it faces the camera)
    const mark = new THREE.Sprite(padlockMat);
    mark.scale.set(0.62, 0.62, 1);
    mark.renderOrder = 7;
    mark.visible = false;
    scene.add(mark);
    const view = {
      kind: 'open', doorway: d, strip, leaf, glow, blink, warn, mark, locked: null, shut: null, openedNow: false,
      bar: null, barricaded: false,
      sync() {
        // A barricade: boards across the doorway while it is sealed (both ways, for every guest).
        this.barricaded = !!isBarricaded(d.id);
        if (this.barricaded && !this.bar) this.bar = makeBarricade(d);
        this.bar?.set(this.barricaded);
        const inRoom = lockedRoom();
        const locked = !!inRoom;
        const shut = locked && standingIn() !== inRoom;     // open for the guest inside, shut to everyone else
        // A key has this door open for the rest of the turn: an OPEN padlock hangs in front of it, so
        // the scene shows it will lock again (the closed padlock comes back when it does).
        const keyed = !locked && !!leaf ? (openedNow(d.a) ? d.a : openedNow(d.b) ? d.b : null) : null;
        this.openedNow = !!keyed;
        mark.material = keyed ? padlockOpenMat : padlockMat;
        if (keyed) {
          const [ix, iz] = INTO[d.sideFor(keyed === d.a ? d.b : d.a)];
          mark.position.set(d.center[0] + ix * 0.45, 1.5, d.center[1] + iz * 0.45);
        }
        if ((locked === this.locked && shut === this.shut) || !leaf) { warn.visible = !!locked; mark.visible = (!!locked || !!keyed) && !!leaf; return; }
        this.locked = locked; this.shut = shut;
        const u = leaf.userData;
        u.leaf.material = locked ? lockedMat : leafMat;
        u.knob.visible = !locked;
        for (const p of u.pads) p.visible = locked;
        if (!shut && u.swing === 0) chooseHinge(leaf, u.room === d.a ? d.b : d.a);
        u.target = shut ? 0 : 1;
        u.locked = shut;
        warn.visible = locked;
        mark.visible = locked || !!keyed;
        if (locked) {
          // the glow sits on the side of the room that is NOT locked
          const openSide = inRoom === d.a ? d.b : d.a;
          const [ix, iz] = INTO[d.sideFor(openSide)];
          const deep = 1.0;
          warn.scale.set(along ? d.width + 0.6 : deep, 1, along ? deep : d.width + 0.6);
          warn.position.set(d.center[0] + ix * (t + deep / 2), 0.036, d.center[1] + iz * (t + deep / 2));
          mark.position.set(d.center[0] + ix * 0.45, 1.5, d.center[1] + iz * 0.45);
        }
      },
      setState() { this.sync(); },
      setUsable(v, fromRoom) { blink.visible = v; glow.visible = v; placeRing(blink, d, fromRoom); },
      dispose() { scene.remove(strip, glow, blink, warn, mark); if (leaf) scene.remove(leaf); this.bar?.dispose(); },
    };
    view.sync();
    return view;
  }

  // A barricade across an open doorway, built the first time it is sealed and kept (hidden) after.
  function makeBarricade(d) {
    const planks = new THREE.Mesh(barricadeGeometry(d.width, t), plankMat);
    planks.position.set(d.center[0], 0, d.center[1]);
    if (d.axis !== 'x') planks.rotation.y = Math.PI / 2;
    planks.renderOrder = 4;
    const glow = new THREE.Mesh(unitPlane, barGlowMat);        // red on the floor, both sides
    const along = d.axis === 'x', deep = 2 * t + 1.9;
    glow.scale.set(along ? d.width + 0.8 : deep, 1, along ? deep : d.width + 0.8);
    glow.position.set(d.center[0], 0.037, d.center[1]);
    glow.renderOrder = 2;
    const sign = new THREE.Sprite(barSignMat);
    sign.scale.set(0.5, 0.5, 1);
    sign.position.set(d.center[0], BAR_SIGN_Y, d.center[1]);
    sign.renderOrder = 7;
    scene.add(planks, glow, sign);
    return {
      planks, glow, sign, on: false,
      set(on) { this.on = on; planks.visible = glow.visible = sign.visible = on; },
      dispose() { scene.remove(planks, glow, sign); },
    };
  }

  const at = d => `${d.center[0].toFixed(2)},${d.center[1].toFixed(2)}`;

  return {
    views,
    // Catch up with the hotel: a view for every door and doorway, the leaf of a door that has just
    // been opened handed on to its new doorway so it can swing open.
    sync() {
      const leaves = new Map();
      const live = new Set([...floor.frontier.map(d => d.id), ...floor.doorways.map(d => d.id)]);
      for (const [id, v] of views) {
        if (live.has(id)) continue;
        if (v.kind === 'closed') { leaves.set(at(v.doorway), v.leaf); scene.remove(v.glow, v.blink); }
        else v.dispose();
        views.delete(id);
      }
      for (const d of floor.frontier) if (!views.has(d.id)) views.set(d.id, addFrontier(d));
      for (const d of floor.doorways) if (!views.has(d.id)) views.set(d.id, addOpen(d, leaves.get(at(d))));
      for (const l of leaves.values()) if (!l.parent || ![...views.values()].some(v => v.leaf === l)) scene.remove(l);
      for (const v of views.values()) v.sync?.();
    },
    // A new match: drop everything.
    reset() {
      for (const v of views.values()) v.dispose();
      views.clear();
    },
    // Pulse the rings, swing opening doors, and keep leaves no taller than a lowered wall.
    // `walker` (the active guest's mover): while they walk, the rings right around them are hidden,
    // so the doorway they are crossing does not show a second ring over their own.
    update(time, dt, roomViews, walker = null) {
      const p = 0.5 + 0.5 * Math.sin(time * 2.6);
      ringMat.opacity = 0.6 + 0.4 * p;
      haloMat.opacity = 0.25 + 0.3 * p;
      glowMat.opacity = 0.4 + 0.12 * p;
      for (const v of views.values()) {
        const b = v.blink;
        const near = !!walker?.walking && Math.hypot(b.position.x - walker.x, b.position.z - walker.z) < 1.3;
        if (b.children[0].visible === near) for (const ch of b.children) ch.visible = !near;
        if (v.bar?.on) {
          // The boards stand as tall as the taller of the doorway's two walls, and at least waist
          // high where both are cut down, so a sealed doorway still reads in the cutaway.
          const d = v.doorway, ra = roomViews.get(d.a), rb = roomViews.get(d.b);
          const h = Math.max(ra ? ra.sideHeight(d.sideA) : 0, rb ? rb.sideHeight(d.sideB) : 0);
          const k = Math.max(0.5, Math.min(1, h / BARRICADE_H));
          const shown = !!(ra?.group.visible || rb?.group.visible);
          v.bar.planks.scale.y = k;
          v.bar.planks.visible = v.bar.glow.visible = v.bar.sign.visible = shown;
          // The sign hangs in the middle of the boards, not above them, and a little out from the
          // doorway toward the camera: above the door it would sit under the guest strip at the top
          // of the screen whenever the doorway is on the far wall.
          const sg = v.bar.sign;
          sg.position.y = BAR_SIGN_Y * k;
          if (camera) {
            const ax = d.axis === 'x' ? 1 : 0;           // the opening runs along x: its face looks along z
            const out = Math.sign(camera.position.getComponent(ax ? 2 : 0) - d.center[ax]) * BAR_SIGN_OUT;
            if (ax) sg.position.z = d.center[1] + out; else sg.position.x = d.center[0] + out;
          }
        }
        const leaf = v.leaf;
        if (!leaf) continue;
        const u = leaf.userData;
        // A barricaded doorway swings its door shut behind the boards (an open leaf beside them would
        // still read as an open door, and could hide them); it swings open again when they come down.
        const target = v.bar?.on ? 0 : u.target;
        if (u.swing < target) u.swing = Math.min(target, u.swing + dt / 0.45);
        else if (u.swing > target) u.swing = Math.max(target, u.swing - dt / 0.45);   // a door locking again swings shut
        // swing away from the room the door belongs to, into the room that was revealed
        leaf.rotation.y = swingAngle(u, easeOutCubic(u.swing));
        const rv = roomViews.get(u.room);
        let h = rv ? rv.sideHeight(u.side) : H;
        // An open door stands in the next room: it is as tall as the taller of the two walls there
        // (so it lowers when both are cut down, and stands by a wall that stands).
        if (v.kind === 'open' && u.swing > 0) {
          const other = v.doorway.a === u.room ? v.doorway.b : v.doorway.a, ov = roomViews.get(other);
          if (ov) h = Math.max(h, ov.sideHeight(v.doorway.sideFor(other)));
        }
        // A locked door stays at least chest high, padlock showing, even where the wall is cut down.
        leaf.scale.y = Math.max(u.locked ? 1.3 / LEAF_H : 0.02, Math.min(1, h / LEAF_H));
        leaf.visible = !!rv?.group.visible;
      }
    },
  };
}
