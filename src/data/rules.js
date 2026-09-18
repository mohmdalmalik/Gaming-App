// THE one place rules numbers live. Nothing else in the code should hard-code a cost,
// a hand size, a room count or a card effect — import from here instead.
// See docs/GAME_RULES.md for the spec these values implement.
//
// There are three game modes, chosen at startup by `applyMode()` at the bottom of this file:
//
//   'practice'  — PHASE 0. One guest exploring the hotel: movement, action points, discovery,
//                 searching, cards, objectives and the exit. No hidden roles, no timer.
//   'hotseat'   — PHASE 1. The approved rules played by 4-6 people passing ONE device:
//                 one hidden Possessor, pre-committed Offers, a turn timer, a round limit.
//                 Local only — there is no server and no networking anywhere in this project.
//   'legacy'    — the older multiplayer engine (health, combat, weapons, three-Lantern Exit
//                 Key). Kept working and tested; nothing in the shipped game turns it on.
//
// The values below are the PRACTICE defaults. `applyMode()` overwrites the ones a mode
// changes, so there is still exactly one place any number lives.

export const rules = {
  // --- Mode --------------------------------------------------------------------------------
  // Set by applyMode(). 'practice' | 'hotseatRulesV1' | 'legacy'.
  gameMode: 'practice',
  playerCount: 1,

  // --- Phase 0 flags -----------------------------------------------------------------------
  practiceMode: true,       // single-player practice: no other players, no possession, no timer
  onlineMode: false,        // no server, no networking in this phase
  healthEnabled: false,     // no damage/combat yet, so health is neither shown nor applied
  combatEnabled: false,     // no Challenge, no weapons, no attacks
  lockedDoorsEnabled: false,// no locked doors in this phase
  roundLimitEnforced: false,// the round counter is shown for testing but never ends practice

  // --- Turn timer ---------------------------------------------------------------------------
  // PURPOSE: stop one player thinking for five minutes while five others watch.
  // BEHAVIOUR: counts only the active player's action phase. It never runs during a role
  //   reveal or a pass-the-device screen, so handing the iPad over costs nobody their turn.
  // WHY 45: four action points at roughly 8-10 seconds of tapping each, plus a few seconds to
  //   read the room. Measured on the practice build, a deliberate 4-AP turn takes 20-30s.
  // MEASURE: how often turns are cut off. Above about 1 in 10 it is too short; if nobody ever
  //   sees the last 15 seconds it is too long.
  // ADJUST: change turnTimerSeconds in steps of 15. turnTimerEnabled: false switches it off
  //   entirely (the developer flag asked for in the brief).
  turnTimerEnabled: false,
  turnTimerSeconds: 45,

  // --- Corrected v0.1 rules ------------------------------------------------------------------
  // Objectives are PERMANENT PUBLIC TEAM PROGRESS. They are never dealt, held, offered, stolen
  // or carried. `legacyCarriedExitKey` is the old "three Lanterns in one hand are the Exit Key"
  // model: it belongs to the inactive Phase 1 engine and must stay false for the active path.
  legacyCarriedExitKey: false,
  // Dark rooms are ATMOSPHERE ONLY in v0.1: they stay enterable and searchable, and there is no
  // Flashlight card to gate them with. Deliberate — see docs/GAME_RULES.md §0.
  darkRoomsRequireLight: false,
  // Meetings resolve from offers each player commits ON THEIR OWN TURN, so a player is never
  // asked to make a decision while someone else is taking a turn.
  offersArePreCommitted: true,
  // How many clean guests must reach the exit. Practice has one guest, so one escape completes
  // the run; the six-player target is two (floor(players / 3), minimum 1).
  requiredEscapees: 1,
  escapeesAtBalanceCount: 2,
  // The hot-seat value, scaled from the table size by cleanEscapeesForPlayers() below.
  // PURPOSE: one escapee leaves the guests winning 58-80% of games across the whole parameter
  //   space, which is structural rather than a tuning problem. Two is the six-player answer.
  // MEASURE: guest win rate over a batch of matches; the target band is 45-55%.
  // ADJUST: it is an integer, so it moves only with the player count. If six-player guests win
  //   far too often at two, shorten roundLimit before touching this.
  requiredCleanEscapees: 2,

  // --- Table size --------------------------------------------------------------------------
  balancePlayerCount: 6,    // the hotel is laid out for a six-player game even while practising
  roomsPerPlayer: 3,        // map size scales with the table: 6 players -> 18 rooms
  totalRooms: 18,
  itemSearchRooms: 12,      // rooms that yield one item card each
  objectiveCount: 3,        // objectives needed before the exit opens (ceil(players / 2) at 6)
  roundLimit: 8,            // the multiplayer deadline; displayed but not enforced in practice

  // --- Action points -----------------------------------------------------------------------
  actionPointsPerTurn: 4,   // refilled at the start of every turn; never carried over
  knownRoomMoveCost: 1,     // step into a room you have already discovered
  newRoomEntryCost: 2,      // reveal an undiscovered room AND step into it
  searchCost: 1,            // search the room you are standing in
  playCardCost: 1,          // play an active card (Hint)

  // --- Hand --------------------------------------------------------------------------------
  startingHandSize: 4,      // dealt at the start
  guaranteedLantern: true,  // every starting hand contains at least one Lantern
  handLimit: 6,             // most item cards a guest may hold

  // --- Map seed ----------------------------------------------------------------------------
  // A fixed seed keeps the deal reproducible while testing. Set to null for a random game.
  practiceSeed: 20260917,

  // --- Multiplayer values (kept for Phase 1; unused while practiceMode is true) -------------
  maxHealth: 3,
  lanternsToEscape: 3,
  possessionSupply: 3,

  // --- Derived: the nested shape the existing engine reads ----------------------------------
  // `discover` is the EXTRA cost on top of `move` when the room is new, so entering an
  // undiscovered room costs newRoomEntryCost in total. Built once below from the flat values
  // above so there is still only one place to change a cost.
  actionCost: null,   // filled in below
  handSize: null,     // older name for startingHandSize, filled in below

  // --- Card catalogue ----------------------------------------------------------------------
  // Central definitions so a card's future multiplayer effect can be added here without
  // touching the inventory, hand or trade code. `phase0` marks the three types actually in
  // play now; the rest are dormant Phase 1 cards.
  cards: {
    lantern:    { name: 'Lantern',    glyph: '✦', tint: '#ffd66b', phase0: true,
                  desc: 'Your defence against possession when other guests arrive.' },
    hint:       { name: 'Hint',       glyph: '❖', tint: '#8fd8ff', phase0: true, active: true,
                  desc: 'Reveals one undiscovered room next door. Costs 1 action.' },
    distraction:{ name: 'Distraction',glyph: '✺', tint: '#e0b0f0', phase0: true,
                  desc: 'Slips you out of a confrontation with another guest.' },
    // --- Phase 1 cards (defined, not dealt) -------------------------------------------------
    possession: { name: 'Possession', glyph: '☠', tint: '#b46bff', evil: true,
                  desc: 'The possessed side may trade this to possess someone (unless they give a Lantern).' },
    flashlight: { name: 'Flashlight', glyph: '▮', tint: '#8fd8ff', desc: 'Needed to search a dark room.' },
    knife:      { name: 'Knife',      glyph: '†', tint: '#c8ccd4', weapon: true, damage: 1, reusable: true, desc: 'Weapon: 1 damage, reusable.' },
    revolver:   { name: 'Revolver',   glyph: '➶', tint: '#e0806a', weapon: true, damage: 2, shots: 2, desc: 'Weapon: 2 damage, same room, 2 shots then discarded.' },
    bandage:    { name: 'Bandage',    glyph: '✚', tint: '#8fe0a8', heal: 1, desc: 'Restores 1 health bar.' },
    masterKey:  { name: 'Master Key', glyph: '⚷', tint: '#e6cf8a', desc: 'Opens a locked room once.' },
    lockPick:   { name: 'Lock Pick',  glyph: '⚹', tint: '#b8b09a', desc: 'Attempts to open a locked room.' },
    barricade:  { name: 'Barricade',  glyph: '▤', tint: '#c89a6a', desc: 'Seals one doorway for a round.' },
    trinket:    { name: 'Trinket',    glyph: '◆', tint: '#9aa0aa', desc: 'A worthless keepsake. Filler.' },
  },

  // The PRACTICE draw pile: only the three Phase 0 types. 18 cards covers a 4-card starting
  // hand plus one card from each of the 12 item-search rooms, with a little slack.
  practiceDeck: {
    lantern: 6,
    hint: 6,
    distraction: 6,
  },

  // The HOT-SEAT draw pile. Same three card types as practice (the approved rules add no new
  // card types), but sized for six guests: 6 x 4 dealt = 24 cards, plus one card for each of
  // the 12 item rooms = 36 minimum. 42 leaves slack so a late search never finds an empty pile.
  //
  // PURPOSE of the mix: the Lantern is the only defence against possession, so how common it is
  //   *is* the difficulty dial for the possessed side.
  // WHY THESE NUMBERS: every starting hand is guaranteed one Lantern (6 of the 16 go straight
  //   out), leaving 10 in a 36-card remainder — roughly a 1-in-4 chance that any later card is a
  //   Lantern. A guest who searches twice is likely to be holding a second one.
  // MEASURE: how often a possession attempt is blocked. The target is 30-45%: below that the
  //   Possessor converts unopposed, above it possession never gets going.
  // ADJUST: move 2 cards at a time between lantern and hint. Distraction is deliberately the
  //   rarest defence because it cancels the meeting outright and tells the guests nothing.
  hotseatDeck: {
    lantern: 16,
    hint: 14,
    distraction: 12,
  },

  // The legacy multiplayer draw pile (unused unless the legacy mode is started; kept so the
  // older rules engine and its tests keep working unchanged).
  deck: {
    lantern: 9,
    flashlight: 3,
    knife: 3,
    revolver: 2,
    bandage: 4,
    masterKey: 2,
    lockPick: 3,
    barricade: 3,
    trinket: 6,
  },
};

// Derive the nested shape from the flat values so both spellings stay in step.
rules.actionCost = {
  move: rules.knownRoomMoveCost,
  discover: rules.newRoomEntryCost - rules.knownRoomMoveCost,
  search: rules.searchCost,
  useCard: rules.playCardCost,
  attack: 1,
};
rules.handSize = rules.startingHandSize;

// --- Table scaling ---------------------------------------------------------------------------
// The two rules that move with the number of people at the table. Both are exactly as approved
// in the rules audit; nothing else scales.
export const objectivesForPlayers = n => Math.ceil(n / 2);
export const cleanEscapeesForPlayers = n => Math.max(1, Math.floor(n / 3));

// --- Modes -----------------------------------------------------------------------------------
// PHASE 1 hot-seat configuration, exactly as approved. Everything here is applied on top of the
// practice defaults by applyMode('hotseat', playerCount).
export const hotseatRules = {
  gameMode: 'hotseatRulesV1',
  rooms: 18,
  actionPointsPerTurn: 4,
  knownRoomMoveCost: 1,
  newRoomEntryCost: 2,
  searchCost: 1,
  startingHandSize: 4,
  handLimit: 6,
  itemSearchRooms: 12,
  roundLimit: 8,
  turnTimerEnabled: true,
  turnTimerSeconds: 45,
  healthEnabled: false,
  combatEnabled: false,
  lockedDoorsEnabled: false,
  legacyCarriedExitKey: false,
  darkRoomsRequireLight: false,
  offersArePreCommitted: true,
  practiceMode: false,
  onlineMode: false,        // there is NO server and NO networking in this project.
  roundLimitEnforced: true,
};

// The practice defaults, captured so applyMode('practice') can put everything back.
const practiceDefaults = {
  gameMode: 'practice',
  playerCount: 1,
  practiceMode: true,
  onlineMode: false,
  healthEnabled: false,
  combatEnabled: false,
  lockedDoorsEnabled: false,
  roundLimitEnforced: false,
  turnTimerEnabled: false,
  turnTimerSeconds: 45,
  legacyCarriedExitKey: false,
  darkRoomsRequireLight: false,
  offersArePreCommitted: true,
  requiredEscapees: 1,
  requiredCleanEscapees: 2,
  actionPointsPerTurn: 4,
  knownRoomMoveCost: 1,
  newRoomEntryCost: 2,
  searchCost: 1,
  playCardCost: 1,
  startingHandSize: 4,
  handLimit: 6,
  objectiveCount: 3,
  itemSearchRooms: 12,
  roundLimit: 8,
};

// Switch the whole rulebook to one mode. Call this ONCE at startup, before any state is built.
// It mutates the shared `rules` object on purpose: every module reads values off that object at
// call time, so there is still exactly one place a number lives and no module needs to know
// which mode is running.
export function applyMode(mode, playerCount = 1) {
  Object.assign(rules, practiceDefaults);
  if (mode === 'hotseat') {
    const n = Math.max(4, Math.min(6, Math.round(playerCount) || 6));
    Object.assign(rules, hotseatRules);
    rules.playerCount = n;
    rules.objectiveCount = objectivesForPlayers(n);
    rules.requiredCleanEscapees = cleanEscapeesForPlayers(n);
    rules.requiredEscapees = rules.requiredCleanEscapees;
  } else if (mode === 'legacy') {
    rules.gameMode = 'legacy';
    rules.playerCount = Math.max(2, Math.round(playerCount) || 5);
    rules.practiceMode = false;
    rules.healthEnabled = true;
    rules.combatEnabled = true;
  } else {
    rules.playerCount = 1;
  }
  // Re-derive everything that is built from the flat values.
  rules.actionCost = {
    move: rules.knownRoomMoveCost,
    discover: rules.newRoomEntryCost - rules.knownRoomMoveCost,
    search: rules.searchCost,
    useCard: rules.playCardCost,
    attack: 1,
  };
  rules.handSize = rules.startingHandSize;
  return rules;
}

export default rules;
