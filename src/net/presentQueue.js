// PENDING STUB: built in P4 (multiplayer build plan). It will be plays updates in order; skips to the latest past 3 s of backlog (DESIGN §11.6).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P4'); };

export function createPresentQueue() { return pending(); }
