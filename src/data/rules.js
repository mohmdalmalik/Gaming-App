// THE one place rules numbers live. Nothing else in the code should hard-code a cost,
// a hand size, a room count or a card effect — import from here instead.
// See docs/GAME_RULES.md for the spec these values implement.
//
// Phase 0 (this build) is PRACTICE MODE: a single guest exploring the hotel to validate
// movement, action points, discovery, searching, cards, objectives and the exit. The
// multiplayer rules engine (possession, encounters, trade, attack, health) is still present
// and tested, but nothing switches it on while `practiceMode` is true. Flip the flags below
// to bring each system back when its rules are approved.

export const rules = {
  // --- Phase 0 flags -----------------------------------------------------------------------
  practiceMode: true,       // single-player practice: no other players, no possession, no timer
  onlineMode: false,        // no server, no networking in this phase
  healthEnabled: false,     // no damage/combat yet, so health is neither shown nor applied
  lockedDoorsEnabled: false,// no locked doors in this phase
  roundLimitEnforced: false,// the round counter is shown for testing but never ends practice

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

  // The Phase 1 draw pile (unused while practiceMode is true; kept so the multiplayer
  // rules engine and its tests keep working unchanged).
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

export default rules;
