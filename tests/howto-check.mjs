// The words that teach the game (no browser): node tests/howto-check.mjs
//
//   - the How to play pages (src/data/howToPlay.js): five pages, each with a title and short lines; every line
//     renders; and a number is NEVER typed in: the same pages drawn from a copy of the rules with every number
//     changed say the new numbers and none of the old ones (so a change in src/data/rules.js reaches the page)
//   - the hint under "Practice alone", and the role screen's headline and its ONE line about how the other side wins
//   - the tips (src/data/tips.js): the first-meeting tip says both halves of the Lantern dilemma; the new tips exist;
//     every tip renders for every kind of player, in one or two short sentences, with no number typed in either
//   - the end screen's recap line (src/ui/endRecap.js) for the cases a match can end in, and its words
//   - one word for the action budget: no "AP" and no "action points" in anything the player reads (src/ and
//     index.html, comments left out)
import fs from 'node:fs';
import path from 'node:path';
import { rules } from '../src/data/rules.js';
import { HOW_TO_PLAY, NEW_PLAYER_HINT, ROLE_REVEAL, LANTERN_CHIP } from '../src/data/howToPlay.js';
import { TIPS, LANTERN_TRADE_NOTE } from '../src/data/tips.js';
import { END_WORDS } from '../src/data/endScreen.js';
import { GAME_MENU } from '../src/data/gameMenu.js';
import { endRecap } from '../src/ui/endRecap.js';
import { actionsWord } from '../src/ui/actionsWord.js';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

// --- How to play ---------------------------------------------------------------------------------------
console.log('How to play');
const pageText = r => HOW_TO_PLAY.pages.map(p => [p.title, ...p.lines.map(l => l(r))].join('\n'));
const real = pageText(rules);
check(HOW_TO_PLAY.pages.length === 5, 'five pages');
for (const [i, p] of HOW_TO_PLAY.pages.entries()) {
  const lines = p.lines.map(l => l(rules));
  check(!!p.title && lines.length >= 3 && lines.every(t => typeof t === 'string' && t.length > 10 && t.length < 330), `page ${i + 1} "${p.title}": ${lines.length} short lines`);
  check(!lines.some(t => /undefined|NaN|\{|\}|\$/.test(t)), `page ${i + 1}: every line is plain text, nothing left unfilled`);
}
const all = real.join('\n');
for (const [what, text] of [
  [`${rules.actionPointsPerTurn} actions each turn`, `${rules.actionPointsPerTurn} actions each turn`],
  [`${rules.turnTimerSeconds} seconds`, `${rules.turnTimerSeconds} seconds`],
  [`${rules.lanternsToEscape} Lanterns`, `${rules.lanternsToEscape} Lanterns`],
  [`round ${rules.roundLimit}`, `round ${rules.roundLimit}`],
  [`${rules.maxHealth} health`, `${rules.maxHealth} health`],
  [`${rules.handLimit} cards`, `${rules.handLimit} cards`],
  [`Knife ${rules.cards.knife.damage} health`, `Knife takes ${rules.cards.knife.damage} health`],
  [`Revolver ${rules.cards.revolver.damage} and ${rules.cards.revolver.shots} shots`, `Revolver takes ${rules.cards.revolver.damage} and has ${rules.cards.revolver.shots} shots`],
  ['Espresso gives its extra actions', `gives you ${rules.cards.espresso.extraActions} more`],
]) check(all.includes(text), `the pages say ${what}`);
// the draft's own words, to the letter (the owner is reviewing them; a change is on purpose)
for (const sentence of [
  'You are trapped on a hotel floor at night. Lanterns are the way out. One guest is secretly possessed.',
  'Tap a glowing door to open it. Tap a room you can reach to walk there. Tap the magnifier to search; only you see what you found.',
  'Trade: you each pick one card to give, in secret, and the cards swap together. Only you see what you got.',
  'A Lantern is your shield: hand one over in that trade and the attempt fails. The Lantern and the soul burn, and you learn who tried.',
  'At the end of your turn you can keep 6 cards. Souls do not count.',
]) check(all.includes(sentence), `the draft sentence is there: "${sentence.slice(0, 48)}..."`);
check(/out of the game and drop everything you carry, except Possession cards, which leave the game\./.test(all), 'a guest who is out drops what they carry, but Possession cards leave the game (docs/GAME_RULES.md, Health)');
check(/Opening a door, moving to the next room, searching, using a card and using a room's job cost 1 action each\./.test(all), 'the costs read as one sentence while they are all the same');

// Every number changed: the pages follow the rules, nothing is typed in.
const other = JSON.parse(JSON.stringify(rules));
Object.assign(other, { actionPointsPerTurn: 7, turnTimerSeconds: 33, lanternsToEscape: 5, roundLimit: 11, maxHealth: 9, handLimit: 8,
  attackCost: 3, infirmaryHeal: 5, infirmaryCost: 2, lanternsDealtEach: 2, bandageHeal: 3, moveCost: 2, openDoorCost: 2, searchCost: 2, playCardCost: 2, switchboardCost: 2 });
other.cards.knife.damage = 3; other.cards.revolver.damage = 6; other.cards.revolver.shots = 5; other.cards.espresso.extraActions = 9; other.cards.bandage.heal = 3;
const changed = pageText(other).join('\n');
for (const text of ['7 actions each turn', '33 seconds', '5 Lanterns', 'round 11', '9 health', '8 cards', '3 actions', 'heals 5 for 2 actions', 'Five open', 'two Lanterns',
  'takes 3 health', 'takes 6 and has 5 shots', 'gives you 9 more', 'heals 3', 'cost 2 actions each']) check(changed.includes(text), `with other rules the pages say "${text}"`);
for (const text of ['4 actions', '45 seconds', '3 Lanterns', 'round 8', '4 health', '6 cards', '2 shots', 'cost 1 action each']) check(!changed.includes(text), `...and no longer "${text}"`);
// (the costs that differ are listed one by one, not squeezed into a false sentence)
const mixed = JSON.parse(JSON.stringify(rules)); mixed.searchCost = 2;
check(/searching 2 actions/.test(pageText(mixed).join('\n')) && !/cost 1 action each/.test(pageText(mixed).join('\n')), 'when the costs differ, each is said on its own');

// --- the hint, the role screen, the chip --------------------------------------------------------------------
console.log('\nthe hint, the role screen, the Lanterns chip');
check(NEW_PLAYER_HINT === 'New to Hotel Escape? Practice alone is the best place to start.', 'the hint under Practice alone, as drafted');
check(ROLE_REVEAL.headline(false) === 'You are clean' && ROLE_REVEAL.headline(true) === 'You are possessed', 'the role headline: "You are clean" / "You are possessed"');
check(ROLE_REVEAL.otherSide(false, rules) === 'The possessed win if every living guest is possessed, or no clean guest is left, or dawn breaks before anyone escapes.', 'a clean guest is told how the possessed win: all three ways, as docs/GAME_RULES.md (Winning) and the first page say');
check(/every living guest is possessed/.test(real[0]) && /no clean guest is left/.test(real[0]) && /dawn breaks/.test(real[0]), '...the same three ways as page 1 of How to play');
check(ROLE_REVEAL.otherSide(true, rules) === `The clean guests win if one of them escapes with ${rules.lanternsToEscape} Lanterns.`, 'a possessed guest is told how the clean guests win, the number from the rules');
check(ROLE_REVEAL.otherSide(true, other) === 'The clean guests win if one of them escapes with 5 Lanterns.', '...and the number follows the rules');
check(LANTERN_CHIP.text(2, rules.lanternsToEscape) === `2/${rules.lanternsToEscape}` && LANTERN_CHIP.label === 'Lanterns', 'the chip reads "Lanterns 2/3": your own count out of the number the rules ask for');
check(/1 Lantern /.test(LANTERN_CHIP.aria(1, 3)) && /2 Lanterns /.test(LANTERN_CHIP.aria(2, 3)), 'its spoken words say "Lantern" for one and "Lanterns" for more');
check(GAME_MENU.leave(false) === 'Leave the match' && GAME_MENU.leave(true) === 'Leave practice' && GAME_MENU.resume === 'Resume' && GAME_MENU.howTo === 'How to play', 'the Menu panel: Resume, How to play, Leave the match / Leave practice');

// --- the tips ---------------------------------------------------------------------------------------------------
console.log('\nthe tips');
const ids = Object.keys(TIPS);
check(['safeZone', 'camera', 'cameraButtons'].every(id => ids.includes(id)), 'a tip for the safe zone, for pinch and drag, and for the round camera buttons');
check(ids.length === 21, `21 tips in all (18 before, 3 new): ${ids.length}`);
const meeting = TIPS.meeting.text(rules, { practice: false, possessed: false });
check(/A Lantern blocks a soul/.test(meeting) && /but is lost if the other guest gives you an ordinary card/.test(meeting), `the first-meeting tip says both halves of the Lantern dilemma ("${meeting}")`);
check(TIPS.meeting.text(rules, { practice: false, possessed: true }) === meeting, '...and says it the same to a possessed guest');
check(meeting.includes(LANTERN_TRADE_NOTE), '...with the sentence the private pick screen shows when a Lantern is lifted (one place: LANTERN_TRADE_NOTE), so a computer guest who walks in teaches it too');
for (const [id, tip] of Object.entries(TIPS)) {
  const texts = [false, true].flatMap(practice => [false, true].map(possessed => tip.text(rules, { practice, possessed })));
  check(texts.every(t => typeof t === 'string' && t.length > 20 && t.length <= 200), `tip "${id}": one or two short sentences (${texts[0].length} characters)`);
}
const tipWords = (r) => Object.values(TIPS).map(t => t.text(r, { practice: false, possessed: false })).join('\n');
check(!/\bAP\b/.test(tipWords(rules)) && !/action points/i.test(tipWords(rules)), 'no tip says AP or action points');
check(TIPS.safeZone.text(rules, {}).includes('Fourth Floor Landing') && TIPS.safeZone.text(rules, {}).includes('Fire Exit'), 'the safe-zone tip names the two safe rooms (from the hotel data)');
check(/Drag/.test(TIPS.camera.text(rules, {})) && /[Pp]inch/.test(TIPS.camera.text(rules, {})), 'the camera tip says drag and pinch');
check(/arrows/.test(TIPS.cameraButtons.text(rules, {})) && /target/.test(TIPS.cameraButtons.text(rules, {})), 'the round-buttons tip says what the arrows and the target do');

// --- the end screen ---------------------------------------------------------------------------------------------
console.log('\nthe end screen');
const P = (index, name, extra = {}) => ({ index, id: `p${index}`, name, possessed: false, convertedBy: null, ...extra });
const table = (...over) => ({ players: [P(0, 'tester'), P(1, 'oakhart'), P(2, 'ari_v'), P(3, 'birch'), P(4, 'moth'), P(5, 'mabel')].map((p, i) => ({ ...p, ...(over[i] || {}) })) });
check(endRecap(table(), 0) === '', 'nobody possessed: no recap (a match always has one possessed guest; nothing is made up)');
check(endRecap(table(null, { possessed: true }), 0) === 'oakhart was possessed first and possessed nobody.', 'a possessed guest who possessed nobody');
check(endRecap(table(null, { possessed: true }, { possessed: true, convertedBy: 'p1' }, { possessed: true, convertedBy: 'p1' }, { possessed: true, convertedBy: 'p1' }), 0)
  === 'oakhart was possessed first and possessed ari_v, birch and moth.', 'who was possessed first and whom they possessed, as the audit worded it');
check(endRecap(table(null, { possessed: true }, { possessed: true, convertedBy: 'p1' }, { possessed: true, convertedBy: 'p2' }), 0)
  === 'oakhart was possessed first and possessed ari_v. 1 more was possessed after that.', 'a chain: the rest are counted, not listed');
check(endRecap(table(null, { possessed: true }, { possessed: true, convertedBy: 'p1' }, { possessed: true, convertedBy: 'p2' }, { possessed: true, convertedBy: 'p2' }), 0)
  === 'oakhart was possessed first and possessed ari_v. 2 more were possessed after that.', '...in the plural too');
check(endRecap(table({ possessed: true }, { possessed: true, convertedBy: 'p0' }), 0) === 'You were possessed first and possessed oakhart.', 'the player themselves: "You were possessed first and possessed oakhart."');
check(endRecap(table({ possessed: true }, null, { possessed: true, convertedBy: 'p0' }), 2) === 'tester was possessed first and possessed you.', 'a guest the player is: "possessed you"');
check(END_WORDS.victory === 'Victory' && END_WORDS.defeat === 'Defeat', 'the plain words: Victory and Defeat');
check(END_WORDS.winners(true) === 'The clean guests win.' && END_WORDS.winners(false) === 'The possessed win.', 'who won, in one short line');

// --- one word for the action budget -----------------------------------------------------------------------------
console.log('\none word for the action budget');
check(actionsWord(1) === '1 action' && actionsWord(2) === '2 actions' && actionsWord(4) === '4 actions', 'actionsWord: "1 action", "2 actions", "4 actions"');
const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const files = [];
(function walk(dir) { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) files.push(p); } })(path.join(root, 'src'));
const offenders = [];
for (const file of files) {
  const code = strip(fs.readFileSync(file, 'utf8'));
  for (const m of code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) {
    if (/\bAP\b/.test(m[2]) || /\baction points?\b/i.test(m[2])) offenders.push(`${path.relative(root, file)}: ${m[0].slice(0, 70)}`);
  }
}
check(!offenders.length, `no string in src/ says AP or "action points"${offenders.length ? `: ${offenders.slice(0, 4).join(' | ')}` : ''}`);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
check(!/>[^<]*\bAP\b[^<]*</.test(html) && !/action points?/i.test(html), 'index.html shows no AP and no "action points"');

console.log(failures ? `\n${failures} FAILED` : '\nALL HOW-TO-PLAY CHECKS PASSED');
process.exit(failures ? 1 : 0);
