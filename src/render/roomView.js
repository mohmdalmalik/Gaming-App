// Greybox visuals for rooms and doorways. Everything here is placeholder geometry driven by the
// hotel model; swapping in real models later means replacing this file, not the game logic.
//
// The hotel grows during a match, so room views are made one at a time as rooms are revealed
// (`addRoomView`) and all dropped when a new match starts (`clearRoomViews`). Rooms carry no lights
// of their own: each lists where its lights would be, and the mood light pool (mood.js) lights the
// ones nearest the camera, so the light count — and every shader — stays fixed.
import * as THREE from 'three';
import { unitBox, unitPlane, lambert, tinted, makeShadow, easeOutCubic } from './materials.js';

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

const INTO = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };   // into the room from its wall

// Doors and doorways. A CLOSED door (one that leads to a room not yet revealed) is a walnut door
// leaf standing in the opening, with a soft warm glow on the floor in front of it. Opening it
// swings the leaf into the new room, and from then on it is an open doorway. A gold ring (a slow
// pulse; the tests know it as `blink`) sits on the active guest's side of every door they can use
// this turn — to open, or to walk through. A jammed door keeps its leaf, and no cue.
export function createDoorwayViews(floor, cfg, scene) {
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
  const leafMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a2417') });
  const leafJammedMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#241710') });
  const knobMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#b8923f') });
  const LEAF_H = 2.02;

  // A door leaf hinged at one jamb: a pivot group so it can swing open.
  function makeLeaf(d, room) {
    const along = d.axis === 'x';
    const w = d.width - 0.04;
    const pivot = new THREE.Group();
    const [ix, iz] = INTO[d.side];
    // hinge at the "low" jamb, on the owning room's side of the wall line
    pivot.position.set(d.center[0] - (along ? w / 2 : 0) + ix * t * 0.5, 0, d.center[1] - (along ? 0 : w / 2) + iz * t * 0.5);
    const leaf = new THREE.Mesh(unitBox, leafMat);
    leaf.scale.set(along ? w : 0.05, LEAF_H, along ? 0.05 : w);
    leaf.position.set(along ? w / 2 : 0, 0, along ? 0 : w / 2);
    const knob = new THREE.Mesh(unitBox, knobMat);
    knob.scale.set(0.06, 0.06, 0.06);
    knob.position.set(along ? w - 0.12 : ix * 0.05, 1.0, along ? iz * 0.05 : w - 0.12);
    pivot.add(leaf, knob);
    pivot.userData = { leaf, knob, swing: 0, target: 0, room: room.id, side: d.side, along };
    scene.add(pivot);
    return pivot;
  }

  function makeCues(d) {
    const along = d.axis === 'x';
    const glow = new THREE.Mesh(unitPlane, glowMat);
    glow.scale.set(along ? d.width + 0.9 : 1.9, 1, along ? 1.9 : d.width + 0.9);
    glow.position.set(d.center[0], 0.035, d.center[1]);
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
    const { glow, blink } = makeCues(d);
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
    if (leaf) { leaf.userData.leaf.material = leafMat; leaf.userData.target = 1; }
    const view = {
      kind: 'open', doorway: d, strip, leaf, glow, blink,
      setState() {},
      setUsable(v, fromRoom) { blink.visible = v; glow.visible = v; placeRing(blink, d, fromRoom); },
      dispose() { scene.remove(strip, glow, blink); if (leaf) scene.remove(leaf); },
    };
    return view;
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
    update(time, dt, roomViews) {
      const p = 0.5 + 0.5 * Math.sin(time * 2.6);
      ringMat.opacity = 0.6 + 0.4 * p;
      haloMat.opacity = 0.25 + 0.3 * p;
      glowMat.opacity = 0.4 + 0.12 * p;
      for (const v of views.values()) {
        const leaf = v.leaf;
        if (!leaf) continue;
        const u = leaf.userData;
        if (u.swing < u.target) u.swing = Math.min(u.target, u.swing + dt / 0.45);
        const [ix, iz] = INTO[u.side];
        // swing away from the room the door belongs to, into the room that was revealed
        const ang = easeOutCubic(u.swing) * 1.75 * (u.along ? iz : -ix);
        leaf.rotation.y = ang;
        const rv = roomViews.get(u.room);
        const h = rv ? rv.sideHeight(u.side) : H;
        leaf.scale.y = Math.max(0.02, Math.min(1, h / LEAF_H));
        leaf.visible = !!rv?.group.visible;
      }
    },
  };
}
