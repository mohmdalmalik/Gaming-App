// The review sheet and the red-eye visibility test for parts (contract 9.2 and 9.3).
//   node tools/char-pipeline/parts/review.mjs --body m --item hairStyle_swept --port 9521 --out <scratch dir>
//        -> <out>/<item>.png (2400 x 1600: studio, lobby and game-camera rows, the footer) and <out>/<item>.json
//   --item a,b,c | --item all      several items, or every piece of the body
//   --parts <dir>                  a draft folder (with <body>/ and manifest.json) instead of assets/characters/parts
//   --no-sheet / --no-redeye       skip one of the two
//   --mirror victor|marcus|henry   the mirror test: the classic man from pieces next to today's shipped model
//   --record                       write the red-eye minimum into the piece's scene extras (assets only; then run
//                                  manifest.py so it reaches the manifest)
// It starts its own static server (python3 -m http.server <port> --bind 127.0.0.1, the repo root) and ONE headless
// browser (tests/smoke-lib.mjs), and stops both at the end. The poke-through test is poke.py (it runs without a
// browser); its result, when present in <out>/<item>.poke.json, goes in the sheet's footer.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, settle } from '../../../tests/smoke-lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(`--${k}`);
const body = arg('body', 'm'), port = +arg('port', 9521), out = path.resolve(arg('out', path.join(REPO, 'tools/char-pipeline/shots/parts-review')));
const partsDir = path.resolve(arg('parts', path.join(REPO, 'assets/characters/parts')));
fs.mkdirSync(out, { recursive: true });

const LOOKS = JSON.parse(execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(HERE)}); import tables, json; print(json.dumps(tables.LOOKS))`]).toString());
const SHIPPED_EYE = { victor: [0, 1.3723, 0.2407], marcus: [0, 1.364, 0.149], henry: [0, 1.33, 0.184], clara: [0.057, 1.348, 0.171], eleanor: [0.0565, 1.386, 0.178], beatrice: [0.0649, 1.381, 0.152] };
const SLOTS = ['face', 'hairStyle', 'facial', 'makeup', 'top', 'neck', 'legs', 'dress', 'belt', 'feet'];
const AREA = { face: 'head', hairStyle: 'head', facial: 'head', makeup: 'head', top: 'torso', neck: 'torso', dress: 'torso', belt: 'torso', legs: 'legs', feet: 'legs' };
const ATTACH_AREA = { ears: 'head', neck: 'torso', chest: 'torso', waist: 'torso', hands: 'hands' };
const split = key => { const [main, fit] = key.split('~'); const i = main.indexOf('_'); return { slot: main.slice(0, i), id: main.slice(i + 1), fit: fit || null }; };

function lookFor(key) {
  const { slot, id, fit } = split(key), g = body[0];
  if (fit && fit.startsWith('face_')) return fit.slice(5);
  // a PLAIN hair or moustache file is the one fitted to the body's default face: review it on that face's Look (on
  // another classic face the game draws that face's variant instead)
  if (!fit && ['hairStyle', 'facial', 'makeup'].includes(slot)) return g === 'm' ? 'victor' : 'clara';
  if (slot === 'face' && LOOKS[id]) return id;
  for (const [name, L] of Object.entries(LOOKS)) if (L.gender === g && L[slot] === id) return name;
  if (fit) { const f = split(fit); for (const [name, L] of Object.entries(LOOKS)) if (L.gender === g && L[f.slot] === f.id) return name; }
  return g === 'm' ? 'victor' : 'clara';
}
function wornFor(look, key) {
  const L = LOOKS[look], worn = {};
  for (const s of SLOTS) if (L[s] !== undefined) worn[s] = L[s];
  worn.extras = [...(L.extras || [])];
  if (key) {
    const { slot, id, fit } = split(key);
    if (slot === 'extra') worn.extras = [id]; else worn[slot] = id;
    if (fit) { const f = split(fit); worn[f.slot] = f.id; }
  }
  return worn;
}

async function main() {
  const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
  const stop = () => { try { server.kill(); } catch { /* gone */ } };
  process.on('exit', stop);
  await new Promise(r => setTimeout(r, 900));
  const { browser, page, messages } = await launch({ width: 1200, height: 900, profile: false });
  try {
    await page.route(`http://127.0.0.1:${port}/__parts/**`, route => {
      const rel = decodeURIComponent(new URL(route.request().url()).pathname.slice('/__parts/'.length));
      const file = path.join(partsDir, rel);
      if (!file.startsWith(partsDir) || !fs.existsSync(file)) return route.fulfill({ status: 404, body: 'missing' });
      route.fulfill({ status: 200, contentType: file.endsWith('.json') ? 'application/json' : 'model/gltf-binary', body: fs.readFileSync(file) });
    });
    await page.goto(`http://127.0.0.1:${port}/tools/char-pipeline/parts/review/review.html`);
    if (!await settle(page, () => window.__ready === true, null, 60000)) throw new Error('the review page did not start: ' + messages.join(' | '));
    const man = JSON.parse(fs.readFileSync(path.join(partsDir, 'manifest.json'), 'utf8'));
    const all = Object.keys(man.parts).filter(k => k.startsWith(body + '/')).map(k => k.slice(body.length + 1));
    const parts = '/__parts';
    if (arg('mirror')) {
      for (const look of arg('mirror').split(',')) {
        const worn = wornFor(look, null), glasses = LOOKS[look].glasses === 'round';
        const footer = [`Mirror test · ${look} from pieces (top row) vs today's shipped assets/characters/${look}.glb (middle row) · difference x4 (bottom row)`,
                        `game camera at true size (1180 x 820, dpr 2, shown x3), lobby light, walking, red eyes`];
        const r = await page.evaluate(o => window.review.mirror(o), { parts, body, worn, glasses, shipped: `/assets/characters/${look}.glb`, shippedEye: SHIPPED_EYE[look], footer });
        fs.writeFileSync(path.join(out, `mirror-${look}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
        fs.writeFileSync(path.join(out, `mirror-${look}.json`), JSON.stringify({ look, keys: r.keys, stats: r.stats }, null, 1));
        console.log(`mirror ${look}: ${r.keys.join(', ')}`); for (const s of r.stats) console.log(`  ${s.view}: mean ${s.meanDiff}, ${s.pctOver24} % over 24`);
      }
    }
    // --grid hair|facial|neck: the "every piece mixes" sheets (close-ups of every combination on this body)
    for (const kind of (arg('grid') || '').split(',').filter(Boolean)) {
      const ids = slot => [...new Set(all.filter(k => split(k).slot === slot).map(k => split(k).id))];
      const faces = ids('face'), cells = []; let cols, area = 'head', light = arg('light') || 'lobby';
      if (kind === 'hair') { const hs = ids('hairStyle'); cols = hs.length;
        for (const f of faces) for (const h of hs) cells.push({ label: `${h} on ${f}`, worn: { ...wornFor(f in LOOKS ? f : lookFor(`face_${f}`), null), face: f, hairStyle: h, facial: 'none' } }); }
      else if (kind === 'facial') { const fs = ['none', ...ids('facial')]; cols = fs.length;
        for (const f of faces) for (const x of fs) cells.push({ label: `${x} on ${f}`, yaw: 12, worn: { ...wornFor(f in LOOKS ? f : lookFor(`face_${f}`), null), face: f, facial: x } }); }
      else if (kind === 'neck') { const ns = ['none', ...ids('neck')]; cols = ns.length; area = 'torso';
        for (const t of ids('top')) for (const n of ns) cells.push({ label: `${t} + ${n}`, yaw: 20, worn: { ...wornFor('victor', null), top: t, neck: n } }); }
      else if (kind === 'walk') { cols = 4; area = 'legs';        // the legs through the walk (shoes under trouser hems)
        for (const [yaw, nm] of [[150, 'back three-quarter'], [90, 'side']]) for (const frac of [0, 0.25, 0.5, 0.75])
          cells.push({ label: `Walk ${frac}, ${nm}`, yaw, clip: 'Walk', frac, worn: wornFor('victor', null) });
        area = 'feet'; if (arg('shipped')) for (const frac of [0, 0.25, 0.5, 0.75]) cells.push({ label: `today's victor, Walk ${frac}`, yaw: 150, clip: 'Walk', frac, shipped: '/assets/characters/victor.glb' }); }
      else if (kind === 'heel') { cols = 4;       // the trailing heel at toe-off, from his right and from behind (poke.py's points)
        for (const [frac, x] of [[0, -0.11], [0.5, 0.11]]) for (const [nm, from] of [['side', [x * 9, 0.22, -0.19]], ['behind', [x, 0.25, -1.1]]]) {
          for (const shipped of [null, '/assets/characters/victor.glb'])
            cells.push({ label: `${shipped ? 'today' : 'pieces'}: Walk ${frac}, ${nm}`, yaw: 0, clip: 'Walk', frac, shipped, worn: wornFor('victor', null), cam: [from, [x, 0.14, -0.17], 16] });
        } }
      else throw new Error(`unknown grid ${kind}`);
      const yaw = arg('yaw') != null ? +arg('yaw') : null;
      if (yaw != null) for (const c of cells) c.yaw = yaw;
      const r = await page.evaluate(o => window.review.grid(o), { parts, body, cells, cols, area, light, cw: 300, ch: area === 'torso' ? 360 : 330 });
      const file = path.join(out, `grid-${kind}${light === 'lobby' ? '' : '-' + light}${yaw != null ? '-yaw' + yaw : ''}.png`);
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
      console.log(`grid ${kind}: ${cells.length} cells -> ${file}${r.warnings.length ? ' (warnings: ' + [...new Set(r.warnings)].join('; ') + ')' : ''}`);
    }
    const want = arg('item') === 'all' ? all : (arg('item') || '').split(',').filter(Boolean);
    for (const key of want) {
      if (key !== 'body' && !all.includes(key)) { console.log(`SKIP ${key}: not in ${partsDir}/manifest.json`); continue; }
      const look = lookFor(key), worn = wornFor(look, key === 'body' ? null : key), { slot } = split(key);
      const ent = man.parts[`${body}/${key}`] || {};
      const glasses = LOOKS[look].glasses === 'round';
      const keys = await page.evaluate(o => import('./assemble-dev.js').then(m => window.fetch(o.parts + '/manifest.json').then(r => r.json()).then(mm => m.resolveKeys(mm, o.body, o.worn))), { parts, body, worn });
      const result = { key, look, keys, tris: ent.tris, verts: ent.verts, bytes: ent.bytes, patches: ent.patches };
      // ---- red-eye: the guest WITH the piece vs the reference (body + face + the same top / dress)
      if (!flag('no-redeye') && !['legs', 'feet', 'belt'].includes(slot) && key !== 'body') {
        const faceKey = keys.find(k => k.startsWith('face_')), topKey = keys.find(k => k.startsWith('top_') || k.startsWith('dress_'));
        let withKeys, withoutKeys, hideFace = false, omitWithout = null;
        // a face: the same guest without the face's brows and frames is the reference (they are what could cover the
        // eyes from the game camera above; the head hiding its own far eye in profile is not an item hiding them).
        // Glasses are their own item (Henry's built-in frames show only with 'Round'): tested as glasses, not here
        if (slot === 'face') { withKeys = [faceKey, topKey]; withoutKeys = [faceKey, topKey]; omitWithout = ['Brow', 'Glasses']; }
        else if (slot === 'top' || slot === 'dress') { withKeys = [faceKey, key]; withoutKeys = [faceKey]; }
        else { withKeys = [faceKey, topKey, keys.find(k => split(k).slot === slot && split(k).id === split(key).id) || key]; withoutKeys = [faceKey, topKey]; }
        const r = await page.evaluate(o => window.review.redeye(o), { parts, body, withKeys: withKeys.filter(Boolean), withoutKeys: withoutKeys.filter(Boolean), hideFace, omitWithout, glasses: slot === 'face' ? false : glasses });
        result.redEye = r;
        fs.writeFileSync(path.join(out, `${key}.redeye.json`), JSON.stringify({ key, withKeys, withoutKeys, omitWithout, ...r }, null, 1));
        console.log(`red-eye ${key}: facing min ${r.min} over ${r.scored} views -> ${r.pass ? 'PASS' : 'FAIL'}; strict min ${r.strict.min} over ${r.strict.scored} -> ${r.strict.pass ? 'PASS' : 'FAIL'}`);
        if (flag('record') && partsDir === path.join(REPO, 'assets/characters/parts')) {
          execFileSync('python3', [path.join(HERE, 'record.py'), path.join(partsDir, body, `${key}.glb`), 'redEyeMin', String(r.min)]);
        }
      }
      // ---- the sheet
      if (!flag('no-sheet')) {
        const pokeFile = path.join(out, `${key}.poke.json`);
        const poke = fs.existsSync(pokeFile) ? JSON.parse(fs.readFileSync(pokeFile, 'utf8')) : null;
        const mats = Object.entries(ent.materials || {}).map(([k, v]) => `${k}=${v}`).join(', ');
        const pt = Object.entries(ent.patches || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';
        const footer = [
          `body ${body} · item ${key} · worn on the ${look} Look · ${ent.tris ?? '-'} tris · ${ent.verts ?? '-'} verts · ${ent.bytes ?? '-'} bytes · materials: ${mats}`,
          `shadow patches cast (verts): ${pt}`,
          `red-eye minimum: ${result.redEye ? `${result.redEye.min} over ${result.redEye.scored} face-on views (${result.redEye.pass ? 'PASS' : 'FAIL'}), strict ${result.redEye.strict.min} over ${result.redEye.strict.scored} (${result.redEye.strict.pass ? 'PASS' : 'FAIL'})` : 'not tested (legs / feet / belt)'} · poke-through: ${poke ? `${poke.pokes} pokes over ${poke.poses.length} poses, ${poke.pairs.length} pairs (${poke.pass ? 'PASS' : 'FAIL'})` : 'not run'}`,
        ];
        const area = slot === 'extra' ? (ATTACH_AREA[ent.attach] || 'torso') : (AREA[slot] || 'head');
        const r = await page.evaluate(o => window.review.sheet(o), { parts, body, worn, keys, glasses, area, footer, lookName: look,
          shipped: LOOKS[look] ? `/assets/characters/${look}.glb` : null, shippedEye: SHIPPED_EYE[look] });
        fs.writeFileSync(path.join(out, `${key}.png`), Buffer.from(r.png.split(',')[1], 'base64'));
        result.sheet = path.join(out, `${key}.png`); result.warnings = r.warnings;
        if (r.warnings.length) console.log(`  warnings: ${r.warnings.join('; ')}`);
        console.log(`sheet ${key}: ${result.sheet}`);
      }
      fs.writeFileSync(path.join(out, `${key}.json`), JSON.stringify(result, null, 1));
    }
    const errs = messages.filter(m => !/GPU stall|WebGL|swiftshader/i.test(m));
    if (errs.length) console.log('page messages:\n  ' + errs.slice(0, 20).join('\n  '));
  } finally {
    await browser.close(); stop();
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
