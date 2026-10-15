// "A match is in progress" marker, kept on this device (localStorage). If Safari reloads or discards the tab in the
// middle of a match (the iPad is short of memory after another app), the match is gone and the game opens on the
// main menu with no word about it. This marker is how the next start notices: it is written when a real match
// begins and removed when the match ends, when the player leaves it for the main menu and when the problem card's
// Back to menu is used; if it is still there at the next start of the main menu, a match was cut short (a reload,
// a discarded tab, a closed tab): src/main.js counts it once as "Left early" (src/record.js), says so, and clears it.
//
// This only NOTICES; nothing of the match is saved, and nothing here resumes it (step 1 of the audit's compat-1; a
// resume would be thrown away by online play, where the server holds the match). The marker holds no game state, no
// role, no hand: only the time it was written. Every read and write is guarded, so blocked storage (a private window)
// simply never marks anything. A marker older than 6 hours is not a match cut short but an old leftover: it is
// ignored and removed. Direct links (?mode=…, which the tests use) never touch it: src/main.js does not call this
// for them.
const KEY = 'hotelEscape.matchInProgress.v1';
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export const matchMarker = {
  KEY,
  // A real match has begun (or a new one: Play again).
  set(now = Date.now()) {
    try { store()?.setItem(KEY, JSON.stringify({ v: 1, t: now })); } catch { /* storage blocked: nothing is marked */ }
  },
  // The match has ended, or was left.
  clear() {
    try { store()?.removeItem(KEY); } catch { /* storage blocked */ }
  },
  // At the start of the main menu: was a match cut short? True once, and the marker is gone either way (so it is
  // never counted twice, and a stale or damaged one does not linger).
  take(now = Date.now()) {
    let cut = false;
    try {
      const raw = store()?.getItem(KEY);
      if (raw == null) return false;
      let t = NaN;
      try { t = Number(JSON.parse(raw)?.t); } catch { /* damaged: ignored */ }
      // (a time in the future is as wrong as one long past: a clock changed, or not ours)
      cut = Number.isFinite(t) && t > 0 && now - t >= 0 && now - t <= MAX_AGE_MS;
    } catch { return false; }
    matchMarker.clear();
    return cut;
  },
};
