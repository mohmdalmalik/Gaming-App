// The table: who sits in each seat of a game. Pure (no DOM, no three.js): a server can seat a table the
// same way later. Every seat is { id, name, color, avatar } in seat order:
//   id      'p1' … 'p6', BY SEAT (the rules key knowledge, souls and private notes by it)
//   name    the username, as everyone at the table sees it
//   color   the seat's colour (ring, strip, feed), BY SEAT: yours can change from game to game
//   avatar  how the guest looks (src/data/wardrobe.js ids)
//   outfit  the matching outfit of src/data/characters.js, for the views that still read it (outfitOf)
// The six named guests (Victor, Clara …) are not players: they stay as guests of the menu's 3D lobby.
import { normaliseAvatar, outfitOf, DEFAULT_AVATAR } from './data/wardrobe.js';
import { tableAvatars } from './data/randomAvatar.js';

// The six seat colours: gold, sky, blue, pink, vermillion, lilac. Chosen so that no two merge for the common
// kinds of colour blindness (checked with the Machado simulations for protanopia, deuteranopia and
// tritanopia: every pair stays at least 17 apart in CIELAB, where the old set had pairs at 5); the old
// lime was the one that merged with gold and orange. Never the only mark of a guest: the plan and the
// strip also carry the guest's initial.
export const SEAT_COLORS = ['#e6bc5c', '#73d4e6', '#2f8cff', '#e673ac', '#e6652e', '#b6b2ff'];

// The short mark of each guest, for places that show a guest as a small coloured shape (the plan's dots, the
// strip's portraits): the first letter of the name, in capitals. Two guests whose names start with the same
// letter get two letters each ("Ha", "He"); if even those match, their seat numbers. Public (names are).
export function guestMarks(names) {
  const chars = n => [...String(n ?? '').replace(/[^\p{L}\p{N}]/gu, '')];
  const one = names.map(n => (chars(n)[0] || '?').toUpperCase());
  const two = one.map((m, i) => (one.some((x, j) => j !== i && x === m) ? m + (chars(names[i])[1] || '').toLowerCase() : m));
  return two.map((m, i) => (two.some((x, j) => j !== i && x === m) ? String(i + 1) : m));
}

// A player with no profile yet (a direct link on a new device): 'Guest' is reserved, so nobody else can
// be called that.
export const STAND_IN = Object.freeze({ username: 'Guest', avatar: DEFAULT_AVATAR });

// The computer guests' looks: each one's own, rolled from its username (src/data/randomAvatar.js: its own
// random numbers, never the match's), unlockable items at about the rate players wear them, and no two guests at
// the table alike (nor like yours). `avoid`: the avatars already seated (yours). Seated `trusted`: a bot's
// unlockable item is never taken off for want of an inventory.
export function botAvatars(usernames, { avoid = [] } = {}) {
  return tableAvatars(usernames.map(String), { taken: avoid.filter(Boolean) }).map(av => normaliseAvatar(av, { trusted: true }));
}

// Seat a table. `me`: { username, avatar } (the player); `bots`: [{ username, avatar }] for the other
// seats, in seat order; `seat`: the player's seat. Every avatar is made safe `trusted` (checked when it was saved
// or rolled): an item the player owns stays on at the table (it was taken off before: free items only).
export function seatTable({ me, bots = [], seat = 0 }) {
  const people = bots.slice();
  people.splice(Math.max(0, Math.min(people.length, seat)), 0, me);
  return people.map((p, i) => {
    const avatar = normaliseAvatar(p.avatar, { trusted: true });
    return { id: `p${i + 1}`, name: p.username, color: SEAT_COLORS[i % SEAT_COLORS.length], avatar, outfit: outfitOf(avatar) };
  });
}
