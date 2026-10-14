// Which sound a button makes when it is pressed (the one listener in src/audio/index.js asks here). Kept
// as a pure function so tests/audio-buttons-check.mjs can list every button of the page with the cue it
// gets, and fail when one lands on the wrong kind of sound. The cues themselves (files, levels): sounds.js.
//
//   open    the drawer: a button that opens a panel or a screen (the hand, the map, a menu page)
//   close   the drawer shut: a button that closes or goes back, named like one (an id with the word
//           back, cancel, close or done in it, as a WORD: btn-hand-close, not btn-feedback)
//   select  a choice among several (the segmented settings rows)
//   click   everything else: Continue, End turn, yes / no, the arrows through the hand...
//   none    silent (data-sfx="none")
// A button can say its own sound with data-sfx="open" (or any cue of sounds.js), which wins.
//
// The openers are named EXACTLY, never by a prefix: a prefix once caught btn-handoff-next and the hand's
// arrows too, and every Continue played the long 'open' drawer instead of a click.
export const OPENERS = new Set([
  'btn-menu-bots', 'btn-menu-settings', 'btn-menu-record',   // the menu pages
  'btn-profile',                                              // the profile card: opens your avatar
  'btn-private', 'btn-map',                                   // the hand sheet and the map, in a game
]);
const CLOSER_WORDS = new Set(['back', 'cancel', 'close', 'done']);

// `b`: { id, sfx (its data-sfx), seg (it is a .seg-btn) }.
export function cueForButton({ id = '', sfx = '', seg = false } = {}) {
  if (sfx) return sfx;
  if (seg) return 'select';
  if (id.split('-').some(word => CLOSER_WORDS.has(word))) return 'close';
  return OPENERS.has(id) ? 'open' : 'click';
}
