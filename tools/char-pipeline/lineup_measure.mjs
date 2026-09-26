// Measure how each guest material actually renders IN THE GAME (the lobby lineup of lineup.mjs):
//   node tools/char-pipeline/lineup_measure.mjs <prefix> [--zoom 1.8] [--rot 0]
// Same setup as lineup.mjs (hot-seat, seed 4242, six guests in a row). Writes <prefix>-lit.png (HUD hidden) and
// <prefix>-id.png (every skinned-mesh material replaced by a flat, un-tone-mapped ID colour, same camera) plus
// <prefix>.json: for each model guest, each material's authored base colour and its ID colour. line_colours.py
// turns the pair into the median lit colour per material. Tooling only: nothing in the game changes.
import { chromium } from 'playwright-core';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const threeDir = path.join(REPO, 'tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i < 0 ? d : argv[i + 1]; };
const PREFIX = argv[0]; const ZOOM = +opt('zoom', 1.8), ROT = +opt('rot', 0);
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, hasTouch: true })).newPage();
await page.route(`${CDN}**`, r => { const rel = r.request().url().slice(CDN.length).split('?')[0]; const f = path.join(threeDir, rel); r.fulfill(fs.existsSync(f) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(f) } : { status: 404, body: 'x' }); });
await page.goto('http://127.0.0.1:8123/?mode=hotseat&players=6&seed=4242', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 60000 });
await page.click('#btn-begin');
for (let i = 0; i < 20; i++) {
  if (await page.evaluate(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) break;
  if (await page.evaluate(() => window.__game.handoffOpen())) await page.click('#btn-handoff-next');
  await page.waitForTimeout(150);
}
await page.waitForFunction(() => window.__game.dressingDone(), null, { timeout: 60000 });
await page.waitForTimeout(3000);
await page.evaluate(({ ROT }) => {
  const g = window.__game; g.rotate(ROT);
  g.movers.forEach((m, i) => { m.reset(-2.5 + i * 1.0, 1.2); });
  g.refresh(); g.rig.setFocus(0, 1.2, true);
  g.rig.setFocus = () => {};          // pin the camera (the game re-targets the active guest every frame)
}, { ROT });
await page.waitForTimeout(800);
await page.evaluate(z => window.__game.rig && window.__game.rig.zoomBy ? window.__game.rig.zoomBy(z) : null, ZOOM);
await page.waitForTimeout(2500);
await page.evaluate(() => { for (const id of ['hud']) { const e = document.getElementById(id); if (e) e.style.visibility = 'hidden'; } });
await page.waitForTimeout(300);
await page.screenshot({ path: `${PREFIX}-lit.png` });
await page.waitForTimeout(1000); await page.screenshot({ path: `${PREFIX}-lit2.png` });
// freeze animation so both shots share the same pose, then swap materials
const info = await page.evaluate(() => {
  const g = window.__game; const v = g.view;
  let scene = v.scene || Object.values(v).find(o => o && o.isScene);
  if (!scene) for (const k of Object.keys(v)) { const o = v[k]; if (o && o.isObject3D) { let p = o; while (p.parent) p = p.parent; if (p.isScene) { scene = p; break; } } }
  let Basic = null; scene.traverse(o => { if (!Basic && o.isMesh && o.material && o.material.isMeshBasicMaterial) Basic = o.material.constructor; });
  const out = []; let gi = 0; const x0 = [];
  scene.traverse(o => { if (o.isSkinnedMesh) x0.push(o); });
  x0.forEach(o => {
    const wp = o.parent.getWorldPosition(o.position.clone());
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const rec = { x: +wp.x.toFixed(2), mats: [] };
    const nm = mats.map((src, i) => {
      const id = [30 + gi * 7, 70 + i * 20, 200];
      rec.mats.push({ base: '#' + src.color.getHexString(), id });
      const b = new Basic({ fog: false }); b.toneMapped = false; b.side = src.side;
      b.color.setRGB(id[0] / 255, id[1] / 255, id[2] / 255, 'srgb');
      return b;
    });
    o.material = Array.isArray(o.material) ? nm : nm[0];
    out.push(rec); gi++;
  });
  return out;
});
await page.waitForTimeout(600);
await page.screenshot({ path: `${PREFIX}-id.png` });
fs.writeFileSync(`${PREFIX}.json`, JSON.stringify(info, null, 1));
console.log(JSON.stringify(info.map(r => ({ x: r.x, n: r.mats.length }))));
await browser.close();
