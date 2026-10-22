// Lamp halos: a soft, warm glow round every real lamp, sconce and lantern of the rooms on the board, so the
// hotel reads as lit at night the way the menu's lobby does (the graphics review of 21 Oct 2026, recipe "D3").
//
// Where the lights are comes from the room and lobby pipelines (src/data/roomLamps.js, one record per real
// light: never guessed from the meshes). bakedRoom.js ties each record to the model object it is part of
// (`view.lamps`: that object and the light's place in its own space), and every frame each halo is re-placed
// from that object: a sconce's halo folds down with its wall in the cutaway and rises with a newly revealed
// room, fading as the wall or the room is lowered (so nothing pops), and it follows the bulb in a flickering
// room (the light level mood.js puts in the room's light map, which holds steady under Reduce Motion). A room
// not on the board (fogged) has no view, so no halo.
//
// Cheap on the iPad: ALL the halos are one draw call, one camera-facing square per light (instanced), drawn
// added onto the picture (no full-screen pass), its shader built behind the black screen at the start of a
// game (warmObjects, main.js warmUp). Each halo is pushed toward the camera along the line of sight, so the shade
// and its wall do not cut it and it stays centred on the lamp: 0.3 m for a lamp, 0.6 m for a light on a wall (at
// 0.3 m a sconce's wide glow crossed its own slanting wall and was cut there along a hard straight line). It never
// covers more than about a sixth of the screen's height (0.35 in clip units, where the screen is 2 tall: zoomed right
// in, it would flare), and is written out in sRGB like everything else. It is drawn after the active guest (renderOrder
// 12.5: the guest is 12, src/render/characterView.js drawFront) and before the signs (13), so every guest who stands
// right behind a lamp gets its glow over them, the one whose turn it is too. Two fades keep it from showing where its
// light cannot be seen: a light on a wall fades out as the camera comes round to the wall's line and passes to its outer
// side (during a quarter turn the wall is still standing then, and the glow would lie on its outer face or round its
// edge), and a lamp faded out by the see-through window (src/render/xray.js: in front of the active guest, or of the
// search spot) takes its halo with it.
import * as THREE from 'three';
import { xrayKeep } from './xray.js';

// The look (the review's D3 recipe). `gain`: the halo's strength for a light of its kind's usual watts; a
// stronger or weaker bulb is a little bigger and brighter or smaller and dimmer (WATTS: the usual watts, and
// the bounds of that change). `size`: metres across, from the glowing part's size (× per metre, least, most).
// `push`: metres toward the camera (a lamp; a sconce, lantern or strip light, on a wall). `maxNdc`: the most it
// covers on screen, in clip units (the screen is 2 tall: 0.35 is about a sixth of its height).
export const HALO = {
  gain: 0.36,
  dark: 0.7,                      // in a dark room (`dark` in src/data/hotel.js)
  push: { lamp: 0.3, other: 0.6 }, maxNdc: 0.35, core: 0.6, fall: 4.2,
  warm: '#ffb860',                // lamps, sconces, lanterns
  cool: '#b4ccf5',                // a cool white light (the service corridor's fluorescent strip)
  size: { lamp: [3.6, 1.0, 1.7], other: [4.2, 0.8, 1.3] },
  watts: { lamp: 55, sconce: 24, lantern: 24, strip: 40 },
  wattsRange: [0.8, 1.25],
  fadeFrom: 0.3, fadeTo: 0.9,     // a halo fades in as its wall or room stands from 30% to 90% of its height
  outside: [-0.08, 0.02],         // a light on a wall: its halo fades out as the camera comes round to the wall's line and
                                  // passes it (the wall's outward direction · the unit line from the light to the camera; at rest
                                  // it is about -0.28 or lower in the usual views, so no fade; a wall light at the very left or
                                  // right edge of the screen can come near -0.05 and be dimmed a little there)
};

const VERT = `
attribute vec4 aHalo;           // xyz: centre (world), w: size across (m); 0 = not shown
attribute vec3 aCol;            // colour × strength
attribute float aPush;          // metres toward the camera
uniform float uMaxNdc;
varying vec2 vQ;
varying vec3 vCol;
void main() {
  vQ = position.xy * 2.0;
  vCol = aCol;
  vec4 c = viewMatrix * vec4(aHalo.xyz, 1.0);
  c.xyz -= normalize(c.xyz) * aPush;                                   // toward the camera, along the line of sight
  float sz = min(aHalo.w, uMaxNdc * max(-c.z, 0.01) / projectionMatrix[1][1]);   // never more than uMaxNdc tall on screen (clip units)
  c.xy += position.xy * sz;
  gl_Position = projectionMatrix * c;
  if (aHalo.w <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);           // not shown: off screen
}`;
const FRAG = `
uniform float uCore;
uniform float uFall;
varying vec2 vQ;
varying vec3 vCol;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float soft = exp(-r2 * uFall) * (1.0 - r2);
  float core = exp(-r2 * 40.0) * uCore;
  gl_FragColor = vec4(vCol * (soft + core), 1.0);
  #include <colorspace_fragment>
}`;

const clamp = THREE.MathUtils.clamp;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const luma = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

// The size (m), strength and push toward the camera (m) of one light's halo, and its colour (linear), from its
// pipeline record.
export function haloLook(rec) {
  const lamp = rec.kind === 'lamp';
  const [per, least, most] = lamp ? HALO.size.lamp : HALO.size.other;
  const w = clamp(rec.watts / (HALO.watts[rec.kind] || HALO.watts.sconce), ...HALO.wattsRange);
  const cool = rec.color[2] > rec.color[0];
  return { size: clamp(rec.ext * per, least, most) * Math.sqrt(w), gain: HALO.gain * w, push: lamp ? HALO.push.lamp : HALO.push.other, cool };
}

function geometry(capacity) {
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.InstancedBufferGeometry();
  g.index = plane.index;
  g.setAttribute('position', plane.attributes.position);
  g.setAttribute('aHalo', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aCol', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aPush', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  g.instanceCount = 0;
  return g;
}

const _p = new THREE.Vector3(), _sy = new THREE.Vector3(), _eye = new THREE.Vector3();
const shownUp = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// The objects to bring up to date each frame for one room's halos: the parts its lamps are on and the parts between
// them and the room's `lampRoot`, each once, parents first (null: a part not under lampRoot, so the whole of it).
function lampChain(view) {
  const chain = [], seen = new Set([view.lampRoot]);
  for (const l of view.lamps) {
    const up = [];
    let o = l.node;
    for (; o && !seen.has(o); o = o.parent) up.push(o);
    if (!o) return null;
    for (let i = up.length - 1; i >= 0; i--) { seen.add(up[i]); chain.push(up[i]); }
  }
  return chain;
}

export function createLampHalos(scene) {
  const material = new THREE.ShaderMaterial({
    name: 'lamp-halos',
    vertexShader: VERT, fragmentShader: FRAG,
    uniforms: { uMaxNdc: { value: HALO.maxNdc }, uCore: { value: HALO.core }, uFall: { value: HALO.fall } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const warm = new THREE.Color(HALO.warm), cool = new THREE.Color(HALO.cool);
  cool.multiplyScalar(luma(warm) / luma(cool));          // (as strong to the eye as the warm one)
  const mesh = new THREE.Mesh(geometry(16), material);
  mesh.name = 'lamp-halos';
  mesh.frustumCulled = false;
  mesh.renderOrder = 12.5;        // (after the active guest's 12, before the signs' 13: the header)
  mesh.visible = false;
  scene.add(mesh);

  let items = [];                 // { view, node, local, out, size, gain, push, colour }
  const included = new Set();     // the room views whose lamps are in `items`
  const chains = new Map();       // room view → lampChain(view)
  let shown = 0;

  function rebuild(roomViews) {
    items = [];
    included.clear();
    chains.clear();
    for (const view of roomViews.values()) {
      if (!view.lamps) continue;
      included.add(view);
      chains.set(view, lampChain(view));
      for (const l of view.lamps) {
        const look = haloLook(l.rec);
        items.push({ view, node: l.node, local: l.local, out: l.out || null, size: look.size, gain: look.gain * (view.room.dark ? HALO.dark : 1), push: look.push, colour: look.cool ? cool : warm });
      }
    }
    const have = mesh.geometry.attributes.aHalo.count;
    if (items.length > have) {
      mesh.geometry.dispose();
      mesh.geometry = geometry(Math.max(16, 2 ** Math.ceil(Math.log2(items.length))));
    }
    const push = mesh.geometry.attributes.aPush;
    items.forEach((it, i) => { push.array[i] = it.push; });
    push.needsUpdate = true;
    mesh.geometry.instanceCount = items.length;
  }

  return {
    mesh,
    // Every frame, before the render (after the camera, the rooms, the cutaway and the mood have moved this frame's
    // walls and lights). `roomViews`: the rooms on the board (main.js).
    update(roomViews, camera) {
      let n = 0, stale = false;
      for (const view of roomViews.values()) if (view.lamps) { n++; if (!included.has(view)) stale = true; }
      if (stale || n !== included.size) rebuild(roomViews);
      const h = mesh.geometry.attributes.aHalo, col = mesh.geometry.attributes.aCol;
      const H = h.array, C = col.array;
      shown = 0;
      _eye.setFromMatrixPosition(camera.matrixWorld);
      let last = null, roomOn = false, bulb = 1;
      for (let i = 0; i < items.length; i++) {
        const it = items[i], view = it.view;
        if (view !== last) {
          last = view;
          roomOn = view.group.visible && view.revealed;
          // (this frame's wall heights and room rise: the lamps' parts and those above them only, not the whole room)
          if (roomOn) {
            const chain = chains.get(view);
            view.lampRoot?.updateWorldMatrix(true, !chain);
            if (chain) for (const o of chain) o.updateWorldMatrix(false, false, true);
          }
          // a flickering room's halos follow its bulb: the level mood.js put in its light map (bakedScale)
          bulb = 1;
          const b = view.room.mood?.flicker && view.bakedMats?.[0];
          if (b) bulb = clamp((b.mat.lightMapIntensity / b.base - 0.45) / 0.55, 0, 1);
        }
        let k = 0;
        if (roomOn && shownUp(it.node)) {
          _sy.setFromMatrixColumn(it.node.matrixWorld, 1);
          k = smooth(HALO.fadeFrom, HALO.fadeTo, _sy.length()) * bulb;
        }
        if (k > 0.001) {
          _p.copy(it.local).applyMatrix4(it.node.matrixWorld);
          if (it.out) {                 // (on a wall: not once the camera comes round to the wall's line)
            _sy.subVectors(_eye, _p).normalize();
            k *= 1 - smooth(HALO.outside[0], HALO.outside[1], it.out[0] * _sy.x + it.out[1] * _sy.z);
          }
          k *= xrayKeep(_p);            // (as much as the see-through window leaves of its lamp)
        }
        if (k <= 0.001) { H[i * 4 + 3] = 0; continue; }
        H[i * 4] = _p.x; H[i * 4 + 1] = _p.y; H[i * 4 + 2] = _p.z; H[i * 4 + 3] = it.size;
        const g = it.gain * k;
        C[i * 3] = it.colour.r * g; C[i * 3 + 1] = it.colour.g * g; C[i * 3 + 2] = it.colour.b * g;
        shown++;
      }
      mesh.visible = shown > 0;
      if (items.length) { h.needsUpdate = true; col.needsUpdate = true; }
    },
    // One halo with the real material, for the warm-up at the start of a game (main.js warmUp): drawn once out
    // of sight so its shader is built before the first room is revealed.
    warmObjects() {
      const g = geometry(1);
      g.instanceCount = 1;
      g.attributes.aHalo.setXYZW(0, 0, 0, 0, 1);
      g.attributes.aCol.setXYZ(0, 0, 0, 0);
      g.attributes.aPush.setX(0, HALO.push.lamp);
      const m = new THREE.Mesh(g, material);
      m.frustumCulled = false;
      return [m];
    },
    // Tests: how many halos there are and how many are drawn now, and where (world).
    info() {
      const h = mesh.geometry.attributes.aHalo;
      return {
        items: items.length, shown, visible: mesh.visible,
        halos: items.map((it, i) => ({ room: it.view.room.id, size: +h.getW(i).toFixed(2), at: [h.getX(i), h.getY(i), h.getZ(i)].map(v => +v.toFixed(2)) })),
      };
    },
  };
}
