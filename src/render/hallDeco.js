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
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeShadow } from './materials.js';

// Rounded-box geometry cache (softened edges for cushions, arms, table tops...). Keyed by dims so
// repeated sizes share one geometry; built once at dressing time, so the cost is negligible.
const _rbCache = new Map();
function rbox(w, h, d, r = 0.05) {
  const key = `${w.toFixed(3)},${h.toFixed(3)},${d.toFixed(3)},${r.toFixed(3)}`;
  let g = _rbCache.get(key);
  if (!g) { g = new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)); _rbCache.set(key, g); }
  return g;
}
// A rounded-box mesh at (x,y,z) with real dimensions (no scaling, so the corner radius stays even).
function rpart(mat, x, y, z, w, h, d, r = 0.05, ry = 0) {
  const m = new THREE.Mesh(rbox(w, h, d, r), mat);
  m.position.set(x, y, z); m.rotation.y = ry;
  return m;
}

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

// Warm oak basket-weave parquet across the whole 8×8 floor (one non-repeating texture, no seams).
// Kept QUIET: the plank shades sit close together, seams are hairline and only slightly darker than
// the wood (not black), and each plank carries a soft lengthwise grain — so the floor reads as a
// calm parquet rather than a high-contrast checkerboard.
function parquetTexture() {
  const S = 1024, c = canvas(S, S), x = c.getContext('2d');
  x.fillStyle = '#6d4a2c'; x.fillRect(0, 0, S, S);
  const tile = S / 8;                 // ~1 m blocks
  const planks = 4, pw = tile / planks;
  const shades = ['#6f4c2d', '#754f30', '#6a482b', '#714d2f'];   // narrow, warm range
  for (let by = 0; by < S; by += tile) for (let bx = 0; bx < S; bx += tile) {
    const vert = (((bx / tile) + (by / tile)) % 2) === 0;
    for (let k = 0; k < planks; k++) {
      const px = vert ? bx + k * pw : bx, py = vert ? by : by + k * pw;
      const pwx = vert ? pw : tile, pwy = vert ? tile : pw;
      x.fillStyle = shades[(k + (bx + by) / tile) % shades.length | 0];
      x.fillRect(px, py, pwx, pwy);
      // soft lengthwise grain (a few faint light/dark fibres per plank)
      for (let f = 0; f < 5; f++) {
        x.strokeStyle = f % 2 ? 'rgba(255,228,190,0.05)' : 'rgba(60,38,20,0.06)';
        x.lineWidth = 1; x.beginPath();
        if (vert) { const gx = px + pw * (0.2 + f * 0.15); x.moveTo(gx, py + 3); x.lineTo(gx + Math.sin(f) * 2, py + pwy - 3); }
        else { const gy = py + pw * (0.2 + f * 0.15); x.moveTo(px + 3, gy); x.lineTo(px + pwx - 3, gy + Math.sin(f) * 2); }
        x.stroke();
      }
      // hairline seam, only a touch darker than the wood
      x.strokeStyle = 'rgba(46,30,16,0.45)'; x.lineWidth = 1;
      x.strokeRect(px + 0.5, py + 0.5, pwx - 1, pwy - 1);
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

// A restrained woven burgundy rug: a finely woven field (fine warp/weft threads with slight tone
// variation) and a simple double-line gold border. No busy medallion or chevrons — it reads as a
// quality woven rug, not a graphic.
function rugTexture() {
  const W = 512, H = 384, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = '#6a2530'; x.fillRect(0, 0, W, H);
  // woven weave: alternating fine vertical/horizontal threads with a little random tone
  for (let y = 0; y < H; y += 3) for (let xi = 0; xi < W; xi += 3) {
    const up = ((xi + y) / 3) % 2 === 0;
    const j = (Math.sin(xi * 12.9 + y * 78.2) * 43758.5) % 1;
    const v = 0.08 * (j - 0.5);
    x.fillStyle = up ? `rgba(150,60,72,${0.18 + v})` : `rgba(70,26,34,${0.20 + v})`;
    x.fillRect(xi, y, 3, 3);
  }
  // simple gold border, two fine lines
  const gold = '#b89246';
  x.strokeStyle = gold; x.lineWidth = 4; x.strokeRect(26, 26, W - 52, H - 52);
  x.lineWidth = 2; x.strokeStyle = 'rgba(184,146,70,0.7)'; x.strokeRect(38, 38, W - 76, H - 76);
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

// Rich walnut grain for furniture frames, legs and the clock case: long vertical fibres with a
// few darker cathedral streaks. `base`/`hi` set the tone so the same generator makes oak too.
function woodGrainTexture(base = '#5c3a20', hi = '#77502f', lo = '#3f2914') {
  const W = 256, H = 256, c = canvas(W, H), x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {                       // fine straight grain
    const gx = Math.random() * W;
    x.strokeStyle = (i % 3 ? hi : lo); x.globalAlpha = 0.10 + Math.random() * 0.14; x.lineWidth = 1;
    x.beginPath(); x.moveTo(gx, 0);
    for (let y = 0; y <= H; y += 16) x.lineTo(gx + Math.sin(y * 0.05 + i) * 2.2, y);
    x.stroke();
  }
  x.globalAlpha = 0.22; x.strokeStyle = lo; x.lineWidth = 2;     // a couple of cathedral arcs
  for (let i = 0; i < 3; i++) {
    const ax = W * (0.25 + i * 0.28);
    for (let r = 8; r < 60; r += 8) { x.beginPath(); x.ellipse(ax, H * 0.5, r * 0.5, r, 0, 0, Math.PI * 2); x.stroke(); }
  }
  x.globalAlpha = 1;
  return tex(c, 1, 1);
}

// Upholstery: a soft vertical sheen (velvet/wool) with a gentle edge vignette so cushions read
// as fabric, not flat plastic. `col` is the cloth colour.
function fabricTexture(col = '#7c8a5a', deep = '#5f6a43') {
  const W = 128, H = 128, c = canvas(W, H), x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, deep); g.addColorStop(0.5, col); g.addColorStop(1, deep);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.globalAlpha = 0.06;                                 // faint vertical pile streaks
  for (let i = 0; i < 60; i++) { x.strokeStyle = i % 2 ? '#ffffff' : '#000000'; x.beginPath(); const px = Math.random() * W; x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); }
  x.globalAlpha = 1;
  return tex(c, 1, 1);
}

// A small framed landscape (warm sky, distant hills, foreground) for the second artwork.
function landscapeTexture() {
  const W = 256, H = 192, c = canvas(W, H), x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#e9c58c'); sky.addColorStop(0.6, '#d9a56a'); sky.addColorStop(1, '#b9c6a8');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  x.fillStyle = '#f4e4b8'; x.beginPath(); x.arc(W * 0.72, H * 0.34, 16, 0, Math.PI * 2); x.fill();   // low sun
  const hills = [['#8a9a6e', 0.62], ['#6f7f56', 0.74], ['#556542', 0.86]];
  for (const [col, base] of hills) {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i <= W; i += 16) x.lineTo(i, H * base + Math.sin(i * 0.03 + base * 9) * 12);
    x.lineTo(W, H); x.closePath(); x.fill();
  }
  x.fillStyle = '#3f4a30'; x.fillRect(0, H * 0.92, W, H * 0.08);
  return tex(c, 1, 1);
}

// ---- shared materials (hall-only; nothing here is shared with other rooms) ----------------
// Brass is Phong so it catches a restrained specular highlight from the room's warm point lights
// (polished metal), rather than the old flat self-lit look. A tiny emissive keeps it from going
// dead in shadow, but the sheen now comes from the lights. Wood/fabric stay matte Lambert so cloth
// reads clearly as cloth against the wood.
const brassPhong = (color, emissive = '#140d03', shininess = 55) =>
  new THREE.MeshPhongMaterial({ color, specular: '#e8cf8a', shininess, emissive });
const M = {
  brass: brassPhong('#c19a44'),
  brassBright: brassPhong('#d8b660', '#241803', 70),
  brassDark: brassPhong('#93762f', '#0e0902', 40),
  walnut: new THREE.MeshLambertMaterial({ map: woodGrainTexture('#5c3a20', '#77502f') }),
  walnutFlat: new THREE.MeshLambertMaterial({ color: '#5c3a20' }),
  walnutDark: new THREE.MeshLambertMaterial({ color: '#33200f' }),
  oak: new THREE.MeshLambertMaterial({ map: woodGrainTexture('#7a552f', '#946a3c', '#5a3d20') }),
  ivory: new THREE.MeshLambertMaterial({ color: '#efe7d6' }),
  cream: new THREE.MeshLambertMaterial({ color: '#e7ddc8' }),
  bronze: new THREE.MeshPhongMaterial({ color: '#7a6236', specular: '#b89a5a', shininess: 30, emissive: '#0e0a04' }),
  shade: new THREE.MeshLambertMaterial({ color: '#ffe6b0', emissive: '#ffbe63' }),   // frosted, self-lit
  sofa: new THREE.MeshLambertMaterial({ map: fabricTexture('#a8814e', '#8a6738') }),   // warm camel
  seam: new THREE.MeshLambertMaterial({ color: '#8a6738' }),                           // sofa seam/piping
  velvet: new THREE.MeshLambertMaterial({ map: fabricTexture('#4a6249', '#374b37') }), // muted green
  velvetSeam: new THREE.MeshLambertMaterial({ color: '#3a4d3a' }),
  cushionA: new THREE.MeshLambertMaterial({ map: fabricTexture('#7e2632', '#5c1a24') }), // burgundy
  cushionB: new THREE.MeshLambertMaterial({ map: fabricTexture('#b8923f', '#94742f') }), // gold
  leather: new THREE.MeshLambertMaterial({ color: '#8a5a30' }),                        // cognac luggage
  leather2: new THREE.MeshLambertMaterial({ color: '#6e4526' }),                       // darker case
  glass: new THREE.MeshPhongMaterial({ color: '#9fb6b4', specular: '#ffffff', shininess: 90, emissive: '#18251f', transparent: true, opacity: 0.32, depthWrite: false }),
  dark: new THREE.MeshLambertMaterial({ color: '#1c1712' }),
};
const box = new THREE.BoxGeometry(1, 1, 1);
const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);   // unit cylinder: r 0.5, height 1

function part(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
  return m;
}

// A cylinder of radius `r`, length `len`, lying along axis 'x' | 'y' | 'z'.
function tube(mat, x, y, z, r, len, axis = 'y') {
  const m = new THREE.Mesh(cylGeo, mat);
  m.position.set(x, y, z); m.scale.set(r * 2, len, r * 2);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else if (axis === 'z') m.rotation.x = Math.PI / 2;
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

// ---- bespoke furniture & period objects --------------------------------------------------
// Every builder returns a Group modelled in local space with its FRONT facing +Z and its base on
// the floor (y = 0), so a caller places it with a world position + a yaw (the same +Z-at-yaw-0
// convention the rest of the furniture data uses). Shapes are kept to shared box/cylinder geometry
// so the whole room stays a few dozen small draw calls — light enough for the iPad.

// Four turned wood legs rising from the floor to `topY`, so the piece above physically sits on
// them (no gap). `inset` keeps them just inside the footprint corners.
function legs4(g, w, d, topY, mat = M.walnutFlat, r = 0.04, inset = 0.13) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(tube(mat, sx * (w / 2 - inset), topY / 2, sz * (d / 2 - inset), r, topY, 'y'));
}

// A generously upholstered two-seat sofa: rounded seat + back cushions, a gently reclined curved
// back, shaped rolled arms, a welt seam along the front, wood legs and two throw cushions. Rounded
// geometry + matte fabric read clearly as upholstery against the wood.
function buildSofa() {
  const g = new THREE.Group(), W = 2.3, D = 0.95;
  legs4(g, W, D, 0.16);
  g.add(rpart(M.sofa, 0, 0.30, 0.02, W - 0.12, 0.28, D - 0.06, 0.06));                 // seat base
  g.add(rpart(M.seam, 0, 0.17, D / 2 - 0.05, W - 0.16, 0.03, 0.05, 0.015));            // front welt seam
  for (const s of [-1, 1]) {                                                           // shaped rolled arms
    g.add(rpart(M.sofa, s * (W / 2 - 0.10), 0.40, 0, 0.20, 0.48, D - 0.04, 0.09));
    g.add(tube(M.sofa, s * (W / 2 - 0.10), 0.60, 0.03, 0.11, D - 0.06, 'z'));
  }
  const back = rpart(M.sofa, 0, 0.66, -(D / 2 - 0.15), W - 0.34, 0.60, 0.17, 0.08);    // curved back rest
  back.rotation.x = -0.12; g.add(back);
  for (let i = -1; i <= 1; i++) {
    const bx = i * (W - 0.5) / 3;
    g.add(rpart(M.sofa, bx, 0.50, 0.06, (W - 0.54) / 3, 0.17, D - 0.30, 0.07));        // domed seat cushion
    const bc = rpart(M.sofa, bx, 0.66, -(D / 2 - 0.24), (W - 0.54) / 3, 0.44, 0.15, 0.07);
    bc.rotation.x = -0.12; g.add(bc);                                                  // back cushion
  }
  const tA = rpart(M.cushionA, -(W / 2 - 0.42), 0.60, 0.05, 0.34, 0.32, 0.14, 0.06, 0.3); tA.rotation.z = 0.22; g.add(tA);
  const tB = rpart(M.cushionB, (W / 2 - 0.42), 0.60, 0.05, 0.34, 0.32, 0.14, 0.06, -0.3); tB.rotation.z = -0.22; g.add(tB);
  return g;
}

// A high-backed wing chair in muted green velvet — curved reclined back, angled wings, shaped arms.
function buildWingChair() {
  const g = new THREE.Group(), W = 1.02, D = 0.98;
  legs4(g, W, D, 0.17, M.walnutFlat, 0.035);
  g.add(rpart(M.velvet, 0, 0.31, 0.02, W - 0.12, 0.28, D - 0.08, 0.06));               // seat base
  g.add(rpart(M.velvetSeam, 0, 0.18, D / 2 - 0.06, W - 0.18, 0.03, 0.05, 0.015));      // welt seam
  g.add(rpart(M.velvet, 0, 0.50, 0.05, W - 0.30, 0.15, D - 0.30, 0.07));               // seat cushion
  const back = rpart(M.velvet, 0, 0.80, -(D / 2 - 0.13), W - 0.16, 0.82, 0.16, 0.08);  // tall curved back
  back.rotation.x = -0.10; g.add(back);
  const bc = rpart(M.cushionA, 0, 0.62, -(D / 2 - 0.22), W - 0.34, 0.42, 0.13, 0.07); bc.rotation.x = -0.10; g.add(bc);
  for (const s of [-1, 1]) {
    const wing = rpart(M.velvet, s * (W / 2 - 0.06), 0.90, -(D / 2 - 0.32), 0.12, 0.44, 0.40, 0.07);
    wing.rotation.z = s * 0.05; g.add(wing);                                           // gently angled wing
    g.add(rpart(M.velvet, s * (W / 2 - 0.06), 0.42, 0.03, 0.14, 0.42, D - 0.16, 0.07)); // shaped arm
    g.add(tube(M.velvet, s * (W / 2 - 0.06), 0.60, 0.05, 0.08, D - 0.20, 'z'));         // arm roll
  }
  return g;
}

// Walnut-and-glass coffee table: softened apron frame connecting the four legs, a glass top and a
// lower shelf with book stacks.
function buildCoffeeTable() {
  const g = new THREE.Group(), W = 1.28, D = 0.72;
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    g.add(tube(M.walnut, sx * (W / 2 - 0.06), 0.19, sz * (D / 2 - 0.06), 0.035, 0.38, 'y'));  // legs 0..0.38
  g.add(rpart(M.walnut, 0, 0.40, D / 2 - 0.05, W - 0.04, 0.06, 0.06, 0.02));           // aprons (tie the legs)
  g.add(rpart(M.walnut, 0, 0.40, -(D / 2 - 0.05), W - 0.04, 0.06, 0.06, 0.02));
  for (const s of [-1, 1]) g.add(rpart(M.walnut, s * (W / 2 - 0.05), 0.40, 0, 0.06, 0.06, D - 0.04, 0.02));
  const glass = rpart(M.glass, 0, 0.44, 0, W - 0.02, 0.03, D - 0.02, 0.01); glass.renderOrder = 3; g.add(glass);
  g.add(rpart(M.walnutFlat, 0, 0.13, 0, W - 0.16, 0.03, D - 0.16, 0.02));              // lower shelf
  const books = buildBooks(3, 0.22); books.position.set(-0.2, 0.145, 0.06); books.rotation.y = 0.2; g.add(books);
  const books2 = buildBooks(2, 0.2); books2.position.set(0.28, 0.145, -0.04); books2.rotation.y = -0.4; g.add(books2);
  return g;
}

// A low sideboard/console with softened edges, three drawers with brass pulls, on wood legs.
function buildConsole() {
  const g = new THREE.Group(), W = 1.25, D = 0.45;
  legs4(g, W, D, 0.18, M.walnutDark, 0.035, 0.08);
  g.add(rpart(M.walnut, 0, 0.48, 0, W, 0.60, D - 0.02, 0.03));                         // carcass 0.18..0.78
  g.add(rpart(M.walnutFlat, 0, 0.80, 0, W + 0.06, 0.04, D + 0.04, 0.02));              // top
  for (let i = -1; i <= 1; i++) {
    g.add(rpart(M.oak, i * 0.4, 0.50, D / 2 - 0.005, 0.36, 0.42, 0.03, 0.02));         // drawer front
    g.add(tube(M.brass, i * 0.4, 0.50, D / 2 + 0.02, 0.02, 0.18, 'x'));                // brass pull
  }
  return g;
}

// A brass table lamp with a warm glowing shade (the mood lights do the actual lighting).
function buildTableLamp() {
  const g = new THREE.Group();
  g.add(tube(M.brass, 0, 0.03, 0, 0.09, 0.06, 'y'));                                   // base
  g.add(tube(M.brass, 0, 0.28, 0, 0.02, 0.46, 'y'));                                   // stem
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 0.22, 18), M.shade);
  shade.position.set(0, 0.58, 0); g.add(shade);
  return g;
}

// A period rotary telephone.
function buildTelephone() {
  const g = new THREE.Group();
  g.add(part(box, M.dark, 0, 0.05, 0, 0.22, 0.08, 0.17));                              // body
  g.add(tube(M.brassDark, 0.02, 0.095, 0.02, 0.05, 0.012, 'y'));                       // dial
  g.add(tube(M.dark, 0, 0.15, -0.05, 0.028, 0.24, 'x'));                               // handset bar
  for (const s of [-1, 1]) g.add(part(box, M.dark, s * 0.1, 0.135, -0.05, 0.05, 0.05, 0.06)); // ear/mouth
  return g;
}

const bookMats = ['#7e2632', '#2f4a5c', '#3f5a3a', '#8a6738', '#4a3358', '#a07f34']
  .map(c => new THREE.MeshLambertMaterial({ color: c }));
// A short stack of `n` books, total run ~`w`.
function buildBooks(n = 3, w = 0.24) {
  const g = new THREE.Group();
  let y = 0;
  for (let i = 0; i < n; i++) {
    const h = 0.045 + Math.random() * 0.02, d = 0.15 + Math.random() * 0.03;
    g.add(part(box, bookMats[(i * 2 + n) % bookMats.length], (Math.random() - 0.5) * 0.03, y + h / 2, 0, w - i * 0.015, h, d));
    y += h;
  }
  return g;
}

// A potted plant with recognizable leaf blades: a terracotta pot and a spray of long, tapered
// leaves fanning up and outward (each a flattened 4-sided blade), a couple arching over.
const leafGeo = new THREE.ConeGeometry(0.075, 0.6, 4);   // slim 4-sided blade, reused for every leaf
const leafMats = ['#3f6b39', '#4e7d43', '#5a8c49', '#356032'].map(c => new THREE.MeshLambertMaterial({ color: c }));
function buildPlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.13, 0.34, 18), new THREE.MeshLambertMaterial({ color: '#9c5a3c' }));
  pot.position.y = 0.17; g.add(pot);
  g.add(tube(M.brassDark, 0, 0.33, 0, 0.185, 0.05, 'y'));                              // pot rim
  g.add(tube(M.dark, 0, 0.34, 0, 0.15, 0.02, 'y'));                                    // soil
  const N = 9;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + i * 0.7;
    const tilt = 0.35 + (i % 3) * 0.18;                    // how far the blade leans out
    const len = 0.9 + (i % 2) * 0.2;
    const leaf = new THREE.Mesh(leafGeo, leafMats[i % leafMats.length]);
    leaf.scale.set(1, len, 0.34);                          // flatten into a blade
    leaf.position.set(Math.cos(a) * 0.06, 0.34, Math.sin(a) * 0.06);
    leaf.rotation.set(Math.sin(a) * tilt, -a, Math.cos(a) * tilt);
    // lift so the blade base sits in the pot, not through the floor
    leaf.position.y = 0.34 + Math.cos(tilt) * len * 0.28;
    g.add(leaf);
  }
  return g;
}

// A longcase (grandfather) clock — a statement period piece to stand against a wall.
function buildClock() {
  const g = new THREE.Group();
  g.add(part(box, M.walnut, 0, 0.22, 0, 0.5, 0.44, 0.3));                              // plinth
  g.add(part(box, M.walnut, 0, 0.9, 0, 0.36, 0.92, 0.26));                             // trunk
  g.add(part(box, M.glass, 0, 0.92, 0.135, 0.24, 0.78, 0.02));                         // trunk glass
  g.add(tube(M.brass, 0, 0.82, 0.12, 0.012, 0.46, 'y'));                               // pendulum rod
  g.add(tube(M.brass, 0, 0.6, 0.12, 0.055, 0.02, 'z'));                                // bob
  g.add(part(box, M.walnut, 0, 1.55, 0, 0.48, 0.5, 0.32));                             // hood
  g.add(tube(M.cream, 0, 1.56, 0.17, 0.135, 0.02, 'z'));                               // dial
  g.add(tube(M.brass, 0, 1.56, 0.165, 0.15, 0.015, 'z'));                              // brass bezel
  g.add(part(box, M.dark, 0, 1.60, 0.185, 0.015, 0.1, 0.01, 0.4));                     // hands
  g.add(part(box, M.dark, 0, 1.55, 0.185, 0.07, 0.014, 0.01));
  g.add(part(box, M.walnut, 0, 1.85, 0, 0.5, 0.06, 0.34));                             // cornice
  g.add(tube(M.brass, 0, 1.94, 0.02, 0.03, 0.1, 'y'));                                 // finial
  return g;
}

// A stack of two vintage suitcases — flat, wide and clearly luggage: cognac leather bodies with
// brass straps, corner studs and top handles.
function buildLuggage() {
  const g = new THREE.Group();
  const suitcase = (mat, cx, cy, cz, w, h, d, ry) => {
    g.add(part(box, mat, cx, cy, cz, w, h, d, ry));                                    // body
    for (const s of [-1, 1])                                                           // two brass straps
      g.add(part(box, M.brassDark, cx + Math.cos(ry) * s * w * 0.28, cy, cz - Math.sin(ry) * s * w * 0.28, 0.04, h + 0.01, d + 0.01, ry));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])                                // corner studs
      g.add(part(box, M.brass, cx + sx * w * 0.42 * Math.cos(ry), cy - h / 2 + 0.02, cz + sz * d * 0.42, 0.05, 0.04, 0.05, ry));
    g.add(tube(M.walnutDark, cx, cy + h / 2 + 0.035, cz, 0.02, w * 0.34, 'x'));        // handle
  };
  suitcase(M.leather, 0, 0.14, 0, 0.7, 0.22, 0.46, 0);                                 // big case (bottom)
  suitcase(M.leather2, 0.03, 0.36, 0.02, 0.56, 0.18, 0.38, 0.14);                      // smaller case on top
  return g;
}

// A framed picture built facing +Z (frame body, brass lip, art plane), for hanging on a wall.
function buildWallArt(map, fw, fh) {
  const g = new THREE.Group();
  g.add(part(box, M.walnut, 0, 0, 0.03, fw + 0.14, fh + 0.14, 0.06));                  // frame
  g.add(part(box, M.brass, 0, 0, 0.062, fw + 0.05, fh + 0.05, 0.02));                  // brass lip
  const art = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshLambertMaterial({ map }));
  art.position.z = 0.075; g.add(art);
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

    // Skirting board + crown cornice on the room-facing side, as real relief (proud of the wall
    // face). Attached to this segment's `deco`, so they lower/hide with the wall on cutaway.
    const inN = { north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0] }[seg.side];
    const cx = seg.center[0] + inN[0] * (t / 2), cz = seg.center[1] + inN[1] * (t / 2);
    const prof = (h, y, depth, mtl) => {
      const s = part(box, mtl, cx + inN[0] * depth / 2, y, cz + inN[1] * depth / 2,
        axisX ? len : depth, h, axisX ? depth : len);
      group.add(s); w.deco.push(s);
    };
    prof(0.16, 0.08, 0.05, M.walnutFlat);   // skirting
    prof(0.06, H - 0.12, 0.05, M.walnutFlat); // picture-rail run
    prof(0.10, H - 0.05, 0.07, M.cream);      // crown cornice
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

  // 4. Refined walnut door surrounds around each of the four openings: two jambs + a header,
  //    stepped PROUD of the wall face and set OUTSIDE the game's gold doorway markers (which sit
  //    on the wall line at ±0.66). Keeping them clear means the casing never sits on the same
  //    plane as those markers (so no z-fighting) and never hides the "leads somewhere" cue.
  {
    const doors = [
      { c: [0, minZ], n: [0, 1], ax: true }, { c: [0, maxZ], n: [0, -1], ax: true },
      { c: [minX, 0], n: [1, 0], ax: false }, { c: [maxX, 0], n: [-1, 0], ax: false },
    ];
    const jOff = 0.80, jH = 2.35;           // jamb centre offset from opening; jamb height
    for (const d of doors) {
      const [ox, oz] = d.c, [nx, nz] = d.n, along = d.ax;
      const proud = t / 2 + 0.06;
      const px = ox + nx * proud, pz = oz + nz * proud;
      const sur = new THREE.Group();
      for (const s of [-1, 1]) {
        const jx = px + (along ? s * jOff : 0), jz = pz + (along ? 0 : s * jOff);
        sur.add(part(box, M.walnut, jx, jH / 2, jz, along ? 0.14 : 0.11, jH, along ? 0.11 : 0.14));
      }
      const hh = H - jH;
      sur.add(part(box, M.walnut, px, jH + hh / 2, pz, along ? jOff * 2 + 0.14 : 0.11, hh, along ? 0.11 : jOff * 2 + 0.14));
      sur.add(part(box, M.brass, px, jH - 0.03, pz, along ? jOff * 2 : 0.07, 0.03, along ? 0.07 : jOff * 2)); // brass fillet
      attach(sur, ox + nx * 0.2, oz + nz * 0.2);
    }
  }

  // 5. The lift — north wall, west of the doorway. Recess, double doors, brass surround, sunburst
  //    pediment, floor indicator and a call button.
  {
    const cx = -2.6, z = innerZ_N, lw = 1.7, doorH = 1.9;   // doors 0.05..1.95; wall is 2.8 tall
    const lift = new THREE.Group();
    lift.add(part(box, M.walnutDark, cx, 1.35, z + 0.02, lw + 0.34, 2.7, 0.06));           // backing panel
    // brass frame (jambs + lintel + sill), pushed proud so their backs clear the wall face
    for (const s of [-1, 1]) lift.add(part(box, M.brass, cx + s * (lw / 2 + 0.09), 1.2, z + 0.08, 0.16, 2.4, 0.1));
    lift.add(part(box, M.brass, cx, 2.05, z + 0.08, lw + 0.34, 0.14, 0.1));                // lintel above doors
    lift.add(part(box, M.brass, cx, 0.05, z + 0.08, lw + 0.34, 0.1, 0.1));                 // sill
    // doors (bronze) with a centre seam and brass reveal lines
    for (const s of [-1, 1]) {
      lift.add(part(box, M.bronze, cx + s * 0.43, 0.05 + doorH / 2, z + 0.06, 0.82, doorH, 0.05));
      lift.add(part(box, M.brass, cx + s * 0.82, 0.05 + doorH / 2, z + 0.085, 0.04, doorH - 0.2, 0.02));
    }
    lift.add(part(box, M.walnutDark, cx, 0.05 + doorH / 2, z + 0.07, 0.03, doorH, 0.03));  // centre seam
    // sunburst pediment above the doors (fits under the 2.8 m wall top), proud of the backing
    const ped = new THREE.Mesh(new THREE.PlaneGeometry(lw + 0.2, 0.52), new THREE.MeshLambertMaterial({ map: sunburstTexture('#24463f'), emissive: new THREE.Color('#241a08') }));
    ped.position.set(cx, 2.5, z + 0.075); lift.add(ped);
    // floor indicator (lit) just above the doors, clearly in front of everything
    const ind = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.22), new THREE.MeshBasicMaterial({ map: indicatorTexture(), toneMapped: false }));
    ind.position.set(cx, 2.2, z + 0.14); lift.add(ind);
    // call button (a small brass disc with a glowing centre)
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.06, 12), M.brass);
    btn.rotation.x = Math.PI / 2; btn.position.set(cx + lw / 2 + 0.2, 1.1, z + 0.09); lift.add(btn);
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.022, 10), M.shade);
    glow.position.set(cx + lw / 2 + 0.2, 1.1, z + 0.125); lift.add(glow);
    attach(lift, cx, z);
  }

  // 6. Framed Art Deco picture — north wall, east of the doorway. Layers step forward off the
  //    wall with clear gaps (each front layer smaller) so no two visible faces are coplanar.
  {
    const cx = 2.3, z = innerZ_N, fw = 0.95, fh = 1.25, y = 1.75;
    const pic = new THREE.Group();
    pic.add(part(box, M.walnut, cx, y, z + 0.055, fw + 0.16, fh + 0.16, 0.06));      // frame body (proud of wall)
    pic.add(part(box, M.brass, cx, y, z + 0.085, fw + 0.06, fh + 0.06, 0.02));       // brass inner lip
    const art = new THREE.Mesh(new THREE.PlaneGeometry(fw, fh), new THREE.MeshLambertMaterial({ map: sunburstTexture('#26504a') }));
    art.position.set(cx, y, z + 0.11); pic.add(art);                                 // canvas, in front of the frame
    attach(pic, cx, z);
  }

  // 7. Brass sconces around the room (glow via emissive; the room's mood lights do the lighting).
  const sy = 1.85;
  const sconces = [
    [-0.95, innerZ_N, 0], [0.95, innerZ_N, 0],                    // flank the north doorway
    [innerX_W, -1.4, Math.PI / 2], [innerX_E, -1.6, -Math.PI / 2], // west + east walls
  ];
  for (const [x, z, ry] of sconces) { const s = sconce(0, 0, ry); s.position.set(x, sy, z); attach(s, x, z); }

  // 8. A second framed picture — a small warm landscape — on the east wall above the console.
  {
    const land = buildWallArt(landscapeTexture(), 0.8, 0.6);
    land.position.set(innerX_E - 0.02, 1.95, room.center[1] + 2.0);
    land.rotation.y = -Math.PI / 2;   // face west, into the room
    attach(land, innerX_E, room.center[1] + 2.0);
  }

  // 9. Bespoke furniture, replacing the generic Kenney pieces for this hero room. Positions and
  //    yaws mirror the collision data in floor1.js (so the walkable grid still matches), FRONT
  //    facing into the room. Pieces off the rug keep the greybox contact shadow; the seating group
  //    stands ON the rug (y≈0.02), which hides those, so each gets a shadow on the rug surface.
  const cX = room.center[0], cZ = room.center[1];
  const place = (obj, x, z, yaw) => { obj.position.set(x, 0, z); obj.rotation.y = yaw; group.add(obj); };
  const rugShadow = (x, z, w, d) => { const s = makeShadow(w, d); s.position.set(x, 0.032, z); group.add(s); };
  place(buildSofa(), cX - 2.4, cZ + 3.35, Math.PI);            // sofa, south wall
  rugShadow(cX - 2.4, cZ + 3.35, 2.6, 1.2);
  place(buildWingChair(), cX - 3.35, cZ + 2.0, Math.PI / 2);   // wing chair, west wall
  rugShadow(cX - 3.35, cZ + 2.0, 1.25, 1.3);
  place(buildCoffeeTable(), cX - 2.1, cZ + 2.35, 0);           // glass coffee table on the rug
  rugShadow(cX - 2.1, cZ + 2.35, 1.5, 0.95);
  place(buildPlant(), cX + 3.5, cZ + 3.5, 0);                  // SE plant
  place(buildPlant(), cX + 3.4, cZ - 3.4, 0);                  // NE plant

  // Console (east wall) dressed with a lamp, telephone, books and a standing photo — built as the
  // console's children so they rotate with it.
  {
    const con = buildConsole(), top = 0.82;
    const lamp = buildTableLamp(); lamp.position.set(-0.4, top, -0.02); con.add(lamp);
    const phone = buildTelephone(); phone.position.set(0.14, top, 0.04); phone.rotation.y = 0.3; con.add(phone);
    const bk = buildBooks(3, 0.22); bk.position.set(0.46, top, -0.04); bk.rotation.y = -0.5; con.add(bk);
    const photo = buildWallArt(landscapeTexture(), 0.14, 0.18); photo.position.set(0.44, top + 0.18, -0.1); con.add(photo);
    place(con, cX + 3.53, cZ + 2.0, -Math.PI / 2);
  }

  // 10. A longcase clock against the west wall (statement period piece) and a luggage stack by the
  //     lift (the "just arrived" touch). The clock hides with the west wall on cutaway.
  {
    const clock = buildClock();
    clock.position.set(innerX_W + 0.16, 0, cZ - 2.6); clock.rotation.y = Math.PI / 2;
    const sh = makeShadow(0.7, 0.5); sh.position.set(innerX_W + 0.16, 0.012, cZ - 2.6);
    group.add(sh); attach(clock, innerX_W, cZ - 2.6); clock.userData.shadow = sh;
    // keep the clock's shadow hidden/shown with it
    nearestWall(innerX_W, cZ - 2.6).deco.push(sh);
  }
  {
    const bags = buildLuggage();
    place(bags, cX - 1.55, cZ - 3.15, 0.35);
    const sh = makeShadow(0.85, 0.7); sh.position.set(cX - 1.55, 0.012, cZ - 3.15); group.add(sh);
  }

  // Cutaway hook: hide a wall's decorations when that wall lowers, so nothing floats on rotate.
  const orig = view.setWallHeight.bind(view);
  view.setWallHeight = (w, height) => {
    orig(w, height);
    if (w.deco) { const vis = height > H * 0.6; for (const d of w.deco) d.visible = vis; }
  };
  // apply once now
  for (const w of view.walls) view.setWallHeight(w, w.height);
}
