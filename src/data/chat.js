// Quick chat (a match only): the preset lines and emotes a guest can send to the whole table, and the
// numbers that pace it. No typing: only these. A social layer, not a rule: nothing in src/game/ reads
// this file, and nothing said here changes what anyone may do.
//
// A message is { seat, id, at } — or { seat, id, about, at } for a line about another guest (`about`: that
// guest's seat). That is all a server would ever need to relay. Chat is public to the whole table, so a
// message never carries anything else — no role, no card, no private result. What a line CLAIMS ("nora
// tried to possess me!") may be true or a lie: it is talk, never proof.
//
// Bots chat too: what they say, and when, is BOT_CHAT below (src/bots/chatter.js); how they weigh what
// they hear is BOT_HEAR (src/bots/brain.js).

// The two tabs of the chat panel, and the lines in each, in the order the panel shows them.
// `about: true`: the line names a guest (the panel asks "Choose a guest" after the tap). `text` is the
// line with {name} where that guest's name goes; `you` is how it reads on the screen of the guest it
// names ("I don't trust you."). A line without `you` shows that guest's own name ("Stay away from nora!").
export const CHAT_TABS = [
  { id: 'table', label: 'Table' },
  { id: 'suspicion', label: 'Suspicion' },
];
export const CHAT_PHRASES = [
  // Table: manners, Lanterns and plans
  { id: 'greet', tab: 'table', text: 'Good evening!' },
  { id: 'trade', tab: 'table', text: 'Shall we trade?' },
  { id: 'needLantern', tab: 'table', text: 'Need a Lantern?' },
  { id: 'haveLantern', tab: 'table', text: 'I have a Lantern.' },
  { id: 'whoLantern', tab: 'table', text: 'Who has a Lantern?' },
  { id: 'meetExit', tab: 'table', text: 'Meet me at the Fire Exit.' },
  { id: 'watch', tab: 'table', text: 'Watch out!' },
  { id: 'thanks', tab: 'table', text: 'Thank you.' },
  { id: 'sorry', tab: 'table', text: 'Sorry!' },
  { id: 'gg', tab: 'table', text: 'Good game!' },
  // Suspicion: who is who
  { id: 'clean', tab: 'suspicion', text: 'I am clean.' },
  { id: 'iAmPossessed', tab: 'suspicion', text: 'I am possessed.' },
  { id: 'trust', tab: 'suspicion', text: 'Trust me.' },
  { id: 'ringSwitchboard', tab: 'suspicion', text: 'Ring the Switchboard!' },
  { id: 'triedPossess', tab: 'suspicion', about: true, text: '{name} tried to possess me!', you: 'You tried to possess me!' },
  { id: 'isPossessed', tab: 'suspicion', about: true, text: '{name} is possessed!', you: 'You are possessed!' },
  { id: 'isClean', tab: 'suspicion', about: true, text: '{name} is clean.', you: 'You are clean.' },
  { id: 'trustX', tab: 'suspicion', about: true, text: 'I trust {name}.', you: 'I trust you.' },
  { id: 'distrustX', tab: 'suspicion', about: true, text: "I don't trust {name}.", you: "I don't trust you." },
  { id: 'stayAway', tab: 'suspicion', about: true, text: 'Stay away from {name}!' },
];

// The emotes: small brass line drawings (src/ui/chat.js draws them). `does` is the feed line for
// another guest ("nora waves."), `you` for the player ("You wave.").
export const CHAT_EMOTES = [
  { id: 'wave', label: 'Wave', does: 'waves', you: 'wave' },
  { id: 'smile', label: 'Smile', does: 'smiles', you: 'smile' },
  { id: 'laugh', label: 'Laugh', does: 'laughs', you: 'laugh' },
  { id: 'gasp', label: 'Gasp', does: 'gasps', you: 'gasp' },
  { id: 'suspicious', label: 'Suspicious', does: 'looks suspicious', you: 'look suspicious' },
  { id: 'cross', label: 'Cross', does: 'frowns', you: 'frown' },
];

// The lines that name a guest (a message with one of these ids carries `about`; no other does).
export const ABOUT_IDS = new Set(CHAT_PHRASES.filter(p => p.about).map(p => p.id));

export const CHAT = {
  cooldownMs: 3000,     // after sending, the player waits this long before the next message
  bubbleMs: 3500,       // how long a speech bubble stays over the speaker
  aboutBubbleMs: 4500,  // ...a line that names a guest (a longer read)
  pollMs: 250,          // how often the bots' chatter looks for something to say (the interface asks)
};

// The computer guests' chat (src/bots/chatter.js). Each moment below is a chance to say something:
// `chance` (before the guest's own chattiness), what it may say (`say`: [id, weight] pairs), and how long
// after the moment it says it (`delay`: [min, max] ms). A line not said within `staleMs` of its moment
// (the moment's own `staleMs`, or the table's) is dropped: the moment has passed. `prio`: a moment with a
// higher priority replaces a line still waiting (an accusation is never lost behind a "Thank you.").
// `free`: not held back by the bot's own gap (it still waits for the table's). Moments with `base` work
// out their chance from the bot itself: base + bold × its boldness (+ what the moment adds).
// Every moment is something that guest may know: a public event, its own hand, its own private results
// (a trade it made, a Lantern block it made or suffered, a Hand Mirror it used), what it believes
// (src/bots/brain.js, built from the same), or what was said at the table.
export const BOT_CHAT = {
  gapMs: 20000,         // one bot: at most one line this often (unless `free`)
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
  // For one bot in one match: strong accusations ("tried to possess me", "is possessed"), answers to being
  // named strongly, opinions about any one guest, false accusations (a possessed bot's).
  caps: { accuse: 3, deny: 2, opinionPerGuest: 1, frame: 1 },
  moments: {
    // --- small talk (never weighed by the listeners: its rates can change freely) --------------------
    // the start of the match (round 1)
    start: { chance: 0.5, say: [['greet', 3], ['wave', 2]], delay: [1500, 9000] },
    // a guest (a person or a bot alike) said "Good evening!" or waved: at most `max` answers to greetings in
    // any `spanMs`, from the whole table (so greetings never go round and round); a bot that has said
    // "Good evening!" already waves or smiles
    answerGreet: { chance: 0.65, max: 2, spanMs: 20000, say: [['greet', 3], ['wave', 2], ['smile', 1]], delay: [900, 2600] },
    // a guest said "Sorry!" soon after attacking this bot
    answerSorry: { chance: 0.6, within: 25000, say: [['cross', 2], ['smile', 1]], delay: [900, 2200] },
    // a guest said "Good game!" (a bot that has not said it yet; at most end.max + max last words in all)
    answerGG: { chance: 0.5, max: 2, say: [['gg', 3], ['smile', 1]], delay: [900, 2600] },
    // someone asked "Who has a Lantern?": one bot may say it has one (mostly while it holds one:
    // lanternBluff; the same chances whatever its role)
    answerLantern: { chance: 0.25, say: [['haveLantern', 1]], delay: [900, 2600] },
    // it traded with someone (whatever changed hands: the trade itself is all the table sees)
    traded: { chance: 0.4, say: [['thanks', 3], ['smile', 1]], delay: [700, 2200] },
    // ...and it was handed a Lantern: now and then "I trust <them>." (once a guest)
    tradedWell: { chance: 0.5, prio: 1, say: [['thanks', 3], ['trustX', 2]], delay: [700, 2200] },
    // it was attacked, and lived / and died
    attacked: { chance: 0.75, prio: 1, say: [['watch', 3], ['gasp', 2], ['cross', 1], ['stayAway', 2]], delay: [500, 1500] },
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

    // --- who is who (talk that carries information) ------------------------------------------------
    // A CLEAN guest's Lantern burned someone's soul in a trade: it knows. chance = base + bold × boldness
    // + table × (how little it suspects the rest of the table)
    blocked: { base: 0.45, bold: 0.35, table: 0.2, prio: 3, free: true, say: [['triedPossess', 1]], delay: [900, 2600], staleMs: 20000 },
    // its Hand Mirror showed a soul / no soul (the Hand Mirror itself was public)
    sawSoul: { base: 0.6, bold: 0.25, table: 0.1, prio: 3, free: true, say: [['isPossessed', 1]], delay: [900, 2600], staleMs: 20000 },
    sawNoSoul: { chance: 0.3, prio: 1, say: [['isClean', 1]], delay: [900, 2600] },
    // a line about it ("<it> tried to possess me!", "...is possessed!", "Stay away from <it>!" / "I don't
    // trust <it>."): it answers, possessed or clean alike (the same chances: never a tell)
    accusedStrong: { chance: 0.75, prio: 2, free: true, say: [['clean', 3], ['distrustX', 2]], delay: [900, 2400], staleMs: 12000 },
    accusedWeak: { chance: 0.3, prio: 1, say: [['clean', 2], ['distrustX', 1]], delay: [900, 2400] },
    // its turn begins (from round 2) and it strongly suspects a guest (a clean guest: from what it saw and
    // heard; "Stay away" four times as likely when it knows) / a possessed guest: one who knows what it is
    suspects: { chance: 0.2, fromRound: 2, threshold: 0.6, knownBoost: 4, prio: 1, say: [['distrustX', 3], ['stayAway', 1]], delay: [700, 2200] },
    // ...or it trusts a guest a good deal (a Lantern given, cleared by a Hand Mirror or the Switchboard;
    // a possessed guest: an ally, or a guest it is winning over with gifts, at `possessedShare` of the
    // chance: as often a turn as a clean guest says it, so the line never points at either side)
    vouches: { chance: 0.06, fromRound: 2, possessedShare: 0.15, prio: 0, say: [['trustX', 1]], delay: [700, 2200] },
    // plans at the start of its turn: little left to find, a Lantern in hand and the Fire Exit found
    // (a possessed guest: standing guard by it with a soul in hand, a lure) / many trades since the
    // Switchboard last spoke / short of Lanterns with little left to find (either side, the possessed
    // at `possessedShare` of the chance, so it is asked as often a turn by both)
    gather: { chance: 0.25, prio: 0, say: [['meetExit', 1]], delay: [700, 2200] },
    checkCount: { chance: 0.12, trades: 3, prio: 0, say: [['ringSwitchboard', 1]], delay: [700, 2200] },
    askLantern: { chance: 0.06, fromRound: 3, possessedShare: 1, prio: 0, say: [['whoLantern', 1]], delay: [700, 2200] },
    // (`nearby`, `suspects`, `vouches`, `gather`, `checkCount` and `askLantern` are about the bot's own
    // turn: said in it or not at all.)
    // A POSSESSED guest's lies (it never says "I am possessed." during play), each with the same timing as
    // the true line it imitates (`blocked`, `sawSoul`), so when a line comes never tells which it is:
    // its soul was burned by a guest's Lantern, so that guest knows: muddy it first
    counter: { base: 0.2, bold: 0.35, prio: 3, free: true, say: [['triedPossess', 3], ['distrustX', 2]], delay: [900, 2600], staleMs: 20000 },
    // right after a trade in which it handed over no soul, a false "<them> tried to possess me!" about that
    // guest (never an ally, nor one who knows what it is; at most caps.frame a match): chance = base + bold ×
    // boldness + late × (1 if they named an ally, else how late the match is). Its Hand Mirror showing no
    // soul gives it the same chance of the lie "<them> is possessed!"
    frame: { base: 0.04, bold: 0.08, late: 0.12, prio: 3, free: true, say: [['triedPossess', 1]], delay: [900, 2600], staleMs: 20000 },
    // the match is over, nobody escaped (its side won): "I am possessed." as its last word (every role is
    // on the end screen by then)
    confess: { chance: 0.25, say: [['iAmPossessed', 1]], delay: [900, 4000] },
  },
};

// How the computer guests weigh what they hear (src/bots/brain.js). Chat is public: every guest hears the
// same lines, and each weighs them by what IT knows (how much it suspects the speaker, a trade it saw,
// a block it made). Hearsay never makes a guest certain (only its own eyes do), and never moves its
// estimate of one guest by more than `cap` (or below `floor`). The player's lines count like anyone's:
// a bot never knows which seat is a person.
export const BOT_HEAR = {
  on: true,             // (tools only: tools/balance/bot-match.mjs --chat talk turns listening off)
  // how much one line moves a clean listener's estimate that the guest named is possessed (times the
  // speaker's credibility, 0 … 1, and the listener's own trust trait); a claim about oneself ("I am
  // clean.", "I am possessed.") counts in full
  weight: { triedPossess: 0.55, isPossessed: 0.55, stayAway: 0.15, distrustX: 0.06, trustX: -0.06, isClean: -0.3, clean: -0.02, iAmPossessed: 0.15 },
  cap: 0.5, floor: -0.25,
  // what was said counts in full for whom to avoid, meet, trade with in the Fire Exit or pool Lanterns
  // with, in part for an attack, and NOT AT ALL for handing over a Lantern to block: a Lantern "blocked"
  // against a clean guest is simply theirs, so talk must never make a guest a Lantern magnet (measured,
  // QA 12 Oct: at 0.75, a clean guest who lied — "I am possessed.", false or impossible accusations —
  // was handed about a third more Lanterns and escaped about half as often again)
  blockShare: 0, attackShare: 0.75,
  // a claim the table can see is impossible (no trade between the two, no Hand Mirror by the speaker on
  // that guest), or a lie about the listener itself: the speaker looks possessed
  baseless: 0.35, lieAboutMe: 0.5, mistakeAboutMe: 0.05,
  // a claim the listener knows is right: it trusts the speaker more / one it knows is wrong (that guest
  // was cleared): the speaker looks possessed
  confirmed: 0.3, wrong: 0.3,
  // a possessed listener: how much a line makes it think a guest is possessed too (it then holds back a
  // soul: one handed to a guest already possessed is only used up)
  // (liarAboutMe kept low: a guest who falsely says it tried to possess them must not be spared its souls)
  allyHint: { accused: 0.45, iAmPossessed: 0.2, liarAboutMe: 0.2, cap: 0.85 },
};
