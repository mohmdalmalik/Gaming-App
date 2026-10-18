// Checks for profiles and the table (src/account/*, src/data/names.js, src/table.js, the feed's name
// masking in src/ui/feed.js) — fast, no browser.
//   node tests/profile-check.mjs
//
//   1. usernames: the rules (3-16 of A-Z a-z 0-9 _, a letter first), each refusal's message, reserved words
//      (case ignored; the cards' and rooms' names from the data, run together or with _), the light filter
//      (leetspeak, case, stretched letters; short words only as a whole part: "class" and "Sussex" pass);
//      names that read like a role refused ("NotPossessed", "Clean_"); real names the filter once caught pass
//      (Nazir, Shital, Pornchai, Scunthorpe …)
//   2. suggestions: 1000 of them, every one valid, never the one to avoid; every bot username is valid
//   3. the profile (version 2): its shape; repairs of damaged, old and not-owned data (a valid name kept, bad avatar
//      values back to the Look's own, a pending item never, an unlockable one only while the testing switch is on or
//      when owned, unknown inventory ids dropped; no valid name: none); a version 1 profile migrated
//   4. the account (a memory store): sign up, rename, set an avatar (made safe), owns (free items and the inventory),
//      onChange and its unsubscribe, a frozen profile, kept across a new start, a damaged save repaired
//      and saved back, a store that keeps nothing (not persistent, still works for the visit); a saved name
//      no longer allowed keeps the id, avatar and first date for the new one (nameLost); a newer version's
//      profile is read and never written over (readOnly); a saved look called "constructor" or
//      "__proto__" (any built-in name) and a store that throws when read never crash
//   5. the first avatar: last round's "Your guest" seeds it ('p6' is Clara's look); 'random' rolls one
//   6. the table: seat ids p1..pN and colours by seat; bots' avatars deterministic, already safe, about one in three
//      wearing an unlockable item, no two alike nor like yours; bots never take your name (case ignored), with the
//      same random draws
//   7. seeded tables keep their seats: the 5 burnt draws give the same seat, bots and possessed seat as
//      the old shuffle of the six named guests did
//   8. the feed reads lines with names put aside: "nora searched Kitchen." next to a guest named
//      "Kitchen_boy" or "Linen"; "You"/"you"; your own doing left out; every word of the rules' public log
//      (from real bot matches) is reserved, so no username can change how a line reads
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { config } from '../src/config.js';
import { createHotel } from '../src/game/hotel.js';
import { makeRng, shuffle } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import { createBotTable } from '../src/bots/index.js';
import { rollProfiles, USERNAMES } from '../src/bots/profiles.js';
import { playBotTurn } from '../src/bots/autoplay.js';
import { USERNAME, checkUsername, sameName, suggestUsername, reservedWords, isFiltered } from '../src/account/username.js';
import { PROFILE_VERSION, newProfile, repairProfile, startingAvatar } from '../src/account/profile.js';
import { createAccount, memoryStore, PROFILE_KEY } from '../src/account/account.js';
import { SEAT_COLORS, seatTable, botAvatars, STAND_IN } from '../src/table.js';
import { ITEMS, LOOKS, itemId, normaliseAvatar, lookAlike, genderOf, isFree, lookOf, UNLOCK_ALL_FOR_TESTING } from '../src/data/wardrobe.js';
import { randomAvatar, unlockablesWorn } from '../src/data/randomAvatar.js';
// (a classic Look, as an avatar)
const originalAvatar = id => normaliseAvatar(LOOKS[id]);
const ON = UNLOCK_ALL_FOR_TESTING;       // (the testing switch: unlockable items are wearable while it is on)
import { feedLine } from '../src/ui/feed.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const code = n => checkUsername(n).code ?? 'ok';

// --- 1. usernames -------------------------------------------------------------------------------------
console.log('usernames');
check(USERNAME.min === 3 && USERNAME.max === 16, 'names are 3 to 16 characters');
for (const n of ['nora', 'Sam_22', 'velvet_owl', 'abc', 'A234567890123456', 'quietfox_', 'class_act', 'Sussex', 'bass_player', 'scrapbook', 'cockatoo', 'therapist', 'grape', 'swanky_owl', 'Hazel'])
  check(checkUsername(n).ok, `"${n}" is a good name`);
check(checkUsername('  nora  ').ok && checkUsername('  nora  ').name === 'nora', 'spaces round a name are trimmed');
const refusals = { '': 'empty', '   ': 'empty', jo: 'short', A2345678901234567: 'long', 'no spaces': 'chars', 'nora!': 'chars', 'zoë': 'chars', '<b>x</b>': 'chars',
  '7nora': 'start', _nora: 'start', you: 'reserved', YOU: 'reserved', Guest: 'reserved', admin: 'reserved', Possessed: 'reserved', clean: 'reserved',
  Kitchen: 'reserved', LANTERN: 'reserved', Fire_Exit: 'reserved', FireExit: 'reserved', HandMirror: 'reserved', Linen_Store: 'reserved', searched: 'reserved', traded: 'reserved' };
for (const [n, want] of Object.entries(refusals)) check(code(n) === want, `"${n}" is refused: ${want} ("${checkUsername(n).message}")`);
check(Object.values(refusals).every(c => typeof checkUsername(Object.keys(refusals).find(k => refusals[k] === c)).message === 'string'), 'every refusal has words for the player');
check(checkUsername('jo').message === 'At least 3 characters.' && checkUsername('a b c').message === 'Only letters, numbers and _ (no spaces).'
  && checkUsername('9lives').message === 'Start with a letter.' && checkUsername('Kitchen').message === 'That name belongs to the hotel. Try another.', 'the messages are the plain words of the design');
const words = reservedWords();
check(['lantern', 'bandage', 'flashlight', 'knife', 'revolver', 'barricade', 'espresso', 'possession', 'lounge', 'ballroom', 'switchboard', 'library', 'kitchen', 'infirmary', 'cloakroom'].every(w => words.has(w)), 'every one-word card and room name of the data is reserved');
// the light filter (the words themselves are only in base64 in src/data/names.js; built here from parts)
const w = (...parts) => parts.join('');
for (const n of [w('fu', 'ck'), w('F', 'U', 'C', 'K', 'er'), w('fuu', 'uck', '_you'), w('sh', '1', 't'), w('a', '55'), w('Big', 'Ass'), w('my_', 'ass'), w('b', '1', 'tch', 'y'), w('xx', 'sh', 'it', 'xx')])
  check(isFiltered(n) && code(n) !== 'ok', `"${n.replace(/./g, (c, i) => (i % 2 ? c : '*'))}" is caught by the filter (leetspeak, case, stretched, parts)`);
for (const n of ['class', 'Sussex', 'bass_player', 'scrapbook', 'cockatoo', 'therapist', 'grape', 'swanky_owl', 'Dickens_fan', 'assassin', 'passport'])
  check(!isFiltered(n), `"${n}" is not caught (short words only as a whole part)`);
check(sameName('Nora', 'nora') && !sameName('nora', 'nora_b'), 'names compare without case');
// a name that reads like the game telling a role ("POSSESSED_X searched Kitchen.") is the hotel's
for (const n of ['POSSESSED_X', 'Possessed_', 'IsPossessed', 'possessed1', 'NotPossessed', 'p0ssessed', 'Clean_', 'Mr_Clean', 'CleanGuest'])
  check(code(n) === 'reserved', `"${n}" is refused like a reserved name (it reads like a role)`);
// real names and places that hold a filtered word by chance are good names
for (const n of ['Nazir', 'Nazim', 'Nazia', 'Nazih', 'Nazila', 'Shital', 'Shitij', 'Ashita', 'Mishita', 'Pornchai', 'Pornthip', 'Pornpimol', 'Scunthorpe', 'Penistone'])
  check(checkUsername(n).ok, `"${n}" is a good name (a real name, not a filtered word)`);

// --- 2. suggestions -----------------------------------------------------------------------------------
console.log('\nsuggestions');
{
  const rng = makeRng(4242);
  let bad = 0, same = 0;
  for (let k = 0; k < 1000; k++) {
    const avoid = k % 2 ? 'velvet_owl' : `name${k}`;
    const s = suggestUsername(rng, { avoid: [avoid] });
    if (!checkUsername(s).ok || s.length > 16) bad++;
    if (sameName(s, avoid)) same++;
  }
  check(bad === 0, `1000 suggestions are all good names (${bad} not)`);
  check(same === 0, 'a suggestion is never the name to avoid');
  const alwaysSame = () => 0;
  check(suggestUsername(alwaysSame, { avoid: [suggestUsername(alwaysSame)] }) !== suggestUsername(alwaysSame), 'even with one choice of words, the name to avoid is avoided');
  const badBots = USERNAMES.filter(n => !checkUsername(n).ok);
  check(badBots.length === 0, `all ${USERNAMES.length} bot usernames are good names${badBots.length ? ` (not: ${badBots.join(', ')})` : ''}`);
}

// --- 3. the profile -----------------------------------------------------------------------------------
console.log('\nthe profile');
{
  const p = newProfile({ username: 'nora', now: Date.UTC(2026, 9, 12) });
  check(p.version === PROFILE_VERSION && PROFILE_VERSION === 2, 'version 2');
  check(/^local-[0-9a-f]{16}$/.test(p.id), `a random device id (${p.id})`);
  check(p.username === 'nora' && Array.isArray(p.inventory) && p.inventory.length === 0, 'username, an empty inventory');
  check(p.createdAt === '2026-10-12T00:00:00.000Z' && p.updatedAt === p.createdAt && p.nameChangedAt === p.createdAt, 'createdAt, updatedAt, nameChangedAt');
  check(JSON.stringify(p.avatar) === JSON.stringify(normaliseAvatar(p.avatar)) && p.avatar.v === 2, 'an avatar (v2) made of catalogue ids');
  check(JSON.stringify(p.looks) === '[null,null,null]', 'three empty saved Looks');
  check(unlockablesWorn(p.avatar) === 0, "a new player's first look wears free items only");
  check(newProfile({ username: 'x1x' }).id !== newProfile({ username: 'x1x' }).id, 'every new profile has its own id');

  const keep = repairProfile(JSON.stringify(p));
  check(keep.profile && !keep.repaired && JSON.stringify(keep.profile) === JSON.stringify(p), 'a sound saved profile reads back exactly, nothing repaired');
  check(repairProfile('{not json').profile === null, 'damaged JSON: no profile (the register asks again)');
  check(repairProfile('[1,2]').profile === null && repairProfile('42').profile === null && repairProfile(null).profile === null, 'the wrong shape: no profile');
  check(repairProfile({ ...p, username: 'Kitchen' }).profile === null && repairProfile({ ...p, username: 'a b' }).profile === null, 'a name that breaks the rules: no profile');
  const broken = repairProfile({ username: 'nora', avatar: { base: 'clara', skin: 'green', glasses: 'monocle', main: 'gatsby', metal: 'roseGold', hair: 'platinum', frame: 'goldFrame', eyes: 'blue' },
    inventory: ['glasses.monocle', 'bogus.item', 42, 'glasses.monocle'], id: '../../etc', createdAt: 'yesterday' });
  const a = broken.profile?.avatar;
  check(broken.repaired && broken.profile?.username === 'nora', 'damaged avatar data: the name is kept, the profile repaired');
  check(a?.face === 'clara' && a.dress === 'column' && a.colours.skin === originalAvatar('clara').colours.skin && a.colours.eyes === 'blue', 'an unknown value goes back to the Look\'s own; good values stay');
  check(a && a.glasses === 'none', 'an item whose art is not made yet (the Monocle) never comes back from a save, even owned');
  check(a && (ON ? a.colours.main === 'gatsby' && a.colours.metal === 'roseGold' && a.colours.hair === 'platinum' && a.colours.frame === 'goldFrame'
    : a.colours.main === originalAvatar('clara').colours.main && a.colours.metal === 'gold' && a.colours.hair === originalAvatar('clara').colours.hair && a.colours.frame === 'tortoise'),
    ON ? 'unlockable colours come back from a save while the testing switch is on (Gatsby gold, rose gold, platinum, gold frames)'
      : 'unlockable colours not owned never come back from a save (Gatsby gold, rose gold, platinum, gold frames)');
  check(JSON.stringify(broken.profile?.inventory) === '["glasses.monocle"]', 'the inventory keeps known item ids only, once each');
  check(/^local-[0-9a-f]{16}$/.test(broken.profile?.id) && !Number.isNaN(Date.parse(broken.profile?.createdAt)), 'a bad id and a bad date are replaced');
  const old = repairProfile({ username: 'Theo_22' });
  check(old.profile && old.repaired && old.profile.version === 2 && old.profile.avatar?.v === 2, 'an old profile with only a name gets the rest');
  // a version 1 profile: migrated, the look kept, written back once
  const v1 = { version: 1, id: 'local-0123456789abcdef', username: 'nora', avatar: { v: 1, base: 'marcus', skin: 'deep', hair: 'copper', eyes: 'green', glasses: 'oval', frame: 'jet', main: 'plum', accent: 'brass', metal: 'silver' },
    inventory: ['glasses.monocle', 'hair.platinum'], createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', nameChangedAt: '2026-10-12T00:00:00.000Z' };
  const m = repairProfile(JSON.stringify(v1));
  const ma = m.profile?.avatar;
  check(m.repaired && m.profile?.version === 2 && JSON.stringify(m.profile.looks) === '[null,null,null]', 'a version 1 profile becomes version 2 (repaired: written back once)');
  check(ma && ma.body === 'm' && ma.face === 'marcus' && ma.hairStyle === 'sideSwept' && ma.top === 'lounge' && ma.neck === 'tie' && ma.glasses === 'oval'
    && JSON.stringify(ma.colours) === JSON.stringify({ skin: 'deep', hair: 'copper', eyes: 'green', main: 'plum', accent: 'brass', metal: 'silver', frame: 'jet', lips: 'natural' }),
    `its avatar is the Look it was, in its own colours (${JSON.stringify(ma)})`);
  check(JSON.stringify(m.profile?.inventory) === JSON.stringify(v1.inventory) && m.profile.createdAt === v1.createdAt && m.profile.updatedAt === v1.updatedAt && m.profile.id === v1.id,
    'its inventory ids (each keeps its meaning), id and dates are kept');
  const again = repairProfile(JSON.stringify(m.profile));
  check(!again.repaired && JSON.stringify(again.profile) === JSON.stringify(m.profile), 'read again, the migrated profile is sound: nothing more to repair');
}

// --- 4. the account -----------------------------------------------------------------------------------
console.log('\nthe account');
{
  const store = memoryStore();
  let t = Date.UTC(2026, 9, 12, 10);
  const acct = createAccount({ store, now: () => t });
  const heard = [];
  const off = acct.onChange(p => heard.push(p?.username ?? null));
  check(acct.profile === null && acct.persistent === true, 'no profile before sign-up; the store keeps things');
  check(acct.ready instanceof Promise, 'ready is a Promise');
  const r0 = await acct.signUp('jo');
  check(!r0.ok && r0.error === 'At least 3 characters.' && acct.profile === null, 'a refused name: no profile, the reason in words');
  const r1 = await acct.signUp('velvet_owl');
  check(r1.ok && acct.profile?.username === 'velvet_owl' && heard.join() === 'velvet_owl', 'sign up: the profile, and listeners hear it');
  check(Object.isFrozen(acct.profile) && Object.isFrozen(acct.profile.avatar), 'the profile handed out is frozen (a copy: nobody changes it behind the account)');
  const saved = JSON.parse(store.load());
  check(saved.username === 'velvet_owl' && saved.version === 2, `saved in the store (key ${PROFILE_KEY})`);
  const avatarBefore = acct.profile.avatar;
  t += 60000;
  const r2 = await acct.rename('Velvet_Owl2');
  check(r2.ok && acct.profile.username === 'Velvet_Owl2' && acct.profile.nameChangedAt === new Date(t).toISOString() && acct.profile.createdAt !== acct.profile.nameChangedAt, 'rename: the new name, nameChangedAt recorded');
  check(JSON.stringify(acct.profile.avatar) === JSON.stringify(avatarBefore), 'a rename keeps the avatar');
  const r3 = await acct.rename('Fire_Exit');
  check(!r3.ok && /belongs to the hotel/.test(r3.error) && acct.profile.username === 'Velvet_Owl2', 'a refused rename changes nothing');
  const r4 = await acct.setAvatar({ v: 1, base: 'henry', skin: 'deep', hair: 'silver', eyes: 'green', glasses: 'monocle', frame: 'goldFrame', main: 'gatsby', accent: 'brass', metal: 'gold' });
  check(r4.ok && r4.avatar.face === 'henry' && r4.avatar.colours.skin === 'deep' && r4.avatar.glasses === originalAvatar('henry').glasses
    && r4.avatar.colours.frame === (ON ? 'goldFrame' : 'tortoise') && r4.avatar.colours.main === (ON ? 'gatsby' : originalAvatar('henry').colours.main),
    `setAvatar keeps free choices, never a pending one (the Monocle), and unlockable ones only ${ON ? 'while the testing switch is on' : 'when owned'} (gold frames, Gatsby gold)`);
  check(JSON.stringify(acct.profile.avatar) === JSON.stringify(r4.avatar), 'the profile wears what setAvatar returned');
  const free = ITEMS.filter(isFree).map(itemId), locked = ITEMS.filter(i => !isFree(i)).map(itemId);
  check(free.every(id => acct.owns(id)) && !locked.some(id => acct.owns(id)) && !acct.owns('glasses.nothing'), `owns (real ownership, whatever the testing switch): the ${free.length} free items, none of the ${locked.length} unlockable ones`);
  check(['hair.platinum', 'glasses.monocle', 'frame.goldFrame', 'main.champagne', 'main.gatsby', 'metal.roseGold'].every(id => locked.includes(id)), "today's six locked items are still unlockable ones");
  const g1 = await acct.grant('glasses.monocle'), g2 = await acct.grant('glasses.monocle'), g3 = await acct.grant('main.gatsby'), g4 = await acct.grant('hair.black');
  check(g1.ok && g1.added && g2.ok && !g2.added && !g3.ok && !g4.ok && JSON.stringify(acct.profile.inventory) === '["glasses.monocle"]' && acct.owns('glasses.monocle')
    && JSON.parse(store.load()).inventory.includes('glasses.monocle'), 'grant: an achievement item once (saved, owned); never a Boutique item or a free one');
  const n = heard.length;
  off();
  await acct.rename('someone_else');
  check(heard.length === n, 'after unsubscribe, a listener hears nothing more');
  // a new start of the page reads the same profile back
  const again = createAccount({ store });
  check(again.profile?.username === 'someone_else' && JSON.stringify(again.profile.avatar) === JSON.stringify(r4.avatar), 'kept across a new start (same store)');
  // a damaged save is repaired and written back
  const hurt = memoryStore(JSON.stringify({ ...saved, avatar: { base: 'nobody', skin: 42 } }));
  const fixed = createAccount({ store: hurt });
  check(fixed.profile?.username === 'velvet_owl' && fixed.profile.avatar.face === 'victor' && JSON.parse(hurt.load()).avatar.face === 'victor', 'a damaged save: the name kept, the avatar repaired and saved back');
  const lost = createAccount({ store: memoryStore('{"username":"7up"}') });
  check(lost.profile === null, 'a save with a bad name: no profile (the register asks again)');
  // a name allowed once and reserved since: the register asks for a new one, everything else is kept
  const since = memoryStore(JSON.stringify({ ...saved, username: 'Kitchen', avatar: originalAvatar('clara'), createdAt: '2026-01-02T00:00:00.000Z' }));
  const renamed = createAccount({ store: since });
  check(renamed.profile === null && renamed.nameLost, 'a saved name no longer allowed: no profile yet, the register says why (nameLost)');
  await renamed.signUp('kitchen_porter', { avatar: originalAvatar('victor') });
  check(renamed.profile?.username === 'kitchen_porter' && renamed.profile.id === saved.id && renamed.profile.avatar.face === 'clara'
    && renamed.profile.createdAt === '2026-01-02T00:00:00.000Z' && !renamed.nameLost, '...then the new name keeps the id, the avatar and the first date');
  // a profile saved by a newer version: read, never written over (its newer fields are not lost)
  const newer = JSON.stringify({ ...saved, version: 3, coins: 99, friends: ['a'] });
  const v2store = memoryStore(newer);
  const v2 = createAccount({ store: v2store });
  check(v2.readOnly && v2.profile?.username === saved.username && v2store.load() === newer, 'a newer version\'s profile is read (readOnly) and not written back');
  await v2.setAvatar(originalAvatar('henry')); await v2.rename('later_name');
  check(v2.profile.username === 'later_name' && v2store.load() === newer, '...changes last for the visit; the saved newer profile is untouched');
  const g5 = await v2.grant('glasses.monocle');
  check(!g5.ok && g5.added && v2.owns('glasses.monocle') && v2store.load() === newer,
    'grant on a read-only profile: worn for the visit, but ok: false (not saved), so main.js grants it again later');
  // a damaged save of any shape never stops the page
  for (const base of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    let ok = true, acct = null;
    try { acct = createAccount({ store: memoryStore(JSON.stringify({ ...saved, avatar: { base } })) }); } catch { ok = false; }
    check(ok && acct.profile?.avatar.face === 'victor', `a saved look called "${base}" is repaired, never a crash`);
  }
  const throwing = createAccount({ store: { load: () => { throw new Error('boom'); }, save: () => true, works: () => true, watch: () => () => {} } });
  check(throwing.profile === null, 'a store that throws when read: no profile, no crash');
  // a device that keeps nothing (private window, blocked or full storage)
  const none = createAccount({ store: memoryStore(null, { broken: true }) });
  check(none.persistent === false && none.profile === null, 'blocked storage: not persistent, no profile');
  const r5 = await none.signUp('nightowl_7');
  check(r5.ok && none.profile?.username === 'nightowl_7' && none.persistent === false, 'blocked storage: sign-up still works for this visit');
  check((await none.setAvatar(originalAvatar('clara'))).ok && none.profile.avatar.face === 'clara', 'blocked storage: the avatar changes for this visit too');
  // a store that fails on write later: persistent turns false
  let writes = 0;
  const flaky = { load: () => null, save: () => (++writes < 2), works: () => true, watch: () => () => {} };
  const fa = createAccount({ store: flaky });
  await fa.signUp('pebble_a');
  check(fa.persistent === true, 'a store that took the first write: persistent');
  await fa.rename('pebble_b');
  check(fa.persistent === false && fa.profile.username === 'pebble_b', 'a write that fails: persistent turns false, the change is kept for the visit');
  // sign up with a chosen first avatar
  const chosen = createAccount({ store: memoryStore() });
  await chosen.signUp('marigold_', { avatar: originalAvatar('beatrice') });
  check(chosen.profile.avatar.face === 'beatrice', 'sign-up may take a first avatar');
}

// --- 5. the first avatar ------------------------------------------------------------------------------
console.log('\nthe first avatar');
{
  check(JSON.stringify(startingAvatar('nora', 'p6')) === JSON.stringify(originalAvatar('clara')), 'last round\'s "Your guest" Clara (p6): her look in her colours');
  check(startingAvatar('nora', 'Henry').face === 'henry' && startingAvatar('nora', 'p1').face === 'victor', 'a guest by name or by roster id');
  const r = startingAvatar('nora', 'random');
  check(JSON.stringify(r) === JSON.stringify(normaliseAvatar(randomAvatar('nora', { unlockables: false, swapPieces: false }))) && JSON.stringify(startingAvatar('nora')) === JSON.stringify(r), "'random' (or nothing): rolled from the name, the same every time");
  const firsts = Array.from({ length: 300 }, (_, k) => startingAvatar(`newplayer${k}`));
  check(firsts.every(a => lookOf(a)) && new Set(firsts.map(lookOf)).size === 6,
    "a new player's first look keeps a classic Look's pieces (all six seen; colours and glasses rolled): the stand-in wardrobe offers only the six Looks, so no mix is lost on a tap");
  const any = startingAvatar('anyone', 'nonsense');
  check(any.v === 2 && JSON.stringify(normaliseAvatar(any)) === JSON.stringify(any) && unlockablesWorn(any) === 0, 'anything unknown: a rolled look, free items only');
}

// --- 6. the table -------------------------------------------------------------------------------------
console.log('\nthe table');
{
  const me = { username: 'nora', avatar: originalAvatar('marcus') };
  const bots = ['nightowl', 'pixelmoth', 'sam', 'kiwi', 'basil'];
  const looks = botAvatars(bots, { avoid: [me.avatar] });
  const seats = seatTable({ me, bots: bots.map((u, k) => ({ username: u, avatar: looks[k] })), seat: 3 });
  check(seats.length === 6 && seats.every((s, i) => s.id === `p${i + 1}` && s.color === SEAT_COLORS[i]), 'seat ids p1..p6 and colours by seat');
  check(seats[3].name === 'nora' && seats[3].avatar.face === 'marcus' && seats.filter((s, i) => i !== 3).map(s => s.name).join() === bots.join(), 'you in your seat, the bots in theirs');
  check(seats.every(s => s.outfit && typeof s.outfit === 'string'), 'every seat also names its outfit (for the views that still read one)');
  check(STAND_IN.username === 'Guest' && code('Guest') === 'reserved', "the stand-in 'Guest' is a name nobody can take");
  let clash = 0, unsafe = 0, mine = 0, unstable = 0, worn = 0, n = 0;
  for (let k = 0; k < 400; k++) {
    const rng = makeRng(1000 + k);
    const names = rollProfiles(5, rng).map(p => p.username);
    const you = normaliseAvatar(randomAvatar(`player${k}`));
    const av = botAvatars(names, { avoid: [you] });
    if (av.some((a, i) => av.some((b, j) => j > i && lookAlike(a, b)))) clash++;
    if (av.some(a => lookAlike(a, you))) mine++;
    if (av.some(a => JSON.stringify(normaliseAvatar(a, { trusted: true })) !== JSON.stringify(a) || a.v !== 2)) unsafe++;
    if (JSON.stringify(botAvatars(names, { avoid: [you] })) !== JSON.stringify(av)) unstable++;
    for (const a of av) { n++; worn += unlockablesWorn(a); }
  }
  check(clash === 0 && mine === 0, `400 tables of six: no two guests alike, never like you (${clash} / ${mine})`);
  check(unsafe === 0, "bots' avatars are already safe (v2, nothing to repair)");
  check(worn / n > 0.25 && worn / n < 0.42, `about one bot in three wears an unlockable item (${(worn / n).toFixed(2)} a bot)`);
  check(unstable === 0, 'the same names give the same looks (deterministic)');
  // bots never take your name
  let took = 0, drift = 0;
  for (let k = 0; k < 400; k++) {
    const you = USERNAMES[k % USERNAMES.length];
    const shout = k % 2 ? you.toUpperCase() : you;
    const a = makeRng(77 + k), b = makeRng(77 + k);
    const with_ = rollProfiles(5, a, { avoid: [shout] });
    rollProfiles(5, b);
    if (with_.some(p => sameName(p.username, you))) took++;
    if (a() !== b()) drift++;
  }
  check(took === 0, 'a bot never has your username (case ignored), even when yours is one of theirs');
  check(drift === 0, 'avoiding your name takes the same number of random draws (the match after it is unchanged)');
}

// --- 7. seeded tables keep their seats ----------------------------------------------------------------
console.log('\nseeded tables');
{
  let same = 0, total = 0;
  for (const seed of [1, 7, 31337, 4242, 123456, 99, 2026]) for (const n of [4, 5, 6]) for (const role of ['random', 'clean']) {
    total++;
    const make = () => makeRng((seed * 7919 + 13) >>> 0);
    // before: the six named guests shuffled (5 draws), the seat, the bots, the possessed seat
    const r1 = make();
    shuffle([...roster], r1).slice(0, n);
    const seat1 = Math.floor(r1() * n);
    const bots1 = rollProfiles(n - 1, r1).map(p => `${p.username}/${p.style}/${p.traits.boldness}`);
    const others1 = [...Array(n).keys()].filter(i => i !== seat1);
    const poss1 = role === 'clean' ? others1[Math.floor(r1() * others1.length)] : null;
    // now: 5 draws burnt, then the same
    const r2 = make();
    for (let k = 0; k < 5; k++) r2();
    const seat2 = Math.floor(r2() * n);
    const bots2 = rollProfiles(n - 1, r2, { avoid: ['tester'] }).map(p => `${p.username}/${p.style}/${p.traits.boldness}`);
    const others2 = [...Array(n).keys()].filter(i => i !== seat2);
    const poss2 = role === 'clean' ? others2[Math.floor(r2() * others2.length)] : null;
    if (seat1 === seat2 && bots1.join() === bots2.join() && poss1 === poss2) same++;
  }
  check(same === total, `the same seat, bots and possessed seat for every ?seed= tried (${same} of ${total})`);
}

// --- 8. the feed --------------------------------------------------------------------------------------
console.log('\nthe feed');
{
  const P = ['nora', 'Kitchen_boy', 'Linen', 'nora_b', 'pixelmoth'].map((name, index) => ({ name, index }));
  const line = (t, me) => feedLine(t, P, me);
  let r = line('pixelmoth searched Kitchen.', P[1]);
  check(r.text === 'pixelmoth searched Kitchen.' && r.kind?.icon === 'search' && !r.own && !r.mentionsMe, 'a guest named "Kitchen_boy" leaves "searched Kitchen." alone');
  r = line('nora searched Linen Store.', P[2]);
  check(r.text === 'nora searched Linen Store.' && !r.mentionsMe, 'a guest named "Linen" is never found inside "Linen Store"');
  r = line('Linen searched Linen Store.', P[2]);
  check(r.own && r.text === 'You searched Linen Store.', '…but is found as the one who searched (your own doing: left out)');
  r = line('nora_b and nora traded.', P[0]);
  check(r.text === 'nora_b and you traded.' && r.mentionsMe && r.kind?.icon === 'trade', '"nora" is not found inside "nora_b"; a line naming you says "you"');
  r = line('Kitchen_boy attacked nora with a Revolver — fatally.', P[0]);
  check(r.text === 'Kitchen_boy attacked you with a Revolver — fatally.' && r.kind?.icon === 'revolver' && r.kind.cls === 'attack fatal', 'an attack keeps its weapon icon');
  r = line('nora opened a door: Kitchen.', null);
  check(r.text === 'nora opened a door: Kitchen.' && r.kind?.icon === 'door' && !r.own, 'no viewer: the line as written');
  // every word of the public log is reserved (from real bot matches)
  const floor = createHotel(hotel, config);
  const phraseWords = new Set([hotel.lobby.name, ...hotel.tiles.map(t => t.name), ...Object.values(rules.cards).map(c => c.name)]
    .flatMap(n => n.toLowerCase().split(/[^a-z]+/)).filter(Boolean));
  const unreserved = new Map();
  let lines = 0;
  for (let k = 0; k < 40; k++) {
    const players = 4 + (k % 3);
    applyMode('match', players);
    const state = S.createState(floor, roster.slice(0, players), 5000 + k * 13, { mode: 'match' });
    const profiles = rollProfiles(players, makeRng(9000 + k));
    state.players.forEach((p, i) => { p.name = profiles[i].username; });
    const table = createBotTable(state, floor, profiles.map((profile, index) => ({ index, profile })), 5000 + k);
    for (let turns = 0; !state.finished && turns < 300; turns++) playBotTurn(state, floor, table, { maxSteps: 40 });
    const names = new Set(state.players.map(p => p.name));
    for (const l of state.log) {
      lines++;
      for (const word of l.text.split(/[^A-Za-z0-9_]+/).filter(x => x && !names.has(x))) {
        const wl = word.toLowerCase();
        if (!/^[a-z]/i.test(word) || word.length < USERNAME.min) continue;
        if (!words.has(wl) && !phraseWords.has(wl)) unreserved.set(wl, l.text);
      }
    }
  }
  check(unreserved.size === 0, `every word of ${lines} public log lines is reserved or part of a room or card name${unreserved.size ? ` — not: ${[...unreserved].slice(0, 6).map(([w, t]) => `"${w}" (${t})`).join(', ')}` : ''}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'all passed'} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
