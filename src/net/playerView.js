// WHAT ONE SEAT MAY KNOW: the view each person's screens receive (DESIGN §6.1-§6.2). Pure (no DOM, no THREE, no Node
// APIs, no clock, no randomness): Single player's table, the server and the Node tests all build it with this file.
// It extends what a computer guest is given (src/bots/view.js botView): the same public board plus the person's own
// private screen, in the shape the screens need.
//
//   playerView(state, floor, seat, extras, { aliasOf })   the whole view for `seat`, plain JSON (built fresh each time)
//   seatEvents(state, seat, afterO)                        { events, lastO }: this seat's own event stream after `afterO`
//   ordinalOf(state, seat, seq)                            the ordinal `o` an engine event number has in that stream
//
// PUBLIC (everyone's view): the round, the turn, whose turn it is, the dawn round; the hotel as placed (lobby doors,
// [tile, cell i, cell j, rotation] in placement order, jammed doors, how many room tiles are left); which rooms are
// revealed, searched, spent (Infirmaries), locked; which locked doors a key opened and which doorways are barricaded
// (with who did it and on which turn, as the log says); in which rooms something lies on the floor (never what);
// whether a search could still draw a card at all (deckEmpty); which pairs already met where this round; every
// guest's seat, id, name, colour, mark, look, room, health, alive and escaped; the public log (last 30 lines).
// PRIVATE (only `me`): action points, role (possessed, convertedBy, roleChangePending, roleSeen), knows, notes, the
// hand (card ids through `aliasOf`; Revolver shots and the soul's owner, as the screens draw them), every private
// event of my own (inbox, numbered by `o`, never the engine's `seq`).
// NEVER: another seat's hand, card count, role, knows, notes, inbox, convertedBy or questions; the draw or discard
// pile (only deckEmpty); what lies on a floor; the room deck's order (only its length); the seed or any generator;
// the engine's event numbers (seq); engine card ids (with real aliases); another seat's deadlines; bot styles.
// At the end (state.finished, or the referee's own `extras.end`): every seat's role is revealed (end.reveal) and
// the seat's whole event history comes once (end.history), for Your record and the achievements.
//
// `extras` (per seat, from the referee or the host, already private to that seat, DESIGN §5.3):
//   { table, phase, clock, stall, ask, results, end, presence: { [seat]: { away, bot? } } }
// Every field is optional: without it the view says what today's Single player table would (a plain turn, no clock,
// no question). `ask`, `results` and `end` are copied as given, except for card ids:
//   - a card id in ask.weapons, ask.cards or results[].cards[].id is shown under its alias while the card is in my
//     hand, and as null once it has left it (a result is kept until acknowledged and can outlive the card: a fresh
//     alias each time would change from view to view, and the old one would follow the card);
//   - a card shown in a result never carries an id at all (results[].hand, .gave, .got: a Hand Mirror shows types,
//     a soul's owner and a Revolver's shots, never the target's ids).
// `aliasOf(seat, engineId)`: the seat's alias for its own card (src/net/aliases.js). Single player: the engine id.
import { rules } from '../data/rules.js';
import { ONLINE } from '../data/online.js';
import { SIDES } from '../game/hotel.js';
import { isFinalRound } from '../game/state.js';
import { guestMarks } from '../table.js';

export const VIEW_VERSION = 1;
export const LOG_LINES = 30;          // the public log in a view: its last lines (src/ui/feed.js reads them)

// A plain JSON copy (no undefined, no functions; a Set becomes a list, a Map a list of pairs), so a view never
// shares an object with the engine or the referee, and JSON.parse(JSON.stringify(view)) deep-equals it.
export function plain(x) {
  if (x === null || typeof x !== 'object') return typeof x === 'function' ? undefined : x;
  if (Array.isArray(x)) return x.map(v => { const c = plain(v); return c === undefined ? null : c; });
  if (x instanceof Set) return [...x].map(plain);
  if (x instanceof Map) return [...x].map(([k, v]) => [plain(k), plain(v)]);
  const out = {};
  for (const k of Object.keys(x)) { const c = plain(x[k]); if (c !== undefined) out[k] = c; }
  return out;
}

// --- Events and ordinals (DESIGN §6.2) --------------------------------------------------------------------------
// A seat's stream is the public events (state.events) and its own inbox, in engine order. Its ordinal `o` is how many
// events of that stream come at or before it: others' private events never move it, so `o` gives nothing away
// (the engine's shared `seq` would: it counts everyone's private events).

// How many entries of the seq-ordered `list` have seq <= `seq` (a binary search).
function countUpTo(list, seq) {
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].seq <= seq) lo = mid + 1; else hi = mid; }
  return lo;
}

// An event as a seat receives it: `seq` removed, `o` first.
function withOrdinal(e, o) {
  const { seq, ...rest } = e;
  return { o, ...plain(rest) };
}

// The ordinal of engine event `seq` in `seat`'s stream (for an event not in it: the ordinal of the last one before).
export function ordinalOf(state, seat, seq) {
  return countUpTo(state.events || [], seq) + countUpTo(state.players?.[seat]?.inbox || [], seq);
}

// The seat's own events, each with its ordinal (pub: the public ones; own: its inbox).
function ownInbox(state, seat) {
  const pub = state.events || [];
  return (state.players[seat].inbox || []).map((e, j) => withOrdinal(e, j + 1 + countUpTo(pub, e.seq)));
}

// The seat's whole stream after ordinal `afterO`, merged in engine order. { events, lastO }: lastO is the ordinal of
// the last event of the stream (send it back as `afterO` next time). `split: true` (end.history) returns the public
// and own events apart instead.
function stream(state, seat, afterO = 0, split = false) {
  const pub = state.events || [];
  const own = state.players?.[seat]?.inbox || [];
  const events = [], publicOnes = [], ownOnes = [];
  let i = 0, j = 0, o = 0;
  while (i < pub.length || j < own.length) {
    const mine = j < own.length && (i >= pub.length || own[j].seq < pub[i].seq);
    const e = mine ? own[j++] : pub[i++];
    if (++o <= afterO) continue;
    const out = withOrdinal(e, o);
    if (split) (mine ? ownOnes : publicOnes).push(out); else events.push(out);
  }
  return split ? { events: publicOnes, inbox: ownOnes, lastO: o } : { events, lastO: o };
}

export function seatEvents(state, seat, afterO = 0) {
  return stream(state, seat, afterO);
}

// --- The view ---------------------------------------------------------------------------------------------------

const seatOfId = (state, id) => { const p = state.players.find(q => q.id === id); return p ? p.index : null; };

function tableOf(state, t = null) {
  return {
    kind: t?.kind ?? (state.practice ? 'practice' : 'bots'),
    code: t?.code ?? null,
    rules: t?.rules ?? 'today',
    clockOn: t?.clockOn ?? !!rules.turnTimerEnabled,
    relaxed: !!t?.relaxed,
  };
}

// A card in my own hand: its alias, its type, a Revolver's shots and a soul's owner (always my own id).
function handCard(c, alias) {
  const out = { id: alias(c.id), type: c.type };
  if (c.shots != null) out.shots = c.shots;
  if (c.type === 'possession' && c.owner != null) out.owner = c.owner;
  return out;
}

// A card shown in a result (a Hand Mirror, a trade): what it is, never which one.
function shownCard(c) {
  if (!c || typeof c !== 'object') return c;
  const { id, ...rest } = c;
  return rest;
}

// `alias(id)`: the alias of a card in my hand, null for one that has left it.
function askOut(ask, alias) {
  const a = plain(ask);
  const map = x => (typeof x === 'string' ? alias(x) : x && typeof x === 'object' && 'id' in x ? { ...x, id: alias(x.id) } : x);
  if (Array.isArray(a.weapons)) a.weapons = a.weapons.map(map);
  if (Array.isArray(a.cards)) a.cards = a.cards.map(map);
  if (a.leftMs === undefined) a.leftMs = null;
  return a;
}

function resultOut(result, alias) {
  const r = plain(result);
  // found: [{ id, type, shots? }] (ids through the alias); autoDiscarded: [type] (types stay as they are)
  if (Array.isArray(r.cards)) r.cards = r.cards.map(c => (c && typeof c === 'object' && 'id' in c ? { ...c, id: alias(c.id) } : c));
  if (Array.isArray(r.hand)) r.hand = r.hand.map(shownCard);
  if (r.gave && typeof r.gave === 'object') r.gave = shownCard(r.gave);
  if (r.got && typeof r.got === 'object') r.got = shownCard(r.got);
  return r;
}

function endOf(state, seat, extraEnd) {
  if (!state.finished && !extraEnd) return null;
  const history = stream(state, seat, 0, true);
  const end = {
    won: state.won ?? null,
    dawn: !!state.dawn,
    reveal: state.players.map(p => ({
      seat: p.index, possessed: !!p.possessed, convertedBy: p.convertedBy ?? null, alive: !!p.alive, escaped: !!state.escaped?.has(p.id),
    })),
    history: { events: history.events, inbox: history.inbox },
  };
  if (extraEnd) Object.assign(end, plain(extraEnd));   // the referee's own: { won: null, stopped: 'stall' }, standInTurns
  return end;
}

export function playerView(state, floor, seat, extras = {}, { aliasOf = (s, id) => id } = {}) {
  const x = extras || {};
  const me = state.players[seat];
  if (!me) throw new Error(`playerView: no seat ${seat}`);
  const alias = id => aliasOf(seat, id);
  const inHand = new Set((me.hand || []).map(c => c.id));
  const mine = id => (inHand.has(id) ? alias(id) : null);   // (asks and results: see the header)
  const presence = x.presence || {};
  const marks = guestMarks(state.players.map(p => p.name));
  const lobby = floor.start ? floor.rooms.get(floor.start.room) : null;
  return {
    v: VIEW_VERSION,
    table: tableOf(state, x.table),
    seat,
    seats: state.players.length,
    round: state.round,
    roundLimit: rules.roundLimit,
    turn: state.turn,
    activeSeat: state.activeIndex,
    finalRound: isFinalRound(state),
    finished: !!state.finished,
    won: state.won ?? null,
    dawn: !!state.dawn,
    phase: x.phase ? plain(x.phase) : (state.finished ? { kind: 'ended', seats: [] } : { kind: 'turn', seats: [state.activeIndex] }),
    clock: x.clock ? plain(x.clock) : null,
    stall: x.stall ? plain(x.stall) : null,
    hotel: {
      lobbyDoors: lobby ? SIDES.filter(s => lobby.doorSides.has(s)) : [],
      placed: floor.roomList.filter(r => r !== lobby).map(r => [r.tile, r.cell[0], r.cell[1], r.rotation]),
      jammed: floor.frontier.filter(d => d.jammed).map(d => d.id),
      roomTilesLeft: floor.deck?.length ?? 0,
    },
    discovered: [...(state.discovered || [])],
    searched: [...(state.searchedRooms || [])],
    spent: [...(state.spentInfirmaries || [])],
    locked: [...(state.lockedRooms || [])],
    // [room, seat who opened it, the turn, the doorway]: relockDoors reads the turn
    openLocks: [...(state.openLocks || [])].map(([room, u]) => [room, seatOfId(state, u.by), u.turn ?? null, u.doorway ?? null]),
    // [doorway, seat who placed it, the turn it went up]: expireBarricades reads who placed it
    barricades: [...(state.barricades || [])].map(([door, b]) => [door, seatOfId(state, b.by), b.placedTurn ?? null]),
    drops: [...(state.roomDrops || [])].filter(([, cards]) => cards?.length).map(([room]) => room),
    deckEmpty: !state.drawPile?.length && !state.discardPile?.length,
    met: [...(state.encounterLocks || [])].sort(),
    players: state.players.map((p, i) => {
      const out = {
        seat: p.index, id: p.id, name: p.name ?? null, color: p.color ?? null, mark: marks[i],
        avatar: p.avatar ? plain(p.avatar) : null,
        room: p.currentRoom, health: p.health, alive: !!p.alive, escaped: !!state.escaped?.has(p.id),
        away: !!presence[p.index]?.away,
      };
      if (ONLINE.botLabels === true && typeof presence[p.index]?.bot === 'boolean') out.bot = presence[p.index].bot;
      return out;
    }),
    me: {
      seat,
      id: me.id,
      room: me.currentRoom,
      ap: me.actionPoints,
      health: me.health,
      alive: !!me.alive,
      possessed: !!me.possessed,
      convertedBy: me.convertedBy ?? null,
      roleChangePending: !!me.roleChangePending,
      roleSeen: !!me.roleSeen,
      knows: [...(me.knows || [])],
      notes: [...(me.notes || [])],
      hand: (me.hand || []).map(c => handCard(c, alias)),
      inbox: ownInbox(state, seat),
    },
    log: (state.log || []).slice(-LOG_LINES).map(l => ({ round: l.round, turn: l.turn, text: l.text })),
    ask: x.ask ? askOut(x.ask, mine) : null,
    results: (x.results || []).map(r => resultOut(r, mine)),
    end: endOf(state, seat, x.end || null),
  };
}
