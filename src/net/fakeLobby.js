// PENDING STUB: built in P3 (multiplayer build plan). It will be development only (?coop=fake on localhost, dynamic import): scripted waiting-room states and errors.
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P3'); };

export function openFakeCoop() { return pending(); }
