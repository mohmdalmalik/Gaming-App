// The safety net for a frame that goes wrong. Until this existed, ONE line of the per-frame code that
// threw (on some iPad nobody has tried) stopped the rest of that frame, every frame: the 3D picture froze
// while the buttons stayed alive, with no message and no way out. Now:
//   - every step of a frame runs through step(name, fn): a step that throws is skipped for that frame and
//     everything after it still runs, above all the main picture (the 'render' step), so a failing
//     decoration (tags, tips, chat bubbles, portraits, eyes, marks, effects...) can never freeze the hotel;
//   - the last few messages are kept in memory (a short ring buffer, RING entries: the same message from the
//     same step in a row counts up instead of pushing the others out);
//   - the "Something went wrong" card (onGiveUp) is shown only after REPEATED failure: the same step failing
//     frame after frame for a few seconds (a step of the picture the sooner), or the same uncaught error again
//     and again on the page. A single failure, or a short run of them, is only logged, never shown;
//   - the page's own 'error' and 'unhandledrejection' events are kept in the ring too. A rejected promise
//     alone never raises the card (benign ones happen on iPad Safari: audio resume, image decode), and neither
//     do the browser's own harmless notices (ResizeObserver loop).
// No timer ever "unsticks" a meeting or a turn: a slow player's private choice may legitimately take long.
// Nothing here touches the game; it only watches. Messages are cut to one short line, with the file and
// line of the first src/ frame, and show only on the player's own screen (they hold no game data).
//
//   const crash = createCrashNet({ onGiveUp: ({ detail }) => overlays.showError(..., { detail }) });
//   crash.install(window);                    // the page's own errors
//   crash.step('fog', () => fog.update(...));  // false if it threw
//   crash.note('graphics', 'The graphics context was lost.');   // a line for the small print, never a card
//   crash.stuck('graphics', 'Lost and did not come back.');     // the card at once (nothing will fix it)
//   crash.reset();                            // after Back to menu: the counts start again
import { VERSION, VERSION_DATE } from '../version.js';

const RING = 10;
// How long one step must keep failing, in frames in a row and in time, before the card: a step of the
// picture's own ('render') sooner than a decoration.
const LIMITS = { step: { frames: 45, ms: 3000 }, render: { frames: 10, ms: 1000 } };
const PAGE = { count: 8, ms: 5000 };        // the same uncaught error this many times within this long
const LOG_EVERY_MS = 2000;                  // a failing step is written to the console at most this often
const BENIGN = /ResizeObserver loop|^Script error\.?$/i;

// One short line: "TypeError: x is not a function" (never a stack, never longer than 160 characters).
export function messageOf(err) {
  const text = err && typeof err === 'object' && 'message' in err
    ? `${err.name && err.name !== 'Error' ? `${err.name}: ` : ''}${err.message}`
    : String(err);
  return text.split('\n')[0].slice(0, 160);
}
// "src/render/fog.js:88": the first of the game's own files in the stack (Chrome and Safari write it differently).
export function whereOf(err) {
  const m = /(src\/[\w./-]+\.js):(\d+)/.exec((err && typeof err === 'object' && err.stack) || '');
  return m ? `${m[1]}:${m[2]}` : '';
}

export function createCrashNet({ onGiveUp = null, now = () => performance.now(), log = console } = {}) {
  const ring = [];                         // { step, text, where, count, at }, oldest first
  const streaks = new Map();               // step -> { n: frames in a row failing, since, logAt }
  const recent = new Map();                // an uncaught page error's message -> when it happened lately
  const limits = { step: { ...LIMITS.step }, render: { ...LIMITS.render } };   // (a test may shorten them)
  let shown = false;

  function record(step, err) {
    const text = messageOf(err), t = now(), last = ring[ring.length - 1];
    if (last && last.step === step && last.text === text) { last.count++; last.at = t; return; }
    ring.push({ step, text, where: whereOf(err), count: 1, at: t });
    if (ring.length > RING) ring.shift();
  }

  // The small print of the card: the version, then the last message (for a screenshot).
  function detail() {
    const e = ring[ring.length - 1];
    const bits = [`${VERSION} · ${VERSION_DATE}`];
    if (e) bits.push(`${e.step}: ${e.text}${e.where ? ` (${e.where})` : ''}${e.count > 1 ? ` ×${e.count}` : ''}`);
    return bits.join(' · ');
  }

  function giveUp() {
    if (shown) return;
    shown = true;
    try { log.error?.('Something went wrong:', detail()); } catch { /* no console */ }
    try { onGiveUp?.({ detail: detail(), ring: ring.map(e => ({ ...e })) }); } catch (err) { try { log.error?.('the problem card failed:', err); } catch { /* nothing more to do */ } }
  }

  function fail(name, err) {
    const t = now();
    record(name, err);
    let s = streaks.get(name);
    if (!s) streaks.set(name, s = { n: 0, since: t, logAt: -Infinity });
    if (!s.n) s.since = t;
    s.n++;
    if (t - s.logAt >= LOG_EVERY_MS) { s.logAt = t; try { log.error?.(`[${name}]`, err); } catch { /* no console */ } }
    const lim = name === 'render' ? limits.render : limits.step;
    if (s.n >= lim.frames && t - s.since >= lim.ms) giveUp();
  }

  return {
    limits,
    // Run one step of a frame: false if it threw (counted, logged, never rethrown). `a`, `b`: its arguments
    // (so a step that is a plain function needs no closure made every frame).
    step(name, fn, a, b) {
      try { fn(a, b); } catch (err) { fail(name, err); return false; }
      const s = streaks.get(name);
      if (s && s.n) s.n = 0;
      return true;
    },
    // Count a failure that happened somewhere else (as step() does when a step throws).
    fail,
    // A line for the small print that is not a failure (the graphics context was lost and came back).
    note(step, text) { record(step, String(text)); },
    // The picture cannot go on and nothing is bringing it back (the graphics context lost, and still lost
    // after a while): the card at once, with this line in its small print.
    stuck(step, text) { record(step, String(text)); giveUp(); },
    install(win) {
      win.addEventListener('error', e => {
        const text = (e && (e.message || e.error?.message)) || '';
        if (!text || BENIGN.test(text)) return;
        // (a thrown value that is not an Error has no stack: the event's own file and line stand in)
        const err = e.error instanceof Error ? e.error : { message: text, stack: `${e.filename || ''}:${e.lineno || 0}` };
        record('page', err);
        const t = now(), key = messageOf(err);
        const times = (recent.get(key) || []).filter(x => t - x < PAGE.ms);
        times.push(t);
        if (recent.size > 40) recent.clear();
        recent.set(key, times);
        if (times.length >= PAGE.count) giveUp();
      });
      // (only kept: a rejected promise on its own is never a reason to stop the game)
      win.addEventListener('unhandledrejection', e => record('promise', e && e.reason !== undefined ? e.reason : 'A promise was rejected'));
    },
    // After "Back to menu": the counts start again (the messages stay for the small print).
    reset() { shown = false; streaks.clear(); recent.clear(); },
    detail,
    ring: () => ring.map(e => ({ ...e })),
    get shown() { return shown; },
  };
}
