// THE COMPUTER GUESTS' QUICK CHAT: now and then a bot says one of the preset lines or emotes
// (src/data/chat.js) — a greeting at the start, "Thank you." after a trade, "Watch out!" when attacked,
// "Good game!" at the end, an answer to the player's greeting, a word about its plan or a bluff. Pure (no
// DOM, no THREE, no Node APIs): the interface (src/main.js) asks it every so often, and tests do the same
// in Node (tests/chat-check.mjs).
//
//   const chatter = createChatter(state, floor, [{ index, profile }, ...], seed);
//   chatter.tick(now, { hold })   [{ seat, id, at }] — at most one line, to send now. `hold`: the screen is
//                                 covered (a private screen, a meeting): nothing is said, and the moments
//                                 waiting keep until it clears.
//   chatter.hear(msg)             a message someone else at the table sent (the player): it may answer.
//
// Like the bots' game decisions (src/bots/index.js), what a bot says comes ONLY from what that guest may
// know: its own view (src/bots/view.js: the public events, where everyone is, its own hand) and what was
// said at the table. It never reads its private inbox (what it was given in a trade, a Lantern block,
// being possessed): nothing it learned in private shows in what it says, and a possessed bot talks —
// bluffs included — exactly as often and as warmly as a clean one. Chat never feeds back into the game:
// the bots' decisions and the rules never see it. It has its own random numbers (one generator per bot,
// from the match seed), so the game plays out the same with or without it.
import { botView } from './view.js';
import { makeRng } from '../game/cards.js';
import { BOT_CHAT } from '../data/chat.js';

const mix = (seed, index) => (Math.imul((seed >>> 0) ^ 0x6c8e9cf5, 2246822519) ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0;

export function createChatter(state, floor, seats = [], seed = 1, table = BOT_CHAT) {
  const M = table.moments;
  const bots = new Map();      // seat -> its chat memory
  for (const { index, profile } of seats) {
    const style = profile?.style || 'medium';
    const bold = profile?.traits?.boldness ?? 0.5;
    bots.set(index, {
      seat: index,
      chat: (table.chattiness[style] ?? 1) * (0.8 + 0.4 * bold),   // how much it talks
      rng: makeRng(mix(seed, index) || 1),
      // (its private inbox is never read: the cursor starts past its end, so the view's inbox is empty)
      cursor: { pub: 0, inbox: Infinity },
      started: false, ended: false, alive: true,
      lastSaid: -Infinity,
      pending: null,             // { id, due, until, free, farewell, brief }
      attackedBy: new Map(),     // seat -> when it saw that guest attack it (for an answer to "Sorry!")
      answeredGreet: new Set(),  // seats whose greeting it has answered
      saidGG: false,             // it has had its last word on the match ("Good game!", or a smile at the end)
    });
  }
  const order = [...bots.keys()].sort((a, b) => a - b);
  // Who answers first when only a few may (a greeting, the end): a fair turn round the table, from its
  // own random numbers (what was said is public: nobody's hand or role plays any part).
  const tableRng = makeRng(mix(seed, 101) || 1);
  const roundTable = () => { const k = Math.floor(tableRng() * order.length); return [...order.slice(k), ...order.slice(0, k)]; };
  let lastTableAt = -Infinity;    // the bots' last line (any bot)
  let lastTick = null;
  let finished = false;           // the match is over (public)

  const between = (b, [lo, hi]) => lo + (hi - lo) * b.rng();
  // A weighted pick of what to say; `weigh(id, w)` may change a line's weight for this moment.
  function pick(b, say, weigh = (id, w) => w) {
    const opts = say.map(([id, w]) => [id, weigh(id, w)]).filter(([, w]) => w > 0);
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let x = b.rng() * total;
    for (const [id, w] of opts) { if ((x -= w) < 0) return id; }
    return opts.length ? opts[opts.length - 1][0] : null;
  }
  // A moment to say something: maybe (its chance, times how chatty this guest is), after a short pause.
  // `free`: not held back by the bot's own gap (a reply, the end of the match).
  // `farewell`: its last word on the match (it then says nothing more, not even to answer "Good game!").
  // A `brief` moment (data) is gone if a screen covers the game before it is said.
  function moment(b, m, now, { free = false, weigh, force = false, farewell = false } = {}) {
    if (b.pending && !force) return false;
    if (!free && now - b.lastSaid < table.gapMs) return false;
    if (b.rng() >= Math.min(0.95, m.chance * b.chat)) return false;
    const id = pick(b, m.say, weigh);
    if (!id) return false;
    const due = now + between(b, m.delay);
    b.pending = { id, due, until: due + table.staleMs, free, farewell, brief: !!m.brief };
    return true;
  }

  const othersIn = (view, room) => view.players.filter(p => p.seat !== view.seat && p.alive && !p.escaped && p.room === room);
  const holdsLantern = view => view.me.hand.some(c => c.type === 'lantern');

  // Catch up on what this guest may know since it last looked, and find its moments.
  function look(b, now) {
    const view = botView(state, floor, b.seat, b.cursor);
    const evs = view.events;
    if (evs.length) b.cursor.pub = evs[evs.length - 1].seq;
    finished = finished || view.finished;
    const alive = view.me.alive && !view.players[b.seat]?.escaped;
    b.alive = alive;
    const me = b.seat;
    if (!b.started) {
      b.started = true;
      if (view.round === 1 && !view.finished && alive) moment(b, M.start, now, { free: true });
    }
    // (a match skipped to its end: nothing was seen as it happened)
    if (evs.length <= table.backlog) {
      for (const e of evs) {
        if (e.type === 'attack' && e.target === me) {
          b.attackedBy.set(e.by, now);
          moment(b, e.killed ? M.killed : M.attacked, now, { free: !!e.killed });
        } else if (!alive) continue;
        else if (e.type === 'attack') moment(b, e.by === me ? M.attacker : M.sawAttack, now);
        else if (e.type === 'trade' && (e.a === me || e.b === me)) moment(b, M.traded, now);
        else if (e.type === 'mirror' && e.target === me) moment(b, M.mirrored, now);
        else if (e.type === 'switchboard' && e.count > 0) moment(b, M.switchboard, now);
        else if (e.type === 'enter' && e.seat === me) {
          // walked in on someone: a meeting follows (not in a safe room, where nobody meets; the Fire
          // Exit is safe, but a trade may be proposed there)
          const room = view.rooms.find(r => r.id === e.to);
          if (room && (!room.safe || room.isExit) && othersIn(view, e.to).length) moment(b, M.walkIn, now);
        } else if (e.type === 'turn' && e.seat === me && view.round >= (M.nearby.fromRound || 1) && !view.finished) {
          const room = view.rooms.find(r => r.id === view.me.room);
          const near = new Set([view.me.room, ...(room?.doors || []).map(d => d.to)]);
          if (view.players.some(p => p.seat !== me && p.alive && !p.escaped && near.has(p.room))) {
            // ("I have a Lantern." is a claim, not proof: now and then a guest without one says it too)
            const lantern = holdsLantern(view) ? 1 : table.lanternBluff;
            moment(b, M.nearby, now, { weigh: (id, w) => (id === 'haveLantern' ? w * lantern : w) });
          }
        }
      }
    }
    return view;
  }

  // The match is over: a few of the bots say so (at most M.end.max), in seat order. Whatever else was
  // waiting to be said is dropped: its moment has passed.
  function atEnd(now) {
    if (order.every(s => bots.get(s).ended)) return;
    let n = order.filter(s => bots.get(s).saidGG).length;
    for (const s of roundTable()) {
      const b = bots.get(s);
      if (b.ended) continue;
      b.ended = true;
      b.pending = null;
      if (n >= M.end.max || b.saidGG) continue;
      if (moment(b, M.end, now, { free: true, force: true, farewell: true })) n++;
    }
  }

  return {
    has: seat => bots.has(seat),
    seats: () => [...order],
    tick(now, { hold = false } = {}) {
      // While the screen is covered, the waiting lines keep (their clocks stand still), except brief ones.
      if (hold && lastTick != null) {
        const dt = Math.max(0, now - lastTick);
        for (const b of bots.values()) {
          if (b.pending?.brief) b.pending = null;
          else if (b.pending) { b.pending.due += dt; b.pending.until += dt; }
        }
      }
      lastTick = now;
      for (const s of order) look(bots.get(s), now);
      if (finished) atEnd(now);
      if (hold) return [];
      // At most one line now: the one waiting longest whose time has come, if the table has been quiet
      // long enough and (unless it is a reply or the end) the bot has not spoken for a while.
      let best = null;
      for (const s of order) {
        const b = bots.get(s), p = b.pending;
        if (!p) continue;
        if (now > p.until) { b.pending = null; continue; }
        if (now < p.due || (!p.free && now - b.lastSaid < table.gapMs)) continue;
        if (!best || p.due < best.pending.due) best = b;
      }
      if (!best || now - lastTableAt < (finished ? table.endGapMs : table.tableGapMs)) return [];
      const msg = { seat: best.seat, id: best.pending.id, at: now };
      if (msg.id === 'gg' || best.pending.farewell) best.saidGG = true;
      best.pending = null;
      best.lastSaid = now;
      lastTableAt = now;
      return [msg];
    },
    // Someone else at the table said something (only messages from guests that are not these bots).
    hear(msg, now = msg?.at ?? 0) {
      if (!msg || bots.has(msg.seat)) return;
      const alive = s => bots.get(s).alive;      // (as its own view last showed it)
      if (msg.id === 'greet' || msg.id === 'wave') {
        let n = 0;
        for (const s of roundTable()) {
          const b = bots.get(s);
          if (n >= M.answerGreet.max) break;
          if (b.answeredGreet.has(msg.seat) || !alive(s)) continue;
          b.answeredGreet.add(msg.seat);
          if (moment(b, M.answerGreet, now, { free: true })) n++;
        }
      } else if (msg.id === 'sorry') {
        for (const s of order) {
          const b = bots.get(s), when = b.attackedBy.get(msg.seat);
          if (when == null || now - when > M.answerSorry.within) continue;
          b.attackedBy.delete(msg.seat);
          moment(b, M.answerSorry, now, { free: true });
        }
      } else if (msg.id === 'gg' && finished) {
        let n = 0;
        for (const s of roundTable()) {
          const b = bots.get(s);
          if (n >= M.answerGG.max) break;
          if (b.saidGG || b.pending?.farewell) continue;
          if (moment(b, M.answerGG, now, { free: true, force: true, farewell: true })) n++;
        }
      }
    },
  };
}
