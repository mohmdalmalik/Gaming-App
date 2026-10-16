// The words of the in-match Menu panel (src/ui/gameMenu.js). Plain, short English. The question that
// follows Leave ("Leave the match?") is the game's own and has not changed (src/main.js).
export const GAME_MENU = {
  title: 'Menu',
  resume: 'Resume',
  music: 'Music',
  sound: 'Sound effects',
  howTo: 'How to play',
  cards: 'Cards',
  // (practice has no table to leave: it is a hotel of your own)
  leave: practice => (practice ? 'Leave practice' : 'Leave the match'),
};
