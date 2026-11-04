// THE RECORDED MATCH (DESIGN §16.1): a contact sheet of the screenshots tests/browser-coop.mjs takes while several
// headless people play Co-op against the real server on this computer: the Co-op screens and the waiting room, joining,
// the start, a meeting seen from both sides, a server restart, a drop and return, the end and Play again, at the four
// iPad sizes. One HTML page the owner can look through without any setup.
//
//   flock <the browser lock> node tests/browser-coop.mjs            (takes the shots: tests/shots/coop/, git-ignored)
//   node tools/coop-record/make-sheet.mjs --out <folder> [--shots tests/shots/coop] [--inline]
//
// --out: where the page goes (<folder>/index.html, and the pictures beside it in <folder>/img/). With --inline the
// pictures are put inside the one HTML file instead (handy to open it alone; it is several megabytes). The page has no
// scripts and loads nothing from elsewhere. It reads tests/shots/coop/manifest.json (written by the suite: file,
// section, name, caption, who, size), so only the shots of the last run of each section are shown.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const here = path.dirname(new URL(import.meta.url).pathname);
const shotsDir = path.resolve(opt('--shots', path.join(here, '..', '..', 'tests', 'shots', 'coop')));
const outArg = opt('--out', null);
const inline = args.includes('--inline');
if (!outArg) { console.error('usage: node tools/coop-record/make-sheet.mjs --out <folder> [--shots DIR] [--inline]'); process.exit(2); }
const out = path.resolve(outArg);

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(shotsDir, 'manifest.json'), 'utf8')); } catch (e) {
  console.error(`no screenshots to show: ${path.join(shotsDir, 'manifest.json')} (${e.message}). Run tests/browser-coop.mjs first.`);
  process.exit(1);
}
manifest = manifest.filter(m => fs.existsSync(path.join(shotsDir, m.file)) && !/^error-/.test(m.name));

// What each part of the run shows, in plain words (the page is for the owner).
const SECTIONS = [
  ['room', 'Opening a table and joining it',
    'Six people, each on their own device, at one table on the real server: the host starts a table; a friend opens the invite link on a device that has never played (the register comes first); another types the code; the host locks the table, removes someone, and makes it a table of four; one more is turned away because it is full. The code field is checked with the on-screen keyboard up. Then the countdown, and everyone goes into the match with their own secret role.'],
  ['match', 'A whole match with three friends',
    'Three people play a whole match with three computer guests. One opens a door and walks in; another walks in on them and they trade. While both are choosing a card, the server is switched off hard and started again: the match comes back where it was. Then one friend loses the connection for 40 seconds, the server restarts politely, and the match goes on to the end screen and Play again.'],
  ['demo', 'The two-seat test table (?friends=demo)',
    'The review link on one screen: you and "sam" take turns with the Show sam\'s screen button, to the end of a match.'],
];
const SIZE_ORDER = ['1024x694', '1024x768', '1180x820', '1366x1024'];

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
let bytes = 0;
const src = m => {
  if (inline) { const b = fs.readFileSync(path.join(shotsDir, m.file)); bytes += b.length; return `data:image/jpeg;base64,${b.toString('base64')}`; }
  return `img/${encodeURIComponent(m.file)}`;
};

// one group per screen (its sizes side by side), in the order the run took them
function groups(list) {
  const byKey = new Map();
  for (const m of list) {
    const key = m.name.replace(/-(\d+x\d+)$/, '');
    if (!byKey.has(key)) byKey.set(key, { key, caption: m.caption.replace(/ \(\d+x\d+\)$/, ''), who: m.who, at: m.at, shots: [] });
    byKey.get(key).shots.push(m);
  }
  const gs = [...byKey.values()];
  for (const g of gs) g.shots.sort((a, b) => SIZE_ORDER.indexOf(a.size) - SIZE_ORDER.indexOf(b.size));
  return gs.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

let body = '';
let count = 0;
for (const [id, title, line] of SECTIONS) {
  const list = manifest.filter(m => m.section === id);
  if (!list.length) continue;
  body += `<section><h2>${esc(title)}</h2><p class="lede">${esc(line)}</p>`;
  for (const g of groups(list)) {
    body += `<div class="group"><h3>${esc(g.caption)}${g.who ? ` <span class="who">${esc(g.who)}'s screen</span>` : ''}</h3><div class="row">`;
    for (const m of g.shots) {
      count++;
      body += `<figure><a href="${src(m)}"><img loading="lazy" src="${src(m)}" alt="${esc(`${g.caption}, ${m.size}`)}"></a><figcaption>${esc(m.size)}</figcaption></figure>`;
    }
    body += '</div></div>';
  }
  body += '</section>';
}
const when = manifest.map(m => m.at).sort().at(-1) || '';
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Co-op Recorded Match</title>
<style>
:root { --bg: #f6f3ee; --panel: #ffffff; --ink: #1d1b19; --muted: #6b645c; --line: #e2dbd1; --accent: #9a6b1f; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #141210; --panel: #1f1c19; --ink: #f1ece4; --muted: #a59d92; --line: #36312b; --accent: #d9a54a; } }
:root[data-theme="dark"] { --bg: #141210; --panel: #1f1c19; --ink: #f1ece4; --muted: #a59d92; --line: #36312b; --accent: #d9a54a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1400px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 1.7rem; margin: 0 0 4px; }
.sub { color: var(--muted); margin: 0 0 24px; max-width: 70ch; }
section { margin: 0 0 40px; }
h2 { font-size: 1.3rem; margin: 32px 0 6px; color: var(--accent); }
.lede { color: var(--muted); max-width: 80ch; margin: 0 0 16px; }
.group { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; margin: 0 0 14px; }
h3 { font-size: 1rem; margin: 0 0 10px; }
.who { color: var(--muted); font-weight: 400; font-size: .9rem; margin-left: 6px; }
.row { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr)); gap: 12px; }
figure { margin: 0; }
img { display: block; width: 100%; height: auto; border-radius: 6px; border: 1px solid var(--line); background: #000; }
figcaption { color: var(--muted); font-size: .85rem; margin-top: 4px; }
</style></head>
<body><main>
<h1>Co-op: the recorded match</h1>
<p class="sub">Headless players on this computer, each on their own pretend iPad, playing Co-op against the real game server. Nothing here is hosted yet. ${count} screenshots${when ? `, taken ${esc(when.slice(0, 16).replace('T', ' '))} UTC` : ''}. Tap a picture to see it full size.</p>
${body}
</main></body></html>
`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
if (!inline) {
  fs.mkdirSync(path.join(out, 'img'), { recursive: true });
  for (const m of manifest) { fs.copyFileSync(path.join(shotsDir, m.file), path.join(out, 'img', m.file)); bytes += fs.statSync(path.join(shotsDir, m.file)).size; }
}
console.log(`contact sheet: ${path.join(out, 'index.html')} (${count} screenshots, ${(bytes / 1048576).toFixed(1)} MB of pictures${inline ? ', inside the page' : ' in img/'})`);
