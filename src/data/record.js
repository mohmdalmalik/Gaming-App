// Your record (src/record.js keeps the numbers): the words of the main menu's "Your record" screen and
// of the quiet line under the result on the end screen (src/ui/record.js writes them). Plain, short
// English; `n` is always a whole number.
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const RECORD_WORDS = {
  // the end screen, under the result: a match, then practice
  endMatch: r => `Your record: ${plural(r.won, 'win', 'wins')} · ${plural(r.lost, 'loss', 'losses')}`,
  endPractice: r => `Practice escapes on this device: ${r.practiceEscapes}`,
  // the record screen: one side's matches, the escapes, the win rate, and before the first match
  side: s => (s.played ? `${s.played} played · ${s.won} won · ${s.lost} lost` : 'None yet'),
  escaped: n => (n ? plural(n, 'time', 'times') : 'Not yet'),
  practice: n => (n ? plural(n, 'time', 'times') : 'Not yet'),
  left: n => (n ? plural(n, 'match', 'matches') : 'None'),
  rate: pct => (pct == null ? '–' : `${pct}%`),
  none: 'No matches yet. Play with bots and every match you finish is counted here.',
  some: 'Counted when a match ends. A match you leave early is counted as left early, not as a win or a loss.',
  confirm: 'Reset your record? Every number goes back to 0. This cannot be undone.',
};
