// A double tap must not answer the screen it opens. A tap often opens the next screen with its own
// buttons right under the same finger (Trade: the cards to give; Attack: the weapons; a guest's name:
// Trade or Attack; a menu button: the next menu screen), and the second tap of a double tap would then
// choose for the player: a card given away, a weapon used, a setting changed. `tooSoon(e, since)` is
// true for a pointer click that arrives within GUARD_MS of `since` (when that screen opened), and the
// screen ignores it. Clicks with no pointer behind them (keyboard, e.detail 0) always count.
export const GUARD_MS = 300;
export const tooSoon = (e, since) => !!e && e.detail > 0 && performance.now() - since < GUARD_MS;
