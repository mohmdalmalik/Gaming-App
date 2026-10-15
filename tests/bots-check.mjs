// Checks for the computer guests (src/bots/) — fast (well under a minute), no browser.
//   node tests/bots-check.mjs
//
//   1. purity: src/bots/* use no DOM, no THREE, no Node APIs, no Math.random, never the engine's random generator
//   2. the engine additions: structured public events and private inboxes; the forced starting role
//      (state.setup.possessedIndex) leaves the hotel, the deck and the hands exactly as a random deal would
//   3. INFORMATION HONESTY: a bot's view — and every choice it makes — is identical when everything the
//      guest could not know (other guests' hands, roles, private notes and events, the draw pile, the room
//      deck's order) is scrambled, having heard the same lines at the table (quick chat)
//   4. hundreds of seeded all-bot matches at 4, 5 and 6 players: no crash, no refused-action loop, every
//      match ends
//   5. determinism: the same seed plays the same match
//   6. behaviour: possessed bots make friendly trades before trying a Possession card on the same guest; clean
//      bots block with a Lantern; bots escape; the possessed side wins sometimes; possessions are not all in
//      round 1; a possessed bot learns its allies from its own private events (soul cards: a conversion, a
//      soul spent on a guest already possessed, two souls crossed) and never hands a soul to a guest it
//      knows is possessed; profiles and thinking pauses look right
//   7. the table feed (src/ui/feed.js) gives every public line of those matches its icon
//   (and: a possessed bot opens doors in the first two rounds nearly as often as a clean one, so "who has not opened a
//   door yet?" does not give the possessed away; the Hand Mirror shows "likely clean", not "certainly clean")
import fs from 'node:fs';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, makeCard } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { botView } from '../src/bots/view.js';
import { knownPossessed } from '../src/game/knowledge.js';
import { createMind } from '../src/bots/brain.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles, rollProfile, USERNAMES } from '../src/bots/profiles.js';
import { playBotTurn, playOut } from '../src/bots/autoplay.js';
import { createChatter } from '../src/bots/chatter.js';
import { BOT_CHAT } from '../src/data/chat.js';
import { _kindOf as feedKind } from '../src/ui/feed.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);

function newMatch(seed, players, opts = {}) {
  applyMode('match', players);
  const state = S.createState(floor, roster.slice(0, players), seed, { mode: 'match' });
  const rng = makeRng((seed * 2654435761 ^ 0xb075) >>> 0 || 1);
  const profiles = rollProfiles(players, rng);
  state.players.forEach((p, i) => { p.name = profiles[i].username; });
  const seats = (opts.seats ?? profiles.map((_, i) => i)).map(index => ({ index, profile: profiles[index] }));
  const table = createBotTable(state, floor, seats, seed);
  return { state, table, profiles };
}

// --- 1. purity ---------------------------------------------------------------------------------------
console.log('purity of src/bots/');
for (const f of fs.readdirSync(new URL('../src/bots/', import.meta.url))) {
  const src = fs.readFileSync(new URL(`../src/bots/${f}`, import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const bad = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /require\(/, /Math\.random/, /state\.rng/, /\bprocess\./]
    .filter(re => re.test(code));
  check(!bad.length, `${f}: no DOM, THREE, Node API, Math.random or engine random generator${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}
{
  const brain = fs.readFileSync(new URL('../src/bots/brain.js', import.meta.url), 'utf8');
  const imports = [...brain.matchAll(/^import .* from ['"](.*)['"];?$/gm)].map(m => m[1]).sort();
  check(JSON.stringify(imports) === JSON.stringify(['../data/chat.js', '../game/cards.js']),
    `brain.js imports only makeRng from cards.js and how it weighs what it hears (data/chat.js): it reads the view, never the state: ${imports.join(', ')}`);
}

// --- 2. engine additions ---------------------------------------------------------------------------------
console.log('\nengine: events, inboxes, forced role');
{
  const { state } = newMatch(77, 6);
  check(Array.isArray(state.events) && state.events[0]?.type === 'turn' && state.events[0].seat === 0, 'resetState starts the public event list with turn 1');
  check(state.players.every(p => Array.isArray(p.inbox) && p.inbox.length === 0), 'every guest has an empty private inbox');
  const p = state.players[0];
  const door = S.openableDoors(state, floor, p)[0];
  A.openDoor(state, floor, p, door.id);
  const ev = state.events.at(-1);
  check(ev.type === 'open' && ev.seat === 0 && ev.door === door.id && ev.seq === state.events.at(-2).seq + 1 && ev.round === 1, 'opening a door is a public event with seq, round and turn');
  const into = ev.revealed;
  S.enterRoom(state, floor, p, into);
  check(state.events.at(-1).type === 'enter' && state.events.at(-1).from === floor.start.room && state.events.at(-1).to === into, 'walking into a room is a public event');
  // a trade between a possessed and a clean guest in that room
  const P = state.players.find(q => q.possessed), Q = state.players.find(q => !q.possessed && q !== P);
  P.currentRoom = into; Q.currentRoom = into;
  const poss = P.hand.find(c => c.type === 'possession');
  const plain = Q.hand.find(c => c.type !== 'lantern');
  const r = A.resolveTrade(state, floor, P, Q, poss.id, plain.id);
  check(r.ok && r.possessed.length === 1, '(a Possession card passed)');
  check(state.events.at(-1).type === 'trade' && state.events.at(-1).a === P.index && state.events.at(-1).b === Q.index, 'a trade is public: who traded, nothing else');
  const pt = P.inbox.find(e => e.type === 'traded'), qt = Q.inbox.find(e => e.type === 'traded');
  check(pt?.gave === 'possession' && pt.got === plain.type && qt?.got === 'possession', 'each side privately learns what it gave and got');
  check(Q.inbox.some(e => e.type === 'possessed' && e.by === P.index) && P.inbox.some(e => e.type === 'converted' && e.who === Q.index), 'the conversion is private to the two of them');
  check(!state.events.some(e => /possess|lantern|card|hand|gave|got/i.test(JSON.stringify(Object.keys(e)))), 'no public event carries a card, a hand or a role');
  // a block
  const R = state.players.find(q => !q.possessed && q !== Q && q !== P);
  R.currentRoom = into;
  const lan = R.hand.find(c => c.type === 'lantern');
  const qPoss = Q.hand.find(c => c.type === 'possession');
  A.resolveTrade(state, floor, Q, R, qPoss.id, lan.id);
  check(R.inbox.some(e => e.type === 'blockedThem' && e.who === Q.index) && Q.inbox.some(e => e.type === 'blocked' && e.by === R.index), 'a Lantern block is private to the two of them');
  check(R.inbox.find(e => e.type === 'traded').got === null, '(the blocker received nothing: the card burned)');
  // soul cards: a soul handed to a guest already possessed, and two souls crossed (P possessed Q above)
  const S2 = state.players.find(q => !q.possessed && q !== R);
  S2.currentRoom = into;
  const qSoul = () => Q.hand.find(c => c.type === 'possession');
  A.resolveTrade(state, floor, Q, S2, qSoul().id, S2.hand.find(c => c.type !== 'lantern').id);    // Q possesses S2
  check(S2.possessed && S2.hand.filter(c => c.type === 'possession').every(c => c.owner === S2.id) && S2.hand.filter(c => c.type === 'possession').length === rules.soulsOnConvert,
    `a guest possessed gets ${rules.soulsOnConvert} souls of their own (each card carries its owner)`);
  const pub0 = state.events.length;
  A.resolveTrade(state, floor, P, S2, P.hand.find(c => c.type === 'possession').id, S2.hand.find(c => c.type !== 'possession' && c.type !== 'lantern').id);
  check(S2.inbox.some(e => e.type === 'soulSpent' && e.by === P.index) && P.inbox.some(e => e.type === 'alreadyPossessed' && e.who === S2.index),
    'a soul handed to a guest already possessed: private to the two of them (soulSpent / alreadyPossessed)');
  A.resolveTrade(state, floor, P, S2, P.hand.find(c => c.type === 'possession').id, S2.hand.find(c => c.type === 'possession').id);
  check(S2.inbox.some(e => e.type === 'soulsCrossed' && e.with === P.index) && P.inbox.some(e => e.type === 'soulsCrossed' && e.with === S2.index),
    'two souls crossed: private to the two of them (soulsCrossed)');
  check(state.events.slice(pub0).every(e => e.type === 'trade' && Object.keys(e).sort().join() === 'a,b,round,seq,turn,type'), '...and in public only "they traded"');
}
{
  const seed = 4242;
  applyMode('match', 6);
  const a = S.createState(floor, roster.slice(0, 6), seed, { mode: 'match' });
  const deckA = floor.deck.map(t => t.id).join(), drawA = a.drawPile.map(c => c.type).join();
  const handsA = a.players.map(p => p.hand.filter(c => c.type !== 'possession').map(c => c.type).join());
  const randomSeat = a.players.findIndex(p => p.possessed);
  const forced = (randomSeat + 2) % 6;
  const b = { roster: roster.slice(0, 6), mode: 'match', practice: false, setup: { possessedIndex: forced } };
  S.resetState(b, floor, seed);
  check(b.players[forced].possessed && b.players.filter(p => p.possessed).length === 1, 'state.setup.possessedIndex forces the possessed seat');
  check(b.players[forced].hand.filter(c => c.type === 'possession').length === rules.possessionSupply
    && b.players[forced].hand.filter(c => c.type === 'possession').every(c => c.owner === b.players[forced].id), `...with the ${rules.possessionSupply} Possession cards, all their own souls`);
  check(floor.deck.map(t => t.id).join() === deckA && b.drawPile.map(c => c.type).join() === drawA
    && b.players.every((p, i) => p.hand.filter(c => c.type !== 'possession').map(c => c.type).join() === handsA[i]),
  'the hotel, the deck and every hand are exactly as without forcing (the random pick is still drawn)');
  check(a.rng() === b.rng(), "the engine's random sequence continues the same");
}

// --- 3. information honesty -----------------------------------------------------------------------------
console.log('\ninformation honesty');
const TYPES = Object.keys(rules.deck);
function scramble(state, keepSeat, rng) {
  // Everything the guest at `keepSeat` could not know, replaced at random.
  for (const p of state.players) {
    if (p.index === keepSeat) continue;
    const n = 1 + Math.floor(rng() * 7);
    p.hand = Array.from({ length: n }, () => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
    if (rng() < 0.5) p.hand.push(makeCard('possession', { owner: state.players[Math.floor(rng() * state.players.length)].id }));
    p.possessed = rng() < 0.5;
    p.knows = new Set(rng() < 0.5 ? [state.players[keepSeat].id] : []);
    p.notes = ['scrambled'];
    p.inbox = [{ seq: 999999, type: 'possessed', by: keepSeat, souls: 2 }, { seq: 1000000, type: 'soulSpent', by: keepSeat },
      { seq: 1000001, type: 'alreadyPossessed', who: keepSeat }, { seq: 1000002, type: 'soulsCrossed', with: keepSeat }];
    p.convertedBy = 'x';
    p.roleChangePending = rng() < 0.5;
  }
  state.drawPile = state.drawPile.map(() => makeCard(TYPES[Math.floor(rng() * TYPES.length)]));
  state.discardPile = state.discardPile.map(() => makeCard('lantern'));
  for (let i = floor.deck.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [floor.deck[i], floor.deck[j]] = [floor.deck[j], floor.deck[i]]; }
}
function snapshot(state) {
  return {
    players: state.players.map(p => ({ hand: p.hand, possessed: p.possessed, knows: p.knows, notes: p.notes, inbox: p.inbox, convertedBy: p.convertedBy, roleChangePending: p.roleChangePending })),
    drawPile: state.drawPile, discardPile: state.discardPile, deck: [...floor.deck],
  };
}
function restore(state, snap) {
  state.players.forEach((p, i) => Object.assign(p, snap.players[i]));
  state.drawPile = snap.drawPile; state.discardPile = snap.discardPile;
  floor.deck.length = 0; floor.deck.push(...snap.deck);
}
// What a FRESH mind with this seed chooses, having read everything this seat may know up to now (and
// heard: the lines said at the table, { seq, msg }, the same in both worlds).
function choices(state, seat, profile, heard = []) {
  const mind = createMind(seat, profile, 991);
  const view = botView(state, floor, seat, mind.cursor);
  mind.observe(view, heard);
  const other = (seat + 1) % state.players.length;
  const allowed = A.tradeableCards(state.players[seat]).map(c => c.id);
  const isActive = state.activeIndex === seat;
  return JSON.stringify({
    act: isActive ? mind.nextAction(view) : null,
    give: allowed.length ? mind.tradeCard(view, other, allowed) : null,
    attack: mind.attackWith(view, other),
    meet: mind.meetWhom(view, state.players.map(p => p.index).filter(i => i !== seat)),
    accept: mind.acceptTrade(view, other),
    discard: allowed.length ? mind.discard(view, allowed.filter(id => state.players[seat].hand.find(c => c.id === id)?.type !== 'possession')) : null,
    mem: { known: [...mind.mem.known], allies: [...mind.mem.allies], knowsMe: [...mind.mem.knowsMe], susp: [...mind.mem.susp], trust: [...mind.mem.trust],
      liar: [...mind.mem.liar], allyHint: [...mind.mem.allyHint], hearsay: state.players.map(p => (p.index === seat ? 0 : mind.hearsay(mind.context(view), p.index))) },
  });
}
{
  let views = 0, viewSame = 0, decisions = 0, decisionSame = 0, possessedViews = 0, lines = 0;
  const rng = makeRng(31337);
  for (let k = 0; k < 24; k++) {
    const players = 4 + (k % 3);
    const { state, table, profiles } = newMatch(5000 + k, players);
    // the bots talk at the table as they play (src/bots/chatter.js), and every line is heard
    const chatter = createChatter(state, floor, profiles.map((profile, index) => ({ index, profile })), 600 + k, BOT_CHAT, table);
    const heard = [];
    let now = 0;
    const talk = () => { for (let i = 0; i < 24; i++) { now += 500; for (const m of chatter.tick(now)) { heard.push({ seq: state.eventSeq, msg: m }); table.hear(m); chatter.hear(m, now); } } };
    const stopAt = 6 + (k * 5) % 24;          // somewhere in rounds 2..6
    for (let t = 0; t < stopAt && !state.finished; t++) { playBotTurn(state, floor, table); talk(); }
    if (state.finished) continue;
    lines += heard.length;
    for (const p of state.players) {
      if (!p.alive) continue;
      const seat = p.index;
      const before = JSON.stringify(botView(state, floor, seat));
      const decBefore = choices(state, seat, profiles[seat], heard);
      const snap = snapshot(state);
      scramble(state, seat, rng);
      const after = JSON.stringify(botView(state, floor, seat));
      const decAfter = choices(state, seat, profiles[seat], heard);
      restore(state, snap);
      views++; if (before === after) viewSame++;
      decisions++; if (decBefore === decAfter) decisionSame++;
      if (p.possessed) possessedViews++;
    }
  }
  check(views > 80 && viewSame === views, `a bot's view never changes when hidden information is scrambled (${viewSame}/${views} views, ${possessedViews} of them possessed guests)`);
  check(decisionSame === decisions && lines > 100, `nor does any choice it makes or anything it concludes, having heard the same lines at the table (${decisionSame}/${decisions}; ${lines} lines heard)`);
  const v = botView(newMatch(1, 6).state, floor, 2);
  const keys = JSON.stringify(v.players[0]);
  check(!/hand|possess|name|"id"|knows|notes|inbox/.test(keys), `other guests are seen only as seat, room, health, alive, escaped: ${keys}`);
  check(!('deck' in v) && !('drawPile' in v) && typeof v.roomTilesLeft === 'number', 'no draw pile, no room deck (only how many room tiles are left)');
}
{
  // The engine's random generator is never used by a bot's thinking.
  const { state, table } = newMatch(808, 6);
  for (let t = 0; t < 10; t++) playBotTurn(state, floor, table);
  const orig = state.rng; let calls = 0;
  state.rng = () => { calls++; return orig(); };
  for (const p of state.players) {
    const i = p.index;
    table.nextAction(i); table.meetWhom(i, [0, 1, 2]); table.attackWith(i, (i + 1) % 6); table.acceptTrade(i, (i + 1) % 6);
    const allowed = A.tradeableCards(p).map(c => c.id);
    if (allowed.length) table.tradeCard(i, (i + 1) % 6, allowed);
    table.thinkMs(i, 'trade');
  }
  state.rng = orig;
  check(calls === 0, "bots' thinking never draws from the engine's random generator");
}

{
  // A possessed bot learns its allies from its own private events (soul cards) and never hands them a soul.
  const { state } = newMatch(4321, 6);
  const V = state.players.find(q => q.possessed);
  const [K, L, M] = state.players.filter(q => !q.possessed);
  const soul = X => X.hand.find(c => c.type === 'possession');
  const plain = X => X.hand.find(c => c.type !== 'possession' && c.type !== 'lantern');
  const mindOf = (seat, seed = 7) => {
    const mind = createMind(seat, rollProfile(makeRng(seat + seed)), seed);
    mind.observe(botView(state, floor, seat, mind.cursor));
    return mind;
  };
  A.resolveTrade(state, floor, V, K, soul(V).id, plain(K).id);      // V possesses K
  A.resolveTrade(state, floor, K, L, soul(K).id, plain(L).id);      // K possesses L
  check(mindOf(V.index).mem.allies.has(K.index) && mindOf(K.index).mem.allies.has(V.index) && mindOf(K.index).mem.allies.has(L.index)
    && mindOf(L.index).mem.allies.has(K.index), 'a conversion: the two bots count each other as allies');
  check(!mindOf(V.index).mem.allies.has(L.index) && !mindOf(L.index).mem.allies.has(V.index), '(V and L know nothing of each other yet)');
  A.resolveTrade(state, floor, V, L, soul(V).id, plain(L).id);      // V hands L a soul: L already belongs to the hotel
  check(mindOf(V.index).mem.allies.has(L.index) && mindOf(L.index).mem.allies.has(V.index), 'a soul spent on a guest already possessed: both now count the other as an ally');
  A.resolveTrade(state, floor, K, M, soul(K).id, plain(M).id);      // K possesses M with their second soul
  check(!mindOf(V.index).mem.allies.has(M.index) && !mindOf(M.index).mem.allies.has(V.index), '(V and M know nothing of each other yet)');
  A.resolveTrade(state, floor, V, M, soul(V).id, soul(M).id);       // V and M both hand over a soul
  check(mindOf(V.index).mem.allies.has(M.index) && mindOf(M.index).mem.allies.has(V.index), 'two souls crossed: both now count the other as an ally');
  check([V, K, L, M].every(X => [...knownPossessed(state, X)].every(id => mindOf(X.index).mem.allies.has(state.players.find(q => q.id === id).index))),
    'every guest the rules say a bot knows is possessed (knownPossessed) is one of its allies');
  // Never a soul to an ally, whatever the bot's profile and seed.
  let toAlly = 0, tries = 0;
  for (let k = 0; k < 120; k++) {
    for (const [X, Y] of [[L, V], [L, K], [M, V], [M, K]]) {
      if (!X.hand.some(c => c.type === 'possession')) continue;
      const mind = mindOf(X.index, 100 + k);
      const id = mind.tradeCard(botView(state, floor, X.index, mind.cursor), Y.index, A.tradeableCards(X).map(c => c.id));
      tries++; if (X.hand.find(c => c.id === id)?.type === 'possession') toAlly++;
    }
  }
  check(tries > 200 && toAlly === 0, `a bot never chooses to hand a soul to a guest it knows is possessed (${toAlly} of ${tries} choices)`);
}

{
  // A Hand Mirror that shows no Possession card makes a guest only LIKELY clean (about 25%): a possessed guest who has
  // used or given away every soul shows none too (about one look in three). The Switchboard's count still makes one
  // certain (4%), and a possessed guest's own look clears nobody.
  const { state } = newMatch(6161, 6);
  const V = state.players.find(q => q.possessed);
  const [K, L, M] = state.players.filter(q => !q.possessed);
  V.hand = V.hand.filter(c => c.type !== 'possession');                  // V has spent every soul
  const mirror = X => { const c = makeCard('handMirror'); X.hand.push(c); X.actionPoints = 3; return c.id; };
  const mindOf = (X, seed = 7) => createMind(X.index, rollProfile(makeRng(X.index + seed)), seed);
  const look = (mind, X) => { const view = botView(state, floor, X.index, mind.cursor); mind.observe(view); return { view, c: mind.context(view) }; };
  const mk = mindOf(K);
  look(mk, K);
  const r = A.useHandMirror(state, floor, K, mirror(K), V.id);
  check(r.ok && !r.unmasked, "(a possessed guest with no soul left shows none in a Hand Mirror)");
  let { c } = look(mk, K);
  const pMirror = mk.pPoss(c, V.index);
  check(mk.isLikelyClean(V.index) && !mk.isCleared(V.index), 'a guest shown to hold no Possession card is "likely clean", not certainly clean');
  check(pMirror > 0.2 && pMirror < 0.32, `...a clean bot's estimate for them is about 25%, not 4% (${pMirror.toFixed(2)})`);
  // ...but they cannot possess anyone: no soul, and a soul never comes back until they trade. So a bot does not spend a
  // Lantern blocking them, and does not refuse their trade as it might a stranger's (the role estimate is another matter).
  check(mk.holdsNoSoul(V.index) && !mk.holdsNoSoul(L.index), 'a guest shown no soul, with no trade since, holds none: nothing to fear in a trade with them');
  const blocks = (who, n = 400) => { let k = 0; for (let i = 0; i < n; i++) if (mk.wantsToBlock(c, who)) k++; return k; };
  const bV = blocks(V.index), bL = blocks(L.index);
  check(c.lanterns > 0 && bV === 0 && bL > 0, `...so it never hands them a Lantern to block (${bV} of 400), as it sometimes does a stranger (${bL} of 400)`);
  const view0 = botView(state, floor, K.index, mk.cursor);
  const accepts = (who, n = 600) => { let k = 0; for (let i = 0; i < n; i++) if (mk.acceptTrade(view0, who)) k++; return k / n; };
  const aV = accepts(V.index), aL = accepts(L.index);
  check(aV > aL + 0.08 && aV > 0.55, `...and agrees to their trade more readily than a stranger's (${aV.toFixed(2)} against ${aL.toFixed(2)})`);
  mk.mem.cleared.set(M.index, 0);
  ({ c } = look(mk, K));
  check(mk.isCleared(M.index) && Math.abs(mk.pPoss(c, M.index) - 0.04) < 1e-9, 'a guest the Switchboard cleared stays certainly clean (4%)');
  // they trade: what the mirror showed is out of date
  const plain = X => X.hand.find(c2 => c2.type !== 'possession' && c2.type !== 'lantern');
  A.resolveTrade(state, floor, V, L, plain(V).id, plain(L).id);
  ({ c } = look(mk, K));
  check(!mk.isLikelyClean(V.index), '...until they trade again (then it is out of date)');
  // a possessed bot's own look at a guest clears nobody
  const state2 = newMatch(6161, 6).state;
  const V2 = state2.players.find(q => q.possessed), K2 = state2.players.find(q => !q.possessed);
  const mv = mindOf(V2);
  mv.observe(botView(state2, floor, V2.index, mv.cursor));
  const mc = makeCard('handMirror'); V2.hand.push(mc); V2.actionPoints = 3;
  A.useHandMirror(state2, floor, V2, mc.id, K2.id);
  mv.observe(botView(state2, floor, V2.index, mv.cursor));
  check(mv.mem.mirrorClear.size === 0 && mv.mem.cleared.size === 0 && mv.mem.seenNoPoss.has(K2.index), "a possessed bot's Hand Mirror clears nobody (it only notes what it saw)");
}

// --- 4. many matches ---------------------------------------------------------------------------------------
console.log('\nall-bot matches');
const stats = { matches: 0, unfinished: 0, crashes: 0, refusals: 0, maxRefusalsTurn: 0, jammed: 0, cleanWins: 0, escapes: 0, possessedWins: 0,
  conv: [], firstFriendly: 0, friendlyThenAttempt: 0, blockDecisions: 0, blocks: 0, attacks: 0, voluntary: 0, byPlayers: {},
  soulsToKnown: 0, soulsSpent: 0, knownWrong: 0, knownTotal: 0,
  opens: { poss: { doors: 0, turns: 0 }, clean: { doors: 0, turns: 0 } }, noDoor: { poss: 0, all: 0 } };
// Souls a guest handed to someone it already KNEW was possessed: its own private events replayed in order,
// with what they make certain (src/game/knowledge.js reads the same events).
function soulsToKnownAllies(state, p) {
  const knew = new Set();
  let n = 0;
  for (const e of p.inbox) {
    if (e.type === 'traded' && e.gave === 'possession' && knew.has(e.with)) n++;
    const seat = { possessed: e.by, converted: e.who, blockedThem: e.who, soulSpent: e.by, alreadyPossessed: e.who, soulsCrossed: e.with }[e.type];
    if (seat != null) knew.add(seat);
    if (e.type === 'traded' && e.got === 'possession') knew.add(e.with);
    if (e.type === 'mirrorSaw' && e.hand.includes('possession')) knew.add(e.target);
  }
  return n;
}
const feedLines = new Map();      // every public log line of these matches -> its feed icon (section 7)
for (let k = 0; k < 450; k++) {
  const players = 4 + (k % 3);
  const seed = 10000 + k * 37;
  stats.matches++;
  try {
    const { state, table } = newMatch(seed, players);
    let turns = 0;
    const doors = new Array(players).fill(0);
    let round2Done = false;
    while (!state.finished && turns < 300) {
      const who = S.activePlayer(state), round = state.round, poss = who.possessed;
      const s = playBotTurn(state, floor, table, { maxSteps: 40 });
      turns++;
      const opened = s.actions.filter(a => a.k === 'open').length;
      doors[who.index] += opened;
      if (round <= 2) { const o = stats.opens[poss ? 'poss' : 'clean']; o.doors += opened; o.turns++; }
      // the guests who have opened no door by the end of round 2: how many of them are possessed (the strip and the feed show it all)
      if (!round2Done && state.round > 2) {
        round2Done = true;
        for (const p of state.players) if (p.alive && doors[p.index] === 0) { stats.noDoor.all++; if (p.possessed) stats.noDoor.poss++; }
      }
      const real = s.refusals.filter(r => r.reason !== 'jammed');
      stats.jammed += s.refusals.length - real.length;
      stats.refusals += real.length;
      stats.maxRefusalsTurn = Math.max(stats.maxRefusalsTurn, real.length);
      stats.voluntary += s.meetings.filter(m => m.voluntary).length;
    }
    for (const l of state.log) feedLines.set(l.text, feedKind(l.text)?.icon ?? null);
    if (!state.finished) { stats.unfinished++; continue; }
    const b = (stats.byPlayers[players] ||= { n: 0, clean: 0 });
    b.n++;
    if (state.won === 'humans') { stats.cleanWins++; b.clean++; } else stats.possessedWins++;
    if (state.escaped.size) stats.escapes++;
    for (const p of state.players) for (const e of p.inbox) {
      if (e.type === 'possessed') stats.conv.push(e.round);
      if (e.type === 'blockedThem') stats.blocks++;
      if (e.type === 'alreadyPossessed') stats.soulsSpent++;
      if (e.type === 'soulsCrossed') stats.soulsSpent += 0.5;      // (each of the two is told)
    }
    for (const p of state.players) stats.soulsToKnown += soulsToKnownAllies(state, p);
    // What knownPossessed says a guest knows is always true (possession is never undone).
    for (const p of state.players) for (const id of knownPossessed(state, p)) {
      stats.knownTotal++;
      if (!state.players.find(q => q.id === id)?.possessed) stats.knownWrong++;
    }
    stats.attacks += state.events.filter(e => e.type === 'attack').length;
    for (const p of state.players) {
      const seen = new Map();
      for (const d of table.decisions(p.index)) {
        if (d.k !== 'give') continue;
        if (!d.possessed && d.intent === 'block') stats.blockDecisions++;
        if (!d.possessed || d.intent === 'ally') continue;
        if (!seen.has(d.with)) { seen.set(d.with, d.intent); if (d.intent === 'friendly' && d.possCards > 0) stats.firstFriendly++; }
        else if (seen.get(d.with) === 'friendly' && d.intent === 'attempt') { stats.friendlyThenAttempt++; seen.set(d.with, 'done'); }
      }
    }
  } catch (err) {
    stats.crashes++;
    if (stats.crashes <= 3) console.log(`  crash in match ${seed} (${players} players):`, err.stack);
  }
}
check(stats.crashes === 0, `no crash in ${stats.matches} matches`);
check(stats.unfinished === 0, 'every match ends (an escape, everyone possessed or dead, or dawn)');
check(stats.maxRefusalsTurn <= 2 && stats.refusals <= stats.matches * 0.05, `no refused-action loops: ${stats.refusals} refused actions in all, at most ${stats.maxRefusalsTurn} in one turn (doors that turned out jammed, tried once each: ${stats.jammed})`);
const n = stats.matches - stats.crashes - stats.unfinished;
check(stats.escapes > n * 0.2, `bots escape: ${stats.escapes} of ${n} matches`);
check(stats.possessedWins > n * 0.2, `the possessed side wins too: ${stats.possessedWins} of ${n}`);
for (const [pl, b] of Object.entries(stats.byPlayers)) console.log(`         (${pl} players: clean side ${(100 * b.clean / b.n).toFixed(0)}% of ${b.n})`);
const r1 = stats.conv.filter(r => r === 1).length;
check(stats.conv.length > n * 0.5 && r1 < stats.conv.length * 0.4, `possessions happen, and not all in round 1 (${r1} of ${stats.conv.length} in round 1)`);
check(stats.firstFriendly > n * 0.3 && stats.friendlyThenAttempt > n * 0.15, `possessed bots build trust first: ${stats.firstFriendly} friendly first trades, ${stats.friendlyThenAttempt} later followed by an attempt on the same guest`);
check(stats.blockDecisions > n && stats.blocks > n * 0.3, `clean bots block with a Lantern: ${stats.blockDecisions} Lanterns handed over to block, ${stats.blocks} attempts actually blocked`);
check(stats.attacks > 0, `bots attack now and then (${stats.attacks} attacks in ${n} matches)`);
{
  const rate = o => o.doors / Math.max(1, o.turns);
  check(rate(stats.opens.poss) >= 0.3 * rate(stats.opens.clean) && rate(stats.opens.poss) >= 0.3,
    `a possessed bot opens doors in rounds 1-2 (${rate(stats.opens.poss).toFixed(2)} a turn) at least a third as often as a clean one (${rate(stats.opens.clean).toFixed(2)}): not "never", which gave the possessed away`);
}
check(stats.noDoor.all > 150 && stats.noDoor.poss <= 0.7 * stats.noDoor.all,
  `a guest who has opened no door by the end of round 2 is possessed ${(100 * stats.noDoor.poss / Math.max(1, stats.noDoor.all)).toFixed(0)}% of the time (${stats.noDoor.poss} of ${stats.noDoor.all}; a person looking for the possessed one by the feed would have been right 86-96% of the time before)`);
check(stats.knownWrong === 0 && stats.knownTotal > n, `everything knownPossessed says a guest knows is true (${stats.knownTotal} certainties at the ends of the matches, ${stats.knownWrong} wrong)`);
check(stats.soulsToKnown === 0, `a possessed bot never hands a soul to a guest it knows is possessed (${stats.soulsToKnown}; souls spent on a guest not yet known to be possessed: ${(stats.soulsSpent / Math.max(1, n)).toFixed(2)} a match)`);

// --- 7. the table feed's icons -------------------------------------------------------------------------------
// Every line the rules wrote in those matches gets an icon in the feed; and the rarer lines, and the ones a
// room name could confuse, get the right one.
console.log('\nthe table feed');
{
  const missing = [...feedLines].filter(([, icon]) => !icon).map(([t]) => t);
  check(missing.length === 0, `all ${feedLines.size} different public lines of the matches get a feed icon${missing.length ? ` — none for: ${missing.slice(0, 4).join(' | ')}` : ''}`);
  const want = {
    'Ann and Bo traded.': 'trade', 'Ann and Bo met, but there was no trade.': 'noTrade',
    'Ann attacked Bo with a Knife — fatally.': 'knife', 'Ann attacked Bo with a Revolver.': 'revolver',
    'Ann searched Switchboard.': 'search', 'Ann opened a door: Infirmary.': 'door', 'Ann rang the Switchboard: 2 guests are possessed.': 'phone',
    'Ann was treated in the Infirmary.': 'infirmary', 'Ann escaped through the Fire Exit.': 'escape', 'Ann used a Hand Mirror on Bo.': 'mirror',
    'Ann barricaded a doorway of Kitchen.': 'barricade', 'The Cloakroom door locked again.': 'door',
  };
  const wrong = Object.entries(want).filter(([t, icon]) => feedKind(t)?.icon !== icon).map(([t, icon]) => `${t} -> ${feedKind(t)?.icon} (want ${icon})`);
  check(wrong.length === 0, `each kind of line gets its own icon (a room's name never decides it)${wrong.length ? ` — ${wrong.join(' | ')}` : ''}`);
  check(feedKind('Ann attacked Bo with a Knife — fatally.')?.cls === 'attack fatal', 'a fatal attack is marked as one');
}

// --- 5. determinism -----------------------------------------------------------------------------------------
console.log('\ndeterminism');
{
  const run = (seed, players) => {
    const { state, table } = newMatch(seed, players);
    playOut(state, floor, table, { maxTurns: 300 });
    return JSON.stringify({ won: state.won, round: state.round, events: state.events, inbox: state.players.map(p => p.inbox) });
  };
  let same = 0;
  for (const [seed, pl] of [[123, 6], [456, 5], [789, 4], [2024, 6]]) if (run(seed, pl) === run(seed, pl)) same++;
  check(same === 4, 'the same seed plays the same match, event for event (4 of 4)');
  const a = run(321, 6), b = run(322, 6);
  check(a !== b, 'a different seed plays a different match');
}
{
  // playOut fills in a seat that has no bot (the interface hands over a match the person has left).
  const { state, table } = newMatch(99, 5, { seats: [0, 1, 2, 3] });
  check(!table.has(4), '(seat 4 starts without a bot)');
  const r = playOut(state, floor, table, { maxTurns: 300 });
  check(r.finished && table.has(4), 'playOut finishes the match, adding a bot for the empty seat');
}

// --- 6. profiles and pace ---------------------------------------------------------------------------------
console.log('\nprofiles and pace');
{
  const rng = makeRng(5);
  let dupes = 0, styles = {}, badTraits = 0, badPace = 0;
  for (let k = 0; k < 300; k++) {
    const ps = rollProfiles(6, rng);
    if (new Set(ps.map(p => p.username)).size !== 6) dupes++;
    for (const p of ps) {
      styles[p.style] = (styles[p.style] || 0) + 1;
      if (Object.values(p.traits).some(v => !(v >= 0 && v <= 1))) badTraits++;
      if (!(p.pace >= 0.7 && p.pace <= 1.4)) badPace++;
    }
  }
  check(USERNAMES.length >= 60 && new Set(USERNAMES).size === USERNAMES.length, `${USERNAMES.length} different usernames to draw from`);
  check(USERNAMES.every(u => /^[a-z0-9_]+$/.test(u)), 'usernames are online-style handles (lowercase, digits, underscores)');
  check(dupes === 0, 'no username twice in a match');
  const total = Object.values(styles).reduce((a, b) => a + b, 0);
  check(styles.medium / total > 0.5 && styles.bold / total > 0.1 && styles.careful / total > 0.1,
    `mostly medium, some bold, some careful: ${Object.entries(styles).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(', ')}`);
  check(badTraits === 0 && badPace === 0, 'every trait is between 0 and 1, every pace between 0.7 and 1.4');
  {
    // curiosity (how keen a guest is to open doors, whichever side it plays) varies from guest to guest and takes no random
    // draw of its own, so the guests rolled for a seed are the same ones as before the trait existed
    const cur = [];
    const r2 = makeRng(77);
    for (let k = 0; k < 200; k++) for (const p of rollProfiles(6, r2)) cur.push(p.traits.curiosity);
    const mean = cur.reduce((a, b) => a + b, 0) / cur.length, sd = Math.sqrt(cur.reduce((a, b) => a + (b - mean) ** 2, 0) / cur.length);
    check(cur.every(c => c >= 0.05 && c <= 0.95) && mean > 0.4 && mean < 0.6 && sd > 0.15, `curiosity: every guest has some, from shy to eager (mean ${mean.toFixed(2)}, spread ${sd.toFixed(2)})`);
    let draws = 0;
    const base = makeRng(9);
    rollProfile(() => { draws++; return base(); }, { username: 'zed' });
    check(draws === 25, `rolling a guest takes the same ${draws} random draws as before the curiosity trait (25): the same seed still seats the same guests`);
    const a = rollProfile(makeRng(4), { style: 'medium', username: 'zed' }), b = rollProfile(makeRng(4), { style: 'medium', username: 'zed' });
    check(JSON.stringify(a) === JSON.stringify(b), '...and a profile is the same every time it is rolled from the same numbers');
  }
  const { table } = newMatch(3, 6);
  const kinds = ['turn', 'act', 'move', 'meet', 'attack', 'trade', 'reply', 'discard'];
  let lo = Infinity, hi = 0; const per = {};
  for (const kind of kinds) {
    const xs = [];
    for (let k = 0; k < 400; k++) for (let i = 0; i < 6; i++) xs.push(table.thinkMs(i, kind));
    lo = Math.min(lo, ...xs); hi = Math.max(hi, ...xs);
    per[kind] = Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  }
  check(lo >= 240 && hi <= 3500, `thinking pauses ${lo}–${hi} ms (quicker than a person, an occasional longer "hmm")`);
  check(per.act < per.trade && per.move < per.meet, `typical pauses: ${Object.entries(per).map(([k, v]) => `${k} ${v}`).join(', ')} ms`);
}

console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
if (failures) { console.log(`\n${failures} BOT CHECK(S) FAILED`); process.exit(1); }
console.log('\nALL BOT CHECKS PASSED');
