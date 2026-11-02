// PENDING STUB: built in P4 (multiplayer build plan). It will be Screen Wake Lock during the waiting room and the match (DESIGN §11.1).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P4'); };

export function holdWakeLock() { return pending(); }
