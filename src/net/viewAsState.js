// A VIEW WRITTEN INTO THE SCREENS' ONE LONG-LIVED STATE (DESIGN §6.6). The screens, the map, the sounds and the
// button checks (canSearch, roomRoute, ...) read an object shaped like the rules engine's `state`. In Single player
// and in Co-op that object is no longer the real state: it is the presenter state, written only by applyView from
// what this seat may know (src/net/playerView.js). Pure (no DOM, no THREE): the page and the Node tests use it.
//
//   applyView(target, view, received, { fresh, newMatch })   write `view` INTO `target` and return it
//   viewAsState(view, received)                              the same into a new blank state (tests, one-off checks)
//   blankState()                                             an empty presenter state
//
// `received`: the events this device has been given for this match (src/net/playerView.js seatEvents: { o, ... }),
// all of them or only the new ones: only those past what `target` already holds are added. Public events go to
// target.events and my own to my guest's inbox, each with seq := o, as in the engine (matchSummary.js and
// gameSounds.js order by seq). My own come from view.me.inbox, which is always complete.
//
// What it writes, shaped like the engine state: the Sets and Maps (in place); openLocks and barricades keyed back to
// player ids; other guests with an empty hand, possessed false, no knows, notes or inbox (at the end: their roles
// from end.reveal); drawPile one placeholder card while a search could still draw (deckEmpty false), so canSearch
// answers without the pile's size; roomDrops one placeholder card per room with something on its floor; viewerIndex
// = my seat (which closes the "active seat" fallbacks of hud.js, ui/hand.js and map.js). Not engine fields, from the
// view as they are: table, phase, clock, stall, ask, results and end.
//
// What it keeps, because the page's modules hold these objects and key on them (DESIGN §4.3):
//   - `target` itself, always;
//   - each target.players[i] within a match (a new match gets new guest records, as resetState gives today), and
//     the card objects of my hand while they stay in it;
//   - target.events and my inbox: append-only within a match. A new array only on `fresh` (rebuilt from `received`)
//     or a new match, when gameSounds rightly starts over (src/audio/gameSounds.js resets when state.events changes);
//   - target.log's line objects, reused when round, turn and text match, so src/ui/feed.js reports each line once.
// A new match is noticed by itself (other guests, an earlier turn, fewer rooms revealed, an inbox or event list that
// does not continue, a finished match followed by one still running); `newMatch` (true / false) overrides that.
// `fresh`: a reconnect, a seat switch, a restore or a skipped update: draw, don't animate.
import { outfitOf } from '../data/wardrobe.js';

// The placeholder for a card nobody here may see (one in the draw pile, one on each floor with something on it).
export const HIDDEN_CARD = Object.freeze({ id: null, type: null, hidden: true });

export function blankState() {
  return {
    mode: 'match', practice: false, seed: null,
    players: [], viewerIndex: 0, activeIndex: 0, round: 1, turn: 1,
    finished: false, won: null, dawn: false,
    discovered: new Set(), searchedRooms: new Set(), spentInfirmaries: new Set(), lockedRooms: new Set(),
    openLocks: new Map(), barricades: new Map(), roomDrops: new Map(), encounterLocks: new Set(), escaped: new Set(),
    drawPile: [], discardPile: [],
    log: [], events: [], eventSeq: 0,
    // (from the view, not the engine)
    table: null, phase: null, clock: null, stall: null, ask: null, results: [], end: null,
  };
}

export function viewAsState(view, received = []) {
  return applyView(blankState(), view, received);
}

const copy = x => (x == null ? null : JSON.parse(JSON.stringify(x)));
const asEvent = ({ o, ...rest }) => ({ seq: o, ...copy(rest) });
const sameEvent = (mine, theirs) => {
  if (!mine || !theirs || mine.seq !== theirs.o) return false;
  const { seq, ...a } = mine; const { o, ...b } = theirs;
  return JSON.stringify(a) === JSON.stringify(b);
};
function refill(set, items) {
  set.clear();
  for (const x of items) set.add(x);
  return set;
}
const setOf = x => (x instanceof Set ? x : new Set());
const mapOf = x => (x instanceof Map ? x : new Map());

function isNewMatch(target, view, received) {
  const P = target.players;
  if (!Array.isArray(P) || !P.length || P.length !== view.players.length) return true;
  if (view.players.some((p, i) => P[i]?.id !== p.id)) return true;
  if (view.turn < target.turn || view.round < target.round) return true;
  if (target.finished && !view.finished) return true;
  if (view.discovered.length < (target.discovered?.size ?? 0)) return true;
  // my inbox and the public events must continue what is here (ordinals are per seat: after a seat switch they
  // cannot be compared, and the guests, the turn and the board above decide)
  if (target.viewerIndex !== view.seat) return false;
  const mine = P[view.seat]?.inbox || [];
  const theirs = view.me.inbox || [];
  if (theirs.length < mine.length) return true;
  for (let k = 0; k < mine.length; k++) if (!sameEvent(mine[k], theirs[k])) return true;
  const last = target.events?.[target.events.length - 1];
  if (last && received.length) {
    let maxO = 0;
    for (const e of received) {
      if (e.o > maxO) maxO = e.o;
      if (e.o === last.seq && !sameEvent(last, e)) return true;
    }
    if (maxO < last.seq) return true;
  }
  return false;
}

// The log's line objects, reused where the new lines continue the old ones (the longest end of `old` that is the
// start of `lines`).
function mergeLog(log, lines, reuse) {
  const old = reuse ? log.slice() : [];
  const same = (a, b) => a.round === b.round && a.turn === b.turn && a.text === b.text;
  let k = Math.min(old.length, lines.length);
  for (; k > 0; k--) {
    let ok = true;
    for (let i = 0; i < k && ok; i++) ok = same(old[old.length - k + i], lines[i]);
    if (ok) break;
  }
  log.length = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    log.push(i < k ? old[old.length - k + i] : { round: l.round, turn: l.turn, text: l.text });
  }
  return log;
}

export function applyView(target, view, received = [], { fresh = false, newMatch = null } = {}) {
  if (!target || !view) throw new Error('applyView needs a target and a view');
  received = Array.isArray(received) ? received : [];
  const isNew = newMatch ?? isNewMatch(target, view, received);
  const seat = view.seat;
  const practice = view.table?.kind === 'practice';
  const idOf = s => view.players[s]?.id ?? null;

  // --- the guests ---------------------------------------------------------------------------------------------
  if (isNew || !Array.isArray(target.players) || target.players.length !== view.players.length) {
    target.players = view.players.map(() => ({}));
  }
  const reveal = new Map((view.end?.reveal || []).map(r => [r.seat, r]));
  view.players.forEach((vp, i) => {
    const rec = target.players[i];
    const mine = i === seat;
    const avatar = vp.avatar && rec.avatar && JSON.stringify(rec.avatar) === JSON.stringify(vp.avatar) ? rec.avatar : copy(vp.avatar);
    Object.assign(rec, {
      id: vp.id, name: vp.name, color: vp.color, mark: vp.mark, avatar,
      outfit: avatar ? outfitOf(avatar) : (rec.outfit ?? null),
      index: vp.seat, currentRoom: vp.room, health: vp.health, alive: vp.alive, away: !!vp.away,
    });
    if (vp.bot !== undefined) rec.bot = vp.bot; else delete rec.bot;
    if (mine) {
      const me = view.me;
      const cards = new Map((Array.isArray(rec.hand) ? rec.hand : []).map(c => [c.id, c]));
      rec.hand = me.hand.map(c => {
        const card = cards.get(c.id) || {};
        for (const k of Object.keys(card)) if (!(k in c)) delete card[k];
        return Object.assign(card, c);
      });
      rec.actionPoints = me.ap;
      rec.possessed = me.possessed;
      rec.convertedBy = me.convertedBy;
      rec.roleChangePending = me.roleChangePending;
      rec.roleSeen = me.roleSeen;
      rec.knows = refill(setOf(rec.knows), me.knows);
      rec.notes = me.notes.slice();
      // my own events (complete in every view): appended within a match, rebuilt on fresh / a new match / a switch
      const keep = !isNew && !fresh && target.viewerIndex === seat && Array.isArray(rec.inbox);
      const inbox = keep ? rec.inbox : [];
      const lastO = inbox.length ? inbox[inbox.length - 1].seq : 0;
      for (const e of me.inbox) if (e.o > lastO) inbox.push(asEvent(e));
      rec.inbox = inbox;
    } else {
      const r = reveal.get(vp.seat);
      rec.hand = [];
      rec.actionPoints = 0;                          // (not in the view: only my own)
      rec.possessed = !!r?.possessed;                // revealed only once the match is over
      rec.convertedBy = r ? r.convertedBy : null;
      rec.roleChangePending = false;
      rec.roleSeen = false;
      rec.knows = setOf(rec.knows); rec.knows.clear();
      rec.notes = [];
      rec.inbox = [];
    }
  });

  // --- the board ----------------------------------------------------------------------------------------------
  Object.assign(target, {
    mode: practice ? 'practice' : 'match', practice,
    viewerIndex: seat, activeIndex: view.activeSeat, round: view.round, turn: view.turn,
    finished: view.finished, won: view.won, dawn: view.dawn,
  });
  target.discovered = refill(setOf(target.discovered), view.discovered);
  target.searchedRooms = refill(setOf(target.searchedRooms), view.searched);
  target.spentInfirmaries = refill(setOf(target.spentInfirmaries), view.spent);
  target.lockedRooms = refill(setOf(target.lockedRooms), view.locked);
  target.encounterLocks = refill(setOf(target.encounterLocks), view.met);
  target.escaped = refill(setOf(target.escaped), view.players.filter(p => p.escaped).map(p => p.id));
  const openLocks = mapOf(target.openLocks); openLocks.clear();
  for (const [room, s, turn, doorway] of view.openLocks) openLocks.set(room, { by: idOf(s), turn, doorway });
  target.openLocks = openLocks;
  const barricades = mapOf(target.barricades); barricades.clear();
  for (const [door, s, placedTurn] of view.barricades) barricades.set(door, { by: idOf(s), placedTurn });
  target.barricades = barricades;
  const drops = mapOf(target.roomDrops); drops.clear();
  for (const room of view.drops) drops.set(room, [HIDDEN_CARD]);
  target.roomDrops = drops;
  target.drawPile = view.deckEmpty ? [] : [HIDDEN_CARD];
  target.discardPile = [];

  // --- events: public ones in target.events (seq := o), append-only within a match ------------------------------
  const own = new Set(view.me.inbox.map(e => e.o));
  const keepEvents = !isNew && !fresh && Array.isArray(target.events);
  const events = keepEvents ? target.events : [];
  const lastPub = events.length ? events[events.length - 1].seq : 0;
  const incoming = received.filter(e => e && Number.isFinite(e.o) && !own.has(e.o) && e.o > lastPub).sort((a, b) => a.o - b.o);
  let prev = lastPub;
  for (const e of incoming) if (e.o > prev) { events.push(asEvent(e)); prev = e.o; }
  // the end brings the whole history once: a list with gaps (after a reconnect) is made whole from it
  const history = view.end?.history?.events;
  if (Array.isArray(history) && history.length > events.length) {
    const whole = history.map(asEvent);
    target.events = whole;
  } else target.events = events;
  if (Array.isArray(view.end?.history?.inbox)) {
    const rec = target.players[seat];
    if (view.end.history.inbox.length > rec.inbox.length) rec.inbox = view.end.history.inbox.map(asEvent);
  }
  const lastEv = target.events.length ? target.events[target.events.length - 1].seq : 0;
  const lastIn = target.players[seat].inbox.length ? target.players[seat].inbox[target.players[seat].inbox.length - 1].seq : 0;
  target.eventSeq = Math.max(lastEv, lastIn);

  // --- the log (line objects kept for the feed) ----------------------------------------------------------------
  target.log = mergeLog(Array.isArray(target.log) ? target.log : [], view.log, !isNew);

  // --- what the table adds for this seat ----------------------------------------------------------------------
  target.table = copy(view.table);
  target.phase = copy(view.phase);
  target.clock = copy(view.clock);
  target.stall = copy(view.stall);
  target.ask = copy(view.ask);
  target.results = copy(view.results) || [];
  target.end = copy(view.end);
  return target;
}
