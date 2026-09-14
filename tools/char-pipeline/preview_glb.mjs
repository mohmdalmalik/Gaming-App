// Render any GLB through preview_glb.html (game-like lighting + Lambert conversion).
//
//   node tools/char-pipeline/preview_glb.mjs --glb assets/characters/victor.glb --out tools/char-pipeline/shots/v2 \
//        [--views front,tq,side,back,game,gamescale,turn] [--clip Idle] [--t 0] [--w 700 --h 760]
//
// 'turn' renders four game-angle views with the model yawed 0/90/180/270 (what the four camera
// rotations show). Prints the loader's info (clips, tris, bbox, materials) once.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const GLB = path.resolve(REPO, String(opt('glb', 'assets/characters/victor.glb')));
const OUT = String(opt('out', path.join(HERE, 'shots', 'preview')));
const VIEWS = String(opt('views', 'front,tq,game,turn')).split(',');
const CLIP = String(opt('clip', 'Idle')); const T = String(opt('t', '0'));
const W = +opt('w', 700), H = +opt('h', 760);
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await context.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await context.route('**/__glb', r => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(GLB) }));
let printed = false; const errs = [];
async function shot(name, view, yaw = 0) {
  const page = await context.newPage();
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
  await page.goto(`http://127.0.0.1:8123/tools/char-pipeline/preview_glb.html?glb=/__glb&view=${view}&clip=${CLIP}&t=${T}&yaw=${yaw}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__info, null, { timeout: 20000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}-${name}.png` });
  if (!printed) { printed = true; console.log(JSON.stringify(await page.evaluate(() => window.__info))); }
  await page.close();
}
for (const v of VIEWS) {
  if (v === 'turn') { for (let i = 0; i < 4; i++) await shot(`turn${i}`, 'game', i * 90); }
  else if (v.includes('@')) { const [name, yaw] = v.split('@'); await shot(`${name}-${yaw}`, name, +yaw); }   // e.g. body@35
  else await shot(v, v);
}
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
