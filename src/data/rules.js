// Rules numbers, card definitions and the starting deck for Hotel Escape.
// This is the one place to change AP, health, hand size, deck counts and card behaviour;
// see docs/GAME_RULES.md for the authoritative spec these values implement.

export const rules = {
  actionPointsPerTurn: 4,   // AP each living player gets at the start of their turn
  actionCost: {
    move: 1,                // step into a room you already know
    discover: 1,            // extra cost the first time a room is entered (revealing it)
    search: 1,              // search the current room (once per room, searchable rooms only)
    useCard: 1,             // play a card (e.g. Bandage)
    attack: 1,              // attack in a forced encounter (needs a weapon)
  },
  // Entering an undiscovered room costs move + discover (2); a known room costs move (1).

  maxHealth: 3,             // health bars per player
  handSize: 4,             // cards dealt to each player at the start
  guaranteedLantern: true, // every starting hand contains at least one Lantern
  lanternsToEscape: 3,     // a clean player holding this many is carrying the Exit Key

  // The possessed side's private supply of Possession cards (held by the possessed player
  // at setup, then circulated through successful trades). Not part of the searchable deck.
  possessionSupply: 3,

  // Card behaviour. `weapon`, `damage`, `shots`, `heal` drive the engine; the rest is for
  // the interface. Keep every card type the deck uses listed here.
  cards: {
    lantern:    { name: 'Lantern',    glyph: '✦', tint: '#ffd66b', desc: 'Defends against possession in a trade. Three make the Exit Key.' },
    possession: { name: 'Possession', glyph: '☠', tint: '#b46bff', desc: 'The possessed side may trade this to possess someone (unless they give a Lantern).', evil: true },
    flashlight: { name: 'Flashlight', glyph: '▮', tint: '#8fd8ff', desc: 'Needed to search a dark room.' },
    knife:      { name: 'Knife',      glyph: '†', tint: '#c8ccd4', weapon: true, damage: 1, reusable: true, desc: 'Weapon: 1 damage, reusable.' },
    revolver:   { name: 'Revolver',   glyph: '➶', tint: '#e0806a', weapon: true, damage: 2, shots: 2, desc: 'Weapon: 2 damage, same room, 2 shots then discarded.' },
    bandage:    { name: 'Bandage',    glyph: '✚', tint: '#8fe0a8', heal: 1, desc: 'Restores 1 health bar.' },
    masterKey:  { name: 'Master Key', glyph: '⚷', tint: '#e6cf8a', desc: 'Opens a locked room once (no locked rooms in this build yet).' },
    lockPick:   { name: 'Lock Pick',  glyph: '⚹', tint: '#b8b09a', desc: 'Attempts to open a locked room (no locked rooms in this build yet).' },
    barricade:  { name: 'Barricade',  glyph: '▤', tint: '#c89a6a', desc: 'Seals one doorway for a round (no locked rooms in this build yet).' },
    trinket:    { name: 'Trinket',    glyph: '◆', tint: '#9aa0aa', desc: 'A worthless keepsake. Filler.' },
  },

  // The searchable draw deck (Possession cards are NOT here — they are the possessed
  // supply). Tuned for a 6-player game per the spec; comfortably supplies a 5-player test.
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

export default rules;
