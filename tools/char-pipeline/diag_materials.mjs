// Diagnostic: the REAL game page with Victor's materials replaced by UNLIT contrasting colours
// (hair magenta, skin green, everything else grey), captured from the actual game camera at the
// four rotations (+ crops), optionally with all faces double-sided. Also prints the loaded model's
// mesh/material list. Temporary tooling — it changes nothing in the game code or the asset.
//   node tools/char-pipeline/diag_materials.mjs --out tools/char-pipeline/shots/diag [--double] [--zoom 1.8]
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three'); const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); if (i < 0) return d; const v = argv[i + 1]; return v === undefined || v.startsWith('--') ? true : v; };
const OUT = String(opt('out', path.join(HERE, 'shots', 'diag'))); const DOUBLE = !!opt('double', false); const ZOOM = +opt('zoom', 1);
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push(String(e)));
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
const loaded = [];
page.on('response', r => { if (r.url().includes('.glb')) loaded.push(`${r.url()} status=${r.status()} bytes=${r.headers()['content-length'] || '?'}`); });
await page.goto('http://127.0.0.1:8123/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 20000 });
await page.evaluate(() => { window.__game.activePlayer().possessed = false; window.__game.refresh(); });
await page.tap('#btn-begin'); await page.waitForTimeout(1600);
if (ZOOM !== 1) { await page.evaluate(z => window.__game.rig.zoomBy(z), ZOOM); await page.waitForTimeout(400); }
await page.evaluate(() => { document.getElementById('hud').style.visibility = 'hidden'; });
// find the scene, then Victor's skinned meshes (the only SkinnedMesh objects in the room)
const info = await page.evaluate((DOUBLE) => {
  const g = window.__game; const v = g.view;
  let scene = v.scene || v._scene || Object.values(v).find(o => o && o.isScene);
  if (!scene) { for (const k of Object.keys(v)) { const o = v[k]; if (o && o.isObject3D) { let p = o; while (p.parent) p = p.parent; if (p.isScene) { scene = p; break; } } } }
  const out = { sceneFound: !!scene, meshes: [] };
  if (!scene) return out;
  scene.traverse(o => {
    if (!o.isSkinnedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g2 = o.geometry; const tris = (g2.index ? g2.index.count : g2.attributes.position.count) / 3;
    const hasN = !!g2.attributes.normal;
    out.meshes.push({ name: o.name, material: mats.map(m => m.name).join(','), tris, hasNormals: hasN, side: mats[0].side, type: mats[0].type, color: '#' + mats[0].color.getHexString() });
    for (let i = 0; i < mats.length; i++) {
      const src = mats[i]; const hex = src.color.getHexString();
      // the game's conversion drops material names: identify parts by their authored colour
      const col = hex === '382920' || hex === '2a1d14' || hex === '241811' ? 0xff00ff : hex === 'eebe95' ? 0x00c000 : 0x808080;
      const unlit = new src.constructor({ color: 0x000000, emissive: col, side: DOUBLE ? 2 : src.side });
      unlit.name = src.name + '-diag';
      if (Array.isArray(o.material)) o.material[i] = unlit; else o.material = unlit;
    }
  });
  return out;
}, DOUBLE);
console.log('glb responses:', JSON.stringify(loaded));
console.log('model:', JSON.stringify(info));
async function cropBox(scale = 1) {
  const p = await page.evaluate(() => { const m = window.__game.activeMover(); const r = window.__game.groundToScreen(m.x, m.z); return Array.isArray(r) ? { x: r[0], y: r[1] } : { x: r.x, y: r.y }; });
  const w = 260 * scale, h = 340 * scale; return { x: Math.max(0, p.x - w / 2), y: Math.max(0, p.y - h * 0.78), width: w, height: h };
}
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}-r${i}-crop.png`, clip: await cropBox(ZOOM) });
  if (i < 3) { await page.evaluate(() => window.__game.rotate(1)); await page.waitForTimeout(700); }
}
console.log('errors:', errs.length ? errs.join(' | ') : 'none');
await browser.close();
