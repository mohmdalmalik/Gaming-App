// PENDING STUB: built in P2B (multiplayer build plan). It will be the device key in storage (DESIGN §11.4).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P2B'); };

export function guestKey() { return pending(); }
