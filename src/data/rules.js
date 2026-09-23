// THE one place rules numbers live. Nothing else in the code should hard-code a cost, a hand
// size, a card effect or a deck count — import from here instead.
//
// This file implements docs/GAME_RULES.md, which is the OWNER'S product design. Do not add,
// remove or change a rule or a number here without the owner's explicit approval of a
// before/after list (see CLAUDE.md, "Rules changes").
//
// Two ways to play the same ruleset, chosen at startup by applyMode() at the bottom:
//   'practice'  — one guest alone: find the three key pieces and escape. No meetings, no
//                 hidden role, no timer. Everything else (dark rooms, locked rooms, cards) applies.
//   'hotseat'   — 4-6 guests passing ONE device. A testing tool for the real online game; the
//                 rules are designed for one device each, not around the shared iPad.
// There is no server and no networking anywhere in this project.

export const rules = {
  // --- Mode --------------------------------------------------------------------------------
  gameMode: 'practice',     // 'practice' | 'hotseat' — set by applyMode()
  playerCount: 1,
  practiceMode: true,
  onlineMode: false,        // no server, no networking

  // --- Systems on in this ruleset -------------------------------------------------------------
  healthEnabled: true,
  combatEnabled: true,
  lockedDoorsEnabled: true,
  darkRoomsRequireLight: true,   // searching a dark room needs a Flashlight in hand (not used up)

  // --- Turn ----------------------------------------------------------------------------------
  actionPointsPerTurn: 4,   // never carried over
  moveCost: 1,              // into ANY adjacent room, new or already known
  searchCost: 1,
  playCardCost: 1,          // Bandage, Master Key, Lock Pick, Barricade
  attackCost: 1,
  turnTimerEnabled: false,  // practice: off. Hot-seat: on. ?timer=off disables it anywhere.
  turnTimerSeconds: 45,     // counts the active player's actions only; pauses in meetings and
                            // on every pass-the-device screen

  // --- Health --------------------------------------------------------------------------------
  maxHealth: 3,
  bandageHeal: 1,

  // --- Possession ----------------------------------------------------------------------------
  possessionSupply: 3,      // the Possessed guest starts with this many Possession cards

  // --- Key pieces and escape -----------------------------------------------------------------
  // Three different pieces, hidden in three different random rooms at setup — never the lobby,
  // never a room next to it. Carried cards: tradeable, outside the hand limit, undroppable,
  // dropped on death. A clean guest holding all three who enters the exit escapes at once.
  keyPieces: ['bow', 'shank', 'bit'],

  // --- Rooms ---------------------------------------------------------------------------------
  lockedRoomCount: 2,       // chosen at random at setup (never the lobby, its neighbours, the exit)
  lockPickChance: 0.5,      // a Lock Pick works half the time; discarded either way
  barricadeRounds: 1,       // a Barricade seals one doorway of your room for one round

  // --- Hand ----------------------------------------------------------------------------------
  startingHandSize: 4,
  guaranteedLantern: true,  // every starting hand holds at least one Lantern
  handLimit: 6,             // checked at the end of your turn; pieces and Possession cards don't count

  // --- Seeds ---------------------------------------------------------------------------------
  practiceSeed: 20260917,   // practice deals the same hotel every time; null for random

  // --- Card catalogue ------------------------------------------------------------------------
  cards: {
    lantern:    { name: 'Lantern',    glyph: '✦', tint: '#ffd66b',
                  desc: 'Give it in a trade to block a possession attempt. Defence only.' },
    bandage:    { name: 'Bandage',    glyph: '✚', tint: '#8fe0a8', heal: 1, active: true,
                  desc: 'Restores 1 health bar. 1 action.' },
    flashlight: { name: 'Flashlight', glyph: '▮', tint: '#8fd8ff',
                  desc: 'Lets you search a dark room. Never used up.' },
    knife:      { name: 'Knife',      glyph: '†', tint: '#c8ccd4', weapon: true, damage: 1, reusable: true,
                  desc: 'Attack: 1 damage, reusable.' },
    revolver:   { name: 'Revolver',   glyph: '➶', tint: '#e0806a', weapon: true, damage: 2, shots: 2,
                  desc: 'Attack: 2 damage. Two shots, then it is gone.' },
    barricade:  { name: 'Barricade',  glyph: '▤', tint: '#c89a6a', active: true,
                  desc: 'Seals one doorway of your room for one round. 1 action.' },
    lockPick:   { name: 'Lock Pick',  glyph: '⚹', tint: '#b8b09a', active: true, unlock: true,
                  desc: 'Tries a locked room next door: works half the time. Used up either way. 1 action.' },
    masterKey:  { name: 'Master Key', glyph: '⚷', tint: '#e6cf8a', active: true, unlock: true,
                  desc: 'Opens a locked room next door. Always works, then used up. 1 action.' },
    // The possessed side's supply — never in the deck.
    possession: { name: 'Possession', glyph: '☠', tint: '#b46bff', evil: true,
                  desc: 'Give it in a trade to possess someone — unless they hand you a Lantern.' },
    // The three pieces of the fire-exit key — hidden in rooms, never dealt, never in the deck.
    bow:        { name: 'Key Bow',    glyph: '◯', tint: '#e8ca80', piece: true,
                  desc: 'The head of the fire-exit key. One of three pieces.' },
    shank:      { name: 'Key Shank',  glyph: '│', tint: '#e8ca80', piece: true,
                  desc: 'The shaft of the fire-exit key. One of three pieces.' },
    bit:        { name: 'Key Bit',    glyph: '⌐', tint: '#e8ca80', piece: true,
                  desc: 'The teeth of the fire-exit key. One of three pieces.' },
  },

  // --- The draw deck (40, tuned for 6 players) --------------------------------------------------
  deck: {
    lantern: 12,
    bandage: 7,
    flashlight: 5,
    knife: 4,
    barricade: 4,
    lockPick: 4,
    revolver: 2,
    masterKey: 2,
  },
};

// The nested shape older code reads. `discover` is 0: a new room costs the same as a known one.
function derive() {
  rules.actionCost = {
    move: rules.moveCost,
    discover: 0,
    search: rules.searchCost,
    useCard: rules.playCardCost,
    attack: rules.attackCost,
  };
  rules.handSize = rules.startingHandSize;
  rules.keyPiecesToEscape = rules.keyPieces.length;
}
derive();

// Switch between the two ways of playing. Call ONCE at startup, before any state is built. It
// mutates the shared `rules` object on purpose: every module reads values off it at call time,
// so a number still lives in exactly one place.
export function applyMode(mode, playerCount = 1) {
  if (mode === 'hotseat') {
    rules.gameMode = 'hotseat';
    rules.playerCount = Math.max(4, Math.min(6, Math.round(playerCount) || 6));
    rules.practiceMode = false;
    rules.turnTimerEnabled = true;
  } else {
    rules.gameMode = 'practice';
    rules.playerCount = 1;
    rules.practiceMode = true;
    rules.turnTimerEnabled = false;
  }
  derive();
  return rules;
}

export default rules;
