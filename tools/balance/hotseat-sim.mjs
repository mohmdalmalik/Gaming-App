// Hot-seat balance simulation (dev tool, not part of the game).
//   node tools/balance/hotseat-sim.mjs
//
// Plays whole matches through the PURE rules engine — no browser, no rendering — with simple
// bots, and prints the numbers the rules audit asked us to keep measuring: how often the guests
// win, how many conversions a match produces, and how long a match runs.
//
// The bots are deliberately honest about what a player can know: they head for the nearest room
// nobody has searched yet, because nothing tells you which rooms hold an objective until you
// search one. The first column is how often a guest keeps a Lantern in their Offer.
//
// These are BOTS, not people: they never talk, never suspect anyone and never co-ordinate, and
// they never waste a turn. Read the output as an upper bound on how fast an efficient table can
// finish, not as a prediction of a real game. See docs/PROGRESS.md for what the numbers say now.
import { rules, applyMode } from '../../src/data/rules.js';
import { floor1 } from '../../src/data/floor1.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { buildFloor } from '../../src/game/floor.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';

applyMode('hotseat', 6);
const floor = buildFloor(floor1, config);
const adj = new Map(floor.roomList.map(r => [r.id, [...r.neighbours]]));

// Shortest room path, honouring the sealed exit.
function pathTo(st, from, targets) {
  const want = new Set(targets);
  if (want.has(from)) return [from];
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const here = q.shift();
    for (const n of adj.get(here)) {
      if (prev.has(n) || !S.isRoomOpen(st, floor, n)) continue;
      prev.set(n, here);
      if (want.has(n)) { const path = [n]; let c = here; while (c) { path.unshift(c); c = prev.get(c); } return path; }
      q.push(n);
    }
  }
  return null;
}

function match(seed, shield) {
  const st = S.createState(floor, roster.slice(0, 6), seed, { mode: 'hotseat' });
  let conversions = 0, guard = 0;
  while (!st.finished && guard++ < 3000) {
    const p = S.activePlayer(st);
    p.offerLocked = false;
    // Guests offer a Lantern when they have one; the possessed side always tries to convert.
    const card = p.possessed
      ? (p.hand.find(c => c.type !== 'lantern') || p.hand[0] || null)
      : (Math.random() < shield
        ? (p.hand.find(c => c.type === 'lantern') || p.hand.find(c => c.type === 'distraction') || p.hand[0] || null)
        : (p.hand.find(c => c.type !== 'lantern') || null));
    S.setOffer(st, p, card ? card.id : null, p.possessed ? 'possess' : 'trade');

    while (p.actionPoints > 0 && !st.finished) {
      if (A.canSearch(st, floor, p).ok) { A.search(st, floor, p); continue; }
      // Head for the nearest room nobody has searched yet. Players cannot know which rooms hold
      // an objective until they search them, so the bot does not either.
      const unsearched = floor.roomList.filter(r => r.searchable && !st.searchedRooms.has(r.id)).map(r => r.id);
      const targets = S.exitUnlocked(st) && !p.possessed ? [floor.exitRoom] : unsearched;
      const path = targets.length ? pathTo(st, p.currentRoom, targets) : null;
      const step = path && path.length > 1 ? path[1] : null;
      if (!step || S.moveCostInto(st, step) > p.actionPoints) break;
      S.enterRoom(st, floor, p, step);
      const room = floor.rooms.get(p.currentRoom);
      if (room?.isExit) { if (S.checkWin(st, floor, p)) break; continue; }
      const cands = S.pendingEncounters(st, floor, p);
      if (cands.length) {
        const r = A.resolveMeeting(st, floor, p, cands[0]);
        if (r.outcome === 'possessed') conversions++;
        S.lockEncounter(st, p.currentRoom, p.index, cands[0].index);
      }
    }
    if (st.finished) break;
    const r = S.endTurn(st, floor);
    if (r.finished) break;
    S.checkWin(st, floor);
  }
  return { won: st.won, round: st.round, conversions, escaped: st.escaped.size, objectives: st.objectivesFound.size };
}

const N = 400;
console.log(`${N} matches per row, bots that search every room they can reach:\n`);
console.log('  how often a guest shields with a Lantern | guests win | conversions | rounds');
for (const shield of [1, 0.75, 0.5, 0.25, 0]) {
  let guests = 0, conv = 0, roundSum = 0;
  for (let i = 1; i <= N; i++) {
    const m = match(i * 13 + 5, shield);
    if (m.won === 'guests') guests++;
    conv += m.conversions;
    roundSum += Math.min(m.round, rules.roundLimit);
  }
  console.log(`  ${String(Math.round(shield * 100) + '%').padStart(38)} | ${String(Math.round(guests / N * 100) + '%').padStart(10)} | ${(conv / N).toFixed(2).padStart(11)} | ${(roundSum / N).toFixed(1)}`);
}
