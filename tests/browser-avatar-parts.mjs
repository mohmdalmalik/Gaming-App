// Guests made of pieces (src/render/avatarParts.js, avatar.js; Wardrobe W1): headless browser checks. Run from the
// repo root with a static server on 8123:  node tests/browser-avatar-parts.mjs [--url http://127.0.0.1:8123/] [--shots DIR]
//
//   1. a v1 profile looks as before: the test profile's saved v1 avatar (the Tuxedo) is read as Victor's Look and saved
//      back as v2; Victor assembled from his pieces renders like today's whole model (assets/characters/victor.glb,
//      drawn the way the game drew it before pieces) in studio light, front and back, at the game camera, walking and
//      with red eyes: mean difference under 0.5 of 255 (skipped once the old model is removed)
//   2. two draw calls a guest (three while a face's catchlights show), for the six Looks; the pieces downloaded once
//      and shared; a new assembly quick after download
//   3. a colour change repaints only: the same merged geometry, no new geometry, 16 numbers changed
//   4. the possessed eyes: red on, the catchlights hidden, back off; an eye colour kept through it
//   5. glasses: every style merged into the guest's one mesh (no draw call of its own)
//   6. a six-seat match: every guest's model within 3 draw calls, the six within 18; shader programs within the budget
//   7. the menu's lobby: every person in the room one draw call, your avatar 2-3; the whole room no more than before
import fs from 'node:fs';
import { launch } from './smoke-lib.mjs';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg('--url', 'http://127.0.0.1:8123/');
const shots = arg('--shots', null);
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PROGRAM_BUDGET = 28;

// (the draw calls of a model: one per mesh, one per visible group of a mesh with several materials)
const CALLS = `o => { let n = 0; o.traverse(x => { if (!x.isMesh || !x.visible) return; n += Array.isArray(x.material) ? x.geometry.groups.filter(g => x.material[g.materialIndex]?.visible !== false).length : 1; }); return n; }`;

{
  const { browser, page, messages } = await launch({ width: 640, height: 480 });
  await page.goto(`${base}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.portraits && window.__game.profile(), null, { timeout: 120000 });
  await page.evaluate(() => window.__game.setPixelRatio(0.5));

  console.log('1. a v1 profile looks as before');
  const prof = await page.evaluate(async () => {
    const W = await import('./src/data/wardrobe.js');
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem('hotelEscape.profile.v1')); } catch { /* none */ }
    return { avatar: window.__game.profile().avatar, victor: W.LOOKS.victor, saved: saved?.avatar, version: saved?.version };
  });
  check(JSON.stringify(prof.avatar) === JSON.stringify(prof.victor), `the saved v1 Tuxedo is read as Victor's Look (${JSON.stringify(prof.avatar)})`);
  check(prof.version === 2 && prof.saved?.v === 2 && prof.saved.face === 'victor', `and saved back once as a version 2 profile (${prof.version}, avatar v${prof.saved?.v})`);

  const mirror = await page.evaluate(async ({ CALLS }) => {
    const calls = eval(CALLS);
    const THREE = await import('three');
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const W = await import('./src/data/wardrobe.js');
    const A = await import('./src/render/avatar.js');
    const P = await import('./src/render/avatarParts.js');
    let old;
    try { old = await new GLTFLoader().loadAsync('assets/characters/victor.glb'); } catch { return { skipped: true }; }
    const look = W.LOOKS.victor;
    // today's way: one matte part per material, painted from the catalogue (the same palette entries), the rim + fill
    const pal = P.writePalette(new Float32Array(48), look);
    const ENTRY = { Skin: 'skin', Hair: 'hair', Brow: 'brow', Stache: 'brow', Jacket: 'main', Trouser: 'main', Lapel: 'lapel', Shade: 'shade', Tie: 'accent' };
    const oldParts = [];
    old.scene.traverse(o => {
      if (!o.isSkinnedMesh) return;
      o.frustumCulled = false;
      const e = ENTRY[o.material.name], i = P.PALETTE[e];
      const m = new THREE.MeshLambertMaterial({ color: e ? new THREE.Color(pal[i * 3], pal[i * 3 + 1], pal[i * 3 + 2]) : o.material.color.clone(), vertexColors: true, side: o.material.side });
      m.name = o.material.name;
      o.material = A.guestLight(m, A.GAME_RIM);
      oldParts.push(o);
    });
    const { createPossessedEyes } = await import('./src/render/possessedLook.js');
    const oldEyes = createPossessedEyes(old.scene);
    const asm = await A.loadBase(look);
    const model = A.createAvatarModel(asm, look);
    const canvas = document.createElement('canvas');
    const R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    R.toneMapping = THREE.NeutralToneMapping; R.toneMappingExposure = window.__game.cfg.render.exposure; R.setPixelRatio(1);
    const shoot = (root, { w, h, cam, at, yaw = 0, clip = 'idle', t = 0.4, possessed = false, dark = false, eyes }) => {
      const sc = new THREE.Scene(); sc.background = new THREE.Color(dark ? '#141016' : '#7b716a');
      sc.add(new THREE.HemisphereLight(dark ? '#5a6a90' : '#ffdcb0', '#2a1a12', dark ? 0.28 : 0.5));
      const k = new THREE.PointLight('#ffc98a', dark ? 5 : 18, 12, 1.6); k.position.set(1.4, 3.2, 2.4); sc.add(k);
      const parent = root.parent; sc.add(root);
      root.rotation.y = yaw * Math.PI / 180;
      const mixer = new THREE.AnimationMixer(root);
      const clips = root === old.scene ? { idle: old.animations.find(a => /idle/i.test(a.name)), walk: old.animations.find(a => /walk/i.test(a.name)) } : asm.clips;
      mixer.clipAction(clips[clip]).play(); mixer.setTime(clip === 'walk' ? t * clips.walk.duration : t);
      eyes.set(possessed);
      sc.updateMatrixWorld(true);
      R.setSize(w, h, false);
      const c = new THREE.PerspectiveCamera(cam.fov, w / h, 0.05, 100); c.position.set(...cam.pos); c.lookAt(...at); c.updateProjectionMatrix();
      R.render(sc, c);
      const d = new Uint8Array(w * h * 4); const gl = R.getContext(); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, d);
      eyes.set(false); mixer.stopAllAction(); sc.remove(root); if (parent) parent.add(root);
      return d;
    };
    const d16 = 16, p = 44 * Math.PI / 180;
    const views = {
      front: { w: 240, h: 400, cam: { fov: 30, pos: [0, 1.0, 3.9] }, at: [0, 0.86, 0] },
      back: { w: 240, h: 400, cam: { fov: 30, pos: [0, 1.0, 3.9] }, at: [0, 0.86, 0], yaw: 180 },
      face: { w: 300, h: 300, cam: { fov: 18, pos: [0, 1.41, 1.6] }, at: [0, 1.34, 0], yaw: 25 },
      game: { w: 120, h: 220, cam: { fov: 42 * 220 / 1640, pos: [0, 0.8 + d16 * Math.sin(p), d16 * Math.cos(p)] }, at: [0, 0.8, 0], yaw: 45 },
      walkDark: { w: 120, h: 220, cam: { fov: 42 * 220 / 1640, pos: [0, 0.8 + d16 * Math.sin(p), d16 * Math.cos(p)] }, at: [0, 0.8, 0], yaw: 30, clip: 'walk', t: 0.25, dark: true },
      redEyes: { w: 300, h: 300, cam: { fov: 18, pos: [0, 1.41, 1.6] }, at: [0, 1.34, 0], possessed: true },
    };
    const out = {};
    for (const [name, v] of Object.entries(views)) {
      const a = shoot(old.scene, { ...v, eyes: oldEyes }), b = shoot(model.root, { ...v, eyes: { set: on => model.setPossessed(on) } });
      let sum = 0, max = 0;
      for (let i = 0; i < a.length; i += 4) for (let c = 0; c < 3; c++) { const dd = Math.abs(a[i + c] - b[i + c]); sum += dd; if (dd > max) max = dd; }
      out[name] = { mae: +(sum / (a.length / 4 * 3)).toFixed(3), max };
    }
    const res = { views: out, calls: { old: calls(old.scene), pieces: calls(model.root) }, tris: { old: oldParts.reduce((s, o) => s + o.geometry.index.count / 3, 0), pieces: asm.stats.tris } };
    model.dispose(); R.dispose();
    return res;
  }, { CALLS });
  if (mirror.skipped) console.log('  (skipped: assets/characters/victor.glb is gone: the review reference was removed)');
  else {
    const worst = Math.max(...Object.values(mirror.views).map(v => v.mae));
    check(worst < 0.5, `Victor from pieces renders like today's victor.glb (${Object.entries(mirror.views).map(([k, v]) => `${k} ${v.mae}`).join(', ')} of 255)`);
    check(mirror.calls.pieces === 2 && mirror.calls.old >= 9, `in ${mirror.calls.pieces} draw calls instead of ${mirror.calls.old} (${mirror.tris.pieces} triangles; today ${mirror.tris.old})`);
  }

  console.log('\n2. two draw calls a guest; pieces shared; quick to assemble');
  const looks = await page.evaluate(async ({ CALLS }) => {
    const calls = eval(CALLS);
    const W = await import('./src/data/wardrobe.js');
    const A = await import('./src/render/avatar.js');
    const P = await import('./src/render/avatarParts.js');
    const out = {};
    for (const id of Object.keys(W.LOOKS)) {
      const asm = await A.loadBase(W.LOOKS[id]);
      const m = A.createAvatarModel(asm, W.LOOKS[id]);
      out[id] = { calls: calls(m.root), shine: asm.eyeMaterials.some(e => e.name === 'Shine'), tris: asm.stats.tris, bytes: asm.stats.bytes, warnings: asm.warnings.length };
      m.dispose();
    }
    // two guests in the same pieces share one merged geometry; the pieces themselves are parsed once
    const a = await A.loadBase(W.LOOKS.marcus), m1 = A.createAvatarModel(a, W.LOOKS.marcus), m2 = A.createAvatarModel(await A.loadBase(W.withItem(W.LOOKS.marcus, 'main', 'plum')), W.withItem(W.LOOKS.marcus, 'main', 'plum'));
    const shared = m1.mesh.geometry === m2.mesh.geometry;
    m1.dispose(); m2.dispose();
    // assembly time after download (new mixes of pieces)
    const RA = await import('./src/data/randomAvatar.js');
    const avs = Array.from({ length: 12 }, (_, i) => W.normaliseAvatar(RA.randomAvatar(`parts_speed_${i}`), { trusted: true }));
    await P.preload(avs);
    const times = [];
    for (const av of avs) { const s = await P.assemble(av); times.push(s.stats.buildMs); s.release(); }
    times.sort((x, y) => x - y);
    return { out, shared, parts: P.partsDebug().parts.length, median: times[times.length >> 1], max: times[times.length - 1] };
  }, { CALLS });
  for (const [id, x] of Object.entries(looks.out)) check(x.calls === (x.shine ? 3 : 2) && !x.warnings, `${id}: ${x.calls} draw calls${x.shine ? ' (with her catchlights)' : ''}, ${x.tris} triangles, ${Math.round(x.bytes / 1024)} kB of pieces`);
  check(looks.shared, 'two guests in the same pieces share one merged geometry (only the colours differ)');
  check(looks.median < 50, `a new assembly after download: median ${looks.median} ms, slowest ${looks.max} ms (budget 50 ms; ${looks.parts} pieces loaded once)`);

  console.log('\n3. a colour change repaints only');
  const repaint = await page.evaluate(async () => {
    const THREE = await import('three');
    const W = await import('./src/data/wardrobe.js');
    const A = await import('./src/render/avatar.js');
    const g = window.__game;
    const look = W.LOOKS.clara;
    const asm = await A.loadBase(look);
    const m = A.createAvatarModel(asm, look);
    g.view.scene.add(m.root);
    g.view.renderer.render(g.view.scene, g.view.camera);
    const geo = m.mesh.geometry, before = g.view.renderer.info.memory.geometries;
    const pal = m.mesh.material.userData.palette, p0 = Array.from(pal);
    const next = W.withItem(W.withItem(look, 'main', 'emerald'), 'hair', 'blonde');
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) m.setAvatar(i % 2 ? look : next);
    const ms = (performance.now() - t0) / 100;
    m.setAvatar(next);
    g.view.renderer.render(g.view.scene, g.view.camera);
    const changed = Array.from(pal).filter((v, i) => Math.abs(v - p0[i]) > 1e-6).length;
    const res = { same: m.mesh.geometry === geo, geos: [before, g.view.renderer.info.memory.geometries], changed, ms: +ms.toFixed(3), sameKey: W.geometryKey(next) === W.geometryKey(look) };
    m.dispose();
    return res;
  });
  check(repaint.sameKey && repaint.same && repaint.geos[0] === repaint.geos[1], `new colours: the same merged geometry, no new geometry (${repaint.geos.join(' -> ')})`);
  check(repaint.changed > 0 && repaint.changed <= 48 && repaint.ms < 1, `only palette numbers change (${repaint.changed} of 48), ${repaint.ms} ms a repaint`);

  console.log('\n4. the possessed eyes');
  const eyes = await page.evaluate(async () => {
    const W = await import('./src/data/wardrobe.js');
    const A = await import('./src/render/avatar.js');
    const out = {};
    for (const id of ['victor', 'eleanor']) {
      for (const eye of ['classic', 'green']) {
        const av = W.withItem(W.LOOKS[id], 'eyes', eye);
        const m = A.createAvatarModel(await A.loadBase(av), av);
        const mats = () => m.eyeMesh.material.map(x => `${x.name}${x.visible === false ? '(hidden)' : ''}`).join('+');
        const off = mats(); m.setPossessed(true); const on = mats(); m.setPossessed(false); const back = mats();
        out[`${id}/${eye}`] = { off, on, back };
        m.dispose();
      }
    }
    return out;
  });
  for (const [k, x] of Object.entries(eyes)) {
    const female = k.startsWith('eleanor'), iris = k.endsWith('green');
    const ok = /^Eye:possessed/.test(x.on) && x.off === x.back && (!female || (iris ? /Shine:hidden/.test(x.off) : /Shine$/.test(x.off) && /Shine\(hidden\)/.test(x.on)));
    check(ok, `${k}: red on (${x.on}), back off (${x.back})`);
  }

  console.log('\n5. glasses in the guest\'s own mesh');
  const glasses = await page.evaluate(async ({ CALLS }) => {
    const calls = eval(CALLS);
    const W = await import('./src/data/wardrobe.js');
    const A = await import('./src/render/avatar.js');
    const out = [];
    for (const id of ['marcus', 'henry', 'beatrice']) for (const g of W.itemsFor('glasses', W.LOOKS[id].body)) {
      const av = W.withItem(W.LOOKS[id], 'glasses', g.id);
      const asm = await A.loadBase(av), m = A.createAvatarModel(asm, av);
      out.push({ id, g: g.id, calls: calls(m.root), verts: (asm.ranges.Glasses || []).reduce((s, r) => s + r[1], 0) });
      m.dispose();
    }
    return out;
  }, { CALLS });
  const gBad = glasses.filter(x => (x.g === 'none' ? x.verts : !x.verts) || x.calls > 3);
  check(!gBad.length, `${glasses.length} looks with glasses: every pair merged in, no draw call of its own${gBad.length ? ` (odd: ${JSON.stringify(gBad)})` : ''}`);
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

{
  console.log('\n6. a six-seat match');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  await page.goto(`${base}?mode=bots&bots=5&seed=7&seat=0&intro=off&botpace=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin')?.disabled, null, { timeout: 240000 });
  await page.click('#btn-begin');
  await page.waitForFunction(() => window.__game.characters.length === 6 && window.__game.characters.every(c => c.debug().loaded), null, { timeout: 240000 });
  await sleep(1500);
  for (const sel of ['#btn-role-ok', 'text=I understand']) { try { await page.click(sel, { timeout: 3000 }); break; } catch { /* the next */ } }
  await sleep(2000);
  if (shots) await page.screenshot({ path: `${shots}/match-six.png` });
  const m = await page.evaluate(({ CALLS }) => {
    const calls = eval(CALLS);
    const g = window.__game;
    const per = g.characters.map(cv => { let n = 0, tris = 0; cv.group.traverse(o => { if (o.isSkinnedMesh) { n += calls(o); tris += o.geometry.index.count / 3; } }); return { calls: n, tris }; });
    return { per, info: g.renderInfo() };
  }, { CALLS });
  const total = m.per.reduce((s, x) => s + x.calls, 0);
  check(m.per.every(x => x.calls >= 2 && x.calls <= 3) && total <= 18, `the six guests: ${m.per.map(x => x.calls).join('+')} = ${total} draw calls (budget 18; 94 before pieces)`);
  check(m.per.every(x => x.tris <= 38000), `each guest within the triangle cap (${m.per.map(x => x.tris).join(', ')})`);
  check(m.info.programs <= PROGRAM_BUDGET, `the frame: ${m.info.calls} draw calls, ${m.info.triangles} triangles, ${m.info.programs} shader programs (budget ${PROGRAM_BUDGET})`);
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

{
  console.log('\n7. the menu\'s lobby');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.lobbyReady() && window.__game.lobbyPlayer() && !document.getElementById('btn-menu-bots').disabled, null, { timeout: 240000 });
  await sleep(1500);
  if (shots) await page.screenshot({ path: `${shots}/lobby.png` });
  const l = await page.evaluate(() => ({ info: window.__game.renderInfo(), people: window.__game.lobbyPeople() }));
  const you = l.people.find(p => p.name === 'you'), others = l.people.filter(p => p.name !== 'you');
  check(others.length >= 10 && others.every(p => p.calls === 1), `every person in the room one draw call (${others.map(p => `${p.name} ${p.calls}`).join(', ')})`);
  check(!!you && you.calls >= 2 && you.calls <= 3, `your avatar ${you?.calls} draw calls (9-15 before pieces)`);
  check(l.info.calls <= 45, `the menu's lobby: ${l.info.calls} draw calls, ${l.info.triangles} triangles (45 before pieces)`);
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall avatar-parts checks passed');
process.exit(failures.length ? 1 : 0);
