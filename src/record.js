// Your record: how your games ended, kept on this device only (localStorage). Like src/settings.js,
// every read and write is guarded, so a private window or blocked storage simply starts from nothing
// and keeps the count for this visit. src/main.js counts a game when its end screen shows (once per
// game: Play again does not count it twice); a match left early (Main menu before its end) is counted
// as left early, never as a win or a loss (owner's choice, 11 Oct 2026). Nothing here is a game rule,
// and nothing in src/game/ or src/bots/ reads it.
//
//   played / won / lost    every finished match with bots: did your side win? (alive or not)
//   clean / possessed      the same three, by the side you ended the match on
//   escaped                matches you got out of yourself, through the Fire Exit
//   left                   matches left early, before their end (not in played)
//   practiceEscapes        practice games finished (practice ends only at the Fire Exit)
//
// The store is injectable, like the account's (src/account/account.js): createRecord({ store }) takes
// anything with getItem(key) and setItem(key, text), the shape of localStorage, so the counting, "Left
// early" and a damaged save can be tested in Node (tests/record-check.mjs). The game uses `record`, made
// with the device's own localStorage, read at each call as before.
export const KEY = 'hotelEscape.record.v1';
const SIDES = ['clean', 'possessed'];
const TOTALS = ['played', 'won', 'lost'];

const empty = () => ({
  played: 0, won: 0, lost: 0,
  clean: { played: 0, won: 0, lost: 0 },
  possessed: { played: 0, won: 0, lost: 0 },
  escaped: 0, practiceEscapes: 0, left: 0,
});
// (a saved number that is missing or not a count reads as 0; a damaged one is held to a sane size)
const MAX = 1e6;
const count = v => (Number.isFinite(+v) && +v > 0 ? Math.min(MAX, Math.floor(+v)) : 0);

// The device's own storage. localStorage is looked up at each call: a page may have none (getItem then
// answers undefined), and in a private window an access may throw: both are handled by the guards below.
const deviceStore = {
  getItem: key => window.localStorage?.getItem(key),
  setItem: (key, text) => window.localStorage?.setItem(key, text),
};

export function createRecord({ store = deviceStore } = {}) {
  // The saved record, or null when storage cannot be read at all (then the copy in memory is kept).
  function read() {
    try {
      const raw = store.getItem(KEY);
      if (raw === undefined) return null;               // (no storage on this page)
      const saved = raw ? JSON.parse(raw) : null;
      const r = empty();
      if (saved && typeof saved === 'object') {
        for (const k of [...TOTALS, 'escaped', 'practiceEscapes', 'left']) r[k] = count(saved[k]);
        for (const side of SIDES) for (const k of TOTALS) r[side][k] = count(saved[side]?.[k]);
      }
      // (every match counted is won or lost: a damaged save can never show more wins than matches)
      for (const t of [r, r.clean, r.possessed]) t.played = t.won + t.lost;
      return r;
    } catch { return null; }
  }
  let saved = true;       // false once a write has failed: then the copy in memory is ahead of storage
  function write() {
    try { store.setItem(KEY, JSON.stringify(current)); saved = true; } catch { saved = false; /* storage blocked: kept for this visit */ }
  }

  let current = read() || empty();
  // (another tab of the game may have counted a game since: count on top of what is saved now — unless
  // storage refuses writes, when what it holds is older than this visit's count)
  function fresh() { if (saved) current = read() || current; }

  return {
    // A copy of the record (change it freely).
    get() { fresh(); return JSON.parse(JSON.stringify(current)); },
    // A finished match: `won` whether your side won, `possessed` the side you ended on, `escaped` whether
    // you got out yourself.
    countMatch({ won, possessed, escaped }) {
      fresh();
      const side = current[possessed ? 'possessed' : 'clean'];
      current.played++; side.played++;
      if (won) { current.won++; side.won++; } else { current.lost++; side.lost++; }
      if (escaped) current.escaped++;
      write();
    },
    // A match left early: the player went back to the main menu before it ended.
    countLeft() { fresh(); current.left++; write(); },
    // A practice game finished (the player reached the Fire Exit).
    countPractice() { fresh(); current.practiceEscapes++; write(); },
    // Everything back to nothing (the record screen asks first).
    reset() { current = empty(); write(); },
  };
}

export const record = createRecord();

// The share of matches won, as a whole percentage, or null before the first match.
export const winRate = r => (r.played > 0 ? Math.round((100 * r.won) / r.played) : null);
