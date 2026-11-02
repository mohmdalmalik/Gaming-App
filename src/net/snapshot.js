// PENDING STUB: built in P1B (multiplayer build plan). It will be engine state + floor to plain JSON and back (DESIGN §10.2).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P1B'); };

export const SNAPSHOT_VERSION = 1;
export function toSnapshot() { return pending(); }
export function fromSnapshot() { return pending(); }
