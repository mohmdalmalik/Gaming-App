// The fogged, unknown rooms (docs/GAME_RULES.md > Doors and exploring): beyond every closed door that
// can still be opened lies a soft, slowly drifting mist the size of a room — "an unknown room, tap to
// explore". Several doors can lead into the same empty cell; it still gets ONE fog room
// (fogCells in src/game/hotel.js). The fog beyond the doors of the active guest's own room is brighter,
// with a gently pulsing gold edge and a small "Explore · 1 AP" tag; fog elsewhere is dimmer. When a door
// opens, its fog room fades away as the real room rises in its place.
//
// Cheap on the iPad: ALL the fog is one InstancedMesh (one draw call) — a few stacked, see-through
// planes per cell sharing one small shader and one 128×128 noise texture made once at start-up. The tags
// are plain HTML in the shared tag layer (src/ui/screenTags.js: under the interface, inside the screen,
// hidden while they would cover any of the interface; a tap on a tag lands on the fog under it).
// Nothing here decides a rule: what is fogged and what can be opened comes from the hotel and the rules.
import * as THREE from 'three';
import { fogCells } from '../game/hotel.js';
import { rules } from '../data/rules.js';

const MAX_CELLS = 64;

// A tileable fractal value noise (grey, 0..255), made once.
function noiseTexture(size = 128) {
  let seed = 97531;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const acc = new Float32Array(size * size);
  const fade = t => t * t * (3 - 2 * t);
  let total = 0;
  for (const [cells, amp] of [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]]) {
    const g = Array.from({ length: cells * cells }, rnd);
    const at = (i, j) => g[((j + cells) % cells) * cells + ((i + cells) % cells)];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = x / size * cells, fy = y / size * cells;
        const i = Math.floor(fx), j = Math.floor(fy), u = fade(fx - i), v = fade(fy - j);
        const a = at(i, j) + (at(i + 1, j) - at(i, j)) * u;
        const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * u;
        acc[y * size + x] += (a + (b - a) * v) * amp;
      }
    }
    total += amp;
  }
  const data = new Uint8Array(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const n = Math.round(255 * acc[k] / total);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = n; data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const VERT = `
attribute vec4 aFog;      // x: shown (0..1, fades), y: explorable now (0..1), z: layer, w: seed
varying vec2 vUv;
varying vec2 vWorld;
varying vec4 vFog;
void main() {
  vUv = uv;
  vFog = aFog;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = `
uniform sampler2D uNoise;
uniform float uTime;
uniform float uDrift;
uniform vec3 uMist;
uniform vec3 uDeep;
uniform vec3 uEdge;
uniform float uDim;
uniform vec3 uLayerAlpha;
varying vec2 vUv;
varying vec2 vWorld;
varying vec4 vFog;
void main() {
  vec2 q = abs(vUv - 0.5) * 2.0;                 // 0 in the middle, 1 at the edge
  float d = max(q.x, q.y);
  float layer = vFog.z;
  float edgeFade = 1.0 - smoothstep(0.74, 1.0, max(d, length(max(q - 0.6, 0.0)) / 0.4 * 0.98));
  vec2 drift = vec2(uTime * uDrift, uTime * uDrift * 0.63) * (1.0 + layer * 0.7);
  float n1 = texture2D(uNoise, vWorld * 0.065 + drift + vFog.w).r;
  float n2 = texture2D(uNoise, vWorld * 0.15 - drift * 1.6 + vFog.w * 1.7).r;
  float wisp = smoothstep(0.28, 0.8, n1 * 0.62 + n2 * 0.38);
  float lit = mix(uDim, 1.0, vFog.y);
  vec3 col = mix(uDeep, uMist, wisp) * lit;
  float la = layer < 0.5 ? uLayerAlpha.x : layer < 1.5 ? uLayerAlpha.y : uLayerAlpha.z;
  float a = edgeFade * mix(0.5, 1.0, wisp) * la;
  if (layer < 0.5) {
    // the edge of a room you can explore now: a soft gold line just inside the fog's rim, breathing
    float rim = smoothstep(0.84, 0.885, d) * (1.0 - smoothstep(0.905, 0.95, d)) * vFog.y;
    float pulse = 0.72 + 0.28 * sin(uTime * 2.4);
    col = mix(col, uEdge, clamp(rim * pulse * 1.2, 0.0, 1.0));
    a = max(a, rim * pulse);
  }
  gl_FragColor = vec4(col, a * vFog.x);
  #include <colorspace_fragment>
}`;

export function createFog(scene, camera, cfg) {
  const F = cfg.fog;
  const LAYERS = F.layers.length;
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CELLS * LAYERS * 4), 4);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFog', attr);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: {
      uNoise: { value: noiseTexture() },
      uTime: { value: 0 },
      uDrift: { value: F.drift },
      uMist: { value: new THREE.Color(F.mist) },
      uDeep: { value: new THREE.Color(F.deep) },
      uEdge: { value: new THREE.Color(F.edge) },
      uDim: { value: F.dim },
      uLayerAlpha: { value: new THREE.Vector3(...[0, 1, 2].map(i => F.layers[i]?.alpha ?? 0)) },
    },
    transparent: true, depthWrite: false, toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_CELLS * LAYERS);
  mesh.name = 'fog';
  mesh.count = 0;
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  scene.add(mesh);

  // One entry per fogged cell, kept while it fades out after its door opened.
  const entries = new Map();   // key -> { key, center, shown, target, hl, hlTarget, seed, label }
  let version = -1, cells = new Map();
  let instant = true;          // a new match: its first fog rooms are simply there (no fade-in)
  const m4 = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  let list = [];               // this frame's fog rooms, far first
  let here = null;

  return {
    mesh,
    // Every frame, before the render. `player`: the active guest (their room's doors are the ones they
    // can open now).
    update(floor, player, { time = 0, dt = 0 } = {}) {
      if (floor.version !== version) { version = floor.version; cells = fogCells(floor); }
      here = player?.alive ? player.currentRoom : null;
      for (const c of cells.values()) {
        let e = entries.get(c.key);
        if (!e) {
          e = { key: c.key, center: c.center, shown: instant ? 1 : 0, target: 1, hl: 0, seed: (Math.abs(c.cell[0] * 7.13 + c.cell[1] * 3.71) % 1) };
          entries.set(c.key, e);
        }
        e.target = 1;
        e.doors = c.doors;
        e.hlTarget = here && c.doors.some(d => d.room === here) ? 1 : 0;
        if (instant) e.hl = e.hlTarget;
      }
      instant = false;
      const step = dt / Math.max(0.05, F.fade);
      for (const [k, e] of entries) {
        if (!cells.has(k)) { e.target = 0; e.hlTarget = 0; }
        e.shown += Math.sign(e.target - e.shown) * Math.min(Math.abs(e.target - e.shown), step);
        e.hl += Math.sign(e.hlTarget - e.hl) * Math.min(Math.abs(e.hlTarget - e.hl), dt / 0.3);
        if (e.target === 0 && e.shown <= 0) entries.delete(k);
      }
      // Far cells first, each from the floor up, so the see-through layers blend in order.
      camera.getWorldDirection(fwd);
      list = [...entries.values()].slice(0, MAX_CELLS);
      list.sort((a, b) => (b.center[0] * fwd.x + b.center[1] * fwd.z) - (a.center[0] * fwd.x + a.center[1] * fwd.z));
      let n = 0;
      const arr = attr.array;
      for (const e of list) {
        for (let l = 0; l < LAYERS; l++) {
          const L = F.layers[l];
          pos.set(e.center[0], L.y, e.center[1]);
          const s = F.size * (L.scale ?? 1);
          scl.set(s, 1, s);
          mesh.setMatrixAt(n, m4.compose(pos, quat, scl));
          arr[n * 4] = e.shown; arr[n * 4 + 1] = e.hl; arr[n * 4 + 2] = l; arr[n * 4 + 3] = e.seed;
          n++;
        }
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n) { mesh.instanceMatrix.needsUpdate = true; attr.needsUpdate = true; }
      mat.uniforms.uTime.value = time;
    },
    // After the render: the "Explore · 1 AP" tags over the fog rooms the active guest can explore now
    // (first in the tag layer, so nothing else covers them). `ap`: their action points.
    tags(tags, ap) {
      const cost = rules.actionCost.open;
      for (const e of list) {
        if (e.hlTarget < 1 || e.shown < 0.5) continue;
        // (a little in from the middle, toward the door it opens: nearer the guest, and on the screen
        // when the fog room's far side is not)
        const d = e.doors.find(x => x.room === here) || e.doors[0];
        const p = [e.center[0] + (d.center[0] - e.center[0]) * 0.4, 0.9, e.center[1] + (d.center[1] - e.center[1]) * 0.4];
        tags.put(`fog:${e.key}`, p, ap >= cost ? `Explore · ${cost} AP` : 'No actions left', ap >= cost ? 'fog-label' : 'fog-label dim');
      }
    },
    // A new match: every fog room goes at once (the new hotel's fog fades in).
    reset() { entries.clear(); version = -1; instant = true; mesh.count = 0; list = []; },
    // Tests: the fog rooms on the board now.
    cells() {
      return [...entries.values()].filter(e => e.target > 0).map(e => ({ key: e.key, center: [...e.center], shown: +e.shown.toFixed(2), explorable: e.hlTarget > 0, doors: e.doors.map(d => d.id) }));
    },
  };
}
