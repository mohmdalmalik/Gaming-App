// Shared greybox geometry and materials. Keeping these in one place means the later swap
// to real models and materials happens here, not in the game logic.
import * as THREE from 'three';

// A 1x1x1 box whose origin is at the bottom centre, so scale.y is simply "height".
export const unitBox = new THREE.BoxGeometry(1, 1, 1);
unitBox.translate(0, 0.5, 0);

// A 1x1 plane lying flat on the ground, facing up.
export const unitPlane = new THREE.PlaneGeometry(1, 1);
unitPlane.rotateX(-Math.PI / 2);

const cache = new Map();

// Cheap lit material (no specular, no textures). One instance per colour so draw calls
// can share it.
export function lambert(color, emissive) {
  const key = `${color}|${emissive || ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
    if (emissive) m.emissive = new THREE.Color(emissive);
    cache.set(key, m);
  }
  return m;
}

// A palette grey pulled part-way toward a mood colour (one material per room part).
export function tinted(base, toward, amount) {
  const key = `${base}~${toward}~${amount}`;
  let m = cache.get(key);
  if (!m) {
    const c = new THREE.Color(base).lerp(new THREE.Color(toward), amount);
    m = new THREE.MeshLambertMaterial({ color: c });
    cache.set(key, m);
  }
  return m;
}

// A soft round contact shadow: one shared radial-gradient texture + material, dropped under
// characters and furniture to ground them on the floor. Cheap (no shadow maps).
let _shadowMat = null;
export function shadowMaterial() {
  if (_shadowMat) return _shadowMat;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _shadowMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
  return _shadowMat;
}

// A contact-shadow mesh sized to a footprint (flat on the floor, just above y=0).
export function makeShadow(width, depth = width) {
  const m = new THREE.Mesh(unitPlane, shadowMaterial());
  m.scale.set(width, 1, depth);
  m.position.y = 0.012;
  return m;
}

export function easeOutCubic(t) {
  t = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - t, 3);
}
