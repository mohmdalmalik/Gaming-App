// DEV assembler for the parts review tools (NOT the game's): a copy of the parts proof's assemble.js adapted to the
// parts format (contract sections 3 and 8). It exists so the review sheet, the red-eye test and the mirror test can
// run before the game's own src/render/avatarParts.js lands; review.html switches to the game's code when it can.
//   const lib = createLibrary(rootUrl)        rootUrl: the parts folder (manifest.json + <body>/<key>.glb)
//   await lib.manifest()                      the manifest (contract 3.4)
//   resolveKeys(manifest, body, worn)         worn: { slot: id } (+ extras: [...]) -> file keys (variants resolved)
//   const g = await assembleDev(lib, body, keys, { rim, glasses, paint })
//     -> { root, clips, merged, eyes, stats, dispose() }: ONE merged skinned mesh (every material's colour multiplied
//        into the vertex colour, shadow patches applied) + ONE eye mesh (material 'Eye', for the possessed look)
// `glasses: true` keeps a face's built-in 'Glasses' primitive (Henry's own frames), otherwise it is left out.
// `paint`: { materialName: '#rrggbb' } repaints materials (default: each piece's own colours, i.e. the Look's).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function guestLight(m, rim) {          // the game's rim + fill (src/render/avatar.js guestLight), same shader
  if (!rim) return m;
  const color = new THREE.Color(rim.color), k = new THREE.Vector2(rim.rim, rim.fill);
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = { value: color }; shader.uniforms.uRim = { value: k };
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform vec2 uRim;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
      outgoingLight += uRimColor * rimK * uRim.x * (0.35 + 0.65 * diffuseColor.rgb) + diffuseColor.rgb * uRim.y;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'guestLight1';
  return m;
}

export function createLibrary(root) {
  const loader = new GLTFLoader(), cache = new Map(); let man = null;
  return {
    root,
    async manifest() { if (!man) man = (await fetch(`${root}/manifest.json`, { cache: 'no-store' })).json(); return man; },
    load(file) {
      if (!cache.has(file)) cache.set(file, (async () => {
        const res = await fetch(`${root}/${file}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${file}: ${res.status}`);
        const buf = await res.arrayBuffer();
        const gltf = await loader.parseAsync(buf, '');
        const meshes = []; gltf.scene.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
        return { file, gltf, meshes, extras: gltf.scene.userData || {}, bytes: buf.byteLength };
      })());
      return cache.get(file);
    },
  };
}

// contract 3.2: the first variant (sorted) whose fit piece is worn, else the plain file
export function resolveKeys(manifest, body, worn) {
  const keys = Object.keys(manifest.parts).filter(k => k.startsWith(body + '/')).map(k => k.slice(body.length + 1)).sort();
  const wornPlain = new Set(Object.entries(worn).filter(([s, v]) => s !== 'extras' && v && v !== 'none').map(([s, v]) => `${s}_${v}`));
  for (const e of worn.extras || []) wornPlain.add(`extra_${e}`);
  const out = [];
  for (const plain of wornPlain) {
    const v = keys.find(k => k.startsWith(plain + '~') && wornPlain.has(k.split('~')[1]));
    if (v) out.push(v); else if (keys.includes(plain)) out.push(plain);
  }
  const order = ['face', 'hairStyle', 'facial', 'makeup', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'extra'];
  return out.sort((a, b) => order.indexOf(a.split('_')[0]) - order.indexOf(b.split('_')[0]));
}

function ownColour(g) {
  const o = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) o.setAttribute(k, k === 'color' ? a.clone() : a);
  o.setIndex(g.index); return o;
}

export async function assembleDev(lib, body, keys, { rim = null, glasses = false, paint = null, skipPatches = false, omit = [] } = {}) {
  const man = await lib.manifest();
  const files = [`${body}/body.glb`, ...keys.map(k => `${body}/${k}.glb`)];
  const loaded = await Promise.all(files.map(f => lib.load(f)));
  const bodyP = loaded[0];
  const root = SkeletonUtils.clone(bodyP.gltf.scene);
  const bodyMeshes = []; root.traverse(o => { if (o.isSkinnedMesh) bodyMeshes.push(o); });
  const skel = bodyMeshes[0].skeleton, bindMatrix = bodyMeshes[0].bindMatrix.clone(), holder = bodyMeshes[0].parent;
  const names = skel.bones.map(b => b.name);
  const pieces = [];      // { key, mat, geo }
  for (const m of bodyMeshes) { pieces.push({ key: 'body', mat: m.material, geo: m.geometry }); holder.remove(m); }
  keys.forEach((key, i) => {
    for (const m of loaded[i + 1].meshes) {
      if (m.skeleton.bones.map(b => b.name).join() !== names.join()) throw new Error(`${key}: joint order differs from the body`);
      if (m.material.name === 'Glasses' && !glasses) continue;
      if ((omit || []).includes(m.material.name)) continue;   // (tests: e.g. a face without its brows)
      pieces.push({ key, mat: m.material, geo: m.geometry });
    }
  });
  // shadow patches from every worn piece onto every worn target (skipped, with a warning, if the target changed)
  const worn = new Set(['body', ...keys]); const warnings = []; let patched = 0;
  const hashOf = k => (k === 'body' ? man.bodies[body]?.hash : man.parts[`${body}/${k}`]?.hash);
  if (!skipPatches) keys.forEach((key, i) => {
    for (const [target, patch] of Object.entries(loaded[i + 1].extras.aoPatches || {})) {
      if (!worn.has(target)) continue;
      if (patch.against !== hashOf(target)) { warnings.push(`patch ${key} -> ${target} is stale`); continue; }
      for (const [mat, p] of Object.entries(patch.mats || {})) {
        const pc = pieces.find(q => q.key === target && q.mat.name === mat);
        if (!pc) continue;
        if (!pc.own) { pc.geo = ownColour(pc.geo); pc.own = true; }
        const c = pc.geo.attributes.color, arr = c.array, n = c.itemSize;
        for (let k = 0; k < p.idx.length; k++) for (let ch = 0; ch < 3; ch++) arr[p.idx[k] * n + ch] = Math.round(arr[p.idx[k] * n + ch] * p.mul[k]);
        c.needsUpdate = true; patched += p.idx.length;
      }
    }
  });
  const col = name => (paint && paint[name] ? new THREE.Color(paint[name]) : null);
  const solo = new Set(['Eye', 'Shine']);
  const geos = pieces.filter(q => !solo.has(q.mat.name)).map(q => {
    const g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) g.setAttribute(k, q.geo.attributes[k]);
    const src = q.geo.attributes.color, n = q.geo.attributes.position.count, out = new Uint16Array(n * 4);
    const c = col(q.mat.name) || q.mat.color;
    for (let i = 0; i < n; i++) {
      out[i * 4] = Math.min(65535, Math.round((src ? src.getComponent(i, 0) : 1) * c.r * 65535));
      out[i * 4 + 1] = Math.min(65535, Math.round((src ? src.getComponent(i, 1) : 1) * c.g * 65535));
      out[i * 4 + 2] = Math.min(65535, Math.round((src ? src.getComponent(i, 2) : 1) * c.b * 65535));
      out[i * 4 + 3] = 65535;
    }
    g.setAttribute('color', new THREE.BufferAttribute(out, 4, true)); g.setIndex(q.geo.index);
    return g;
  });
  const owned = [];
  const add = (geo, mat, name) => {
    const sm = new THREE.SkinnedMesh(geo, mat); sm.name = name; sm.frustumCulled = false;
    holder.add(sm); sm.bind(skel, bindMatrix); owned.push(sm); return sm;
  };
  const gm = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }); gm.name = 'Guest';
  const merged = add(mergeGeometries(geos, false), guestLight(gm, rim), 'guest');
  let eyes = null;
  const eyeP = pieces.filter(q => solo.has(q.mat.name));
  for (const q of eyeP) {
    const m = new THREE.MeshLambertMaterial({ color: (col(q.mat.name) || q.mat.color).clone(), vertexColors: !!q.mat.vertexColors, side: q.mat.side });
    m.name = q.mat.name; const sm = add(q.geo, guestLight(m, rim), q.mat.name);
    if (q.mat.name === 'Eye') eyes = sm;
  }
  let tris = 0; for (const sm of owned) tris += sm.geometry.index.count / 3;
  return {
    root, clips: bodyP.gltf.animations, merged, eyes, skeleton: skel, warnings,
    stats: { drawCalls: owned.length, tris, patched, bytes: loaded.reduce((s, p) => s + p.bytes, 0), files },
    dispose() { root.parent?.remove(root); for (const sm of owned) { sm.material.dispose(); if (sm === merged) sm.geometry.dispose(); } },
  };
}

// today's shipped guest (assets/characters/<look>.glb) drawn as the game draws it today: one Lambert part per
// material with the guests' rim + fill, the model's own colours, Henry's frames shown only when asked
export async function loadShipped(url, { rim = null, glasses = false } = {}) {
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = gltf.scene; let tris = 0, calls = 0;
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.frustumCulled = false;
    const s = o.material, m = new THREE.MeshLambertMaterial({ color: s.color.clone(), vertexColors: !!s.vertexColors, side: s.side }); m.name = s.name;
    o.material = guestLight(m, rim);
    if (s.name === 'Glasses' && !glasses) o.visible = false; else { tris += o.geometry.index.count / 3; calls++; }
  });
  return { root, clips: gltf.animations, stats: { tris, drawCalls: calls } };
}
