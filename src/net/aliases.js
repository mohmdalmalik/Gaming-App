// PENDING STUB: built in P1A (multiplayer build plan). It will be per-seat card aliases (DESIGN §6.5).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P1A'); };

export function createAliases() { return pending(); }
export const identityAliases = Object.freeze({ aliasFor: pending, idFor: pending, sync: pending, toJSON: pending, restore: pending });
