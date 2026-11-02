// PENDING STUB: built in P2A (multiplayer build plan). It will be the server's brain: tables by code, waiting room, presence, fan-out, saving (DESIGN §7-§10).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P2A'); };

export function createRooms() { return pending(); }
