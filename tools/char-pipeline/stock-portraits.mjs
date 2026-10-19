// The six classic Looks' stock pictures (assets/portraits/<look>.jpg and <look>-possessed.jpg), drawn by the GAME's
// own portrait code (src/render/avatarPortrait.js) from the current pieces, so the picture that shows until a
// runtime portrait is ready (the guest strip, the meeting panel), and the soul cards' fallback, is exactly the portrait
// the game draws. 576 x 768, JPEG quality 0.9 (the shipped size).
//   node tools/char-pipeline/stock-portraits.mjs --port 9541            compare: each picture's mean difference (0-255)
//   node tools/char-pipeline/stock-portraits.mjs --port 9541 --write    rewrite the pair of every Look that differs
//        [--min 1.0]  the mean difference above which a Look is rewritten   [--only henry,clara]  only these Looks
//        [--out DIR]  also save every drawn picture and an old | new side-by-side PNG there
// Run it after any change to a classic Look's pieces or to the portrait code. (tools/char-pipeline/portrait.mjs drew
// them from the old whole-guest models: it is not used for the stock pictures any more.) It starts its own static
// server on that port (127.0.0.1, the repo root) and one headless browser (tests/smoke-lib.mjs), and stops both.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch } from '../../tests/smoke-lib.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const arg = (k, d = null) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const port = +arg('port', 9541), write = process.argv.includes('--write'), min = +arg('min', 1.0), out = arg('out');
const only = arg('only') ? arg('only').split(',') : null;
if (out) fs.mkdirSync(out, { recursive: true });

const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: REPO, stdio: 'ignore' });
const stop = () => { try { server.kill(); } catch { /* gone */ } };
process.on('exit', stop);
await new Promise(r => setTimeout(r, 900));
const { browser, page, messages } = await launch({ width: 640, height: 480 });
try {
  await page.goto(`http://127.0.0.1:${port}/?mode=practice&intro=off`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game?.portraits, null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    const W = await import('./src/data/wardrobe.js');
    const P = window.__game.portraits();
    const pixels = src => new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => { const c = document.createElement('canvas'); c.width = 576; c.height = 768; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0, 576, 768); res({ data: g.getImageData(0, 0, 576, 768).data, canvas: c }); };
      i.onerror = rej;
      i.src = src.startsWith('data:') ? src : `${src}?t=${Date.now()}`;
    });
    const res = {};
    for (const id of Object.keys(W.LOOKS)) for (const possessed of [false, true]) {
      const name = `${id}${possessed ? '-possessed' : ''}`;
      const canvas = await P.draw(W.LOOKS[id], { possessed, w: 576, h: 768 });
      const jpeg = canvas.toDataURL('image/jpeg', 0.9);
      const mine = (await pixels(jpeg)).data, ref = await pixels(`assets/portraits/${name}.jpg`);
      let sum = 0, big = 0;
      for (let i = 0; i < mine.length; i += 4) {
        const d = Math.abs(mine[i] - ref.data[i]) + Math.abs(mine[i + 1] - ref.data[i + 1]) + Math.abs(mine[i + 2] - ref.data[i + 2]);
        sum += d; if (d > 72) big++;
      }
      const side = document.createElement('canvas'); side.width = 1152; side.height = 768;
      const sg = side.getContext('2d'); sg.drawImage(ref.canvas, 0, 0); sg.drawImage(canvas, 576, 0);
      res[name] = { diff: +(sum / (576 * 768 * 3)).toFixed(2), bigPct: +(100 * big / (576 * 768)).toFixed(2), jpeg, side: side.toDataURL('image/png') };
    }
    return res;
  });
  const looks = [...new Set(Object.keys(r).map(k => k.replace('-possessed', '')))];
  const redo = looks.filter(id => (!only || only.includes(id)) && (r[id].diff > min || r[`${id}-possessed`].diff > min));
  for (const [k, v] of Object.entries(r)) {
    console.log(`${k.padEnd(20)} mean difference ${v.diff} of 255, ${v.bigPct} % of pixels clearly different${redo.includes(k.replace('-possessed', '')) ? '  -> differs' : ''}`);
    if (out) {
      fs.writeFileSync(path.join(out, `${k}.jpg`), Buffer.from(v.jpeg.split(',')[1], 'base64'));
      fs.writeFileSync(path.join(out, `side-${k}.png`), Buffer.from(v.side.split(',')[1], 'base64'));
    }
  }
  if (write) {
    for (const id of redo) for (const k of [id, `${id}-possessed`]) fs.writeFileSync(path.join(REPO, 'assets/portraits', `${k}.jpg`), Buffer.from(r[k].jpeg.split(',')[1], 'base64'));
    console.log(`wrote ${redo.length ? redo.map(id => `${id}.jpg and ${id}-possessed.jpg`).join(', ') : 'nothing (none differs)'}`);
  }
  const errs = messages.filter(m => !/GPU stall|ReadPixels/i.test(m));
  if (errs.length) console.log('page messages:\n  ' + errs.slice(0, 10).join('\n  '));
} finally {
  await browser.close(); stop();
}
process.exit(0);
