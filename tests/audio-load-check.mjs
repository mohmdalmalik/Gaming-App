// How the sound files are downloaded (src/audio/index.js) — no browser, fast: node tests/audio-load-check.mjs
//
// The Web Audio API, the network and the clock are faked, so what is checked is the order and timing of the
// requests, exactly:
//   1. before the first tap only the menu's own music is fetched (iOS allows no sound before a tap; nothing
//      new is fetched before one); after it the effects follow
//   2. a download that fails is tried again after 3 s, then after 10 s (never sooner, never in a loop), the
//      sound arrives when the file does, and nothing waits for it
//   3. a file that failed every try is left alone for a minute, then asked for again the next time something
//      wants it; the scene's music that failed every try is asked for again by itself
//   4. a file that is really not there (404) is asked for once
//   5. the night music's download starts when the lift starts (a match being set up), only after the first tap;
//      the end fanfares are fetched ahead (round 7), once each, and playing one then asks the network for nothing
//   6. three effects failing in a row stop the preloading (the connection is down); the rest wait to be needed
import { createAudio, RETRY_PAUSES, COOL_OFF_MS } from '../src/audio/index.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

// --- a fake clock (setTimeout and performance.now) ---------------------------------------------------------------
let now = 0;
let timers = [];
let timerId = 0;
globalThis.setTimeout = (fn, ms = 0) => { const id = ++timerId; timers.push({ id, at: now + ms, fn }); return id; };
globalThis.clearTimeout = id => { timers = timers.filter(t => t.id !== id); };
Object.defineProperty(globalThis, 'performance', { value: { now: () => now }, configurable: true });
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setImmediate(r)); };
async function advance(ms) {
  const end = now + ms;
  await flush();
  for (;;) {
    const due = timers.filter(t => t.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
    if (!due) break;
    timers = timers.filter(t => t !== due);
    now = Math.max(now, due.at);
    due.fn();
    await flush();
  }
  now = end;
  await flush();
}

// --- a fake network ------------------------------------------------------------------------------------------------
const requests = [];           // { file, at }
let script = {};               // file -> list of outcomes to give in order: 'fail' (network error) | 500 | 404 | 'ok'; then ok
globalThis.fetch = async url => {
  const file = String(url).split('/').pop();
  requests.push({ file, at: now });
  const out = (script[file] || []).shift();
  if (out === 'fail') throw new TypeError('Failed to fetch');
  if (out === 500 || out === 404) return { ok: false, status: out };
  return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(16) };
};
const asked = file => requests.filter(r => r.file === file);
const askedAt = file => asked(file).map(r => r.at);

// --- a fake Web Audio ----------------------------------------------------------------------------------------------
class Param { constructor(v = 0) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
class Node {
  constructor() { this.gain = new Param(1); this.pan = new Param(0); this.playbackRate = new Param(1); this.threshold = new Param(); this.knee = new Param(); this.ratio = new Param(); this.attack = new Param(); this.release = new Param(); }
  connect() {} disconnect() {}
  start() { this.started = true; } stop() {}
}
class FakeContext {
  constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.destination = new Node(); }
  get currentTime() { return now / 1000; }
  createGain() { return new Node(); }
  createDynamicsCompressor() { return new Node(); }
  createBufferSource() { return new Node(); }
  createStereoPanner() { return new Node(); }
  createBuffer() { return {}; }
  resume() { this.state = 'running'; queueMicrotask(() => this.onstatechange?.()); return Promise.resolve(); }
  suspend() { this.state = 'suspended'; return Promise.resolve(); }
  decodeAudioData(data) { return Promise.resolve({ duration: 10, length: 480000, tag: 'decoded' }); }
}
function makeAudio({ music = 0.5 } = {}) {
  const handlers = {};
  const win = {
    AudioContext: FakeContext, navigator: { userActivation: { isActive: true } },
    addEventListener: (ev, fn) => { handlers[ev] = fn; },
  };
  const doc = { hidden: false, addEventListener() {} };
  const settings = { choice: name => ({ gain: name === 'music' ? music : 1 }) };
  const audio = createAudio({ settings, doc, win });
  return { audio, win, tap: () => handlers.pointerdown?.() };
}
const quiet = fn => { const w = console.warn; console.warn = () => {}; return fn().finally(() => { console.warn = w; }); };

// the pauses are long enough to be no loop at all
check(RETRY_PAUSES.length === 2 && RETRY_PAUSES[0] >= 2000 && RETRY_PAUSES[1] > RETRY_PAUSES[0] && COOL_OFF_MS >= 30000,
  `two retries, ${RETRY_PAUSES.join(' ms then ')} ms after the failures; a file that failed every try rests ${COOL_OFF_MS / 1000} s`);

// --- 1. before and after the first tap -------------------------------------------------------------------------------
console.log('before and after the first tap');
{
  const { audio, tap } = makeAudio();
  audio.setScene('menu');
  await advance(100);
  check(requests.length === 1 && requests[0].file === 'music-lobby.mp3', `before a tap only the menu's own music is fetched (${requests.map(r => r.file).join(', ')})`);
  audio.prefetch('game', { decode: false }); audio.prefetch('final'); audio.prefetchEnding();
  await advance(100);
  check(requests.length === 1, `...and asking for tracks ahead does nothing yet (${requests.length} request)`);
  tap();
  await advance(200);
  check(audio.state().unlocked && audio.state().playing.includes('lobby'), 'the first tap unlocks the sound and starts the waltz');
  check(asked('sfx-click.mp3').length === 1 && requests.length > 10, `after it the effects are fetched (${requests.length} requests)`);
  check(asked('music-lobby.mp3').length === 1, 'the waltz is not fetched twice');
  check(requests.every(r => /^(music|sfx)-/.test(r.file)), 'nothing but sound files');
}

// --- 2. a failed download is tried again after a pause -----------------------------------------------------------------
console.log('\na failed download is tried again');
await quiet(async () => {
  requests.length = 0; script = { 'music-game.mp3': ['fail'] };
  const { audio, tap } = makeAudio();
  audio.setScene('menu');
  tap(); await advance(300);
  audio.setScene('game');
  const t0 = now;
  await advance(100);
  check(asked('music-game.mp3').length === 1, 'the night music is asked for when the game starts');
  check(!audio.state().playing.includes('game'), '...it failed, so nothing plays yet (and the game goes on)');
  await advance(RETRY_PAUSES[0] - 500);
  check(asked('music-game.mp3').length === 1, `no second request before the pause is over (${now - t0} ms in)`);
  await advance(1000);
  check(asked('music-game.mp3').length === 2 && askedAt('music-game.mp3')[1] - askedAt('music-game.mp3')[0] >= RETRY_PAUSES[0], `asked again after ${askedAt('music-game.mp3')[1] - askedAt('music-game.mp3')[0]} ms`);
  await advance(500);
  check(audio.state().playing.includes('game'), 'the night music starts when the retry succeeds');
  check(audio.state().failed.length === 0, 'nothing is marked failed');
  audio.setScene('none');
  await advance(5000);

  // an effect: failing twice, then arriving
  requests.length = 0; script = { 'sfx-search.mp3': ['fail', 500] };
  const { audio: a2, win: w2, tap: tap2 } = makeAudio();
  a2.setScene('game'); tap2(); await advance(300);
  const bytesBefore = asked('sfx-search.mp3').length;
  check(bytesBefore <= 1, 'the effects preload begins');
  a2.play('search'); await advance(50);
  await advance(RETRY_PAUSES[0] + 200);
  const t = askedAt('sfx-search.mp3');
  check(t.length === 2 && t[1] - t[0] >= RETRY_PAUSES[0], `the effect's second try came after ${t[1] - t[0]} ms`);
  await advance(RETRY_PAUSES[1] + 200);
  const t3 = askedAt('sfx-search.mp3');
  check(t3.length === 3 && t3[2] - t3[1] >= RETRY_PAUSES[1], `...and the third after another ${t3[2] - t3[1]} ms`);
  check(a2.state().decoded.includes('sfx-search.mp3') && a2.state().failed.length === 0, 'the effect is ready after the retries');
  now += 1000; a2.play('search'); await advance(50);
  check((w2.__audioLog || []).some(l => l.name === 'search' && l.why === 'played'), 'and the next rummage is heard');
});

// --- 3. every try failed: a rest, then again -----------------------------------------------------------------------------------
console.log('\nevery try failed');
await quiet(async () => {
  requests.length = 0; script = { 'music-game.mp3': ['fail', 'fail', 'fail'] };
  const { audio, tap } = makeAudio();
  audio.setScene('menu'); tap(); await advance(300);
  audio.setScene('game');
  await advance(RETRY_PAUSES[0] + RETRY_PAUSES[1] + 500);
  const t = askedAt('music-game.mp3');
  check(t.length === 3 && t[1] - t[0] >= RETRY_PAUSES[0] && t[2] - t[1] >= RETRY_PAUSES[1], `three tries, ${t[1] - t[0]} and ${t[2] - t[1]} ms apart`);
  check(audio.state().failed.includes('music-game.mp3') && !audio.state().playing.includes('game'), 'it failed every try: no music for now');
  const n = asked('music-game.mp3').length;
  audio.applySettings(); await advance(5000);
  check(asked('music-game.mp3').length === n, 'asked again meanwhile? no: the file is left alone during its rest');
  // the scene's music is asked for again by itself once the rest is over
  await advance(COOL_OFF_MS + 2000);
  check(asked('music-game.mp3').length === n + 1 && audio.state().playing.includes('game'), 'once the rest is over the scene asks again by itself, and the music plays');
  check(audio.state().failed.length === 0, '(the failure is forgotten)');
  // the same, but only the first scene start: a later start asks again
  requests.length = 0; script = { 'music-final.mp3': ['fail', 'fail', 'fail'] };
  audio.setScene('final');
  await advance(RETRY_PAUSES[0] + RETRY_PAUSES[1] + 500);
  check(asked('music-final.mp3').length === 3, 'the final-round music fails every try too');
  audio.setScene('game'); await advance(100);
  audio.setScene('final'); await advance(100);
  check(asked('music-final.mp3').length === 3, '(still resting: a scene that starts again does not ask at once)');
  await advance(COOL_OFF_MS + 2000);
  check(audio.state().playing.includes('final'), 'after the rest it plays');
});

// --- 4. a file that is not there --------------------------------------------------------------------------------------------------
console.log('\na file that is not there');
await quiet(async () => {
  requests.length = 0; script = { 'music-game.mp3': [404] };
  const { audio, tap } = makeAudio();
  audio.setScene('menu'); tap(); await advance(300);
  audio.setScene('game');
  await advance(RETRY_PAUSES[0] + RETRY_PAUSES[1] + 1000);
  check(asked('music-game.mp3').length === 1, `a 404 is asked for once (${asked('music-game.mp3').length})`);
  await advance(10 * COOL_OFF_MS);
  audio.setScene('final'); audio.setScene('game'); await advance(1000);
  check(asked('music-game.mp3').length === 1, 'and never again');
  check(audio.state().failed.includes('music-game.mp3'), '(it is listed as failed)');
});

// --- 5. ahead of time -------------------------------------------------------------------------------------------------------------------
console.log('\nahead of time');
await quiet(async () => {
  requests.length = 0; script = {};
  const { audio, win, tap } = makeAudio();
  audio.setScene('menu'); tap(); await advance(2000);
  check(asked('music-game.mp3').length === 0, 'in the menu the night music is not fetched');
  audio.prefetch('game', { decode: false }); await advance(200);
  check(asked('music-game.mp3').length === 1 && !audio.state().decoded.includes('music-game.mp3'), 'asked ahead (matchmaking): downloaded, not decoded');
  audio.prefetch('game', { decode: false }); audio.setScene('intro'); await advance(200);
  check(asked('music-game.mp3').length === 1, 'the lift asks for nothing more (once)');
  audio.setScene('none'); audio.setScene('game'); await advance(500);
  check(asked('music-game.mp3').length === 1 && audio.state().playing.includes('game'), `the game then starts it from the bytes already here (still ${asked('music-game.mp3').length} request)`);
  // the lift alone (practice has no matchmaking): the download starts with the lift
  requests.length = 0;
  const b = makeAudio();
  b.audio.setScene('menu'); b.tap(); await advance(2000);
  b.audio.setScene('intro'); await advance(200);
  check(asked('music-game.mp3').length === 1, 'the lift starts the night music download by itself');
  // the end fanfares
  requests.length = 0;
  audio.prefetch('final'); audio.prefetchEnding(); audio.prefetchEnding(); await advance(500);
  const fan = ['music-win.mp3', 'music-winPossessed.mp3', 'music-lose.mp3', 'music-dawn.mp3'];
  check(fan.every(f => asked(f).length === 1), `the four fanfares are fetched ahead, once each (${fan.map(f => asked(f).length).join(' ')})`);
  check(!audio.state().decoded.some(f => fan.includes(f)), '...as bytes only: nothing decoded until the end');
  requests.length = 0;
  audio.setScene('end'); audio.stinger('win'); await advance(100);
  check(requests.length === 0, 'the fanfare at the end asks the network for nothing');
  check((win.__audioLog || []).some(l => l.name === 'win' && l.why === 'stinger') && audio.state().decoded.includes('music-win.mp3'), 'and plays');
  // music Off: nothing ahead
  requests.length = 0;
  const off = makeAudio({ music: 0 });
  off.audio.setScene('menu'); off.tap(); await advance(500);
  off.audio.prefetch('game', { decode: false }); off.audio.prefetchEnding(); await advance(500);
  check(!requests.some(r => /^music-/.test(r.file)), 'with the music Off no music is fetched ahead');
});

// --- 6. the connection is down -----------------------------------------------------------------------------------------------------------
console.log('\nthe connection is down');
await quiet(async () => {
  requests.length = 0;
  script = {};
  const effects = ['sfx-click.mp3', 'sfx-open.mp3', 'sfx-close.mp3', 'sfx-select.mp3', 'sfx-deny.mp3', 'sfx-joined.mp3', 'sfx-liftDing.mp3', 'sfx-liftDoors.mp3'];
  // every request fails
  const real = globalThis.fetch;
  globalThis.fetch = async url => { requests.push({ file: String(url).split('/').pop(), at: now }); throw new TypeError('Failed to fetch'); };
  const { audio, tap } = makeAudio();
  audio.setScene('menu'); tap(); await advance(RETRY_PAUSES[0] + RETRY_PAUSES[1] + 2000);
  const files = new Set(requests.map(r => r.file));
  check(files.size < 12, `the preload stops once a few effects have failed every try (${files.size} different files asked for, of about 40)`);
  const per = {}; for (const r of requests) per[r.file] = (per[r.file] || 0) + 1;
  check(Math.max(...Object.values(per)) <= 3, `no file asked for more than three times (${Math.max(...Object.values(per))})`);
  // no loop: a quiet minute asks for little
  const before = requests.length;
  await advance(30000);
  check(requests.length - before <= 4, `and nothing hammers the network meanwhile (${requests.length - before} requests in 30 s)`);
  globalThis.fetch = real;
});

console.log(failures ? `\n${failures} AUDIO LOAD CHECK(S) FAILED` : '\nALL AUDIO LOAD CHECKS PASSED');
process.exit(failures ? 1 : 0);
