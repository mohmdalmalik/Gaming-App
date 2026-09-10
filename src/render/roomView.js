// Greybox visuals for rooms and doorways. Everything here is placeholder geometry driven
// by the floor model; swapping in real models later means replacing this file, not the
// game logic.
import * as THREE from 'three';
import { unitBox, unitPlane, lambert, tinted, easeOutCubic } from './materials.js';

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

    const furniture = room.furniture.map(f => {
      const mesh = new THREE.Mesh(unitBox, lambert(f.color || pal.furniture, f.emissive));
      mesh.scale.set(f.size[0], f.size[1], f.size[2]);
      mesh.position.set(f.center[0], 0, f.center[1]);
      group.add(mesh);
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

// A doorway shows a floor strip once either side is known, and a steady bright frame while
// it still leads somewhere undiscovered. (No pulsing: highlights must not read as flicker.)
export function createDoorwayViews(floor, cfg, scene) {
  const views = new Map();
  const H = cfg.walls.height;
  const t = cfg.walls.thickness;
  const frontierMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(cfg.palette.frontier), toneMapped: false });
  const stripMat = lambert(cfg.palette.doorStrip);

  for (const d of floor.doorways) {
    const along = d.axis === 'x';
    const sizeAlong = d.width, sizeAcross = t * 2;

    const strip = new THREE.Mesh(unitPlane, stripMat);
    strip.scale.set(along ? sizeAlong : sizeAcross, 1, along ? sizeAcross : sizeAlong);
    strip.position.set(d.center[0], 0.02, d.center[1]);
    strip.visible = false;
    scene.add(strip);

    const marker = new THREE.Group();
    const post = 0.12;
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(unitBox, frontierMat);
      p.scale.set(along ? post : sizeAcross + 0.02, H, along ? sizeAcross + 0.02 : post);
      p.position.set(
        d.center[0] + (along ? s * (d.width / 2 + post / 2) : 0),
        0,
        d.center[1] + (along ? 0 : s * (d.width / 2 + post / 2)),
      );
      marker.add(p);
    }
    const lintel = new THREE.Mesh(unitBox, frontierMat);
    lintel.scale.set(along ? d.width + post * 2 : sizeAcross + 0.02, post, along ? sizeAcross + 0.02 : d.width + post * 2);
    lintel.position.set(d.center[0], H, d.center[1]);
    marker.add(lintel);
    const bar = new THREE.Mesh(unitBox, frontierMat);
    bar.scale.set(along ? d.width : sizeAcross + 0.02, 0.03, along ? sizeAcross + 0.02 : d.width);
    bar.position.set(d.center[0], 0.03, d.center[1]);
    marker.add(bar);
    marker.visible = false;
    scene.add(marker);

    views.set(d.id, {
      doorway: d,
      strip,
      marker,
      setState({ known, frontier }) {
        strip.visible = known;
        marker.visible = frontier;
      },
    });
  }

  return { views };
}
