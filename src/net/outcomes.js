// WHICH TRADE OUTCOME A GUEST SAW: a pure copy of tradeOutcome() from src/ui/tradeReveal.js, so the referee (in the
// page, on the server and in the Node tests) can name a trade's outcome without loading the reveal's portraits,
// sounds and allies. src/ui/tradeReveal.js will re-export this one (DESIGN §6.4; done when the page switches over).
// Pure: no DOM, no clock, no randomness.
//
// tradeOutcome(events, me, other) -> one of TRADE_OUTCOMES, for `me` (a player record with an `id`):
//   events  resolveTrade's result (src/game/actions.js), or skipTrade's ({ skipped: true }) for a skipped trade
//   me      the guest whose screen it is; other: the guest they traded with
// It reads only what concerns `me` and `other`: the blocks, possessions and spent souls of this one trade.

export const TRADE_OUTCOMES = ['swap', 'blocked', 'blockedMe', 'possessed', 'possessedThem', 'soulSpent', 'alreadyPossessed', 'soulsCrossed', 'noTrade'];

// Which outcome a trade (resolveTrade's events) or a skipped trade (skipTrade's) was, for `me`.
// (`spent`: a soul used up on a guest already possessed — one entry, or two when both gave a soul.)
export function tradeOutcome(events, me, other) {
  if (!events?.ok || events.skipped) return 'noTrade';
  if (events.blocks?.some(b => b.blocker === me.id)) return 'blocked';
  if (events.blocks?.some(b => b.revealed === me.id)) return 'blockedMe';
  if (events.possessed?.some(p => p.newly === me.id)) return 'possessed';
  if (events.possessed?.some(p => p.newly === other.id && p.by === me.id)) return 'possessedThem';
  const spentByMe = events.spent?.some(x => x.by === me.id), spentOnMe = events.spent?.some(x => x.at === me.id);
  if (spentByMe && spentOnMe) return 'soulsCrossed';
  if (spentOnMe) return 'soulSpent';
  if (spentByMe) return 'alreadyPossessed';
  return 'swap';
}
