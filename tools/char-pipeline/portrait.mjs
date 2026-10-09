// Render a guest's interface portraits FROM THE MODEL (same lighting + Lambert conversion as the game).
//
//   node tools/char-pipeline/portrait.mjs [names...|all] [--normal]
//     names     victor marcus henry eleanor clara beatrice (default: victor; `all` = the six)
//     (default) writes ONLY assets/portraits/<name>-possessed.jpg — the private possessed portrait
//     --normal  also rewrites assets/portraits/<name>.jpg — the normal portrait (public strip + own
//               panel). Leave it off unless the model itself changed: the normal files are approved art.
//   Needs the static server on :8123 serving the repo root (see README); PORTRAIT_URL overrides it.
//
// Two renders per guest, same camera, pose and frame:
//   normal     the charcoal-navy plate (shots/portrait-raw-<name>.png)
//   possessed  the possessed look from the game's own module (src/render/possessedLook.js: both eyes a
//              deep blood-red iris with a white catchlight; nothing else changes) on a transparent
//              backdrop (shots/portrait-raw-<name>-possessed.png)
// portrait_post.py crops BOTH with the crop measured on the normal render (so the two files line up
// pixel for pixel apart from the eyes and the backdrop) and lays the possessed one on the private
// plum-crimson plate. It also writes shots/portrait-check-<name>.jpg (the normal crop, for checking
// the line-up against the committed normal file) without touching assets/ unless --normal is given.
// The eye centres come from the GLB's armature extras (`eyeCentre`: [x, y, z] in glTF space, written
// by the guest builder); Victor's older build falls back to the constants below.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const SERVER = process.env.PORTRAIT_URL || 'http://127.0.0.1:8123';
const ALL = ['victor', 'marcus', 'henry', 'eleanor', 'clara', 'beatrice'];
const args = process.argv.slice(2);
const WRITE_NORMAL = args.includes('--normal');
let NAMES = args.filter(a => !a.startsWith('--'));
if (!NAMES.length) NAMES = ['victor'];
if (NAMES.includes('all')) NAMES = ALL;

// eyeCentre from the GLB's JSON chunk (node extras), if the builder wrote it
function glbEyes(file) {
  const b = fs.readFileSync(file); const len = b.readUInt32LE(12); const j = JSON.parse(b.subarray(20, 20 + len).toString());
  for (const n of j.nodes || []) if (n.extras && Array.isArray(n.extras.eyeCentre)) return n.extras.eyeCentre;
  return null;
}
const OUT = path.join(HERE, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const YAW = 14;   // a touch of 3/4 turn (degrees) — the target HUD portrait is not dead-on

const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
let failed = false;
for (const NAME of NAMES) {
  const GLB = path.join(REPO, `assets/characters/${NAME}.glb`);
  // Eye centres in glTF space (Y up, face toward +Z). From make_victor.py CFG: eye_x = ±0.071,
  // z_eye = zp(17.3) = 1.373, face plane 0.233 in front of the skull axis (+0.004 lift). eye_x = ±0.074 since pass 8.
  const EC = glbEyes(GLB);
  const EYE_X = EC && Math.abs(EC[0]) > 0.02 ? Math.abs(EC[0]) : 0.072,   // eyeCentre may be the midpoint between the eyes (x = 0)
        EYE_Y = EC ? EC[1] : 1.373, EYE_Z = EC ? EC[2] : 0.237;
  const points = [[-EYE_X, EYE_Y, EYE_Z], [EYE_X, EYE_Y, EYE_Z]].map(p => p.join(',')).join(';');

  const context = await browser.newContext({ viewport: { width: 600, height: 800 }, deviceScaleFactor: 2 });
  await context.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
  await context.route('**/__glb', r => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(GLB) }));
  const errs = [];
  async function render(extra, file, omitBackground) {
    const page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
    await page.goto(`${SERVER}/tools/char-pipeline/preview_glb.html?glb=/__glb&view=portrait&clip=Idle&t=0.4&yaw=${YAW}&points=${encodeURIComponent(points)}${extra}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__info, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: file, omitBackground });
    const info = await page.evaluate(() => window.__info);
    await page.close();
    if (!info.ok) throw new Error(`${NAME}: ${info.error}`);
    return info;
  }
  const rawN = path.join(OUT, `portrait-raw-${NAME}.png`);
  const rawP = path.join(OUT, `portrait-raw-${NAME}-possessed.png`);
  const infoN = await render('', rawN, false);
  const infoP = await render('&possessed=1&bg=none', rawP, true);
  await context.close();
  // The two renders must be the same frame (same pose, same projected eyes) and the red eyes must be on.
  const same = infoN.points.length === 2 && infoN.points.every((p, i) => p.x === infoP.points[i].x && p.y === infoP.points[i].y);
  const eyesOn = !!(infoP.possessedEyes && infoP.possessedEyes.available && infoP.possessedEyes.on);
  console.log(`${NAME}: eyes (css px) ${JSON.stringify(infoN.points)} same frame: ${same}, red eyes: ${eyesOn}, errors: ${errs.length ? errs.join(' | ') : 'none'}`);
  if (!same || !eyesOn || errs.length) { failed = true; console.error(`${NAME}: SKIPPED (renders differ, no Eye material, or page errors)`); continue; }
  // post-process -> the portrait file(s) (device px = css px * 2)
  const eyes = infoN.points.map(p => [p.x * 2, p.y * 2]);
  execFileSync('python3', [path.join(HERE, 'portrait_post.py'), rawN, rawP, JSON.stringify(eyes), path.join(REPO, 'assets/portraits'), NAME, OUT]
    .concat(WRITE_NORMAL ? ['--normal'] : []), { stdio: 'inherit' });
}
await browser.close();
if (failed) process.exit(1);
