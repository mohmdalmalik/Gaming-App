// PENDING STUB: built in P2B (multiplayer build plan). It will be an in-page transport to rooms.js for the review link (DESIGN §16).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P2B'); };

export function createLoopback() { return pending(); }
