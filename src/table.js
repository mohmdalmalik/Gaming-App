// The table: who sits in each seat of a game. Pure (no DOM, no three.js): a server can seat a table the
// same way later. Every seat is { id, name, color, avatar } in seat order:
//   id      'p1' … 'p6', BY SEAT (the rules key knowledge, souls and private notes by it)
//   name    the username, as everyone at the table sees it
//   color   the seat's colour (ring, strip, feed), BY SEAT: yours can change from game to game
//   avatar  how the guest looks (src/data/wardrobe.js ids)
//   outfit  the matching outfit of src/data/characters.js, for the views that still read it
// The six named guests (Victor, Clara …) are not players: they stay as guests of the menu's 3D lobby.
import { normaliseAvatar, DEFAULT_AVATAR } from './data/wardrobe.js';
import { tableAvatars } from './data/randomAvatar.js';

export const SEAT_COLORS = ['#e6b45a', '#5ac8e6', '#a8e05a', '#e67ab8', '#f0743c', '#b8a2f0'];

// (each look's outfit in src/data/characters.js: what the views keyed by outfit understand)
export const OUTFIT_OF_BASE = {
  victor: 'tuxedo', marcus: 'suit', henry: 'dinnerJacket', clara: 'dressBurgundy', eleanor: 'dressMidnight', beatrice: 'dressEmerald',
};

// A player with no profile yet (a direct link on a new device): 'Guest' is reserved, so nobody else can
// be called that.
export const STAND_IN = Object.freeze({ username: 'Guest', avatar: DEFAULT_AVATAR });

// The computer guests' looks: each one's own, rolled from its username (src/data/randomAvatar.js: its own
// random numbers, never the match's), free items only, and no two guests at the table in the same look
// (nor in yours) while there are looks enough. `avoid`: the avatars already seated (yours).
export function botAvatars(usernames, { avoid = [] } = {}) {
  return tableAvatars(usernames.map(String), { taken: avoid.filter(Boolean) }).map(av => normaliseAvatar(av));
}

// Seat a table. `me`: { username, avatar } (the player); `bots`: [{ username, avatar }] for the other
// seats, in seat order; `seat`: the player's seat.
export function seatTable({ me, bots = [], seat = 0 }) {
  const people = bots.slice();
  people.splice(Math.max(0, Math.min(people.length, seat)), 0, me);
  return people.map((p, i) => {
    const avatar = normaliseAvatar(p.avatar);
    return { id: `p${i + 1}`, name: p.username, color: SEAT_COLORS[i % SEAT_COLORS.length], avatar, outfit: OUTFIT_OF_BASE[avatar.base] };
  });
}
