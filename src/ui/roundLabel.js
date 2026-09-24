// How the round is written everywhere it appears. Hot-seat counts down to dawn ("Round 3 of 8")
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
