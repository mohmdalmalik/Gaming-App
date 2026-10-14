// The end screen's one-line recap of how the possession spread (the words: src/data/endScreen.js). Pure: it
// reads the finished game's own record (who is possessed, and `convertedBy`, the guest whose soul did it), so
// a test can run it. Only used once the match is over, when every guest's side is revealed anyway.
import { END_WORDS } from '../data/endScreen.js';

// `humanIndex`: the player's own seat (named "you"). Returns '' when nobody was possessed.
export function endRecap(state, humanIndex = -1, words = END_WORDS) {
  const first = state.players.find(p => p.possessed && p.convertedBy == null);
  if (!first) return '';
  const named = p => ({ name: p.name, you: p.index === humanIndex });
  const direct = state.players.filter(p => p.possessed && p.convertedBy === first.id);
  const later = state.players.filter(p => p.possessed && p !== first && p.convertedBy !== first.id).length;
  return words.recap({ first: named(first), direct: direct.map(named), later });
}
