// How the round is written everywhere it appears. A match counts down to dawn ("Round 3 of 8")
// and marks the last one; practice has no deadline, so it is just "Round 3".
import { rules } from '../data/rules.js';
import { isFinalRound } from '../game/state.js';

export function roundLabel(state) {
  if (state.practice) return `Round ${state.round}`;
  return `Round ${Math.min(state.round, rules.roundLimit)} of ${rules.roundLimit}`;
}
export const finalRoundNote = 'Final round — dawn breaks when it ends';   // pass and turn screens
export const finalRoundShort = 'Final round';                              // the header, where space is tight
export const isFinal = state => isFinalRound(state);

// How far through the round the table is, for the guest strip's footer and its "Round ends" marker
// (src/hud.js, src/ui/stripModel.js). Public information only: the seat order and whose turn it is.
// A round is every living guest taking one turn, in seat order (docs/GAME_RULES.md > Turn): it wraps to the
// next round after the last living guest, so `left` counts the active guest's own turn and the living guests
// after them (the dead, and anyone out of the game, never take a turn and are not counted). Null where there
// is nothing to count: practice (one guest, no deadline), or a finished game.
export function roundReadout(state) {
  if (!state || state.practice || state.finished || (state.players?.length ?? 0) < 2) return null;
  let left = 0;
  state.players.forEach((q, i) => { if (i >= state.activeIndex && q.alive && !state.escaped?.has(q.id)) left += 1; });
  left = Math.max(1, left);
  const round = Math.min(state.round, rules.roundLimit);
  const final = isFinal(state);
  const last = left === 1;
  // "3 turns left in Round 2" / "Last turn of Round 2"; in the final round there is no next round, so it says dawn
  // follows ("Round 8 of 8 · Final round" says the same in the header).
  const text = final
    ? `${last ? 'Last turn' : `${left} turns left`} · Dawn after this round`
    : last ? `Last turn of Round ${round}` : `${left} turns left in Round ${round}`;
  return { round, left, last, final, text, capWord: final ? 'Dawn' : 'Round ends' };
}
