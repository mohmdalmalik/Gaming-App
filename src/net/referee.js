// THE REFEREE: one match, run from outside the screens (DESIGN §5). Pure: no DOM, no timers, no clock of its own, no
// global randomness. Time comes in as `now` (milliseconds); randomness for time-out choices comes in as `random`.
// Its own bookkeeping (R below) is plain data, so a table can be saved after every step (toJSON) and restored
// (createReferee.restore). It runs in three places: the page (Single player, through src/net/localTable.js), the
// server (Co-op, through src/net/rooms.js) and the Node tests.
//
// It is today's turn flow lifted out of src/main.js (turns, the clock, bots, meetings, trades, the discard) and
// src/bots/autoplay.js, with people's choices turned into QUESTIONS (asks) and their private outcomes into RESULTS.
// Every rule is still the engine's (src/game/*): the referee only decides who acts when, and asks.
//
//   const ref = createReferee({ state, floor, bots, people, mode, walkMode, botRules, limits, pace, walkMs, random, now })
//     state, floor   a dealt match (createState); bots: createBotTable(state, floor, botSeats, seed) (null: no bots)
//     people         the seats played by people (every other seat is a bot)
//     mode           'local' (Single player: the page's own clock and pauses) | 'online' (a Co-op table)
//     walkMode       'device' (local: the page walks the figure and reports each doorway, §4.4) | 'atomic' (online)
//     botRules       'page' (LocalTable and the server) | 'autoplay' (the replay test only); the four differences below
//     limits         LOCAL_LIMITS | ONLINE_RULES.today | ONLINE_RULES.pending (src/data/online.js), read once here
//     pace           (seat, kind) => ms before a bot's step or beat (kinds: turn act move meet trade reply)
//     walkMs         (seat, rooms) => ms a walk takes on screens (online: bots and asks wait for it after a move)
//     random         () => [0, 1) for time-out choices (local: leave it out, so the engine's own generator is used,
//                    exactly where the page uses it today; the server: crypto)
//     now            the time the match starts
//
//   ref.do(seat, cmd, now)   -> { ok, reason?, result? }   a person's command (DESIGN §6.3). `result` is WHITELISTED:
//                               { rooms } for a move, nothing else ever (private outcomes go into that seat's results)
//   ref.tick(now)            -> true if anything changed: deadlines, bot steps, meeting beats
//   ref.extras(seat, now)    -> { phase, clock, stall, ask, results, end }   what playerView adds for THAT seat
//   ref.phase                   the public phase { kind, seats }
//   ref.drain()              -> [{ to: 'all' | seat, ev }]   what happened outside the engine's events since the last
//                               drain: { type: 'walk', seat, rooms } and { type: 'walkCut', seat, to } (device walks);
//                               local only, to a person in an attack: { type: 'attackSeen', by, target, weapon, discarded }
//   ref.setPresence(seat, 'here' | 'hidden' | 'gone', now)
//   ref.toJSON()             -> plain data;  createReferee.restore(json, opts) -> a referee carrying on from it
//   ref.setBots(bots)           new minds (a restore, or a test's fork)
//   ref.shift(ms)               every time it holds moved later (a restored table gets the outage + 15 s back)
//   ref.nextDue()            -> the earliest time something is due (a test or a server can sleep until then), or null
//   Local only (Single player): ref.hold({ bots, clock }), ref.advance(dtMs, now), ref.step(roomId, now),
//   ref.arrived(now), ref.walkFailed(now), ref.skipToEnd(now), ref.timeLeft(), ref.setTimeLeft(ms)
//
// PHASES (DESIGN §5.3; R.stage): start -> turn -> meet:whom / meet:act / meet:cards / offer / discard -> turn ... ->
// ended. The public phase never shows a sub-step: a meeting is { kind: 'meeting', seats: [walker, met?] } until it is
// resolved, a Fire Exit proposal { kind: 'offer', seats }, and THE ACTIVE SEAT'S DISCARD IS NEVER PUBLIC: everyone
// else keeps seeing phase 'turn' and the turn clock, which holds at 0:00 while a discard minimum runs (§5.3, #17).
//
// QUESTIONS (asks, only the asked seat sees its own): role, meetWhom, meetAct, tradeCard, offer, discard. A person
// walker is always asked Trade or Attack (meetAct, canAttack false when unarmed or out of actions). A trade with a
// person is SEALED: each person answers on their own; a bot's card is chosen at the start and kept hidden; after the
// last person's answer a bot side takes its 'trade' beat; nothing is shown before the cards change hands.
// RESULTS (private, kept until acknowledged with { k: 'ack', what: 'result', id }): found, mirror, trade, noTrade,
// declined, notes, autoDiscarded (and timedOut under the pending rules). Card ids in asks and results are ENGINE
// ids: playerView maps them through the seat's aliases (src/net/playerView.js).
//
// THE CLOCK (§5.5): the turn clock runs only in 'turn' and 'discard' for the active seat; frozen in meetings and
// offers. Local: today's tickTimer exactly (advance: at most 50 ms a frame, nothing while hold.clock; a walk cut short
// at zero, main.js:634-648). Online: server milliseconds, with a 500 ms grace after zero; the ACTIVE person's own
// private screens (found cards, a Mirror, a trade, the notes, a role change) pause it until acknowledged (capped by
// screenCapMs when that is set). Local mode leaves that pause to the page (hold.clock), so a missed ack can never
// freeze Single player's clock.
//
// BOT RULES. Today's page plays bots slightly differently from autoplay.playOut; `botRules` picks which:
//   1. A jammed door: page - not a refusal and no reject (main.js:1141-1145); autoplay - a refusal plus reject
//      (autoplay.js:121-125; three refusals end the bot's turn).
//   2. A bot-to-bot meeting: page - one 'meet' think pause first (main.js:871-873); autoplay - at once. (A bot meeting
//      a person takes the beat under both.) Likewise a bot answering a bot's Fire Exit proposal: page - a 'reply'
//      pause; autoplay - at once.
//   3. A bot's turn timing out over the hand limit: page - the bot chooses its own discards (endTurnNow ->
//      botDiscardDown, main.js:731-734); autoplay - the random discard of a person (it has no clock, so it never
//      arises there).
//   4. Bots' private notes: page - cleared each turn (main.js:703); autoplay - kept.
//   (Also: a refused bot action is reported to the bot as 'refused' by the page and with the engine's reason by
//   autoplay; the bots ignore the reason.)
// In both, a bot's meeting is decided in one beat: whom, then attack or trade (attackWith only when armed and able).
//
// NOT BUILT (DESIGN §5.7, owner rules R6/R7 not approved): stand-ins, the idle time-outs and the whileAway result;
// the host's Relaxed clock (R10). The `pending` limits R3/R4/R5 (meeting, card and Fire Exit answers time out after
// meetMs/cardMs/offerMs; the private-screen pause is capped by screenCapMs; one proposal a turn) ARE built, and
// unused while ONLINE_RULES.approved is false.
import { rules } from '../data/rules.js';
import { ONLINE } from '../data/online.js';
import {
  activePlayer, endTurn, enterRoom, pendingEncounters, lockEncounter, checkWin, canTradeVoluntarily,
  doorBetween, doorwayPassable, moveCostInto,
} from '../game/state.js';
import * as A from '../game/actions.js';
import { weaponsIn, isWeapon } from '../game/cards.js';
import { planWalk, runMeeting, playOut } from '../bots/autoplay.js';
import { tradeOutcome } from './outcomes.js';

export const REFEREE_VERSION = 1;

const STEP_CAP = 40;              // a bot's turn ends after this many actions (main.js:1086, autoplay.js maxSteps)
const REFUSAL_CAP = 3;            // ...or this many refused ones
const REFUSAL_PAUSE_MS = 150;     // a refused bot action: it tries again this soon (main.js:1093)
const FRAME_CAP_MS = 50;          // the local clock never counts more than this for one frame (main.js:2449)
const CUT_HOLD_MS = 1;            // a walk cut short at zero: the clock holds just above zero until the guest arrives
const BOT_DISCARD_GUARD = { page: 12, autoplay: 30 };
// The private screens that pause the active person's clock online (§5.5), and the questions the stall timer watches.
const SCREEN_KINDS = new Set(['found', 'mirror', 'trade', 'noTrade', 'declined', 'notes']);
const WAIT_KINDS = new Set(['meetWhom', 'meetAct', 'tradeCard', 'offer']);
const LIMIT_KEYS = ['turnMs', 'discardMinMs', 'meetMs', 'cardMs', 'offerMs', 'screenCapMs', 'startAckMs', 'stallMs'];

// The limits, read once (LOCAL_LIMITS.clock is a getter on the rules as this match was dealt): plain data.
function readLimits(limits = {}) {
  const L = { clock: limits.clock ?? null };
  for (const k of LIMIT_KEYS) L[k] = Number.isFinite(limits[k]) ? limits[k] : null;
  L.offerOncePerTurn = !!limits.offerOncePerTurn;
  L.devicePauses = !!limits.devicePauses;
  return L;
}

const copy = x => (x == null ? x : JSON.parse(JSON.stringify(x)));
const ok = (extra = null) => (extra ? { ok: true, ...extra } : { ok: true });
const no = reason => ({ ok: false, reason: reason ?? 'notNow' });
// A card as a result shows it: what it is, never which one (a Revolver's shots and a soul's owner, as drawn).
const shownCard = c => {
  if (!c) return null;
  const out = { type: c.type };
  if (c.shots != null) out.shots = c.shots;
  if (c.type === 'possession' && c.owner != null) out.owner = c.owner;
  return out;
};
const foundCard = c => { const out = { id: c.id, type: c.type }; if (c.shots != null) out.shots = c.shots; return out; };

export function createReferee(opts = {}) {
  const mode = opts.mode === 'online' ? 'online' : 'local';
  const R = {
    v: REFEREE_VERSION,
    mode,
    walkMode: opts.walkMode ?? (mode === 'local' ? 'device' : 'atomic'),
    botRules: opts.botRules === 'autoplay' ? 'autoplay' : 'page',
    limits: readLimits(opts.limits),
    graceMs: mode === 'online' ? (opts.graceMs ?? ONLINE.timing.graceMs) : 0,
    people: [...new Set(opts.people || [])].sort((a, b) => a - b),
    presence: {},
    stage: 'start', stopped: null, turns: 0, now: opts.now ?? 0, turnAt: null, startAt: null,
    hold: { bots: false, clock: false },
    clock: null,          // { seat, kind: 'turn' | 'discard', leftMs, at, offset, cut }
    walk: null,           // device walks: { seat, rooms, cut, cutTo }
    arrival: false,       // device walks: a room was entered since the last arrived()
    bot: null,            // the active bot's turn: { seat, due, steps, refusals, last, afterMeet }
    beat: null,           // a meeting beat: { kind: 'meet' | 'trade' | 'reply', seat, at }
    meet: null,           // the meeting or proposal under way (seats and card ids only)
    asks: {}, roleAsks: {}, results: {}, seq: {}, answered: {},
    proposed: [], skipQueued: false,
    out: [],
  };
  for (const s of R.people) R.presence[s] = 'here';
  const ref = build(R, opts);
  ref._start(R.now);
  return ref;
}

createReferee.restore = (json, opts = {}) => {
  const R = typeof json === 'string' ? JSON.parse(json) : copy(json);
  if (!R || R.v !== REFEREE_VERSION) throw new Error(`referee: saved version ${R?.v} (this build reads ${REFEREE_VERSION})`);
  return build(R, opts);
};

function build(R, opts) {
  const S = opts.state, F = opts.floor;
  let bots = opts.bots ?? null;
  const pace = opts.pace ?? ((seat, kind) => bots?.thinkMs?.(seat, kind) ?? 600);
  const random = opts.random ?? null;
  const local = R.mode === 'local';
  const clockMode = R.limits.clock;          // 'device' | 'server' | null

  const P = i => S.players[i];
  const act = () => activePlayer(S);
  const person = i => R.people.includes(i);
  const out = (to, ev) => R.out.push({ to, ev });
  const nextId = (seat, letter) => { R.seq[seat] = (R.seq[seat] || 0) + 1; return `${letter}${R.seq[seat]}`; };
  const paceOf = (seat, kind) => { let ms = 600; try { ms = pace(seat, kind); } catch { /* keep the default */ } return Number.isFinite(ms) && ms > 0 ? ms : 0; };
  const walkMsOf = (seat, rooms) => { let ms = 0; try { ms = opts.walkMs?.(seat, rooms) ?? 0; } catch { ms = 0; } return Number.isFinite(ms) && ms > 0 ? ms : 0; };
  const pickIndex = n => Math.min(n - 1, Math.floor((random ? random() : 0) * n));
  const otherSide = s => (R.meet.sides[0] === s ? R.meet.sides[1] : R.meet.sides[0]);

  // --- questions and results -----------------------------------------------------------------------------------
  function openAsk(seat, kind, fields, now, limitMs = null) {
    const delay = R.meet?.delay || 0;
    if (R.meet) R.meet.delay = 0;          // (only the first question after a move waits for the walk to be seen)
    const a = { id: nextId(seat, 'q'), kind, ...copy(fields), at: now, deadline: limitMs != null ? now + delay + limitMs : null };
    R.asks[seat] = a;
    return a;
  }
  function roleAsk(seat, now, changed = false) {
    const p = P(seat);
    const a = { id: nextId(seat, 'q'), kind: 'role', role: p.possessed ? 'possessed' : 'clean', at: now, deadline: null };
    if (changed) { a.changed = true; const by = S.players.find(q => q.id === p.convertedBy); a.by = by ? by.index : null; }
    R.roleAsks[seat] = a;
  }
  function addResult(seat, kind, fields, now) {
    if (!person(seat)) return null;
    const r = { id: nextId(seat, 'r'), kind, ...copy(fields), at: now };
    (R.results[seat] ||= []).push(r);
    return r;
  }
  function discardAsk(seat, now) {
    const p = P(seat);
    const fields = { over: A.overHandLimit(p), cards: p.hand.filter(c => c.type !== 'possession').map(c => c.id) };
    const a = R.asks[seat];
    if (a?.kind === 'discard') Object.assign(a, fields);
    else R.asks[seat] = { id: nextId(seat, 'q'), kind: 'discard', ...fields, at: now, deadline: null };
  }
  function ackRole(seat, now) {
    const p = P(seat);
    p.roleChangePending = false;
    p.roleSeen = true;
    delete R.roleAsks[seat];
    if (R.stage === 'start') maybeEndStart(now);
  }

  // --- the clock ---------------------------------------------------------------------------------------------------
  // Online, the active person's own unread screens pause it (from when each arrived, or from the turn's start), each
  // for at most screenCapMs when that is set. Returns until when it is paused (-Infinity: not at all).
  function pauseEnd() {
    if (local || !R.clock) return -Infinity;
    const seat = R.clock.seat;
    if (!person(seat) || (R.presence[seat] ?? 'here') !== 'here') return -Infinity;
    const starts = [];
    if (R.roleAsks[seat]) starts.push(R.roleAsks[seat].at);
    for (const r of R.results[seat] || []) if (SCREEN_KINDS.has(r.kind)) starts.push(r.at);
    if (!starts.length) return -Infinity;
    if (R.limits.screenCapMs == null) return Infinity;
    return Math.max(...starts.map(t => Math.max(t, R.turnAt ?? t) + R.limits.screenCapMs));
  }
  const counting = () => !!R.clock && (R.stage === 'turn' || R.stage === 'discard');
  function running(now) {
    if (!counting()) return false;
    if (local) return !(R.limits.devicePauses && R.hold.clock);
    return pauseEnd() <= now;
  }
  // The server clock's time left at `now` (without changing anything).
  function leftAt(now) {
    const c = R.clock;
    if (!c) return null;
    if (clockMode !== 'server' || !counting() || now <= c.at) return c.leftMs;
    const from = Math.max(c.at, pauseEnd());
    return now > from ? c.leftMs - (now - from) : c.leftMs;
  }
  function settle(now) {
    const c = R.clock;
    if (!c || clockMode !== 'server') return;
    c.leftMs = leftAt(now);
    c.at = Math.max(c.at, now);
  }
  function startClock(seat, now) {
    R.clock = clockMode && R.limits.turnMs != null
      ? { seat, kind: 'turn', leftMs: R.limits.turnMs, at: now, offset: 0, cut: false } : null;
  }

  // --- turns -------------------------------------------------------------------------------------------------------
  function finish(now) {
    R.stage = 'ended';
    R.clock = null; R.walk = null; R.arrival = false; R.beat = null; R.meet = null; R.bot = null;
    R.asks = {};
  }

  function beginTurn(now) {
    if (S.finished) return finish(now);
    const p = act(), seat = p.index;
    R.stage = 'turn';
    R.turns++;
    R.turnAt = now;
    R.walk = null; R.arrival = false; R.beat = null; R.meet = null; R.proposed = [];
    startClock(seat, now);
    if (!person(seat)) {
      if (bots && !bots.has(seat)) bots.addSeat(seat);
      R.bot = { seat, due: now + paceOf(seat, 'turn'), steps: 0, refusals: 0, last: null, afterMeet: null };
      return;
    }
    R.bot = null;
    // Anything that happened to them meanwhile, in private, before their actions (main.js:580-585).
    if (p.roleChangePending && !R.roleAsks[seat]) roleAsk(seat, now, true);
    if (p.notes.length) {
      R.results[seat] = (R.results[seat] || []).filter(r => r.kind !== 'notes');
      addResult(seat, 'notes', { lines: [...p.notes] }, now);
    }
  }

  // The active guest's turn passes to the next living guest (main.js passTurn).
  function passTurn(now) {
    const p = act();
    if (!S.finished && A.overHandLimit(p) > 0) {                 // never past the hand limit
      if (person(p.index)) return enterDiscard(now);
      botDiscardDown(p);
    }
    delete R.asks[p.index];
    R.clock = null; R.walk = null; R.arrival = false;
    const res = endTurn(S, F);
    if (!res.ok) {                                                // (only over the hand limit, handled above)
      if (person(p.index)) return enterDiscard(now);
      A.discardRandomDown(S, p, random || undefined);
      return passTurn(now);
    }
    if (R.botRules === 'page') for (const q of S.players) if (!person(q.index)) q.notes.length = 0;
    if (res.finished || checkWin(S, F)) return finish(now);
    beginTurn(now);
  }

  // End the turn now: over the hand limit a person chooses discards first; a bot chooses its own (main.js endTurnNow).
  function endTurnNow(now) {
    const p = act();
    if (A.overHandLimit(p) > 0) {
      if (person(p.index)) return enterDiscard(now);
      botDiscardDown(p);
    }
    passTurn(now);
  }

  function botDiscardDown(p) {
    for (let guard = BOT_DISCARD_GUARD[R.botRules]; A.overHandLimit(p) > 0 && guard > 0; guard--) {
      const ids = p.hand.filter(c => c.type !== 'possession').map(c => c.id);
      let id = null;
      try { id = bots ? bots.discard(p.index, ids) : null; } catch { id = null; }
      if (!A.discardCard(S, p, id).ok) A.discardCard(S, p, ids[0]);
    }
  }

  // A person over the hand limit: the discard question; the turn clock runs on, never under discardMinMs
  // (src/ui/discardClock.js discardAllowance). The added part is hidden from everyone else (offset).
  function enterDiscard(now) {
    const seat = act().index;
    R.stage = 'discard';
    R.walk = null; R.arrival = false;
    const c = R.clock;
    if (c) {
      const left = Math.max(0, c.leftMs);
      const allowance = Math.max(left, R.limits.discardMinMs ?? 0);
      c.offset = allowance - left;
      c.kind = 'discard';
      c.leftMs = allowance;
      c.at = now;
    }
    discardAsk(seat, now);
  }

  // The clock ran out on the active guest (main.js onTimeUp / endTurnByClock; actions.js endTurnByTimeout).
  function timeUp(now) {
    const p = act(), seat = p.index;
    if (person(seat) || R.botRules === 'autoplay') {
      delete R.asks[seat];
      const gone = A.discardRandomDown(S, p, random || undefined);
      if (gone.length) addResult(seat, 'autoDiscarded', { cards: gone.map(c => c.type) }, now);
      return passTurn(now);
    }
    endTurnNow(now);                                              // page: a bot chooses its own discards
  }

  // --- the start: each present person reads their role -------------------------------------------------------------
  function maybeEndStart(now) {
    if (R.stage !== 'start') return false;
    const waiting = R.people.filter(s => R.roleAsks[s] && (R.presence[s] ?? 'here') !== 'gone');
    const late = R.limits.startAckMs != null && now >= R.startAt + R.limits.startAckMs;
    if (waiting.length && !late) return false;
    beginTurn(now);
    return true;
  }

  // --- walks ---------------------------------------------------------------------------------------------------------
  // A planned move (planWalk's rooms, starting with the guest's own). Device: a walk in progress, entered room by room
  // as the figure crosses (step) and finished by arrived(). Atomic: every room at once, then the forced meeting.
  function startMove(p, rooms, now) {
    if (R.walkMode === 'device') {
      R.walk = { seat: p.index, rooms: [...rooms], cut: false, cutTo: null };
      R.arrival = false;
      out('all', { type: 'walk', seat: p.index, rooms: [...rooms] });
      return;
    }
    for (let i = 1; i < rooms.length; i++) enterRoom(S, F, p, rooms[i]);
    const cands = pendingEncounters(S, F, p);
    if (cands.length) startMeeting(p, cands, now, walkMsOf(p.index, rooms));
  }

  // The clock ran out mid-walk (main.js cutWalkShort): still in the room the walk started from, the step under way
  // into the next room is finished; already in a room on the way, the guest stops there.
  function cutWalk() {
    const w = R.walk;
    if (!w || w.cut) return;
    w.cut = true;
    if (R.clock) R.clock.cut = true;
    const p = P(w.seat);
    const next = !R.arrival && w.rooms.length > 1 && w.rooms[0] === p.currentRoom ? w.rooms[1] : p.currentRoom;
    w.cutTo = next;
    out('all', { type: 'walkCut', seat: w.seat, to: next });
  }

  // --- meetings ------------------------------------------------------------------------------------------------------
  function startMeeting(walker, cands, now, delay = 0) {
    const seat = walker.index, seats = cands.map(q => q.index);
    R.meet = {
      kind: 'forced', walker: seat, met: seats.length === 1 ? seats[0] : null, candidates: seats,
      voluntary: false, sides: null, cards: {}, hidden: {}, delay,
    };
    R.stage = 'meet:whom';
    if (!person(seat)) {
      if (R.botRules === 'page' || seats.some(person)) {
        R.beat = { kind: 'meet', seat, at: now + delay + paceOf(seat, 'meet') };
        R.meet.delay = 0;
        return;
      }
      botMeeting(now);                    // autoplay: a bot-to-bot meeting at once
      return;
    }
    if (seats.length > 1) { openAsk(seat, 'meetWhom', { candidates: seats }, now, R.limits.meetMs); return; }
    personMet(seats[0], now);
  }

  // A bot walked in: whom, then attack or trade, in one beat (main.js botMeeting; autoplay.js runMeeting).
  function botMeeting(now) {
    const m = R.meet, W = P(m.walker);
    if (S.finished) return endMeeting(now);
    let pick = m.candidates[0];
    if (m.candidates.length > 1) {
      try { pick = bots.meetWhom(m.walker, m.candidates); } catch { pick = m.candidates[0]; }
      if (!m.candidates.includes(pick)) pick = m.candidates[0];
    }
    m.met = pick;
    const Q = P(pick);
    lockEncounter(S, W.currentRoom, W.index, Q.index);
    const canAttack = weaponsIn(W.hand).length > 0 && W.actionPoints >= rules.actionCost.attack;
    let weapon = null;
    if (canAttack) { try { weapon = bots.attackWith(W.index, Q.index); } catch { weapon = null; } }
    if (weapon && W.hand.some(c => c.id === weapon)) {
      const r = A.resolveAttack(S, F, W, Q, weapon);
      if (r.ok) { attackSeen(W, Q, r); return endMeeting(now); }
    }
    startTrade(W, Q, now, false);
  }

  // Single player: the one thing the attack's own screen shows a person in it that the public attack event does not say:
  // whether a Revolver fired its last shot (the card is discarded; the screen marks it "Empty", main.js / ui/meeting.js).
  // Online leaves it out (a Co-op screen draws the attack from the public event alone).
  function attackSeen(W, Q, r) {
    if (!local) return;
    for (const s of [W.index, Q.index]) {
      if (person(s)) out(s, { type: 'attackSeen', by: W.index, target: Q.index, weapon: r.weapon, discarded: !!r.discarded });
    }
  }

  // A person walked in and met `q`: Trade or Attack, always asked (Attack greyed when unarmed or out of actions).
  function personMet(q, now) {
    const m = R.meet, W = P(m.walker);
    m.met = q;
    lockEncounter(S, W.currentRoom, W.index, q);
    const weapons = weaponsIn(W.hand).map(c => c.id);
    const canAttack = weapons.length > 0 && W.actionPoints >= rules.actionCost.attack;
    R.stage = 'meet:act';
    openAsk(W.index, 'meetAct', { with: q, canAttack, weapons }, now, R.limits.meetMs);
  }

  function botCard(X, Y) {
    const ids = A.tradeableCards(X).map(c => c.id);
    if (bots && !bots.has(X.index)) bots.addSeat(X.index);
    let id = null;
    try { id = bots.tradeCard(X.index, Y.index, ids); } catch { id = null; }
    return ids.includes(id) ? id : ids[0];
  }

  // A trade between X (who walked in, or proposed it) and Y (main.js runTrade; autoplay.js runTrade).
  function startTrade(X, Y, now, voluntary) {
    const m = R.meet;
    m.sides = [X.index, Y.index];
    m.met = Y.index;
    m.voluntary = !!voluntary;
    if (!A.canTrade(X, Y).ok) {
      const r = A.skipTrade(S, F, X, Y);
      for (const [a, b] of [[X, Y], [Y, X]]) {
        addResult(a.index, 'noTrade', { with: b.index, empty: r.empty || [], notes: r.notes?.[a.id] ? [r.notes[a.id]] : [], voluntary: m.voluntary }, now);
      }
      return endMeeting(now);
    }
    const people = m.sides.filter(person);
    if (!people.length) return resolveTradeNow(botCard(X, Y), botCard(Y, X), now);
    for (const s of m.sides) if (!person(s)) m.hidden[s] = botCard(P(s), P(otherSide(s)));   // chosen now, hidden
    R.stage = 'meet:cards';
    for (const s of people) {
      openAsk(s, 'tradeCard', { with: otherSide(s), cards: A.tradeableCards(P(s)).map(c => c.id), voluntary: m.voluntary }, now, R.limits.cardMs);
    }
  }

  // A person's card is in: after the last one, a bot side takes its 'trade' beat; with no bot side, the swap.
  function afterTradeAnswer(now) {
    const m = R.meet;
    if (m.sides.some(s => person(s) && m.cards[s] == null)) return;
    const botSide = m.sides.find(s => !person(s));
    if (botSide != null) { R.beat = { kind: 'trade', seat: botSide, at: now + paceOf(botSide, 'trade') }; return; }
    resolveTradeNow(m.cards[m.sides[0]], m.cards[m.sides[1]], now);
  }

  function resolveTradeNow(cX, cY, now) {
    const m = R.meet;
    const [x, y] = m.sides, X = P(x), Y = P(y);
    const given = { [x]: shownCard(X.hand.find(c => c.id === cX)), [y]: shownCard(Y.hand.find(c => c.id === cY)) };
    const ev = A.resolveTrade(S, F, X, Y, cX, cY);
    if (!ev.ok) {
      for (const [a, b] of [[X, Y], [Y, X]]) addResult(a.index, 'noTrade', { with: b.index, empty: [], notes: ['The trade could not be made.'], voluntary: m.voluntary }, now);
      return endMeeting(now);
    }
    for (const [a, b] of [[X, Y], [Y, X]]) {
      if (!person(a.index)) continue;
      addResult(a.index, 'trade', {
        with: b.index, outcome: tradeOutcome(ev, a, b), gave: given[a.index], got: given[b.index],
        notes: ev.notes?.[a.id] || [], voluntary: m.voluntary,
      }, now);
      if (ev.possessed?.some(e => e.newly === a.id)) roleAsk(a.index, now, true);
    }
    endMeeting(now);
  }

  // A Fire Exit proposal: from the active guest to Q (main.js onTrade / botProposeTrade).
  function startOffer(W, Q, now) {
    R.meet = { kind: 'offer', walker: W.index, met: Q.index, candidates: [Q.index], voluntary: true, sides: null, cards: {}, hidden: {}, delay: 0 };
    R.stage = 'offer';
    if (person(W.index)) R.proposed.push(W.index);
    if (!person(Q.index)) {
      if (R.botRules === 'autoplay') { offerReply(botAccepts(Q.index, W.index), now); return; }
      R.beat = { kind: 'reply', seat: Q.index, at: now + paceOf(Q.index, 'reply') };
      return;
    }
    openAsk(Q.index, 'offer', { from: W.index }, now, R.limits.offerMs);
  }
  function botAccepts(q, from) {
    if (bots && !bots.has(q)) bots.addSeat(q);
    try { return !!bots.acceptTrade(q, from); } catch { return false; }
  }
  function offerReply(yes, now) {
    const m = R.meet, W = P(m.walker), Q = P(m.met);
    if (yes) return startTrade(W, Q, now, true);
    if (person(W.index)) addResult(W.index, 'declined', { with: Q.index }, now);
    endMeeting(now);
  }

  // The meeting is over (main.js afterMeeting). On a bot's turn its next step waits a think pause; locally, after a
  // meeting a person took part in, that pause starts only once the page's screens are closed (hold.bots off), as
  // today's afterMeeting runs when the last screen is dismissed.
  function endMeeting(now) {
    const m = R.meet;
    R.meet = null; R.beat = null;
    if (m) for (const s of [m.walker, ...(m.candidates || [])]) if (R.asks[s] && R.asks[s].kind !== 'discard') delete R.asks[s];
    if (S.finished) return finish(now);
    R.stage = 'turn';
    const b = R.bot;
    if (b && b.seat === act().index) {
      const personIn = m && (person(m.walker) || (m.met != null && person(m.met)));
      if (local && personIn) b.afterMeet = now;
      else b.due = now + paceOf(b.seat, 'act');
    }
    if (R.skipQueued) { R.skipQueued = false; skipToEnd(now); }
  }

  function runBeat(now) {
    const b = R.beat;
    R.beat = null;
    const m = R.meet;
    if (!m) return;
    if (b.kind === 'meet') return botMeeting(now);
    if (b.kind === 'reply') return offerReply(botAccepts(m.met, m.walker), now);
    if (b.kind === 'trade') {
      const card = s => (person(s) ? m.cards[s] : m.hidden[s]);
      return resolveTradeNow(card(m.sides[0]), card(m.sides[1]), now);
    }
  }

  // --- bots' turns -----------------------------------------------------------------------------------------------------
  function botCanStep(now) {
    const b = R.bot;
    return R.stage === 'turn' && !!b && b.seat === S.activeIndex && b.afterMeet == null && b.due != null && now >= b.due
      && !R.walk && !R.arrival && !R.clock?.cut && !(local && R.hold.bots);
  }

  // One action of the active bot (main.js botStep / runBotAction; autoplay.js playBotTurn / runAction).
  function botStep(now) {
    const b = R.bot, p = act(), seat = p.index;
    if (++b.steps > STEP_CAP || b.refusals >= REFUSAL_CAP) return endTurnNow(now);
    let a = null;
    try { a = bots.nextAction(seat); } catch { return endTurnNow(now); }
    a = a || { k: 'end' };
    b.last = copy(a);
    let r;
    try { r = runBotAction(p, a, now); } catch { r = no('error'); }
    if (r === 'ended') return;
    if (!r.ok) {
      b.refusals++;
      try { bots.reject(seat, a, R.botRules === 'page' ? 'refused' : (r.reason ?? null)); } catch { /* nothing to tell */ }
      b.due = now + REFUSAL_PAUSE_MS;
      return;
    }
    if (R.bot !== b) return;
    b.due = now + paceOf(seat, a.k === 'move' ? 'move' : 'act') + (a.k === 'move' && R.walkMode === 'atomic' ? walkMsOf(seat, r.rooms) : 0);
  }

  function runBotAction(p, a, now) {
    switch (a.k) {
      case 'end': endTurnNow(now); return 'ended';
      case 'move': {
        const plan = planWalk(S, F, p, a.to);
        if (!plan.ok) return plan;
        startMove(p, plan.rooms, now);
        return ok({ rooms: plan.rooms });
      }
      case 'open': {
        const r = A.openDoor(S, F, p, a.door);
        if (!r.ok && r.reason === 'jammed' && R.botRules === 'page') return ok();   // a discovery, not a mistake
        return r.ok ? ok() : no(r.reason);
      }
      case 'search': { const r = A.search(S, F, p); return r.ok ? ok() : no(r.reason); }
      case 'escape': {
        const r = A.escape(S, F, p);
        if (!r.ok) return no(r.reason);
        finish(now);
        return 'ended';
      }
      case 'job': { const r = useJob(p); return r.ok ? ok() : no(r.reason); }
      case 'card': { const r = playCard(p, a.type, a.card, a.target); return r.ok ? ok() : no(r.reason); }
      case 'trade': {
        if (!canTradeVoluntarily(S, F, p)) return no('noTradeHere');
        const Q = S.players[a.with];
        if (!Q || !Q.alive || Q === p || Q.currentRoom !== p.currentRoom) return no('noPartner');
        startOffer(p, Q, now);
        return ok();
      }
      default: return no('unknownAction');
    }
  }

  function useJob(p) {
    const g = A.canUseRoom(S, F, p);
    if (!g.ok) return g;
    return g.job === 'infirmary' ? A.useInfirmary(S, F, p) : A.useSwitchboard(S, F, p);
  }
  // A card played on your turn (`target`: a Hand Mirror's seat or player id, a key's room id, a Barricade's doorway).
  function playCard(p, type, cardId, target) {
    switch (type) {
      case 'bandage': return A.useBandage(S, p, cardId);
      case 'espresso': return A.useEspresso(S, p, cardId);
      case 'handMirror': {
        const T = Number.isInteger(target) ? S.players[target] : S.players.find(q => q.id === target);
        return A.useHandMirror(S, F, p, cardId, T ? T.id : target);
      }
      case 'barricade': return A.useBarricade(S, F, p, cardId, target);
      case 'masterKey': case 'lockPick': return A.useUnlock(S, F, p, cardId, target);
      default: return no('unknownCard');
    }
  }

  // --- a person's commands -------------------------------------------------------------------------------------------
  function command(seat, cmd, now) {
    switch (cmd.k) {
      case 'answer': return answer(seat, cmd, now);
      case 'ack': return ack(seat, cmd, now);
      case 'back': return no('notNow');                         // pending R7 (stand-ins): not built
      default: break;
    }
    if (R.stage === 'ended' || R.stage === 'start') return no('notNow');
    if (seat !== S.activeIndex) return no('notYourTurn');
    if (cmd.turn != null && cmd.turn !== S.turn) return no('stale');
    const p = P(seat);
    if (cmd.k === 'discard') {
      if (R.stage !== 'discard') return no('notNow');
      if (!p.hand.some(c => c.id === cmd.card)) return no('notYourCard');
      const r = A.discardCard(S, p, cmd.card);
      if (!r.ok) return no(r.reason);
      if (A.overHandLimit(p) > 0) { discardAsk(seat, now); return ok(); }
      delete R.asks[seat];
      // Online the last discard passes the turn at once. Single player: the page shows the last card leaving first (half
      // a second, the clock held) and then ends the turn itself with { k: 'end' }, exactly as it always did.
      if (local) return ok();
      passTurn(now);
      return ok();
    }
    // (Single player: the hand is down to the limit, the discard screen has finished: the turn passes now)
    if (cmd.k === 'end' && local && R.stage === 'discard' && !R.asks[seat] && A.overHandLimit(p) === 0) { passTurn(now); return ok(); }
    // (a walk under way: nothing else now — except, in device walks, a card from the hand: the page lets a guest
    // bandage or drink an Espresso on the way, as it always did; what may be done mid-walk is the page's to offer)
    const walking = R.walk || R.arrival;
    if (R.stage !== 'turn' || (walking && !(R.walkMode === 'device' && cmd.k === 'card')) || R.clock?.cut || R.asks[seat]) return no('notNow');
    switch (cmd.k) {
      case 'move': {
        const plan = planWalk(S, F, p, cmd.to);
        if (!plan.ok) return no(plan.reason);
        startMove(p, plan.rooms, now);
        return { ok: true, result: { rooms: [...plan.rooms] } };
      }
      case 'open': { const r = A.openDoor(S, F, p, cmd.door); return r.ok ? ok() : no(r.reason); }
      case 'search': {
        const r = A.search(S, F, p);
        if (!r.ok) return no(r.reason);
        const cards = r.kind === 'found' || r.kind === 'cards' ? r.cards : r.kind === 'card' ? [r.card] : [];
        addResult(seat, 'found', { cards: cards.map(foundCard), where: r.searchPoint || null, pickup: r.kind === 'found' }, now);
        return ok();
      }
      case 'job': { const r = useJob(p); return r.ok ? ok() : no(r.reason); }
      case 'escape': {
        const r = A.escape(S, F, p);
        if (!r.ok) return no(r.reason);
        finish(now);
        return ok();
      }
      case 'card': {
        if (!p.hand.some(c => c.id === cmd.card)) return no('notYourCard');
        if (cmd.type === 'handMirror') {
          const T = Number.isInteger(cmd.target) ? S.players[cmd.target] : S.players.find(q => q.id === cmd.target);
          if (!T) return no('badTarget');
        }
        const r = playCard(p, cmd.type, cmd.card, cmd.target);
        if (!r.ok) return no(r.reason);
        if (cmd.type === 'handMirror') {
          const T = S.players.find(q => q.id === r.target);
          addResult(seat, 'mirror', { target: T.index, hand: r.hand.map(shownCard) }, now);
        }
        return ok();
      }
      case 'trade': {
        if (R.limits.offerOncePerTurn && R.proposed.includes(seat)) return no('notNow');
        if (!canTradeVoluntarily(S, F, p)) return no('noTradeHere');
        const Q = S.players[cmd.with];
        if (!Q || !Q.alive || Q === p || Q.currentRoom !== p.currentRoom) return no('noPartner');
        startOffer(p, Q, now);
        return ok();
      }
      case 'end': endTurnNow(now); return ok();
      default: return no('unknown');
    }
  }

  // An answer to the seat's own open question. Safe to repeat: the same ask id gets the same reply.
  function answer(seat, cmd, now) {
    const last = R.answered[seat];
    if (last && last.ask === cmd.ask) return copy(last.reply);
    const ra = R.roleAsks[seat];
    if (ra && ra.id === cmd.ask) {
      ackRole(seat, now);
      R.answered[seat] = { ask: cmd.ask, reply: ok() };
      return ok();
    }
    const a = R.asks[seat];
    if (!a || a.id !== cmd.ask || a.kind === 'discard') return no('badAsk');
    const r = applyAnswer(seat, a, cmd.value, now);
    if (r.ok) R.answered[seat] = { ask: a.id, reply: copy(r) };
    return r;
  }

  function applyAnswer(seat, a, value, now) {
    const p = P(seat), m = R.meet;
    switch (a.kind) {
      case 'meetWhom':
        if (!a.candidates.includes(value)) return no('badAsk');
        delete R.asks[seat];
        personMet(value, now);
        return ok();
      case 'meetAct': {
        if (value === 'trade') { delete R.asks[seat]; startTrade(P(m.walker), P(m.met), now, false); return ok(); }
        if (!value || typeof value !== 'object' || typeof value.attack !== 'string') return no('badAsk');
        if (!a.canAttack) return no('badAsk');
        const w = p.hand.find(c => c.id === value.attack);
        if (!w) return no('notYourCard');
        if (!isWeapon(w)) return no('badAsk');
        const r = A.resolveAttack(S, F, p, P(m.met), w.id);
        if (!r.ok) return no(r.reason);
        delete R.asks[seat];
        attackSeen(p, P(m.met), r);
        endMeeting(now);
        return ok();
      }
      case 'tradeCard':
        if (!p.hand.some(c => c.id === value)) return no('notYourCard');
        if (!a.cards.includes(value)) return no('badAsk');
        m.cards[seat] = value;
        delete R.asks[seat];
        afterTradeAnswer(now);
        return ok();
      case 'offer':
        if (typeof value !== 'boolean') return no('badAsk');
        delete R.asks[seat];
        offerReply(value, now);
        return ok();
      default: return no('badAsk');
    }
  }

  // A screen closed (DESIGN §6.3): the role screen, the notes (all, or only `lines`), or one result by id.
  function ack(seat, cmd, now) {
    const p = P(seat);
    switch (cmd.what) {
      case 'role': ackRole(seat, now); return ok();
      case 'notes': {
        if (Array.isArray(cmd.lines)) {
          for (const line of cmd.lines) { const i = p.notes.indexOf(line); if (i >= 0) p.notes.splice(i, 1); }
          for (const r of R.results[seat] || []) if (r.kind === 'notes') r.lines = r.lines.filter(l => p.notes.includes(l));
          R.results[seat] = (R.results[seat] || []).filter(r => r.kind !== 'notes' || r.lines.length);
        } else {
          p.notes.length = 0;
          R.results[seat] = (R.results[seat] || []).filter(r => r.kind !== 'notes');
        }
        return ok();
      }
      case 'result': {
        const list = R.results[seat] || [];
        const i = list.findIndex(r => r.id === cmd.id);
        if (i < 0) return ok();                                  // already acknowledged: safe to repeat
        const [r] = list.splice(i, 1);
        if (r.kind === 'notes') for (const line of r.lines) { const k = p.notes.indexOf(line); if (k >= 0) p.notes.splice(k, 1); }
        return ok();
      }
      default: return no('unknown');
    }
  }

  // A question past its deadline (only under limits that set one: the pending R3/R5): a random guest and Trade, a
  // random ordinary card, or "no". The person is told privately (timedOut).
  function timeOutAsk(seat, a, now) {
    const p = P(seat);
    switch (a.kind) {
      case 'meetWhom': { const pick = a.candidates[pickIndex(a.candidates.length)]; addResult(seat, 'timedOut', { ask: a.kind }, now); applyAnswer(seat, a, pick, now); return; }
      case 'meetAct': addResult(seat, 'timedOut', { ask: a.kind }, now); applyAnswer(seat, a, 'trade', now); return;
      case 'tradeCard': {
        const ordinary = a.cards.filter(id => p.hand.find(c => c.id === id)?.type !== 'possession');
        const pool = ordinary.length ? ordinary : a.cards;
        const id = pool[pickIndex(pool.length)];
        addResult(seat, 'timedOut', { ask: a.kind, gave: p.hand.find(c => c.id === id)?.type ?? null }, now);
        applyAnswer(seat, a, id, now);
        return;
      }
      case 'offer': addResult(seat, 'timedOut', { ask: a.kind }, now); applyAnswer(seat, a, false, now); return;
      default: delete R.asks[seat];
    }
  }

  // --- the stall (TP3, online today): one wait on a person with no time limit over stallMs stops the match ----------
  function stallSince(now) {
    if (local || R.limits.stallMs == null || R.stage === 'ended') return null;
    const starts = [];
    for (const a of Object.values(R.asks)) if (WAIT_KINDS.has(a.kind) && a.deadline == null) starts.push(a.at);
    if (R.limits.screenCapMs == null && counting() && pauseEnd() > now) {
      const seat = R.clock.seat;
      if (R.roleAsks[seat]) starts.push(Math.max(R.roleAsks[seat].at, R.turnAt ?? 0));
      for (const r of R.results[seat] || []) if (SCREEN_KINDS.has(r.kind)) starts.push(Math.max(r.at, R.turnAt ?? 0));
    }
    return starts.length ? Math.min(...starts) : null;
  }

  // --- what each seat is told ------------------------------------------------------------------------------------------
  function phaseFor(seat) {
    const m = R.meet;
    switch (R.stage) {
      case 'start': return { kind: 'start', seats: [] };
      case 'turn': return { kind: 'turn', seats: [S.activeIndex] };
      case 'discard': return { kind: seat === S.activeIndex ? 'discard' : 'turn', seats: [S.activeIndex] };
      case 'meet:whom': case 'meet:act': case 'meet:cards': return { kind: 'meeting', seats: m.met != null ? [m.walker, m.met] : [m.walker] };
      case 'offer': return { kind: 'offer', seats: [m.walker, m.met] };
      default: return { kind: 'ended', seats: [] };
    }
  }
  function clockFor(seat, now) {
    const c = R.clock;
    if (!c || R.stage === 'ended' || R.stage === 'start') return null;
    const left = Math.max(0, leftAt(now));
    const run = running(now);
    if (c.kind === 'discard' && seat !== c.seat) return { seat: c.seat, kind: 'turn', leftMs: Math.max(0, left - c.offset), running: run };
    return { seat: c.seat, kind: c.kind, leftMs: left, running: run };
  }
  function askFor(seat, now) {
    const a = R.asks[seat] || R.roleAsks[seat];
    if (!a) return null;
    const { at, deadline, ...rest } = a;
    const out = copy(rest);
    if (a.kind === 'discard') out.leftMs = R.clock ? Math.max(0, leftAt(now)) : null;
    else out.leftMs = deadline != null ? Math.max(0, deadline - now) : null;
    return out;
  }

  // --- the referee ---------------------------------------------------------------------------------------------------
  const ref = {
    get phase() { return phaseFor(-1); },
    get stage() { return R.stage; },
    get turns() { return R.turns; },
    get walking() { return R.walk ? copy(R.walk) : null; },
    get people() { return [...R.people]; },

    _start(now) {
      if (S.finished) return finish(now);
      const roles = !S.practice && R.people.some(s => !P(s).roleSeen);
      if (!roles) return beginTurn(now);
      R.stage = 'start';
      R.startAt = now;
      for (const s of R.people) if (!P(s).roleSeen && !R.roleAsks[s]) roleAsk(s, now);
      maybeEndStart(now);
    },

    do(seat, cmd, now = R.now) {
      R.now = now;
      if (!cmd || typeof cmd.k !== 'string') return no('unknown');
      if (!person(seat)) return no('notYourTurn');
      settle(now);
      const r = command(seat, cmd, now);
      if (!r.ok) return { ok: false, reason: r.reason ?? 'notNow' };
      return r.result ? { ok: true, result: r.result } : { ok: true };
    },

    tick(now = R.now) {
      R.now = now;
      if (R.stage === 'ended') return false;
      let changed = false;
      settle(now);
      if (clockMode === 'server' && counting() && R.clock.leftMs <= -R.graceMs) { timeUp(now); changed = true; }
      if (R.stage === 'start' && maybeEndStart(now)) changed = true;
      for (const [s, a] of Object.entries(R.asks)) {
        if (a.deadline != null && now >= a.deadline + R.graceMs && R.asks[s] === a) { timeOutAsk(+s, a, now); changed = true; }
      }
      const since = stallSince(now);
      if (since != null && now - since >= R.limits.stallMs) { R.stopped = 'stall'; finish(now); return true; }
      const b = R.bot;
      if (b && b.afterMeet != null && !R.hold.bots && now > b.afterMeet) { b.afterMeet = null; b.due = now + paceOf(b.seat, 'act'); }
      const cap = opts.maxStepsPerTick ?? ONLINE.limits.maxBotStepsPerTick;
      for (let n = 0; n < cap && R.stage !== 'ended'; n++) {
        if (R.beat && now >= R.beat.at) { runBeat(now); changed = true; continue; }
        if (botCanStep(now)) { botStep(now); changed = true; continue; }
        break;
      }
      return changed;
    },

    extras(seat, now = R.now) {
      const since = stallSince(now);
      const banner = ONLINE.timing.stallBannerMs;
      return {
        phase: phaseFor(seat),
        clock: clockFor(seat, now),
        stall: since != null && now - since >= banner ? { leftMs: Math.max(0, R.limits.stallMs - (now - since)) } : null,
        ask: askFor(seat, now),
        results: (R.results[seat] || []).map(({ at, ...r }) => copy(r)),
        end: R.stopped ? { won: null, dawn: false, stopped: R.stopped } : null,
      };
    },

    drain() { const list = R.out; R.out = []; return list; },

    setPresence(seat, presence, now = R.now) {
      R.now = now;
      settle(now);
      if (!person(seat)) return;
      R.presence[seat] = presence === 'gone' || presence === 'hidden' ? presence : 'here';
      if (R.stage === 'start') maybeEndStart(now);
    },

    nextDue() {
      if (R.stage === 'ended') return null;
      const t = [];
      if (R.beat) t.push(R.beat.at);
      const b = R.bot;
      if (b && R.stage === 'turn' && b.due != null && b.afterMeet == null && !R.walk && !R.arrival) t.push(b.due);
      if (b && b.afterMeet != null && !R.hold.bots) t.push(b.afterMeet + 1);     // (local: its pause starts at the next tick)
      for (const a of Object.values(R.asks)) if (a.deadline != null) t.push(a.deadline + R.graceMs);
      if (R.stage === 'start' && R.limits.startAckMs != null) t.push(R.startAt + R.limits.startAckMs);
      if (clockMode === 'server' && counting()) {
        const pe = pauseEnd();
        const from = Math.max(R.clock.at, pe);
        if (Number.isFinite(from)) t.push(from + R.clock.leftMs + R.graceMs);
        if (pe > R.clock.at && Number.isFinite(pe)) t.push(pe);
      }
      const since = stallSince(R.now);
      if (since != null) t.push(since + R.limits.stallMs);
      return t.length ? Math.min(...t) : null;
    },

    toJSON() { return copy(R); },
    setBots(b) { bots = b ?? null; },

    // Move every time the referee holds `ms` later (a restored table: the outage plus ONLINE.timing.restoreGraceMs,
    // DESIGN §10.5), so whoever was playing gets their time back: clocks, deadlines, beats, bot steps, the stall.
    shift(ms) {
      if (!Number.isFinite(ms) || !ms) return;
      const add = o => { if (o) for (const k of ['at', 'deadline', 'due', 'afterMeet']) if (Number.isFinite(o[k])) o[k] += ms; };
      add(R.clock); add(R.beat); add(R.bot);
      for (const a of Object.values(R.asks)) add(a);
      for (const a of Object.values(R.roleAsks)) add(a);
      for (const list of Object.values(R.results)) for (const r of list) add(r);
      for (const k of ['turnAt', 'startAt', 'now']) if (Number.isFinite(R[k])) R[k] += ms;
    },

    // --- local only (Single player, §4.4) ---
    hold({ bots: hb = false, clock: hc = false } = {}) { R.hold = { bots: !!hb, clock: !!hc }; },

    // The frame clock: today's tickTimer (main.js:610-631). Returns true if the turn ended or a walk was cut.
    advance(dtMs, now = R.now) {
      R.now = now;
      if (clockMode !== 'device' || !R.clock || !counting()) return false;
      if (R.limits.devicePauses && R.hold.clock) return false;
      const c = R.clock;
      if (c.leftMs <= 0) return false;
      c.leftMs -= Math.min(FRAME_CAP_MS, Math.max(0, dtMs || 0));
      if (c.leftMs <= 0 && (R.walk || R.arrival)) { cutWalk(); c.leftMs = CUT_HOLD_MS; return true; }
      if (c.leftMs <= 0) { timeUp(now); return true; }
      return false;
    },

    // The active guest's figure crossed into roomId (replaces discovery.update -> enterRoom): adjacent, passable and
    // affordable, as enterRoom is reached today; with or without a walk in progress.
    step(roomId, now = R.now) {
      R.now = now;
      if (R.walkMode !== 'device' || R.stage !== 'turn' || S.finished) return no('notNow');
      const p = act();
      if (roomId === p.currentRoom) return ok();
      const door = doorBetween(F, p.currentRoom, roomId);
      if (!door || !S.discovered.has(roomId)) return no('notAdjacent');
      if (!doorwayPassable(S, door, p.currentRoom)) return no('blocked');
      if (p.actionPoints < moveCostInto(S, roomId)) return no('ap');
      enterRoom(S, F, p, roomId);
      R.arrival = true;
      return ok();
    },

    // The active guest's walk ended (replaces onArrive's rules part): the forced meeting, if any.
    arrived(now = R.now) {
      R.now = now;
      if (R.walkMode !== 'device') return no('notNow');
      R.walk = null;
      if (!R.arrival) return ok();
      R.arrival = false;
      if (R.stage !== 'turn' || S.finished) return ok();
      const p = act();
      const cands = pendingEncounters(S, F, p);
      if (cands.length) startMeeting(p, cands, now, 0);
      return ok();
    },

    // The page could not plan a bot's walk (discovery.planToRoom): a refused action, as today (main.js:1106).
    walkFailed(now = R.now) {
      R.now = now;
      const w = R.walk;
      if (!w) return no('notNow');
      R.walk = null;
      if (R.arrival) return ref.arrived(now);
      const b = R.bot;
      if (b && b.seat === w.seat) {
        b.refusals++;
        try { bots.reject(w.seat, b.last, 'refused'); } catch { /* nothing to tell */ }
        b.due = now + REFUSAL_PAUSE_MS;
      }
      return ok();
    },

    // The person is out: the rest of the match at once (main.js skipToEnd). During a meeting it waits for its end.
    skipToEnd(now = R.now) {
      R.now = now;
      if (R.stage === 'ended') return ok({ finished: !!S.finished });
      if (R.meet) { R.skipQueued = true; return ok({ queued: true }); }
      const arriving = R.arrival && !person(S.activeIndex);
      R.walk = null; R.arrival = false; R.beat = null; R.asks = {}; R.clock = null;
      try {
        if (arriving) runMeeting(S, F, bots, act());
        playOut(S, F, bots, { maxTurns: 600 });
      } catch { /* the page says it could not be finished at once; it plays on */ }
      if (S.finished) finish(now); else beginTurn(now);
      return ok({ finished: !!S.finished });
    },

    // The clock hooks of the page's tests (forceTimeUp, setTimeLeft, timeLeft): milliseconds.
    timeLeft() { return R.clock ? Math.max(0, R.clock.leftMs) : 0; },
    setTimeLeft(ms) { if (!R.clock) return false; R.clock.leftMs = ms; return true; },
  };
  return ref;
}
