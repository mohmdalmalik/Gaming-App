// The fast suites in one command: the ones the GitHub Action runs on every push (no browser, no install).
//   node tests/run-fast.mjs            run them all (a few at a time), print one line each, exit 1 if any failed
//   node tests/run-fast.mjs rules-check bots-check     only these
//   node tests/run-fast.mjs --list     print the list
// The list is read from the Action's matrix (.github/workflows/tests.yml), so this runs exactly what CI runs and a
// suite added there is run here too. The browser suites (they need Chromium and a server) are not part of it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.join(here, '..', '.github', 'workflows', 'tests.yml'), 'utf8');
const listed = (workflow.match(/^\s*suite:\s*\[([^\]]+)\]/m)?.[1] || '').split(',').map(s => s.trim()).filter(Boolean);
if (!listed.length) { console.error('no suite list found in .github/workflows/tests.yml'); process.exit(2); }

const args = process.argv.slice(2);
if (args.includes('--list')) { console.log(listed.join('\n')); process.exit(0); }
const suites = args.filter(a => !a.startsWith('--')).length ? args.filter(a => !a.startsWith('--')) : listed;
const unknown = suites.filter(s => !fs.existsSync(path.join(here, `${s}.mjs`)));
if (unknown.length) { console.error(`no such suite: ${unknown.join(', ')}`); process.exit(2); }

const workers = Math.max(1, Math.min(4, os.cpus().length - 1));
const results = [];
let next = 0;
const t0 = Date.now();

function run(suite) {
  return new Promise(resolve => {
    const t = Date.now();
    const child = spawn(process.execPath, [path.join(here, `${suite}.mjs`)], { cwd: path.join(here, '..') });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', code => {
      const secs = ((Date.now() - t) / 1000).toFixed(1);
      const ok = code === 0;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${suite.padEnd(22)} ${secs.padStart(6)} s`);
      if (!ok) console.log(out.split('\n').filter(l => /FAIL|Error|error/.test(l)).slice(0, 12).map(l => '       ' + l).join('\n') || out.split('\n').slice(-12).join('\n'));
      results.push({ suite, ok });
      resolve();
    });
  });
}
async function worker() { while (next < suites.length) await run(suites[next++]); }
await Promise.all(Array.from({ length: Math.min(workers, suites.length) }, worker));

const failed = results.filter(r => !r.ok).map(r => r.suite);
console.log(`\n${failed.length ? `${failed.length} FAILED: ${failed.join(', ')}` : `ALL ${results.length} PASSED`} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
process.exit(failed.length ? 1 : 0);
