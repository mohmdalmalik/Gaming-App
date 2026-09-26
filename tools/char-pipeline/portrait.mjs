// Render a guest's interface portrait FROM THE MODEL (same lighting + Lambert conversion as the game)
// and produce the two files the interface uses:
//   node tools/char-pipeline/portrait.mjs [name]          (default: victor)
//   assets/portraits/<name>.jpg            normal (public + private)
//   assets/portraits/<name>-possessed.jpg  private possessed look (altered eye + cold wash)
// The eye centres come from the GLB's armature extras (`eyeCentre`: [x, y, z] in glTF space, written
// by the guest builder); Victor's older build falls back to the constants below.
// The raw render is written to shots/portrait-raw.png; post-processing (crop, wash, weird eye) is
// done by portrait_post.py with the projected eye positions this script prints.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const NAME = process.argv[2] || 'victor';
const GLB = path.join(REPO, `assets/characters/${NAME}.glb`);
// eyeCentre from the GLB's JSON chunk (node extras), if the builder wrote it
function glbEyes(file) {
  const b = fs.readFileSync(file); const len = b.readUInt32LE(12); const j = JSON.parse(b.subarray(20, 20 + len).toString());
  for (const n of j.nodes || []) if (n.extras && Array.isArray(n.extras.eyeCentre)) return n.extras.eyeCentre;
  return null;
}
const OUT = path.join(HERE, 'shots'); fs.mkdirSync(OUT, { recursive: true });

// Eye centres in glTF space (Y up, face toward +Z). From make_victor.py CFG: eye_x = ±0.071,
// z_eye = zp(17.3) = 1.373, face plane 0.233 in front of the skull axis (+0.004 lift). eye_x = ±0.074 since pass 8.
const EC = glbEyes(GLB);
const EYE_X = EC ? Math.abs(EC[0]) : 0.074, EYE_Y = EC ? EC[1] : 1.373, EYE_Z = EC ? EC[2] : 0.237;
const YAW = 14;   // a touch of 3/4 turn (degrees) — the target HUD portrait is not dead-on
const points = [[-EYE_X, EYE_Y, EYE_Z], [EYE_X, EYE_Y, EYE_Z]].map(p => p.join(',')).join(';');

const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
await context.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await context.route('**/__glb', r => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(GLB) }));
const page = await context.newPage();
const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
await page.goto(`http://127.0.0.1:8123/tools/char-pipeline/preview_glb.html?glb=/__glb&view=portrait&clip=Idle&t=0.4&yaw=${YAW}&points=${encodeURIComponent(points)}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__info, null, { timeout: 20000 });
await page.waitForTimeout(300);
const raw = path.join(OUT, `portrait-raw-${NAME}.png`);
await page.screenshot({ path: raw });
const info = await page.evaluate(() => window.__info);
await browser.close();
console.log('eyes (css px):', JSON.stringify(info.points), 'errors:', errs.length ? errs.join(' | ') : 'none');
// post-process -> the two portrait files (device px = css px * 2)
const eyes = info.points.map(p => [p.x * 2, p.y * 2]);
execFileSync('python3', [path.join(HERE, 'portrait_post.py'), raw, JSON.stringify(eyes), path.join(REPO, 'assets/portraits'), NAME], { stdio: 'inherit' });
