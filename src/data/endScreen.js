// The words of the end screen that tell the player how it went for THEIR side (src/overlays.js showEnd,
// src/ui/endRecap.js, src/main.js). Plain, short English. Practice has no sides, so it keeps its own words.
// By the end everything is revealed (the list of roles under it shows every guest's side), so the recap may
// say who was possessed first.
const list = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

export const END_WORDS = {
  victory: 'Victory',
  defeat: 'Defeat',
  // Who wins, on the second line under the title (with the round).
  winners: cleanWon => (cleanWon ? 'The clean guests win.' : 'The possessed win.'),
  // One line: who was possessed first, whom they possessed, and how many more were possessed after that.
  //   first / direct: { name, you } (`direct`: the guests that first guest possessed, in seat order)
  //   later: how many more were possessed by guests who had themselves been possessed
  recap: ({ first, direct, later }) => {
    const who = p => (p.you ? 'you' : p.name);
    const head = first.you ? 'You were possessed first' : `${first.name} was possessed first`;
    const tail = direct.length ? ` and possessed ${list(direct.map(who))}` : ' and possessed nobody';
    const more = later > 0 ? ` ${later} more ${later === 1 ? 'was' : 'were'} possessed after that.` : '';
    return `${head}${tail}.${more}`;
  },
};
