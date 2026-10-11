// WHAT ONE GUEST KNOWS FOR CERTAIN about who is possessed. Pure (no DOM, no THREE): the interface uses
// it (red eyes on the guests you know are possessed, on your own screen only), and a server could
// reuse it unchanged.
//
// It reads ONLY that guest's own record and own private events — never another guest's role, hand,
// notes or inbox, and never the public log (which never carries a role). Possession is never undone,
// so a guest once known to be possessed stays known, alive or dead (the caller leaves out the dead if
// it wants to). The guest themselves is never in the set: their own role is player.possessed.
//
// Ways a guest knows another is possessed (docs/GAME_RULES.md > Trade, Possession, Cards):
//   convertedBy / 'possessed' { by }      the guest whose Possession card possessed them
//   'converted' { who }                   a guest they possessed
//   'traded' { with, got: 'possession' }  a Possession card reached them (only a possessed guest can give one)
//   'blockedThem' { who }                 they blocked that guest's Possession card with a Lantern
//   'soulSpent' { by }                    that guest handed them a soul while they were already possessed
//   'alreadyPossessed' { who }            they handed that guest a soul, and that guest already was possessed
//   'soulsCrossed' { with }               they and that guest both handed over a soul
//   'mirrorSaw' { target, hand }          a Hand Mirror showed that guest holding a Possession card
//   player.knows                          what the rules engine already recorded (blocks, mirrors, spent souls)
// NOT a way: being blocked ('blocked' { by }: a Lantern blocks whatever the blocker's own role), being
// looked at in a Hand Mirror ('mirroredBy'), the Switchboard's count (how many, never who).
//
// Events name guests by seat (player.index); the result holds player ids.
export function knownPossessed(state, player) {
  const known = new Set();
  if (!player) return known;
  const bySeat = seat => state.players[seat]?.id;
  const add = id => { if (id != null && id !== player.id) known.add(id); };
  for (const id of player.knows || []) add(id);
  if (player.convertedBy != null) add(player.convertedBy);
  for (const e of player.inbox || []) {
    switch (e.type) {
      case 'possessed': add(bySeat(e.by)); break;
      case 'converted': add(bySeat(e.who)); break;
      case 'traded': if (e.got === 'possession') add(bySeat(e.with)); break;
      case 'blockedThem': add(bySeat(e.who)); break;
      case 'soulSpent': add(bySeat(e.by)); break;
      case 'alreadyPossessed': add(bySeat(e.who)); break;
      case 'soulsCrossed': add(bySeat(e.with)); break;
      case 'mirrorSaw': if ((e.hand || []).includes('possession')) add(bySeat(e.target)); break;
      default: break;
    }
  }
  return known;
}

// Whether `player` certainly knows that `other` is possessed (the same reasoning, for one guest).
export const knowsIsPossessed = (state, player, other) => !!other && knownPossessed(state, player).has(other.id);
