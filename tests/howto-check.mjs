// The words that teach the game (no browser): node tests/howto-check.mjs
//
//   - the How to play pages (src/data/howToPlay.js): five pages, each with a title and short lines; every line
//     renders; and a number is NEVER typed in: the same pages drawn from a copy of the rules with every number
//     changed say the new numbers and none of the old ones (so a change in src/data/rules.js reaches the page).
//     The pages teach the game, not the cards: no card but the Lantern and the Possession card is named on them
//     (the owner's feedback, 15 Oct 2026); the last page points to the Cards screen
//   - the Cards screen (src/data/cardsGuide.js, src/data/rules.js): one entry for EVERY card type in the catalogue,
//     with its name and ONE short plain line; the numbers in those lines still match the rules; the Lantern's line
//     is the owner's own; the screen and its three doors (main menu, Menu panel, last How to play page) are in index.html
//   - the hint under "Practice alone", and the role screen's headline and its ONE line about how the other side wins
//   - the round-4 rules (approved 15 Oct 2026) in the words: page 5 says each Infirmary works once per match (for whoever
//     gets there first, and everyone sees), the Switchboard costs 2 actions, works as often as you can pay for and says how many
//     living guests are possessed, never who, the room's action takes the place of searching, and the discard has a time limit
//     (the turn clock keeps running, at least 10 seconds, then the game discards for you); the tips say the same
//   - the tips (src/data/tips.js): the first-meeting tip says both halves of the Lantern dilemma; the new tips exist;
//     every tip renders for every kind of player, in one or two short sentences, and its numbers follow a changed copy of the rules
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
import { CARDS_GUIDE, cardEntries } from '../src/data/cardsGuide.js';
import { CARDS, makeCard } from '../src/game/cards.js';
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
// the owner's three added sentences (15 Oct 2026): how to escape, End turn, and a guest walking into you (the escape
// one has "tap the Exit icon" in place of "tap Escape" since the Escape button became an icon in the Fire Exit)
for (const text of ['Tap End turn when you are done; unused actions are lost.', 'If a guest walks into your room, they choose; a trade then asks you for a card.',
  `Escaping costs ${rules.escapeCost === 1 ? '1 action' : `${rules.escapeCost} actions`}: stand in the Fire Exit and tap the Exit icon.`]) check(real.join('\n').includes(text), `the pages say "${text}"`);
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
  [`the Infirmary's ${rules.infirmaryHeal} for ${rules.infirmaryCost} action`, `restores ${rules.infirmaryHeal} health for ${rules.infirmaryCost} action`],
  [`the Switchboard's ${rules.switchboardCost} actions`, `The Switchboard costs ${rules.switchboardCost} actions`],
  [`the discard's ${rules.discardMinSeconds} seconds`, `at least ${rules.discardMinSeconds} seconds`],
]) check(all.includes(text), `the pages say ${what}`);
// The round-4 rules (approved 15 Oct 2026), sentence by sentence: each Infirmary once per match, the Switchboard, the room's
// action in the place of the search, the discard's time limit. They live on the last page ("Staying alive").
const staying = HOW_TO_PLAY.pages.at(-1).lines.map(l => l(rules)).join('\n');
for (const [what, re] of [
  ['each Infirmary works once per match, for whoever gets there first, and everyone sees when it is used', /Each one works once per match, for whoever gets there first, and everyone sees when it is used\./],
  ['the Switchboard can be used as often as you can pay (no once-a-turn limit)', /can be used as often as you can pay for\./],
  ['the Switchboard says how many living guests are possessed, but not who', /how many living guests are possessed, but not who\./],
  ["the room's own action takes the place of searching", /In these two rooms, the room's own action takes the place of searching\./],
  ['holding more than the limit means discarding down to it at the end of the turn', new RegExp(`you discard down to ${rules.handLimit} when you end your turn\\.`)],
  ['the turn clock keeps running and the discard gets at least 10 seconds', new RegExp(`The turn clock keeps running, but you always get at least ${rules.discardMinSeconds} seconds\\.`)],
  ['when time runs out the game discards for you, at random', /When time runs out, the game discards for you, at random\./],
]) check(re.test(staying), `"Staying alive" says ${what}`);
check(!/once a turn|once per turn|as you like|AP\b/.test(all), 'nothing on the pages still says "once a turn" (the old Switchboard rule), "as you like" or "AP"');
check(!/search/i.test(staying.replace(/In these two rooms[^\n]*/, '')), 'the page says nothing else about searching the Infirmary or the Switchboard (the old rule gave them a card)');
// The pages teach the game, not the cards (the owner: "we don't need to mention espresso and we don't need to mention
// the hand mirror"; what each card does is on the Cards screen). The Lantern and the Possession card are the game itself.
const cardNames = Object.entries(rules.cards).filter(([type]) => !['lantern', 'possession'].includes(type)).map(([, c]) => c.name);
for (const name of cardNames) check(!new RegExp(`\\b${name}\\b`, 'i').test(all), `the pages no longer mention the ${name}`);
check(!/Espresso/i.test(all) && !/Hand Mirror/i.test(all), 'no Espresso and no Hand Mirror on any page (the owner\'s own examples)');
check(!/\bdamage\b/i.test(all) && !/\bshots?\b/i.test(all), 'no card numbers (damage, shots) on the pages');
const lastLines = HOW_TO_PLAY.pages.at(-1).lines.map(l => l(rules));
check(lastLines.at(-1) === 'All the cards and what they do are on the Cards screen.', 'the last page ends with the pointer to the Cards screen');
check(HOW_TO_PLAY.pages.at(-1).cardsLink === true && HOW_TO_PLAY.pages.slice(0, -1).every(p => !p.cardsLink) && HOW_TO_PLAY.words.cards === 'Cards', '...and only the last page has the small Cards button');
check(HOW_TO_PLAY.pages.every(p => p.lines.length >= 3), 'no page is left empty or thin: every page keeps at least three lines');
// the draft's own words, to the letter (the owner is reviewing them; a change is on purpose)
for (const sentence of [
  'You are trapped on a hotel floor at night. Lanterns are the way out. One guest is secretly possessed.',
  'Tap a glowing door to open it. Tap a room you can reach to walk there. Tap the magnifier to search; only you see what you found.',
  'Trade: you each pick one card to give, in secret, and the cards swap together. Only you see what you got.',
  'A Lantern is your shield: hand one over in that trade and the attempt fails. The Lantern and the soul burn, and you learn who tried.',
  'At the end of your turn you can keep 6 cards. Souls do not count.',
]) check(all.includes(sentence), `the draft sentence is there: "${sentence.slice(0, 48)}..."`);
check(/out of the game and drop everything you carry, except Possession cards, which leave the game\./.test(all), 'a guest who is out drops what they carry, but Possession cards leave the game (docs/GAME_RULES.md, Health)');
// (the Switchboard costs 2 since round 4, so the costs are no longer all the same and are said one by one; the one-sentence form
// is checked below with a copy of the rules in which they are all the same)
check(new RegExp(`Opening a door costs ${rules.openDoorCost} action, moving to the next room ${rules.moveCost} action, searching ${rules.searchCost} action and using a card ${rules.playCardCost} action\\. The Infirmary costs ${rules.infirmaryCost} action and the Switchboard ${rules.switchboardCost} actions\\.`).test(all)
  && !/cost 1 action each/.test(all), 'the costs differ (the Switchboard costs 2 actions), so each is said on its own');
check(/cost 1 action each\./.test(pageText({ ...JSON.parse(JSON.stringify(rules)), switchboardCost: 1 }).join('\n')), '...and they read as one sentence again when they are all the same');

// Every number changed: the pages follow the rules, nothing is typed in.
const other = JSON.parse(JSON.stringify(rules));
Object.assign(other, { actionPointsPerTurn: 7, turnTimerSeconds: 33, lanternsToEscape: 5, roundLimit: 11, maxHealth: 9, handLimit: 8,
  attackCost: 3, escapeCost: 3, infirmaryHeal: 5, infirmaryCost: 2, lanternsDealtEach: 2, bandageHeal: 3, moveCost: 2, openDoorCost: 2, searchCost: 2, playCardCost: 2, switchboardCost: 2,
  discardMinSeconds: 17 });
const changed = pageText(other).join('\n');
for (const text of ['7 actions each turn', '33 seconds', '5 Lanterns', 'round 11', '9 health', '8 cards', '3 actions', 'restores 5 health for 2 actions', 'Five open', 'two Lanterns',
  'cost 2 actions each', 'Escaping costs 3 actions: stand in the Fire Exit and tap the Exit icon.', 'you need a weapon and 3 actions',
  'you discard down to 8 when you end your turn', 'at least 17 seconds', 'The Switchboard costs 2 actions']) check(changed.includes(text), `with other rules the pages say "${text}"`);
for (const text of ['4 actions', '45 seconds', '3 Lanterns', 'round 8', '4 health', '6 cards', 'restores 2 health for', 'cost 1 action each', 'Escaping costs 1 action', 'weapon and 1 action',
  'discard down to 6', 'at least 10 seconds']) check(!changed.includes(text), `...and no longer "${text}"`);
// (the Switchboard's price on its own: a copy of the rules where only it costs more than the rest)
const dearer = JSON.parse(JSON.stringify(other)); dearer.switchboardCost = 3;
check(pageText(dearer).join('\n').includes('The Switchboard costs 3 actions') && /the Switchboard 3 actions/.test(pageText(dearer).join('\n')), 'the Switchboard price follows the rules too (a copy where it costs 3: said on page 2 and on page 5)');
// (the costs that differ are listed one by one, not squeezed into a false sentence)
const mixed = JSON.parse(JSON.stringify(rules)); mixed.searchCost = 2;
check(/searching 2 actions/.test(pageText(mixed).join('\n')) && !/cost 1 action each/.test(pageText(mixed).join('\n')), 'when the costs differ, each is said on its own');

// --- the Cards screen --------------------------------------------------------------------------------------
console.log('\nthe Cards screen');
const entries = cardEntries(CARDS);
const types = Object.keys(CARDS);
check(entries.length === types.length && entries.map(e => e.type).join() === types.join(), `one entry for every card type in the catalogue, in its order (${types.join(', ')})`);
check(types.includes('lantern') && types.includes('possession') && entries.every(e => e.name === CARDS[e.type].name && e.desc === CARDS[e.type].desc && e.name && e.desc), 'each entry is its name and its line from src/data/rules.js, none empty (the Lantern and the Possession card are in it)');
check(Object.keys(rules.deck).every(t => types.includes(t)) && new Set(entries.map(e => e.name)).size === entries.length, 'every card of the draw deck is in the list, and no two have the same name');
check(['Lantern', 'Bandage', 'Flashlight', 'Knife', 'Revolver', 'Barricade', 'Lock Pick', 'Master Key', 'Hand Mirror', 'Espresso', 'Possession'].every(n => entries.some(e => e.name === n)), 'all eleven cards are there by name');
// a card type added to the catalogue is listed by itself (and a copy of the rules is read as it is)
const extra = { ...JSON.parse(JSON.stringify(CARDS)), torch: { name: 'Torch', desc: 'A test card.' } };
check(cardEntries(extra).length === types.length + 1 && cardEntries(extra).at(-1).type === 'torch' && cardEntries(extra).at(-1).desc === 'A test card.', 'a new card type added to the catalogue shows up in the list with no other change');
check(CARDS_GUIDE.title === 'Cards' && CARDS_GUIDE.close === 'Close', 'the screen is called "Cards" and has a Close button');
// ONE short plain line each, about 12 words at most (the owner: "very detailed ... let us keep it simpler"); the Lantern's two
// short sentences are the owner's own words, so it may run to 15
const sentences = t => t.split(/(?<=[.!?])\s+/).filter(Boolean);
const words = t => t.trim().split(/\s+/).length;
for (const e of entries) {
  check(sentences(e.desc).length <= 2 && words(e.desc) <= (e.type === 'lantern' ? 15 : 12) && e.desc.length <= 90, `${e.name}: short and plain (${words(e.desc)} words): "${e.desc}"`);
  check(!/\bAP\b|action points|\n/.test(e.desc) && !/\b1 action\b/.test(e.desc), `${e.name}: no "AP", and no action cost typed in (the Use button says it)`);
}
check(CARDS.lantern.desc === 'Three let you escape through the Fire Exit. One protects you from a Possession card.', "the Lantern's line is the owner's own words");
// the numbers in the lines are the rules' numbers (a line that says a number must agree with rules.js)
const w = n => ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n];
check(new RegExp(`\\b${w(rules.lanternsToEscape)}\\b`, 'i').test(CARDS.lantern.desc), `Lantern: "${w(rules.lanternsToEscape)}" is lanternsToEscape`);
check(CARDS.bandage.desc.includes(`${rules.cards.bandage.heal}`) && /health/.test(CARDS.bandage.desc), `Bandage: heals ${rules.cards.bandage.heal}`);
check(CARDS.knife.desc.includes(`${rules.cards.knife.damage} damage`) && (rules.cards.knife.reusable ? /reusable/.test(CARDS.knife.desc) : true), `Knife: ${rules.cards.knife.damage} damage, reusable`);
check(CARDS.revolver.desc.includes(`${rules.cards.revolver.damage} damage`) && new RegExp(`\\b${w(rules.cards.revolver.shots)} shots`, 'i').test(CARDS.revolver.desc), `Revolver: ${rules.cards.revolver.damage} damage, ${w(rules.cards.revolver.shots)} shots`);
check(CARDS.espresso.desc.includes(`${rules.cards.espresso.extraActions} extra actions`) && (rules.espressoCost === 0 ? /Free/.test(CARDS.espresso.desc) : true), `Espresso: ${rules.cards.espresso.extraActions} extra actions${rules.espressoCost === 0 ? ', free' : ''}`);
check(/half the time/.test(CARDS.lockPick.desc) === (rules.lockPickChance === 0.5) && /^Always opens/.test(CARDS.masterKey.desc), `Lock Pick: half the time (lockPickChance ${rules.lockPickChance}); Master Key: always`);
check(new RegExp(`\\b${w(rules.barricadeRounds)} round\\b`).test(CARDS.barricade.desc), `Barricade: for ${w(rules.barricadeRounds)} round`);
// what a player reads when a card is made (a card of every type can be built)
check(types.every(t => makeCard(t).type === t), 'a card of every listed type can be made');
// the screen and its doors are in the page: the overlay, and a button in the main menu, the Menu panel and the last How to play page
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
check(/id="cards-overlay"/.test(page) && /id="cards-list"/.test(page) && /id="btn-cards-close"/.test(page) && /id="btn-menu-cards"[^>]*data-sfx="open"/.test(page) && /id="btn-gm-cards"[^>]*data-sfx="open"/.test(page), 'index.html has the Cards screen, its Close button, and the Cards buttons of the main menu and the Menu panel');
const howtoUi = fs.readFileSync(path.join(root, 'src/ui/howToPlay.js'), 'utf8');
check(/btn-howto-cards/.test(howtoUi) && /cardsBtn\.dataset\.sfx = 'open'/.test(howtoUi) && /cards\?\.open\(/.test(howtoUi), 'the last How to play page has a Cards button that opens the screen (with the opening sound)');
const guideUi = fs.readFileSync(path.join(root, 'src/ui/cardsGuide.js'), 'utf8');
check(/cardEntries\(CARDS\)/.test(guideUi) && /cardTile\(/.test(guideUi), 'the screen is drawn from the whole catalogue with the shared card tile (src/ui/cards.js)');
// it only reads: no game state, no hand, no timer is touched by the screen's code
check(!/state\b|\.hand\b|setTimeout|setInterval|timer/i.test(guideUi.replace(/\/\/.*$/gm, '')), 'the screen never touches a game state, a hand or a clock');

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
check(GAME_MENU.leave(false) === 'Leave the match' && GAME_MENU.leave(true) === 'Leave practice' && GAME_MENU.resume === 'Resume' && GAME_MENU.howTo === 'How to play' && GAME_MENU.cards === 'Cards', 'the Menu panel: Resume, How to play, Cards, Leave the match / Leave practice');

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
// The round-4 rules in the tips (approved 15 Oct 2026): the numbers are the rules' (none typed in), and each tip says the new rule
const YOU = { practice: false, possessed: false };
const tipsOf = r => Object.fromEntries(Object.entries(TIPS).map(([id, t]) => [id, t.text(r, YOU)]));
const realTips = tipsOf(rules), otherTips = tipsOf({ ...other, switchboardCost: 3 });
check(/heal 2 health for 1 action/.test(realTips.infirmary) && /once per match, for whoever gets there first/.test(realTips.infirmary) && /Tap the cross/.test(realTips.infirmary), `the Infirmary tip: the cross heals ${rules.infirmaryHeal} health for ${rules.infirmaryCost} action, each Infirmary works once per match, for whoever gets there first ("${realTips.infirmary}")`);
check(/heal 5 health for 2 actions/.test(otherTips.infirmary), '...and its numbers follow the rules');
check(new RegExp(`costs ${rules.switchboardCost} actions, works as often as you can pay for, and tells the whole table how many guests are possessed, never who`).test(realTips.switchboard) && !/once a turn|once per turn/i.test(realTips.switchboard), `the Switchboard tip: ${rules.switchboardCost} actions, as often as you can pay for, the count and never who ("${realTips.switchboard}")`);
check(/costs 3 actions/.test(otherTips.switchboard) && /costs 3 actions/.test(otherTips.switchboardPractice), '...and its price follows the rules (the practice tip too)');
check(/the game discards cards for you, at random/.test(realTips.handLimit) && /if the clock runs out first/.test(realTips.handLimit), `the full-hand tip says the clock can run out and the game then discards cards at random ("${realTips.handLimit}")`);
const handPractice = TIPS.handLimit.text(rules, { ...YOU, practice: true });
check(!/clock|random/.test(handPractice) && /you choose what to discard/.test(handPractice), `...but not in practice, which has no clock ("${handPractice}")`);
check(/You may keep 8 cards/.test(otherTips.handLimit), '...and the limit follows the rules');
check(new RegExp(`more than ${rules.handLimit} cards, the game discards the extras at random`).test(realTips.timer) && /more than 8 cards/.test(otherTips.timer) && /33 seconds/.test(otherTips.timer), `the clock tip says what the clock does to a hand over the limit ("${realTips.timer}"), with the rules' numbers`);
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
