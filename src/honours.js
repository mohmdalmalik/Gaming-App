// Your achievements ("Hotel Honours"), kept on this device (localStorage, key 'hotelEscape.honours.v1') like Your
// record (src/record.js) until there is a server; every read and write is guarded, so a private window or blocked
// storage simply keeps them for this visit. Checked ONLY on the end screen of a finished match (src/main.js showEnd,
// once per game), from that match's summary (src/matchSummary.js): nothing is checked, shown or saved during a match.
// Progress only goes up; the record's reset never touches it. Nothing in src/game/ or src/bots/ reads it.
//
//   saved   { v: 1, counters: { goodCompany: 2, darkHorse: 0 },   the 'total' achievements, added up
//             best: { lamplighter: 2 },                           the 'match' ones: the best single match
//             earned: { seenThrough: '2026-10-19T20:15:00.000Z' }, when each was earned
//             matches: 12 }                                       matches that counted
//
// The store is injectable (createHonours({ store })): anything with getItem(key) and setItem(key, text), the shape of
// localStorage, so tests/honours-check.mjs runs it in Node.
import { ACHIEVEMENTS } from './data/achievements.js';

export const HONOURS_KEY = 'hotelEscape.honours.v1';
const MAX = 1e6;
const count = v => (Number.isFinite(+v) && +v > 0 ? Math.min(MAX, Math.floor(+v)) : 0);
const isDate = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const empty = () => {
  const h = { v: 1, counters: {}, best: {}, earned: {}, matches: 0 };
  for (const a of ACHIEVEMENTS) { if (a.scope === 'total') h.counters[a.id] = 0; else h.best[a.id] = 0; }
  return h;
};

const deviceStore = {
  getItem: key => window.localStorage?.getItem(key),
  setItem: (key, text) => window.localStorage?.setItem(key, text),
};

export function createHonours({ store = deviceStore, now = () => Date.now() } = {}) {
  // The saved progress made safe (only the five achievements, counts as whole numbers), or null when storage cannot
  // be read at all (then the copy in memory is kept).
  function read() {
    try {
      const raw = store.getItem(HONOURS_KEY);
      if (raw === undefined) return null;
      const saved = raw ? JSON.parse(raw) : null;
      const h = empty();
      if (saved && typeof saved === 'object') {
        for (const a of ACHIEVEMENTS) {
          if (a.scope === 'total') h.counters[a.id] = count(saved.counters?.[a.id]);
          else h.best[a.id] = Math.min(a.goal, count(saved.best?.[a.id]));
          if (isDate(saved.earned?.[a.id])) h.earned[a.id] = saved.earned[a.id];
        }
        h.matches = count(saved.matches);
      }
      return h;
    } catch { return null; }
  }
  let saved = true;
  function write() {
    try { store.setItem(HONOURS_KEY, JSON.stringify(current)); saved = true; } catch { saved = false; }
  }
  let current = read() || empty();
  // (another tab may have counted a match since: count on top of what is saved now, unless writes are failing)
  function fresh() { if (saved) current = read() || current; }

  const progress = (a, s) => { const p = Number(a.progress(s)); return Number.isFinite(p) && p > 0 ? Math.floor(p) : 0; };
  return {
    // A copy of the saved progress.
    get() { fresh(); return JSON.parse(JSON.stringify(current)); },
    // One finished match's summary: the achievements newly earned by it ([{ id, label, item }]; none unless the
    // summary counts). Saved.
    evaluate(summary) {
      if (!summary || summary.counts !== true) return [];
      fresh();
      const at = new Date(now()).toISOString();
      const newly = [];
      current.matches = Math.min(MAX, current.matches + 1);
      for (const a of ACHIEVEMENTS) {
        const p = progress(a, summary);
        let have;
        if (a.scope === 'total') have = current.counters[a.id] = Math.min(MAX, (current.counters[a.id] || 0) + p);
        else have = current.best[a.id] = Math.min(a.goal, Math.max(current.best[a.id] || 0, p));
        if (have >= a.goal && !current.earned[a.id]) {
          current.earned[a.id] = at;
          newly.push({ id: a.id, label: a.label, item: a.item });
        }
      }
      write();
      return newly;
    },
    // How far one achievement has come: { have, goal, earned }.
    progressOf(id) {
      fresh();
      const a = ACHIEVEMENTS.find(x => x.id === id);
      if (!a) return null;
      const have = a.scope === 'total' ? current.counters[a.id] || 0 : current.best[a.id] || 0;
      return { have: Math.min(have, a.goal), goal: a.goal, earned: !!current.earned[a.id] };
    },
  };
}

export const honours = createHonours();
