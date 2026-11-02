// CO-OP (playing with friends online): the server's address, the protocol version and every technical number,
// plus the rules a Co-op table plays by. Pure data (the page and the server both import it; nothing here touches
// the DOM or Node). Every word the player reads is in src/data/onlineText.js, not here.
//
// Nothing here changes Single player, and nothing here is a rule of docs/GAME_RULES.md:
//   - ONLINE_RULES.today is today's rules, as a Co-op table applies them, plus marked TECHNICAL PLACEHOLDERS (TP)
//     where today's rules are silent or cannot apply to several people (TP1-TP9 below). They are not rules.
//   - ONLINE_RULES.pending is a PROPOSAL waiting for the owner's approval (the rule list R1-R12 in the design's
//     owner-decisions file). It is NOT A RULE and is never used while ONLINE_RULES.approved is false. Only the lead
//     sets `approved`, and only after the owner approves that list; then the numbers move into src/data/rules.js and
//     docs/GAME_RULES.md gets the approved wording in the same commit (CLAUDE.md "Rules changes").
//   - ONLINE.server.open stays false until the owner has approved the list (at least R1, R2, R3, R6, R8, R10) and opened
//     a hosting account (owner decision D7). Until then the live site shows "Coming soon".
//
// The technical placeholders (what a Co-op table does while the owner decides; each goes when its rule is approved):
//   TP1  every seat is dealt with today's "Random" role; no role picker at Co-op tables            (until R2)
//   TP2  the host picks 4, 5 or 6 guests; bots fill empty seats; no joining a running match       (until R1)
//   TP3  no time limit on meeting choices, cards, Fire Exit answers or your own private screens (today's rules),
//        but a single wait over 5 minutes stops the match without a result (stallMs)              (until R3-R6)
//   TP4  an away or departed person keeps their seat; their guest's turns run out on the 45 s clock (until R6-R8)
//   TP5  a guest who is out can watch or leave; no "Skip to the result" at Co-op tables            (until R9)
//   TP6  the table's clock is the server's: device pauses and test links do nothing at Co-op tables (until R10)
//   TP7  Co-op matches don't count in Your record or achievements (countInRecord false)             (D4, D5)
//   TP8  bots look like players in the match (botLabels false)                                      (D3)
//   TP9  the private-screen pause applies only to the active player's own screens                   (until R4)
import { rules } from './rules.js';

export const ONLINE = {
  protocol: 1, minProtocol: 1,
  // live: the wss:// address once the owner has a hosting account (null: none yet). local: a server on this computer.
  server: { live: null, local: 'ws://localhost:8787', open: false },
  // Table codes: 5 letters from 18 consonants (no vowels or Y, so no words; no L or Q). inputMax: what the code
  // field accepts, so a whole pasted invite link fits (normaliseCode in src/net/codes.js cleans it).
  code: { alphabet: 'BCDFGHJKMNPRSTVWXZ', length: 5, reuseHours: 24, inputMax: 200 },
  table: { sizes: [4, 5, 6], defaultSize: 6, minPeople: 2, maxPeople: 6 },
  timing: {
    tickMs: 250,                 // the server ticks every table this often
    graceMs: 500,                // a command arriving up to this long after a deadline still counts
    startCountdownMs: 5000,      // "The lift is on its way… 5"
    roleAckMs: 20000,            // turn 1 starts at most this long after the role screens (technical, T6)
    heartbeatMs: 10000,          // the server pings every socket this often
    awayAfterHiddenMs: 5000,     // others see Away after the page is hidden this long
    hostAwayMs: 120000,          // a host away this long in the waiting room hands the host on
    lobbyAwayFreeMs: 120000,     // a person away this long in the waiting room loses their seat
    emptyMatchCloseMs: 120000,   // no person connected this long: the match ends without a result
    idleWaitingCloseMs: 3600000, // a waiting table unused this long closes
    afterMatchCloseMs: 600000,   // an ended table unused this long closes
    closedFilesKeepMs: 86400000, // a closed table's saved file is deleted after this
    reconnectPillMs: 1000,       // "Reconnecting…" shows after this long without the server
    lostCardMs: 20000,           // "Still reconnecting…" shows after this long
    retryCapMs: 10000,           // reconnect retries back off to at most this
    pingCheckMs: 3000,           // no pong this long after a ping: reconnect
    liveSilenceMs: 25000,        // no message this long while visible: ping
    wakeSlowMs: 4000,            // "The hotel's switchboard is waking up…" after this long
    stallBannerMs: 60000,        // the stall countdown (TP3) shows after one wait passes this
    rememberTableMs: 21600000,   // a reload within this long rejoins the remembered table
    walkMsPerRoom: 1900,         // derived, not measured: rooms are 8 m apart (src/config.js), bots walk
                                 // player.speed 2.9 m/s x 1.45 (src/main.js) ≈ 4.2 m/s → ≈ 1.9 s a room
    helloTimeoutMs: 5000,        // a socket that sends no hello this long is closed (4010)
    restartRetryMs: 3000,        // after a server restart, devices try again this long later
    restoreGraceMs: 15000,       // a restored match moves every open deadline later by the outage plus this
    faultWindowMs: 60000,        // a second fault at one table within this ends that match politely
    drainMs: 25000,              // on SIGTERM the server exits within this
  },
  limits: {
    maxPayload: 4096,            // bytes a device may send in one message
    msgsPerSec: 10, burst: 20,   // per socket
    socketsPerIp: 12, newSocketsPerIpPerMin: 30,
    hellosPerTokenPerMin: 20,
    createsPerIpPerMin: 5, createsPerTokenPerMin: 3, openTablesPerToken: 2, openTablesPerIp: 6,
    maxTables: 300,
    wrongCodesPerIpPerMin: 10, wrongCodesPerIpPer10Min: 30,
    sendBufferBytes: 262144,     // unsent bytes before a socket is dropped (it reconnects)
    doIdsKept: 16,               // each seat's last replies kept, so a repeated command acts once
    maxBotStepsPerTick: 50,      // per table per tick
    slowStepMs: 200,             // a table step this slow twice ends that match politely
    doIdMaxChars: 12,            // a command's id is at most this long
  },
  storage: { guest: 'hotelEscape.guest.v1', table: 'hotelEscape.table.v1' },
  botLabels: false,       // OWNER DECISION D3 (recommended: true, a small "Bot" tag at Co-op tables). TP8
  countInRecord: false,   // OWNER DECISIONS D4/D5 (recommended: true, your own actions only). TP7
};

// Single player's limits: today's game exactly (the device's own clock, paused by the device; no other limits).
// `clock` follows the rules as the match was dealt (applyMode, ?timer=off), so it is read when used.
export const LOCAL_LIMITS = {
  get clock() { return rules.turnTimerEnabled ? 'device' : null; },
  turnMs: rules.turnTimerSeconds * 1000,
  discardMinMs: rules.discardMinSeconds * 1000,
  meetMs: null, cardMs: null, offerMs: null, screenCapMs: null, startAckMs: null,
  standIn: false, idleTimeouts: null, stallMs: null, devicePauses: true,
};

const today = {
  clock: 'server',                              // TP6: the table's clock is the server's
  turnMs: rules.turnTimerSeconds * 1000,        // today's rule (45 s)
  discardMinMs: rules.discardMinSeconds * 1000, // today's rule (at least 10 s to discard)
  meetMs: null, cardMs: null, offerMs: null,    // today: no limit on meeting choices, cards, Fire Exit answers
  screenCapMs: null,                            // today: a private screen pauses your clock without a cap (TP9)
  startAckMs: ONLINE.timing.roleAckMs,          // technical (T6): turn 1 starts at most 20 s after the role screens
  standIn: false, idleTimeouts: null,           // no rule today (TP4)
  stallMs: 300000,                              // TP3 PLACEHOLDER: one wait over 5 minutes stops the match, no result
  devicePauses: false,                          // TP6: no device pauses the table
  offerOncePerTurn: false,
  relaxedFactor: 1,
};

export const ONLINE_RULES = {
  approved: false,        // set only by the lead after the owner approves the rule list R1-R12. Never by a builder.
  today,
  // PROPOSED, NOT RULES: waiting for the owner's approval. Never used while `approved` is false.
  pending: {
    ...today,
    meetMs: 20000, cardMs: 20000, offerMs: 20000,   // R3, R5 (PROPOSED)
    screenCapMs: 10000,                             // R4 (PROPOSED; owner choice D2b: 10 s or 15 s)
    standIn: true, standInGraceMs: 10000,           // R6 (PROPOSED)
    idleTimeouts: 2,                                // R7 (PROPOSED)
    offerOncePerTurn: true,                         // R5 (PROPOSED)
    relaxedFactor: 2,                               // R10 (PROPOSED): the host's Relaxed clock doubles every limit
    stallMs: null,                                  // TP3 goes when R3-R6 are approved
  },
};

export const activeOnlineRules = () => (ONLINE_RULES.approved ? ONLINE_RULES.pending : ONLINE_RULES.today);
