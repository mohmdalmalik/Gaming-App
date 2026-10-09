// THE MIND OF ONE COMPUTER GUEST. Pure (no DOM, no THREE, no Node APIs); deterministic for a given seed.
//
// A mind reads ONLY the view built by botView (src/bots/view.js) and its own memory. It never sees
// another guest's hand, card count or role, and never touches the engine's random generator: its
// choices come from its own seeded generator. It only PICKS actions; the caller carries them out
// through the rules engine (src/game/*), which refuses anything illegal.
//
// How it plays (see also docs/DECISIONS.md, "Computer guests"):
//   Every guest
//     Utility choice: each step it scores what it could do now (escape, heal, search here, open a door
//     here, use a room's job or a card, trade in the Fire Exit) and where it could walk (rooms to
//     search, rooms with closed doors, the Fire Exit, an Infirmary, the Switchboard, people), minus
//     the walk, and takes the best. Its traits (src/bots/profiles.js) weight the scores; a little
//     noise scaled by its skill makes it imperfect but never absurd. Walking into a room with a guest
//     it has not met there this round forces a meeting, so careful guests route round people.
//   A clean guest
//     Collects Lanterns and heads for the Fire Exit with three (explores to find it). Reasons only from
//     what it saw: who attacked whom, who traded just before the Switchboard count went up (and what
//     the count rules in or out), who traded with a guest it knows is possessed, a Lantern block it
//     made, a Hand Mirror it used. Trust grows with guests who gave it useful cards. In a trade it
//     hands over a Lantern to block when suspicion or caution is high (more readily with two or more
//     Lanterns), otherwise a low-value card — or, now and then, a useful card back to a guest who was
//     kind to it. Attacks only with a reason (a guest it knows is possessed, one who attacked it, a
//     strong suspect when it is aggressive, someone in its way to the exit).
//   A possessed guest
//     Builds trust first: it often makes one or two friendly trades (a Bandage, Flashlight, Espresso,
//     sometimes a Knife, rarely a Lantern) before trying a Possession card on the same guest; prefers
//     targets who gave it something other than a Lantern before (they did not block it); grows
//     impatient as dawn (round 8) nears and as its chances run out; never tries on a guest who knows
//     it or on a possessed guest it knows of; keeps Lanterns away from the clean side; searches to
//     look busy; late in the match some stand guard by the Fire Exit. It knows only the possessed
//     guests it is linked to through conversions (and any it worked out), never the whole team.
import { makeRng } from '../game/cards.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function hash32(...parts) {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    h ^= 0x2f; h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
const metKey = (room, a, b) => `${room}:${Math.min(a, b)}-${Math.max(a, b)}`;
const actionKey = a => `${a.k}|${a.to ?? ''}|${a.door ?? ''}|${a.card ?? ''}|${a.target ?? ''}|${a.with ?? ''}`;

const USEFUL_GIFTS = ['bandage', 'espresso', 'flashlight', 'knife', 'masterKey', 'revolver'];
const WEAPON_DAMAGE = { knife: 1, revolver: 2 };

export function createMind(seat, profile, seed) { return new Mind(seat, profile, seed); }

export class Mind {
  constructor(seat, profile, seed = 1) {
    this.seat = seat;
    this.profile = profile;
    this.t = profile.traits;
    this.seed = seed >>> 0;
    this.rng = makeRng(hash32(this.seed, seat, 'decide') || 1);
    this.paceRng = makeRng(hash32(this.seed, seat, 'pace') || 1);
    this.cursor = { pub: 0, inbox: 0 };
    this.decisions = [];       // what this guest chose and why (its own record; the measuring tools read it)
    this.mem = {
      round: 1,
      // public, as everyone saw it
      tradeCount: new Map(),   // seat -> trades made
      searchCount: new Map(),  // seat -> searches made
      trades: [],              // { a, b, seq }
      attacks: [],             // { by, target, killed, seq }
      readings: [],            // Switchboard: { seq, count, deaths }
      deaths: 0,
      // what this guest worked out or learned privately
      known: new Set(),        // (as clean) guests it knows are possessed
      allies: new Set(),       // (as possessed) possessed guests it knows of
      knowsMe: new Set(),      // (as possessed) guests who know it is possessed
      cleared: new Map(),      // seat -> their trade count when last shown to be clean (a mirror, the Switchboard)
      seenNoPoss: new Map(),   // seat -> their trade count when a mirror showed no Possession card
      seenNoLantern: new Map(),// seat -> { trades, searches } when a mirror showed no Lantern
      susp: new Map(),         // seat -> suspicion from evidence (added to a base rate)
      trust: new Map(),        // seat -> kindness received (useful cards given to me)
      grudge: new Map(),       // seat -> times they attacked me
      gotFrom: new Map(),      // seat -> { lantern, other } what they handed me in trades
      friendly: new Map(),     // (as possessed) seat -> friendly gifts I gave them
      attempts: new Map(),     // seat -> Possession cards I gave them
      pendingAttempt: null,    // { with } a Possession card given; settled by 'converted' / 'blocked'
      possessedSince: null,    // the round I was possessed (null: clean, or the first possessed)
      mirrored: new Set(),     // guests I have used a Hand Mirror on
    };
    this.turnState = null;
  }

  // --- reading what happened ------------------------------------------------------------------------
  observe(view) {
    const evs = [...view.events.map(e => ({ e, pub: true })), ...view.inbox.map(e => ({ e, pub: false }))]
      .sort((x, y) => x.e.seq - y.e.seq);
    for (const { e, pub } of evs) (pub ? this.onPublic(e, view) : this.onPrivate(e, view));
    if (view.events.length) this.cursor.pub = view.events[view.events.length - 1].seq;
    this.cursor.inbox += view.inbox.length;
    // A Possession card handed to a guest who was neither converted nor blocked: they already were possessed.
    const pa = this.mem.pendingAttempt;
    if (pa) { this.mem.allies.add(pa.with); this.mem.pendingAttempt = null; }
    this.mem.round = view.round;
  }

  bump(map, k, d) { map.set(k, (map.get(k) || 0) + d); }

  onPublic(e, view) {
    const m = this.mem, me = this.seat;
    switch (e.type) {
      case 'trade': {
        m.trades.push({ a: e.a, b: e.b, seq: e.seq });
        this.bump(m.tradeCount, e.a, 1); this.bump(m.tradeCount, e.b, 1);
        // Trading with a guest I know is possessed: they may have been converted.
        if (e.a !== me && e.b !== me) {
          for (const [x, y] of [[e.a, e.b], [e.b, e.a]]) {
            if (m.known.has(x) && !m.known.has(y)) this.bump(m.susp, y, 0.3);
          }
        }
        break;
      }
      case 'search': this.bump(m.searchCount, e.seat, 1); break;
      case 'attack': {
        m.attacks.push({ by: e.by, target: e.target, killed: e.killed, seq: e.seq });
        if (e.killed) m.deaths++;
        if (e.by === me) break;
        if (e.target === me) { this.bump(m.grudge, e.by, 1); this.bump(m.susp, e.by, 0.4); break; }
        if (m.known.has(e.target)) { this.bump(m.susp, e.by, -0.2); this.bump(m.trust, e.by, 0.4); break; }
        const liked = (m.trust.get(e.target) || 0) > 0.5 || this.isCleared(e.target);
        this.bump(m.susp, e.by, (liked ? 0.3 : 0.17) + (e.killed ? 0.08 : 0));
        break;
      }
      case 'switchboard': this.onSwitchboard(e, view); break;
      default: break;
    }
  }

  onPrivate(e, view) {
    const m = this.mem;
    switch (e.type) {
      case 'traded': {
        const got = e.got;
        const rec = m.gotFrom.get(e.with) || { lantern: 0, other: 0, useful: 0 };
        if (got === 'lantern') rec.lantern++;
        else if (got && got !== 'possession') { rec.other++; if (USEFUL_GIFTS.includes(got)) rec.useful++; }
        m.gotFrom.set(e.with, rec);
        if (got === 'lantern') { this.bump(m.trust, e.with, 1.0); this.bump(m.susp, e.with, -0.15); }
        else if (got && USEFUL_GIFTS.includes(got)) { this.bump(m.trust, e.with, 0.55); this.bump(m.susp, e.with, -0.05); }
        else if (got && got !== 'possession') this.bump(m.trust, e.with, 0.1);
        if (e.gave === 'possession' && got !== null) m.pendingAttempt = { with: e.with };
        if (got === 'possession') m.allies.add(e.with);        // only the possessed can give one
        break;
      }
      case 'blocked': m.knowsMe.add(e.by); m.pendingAttempt = null; break;
      case 'blockedThem': m.known.add(e.who); m.allies.add(e.who); break;
      case 'possessed':
        m.allies.add(e.by);
        for (const k of m.known) m.allies.add(k);
        m.possessedSince = e.round;
        break;
      case 'converted': m.allies.add(e.who); m.pendingAttempt = null; break;
      case 'mirrorSaw': {
        m.mirrored.add(e.target);
        const tc = m.tradeCount.get(e.target) || 0;
        if (e.hand.includes('possession')) { m.known.add(e.target); m.allies.add(e.target); }
        else { m.seenNoPoss.set(e.target, tc); if (!view.me.possessed) m.cleared.set(e.target, tc); }
        if (!e.hand.includes('lantern')) m.seenNoLantern.set(e.target, { trades: tc, searches: m.searchCount.get(e.target) || 0 });
        break;
      }
      case 'mirroredBy': if (e.hand.includes('possession')) m.knowsMe.add(e.by); break;
      default: break;
    }
  }

  // The Switchboard's count is public. What it rules in or out, from what this guest knows.
  onSwitchboard(e, view) {
    const m = this.mem, me = this.seat;
    const prev = m.readings.length ? m.readings[m.readings.length - 1] : { seq: 0, count: 1, deaths: 0 };
    const deaths = m.deaths - prev.deaths;
    m.readings.push({ seq: e.seq, count: e.count, deaths: m.deaths });
    const iAmPossessed = view.me.possessed;
    const alive = view.players.filter(p => p.alive && !p.escaped && p.seat !== me).map(p => p.seat);
    if (!iAmPossessed) {
      // Trades since the last count that could have converted someone (never mine: I am clean).
      const between = m.trades.filter(t => t.seq > prev.seq && t.seq < e.seq && t.a !== me && t.b !== me);
      const rise = e.count - prev.count + deaths * 0.4;
      if (rise > 0.5 && between.length) {
        const each = Math.min(0.9, rise / between.length);
        for (const t of between) { this.bump(m.susp, t.a, each * 0.8); this.bump(m.susp, t.b, each * 0.8); }
      } else if (rise <= 0 && between.length) {
        for (const t of between) { this.bump(m.susp, t.a, -0.04); this.bump(m.susp, t.b, -0.04); }
      }
      const knownAlive = alive.filter(s => m.known.has(s));
      if (e.count === knownAlive.length) {
        for (const s of alive) if (!m.known.has(s)) m.cleared.set(s, m.tradeCount.get(s) || 0);
      } else {
        const unknown = alive.filter(s => !m.known.has(s));
        if (unknown.length && e.count - knownAlive.length >= unknown.length) for (const s of unknown) m.known.add(s);
      }
    } else {
      const alliesAlive = alive.filter(s => m.allies.has(s));
      if (e.count === alliesAlive.length + 1) {
        for (const s of alive) if (!m.allies.has(s)) m.cleared.set(s, m.tradeCount.get(s) || 0);
      } else {
        const unknown = alive.filter(s => !m.allies.has(s));
        if (unknown.length && e.count - alliesAlive.length - 1 >= unknown.length) for (const s of unknown) m.allies.add(s);
      }
    }
  }

  isCleared(s) {
    const at = this.mem.cleared.get(s);
    return at != null && at === (this.mem.tradeCount.get(s) || 0);
  }

  // How likely `s` is possessed, as a clean guest sees it (0 … 1).
  pPoss(c, s) {
    const m = this.mem;
    if (m.known.has(s)) return 1;
    if (this.isCleared(s)) return 0.04;
    const others = c.others;
    const lastR = m.readings.length ? m.readings[m.readings.length - 1] : null;
    const tradesSince = m.trades.filter(t => (!lastR || t.seq > lastR.seq) && t.a !== this.seat && t.b !== this.seat).length;
    const est = (lastR ? lastR.count : 1) + 0.13 * tradesSince;
    const knownAlive = others.filter(p => m.known.has(p.seat)).length;
    const pool = others.filter(p => !m.known.has(p.seat) && !this.isCleared(p.seat)).length;
    const base = clamp((est - knownAlive) / Math.max(1, pool), 0.03, 0.85);
    const wasCleared = m.cleared.has(s) ? -0.08 : 0;
    const trust = Math.min(m.trust.get(s) || 0, 2.5) * 0.06;
    return clamp(base + (m.susp.get(s) || 0) + wasCleared - trust, 0.02, 0.97);
  }

  // --- the board as this guest sees it ----------------------------------------------------------------
  context(view) {
    const rooms = new Map(view.rooms.map(r => [r.id, r]));
    const me = view.me;
    const here = rooms.get(me.room);
    const met = new Set(view.met);
    const others = view.players.filter(p => p.seat !== this.seat && p.alive && !p.escaped);
    const count = type => me.hand.reduce((n, x) => n + (x.type === type ? 1 : 0), 0);
    const has = type => me.hand.find(x => x.type === type) || null;
    const meetersIn = roomId => {
      const r = rooms.get(roomId);
      if (!r || r.safe) return [];
      return others.filter(p => p.room === roomId && !met.has(metKey(roomId, this.seat, p.seat)));
    };
    const c = {
      view, rooms, me, here, met, others, count, has, meetersIn,
      possessed: me.possessed,
      lanterns: count('lantern'),
      possCards: count('possession'),
      weapons: me.hand.filter(x => x.type === 'knife' || x.type === 'revolver'),
      hasLight: !!has('flashlight'),
      exitKnown: !!view.exitRoom && rooms.has(view.exitRoom),
      othersIn: roomId => others.filter(p => p.room === roomId),
    };
    c.escaping = !c.possessed && c.lanterns >= view.lanternsToEscape;
    c.urgency = clamp((view.round - 1) / Math.max(1, view.roundLimit - 2), 0, 1);
    c.lockedWithLoot = view.rooms.some(r => r.locked && (!r.searched || r.drops));
    c.darkWithLoot = view.rooms.some(r => r.dark && !r.searched);
    // A clean guest short of Lanterns with little left to find by itself starts looking to other guests.
    c.stuck = !c.possessed && !c.escaping && (this.prospects(c) <= 2 || c.urgency >= 0.67);
    return c;
  }

  // Walking costs: Dijkstra over the open doors (never into a locked room, never through a barricade),
  // each room entered costing 1 plus `penalty(roomId)`.
  paths(c, penalty = () => 0) {
    const from = c.me.room;
    const dist = new Map([[from, { d: 0, steps: 0, first: null }]]);
    const done = new Set();
    const refused = this.turnState?.refusedRooms || new Set();
    for (;;) {
      let best = null, bd = Infinity;
      for (const [id, e] of dist) if (!done.has(id) && e.d < bd) { bd = e.d; best = id; }
      if (best == null) break;
      done.add(best);
      const cur = dist.get(best);
      for (const door of c.rooms.get(best)?.doors || []) {
        if (door.barricaded) continue;
        const to = c.rooms.get(door.to);
        if (!to || to.locked) continue;
        if (best === from && refused.has(door.to)) continue;
        const nd = cur.d + 1 + penalty(door.to);
        const e = dist.get(door.to);
        if (!e || nd < e.d - 1e-9) dist.set(door.to, { d: nd, steps: cur.steps + 1, first: cur.first || door.to });
      }
    }
    return dist;
  }

  // How much a card is worth to this guest right now.
  value(c, type, hand = c.me.hand) {
    const t = this.t;
    const dup = hand.filter(x => x.type === type).length;
    let v;
    switch (type) {
      case 'lantern': return c.possessed ? 8.5 : 10;
      case 'possession': return 20;
      case 'flashlight': v = c.darkWithLoot ? 5 : 3; break;
      case 'bandage': v = 3 + (c.me.health < c.view.maxHealth ? 1.5 : 0); break;
      case 'knife': v = 2.5 + 3 * t.aggression; break;
      case 'revolver': v = 3.5 + 3 * t.aggression; break;
      case 'espresso': v = 3; break;
      case 'masterKey': v = c.lockedWithLoot ? 4.5 : 1.8; break;
      case 'lockPick': v = c.lockedWithLoot ? 3 : 1.1; break;
      case 'handMirror': v = 1.8 + 1.6 * t.caution; break;
      case 'barricade': v = 1 + 1.6 * t.caution; break;
      default: v = 1;
    }
    return dup > 1 ? v * 0.55 : v;
  }

  leastValuable(c, cards) {
    const plain = cards.filter(x => x.type !== 'lantern' && x.type !== 'possession');
    const pool = plain.length ? plain : cards.filter(x => x.type !== 'possession');
    const use = pool.length ? pool : cards;
    return [...use].sort((a, b) => this.value(c, a.type) - this.value(c, b.type) || (a.id < b.id ? -1 : 1))[0] || null;
  }

  noise(tag) {
    // Stable within a turn (no dithering back and forth), scaled by how imperfect this guest is.
    const u = hash32(this.seed, this.seat, this.mem.round, this.turnState?.turn ?? 0, tag) / 4294967296;
    return (u - 0.5) * 2 * (1 - this.t.skill) * 1.6;
  }

  record(d) { this.decisions.push({ round: this.mem.round, ...d }); }

  // --- the possessed side: whom to try a Possession card on ------------------------------------------
  isAlly(s) { return this.mem.allies.has(s); }

  // Probability of trying a Possession card on `s` in a trade now.
  attemptChance(c, s) {
    const m = this.mem, t = this.t;
    if (!c.possessed || c.possCards === 0 || this.isAlly(s) || m.knowsMe.has(s)) return 0;
    const nl = m.seenNoLantern.get(s);
    if (nl && nl.trades === (m.tradeCount.get(s) || 0) && nl.searches === (m.searchCount.get(s) || 0)) return 0.97;
    const f = m.friendly.get(s) || 0;
    const got = m.gotFrom.get(s) || { lantern: 0, other: 0, useful: 0 };
    const opportunities = c.others.filter(p => !this.isAlly(p.seat) && !m.knowsMe.has(p.seat)).length;
    const scarce = clamp(1 - opportunities / Math.max(1, c.view.seats - 1), 0, 1);
    const u = Math.max(c.urgency, scarce * 0.8);
    let x = 0.03 + 0.24 * (1 - t.patience);
    if (f >= 1) x += 0.45 + (f >= 2 ? 0.12 : 0);
    x += 0.12 * Math.min(got.other, 2) + 0.08 * Math.min(got.useful, 2) - 0.25 * Math.min(got.lantern, 1);
    x += 0.62 * u;
    if (c.possCards >= 2) x += 0.06;
    if (this.isCleared(s)) x += 0.05;           // certainly clean (the Switchboard): not wasted on an ally
    return clamp(x, 0.02, 0.95);
  }

  // How attractive meeting `s` is for a possessed guest holding a Possession card.
  targetAppeal(c, s) {
    const a = this.attemptChance(c, s);
    const f = this.mem.friendly.get(s) || 0;
    return a + (f === 0 ? 0.35 * this.t.patience : 0.15);
  }

  // --- choosing the next step of the turn ----------------------------------------------------------------
  startTurn(view) {
    if (this.turnState?.turn === view.turn) return;
    this.turnState = { turn: view.turn, refused: new Set(), refusedRooms: new Set(), noSearch: false, proposed: new Set(), steps: 0, lastGoal: null };
  }

  nextAction(view) {
    this.startTurn(view);
    const ts = this.turnState;
    const c = this.context(view);
    if (view.finished || !c.me.alive || view.activeSeat !== this.seat) return { k: 'end' };
    if (++ts.steps > 24) return { k: 'end' };
    const ok = a => !ts.refused.has(actionKey(a));
    const ap = c.me.ap;

    // Escape the moment it is possible.
    if (c.escaping && c.here?.isExit && ap >= 1 && ok({ k: 'escape' })) return { k: 'escape' };

    const opts = this.options(c).filter(o => o.action && ok(o.action));
    opts.sort((a, b) => b.score - a.score);
    let best = opts[0];

    // Out of actions: an Espresso if there is still something worth doing.
    const esp = c.has('espresso');
    if (esp && ok({ k: 'card', type: 'espresso', card: esp.id })) {
      const want = this.wantsEspresso(c, best);
      if (want) return { k: 'card', type: 'espresso', card: esp.id };
    }
    if (ap <= 0) return { k: 'end' };

    if (!best || best.score <= 0.15) {
      const bar = this.barricadeOption(c, true);
      if (bar && ok(bar.action)) return bar.action;
      return { k: 'end' };
    }
    // A little human slack: now and then a guest calls it a turn with an action left and nothing pressing.
    if (best.score < 0.9 && ap <= 2 && this.rng() < 0.12 * (1 - this.t.skill) + 0.04) return { k: 'end' };
    ts.lastGoal = best.goal ?? null;
    if (best.action.k === 'trade') ts.proposed.add(best.action.with);    // one proposal per guest per turn
    return best.action;
  }

  wantsEspresso(c, best) {
    const ap = c.me.ap, t = this.t;
    if (c.escaping && c.exitKnown) {
      const d = this.paths(c, id => this.avoidPenalty(c, id)).get(c.view.exitRoom);
      if (d && d.steps + 1 > ap && d.steps + 1 <= ap + 2) return true;
    }
    if (ap > 0) return false;
    if (!best || best.score < 1.6) return false;
    if (c.escaping) return true;
    return this.rng() < 0.25 + 0.4 * Math.max(t.greed, t.boldness);
  }

  // A penalty for walking into a room where a meeting would be forced.
  avoidPenalty(c, roomId) {
    const ms = c.meetersIn(roomId);
    if (!ms.length) return 0;
    const t = this.t, m = this.mem;
    if (c.possessed) {
      let p = 0;
      for (const q of ms) {
        if (m.knowsMe.has(q.seat)) p += c.weapons.length && t.aggression > 0.55 ? 0 : 2.5;
      }
      return p;
    }
    let p = 0.3 + 2.2 * t.caution - 1.6 * t.boldness;
    if (c.escaping) p = 3 + 2 * t.caution;
    else if (c.lanterns >= 2) p += 0.8 * t.caution;
    for (const q of ms) {
      const pp = this.pPoss(c, q.seat);
      p += pp > 0.5 ? 1.5 : pp * 1.2;
    }
    return Math.max(0, p);
  }

  options(c) {
    const v = c.view, t = this.t, m = this.mem, me = c.me, here = c.here;
    const out = [];
    const add = (score, action, goal = null) => { if (action) out.push({ score, action, goal }); };
    const ap = me.ap;
    const healAt = v.maxHealth - (t.caution > 0.65 ? 1 : t.caution < 0.35 ? 3 : 2);
    const hurt = me.health <= healAt;
    const greedW = 0.75 + 0.5 * t.greed;

    // --- here, now -------------------------------------------------------------------------------
    if (hurt && here?.job === 'infirmary' && me.health < v.maxHealth) add(9, { k: 'job' }, 'heal');
    const bandage = c.has('bandage');
    if (bandage && me.health < v.maxHealth) {
      if (hurt) add(here?.job === 'infirmary' ? 4 : 8, { k: 'card', type: 'bandage', card: bandage.id }, 'heal');
      else if (me.health <= v.maxHealth - 1 && t.caution > 0.6 && c.count('bandage') >= 2) add(0.9, { k: 'card', type: 'bandage', card: bandage.id }, 'heal');
    }
    const canSearchHere = here && here.searchable && !here.isExit && (here.drops || !here.searched)
      && (!here.dark || c.hasLight) && !this.turnState.noSearch;
    if (canSearchHere) {
      let s = (here.drops ? 6 : 2.4 * (here.job === 'linenStore' ? 1.6 : 1)) * greedW + 0.3;
      if (c.escaping) s *= 0.12;
      add(s, { k: 'search' }, 'search:' + here.id);
    }
    if (here?.closed?.length) {
      const door = here.closed[Math.floor(hash32(this.seed, v.turn, here.id) % here.closed.length)];
      add(this.exploreValue(c) + 0.25 + this.noise('open'), { k: 'open', door }, 'explore:' + here.id);
    }
    if (here?.job === 'switchboard' && !me.rangSwitchboardThisTurn) add(this.switchboardValue(c) + 0.2, { k: 'job' }, 'switchboard');
    const unlock = this.unlockOption(c); if (unlock) out.push(unlock);
    const mirror = this.mirrorOption(c); if (mirror) out.push(mirror);
    const vt = this.voluntaryTradeOption(c); if (vt) out.push(vt);
    const bar = this.barricadeOption(c, false); if (bar) out.push(bar);
    if (c.possessed) { const camp = this.campOption(c); if (camp) out.push(camp); }

    // --- somewhere else ----------------------------------------------------------------------------
    const dist = this.paths(c, id => this.avoidPenalty(c, id));
    const stepCost = 0.55 + 0.15 * (1 - t.boldness);
    const go = (roomId, value, goal) => {
      if (roomId === me.room) return;
      const e = dist.get(roomId);
      if (!e || !e.first) return;
      const sticky = this.turnState.lastGoal === goal ? 0.35 : 0;
      add(value - stepCost * e.d + sticky + this.noise(goal), { k: 'move', to: e.first }, goal);
    };
    if (c.escaping) {
      if (c.exitKnown) go(v.exitRoom, 100, 'exit');
      else for (const r of v.rooms) if (r.closed.length) go(r.id, 30, 'explore:' + r.id);
    }
    if (hurt && me.health < v.maxHealth) for (const r of v.rooms) if (r.job === 'infirmary') go(r.id, c.has('bandage') ? 3 : 7, 'heal');
    for (const r of v.rooms) {
      if (r.id === me.room) continue;
      if (r.searchable && !r.isExit && (r.drops || !r.searched) && (!r.dark || c.hasLight)) {
        let s = (r.drops ? 6 : 2.4 * (r.job === 'linenStore' ? 1.6 : 1)) * greedW;
        if (c.escaping) s *= 0.12;
        go(r.id, s, 'search:' + r.id);
      }
      if (r.closed.length && !c.escaping) go(r.id, this.exploreValue(c), 'explore:' + r.id);
      if (r.job === 'switchboard') go(r.id, this.switchboardValue(c), 'switchboard');
    }
    // People: possessed guests look for someone to trade with; bold clean guests seek company; armed
    // guests may go after a guest they know is possessed.
    for (const q of c.others) {
      const room = c.rooms.get(q.room);
      if (!room || room.safe || q.room === me.room) continue;
      const val = this.meetValue(c, q);
      if (val > 0) {
        const e = dist.get(q.room);
        const reach = e && e.steps <= ap ? 1 : 0.6;
        go(q.room, val * reach, 'meet:' + q.seat);
      }
    }
    if (c.possessed) {
      const camp = this.campRoom(c);
      if (camp && camp !== me.room) go(camp, this.campValue(c), 'camp');
    }
    add(0.12, { k: 'end' }, 'end');
    return out;
  }

  exploreValue(c) {
    const t = this.t;
    if (c.view.roomTilesLeft <= 0) return 0;            // every room is on the board: the closed doors are jammed
    if (c.possessed) return c.exitKnown ? 0.3 : 0.55 * (1 - 0.5 * c.urgency) + 0.3 * t.boldness;
    if (c.escaping) return c.exitKnown ? 0.2 : 30;
    if (c.exitKnown) return 0.8 + 0.5 * t.greed;          // a new room still has its card draw
    return (1.5 + 0.55 * Math.min(c.lanterns, 2)) * (0.8 + 0.45 * (1 - t.greed)) + 0.35 * c.urgency;
  }

  // Whether this clean guest still has a way to find Lanterns by itself: rooms whose card draw is unused,
  // or room tiles still to come.
  prospects(c) {
    let n = 0;
    for (const r of c.view.rooms) if (r.searchable && !r.isExit && (r.drops || !r.searched) && (!r.dark || c.hasLight) && !r.locked) n++;
    return n + Math.min(c.view.roomTilesLeft, 4);
  }

  switchboardValue(c) {
    const m = this.mem;
    const last = m.readings.length ? m.readings[m.readings.length - 1].seq : 0;
    const since = m.trades.filter(x => x.seq > last).length;
    if (c.possessed) return since >= 2 ? 0.6 : 0.15;
    if (since === 0) return 0;
    return (since >= 2 ? 1.7 : 0.8) * (0.7 + 0.6 * this.t.caution);
  }

  meetValue(c, q) {
    const t = this.t, m = this.mem;
    const s = q.seat;
    if (c.possessed) {
      if (this.isAlly(s)) return 0;
      if (m.knowsMe.has(s)) {
        // They would block or attack: avoid them, unless armed, aggressive and they are weak.
        const w = c.weapons.length && t.aggression > 0.55;
        return w ? 1.2 * t.aggression + (q.health <= 2 ? 0.8 : 0) : 0;
      }
      if (c.possCards > 0) return 1.0 + 2.6 * this.targetAppeal(c, s) * (0.7 + 0.6 * t.boldness);
      if (c.weapons.length && t.aggression > 0.45) return (0.5 + 1.2 * c.urgency) * t.aggression + (q.health <= 2 ? 1 : 0);
      return 0.25 * t.boldness;
    }
    if (c.escaping) return 0;
    const pp = this.pPoss(c, s);
    if (m.known.has(s)) return c.weapons.length ? 1.2 + 2.2 * t.aggression : 0;
    if ((m.grudge.get(s) || 0) > 0 && c.weapons.length) return 1.6 * t.aggression;
    if (pp > 0.6 && c.weapons.length && t.aggression > 0.55) return 1.4 * t.aggression;
    if (c.stuck && pp < 0.3) return 0.5 + 0.6 * t.boldness + 0.3 * Math.min(m.trust.get(s) || 0, 2);
    return t.boldness > 0.55 && pp < 0.35 ? 0.9 * (t.boldness - 0.4) : 0;
  }

  unlockOption(c) {
    const key = c.has('masterKey') || c.has('lockPick');
    if (!key || c.me.ap < 2) return null;
    for (const d of c.here?.doors || []) {
      if (d.barricaded) continue;
      const r = c.rooms.get(d.to);
      if (!r || !r.locked || (r.searched && !r.drops)) continue;
      if (c.escaping) return null;
      const s = (key.type === 'masterKey' ? 2.9 : 2.0) * (0.75 + 0.5 * this.t.greed) + (c.me.ap >= 3 ? 0.4 : 0);
      return { score: s, action: { k: 'card', type: key.type, card: key.id, target: r.id }, goal: 'unlock' };
    }
    return null;
  }

  mirrorOption(c) {
    const mirror = c.has('handMirror');
    if (!mirror || c.me.ap < 1) return null;
    const m = this.mem;
    let best = null;
    for (const q of c.othersIn(c.me.room)) {
      if (m.mirrored.has(q.seat) && (m.seenNoPoss.get(q.seat) ?? -1) === (m.tradeCount.get(q.seat) || 0)) continue;
      let s;
      if (c.possessed) {
        if (c.possCards === 0 || this.isAlly(q.seat) || m.knowsMe.has(q.seat)) continue;
        s = 0.5 + 0.8 * this.t.skill * (1 - this.t.boldness * 0.5);
      } else {
        if (m.known.has(q.seat) || this.isCleared(q.seat)) continue;
        const pp = this.pPoss(c, q.seat);
        s = (0.4 + 2.6 * pp) * (0.6 + 0.7 * this.t.caution);
        if (c.lanterns >= 2) s += 0.4;
      }
      if (!best || s > best.score) best = { score: s, action: { k: 'card', type: 'handMirror', card: mirror.id, target: q.seat }, goal: 'mirror' };
    }
    return best;
  }

  voluntaryTradeOption(c) {
    const here = c.here;
    if (!here?.safe || here.noTrade) return null;
    const ts = this.turnState, m = this.mem;
    const there = c.othersIn(c.me.room).filter(q => !ts.proposed.has(q.seat));
    if (!there.length) return null;
    if (c.possessed && c.possCards > 0) {
      let best = null;
      for (const q of there) {
        if (this.isAlly(q.seat) || m.knowsMe.has(q.seat)) continue;
        const a = this.targetAppeal(c, q.seat);
        if (!best || a > best.a) best = { a, q };
      }
      if (best && best.a > 0.45) return { score: 1.5 + 2 * best.a, action: { k: 'trade', with: best.q.seat }, goal: 'trade' };
    }
    return null;
  }

  barricadeOption(c, ending) {
    const b = c.has('barricade');
    if (!b || c.me.ap < 1 || c.here?.safe) return null;
    const t = this.t;
    let best = null;
    for (const d of c.here?.doors || []) {
      if (d.barricaded) continue;
      const room = c.rooms.get(d.to);
      if (!room) continue;
      let s = 0;
      if (c.possessed) {
        // Seal the way into the Fire Exit when someone could be heading there.
        if (room.isExit && c.urgency > 0.3) {
          const near = c.others.filter(q => !this.isAlly(q.seat)).length;
          if (near) s = 1.2 + 1.5 * c.urgency * t.skill;
        }
      } else {
        const there = c.othersIn(d.to);
        if (!there.length || room.safe) continue;
        const worst = Math.max(...there.map(q => this.pPoss(c, q.seat)));
        if (worst < 0.3 && t.caution < 0.6) continue;
        s = (0.3 + 1.6 * worst) * t.caution + (c.lanterns >= 2 ? 0.3 : 0);
        if (!ending && c.me.ap > 1) s *= 0.3;
      }
      if (s > 0 && (!best || s > best.score)) best = { score: s, action: { k: 'card', type: 'barricade', card: b.id, target: d.id }, goal: 'barricade' };
    }
    if (best && ending && best.score < 0.5) return null;
    return best;
  }

  // The room next to the Fire Exit: a guest heading out has to pass through it.
  campRoom(c) {
    if (!c.exitKnown) return null;
    const exit = c.rooms.get(c.view.exitRoom);
    const d = exit?.doors?.[0];
    return d ? d.to : null;
  }
  campValue(c) {
    const t = this.t;
    if (c.urgency < 0.45) return 0;
    const w = c.possCards > 0 || (c.weapons.length && t.aggression > 0.45) ? 1 : 0.4;
    return (0.8 + 2.8 * (c.urgency - 0.3)) * (0.5 + 0.7 * t.skill) * w;
  }
  campOption(c) {
    const room = this.campRoom(c);
    if (!room || room !== c.me.room) return null;
    const v = this.campValue(c);
    return v > 0 ? { score: v, action: { k: 'end' }, goal: 'camp' } : null;
  }

  reject(view, action, reason) {
    this.startTurn(view);
    const ts = this.turnState;
    ts.refused.add(actionKey(action));
    if (action.k === 'move') ts.refusedRooms.add(action.to);
    if (action.k === 'search') ts.noSearch = true;
    if (action.k === 'trade') ts.proposed.add(action.with);
  }

  // The interface carried out a voluntary trade proposal (accepted or not).
  proposed(view, withSeat) { this.startTurn(view); this.turnState.proposed.add(withSeat); }

  // --- meetings --------------------------------------------------------------------------------------
  meetWhom(view, candidates) {
    const c = this.context(view);
    const m = this.mem;
    let best = candidates[0], bestS = -Infinity;
    for (const s of candidates) {
      let sc;
      if (c.possessed) {
        if (this.isAlly(s)) sc = -1;
        else if (m.knowsMe.has(s)) sc = c.weapons.length && this.t.aggression > 0.5 ? 0.5 : -2;
        else sc = c.possCards > 0 ? this.targetAppeal(c, s) : 0;
      } else {
        const pp = this.pPoss(c, s);
        sc = c.weapons.length && (m.known.has(s) || (pp > 0.6 && this.t.aggression > 0.55)) ? 2 + pp : -pp + 0.1 * (m.trust.get(s) || 0);
      }
      sc += this.noise('who' + s) * 0.3;
      if (sc > bestS) { bestS = sc; best = s; }
    }
    return best;
  }

  attackWith(view, target) {
    const c = this.context(view);
    const t = this.t, m = this.mem;
    if (!c.weapons.length || c.me.ap < 1 || c.here?.safe) return null;
    const q = view.players[target];
    if (!q || !q.alive) return null;
    let p = 0;
    if (c.possessed) {
      if (this.isAlly(target)) p = 0;
      else if (m.knowsMe.has(target)) p = 0.3 + 0.55 * t.aggression;
      else if (c.possCards > 0) p = q.health <= 2 && t.aggression > 0.6 ? 0.12 * t.aggression : 0;
      else p = 0.06 + 0.4 * t.aggression * (0.5 + c.urgency) + (q.health <= 2 ? 0.15 : 0);
    } else {
      const pp = this.pPoss(c, target);
      if (m.known.has(target)) {
        const seen = m.seenNoPoss.get(target);
        p = seen != null && seen === (m.tradeCount.get(target) || 0) ? 0.85 : 0.35 + 0.55 * t.aggression;
        if (c.lanterns === 0) p = Math.max(p, 0.8);
      } else if ((m.grudge.get(target) || 0) > 0) p = 0.25 + 0.6 * t.aggression;
      else if (pp > 0.55) p = (pp - 0.35) * (0.4 + 1.2 * t.aggression);
      else if (c.escaping && pp > 0.25) p = (pp - 0.15) * (0.5 + t.aggression);
      else p = 0.01 * t.aggression;
    }
    if (!(this.rng() < p)) { this.record({ k: 'meet', with: target, attack: false, possessed: c.possessed }); return null; }
    const knife = c.weapons.find(w => w.type === 'knife');
    const rev = c.weapons.find(w => w.type === 'revolver');
    const w = knife && q.health <= WEAPON_DAMAGE.knife ? knife : rev || knife;
    this.record({ k: 'attack', with: target, weapon: w.type, possessed: c.possessed, reason: c.possessed ? 'possessed' : (m.known.has(target) ? 'known' : 'suspect') });
    return w.id;
  }

  // The card to give in a trade (either side of it). Only cards in `allowed` (what the rules let this
  // guest give) are ever chosen.
  tradeCard(view, other, allowed) {
    const c = this.context(view);
    const m = this.mem, t = this.t;
    const cards = allowed.map(id => c.me.hand.find(x => x.id === id)).filter(Boolean);
    if (!cards.length) return allowed[0];
    const lantern = cards.find(x => x.type === 'lantern');
    const poss = cards.find(x => x.type === 'possession');
    const plain = cards.filter(x => x.type !== 'possession');
    const first = !(m.gotFrom.has(other) || m.friendly.has(other) || m.attempts.has(other));
    const pick = (card, intent) => {
      const chosen = card || this.leastValuable(c, cards) || cards[0];
      if (intent === 'attempt') this.bump(m.attempts, other, 1);
      if (intent === 'friendly' && c.possessed) this.bump(m.friendly, other, 1);
      this.record({ k: 'give', with: other, card: chosen.type, intent, possessed: c.possessed, first, possCards: c.possCards });
      return chosen.id;
    };

    if (c.possessed) {
      if (this.isAlly(other)) return pick(this.leastValuable(c, plain.length ? plain : cards), 'ally');
      if (poss && this.rng() < this.attemptChance(c, other)) return pick(poss, 'attempt');
      if (!plain.length) return pick(poss, 'attempt');                      // nothing else to give
      if (m.knowsMe.has(other)) return pick(this.leastValuable(c, plain), 'plain');
      const f = m.friendly.get(other) || 0;
      let pf = c.possCards > 0 ? (0.5 + 0.4 * t.patience) * (1 - 0.5 * c.urgency) : 0.22;
      if (f >= 2) pf *= 0.35;
      if (this.rng() < pf) {
        const gift = this.giftCard(c, plain);
        if (gift) return pick(gift, 'friendly');
      }
      return pick(this.leastValuable(c, plain), 'plain');
    }

    // Clean.
    if (lantern && this.wantsToBlock(c, other)) return pick(lantern, 'block');
    const pp = this.pPoss(c, other);
    const trust = m.trust.get(other) || 0;
    // Pooling: one escape wins it for every clean guest. Holding a single Lantern with little left to find,
    // hand it to a guest it is fairly sure of — so Lanterns gather on guests who already hold more.
    if (lantern && c.lanterns === 1 && c.stuck && (pp < 0.12 || (trust >= 1 && pp < 0.22)) && this.rng() < 0.4 + 0.4 * t.trust) {
      return pick(lantern, 'pool');
    }
    if (trust >= 0.5 && pp < 0.3 && this.rng() < 0.3 + 0.4 * t.trust) {
      const back = this.giftCard(c, plain.filter(x => x.type !== 'lantern'));
      if (back) return pick(back, 'reciprocate');
    }
    return pick(this.leastValuable(c, plain.length ? plain : cards), 'plain');
  }

  wantsToBlock(c, s) {
    const m = this.mem, t = this.t;
    if (c.lanterns === 0) return false;
    if (m.known.has(s)) {
      const seen = m.seenNoPoss.get(s);
      if (seen != null && seen === (m.tradeCount.get(s) || 0)) return false;   // nothing to block: don't feed them
      return this.rng() < 0.96;
    }
    const pp = this.pPoss(c, s);
    const trust = Math.min(m.trust.get(s) || 0, 2.5);
    let x = -0.42 + 2.05 * pp + 0.62 * t.caution - 0.16 * trust * (0.5 + t.trust)
      + (c.lanterns >= 2 ? 0.14 : 0) + (c.lanterns >= 3 ? 0.3 : 0);
    x += (this.rng() - 0.5) * 0.3 * (1 - t.skill);
    return this.rng() < clamp(x, 0.03, 0.97);
  }

  // A genuinely useful card to give away (a trust-building gift), or null.
  giftCard(c, plain) {
    const t = this.t;
    const pool = plain.filter(x => x.type !== 'possession');
    if (!pool.length) return null;
    const appeal = x => {
      switch (x.type) {
        case 'bandage': return 3;
        case 'espresso': return 2.8;
        case 'flashlight': return c.count('flashlight') >= 2 ? 3 : 2;
        case 'knife': return 2.2 - t.aggression;
        case 'masterKey': return 2;
        case 'revolver': return 0.8 - t.aggression;
        case 'lantern': return c.possessed && c.possCards > 0 && this.rng() < 0.12 * (0.5 + t.patience) ? 3.5 : -5;
        default: return -5;
      }
    };
    const ranked = pool.map(x => ({ x, s: appeal(x) - 0.25 * this.value(c, x.type) })).filter(o => o.s > -2).sort((a, b) => b.s - a.s);
    return ranked.length ? ranked[0].x : null;
  }

  acceptTrade(view, proposer) {
    const c = this.context(view);
    const m = this.mem, t = this.t;
    let p;
    if (c.possessed) p = this.isAlly(proposer) ? 0.9 : m.knowsMe.has(proposer) ? 0.1 : 0.75;
    else if (m.known.has(proposer)) p = c.lanterns && t.caution > 0.5 ? 0.3 : 0.05;
    else p = clamp(0.8 - 1.4 * this.pPoss(c, proposer) + 0.1 * (m.trust.get(proposer) || 0) - 0.3 * t.caution, 0.05, 0.9);
    const yes = this.rng() < p;
    this.record({ k: 'accept', with: proposer, yes, possessed: c.possessed });
    return yes;
  }

  discard(view, ids) {
    const c = this.context(view);
    const cards = ids.map(id => c.me.hand.find(x => x.id === id)).filter(Boolean);
    const d = this.leastValuable(c, cards);
    return d ? d.id : ids[0];
  }

  // How long this guest "thinks" before an action of this kind (ms, before the player's speed setting).
  thinkMs(kind) {
    const r = this.paceRng;
    const RANGE = {
      turn: [600, 1500], act: [350, 1200], move: [350, 1000], meet: [700, 1800], attack: [700, 1700],
      trade: [800, 2000], reply: [700, 1800], discard: [400, 1100],
    };
    const [lo, hi] = RANGE[kind] || RANGE.act;
    let ms = lo + (hi - lo) * (r() + r()) / 2;
    if (r() < 0.07) ms = Math.min(2500, ms + 500 + 900 * r());     // an occasional "hmm"
    return Math.round(ms * (this.profile.pace || 1));
  }
}
