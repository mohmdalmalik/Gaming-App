// The wardrobe's tile pictures: one small WebP per piece and body, drawn by the game's own code (thumbs.html).
//   node tools/char-pipeline/parts/thumbs.mjs [--port 9635] [--body m,f] [--only hairStyle_swept,top_tux] [--out <dir>]
// -> assets/characters/parts/thumbs/<body>/<slot>_<id>.webp (240 x 200; about 5-15 kB each) and <body>/body.webp
//    (the Man / Woman choice), and src/data/thumbsIndex.js (GENERATED: every picture on disk with a short hash of its
//    bytes, so a new picture is fetched fresh; the wardrobe shows its placeholder tile for any piece not listed).
// Every piece the catalogue offers on a built body (src/data/wardrobe.js itemsFor: pending pieces are left out) gets a
// picture; run it again after new pieces reach the parts index (manifest.py) and only those change. --only redraws
// the named ones; the index is always rebuilt from what is on disk. Pictures of pieces no longer offered are kept
// (a retired item's tile may still show for a saved look) unless --prune.
// It starts its own static server (python3 -m http.server <port> --bind 127.0.0.1, the repo root) and ONE headless
// browser (tests/smoke-lib.mjs), and stops both at the end.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { launch, settle } from '../../../tests/smoke-lib.mjs';
import { PART_INDEX } from '../../../src/data/partsIndex.js';
import { itemsFor } from '../../../src/data/wardrobe.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = path.resolve(HERE, '../../..');
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('port', 9635);
const OUT = path.resolve(arg('out', path.join(REPO, 'assets/characters/parts/thumbs')));
// (the game's index only for the game's own folder; a trial elsewhere gets its own copy beside its pictures)
const INDEX = arg('out') ? path.join(OUT, 'thumbsIndex.js') : path.join(REPO, 'src/data/thumbsIndex.js');
const only = arg('only') ? new Set(arg('only').split(',')) : null;
const bodies = (arg('body') ? arg('body').split(',') : PART_INDEX.bodies || []).filter(b => (PART_INDEX.bodies || []).includes(b));
const SLOTS = ['face', 'hairStyle', 'facial', 'makeup', 'glasses', 'top', 'neck', 'legs', 'dress', 'belt', 'feet', 'extra'];
const W = 240, H = 200;

// What to draw: every piece offered on each built body (the slot's items; 'none' too: the clean-shaven face, no
// glasses, no belt), and the body itself.
const jobs = [];
for (const body of bodies) {
  jobs.push({ body, slot: 'body', id: 'body', file: 'body' });
  for (const slot of SLOTS) for (const it of itemsFor(slot, body)) jobs.push({ body, slot, id: it.id, file: `${slot}_${it.id}` });
}
const todo = jobs.filter(j => !only || only.has(j.file) || only.has(`${j.body}/${j.file}`));

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);
await new Promise(r => setTimeout(r, 900));
const { browser, page, messages } = await launch({ width: 800, height: 600, profile: false });
let failed = 0;
try {
  await page.goto(`http://127.0.0.1:${port}/tools/char-pipeline/parts/thumbs.html`);
  if (!await settle(page, () => window.__ready === true, null, 60000)) throw new Error('the thumbnail page did not start: ' + messages.join(' | '));
  for (const j of todo) {
    const r = await page.evaluate(o => window.thumbs.render(o), { body: j.body, slot: j.slot, id: j.id, w: W, h: H });
    if (!r.ok) { failed++; console.log(`FAIL ${j.body}/${j.file}: ${r.error}`); continue; }
    const buf = Buffer.from(r.dataUrl.split(',')[1], 'base64');
    if (!/^RIFF....WEBP/s.test(buf.subarray(0, 12).toString('latin1'))) { failed++; console.log(`FAIL ${j.body}/${j.file}: not a WebP`); continue; }
    fs.mkdirSync(path.join(OUT, j.body), { recursive: true });
    fs.writeFileSync(path.join(OUT, j.body, `${j.file}.webp`), buf);
    console.log(`${j.body}/${j.file}.webp ${(buf.length / 1024).toFixed(1)} kB`);
  }
  if (process.argv.includes('--prune')) {
    const want = new Set(jobs.map(j => `${j.body}/${j.file}.webp`));
    for (const b of fs.existsSync(OUT) ? fs.readdirSync(OUT) : []) for (const f of fs.readdirSync(path.join(OUT, b))) if (f.endsWith('.webp') && !want.has(`${b}/${f}`)) { fs.unlinkSync(path.join(OUT, b, f)); console.log(`pruned ${b}/${f}`); }
  }
} finally {
  await browser.close();
  stop();
}
// the index: every picture on disk, with a short hash of its bytes (the page asks for ?v=<hash>)
const index = {};
if (fs.existsSync(OUT)) {
  for (const b of fs.readdirSync(OUT).sort()) {
    const dir = path.join(OUT, b);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).sort()) if (f.endsWith('.webp')) index[`${b}/${f.slice(0, -5)}`] = crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex').slice(0, 8);
  }
}
const lines = Object.entries(index).map(([k, v]) => `  '${k}': '${v}',`);
const text = `// src/data/thumbsIndex.js: GENERATED by tools/char-pipeline/parts/thumbs.mjs (the wardrobe's tile pictures in
// assets/characters/parts/thumbs/). Never edit. A key with no picture yet shows the screen's placeholder tile.
export const THUMBS = {
${lines.join('\n')}
};
`;
const tmp = `${INDEX}.tmp`;
fs.writeFileSync(tmp, text);
fs.renameSync(tmp, INDEX);
const bytes = Object.keys(index).reduce((s, k) => s + fs.statSync(path.join(OUT, `${k}.webp`)).size, 0);
console.log(`\n${todo.length - failed} drawn, ${failed} failed; ${Object.keys(index).length} pictures in the index, ${(bytes / 1024).toFixed(0)} kB in all`);
if (messages.length) console.log(messages.slice(0, 10).join('\n'));
process.exit(failed ? 1 : 0);
