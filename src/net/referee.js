// PENDING STUB: built in P1B (multiplayer build plan). It will be the referee: phases, questions, deadlines, bot steps, holds, walk modes (DESIGN §5).
// For now it only names the final exports, each of which throws when called, so the README can list the file and
// later phases can replace it without touching anything else. Nothing imports it yet.
const pending = () => { throw new Error('PENDING STUB: built in P1B'); };

export function createReferee() { return pending(); }
createReferee.restore = () => pending();
