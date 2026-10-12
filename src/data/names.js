// Names, as data (src/account/username.js uses them; no DOM, so a server can reuse them):
//   SUGGEST       the words "Suggest a name" puts together: adjective + '_' + noun, Art Deco hotel words
//   RESERVED      names nobody may take (the hotel's own words; card and room names are added from the
//                 game's data by username.js, so that list stays current by itself)
//   ROLE_WORDS    words that read like the game telling a role ("POSSESSED_X searched Kitchen."): refused
//                 like the reserved names. `anywhere`: found anywhere in a name; `whole`: only as a whole part
//   FILTER        a light word filter. The entries are base64-encoded so the words are not written out
//                 in plain text here. `anywhere`: found anywhere in a name; `whole`: only as a whole part
//                 of it (split on _, digits and capitals), which leaves "class" or "Sussex" alone.
//   FILTER_ALLOW  real names and places that contain a filtered word by chance (Nazir, Shital, Pornchai,
//                 Scunthorpe): taken out of a name before the `anywhere` words are looked for
// A real check belongs to a server later; this one only keeps the obvious out of a device-local name.

export const SUGGEST = {
  adjectives: [
    'velvet', 'brass', 'gilded', 'amber', 'midnight', 'dapper', 'silver', 'golden', 'ivory', 'jazzy',
    'swanky', 'moonlit', 'marble', 'plush', 'smoky', 'starlit', 'deco', 'ritzy', 'lucky', 'quiet',
    'merry', 'dashing', 'opal', 'sable', 'cobalt', 'emerald', 'ruby', 'satin', 'polished', 'gallant',
  ],
  nouns: [
    'owl', 'lark', 'moth', 'cello', 'waltz', 'pearl', 'valet', 'bellhop', 'foxtrot', 'sparrow',
    'heron', 'swan', 'finch', 'wren', 'tulip', 'orchid', 'violet', 'poppy', 'sonnet', 'tango',
    'monocle', 'fedora', 'locket', 'compass', 'comet', 'ember', 'cufflink', 'teacup', 'raven', 'quill',
  ],
};

// Exact words (case ignored). Single-word card and room names (Lantern, Kitchen…) are reserved too,
// from the game's data, so they can never be mistaken for a card or a room in the feed.
export const RESERVED = [
  'you', 'me', 'guest', 'guests', 'bot', 'bots', 'admin', 'administrator', 'mod', 'moderator', 'staff',
  'support', 'system', 'server', 'hotel', 'manager', 'concierge', 'everyone', 'nobody', 'possessed', 'clean',
];

// The words of the rules' public log (src/game/actions.js, state.js: "nora searched Kitchen.", "… and …
// traded.", "… attacked … with a Knife — fatally."), reserved too: a guest called "searched" or "the" would
// otherwise change how the feed reads a line (src/ui/feed.js). tests/profile-check.mjs plays bot matches
// and checks that every word of their log is reserved, so a new log line cannot slip past this list.
export const LOG_WORDS = [
  'the', 'and', 'with', 'tried', 'door', 'doors', 'jammed', 'shut', 'opened', 'open', 'escaped', 'through', 'fire', 'exit',
  'searched', 'used', 'hand', 'mirror', 'unlocked', 'until', 'end', 'their', 'turn', 'barricaded', 'doorway',
  'was', 'treated', 'rang', 'are', 'met', 'but', 'there', 'trade', 'traded', 'attacked', 'fatally', 'locked',
  'again', 'room', 'failed', 'guest', 'guests', 'possessed', 'its', 'for', 'one',
];

export const ROLE_WORDS = { anywhere: ['possess'], whole: ['clean'] };

export const FILTER = {
  anywhere: ['ZnVjaw==', 'c2hpdA==', 'Y3VudA==', 'Yml0Y2g=', 'bmlnZ2Vy', 'bmlnZ2E=', 'ZmFnZ290', 'd2hvcmU=',
    'c2x1dA==', 'cGVuaXM=', 'dmFnaW5h', 'YXNzaG9sZQ==', 'YmFzdGFyZA==', 'dHdhdA==', 'cmV0YXJk', 'bmF6aQ==',
    'aGl0bGVy', 'cG9ybg==', 'ZGlsZG8=', 'aml6eg==', 'Y3Vtc2hvdA==', 'Ymxvd2pvYg==', 'aGFuZGpvYg==', 'bW90aGVyZg=='],
  whole: ['YXNz', 'YXJzZQ==', 'Y3Vt', 'c2V4', 'YW5hbA==', 'ZmFn', 'ZmFncw==', 'ZGljaw==', 'Y29jaw==', 'dGl0cw==',
    'Ym9vYg==', 'Ym9vYnM=', 'cmFwZQ==', 'cmFwaXN0', 'a2lrZQ==', 'c3BpYw==', 'Y2hpbms=', 'cGFraQ==', 'Y29vbg==',
    'aG9tbw==', 'cGlzcw==', 'd2Fuaw==', 'd2Fua2Vy', 'cHJpY2s=', 'c2hhZw==', 'c2xhZw==', 'aG9l', 'a2tr', 'cHVzc3k=',
    'bnVkZQ==', 'bnVkZXM=', 'eHh4', 'bWlsZg==', 'aW5jZXN0', 'cGVkbw=='],
};
export const FILTER_ALLOW = ['nazir', 'nazim', 'nazih', 'nazil', 'nazia', 'shital', 'shitij', 'ashita', 'mishita',
  'pornchai', 'pornthip', 'pornpimol', 'pornsak', 'porntip', 'scunthorpe', 'penistone'];
