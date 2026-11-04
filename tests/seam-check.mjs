// THE SEAM BETWEEN THE SCREENS AND THE GAME (DESIGN §6.8 test 11, static; multiplayer build plan P1C S5). From P1C
// the page only PRESENTS the game: the table (src/net/localTable.js in Single player; a server in Co-op) holds the real
// game and changes it, and the screens read only what the player's own seat may know (src/net/playerView.js written
// into the presenter state by src/net/viewAsState.js; the hotel from src/net/floorCopy.js). Read from the code:
//   1. no screen file (everything under src/ outside src/net/, src/bots/ and src/game/) imports a rules-changing
//      function from src/game/ or src/bots/ (search, openDoor, resolveTrade, ..., any use*, createState, resetState,
//      the hotel's mutators ...), or a whole rules module (`import * as`); of src/bots/ a screen file may load only the
//      computer guests' names and looks (profiles.js);
//   2. what the screens import from src/game/state.js and src/game/actions.js is only the rules' QUESTIONS (a list of
//      read-only predicates below), asked of the presenter state;
//   3. the hotel's mutators (stackDeck, growTo, placeTile, openFrontierDoor) are imported only in src/net/ and src/game/;
//   4. no screen file reads the piles (.drawPile, .discardPile), the room deck (.deck), the engine's possessed seat
//      (.setup), or an inbox other than the player's own (whitelisted: src/matchSummary.js `you.inbox`, src/ui/allies.js
//      `viewer.inbox`); `possessedIndex` appears only in src/main.js, as the page's own role choice handed to the table
//      (planGame, setupGame, newTable). The test hooks (main.js's window.__game block) are left out: they read the real
//      game, for the tests' direct engine calls;
//   5. table.local.debug (the real game) is used only inside main.js's window.__game block, and main.js loads
//      src/net/localTable.js only with import() (the computer guests' minds stay lazily loaded);
//   6. src/net/ is pure (no DOM, THREE, Node API, Math.random, engine generator, clock, timer or storage: the regexes of
//      tests/bots-check.mjs and tests/view-check.mjs), except the files that drive the page or the network (BUILD-PLAN
//      rule 7);
//   7. docs/GAME_RULES.md matches its recorded hash (tests/fixtures/game-rules.sha256);
//   8. no stub is left (multiplayer build plan P6): no file of the game, the server, the tests or the tools still says
//      "PENDING STUB" (the marker every planned file and suite carried until its phase built it).
//   node tests/seam-check.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const t0 = Date.now();
let failures = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failures++; };

// --- the files ----------------------------------------------------------------------------------------------------
function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(rel));
    else if (e.name.endsWith('.js')) out.push(rel);
  }
  return out;
}
const ALL = walk('src');
const RULES_SIDE = /^src\/(net|bots|game)\//;
const SCREENS = ALL.filter(f => !RULES_SIDE.test(f));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
// The code without its comments, line by line (so a '/*' inside a line comment, like "src/bots/*", starts nothing): a
// /* ... */ within a line; a whole-line // comment; a trailing ` // ...`; a block comment whose lines start with /* and *.
// A '//' inside a string (a URL) is never preceded by a space, so it stays. Line numbers are kept.
function code(src) {
  let inBlock = false;
  return src.split('\n').map(line => {
    if (inBlock) { if (line.includes('*/')) inBlock = false; return ''; }
    let l = line.replace(/\/\*.*?\*\//g, ' ');
    if (/^\s*\/\//.test(l)) return '';
    if (/^\s*\/\*/.test(l)) { inBlock = !l.includes('*/'); return ''; }
    return l.replace(/(^|\s)\/\/(\s.*|$)/, '$1');
  }).join('\n');
}

// main.js's test hooks: the window.__game block, from `window.__game =` to the line that closes it.
const MAIN = 'src/main.js';
const mainSrc = read(MAIN);
const hooksAt = mainSrc.indexOf('window.__game = ');
const hooksEnd = hooksAt < 0 ? -1 : mainSrc.indexOf('\n})();\n', hooksAt);
const HOOKS = hooksAt >= 0 && hooksEnd > hooksAt ? mainSrc.slice(hooksAt, hooksEnd + 6) : '';
const withoutHooks = src => (HOOKS ? src.replace(HOOKS, '') : src);
const body = (src, name) => {
  const m = new RegExp(`(?:async )?function ${name}\\(`).exec(src);
  if (!m) return '';
  const end = src.indexOf('\n}\n', m.index);
  return src.slice(m.index, end < 0 ? undefined : end + 2);
};

// Every import of a file: { names, star, from (resolved to a path under the repo), dynamic }.
function importsOf(file) {
  const src = code(read(file));
  const dir = path.posix.dirname(file);
  const resolve = spec => (spec.startsWith('.') ? path.posix.normalize(`${dir}/${spec}`) : spec);
  const out = [];
  for (const m of src.matchAll(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)) {
    const what = m[1];
    const star = /\*\s+as\s+\w+/.test(what);
    const names = [...(what.match(/\{([\s\S]*?)\}/)?.[1] ?? '').split(',')].map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    out.push({ names, star, from: resolve(m[2]), dynamic: false });
  }
  for (const m of src.matchAll(/^\s*export\s+(\*|\{[\s\S]*?\})\s+from\s+['"]([^'"]+)['"]/gm)) {
    const names = m[1] === '*' ? [] : m[1].slice(1, -1).split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    out.push({ names, star: m[1] === '*', from: resolve(m[2]), dynamic: false });
  }
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push({ names: [], star: true, from: resolve(m[1]), dynamic: true });
  return out;
}

// --- 1. rules-changing functions ---------------------------------------------------------------------------------
console.log('1. no screen file imports a rules-changing function');
const CHANGERS = new Set(['search', 'openDoor', 'resolveTrade', 'resolveAttack', 'skipTrade', 'endTurn', 'enterRoom', 'lockEncounter',
  'discardCard', 'discardRandomDown', 'endTurnByTimeout', 'escape', 'createState', 'resetState', 'resetHotel', 'createBotTable',
  'createChatter', 'stackDeck', 'growTo', 'placeTile', 'openFrontierDoor', 'passTurn', 'convertToPossessed', 'runMeeting', 'playOut',
  'playBotTurn', 'clearHotel', 'placeLobby']);
const changer = n => CHANGERS.has(n) || /^use[A-Z]/.test(n);
const RULES_MODULE = f => /^src\/game\//.test(f) || (/^src\/bots\//.test(f) && f !== 'src/bots/profiles.js');
{
  const bad = [];
  let looked = 0;
  for (const f of SCREENS) {
    for (const im of importsOf(f)) {
      if (!/^src\/(game|bots)\//.test(im.from)) continue;
      looked++;
      if (im.star && RULES_MODULE(im.from)) bad.push(`${f}: ${im.dynamic ? 'import()' : 'import * as'} of ${im.from}`);
      else if (/^src\/bots\//.test(im.from) && im.from !== 'src/bots/profiles.js') bad.push(`${f}: imports ${im.from}`);
      for (const n of im.names) if (changer(n)) bad.push(`${f}: ${n} from ${im.from}`);
    }
  }
  check(!bad.length && looked > 20, `${SCREENS.length} screen files, ${looked} imports from src/game/ and src/bots/: none of them changes the game${bad.length ? ` — ${bad.join('; ')}` : ''}`);
}

// --- 2. only the rules' questions ----------------------------------------------------------------------------------
console.log('\n2. the screens ask the rules only questions (src/game/state.js, src/game/actions.js)');
const QUESTIONS = new Set([
  // state.js
  'activePlayer', 'nextPlayer', 'canEscape', 'openableDoors', 'playersInRoom', 'isBarricaded', 'canTradeVoluntarily', 'doorBetween',
  'encountersIn', 'adjacentLockedRooms', 'isLocked', 'isSpent', 'isFinalRound', 'moveCostInto', 'doorwayPassable', 'pendingEncounters',
  // actions.js
  'canSearch', 'searchLeft', 'canUseRoom', 'overHandLimit', 'tradeableCards',
]);
{
  const asked = new Map();
  const bad = [];
  for (const f of SCREENS) {
    for (const im of importsOf(f)) {
      if (im.from !== 'src/game/state.js' && im.from !== 'src/game/actions.js') continue;
      if (im.star) { bad.push(`${f}: the whole of ${im.from}`); continue; }
      for (const n of im.names) {
        if (!QUESTIONS.has(n)) bad.push(`${f}: ${n}`);
        asked.set(n, (asked.get(n) || 0) + 1);
      }
    }
  }
  check(!bad.length, `every name imported from the rules' state and actions is a question (${[...asked.keys()].sort().join(', ')})${bad.length ? ` — not a question: ${bad.join('; ')}` : ''}`);
  const mainNames = importsOf(MAIN).filter(im => im.from === 'src/game/state.js' || im.from === 'src/game/actions.js').flatMap(im => im.names);
  check(mainNames.length > 0 && mainNames.every(n => QUESTIONS.has(n)),
    `src/main.js makes no call into src/game/state.js or src/game/actions.js that changes the game: it imports ${mainNames.length} questions only`);
}

// --- 3. the hotel's mutators ------------------------------------------------------------------------------------------
console.log('\n3. the hotel is changed only by the table');
{
  const MUTATORS = new Set(['stackDeck', 'growTo', 'placeTile', 'openFrontierDoor']);
  const bad = [];
  const users = new Set();
  for (const f of ALL) {
    for (const im of importsOf(f)) {
      for (const n of im.names) {
        if (!MUTATORS.has(n)) continue;
        if (/^src\/(net|game)\//.test(f)) users.add(f); else bad.push(`${f}: ${n}`);
      }
    }
  }
  check(!bad.length, `stackDeck, growTo, placeTile and openFrontierDoor are imported only in src/net/ and src/game/ (${[...users].sort().join(', ') || 'nowhere'})${bad.length ? ` — also ${bad.join('; ')}` : ''}`);
}

// --- 4. hidden fields -------------------------------------------------------------------------------------------------
console.log('\n4. no screen file reads a hidden field');
{
  const OWN_INBOX = [['src/matchSummary.js', /\byou\??\.inbox\b/g], ['src/ui/allies.js', /\bviewer\??\.inbox\b/g]];
  const HIDDEN = [[/\.drawPile\b/, '.drawPile'], [/\.discardPile\b/, '.discardPile'], [/(?<!rules)\.deck\b/, '.deck (the room deck)'],
    [/\.setup\b/, '.setup (the engine\'s possessed seat)'], [/\.inbox\b/, '.inbox (another guest\'s)']];
  const bad = [];
  let whitelisted = 0;
  for (const f of SCREENS) {
    let src = code(read(f));
    if (f === MAIN) src = code(withoutHooks(mainSrc));
    src.split('\n').forEach((line, i) => {
      let l = line;
      for (const [file, re] of OWN_INBOX) if (file === f && re.test(l)) { whitelisted++; l = l.replace(re, ''); }
      for (const [re, what] of HIDDEN) if (re.test(l)) bad.push(`${f}:${i + 1} ${what}`);
    });
  }
  check(!bad.length, `no pile, room deck, engine role seat or another guest's inbox is read by a screen file${bad.length ? ` — ${bad.join('; ')}` : ''}`);
  check(whitelisted === 2, `the two own-inbox reads are the whitelisted ones (src/matchSummary.js, src/ui/allies.js: ${whitelisted} found)`);
  const outside = [];
  for (const f of SCREENS) {
    if (f === MAIN) continue;
    if (/\bpossessedIndex\b/.test(code(read(f)))) outside.push(f);
  }
  const mainCode = code(withoutHooks(mainSrc));
  const allowed = ['planGame', 'setupGame', 'newTable'].map(n => code(body(mainSrc, n))).join('\n');
  const inMain = (mainCode.match(/\bpossessedIndex\b/g) || []).length;
  const inAllowed = (allowed.match(/\bpossessedIndex\b/g) || []).length;
  check(!outside.length && inMain > 0 && inMain === inAllowed,
    `possessedIndex is only the page's own role choice handed to the table (src/main.js planGame, setupGame, newTable: ${inAllowed} of ${inMain})${outside.length ? ` — also in ${outside.join(', ')}` : ''}`);
}

// --- 5. the real game stays behind the test hooks -------------------------------------------------------------------
console.log('\n5. the real game is reached only by the test hooks');
{
  check(!!HOOKS && /table \?\? lastTable\)\?\.local\??\.debug/.test(HOOKS), `main.js's window.__game block found (${HOOKS.split('\n').length} lines), and it is where the real game is reached`);
  const bad = [];
  for (const f of ALL) {
    const src = code(f === MAIN ? withoutHooks(mainSrc) : read(f));
    if (/\blocal\??\.debug\b/.test(src)) bad.push(f);
  }
  check(!bad.length, `table.local.debug is used nowhere else in src/${bad.length ? ` — found in ${bad.join(', ')}` : ''}`);
  const mainImports = importsOf(MAIN);
  check(mainImports.some(im => im.dynamic && im.from === 'src/net/localTable.js') && !mainImports.some(im => !im.dynamic && im.from === 'src/net/localTable.js'),
    'main.js loads src/net/localTable.js only with import() (the computer guests\' minds stay lazily loaded)');
  const realInMain = code(withoutHooks(mainSrc));
  check(!/\b(realState|lastReal|realNow)\b|\bT\(\)|\bW\(|\badopt\b/.test(realInMain), 'main.js holds no real game of its own (no realState, T(), W() or adopt left)');
}

// --- 6. src/net/ purity -------------------------------------------------------------------------------------------------
console.log('\n6. src/net/ is pure (but for the files that drive the page or the network)');
{
  const EXCEPT = new Set(['connection.js', 'onlineTable.js', 'loopback.js', 'guestKey.js', 'wakeLock.js', 'presentQueue.js', 'serverUrl.js',
    'localTable.js', 'fakeLobby.js']);
  const RES = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /from ['"]fs['"]/, /require\(/, /Math\.random/, /state\.rng/,
    /\bprocess\./, /Date\.now/, /\bsetTimeout\b/, /\bsetInterval\b/, /\blocalStorage\b/];
  const files = fs.readdirSync(path.join(root, 'src/net')).filter(f => f.endsWith('.js') && !EXCEPT.has(f)).sort();
  for (const f of files) {
    const src = read(`src/net/${f}`).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    const bad = RES.filter(re => re.test(src));
    check(!bad.length, `src/net/${f}: no DOM, THREE, Node API, Math.random, engine generator, clock, timer or storage${bad.length ? ` — found ${bad.join(' ')}` : ''}`);
  }
  const missing = [...EXCEPT].filter(f => !fs.existsSync(path.join(root, 'src/net', f)));
  check(!missing.length, `the exceptions are the files rule 7 names, all present (${EXCEPT.size})${missing.length ? ` — missing ${missing.join(', ')}` : ''}`);
}

// --- 7. the rules ----------------------------------------------------------------------------------------------------
console.log('\n7. the owner\'s rules');
{
  const recorded = fs.readFileSync(path.join(root, 'tests/fixtures/game-rules.sha256'), 'utf8').trim().split(/\s+/)[0];
  const now = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'docs/GAME_RULES.md'))).digest('hex');
  check(recorded === now, `docs/GAME_RULES.md matches its recorded hash (sha256 ${now.slice(0, 12)}…, tests/fixtures/game-rules.sha256)`);
}

// --- 8. no stub left -------------------------------------------------------------------------------------------------
console.log('\n8. no stub is left');
{
  const MARK = ['PENDING', 'STUB'].join(' ');          // (spelled in two pieces, so this file does not find itself)
  const SKIP = new Set(['node_modules', 'shots', '.git', '__pycache__', 'old']);
  const CODE = /\.(?:js|mjs|cjs|html|py|yml|yaml|json)$/;
  const files = [];
  const scan = dir => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!SKIP.has(e.name)) scan(rel); }
      else if (CODE.test(e.name)) files.push(rel);
    }
  };
  for (const dir of ['src', 'server', 'tests', 'tools', '.github']) if (fs.existsSync(path.join(root, dir))) scan(dir);
  for (const f of ['index.html', 'render.yaml']) if (fs.existsSync(path.join(root, f))) files.push(f);
  const left = files.filter(f => f !== 'tests/seam-check.mjs' && fs.readFileSync(path.join(root, f), 'utf8').includes(MARK));
  check(files.length > 200 && !left.length, `${files.length} files of the game, the server, the tests and the tools: none still says "${MARK}"${left.length ? ` — ${left.join(', ')}` : ''}`);
}

console.log(failures ? `\n${failures} FAILED` : `\nALL SEAM CHECKS PASSED (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
