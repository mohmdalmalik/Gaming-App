// Small procedural canvas textures for the menu lobby (no image files to download): marble floor,
// walnut panelling, rugs, the key pigeonholes, the lift doors and dial, the night windows and a soft
// round glow. Each is drawn once and cached. Sizes are kept small (≤ 1024) for the iPad.
import * as THREE from 'three';

const cache = new Map();
function canvasTexture(key, w, h, draw, { repeat, srgb = true, aniso = 4, mipmaps = true } = {}) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (!mipmaps) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  cache.set(key, t);
  return t;
}

// Deterministic noise so the textures are the same every load.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Cream marble, 2 x 2 tiles per texture, thin dark joints and a small black-and-brass cabochon at
// each tile corner (Art Deco). Repeats.
export function marbleFloor() {
  return canvasTexture('marble', 512, 512, (g, w, h) => {
    const r = rng(7);
    const T = w / 2;
    for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
      const x0 = tx * T, y0 = ty * T;
      const light = (tx + ty) % 2 === 0;
      g.fillStyle = light ? '#e3d4b6' : '#d4c09c';
      g.fillRect(x0, y0, T, T);
      // soft clouding
      for (let i = 0; i < 26; i++) {
        const cx = x0 + r() * T, cy = y0 + r() * T, rad = 20 + r() * 70;
        const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grd.addColorStop(0, light ? 'rgba(255,248,230,0.22)' : 'rgba(150,120,85,0.14)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(x0, y0, T, T);
      }
      // veins
      g.save(); g.beginPath(); g.rect(x0, y0, T, T); g.clip();
      for (let i = 0; i < 5; i++) {
        g.strokeStyle = `rgba(120,95,70,${0.12 + r() * 0.16})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        let x = x0 + r() * T, y = y0;
        g.moveTo(x, y);
        while (y < y0 + T) { x += (r() - 0.5) * 30; y += 12 + r() * 20; g.lineTo(x, y); }
        g.stroke();
      }
      g.restore();
    }
    // joints
    g.strokeStyle = 'rgba(70,52,36,0.75)';
    g.lineWidth = 2;
    for (let i = 0; i <= 2; i++) {
      g.beginPath(); g.moveTo(i * T, 0); g.lineTo(i * T, h); g.stroke();
      g.beginPath(); g.moveTo(0, i * T); g.lineTo(w, i * T); g.stroke();
    }
    // corner cabochons (drawn at the 4 corners and the centre, which wrap into whole diamonds)
    const dia = (cx, cy, s) => {
      g.fillStyle = '#1d1512';
      g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.closePath(); g.fill();
      g.strokeStyle = '#b08a45'; g.lineWidth = 2.5; g.stroke();
    };
    for (const [cx, cy] of [[0, 0], [T, 0], [w, 0], [0, T], [T, T], [w, T], [0, h], [T, h], [w, h]]) dia(cx, cy, 22);
  }, { repeat: true, aniso: 8 });
}

// Walnut wall panelling: one bay (1.2 m wide x 3.2 m tall when mapped 1:1) — a tall raised panel
// with a slim brass inlay, a dado rail and a short lower panel. Repeats horizontally.
export function walnutPanel() {
  return canvasTexture('walnut', 256, 512, (g, w, h) => {
    const r = rng(3);
    // base grain
    g.fillStyle = '#4a2c19'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 220; i++) {
      const x = r() * w;
      g.strokeStyle = `rgba(${r() < 0.5 ? '30,16,8' : '110,70,40'},${0.08 + r() * 0.12})`;
      g.lineWidth = 0.5 + r() * 2;
      g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + (r() - 0.5) * 12, h * 0.3, x + (r() - 0.5) * 12, h * 0.7, x + (r() - 0.5) * 8, h); g.stroke();
    }
    const panel = (x0, y0, x1, y1) => {
      // raised panel: lighter field, dark shadow bottom/right, highlight top/left
      const grd = g.createLinearGradient(x0, y0, x1, y1);
      grd.addColorStop(0, 'rgba(150,95,55,0.30)'); grd.addColorStop(1, 'rgba(90,50,25,0.15)');
      g.fillStyle = grd; g.fillRect(x0, y0, x1 - x0, y1 - y0);
      g.strokeStyle = 'rgba(15,8,4,0.7)'; g.lineWidth = 5;
      g.beginPath(); g.moveTo(x1, y0); g.lineTo(x1, y1); g.lineTo(x0, y1); g.stroke();
      g.strokeStyle = 'rgba(190,130,80,0.35)'; g.lineWidth = 3;
      g.beginPath(); g.moveTo(x0, y1); g.lineTo(x0, y0); g.lineTo(x1, y0); g.stroke();
      // brass inlay inside the panel
      g.strokeStyle = 'rgba(214,170,90,0.85)'; g.lineWidth = 2;
      g.strokeRect(x0 + 14, y0 + 14, x1 - x0 - 28, y1 - y0 - 28);
    };
    const m = 22;
    panel(m, m, w - m, h * 0.62);                  // tall upper panel
    // dado rail
    g.fillStyle = '#2a170c'; g.fillRect(0, h * 0.655, w, 10);
    g.fillStyle = 'rgba(214,170,90,0.9)'; g.fillRect(0, h * 0.655 + 3, w, 3);
    panel(m, h * 0.7, w - m, h - 26);             // lower panel
    // skirting
    g.fillStyle = '#1e1008'; g.fillRect(0, h - 14, w, 14);
    // bay edges (stiles)
    g.fillStyle = 'rgba(20,10,5,0.55)'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
  }, { repeat: true });
}

// Burgundy rug with a gold double border and a stepped Art Deco medallion.
export function rugTexture() {
  return canvasTexture('rug', 512, 512, (g, w, h) => {
    const r = rng(11);
    g.fillStyle = '#5e1219'; g.fillRect(0, 0, w, h);
    // pile noise
    for (let i = 0; i < 3000; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,0,4' : '140,40,50'},${r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    g.strokeStyle = '#c59a4e'; g.lineWidth = 10; g.strokeRect(22, 22, w - 44, h - 44);
    g.lineWidth = 3; g.strokeRect(46, 46, w - 92, h - 92);
    g.fillStyle = '#3c0a10'; g.fillRect(52, 52, w - 104, h - 104);
    g.fillStyle = '#6b1820'; g.fillRect(70, 70, w - 140, h - 140);
    // stepped medallion
    g.save(); g.translate(w / 2, h / 2);
    const steps = [[150, '#c59a4e'], [138, '#3c0a10'], [112, '#c59a4e'], [104, '#5e1219'], [70, '#c59a4e'], [62, '#3c0a10'], [28, '#c59a4e']];
    for (const [s, col] of steps) {
      g.fillStyle = col; g.beginPath();
      g.moveTo(0, -s); g.lineTo(s * 0.35, -s * 0.35); g.lineTo(s, 0); g.lineTo(s * 0.35, s * 0.35);
      g.lineTo(0, s); g.lineTo(-s * 0.35, s * 0.35); g.lineTo(-s, 0); g.lineTo(-s * 0.35, -s * 0.35); g.closePath(); g.fill();
    }
    g.restore();
    // corner fans
    for (const [cx, cy, a] of [[70, 70, 0], [w - 70, 70, Math.PI / 2], [w - 70, h - 70, Math.PI], [70, h - 70, -Math.PI / 2]]) {
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.strokeStyle = '#c59a4e'; g.lineWidth = 3;
      for (let k = 1; k <= 3; k++) { g.beginPath(); g.arc(0, 0, k * 16, 0, Math.PI / 2); g.stroke(); }
      g.restore();
    }
  }, { aniso: 8 });
}

// A long runner: burgundy with gold borders along both sides and stepped chevrons (repeats along v).
export function runnerTexture() {
  return canvasTexture('runner', 256, 512, (g, w, h) => {
    const r = rng(13);
    g.fillStyle = '#56101a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '20,0,4' : '140,40,50'},${r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
    g.fillStyle = '#c59a4e'; g.fillRect(14, 0, 9, h); g.fillRect(w - 23, 0, 9, h);
    g.fillRect(32, 0, 3, h); g.fillRect(w - 35, 0, 3, h);
    g.fillStyle = '#3c0a10'; g.fillRect(38, 0, w - 76, h);
    g.strokeStyle = '#c59a4e'; g.lineWidth = 5;
    for (let k = 0; k < 4; k++) {
      const y = k * h / 4 + 30;
      g.beginPath(); g.moveTo(60, y + 60); g.lineTo(w / 2, y); g.lineTo(w - 60, y + 60); g.stroke();
      g.beginPath(); g.moveTo(84, y + 70); g.lineTo(w / 2, y + 26); g.lineTo(w - 84, y + 70); g.stroke();
      g.fillStyle = '#c59a4e';
      g.beginPath(); g.moveTo(w / 2, y + 52); g.lineTo(w / 2 + 12, y + 64); g.lineTo(w / 2, y + 76); g.lineTo(w / 2 - 12, y + 64); g.closePath(); g.fill();
    }
  }, { repeat: true, aniso: 8 });
}

// The key wall behind reception: walnut pigeonholes, brass key tags, a few letters.
export function keyBoardTexture() {
  return canvasTexture('keys', 512, 256, (g, w, h) => {
    const r = rng(5);
    g.fillStyle = '#2a170c'; g.fillRect(0, 0, w, h);
    const cols = 12, rows = 5, mx = 14, my = 14;
    const cw = (w - mx * 2) / cols, ch = (h - my * 2) / rows;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = mx + i * cw, y = my + j * ch;
      g.fillStyle = '#120904'; g.fillRect(x + 3, y + 3, cw - 6, ch - 6);
      g.fillStyle = 'rgba(120,75,40,0.5)'; g.fillRect(x + 3, y + ch - 8, cw - 6, 5);
      if (r() < 0.62) {   // a key on its hook with a brass tag
        g.fillStyle = '#d2a85a';
        g.fillRect(x + cw / 2 - 1, y + 8, 2, 12);
        g.beginPath(); g.ellipse(x + cw / 2, y + 25, 5, 8, 0, 0, Math.PI * 2); g.fill();
      }
      if (r() < 0.25) {   // a letter waiting
        g.fillStyle = '#e8dcc0'; g.fillRect(x + 6, y + ch - 20, cw - 12, 10);
      }
    }
    g.strokeStyle = '#c59a4e'; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
  });
}

// Brass lift door leaf: brushed brass with an engraved Art Deco chevron/sunray panel.
export function liftDoorTexture() {
  return canvasTexture('liftdoor', 128, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#8a6326'); grd.addColorStop(0.5, '#d9b061'); grd.addColorStop(1, '#8a6326');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const r = rng(9);
    for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(255,240,200,${r() * 0.07})`; g.fillRect(0, r() * h, w, 1); }
    g.strokeStyle = 'rgba(60,38,10,0.65)'; g.lineWidth = 2;
    g.strokeRect(10, 10, w - 20, h - 20);
    // chevrons
    for (let k = 0; k < 7; k++) {
      const y = 60 + k * 16;
      g.beginPath(); g.moveTo(18, y + 10); g.lineTo(w / 2, y); g.lineTo(w - 18, y + 10); g.stroke();
    }
    // sun rays from the bottom
    for (let k = -4; k <= 4; k++) {
      g.beginPath(); g.moveTo(w / 2, h - 16); g.lineTo(w / 2 + k * 11, h - 80); g.stroke();
    }
  });
}

// The floor dial's face, in its 256 x 160 design space (pixels, y down). src/menu/lobbySet.js sizes the
// plate from w x h, turns the needle on `hub` and makes it `tip` long, so the needle's pivot is the brass
// hub drawn here and its arrow ends on the ring of ticks. Radii from the hub:
//   rim   the brass rim's outer edge          face  the cream face inside it
//   tick  the ring of ticks (inner, outer)    tip   where the needle's arrow ends (on the ticks)
//   mark  where the marks' centres stand      font  the marks' largest size (smaller if they would crowd)
export const DIAL_FACE = { w: 256, h: 160, hub: [128, 142], hubR: 9, base: 14, rim: 124, face: 114, tick: [69, 79], tip: 75, mark: 97, font: 24 };

// Where a point `f` steps from the first mark stands on the dial (0 = L ... floors = the top mark): its
// angle in radians from straight up, positive to the left. The marks spread evenly over `sweepDeg` degrees
// (src/menu/lobbyLayout.js lift.dialSweep), centred on straight up. The texture draws its marks with this and
// the needle turns by it (src/menu/lobbySet.js setFloor), so the needle always points exactly at a mark.
export function dialAngle(f, floors, sweepDeg) { return (0.5 - f / floors) * sweepDeg * Math.PI / 180; }

// Floor-indicator dial, after the 1920s Art Deco ones: a cream half-disc inside a brass rim on a brass base,
// a faint sunburst round the hub (mirrored about straight up), a ring of ticks with a scale line, and the
// floor marks (`labels`, left to right: src/menu/lobbyLayout.js lift.dial) spread evenly over `sweepDeg`
// degrees (less than a half circle, so the first and last marks stand clear of the base). Every mark stands
// upright on the line from the hub through its tick, outside the ring of ticks (the needle is a mesh:
// src/menu/lobbySet.js). Drawn in the DIAL_FACE design space and scaled to a 384 x 240 canvas, so the marks
// stay crisp when the camera pushes in.
// Plain lining figures (old-style 3, 4, 5, 7 and 9 sink below the line), every mark drawn equally narrow
// (MARK_NARROW: tall, condensed Deco figures); the marks' size is measured here and stepped down if any two
// would come within MARK_GAP of each other or of the ticks, rim or base (a device's own serif font may be
// wider). What was drawn (each mark's and tick's box, in design pixels, and the sunburst's wedges) is kept in
// texture.userData.dial for tests/menu-scene-shots.mjs.
const MARK_GAP = 3;   // design px (4.5 on the canvas): the least room round every mark
const MARK_NARROW = 0.74;   // the marks' width, as a share of the font's own
const MARK_WEIGHT = 0.9;    // design px of ink traced round each mark, so the narrow figures keep a bold stroke
export function dialTexture(labels, sweepDeg) {
  const K = 1.5, F = DIAL_FACE;
  let drawn = null;
  const tex = canvasTexture(`dial:${labels.join(',')}:${sweepDeg}`, F.w * K, F.h * K, (g) => {
    g.scale(K, K);
    const { w, h } = F, [cx, cy] = F.hub, n = labels.length - 1;
    const ang = i => dialAngle(i, n, sweepDeg);
    const at = (a, r) => [cx - Math.sin(a) * r, cy - Math.cos(a) * r];
    const arcA = a => -Math.PI / 2 - a;            // canvas arc angle (from +x, clockwise) for an angle from up
    const brass = '#b08a45', brassDark = '#8a6a32', cream = '#efe2c2', creamDeep = '#e5d3aa', ink = '#2a1a10';
    g.clearRect(0, 0, w, h);
    // brass rim and base, the cream face, a thin dark bevel where they meet
    g.fillStyle = brass;
    g.beginPath(); g.arc(cx, cy, F.rim, Math.PI, 0); g.lineTo(cx + F.rim, cy + F.base); g.lineTo(cx - F.rim, cy + F.base); g.closePath(); g.fill();
    g.fillStyle = brassDark;
    g.beginPath(); g.arc(cx, cy, F.face + 2, Math.PI, 0); g.closePath(); g.fill();
    g.fillStyle = cream;
    g.beginPath(); g.arc(cx, cy, F.face, Math.PI, 0); g.closePath(); g.fill();
    // sunburst: a wedge a shade deeper on every other mark, one step wide and centred on it, from the hub to just
    // inside the ticks. They are counted out from the middle of the sweep (straight up) in steps of two marks, so the
    // pattern mirrors about straight up: with L ... 20 the wedges sit on the 2, 6, 10, 14 and 18, the 10's in the middle.
    g.fillStyle = creamDeep;
    const shade = [];
    for (let k = -Math.ceil(n / 4); k <= Math.ceil(n / 4); k++) {
      const c = n / 2 + 2 * k;
      if (c - 0.5 < 0 || c + 0.5 > n) continue;
      const a0 = ang(c - 0.5), a1 = ang(c + 0.5);
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, F.tick[0] - 6, arcA(a0), arcA(a1));
      g.closePath(); g.fill();
      shade.push([a0, a1]);
    }
    // the scale line along the outer edge of the ticks, and the ticks (one per mark, on the line to it)
    g.strokeStyle = ink; g.lineWidth = 1.2;
    g.beginPath(); g.arc(cx, cy, F.tick[1], arcA(ang(0)), arcA(ang(n))); g.stroke();
    g.lineWidth = 2.4; g.lineCap = 'butt';
    const ticks = labels.map((_, i) => {
      const a = ang(i), [x0, y0] = at(a, F.tick[0]), [x1, y1] = at(a, F.tick[1]);
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      const ox = Math.abs(Math.cos(a)) * 1.2, oy = Math.abs(Math.sin(a)) * 1.2;   // half the stroke, across the tick
      return [Math.min(x0, x1) - ox, Math.min(y0, y1) - oy, Math.max(x0, x1) + ox, Math.max(y0, y1) + oy];
    });
    // the marks: measured, centred on their line (ink box, not the font's em box), stepped down if crowded
    const layout = size => {
      g.font = `bold ${size}px "Times New Roman", Times, "Liberation Serif", serif`;
      return labels.map((t, i) => {
        const m = g.measureText(t), s = MARK_NARROW, a = ang(i), [px, py] = at(a, F.mark);
        const L = m.actualBoundingBoxLeft, R = m.actualBoundingBoxRight, A = m.actualBoundingBoxAscent, D = m.actualBoundingBoxDescent;
        const bw = (L + R) * s, bh = A + D, o = MARK_WEIGHT / 2;   // (the box includes the traced ink)
        return { t, a, s, x: px - bw / 2 + L * s, y: py + (A - D) / 2, box: [px - bw / 2 - o, py - bh / 2 - o, px + bw / 2 + o, py + bh / 2 + o] };
      });
    };
    const gap = (p, q) => Math.max(q[0] - p[2], p[0] - q[2], q[1] - p[3], p[1] - q[3]);
    const room = marks => {
      let least = Infinity;
      marks.forEach((m, i) => {
        if (i) least = Math.min(least, gap(marks[i - 1].box, m.box));
        for (const t of ticks) least = Math.min(least, gap(m.box, t));
        const [x0, y0, x1, y1] = m.box;
        const far = Math.hypot(Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx)), Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy)));
        least = Math.min(least, F.face - far, cy - y1);
      });
      return least;
    };
    let size = F.font, marks = layout(size);
    while (room(marks) < MARK_GAP && size > 14) marks = layout(size -= 0.5);
    g.fillStyle = ink; g.strokeStyle = ink; g.lineJoin = 'round'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    for (const m of marks) {
      g.save(); g.translate(m.x, m.y); g.scale(m.s, 1); g.lineWidth = MARK_WEIGHT; g.fillText(m.t, 0, 0); g.strokeText(m.t, 0, 0); g.restore();
    }
    // the base's top edge, then the brass hub the needle turns on
    g.fillStyle = brassDark; g.fillRect(cx - F.rim, cy, F.rim * 2, 1.2);
    g.fillStyle = brass; g.beginPath(); g.arc(cx, cy, F.hubR, 0, Math.PI * 2); g.fill();
    g.strokeStyle = brassDark; g.lineWidth = 1.2; g.beginPath(); g.arc(cx, cy, F.hubR - 0.6, 0, Math.PI * 2); g.stroke();
    drawn = { w, h, size, sweep: sweepDeg, hub: [cx, cy], face: F.face, baseTop: cy, tip: F.tip, tickRing: F.tick.slice(),
      shade, shadeR: F.tick[0] - 6,   // (the sunburst's wedges: [from, to] angles from straight up, and their radius)
      marks: marks.map(m => ({ label: m.t, angle: m.a, box: m.box.map(v => +v.toFixed(2)) })),
      ticks: ticks.map(b => b.map(v => +v.toFixed(2))) };
  }, { srgb: true });
  if (drawn) tex.userData.dial = drawn;
  return tex;
}

// Tall night window: deep blue glass with a cold glow low down, glazing bars and an arched head.
export function windowTexture() {
  return canvasTexture('window', 128, 384, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#0d1428'); grd.addColorStop(0.55, '#1b2a4a'); grd.addColorStop(1, '#31476e');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    // a few distant lit windows of the city
    const r = rng(21);
    for (let i = 0; i < 18; i++) { g.fillStyle = `rgba(255,${180 + r() * 50 | 0},120,${0.25 + r() * 0.35})`; g.fillRect(r() * w, h * 0.55 + r() * h * 0.4, 3, 4); }
    g.strokeStyle = '#1a120c'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
    for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(0, k * h / 6); g.lineTo(w, k * h / 6); g.stroke(); }
    g.strokeStyle = '#b08a45'; g.lineWidth = 2;
    g.strokeRect(3, 3, w - 6, h - 6);
  });
}

// Soft round glow (white; tinted per use). Used for light pools on the floor, wall washes and the
// halo round lamps and chandeliers — all additive, so they cost one cheap draw call together.
export function glowTexture() {
  return canvasTexture('glow', 128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.6, 'rgba(255,255,255,0.15)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, { srgb: false });
}

// A wash of light on a wall above and below a sconce: a vertical ellipse brightest near the lamp.
export function washTexture() {
  return canvasTexture('wash', 64, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w * 2 - 1, ny = (y + 0.5) / h * 2 - 1;
      // brighter up the wall (a fan upward), softer downward
      const fy = ny < 0 ? -ny : ny * 1.6;
      const spread = 0.35 + 0.65 * (ny < 0 ? -ny : 0.25);
      const d = Math.sqrt((nx / spread) ** 2 + fy ** 2);
      const v = Math.max(0, 1 - d) ** 1.6;
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = v * 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

// A shaft of light: soft along its length, brightest in the middle, fading at both ends.
export function shaftTexture() {
  return canvasTexture('shaft', 64, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w * 2 - 1, v = (y + 0.5) / h;
      const across = Math.max(0, 1 - Math.abs(u)) ** 1.1;
      const along = Math.sin(Math.PI * v) ** 0.8 * (0.55 + 0.45 * v);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = across * along * 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

// The spill of light from the open lift onto the floor: bright at the doors, fading outward.
export function spillTexture() {
  return canvasTexture('spill', 64, 128, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = y / (h - 1);                       // 0 at the doors, 1 far out
      const half = 0.38 + 0.62 * t;                // widening trapezoid
      const nx = Math.abs((x + 0.5) / w * 2 - 1) / half;
      const edge = Math.max(0, 1 - Math.max(0, nx - 0.7) / 0.3);
      const v = edge * Math.pow(1 - t, 1.5);
      const i = (y * w + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(1, v) * 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false });
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
