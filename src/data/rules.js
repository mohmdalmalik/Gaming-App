// THE one place rules numbers live. Nothing else in the code should hard-code a cost, a hand
// size, a card effect or a deck count — import from here instead.
//
// This file implements docs/GAME_RULES.md, which is the OWNER'S product design. Do not add,
// remove or change a rule or a number here without the owner's explicit approval of a
// before/after list (see CLAUDE.md, "Rules changes").
//
// Two ways to play the same ruleset, chosen at startup by applyMode() at the bottom:
//   'practice'  — one guest alone: find three Lanterns and escape. No meetings, no
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
  moveCost: 1,              // into ANY adjacent room through an open doorway
  openDoorCost: 1,          // open a closed door of your room: reveals the room behind; you stay put
  searchCost: 1,
  playCardCost: 1,          // Bandage, Master Key, Lock Pick, Barricade, Hand Mirror
  espressoCost: 0,          // Espresso is free to use
  attackCost: 1,
  turnTimerEnabled: false,  // practice: off. Hot-seat: on. ?timer=off disables it anywhere.
  turnTimerSeconds: 45,     // counts the active player's actions only; pauses in meetings and
                            // on every pass-the-device screen
  // Dawn deadline: if no clean guest has escaped when this round ends, dawn breaks and the hotel
  // wins. Hot-seat only — practice has no deadline.
  roundLimit: 8,

  // --- Health --------------------------------------------------------------------------------
  maxHealth: 3,
  bandageHeal: 1,

  // --- Possession ----------------------------------------------------------------------------
  possessionSupply: 3,      // the Possessed guest starts with this many Possession cards

  // --- Lanterns and escape ------------------------------------------------------------------
  // A clean guest holding this many Lanterns, standing in the Fire Exit, may escape (escapeCost). Lanterns are
  // never dealt — they are found only by searching.
  lanternsToEscape: 3,
  escapeCost: 1,            // APPROVED: escaping is its own action — walk in (a normal move), then 1 AP to escape
  lanternsDealtEach: 0,     // APPROVED: 0. The simulator compares 1 (one Lantern dealt to each guest).
  // What happens to a Lantern that blocks a possession attempt.
  //   'discard'  APPROVED: used up — the Lantern and the Possession card are both discarded.
  //   'attacker' comparison only (Panic Station style): the Lantern goes to the possessed guest.
  lanternBlock: 'discard',

  // --- Rooms ---------------------------------------------------------------------------------
  // The hotel itself — tile size, the room deck (incl. the 2 locked and the dark rooms), the lobby's
  // 3 or 4 doorways, the Fire Exit in the last five tiles — is in src/data/hotel.js.
  lockPickChance: 0.5,      // a Lock Pick works half the time; discarded either way
  barricadeRounds: 1,       // a Barricade seals one doorway of your room until your next turn starts

  // Rooms with jobs (which tiles have them is in src/data/hotel.js, `job`).
  linenStoreDraws: 2,       // Linen Store: the first search here draws 2 cards instead of 1
  infirmaryCost: 1,         // Infirmary: 1 AP to restore health...
  infirmaryHeal: 2,         // ...2 bars (never above maxHealth)
  switchboardCost: 1,       // Switchboard: 1 AP, once per player per turn; everyone learns how many
                            // guests are currently possessed, but not who

  // --- Hand ----------------------------------------------------------------------------------
  startingHandSize: 4,      // dealt from the deck with the Lanterns taken out
  handLimit: 6,             // checked at the end of your turn; Lanterns count, Possession cards don't

  // --- Seeds ---------------------------------------------------------------------------------
  practiceSeed: null,       // null: a new random hotel every practice match (?seed= still forces one)

  // --- Card catalogue ------------------------------------------------------------------------
  cards: {
    lantern:    { name: 'Lantern',    glyph: '✦', tint: '#ffd66b',
                  desc: 'Give it in a trade to block a possession attempt. Three of them let a clean guest escape.' },
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
    handMirror: { name: 'Hand Mirror', glyph: '◐', tint: '#b9c8d8', active: true,
                  desc: 'Choose a guest in your room: they show you their whole hand, in private. Used up. 1 action.' },
    espresso:   { name: 'Espresso',   glyph: '☕', tint: '#c08a5a', active: true, extraActions: 2,
                  desc: 'Free to use: gain 2 extra actions this turn. Used up.' },
    // The possessed side's supply — never in the deck.
    possession: { name: 'Possession', glyph: '☠', tint: '#b46bff', evil: true,
                  desc: 'Give it in a trade to possess someone — unless they hand you a Lantern.' },
  },

  // --- The draw deck (48, tuned for 6 players) --------------------------------------------------
  deck: {
    lantern: 14,
    bandage: 7,
    flashlight: 5,
    knife: 4,
    barricade: 4,
    lockPick: 4,
    handMirror: 3,
    espresso: 3,
    revolver: 2,
    masterKey: 2,
  },
};

// The nested shape older code reads. Entering a room is `move`; opening its door first is `open`.
function derive() {
  rules.actionCost = {
    move: rules.moveCost,
    open: rules.openDoorCost,
    discover: 0,
    search: rules.searchCost,
    useCard: rules.playCardCost,
    espresso: rules.espressoCost,
    infirmary: rules.infirmaryCost,
    switchboard: rules.switchboardCost,
    escape: rules.escapeCost,
    attack: rules.attackCost,
  };
  rules.handSize = rules.startingHandSize;
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
