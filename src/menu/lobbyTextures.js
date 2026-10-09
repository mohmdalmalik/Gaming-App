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

// Floor-indicator dial: a cream half-disc with floor numbers, inside a brass rim (needle is a mesh).
export function dialTexture() {
  return canvasTexture('dial', 256, 160, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h - 18, R = 112;
    g.fillStyle = '#b08a45';
    g.beginPath(); g.arc(cx, cy, R + 12, Math.PI, 0); g.lineTo(cx + R + 12, cy + 14); g.lineTo(cx - R - 12, cy + 14); g.closePath(); g.fill();
    g.fillStyle = '#efe2c2';
    g.beginPath(); g.arc(cx, cy, R, Math.PI, 0); g.closePath(); g.fill();
    g.fillStyle = '#2a1a10';
    g.font = 'bold 20px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const labels = ['L', '1', '2', '3', '4', '5', '6'];
    labels.forEach((t, i) => {
      const a = Math.PI + (i / (labels.length - 1)) * Math.PI;
      g.fillText(t, cx + Math.cos(a) * (R - 22), cy + Math.sin(a) * (R - 22));
      g.fillRect(cx + Math.cos(a) * (R - 6) - 1, cy + Math.sin(a) * (R - 6) - 1, 3, 3);
    });
    g.fillStyle = '#b08a45'; g.beginPath(); g.arc(cx, cy, 9, 0, Math.PI * 2); g.fill();
  }, { srgb: true });
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
