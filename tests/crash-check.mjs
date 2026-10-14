// The frame safety net (src/ui/crash.js), in plain Node with a fake clock and a fake window: no browser.
// Run: node tests/crash-check.mjs
//   - a step that throws is skipped, counted, written down, never rethrown; the steps after it still run
//   - the "Something went wrong" card (onGiveUp) only after REPEATED failure: the same step failing frame
//     after frame for long enough (a step of the picture sooner); never for a one-off, a short run, or a
//     step that fails every other frame; and only once
//   - the ring of the last messages: short, one line, the file and line of the game's own code, repeats
//     counted instead of pushing the others out
//   - the page's own errors: the same uncaught error again and again raises the card; one does not; the
//     browser's harmless notices and rejected promises never do
//   - main.js really runs the frame through it (a source check, so the net cannot quietly be taken out)
import fs from 'node:fs';
import { createCrashNet, messageOf, whereOf } from '../src/ui/crash.js';
import { VERSION, VERSION_DATE, versionLine } from '../src/version.js';

let failures = 0;
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures++; } };
const quiet = { error() {} };       // (the net writes failures to the console: not in this output)

function net(opts = {}) {
  const clock = { t: 0 };
  const shown = [];
  const n = createCrashNet({ now: () => clock.t, log: quiet, onGiveUp: info => shown.push(info), ...opts });
  return { n, clock, shown };
}
const boom = (msg = 'x.y is not a function') => { throw new TypeError(msg); };
// Run `frames` frames, `ms` apart, of one failing step (and optionally a healthy one beside it).
function failFor(h, name, frames, ms, healthy = null) {
  let ran = 0;
  for (let i = 0; i < frames; i++) {
    h.n.step(name, boom);
    if (healthy) h.n.step(healthy, () => { ran++; });
    h.clock.t += ms;
  }
  return ran;
}

console.log('a step that throws');
{
  const h = net();
  let after = 0;
  const r1 = h.n.step('fog', boom);
  h.n.step('tags', () => { after++; });
  check(r1 === false && after === 1, 'it returns false, never throws, and the next step still runs');
  check(h.n.step('fog', () => {}) === true, 'a step that works returns true');
  check(h.n.ring().length === 1 && h.n.ring()[0].step === 'fog' && /x\.y is not a function/.test(h.n.ring()[0].text), 'the failure is written down (step and message)');
  check(!h.n.shown && h.shown.length === 0, 'a single failure never raises the card');
  const args = []; h.n.step('args', (a, b) => args.push(a, b), 1, 2);
  check(args.join() === '1,2', 'a step can be given its arguments (no closure made every frame)');
}

console.log('\nthe card only after repeated failure');
{
  let h = net();
  failFor(h, 'fog', 44, 100);
  check(h.shown.length === 0, '44 frames in a row is not enough (45 and 3 s are needed)');
  failFor(h, 'fog', 1, 100);
  check(h.shown.length === 1, 'the 45th frame, over 3 s of failing, raises the card');
  failFor(h, 'fog', 200, 100);
  check(h.shown.length === 1 && h.n.shown, 'and only once, however long it goes on');
  check(/fog: TypeError: x\.y is not a function/.test(h.shown[0].detail) && h.shown[0].detail.includes(`${VERSION} · ${VERSION_DATE}`), `its small print holds the version and the last message ("${h.shown[0].detail}")`);

  h = net();
  failFor(h, 'fog', 500, 1);       // many frames, but all within half a second
  check(h.shown.length === 0, '500 frames in half a second: too short a time, no card');
  failFor(h, 'fog', 40, 100);
  check(h.shown.length === 1, '...and 3 s of it does');

  h = net();
  for (let i = 0; i < 400; i++) { h.n.step('fog', i % 2 ? () => {} : boom); h.clock.t += 100; }
  check(h.shown.length === 0, 'a step that fails every other frame never raises the card (its run is broken each time it works)');

  h = net();
  const ran = failFor(h, 'tags', 60, 100, 'render');
  check(ran === 60, 'a healthy step beside a failing one runs every frame (the picture is never stopped)');
  check(h.shown.length === 1, '...while the failing one brings up the card');

  h = net();
  failFor(h, 'render', 9, 200);
  check(h.shown.length === 0, 'the main picture: 9 frames are not enough');
  failFor(h, 'render', 1, 200);
  check(h.shown.length === 1, 'the main picture failing 10 frames in a row over 1 s raises the card sooner than a decoration');

  h = net();
  failFor(h, 'fog', 50, 100); h.n.reset();
  check(!h.n.shown, 'reset() (Back to menu) lets the card be shown again');
  failFor(h, 'fog', 60, 100);
  check(h.shown.length === 2, 'and the same failure then shows it a second time');

  h = net({ onGiveUp: () => { throw new Error('the card itself failed'); } });
  let threw = false;
  try { failFor(h, 'fog', 60, 100); } catch { threw = true; }
  check(!threw, 'a failure while showing the card is swallowed');

  h = net();
  h.n.limits.step = { frames: 3, ms: 100 };
  failFor(h, 'fog', 3, 60);
  check(h.shown.length === 1, 'the limits can be shortened (the browser test does)');
}

console.log('\nthe ring of messages');
{
  const h = net();
  for (let i = 0; i < 30; i++) h.n.step(`s${i}`, () => boom(`m${i}`));
  const ring = h.n.ring();
  check(ring.length === 10 && ring[0].text.endsWith('m20') && ring[9].text.endsWith('m29'), 'it keeps the last 10 messages, oldest out first');
  const h2 = net();
  h2.n.step('a', () => boom('first')); for (let i = 0; i < 50; i++) h2.n.step('b', () => boom('same'));
  check(h2.n.ring().length === 2 && h2.n.ring()[1].count === 50, 'the same message from the same step counts up (x50) instead of pushing the others out');
  h2.n.note('graphics', 'The graphics context was lost.');
  check(h2.n.ring().at(-1).step === 'graphics' && !h2.n.shown && h2.shown.length === 0, 'note() adds a line for the small print and never raises the card');

  check(messageOf(new TypeError('a\nb\nc')) === 'TypeError: a', 'one line only, with the kind of error');
  check(messageOf(new Error('plain')) === 'plain', 'a plain Error shows just its message');
  check(messageOf('a string') === 'a string' && messageOf(undefined) === 'undefined' && messageOf({ message: 'obj' }) === 'obj', 'any thrown value is handled');
  check(messageOf(new Error('x'.repeat(500))).length === 160, 'and it is cut to 160 characters');
  check(whereOf({ stack: 'TypeError: x\n    at update (https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js:100:5)\n    at Object.update (http://127.0.0.1:8500/src/render/fog.js:88:14)' }) === 'src/render/fog.js:88', 'the first of the game\'s own files in a Chrome stack');
  check(whereOf({ stack: 'update@https://user.github.io/Gaming-App/src/ui/tips.js:42:9\nframeLoop@https://user.github.io/Gaming-App/src/main.js:10:3' }) === 'src/ui/tips.js:42', 'and in a Safari stack');
  check(whereOf({}) === '' && whereOf(null) === '' && whereOf('x') === '', 'no stack: nothing');
}

console.log('\nlost and never back (the graphics context)');
{
  const h = net();
  h.n.note('graphics', 'The graphics context was lost.');
  check(h.shown.length === 0 && h.n.ring().length === 1, 'a loss is written down (note) and shows nothing');
  h.n.stuck('graphics', 'The graphics context was lost and did not come back.');
  check(h.shown.length === 1 && /graphics: The graphics context was lost and did not come back\./.test(h.shown[0].detail) && h.n.shown, 'stuck raises the card at once, with the line in the small print');
  h.n.stuck('graphics', 'again');
  check(h.shown.length === 1, '...and only once');
  h.n.reset();
  h.n.stuck('graphics', 'again');
  check(h.shown.length === 2, 'after Back to menu (reset) it can show again');
}

console.log('\nthe page\'s own errors');
{
  const mkWin = () => { const w = new EventTarget(); return w; };
  const errEvent = (message, extra = {}) => Object.assign(new Event('error'), { message, ...extra });
  const rejEvent = reason => Object.assign(new Event('unhandledrejection'), { reason });

  let h = net(), w = mkWin(); h.n.install(w);
  w.dispatchEvent(errEvent('Cannot read properties of undefined', { error: new TypeError('Cannot read properties of undefined') }));
  check(h.shown.length === 0 && h.n.ring().length === 1 && h.n.ring()[0].step === 'page', 'one uncaught error is written down and does nothing more');
  for (let i = 0; i < 6; i++) { h.clock.t += 400; w.dispatchEvent(errEvent('Cannot read properties of undefined', { error: new TypeError('Cannot read properties of undefined') })); }
  check(h.shown.length === 0, '7 of the same error within 5 s: not yet');
  h.clock.t += 400; w.dispatchEvent(errEvent('Cannot read properties of undefined', { error: new TypeError('Cannot read properties of undefined') }));
  check(h.shown.length === 1, 'the 8th within 5 s raises the card');

  h = net(); w = mkWin(); h.n.install(w);
  for (let i = 0; i < 40; i++) { h.clock.t += 1500; w.dispatchEvent(errEvent('Tap handler failed', { error: new Error('Tap handler failed') })); }
  check(h.shown.length === 0, 'the same error once every 1.5 s, for a minute, never has 8 inside 5 s: no card');

  h = net(); w = mkWin(); h.n.install(w);
  for (let i = 0; i < 50; i++) w.dispatchEvent(errEvent('ResizeObserver loop completed with undelivered notifications.'));
  for (let i = 0; i < 50; i++) w.dispatchEvent(errEvent('Script error.'));
  for (let i = 0; i < 50; i++) w.dispatchEvent(errEvent(''));
  check(h.shown.length === 0 && h.n.ring().length === 0, 'the browser\'s harmless notices (ResizeObserver loop, "Script error.", no message) are ignored');

  h = net(); w = mkWin(); h.n.install(w);
  for (let i = 0; i < 50; i++) w.dispatchEvent(rejEvent(new DOMException('The play() request was interrupted', 'AbortError')));
  w.dispatchEvent(rejEvent(undefined));
  check(h.shown.length === 0 && h.n.ring().some(e => e.step === 'promise'), 'rejected promises (benign ones happen on iPad Safari) are written down and never raise the card');

  h = net(); w = mkWin(); h.n.install(w);
  w.dispatchEvent(errEvent('thrown string', { filename: 'http://x/src/ui/hand.js', lineno: 12 }));
  check(h.n.ring()[0].where === 'src/ui/hand.js:12', 'an error with no stack names the file and line the event gave');
}

console.log('\nthe version');
{
  check(/^v\d+\.\d+$/.test(VERSION) && /^\d{1,2} [A-Z][a-z]{2} 20\d\d$/.test(VERSION_DATE), `src/version.js holds a label and a date (${VERSION}, ${VERSION_DATE})`);
  check(versionLine() === `Version ${VERSION} · ${VERSION_DATE}`, 'the Settings line reads "Version <label> · <date>"');
}

console.log('\nmain.js runs the frame through the net (source check)');
{
  const src = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  check(/setAnimationLoop\(now => crash\.step\('frame', frameLoop, now\)\)/.test(src), 'the animation loop is the net\'s own step (the last guard against anything not wrapped below)');
  check(/webglcontextlost[\s\S]{0,400}visibilityState === 'visible'[\s\S]{0,400}crash\.stuck\('graphics'/.test(src) && /webglcontextrestored[\s\S]{0,200}clearInterval\(graphicsWatch\)/.test(src), 'a graphics context lost and not back: main.js raises the card after a while with the page in view, and stops waiting when it comes back');
  check(/step\('render', \(\) => view\.render\(\)\)/.test(src) && /step\('render', \(\) => view\.renderer\.render\(lobby\.scene, lobby\.camera\)\)/.test(src), 'both pictures (the game and the menu\'s lobby) are drawn in a step of their own');
  const body = src.slice(src.indexOf('function frameLoop'), src.indexOf('function placeTags'));
  for (const name of ['fog', 'mood', 'cutaway', 'guests', 'hand', 'search icon', 'feed', 'chat', 'tips', 'sound', 'tags', 'camera', 'bots', 'clock']) {
    check(body.includes(`step('${name}'`), `the "${name}" part of a frame is a step of its own`);
  }
  check(!/^\s*(fog\.update|tips\.update|screenTags\.begin|view\.render)\(/m.test(body), 'no optional part of the frame is called outside a step');
  check(/step\('tags: names'/.test(src) && /finally \{ screenTags\.end\(\); \}/.test(src), 'the frame\'s tags are always closed, whatever one kind of tag does');
}

console.log('\nthe start-up script in index.html (source check)');
{
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const classic = [...html.matchAll(/<script>\n([\s\S]*?)\n\s*<\/script>/g)].map(m => m[1]);
  check(classic.length === 1, 'one classic (non-module) script, the start-up script');
  // Plain old JavaScript on purpose: it must run on a browser too old for the game (iPadOS 12-15 have no import
  // maps) to tell it so. Comments and string literals are taken out first; then no let/const/class/async, arrow
  // functions, template strings, ?. ?? or spread.
  const bare = (classic[0] || '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const modern = bare.match(/\b(let|const|class|async|await|yield|import|export)\b|=>|`|\?\.|\?\?|\.\.\./g);
  check(!modern, `it uses no modern syntax${modern ? ` (found: ${[...new Set(modern)].join(' ')})` : ''}`);
  const start = classic[0] || '';
  check(/HTMLScriptElement\.supports\('importmap'\)/.test(start) && /iPadOS 16\.4/.test(start), 'it asks the browser about import maps and says "iPadOS 16.4"');
  // The answer is a hint, never a gate: a Safari that wrongly said "no" would lock a working iPad out. The "needs
  // iPadOS 16.4" card is only for a game that then FAILS to load, and the module script never stops on the hint.
  const failedFn = start.slice(start.indexOf('function failed'));
  check(/boot\.noMaps\s*=\s*!/.test(start) && !/if\s*\(\s*boot\.noMaps\s*\)\s*\{?\s*(return|card)/.test(start.slice(0, start.indexOf('function failed'))), 'the browser\'s answer is only stored (boot.noMaps), not acted on before the game has been tried');
  check(/else if \(boot\.noMaps\)[\s\S]{0,120}boot\.unsupported = true[\s\S]{0,160}iPadOS 16\.4/.test(failedFn), 'the "needs iPadOS 16.4" card is chosen inside failed(): the game failed to load and the answer was "no"');
  check(!/unsupported/.test((html.match(/<script type="module">\n([\s\S]*?)\n\s*<\/script>/) || [])[1] || ''), 'the module script never skips the game on the browser\'s answer');
  check(/navigator\.onLine !== false && !marked\(\)/.test(failedFn), 'no automatic reload while the device is offline (it cannot help, and the browser\'s own error page would replace the game)');
  check(/STALL_MS = 30000/.test(start) && /id="boot-reload"[^>]*onclick="location\.reload\(\)"/.test(html) && /\$\('boot-reload'\)\.hidden/.test(start), 'a load that stalls for 30 s gets a plain-HTML Reload button on the loading screen');
  check(/screen\.orientation/.test(start) && /window\.orientation/.test(start) && /device-landscape/.test(start) && /html\.device-landscape \.rotate-wide/.test(fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8')), 'a window taller than wide on a device held sideways is asked to be wider (class device-landscape, read by styles.css)');
  check(/sessionStorage/.test(classic[0] || '') && /reload\(\)/.test(classic[0] || '') && /marked\(\)/.test(classic[0] || ''), 'it reloads at most once, guarded by a sessionStorage marker');
  check(!/setTimeout\(/.test(classic[0] || ''), 'and has no timer that guesses the connection is down');
  const mod = [...html.matchAll(/<script type="module">\n([\s\S]*?)\n\s*<\/script>/g)].map(m => m[1]);
  check(mod.length === 1 && /import\('\.\/src\/main\.js'\)/.test(mod[0]) && /__hotelBoot/.test(mod[0]), 'the module script only starts the game through the start-up script (relative path, for GitHub Pages)');
  check(!/setTimeout\(/.test(mod[0] || ''), 'with no 20-second alarm');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL CRASH-NET CHECKS PASSED');
process.exit(failures ? 1 : 0);
