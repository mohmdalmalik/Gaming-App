// What one player did in a finished match, for the achievements (src/honours.js, src/data/achievements.js). Pure: it
// reads only the rules engine's PUBLIC events (state.events), the player's OWN private events
// (state.players[seat].inbox), the end state and `found` (the cards the player's own searches put in their hand:
// the rules return them from search() and emit no event, so src/main.js keeps them per game). The same code can run
// on a server later. Nothing here changes the game, and it is only called on the end screen.
//
//   counts / why          false + 'practice' | 'testLink' | 'unfinished' | 'idle': nothing is earned
//   actions               the public events you made (enter, open, search, infirmary, escape; mirror, unlock,
//                         barricade, switchboard, attack)
//   startedPossessed      possessed at the end with no 'possessed' event in your inbox (nobody possessed you)
//   cleanWin              you started clean, were still clean at the end, and the clean side won (alive or not)
//   possessedWin          you started possessed and the possessed side won
//   mirrorSawPossession   your Hand Mirror showed you a Possession card, while you were clean
//   lanternBlocks         Lanterns you handed over that stopped a possession, while you were clean
//   lanternsFound         Lanterns your own searches found (each card once)
// "While you were clean": you did not start possessed, and it came before the first 'possessed' event in your inbox
// (a possessed player could farm a mirror or a block on allies they made).
export const SUMMARY_VERSION = 1;
// A test link (the URL forces something about the match: its mode, deal, clock, bots' pace, role, seat, bots or
// name) earns nothing. intro, camera and stats change nothing in play and are allowed.
export const TEST_PARAMS = ['mode', 'seed', 'timer', 'botpace', 'role', 'seat', 'bots', 'user'];
export const isTestLink = params => TEST_PARAMS.some(k => params?.has?.(k));
export const MIN_ACTIONS = 3;                // fewer = idle: nothing is earned

const BY_SEAT = new Set(['enter', 'open', 'search', 'infirmary', 'escape']);
const BY_BY = new Set(['mirror', 'unlock', 'barricade', 'switchboard', 'attack']);

export function matchSummary(state, seat, { found = [], testLink = false } = {}) {
  const you = state?.players?.[seat];
  const inbox = Array.isArray(you?.inbox) ? you.inbox : [];
  const events = Array.isArray(state?.events) ? state.events : [];
  const actions = events.filter(e => (BY_SEAT.has(e.type) && e.seat === seat) || (BY_BY.has(e.type) && e.by === seat)).length;
  const turned = inbox.find(e => e.type === 'possessed');
  const startedPossessed = !!you?.possessed && !turned;
  const endedPossessed = !!you?.possessed;
  const whileClean = e => !startedPossessed && (!turned || e.seq < turned.seq);
  const sideWon = state?.won === 'humans' ? 'clean' : state?.won === 'possessed' ? 'possessed' : null;
  const lanterns = new Set((Array.isArray(found) ? found : []).filter(c => c?.type === 'lantern').map(c => c.id));
  const why = state?.practice ? 'practice' : testLink ? 'testLink' : !state?.finished || !sideWon ? 'unfinished'
    : actions < MIN_ACTIONS ? 'idle' : null;
  return {
    v: SUMMARY_VERSION,
    counts: !why, why,
    actions,
    startedPossessed, endedPossessed, sideWon,
    cleanWin: !startedPossessed && !endedPossessed && sideWon === 'clean',
    possessedWin: startedPossessed && sideWon === 'possessed',
    mirrorSawPossession: inbox.some(e => e.type === 'mirrorSaw' && Array.isArray(e.hand) && e.hand.includes('possession') && whileClean(e)),
    lanternBlocks: inbox.filter(e => e.type === 'blockedThem' && whileClean(e)).length,
    lanternsFound: lanterns.size,
  };
}
