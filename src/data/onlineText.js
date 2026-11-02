// CO-OP: EVERY NEW WORD the player reads about playing with friends (the menu split, the Co-op screens, the waiting
// room, the in-match additions, connection and recovery, the can't-join cards, the review link). Pure data plus
// two tiny pure helpers; the screens (src/ui/coopMenu.js, src/ui/coopMatch.js, src/ui/seatSwitch.js) read it and
// never write a word of their own, so renaming "Co-op" or rewording anything is an edit here only.
//
// Placeholders in braces are filled by fill() below: {label} (always this file's label), {name}, {host}, {code},
// {letters}, {n}, {size}, {time}, {minutes}, {card}. Numbers come from src/data/online.js and src/data/rules.js,
// never typed into a sentence here.
//
// Where today's rules and the owner's pending rule list (src/data/online.js ONLINE_RULES) would say different things,
// an entry has two forms, { today, pending }; byRules() picks one. `pending` is never shown while the list is not
// approved.
//
// Unchanged and NOT here: the main menu's kicker, title and subtitle, the profile card, How to play, Cards, Settings
// and Your record; and the two buttons the new Single player screen holds, "Play with bots" / "Join a table of 4–6
// guests" and "Practice alone" / "Explore the hotel and find the way out" (index.html), with the new-player hint
// (NEW_PLAYER_HINT in src/data/howToPlay.js). They move into the Single player screen with today's words.

export const ONLINE_TEXT = {
  label: 'Co-op',   // OWNER DECISION D1 (recommended: 'Play with friends'). One line: every screen reads it.

  // --- The main menu (its two big buttons) ---------------------------------------------------------------------
  menu: {
    single: 'Single player',
    singleLine: 'Play with bots, or practice alone.',
    coop: '{label}',
    coopLine: 'A private table with friends, each on their own device.',
  },

  // --- Single player (#menu-single) ----------------------------------------------------------------------------
  single: {
    kicker: 'Single player',
    heading: 'How do you want to play?',
    back: '‹ Back',
  },

  // --- {label}: a server is available (#menu-coop) -------------------------------------------------------------
  coop: {
    kicker: '{label}',
    heading: 'A private table',
    line: 'Everyone plays on their own iPad, phone or computer. One guest is secretly possessed, so keep your screen to yourself.',
    start: 'Start a table',
    startLine: "You'll get a link to send to your friends.",
    codeLabel: 'Have a code?',
    codePlaceholder: '{length} letters',
    join: 'Join',
    back: '‹ Back',
    opening: 'Opening your table…',          // on the pressed button after 1 s
    looking: 'Looking for the table…',       // on the pressed button after 1 s
    waking: "The hotel's switchboard is waking up. The first table of the day can take up to a minute.",   // after 4 s
    offline: "You're offline. Connect to Wi-Fi to play with friends. Single player still works offline.",
    codeLetters: 'Codes use only consonants: no A, E, I, O, U, Y, L or Q.',
    codeLength: 'Codes are {length} letters.',
    rejoining: 'Rejoining your table…',
    cancel: 'Cancel',
    invited: "You're invited to {host}'s table.",   // above "Sign the register", from peek
    invitedAny: "You're invited to a table.",        // the same when peek fails
  },

  // --- {label}: coming soon (the live site without an open server; ?coop=soon on localhost) ---------------------
  soon: {
    kicker: '{label}',
    heading: 'Coming soon',
    line: "Soon you'll start a private table and send your friends a link. Everyone plays on their own iPad, phone or computer.",
    ready: 'Single player is ready now.',
    single: 'Single player',
    back: '‹ Back',
    // a ?join= link opened while Co-op isn't open
    joinHeading: "{label} isn't open yet",
    joinLine: "This link is for a {label} table, which isn't open yet. Single player is ready now.",
    mainMenu: 'Main menu',
  },

  // --- Your private table: the waiting room (#menu-table) ------------------------------------------------------
  table: {
    kickerHost: '{label} · Your private table',
    kickerGuest: "{label} · {host}'s table",
    waiting: 'Waiting for friends…',
    ready: 'Ready when you are',
    waitingGuest: 'Waiting for {host} to start…',
    codeLabel: 'Table code',
    codeAria: 'Table code: {letters}',
    invite: 'Invite friends',
    copy: 'Copy link',
    shareTitle: 'Hotel Escape',
    shareText: 'Join my table in Hotel Escape. Code: {code}',
    tags: { host: 'Host', you: 'You', away: 'Away', reconnecting: 'reconnecting…', bot: 'Bot' },
    empty: 'Empty seat: a bot will sit here',
    sizeLabel: 'Guests at the table',
    sizeNote: 'Empty seats get bots when you start.',
    newGuests: 'New guests',
    welcome: 'Welcome',
    locked: 'Locked',
    lockedNote: 'No one new can join. Guests already seated can still come back.',
    lockedGuest: '{host} has locked this table.',
    seatsTaken: '{n} of {size} seats taken.',
    guestLine: 'A table for {size} guests. {host} starts the match; empty seats get bots.',
    start: 'Start the match',
    leave: 'Leave table',
    wardrobe: 'Wardrobe',
    footer: 'Roles are secret: keep your screen to yourself.',
    notPersistent: "This browser won't remember you. If you leave, you can't come back to this match.",
    countdown: 'The lift is on its way… {n}',
    countdownGuests: '{host} can still stop it.',
    wait: 'Wait',
    removeAria: 'Remove {name} from the table',       // (read aloud on a friend's seat, for the host)
  },

  // --- Questions (one card: title / line / buttons) ------------------------------------------------------------
  dialogs: {
    remove: { title: 'Remove {name} from the table?', line: "They can't come back to this table.", buttons: ['Cancel', 'Remove'] },
    alone: { title: 'Nobody has joined yet.', line: 'Play with bots instead, or wait for your friends.', buttons: ['Wait', 'Play with bots'] },
    away: {
      title: '{name} is away.',
      line: {
        today: "If you start now, {name}'s turns will run out on the clock until they're back.",
        pending: "A bot will play for {name} until they're back.",                  // R6, PROPOSED
      },
      buttons: ['Wait', 'Start anyway'],
    },
    leaveMatch: {
      title: 'Leave the match?',
      line: "Your guest stays at the table and its turns run out on the clock. You can come back with the table's link while the match lasts.",
      buttons: ['Keep playing', 'Leave'],
    },
    out: {
      title: 'You are out',
      line: 'Your guest has died. Everything you carried lies on the floor. Watch the others play on, or leave the table.',
      buttons: ['Watch', 'Leave table'],
    },
    stillThere: { title: 'Are you still there?', line: 'A bot is playing your turns.', buttons: ["I'm back"] },      // R7, PROPOSED
    whileAway: { title: 'While you were away', line: 'A bot played for you:', buttons: ['Continue'] },             // R6, PROPOSED
  },

  // --- Toasts --------------------------------------------------------------------------------------------------
  toasts: {
    joinedYou: "You joined {host}'s table.",
    joined: '{name} joined.',
    hostLeft: '{name} left. {host} is now the host.',
    left: '{name} left the table.',
    linkCopied: 'Link copied. Paste it into Messages or WhatsApp.',
    timedOut: 'Time ran out: a card was chosen for you ({card}).',                                                // R3, PROPOSED
  },

  // --- In the match (small additions to today's screens) -------------------------------------------------------
  match: {
    away: 'Away',
    feed: {
      dropped: {
        today: "{name}'s connection dropped. Their turns will run out on the clock until they're back.",
        pending: "A bot is playing for {name} until they're back.",                // R6, PROPOSED
      },
      back: '{name} is back.',
      left: {
        today: '{name} left the match. Their guest stays at the table.',
        pending: 'A bot will play for {name} until the end.',                      // R8, PROPOSED
      },
    },
    stall: {                                                                       // TP3, technical
      waitingFor: 'Waiting for {name}…',
      waitingMeeting: 'Waiting for the meeting to finish…',
      countdown: 'If it takes {time} more, this match ends without a result.',
      stopped: {
        title: 'This match was stopped',
        line: "It waited more than {minutes} minutes for one choice, so it ended without a result. It won't count.",
        buttons: ['Back to the table'],
      },
    },
    end: {
      playAgain: 'Play again',
      leave: 'Leave table',
      backToTable: 'Back to the table',
      hostStarts: '{host} starts the next match.',
      nextIn: 'The next match starts in {n}…',
    },
  },

  // --- Connection and recovery ---------------------------------------------------------------------------------
  recovery: {
    pill: 'Reconnecting…',
    back: "You're back at the table.",
    lost: {
      title: 'Still reconnecting…',
      line: {
        today: "Your seat is kept. Until you're back, your turns run out on the clock.",
        pending: "Your seat is safe. A bot is playing for you until you're back.", // R6, PROPOSED
      },
      buttons: ['Try again', 'Leave match'],
    },
    rejoining: 'Rejoining your table…',
    cancel: 'Cancel',
    restarted: {
      title: "The hotel's server restarted",
      line: 'Everyone is back where they were. Whoever was playing got their time back.',
      buttons: ['OK'],
    },
    restartLost: { title: 'The hotel closed for a moment', line: "The server restarted, so this match ended. It won't count.", buttons: ['Main menu'] },
    updated: { title: 'The game was updated', line: "So this match ended. It won't count.", buttons: ['Back to the table'] },
    fault: { title: 'Something went wrong at this table', line: "This match had to stop. It won't count. Sorry about that.", buttons: ['Back to the table'] },
    elsewhere: { title: 'Playing on another device', line: "You're playing this table on another device.", buttons: ['Play here instead', 'Main menu'] },
  },

  // --- Can't join, and errors (one card each; keyed by the server's err code where there is one) ---------------
  errors: {
    notFound: {
      title: 'No table with that code',
      line: "There's no table with code {code}. Check the letters, or ask your friend to send the link again.",
      buttons: ['Try again', 'Back'],
    },
    full: { title: 'This table is full', line: 'All {size} seats are taken. Ask the host to make room, or start your own table.', buttons: ['Start a table', 'Back'] },
    midMatch: {
      title: 'This table is mid-match',
      line: 'This table is in the middle of a match. Matches usually take about 20 minutes.',
      buttons: ['Try again', 'Main menu'],
      buttonsWaitHere: ['Wait here', 'Main menu'],   // only once "a friend who arrives mid-match" is built (not tonight)
    },
    locked: { title: 'This table is locked', line: 'The host has locked this table. Ask them to unlock it.', buttons: ['Back'] },
    removed: { title: "You've left the table", line: 'The host removed you from this table.', buttons: ['Main menu'] },
    closed: { title: 'This table has closed', line: 'Everyone has left this table. Ask your friend for a new link.', buttons: ['Start a table', 'Main menu'] },
    tooMany: { title: 'Too many tries', line: 'Wait a minute, then try again.', buttons: ['OK'] },
    busy: {
      title: 'The hotel is full right now',
      line: 'Too many tables are open at the moment. Try again in a few minutes. Single player still works.',
      buttons: ['Try again', 'Single player'],
    },
    offline: { title: "You're offline", line: 'Connect to Wi-Fi to play with friends. Single player still works offline.', buttons: ['Single player', 'Try again'] },
    unreachable: {
      title: "Can't reach the game",
      line: "We can't connect right now. Check your internet, then try again. Single player still works.",
      buttons: ['Try again', 'Single player'],
    },
    update: { title: 'Update needed', line: 'A new version of Hotel Escape is out. Update to join this table.', buttons: ['Update now'] },
    serverOld: { title: 'One moment', line: 'The game is being updated. Try again in a minute.', buttons: ['Try again'] },
    storage: { title: null, line: "This browser won't remember you. If you leave, you can't come back to this match.", buttons: [] },   // a note in the waiting room
  },

  // --- The review link: two seats on one iPad (?friends=demo) --------------------------------------------------
  demo: {
    note: 'Test table: the online rules are not decided yet.',
    dealt: 'Match dealt: the match itself arrives next.',
    showSeat: "Show {name}'s screen",
    secondName: 'sam',                                // the second seat you hold on the review link
    mustChooseCard: '{name} must choose a card',
    // when a question waits on the other seat, the switch says so (by the question's kind: DESIGN §6.3)
    waits: {
      meetWhom: '{name} must choose whom to meet',
      meetAct: '{name} must choose: Trade or Attack',
      card: '{name} must choose a card',
      offer: '{name} must answer a trade offer',
      discard: '{name} must discard',
      role: '{name} must read their role',
      screen: "{name} has a screen to read",
    },
  },
};

// Fill a sentence's {placeholders}. {label} is always this file's label; a placeholder with no value is left as it is.
export function fill(text, vars = {}) {
  if (typeof text !== 'string') return text;
  const all = { label: ONLINE_TEXT.label, ...vars };
  return text.replace(/\{(\w+)\}/g, (m, k) => (all[k] != null ? String(all[k]) : m));
}

// The form of an entry for the rules in force: `pending` only when the owner's rule list is approved.
export const byRules = (entry, approved = false) =>
  (entry && typeof entry === 'object' && 'today' in entry ? (approved ? entry.pending : entry.today) : entry);
