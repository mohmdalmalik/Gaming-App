// Art Deco dressing for the STARTING ROOM ONLY ("Fourth Floor Landing").
//
// Everything here is procedural — geometry from Three.js primitives and a handful of small
// CanvasTextures — so it needs no downloaded assets and stays light on the iPad. It replaces the
// hall's plain floor/walls/rug with ivory-and-walnut panelling, parquet, a patterned burgundy
// rug, brass sconces, a framed picture, brass doorway surrounds and a proper hotel lift.
//
// Cutaway safety: wall meshes stay 1-unit-tall groups slotted into `view.walls` (so the existing
// cutaway squashes them exactly as before), and every PROTRUDING decoration is registered on the
// wall segment it belongs to and hidden when that segment lowers — so nothing floats when the
// camera rotates. Other rooms are untouched; the shared model loader/palette is not modified.
import * as THREE from 'three';

// ---- small canvas helpers ----------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c, repX = 1, repY = 1) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repX, repY);
  t.anisotropy = 4;
  return t;
}

// Walnut basket-weave parquet across the whole 8×8 floor (one non-repeating texture, so no seams).
function parquetTexture() {
  const S = 1024, c = canvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#3a2414'; x.fillRect(0, 0, S, S);
  const tile = S / 8;                 // ~1 m blocks
  const planks = 4, pw = tile / planks;
  const shades = ['#6b4526', '#5c3a20', '#78502e', '#654223'];
  for (let by = 0; by < S; by += tile) for (let bx = 0; bx < S; bx += tile) {
    const vert = (((bx / tile) + (by / tile)) % 2) === 0;
    for (let k = 0; k < planks; k++) {
      x.fillStyle = shades[(k + (bx + by) / tile) % shades.length | 0];
      if (vert) x.fillRect(bx + k * pw + 1, by + 1, pw - 2, tile - 2);
      else x.fillRect(bx + 1, by + k * pw + 1, tile - 2, pw - 2);
      // a faint grain streak
      x.strokeStyle = 'rgba(255,220,180,0.05)'; x.lineWidth = 1;
      x.beginPath();
      if (vert) { x.moveTo(bx + k * pw + pw * 0.5, by + 2); x.lineTo(bx + k * pw + pw * 0.5, by + tile - 2); }
      else { x.moveTo(bx + 2, by + k * pw + pw * 0.5); x.lineTo(bx + tile - 2, by + k * pw + pw * 0.5); }
      x.stroke();
    }
  }
  return tex(c);
}

// One wall's vertical section: cornice / ivory upper / brass chair-rail / walnut dado / baseboard.
// Canvas top = wall top. `repX` tiles the panelling horizontally.
function wallTexture() {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
  const ivory = '#efe7d6', walnut = '#5c3a20', walnutHi = '#6f4a2c', brass = '#c8a24e', dark = '#2c1c10';
  // bands (top → bottom)
  x.fillStyle = ivory; x.fillRect(0, 0, W, H);
  x.fillStyle = '#e5dcc7'; x.fillRect(0, 0, W, H * 0.05);                 // cornice shadow line
  x.fillStyle = brass; x.fillRect(0, H * 0.05, W, H * 0.012);             // picture-rail brass line
  x.fillStyle = walnut; x.fillRect(0, H * 0.60, W, H * 0.40);            // dado (lower panelling)
  x.fillStyle = brass; x.fillRect(0, H * 0.575, W, H * 0.028);           // brass chair rail
  x.fillStyle = dark; x.fillRect(0, H * 0.96, W, H * 0.04);              // baseboard
  // raised walnut panels with brass beading, repeated across the width
  const panels = 3, pw = W / panels;
  for (let i = 0; i < panels; i++) {
    const px = i * pw + pw * 0.12, pwi = pw * 0.76, py = H * 0.63, ph = H * 0.30;
    x.fillStyle = walnutHi; x.fillRect(px, py, pwi, ph);
    x.strokeStyle = brass; x.lineWidth = 1.5; x.strokeRect(px + 2, py + 2, pwi - 4, ph - 4);
    x.strokeStyle = 'rgba(0,0,0,0.25)'; x.strokeRect(px, py, pwi, ph);
    // faint fluted pilaster on the ivory upper between panels
    x.strokeStyle = 'rgba(150,130,100,0.15)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(i * pw, H * 0.07); x.lineTo(i * pw, H * 0.55); x.stroke();
  }
  return c; // caller wraps as texture so repeat.x can be set per segment
}

// Deep burgundy rug with a stepped Art Deco gold border.
function rugTexture() {
  const W = 512, H = 384, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#5a1f28'; x.fillRect(0, 0, W, H);
  const gold = '#caa24a', dark = '#3c1219';
  const rings = [[18, gold, 6], [30, dark, 3], [40, gold, 2], [70, gold, 3]];
  for (const [inset, col, lw] of rings) {
    x.strokeStyle = col; x.lineWidth = lw; x.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  }
  // corner chevrons
  x.strokeStyle = gold; x.lineWidth = 3;
  for (const [cx, cy, sx, sy] of [[52, 52, 1, 1], [W - 52, 52, -1, 1], [52, H - 52, 1, -1], [W - 52, H - 52, -1, -1]]) {
    x.beginPath();
    x.moveTo(cx + sx * 26, cy); x.lineTo(cx, cy); x.lineTo(cx, cy + sy * 26);
    x.moveTo(cx + sx * 18, cy + sy * 8); x.lineTo(cx + sx * 8, cy + sy * 8); x.lineTo(cx + sx * 8, cy + sy * 18);
    x.stroke();
  }
  // centre medallion
  x.strokeStyle = 'rgba(202,162,74,0.6)'; x.lineWidth = 2;
  x.beginPath(); x.ellipse(W / 2, H / 2, 60, 44, 0, 0, Math.PI * 2); x.stroke();
  x.beginPath(); x.ellipse(W / 2, H / 2, 40, 28, 0, 0, Math.PI * 2); x.stroke();
  return tex(c);
}

// Art Deco sunburst fan on a teal ground — used for the framed picture and the lift pediment.
function sunburstTexture(ground = '#1f4a4a') {
  const W = 256, H = 320, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = ground; x.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.9;
  const cols = ['#e6c063', '#caa24a', '#efe7d6'];
  for (let i = 0; i <= 16; i++) {
    const a = Math.PI + (i / 16) * Math.PI;   // fan upward
    x.strokeStyle = cols[i % cols.length]; x.lineWidth = i % 2 ? 6 : 3;
    x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(a) * H * 0.95, cy + Math.sin(a) * H * 0.95); x.stroke();
  }
  // concentric arcs
  x.strokeStyle = '#efe7d6'; x.lineWidth = 3;
  for (const r of [H * 0.35, H * 0.55, H * 0.75]) { x.beginPath(); x.arc(cx, cy, r, Math.PI, Math.PI * 2); x.stroke(); }
  x.fillStyle = '#caa24a'; x.beginPath(); x.arc(cx, cy, 12, Math.PI, Math.PI * 2); x.fill();
  return tex(c);
}

// Lift floor indicator: two arrows + a "4" on a dark panel (self-lit).
function indicatorTexture() {
  const W = 128, H = 64, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#12100c'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#ffcf7a';
  x.beginPath(); x.moveTo(30, 44); x.lineTo(44, 20); x.lineTo(58, 44); x.closePath(); x.fill(); // up arrow (lit)
  x.strokeStyle = '#6a5a3a'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(70, 20); x.lineTo(84, 44); x.lineTo(98, 20); x.stroke();              // down arrow (dim)
  return tex(c);
}

// ---- shared materials (hall-only; nothing here is shared with other rooms) ----------------
const M = {
  brass: new THREE.MeshLambertMaterial({ color: '#c8a24e', emissive: '#4a3410' }),
  brassBright: new THREE.MeshLambertMaterial({ color: '#e6c877', emissive: '#6a4e18' }),
  walnut: new THREE.MeshLambertMaterial({ color: '#5c3a20' }),
  walnutDark: new THREE.MeshLambertMaterial({ color: '#33200f' }),
  ivory: new THREE.MeshLambertMaterial({ color: '#efe7d6' }),
  bronze: new THREE.MeshLambertMaterial({ color: '#6e5a34', emissive: '#241a08' }),
  shade: new THREE.MeshLambertMaterial({ color: '#ffe6b0', emissive: '#ffbe63' }),   // frosted, self-lit
};
const box = new THREE.BoxGeometry(1, 1, 1);

function part(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
  return m;
}

// A brass wall sconce: backplate + a glowing frosted bar. `n` is the inward normal (unit x/z).
function sconce(nx, nz, ry) {
  const g = new THREE.Group();
  g.add(part(box, M.brass, 0, 0, 0, 0.10, 0.5, 0.04));            // backplate
  g.add(part(box, M.brassBright, 0, -0.26, 0.02, 0.16, 0.06, 0.06)); // bottom bracket
  g.add(part(box, M.shade, 0, 0.06, 0.05, 0.12, 0.34, 0.05));     // frosted shade (glows)
  g.rotation.y = ry;
  return g;
}

// ---- main -------------------------------------------------------------------------------
// Dress the hall. Assumes greybox floor/furniture already hidden by the caller. Adds the parquet
// floor, the panelled walls (replacing the cutaway wall meshes) and every Deco decoration.
export function dressHall(view, floor, cfg) {
  const room = view.room, group = view.group;
  const H = cfg.walls.height, t = cfg.walls.thickness;
  const [minX, minZ] = room.min, [maxX, maxZ] = room.max;
  const half = { x: room.size[0] / 2, z: room.size[1] / 2 };

  // 1. Parquet floor — one plane over the whole room.
  const floorGeo = new THREE.PlaneGeometry(room.size[0], room.size[1]);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({ map: parquetTexture() }));
  floorMesh.position.set(room.center[0], 0.001, room.center[1]);
  group.add(floorMesh);

  // 2. Burgundy rug under the south-west seating group.
  const rugGeo = new THREE.PlaneGeometry(3.0, 2.2); rugGeo.rotateX(-Math.PI / 2);
  const rug = new THREE.Mesh(rugGeo, new THREE.MeshLambertMaterial({ map: rugTexture() }));
  rug.position.set(room.center[0] - 2.2, 0.02, room.center[1] + 2.5);
  group.add(rug);

  // 3. Panelled walls — replace each greybox wall segment mesh, keeping it in the cutaway system.
  const wallCanvas = wallTexture();
  for (const w of view.walls) {
    const seg = w.wall;
    const axisX = seg.side === 'north' || seg.side === 'south';
    const len = axisX ? seg.size[0] : seg.size[1];
    const map = tex(wallCanvas, Math.max(1, Math.round(len / 1.0)), 1);
    const mat = new THREE.MeshLambertMaterial({ map });
    // unit box with origin at floor: scale (length, height, thickness); cutaway overwrites scale.y.
    const g = new THREE.Group();
    g.add(part(box, mat, 0, 0.5, 0, axisX ? len : t, 1, axisX ? t : len));
    g.position.set(seg.center[0], 0, seg.center[1]);
    group.remove(w.mesh); w.mesh = g; group.add(g);
    w.deco = [];
    view.setWallHeight(w, w.height);
  }

  // Helper: the wall segment nearest a point, to hang a decoration on (so it hides with cutaway).
  const nearestWall = (x, z) => {
    let best = view.walls[0], bd = Infinity;
    for (const w of view.walls) {
      const d = (w.wall.center[0] - x) ** 2 + (w.wall.center[1] - z) ** 2;
      if (d < bd) { bd = d; best = w; }
    }
    return best;
  };
  const attach = (obj, x, z) => { group.add(obj); nearestWall(x, z).deco.push(obj); };

  const innerZ_N = minZ + t;   // inner face of the north wall (toward room)
  const innerZ_S = maxZ - t;
  const innerX_W = minX + t;
  const innerX_E = maxX - t;

  // 4. Doorway brass surrounds (four openings, 1.2 m wide). Vertical jambs + a lintel; the floor
  //    movement strips are untouched.
  for (const d of room.doorways) {
    const alongX = d.axis === 'x';                    // opening runs along x (north/south wall)
    const [dx, dz] = d.center;
    const surround = new THREE.Group();
    const w = d.width, jamb = 0.09;
    if (alongX) {
      for (const s of [-1, 1]) surround.add(part(box, M.brass, dx + s * (w / 2 + jamb / 2), H / 2, dz, jamb, H, 0.12));
      surround.add(part(box, M.brassBright, dx, H - 0.06, dz, w + jamb * 2, 0.12, 0.12));
    } else {
      for (const s of [-1, 1]) surround.add(part(box, M.brass, dx, H / 2, dz + s * (w / 2 + jamb / 2), 0.12, H, jamb));
      surround.add(part(box, M.brassBright, dx, H - 0.06, dz, 0.12, 0.12, w + jamb * 2));
    }
    attach(surround, dx, dz);
  }

  // 5. The lift — north wall, west of the doorway. Recess, double doors, brass surround, sunburst
  //    pediment, floor indicator and a call button.
  {
    const cx = -2.6, z = innerZ_N, lw = 1.7, doorH = 1.9;   // doors 0.05..1.95; wall is 2.8 tall
    const lift = new THREE.Group();
    lift.add(part(box, M.walnutDark, cx, 1.35, z + 0.02, lw + 0.34, 2.7, 0.06));           // backing panel
    // brass frame (jambs + lintel + sill)
    for (const s of [-1, 1]) lift.add(part(box, M.brass, cx + s * (lw / 2 + 0.09), 1.2, z + 0.05, 0.16, 2.4, 0.1));
    lift.add(part(box, M.brass, cx, 2.05, z + 0.05, lw + 0.34, 0.14, 0.1));                // lintel above doors
    lift.add(part(box, M.brass, cx, 0.05, z + 0.05, lw + 0.34, 0.1, 0.1));                 // sill
    // doors (bronze) with a centre seam and brass reveal lines
    for (const s of [-1, 1]) {
      lift.add(part(box, M.bronze, cx + s * 0.43, 0.05 + doorH / 2, z + 0.06, 0.82, doorH, 0.05));
      lift.add(part(box, M.brass, cx + s * 0.82, 0.05 + doorH / 2, z + 0.085, 0.04, doorH - 0.2, 0.02));
    }
    lift.add(part(box, M.walnutDark, cx, 0.05 + doorH / 2, z + 0.07, 0.03, doorH, 0.03));  // centre seam
    // floor indicator (lit) just above the doors
    const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ map: indicatorTexture(), toneMapped: false }));
    ind.position.set(cx, 2.22, z + 0.09); lift.add(ind);
    // sunburst pediment above the indicator (fits under the 2.8 m wall top)
    const ped = new THREE.Mesh(new THREE.PlaneGeometry(lw + 0.2, 0.52), new THREE.MeshLambertMaterial({ map: sunburstTexture('#24463f'), emissive: new THREE.Color('#241a08') }));
    ped.position.set(cx, 2.5, z + 0.06); lift.add(ped);
    // call button (a small brass disc with a glowing centre)
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), M.brass);
    btn.rotation.x = Math.PI / 2; btn.position.set(cx + lw / 2 + 0.2, 1.1, z + 0.09); lift.add(btn);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), M.shade);
    glow.position.set(cx + lw / 2 + 0.2, 1.1, z + 0.125); lift.add(glow);
    attach(lift, cx, z);
  }

  // 6. Framed Art Deco picture — north wall, east of the doorway.
  {
    const cx = 2.3, z = innerZ_N, fw = 0.95, fh = 1.25, y = 1.75;
    const pic = new THREE.Group();
    pic.add(part(box, M.walnut, cx, y, z + 0.03, fw + 0.14, fh + 0.14, 0.06));       // frame body
    pic.add(part(box, M.brass, cx, y, z + 0.05, fw + 0.05, fh + 0.05, 0.04));        // brass inner lip
    const art = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshLambertMaterial({ map: sunburstTexture('#26504a') }));
    art.position.set(cx, y, z + 0.07); pic.add(art);
    attach(pic, cx, z);
  }

  // 7. Brass sconces around the room (glow via emissive; the room's mood lights do the lighting).
  const sy = 1.85;
  const sconces = [
    [-0.95, innerZ_N, 0], [0.95, innerZ_N, 0],                    // flank the north doorway
    [innerX_W, -1.4, Math.PI / 2], [innerX_E, -1.4, -Math.PI / 2],
    [innerX_E, 1.7, -Math.PI / 2],
  ];
  for (const [x, z, ry] of sconces) { const s = sconce(0, 0, ry); s.position.set(x, sy, z); attach(s, x, z); }

  // 8. A tall plant already sits in the NE corner (furniture); nothing to add there.

  // Cutaway hook: hide a wall's decorations when that wall lowers, so nothing floats on rotate.
  const orig = view.setWallHeight.bind(view);
  view.setWallHeight = (w, height) => {
    orig(w, height);
    if (w.deco) { const vis = height > H * 0.6; for (const d of w.deco) d.visible = vis; }
  };
  // apply once now
  for (const w of view.walls) view.setWallHeight(w, w.height);
}
