// PER-SEAT CARD ALIASES (DESIGN §6.5). The engine numbers its cards c1, c2, ... and a card keeps its number for the
// whole match, from hand to hand. If a device saw those numbers it could follow a card it once held into someone
// else's hand. So a Co-op table shows each seat its own cards under aliases: a card entering a seat's hand gets a
// fresh random alias, leaving the hand deletes it, and coming back gets a new one. Nobody can follow a card.
// Pure: the random bytes are injected (Node: crypto.randomFillSync; a page: b => crypto.getRandomValues(b)).
//
//   const aliases = createAliases(randomBytes);
//   aliases.sync(state)              after every change: aliases of cards that left each hand go, new cards get one
//   aliases.aliasFor(seat, engineId) the seat's alias for its card (one is made if it has none yet)
//   aliases.idFor(seat, alias)       the engine id back (a command's card), or null: an unknown alias → notYourCard
//   aliases.toJSON() / aliases.restore(json)   saved with the table
//
// An alias is 8 characters from 32 easy-to-read letters and digits, never starting with 'c', so it can never look
// like an engine id. No alias is ever issued twice at a table (every one issued is remembered), so an alias a seat
// has seen never comes back. Single player uses `identityAliases` (alias = engine id), so the tests and hooks that
// pass card ids keep working.
export const ALIAS_LENGTH = 8;
const REST = 'abcdefghijkmnpqrstuvwxyz23456789';      // 32: no l, o, 0 or 1
const FIRST = REST.replace('c', '');                  // 31: never 'c' (engine ids are 'c' + digits)
const FIRST_LIMIT = Math.floor(256 / FIRST.length) * FIRST.length;   // 248: bytes at or above are drawn again

export function createAliases(randomBytes) {
  if (typeof randomBytes !== 'function') throw new Error('createAliases needs a random bytes source');
  const seats = new Map();      // seat -> { toAlias: Map(engineId -> alias), toId: Map(alias -> engineId) }
  const used = new Set();       // every alias ever issued at this table
  const buf = new Uint8Array(16);
  let at = buf.length;
  const byte = () => { if (at >= buf.length) { randomBytes(buf); at = 0; } return buf[at++]; };

  function draw() {
    let s;
    do { const b = byte(); if (b < FIRST_LIMIT) s = FIRST[b % FIRST.length]; } while (!s);
    while (s.length < ALIAS_LENGTH) s += REST[byte() & 31];
    return s;
  }
  function fresh() {
    for (let tries = 0; tries < 1000; tries++) { const a = draw(); if (!used.has(a)) { used.add(a); return a; } }
    throw new Error('aliases: no fresh alias (is the random source working?)');
  }
  const mapsOf = seat => {
    let m = seats.get(seat);
    if (!m) { m = { toAlias: new Map(), toId: new Map() }; seats.set(seat, m); }
    return m;
  };
  const forget = (m, id) => { const a = m.toAlias.get(id); m.toAlias.delete(id); if (a != null) m.toId.delete(a); };

  // (Closures, not methods: `aliasOf: aliases.aliasFor` can be passed on as it is.)
  const aliasFor = (seat, engineId) => {
    if (engineId == null) return engineId;
    const m = mapsOf(seat);
    let a = m.toAlias.get(engineId);
    if (a == null) { a = fresh(); m.toAlias.set(engineId, a); m.toId.set(a, engineId); }
    return a;
  };
  const idFor = (seat, alias) => seats.get(seat)?.toId.get(alias) ?? null;

  function sync(state) {
    for (const p of state.players || []) {
      const m = mapsOf(p.index);
      const inHand = new Set((p.hand || []).map(c => c.id));
      for (const id of [...m.toAlias.keys()]) if (!inHand.has(id)) forget(m, id);
      for (const c of p.hand || []) aliasFor(p.index, c.id);
    }
  }

  function toJSON() {
    return { v: 1, seats: [...seats].map(([seat, m]) => [seat, [...m.toAlias]]), used: [...used] };
  }
  function restore(json) {
    const j = typeof json === 'string' ? JSON.parse(json) : json;
    seats.clear(); used.clear();
    for (const a of j?.used || []) used.add(a);
    for (const [seat, pairs] of j?.seats || []) {
      const m = mapsOf(seat);
      for (const [id, a] of pairs) { m.toAlias.set(id, a); m.toId.set(a, id); used.add(a); }
    }
  }

  return { aliasFor, idFor, sync, toJSON, restore };
}

// Single player: every card's alias is its engine id.
export const identityAliases = Object.freeze({
  aliasFor: (seat, engineId) => engineId,
  idFor: (seat, alias) => alias ?? null,
  sync() {},
  toJSON: () => null,
  restore() {},
});
