// The female "every piece mixes" sheets: close-ups of every combination on body 'f', through the shared review page
// (tools/char-pipeline/parts/review/review.html, the game's lights and rim shader).
//   node tools/char-pipeline/parts/female/grids.mjs --port 9531 --out <dir> [--parts <draft dir>] [--grid hair,back,earrings,belt,gown,walk]
//   hair      every hairstyle on every face (front three-quarter)       back      the same from behind
//   earrings  every pair of earrings on every face                       belt      every belt on every gown
//   gown      every gown on every face, full length                       walk      every gown at the stride extremes (legs, hems)
// It starts its own static server (python3 -m http.server <port> --bind 127.0.0.1, the repo root) and ONE headless
// browser, and stops both at the end.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, settle } from '../../../../tests/smoke-lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../../..');
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('port', 9531), out = path.resolve(arg('out', path.join(REPO, 'tools/char-pipeline/shots/parts-female')));
const partsDir = path.resolve(arg('parts', path.join(REPO, 'assets/characters/parts')));
const kinds = (arg('grid') || 'hair,back,earrings,belt,gown,walk').split(',').filter(Boolean);
fs.mkdirSync(out, { recursive: true });
const LOOKS = JSON.parse(execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(path.dirname(HERE))}); import tables, json; print(json.dumps(tables.LOOKS))`]).toString());
const FACES = ['clara', 'eleanor', 'beatrice'];
const worn = (look, over = {}) => { const L = LOOKS[look]; const w = {}; for (const s of ['face', 'hairStyle', 'makeup', 'dress', 'belt', 'feet']) w[s] = L[s]; w.extras = [...(L.extras || [])]; return { ...w, ...over }; };

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
    const ids = slot => [...new Set(Object.keys(man.parts).filter(k => k.startsWith(`f/${slot}_`)).map(k => k.slice(2).split('~')[0].slice(slot.length + 1)))];
    for (const kind of kinds) {
      const cells = []; let cols, area = 'head', ch = 330, cw = 300;
      if (kind === 'hair' || kind === 'back') {
        const hs = ids('hairStyle'); cols = hs.length;
        for (const f of FACES) for (const h of hs) cells.push({ label: `${h} on ${f}`, yaw: kind === 'back' ? 160 : 25, worn: worn(f, { hairStyle: h }) });
      } else if (kind === 'earrings') {
        const es = ids('extra'); cols = es.length;
        for (const f of FACES) for (const e of es) cells.push({ label: `${e} on ${f}`, yaw: 38, worn: worn(f, { extras: [e] }) });
      } else if (kind === 'belt') {
        const bs = ['none', ...ids('belt')]; cols = bs.length; area = 'torso'; ch = 360;
        for (const d of ids('dress')) { const f = Object.keys(LOOKS).find(k => LOOKS[k].dress === d);
          for (const b of bs) cells.push({ label: `${d} + ${b}`, yaw: 20, worn: worn(f, { belt: b }) }); }
      } else if (kind === 'gown') {
        const ds = ids('dress'); cols = ds.length; ch = 520;
        for (const f of FACES) for (const d of ds) cells.push({ label: `${d} on ${f}`, yaw: 20, worn: worn(f, { dress: d }), cam: [[0, 0.86, 7.2], [0, 0.84, 0], 15] });
      } else if (kind === 'walk') {
        cols = 4; ch = 420;
        for (const d of ids('dress')) { const f = Object.keys(LOOKS).find(k => LOOKS[k].dress === d);
          for (const [frac, yaw] of [[0.25, 90], [0.75, 90], [0.25, 150], [0.5, 30]])
            cells.push({ label: `${d}: Walk ${frac}, yaw ${yaw}`, yaw, clip: 'Walk', frac, worn: worn(f), cam: [[0, 0.6, 4.6], [0, 0.55, 0], 18] }); }
      } else throw new Error(`unknown grid ${kind}`);
      const r = await page.evaluate(o => window.review.grid(o), { parts: '/__parts', body: 'f', cells, cols, area, light: arg('light') || 'lobby', cw, ch });
      const file = path.join(out, `grid-${kind}.png`);
      fs.writeFileSync(file, Buffer.from(r.png.split(',')[1], 'base64'));
      console.log(`grid ${kind}: ${cells.length} cells -> ${file}${r.warnings.length ? ' (warnings: ' + [...new Set(r.warnings)].join('; ') + ')' : ''}`);
    }
    const errs = messages.filter(m => !/GPU stall|WebGL|swiftshader/i.test(m));
    if (errs.length) console.log('page messages:\n  ' + errs.slice(0, 20).join('\n  '));
  } finally {
    await browser.close(); stop();
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
