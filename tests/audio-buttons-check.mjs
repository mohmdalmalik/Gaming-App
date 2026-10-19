// Which sound does each button make? No browser: node tests/audio-buttons-check.mjs
//
// Lists every button of index.html (and the ones the code makes with an id) with the cue it gets from
// src/audio/buttonCues.js, and fails if any of them lands on the wrong KIND of sound. The table below is
// the intended sound of each button: a NEW button must be added to it, on purpose, so it cannot slip onto
// the wrong sound unseen (a name-matching slip once gave every Continue and the hand's arrows the long
// 'open' drawer instead of a click). Also checks the mix table (src/audio/sounds.js): every cue that
// the code or a data-sfx asks for exists, and every cue has its sound file.
import fs from 'node:fs';
import path from 'node:path';
import { cueForButton, OPENERS } from '../src/audio/buttonCues.js';
import { CUES } from '../src/audio/sounds.js';
import { EFFECTS, MUSIC } from '../src/audio/library.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

// What each button should sound like: open (a panel or screen opens), close (it closes or goes back),
// select (a choice among several), click (everything else). 'none' would be silent.
const EXPECT = {
  // the game's own buttons
  'btn-restart-practice': 'click', 'btn-chat': 'open', 'btn-leave': 'click', 'btn-private': 'open',
  'btn-rotate-left': 'click', 'btn-rotate-right': 'click', 'btn-centre': 'click', 'btn-map': 'open',
  'btn-trade': 'click', 'btn-end-turn': 'click',
  'btn-confirm-move': 'click', 'btn-confirm-cancel': 'close',
  'btn-discard-done': 'close',
  'btn-hand-close': 'close', 'btn-hand-prev': 'click', 'btn-hand-next': 'click', 'btn-map-close': 'close',
  'btn-handoff-next': 'click', 'btn-offer-give': 'click',
  'btn-chat-gg': 'select',
  // the in-match Menu panel (src/ui/gameMenu.js) and How to play (src/ui/howToPlay.js)
  'btn-gm-resume': 'close', 'btn-gm-howto': 'open', 'btn-gm-cards': 'open', 'btn-gm-leave': 'click',
  'btn-howto-close': 'close', 'btn-howto-back': 'click', 'btn-howto-next': 'click', 'btn-howto-cards': 'open',
  // the Cards screen (src/ui/cardsGuide.js): opened from the main menu, the Menu panel and the last How to play page
  'btn-cards-close': 'close',
  // the menu
  'btn-su-suggest': 'click', 'btn-su-go': 'click', 'btn-profile': 'open',
  'btn-menu-bots': 'open', 'btn-menu-practice': 'click', 'btn-menu-settings': 'open', 'btn-menu-record': 'open', 'btn-menu-howto': 'open', 'btn-menu-cards': 'open',
  'btn-av-rename': 'click', 'btn-bots-back': 'close', 'btn-bots-find': 'click',
  // the Wardrobe (src/ui/wardrobe/wardrobe.js): Surprise me plays the dice's own cue and Save look the lift bell when
  // the look is saved (both from the code: data-sfx none), the Honours pill and the end screen's achievement line open
  // the Hotel Honours page (src/ui/honours.js), whose Done closes it
  'btn-wd-honours': 'open', 'btn-wd-undo': 'click', 'btn-wd-surprise': 'none', 'btn-wd-cancel': 'close', 'btn-wd-save': 'none',
  'end-honours': 'open', 'btn-hn-done': 'close',
  'btn-mm-cancel': 'close', 'btn-tips-again': 'select', 'btn-settings-done': 'close',
  'btn-record-back': 'close', 'btn-record-reset': 'click', 'btn-record-keep': 'click', 'btn-record-yes': 'click',
  // the full-screen overlays
  'btn-begin': 'click', 'btn-notice-ok': 'click', 'btn-ask-no': 'click', 'btn-ask-yes': 'click',
  'btn-lock-cancel': 'close',            // the lock choice (src/ui/lockChoice.js): Not now; its "Use ..." buttons have no id, a plain click
  'btn-keep-exploring': 'click', 'btn-end-menu': 'click', 'btn-restart': 'click',
  'btn-error-menu': 'click', 'btn-error-reload': 'click', 'boot-reload': 'click',
};

// --- every button of the page, and the ones the code makes with an id -------------------------------------
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const buttons = [];
for (const m of html.matchAll(/<button\b[^>]*>/g)) {
  const tag = m[0];
  const id = /\sid="([^"]+)"/.exec(tag)?.[1] || '';
  const cls = (/\sclass="([^"]*)"/.exec(tag)?.[1] || '').split(/\s+/);
  buttons.push({ id, sfx: /\sdata-sfx="([^"]*)"/.exec(tag)?.[1] || '', seg: cls.includes('seg-btn'), where: 'index.html' });
}
const srcFiles = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) srcFiles.push(p);
  }
})(path.join(root, 'src'));
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\.id\s*=\s*'(btn-[\w-]+)'/g)) {
    // (the data-sfx of a button made in code is set on the line next to its id)
    const near = text.slice(m.index, m.index + 200);
    buttons.push({ id: m[1], sfx: /dataset\.sfx\s*=\s*'(\w+)'/.exec(near)?.[1] || '', seg: false, where: path.relative(root, file) });
  }
}

console.log(`the buttons (${buttons.length}) and their sounds`);
const seen = new Set();
for (const b of buttons) {
  if (!b.id) continue;                         // (a button with no id is a plain click, or says data-sfx)
  seen.add(b.id);
  const cue = cueForButton(b);
  const want = EXPECT[b.id];
  if (want === undefined) { check(false, `${b.id} (${b.where}) makes '${cue}', but it is not in the table of tests/audio-buttons-check.mjs: add it, with the sound it should make`); continue; }
  check(cue === want, `${b.id} makes '${cue}'${cue === want ? '' : `, not '${want}'`}`);
}
for (const id of Object.keys(EXPECT)) if (!seen.has(id)) check(false, `${id} is in the table but no button has that id any more: remove it`);

console.log('\nthe kind of sound a name says');
// Whatever the table says, a button must not land on a sound that contradicts its name.
for (const b of buttons.filter(x => x.id)) {
  const cue = cueForButton(b);
  const words = b.id.split('-');
  if (words.some(w => ['next', 'prev', 'continue', 'ok', 'yes', 'no', 'go', 'find', 'give', 'move', 'begin', 'start', 'reload'].includes(w)) && !b.sfx) {
    check(cue === 'click', `${b.id}: a forward / answering button clicks (it makes '${cue}')`);
  }
  if (words.some(w => ['back', 'cancel', 'close', 'done'].includes(w)) && !b.sfx) {
    check(cue === 'close', `${b.id}: a closing button closes (it makes '${cue}')`);
  }
}
// The openers are named exactly: a name that merely starts like one is not one.
for (const id of OPENERS) check(seen.has(id), `opener ${id} is a button of the page`);
check(cueForButton({ id: 'btn-handoff-next' }) === 'click' && cueForButton({ id: 'btn-hand-prev' }) === 'click'
  && cueForButton({ id: 'btn-hand-next' }) === 'click', 'a name that only starts like an opener (btn-hand...) is not one');
check(cueForButton({ id: 'btn-feedback' }) === 'click' && cueForButton({ id: 'btn-abandon' }) === 'click',
  'a closer is a WORD of the name: btn-feedback does not close');
check(cueForButton({ id: 'btn-hand-close', sfx: 'none' }) === 'none' && cueForButton({ id: 'x', seg: true }) === 'select', 'data-sfx wins; a segmented row selects');

// The player really uses buttonCues.js (this check imports the matcher directly, so it would still pass if
// src/audio/index.js went back to a matcher of its own, which is how the Continue button once got the drawer).
console.log('\nsrc/audio/index.js uses the matcher this check tests');
{
  const player = fs.readFileSync(path.join(root, 'src/audio/index.js'), 'utf8');
  check(/import \{ cueForButton \} from '\.\/buttonCues\.js';/.test(player) && /cueForButton\(\{/.test(player), "it imports cueForButton from './buttonCues.js' and asks it for every button");
  check(!/\/\^?\(?[^/\n]*btn-(hand|handoff)/.test(player) && !/btn-hand\|/.test(player), 'and has no name-matching expression of its own for the buttons (no /btn-hand.../)');
}

console.log('\nthe mix table (src/audio/sounds.js)');
for (const [name, def] of Object.entries(CUES)) {
  const ok = def.stinger ? !!MUSIC[def.stinger] : !!EFFECTS[def.file];
  check(ok, `cue '${name}' has its ${def.stinger ? `stinger '${def.stinger}'` : `file '${def.file}'`}`);
}
const used = new Map();          // cue name -> where it is asked for
for (const file of srcFiles) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/\bsfx\(([^)]*)\)/g)) {
    // the cue is the first argument: a plain 'name', or the two names of a  cond ? 'a' : 'b'
    const arg = m[1], names = /^\s*'/.test(arg) ? [arg.match(/^\s*'([A-Za-z]+)'/)] : [...arg.matchAll(/[?:]\s*'([A-Za-z]+)'/g)];
    for (const q of names) if (q) used.set(q[1], path.relative(root, file));
  }
  for (const m of text.matchAll(/(?:dataset\.sfx\s*=\s*|data-sfx=\\?")'?(\w+)/g)) used.set(m[1], path.relative(root, file));
}
for (const m of html.matchAll(/data-sfx="(\w+)"/g)) used.set(m[1], 'index.html');
for (const [name, where] of used) if (name !== 'none') check(!!CUES[name], `'${name}' (asked for in ${where}) is a cue of the mix table`);

// The wardrobe's own cues (its tiles say theirs with data-sfx): every one is in the mix table, and each kind of choice
// has its sound (a snip for hair and moustaches, a rustle for clothes, a clink for glasses and jewellery, the lift bell
// on Save look).
console.log('\nthe wardrobe\'s sounds (src/ui/wardrobe/areas.js WARDROBE_CUES)');
{
  const { WARDROBE_CUES } = await import('../src/ui/wardrobe/areas.js');
  for (const [what, cue] of Object.entries(WARDROBE_CUES)) check(!!CUES[cue], `${what} plays '${cue}', a cue of the mix table`);
  check(WARDROBE_CUES.hairStyle === 'snip' && WARDROBE_CUES.facial === 'snip', 'hair and moustaches: the snip');
  check(['top', 'neck', 'legs', 'dress', 'belt', 'feet'].every(s => WARDROBE_CUES[s] === 'rustle'), 'clothes: the rustle');
  check(WARDROBE_CUES.glasses === 'clink' && WARDROBE_CUES.extra === 'clink', 'glasses and jewellery: the clink');
  check(WARDROBE_CUES.save === 'liftDing' && WARDROBE_CUES.colour === 'tick' && WARDROBE_CUES.tryOn === 'mirror', 'Save look: the lift bell; a colour: the tick; a try-on: the mirror');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL BUTTON SOUND CHECKS PASSED');
process.exit(failures ? 1 : 0);
