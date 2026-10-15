// The words that teach the game, all in one place: the How to play pages (src/ui/howToPlay.js), the hint on
// the main menu, the role screen's headline and its one line about how the OTHER side wins, and the little
// Lanterns chip. Written from docs/GAME_RULES.md: it restates the rules and changes none. The owner reviews
// this wording, so every sentence lives here and nowhere else; a number is never written twice: `r` is the
// rules (src/data/rules.js), so when a number there changes, the page changes with it.
//
// The pages teach the GAME (the goal, a turn, meetings, Possession and Lanterns, staying alive). What each
// card does is NOT here: it is on the Cards screen (src/ui/cardsGuide.js, src/data/cardsGuide.js).
//
// A page is { title, lines }: `lines` are short sentences, each `r => text`. (The pages are the same in
// practice and in a match: they teach the match. Practice has its own line on the first page.) A page with
// `cardsLink: true` (the last) also gets a small button to the Cards screen under its lines.
import { hotel } from './hotel.js';

const actions = n => `${n} action${n === 1 ? '' : 's'}`;
const word = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n);
const Word = n => word(n).charAt(0).toUpperCase() + word(n).slice(1);
const lanterns = n => `${n} Lantern${n === 1 ? '' : 's'}`;

// The two safe zones, by the names the hotel's own data gives them.
const LANDING = hotel.lobby.name;
const EXIT = hotel.tiles.find(t => t.isExit)?.name ?? 'Fire Exit';

// What opening a door, moving, searching, using a card and using a room's job cost: one sentence when they
// all cost the same (they do today), the costs one by one if the rules ever say otherwise.
function costs(r) {
  const same = new Set([r.openDoorCost, r.moveCost, r.searchCost, r.playCardCost, r.infirmaryCost, r.switchboardCost]).size === 1;
  return same
    ? `Opening a door, moving to the next room, searching, using a card and using a room's job cost ${actions(r.moveCost)} each.`
    : `Opening a door costs ${actions(r.openDoorCost)}, moving to the next room ${actions(r.moveCost)}, searching ${actions(r.searchCost)}`
      + ` and using a card ${actions(r.playCardCost)}. The Infirmary costs ${actions(r.infirmaryCost)} and the Switchboard ${actions(r.switchboardCost)}.`;
}

export const HOW_TO_PLAY = {
  title: 'How to play',
  // the buttons under the pages, and the little "2 of 5" above them
  words: { back: 'Back', next: 'Next', close: 'Close', cards: 'Cards', of: (n, total) => `${n} of ${total}` },
  pages: [
    {
      title: 'The goal',
      lines: [
        () => 'You are trapped on a hotel floor at night. Lanterns are the way out. One guest is secretly possessed.',
        r => `Clean guests win when one of them escapes through the ${EXIT} carrying ${lanterns(r.lanternsToEscape)}.`,
        r => `The possessed side wins if every living guest is possessed, or no clean guest is left, or dawn breaks (round ${r.roundLimit} ends) before anyone escapes. A possessed guest can never escape.`,
        () => 'You are told your role in private when the match starts.',
        () => 'New here? Practice alone lets you explore with no other guests and no deadline.',
      ],
    },
    {
      title: 'Your turn',
      lines: [
        r => `You have ${actions(r.actionPointsPerTurn)} each turn. ${costs(r)}`,
        () => 'Tap a glowing door to open it. Tap a room you can reach to walk there. Tap the magnifier to search; only you see what you found.',
        () => 'Tap End turn when you are done; unused actions are lost.',
        r => `You have ${r.turnTimerSeconds} seconds. When the time runs out, your turn ends.`,
        r => `Once every guest has had a turn, a round is over. Dawn comes after round ${r.roundLimit}.`,
      ],
    },
    {
      title: 'Meetings and trades',
      lines: [
        () => 'Walk into a room with a guest you have not met there this round and you must meet. You choose Trade or Attack.',
        () => 'If a guest walks into your room, they choose; a trade then asks you for a card.',
        () => 'Trade: you each pick one card to give, in secret, and the cards swap together. Only you see what you got.',
        r => `Attack: you need a weapon and ${actions(r.attackCost)}, and it takes health from the other guest.`,
        () => `The ${LANDING} and the ${EXIT} are safe zones: no meetings, no attacks.`,
      ],
    },
    {
      title: 'Possession and Lanterns',
      lines: [
        () => 'A possessed guest can hand over a Possession card (a soul) in a trade. If you receive one, you become possessed too, and you now play for the hotel. Only you and the guest who possessed you know.',
        () => 'A Lantern is your shield: hand one over in that trade and the attempt fails. The Lantern and the soul burn, and you learn who tried.',
        r => `Everyone starts with ${word(r.lanternsDealtEach)} ${r.lanternsDealtEach === 1 ? 'Lantern' : 'Lanterns'}. The rest are found by searching. ${Word(r.lanternsToEscape)} open the ${EXIT}.`,
        r => `Escaping costs ${actions(r.escapeCost)}: stand in the ${EXIT} and tap the Exit icon.`,
      ],
    },
    {
      title: 'Staying alive',
      cardsLink: true,
      lines: [
        r => `You have ${r.maxHealth} health. At 0 health you are out of the game and drop everything you carry, except Possession cards, which leave the game.`,
        r => `The Infirmary is a room where you can heal: it restores ${r.infirmaryHeal} health for ${actions(r.infirmaryCost)}.`,
        r => `At the end of your turn you can keep ${r.handLimit} cards. Souls do not count.`,
        () => 'The Switchboard tells everyone how many guests are possessed, but not who.',
        () => 'All the cards and what they do are on the Cards screen.',
      ],
    },
  ],
};

// Under "Practice alone" on the main menu, until the player has played a match or finished a practice.
export const NEW_PLAYER_HINT = 'New to Hotel Escape? Practice alone is the best place to start.';

// The role screen (src/ui/handoff.js revealRole): the headline, and ONE line about how the OTHER side wins.
// Both read the same way for everyone: each is that player's own, on their own screen.
export const ROLE_REVEAL = {
  headline: possessed => (possessed ? 'You are possessed' : 'You are clean'),
  otherSide: (possessed, r) => (possessed
    ? `The clean guests win if one of them escapes with ${lanterns(r.lanternsToEscape)}.`
    : 'The possessed win if every living guest is possessed, or no clean guest is left, or dawn breaks before anyone escapes.'),
};

// The Lanterns chip on the match screen (src/hud.js): the player's OWN count out of the number needed.
// The same words for a clean and a possessed guest (a possessed guest can hold Lanterns too).
export const LANTERN_CHIP = {
  label: 'Lanterns',
  text: (n, need) => `${n}/${need}`,
  aria: (n, need) => `You hold ${lanterns(n)} of the ${need} needed to escape.`,
};
