// The sound mix (data): which file plays for each cue of the cue bus (src/audio/bus.js), how loud,
// how much it may vary from one play to the next, and which music plays in which part of the game.
// The files themselves are made by tools/audio/build.py and listed in src/audio/library.js.
//
// A cue: { file: effect name in EFFECTS (or stinger: name in MUSIC), gain: dB trim, vary: semitones
// of random pitch either way (0 for tuned cues), jitter: dB of random level either way, max: how many
// of this cue may sound at once, gap: s - a repeat sooner than this is dropped (a double trigger),
// low: true = may be dropped when many sounds are playing }.
export const CUES = {
  // interface
  click: { file: 'click', gain: 0, vary: 0.6, jitter: 1, max: 3, gap: 0.03, low: true },
  open: { file: 'open', gain: 0, vary: 0, jitter: 1, max: 2, gap: 0.08 },
  close: { file: 'close', gain: 0, vary: 0, jitter: 1, max: 2, gap: 0.08 },
  select: { file: 'select', gain: 0, vary: 0, jitter: 1, max: 2, gap: 0.05, low: true },
  deny: { file: 'deny', gain: 0, vary: 0.4, jitter: 1, max: 1, gap: 0.25 },
  // menu and the lift
  joined: { file: 'joined', gain: -1, vary: 0.25, jitter: 1.5, max: 3, gap: 0.1 },
  liftDing: { file: 'liftDing', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1 },
  liftDoors: { file: 'liftDoors', gain: -2, vary: 0.3, jitter: 1, max: 1, gap: 0.6 },
  fadeIn: { file: 'fadeIn', gain: -2, vary: 0, jitter: 0, max: 1, gap: 1 },
  // the turn and its clock
  yourTurn: { file: 'yourTurn', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1 },
  tick: { file: 'tick', gain: -2, vary: 0.3, jitter: 0.5, max: 2, gap: 0.3 },
  timeUp: { file: 'timeUp', gain: -1, vary: 0, jitter: 0, max: 1, gap: 1 },
  // doors
  doorOpen: { file: 'doorOpen', gain: 0, vary: 1.0, jitter: 1.5, max: 2, gap: 0.3 },
  doorJammed: { file: 'doorJammed', gain: 0, vary: 0.8, jitter: 1, max: 1, gap: 0.3 },
  doorLocked: { file: 'doorLocked', gain: 0, vary: 0.8, jitter: 1, max: 1, gap: 0.3 },
  unlock: { file: 'unlock', gain: 0, vary: 0.5, jitter: 1, max: 1, gap: 0.3 },
  lockFail: { file: 'lockFail', gain: 0, vary: 0.5, jitter: 1, max: 1, gap: 0.3 },
  barricade: { file: 'barricade', gain: 0, vary: 0.6, jitter: 1, max: 1, gap: 0.3 },
  // finding
  search: { file: 'search', gain: 0, vary: 1.0, jitter: 1.5, max: 1, gap: 0.3 },
  cardFound: { file: 'cardFound', gain: -1, vary: 0, jitter: 0.5, max: 1, gap: 0.2 },
  cardFlip: { file: 'cardFlip', gain: -1, vary: 1.0, jitter: 1.5, max: 3, gap: 0.04, low: true },
  // cards
  bandage: { file: 'bandage', gain: 0, vary: 0.6, jitter: 1, max: 1, gap: 0.3 },
  espresso: { file: 'espresso', gain: 0, vary: 0.4, jitter: 1, max: 1, gap: 0.3 },
  mirror: { file: 'mirror', gain: 0, vary: 0, jitter: 0.5, max: 1, gap: 0.5 },
  // trades
  tradeSwap: { file: 'tradeSwap', gain: 0, vary: 0.6, jitter: 1, max: 1, gap: 0.3 },
  lanternBlock: { file: 'lanternBlock', gain: 0, vary: 0, jitter: 0.5, max: 1, gap: 0.6 },
  possessed: { file: 'possessed', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1 },
  possessOther: { file: 'possessOther', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1 },
  noTrade: { file: 'noTrade', gain: 0, vary: 0, jitter: 0.5, max: 1, gap: 0.3 },
  // combat
  knife: { file: 'knife', gain: 0, vary: 0.8, jitter: 1, max: 1, gap: 0.8 },
  revolver: { file: 'revolver', gain: -1, vary: 0.4, jitter: 1, max: 1, gap: 0.8 },
  hurt: { file: 'hurt', gain: 0, vary: 0.5, jitter: 1, max: 1, gap: 0.8 },
  death: { file: 'death', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1.5 },
  // rooms
  infirmary: { file: 'infirmary', gain: 0, vary: 0, jitter: 0.5, max: 1, gap: 0.5 },
  switchboard: { file: 'switchboard', gain: -1, vary: 0, jitter: 0.5, max: 1, gap: 0.8 },
  // the end of the match (the stingers are music: they follow the Music setting)
  escape: { file: 'escape', gain: 0, vary: 0, jitter: 0, max: 1, gap: 1 },
  dawn: { stinger: 'dawn', gain: 0 },
  win: { stinger: 'win', gain: 0 },
  winPossessed: { stinger: 'winPossessed', gain: 0 },
  lose: { stinger: 'lose', gain: 0 },
  // a footstep of the guest who is walking (opts.surface: carpet | wood | marble)
  step: { file: 'steps', gain: -3, vary: 0.8, jitter: 2, max: 3, gap: 0.12, low: true, sliced: true },
};

// Music by scene. fadeIn / fadeOut: seconds; gain: dB trim of the track under the Music setting.
export const SCENES = {
  none: { track: null, fadeOut: 1.2 },
  menu: { track: 'lobby', fadeIn: 2.5, fadeOut: 1.6 },
  intro: { track: 'lobby', fadeIn: 1.5, fadeOut: 1.0 },          // the lift: the lobby music carries on
  game: { track: 'game', fadeIn: 4.0, fadeOut: 2.5 },
  final: { track: 'final', fadeIn: 3.5, fadeOut: 2.5 },           // round 8 of 8
  end: { track: null, fadeOut: 1.0 },                              // the end screen: a stinger instead
};
export const TRACK_GAIN = { lobby: 0, game: -2, final: -1.5 };
export const STINGER_GAIN = 0;

// Under the floor of each room: what a footstep sounds like there (the rooms' floors are wooden
// boards; some have rugs or carpet, the kitchen and the infirmaries are tiled).
export const FLOORS = {
  default: 'wood',
  hall: 'carpet', lounge: 'carpet', library: 'carpet', dining: 'carpet', suite416: 'carpet', cloakroom: 'carpet',
  grandCorridor: 'carpet', corridorN: 'carpet', corridorS: 'carpet', corridorE: 'carpet', corridorW: 'carpet', cornerCorridor: 'carpet',
  kitchen: 'marble', infirmary1: 'marble', infirmary2: 'marble', exit: 'marble',
};

// How many effects may sound at once (music and stingers not counted).
export const MAX_VOICES = 12;
