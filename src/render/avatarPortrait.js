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
// Avatars are pieces (src/render/avatarParts.js): one hidden model per set of pieces (geometryKey), repainted per
// portrait, the 8 used last kept (the oldest let go); the framing is measured once per body, face and hairstyle
// (frameKey), from the guest's own eyes and, for the women, the whole hairdo (the merged Hair).
//
//   const portraits = createAvatarPortraits(renderer, { paused });
//   portraits.peek(avatar, { possessed })  -> the URL if it is drawn, else null
//   portraits.url(avatar, { possessed })   -> Promise<URL | null> (drawn soon: one portrait per frame)
//   portraits.prepare([avatar | { avatar, possessed }, ...])  -> drawn ahead, after anything asked for
//   portraits.prewarm(avatar)              -> builds the shaders (the menu), so the first draw is quick
//   portraits.resume()                     -> start drawing (created `paused`: the menu's lobby first)
//   portraits.draw(avatar, { possessed, w, h }) -> Promise<canvas> (tests)
// While paused, url() and prepare() still queue their portraits (the shipped picture shows meanwhile).
// The off-screen buffers are let go once nothing has been drawn for a few seconds (RELEASE_MS) and made
// again when needed. A picture that could not be drawn is tried again after RETRY_MS.
// Nothing here knows any rule or role: the caller says which look it wants.
import * as THREE from 'three';
import { createAvatarModel, loadBase } from './avatar.js';
import { avatarKey, frameKey, genderOf } from '../data/wardrobe.js';
import { POSSESSED_COLORS } from './possessedLook.js';

const VERSION = 2;                      // (bump when the catalogue's colours or the framing change; 2: avatar v2, pieces)
const NORMAL_BG = '#171b27';
const FRAME_W = 1200, FRAME_H = 1600;
const KEEP = 80;                        // portraits kept (about 2 MB); the oldest are let go
const MODELS = 8;                       // hidden models kept (one per set of pieces); the least recently used go
const RELEASE_MS = 5000;                // the buffers (about 12 MB on the graphics chip) after the last draw
const RETRY_MS = 30000;                 // a portrait that failed (its model did not download) is tried again
const nextFrame = () => new Promise(r => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });

export function createAvatarPortraits(renderer, { w = 384, h = 512, paused = false } = {}) {
  const scene = new THREE.Scene();
  scene.name = 'avatar-portraits';
  scene.add(new THREE.HemisphereLight(new THREE.Color('#ffffff').lerp(new THREE.Color('#ffd9a8'), 0.5), new THREE.Color('#3a3438'), 0.6));
  const key = new THREE.PointLight(new THREE.Color('#ffd9a8'), 22, 9, 2); key.position.set(1.2, 2.6, 1.6); scene.add(key);
  const back = new THREE.PointLight(new THREE.Color('#ffd9a8'), 10, 9, 2); back.position.set(-2.0, 2.4, -1.0); scene.add(back);
  const cam = new THREE.PerspectiveCamera(24, FRAME_W / FRAME_H, 0.1, 100);
  const models = new Map();             // geometryKey -> { base, model, mixer }: one model per set of pieces, repainted
  const frames = new Map();             // frameKey -> the framing (camera, crop, the eyes' place)
  const cache = new Map();              // key -> { url, promise, failed }
  const urgent = [], later = [];        // jobs: asked for (shown now) first, then drawn ahead
  const timings = [];
  let targets = null, running = false, disposed = false, releaseTimer = 0, drawing = 0;

  const keyOf = (av, possessed) => `${avatarKey(av)}:${possessed ? 'p' : 'n'}:${VERSION}`;

  // ---- the graphics context lost and back (iPad Safari does this when memory is short or the tab sat in the
  // background): three.js sets itself up again, and so do the portraits. Nothing drawn while it was gone counts:
  // a portrait whose draw was cut off (a failed read-back) or that started inside the loss is NOT marked failed
  // (that would show the shipped picture for the next 30 s, or until a reload) but goes back to the front of its
  // queue and is drawn again once the context is back. `epoch` counts the losses, to tell a draw that spanned one.
  const CONTEXT_LOST = new Error('the graphics context was lost');
  let epoch = 0, waiting = [];             // (waiting: the draws held in a read-back, told at once of a loss)
  const lostNow = () => { try { return !!renderer.getContext?.()?.isContextLost?.(); } catch { return false; } };
  renderer.domElement?.addEventListener('webglcontextlost', () => { epoch++; const w = waiting; waiting = []; for (const reject of w) reject(CONTEXT_LOST); });
  renderer.domElement?.addEventListener('webglcontextrestored', () => {
    // (three.js has already made its own state again, its listener having come first: the off-screen buffers
    // were made in the old context, so they are made again; the pictures drawn so far are plain JPEGs and stay)
    targets = null;
    if (!disposed) run();
  });

  // ---- render targets and the tone-map pass ----
  function makeTargets(W, H) {
    if (targets && targets.w === W && targets.h === H) return targets;
    disposeTargets();
    const ext = renderer.extensions;
    const floatOk = !!(ext?.has?.('EXT_color_buffer_float') || ext?.has?.('EXT_color_buffer_half_float'));
    const samples = Math.min(4, renderer.capabilities?.maxSamples ?? 4);
    const hdr = new THREE.WebGLRenderTarget(W, H, { type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType, samples });
    // (no float buffers on this device: an sRGB 8-bit buffer keeps the dark cloth and hair free of banding;
    // the tone-map pass still reads it as linear light)
    if (!floatOk) hdr.texture.colorSpace = THREE.SRGBColorSpace;
    // (the 8-bit target only ever takes the full-screen tone-map pass: no depth buffer)
    const ldr = new THREE.WebGLRenderTarget(W, H, { type: THREE.UnsignedByteType, depthBuffer: false });
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
  // Nothing drawn for a while: the buffers and the plates go (made again on the next portrait).
  function releaseSoon() {
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(() => { if (!running && !drawing && !disposed) { disposeTargets(); plates.clear(); } }, RELEASE_MS);
  }

  // ---- one model per set of pieces, posed; framed once per body, face and hairstyle ----
  async function modelFor(av) {
    const base = await loadBase(av);
    let m = models.get(base.id);
    if (m) { models.delete(base.id); models.set(base.id, m); return m; }   // (recently used: kept longest)
    const model = createAvatarModel(base, av, { rim: false });
    model.root.rotation.y = THREE.MathUtils.degToRad(14);
    scene.add(model.root);
    model.root.visible = false;
    const mixer = new THREE.AnimationMixer(model.root);
    if (base.clips.idle) mixer.clipAction(base.clips.idle).play();
    m = { base, model, mixer };
    models.set(base.id, m);
    for (const [k, o] of models) {
      if (models.size <= MODELS) break;
      if (o === m) continue;
      models.delete(k); scene.remove(o.model.root); o.mixer.stopAllAction(); o.model.dispose();
    }
    return m;
  }

  // The frame and crop for a body, face and hairstyle (the pipeline's preview + portrait.mjs + portrait_post.py),
  // measured once.
  function frameFor(m, av) {
    const fk = frameKey(av);
    if (frames.has(fk)) return frames.get(fk);
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
    // the eyes (portrait.mjs): the men's eyeCentre has x = 0, so the tool's 0.072; the women's pictures were framed on
    // the eye's own x (their eyeCentre's; the pieces' faces give the middle, so it is measured from the eye ovals)
    const EC = base.eyeCentre, female = genderOf(base.body) === 'f';
    const measured = base.eyes ? (Math.abs(base.eyes.left.centre.x) + Math.abs(base.eyes.right.centre.x)) / 2 : 0;
    const EX = EC && Math.abs(EC[0]) > 0.02 ? Math.abs(EC[0]) : female && measured > 0.02 ? measured : 0.072;
    const EY = EC ? EC[1] : 1.373, EZ = EC ? EC[2] : 0.237;
    const bone = model.headBone, inv = base.headInverse;
    const eyes = [[-EX, EY, EZ], [EX, EY, EZ]].map(([x, y, z]) => {
      const p = new THREE.Vector3(x, y, z).applyMatrix4(inv).applyMatrix4(bone.matrixWorld).project(cam);
      // (portrait.mjs rounds css px to 0.1 then doubles them)
      return [Math.round((p.x + 1) / 2 * 600 * 10) / 10 * 2, Math.round((1 - p.y) / 2 * 800 * 10) / 10 * 2];
    });
    const ex = (eyes[0][0] + eyes[1][0]) / 2, ey = (eyes[0][1] + eyes[1][1]) / 2, gap = Math.abs(eyes[1][0] - eyes[0][0]);
    let cw = Math.min(FRAME_W, Math.floor(gap * 3.5)), ch = Math.min(FRAME_H, Math.floor(cw * 4 / 3));
    let eyeFrac = 0.37;
    const hair = base.ranges?.Hair;
    if (female && hair) {
      // the whole hairdo in: the highest projected hair point within 1.6 eye gaps of the eyes
      let top = ey;
      const v = new THREE.Vector3(), mesh = model.mesh;
      for (const [start, n] of hair) for (let i = start; i < start + n; i++) {
        mesh.getVertexPosition(i, v); v.applyMatrix4(mesh.matrixWorld).project(cam);
        const px = (v.x + 1) / 2 * FRAME_W, py = (1 - v.y) / 2 * FRAME_H;
        if (Math.abs(px - ex) < gap * 1.6 && py < top) top = py;
      }
      eyeFrac = 0.46;
      const need = (ey - top) / (eyeFrac - 0.03);
      if (need > ch) { ch = Math.min(FRAME_H, Math.floor(need)); cw = Math.min(FRAME_W, Math.floor(ch * 3 / 4)); }
    }
    // (the crop is the camera's view offset, so it may pass the frame's edge: every face's eyes then sit at the same
    // height, however tall the guest or far forward the head. The picture tool clamped it to its rendered frame,
    // which put Henry's eyes 2 % low.)
    const x0 = Math.floor(ex - cw / 2), y0 = Math.floor(ey - ch * eyeFrac);
    // (tests) where the eye ovals' middles land in the frame (measured from the Eye mesh)
    const eyePx = base.eyes ? [base.eyes.left.centre, base.eyes.right.centre].map(c => {
      const p = c.clone().applyMatrix4(base.bindMatrix).applyMatrix4(inv).applyMatrix4(bone.matrixWorld).project(cam);
      return [(p.x + 1) / 2 * FRAME_W, (1 - p.y) / 2 * FRAME_H];
    }) : [];
    const frame = { pos, look, crop: { x0, y0, cw, ch }, eyePx };
    frames.set(fk, frame);
    return frame;
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
  async function draw(av, opts = {}) {
    drawing++;
    try { return await drawOne(av, opts); } finally { drawing--; }
  }
  async function drawOne(av, { possessed = false, w: W = w, h: H = h } = {}) {
    const t0 = performance.now();
    const m = await modelFor(av);
    if (disposed) return null;
    if (lostNow()) throw CONTEXT_LOST;
    const e0 = epoch;
    const { model: shown, mixer } = m;
    shown.setAvatar(av);
    shown.setPossessed(possessed);
    const f = frameFor(m, av);
    mixer.setTime(0.4);
    for (const o of models.values()) o.model.root.visible = false;
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
    }
    const t2 = performance.now();
    const px = T.px;
    // (a loss during the read-back ends the wait at once: a read-back cut off that way might never settle, and the
    // portraits behind this one would wait for it for ever)
    let tell;
    const lost = new Promise((_, reject) => { tell = reject; waiting.push(tell); });
    try { await Promise.race([renderer.readRenderTargetPixelsAsync(T.ldr, 0, 0, W, H, px), lost]); } finally { waiting = waiting.filter(f => f !== tell); }
    if (epoch !== e0 || lostNow()) throw CONTEXT_LOST;     // (those pixels are not a portrait)
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
    if (running || paused) return;
    running = true;
    clearTimeout(releaseTimer);
    try {
      while (!disposed && (urgent.length || later.length)) {
        await nextFrame();                       // (one portrait per frame: never a long stall)
        if (lostNow()) break;                    // (the graphics context is gone: the queue waits; its restore starts this again)
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
          if (err === CONTEXT_LOST || lostNow()) {   // (cut off by a lost context: drawn again, never marked failed)
            job.lane.unshift(job);
            if (lostNow()) break;
            continue;
          }
          entry.failed = true; entry.failedAt = performance.now();
          if (!run.warned) { run.warned = true; console.warn('avatar portraits: the shipped picture is used instead:', err?.message || err); }
          job.resolve(null);
        }
        trim();
      }
    } finally { running = false; releaseSoon(); }
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
    if (e?.failed && performance.now() - e.failedAt > RETRY_MS) { cache.delete(k); e = null; }   // (try again)
    if (e) {
      cache.delete(k); cache.set(k, e);          // (recently used: kept longest)
      if (lane === urgent && !e.url && !e.failed && e.job && later.includes(e.job)) { later.splice(later.indexOf(e.job), 1); urgent.push(e.job); }
      return e.promise;
    }
    e = { url: null, failed: false, promise: null, job: null };
    e.promise = new Promise(resolve => { e.job = { key: k, av: { ...av }, possessed, resolve, lane }; });
    cache.set(k, e);
    lane.push(e.job);
    run();
    return e.promise;
  }

  return {
    keyOf,
    // (a portrait shown is a portrait used: kept longest, like one asked for — the player's own possessed
    // portrait is read only this way during play, and must not be the first let go in a long visit)
    peek(av, { possessed = false } = {}) {
      if (!av) return null;
      const k = keyOf(av, possessed), e = cache.get(k);
      if (!e?.url) return null;
      cache.delete(k); cache.set(k, e);
      return e.url;
    },
    url(av, { possessed = false } = {}) { return av ? request(av, !!possessed, urgent) : Promise.resolve(null); },
    prepare(list = []) {
      return Promise.all(list.filter(Boolean).map(x => (x.avatar ? request(x.avatar, !!x.possessed, later) : request(x, false, later))));
    },
    // Build the shaders for this look up front (in the menu): the first portrait then needs no compile.
    // They are built for the off-screen targets the portraits are drawn into (three.js picks the tone
    // mapping and colour space of a shader from the target bound when it is built: one built for the
    // screen would be another shader). compileAsync works the shaders out at once and then only waits,
    // so the target can be put back before the wait.
    async prewarm(av) {
      try {
        const m = await modelFor(av);
        m.model.setAvatar(av);
        frameFor(m, av);
        const T = makeTargets(w, h);
        m.model.root.visible = true;
        const parallel = !!(renderer.compileAsync && renderer.extensions?.has?.('KHR_parallel_shader_compile'));
        const build = (target, sc, camera) => {
          const prev = renderer.getRenderTarget();
          renderer.setRenderTarget(target);
          try { return parallel ? renderer.compileAsync(sc, camera) : renderer.compile(sc, camera); } finally { renderer.setRenderTarget(prev); }
        };
        // (the red / coloured eyes and a pair of glasses included)
        await m.model.withAllShaders(async () => {
          const a = build(T.hdr, scene, cam), b = build(T.ldr, T.qs, T.qcam);
          if (parallel) await Promise.all([a, b]);
        });
        m.model.root.visible = false;
      } catch { /* only an optimisation */ } finally { if (!running) releaseSoon(); }
    },
    resume() { if (!paused) return; paused = false; run(); },
    draw,
    // (tests) the eyes' middles in a W x H portrait of an avatar already drawn: [[x, y], [x, y]]
    eyesAt(av, W = w, H = h) {
      const f = av ? frames.get(frameKey(av)) : null;
      if (!f) return null;
      const c = f.crop;
      return f.eyePx.map(([x, y]) => [(x - c.x0) / c.cw * W, (y - c.y0) / c.ch * H]);
    },
    timings: () => [...timings],
    cached: () => [...cache.values()].filter(e => e.url).length,
    pending: () => urgent.length + later.length,
    models: () => models.size,
    dispose() {
      disposed = true;
      clearTimeout(releaseTimer);
      for (const e of cache.values()) if (e.url) URL.revokeObjectURL(e.url);
      cache.clear();
      for (const m of models.values()) { m.mixer.stopAllAction(); m.model.dispose(); }
      models.clear();
      frames.clear();
      disposeTargets();
    },
  };
}
