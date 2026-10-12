// The interface portraits of an avatar (the strip, the player panel, the meeting, the trades, the soul
// cards), drawn at run time with the game's OWN renderer (never a second WebGL context) and framed exactly
// like the shipped pictures in assets/portraits/ (tools/char-pipeline/portrait.mjs + portrait_post.py):
//   the frame: 1200 x 1600, fov 24, camera (0.05, minY + 0.86 h, 2.15) -> (0, minY + 0.80 h, 0), the
//   model turned 14 degrees, Idle at 0.4 s, warm light; the crop: a 3:4 window centred on the eyes,
//   3.5 eye gaps wide, eyes 37 % down (men) / 46 % down with the whole hairdo in (women). The crop is the
//   camera's view offset, so the render is exactly the crop, at the output size.
// The pixels: an off-screen half-float render target (4x MSAA, transparent) -> a small tone-map pass
// (the game's NeutralToneMapping x exposure, then sRGB) into an 8-bit target -> read back without
// stalling (readRenderTargetPixelsAsync) -> over the plate (flat navy, or the possessed crimson gradient)
// -> a JPEG (about 26 kB) -> an object URL, kept by avatarKey + look. The canvas the player sees is never
// touched, so the menu's 'Still' background and the game's frames are unaffected.
//
//   const portraits = createAvatarPortraits(renderer);
//   portraits.peek(avatar, { possessed })  -> the URL if it is drawn, else null
//   portraits.url(avatar, { possessed })   -> Promise<URL | null> (drawn soon: one portrait per frame)
//   portraits.prepare([avatar | { avatar, possessed }, ...])  -> drawn ahead, after anything asked for
//   portraits.prewarm(avatar)              -> builds the shaders (the menu), so the first draw is quick
//   portraits.draw(avatar, { possessed, original, w, h }) -> Promise<canvas> (tests)
// Nothing here knows any rule or role: the caller says which look it wants.
import * as THREE from 'three';
import { createAvatarModel, loadBase } from './avatar.js';
import { avatarKey } from '../data/wardrobe.js';
import { POSSESSED_COLORS } from './possessedLook.js';

const VERSION = 1;                      // (bump when the catalogue's colours or the framing change)
const NORMAL_BG = '#171b27';
const FRAME_W = 1200, FRAME_H = 1600;
const KEEP = 80;                        // portraits kept (about 2 MB); the oldest are let go
const nextFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });

export function createAvatarPortraits(renderer, { w = 384, h = 512 } = {}) {
  const scene = new THREE.Scene();
  scene.name = 'avatar-portraits';
  scene.add(new THREE.HemisphereLight(new THREE.Color('#ffffff').lerp(new THREE.Color('#ffd9a8'), 0.5), new THREE.Color('#3a3438'), 0.6));
  const key = new THREE.PointLight(new THREE.Color('#ffd9a8'), 22, 9, 2); key.position.set(1.2, 2.6, 1.6); scene.add(key);
  const back = new THREE.PointLight(new THREE.Color('#ffd9a8'), 10, 9, 2); back.position.set(-2.0, 2.4, -1.0); scene.add(back);
  const cam = new THREE.PerspectiveCamera(24, FRAME_W / FRAME_H, 0.1, 100);
  const models = new Map();             // look id -> { model, mixer, frame }: one model per look, repainted
  const cache = new Map();              // key -> { url, promise, failed }
  const urgent = [], later = [];        // jobs: asked for (shown now) first, then drawn ahead
  const timings = [];
  let targets = null, running = false, disposed = false;

  const keyOf = (av, possessed) => `${avatarKey(av)}:${possessed ? 'p' : 'n'}:${VERSION}`;

  // ---- render targets and the tone-map pass ----
  function makeTargets(W, H) {
    if (targets && targets.w === W && targets.h === H) return targets;
    disposeTargets();
    const ext = renderer.extensions;
    const floatOk = !!(ext?.has?.('EXT_color_buffer_float') || ext?.has?.('EXT_color_buffer_half_float'));
    const samples = Math.min(4, renderer.capabilities?.maxSamples ?? 4);
    const hdr = new THREE.WebGLRenderTarget(W, H, { type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType, samples });
    const ldr = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType });
    const material = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: hdr.texture }, uExposure: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D tMap; uniform float uExposure; varying vec2 vUv;
        vec3 neutral(vec3 color) {            // three.js NeutralToneMapping (Khronos PBR Neutral)
          const float StartCompression = 0.8 - 0.04; const float Desaturation = 0.15;
          color *= uExposure;
          float x = min(color.r, min(color.g, color.b));
          float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
          color -= offset;
          float peak = max(color.r, max(color.g, color.b));
          if (peak < StartCompression) return color;
          float d = 1. - StartCompression;
          float newPeak = 1. - d * d / (peak + d - StartCompression);
          color *= newPeak / peak;
          float g = 1. - 1. / (Desaturation * (peak - newPeak) + 1.);
          return mix(color, vec3(newPeak), g);
        }
        vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
        void main(){ vec4 c = texture2D(tMap, vUv); vec3 col = c.a > 0.0 ? c.rgb / c.a : c.rgb;
          gl_FragColor = vec4(srgb(clamp(neutral(col), 0.0, 1.0)), c.a); }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    quad.frustumCulled = false;
    const qs = new THREE.Scene(); qs.add(quad);
    targets = { w: W, h: H, hdr, ldr, material, quad, qs, qcam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), px: new Uint8Array(W * H * 4) };
    return targets;
  }
  function disposeTargets() {
    if (!targets) return;
    targets.hdr.dispose(); targets.ldr.dispose(); targets.material.dispose(); targets.quad.geometry.dispose();
    targets = null;
  }

  // ---- one model per look, posed and framed once ----
  async function modelFor(av) {
    const base = await loadBase(av.base);
    let m = models.get(base.id);
    if (!m) {
      const model = createAvatarModel(base, av, { rim: false });
      model.root.rotation.y = THREE.MathUtils.degToRad(14);
      scene.add(model.root);
      model.root.visible = false;
      const mixer = new THREE.AnimationMixer(model.root);
      if (base.clips.idle) mixer.clipAction(base.clips.idle).play();
      m = { base, model, mixer, frame: null };
      models.set(base.id, m);
    }
    return m;
  }

  // The frame and crop for a look (the pipeline's preview + portrait.mjs + portrait_post.py), measured once.
  function frameFor(m) {
    if (m.frame) return m.frame;
    const { base, model } = m;
    model.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.root);
    const ht = Math.max(0.5, box.max.y - box.min.y);
    const pos = new THREE.Vector3(0.05, box.min.y + ht * 0.86, 2.15), look = new THREE.Vector3(0, box.min.y + ht * 0.80, 0);
    m.mixer.setTime(0.4);
    model.root.updateMatrixWorld(true);
    cam.clearViewOffset();
    cam.aspect = FRAME_W / FRAME_H;
    cam.position.copy(pos); cam.lookAt(look); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    // the eyes (portrait.mjs): the men's eyeCentre has x = 0, so the tool's 0.072; the women's the eye's x
    const EC = base.eyeCentre;
    const EX = EC && Math.abs(EC[0]) > 0.02 ? Math.abs(EC[0]) : 0.072, EY = EC ? EC[1] : 1.373, EZ = EC ? EC[2] : 0.237;
    const bone = model.headBone, inv = base.headInverse;
    const eyes = [[-EX, EY, EZ], [EX, EY, EZ]].map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv).applyMatrix4(bone.matrixWorld).project(cam);
      // (portrait.mjs rounds css px to 0.1 then doubles them)
      return [Math.round((p.x + 1) / 2 * 600 * 10) / 10 * 2, Math.round((1 - p.y) / 2 * 800 * 10) / 10 * 2];
    });
    const ex = (eyes[0][0] + eyes[1][0]) / 2, ey = (eyes[0][1] + eyes[1][1]) / 2, gap = Math.abs(eyes[1][0] - eyes[0][0]);
    let cw = Math.min(FRAME_W, Math.floor(gap * 3.5)), ch = Math.min(FRAME_H, Math.floor(cw * 4 / 3));
    let eyeFrac = 0.37;
    const hair = model.parts.Hair?.mesh;
    if (base.def.body === 'f' && hair) {
      // the whole hairdo in: the highest projected hair point within 1.6 eye gaps of the eyes
      let top = ey;
      const v = new THREE.Vector3();
      hair.skeleton.update();
      const n = hair.geometry.attributes.position.count;
      for (let i = 0; i < n; i++) {
        hair.getVertexPosition(i, v); v.applyMatrix4(hair.matrixWorld).project(cam);
        const px = (v.x + 1) / 2 * FRAME_W, py = (1 - v.y) / 2 * FRAME_H;
        if (Math.abs(px - ex) < gap * 1.6 && py < top) top = py;
      }
      eyeFrac = 0.46;
      const need = (ey - top) / (eyeFrac - 0.03);
      if (need > ch) { ch = Math.min(FRAME_H, Math.floor(need)); cw = Math.min(FRAME_W, Math.floor(ch * 3 / 4)); }
    }
    let x0 = Math.floor(ex - cw / 2), y0 = Math.floor(ey - ch * eyeFrac);
    x0 = Math.max(0, Math.min(FRAME_W - cw, x0)); y0 = Math.max(0, Math.min(FRAME_H - ch, y0));
    // (tests) where the eye ovals' middles land in the frame (measured from the Eye mesh)
    const eyePx = base.eyes ? [base.eyes.left.centre, base.eyes.right.centre].map(c => {
      const p = c.clone().applyMatrix4(base.bindMatrix).applyMatrix4(inv).applyMatrix4(bone.matrixWorld).project(cam);
      return [(p.x + 1) / 2 * FRAME_W, (1 - p.y) / 2 * FRAME_H];
    }) : [];
    m.frame = { pos, look, crop: { x0, y0, cw, ch }, eyePx };
    return m.frame;
  }

  // ---- the plates (portrait_post.py): flat navy, or the possessed crimson gradient with a vignette ----
  // (as pixels, worked out once per size: the portrait is laid over them in plain JS, so no canvas is
  // ever read back from the graphics chip)
  const plates = new Map();
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  function plate(W, H, possessed) {
    const k = `${W}x${H}:${possessed}`;
    if (plates.has(k)) return plates.get(k);
    const d = new Uint8ClampedArray(W * H * 4);
    const flat = hex(NORMAL_BG), top = hex(POSSESSED_COLORS.plateTop), bottom = hex(POSSESSED_COLORS.plateBottom);
    for (let y = 0; y < H; y++) {
      const t = H > 1 ? y / (H - 1) : 0;
      const row = possessed ? top.map((a, i) => a + (bottom[i] - a) * t) : flat;
      for (let x = 0; x < W; x++) {
        let k2 = 1;
        if (possessed) {
          const dx = (x / W - 0.5) * 256, dy = (y / H - 0.5) * 256;
          const v = Math.min(255, Math.hypot(dx, dy) * 2);
          k2 = 1 - Math.min(1, Math.max(0, (v - 110) / 145)) ** 1.6 * 46 / 255;
        }
        const j = (y * W + x) * 4;
        d[j] = row[0] * k2; d[j + 1] = row[1] * k2; d[j + 2] = row[2] * k2; d[j + 3] = 255;
      }
    }
    plates.set(k, d);
    return d;
  }

  // ---- one portrait ----
  async function draw(av, { possessed = false, original = false, w: W = w, h: H = h } = {}) {
    const t0 = performance.now();
    const m = await modelFor(av);
    if (disposed) return null;
    const { model, mixer } = m;
    if (original) { m.originalModel ||= createAvatarModel(m.base, av, { rim: false, original: true }); }
    const shown = original ? m.originalModel : model;
    if (original) { shown.root.rotation.y = model.root.rotation.y; scene.add(shown.root); }
    else shown.setAvatar(av);
    shown.setPossessed(possessed);
    const f = frameFor(m);
    // (the original-colours model shares the pose: its own mixer, same clip and time)
    const mix = original ? (m.originalMixer ||= (() => { const mx = new THREE.AnimationMixer(shown.root); if (m.base.clips.idle) mx.clipAction(m.base.clips.idle).play(); return mx; })()) : mixer;
    mix.setTime(0.4);
    for (const o of models.values()) { o.model.root.visible = false; if (o.originalModel) o.originalModel.root.visible = false; }
    shown.root.visible = true;
    shown.root.updateMatrixWorld(true);
    cam.clearViewOffset();
    cam.aspect = FRAME_W / FRAME_H;
    cam.position.copy(f.pos); cam.lookAt(f.look);
    const c = f.crop;
    cam.setViewOffset(FRAME_W, FRAME_H, c.x0, c.y0, c.cw, c.ch);
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    const T = makeTargets(W, H);
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha();
    const t1 = performance.now();
    try {
      renderer.setClearColor(0x000000, 0);
      renderer.setRenderTarget(T.hdr); renderer.clear(); renderer.render(scene, cam);
      T.material.uniforms.uExposure.value = renderer.toneMappingExposure;
      renderer.setRenderTarget(T.ldr); renderer.render(T.qs, T.qcam);
    } finally {
      renderer.setRenderTarget(prevTarget); renderer.setClearColor(prevClear, prevAlpha);
      shown.root.visible = false;
      shown.setPossessed(false);
      if (original) scene.remove(shown.root);
    }
    const t2 = performance.now();
    const px = T.px;
    await renderer.readRenderTargetPixelsAsync(T.ldr, 0, 0, W, H, px);
    const t3 = performance.now();
    // the render (bottom row first: flipped) laid over the plate ("over", straight alpha)
    const bg = plate(W, H, possessed);
    const img = new ImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4;
      for (let x = 0; x < W * 4; x += 4) {
        const a = px[src + x + 3] / 255, b = 1 - a, j = dst + x;
        d[j] = px[src + x] * a + bg[j] * b; d[j + 1] = px[src + x + 1] * a + bg[j + 1] * b; d[j + 2] = px[src + x + 2] * a + bg[j + 2] * b; d[j + 3] = 255;
      }
    }
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    out.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
    timings.push({ base: m.base.id, possessed, setup: +(t1 - t0).toFixed(1), render: +(t2 - t1).toFixed(1), read: +(t3 - t2).toFixed(1), copy: +(performance.now() - t3).toFixed(1) });
    if (timings.length > 40) timings.shift();
    return out;
  }

  const toBlob = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));

  async function run() {
    if (running) return;
    running = true;
    try {
      while (!disposed && (urgent.length || later.length)) {
        await nextFrame();                       // (one portrait per frame: never a long stall)
        const job = urgent.shift() || later.shift();
        if (!job) continue;
        const entry = cache.get(job.key);
        if (!entry || entry.url || entry.failed) { job.resolve(entry?.url || null); continue; }
        try {
          const canvas = await draw(job.av, { possessed: job.possessed });
          const blob = canvas && await toBlob(canvas);
          if (!blob) throw new Error('no picture');
          entry.url = URL.createObjectURL(blob);
          job.resolve(entry.url);
        } catch (err) {
          entry.failed = true;
          if (!run.warned) { run.warned = true; console.warn('avatar portraits: the shipped picture is used instead:', err?.message || err); }
          job.resolve(null);
        }
        trim();
      }
    } finally { running = false; }
  }
  function trim() {
    if (cache.size <= KEEP) return;
    for (const [k, e] of cache) {
      if (cache.size <= KEEP) break;
      if (!e.url && !e.failed) continue;       // (still to draw)
      if (e.url) URL.revokeObjectURL(e.url);
      cache.delete(k);
    }
  }

  function request(av, possessed, lane) {
    const k = keyOf(av, possessed);
    let e = cache.get(k);
    if (e) {
      cache.delete(k); cache.set(k, e);          // (recently used: kept longest)
      if (lane === urgent && !e.url && !e.failed && e.job && later.includes(e.job)) { later.splice(later.indexOf(e.job), 1); urgent.push(e.job); }
      return e.promise;
    }
    e = { url: null, failed: false, promise: null, job: null };
    e.promise = new Promise(resolve => { e.job = { key: k, av: { ...av }, possessed, resolve }; });
    cache.set(k, e);
    lane.push(e.job);
    run();
    return e.promise;
  }

  return {
    keyOf,
    peek(av, { possessed = false } = {}) { return av ? cache.get(keyOf(av, possessed))?.url || null : null; },
    url(av, { possessed = false } = {}) { return av ? request(av, !!possessed, urgent) : Promise.resolve(null); },
    prepare(list = []) {
      return Promise.all(list.filter(Boolean).map(x => (x.avatar ? request(x.avatar, !!x.possessed, later) : request(x, false, later))));
    },
    // Build the shaders for this look up front (in the menu): the first portrait then needs no compile.
    async prewarm(av) {
      try {
        const m = await modelFor(av);
        m.model.setAvatar(av);
        frameFor(m);
        const T = makeTargets(w, h);
        m.model.root.visible = true;
        const prev = renderer.getRenderTarget();
        // (the red / coloured eyes and a pair of glasses included)
        await m.model.withAllShaders(async () => {
          if (renderer.compileAsync && renderer.extensions?.has?.('KHR_parallel_shader_compile')) {
            await renderer.compileAsync(scene, cam);
            await renderer.compileAsync(T.qs, T.qcam);
          } else { renderer.compile(scene, cam); renderer.compile(T.qs, T.qcam); }
        });
        renderer.setRenderTarget(prev);
        m.model.root.visible = false;
      } catch { /* only an optimisation */ }
    },
    draw,
    // (tests) the eyes' middles in a W x H portrait of a look already drawn: [[x, y], [x, y]]
    eyesAt(baseId, W = w, H = h) {
      const f = models.get(baseId)?.frame;
      if (!f) return null;
      const c = f.crop;
      return f.eyePx.map(([x, y]) => [(x - c.x0) / c.cw * W, (y - c.y0) / c.ch * H]);
    },
    timings: () => [...timings],
    cached: () => [...cache.values()].filter(e => e.url).length,
    pending: () => urgent.length + later.length,
    dispose() {
      disposed = true;
      for (const e of cache.values()) if (e.url) URL.revokeObjectURL(e.url);
      cache.clear();
      for (const m of models.values()) { m.model.dispose(); m.originalModel?.dispose(); }
      models.clear();
      disposeTargets();
    },
  };
}
