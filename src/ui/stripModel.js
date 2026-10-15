// What the top guest strip shows, worked out as plain data (no page, no three.js) so src/hud.js only has to draw it
// and tests/strip-check.mjs can hold it to the information rules without a browser.
//
// ONE row per guest, in seat order (the turn order): who is playing and who is next, who is out, and whether the
// VIEWER (the person looking at this screen) certainly knows that guest is possessed. That last part is the
// viewer's own knowledge and nothing else (src/ui/allies.js > src/game/knowledge.js): never a guest's real role,
// never a guess, never a guest the viewer is unsure of, and never the viewer's own tile (their own role is shown
// on their own panel, not on the strip). Everything else on the strip is public: where guests are, their health,
// whose turn it is.
import { nextPlayer, isFinalRound } from '../game/state.js';
import { knownPossessedIds } from './allies.js';

export function stripGuests(state, viewer) {
  const match = state.players.length > 1;
  const known = knownPossessedIds(state, viewer);
  const next = nextPlayer(state);
  // (the last turn of the final round is followed by dawn, not by anyone's turn: nobody is "next" then)
  const dawnFollows = isFinalRound(state) && !!next && next.index <= state.activeIndex;
  const nextSeat = !state.finished && next && !dawnFollows ? next.index : -1;
  return state.players.map((q, i) => {
    const out = !!state.escaped?.has(q.id);
    const active = i === state.activeIndex && !state.finished;
    const isNext = i === nextSeat && !active;
    const me = match && q === viewer;
    const flag = out ? 'Out'
      : active ? (me || !match ? 'Your turn' : 'Playing')
        : isNext ? (me ? 'You · next' : 'Next')
          : me ? 'You' : '';
    return { seat: i, id: q.id, active, next: isNext, dead: !q.alive, out, me, flag, known: known.has(q.id) };
  });
}
