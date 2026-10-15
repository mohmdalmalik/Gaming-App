// Red eyes on known allies (owner-approved, 10 Oct 2026). While the player is possessed, every guest
// they KNOW is possessed wears red eyes on the player's own screen: the guest in the hotel
// (characterView.setPossessed, src/main.js), the guest strip (src/hud.js), the meeting portraits
// (src/ui/meeting.js) and the trade scenes (src/ui/tradeReveal.js). What they know comes from the rules
// engine's knowledge helper (src/game/knowledge.js) and nothing else — never a guest's real role.
// Never in practice, never for a clean viewer, never on a guest the player is not certain of. The
// player's own red eyes are decided where they always were (their own guest, panel and screens).
//
// The same knowledge also drives the guest strip's "Possessed" marker (src/ui/stripModel.js), which is for BOTH
// sides: a clean guest who learned that someone is possessed (a Hand Mirror, a Lantern that blocked a Possession
// card) sees that guest marked on their own strip, though never with red eyes (those stay for a possessed viewer).
import { knownPossessed } from '../game/knowledge.js';

const NONE = new Set();
let memo = { viewer: null, key: '', set: NONE };
// A guest the trade scene on screen is about to SHOW to be possessed: held back (no red eyes anywhere)
// until the scene shows it, so the strip or the hotel behind the scene never gives it away first.
const held = new Set();

// The ids of the guests `viewer` CERTAINLY knows are possessed right now, whichever side the viewer is on (never
// the viewer themselves, never anyone they are not sure of; none in practice). Cheap enough to ask every frame:
// worked out again only when what the viewer knows can have changed (a new private event).
export function knownPossessedIds(state, viewer) {
  if (!state || state.practice || !viewer || (state.players?.length ?? 0) < 2) return NONE;
  const key = `${viewer.id}|${viewer.inbox?.length ?? 0}|${viewer.knows?.size ?? 0}|${viewer.convertedBy ?? ''}`;
  // (a new game deals new guest records, so a new viewer object starts afresh)
  if (memo.viewer !== viewer || memo.key !== key) memo = { viewer, key, set: knownPossessed(state, viewer) };
  if (!held.size) return memo.set;
  return new Set([...memo.set].filter(id => !held.has(id)));
}

// The ids of the guests whose red eyes `viewer` (the player) sees right now: the same guests, but only while the
// viewer is possessed themselves (approved, 10 Oct 2026: never for a clean viewer).
export function redEyedAllies(state, viewer) {
  return viewer?.possessed ? knownPossessedIds(state, viewer) : NONE;
}

// The trade scene (src/ui/tradeReveal.js): hold a guest back while it plays, and let them go the moment it
// shows them (or the scene closes).
export function holdAlly(id) { if (id != null) held.add(id); }
export function releaseAlly(id) { if (id == null) held.clear(); else held.delete(id); }
