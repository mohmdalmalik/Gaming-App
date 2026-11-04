// The screen stays awake at a Co-op table (DESIGN §11.1): an iPad that dims and locks itself mid-match closes the
// page's connection, and the turns run out on the clock meanwhile. So while the waiting room or a Co-op match is on
// screen the page holds a Screen Wake Lock (iPadOS 16.4+ Safari, Chrome), asked for again whenever the page becomes
// visible (the browser lets it go when the page is hidden). A refusal (Low Power Mode, an old browser, no tap yet) is
// ignored: the game works the same, the screen just may dim. Single player never asks for it.
//
//   holdWakeLock(true)    hold it (again: nothing more happens)
//   holdWakeLock(false)   let it go
//   wakeLockState()       { wanted, held } (tests)
let wanted = false;
let sentinel = null;
let asking = null;
let listening = false;

function nav() { return globalThis.navigator; }
function doc() { return globalThis.document; }

async function ask() {
  const wl = nav()?.wakeLock;
  if (!wanted || !wl?.request || sentinel || asking) return;
  if (doc() && doc().visibilityState !== 'visible') return;
  asking = (async () => {
    try {
      const s = await wl.request('screen');
      if (!wanted) { try { await s.release(); } catch { /* gone already */ } return; }
      sentinel = s;
      s.addEventListener?.('release', () => { if (sentinel === s) sentinel = null; });
    } catch { /* refused: the screen may dim, nothing else changes */ }
  })();
  try { await asking; } finally { asking = null; }
}

function onVisible() { if (wanted && doc()?.visibilityState === 'visible') ask(); }

export function holdWakeLock(on) {
  wanted = !!on;
  if (wanted) {
    if (!listening && doc()?.addEventListener) { doc().addEventListener('visibilitychange', onVisible); listening = true; }
    ask();
    return;
  }
  const s = sentinel;
  sentinel = null;
  if (s) s.release?.().catch?.(() => {});
}

export function wakeLockState() { return { wanted, held: !!sentinel }; }
