// The documents' facts, checked (no browser, ~1 s).
//   node tests/docs-check.mjs
//
// Documents go stale quietly (the audit of 13 Oct 2026 found DECISIONS.md saying "health 3" and the README missing
// fourteen files). This keeps the facts that can be checked by a machine true:
//   1. the rule numbers in docs/DECISIONS.md "Read this first" are the numbers in src/data/rules.js
//   2. the README's project structure names every file under src/
//   3. every src/, tests/, tools/, docs/ or assets/ path that "Read this first" and the README's structure name exists
//      (except on the lines that say a file no longer exists)
//   4. the GitHub Action runs every fast suite (a suite that needs no browser) and lists no suite that is missing
//   5. every suite in tests/ is named in the README, and the README names no suite that is missing
//   6. a preview server named in the README or the tests' headers is bound to 127.0.0.1
//   7. docs/VERSIONS.md has a row for the version in src/version.js
//   8. docs/PROGRESS.md and the README name only DECISIONS.md sections that exist
//   9. the README gives no hard-coded count of assertions or checks
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rules } from '../src/data/rules.js';
import { VERSION } from '../src/version.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const exists = f => fs.existsSync(path.join(root, f));
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const section = (text, from, to) => { const a = text.indexOf(from); if (a < 0) return ''; const b = text.indexOf(to, a + from.length); return text.slice(a, b < 0 ? undefined : b); };
const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true })
  .flatMap(e => (e.isDirectory() ? (['node_modules', 'shots', '.git'].includes(e.name) ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));

const decisions = read('docs/DECISIONS.md');
const readme = read('README.md');
const first = section(decisions, '## Read this first', '\n## Engine and loading');

// --- 1. the numbers ---------------------------------------------------------------------------------------
console.log('docs/DECISIONS.md "Read this first" against src/data/rules.js');
{
  check(first.length > 500, 'the block is there');
  const num = (re, what) => { const m = first.match(re); if (!m) { check(false, `the block still says ${what} (pattern ${re})`); return null; } return m.slice(1).map(Number); };
  const same = (got, want, what) => got && check(got.every((g, i) => g === want[i]), `${what}: ${got?.join(' to ')} (rules.js: ${want.join(' to ')})`);
  same(num(/(\d+) actions a turn/, '"N actions a turn"'), [rules.actionPointsPerTurn], 'actions a turn');
  const cost = num(/opening a door, moving into a room, searching, playing a card and attacking cost (\d+) action each/, 'the 1-action costs');
  same(cost, [1], 'those five cost');
  check([rules.openDoorCost, rules.moveCost, rules.searchCost, rules.playCardCost, rules.attackCost].every(c => c === cost?.[0]), 'in rules.js, open a door, move, search, play a card and attack all cost that');
  check(/Espresso is free/.test(first) && rules.espressoCost === 0, 'Espresso is free (rules.espressoCost 0)');
  same(num(/escaping costs (\d+)/, '"escaping costs N"'), [rules.escapeCost], 'escaping costs');
  same(num(/a (\d+)-second clock/, '"an N-second clock"'), [rules.turnTimerSeconds], 'the clock, seconds');
  same(num(/(\d+) health/, '"N health"'), [rules.maxHealth], 'health');
  same(num(/hand limit (\d+)/, '"hand limit N"'), [rules.handLimit], 'hand limit');
  same(num(/(\d+) Possession cards/, '"N Possession cards"'), [rules.possessionSupply], 'Possession cards');
  same(num(/(\d+) new souls/, '"N new souls"'), [rules.soulsOnConvert], 'new souls for each guest possessed');
  same(num(/(\d+) Lanterns to escape/, '"N Lanterns to escape"'), [rules.lanternsToEscape], 'Lanterns to escape');
  same(num(/everyone starts with (\d+)/, '"everyone starts with N"'), [rules.lanternsDealtEach], 'Lanterns each guest starts with');
  same(num(/dawn after round (\d+)/, '"dawn after round N"'), [rules.roundLimit], 'dawn after round');
  same(num(/(\d+) to (\d+) guests in a match/, '"N to M guests in a match"'), [rules.minPlayers, rules.maxPlayers], 'guests in a match');
}

// --- 2 and 3. the README's structure, and the paths the documents name --------------------------------------
console.log('\nfiles named in the documents');
{
  const structure = section(readme, '## Project structure', '## Character pipeline');
  const missing = walk('src').filter(f => f.endsWith('.js') && !new RegExp(`(^|[^\\w.])${path.basename(f).replace('.', '\\.')}(?![\\w])`).test(structure));
  check(missing.length === 0, `the README's project structure names every file under src/ (${walk('src').length} files)${missing.length ? '; missing: ' + missing.join(', ') : ''}`);

  // paths in the two blocks (backticked in "Read this first"; anywhere in the structure), except on lines saying they are gone
  const pathsIn = (text, re) => [...text.matchAll(re)].map(m => m[1]);
  const gone = line => /no longer exist|removed|once said|once named|is gone|are gone|retired/.test(line);
  const live = text => text.split('\n').filter(l => !gone(l)).join('\n');
  const re = /(?:^|[\s`(])((?:src|tests|tools|docs|assets)\/[\w./-]*[\w-]\.(?:js|mjs|md|py|json|jpg|html))/g;
  const named = [...new Set([...pathsIn(live(first), re), ...pathsIn(structure, re)])];
  const bad = named.filter(p => !exists(p));
  check(named.length > 20 && bad.length === 0, `${named.length} file paths named in "Read this first" and in the structure all exist${bad.length ? '; missing: ' + bad.join(', ') : ''}`);
  const asset = readme.match(/assets\/README\.md/) && read('assets/README.md');
  check(!/Supplied so far/.test(asset || ''), 'assets/README.md no longer lists "Supplied so far"');
  const assetPaths = [...(asset || '').matchAll(/`((?:src|tools)\/[\w./-]+\.(?:js|py))`/g)].map(m => m[1]);
  check(assetPaths.every(exists), `the source files assets/README.md names exist (${assetPaths.length})`);
}

// --- 4 and 5. the suites ---------------------------------------------------------------------------------------
console.log('\nthe suites');
{
  const suites = walk('tests').filter(f => /^tests\/[\w-]+\.mjs$/.test(f)).map(f => path.basename(f, '.mjs'))
    .filter(n => !['smoke-lib', 'run-fast'].includes(n));
  const isBrowser = n => /^import .*(?:smoke-lib|playwright-core)/m.test(read(`tests/${n}.mjs`));
  const fast = suites.filter(n => !isBrowser(n));
  const matrix = (read('.github/workflows/tests.yml').match(/^\s*suite:\s*\[([^\]]+)\]/m)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean);
  const notRun = fast.filter(n => !matrix.includes(n)), unknown = matrix.filter(n => !exists(`tests/${n}.mjs`)), browserInCI = matrix.filter(n => suites.includes(n) && isBrowser(n));
  check(notRun.length === 0, `the GitHub Action runs every fast suite (${fast.length})${notRun.length ? '; not listed in the workflow: ' + notRun.join(', ') : ''}`);
  check(unknown.length === 0 && browserInCI.length === 0, `...and lists no missing suite and no browser suite${unknown.length ? '; missing: ' + unknown.join(', ') : ''}${browserInCI.length ? '; needs a browser: ' + browserInCI.join(', ') : ''}`);
  const unnamed = suites.filter(n => !readme.includes(`tests/${n}.mjs`));
  check(unnamed.length === 0, `the README names every suite in tests/ (${suites.length})${unnamed.length ? '; not named: ' + unnamed.join(', ') : ''}`);
  const named = [...new Set([...readme.matchAll(/\btests\/([\w-]+)\.mjs/g)].map(m => m[1]))];
  const gone = named.filter(n => !exists(`tests/${n}.mjs`) && !exists(`tests/old/${n}.mjs`));
  check(gone.length === 0, `...and names no suite that does not exist${gone.length ? ': ' + gone.join(', ') : ''}`);
}

// --- 6. a server open to the whole network ----------------------------------------------------------------------
console.log('\nsmall facts');
{
  const lines = [...readme.split('\n'), ...walk('tests').filter(f => f.endsWith('.mjs')).flatMap(f => read(f).split('\n'))].filter(l => /http\.server/.test(l));
  const open = lines.filter(l => !/--bind['",\s]+127\.0\.0\.1/.test(l));
  check(lines.length > 0 && open.length === 0, `every preview server named is bound to 127.0.0.1 (${lines.length} mentions)${open.length ? '; not bound: ' + open[0].trim().slice(0, 90) : ''}`);
  const versions = read('docs/VERSIONS.md');
  check(new RegExp(`^\\| ${VERSION.replace('.', '\\.')} \\|`, 'm').test(versions), `docs/VERSIONS.md has a row for ${VERSION}, the version in src/version.js`);
  // (not a failure: the hash cannot be known until the publish. But the rollback steps read it from this row, so say so while it is open)
  const pending = versions.split('\n').find(l => l.startsWith(`| ${VERSION} |`) && /written in after publishing/i.test(l));
  if (pending) console.log(`  NOTE  docs/VERSIONS.md still has no commit for ${VERSION} ("written in after publishing"): put the real hash in right after the publish, or the rollback steps have nothing to go back to`);
  check(!/\b\d+\s+(?:assertions|checks)\b/i.test(readme.replace(/(?:python|node) .*$/gm, '')), 'the README gives no hard-coded count of assertions or checks');
}

// --- 8. sections named by PROGRESS.md and the README exist ----------------------------------------------------------
console.log('\nDECISIONS.md sections named elsewhere');
{
  const all = decisions.toLowerCase();       // (a section, or a named part of one: PROGRESS.md also cites parts of sections)
  const refs = [];
  for (const [file, text] of [['docs/PROGRESS.md', read('docs/PROGRESS.md')], ['README.md', readme]]) {
    for (const m of text.matchAll(/DECISIONS\.md[^\n'"‘’]{0,40}['"‘]([^'"’\n]{4,80})['"’]/g)) refs.push([file, m[1]]);
  }
  const lost = refs.filter(([, name]) => !all.includes(name.toLowerCase()));
  check(refs.length > 5 && lost.length === 0, `${refs.length} section names in PROGRESS.md and the README are found in DECISIONS.md (so no section was renamed or deleted)${lost.length ? '; not found: ' + lost.map(([f, n]) => `${f}: "${n}"`).join('; ') : ''}`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'}`);
process.exit(failures ? 1 : 0);
