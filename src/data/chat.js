// Quick chat (a match only): the preset lines and emotes a guest can send to the whole table, and the
// numbers that pace it. No typing: only these. A social layer, not a rule: nothing in src/game/ reads
// this file, and nothing said here changes what anyone may do.
//
// A message is { seat, id, at }: who said it (the seat), which line or emote (an id below) and when (ms).
// That is all a server would ever need to relay. Chat is public to the whole table, so a message never
// carries anything else — no role, no card, no private result.
//
// Bots chat too (src/bots/chatter.js): what they may say, and when, is the BOT_CHAT table at the end.

// The lines, in the order the chat panel shows them.
export const CHAT_PHRASES = [
  { id: 'greet', text: 'Good evening!' },
  { id: 'trade', text: 'Shall we trade?' },
  { id: 'needLantern', text: 'Need a Lantern?' },
  { id: 'haveLantern', text: 'I have a Lantern.' },
  { id: 'trust', text: 'Trust me.' },
  { id: 'watch', text: 'Watch out!' },
  { id: 'thanks', text: 'Thank you.' },
  { id: 'sorry', text: 'Sorry!' },
  { id: 'gg', text: 'Good game!' },
];

// The emotes: small brass line drawings (src/ui/chat.js draws them). `does` is the feed line for
// another guest ("Henry waves."), `you` for the player ("You wave.").
export const CHAT_EMOTES = [
  { id: 'wave', label: 'Wave', does: 'waves', you: 'wave' },
  { id: 'smile', label: 'Smile', does: 'smiles', you: 'smile' },
  { id: 'laugh', label: 'Laugh', does: 'laughs', you: 'laugh' },
  { id: 'gasp', label: 'Gasp', does: 'gasps', you: 'gasp' },
  { id: 'suspicious', label: 'Suspicious', does: 'looks suspicious', you: 'look suspicious' },
  { id: 'cross', label: 'Cross', does: 'frowns', you: 'frown' },
];

export const CHAT = {
  cooldownMs: 3000,     // after sending, the player waits this long before the next message
  bubbleMs: 3500,       // how long a speech bubble stays over the speaker
  pollMs: 250,          // how often the bots' chatter looks for something to say (the interface asks)
};

// The computer guests' chat (src/bots/chatter.js). Each moment below is a chance to say something:
// `chance` (before the guest's own chattiness), what it may say (`say`: [id, weight] pairs), and how long
// after the moment it says it (`delay`: [min, max] ms). A line not said within `staleMs` of its moment is
// dropped (the moment has passed). Every moment is PUBLIC (or the bot's own hand): a bot never reacts to
// anything it could not know, and a possessed bot says the same things, as often, as a clean one would.
export const BOT_CHAT = {
  gapMs: 20000,         // one bot: at most one line this often
  tableGapMs: 4500,     // all the bots together: at most one line this often
  endGapMs: 1300,       // ...except at the end of the match ("Good game!")
  staleMs: 6000,
  backlog: 14,          // more new public events than this at once (the match was skipped to its end):
                        // nothing was seen as it happened, so only the end is answered
  // how much each kind of guest talks (src/bots/profiles.js styles)
  chattiness: { bold: 1.3, medium: 1, careful: 0.55 },
  // "I have a Lantern." from a guest holding none (a bluff), compared with one that holds one: so the line
  // is a claim, never proof of what another guest carries
  lanternBluff: 0.35,
  moments: {
    // the start of the match (round 1)
    start: { chance: 0.5, say: [['greet', 3], ['wave', 2]], delay: [1500, 9000] },
    // the player said "Good evening!" or waved: at most `max` bots answer
    answerGreet: { chance: 0.65, max: 2, say: [['greet', 3], ['wave', 2], ['smile', 1]], delay: [900, 2600] },
    // the player said "Sorry!" soon after attacking this bot
    answerSorry: { chance: 0.6, within: 25000, say: [['cross', 2], ['smile', 1]], delay: [900, 2200] },
    // the player said "Good game!" (a bot that has not said it yet)
    answerGG: { chance: 0.5, max: 2, say: [['gg', 3], ['smile', 1]], delay: [900, 2600] },
    // it traded with someone (whatever changed hands: the trade itself is all the table sees)
    traded: { chance: 0.4, say: [['thanks', 3], ['smile', 1]], delay: [700, 2200] },
    // it was attacked, and lived / and died
    attacked: { chance: 0.75, say: [['watch', 3], ['gasp', 2], ['cross', 1]], delay: [500, 1500] },
    killed: { chance: 0.5, say: [['gasp', 1]], delay: [300, 900] },
    // it attacked someone
    attacker: { chance: 0.3, say: [['sorry', 1]], delay: [900, 2400] },
    // someone else was attacked (an attack is public)
    sawAttack: { chance: 0.1, say: [['gasp', 1]], delay: [600, 2000] },
    // a Hand Mirror was used on it
    mirrored: { chance: 0.35, say: [['suspicious', 1]], delay: [600, 1800] },
    // the Switchboard said someone is possessed
    switchboard: { chance: 0.15, say: [['suspicious', 2], ['gasp', 1]], delay: [900, 2600] },
    // its turn begins with another guest in its room or next door (from round 2): its plan, or a bluff
    // ("I have a Lantern." mostly while it holds one: lanternBluff)
    nearby: { chance: 0.18, fromRound: 2, say: [['trade', 3], ['haveLantern', 2], ['trust', 1]], delay: [600, 2000] },
    // it walked in on someone (a meeting follows; `brief`: not said once the meeting's screen is up)
    walkIn: { chance: 0.25, brief: true, say: [['trade', 2], ['trust', 2], ['greet', 1]], delay: [150, 500] },
    // the match is over: at most `max` bots say so
    end: { chance: 0.75, max: 3, say: [['gg', 4], ['smile', 1]], delay: [900, 5000] },
  },
};
