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

export function easeOutCubic(t) {
  t = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - t, 3);
}
