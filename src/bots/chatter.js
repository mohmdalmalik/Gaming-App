// THE COMPUTER GUESTS' QUICK CHAT: now and then a bot says one of the preset lines or emotes
// (src/data/chat.js). Small talk — a greeting at the start, "Thank you." after a trade, "Watch out!" when
// attacked, "Good game!" at the end, answers to the player — and talk that carries information:
// "<name> tried to possess me!" after its Lantern burned that guest's soul, "<name> is possessed!" /
// "...is clean." after its Hand Mirror, "I am clean." when it is named, "I trust <name>." after a Lantern
// was handed to it, "I don't trust <name>." about a strong suspect; and the possessed side's lies (a
// counter-accusation against the guest who burned its soul, now and then a false accusation of a clean
// guest it traded with). Pure (no DOM, no THREE, no Node APIs): the interface (src/main.js) asks it every
// so often, and the Node tools and tests do the same.
//
//   const chatter = createChatter(state, floor, [{ index, profile }, ...], seed, BOT_CHAT, botTable);
//   chatter.tick(now, { hold })   [{ seat, id, about?, at }] — at most one line, to send now. `hold`: the
//                                 screen is covered (a private screen, a meeting): nothing is said, and the
//                                 lines waiting keep until it clears.
//   chatter.hear(msg, now)        a line anyone at the table said (the player's and the bots' own): a bot
//                                 it names may answer; the player's greeting, "Sorry!" and "Good game!" too.
//
// Without a bot table (src/bots/index.js) it makes small talk only.
//
// What a bot says comes ONLY from what that guest may know: its own view (src/bots/view.js: the public
// events, where everyone is, its own hand and role, ITS OWN private results), its own mind's beliefs
// (src/bots/brain.js, built from that same view and from what was said: botTable.catchUp) and what was
// said at the table. A possessed bot answers being named exactly as a clean one does (the same lines, the
// same chances), so a denial is never a tell, and it never says "I am possessed." during play (now and
// then as its last word, once its side has won and every role is on the end screen). Talking never
// changes the game: only listening does (src/bots/brain.js). It has its own random numbers (one generator
// per bot, from the match seed), so the bots' game decisions draw nothing from it.
import { botView } from './view.js';
import { makeRng } from '../game/cards.js';
import { BOT_CHAT, ABOUT_IDS } from '../data/chat.js';

const mix = (seed, index) => (Math.imul((seed >>> 0) ^ 0x6c8e9cf5, 2246822519) ^ Math.imul(index + 7, 0x85ebca6b)) >>> 0;
// "<name> tried to possess me!" / "<name> is possessed!": strong accusations. Lines that name a guest's
// role or doubt them (a bot named by one may answer). Opinions: one per guest per bot.
const STRONG = new Set(['triedPossess', 'isPossessed']);
const NAMING = new Set(['triedPossess', 'isPossessed', 'stayAway', 'distrustX']);
const OPINION = new Set(['trustX', 'distrustX', 'stayAway']);

export function createChatter(state, floor, seats = [], seed = 1, table = BOT_CHAT, minds = null) {
  const M = table.moments;
  const bots = new Map();      // seat -> its chat memory
  for (const { index, profile } of seats) {
    const style = profile?.style || 'medium';
    const bold = profile?.traits?.boldness ?? 0.5;
    bots.set(index, {
      seat: index,
      bold,
      chat: (table.chattiness[style] ?? 1) * (0.8 + 0.4 * bold),   // how much it talks
      rng: makeRng(mix(seed, index) || 1),
      cursor: { pub: 0, inbox: 0 },
      view: null,                // its view, as it last looked
      started: false, ended: false, alive: true, possessed: false,
      lastSaid: -Infinity,
      pending: null,             // { id, about, due, until, free, farewell, brief, prio, from }
      attackedBy: new Map(),     // seat -> when it saw that guest attack it (for an answer to "Sorry!")
      answeredGreet: new Set(),  // seats whose greeting it has answered
      saidGG: false,             // it has had its last word on the match
      count: { accuse: 0, deny: 0, frame: 0 },
      named: new Set(),          // guests it has accused (a strong line: once a guest)
      exposed: new Set(),        // guests its own Lantern block or Hand Mirror showed are possessed
      opinion: new Set(),        // guests it has said "I trust / I don't trust / Stay away from" about
      partners: [],              // { seat, turn }: the public trades it made
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
  const heardLog = [];            // what was said at the table: { seat, id, about }

  const between = (b, [lo, hi]) => lo + (hi - lo) * b.rng();
  // A weighted pick of what to say; `weigh(id, w)` may change a line's weight for this moment.
  function pick(b, say, weigh) {
    const opts = say.map(([id, w]) => [id, weigh(id, w)]).filter(([, w]) => w > 0);
    const total = opts.reduce((s, [, w]) => s + w, 0);
    let x = b.rng() * total;
    for (const [id, w] of opts) { if ((x -= w) < 0) return id; }
    return opts.length ? opts[opts.length - 1][0] : null;
  }
  // A moment to say something: maybe (its chance, times how chatty this guest is, unless `chance` is
  // given), after a short pause. `about`: the guest a line naming one would name (`aboutOf(id)` when it
  // depends on the line); lines that need one are left out without it, and an opinion it has already
  // given about that guest is not given again. `free`: not held back by the bot's own gap. `farewell`: its
  // last word on the match. A moment with a higher `prio` replaces a line still waiting (`force`: always).
  function moment(b, m, now, { free = !!m.free, weigh = null, force = false, farewell = false, about = null, aboutOf = null, chance = null, from = null } = {}) {
    const prio = m.prio || 0;
    if (b.pending && !force && prio <= (b.pending.prio || 0)) return false;
    if (!free && now - b.lastSaid < table.gapMs) return false;
    const p = chance ?? m.chance * b.chat;
    if (b.rng() >= Math.min(0.95, p)) return false;
    const whom = id => (aboutOf ? aboutOf(id) : about);
    const id = pick(b, m.say, (i, w) => {
      if (ABOUT_IDS.has(i)) {
        const a = whom(i);
        if (a == null || a === b.seat || (OPINION.has(i) && b.opinion.has(a))) return 0;
      }
      return weigh ? weigh(i, w) : w;
    });
    if (!id) return false;
    const due = now + between(b, m.delay);
    b.pending = { id, about: ABOUT_IDS.has(id) ? whom(id) : null, due, until: due + (m.staleMs ?? table.staleMs), free, farewell, brief: !!m.brief, prio, from };
    return true;
  }
  // The chance of a moment that works it out from the bot: base + bold × boldness (+ `extra`).
  const scaled = (b, m, extra = 0) => Math.min(0.95, (m.base ?? m.chance ?? 0) + (m.bold || 0) * b.bold + extra);

  const othersIn = (view, room) => view.players.filter(p => p.seat !== view.seat && p.alive && !p.escaped && p.room === room);
  const holdsLantern = view => !!view?.me.hand.some(c => c.type === 'lantern');
  const live = (view, s) => { const p = view?.players[s]; return !!p && p.alive && !p.escaped; };
  // The bot's own mind, caught up on what it may know ({ mind, view }, or null without a bot table).
  const mindOf = s => (minds?.catchUp ? minds.catchUp(s) || null : null);
  // Does this clean guest know `s` is possessed? (its own Lantern block or Hand Mirror; its mind: also
  // what the Switchboard's count proved)
  const knowsPossessed = (b, s) => b.exposed.has(s) || !!mindOf(b.seat)?.mind.mem.known.has(s);

  // How suspicious the rest of the table looks to this clean guest (the mean of its estimates), 0 … 1.
  function avgSusp(l) {
    const c = l.mind.context(l.view);
    const ps = c.others.map(q => l.mind.pPoss(c, q.seat));
    return ps.length ? ps.reduce((a, x) => a + x, 0) / ps.length : 0.5;
  }

  // --- the start of its own turn: what it believes, and its plans ----------------------------------
  function turnTalk(b, view, now) {
    const l = mindOf(b.seat);
    if (!l || view.round < 2 || view.finished) return;
    const { mind } = l;
    const c = mind.context(l.view);
    const m = mind.mem;
    const others = view.players.filter(p => p.seat !== b.seat && p.alive && !p.escaped).map(p => p.seat);
    if (!view.me.possessed) {
      // the guest it suspects most, if strongly (from what it saw, and what it heard)
      let best = null, bp = 0;
      for (const s of others) {
        if (b.opinion.has(s) || b.named.has(s)) continue;
        const p = mind.pPoss(c, s);
        if (p > bp) { bp = p; best = s; }
      }
      if (best != null && bp >= M.suspects.threshold
        && moment(b, M.suspects, now, { about: best, weigh: (id, w) => (id === 'stayAway' && m.known.has(best) ? w * M.suspects.knownBoost : w) })) return;
      // a guest it trusts a good deal
      const good = others.filter(s => !b.opinion.has(s) && ((m.trust.get(s) || 0) >= 1 || mind.isCleared(s)) && mind.pPoss(c, s) < 0.15);
      if (good.length && moment(b, M.vouches, now, { about: good[Math.floor(b.rng() * good.length)] })) return;
      if (c.stuck && c.exitKnown && c.lanterns >= 1 && moment(b, M.gather, now)) return;
      if (c.stuck && c.lanterns < 2 && view.round >= M.askLantern.fromRound && moment(b, M.askLantern, now)) return;
    } else {
      // the same kinds of line, from the other side: doubt a guest who knows what it is (a block, a
      // mirror), vouch for an ally now and then, lure guests to the Fire Exit while holding a soul
      const knows = others.filter(s => m.knowsMe.has(s) && !b.opinion.has(s) && !b.named.has(s));
      if (knows.length && moment(b, M.suspects, now, { about: knows[0] })) return;
      const allies = others.filter(s => m.allies.has(s) && !b.opinion.has(s));
      if (allies.length && moment(b, M.vouches, now, { about: allies[0] })) return;
      if (c.exitKnown && c.possCards > 0 && mind.campRoom(c) === c.me.room && moment(b, M.gather, now)) return;
      if (c.possCards > 0 && view.round >= M.askLantern.fromRound
        && moment(b, M.askLantern, now, { chance: M.askLantern.chance * M.askLantern.possessedShare * b.chat })) return;
      // a false accusation of a clean guest it traded with lately (one a match at most)
      if (b.count.frame < table.caps.frame && b.count.accuse < table.caps.accuse) {
        const lately = b.partners.filter(x => view.turn - x.turn <= M.frame.rounds * view.seats).map(x => x.seat);
        const cand = [...new Set(lately)].filter(s => live(view, s) && !m.allies.has(s) && !m.knowsMe.has(s) && !b.named.has(s));
        // most of all one who named an ally of its own
        const namedAlly = s => heardLog.some(h => h.seat === s && NAMING.has(h.id) && m.allies.has(h.about));
        cand.sort((x, y) => namedAlly(y) - namedAlly(x) || x - y);
        if (cand.length) {
          const want = namedAlly(cand[0]) ? 1 : c.urgency;
          if (moment(b, M.frame, now, { about: cand[0], chance: scaled(b, M.frame, M.frame.late * want) })) {
            b.named.add(cand[0]); b.count.frame++; b.count.accuse++;
            return;
          }
        }
      }
    }
    // either side: after a run of trades, ask for a Switchboard count
    const last = m.readings.length ? m.readings[m.readings.length - 1].seq : 0;
    const since = m.trades.filter(t => t.seq > last).length;
    if (since >= M.checkCount.trades && view.rooms.some(r => r.job === 'switchboard')) moment(b, M.checkCount, now);
  }

  // Catch up on what this guest may know since it last looked, and find its moments.
  function look(b, now) {
    const view = botView(state, floor, b.seat, b.cursor);
    const evs = [...view.events.map(e => ({ e, pub: true })), ...view.inbox.map(e => ({ e, pub: false }))].sort((x, y) => x.e.seq - y.e.seq);
    if (view.events.length) b.cursor.pub = view.events[view.events.length - 1].seq;
    b.cursor.inbox += view.inbox.length;
    b.view = view;
    finished = finished || view.finished;
    const alive = view.me.alive && !view.players[b.seat]?.escaped;
    b.alive = alive;
    // possessed since it last looked: what it meant to say about other guests no longer serves it
    if (view.me.possessed && !b.possessed && b.pending?.about != null) b.pending = null;
    b.possessed = view.me.possessed;
    const me = b.seat;
    if (!b.started) {
      b.started = true;
      if (view.round === 1 && !view.finished && alive) moment(b, M.start, now, { free: true });
    }
    // (a match skipped to its end: nothing was seen as it happened)
    if (evs.length > table.backlog) return view;
    for (const { e, pub } of evs) {
      if (pub) {
        if (e.type === 'attack' && e.target === me) {
          b.attackedBy.set(e.by, now);
          moment(b, e.killed ? M.killed : M.attacked, now, { free: !!e.killed, about: e.killed ? null : e.by });
        } else if (!alive) continue;
        else if (e.type === 'attack') moment(b, e.by === me ? M.attacker : M.sawAttack, now);
        else if (e.type === 'trade' && (e.a === me || e.b === me)) b.partners.push({ seat: e.a === me ? e.b : e.a, turn: e.turn });
        else if (e.type === 'mirror' && e.target === me) moment(b, M.mirrored, now);
        else if (e.type === 'switchboard' && e.count > 0) moment(b, M.switchboard, now);
        else if (e.type === 'enter' && e.seat === me) {
          // walked in on someone: a meeting follows (not in a safe room, where nobody meets; the Fire
          // Exit is safe, but a trade may be proposed there)
          const room = view.rooms.find(r => r.id === e.to);
          if (room && (!room.safe || room.isExit) && othersIn(view, e.to).length) moment(b, M.walkIn, now);
        } else if (e.type === 'turn' && e.seat === me && !view.finished) {
          if (view.round >= (M.nearby.fromRound || 1)) {
            const room = view.rooms.find(r => r.id === view.me.room);
            const near = new Set([view.me.room, ...(room?.doors || []).map(d => d.to)]);
            if (view.players.some(p => p.seat !== me && p.alive && !p.escaped && near.has(p.room))) {
              // ("I have a Lantern." is a claim, not proof: now and then a guest without one says it too)
              const lantern = holdsLantern(view) ? 1 : table.lanternBluff;
              moment(b, M.nearby, now, { weigh: (id, w) => (id === 'haveLantern' ? w * lantern : w) });
            }
          }
          turnTalk(b, view, now);
        }
        continue;
      }
      // its own private results
      if (!alive) continue;
      if (e.type === 'traded') {
        // handed a Lantern (the kindest card there is): now and then "I trust <them>." (once a guest) —
        // never, as a clean guest, about one it knows is possessed (a Lantern from them is no comfort)
        const well = e.got === 'lantern' && !b.opinion.has(e.with) && (view.me.possessed || !knowsPossessed(b, e.with));
        moment(b, well ? M.tradedWell : M.traded, now, { about: e.with, from: 'trade' });
      } else if (e.type === 'blockedThem' && !view.me.possessed) {
        // my Lantern burned their soul: I know
        b.exposed.add(e.who);
        if (b.pending?.from === 'trade') b.pending = null;
        if (b.count.accuse < table.caps.accuse && !b.named.has(e.who)) {
          const l = mindOf(me);
          const trustTable = l ? 1 - avgSusp(l) : 0.5;
          if (moment(b, M.blocked, now, { about: e.who, chance: scaled(b, M.blocked, M.blocked.table * trustTable) })) { b.named.add(e.who); b.count.accuse++; }
        }
      } else if (e.type === 'blocked' && view.me.possessed) {
        // they burned my soul: they know. Muddy it first.
        if (b.pending?.from === 'trade') b.pending = null;
        if (b.count.accuse < table.caps.accuse && !b.named.has(e.by)) {
          if (moment(b, M.counter, now, { about: e.by, chance: scaled(b, M.counter) }) && b.pending.id === 'triedPossess') { b.named.add(e.by); b.count.accuse++; }
        }
      } else if (e.type === 'mirrorSaw') {
        const soul = e.hand.includes('possession');
        if (soul) b.exposed.add(e.target);
        if (!view.me.possessed) {
          if (soul && b.count.accuse < table.caps.accuse && !b.named.has(e.target)) {
            if (moment(b, M.sawSoul, now, { about: e.target, chance: scaled(b, M.sawSoul, M.sawSoul.table * 0.5) })) { b.named.add(e.target); b.count.accuse++; }
          } else if (!soul) moment(b, M.sawNoSoul, now, { about: e.target });
        } else if (!soul) {
          // a possessed guest saw no soul: a lie the table could believe (the Hand Mirror was public), or the truth
          const lie = b.count.frame < table.caps.frame && b.count.accuse < table.caps.accuse && !b.named.has(e.target)
            && moment(b, { ...M.frame, say: [['isPossessed', 1]] }, now, { about: e.target, chance: scaled(b, M.frame, M.frame.late) });
          if (lie) { b.named.add(e.target); b.count.frame++; b.count.accuse++; } else moment(b, M.sawNoSoul, now, { about: e.target });
        }
      }
    }
    return view;
  }

  // The match is over: a few of the bots say so (at most M.end.max). Whatever else was waiting to be said
  // is dropped: its moment has passed. A possessed bot whose side won (nobody escaped) may own up.
  function atEnd(now) {
    if (order.every(s => bots.get(s).ended)) return;
    let n = order.filter(s => bots.get(s).saidGG).length;
    const won = !(bots.get(order[0])?.view?.players || []).some(p => p.escaped);
    for (const s of roundTable()) {
      const b = bots.get(s);
      if (b.ended) continue;
      b.ended = true;
      b.pending = null;
      if (n >= M.end.max || b.saidGG) continue;
      if (b.possessed && won && moment(b, M.confess, now, { free: true, force: true, farewell: true })) { n++; continue; }
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
      // At most one line now: the most pressing one whose time has come (then the one waiting longest),
      // if the table has been quiet long enough and (unless it is free) the bot has not spoken for a while.
      let best = null;
      for (const s of order) {
        const b = bots.get(s), p = b.pending;
        if (!p) continue;
        if (now > p.until || (p.about != null && !finished && !live(b.view, p.about))) { b.pending = null; continue; }   // (about a guest now dead or gone)
        if (!b.alive && !p.farewell && p.id !== 'gasp') { b.pending = null; continue; }
        if (now < p.due || (!p.free && now - b.lastSaid < table.gapMs)) continue;
        const bp = best?.pending;
        if (!best || (p.prio || 0) > (bp.prio || 0) || ((p.prio || 0) === (bp.prio || 0) && p.due < bp.due)) best = b;
      }
      if (!best || now - lastTableAt < (finished ? table.endGapMs : table.tableGapMs)) return [];
      const p = best.pending;
      const msg = { seat: best.seat, id: p.id, at: now };
      if (p.about != null) msg.about = p.about;
      if (OPINION.has(p.id)) best.opinion.add(p.about);
      if (msg.id === 'gg' || p.farewell) best.saidGG = true;
      best.pending = null;
      best.lastSaid = now;
      lastTableAt = now;
      return [msg];
    },
    // A line said at the table by anyone (these bots included). A line NAMING a bot gets its answer
    // whoever said it; the small-talk answers go to the other guests' lines only (the player's).
    hear(msg, now = msg?.at ?? 0) {
      if (!msg) return;
      heardLog.push({ seat: msg.seat, id: msg.id, about: msg.about ?? null });
      const fromBot = bots.has(msg.seat);
      const alive = s => bots.get(s).alive;      // (as its own view last showed it)
      if (!finished && msg.about != null && msg.about !== msg.seat && NAMING.has(msg.id) && bots.has(msg.about) && alive(msg.about)) {
        // named: "I am clean." or "I don't trust <them>." — possessed or clean, the same chances
        const b = bots.get(msg.about);
        const strong = STRONG.has(msg.id) || msg.id === 'stayAway';
        if (!strong || b.count.deny < table.caps.deny) {
          const m = strong ? M.accusedStrong : M.accusedWeak;
          if (moment(b, m, now, { about: msg.seat, chance: strong ? m.chance : m.chance * b.chat }) && strong) b.count.deny++;
        }
      }
      if (!finished && msg.about != null && NAMING.has(msg.id)) {
        // a possessed bot hears an ally named: doubt the one who named them, or vouch for the ally
        for (const s of order) {
          const b = bots.get(s);
          if (s === msg.seat || s === msg.about || !b.alive || !b.possessed) continue;
          const l = mindOf(s);
          if (!l || !l.mind.mem.allies.has(msg.about)) continue;
          moment(b, M.allyNamed, now, { aboutOf: id => (id === 'trustX' ? msg.about : msg.seat),
            weigh: (id, w) => (id === 'distrustX' && l.mind.mem.allies.has(msg.seat) ? 0 : w) });   // (never doubts an ally)
        }
      }
      if (!finished && msg.id === 'whoLantern') {
        // one bot may answer (mostly while it holds one; the same chances whatever its role)
        for (const s of roundTable()) {
          const b = bots.get(s);
          if (s === msg.seat || !alive(s)) continue;
          const lantern = holdsLantern(b.view) ? 1 : table.lanternBluff;
          if (moment(b, M.answerLantern, now, { chance: M.answerLantern.chance * lantern * b.chat })) break;
        }
      }
      if (fromBot) return;
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
