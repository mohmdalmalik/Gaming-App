// Greybox visuals for rooms and doorways. Everything here is placeholder geometry driven
// by the floor model; swapping in real models later means replacing this file, not the
// game logic.
import * as THREE from 'three';
import { unitBox, unitPlane, lambert, tinted, makeShadow, easeOutCubic } from './materials.js';

export function createRoomViews(floor, cfg, scene) {
  const views = new Map();
  const H = cfg.walls.height;
  const pal = cfg.palette;
  let seed = 0;

  for (const room of floor.roomList) {
    const group = new THREE.Group();
    group.name = `room:${room.id}`;

    // Each room's greys are nudged toward its mood colour so the warm→cold shift also
    // reads in the surfaces, not only in the light.
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

    // Furniture is tinted toward the room's mood like the walls (unless it carries its own
    // colour, e.g. the exit door), so the boxes sit in the room instead of reading as a
    // separate cool grey. Each piece gets a soft contact shadow to ground it.
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

    // Lights are added to the scene (not the hidden group) so the number of lights never
    // changes: Three.js would otherwise rebuild every material's shader on each reveal.
    const positions = room.mood.lights || [[0, 0]];
    const reach = Math.hypot(room.size[0], room.size[1]) * 0.75;
    const lights = positions.map(([lx, lz]) => {
      const light = new THREE.PointLight(new THREE.Color(room.mood.color), 0, reach, 2);
      light.position.set(room.center[0] + lx, H - 0.4, room.center[1] + lz);
      scene.add(light);
      return { light, base: (room.mood.intensity ?? 1) * cfg.render.pointLightScale };
    });

    const view = {
      room,
      group,
      floorMesh,
      walls,
      furniture,
      lights,
      revealed: false,
      revealT: 0,
      seed: seed++ * 7.31,
      setRevealed(revealed, animate = true) {
        this.revealed = revealed;
        if (!revealed) this.revealT = 0;
        else if (!animate) this.revealT = 1;
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
      update(dt) {
        if (this.revealed && this.revealT < 1) {
          this.revealT = Math.min(1, this.revealT + dt / cfg.render.revealDuration);
          this.apply();
        }
      },
    };
    view.apply(); // start hidden until discovered
    scene.add(group);
    views.set(room.id, view);
  }
  return views;
}

// Soft gradient textures for the doorway cues (built once, shared by every doorway).
function gradientTexture(kind) {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  let grad;
  if (kind === 'radial') {
    grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  } else {   // 'rise': bright at the bottom edge, fading upward (a light spill in an opening)
    grad = g.createLinearGradient(0, S, 0, 0);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Doorway cues. A doorway shows a floor strip once either side is known. The "way through" cue is
// deliberately quiet so it sits in the hotel rather than on top of it:
//   • a soft warm glow on the floor across the threshold (the doorway leads somewhere new, or the
//     active guest can use it this turn),
//   • a faint light spilling up the opening while the room behind is still undiscovered,
//   • a gold ring on the floor in front of each door the active guest can step through, gently
//     pulsing (the tap target; the tests know it as `blink`).
// No hard posts or bars, and the pulse is slow so it never reads as the mood flicker.
export function createDoorwayViews(floor, cfg, scene) {
  const views = new Map();
  const t = cfg.walls.thickness;
  const warm = new THREE.Color(cfg.palette.frontier);
  const additive = (map, opacity) => new THREE.MeshBasicMaterial({
    map, color: warm, transparent: true, opacity, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const radial = gradientTexture('radial'), rise = gradientTexture('rise');
  const glowMat = additive(radial, 0.55);
  const spillMat = additive(rise, 0.32);
  const haloMat = additive(radial, 0.5);
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.palette.usable), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const ringGeo = new THREE.RingGeometry(0.27, 0.33, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const stripMat = lambert(cfg.palette.doorStrip);
  const SPILL_H = 1.5;
  const look = new THREE.Vector3();

  for (const d of floor.doorways) {
    const along = d.axis === 'x';
    const sizeAcross = t * 2;

    const strip = new THREE.Mesh(unitPlane, stripMat);
    strip.scale.set(along ? d.width : sizeAcross, 1, along ? sizeAcross : d.width);
    strip.position.set(d.center[0], 0.02, d.center[1]);
    strip.visible = false;
    scene.add(strip);

    // The threshold glow: an oval pool of warm light across the doorway, reaching into both rooms.
    const glow = new THREE.Mesh(unitPlane, glowMat);
    glow.scale.set(along ? d.width + 0.9 : 1.9, 1, along ? 1.9 : d.width + 0.9);
    glow.position.set(d.center[0], 0.035, d.center[1]);
    glow.renderOrder = 2;
    glow.visible = false;
    scene.add(glow);

    // The light spill: a soft vertical gradient standing in the opening.
    const spill = new THREE.Mesh(new THREE.PlaneGeometry(d.width, SPILL_H), spillMat);
    spill.position.set(d.center[0], SPILL_H / 2, d.center[1]);
    if (!along) spill.rotation.y = Math.PI / 2;
    spill.renderOrder = 2;
    spill.visible = false;
    scene.add(spill);

    // The ring (+ a soft halo) in front of the door, on the active guest's side.
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

    let frontier = false, usable = false, overlooked = false;
    const sync = () => {
      glow.visible = frontier || usable;
      spill.visible = frontier && !overlooked;
      blink.visible = usable;
    };
    views.set(d.id, {
      doorway: d,
      // The camera is looking OVER this doorway's wall (it stands between the camera and the view,
      // so the cutaway has lowered it): a standing light spill would stick up out of the cut wall.
      setOverlooked(v) { if (v !== overlooked) { overlooked = v; sync(); } },
      strip,
      glow,
      spill,
      blink,
      setState({ known, frontier: f }) {
        strip.visible = known;
        frontier = f;
        sync();
      },
      // `fromRoom` is the room the active guest stands in: the ring sits on that side of the door.
      setUsable(v, fromRoom) {
        usable = v;
        const room = fromRoom && floor.rooms.get(fromRoom);
        if (room) {
          const inset = t + 0.62;
          const sx = along ? 0 : Math.sign(room.center[0] - d.center[0]) || 1;
          const sz = along ? Math.sign(room.center[1] - d.center[1]) || 1 : 0;
          blink.position.set(d.center[0] + sx * inset, 0, d.center[1] + sz * inset);
        }
        sync();
      },
    });
  }

  return {
    views,
    // A slow, gentle pulse on the rings (and a breath on the threshold glow). With the camera rig,
    // also hide the light spill of doorways on the camera's side of the view.
    update(time, rig) {
      if (rig) {
        const bx = Math.sin(rig.yaw), bz = Math.cos(rig.yaw);   // from the view centre toward the camera
        const c = rig.camera.position, dir = rig.camera.getWorldDirection(look);
        const k = dir.y < -1e-3 ? -c.y / dir.y : 0;      // where the view centre meets the floor
        const fx = c.x + dir.x * k, fz = c.z + dir.z * k;
        for (const v of views.values()) {
          const d = v.doorway, facing = d.axis === 'x' ? Math.abs(bz) : Math.abs(bx);
          const ahead = (d.center[0] - fx) * bx + (d.center[1] - fz) * bz;
          v.setOverlooked(facing > cfg.cutaway.threshold && ahead > 0.5);
        }
      }
      const p = 0.5 + 0.5 * Math.sin(time * 2.6);
      ringMat.opacity = 0.6 + 0.4 * p;
      haloMat.opacity = 0.25 + 0.3 * p;
      glowMat.opacity = 0.45 + 0.12 * p;
    },
  };
}
