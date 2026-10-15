// Tips during your first matches (src/ui/tips.js shows them): a small card near the thing it explains,
// the first time that thing comes up, once per device. The words and the numbers that pace them live
// here; when each one comes up, and where it sits, is in src/ui/tips.js. Not a rule: nothing in
// src/game/ or src/bots/ reads this file. Settings > Tips turns them off, and "Show tips again" brings
// back the ones already seen.
//
// `text(r, you)` is one or two short sentences. `r` is the rules (src/data/rules.js), so a number is
// never written twice; `you` is the player's own situation: { practice, possessed }. Where practice needs
// different words that matter (Lanterns, the Switchboard), it has its own tip, so seeing it in practice
// never hides the match's.
import { hotel } from './hotel.js';

const actions = n => `${n} action${n === 1 ? '' : 's'}`;
const word = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n);
const Word = n => word(n).charAt(0).toUpperCase() + word(n).slice(1);
// The two safe zones, by the names the hotel's own data gives them.
const LANDING = hotel.lobby.name;
const EXIT = hotel.tiles.find(t => t.isExit)?.name ?? 'Fire Exit';

// The Lantern dilemma, once, for everyone: the first-meeting tip says it, and so does the private pick screen
// (src/ui/handoff.js) when a Lantern is lifted there: a computer guest who walks in on the player opens that screen
// with no Trade / Attack panel, so the tip beside that panel never comes up before the first card is chosen.
export const LANTERN_TRADE_NOTE = 'A Lantern blocks a soul, but is lost if the other guest gives you an ordinary card.';

export const TIPS = {
  firstTurn: {
    title: 'Your turn',
    text: r => `You have ${actions(r.actionPointsPerTurn)} each turn. Tap a glowing door to open it, or tap a room to walk there.`,
  },
  moveBar: {
    title: 'Walking',
    text: r => `Tap Move to go, or Cancel to stay. Each room you walk into costs ${actions(r.moveCost)}.`,
  },
  search: {
    title: 'Searching',
    text: (r, you) => `Tap the magnifier to search this room for ${actions(r.searchCost)}.${you.practice ? '' : ' Only you see what you find.'}`,
  },
  cardFound: {
    title: 'A new card',
    text: () => 'It is in your hand at the bottom. Tap a card to see what it does, and to use it.',
  },
  lantern: {
    title: 'Lanterns',
    text: r => `${Word(r.lanternsToEscape)} Lanterns open the Fire Exit. If one clean guest escapes with them, every clean guest wins.`,
  },
  lanternPractice: {
    title: 'Lanterns',
    text: r => `Carry ${word(r.lanternsToEscape)} Lanterns to the Fire Exit, then tap Escape to get out.`,
  },
  timer: {
    title: 'The clock',
    text: r => `Each turn lasts ${r.turnTimerSeconds} seconds. When the clock runs out, your turn ends.`,
  },
  meeting: {
    title: 'Trade or Attack',
    // (both halves of the Lantern dilemma, the same words for everyone: a Lantern blocks a soul, and is lost
    // to the other guest if what they give you is an ordinary card)
    text: () => `In a trade you each give one card, in secret. ${LANTERN_TRADE_NOTE} To attack, you need a weapon.`,
  },
  possessedStart: {
    title: 'You are possessed',
    text: () => 'Your souls carry your face: give one in a trade to possess that guest. You can never escape; you win at dawn, or when no clean guest is left.',
  },
  possessedMid: {
    title: 'You belong to the hotel',
    text: () => 'You now hold souls with your face: give one in a trade to possess that guest. You can no longer escape; you win at dawn, or when no clean guest is left.',
  },
  switchboard: {
    title: 'The Switchboard',
    text: r => `Ring it to tell the whole table how many guests are possessed, never who. It costs ${actions(r.switchboardCost)}.`,
  },
  switchboardPractice: {
    title: 'The Switchboard',
    text: () => 'In a match, ringing it tells every guest how many are possessed, never who.',
  },
  infirmary: {
    title: 'The Infirmary',
    text: r => `Tap Infirmary to heal ${r.infirmaryHeal} health for ${actions(r.infirmaryCost)}.`,
  },
  handLimit: {
    title: 'A full hand',
    text: (r, you) => `You may keep ${r.handLimit} cards${you.possessed ? ', not counting your souls' : ''}. Hold more, and you choose what to drop when you end your turn.`,
  },
  finalRound: {
    title: 'The final round',
    text: () => 'Dawn breaks when this round ends. If no clean guest has escaped by then, the hotel wins.',
  },
  // The first time the player walks into a safe zone (the badge by the room's name has never said what it means).
  safeZone: {
    title: 'Safe zone',
    text: () => `No meetings and no attacks happen in a safe zone. The ${LANDING} and the ${EXIT} are safe.`,
  },
  // On the player's first own turn, if they have not touched the camera yet.
  camera: {
    title: 'Look around',
    text: () => 'Drag to look around the hotel. Pinch with two fingers to zoom in and out.',
  },
  // The first time the player uses one of the three round buttons: what all three do.
  cameraButtons: {
    title: 'The round buttons',
    text: () => 'The two arrows turn the view. The target button brings it back to your guest.',
  },
  map: {
    title: 'The map',
    text: () => 'Tap Map to see every room found so far, and where each guest is.',
  },
  chat: {
    title: 'Quick chat',
    text: () => 'Tap Chat to say a short line, or make a face, to the whole table.',
  },
  out: {
    title: 'You are out',
    text: () => 'Watch the others play on, or tap Skip to the end to see how it finishes.',
  },
};

// The card's own words, and the Settings screen's "Show tips again".
export const TIPS_WORDS = {
  kicker: 'Tip',
  gotIt: 'Got it',
  hide: 'Hide tips',
  hiddenTitle: 'Tips are off',
  hidden: 'Settings can turn them back on.',
  again: 'Show tips again',
  againDone: 'Tips will show again',
};

export const TIPS_TIMING = {
  showMs: 9000,       // a tip hides itself after this long on screen
  gapMs: 1600,        // the pause after one tip before the next
  settleMs: 900,      // the pause after a screen closes (or the turn begins) before a tip appears
  seenMs: 2000,       // a tip cut off sooner than this (a screen opened over it) comes back later
  yieldMs: 4000,      // a tip about something happening right now may take over after this long
  staleMs: 30000,     // a tip about something that has happened is dropped if it could not show in this time
  guardMs: 450,       // the card's buttons ignore a tap this soon after it appears (a tap meant for the game)
  hiddenMs: 2400,     // how long "Tips are off" stays on the card after Hide tips
  againMs: 2500,      // how long the Settings button reads "Tips will show again"
  clockAt: 25,        // the clock tip: once your own turn is down to this many seconds
  mapRooms: 5,        // the map tip: once this many rooms of the hotel are found
};
