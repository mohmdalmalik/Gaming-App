// Checks for the avatars as the game draws them (avatar v2: pieces on shared bodies): the guests assembled from their
// pieces (src/render/avatarParts.js, avatar.js), the glasses (avatarGlasses.js), the runtime portraits
// (avatarPortrait.js), the red eyes, the wardrobe screen (src/ui/avatarEditor.js) with your avatar in the menu's lobby
// (src/menu/lobbyScene.js), the lift, and four tables in a row. (The catalogue, the v1 -> v2 migration and the bots'
// looks are data: tests/wardrobe-check.mjs.) Run from tests/ with the static server on 8123:
//   node avatar-check.mjs [--url http://127.0.0.1:8123/] [--shots DIR] [--skip render,portraits,eyes,wardrobe,lift,games]
//
//   3. render     every classic Look takes every colour of every row (the right palette entries, the iris or the
//                 face's own eyes); every glasses style merged into the guest (no draw call of its own), Henry's own
//                 frames for Round; glasses fitted to every face (built, a sensible size, round the eyes); every
//                 hairstyle on every face and every jacket with every tie, every gown with every belt: assembled,
//                 2-3 draw calls, within the triangle cap, no shadow baked against another version of its piece
//   4. portraits  each Look's runtime portrait framed like the pictures: the eyes level and in the middle, at 37 %
//                 of the height (men) or with the whole hairdo in (women); Victor's matches his shipped picture; every
//                 face has a shipped picture to show until its portrait is drawn
//   5. eyes       the red eyes on every Look with every eye colour (pixels at the eyes of a portrait), the iris colour
//                 back when not possessed, and the possessed switch kept through a change of eye colour (setAvatar
//                 while possessed); the shader programs stay within the budget; the eyewear red-eye test (every
//                 glasses style on every Look: no style hides more of the red eyes than today's; a new one meets 0.90)
//   6. wardrobe   at 1024x768, 1180x820 and 1366x1024: the page never scrolls, the panel and Done are on screen, your
//                 avatar stands in the space right of the panel, head to feet; the rows in order; the unlockable
//                 items marked (wearable for testing); a pick shows on your avatar in the lobby at once; Done keeps it
//                 (your profile, v2); Change name opens the register in rename mode
//   7. lift       practice: your avatar boards alone; a match: you with Henry and Clara (never Victor beside a
//                 guest who looks like him: the test profile is Victor's Look)
//   8. games      four tables in a row (Play again): one character view per seat, built from the seats' avatars, the
//                 others let go; the strip's portraits are the seats' own; geometry, shader programs and draw calls
//                 stay bounded
import fs from 'node:fs';
import { launch } from './smoke-lib.mjs';
import { item } from '../src/data/wardrobe.js';
import { lobbyLayout } from '../src/menu/lobbyLayout.js';

const args = process.argv.slice(2);
const arg = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const base = arg('--url', 'http://127.0.0.1:8123/');
const shots = arg('--shots', null);
const skip = new Set((arg('--skip', '') || '').split(',').filter(Boolean));
if (shots) fs.mkdirSync(shots, { recursive: true });
const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };
const PROGRAM_BUDGET = 28;      // a six-seat match (measured 21 with pieces; 22 before; 18 before avatars)

// ---------------------------------------------------------------------------------------------------
// The render checks run in the game's own page (a direct link: no menu), small and at a low resolution so
// the game's own frames do not slow the software renderer down.
async function renderPage() {
  const { browser, page, messages } = await launch({ width: 640, height: 480 });
  await page.goto(`${base}?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.portraits, null, { timeout: 120000 });
  await page.evaluate(() => window.__game.setPixelRatio(0.5));
  return { browser, page, messages };
}

if (!skip.has('render') || !skip.has('portraits') || !skip.has('eyes')) {
  const { browser, page, messages } = await renderPage();

  if (!skip.has('render')) {
    console.log('\n3. every Look, every colour; glasses; every piece with every piece');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const A = await import('./src/render/avatar.js');
      const P = await import('./src/render/avatarParts.js');
      const G = await import('./src/render/avatarGlasses.js');
      const THREE = await import('three');
      const lin = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
      const near = (pal, slot, rgb) => Math.abs(pal[slot * 3] - rgb[0]) + Math.abs(pal[slot * 3 + 1] - rgb[1]) + Math.abs(pal[slot * 3 + 2] - rgb[2]) < 1e-4;
      const calls = m => { let n = 0; m.root.traverse(o => { if (o.isMesh) n += Array.isArray(o.material) ? o.geometry.groups.filter(g => o.material[g.materialIndex]?.visible !== false).length : 1; }); return n; };
      const out = { bad: [], applied: 0, glasses: [], fits: [], mixes: { n: 0, bad: [] } };
      const COLOURS = ['skin', 'hair', 'eyes', 'main', 'accent', 'metal', 'frame'];
      for (const id of Object.keys(W.LOOKS)) {
        const look = W.LOOKS[id];
        const base = await A.loadBase(look);
        const model = A.createAvatarModel(base, look);
        const pal = model.mesh.material.userData.palette;
        for (const slot of COLOURS) for (const it of W.itemsFor(slot, look.body)) {
          const av = W.withItem(look, slot, it.id);
          if (av.colours[slot] !== it.id) continue;      // (not wearable on this Look)
          model.setAvatar(av);
          out.applied++;
          const P2 = W.paletteHex(av);
          let ok = true;
          if (slot === 'skin') ok = near(pal, P.PALETTE.skin, lin(it.value)) && near(pal, P.PALETTE.lips, lin(it.lips));
          if (slot === 'hair') ok = near(pal, P.PALETTE.hair, lin(it.value)) && near(pal, P.PALETTE.brow, lin(it.brow));
          if (slot === 'main') {
            const m = lin(it.value), l = m[0] * 0.2126 + m[1] * 0.7152 + m[2] * 0.0722;
            const k = THREE.MathUtils.lerp(0.25, 0.62, THREE.MathUtils.smoothstep(l, 0.02, 0.5));
            ok = near(pal, P.PALETTE.main, m) && near(pal, P.PALETTE.lapel, m.map(v => v * 0.62)) && near(pal, P.PALETTE.shade, m.map(v => v * k));
          }
          if (slot === 'accent' || slot === 'metal') ok = near(pal, P.PALETTE[slot], lin(it.value));
          if (slot === 'frame') ok = near(pal, P.PALETTE.frame, lin(P2.frame));
          if (slot === 'eyes') {
            const m = model.eyeMesh.material[0];
            ok = it.value ? !!m.userData.possessedUniforms && m.userData.possessedUniforms.uIrisCore.value.getHexString() === new THREE.Color(it.value[2]).getHexString() && m.userData.possessedUniforms.uGlow.value === 0
              : m.name === 'Eye' && !m.userData.possessedUniforms;
          }
          if (!ok) out.bad.push(`${id}:${slot}.${it.id}`);
        }
        // the glasses: merged into the guest (its own pieces, no draw call of its own); Henry's own frames for Round
        for (const g of W.itemsFor('glasses', look.body)) {
          const av = W.withItem(look, 'glasses', g.id);
          const b2 = await A.loadBase(av);
          const m2 = A.createAvatarModel(b2, av);
          const own = W.partKeysFor(av).builtInGlasses;
          const rng = b2.ranges.Glasses || [];
          const ok = g.id === 'none' ? !rng.length && !m2.glasses
            : rng.length === 1 && !!m2.glasses && (own ? b2.builtInGlasses === own : b2.glasses === g.value);
          out.glasses.push({ id, g: g.id, own: !!own, calls: calls(m2), verts: rng.reduce((s, x) => s + x[1], 0), ok });
          m2.dispose();
        }
        model.dispose();
      }
      // glasses fitted to every face and style (built, a sensible size, round the eyes)
      for (const body of ['m', 'f']) for (const face of W.itemsFor('face', body)) {
        const av = W.withItem(W.LOOKS[body === 'm' ? 'victor' : 'clara'], 'face', face.id);
        const asm = await A.loadBase(av);
        for (const style of ['round', 'oval', 'deco', 'pincenez', 'monocle']) {
          const geo = G.buildGlasses(asm, style);
          const tris = geo ? (geo.index ? geo.index.count : geo.attributes.position.count) / 3 : 0;
          const e = asm.eyes;
          if (geo && !geo.boundingBox) geo.computeBoundingBox();
          const bb = geo?.boundingBox, front = Math.max(e.left.centre.z, e.right.centre.z);
          // in front of the eyes (the bridge over the big noses: at most 9 cm), across both eyes (one for the
          // monocle), at eye height
          const ok = !!bb && bb.max.z > front && bb.max.z < front + 0.09
            && bb.min.x < e.left.centre.x && (style === 'monocle' || bb.max.x > e.right.centre.x)
            && bb.min.y < e.left.centre.y && bb.max.y > e.left.centre.y
            && (style === 'pincenez' || style === 'monocle' || bb.min.z < front - 0.08);   // (temples back toward the ears)
          out.fits.push({ face: face.id, style, tris: Math.round(tris), ok });
        }
      }
      // every hairstyle on every face (moustaches too), every jacket with every tie, every gown with every belt
      const mixes = [];
      for (const body of ['m', 'f']) {
        const start = W.LOOKS[body === 'm' ? 'victor' : 'clara'];
        for (const face of W.itemsFor('face', body)) for (const hair of W.itemsFor('hairStyle', body)) {
          let av = W.withItem(W.withItem(start, 'face', face.id), 'hairStyle', hair.id);
          if (body === 'm') for (const f of W.itemsFor('facial', 'm')) mixes.push(W.withItem(av, 'facial', f.id));
          else mixes.push(av);
        }
        if (body === 'm') for (const top of W.itemsFor('top', 'm')) for (const neck of W.itemsFor('neck', 'm')) mixes.push(W.withItem(W.withItem(start, 'top', top.id), 'neck', neck.id));
        else for (const dress of W.itemsFor('dress', 'f')) for (const belt of W.itemsFor('belt', 'f')) for (const ex of W.itemsFor('extra', 'f'))
          mixes.push(W.withItem(W.withItem(W.withItem(start, 'dress', dress.id), 'belt', belt.id), 'extra', ex.id));
      }
      const seen = new Set();
      for (const av of mixes) {
        const k = W.geometryKey(av);
        if (seen.has(k)) continue;
        seen.add(k);
        const asm = await P.assemble(av);
        const m = A.createAvatarModel(asm, av);
        const c = calls(m), tris = asm.stats.tris;
        out.mixes.n++;
        if (c < 2 || c > 3 || tris > W.TRIANGLE_CAP || asm.warnings.length) out.mixes.bad.push(`${k}: ${c} calls, ${tris} tris ${asm.warnings.join(' ')}`);
        m.dispose(); asm.release();
      }
      return out;
    });
    check(r.bad.length === 0, `${r.applied} colours applied on the six Looks, each painting its palette entry${r.bad.length ? ` (wrong: ${r.bad.join(', ')})` : ''}`);
    const gBad = r.glasses.filter(g => !g.ok || g.calls > 3);
    check(gBad.length === 0, `every glasses style on every Look merged into the guest (${r.glasses.length}: ${Math.min(...r.glasses.map(g => g.calls))}-${Math.max(...r.glasses.map(g => g.calls))} draw calls), Henry's own frames for Round${gBad.length ? ` (odd: ${JSON.stringify(gBad)})` : ''}`);
    const fBad = r.fits.filter(g => !(g.tris > 300 && g.tris < 6000 && g.ok));
    check(fBad.length === 0, `glasses fitted to every face and style: built, ${Math.min(...r.fits.map(g => g.tris))}-${Math.max(...r.fits.map(g => g.tris))} triangles, in front of the eyes, temples back to the ears${fBad.length ? ` (odd: ${JSON.stringify(fBad)})` : ''}`);
    check(r.mixes.n > 40 && r.mixes.bad.length === 0, `${r.mixes.n} mixes of pieces (every hairstyle and moustache on every face, every jacket with every tie, every gown with every belt and earrings) assembled: 2-3 draw calls, within the triangle cap, no stale shadow${r.mixes.bad.length ? ` (odd: ${r.mixes.bad.slice(0, 4).join(' | ')})` : ''}`);
  }

  if (!skip.has('portraits')) {
    console.log('\n4. runtime portraits');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const P = window.__game.portraits();
      const pixels = (src, w, h) => new Promise((res, rej) => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0, w, h); res(g.getImageData(0, 0, w, h).data); }; i.onerror = rej; i.src = src; });
      const out = [];
      for (const id of Object.keys(W.LOOKS)) {
        const av = W.LOOKS[id];
        const canvas = await P.draw(av, { w: 576, h: 768 });
        const eyes = P.eyesAt(av, 576, 768);
        let mae = null;
        try {
          const ref = await pixels(W.shippedPortraitFor(av), 576, 768);
          const mine = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, 576, 768).data;
          let sum = 0;
          for (let i = 0; i < mine.length; i += 4) sum += Math.abs(mine[i] - ref[i]) + Math.abs(mine[i + 1] - ref[i + 1]) + Math.abs(mine[i + 2] - ref[i + 2]);
          mae = +(sum / (576 * 768 * 3)).toFixed(2);
        } catch { mae = null; }
        out.push({ id, female: W.genderOf(av.body) === 'f', eyes: eyes.map(p => p.map(v => +v.toFixed(1))), mae, shipped: [W.shippedPortraitFor(av), W.shippedPortraitFor(av, true)] });
      }
      return out;
    });
    for (const x of r) {
      const [[lx, ly], [rx, ry]] = x.eyes, mx = (lx + rx) / 2, my = (ly + ry) / 2;
      // (the crop is 3.5 eye gaps of 0.072 m wide: the eye ovals' own gap is a little narrower)
      const placed = Math.abs(ly - ry) < 12 && Math.abs(mx - 288) < 20 && (x.female ? my > 768 * 0.3 && my < 768 * 0.47 : Math.abs(my - 768 * 0.37) < 12);
      check(placed, `${x.id}: the eyes level and in place (${x.eyes.map(p => p.join(',')).join(' / ')} in 576x768)`);
    }
    check(r.every(x => x.mae != null), `every face has its shipped picture (${r.map(x => x.shipped[0].split('/').pop()).join(', ')})`);
    const victor = r.find(x => x.id === 'victor');
    // (the shipped picture keeps the model's own colours, a little apart from the catalogue's: the hair, the brows)
    check(victor.mae != null && victor.mae < 6, `Victor's runtime portrait matches his shipped picture (mean error ${victor.mae} of 255)`);
    console.log(`       (the others, built on the shared bodies: ${r.filter(x => x.id !== 'victor').map(x => `${x.id} ${x.mae}`).join(', ')})`);
  }

  if (!skip.has('eyes')) {
    console.log('\n5. red eyes on every Look with every eye colour');
    const r = await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const A = await import('./src/render/avatar.js');
      const P = window.__game.portraits();
      const w = 288, h = 384;
      const sample = (canvas, pts) => {
        const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
        let red = 0, n = 0; const mean = [0, 0, 0];
        for (const [x0, y0] of pts) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const x = Math.round(x0 + dx), y = Math.round(y0 + dy), j = (y * w + x) * 4;
          const [rr, g, b] = [d[j], d[j + 1], d[j + 2]];
          if (rr > 2.2 * g && rr > 1.8 * b && rr > 60) red++;
          mean[0] += rr; mean[1] += g; mean[2] += b; n++;
        }
        return { red: red / n, mean: mean.map(v => Math.round(v / n)) };
      };
      const out = [];
      for (const id of Object.keys(W.LOOKS)) {
        for (const e of W.itemsFor('eyes', W.LOOKS[id].body)) {
          const av = W.withItem(W.LOOKS[id], 'eyes', e.id);
          const red = await P.draw(av, { possessed: true, w, h });
          const pts = P.eyesAt(av, w, h);
          const normal = await P.draw(av, { possessed: false, w, h });
          out.push({ b: id, eyes: e.id, poss: sample(red, pts), norm: sample(normal, pts) });
        }
      }
      // the switch through a change of eye colour while possessed (the wardrobe, a reused view)
      const clara = W.LOOKS.clara, withEyes = id => W.withItem(clara, 'eyes', id);
      const base = await A.loadBase(clara);
      const m = A.createAvatarModel(base, withEyes('blue'));
      const eyeMat = () => m.eyeMesh.material[0];
      m.setPossessed(true);
      const s1 = eyeMat().name;
      m.setAvatar(withEyes('green'));
      const s2 = eyeMat().name, s2red = eyeMat().userData.possessedUniforms?.uIrisCore.value.getHexString();
      m.setPossessed(false);
      const s3 = eyeMat().userData.possessedUniforms?.uIrisCore.value.getHexString();
      m.setAvatar(withEyes('classic'));
      m.setPossessed(true); m.setPossessed(false);
      const s4 = eyeMat().name === 'Eye' && !eyeMat().userData.possessedUniforms;
      m.dispose();
      return { out, sw: { s1, s2, s2red, s3, s4 }, programs: window.__game.programCount() };
    });
    const redBad = r.out.filter(x => !(x.poss.red >= 0.3));
    check(redBad.length === 0, `possessed: red at the eyes on all ${r.out.length} Looks x eye colours${redBad.length ? ` (not red: ${redBad.map(x => `${x.b}/${x.eyes} ${x.poss.red.toFixed(2)}`).join(', ')})` : ''}`);
    const normBad = r.out.filter(x => x.norm.red > 0.05);
    check(normBad.length === 0, `not possessed: no red at the eyes${normBad.length ? ` (red: ${normBad.map(x => `${x.b}/${x.eyes}`).join(', ')})` : ''}`);
    const hue = { blue: m => m[2] > m[0], green: m => m[1] > m[0] && m[1] > m[2] };
    const hueBad = r.out.filter(x => hue[x.eyes] && !hue[x.eyes](x.norm.mean));
    check(hueBad.length === 0, `blue eyes read blue and green eyes green${hueBad.length ? ` (${hueBad.map(x => `${x.b}/${x.eyes} ${x.norm.mean}`).join(', ')})` : ''}`);
    check(/possessed/.test(r.sw.s1) && /possessed/.test(r.sw.s2) && r.sw.s2red === 'a51d2a',
      `red eyes stay on through a change of eye colour (${r.sw.s1} -> ${r.sw.s2}, core #${r.sw.s2red})`);
    const green = item('eyes', 'green').value[2].slice(1);
    check(r.sw.s3 === green, `un-possessed: the new iris comes back (core #${r.sw.s3}, green is #${green})`);
    check(r.sw.s4, "back to classic eyes, red on and off: the face's own eyes return");
    check(r.programs <= PROGRAM_BUDGET, `shader programs within the budget (${r.programs} <= ${PROGRAM_BUDGET})`);

    // The eyewear red-eye test (contract 9.3, through the game's own model): each glasses style on each Look, the
    // share of the eyes' pixels still visible with the frames on (ID-coloured eyes, everything else black, 512 x 512,
    // framed on the eyes from the game camera's direction: pitch 44, distance 16), face-on headings (0, 45, 90, 270,
    // 315) at Idle 0 and Walk 0.25 / 0.75; the minimum. Today's frames score 0.67-0.79, BELOW the contract's 0.90:
    // whether that is accepted is the lead's and the owner's decision (W1 review ART-3). Until then this keeps every
    // style from getting worse than today (git HEAD before W1, the same figures to 3 decimals), and holds any NEW
    // eyewear (the Monocle, Gold frames: W1-B) to the gate.
    const EYEWEAR_TODAY = {
      victor: { round: 0.785, oval: 0.733, deco: 0.748, pincenez: 0.681 }, marcus: { round: 0.748, oval: 0.686, deco: 0.698, pincenez: 0.743 },
      henry: { round: 0.76, oval: 0.75, deco: 0.786, pincenez: 0.687 }, clara: { round: 0.695, oval: 0.715, deco: 0.707, pincenez: 0.67 },
      eleanor: { round: 0.716, oval: 0.716, deco: 0.715, pincenez: 0.682 }, beatrice: { round: 0.776, oval: 0.777, deco: 0.755, pincenez: 0.722 },
    };
    const ew = await page.evaluate(async () => {
      const THREE = await import('three');
      const W = await import('./src/data/wardrobe.js');
      const A = await import('./src/render/avatar.js');
      const N = 512;
      const R = new THREE.WebGLRenderer({ canvas: document.createElement('canvas'), antialias: false });
      R.setPixelRatio(1); R.setSize(N, N, false);
      const rt = new THREE.WebGLRenderTarget(N, N), px = new Uint8Array(N * N * 4);
      const BLACK = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
      const ID = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide, toneMapped: false });
      const HIDE = new THREE.MeshBasicMaterial({ visible: false });
      const count = (scene, cam) => {
        R.setRenderTarget(rt); R.setClearColor(0x000000, 1); R.clear(); R.render(scene, cam);
        R.readRenderTargetPixels(rt, 0, 0, N, N, px); R.setRenderTarget(null);
        let n = 0;
        for (let i = 0; i < px.length; i += 4) if (px[i] > 150 && px[i + 1] < 90 && px[i + 2] > 150) n++;
        return n;
      };
      const without = (geo, spans) => {         // the merged guest with the glasses' triangles left out
        const idx = geo.index.array, keep = [];
        for (let t = 0; t < idx.length; t += 3) if (!spans.some(([s, c]) => idx[t] >= s && idx[t] < s + c)) keep.push(idx[t], idx[t + 1], idx[t + 2]);
        const g = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
        g.setIndex(keep);
        return g;
      };
      const cam = new THREE.PerspectiveCamera(1.4, 1, 1, 100), p = THREE.MathUtils.degToRad(44), out = [];
      for (const id of Object.keys(W.LOOKS)) {
        for (const g of W.itemsFor('glasses', W.LOOKS[id].body).filter(g => g.id !== 'none')) {
          const av = W.withItem(W.LOOKS[id], 'glasses', g.id);
          const base = await A.loadBase(av);
          const model = A.createAvatarModel(base, av, { rim: false });
          const scene = new THREE.Scene(); scene.add(model.root);
          model.mesh.material = BLACK;
          const nEye = Array.isArray(model.eyeMesh.material) ? model.eyeMesh.material.length : 1;
          model.eyeMesh.material = [ID, ...Array(nEye - 1).fill(HIDE)];
          const full = model.mesh.geometry, bare = without(full, base.ranges.Glasses || []);
          const mixer = new THREE.AnimationMixer(model.root);
          let min = 1;
          for (const [clip, frac] of [['idle', 0], ['walk', 0.25], ['walk', 0.75]]) {
            for (const h of [0, 45, 90, 270, 315]) {
              mixer.stopAllAction(); mixer.clipAction(base.clips[clip]).play(); mixer.setTime(frac * base.clips[clip].duration);
              model.root.rotation.set(0, THREE.MathUtils.degToRad(h), 0); scene.updateMatrixWorld(true);
              model.eyeMesh.computeBoundingBox();
              const c = model.eyeMesh.boundingBox.getCenter(new THREE.Vector3()); model.eyeMesh.localToWorld(c);
              cam.position.set(c.x, c.y + 16 * Math.sin(p), c.z + 16 * Math.cos(p)); cam.lookAt(c); cam.updateProjectionMatrix();
              const on = count(scene, cam); model.mesh.geometry = bare;
              const off = count(scene, cam); model.mesh.geometry = full;
              if (off >= 30) min = Math.min(min, on / off);
            }
          }
          mixer.stopAllAction(); bare.dispose(); scene.remove(model.root); model.dispose();
          out.push({ look: id, style: g.id, score: +min.toFixed(3), removed: (base.ranges.Glasses || []).reduce((s, [, n]) => s + n, 0) });
        }
      }
      rt.dispose(); R.dispose(); R.forceContextLoss();
      return { out, gate: W.RED_EYE_GATE };
    });
    const worse = ew.out.filter(x => EYEWEAR_TODAY[x.look]?.[x.style] != null && x.score < EYEWEAR_TODAY[x.look][x.style] - 0.02);
    const fresh = ew.out.filter(x => EYEWEAR_TODAY[x.look]?.[x.style] == null);
    console.log(`        eyewear red-eye scores (today's in brackets): ${ew.out.map(x => `${x.look}/${x.style} ${x.score}${EYEWEAR_TODAY[x.look]?.[x.style] != null ? ` (${EYEWEAR_TODAY[x.look][x.style]})` : ''}`).join(', ')}`);
    check(ew.out.length >= 24 && ew.out.every(x => x.removed > 0) && worse.length === 0,
      `eyewear: no glasses style hides more of the red eyes than today's on any Look (${ew.out.length} measured${worse.length ? `; worse: ${worse.map(x => `${x.look}/${x.style} ${x.score}`).join(', ')}` : ''})`);
    check(fresh.every(x => x.score >= ew.gate), `eyewear: any new style reaches the red-eye gate ${ew.gate} (${fresh.length ? fresh.map(x => `${x.look}/${x.style} ${x.score}`).join(', ') : 'none offered yet: the Monocle and Gold frames come in W1-B'})`);
  }
  check(!messages.filter(m => !/GPU stall|ReadPixels/i.test(m)).length, `no console errors (render checks)${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

// ---------------------------------------------------------------------------------------------------
async function menuPage(w, h) {
  const { browser, page, messages } = await launch({ width: w, height: h });
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.lobbyReady() && window.__game.lobbyPlayer() && !document.getElementById('btn-menu-bots').disabled, null, { timeout: 180000 });
  return { browser, page, messages };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

if (!skip.has('wardrobe')) {
  console.log('\n6. the wardrobe');
  for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024]]) {
    const { browser, page, messages } = await menuPage(w, h);
    const tag = `${w}x${h}`;
    const idle = await page.evaluate(() => window.__game.lobbyPlayer());
    const [sx, sz] = lobbyLayout.player.at;      // (its spot by the lift: src/menu/lobbyLayout.js)
    check(!!idle && idle.look === 'victor' && Math.abs(idle.x - sx) < 0.05 && Math.abs(idle.z - sz) < 0.05, `${tag}: your avatar (the test profile's v1 Tuxedo: Victor's Look) stands by the lift in the lobby (${idle?.look} at ${idle?.x?.toFixed(2)}, ${idle?.z?.toFixed(2)})`);
    await page.click('#btn-profile');
    await page.waitForFunction(() => window.__game.menuScreen() === 'avatar' && window.__game.lobbyWardrobe()?.k >= 1, null, { timeout: 90000 });
    await sleep(700);
    const lay = await page.evaluate(() => {
      const se = document.scrollingElement, panel = document.querySelector('#menu .menu-panel').getBoundingClientRect();
      const done = document.getElementById('btn-av-done').getBoundingClientRect();
      const hit = document.elementFromPoint(done.left + done.width / 2, done.top + done.height / 2);
      return { scroll: [se.scrollHeight, innerHeight, se.scrollWidth, innerWidth], panel: panel.toJSON(), done: done.toJSON(), doneHit: hit?.id || hit?.closest('button')?.id,
        blurred: document.getElementById('view').classList.contains('blurred'), you: window.__game.lobbyPlayer().screen, ed: window.__game.avatarEditor() };
    });
    check(lay.scroll[0] <= lay.scroll[1] && lay.scroll[2] <= lay.scroll[3], `${tag}: the page does not scroll (${lay.scroll.join(' ')})`);
    check(lay.panel.top >= 0 && lay.panel.bottom <= h && lay.done.bottom <= h && lay.doneHit === 'btn-av-done', `${tag}: the panel and Done are on screen (panel ${Math.round(lay.panel.top)}-${Math.round(lay.panel.bottom)})`);
    const [fx, fy] = lay.you.feet, [hx, hy] = lay.you.head;
    check(Math.min(fx, hx) > lay.panel.right + 20 && Math.max(fx, hx) < w - 20 && hy > 0 && fy < h, `${tag}: your avatar stands right of the panel, head to feet on screen (head ${hx.toFixed(0)},${hy.toFixed(0)} feet ${fx.toFixed(0)},${fy.toFixed(0)}; panel ends ${lay.panel.right.toFixed(0)})`);
    check(!lay.blurred, `${tag}: the lobby is sharp behind the wardrobe`);
    const order = lay.ed.rows.map(r => r.slot).join(',');
    check(order === 'body,base,skin,hair,eyes,glasses,main,accent', `${tag}: the rows in order (${order})`);
    const bodyRow = lay.ed.rows[0];
    check(bodyRow.label === 'Body' && await page.evaluate(() => [...document.querySelectorAll('#av-body button[data-slot="body"]')].map(b => b.textContent.trim()).join('/')) === 'Male/Female', `${tag}: the first choice is Male / Female`);
    if (shots) await page.screenshot({ path: `${shots}/wardrobe-${tag}.png` });
    if (w === 1180) {
      const marked = lay.ed.rows.flatMap(r => r.unlockable.map(id => `${r.slot}.${id}`));
      check(['hair.platinum', 'main.champagne', 'main.gatsby'].every(id => marked.includes(id)) && lay.ed.rows.every(r => !r.locked.length), `unlockable items marked and wearable for testing (${marked.join(', ')})`);
      const tapOpt = async (slot, id) => { await page.click(`#av-body button[data-slot="${slot}"][data-id="${id}"]`); await sleep(350); };
      await tapOpt('main', 'claret');
      check(await page.evaluate(() => window.__game.lobbyPlayer().avatar.colours.main) === 'claret', 'a new outfit colour shows on your avatar at once');
      await tapOpt('glasses', 'round');
      await page.waitForFunction(() => window.__game.lobbyPlayer()?.glasses, null, { timeout: 60000 }).catch(() => {});
      const rows = await page.evaluate(() => window.__game.avatarEditor().rows.map(r => r.slot).join(','));
      check(/glasses,frame,main/.test(rows) && await page.evaluate(() => window.__game.lobbyPlayer().glasses), `glasses on: Frame appears, the glasses show in the lobby (${rows})`);
      await tapOpt('body', 'f');
      await page.waitForFunction(() => ['clara', 'eleanor', 'beatrice'].includes(window.__game.lobbyPlayer()?.avatar?.face), null, { timeout: 60000 });
      const fem = await page.evaluate(() => ({ ed: window.__game.avatarEditor(), pl: window.__game.lobbyPlayer() }));
      check(fem.ed.rows[1].options.join(',') === 'clara,eleanor,beatrice' && fem.pl.avatar.colours.main === 'claret' && fem.pl.avatar.glasses === 'round', `Female: the three gowns; outfit and glasses kept, rebuilt in the lobby (${fem.pl.look})`);
      await tapOpt('base', 'eleanor');
      await page.waitForFunction(() => window.__game.lobbyPlayer()?.avatar?.face === 'eleanor', null, { timeout: 60000 });
      const gown = await page.evaluate(() => window.__game.avatarEditor().rows.map(r => r.slot).join(','));
      check(/main,metal$/.test(gown) && !/accent/.test(gown), `Ballgown: Jewellery, no Accent (${gown})`);
      await tapOpt('eyes', 'hazel');
      await sleep(1500);
      if (shots) await page.screenshot({ path: `${shots}/wardrobe-gown-${tag}.png` });
      await page.click('#btn-av-done');
      await page.waitForFunction(() => window.__game.menuScreen() === 'main', null, { timeout: 10000 });
      await sleep(400);
      const saved = await page.evaluate(() => window.__game.profile().avatar);
      check(saved.v === 2 && saved.face === 'eleanor' && saved.dress === 'ballgown' && saved.colours.main === 'claret' && saved.glasses === 'round' && saved.colours.eyes === 'hazel', `Done keeps your avatar in your profile (${JSON.stringify(saved)})`);
      check(await page.evaluate(() => document.getElementById('view').classList.contains('blurred')), 'back on the main menu, the lobby is soft again');
      await page.waitForFunction(() => window.__game.lobbyWardrobe()?.k === 0, null, { timeout: 60000 });
      await page.click('#btn-profile');
      await page.waitForFunction(() => window.__game.menuScreen() === 'avatar', null, { timeout: 10000 });
      await sleep(500);
      await page.click('#btn-av-rename');
      await page.waitForFunction(() => window.__game.menuScreen() === 'signup', null, { timeout: 10000 });
      check(await page.evaluate(() => document.getElementById('su-name').value) === 'tester', 'Change name opens the register, your name filled in');
      check(await page.evaluate(() => window.__game.lobbyWardrobe()?.want === 1 && !document.getElementById('view').classList.contains('blurred')),
        'and the wardrobe camera stays on your avatar, the lobby sharp (no flight out to the lobby and back)');
      await sleep(500);
      await page.click('#btn-su-suggest');      // (Cancel, in rename mode)
      await page.waitForFunction(() => window.__game.menuScreen() === 'avatar', null, { timeout: 10000 }).catch(() => {});
      const back = await page.evaluate(() => ({ screen: window.__game.menuScreen(), want: window.__game.lobbyWardrobe()?.want, av: window.__game.avatarEditor().avatar }));
      check(back.screen === 'avatar' && back.want === 1 && back.av.face === 'eleanor', `Cancel goes back to the wardrobe, its camera and your avatar (${back.screen}, ${back.av.face})`);
    }
    check(!messages.length, `${tag}: no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
}

if (!skip.has('lift')) {
  console.log('\n7. the lift');
  {
    const { browser, page, messages } = await menuPage(1180, 820);
    await sleep(600);
    await page.click('#btn-menu-practice');
    await page.waitForFunction(() => window.__game.lobbyBoarders(), null, { timeout: 20000 });
    check(JSON.stringify(await page.evaluate(() => window.__game.lobbyBoarders())) === '["you"]', 'practice: your avatar boards alone');
    await sleep(2600);
    if (shots) await page.screenshot({ path: `${shots}/lift-practice.png` });
    await page.waitForFunction(() => window.__game.phase() === 'game', null, { timeout: 60000 });
    check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
  {
    const { browser, page, messages } = await menuPage(1180, 820);
    await sleep(600);
    await page.click('#btn-menu-bots');
    await sleep(500);
    await page.click('#btn-bots-find');
    await page.waitForFunction(() => window.__game.lobbyBoarders(), null, { timeout: 60000 });
    // (the test profile is Victor's Look: Henry boards in Victor's place, so nobody beside you looks like you from
    // behind: src/data/wardrobe.js lookAlike)
    check(JSON.stringify(await page.evaluate(() => window.__game.lobbyBoarders())) === '["you","henry","clara"]', 'a match: you board first, with Clara and Henry (never Victor beside his own Look)');
    await sleep(3000);
    if (shots) await page.screenshot({ path: `${shots}/lift-match.png` });
    await page.waitForFunction(() => window.__game.phase() === 'game', null, { timeout: 60000 });
    check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
    await browser.close();
  }
}

if (!skip.has('games')) {
  console.log('\n8. four tables in a row');
  const { browser, page, messages } = await launch({ width: 1180, height: 820 });
  // (no ?seed=: Play again deals a new table each time, with new computer guests in new looks)
  await page.goto(`${base}?mode=bots&bots=5&timer=off&botpace=0.1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.settled() && !document.getElementById('btn-begin')?.disabled, null, { timeout: 240000 });
  await page.click('#btn-begin');
  const tables = [];
  let prevSeats = '';
  for (let t = 0; t < 4; t++) {
    // (a new table: the role screen of a new game, its seats not the last table's, every guest loaded)
    await page.waitForFunction(prev => { const g = window.__game; return g.isRunning() && !g.endOpen() && g.handoffKind() === 'role' && JSON.stringify(g.seats().map(s => s.name)) !== prev
      && g.characters.every(c => c.debug().loaded); }, prevSeats, { timeout: 180000 });
    prevSeats = await page.evaluate(() => JSON.stringify(window.__game.seats().map(s => s.name)));
    await page.waitForFunction(() => window.__game.portraits().pending() === 0, null, { timeout: 180000 }).catch(() => {});
    await sleep(1200);
    // (one plain frame of the game: the counts of the hotel's own frame, not a portrait's)
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
    tables.push(await page.evaluate(async () => {
      const W = await import('./src/data/wardrobe.js');
      const g = window.__game;
      const seats = g.seats();
      return {
        seats: seats.map(s => `${s.name}:${W.lookOf(s.avatar) || 'mix'}`),
        views: g.characterViewCount(),
        sameLooks: seats.every((s, i) => JSON.stringify(g.characters[i].debug().avatar) === JSON.stringify(s.avatar)),
        strip: [...document.querySelectorAll('#players-strip .mini-portrait img')].map(i => i.dataset.portrait || ''),
        info: g.renderInfo(), heap: Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6),
        cached: g.portraits().cached(),
      };
    }));
    const T = tables[t];
    check(T.views === T.seats.length && T.sameLooks, `table ${t + 1}: one view per seat, each in its seat's avatar (${T.seats.join(', ')})`);
    check(T.strip.length === T.seats.length && T.strip.every(Boolean), `table ${t + 1}: the strip shows each seat's own portrait`);
    if (t < 3) {
      await page.evaluate(() => window.__game.skipToEnd());
      await page.waitForFunction(() => window.__game.endOpen(), null, { timeout: 60000 });
      await page.waitForSelector('#btn-restart', { state: 'visible', timeout: 60000 });
      await sleep(600);
      await page.click('#btn-restart');
    }
  }
  const g0 = tables[0].info, gN = tables[3].info;
  console.log('   ', tables.map(T => `geo ${T.info.geometries} tex ${T.info.textures} prog ${T.info.programs} calls ${T.info.calls} heap ${T.heap} MB portraits ${T.cached}`).join(' | '));
  // (measured before pieces, the same four tables: textures 21-27, draw calls 129-213 at the role screen; with pieces
  // a guest is 2-3 draw calls, not 9-15. Geometry grows with the hotel's own room pieces, kept as new rooms are seen)
  check(Math.max(...tables.map(T => T.info.textures)) <= g0.textures + 20, `textures stay level over four tables (${tables.map(T => T.info.textures).join(', ')}): one bone texture per guest, let go with the view`);
  check(gN.geometries < 800, `geometry stays within bounds (${tables.map(T => T.info.geometries).join(', ')})`);
  check(gN.programs <= PROGRAM_BUDGET, `shader programs within the budget (${gN.programs})`);
  check(Math.max(...tables.map(T => T.info.calls)) < 200, `draw calls below what they were before pieces (${tables.map(T => T.info.calls).join(', ')}; < 200, was < 260)`);
  check(Math.max(...tables.map(T => T.heap)) < 160, `memory stays bounded (${tables.map(T => T.heap).join(', ')} MB)`);
  check(!messages.length, `no console errors${messages.length ? `: ${messages.slice(0, 4).join(' | ')}` : ''}`);
  await browser.close();
}

console.log(failures.length ? `\n${failures.length} FAILED` : '\nall avatar checks passed');
process.exit(failures.length ? 1 : 0);
