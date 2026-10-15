// The words of the Cards screen (src/ui/cardsGuide.js), and the list it shows. The screen is a read-only
// reference: one entry per kind of card in the game, with its name and the ONE short line the rules give it
// (src/data/rules.js, cards.<type>.desc). A new kind of card added to the catalogue appears here by itself.
// It lists the KINDS of cards, never anyone's hand, so it says nothing a guest may not know.
export const CARDS_GUIDE = {
  title: 'Cards',
  kicker: 'Every card in the game',
  close: 'Close',
};

// [{ type, name, desc }] in the catalogue's own order (Lanterns lead, Possession last). `catalogue` is the
// card catalogue (src/game/cards.js CARDS, which is rules.cards): a copy can be passed in a test.
export function cardEntries(catalogue) {
  return Object.entries(catalogue).map(([type, meta]) => ({ type, name: meta.name ?? type, desc: meta.desc ?? '' }));
}
