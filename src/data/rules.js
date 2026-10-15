// THE one place rules numbers live. Nothing else in the code should hard-code a cost, a hand
// size, a card effect or a deck count — import from here instead.
//
// This file implements docs/GAME_RULES.md, which is the OWNER'S product design. Do not add,
// remove or change a rule or a number here without the owner's explicit approval of a
// before/after list (see CLAUDE.md, "Rules changes").
//
// Two ways to play the same ruleset, chosen by applyMode() at the bottom, which src/main.js calls each time a
// game is dealt:
//   'practice'  — one guest alone: find three Lanterns and escape. No meetings, no
//                 hidden role, no timer. Everything else (dark rooms, locked rooms, cards) applies.
//   'match'     — minPlayers to maxPlayers guests (4-6), one of them secretly possessed: the real game. Today
//                 the player shares the table with computer guests (bots, src/bots/); later, with people
//                 online, one device each. (Hot-seat, the old pass-one-iPad mode, is gone.)
// There is no server and no networking anywhere in this project yet.

export const rules = {
  // --- Mode --------------------------------------------------------------------------------
  gameMode: 'practice',     // 'practice' | 'match' — set by applyMode()
  playerCount: 1,
  practiceMode: true,
  onlineMode: false,        // no server, no networking

  // --- The table (docs/GAME_RULES.md > Players: "4-6", "you and 3-5 computer guests") ---------------
  minPlayers: 4,            // guests at a match, you included. The menu offers minBots..maxBots computer guests
  maxPlayers: 6,            // (minPlayers - 1 .. maxPlayers - 1), derived in derive() below

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
  turnTimerEnabled: false,  // practice: off. A match: on. ?timer=off disables it anywhere.
  turnTimerSeconds: 45,     // counts the active player's actions only; pauses in meetings and
                            // while a guest reads a private screen
  discardMinSeconds: 10,    // APPROVED 15 Oct 2026: the end-of-turn discard runs on the turn clock but always gets at
                            // least this long; when it runs out, random ordinary cards are discarded for the guest
  // Dawn deadline: if no clean guest has escaped when this round ends, dawn breaks and the hotel
  // wins. Matches only — practice has no deadline.
  roundLimit: 8,

  // --- Health --------------------------------------------------------------------------------
  maxHealth: 4,             // APPROVED (7 Oct 2026): 4 health bars (was 3)
  bandageHeal: 1,

  // --- Possession ----------------------------------------------------------------------------
  possessionSupply: 3,      // APPROVED (10 Oct 2026): the Possessed guest starts with 3 Possession cards (was 2
                            // from 7 Oct; 3 before that).
  soulsOnConvert: 2,        // APPROVED (10 Oct 2026, "soul cards"): every Possession card is its owner's own
                            // soul, with their face on it; you only ever hold and give your own. A guest who
                            // becomes possessed: the card that possessed them is used up, and they get this
                            // many souls of their own: two tries. Each guest they possess gets two tries the
                            // same way (docs/GAME_RULES.md > Possession). A soul handed to a guest who is
                            // already possessed is used up (the giver still gets their card; the other gains
                            // nothing); two souls handed over at once are both used up; either way each now
                            // knows the other. A Lantern block still discards the card used (and the Lantern);
                            // a guest who dies takes their souls out of the game. (Was possessionOnConvert: 1
                            // — keep the card AND get one more.)

  // --- Lanterns and escape ------------------------------------------------------------------
  // A clean guest holding this many Lanterns, standing in the Fire Exit, may escape (escapeCost). Every
  // guest starts with lanternsDealtEach of them; all the others are found by searching.
  lanternsToEscape: 3,
  escapeCost: 1,            // APPROVED: escaping is its own action — walk in (a normal move), then 1 AP to escape
  lanternsDealtEach: 1,     // APPROVED: 1. Every guest, the possessed guest included, is dealt 1 Lantern
                            // + 3 other cards; the remaining Lanterns are then shuffled back into the deck.
  // What happens to a Lantern that blocks a possession attempt.
  //   'discard'  APPROVED: used up — the Lantern and the Possession card are both discarded.
  //   'attacker' comparison only (Panic Station style): the Lantern goes to the possessed guest.
  lanternBlock: 'discard',

  // --- Rooms ---------------------------------------------------------------------------------
  // The hotel itself — tile size, the room deck (incl. the 2 locked and the dark rooms), the lobby's
  // 3 or 4 doorways, the Fire Exit in the last five tiles — is in src/data/hotel.js.
  lockPickChance: 0.5,      // a Lock Pick works half the time; discarded either way. A key or pick opens
                            // one locked door until the end of that guest's turn (src/game/state.js)
  barricadeRounds: 1,       // a Barricade seals one doorway of your room until your next turn starts

  // Rooms with jobs (which tiles have them is in src/data/hotel.js, `job`).
  linenStoreDraws: 2,       // Linen Store: the first search here draws 2 cards instead of 1 (it keeps its search)
  // The Infirmary and the Switchboard have an ACTION instead of a search (APPROVED, round 4: "it should change
  // the search icon to this action ... one of them is enough"): neither can be searched, ever (`searchable:
  // false` in src/data/hotel.js), so no card is drawn from them.
  infirmaryCost: 1,         // Infirmary: 1 AP to restore health...
  infirmaryHeal: 2,         // ...2 bars (never above maxHealth). APPROVED, round 4: each Infirmary room can be
                            // used ONCE PER MATCH, by whoever uses it first (then it is spent for everyone, in
                            // public); a guest at full health cannot use it, so a use is never wasted on them
  switchboardCost: 2,       // Switchboard: 2 AP (APPROVED, round 4: was 1) and NO limit on how often (it was once
                            // per player per turn): everyone learns how many living guests are currently
                            // possessed, but not who

  // --- Hand ----------------------------------------------------------------------------------
  startingHandSize: 4,      // 1 Lantern (lanternsDealtEach) + 3 from the deck with the Lanterns taken out
  handLimit: 6,             // checked ONLY at the end of your own turn: during it you keep everything you
                            // find or receive, even past 6, then discard down to 6 when you end it.
                            // Lanterns count, Possession cards don't. APPROVED, round 4: the end-of-turn
                            // discard has a time limit; when it (or the turn clock itself) runs out, random
                            // ORDINARY cards are discarded down to the limit and the turn ends
                            // (discardRandomDown / endTurnByTimeout, src/game/actions.js; never Possession
                            // cards, never more than needed). The discard always gets at least discardMinSeconds (below).

  // --- Seeds ---------------------------------------------------------------------------------
  practiceSeed: null,       // null: a new random hotel every practice match (?seed= still forces one)

  // --- Card catalogue ------------------------------------------------------------------------
  cards: {
    lantern:    { name: 'Lantern',    glyph: '✦', tint: '#ffd66b',
                  desc: 'Three let you escape through the Fire Exit. One protects you from a Possession card.' },
    bandage:    { name: 'Bandage',    glyph: '✚', tint: '#8fe0a8', heal: 1, active: true,
                  desc: 'Restores 1 health.' },
    flashlight: { name: 'Flashlight', glyph: '▮', tint: '#8fd8ff',
                  desc: 'Lets you search dark rooms, and is never used up.' },
    knife:      { name: 'Knife',      glyph: '†', tint: '#c8ccd4', weapon: true, damage: 1, reusable: true,
                  desc: 'Attack: 1 damage, reusable.' },
    revolver:   { name: 'Revolver',   glyph: '➶', tint: '#e0806a', weapon: true, damage: 2, shots: 2,
                  desc: 'Attack: 2 damage. Two shots, then it is gone.' },
    barricade:  { name: 'Barricade',  glyph: '▤', tint: '#c89a6a', active: true,
                  desc: 'Seals one doorway of your room for one round.' },
    lockPick:   { name: 'Lock Pick',  glyph: '⚹', tint: '#b8b09a', active: true, unlock: true,
                  desc: 'Opens a locked door half the time. Used up either way.' },
    masterKey:  { name: 'Master Key', glyph: '⚷', tint: '#e6cf8a', active: true, unlock: true,
                  desc: 'Always opens a locked door, then is used up.' },
    handMirror: { name: 'Hand Mirror', glyph: '◐', tint: '#b9c8d8', active: true,
                  desc: 'A guest in your room privately shows you their hand. Used up.' },
    espresso:   { name: 'Espresso',   glyph: '☕', tint: '#c08a5a', active: true, extraActions: 2,
                  desc: 'Free to use: 2 extra actions this turn. Used up.' },
    // The possessed side's souls — never in the deck. Each card belongs to the guest who holds it
    // (card.owner, src/game/cards.js) and only they can give it.
    possession: { name: 'Possession', glyph: '☠', tint: '#b46bff', evil: true,
                  desc: 'Your own soul. Give it in a trade to possess someone.' },
  },

  // --- The draw deck (50, tuned for 6 players) --------------------------------------------------
  deck: {
    lantern: 16,       // APPROVED 15 Oct 2026: 14 -> 16, to give back the Lanterns the Infirmaries and the Switchboard no longer find
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
  rules.minBots = rules.minPlayers - 1;      // the computer guests you can play with: everyone else at the table
  rules.maxBots = rules.maxPlayers - 1;
}
derive();

// Switch between the two ways of playing: call it each time a game is dealt, before its state is built (a match
// of this size, or practice). It mutates the shared `rules` object on purpose: every module reads values off
// it at call time, so a number still lives in exactly one place.
export function applyMode(mode, playerCount = 1) {
  if (mode !== 'match' && mode !== 'practice') throw new Error(`applyMode: unknown mode "${mode}" (practice or match)`);
  if (mode === 'match') {
    rules.gameMode = 'match';
    rules.playerCount = Math.max(rules.minPlayers, Math.min(rules.maxPlayers, Math.round(playerCount) || rules.maxPlayers));
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
