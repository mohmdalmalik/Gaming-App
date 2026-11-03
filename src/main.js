// Entry point: builds the floor, sets up rendering, interface and the turn-based rules of
// Hotel Escape, and runs the game loop. The page opens on the main menu over the lobby
// (src/ui/menu.js, src/menu/lobbyScene.js). Two ways to play the same ruleset (docs/GAME_RULES.md):
// practice (one guest alone) and a match: the player and 3-5 computer guests (bots, src/bots/), one
// of them secretly possessed — the online game's table, with bots in the other seats. No server, no
// networking yet. Only ONE person ever looks at this screen, so their own private information (their
// hand, their role) may show on it; nobody else's ever does.
import * as THREE from 'three';
import { config as cfg } from './config.js';
import { rules, applyMode } from './data/rules.js';
import { hotel } from './data/hotel.js';
import { account } from './account/account.js';
import { checkUsername } from './account/username.js';
import { seatTable, botAvatars, STAND_IN } from './table.js';
import { searchSpotOf, roomAt, cellOf, fogCells } from './game/hotel.js';
import { buildGrid } from './game/grid.js';
// (only the rules' questions, asked of the screens' own state: whatever changes the game is the table's, src/net/)
import {
  activePlayer, nextPlayer, canEscape, openableDoors, playersInRoom,
  isBarricaded, canTradeVoluntarily, doorBetween, encountersIn, adjacentLockedRooms,
} from './game/state.js';
import { canSearch, overHandLimit, tradeableCards, canUseRoom } from './game/actions.js';
import { CARDS, lanternCount } from './game/cards.js';
import { createScene } from './render/scene.js';
import { addRoomView, clearRoomViews, createDoorwayViews } from './render/roomView.js';
import { dressRoom } from './render/roomDressing.js';
import { warmTile, releaseTileTextures } from './render/bakedRoom.js';
import { roomDressings } from './data/dressing.js';
import { updateCutaway } from './render/cutaway.js';
import { createMood } from './render/mood.js';
import { createCharacterView } from './render/characterView.js';
import { createSearchMarks } from './render/searchMarks.js';
import { createPathPreview } from './render/pathPreview.js';
import { createFog } from './render/fog.js';
import { createLampHalos } from './render/lampHalos.js';
import { easeOutCubic } from './render/materials.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createDiscovery } from './discovery.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';
import { createOverlays } from './overlays.js';
import { createCrashNet } from './ui/crash.js';
import { watchDialogs } from './ui/focus.js';
import { matchMarker } from './matchMarker.js';
import { LOST_MATCH } from './data/lostMatch.js';
import { createHand } from './ui/hand.js';
import { createLockChoice, lockWarning } from './ui/lockChoice.js';
import { createHandFan } from './ui/handFan.js';
import { createSearchSpot } from './ui/searchSpot.js';
import { createDiscard } from './ui/discard.js';
import { discardAllowance, discardedLine, atZero } from './ui/discardClock.js';
import { createHandoff } from './ui/handoff.js';
import { createMeeting } from './ui/meeting.js';
import { createTradeReveal } from './ui/tradeReveal.js';
import { roundLabel, finalRoundNote, isFinal } from './ui/roundLabel.js';
import { actionsWord } from './ui/actionsWord.js';
import { createPerfStats } from './ui/perfStats.js';
import { createGuestTags } from './ui/guestTags.js';
import { createGoTags } from './ui/goTags.js';
import { createScreenTags, interfaceRects } from './ui/screenTags.js';
import { standable } from './game/moves.js';
import { usePracticeWording, prepareSoulCards } from './ui/cards.js';
import { redEyedAllies, knownPossessedIds } from './ui/allies.js';
import { createMenu } from './ui/menu.js';
import { createCoopMatch } from './ui/coopMatch.js';
// (the screens' own state and hotel, written from what the table shows: src/net/, DESIGN §6.6-§6.7)
import { createFloorCopy, syncFloor } from './net/floorCopy.js';
import { isLocalHost } from './net/serverUrl.js';
import { createPresentQueue } from './net/presentQueue.js';
import { ONLINE, ONLINE_RULES } from './data/online.js';
import { applyView, blankState, idleView } from './net/viewAsState.js';
// (avatars: the wardrobe screen, the runtime portraits and the soul cards' faces from each seat's avatar)
import { createWardrobe } from './ui/wardrobe/wardrobe.js';
import { createHonoursPage } from './ui/honours.js';
import { setPortraitService } from './ui/portrait.js';
import { setSoulPortraits } from './ui/soulFace.js';
import { createAvatarPortraits } from './render/avatarPortrait.js';
import { preloadAvatars } from './render/avatar.js';
import { avatarKey, shippedPortraitFor } from './data/wardrobe.js';
import { record } from './record.js';
import { showEndRecord } from './ui/record.js';
// (achievements, checked on the end screen only; the "Clearer possessed eyes" setting for this screen's match)
import { matchSummary, isTestLink } from './matchSummary.js';
import { honours } from './honours.js';
import { ACHIEVEMENTS } from './data/achievements.js';
import { showEndHonours } from './ui/honoursEnd.js';
import { displayAvatar, normaliseAvatar, outfitOf } from './data/wardrobe.js';
// (Co-op: every word of the match's additions, src/data/onlineText.js)
import { ONLINE_TEXT, fill, byRules } from './data/onlineText.js';
import { createFeed } from './ui/feed.js';
import { createChatUI } from './ui/chat.js';
import { createTips } from './ui/tips.js';
import { createHowToPlay } from './ui/howToPlay.js';
import { createCardsGuide } from './ui/cardsGuide.js';
import { createGameMenu } from './ui/gameMenu.js';
import { endRecap } from './ui/endRecap.js';
import { END_WORDS } from './data/endScreen.js';
import { CHAT } from './data/chat.js';
import { settings } from './settings.js';
import { createAudio } from './audio/index.js';
import { createGameSounds } from './audio/gameSounds.js';
import { sfx } from './audio/bus.js';
import { makeRng, shuffle } from './game/cards.js';

// --- World (pure data + rules) ---------------------------------------------------------
// The hotel is random every match: it starts as the lobby and grows as doors are opened
// (src/game/hotel.js). The real hotel, and the room deck, are the table's (src/net/localTable.js); the page draws, walks
// and plans on its own copy (src/net/floorCopy.js), grown only from the rooms the table shows as placed. ONE object for
// the page's life: discovery, the map, the search marks, the doorways and the search spot keep it.
const floor = createFloorCopy(hotel, cfg);

// What the page opens on: the main menu. A direct link skips it, straight to a "Tap to begin" card for
// one kind of game (the tests use these):
//   ?mode=practice                       practice alone
//   ?mode=bots&bots=5&role=clean         a match against 5 computer guests (role: random | clean |
//                                        possessed); &seat=2 puts the player in that seat (testing)
//   &user=nora                           the name you play under for this visit (checked like a username,
//                                        never saved; without it, your profile's, or 'Guest' on a new
//                                        device). A direct link never shows the register.
//   ?seed=123                           force the deal, the hidden role and the hotel's room deck (testing)
//   ?timer=off                           play without the 45-second turn clock
//   ?intro=off                           no lift sequence between the menu and the game
//   ?botpace=0.1                         the computer guests think 10x faster (testing)
//   ?camera=square / classic             the previous square-on view / the older, higher one
//   ?stats=1                             a small frame-rate / draw-call readout, for measuring on the iPad
const params = new URLSearchParams(window.location.search);
if (params.get('camera') === 'square') Object.assign(cfg.camera, cfg.cameraSquare);     // the previous square-on view
if (params.get('camera') === 'classic') Object.assign(cfg.camera, cfg.cameraClassic);   // the old, higher view
if (params.get('camera') === 'diagonal') Object.assign(cfg.camera, cfg.cameraDiagonal); // (the standard view; old links)
// (?mode=hotseat&players=6, the old pass-one-iPad mode, is gone: old links open a match against bots
// with the same number of guests, the player in the first seat.)
if (params.get('mode') === 'hotseat') {
  params.set('mode', 'bots');
  if (!params.has('bots')) params.set('bots', String(Math.max(rules.minBots, Math.min(rules.maxBots, (parseInt(params.get('players'), 10) || rules.maxPlayers) - 1))));
  if (!params.has('seat')) params.set('seat', '0');
}
const DIRECT = ['practice', 'bots'].includes(params.get('mode')) ? params.get('mode') : null;
// Who the player is at the table (src/account/account.js): their profile's name and avatar; a direct link
// may name them for its own game (?user=, checked, not saved; forgotten once the menu opens, where the
// profile card shows who plays); a device with no profile plays as 'Guest'.
let linkUser = (() => { const r = DIRECT && params.has('user') ? checkUsername(params.get('user')) : null; return r?.ok ? r.name : null; })();
function myIdentity() {
  const p = account.profile;
  return { username: linkUser || p?.username || STAND_IN.username, avatar: p?.avatar || STAND_IN.avatar };
}
const TIMER_OFF = params.get('timer') === 'off';
const INTRO = params.get('intro') !== 'off';
const BOT_PACE = Math.max(0, parseFloat(params.get('botpace'))) || 1;
const forcedSeed = parseInt(params.get('seed'), 10);
const TEST_LINK = isTestLink(params);     // (a link that forces the match earns no achievement: src/matchSummary.js)
const newSeed = () => (Number.isFinite(forcedSeed) && forcedSeed > 0 ? forcedSeed
  : PRACTICE && rules.practiceSeed != null ? rules.practiceSeed
    : (Date.now() & 0x7fffffff) || 1);

// The game being played (or about to be). setupGame() changes it before each new game.
let PRACTICE = true;          // practice alone, or a match against bots
let humanSeat = 0;            // the player's own seat (a match: random, like joining an online table)
// The table this game is played at (src/net/localTable.js): it deals the game and holds it, with the computer guests'
// brains (src/bots/index.js) and their chatter (src/bots/chatter.js); its referee (src/net/referee.js) runs every game,
// Practice and matches alike: the turns, the clock, the computer guests' steps, the meetings and trades. The page only
// presents what the table shows this seat (table.view, table.on), asks the player its questions and sends their answers
// and acknowledgements (table.local.apply). The real game never comes into the page: only the test hooks reach it
// (window.__game, tests/seam-check.mjs).
let table = null;             // the table being played (none behind the menu: nobody thinks or talks there)
let lastTable = null;         // the table last set up (behind the menu, the test hooks still hand out its game)
// Co-op (an online table, src/net/onlineTable.js; the section "Co-op" below): commands waiting for their outcome (the
// player's taps wait meanwhile), whether the player asked to end the turn on screen (else the table's clock ended it),
// the role screen at the start read (netBegun) and turn 1 still waiting for the others' (netStarting), the role question
// last shown, the results whose screens are up or were read.
let netBusy = 0, endAsked = false, netBegun = true, netStarting = false, roleShownFor = null;
const netShown = new Set();
// The table's latest view, written into the screens' state and their copy of the hotel (DESIGN §6.6, §6.7).
function present(view, events, { newMatch = null, fresh = false } = {}) {
  applyView(state, view, events, { newMatch, fresh });
  syncFloor(floor, view.hotel, { newMatch: newMatch === true });
}
// The table told the page that something changed (table.on): the screens' state follows at once. What the page shows of
// it (a computer guest's walk or door, a meeting, the turn passing) waits for follow(), once the table's call is over.
function onTableChange(t, { view, events, fresh, local = [] }) {
  if (t.kind === 'online' && t !== table) return;      // (Co-op: a table not on screen, the review link's other seat)
  const newMatch = presented !== t;
  presented = t;
  // (an attack's screen shows the hearts its target lost: their health as it was just before)
  if (!newMatch) for (const e of events) if (e.type === 'attack') healthBefore.set(e.o, state.players[e.target]?.health);
  present(view, t.kind === 'online' ? t.received : events, { newMatch, fresh });
  if (t.kind === 'online') { coopUI.update(view, { status: t.net?.status }); netQueue.push(fresh); netTableNews(events); }
  for (const ev of local) { if (ev.type === 'attackSeen') attackSeen = ev; else localNews.push(ev); }
  tableNews = true;
}
// What the page has caught up with (follow): the table changed since (tableNews), the figures' news (a computer guest's
// walk, a walk cut short by the clock), the last public event shown (seenO: its number in this seat's events), the turn on
// screen (shown: turnNow()), the hearts before each attack and what the last attack the player was in showed.
let tableNews = false, localNews = [], seenO = 0, shown = null, attackSeen = null;
const healthBefore = new Map();
// The table builds its view again from its real game, and the screens follow (behind the menu: the last table's; before
// the first table, the hotel behind the menu never changes).
function syncTable() { (table ?? lastTable)?.local?.sync(); }
// The screens never read anything stale: after a test hook handed out the real game (window.__game.state, .floor,
// .activePlayer ...), everything that reads (refresh, discovery, any hook) catches up first, for the rest of that
// frame: the real objects handed out may be changed at any moment until then. The next frame catches up once more and
// lets go (pullFrame).
function pull() { if (dirty) syncTable(); }
function pullFrame() { if (dirty) { syncTable(); dirty = false; } }
// The player's command to the table (DESIGN §6.3; its referee, src/net/referee.js, runs every game): synchronous, the
// screens' state is current when it returns.
const act = cmd => (!table ? { ok: false, reason: 'notNow' } : online() ? netAct(cmd) : table.local.apply(cmd));
// (Co-op: the table is the server's, and a command's outcome comes back a moment later. after(r, fn) runs fn with the
// outcome: at once in Single player, whose table answers synchronously; at a Co-op table once the view after its reply
// is in, and only while the same table is still on screen (the review link's seat switch may have changed it).)
function after(r, fn) {
  if (!r || typeof r.then !== 'function') return fn(r);
  const t = table;
  r.then(v => { if (table === t) fn(v); }, err => console.warn('a Co-op command failed:', err));
  return undefined;
}
// An acknowledgement whose outcome nobody waits for.
const tell = cmd => { if (!table) return; if (online()) table.send(cmd); else table.local.apply(cmd); };
// A Co-op table (src/net/onlineTable.js), not this device's own.
const online = () => table?.kind === 'online';
// The table's private results for the player (found cards, a Hand Mirror): the ones there now, and the newest of a kind
// that was not; a result is acknowledged once its screen closes (DESIGN §6.4).
const resultIds = () => new Set((state.results || []).map(r => r.id));
const newResult = (kind, had) => (state.results || []).filter(r => r.kind === kind && !had.has(r.id)).pop() || null;
const newestResult = kind => (state.results || []).filter(r => r.kind === kind).pop() || null;
const ackResult = id => { if (id != null && table) { if (online()) netSeen(id); tell({ k: 'ack', what: 'result', id }); } };
let botProfiles = [];         // per seat: the bot's profile (username, style), or null for the player
const cast = seatTable({ me: myIdentity(), seat: 0 });   // the seats at the table, in seat order (src/table.js; filled in place by setupGame)
applyMode('practice', 1);
if (TIMER_OFF) rules.turnTimerEnabled = false;
let seed = newSeed();
// What the screens read (src/net/viewAsState.js): ONE object for the page's life, shaped like the rules' state but
// written only by applyView, from what the table shows this seat (src/net/playerView.js): never another guest's hand,
// role or notes, the piles or the room deck. gameSounds, the feed and the allies' memo keep it, its guests, its events.
const state = blankState();
let presented = null;        // the table the screens show (a new one is a new match on screen)
let dirty = false;           // a test hook handed out the real game: the screens catch up before they read again (pull)
// Before the first table: the hotel behind the menu, a practice deal nobody plays (src/net/viewAsState.js idleView: only
// its view comes here).
{ const idle = idleView({ roster: cast, seat: humanSeat, seed, hotelData: hotel, cfg }); present(idle.view, idle.events, { newMatch: true }); }
const grid = buildGrid(floor, cfg);
if (floor.problems.length) throw new Error(`Problems in the hotel:\n• ${floor.problems.join('\n• ')}`);
// The walkable grid follows the hotel as it grows (rebuilt in place: everyone keeps the same object).
function rebuildGrid() {
  Object.assign(grid, buildGrid(floor, cfg));
  if (floor.problems.length) console.warn('hotel problems:', floor.problems.join('; '));
}
const startSpot = i => floor.start.positions[i % floor.start.positions.length];
const movers = cast.map((_, i) => createPlayer(cfg, startSpot(i)));   // one per seat (rebuilt in place)
// The player's own guest, and whether it is their turn. In practice they are the only guest.
const me = () => state.players[humanSeat];
const isBot = i => !!table && !!botProfiles[i];
const myTurn = () => !state.finished && state.activeIndex === humanSeat;

// --- Rendering -------------------------------------------------------------------------
const container = document.getElementById('view');
const view = createScene(container, cfg);
// Every seat's portraits (the strip, the panel, the meeting, the trades, the profile card) are drawn from
// their avatar with this renderer (src/render/avatarPortrait.js; never a second WebGL context), one per
// frame, kept by look; the look's shipped picture shows until then. The soul cards' faces are the owners'
// possessed portraits, found by seat id among this table's seats. From the menu they wait (paused) until
// its lobby is up and the player's own portraits' shaders are built (warmPortraits), so neither a model
// download nor a shader build comes before the lobby; a game set up before that starts them (planGame).
const portraits = createAvatarPortraits(view.renderer, { paused: !DIRECT });
setPortraitService(portraits);
const seatAvatar = id => (cast.find(s => s.id === id) || state?.players?.find(p => p.id === id))?.avatar || null;
setSoulPortraits({
  key: id => { const av = seatAvatar(id); return av ? avatarKey(av) : null; },
  url: id => { const av = seatAvatar(id); return av ? portraits.url(av, { possessed: true }).then(u => u || shippedPortraitFor(av, true)) : null; },
});
const roomViews = new Map();          // roomId -> view, added as rooms are revealed
// Rooms with real art (the lobby) are dressed as their views appear. The greybox shows until the
// files have loaded; if a piece fails, the room keeps its greybox. The tests wait on this before
// leaving a page (leaving mid-download cancels a fetch).
let dressingDone = true;
const dressing = new Set();
function trackDressing(promise) {
  dressing.add(promise); dressingDone = false;
  promise.catch(err => console.warn('room dressing failed:', err && err.message))
    .finally(() => { dressing.delete(promise); if (!dressing.size) dressingDone = true; });
}
const doorways = createDoorwayViews(floor, cfg, view.scene, {
  isLocked: id => !!state?.lockedRooms?.has(id),
  // a locked door stands open for the active guest while they are inside that room (the way out)
  standingIn: () => (state && !state.finished ? activePlayer(state)?.currentRoom : null),
  // a locked door a key has opened until the end of this turn (an open padlock hangs in front of it)
  openedNow: id => !!state?.openLocks?.has(id),
  // a doorway sealed by a Barricade (boards across it, seen by every guest)
  isBarricaded: id => !!state?.barricades?.has(id),
  camera: view.camera,      // the barricade sign hangs out on the side facing the camera
});
// One view per seat, built from the seat's avatar (src/render/characterView.js: each look's model is
// parsed once, src/render/avatar.js, and every guest in it is a clone with its own colours). A view whose
// look comes back at the next table (your own, Play again) is reused with its new seat; the views not at
// the table are let go, so memory stays the same however many tables are played. `characters` holds
// this game's, in seat order.
let characterViews = [];        // [{ key, cv }]
const characters = [];
const viewKey = def => (def.avatar ? `a:${avatarKey(def.avatar)}` : `o:${def.outfit}`);
function castCharacters() {
  const old = characterViews;
  characterViews = [];
  characters.length = 0;
  for (const def of cast) {
    const key = viewKey(def);
    const i = old.findIndex(v => v.key === key);
    const cv = i >= 0 ? old.splice(i, 1)[0].cv : createCharacterView(def, cfg, view.scene);
    if (i >= 0) cv.setDef(def);
    characterViews.push({ key, cv });
    cv.group.visible = true;
    cv.setDead(false);
    cv.setPossessed(false);   // (views are reused: no red eyes left over from the last game)
    characters.push(cv);
  }
  for (const v of old) v.cv.dispose();   // (not at this table)
}
// The hotel behind the main menu is not seen once the menu's own lobby scene is up, so its starting
// room's model and the game's guest are loaded only after that scene has loaded (or failed to: then
// the menu shows over the hotel), or when a game is set up — they no longer hold the menu's picture up.
// A direct link (?mode=) needs them at once.
let holdHotel = !DIRECT;
function releaseHotel() {
  if (!holdHotel) return;
  holdHotel = false;
  castCharacters();
  for (const v of roomViews.values()) trackDressing(dressRoom(v, floor, cfg).then(done => { if (done) view.compile(); }));
  syncViews(false);
}
if (!holdHotel) castCharacters();
const searchMarks = createSearchMarks(floor, view.scene);
const confirmBarEl = document.getElementById('confirm-bar');
const pathPreview = createPathPreview(view.scene, view.camera, view.renderer.domElement, container,
  () => (confirmBarEl.hidden ? null : confirmBarEl.getBoundingClientRect()));
const fog = createFog(view.scene, view.camera, cfg);        // the fogged rooms beyond closed doors
const screenTags = createScreenTags(document, container, view.camera);   // the tags over the view, under the HUD
const guestTags = createGuestTags(cfg);                     // names, zoomed far out (one tag per room)
const goTags = createGoTags();                              // "Go · 1 AP" over the rooms next door
const perfStats = createPerfStats(document, view.renderer, params.get('stats') === '1');
const mood = createMood(roomViews, view.hemi, cfg, view.scene);
const halos = createLampHalos(view.scene);                  // the glow round every lamp and sconce (one draw call)
const rig = createCameraRig(view.camera, cfg);
// What the camera follows (focusIndex): the active guest — on another guest's turn too, unless the
// player chose "Stay on me" in Settings — while they walk; once they stand still, at most FOLLOW_SLACK m
// (at the default zoom; more when zoomed in) from the centre of their room. (Guests stand in the middle
// of their room — off it only when others stand there too — and the whole room is in view at the
// default zoom anyway.)
const FOLLOW_SLACK = 1.2;
function focusIndex() {
  if (PRACTICE || myTurn() || state.finished || !me()?.alive || settings.get('follow') !== 'stay') return state.activeIndex;
  return humanSeat;
}
function followPoint() {
  const i = focusIndex();
  const m = movers[i];
  const room = floor.rooms.get(state.players[i].currentRoom);
  if (!room || m.walking || m.path.length) return [m.x, m.z];
  const [cx, cz] = room.center;
  const dx = m.x - cx, dz = m.z - cz, d = Math.hypot(dx, dz);
  const zoom = cfg.camera.distance / rig.distance;
  const slack = FOLLOW_SLACK * zoom * zoom;
  return d <= slack ? [m.x, m.z] : [cx + dx * slack / d, cz + dz * slack / d];
}

// --- Interface -------------------------------------------------------------------------
const hud = createHud(document, cfg);
const map = createMap(document, floor, cfg);
const overlays = createOverlays(document);
// Co-op's additions to the match (src/ui/coopMatch.js): Away on the strip, the stall banner, the reconnect pill, the
// cards that end or interrupt a Co-op match, the end screen's words. Nothing of it shows in Single player.
const coopUI = createCoopMatch(document, { text: ONLINE_TEXT, sfx });
watchDialogs(document);      // the screens over the game take the keyboard focus and keep it (src/ui/focus.js)
// How to play (src/ui/howToPlay.js: five pages, from the main menu and from the Menu) and the in-match Menu
// panel (src/ui/gameMenu.js). The panel holds the game still exactly as a question does (the clock, the computer
// guests, the hand and the buttons): everywhere main.js asks "is a question up?" it asks askUp().
// The Cards screen (src/ui/cardsGuide.js: what every card does, read-only) opens from the main menu, from the Menu and
// from the last How to play page, above all three; it holds nothing still and changes nothing.
const cardsGuide = createCardsGuide(document);
const howTo = createHowToPlay(document, { cards: cardsGuide });
const gameMenu = createGameMenu(document, {
  settings, howTo, cards: cardsGuide, practice: () => PRACTICE,
  onSettingChanged: name => applySettings(name),       // (Music and Sound effects, as in Settings)
  onLeave: () => askLeave(),
});
const askUp = () => overlays.askOpen || gameMenu.isOpen;
// The safety net (src/ui/crash.js): every step of a frame runs through crash.step, so one failing step never
// stops the picture; after a step has failed frame after frame (or the page keeps throwing the same error)
// the "Something went wrong" card shows, with Back to menu and Reload and the last message in small print.
let graphicsCard = false;     // (the card on screen is the lost-graphics one: it goes if they come back)
const crash = createCrashNet({
  onGiveUp: ({ detail }) => overlays.showError('Go back to the menu, or reload the game.', { title: 'Something went wrong', detail, menu: true }),
});
crash.install(window);
overlays.onErrorMenu(() => {
  overlays.hideError(); crash.reset(); graphicsCard = false;
  backToMenu().catch(err => { console.error(err); overlays.showError('The menu could not open. Reload the game.', { title: 'Something went wrong', detail: crash.detail() }); });
});
// (graphics lost and back, e.g. iPad Safari short of memory: three.js and the portraits recover by themselves;
// the card's small print says it happened. Lost and NOT back after GRAPHICS_LOST_MS of the player looking at
// the page: the picture is a still image with a live interface on top of it, so the card comes up. Time with
// the page hidden does not count: a loss in the background is normal and Safari restores it on return.)
const GRAPHICS_LOST_MS = 5000;
let graphicsWatch = 0;
view.renderer.domElement.addEventListener('webglcontextlost', () => {
  crash.note('graphics', 'The graphics context was lost.');
  clearInterval(graphicsWatch);
  let seen = 0, last = performance.now();
  graphicsWatch = setInterval(() => {
    const t = performance.now();
    if (document.visibilityState === 'visible') seen += Math.min(t - last, 1000);
    last = t;
    if (seen < GRAPHICS_LOST_MS) return;
    clearInterval(graphicsWatch);
    graphicsCard = !crash.shown;
    crash.stuck('graphics', 'The graphics context was lost and did not come back.');
  }, 500);
});
view.renderer.domElement.addEventListener('webglcontextrestored', () => {
  clearInterval(graphicsWatch);
  crash.note('graphics', 'The graphics context came back.');
  if (graphicsCard) { graphicsCard = false; overlays.hideError(); crash.reset(); }   // (it came back after all: the card is not needed)
});
const hand = createHand(document, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror });
// The padlock of a locked door next to the guest, tapped: which key or pick to open it with (onLockTap, onUnlock).
const lockChoice = createLockChoice(document, { onChoose: (cardId, roomId) => onUnlock(cardId, roomId) });
const discard = createDiscard(document, cfg, {
  onDiscard: cardId => after(act({ k: 'discard', card: cardId }), r => { if (!r.ok) hud.toast('That card cannot be discarded.'); refresh(); }),
});
// The hand, held as a fan of face-up cards; tapping one opens it large in the card view.
const fan = createHandFan(document, { onOpen: cardId => { if (running && !uiBusy()) hand.open(state, floor, cardId); } });
const feed = createFeed(document);     // what the other guests just did (a match)
// Quick chat (a match, Settings > Quick chat On) is the table's (src/net/localTable.js table.say, table.onChat; a message
// is { seat, id, at }, + `about` for a line that names a guest: src/social/chat.js). Every line said there reaches every
// bot: their chatter (src/bots/chatter.js: a bot it names may answer) and their minds (src/bots/brain.js: they weigh what
// they hear); the bots talk there too (syncChat). The Chat button, panel, bubbles and feed lines (src/ui/chat.js) use it
// through this one road, whichever table is set up. With Quick chat Off the table is silent: the bots neither talk nor
// listen.
const chatHeard = new Set();
const chatRoad = {
  onMessage(fn) { chatHeard.add(fn); return () => chatHeard.delete(fn); },
  waitFor: () => (!table ? 0 : online() ? table.chatWait() : table.local.chatWait()),
  say: (seat, id, about = null) => (!table ? null : online() ? table.sayNow(id, about) : table.local.say(id, about)),
  post: msg => (table && !online() ? table.local.post(msg) : null),
  reset() { /* a new table starts with nobody cooling down */ },
};
// (what a table says reaches the chat screen while it is the table being played)
const hearChat = t => msg => { if (t === table) for (const fn of [...chatHeard]) fn(msg); };
const chat = createChatUI(document, {
  channel: chatRoad, feed, sfx, mySeat: () => humanSeat,
  nameOf: i => state.players[i]?.name ?? 'A guest', colorOf: i => state.players[i]?.color ?? '#c9a24e',
  // the guests a line may name: the others still in the hotel, in seat order (red eyes as in the strip)
  guests: () => {
    const red = redEyedAllies(state, me());
    return state.players.filter(p => p.index !== humanSeat && p.alive && !state.escaped?.has(p.id))
      .map(p => ({ seat: p.index, player: p, red: red.has(p.id) }));
  },
});
let chatPollAt = 0;
const topLeftEl = document.querySelector('.hud-top-left');
// (the notes the player has read on their own screen: the table takes them off its waiting list, all of them or only
// `lines`: { k: 'ack', what: 'notes' } (DESIGN §6.3); never off the screens' copy)
const notesRead = (p, lines = null) => {
  if (!table || p?.index !== humanSeat) return;
  tell(lines ? { k: 'ack', what: 'notes', lines: [...lines] } : { k: 'ack', what: 'notes' });
};
// (the role screen has been read: the start of a match, a role that changed)
const roleRead = () => { if (!table) return; if (online()) roleShownFor = state.ask?.kind === 'role' ? state.ask.id : roleShownFor; tell({ k: 'ack', what: 'role' }); };
const handoff = createHandoff(document, { onNotesRead: p => notesRead(p) });
// (`known`: the face-off's crimson ring, only on a guest the player certainly knows is possessed: the strip's own marker)
const meeting = createMeeting(document, cfg, { isViewer: p => !PRACTICE && p.index === humanSeat, redEyes: p => redEyedAllies(state, me()).has(p.id),
  known: p => knownPossessedIds(state, me()).has(p.id) });
const tradeReveal = createTradeReveal(document, { handoff, onNotesRead: (p, lines) => notesRead(p, lines) });   // the player's own trade, as cards
// First-match tips (src/ui/tips.js; the words: src/data/tips.js): a small card near the thing it explains,
// the first time it comes up. What they may go by is only the player's own situation and what the whole
// table sees, never anything hidden from them; they never stop the clock or take a tap meant for the game,
// and wait while anything private or a notice covers the game.
const tips = createTips(document, {
  settings, camera: view.camera, tagBoxes: () => screenTags.list(),
  situation: () => ({
    on: running && phase === 'game' && !state.finished, game: gameToken, practice: PRACTICE, me: me(),
    self: me()?.alive && !state.escaped?.has(me().id) ? movers[humanSeat] : null,   // (where the player's own guest stands)
    // (public: the round, the rooms on the board, the job of the room the player stands in)
    round: state.round, final: isFinal(state), rooms: floor.roomList.length, exitFound: floor.roomList.some(r => r.isExit),
    job: floor.rooms.get(me()?.currentRoom)?.job ?? null,
    safe: !!floor.rooms.get(me()?.currentRoom)?.safe,                  // (the player's own room is a safe zone: the badge says so to everyone)
    cameraTouched: camTouchedIn === gameToken, cameraButton: camButtonIn === gameToken,   // (the player's own use of the camera in this game)
    myTurn: myTurn(), acting: actionPhaseClear() && !hand.isOpen && !pendingArrival && !activeMover().walking && !activeMover().path.length,
    clock: rules.turnTimerEnabled && timerLeft > 0 ? timerLeft : null, moveBar: hud.confirmKind === 'move', search: searchSpot.kind === 'search' ? searchSpot.mode : null,
    meeting: meeting.isOpen, heard: PRACTICE ? 0 : chat.recent().reduce((t, m) => (m.seat !== humanSeat ? Math.max(t, m.at) : t), 0),   // (when another guest last spoke)
    covered: handoff.isOpen || tradeReveal.isOpen || hand.isOpen || discard.isOpen || map.isOpen || chat.isOpen
      || overlays.endOpen || overlays.noticeOpen || askUp() || !fadeEl.hidden || !!sideways?.matches,
    mapOpen: map.isOpen, chatOpen: chat.isOpen, cardOpen: hand.isOpen,   // (the player's own screens: a tip they obeyed is seen)
  }),
});

let running = false;
let pendingArrival = null;   // enterRoom result waiting for the walk to finish
let selectedMove = null;     // a move to a room awaiting confirmation
let activeWalk = null;       // the confirmed walk under way (its plan), until the guest arrives
let walkCutShort = false;    // the clock ran out during this walk: it was cut short at the next room

const uiBusy = () => map.isOpen || hand.isOpen || discard.isOpen || lockChoice.isOpen
  || overlays.endOpen || overlays.noticeOpen || askUp() || handoff.isOpen || meeting.isOpen || netBusy > 0 || coopUI.cardOpen;

const discovery = createDiscovery({
  floor, grid, state, movers, cfg,
  // (crossing into a room is the table's to settle: the real game, then the screens' state at once)
  // (Co-op: the server has settled the whole walk already, DESIGN §4.5: a crossing settles nothing)
  enter: (p, roomId) => (!table ? { ok: false, reason: 'notNow' } : online() ? null : table.local.step(roomId)),
  before: () => pull(),
  on: {
    roomEntered(result) {
      // (a walk through several rooms already ends in the first room where a meeting is forced:
      // planRoomMove in src/game/moves.js)
      pendingArrival = result;
      syncViews(true);
      hud.update(state, floor);
    },
  },
});

// The room action icon (src/ui/searchSpot.js): the magnifier over the room's search spot (the furniture flagged
// `search: true`), the door-with-an-arrow in the Fire Exit, the cross in an Infirmary, the headset in the Switchboard
// (the last two stand on the same flagged furniture: those rooms are not searched). A tap does what its kind says (a new
// kind adds a line here).
const searchSpot = createSearchSpot(document, { camera: view.camera, container, floor, state, onTap: { search: onSearchSpot, exit: onEscape, heal: onRoom, switchboard: onRoom } });

// The room action icon is part of the player's own action phase only: never on another guest's turn, a
// private screen, a meeting, a notice or the end screen (CSS also hides it the moment any of those is
// up). The hand fan is the player's own hand: it shows on other guests' turns too (to look at — using a
// card needs their own turn), but never under a private screen, a meeting, a notice or the end screen.
// Cheap enough to run every frame; each only touches the page when something changed.
function screenClear() {
  return running && !state.finished && !handoff.isOpen && !meeting.isOpen && !overlays.endOpen
    && !overlays.noticeOpen && !askUp() && !map.isOpen && !discard.isOpen;
}
function actionPhaseClear() { return screenClear() && myTurn() && inActionPhase; }
function syncHandFan() {
  fan.update(me(), screenClear() && me().alive, { withPossession: true });
  if (running) hud.syncTell(state);   // (not behind the menu: backToMenu's hud.hide() put the tell away)
  hud.syncEndTurn(state);
}
function syncSearchSpot() {
  const m = activeMover();   // (on the player's own turn, the only time the icon is up, this is their own guest)
  searchSpot.update(me(), actionPhaseClear() && !hand.isOpen && !pendingArrival, m.walking || m.path.length > 0);
}
// Quick chat: the Chat button only while nothing covers the game (other guests' turns and watching after
// death included); the end screen has its own "Good game!". The computer guests' chatter is asked a few
// times a second; while a screen covers the game it keeps its lines for when the screen clears.
function syncChat(now) {
  const clear = screenClear() && !hand.isOpen;
  const ended = running && !PRACTICE && overlays.endOpen;
  chat.update({ clear, ended });
  if (!table?.local?.chats || !running || now < chatPollAt) return;
  chatPollAt = now + CHAT.pollMs;
  table.local.chatTick(now, { hold: !clear && !ended });
}
// The point a guest's speech bubble stands on: over their head (lower over a body); none once escaped.
function chatPoint(i) {
  const p = state.players[i], m = movers[i];
  if (!p || !m || state.escaped?.has(p.id)) return null;
  return [m.x, p.alive ? 2.05 : 0.75, m.z];
}

// --- Render sync -------------------------------------------------------------------------
// A room just opened and still waiting for its model (src/render/roomView.js hold): by id (no Go tag over it yet),
// and by a point in it (its mist stays: src/render/fog.js).
const heldRoom = id => !!roomViews.get(id)?.held;
function heldAt(x, z) {
  for (const v of roomViews.values()) {
    if (v.held && x >= v.room.min[0] && x <= v.room.max[0] && z >= v.room.min[1] && z <= v.room.max[1]) return true;
  }
  return false;
}
// ...and a point where a room's mist still shows: held, or still rising (its mist fades as it rises). The active
// guest standing there is drawn the plain way, under the mist (src/render/characterView.js setMisted).
function mistAt(x, z) {
  for (const v of roomViews.values()) {
    if ((v.held || v.revealT < 1) && x >= v.room.min[0] && x <= v.room.max[0] && z >= v.room.min[1] && z <= v.room.max[1]) return true;
  }
  return false;
}
function syncViews(animate) {
  pull();
  // A view for every room the hotel has grown (dressed if it has dressing), and for every door.
  for (const room of floor.roomList) {
    if (roomViews.has(room.id)) continue;
    const v = addRoomView(roomViews, room, cfg, view.scene, { animate });
    if (holdHotel) continue;
    const dressed = dressRoom(v, floor, cfg).then(done => { if (done) view.compile(); });
    // A room just opened waits under its mist until its model is in (at most 3 s: on a very slow network the
    // stand-in rises after that), so no beige stand-in walls rise and pop into the real room (src/render/roomView.js
    // hold). A model already loaded this visit is in at once: no wait. Only the picture waits, never the turn.
    if (animate) { v.hold(3000); dressed.then(() => v.release(), () => v.release()); }
    trackDressing(dressed);
  }
  doorways.sync();
  // The camera may zoom out until every revealed room is in view, and pan over all of them.
  rig.setRooms(floor.roomList.map(r => [r.min[0], r.min[1], r.max[0], r.max[1]]));
  searchMarks.update(state);
  characters.forEach((cv, i) => {
    cv.group.visible = !state.escaped?.has(state.players[i].id);
    cv.setDead(!state.players[i].alive);
    cv.setActive(i === state.activeIndex && !state.finished);
  });
}

// A soft glow at the closed doors of the player's room they can open this turn (the fog beyond each one
// is brighter too: src/render/fog.js). On another guest's turn, none.
function refreshUsable() {
  const p = me();
  const usable = new Set(state.finished || !myTurn() ? [] : openableDoors(state, floor, p).map(d => d.id));
  for (const dv of doorways.views.values()) dv.setUsable(usable.has(dv.doorway.id), p.currentRoom);
  // The padlock of a locked door next to the guest is drawn larger while they hold a key or a pick and an action to use it.
  const canKey = !state.finished && myTurn() && p.actionPoints >= rules.actionCost.useCard && p.hand.some(c => CARDS[c.type]?.unlock);
  doorways.setKeyable(canKey ? adjacentLockedRooms(state, floor, p) : []);
}

function refresh() { pull(); hud.update(state, floor); refreshUsable(); hand.refresh(); searchMarks.update(state); discovery.refresh(); syncHandFan(); syncSearchSpot(); }

function activeMover() { return movers[state.activeIndex]; }

// Card names in sentences: "a Lantern", "an Espresso"; "a Lantern and a Knife".
function aCard(type) { const name = CARDS[type]?.name ?? type; return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`; }
function andList(items) { return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

// --- Turn flow ---------------------------------------------------------------------------
// Practice: the one guest's turns follow each other. A match: everyone's turns in seat order. On the
// player's turn they act (tapping rooms, cards, buttons); on a computer guest's turn the bot plays
// (the table: src/net/referee.js): it decides, the rules carry each action out exactly like the player's,
// and the page shows it with the same walks and the same public words a person's action would have (follow).
let timerLeft = 0;
let inActionPhase = true;    // the player may act now (their turn has started and nothing private is up)

function begin() {
  overlays.hideStart();
  hud.show();
  running = true;
  phase = 'game';
  refresh();
  if (PRACTICE) return;
  // A match: the player reads their secret role first, then the first turn begins (the table waits for it: its referee
  // starts turn 1 when the role screen is acknowledged).
  inActionPhase = false;
  if (online()) { netBegin(); return; }
  handoff.revealRole(me(), {}, () => { roleRead(); shown = turnNow(); beginTurn(); });
  if (!DIRECT) matchMarker.set();      // (a real match, not a direct test link: if the browser cuts it short, the next start says so)
}

// At the start of the main menu: a match that was cut short (src/matchMarker.js: the marker was still there) is counted
// once as left early and said so, once, on the game's notice card. A direct link never gets here.
function noteLostMatch() {
  if (DIRECT || !matchMarker.take()) return;
  record.countLeft();
  overlays.showNotice(LOST_MATCH.title, LOST_MATCH.body);
}

// A new turn: the player's own, or a computer guest's.
let lockNews = '';
// (`resume`, Co-op only: the turn is already under way, the review link's seat switch or a return to the table: no
// "Your turn" again)
function beginTurn({ resume = false } = {}) {
  if (state.finished) { showEnd(); return; }
  inActionPhase = false;
  endAsked = false;
  stopTimer();
  hud.hideConfirm(); selectedMove = null; activeWalk = null; walkCutShort = false; queuedTap = null;
  const p = activePlayer(state);
  movers[p.index]?.halt();
  syncViews(false);
  refresh();
  if (isOther(p.index)) { startBotTurn(p); return; }
  // The player's turn: anything that happened to them meanwhile first (they were mirrored, a trade
  // they were dragged into), in private, then their actions.
  rig.recentre();
  mood.snap(p.currentRoom);
  const go = () => {
    inActionPhase = true;
    startTimer();
    refresh();
    if (!resume) {
      hud.toast(`Your turn — ${rules.actionPointsPerTurn} actions.${lockNews ? ` ${lockNews}` : ''}`, lockNews ? 5 : undefined);
      sfx('yourTurn');
    }
    lockNews = '';
  };
  if (p.roleChangePending) {
    handoff.revealRole(p, { changed: true, by: state.players.find(q => q.id === p.convertedBy)?.name }, () => { roleRead(); go(); });
    return;
  }
  if (p.notes.length) { handoff.privateNote(p, ['While the others played:'], go); return; }
  go();
}

// --- Turn timer --------------------------------------------------------------------------
// Counts the active guest's actions only. Meetings, hand-over screens, the end screen and every
// blocking prompt pause it. The end-of-turn DISCARD does not (approved rule, 15 Oct 2026): the clock runs on
// while the guest chooses what to discard, but they always get at least rules.discardMinSeconds (endTurnNow);
// when it reaches zero, or when the 45 seconds run out in the action phase holding more than the limit, the
// game discards random ordinary cards for them and the turn ends (onTimeUp, endTurnByClock). The clock is
// dt-based (a frame is never counted as more than 50 ms), and a hidden tab draws no frames: time away from
// the page is not counted, so coming back never finds a discard made behind the guest's back.
// The clock itself is the table's (src/net/referee.js in local mode: advance, a walk cut short, timeUp). The page holds it
// while anything above is up (holds, every frame), shows it (timerLeft: the seconds the table has left, between startTimer
// and stopTimer) and shows what the table did when it ran out (cutWalkShort, onTimeUp).
let clockShown = false;
function startTimer() {
  if (!rules.turnTimerEnabled) { hud.hideTimer(); timerLeft = 0; clockShown = false; return; }
  const left = !table ? 0 : online() ? (table.clockLeft() ?? 0) * 1000 : table.local.timeLeft();
  timerLeft = left > 0 ? left / 1000 : rules.turnTimerSeconds;
  clockShown = true;
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
}
function stopTimer() { timerLeft = 0; clockShown = false; hud.hideTimer(); }
// The "turn your iPad sideways" card (pure CSS, styles.css) covers the game in portrait: the clock
// waits while it is up. (The discard screen is not in this list: only the half second its last card spends
// leaving, `discard.finishing`, when the choosing is over and the screen is closing by itself.)
const sideways = window.matchMedia?.('(orientation: portrait), (max-width: 900px)');
const timerPaused = () => handoff.isOpen || overlays.endOpen || overlays.noticeOpen || askUp()
  || meeting.isOpen || discard.finishing || meetingLive || overlays.errorOpen || !!sideways?.matches;

// What the page holds the table to, set every frame before it ticks (DESIGN §4.4): the computer guests wait while anything
// is under way or up on this screen (the old botTick wait list), and the clock while anything pauses it (timerPaused) or
// the player's own turn has not begun yet (its private screens: a role that changed, the notes).
function holds() {
  const m = activeMover();
  return {
    bots: meetingLive || !!pendingArrival || m.walking || m.path.length > 0 || walkCutShort || handoff.isOpen || overlays.noticeOpen
      || askUp() || overlays.endOpen || overlays.errorOpen || discard.isOpen || meeting.isOpen,
    clock: timerPaused() || (myTurn() && !inActionPhase),
  };
}

// Every frame: the table's clock counts the frame (unless held), then the page shows what is left. A clock that ran out
// has been settled by the table already (a walk cut short, the turn ended: follow shows it). The player's own clock
// ticks out loud for its last ten seconds.
function tickClock(now, dt) {
  if (!table) return;
  if (online()) { netClock(now); return; }
  table.local.hold(holds());
  const turn = state.turn, before = timerLeft;
  if (table.local.tick(now, dt * 1000)) {
    follow({ byClock: true });
    if (state.turn !== turn || state.finished) return;
  }
  if (!clockShown) return;
  const left = table.local.timeLeft() / 1000;
  if (left === timerLeft) return;
  timerLeft = left;
  if (myTurn() && timerLeft > 0 && timerLeft <= 10 && Math.ceil(timerLeft) < Math.ceil(before)) sfx('tick', { volume: timerLeft <= 3.5 ? 1 : 0.7 });
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
  if (discard.isOpen) discard.tick(timerLeft);      // (the discard screen's own countdown)
}

// The clock ran out mid-walk, and the table cut the walk short (its walkCut news, `to`): a guest still in the room the
// walk started from walks on to the standing spot of the next room (that room's move is charged as they cross into it,
// like any move); once they have stepped into a room on the way, they stop on that room's standing spot. A guest still
// walking when the clock runs out always ends on a standing spot; they finish arriving first (a forced meeting there
// pauses the clock), and the table ends the turn then. Ending it mid-walk would leave the guest off their spot, or that
// arrival for the next guest.
function cutWalkShort(to) {
  if (walkCutShort) return;
  walkCutShort = true;
  if (clockShown) timerLeft = 0.001;
  const m = activeMover();
  if (!m.walking && !m.path.length) return;           // (only arriving: that finishes by itself)
  const player = activePlayer(state);
  const plan = to != null && to !== player.currentRoom ? discovery.planToRoom(to, standAtFor(player.index), walker(player)) : null;
  if (plan?.ok) { activeWalk = plan; discovery.go(plan); return; }
  const here = discovery.planToRoom(player.currentRoom, standAtFor(player.index), walker(player));
  if (here.ok) { activeWalk = here; discovery.go(here); } else m.halt();
}

// The clock ran out on the active guest, and the table has settled it (src/net/referee.js timeUp): the player holding more
// than the limit has had random ordinary cards discarded for them by the engine's own discardRandomDown (its private
// result 'autoDiscarded' says which kinds); a computer guest chose its own; then the turn passed. `at`: the turn as it
// stood. The page shows it as it always did.
function onTimeUp(at) {
  const mine = at.seat === humanSeat;
  const res = mine ? newestResult('autoDiscarded') : null;
  const gone = (res?.cards || []).map(type => ({ type }));
  // The player's clock ran out holding more than the limit, on the discard screen or in the action phase (the
  // screen then never opens): the game discarded for them.
  if (mine && atZero(gone.length) === 'random') { endTurnByClock(at, gone, res); return; }
  if (discard.isOpen) discard.close();
  if (mine) { hud.toast('Time is up — your turn ends.'); sfx('timeUp'); }
  turnPassed(at);
}

// The clock ran out while the player held more than the hand limit: the table discarded RANDOM ordinary cards for them,
// only as many as needed (never a Possession card, and no log line or public event: the table learns nothing), and the
// turn passed the way any end of turn does (turnPassed). The player is told what went, privately and without blocking
// anything, on their own screen. The screen, if it was open, is closed here before anything else.
function endTurnByClock(at, gone, res) {
  discard.close();
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
  if (movers[at.seat]?.walking) movers[at.seat].halt();
  sfx('timeUp');
  ackResult(res?.id);
  turnPassed(at);
  if (gone.length && !state.finished) discard.note(discardedLine(gone));
}
// Which turn of which game a discard screen belongs to (a screen is only ever ended by its own turn's clock).
const turnStamp = () => `${gameToken}:${state.turn}`;
let discardStamp = '';

// "the door to the Library" (seen from `fromRoom`), or "door between the Hall and the Library".
function doorName(doorwayId, fromRoom = null) {
  const d = floor.doorways.find(x => x.id === doorwayId);
  if (!d) return 'doorway';
  const name = id => (state.discovered?.has(id) ?? true) ? floor.rooms.get(id)?.name ?? 'next room' : 'unknown room';
  if (fromRoom === d.a || fromRoom === d.b) return `door to the ${name(d.otherRoom(fromRoom))}`;
  return `door between the ${name(d.a)} and the ${name(d.b)}`;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// The turn passes at the table (src/net/referee.js: the hand limit settled first, the doors that lock again, the
// barricades that come down, the next turn). The player's End turn, and the last card of the discard screen, ask it to
// (passTurn); a computer guest's turn, and a turn the clock ended, it passes by itself (follow). Either way the page shows
// it as it always has (turnPassed). `shown`: the turn on screen; `at` (turnNow): the turn as it stood just before.
const turnNow = () => ({ game: gameToken, turn: state.turn, seat: state.activeIndex, sealed: [...(state.barricades?.keys() ?? [])], seq: state.eventSeq });
function passTurn() {
  if (!table || state.finished || shown?.game !== gameToken || state.turn !== shown.turn) return;   // (passed already, and shown)
  // (Co-op: the last discard passes the turn at the table by itself; the view shows the turn passing: follow)
  if (online() && (endAsked || state.ask?.kind === 'discard')) return;
  // Never past the hand limit: anything that ends a turn goes through the discard screen first.
  if (overHandLimit(activePlayer(state)) > 0) { endTurnNow(); return; }
  if (online()) { netEnd(); return; }
  const at = turnNow();
  const r = table.local.apply({ k: 'end' });
  if (!r.ok || (!state.finished && state.turn === at.turn)) return;      // (refused, or the discard question first)
  turnPassed(at);
}

function turnPassed(at) {
  hud.hideConfirm(); selectedMove = null; activeWalk = null; walkCutShort = false;
  if (at.seat === humanSeat) hand.close();     // (a computer guest's turn ending leaves the player's card view open)
  stopTimer();
  endTurnGuardUntil = performance.now() + END_TURN_GUARD_MS;
  const relocked = [
    // A locked door opened this turn has locked again (its door swings shut in syncViews below).
    ...state.events.filter(e => e.seq > at.seq && e.type === 'relock').map(e => `The ${floor.rooms.get(e.room)?.name ?? 'locked room'} door has locked again.`),
    // a barricade that came down as this turn started (its boards go in syncViews below)
    ...at.sealed.filter(id => !state.barricades.has(id)).map(id => `Barricade down: ${doorName(id, activePlayer(state).currentRoom)}.`),
  ].join(' ');
  movers[at.seat]?.halt();
  shown = turnNow();
  syncViews(false);
  if (state.finished) { refresh(); showEnd(); return; }
  if (!PRACTICE) { lockNews = relocked; beginTurn(); return; }
  rig.setFocus(...followPoint());
  rig.recentre();
  mood.snap(activePlayer(state).currentRoom);
  refresh();
  hud.toast(`Turn ${state.turn} — ${actionsWord(rules.actionPointsPerTurn)}.${relocked ? ` ${relocked}` : ''}`, relocked ? 5 : undefined);
  sfx('yourTurn', { volume: 0.7 });
}

// End the turn (the End turn button, the turn passing by itself when the actions run out - tickAutoEnd
// below - or the 45-second clock running out). The hand limit is settled
// HERE and only here (approved rule): a guest holding more than 6 cards (Possession cards don't count)
// chooses what to discard on the discard screen first, and the turn passes only once they are down to
// 6. Nothing else is left open behind it. A computer guest chooses its discards itself (the table: src/net/referee.js
// endTurnNow, botDiscardDown).
// The turn clock keeps running during the discard (approved rule, 15 Oct 2026): the screen gets what is left of
// it, but never under rules.discardMinSeconds (src/ui/discardClock.js); at zero the game discards at random
// (onTimeUp). Where the clock is off (Practice, ?timer=off) the discard has no time limit.
function endTurnNow() {
  const p = activePlayer(state);
  if (overHandLimit(p) > 0) {
    hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
    if (activeMover().walking) activeMover().halt();
    const seconds = discardAllowance(timerLeft, rules.turnTimerEnabled);
    if (seconds === null) stopTimer();
    else { timerLeft = seconds; hud.showTimer(timerLeft, rules.turnTimerSeconds); }
    discardStamp = turnStamp();
    if (online()) netEnd();
    else table.local.apply({ k: 'end' });      // (the table's discard question: its clock gives the same allowance)
    discard.open(p, passTurn, { seconds });
    return;
  }
  passTurn();
}

// A second tap on End turn right after the first (a double tap) must not end the next turn too: in
// practice there is no hand-over screen in between to catch it. The new turn ignores End turn for a
// moment.
const END_TURN_GUARD_MS = 700;
let endTurnGuardUntil = 0;
// With actions still unspent End turn first asks "You still have 3 actions. End turn?" (they are lost
// when the turn ends: the same light bar as Move; src/hud.js). Never at 0 actions, never when the clock
// runs out (the table ends that turn itself) and never for a computer guest (the table ends its turn).
// `ask: false` ends the turn without the question: the bar's own End turn answer, and the tests' hook.
function doEndTurn({ ask = true } = {}) {
  if (!running || state.finished || uiBusy()) return;
  // Out of the match (dead) with the others still playing: the button skips to the result (not at a Co-op table, TP5).
  if (!PRACTICE && !me().alive) { if (!online()) skipToEnd(); return; }
  if (activeMover().walking || !myTurn() || !inActionPhase) return;
  if (performance.now() < endTurnGuardUntil) return;
  const left = activePlayer(state).actionPoints;
  if (ask && left > 0) {
    if (hud.confirmKind !== 'end') { selectedMove = null; hud.askEndTurn(left); }   // (asked already: it stays)
    return;
  }
  hud.hideConfirm(); selectedMove = null;
  endTurnNow();
}

// --- Auto end turn -----------------------------------------------------------------------
// When the player's last action is spent, the turn passes by itself a beat later: the same path as the
// End turn button (endTurnNow: the discard screen first if the hand is over the limit, stopTimer, ...),
// without the "End turn?" question. The beat (AUTO_END_MS) only runs while nothing else is going on - no
// walk, door, reveal, meeting, private screen or menu - and starts over if something does start, so the
// result of the last action is always seen first. It never runs on a computer guest's turn, for a guest
// who is out, once the match is over, while the clock is paused, or after the clock cut a walk short.
// While the player could still do something FREE with no actions left (an Espresso in hand gives +2
// actions; a Trade in the Fire Exit costs nothing) it does not run at all: End turn glows instead, and
// the player taps it themselves. The End turn button stays for ending early.
const AUTO_END_MS = 900;
let autoEndOn = !window.__noAutoEnd;       // (the browser checks that tap End turn themselves switch it off before the page loads: tests/smoke-lib.mjs)
let autoEndKey = '', autoEndSince = 0;     // the turn the beat is running for (game + turn number) and when it began
let autoEndFired = 0;                      // how many turns have passed this way (tests)
const endTurnBtn = document.getElementById('btn-end-turn');

// 'out': no actions left and nothing free to do; 'free': no actions left but something free remains;
// 'no': anything else (actions left, not the player's turn, over, ...).
function autoEndState() {
  if (!running || state.finished || phase !== 'game' || !myTurn() || !inActionPhase) return 'no';
  const p = me();
  if (!p.alive || p.actionPoints > 0) return 'no';
  return p.hand.some(c => c.type === 'espresso') || canTradeVoluntarily(state, floor, p) ? 'free' : 'out';
}
const autoEndBusy = () => uiBusy() || timerPaused() || tradeReveal.isOpen || chat.isOpen || howTo.isOpen || cardsGuide.isOpen
  || doorways.animating || crash.shown || meetingLive || !!pendingArrival || walkCutShort || activeMover().walking || activeMover().path.length > 0;

function tickAutoEnd(now) {
  const s = autoEndState();
  if (endTurnBtn && endTurnBtn.classList.contains('nudge') !== (s === 'free')) endTurnBtn.classList.toggle('nudge', s === 'free');
  if (!autoEndOn || s !== 'out' || autoEndBusy()) { autoEndKey = ''; return; }
  const key = `${gameToken}:${state.turn}`;
  if (key !== autoEndKey) { autoEndKey = key; autoEndSince = now; return; }    // (the beat starts now)
  if (now - autoEndSince < AUTO_END_MS) return;
  autoEndKey = '';                          // (once: a new beat needs a new quiet moment)
  autoEndFired++;
  endTurnNow();
}

// The active guest finished walking into a room. The Fire Exit is a safe zone (never a meeting);
// escaping there is a separate action, the Exit icon (1 action: onEscape).
function onArrive() {
  if (table && !online()) table.local.arrived();       // (the table settles the arrival: a forced meeting there)
  const player = activePlayer(state);
  const room = floor.rooms.get(player.currentRoom);
  pendingArrival = null;
  activeWalk = null;
  if (room?.isExit && !isOther(player.index)) {
    // The same words whoever you are, so they give nothing away about who is carrying what or who is
    // possessed. (Practice has nothing to hide: it says plainly what to do.)
    const cost = `${rules.actionCost.escape} action${rules.actionCost.escape === 1 ? '' : 's'}`;
    hud.toast(!state.practice ? `The Fire Exit — a clean guest carrying ${rules.lanternsToEscape} Lanterns can escape here (${cost}).`
      : canEscape(state, floor, player) ? `You carry ${rules.lanternsToEscape} Lanterns: tap the Exit icon (${cost}).`
        : `The Fire Exit — bring ${rules.lanternsToEscape} Lanterns here to escape (${cost}).`);
  }
  if (!inMeeting()) { refresh(); return; }
  // Walking into a room with another guest: the table has started the meeting.
  meetingLive = true;
  hud.hideConfirm(); selectedMove = null;
  if (player.index !== humanSeat) return;      // (a computer guest walked in: it makes up its mind in a moment: follow)
  // The player walked in. The meeting panel takes the screen: close anything they had open.
  hand.close(); map.close();
  rig.recentre();      // the meeting is where the guest is
  talk = {};
  talkNext();
}

// --- Meetings ----------------------------------------------------------------------------
// Walking into a room with another guest forces a meeting: the guest who walked in picks ONE guest
// (when several are there) and chooses Trade or Attack. In a trade each side picks a card in secret
// and the cards swap at the same moment; an attack is public. The player makes their own choices on
// their own screens. A computer guest makes its choices through src/bots/, after a short pause like a
// person's. A meeting between two computer guests plays out by itself and is reported in the feed.
// The table runs every meeting and Fire Exit trade (src/net/referee.js, DESIGN §5.3): it asks the player its questions
// (state.ask: meetWhom, meetAct, tradeCard, offer), keeps the computer guests' pauses and choices, and tells the player in
// private what came of it (state.results: trade, noTrade, declined). The page shows each on the screens it always used,
// sends the answers (talkNext) and shows what the others did (follow).
let meetingLive = false;     // a meeting (or a proposed trade) is being played out: the bots wait for it
// The player's part in the meeting or trade under way (null: none): the question on screen (ask), the result on screen
// (result), what the reveal needs from before the cards changed hands (before), and whether the page is waiting on the
// other guest (waiting: 'card', their card for the trade; 'reply', their answer to a Fire Exit proposal).
let talk = null;
const inMeeting = () => state.phase?.kind === 'meeting' || state.phase?.kind === 'offer';
// The player's answer to the table's question `a` (DESIGN §6.3): synchronous, the screens' state is current after it.
const answer = (a, value) => act({ k: 'answer', ask: a.id, value });

let gameToken = 0;
let foundThisGame = [];      // the cards the player's own searches found this game (the achievements: countHonours)
// The game the player last looked round the hotel in (dragged, pinched, wheeled, or used a round camera
// button), and the game they last used a round button in: the camera tips go by these (src/ui/tips.js).
let camTouchedIn = -1, camButtonIn = -1;

// The player has a part in the meeting or trade under way. One a computer guest brought them into (it walked in on them,
// proposed a trade, attacked) first clears the screen ('close'), and brings the view back to them too ('recentre').
function own(clear = null) {
  meetingLive = true;
  if (talk) return talk;
  talk = {};
  if (clear) {
    hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
    if (clear === 'recentre') rig.recentre({ zoom: false });
  }
  return talk;
}

// The next screen of the player's part, if one is due and none is up: after each answer, and whenever the table has news
// (follow). A screen that is up carries on by itself when it closes.
function talkNext() {
  if (!table || handoff.isOpen || tradeReveal.isOpen) return;
  // (Co-op: the question comes with the view at once; it waits until the walk into the meeting has been seen)
  if (online() && (pendingArrival || activeMover().walking || activeMover().path.length)) return;
  if (meeting.isOpen && !talk?.waiting) return;
  const res = (state.results || []).find(r => (r.kind === 'trade' || r.kind === 'noTrade' || r.kind === 'declined') && r.id !== talk?.result);
  if (res) { if (talk?.waiting) meeting.close(); talkResult(res); return; }
  const a = state.ask;
  if (!a || a.id === talk?.ask || talk?.waiting === 'card') return;
  if (talk?.waiting === 'reply' && a.kind !== 'tradeCard') return;
  if (talk?.waiting) meeting.close();
  // (Co-op: a question that reaches the player off their own turn, someone walked in or a Fire Exit offer, calls them)
  if (online() && state.activeIndex !== humanSeat) sfx('yourTurn');
  if (a.kind === 'meetWhom') meetWhom(a);
  else if (a.kind === 'meetAct') meetAct(a);
  else if (a.kind === 'tradeCard') tradePick(a);
  else if (a.kind === 'offer') offered(a);
}

// The player walked in on several guests: whom to meet.
function meetWhom(a) {
  own().ask = a.id;
  meeting.choose(me(), a.candidates.map(i => state.players[i]), Q => { answer(a, Q.index); talkNext(); });
}

// The player walked in and meets Q: Trade or Attack (Attack needs a weapon and an action; the table says which).
function meetAct(a) {
  own().ask = a.id;
  const P = me(), Q = state.players[a.with];
  // Trade or Attack; the weapon picker's Back returns here (nothing has happened yet).
  const chooseAction = () => meeting.chooseAction(P, Q, {
    canAttack: !!a.canAttack,
    onTrade: () => { answer(a, 'trade'); talkNext(); },
    onAttack: () => runAttack(P, Q, a, chooseAction),
  });
  chooseAction();
}

// The player attacks: choose a weapon, then the public result.
function runAttack(P, Q, a, onBack = null) {
  meeting.attackPick(P, Q, weaponId => {
    const before = Q.health;
    after(answer(a, { attack: weaponId }), r => {
      if (!r.ok) { hud.toast('You cannot attack now.'); onBack?.(); return; }
      // (Co-op: the weapon went if it left the hand: the table tells only the attacker that)
      if (online() && !attackSeen) attackSeen = { by: P.index, target: Q.index, discarded: !me().hand.some(c => c.id === weaponId) };
      showAttack(P, Q, state.events.filter(e => e.type === 'attack' && e.by === P.index).pop(), before);
    });
  }, onBack);
}

// The public outcome of an attack the player is in (the meeting panel: src/ui/meeting.js), from the table's public attack
// event; `before`: the target's health just before it. The player reads it and taps on.
function showAttack(P, Q, e, before) {
  const seen = attackSeen && attackSeen.by === P.index && attackSeen.target === Q.index ? attackSeen : null;
  attackSeen = null;
  const events = { ok: true, weapon: e?.weapon, damage: e?.damage ?? 0, killed: !!e?.killed, discarded: !!seen?.discarded };
  if (events.killed) layBodyClear(Q.index);   // (the figure falls when the result is dismissed)
  meeting.attackResult(P, Q, events, afterMeeting, { before });
}

// A trade between the player and another guest: the player picks their card on a private screen, while the other picks
// theirs in secret (a computer guest's is chosen by the table, src/bots/). The cards swap at once; the player then reads,
// in private, what they received (and what it did to them).
function tradePick(a) {
  const t = own('recentre');                  // (a computer guest walked in on the player and chose to trade)
  t.ask = a.id; t.waiting = null;
  const human = me(), other = state.players[a.with];
  const walker = state.phase?.seats?.[0];
  tradeReveal.preload();     // (the card faces the reveal will turn over)
  handoff.privatePick(human, {
    kicker: a.voluntary ? `The Fire Exit — a trade with ${other.name}` : walker === humanSeat ? `A trade with ${other.name}` : `${other.name} walked in — a trade`,
    title: `Give one card to ${other.name}`,
    sub: `${other.name} is choosing a card for you at the same moment. Neither of you sees the other's card until they have changed hands.`,
    cards: tradeableCards(human),
    onPick: card => {
      const id = card ?? a.cards?.[0] ?? null;
      // (what the reveal shows from before the cards change hands: the card given, the player's role, and whether they
      // saw red eyes or the strip's marker on the other guest: src/ui/allies.js)
      t.before = {
        mine: human.hand.find(c => c.id === id) || null, wasPossessed: !!human.possessed,
        allyBefore: redEyedAllies(state, human).has(other.id), markBefore: knownPossessedIds(state, human).has(other.id),
      };
      after(answer(a, id), r => {
        if (!r.ok) { t.ask = null; talkNext(); return; }
        t.waiting = 'card';
        meeting.waiting('A trade', `${other.name} is choosing a card…`);
        talkNext();
      });
    },
  });
}

// What the trade, the skipped trade or the Fire Exit proposal came to (the table's private result): the trade as cards
// with its effect (src/ui/tradeReveal.js), then, if it possessed the player, their new role; an empty slot for whoever had
// nothing to give (GAME_RULES, Trade: the rules' own note, worded the same whatever anyone's role); a declined proposal.
function talkResult(r) {
  const t = own('recentre');                  // (a computer guest walked in on the player with no trade to make)
  t.result = r.id; t.waiting = null;
  const human = me(), other = state.players[r.with];
  if (r.kind === 'declined') { meeting.notice(`${other.name} declined.`, () => { ackResult(r.id); afterMeeting(); }, 'No trade'); return; }
  const done = () => {
    ackResult(r.id);
    if (state.ask?.kind === 'role') handoff.revealRole(human, { changed: true, by: other.name }, () => { roleRead(); afterMeeting(); });
    else afterMeeting();
  };
  if (r.kind === 'noTrade') {
    const ally = redEyedAllies(state, human).has(other.id);
    tradeReveal.show({
      outcome: 'noTrade', me: human, other, empty: r.empty || [], allyBefore: ally, allyAfter: ally,
      wasPossessed: human.possessed, notes: r.notes || [],
    }, done);
    return;
  }
  // The souls they hold now: if it possessed them, the new souls of their own the rules dealt (the card that did it is
  // used up).
  const b = t.before || {};
  tradeReveal.show({
    outcome: r.outcome, me: human, other, mine: b.mine || r.gave, theirs: r.got,
    held: human.hand.filter(c => c.type === 'possession').length, wasPossessed: b.wasPossessed ?? human.possessed,
    allyBefore: !!b.allyBefore, allyAfter: redEyedAllies(state, human).has(other.id),
    markBefore: !!b.markBefore, markAfter: knownPossessedIds(state, human).has(other.id), notes: r.notes,
  }, done);
  refresh();   // (once the scene is up: a guest it shows to be possessed turns red only as it shows it)
}

function afterMeeting() {
  meetingLive = false;
  talk = null;
  syncViews(false); refresh();
  if (state.finished) { showEnd(); return; }
  if (skipQueued) { skipToEnd(); return; }
  checkPlayerOut();
}

// Voluntary trade in a safe zone that allows it (the Fire Exit; never the lobby): the other guest must
// agree before anyone chooses. The player proposes it with the Trade button; a computer guest takes a
// moment to answer (the table's pause), then the trade, or "declined".
// (Whether a trade is allowed here is the table's to say: with one other guest there the proposal goes straight to it,
// and a refusal shows nothing, as before; with several, the screens' own answer first, before the player picks whom.)
function onTrade() {
  if (!running || state.finished || uiBusy() || activeMover().walking || PRACTICE || !myTurn() || !inActionPhase) return;
  const P = me();
  const others = playersInRoom(state, P.currentRoom, P.id);
  if (!others.length) return;
  const ask = Q => after(act({ k: 'trade', with: Q.index }), r => {
    if (!r.ok) { refresh(); return; }
    hud.hideConfirm(); selectedMove = null;
    meetingLive = true;
    talk = { waiting: 'reply' };
    meeting.waiting('A trade is proposed', `${Q.name} is thinking it over…`);
  });
  if (others.length === 1) { ask(others[0]); return; }
  if (!canTradeVoluntarily(state, floor, P)) return;
  hud.hideConfirm(); selectedMove = null;
  meeting.choose(P, others, ask, { voluntary: true, onCancel: refresh });
}

// A computer guest proposes a trade in the Fire Exit to the player: Accept or Decline, in private.
function offered(a) {
  const t = own('close');
  t.ask = a.id;
  const P = state.players[a.from], Q = me();
  handoff.privateChoice(Q, {
    kicker: 'The Fire Exit',
    title: `${P.name} would like to trade`,
    sub: 'You each give one card, in secret. You do not have to agree.',
    options: [{ label: 'Accept', value: true, primary: true }, { label: 'Decline', value: false }],
    onPick: yes => { answer(a, !!yes); if (yes) talkNext(); else afterMeeting(); },
  });
}

// The player has just died: they can watch the others play on, or skip straight to the result.
let outNoticeShown = false;
function checkPlayerOut() {
  if (PRACTICE || outNoticeShown || state.finished || me().alive) return;
  outNoticeShown = true;
  hand.close(); map.close(); hud.hideConfirm();
  // (Co-op: other people are still playing, so it can't be skipped: watch, or leave the table, TP5)
  if (online()) { const w = ONLINE_TEXT.dialogs.out; overlays.ask(w.title, w.line, { yes: w.buttons[1], no: w.buttons[0] }, () => leaveCoop()); return; }
  overlays.ask('You are out', 'Your guest has died. Everything you carried lies on the floor. Watch the others play on, or skip straight to how it ends.',
    { yes: 'Skip to the result', no: 'Watch' }, skipToEnd);
}

// --- Computer guests' turns ------------------------------------------------------------------
// The table plays them (src/net/referee.js, with each bot's mind, src/bots/): on a bot's turn, once nothing is under way
// (a walk, a meeting, a screen the player is reading: holds) and its thinking pause is over, the bot takes ONE action
// through the rules, exactly like the player's. Refused actions are reported back to it; three in a turn (or a runaway
// turn) end it. The 45-second clock runs for bots too, as a backstop. The page shows each action as it always did
// (follow): the same walks and the same public words a person's action would have.

// (the bots' thinking pause, for the table: Bot speed × ?botpace × a half once the player is out)
const botPaceScale = () => (settings.choice('botSpeed')?.think ?? 1) * BOT_PACE * (me()?.alive ? 1 : 0.5);
function botWalkScale() { return (settings.choice('botSpeed')?.walk ?? 1.45) * (me()?.alive ? 1 : 1.4); }

function startBotTurn(p) {
  movers[p.index].speedScale = online() ? NET_WALK : botWalkScale();
  startTimer();          // everyone's clock shows, as it would online
  if (focusIndex() === p.index) rig.recentre({ zoom: false });
  refresh();
}

// Every frame: the table may take a computer guest's step or a meeting's beat (held as `holds` says), then the page shows
// whatever it did.
function tickBots(now) {
  if (!table) return;
  if (online()) { follow(); return; }
  table.local.hold(holds());
  follow({ acted: table.local.tick(now) });
}

// What the table did since the page last looked, shown as the page always showed it (a walk, a door, a search, a Hand
// Mirror, the Switchboard, an attack, a meeting the player is brought into or has no part in, the turn passing, the
// end): every frame after the table's tick, and at once after a clock that ran out (byClock). Cheap when nothing is new.
let following = false;
function follow({ acted = false, byClock = false } = {}) {
  if (!table || following || (!tableNews && !localNews.length)) return;
  following = true;
  try {
    tableNews = false;
    const news = localNews;
    localNews = [];
    for (const ev of news) {
      if (ev.type === 'walk') { if (ev.seat !== humanSeat) botWalk(ev); } else if (ev.type === 'walkCut') cutWalkShort(ev.to);
    }
    const fresh = state.events.filter(e => e.seq > seenO);
    if (fresh.length) seenO = fresh[fresh.length - 1].seq;
    for (const e of fresh) showEvent(e);
    // (Co-op: the other guests' walks, from their `enter` events; every figure where the table has it; until the role
    // screen at the start is read, and while the others still read theirs, no turn is shown yet)
    if (online()) {
      // (a backlog of more than 3 s, a hidden page or a burst after a reconnection: drawn as it stands, not replayed)
      let late = false;
      for (let x = netQueue.next(); x; x = netQueue.next()) late ||= x.fresh || x.change === true;
      if (late) { movers.forEach((m, i) => { if (i !== humanSeat || !netBusy) m.halt(); }); rebuildGrid(); discovery.refresh(); syncViews(false); } else netWalks(fresh);
      netSnap();
      if (state.end?.stopped) { netStopped(); return; }
      if (!netBegun) return;
      if (netStarting) {
        if (state.phase?.kind === 'start' && !state.finished) return;
        netStarting = false; shown = turnNow(); beginTurn(); return;
      }
    }
    // The turn passed by itself (a computer guest ended theirs, or the clock ended one): as passTurn shows it.
    if (shown?.game === gameToken && (state.turn !== shown.turn || (byClock && state.finished))) {
      const at = shown;
      // (Co-op: the player's own turn ended without their End turn: the server's clock ran it out)
      if (byClock || (online() && at.seat === humanSeat && !endAsked && !state.finished)) onTimeUp(at); else turnPassed(at);
      return;
    }
    talkNext();
    if (inMeeting() && !meetingLive) { meetingLive = true; hud.hideConfirm(); selectedMove = null; }   // (a bot's Fire Exit proposal to a bot)
    else if (meetingLive && !talk && !inMeeting()) afterMeeting();          // (a meeting the player had no part in is over)
    if (state.finished && !meetingLive && !overlays.endOpen) { syncViews(false); refresh(); showEnd(); return; }
    if (!meetingLive && (acted || byClock || news.length || fresh.some(e => (e.seat ?? e.by) !== humanSeat))) { syncViews(false); refresh(); }
    if (shown?.game === gameToken) { shown.sealed = [...(state.barricades?.keys() ?? [])]; shown.seq = state.eventSeq; }
    if (online()) netScreens();
  } finally { following = false; }
}

// One public event of another guest's, shown as the page showed that guest's action when it ran it itself (the feed and
// the sounds follow the events by themselves: src/ui/feed.js, src/audio/gameSounds.js).
function showEvent(e) {
  const by = e.seat ?? e.by;
  if (by == null || by === humanSeat) return;
  const P = state.players[by];
  const rect = q => [q.min[0], q.min[1], q.max[0], q.max[1]];
  switch (e.type) {
    case 'open': {
      // (a jammed door is a discovery, not a mistake: the bot learns it, nothing is spent, nothing to show)
      if (e.jammed || e.revealed == null) return;
      rebuildGrid();
      discovery.refresh();
      syncViews(true);
      refresh();
      const a = floor.rooms.get(e.room), b = floor.rooms.get(e.revealed);
      if (a && b && focusIndex() === by) rig.showRooms([rect(a), rect(b)]);
      return;
    }
    case 'search': {        // (the guest turns to face the furniture it searched)
      const spot = state.activeIndex === by ? searchSpotOf(floor.rooms.get(e.room)) : null;
      if (spot) faceTowards(spot.center);
      return;
    }
    case 'mirror': {
      // The player was looked at: told at once (the feed says it too), not again at their next turn.
      if (e.target !== humanSeat || !P) return;
      const line = `${P.name} looked at your whole hand with a Hand Mirror.`;
      notesRead(me(), [line]);
      hud.toast(line, 4);
      return;
    }
    case 'switchboard': if (P) hud.toast(`${P.name} rang the Switchboard. ${switchboardLine(e.count)}`, 6); return;
    case 'attack': {
      // A computer guest attacked: the player, if they were the one attacked, reads it (and taps on); between two
      // computer guests a short public line says what happened.
      const Q = state.players[e.target];
      if (!P || !Q) return;
      if (e.target === humanSeat) { own('recentre').attack = e.seq; showAttack(P, Q, e, healthBefore.get(e.seq)); return; }
      if (e.killed) layBodyClear(Q.index);
      hud.toast(`${P.name} attacked ${Q.name} with ${aCard(e.weapon)}${e.killed ? ` — ${Q.name} is dead` : ''}.`, 4);
      return;
    }
    default: break;
  }
}

// A computer guest set off (the table's walk news: the rooms it will walk through): its figure walks there the way the
// player's does, and each doorway it crosses is the table's to settle (discovery.update, table.local.step). A walk the
// page cannot plan is refused like any other action (walkFailed): the table tells the bot, and it thinks again.
function botWalk(ev) {
  const p = state.players[ev.seat];
  const to = ev.rooms?.[ev.rooms.length - 1];
  const plan = p && ev.seat === state.activeIndex && to != null && to !== p.currentRoom && floor.rooms.has(to)
    ? discovery.planToRoom(to, standAtFor(ev.seat), walker(p)) : null;
  if (!plan?.ok) { table.local.walkFailed(); return; }
  startWalk(plan);
}

// The player is out (dead): the rest of the match is played at once by the bots, through the same
// rules (src/bots/autoplay.js, run by the table: table.local.skipToEnd), and the guests are put where the rules left them.
function skipToEnd() {
  if (state.finished || !table || PRACTICE || online()) return;
  if (meetingLive) { overlays.hideAsk(); hud.toast('A meeting is under way — skipping as soon as it ends.', 3); skipQueued = true; return; }
  skipQueued = false;
  overlays.hideAsk();
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null; activeWalk = null;
  stopTimer();
  for (const m of movers) m.halt();
  // (a bot arriving in a room this very moment still has its forced meeting: the table plays it first)
  pendingArrival = null;
  const r = table.local.skipToEnd();
  if (r.queued) { hud.toast('A meeting is under way — skipping as soon as it ends.', 3); skipQueued = true; return; }
  // (what the computer guests did meanwhile is in the feed and the log: no walk, door or line is played back)
  localNews = []; healthBefore.clear(); attackSeen = null;
  seenO = state.eventSeq;
  movers.forEach((m, i) => { const s = standingSlot(state.players[i].currentRoom, i); m.reset(s.x, s.z); });
  rebuildGrid(); discovery.refresh(); syncViews(false); refresh();
  shown = turnNow();
  if (state.finished) showEnd();
  else { hud.toast('The match could not be finished at once — it plays on.', 4); beginTurn(); }
}
let skipQueued = false;       // "Skip to the end" was asked for during a meeting

// --- Actions -----------------------------------------------------------------------------
const SEARCH_FAIL = {
  notSearchable: 'There is nothing to search in here.',
  searched: 'This room has already been searched.',
  dark: 'Too dark to search — you need a Flashlight.',
  ap: 'No actions left to search.',
  empty: 'Nothing left to find here.',
};

function onSearch() {
  if (!running || state.finished || uiBusy() || activeMover().walking || !myTurn()) return;
  const player = activePlayer(state);
  const had = resultIds();
  after(act({ k: 'search' }), r => {
    if (!r.ok) { hud.toast(SEARCH_FAIL[r.reason] || 'Cannot search now.'); return; }
    const res = newResult('found', had);     // (the table's private result: the cards, where, picked up?)
    const found = res?.cards || [];
    foundThisGame.push(...found);            // (your own finds, for the achievements at the end: the rules emit no event for them)
    showFound(player, res);
  });
}
// What a search found, on the player's own screen (and, at a Co-op table, a result whose screen was not seen yet).
function showFound(player, res) {
  if (res) netShown.add(res.id);
  const where = res?.where || 'the room';
  syncViews(false);
  // Everything found goes into the hand, even past the limit of 6 (approved rule): the limit is
  // settled only when the turn ends (endTurnNow -> the discard screen). The reveal says nothing about
  // it: the hand fan shows "Cards 8/6 · discard 2 at end of turn" the moment the reveal closes.
  const found = res?.cards || [];
  const pickup = !!res?.pickup;
  const then = () => { ackResult(res?.id); refresh(); };
  // Search results are PRIVATE: the others learn only that a search happened (the public log). The
  // found cards are shown large on the player's own screen, on a light backdrop with the room still in
  // view (only the player looks at this screen), each kind with its one short line (src/ui/handoff.js).
  handoff.privateFound(player, {
    kicker: `You search ${where}`,
    title: !found.length ? 'Nothing here' : `${pickup ? 'You pick up' : 'You found'} ${foundPhrase(found)}`,
    cards: found,
    soft: true,
  }, then);
  if (found.length) sfx('cardFound', { delay: 0.55 });
}

// What was found, in a few words: "a Lantern", "2 Lanterns", "a Bandage and a Knife". A big pile off the
// floor (a guest's dropped hand) is just counted, so the title stays short.
function foundPhrase(cards) {
  if (cards.length > 3) return `${cards.length} cards`;
  const counts = new Map();
  for (const c of cards) counts.set(c.type, (counts.get(c.type) || 0) + 1);
  return andList([...counts].map(([type, n]) => {
    const name = CARDS[type]?.name ?? type;
    return n === 1 ? aCard(type) : `${n} ${name.endsWith('fe') ? `${name.slice(0, -2)}ves` : `${name}s`}`;
  }));
}

// The search icon (or its furniture) was tapped: search it from where the guest stands — they do not
// walk to it (docs/GAME_RULES.md > Turn), they only turn to face it. The same search as always, for 1
// action. A refusal is explained where the tap was.
function onSearchSpot() {
  if (!running || state.finished || uiBusy() || pendingArrival || activeMover().walking) return;
  if (!myTurn() || !inActionPhase) return;
  const player = activePlayer(state);
  const gate = canSearch(state, floor, player);
  if (!gate.ok) { hud.toast(SEARCH_FAIL[gate.reason] || 'Cannot search now.'); return; }
  hud.hideConfirm(); selectedMove = null;
  const spot = searchSpotOf(floor.rooms.get(player.currentRoom));
  if (spot) faceTowards(spot.center);
  onSearch();
}

// The furniture the icon rests on was tapped: the same as tapping the icon. In an Infirmary or the Switchboard that
// furniture is where the room's own action is (those rooms are not searched); anywhere else it is the search.
function onSpotTap() {
  const job = floor.rooms.get(activePlayer(state).currentRoom)?.job;
  if (job === 'infirmary' || job === 'switchboard') onRoom(); else onSearchSpot();
}

// Turn the active guest to look at a point (the furniture they search).
function faceTowards([x, z]) {
  const m = activeMover();
  if (Math.hypot(x - m.x, z - m.z) > 0.05) m.heading = Math.atan2(x - m.x, z - m.z);
}

function onUseBandage(cardId) {
  if (!myTurn() || !inActionPhase) return;
  after(act({ k: 'card', type: 'bandage', card: cardId }), r => {
    if (!r.ok) { hud.toast(r.reason === 'full' ? 'Already at full health.' : r.reason === 'ap' ? 'No actions left.' : 'Cannot use that now.'); return; }
    hud.toast(`Bandaged — health ${me().health} of ${rules.maxHealth}.`);
    sfx('bandage');
    refresh();
  });
}

const doorBarricaded = name => `The ${name} door is barricaded: a key or pick cannot get you through it until the barricade comes down.`;

// A Master Key or Lock Pick on the locked door of room `roomId` (1 action): from the hand's Open button, or from the
// choice card the padlock opens (onLockTap). The rules settle it (useUnlock); then the door shows the outcome
// (roomView.js playUnlock): opened, the padlock pops open and the door swings (its sound after the unlock cue the public
// event plays), snapped, the padlock shakes and the door stays shut (the lockFail cue is that same event's).
function onUnlock(cardId, roomId) {
  if (!myTurn() || !inActionPhase) return;
  const type = me().hand.find(c => c.id === cardId)?.type ?? 'lockPick';
  after(act({ k: 'card', type, card: cardId, target: roomId }), r => {
    const name = floor.rooms.get(roomId)?.name ?? 'locked room';
    if (!r.ok) {
      hud.toast(r.reason === 'ap' ? 'No actions left.'
        : r.reason === 'sealed' ? doorBarricaded(name)
          : 'Cannot use that here.');
      return;
    }
    // (opened, or the pick snapped: what the table now shows — the door open until the end of the turn, or still locked)
    const opened = state.openLocks.has(roomId);
    const doorway = doorBetween(floor, me().currentRoom, roomId)?.id;
    hud.toast(opened ? `The ${name} door is open until the end of your turn.`
      : `The lock pick snapped. The ${name} door stays locked.`);
    hand.close();
    syncViews(false); refresh();
    doorways.playUnlock(doorway, opened);
    if (opened) sfx('doorOpen', { delay: 0.45 });
  });
}

// The padlock of a locked door (or that door) was tapped by the guest standing next to it (tapTarget 'lock'): the same
// cards as the hand's Open button, chosen on the door itself. A guest holding neither is told what opens it. Otherwise
// the choice card asks which to use: one button for each kind held, and Not now, so a tap meant for something else never
// spends a card. A barricaded door and a turn with no action left are refused here, plainly, with nothing spent.
function onLockTap(roomId) {
  if (!myTurn() || !inActionPhase || uiBusy()) return;
  const player = activePlayer(state);
  if (!adjacentLockedRooms(state, floor, player).includes(roomId)) return;
  const room = floor.rooms.get(roomId);
  const door = doorBetween(floor, player.currentRoom, roomId);
  hud.hideConfirm(); selectedMove = null;
  const held = new Map();                       // one card of each kind held (the choice is a kind, not a card)
  for (const c of player.hand) if (CARDS[c.type]?.unlock && !held.has(c.type)) held.set(c.type, c.id);
  if (!held.size) { hud.toast(moveRefusal({ reason: 'locked' }, room, player), 4); sfx('doorLocked'); return; }
  if (door && isBarricaded(state, door.id)) { hud.toast(doorBarricaded(room.name), 4); sfx('deny'); return; }
  if (player.actionPoints < rules.actionCost.useCard) { hud.toast('No actions left.'); sfx('deny'); return; }
  // (the sure one first)
  const options = [...held].map(([type, cardId]) => ({ type, cardId })).sort((a, b) => (b.type === 'masterKey') - (a.type === 'masterKey'));
  lockChoice.open({ roomId, roomName: room.name, options, cost: actionsWord(rules.actionCost.useCard), warn: lockWarning(state, player, roomId), anchor: lockPoint(roomId) });
  sfx('doorLocked', { volume: 0.6 });
}

// Where the padlock of a locked room's door is on screen (the choice card sits near it), or null. `part: 'door'`: the
// shut door itself, low on it (tests).
function lockPoint(roomId, part = 'sign') {
  const v = [...doorways.views.values()].find(w => w.kind === 'open' && w.lockRoom === roomId);
  if (!v || !v.mark.visible) return null;
  const rect = view.renderer.domElement.getBoundingClientRect();
  const p = part === 'door' ? v.leaf.userData.leaf.getWorldPosition(new THREE.Vector3()).setY(0.45).project(view.camera) : v.mark.position.clone().project(view.camera);
  return p.z < 1 ? { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height } : null;
}

function onBarricade(cardId, doorwayId) {
  if (!myTurn() || !inActionPhase) return;
  after(act({ k: 'card', type: 'barricade', card: cardId, target: doorwayId }), r => {
    if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No actions left.' : 'Cannot barricade that.'); return; }
    hud.toast(`${cap(doorName(doorwayId, activePlayer(state).currentRoom))} barricaded until your next turn.`, 5);
    hand.close();
    syncViews(false); refresh();
  });
}

// Espresso (free): extra action points for this turn only.
function onEspresso(cardId) {
  if (!myTurn() || !inActionPhase) return;
  const before = me().actionPoints;
  after(act({ k: 'card', type: 'espresso', card: cardId }), r => {
    if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No actions left.' : 'Cannot use that now.'); return; }
    hud.toast(`Espresso — ${me().actionPoints - before} extra actions this turn.`);
    sfx('espresso');
    refresh();
  });
}

// Hand Mirror (1 action): another guest in the room shows the user their whole hand. What it shows
// is PRIVATE and goes on the user's own screen; the others learn only that the mirror was used, and on
// whom (the public log).
const MIRROR_FAIL = {
  ap: 'No actions left.',
  noTarget: 'Choose another guest in this room.',
  targetDead: 'That guest is dead.',
  notTogether: 'That guest is not in this room any more.',
};
function onHandMirror(cardId, targetId) {
  if (!myTurn() || !inActionPhase) return;
  // Not mid-walk: walking into a room with a guest starts a meeting first, before anything else.
  if (activeMover().walking || pendingArrival) { hud.toast('Wait until you have arrived.'); return; }
  const player = activePlayer(state);
  const had = resultIds();
  after(act({ k: 'card', type: 'handMirror', card: cardId, target: targetId }), r => {
    if (!r.ok) { hud.toast(MIRROR_FAIL[r.reason] || 'Cannot use that now.'); return; }
    showMirror(player, newResult('mirror', had), targetId);    // (the table's private result: whose hand, and what was in it)
  });
}
// A Hand Mirror's private result on the player's own screen.
function showMirror(player, res, targetId = null) {
  if (res) netShown.add(res.id);
  const target = state.players[res?.target] ?? state.players.find(q => q.id === targetId);
  const seen = res?.hand || [];
  hand.close();
  refresh();
  const lines = seen.some(c => c.type === 'possession')
    ? [player.possessed
      ? `${target.name} holds a Possession card — ${target.name} is possessed too.`
      : `${target.name} holds a Possession card — ${target.name} is POSSESSED. Now you know.`]
    : [];
  handoff.privateHand(player, {
    kicker: `Hand Mirror · private — ${player.name} only`,
    title: `${target.name}'s hand`,
    sub: `${target.name} shows you every card they carry. Nobody else sees this.`,
    cards: seen,
    lines,
  }, () => { ackResult(res?.id); refresh(); });
}

// A room with a job (src/data/hotel.js `job`). The Infirmary heals (once per match, for the whole table: the first guest to
// use it spends it for everyone); the Switchboard tells the whole table how many guests are possessed right now, never who
// (2 actions, as often as the guest can pay). Each has its own icon on its furniture (src/ui/searchSpot.js, kinds 'heal' and
// 'switchboard'); a refused tap says why here and spends nothing. A Linen Store's job is in the search.
const ROOM_FAIL = {
  full: () => 'You are at full health.',
  spent: () => 'This Infirmary has already been used.',
  ap: job => (job === 'switchboard' ? `The Switchboard needs ${actionsWord(rules.actionCost.switchboard)}.` : 'No actions left.'),
  noJob: () => 'There is nothing to use in this room.',
};
const roomRefusal = r => (ROOM_FAIL[r.reason] || (() => 'Cannot use this room now.'))(r.job);
function switchboardLine(n) {
  if (n === 0) return 'No guest is possessed right now.';
  return `${n} ${n === 1 ? 'guest is' : 'guests are'} possessed right now — it doesn't say who.`;
}
// The Exit icon in the Fire Exit was tapped (src/ui/searchSpot.js, kind 'exit'): leave the hotel — the escape
// the rules allow (a clean guest carrying the Lanterns, for 1 action), the very one a computer guest uses. If the
// rules refuse, a short line says what is missing and nothing is spent. The icon is there for every guest in the
// Fire Exit and the words never depend on the role, so a tap tells nobody (and no screen) who is possessed.
function onEscape() {
  if (!running || state.finished || uiBusy() || pendingArrival || activeMover().walking) return;
  if (!myTurn() || !inActionPhase) return;
  const player = activePlayer(state);
  if (!floor.rooms.get(player.currentRoom)?.isExit) return;
  after(act({ k: 'escape' }), r => {
    if (r.ok) { syncViews(false); refresh(); showEnd(); return; }
    hud.toast(escapeRefusal(player, r.reason));
  });
}
// What a tap on the grey Exit icon says. No actions left is the same for everyone. Otherwise one sentence for
// every guest the exit stays shut for, with their own Lantern count: a clean guest short of Lanterns and a
// possessed one holding enough read the same words, and neither is told why. (Practice has no roles: it says
// plainly what is missing.)
function escapeRefusal(player, reason) {
  if (reason === 'ap') return 'No actions left.';
  const need = rules.lanternsToEscape, have = lanternCount(player.hand);
  return state.practice ? `You need ${need} Lanterns to leave. You have ${have}.`
    : `Only a clean guest with ${need} Lanterns can leave. You have ${have}.`;
}

// The icon in an Infirmary or the Switchboard was tapped (or the furniture it stands on): the room's action, from where the
// guest stands, for its cost. The rules settle it (useInfirmary / useSwitchboard); a refusal says why and spends nothing.
function onRoom() {
  if (!running || state.finished || uiBusy() || pendingArrival || activeMover().walking) return;
  if (!myTurn() || !inActionPhase) return;
  const player = activePlayer(state);
  const gate = canUseRoom(state, floor, player);
  if (!gate.ok) { hud.toast(roomRefusal(gate)); return; }
  if (gate.job === 'infirmary') {
    after(act({ k: 'job' }), r => {
      if (!r.ok) { hud.toast(roomRefusal({ job: gate.job, ...r })); return; }
      hud.toast(`Treated in the Infirmary — health ${me().health} of ${rules.maxHealth}.`);
      refresh();     // (the icon turns to its "already used" look at once, for this Infirmary is spent for everyone)
    });
  } else if (gate.job === 'switchboard') {
    after(act({ k: 'job' }), r => {
      if (!r.ok) { hud.toast(roomRefusal({ job: gate.job, ...r })); return; }
      // (how many: the public event the whole table saw)
      const count = state.events.filter(e => e.type === 'switchboard').pop()?.count ?? 0;
      refresh();
      // PUBLIC, for every guest: it stays up until the player taps Continue (the clock waits).
      // Practice: nobody else is in the hotel, so there is nobody to count — say what it does in a match.
      overlays.showNotice('The Switchboard', PRACTICE
        ? 'You rang the Switchboard. In a match it tells everyone how many guests are possessed. You are alone in the hotel, so there is nobody to count.'
        : `You rang the Switchboard. ${switchboardLine(count)}`, refresh);
    });
  }
}

// --- End of the match ----------------------------------------------------------------------
// How the match ended, from the table's end of it (view.end, DESIGN §6.1: the result, dawn, and every guest's role,
// whether they lived and got out, revealed once the match is over). The end screen, Your record and the music read it;
// the achievements read the whole history it brings (applyView puts it in the screens' events and the player's inbox).
// (Shown before the table has ended it, from the tests' hook: the match as the screens know it.)
function endOf() {
  if (state.end) return state.end;
  return { won: state.won, dawn: !!state.dawn, reveal: state.players.map(p => ({
    seat: p.index, possessed: !!p.possessed, convertedBy: p.convertedBy ?? null, alive: !!p.alive, escaped: !!state.escaped?.has(p.id) })) };
}
function showEnd() {
  if (!DIRECT && !online()) matchMarker.clear();         // (the match ended: it is not one the browser cut short)
  stopTimer();
  if (discard.isOpen) discard.close();      // (a discard screen open as the match ends goes; the stopped clock discards nothing)
  meetingLive = false;
  hud.hideConfirm(); selectedMove = null;
  endMusic();
  if (state.practice) {
    overlays.showEnd('You reached the Fire Exit',
      `Practice complete: ${rules.lanternsToEscape} Lanterns carried out.\n${floor.roomList.length} rooms of the hotel revealed, on round ${state.round}.`,
      { keepExploring: false, restartLabel: 'Restart practice' });
    countRecord({ practice: true });
    countHonours();
    return;
  }
  const end = endOf();
  const role = new Map(end.reveal.map(r => [r.seat, r]));
  const yours = role.get(humanSeat) || {};
  const out = end.reveal.filter(r => r.escaped).map(r => state.players[r.seat]).filter(Boolean);
  const cleanWon = end.won === 'humans';
  const yourSideWon = cleanWon !== !!yours.possessed;
  const name = p => (p.index === humanSeat ? 'You' : p.name);
  // What happened, in a line or two; then every guest's role revealed (the match is over).
  let title, line;
  if (cleanWon) {
    title = out.some(p => p.index === humanSeat) ? 'You got out!' : 'The guests got out';
    line = `${andList(out.map(name))} escaped carrying ${rules.lanternsToEscape} Lanterns.`;
  } else if (end.dawn) {
    title = 'Dawn breaks';
    line = `Round ${rules.roundLimit} has ended and nobody got out. The hotel keeps them.`;
  } else {
    title = 'The hotel keeps them';
    line = 'No clean guest is left.';
  }
  // (the plain word for the player's side, Victory or Defeat, sits above the title; the summary says who won)
  const winners = END_WORDS.winners(cleanWon);
  const reveal = state.players.map(p => ({
    name: p.name,                                   // (the username; your own row is marked "You")
    who: p.index === humanSeat ? 'You' : '',
    color: p.color,
    possessed: !!role.get(p.index)?.possessed,
    status: role.get(p.index)?.escaped ? 'Escaped' : !role.get(p.index)?.alive ? 'Dead' : '',
    you: p.index === humanSeat,
    player: p,                                      // (their face in the row: the normal portrait, never the red-eyed one)
  }));
  // (who was possessed first, and whom they possessed: the roles as the end reveals them)
  const revealed = { players: state.players.map(p => ({ ...p, possessed: !!role.get(p.index)?.possessed, convertedBy: role.get(p.index)?.convertedBy ?? null })) };
  overlays.showEnd(title, `${line}\n${winners} · ${roundLabel(state)}`, {
    restartLabel: 'Play again', reveal, won: yourSideWon,
    verdict: yourSideWon ? END_WORDS.victory : END_WORDS.defeat,       // (whether or not you are alive or got out)
    recap: endRecap(revealed, humanSeat),
  });
  // (Co-op: the table's own end buttons; its matches count nowhere yet, TP7)
  if (online()) { netEndButtons(); return; }
  countRecord({ won: yourSideWon, possessed: !!yours.possessed, escaped: !!yours.escaped });
  countHonours();
}
// Your record (src/record.js): each finished game is counted once, when its end screen shows (it can
// show again for the same game; Play again and Restart practice deal a new one, a new gameToken). A
// match left early is counted as left early instead (backToMenu). Then the quiet line under the result.
let countedGame = -1;
function countRecord(result) {
  if (countedGame !== gameToken) {
    countedGame = gameToken;
    if (result.practice) record.countPractice(); else record.countMatch(result);
  }
  showEndRecord(document, result);
}
// Achievements (src/honours.js): checked once per game, here on the end screen only (never during a match), from the
// rules' own events and your own finds (src/matchSummary.js: practice, test links and idle matches earn nothing); an
// item earned goes into your profile (account.grant), and a quiet line under the record says so.
let honouredGame = -1, honoured = [];
// An achievement saved as earned whose item never reached the profile (it was read-only in this tab, or the save
// failed) is granted again: at start-up and on every end screen. grant() adds an item once, so this is safe to repeat.
function regrantHonours() {
  try {
    const earned = honours.get().earned || {};
    for (const a of ACHIEVEMENTS) if (earned[a.id] && account.profile && !account.owns(a.item)) account.grant(a.item).catch(() => {});
  } catch (err) { console.warn('achievement items could not be checked:', err); }
}
regrantHonours();
function countHonours() {
  if (honouredGame !== gameToken) {
    honouredGame = gameToken;
    honoured = [];
    regrantHonours();
    try {
      honoured = honours.evaluate(matchSummary(state, humanSeat, { found: foundThisGame, testLink: TEST_LINK }));
      for (const a of honoured) account.grant(a.item).catch(() => {});
    } catch (err) { console.warn('achievements could not be checked:', err); }
  }
  showEndHonours(document, honoured, { body: account.profile?.avatar?.body });
}

// A fresh hotel and a fresh deal for the guests at the table now.
// (`net`: a Co-op match's table, src/net/onlineTable.js: dealt by the server, presented here from its view)
function resetWorld(net = null) {
  gameToken++;
  foundThisGame = [];
  if (net) {
    if ((table ?? lastTable)?.kind === 'local') (table ?? lastTable).leave();
    table = lastTable = net;
    netReset();
    onTableChange(net, { view: net.view, events: net.received, fresh: true });    // (the screens' state and hotel)
  } else {
    seed = newSeed();
    (table ?? lastTable)?.leave();
    const t = newTable(seed);                // a new random hotel and a new deal, at a new table (src/net/localTable.js)
    table = lastTable = t;
    t.on(change => onTableChange(t, change));
    t.onChat(hearChat(t));
    syncTable();                             // (the screens' state and hotel: the new match)
  }
  clearRoomViews(roomViews, view.scene);
  releaseTileTextures();                   // (the old hotel's room light maps leave the graphics chip)
  doorways.reset();
  rebuildGrid();
  movers.forEach((m, i) => { m.reset(startSpot(i)[0], startSpot(i)[1]); m.speedScale = 1; });
  pendingArrival = null; selectedMove = null; activeWalk = null; walkCutShort = false; queuedTap = null;
  meetingLive = false; talk = null; outNoticeShown = false; lockNews = ''; skipQueued = false;
  // (the page has caught up with the new table: its first turn on screen, no news yet)
  tableNews = false; localNews = []; healthBefore.clear(); attackSeen = null;
  seenO = state.eventSeq; shown = turnNow();
  inActionPhase = PRACTICE;
  fan.reset();
  fog.reset();
  discovery.refresh();
  syncViews(false);
  rig.setFocus(...followPoint(), true);
  rig.reset();
  mood.snap(activePlayer(state).currentRoom);
  overlays.hideEnd(); overlays.hideNotice(); overlays.hideAsk(); hand.close(); map.close();
  discard.close(); handoff.close(); meeting.close(); hud.hideConfirm();
  stopTimer();
  feed.reset(!PRACTICE);
  feed.skip(state);
  chat.reset(!PRACTICE && settings.get('chat') !== 'off');
  refresh();
}

// A new table for the game being set up (src/net/localTable.js): it deals (a new random hotel, the cards, the hidden
// role) and seats the computer guests and their chatter, with the page's own seeds.
function newTable(seed) {
  const botSeats = botProfiles.map((profile, index) => (profile ? { index, profile } : null)).filter(Boolean);
  return tableModule.createLocalTable({
    roster: cast, humanSeat, seed, practice: PRACTICE, possessedIndex: roleChoice, botSeats,
    clockOn: rules.turnTimerEnabled, paceScale: botPaceScale, chat: settings.get('chat') !== 'off', hotelData: hotel, cfg,
    referee: true,                         // (the table's referee runs the game: Practice from P1C S3, every match from S4)
  });
}
let roleChoice = null;                     // the seat the player chose to be possessed (or clean), for the next table

// The end screen's main button, and Restart practice: practice starts again in a new hotel; a match
// becomes a new match at a new table with the same choices (how many guests, your role).
function restart() {
  if (online()) { netRestart(); return; }
  if (PRACTICE) {
    audio.stopStinger();          // (from the end screen: the win jingle stops, as in playAgain / backToMenu)
    resetWorld();
    if (running) hud.toast('Practice restarted.');
    return;
  }
  playAgain();
}

// --- Main menu, the lift, and starting a game ----------------------------------------------------
// The page opens on the main menu over the lobby (src/menu/lobbyScene.js, blurred behind it). Play
// with bots: choose the table, watch it fill, then the manager takes guests up in the lift, the screen
// goes black and the game opens. Practice alone: the same lift, one guest. A direct link (?mode=)
// skips the menu.
let phase = 'menu';          // 'menu' (the lobby behind the menu) | 'intro' (the lift) | 'game'
let lobby = null;            // the lobby scene, once it has loaded (or null: the menu shows over the hotel)
let lobbyReady = false;
let lastChoice = { practice: true };
let botModules = null;       // src/bots/profiles.js (the computer guests' names and looks), loaded the first time a match is set up
let tableModule = null;      // src/net/localTable.js (and the computer guests' brains it seats), loaded when a game is set up
const LIFT_MAX_MS = 9000;    // the lift sequence normally takes about 5 s
const fadeEl = document.getElementById('fade');
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => r()));

// Black over everything (on) or not (off), easing over `ms`.
async function fade(on, ms) {
  fadeEl.style.setProperty('--fade-ms', `${ms}ms`);
  if (on) { fadeEl.hidden = false; await frame(); fadeEl.classList.add('on'); }
  else { fadeEl.classList.remove('on'); }
  await wait(ms + 30);
  if (!on) fadeEl.hidden = true;
}

async function loadBots() {
  if (!botModules) {
    const profiles = await import('./bots/profiles.js');
    botModules = { profiles };
  }
  return botModules;
}
async function loadTable() {
  tableModule ||= await import('./net/localTable.js');
  return tableModule;
}

// Who sits where, who the computer guests are, and who starts possessed — like joining a random online
// table: a random seat, random bots. `choice`: { practice: true } or { bots: 3-5, role }. Every seat is
// a player (src/table.js): you as your profile (name and avatar), each bot as its username and its own
// avatar (rolled from its name: src/data/randomAvatar.js, never the match's random numbers). The six
// named guests (Victor, Clara …) stay in the menu's lobby. `seats` (also `cast`): in seat order.
// (the "Clearer possessed eyes" setting: on this device only, the whole match shows brown and hazel eyes as classic
// dark eyes, so the possessed red stands out for a colour-blind player: src/data/wardrobe.js displayAvatar)
const shownHere = seats => {
  const clearEyes = settings.get('clearEyes') === 'on';
  return seats.map(s => ({ ...s, avatar: displayAvatar(s.avatar, { clearEyes }) }));
};
async function planGame(choice) {
  portraits.resume();                      // (a game is coming: its portraits must be drawn)
  await loadTable();
  const mine = myIdentity();
  if (choice.practice) {
    const seats = shownHere(seatTable({ me: mine, seat: 0 }));
    return { practice: true, seats, cast: seats, humanSeat: 0, profiles: [null], possessedIndex: null, choice };
  }
  const mods = await loadBots();
  const n = Math.max(rules.minBots, Math.min(rules.maxBots, Math.round(choice.bots) || rules.maxBots)) + 1;
  const rng = makeRng(Number.isFinite(forcedSeed) && forcedSeed > 0 ? (forcedSeed * 7919 + 13) >>> 0 : ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0) || 1);
  // (the 5 draws that shuffled the six named guests before are still drawn, so a ?seed= keeps its seat,
  // its bots and its possessed seat)
  for (let k = 0; k < 5; k++) rng();
  const askedSeat = parseInt(params.get('seat'), 10);
  const seat = Number.isFinite(askedSeat) ? Math.max(0, Math.min(n - 1, askedSeat)) : Math.floor(rng() * n);
  const rolled = mods.profiles.rollProfiles(n - 1, rng, { avoid: [mine.username] });   // (never your name)
  const looks = botAvatars(rolled.map(p => p.username), { avoid: [mine.avatar] });
  const seats = shownHere(seatTable({ me: mine, bots: rolled.map((p, k) => ({ username: p.username, avatar: looks[k] })), seat }));
  preloadAvatars(seats.map(s => s.avatar));    // (every bot's pieces download together, during the lift)
  const profiles = seats.map((_, i) => (i === seat ? null : rolled.shift()));
  let possessedIndex = null;                                   // random, dealt by the rules
  if (choice.role === 'possessed') possessedIndex = seat;
  else if (choice.role === 'clean') {
    const others = seats.map((_, i) => i).filter(i => i !== seat);
    possessedIndex = others[Math.floor(rng() * others.length)];
  }
  return { practice: false, seats, cast: seats, humanSeat: seat, profiles, possessedIndex, choice };
}

// Each guest's own soul-card face (src/ui/soulFace.js) is drawn ahead: the player's own first, behind the
// black screen (setupGame, then waited for briefly before the game shows), the others' once the game has
// faded in, a quarter of a second apart, so drawing them never lands on the fade or the role screen.
let ownSoul = null;
const ownSoulDrawn = () => Promise.race([ownSoul, wait(800)]);
function soulsRest() {
  if (!PRACTICE) prepareSoulCards(cast.filter((_, i) => i !== humanSeat).map(g => g.id), { gapMs: 250 });
}

// Seat the table and deal a new game (no screens: the caller shows them).
function setupGame(plan) {
  holdHotel = false;                       // (this game's guests and rooms load now: castCharacters, resetWorld)
  PRACTICE = plan.practice;
  lastChoice = plan.choice || { practice: true };
  cast.length = 0; cast.push(...plan.cast);
  humanSeat = plan.humanSeat;
  botProfiles = plan.profiles;
  applyMode(PRACTICE ? 'practice' : 'match', cast.length);
  if (TIMER_OFF) rules.turnTimerEnabled = false;
  roleChoice = plan.possessedIndex;
  movers.length = 0;
  cast.forEach((_, i) => movers.push(createPlayer(cfg, startSpot(i))));
  castCharacters();
  usePracticeWording(PRACTICE);
  ownSoul = PRACTICE ? null : prepareSoulCards([cast[humanSeat].id]);   // (the player's own soul-card face first: soulsRest)
  table = null;
  hud.rebuild();
  resetWorld();                            // (the new table: the deal, the computer guests and their chatter)
  if (!PRACTICE) movers.forEach((m, i) => { m.speedScale = isBot(i) ? botWalkScale() : 1; });
  document.title = PRACTICE ? 'Hotel Escape — Practice' : `Hotel Escape — ${cast.length} guests`;
  refresh();
}

// --- Warm-up ---------------------------------------------------------------------------------------
// The first time a door opens (a room tile), a room is searched (its tick), a door is locked or
// barricaded, or the player is possessed (red eyes), the graphics chip has to build the shaders for it,
// and the game froze for a moment right then. Instead, at the start of a game, behind the black screen
// (or the "Tap to begin" card), one of each is drawn once out of sight, so those shaders are ready before
// play begins. Once per visit: they are kept. What it needs (the smallest tile, the Fire Exit's) is
// loaded early, so nothing waits for it.
let warmGroup = null, warmPrep = null, warmDone = false, warmSettled = false;
let warmEyes = -1, eyesWarm = false;            // (the seat whose guest wears red eyes for the warm-up)
function prepareWarmUp() {
  warmPrep ||= warmTile(roomDressings.exit).then(tile => {
    const g = new THREE.Group();
    g.name = 'warm-up';
    g.add(tile, ...searchMarks.warmObjects(), ...doorways.warmObjects(), ...halos.warmObjects());
    g.position.set(0, -500, 0);                 // far below the floor: out of sight, but still drawn
    g.traverse(o => { o.frustumCulled = false; });
    warmGroup = g;
  }).catch(err => { console.warn('warm-up skipped:', err?.message || err); }).finally(() => { warmSettled = true; });
  return warmPrep;
}
async function warmUp(maxWaitMs = 1500, { eyes = false } = {}) {
  if (!warmDone) await warmScene(maxWaitMs);
  // The red eyes of a guest who becomes possessed mid-match (src/render/possessedLook.js: one shader for
  // every guest), worn for three frames by the player's own guest — only behind the black screen.
  if (eyes && !eyesWarm) {
    const cv = characters[humanSeat];
    const until = performance.now() + maxWaitMs;
    while (cv && !cv.debug().loaded && performance.now() < until) await wait(100);
    if (cv?.debug().loaded) {
      warmEyes = humanSeat;
      await frame(); await frame(); await frame();
      warmEyes = -1;
      eyesWarm = true;
    }
  }
  // The active guest is drawn after its own floor ring (src/render/characterView.js drawFront), with its own shader
  // variant: worn for two frames by the player's own guest, every game (a new table may have let go of the guests
  // that had it built), so the first turn that changes hands never stalls.
  const own = characters[humanSeat];
  const until = performance.now() + maxWaitMs;
  while (own && !own.debug().loaded && performance.now() < until) await wait(100);
  if (own?.debug().loaded) { own.warmFront(true); await frame(); await frame(); own.warmFront(false); }
}
async function warmScene(maxWaitMs) {
  await Promise.race([prepareWarmUp(), wait(maxWaitMs)]);
  if (!warmGroup) return;                       // (not loaded in time: tried again at the next game)
  view.scene.add(warmGroup);
  // (with KHR_parallel_shader_compile the shaders build in the background first; without it they build
  // during the draws below — behind the black screen either way)
  try {
    if (view.renderer.extensions.has('KHR_parallel_shader_compile')) await view.renderer.compileAsync(warmGroup, view.camera, view.scene);
    else view.renderer.compile(warmGroup, view.camera, view.scene);
  } catch { /* drawn below anyway */ }
  await frame(); await frame(); await frame();  // (drawn: shaders linked, its textures uploaded)
  view.scene.remove(warmGroup);
  warmDone = true;
}

// From the menu into the game: the lift (unless switched off), black, the game, the lights come up.
async function enterGame(plan, { guests = 3, net = null } = {}) {
  prepareWarmUp();
  menu.leave();
  phase = 'intro';
  audio.setScene('intro');
  applyPixelRatio();
  container.classList.remove('blurred');
  if (INTRO && lobbyReady && lobby) {
    // (never longer than LIFT_MAX_MS: on a struggling device the scene runs slow, and the game must not wait)
    // (your own avatar, standing by the lift, boards first: alone in practice, with Victor and Clara in a match)
    try { await Promise.race([lobby.enter({ guests, onCue: name => sfx(name) }), wait(LIFT_MAX_MS)]); } catch (err) { console.warn('the lift sequence failed:', err); }
  } else await wait(400);
  audio.setScene('none');          // (the lobby music goes with the picture)
  await fade(true, 650);
  menu.hide();
  if (net) setupCoop(net); else setupGame(plan);
  phase = 'game';
  view.compile();
  await warmUp(1500, { eyes: true });
  // (a game started before the menu's lobby had loaded: its starting room may still be on its way —
  // wait a little for it behind the black screen rather than show the grey placeholder)
  await Promise.race([new Promise(r => { const t = () => (dressingDone ? r() : setTimeout(t, 100)); t(); }), wait(3000)]);
  await ownSoulDrawn();
  await frame(); await frame();
  begin();
  if (PRACTICE) {
    overlays.showNotice('Practice',
      `You are alone in the hotel. You start with ${rules.lanternsDealtEach} Lantern — find ${rules.lanternsToEscape - rules.lanternsDealtEach} more and escape through the Fire Exit.`, refresh);
  }
  sfx('fadeIn');
  await fade(false, 900);
  soulsRest();
}

async function startPractice() {
  const plan = await planGame({ practice: true });
  enterGame(plan, { guests: 1 });
}

async function startBots(choice) {
  let plan;
  try { plan = await planGame({ bots: choice.bots, role: choice.role }); } catch (err) {
    console.error('could not load the computer guests:', err);
    overlays.showError('The computer guests could not be loaded. Check the internet connection and reload.');
    return;
  }
  // (the player went back, or started something else, while the computer guests were loading)
  if (phase !== 'menu' || menu.screen !== 'bots') return;
  // (the matchmaking list: you first, then the others as they "join", each by username and seat colour)
  const seats = [humanSeatFirst(plan)].concat(plan.seats.map((s, i) => ({ i, s })).filter(x => x.i !== plan.humanSeat).map(x => ({
    username: x.s.name, color: x.s.color, avatar: x.s.avatar, you: false,
  })));
  portraits.prepare(tablePortraits(plan));     // (the table's portraits, drawn while it fills up)
  audio.prefetch('game', { decode: false });   // (the night music's download, while the table fills up and the lift rises)
  menu.matchmake(seats, { onFull: () => enterGame(plan, { guests: 3 }), onCancel: () => {} });
}
// Every seat's two portraits, normal and possessed (a soul card's face, an ally's red eyes): drawn ahead,
// during matchmaking and the lift, never in the first seconds of play.
const tablePortraits = plan => plan.seats.flatMap(s => [s.avatar, { avatar: s.avatar, possessed: true }]);
function humanSeatFirst(plan) {
  const s = plan.seats[plan.humanSeat];
  return { username: s.name, color: s.color, avatar: s.avatar, you: true };
}

// Play again (a match): a new table with the same choices, straight in (no menu, no lift).
async function playAgain() {
  const plan = await planGame(lastChoice.practice ? { practice: true } : lastChoice);
  if (!plan.practice) portraits.prepare(tablePortraits(plan));
  audio.stopStinger();
  await fade(true, 450);
  setupGame(plan);
  await warmUp(1500, { eyes: true });
  await ownSoulDrawn();
  begin();
  await frame();
  await fade(false, 700);
  soulsRest();
}

// Back to the main menu (from the end screen or the Menu button).
// (`screen`: the menu screen it opens on; Co-op's "Back to the table" opens the waiting room)
async function backToMenu({ screen = 'main' } = {}) {
  if (!DIRECT) matchMarker.clear();         // (left on purpose, from the Menu, the end screen or the problem card: not one the browser cut short)
  // (a match left before its end: counted as left early, never as a win or a loss)
  if (!PRACTICE && !online() && phase === 'game' && !state.finished && countedGame !== gameToken) { countedGame = gameToken; record.countLeft(); }
  audio.stopStinger();
  await fade(true, 450);
  gameToken++;
  running = false;
  phase = 'menu';
  audio.setScene('menu');
  stopTimer();
  hud.hide();
  overlays.hideEnd(); overlays.hideNotice(); overlays.hideAsk(); overlays.hideStart();
  gameMenu.close({ restoreFocus: false });
  hand.close(); map.close(); discard.close(); handoff.close(); meeting.close(); hud.hideConfirm();
  feed.reset(false);
  chat.reset(false);
  // (the tags over the hotel — "Go · 1 AP", "Explore", names, speech bubbles — go too: the menu's frames
  // no longer place them, so whatever showed last would stay over the menu and the lift)
  screenTags.begin(); screenTags.end();
  movers.forEach(m => m.halt());
  meetingLive = false; talk = null;
  if (online()) netAway();
  table = null;                          // (no computer guests think or talk behind the menu)
  if (lobbyReady) releaseTileTextures();  // (the menu shows the lobby scene: the hotel's maps are not drawn)
  lobby?.reset();
  linkUser = null;                       // (the menu plays as the profile its card shows)
  applyPixelRatio();
  container.classList.add('blurred');
  menu.show(screen);
  document.title = 'Hotel Escape';
  await fade(false, 700);
}

// --- Screen ↔ ground plane ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitA = new THREE.Vector3();
const hitB = new THREE.Vector3();
const tapBox = new THREE.Box3();

function screenToGround(x, y, out = hitA) {
  const rect = view.renderer.domElement.getBoundingClientRect();
  ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  return raycaster.ray.intersectPlane(ground, out) ? out : null;
}

function groundToScreen(x, z) {
  const rect = view.renderer.domElement.getBoundingClientRect();
  const v = new THREE.Vector3(x, 0, z).project(view.camera);
  return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height };
}

// --- Tapping the hotel ---------------------------------------------------------------------
// The guest never walks around inside a room (docs/GAME_RULES.md > Turn): the player acts by tapping
// ROOMS. What a tap points at is what is under the finger, as the player sees it: the nearest standing
// wall or piece of furniture (that room) or else the floor (the room it lies in), or the fogged,
// unknown room beyond a closed door. Walls count at the height they are shown (the cutaway lowers
// some), so a tap on another room's tall far wall means that room, not the floor hidden behind it —
// at any turn of the view. The walls of the guest's OWN room are the exception: a tap there means
// what lies beyond (the room or fog behind that wall), since the room they stand in is not a place
// to go. The piece of furniture that holds the search spot of their own room is the other exception:
// tapping it searches it (docs/GAME_RULES.md > Turn: tap a room's furniture to search it), the same as
// tapping the magnifier over it.
//   { kind: 'room', id }        a revealed room
//   { kind: 'search' }          the search spot's furniture in the guest's own room
//   { kind: 'lock', id }        the padlock, or the shut door, of the locked room `id` next to the guest
//   { kind: 'fog', key, doors } a fogged room: the closed doors that lead into it
//   { kind: 'jammed', door }    the empty space behind a jammed door
function tapTargetAt(x, y) {
  const rect = view.renderer.domElement.getBoundingClientRect();
  ndc.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, view.camera);
  const ray = raycaster.ray;
  const g = ray.intersectPlane(ground, hitA);
  let best = g ? ray.origin.distanceTo(g) : Infinity, hitRoom = null, hitPiece = null;
  const tryBox = (minX, minZ, maxX, maxZ, h, roomId, piece = null) => {
    if (h < 0.05) return;
    tapBox.min.set(minX, 0, minZ); tapBox.max.set(maxX, h, maxZ);
    const p = ray.intersectBox(tapBox, hitB);
    if (!p) return;
    const d = ray.origin.distanceTo(p);
    if (d < best - 1e-4) { best = d; hitRoom = roomId; hitPiece = piece; }
  };
  const here = activePlayer(state).currentRoom;
  for (const rv of roomViews.values()) {
    if (!rv.group.visible) continue;
    const k = easeOutCubic(rv.revealT), id = rv.room.id;
    if (id !== here) for (const w of rv.walls) tryBox(w.wall.min[0], w.wall.min[1], w.wall.max[0], w.wall.max[1], Math.max(cfg.cutaway.stubHeight, w.height) * k, id);
    for (const f of rv.room.furniture) tryBox(f.min[0], f.min[1], f.max[0], f.max[1], f.size[1] * k, id, f);
  }
  // The padlock sign (drawn over everything) or the shut door of a locked room next to the guest, whichever the tap is on;
  // the door only when nothing stands in front of it (src/render/roomView.js pickLock).
  const next = adjacentLockedRooms(state, floor, activePlayer(state));
  const lock = next.length ? doorways.pickLock(raycaster, view.camera, rect, x, y, next) : null;
  if (lock && lock.distance < best) return { kind: 'lock', id: lock.room };
  if (hitRoom === here && hitPiece?.search) return { kind: 'search' };
  if (hitRoom) return { kind: 'room', id: hitRoom };
  if (!g) return null;
  const id = roomAt(floor, g.x, g.z);
  if (id) return { kind: 'room', id };
  const [i, j] = cellOf(floor, g.x, g.z);
  const fogged = fogCells(floor).get(`${i},${j}`);
  if (fogged) return { kind: 'fog', key: fogged.key, doors: fogged.doors };
  const jam = floor.frontier.find(d => d.jammed && d.cell[0] === i && d.cell[1] === j);
  return jam ? { kind: 'jammed', door: jam } : null;
}

// Tap a fogged room: if one of the doors into it is a door of the active guest's room, it opens at
// once (1 AP, no question asked: the guest stays where they are). Tap a revealed room: the guest is
// offered the walk there (Move · N AP), to be confirmed. Tap their own room: nothing to do there but
// search (the magnifier) or use its job — a short hint says so.
function tapTarget(t, { queued = false } = {}) {
  const player = activePlayer(state);
  if (t.kind === 'search') { if (!queued) onSpotTap(); return; }
  if (t.kind === 'lock') { if (!queued) onLockTap(t.id); return; }
  if (t.kind === 'fog') {
    // (your own door into it is jammed — even if another room's door into it is not: say so)
    const mine = floor.rooms.get(player.currentRoom)?.frontier.find(d => `${d.cell[0]},${d.cell[1]}` === t.key);
    if (mine?.jammed) { hud.toast(DOOR_FAIL.jammed); return; }
    const door = t.doors.find(d => d.room === player.currentRoom);
    if (!door) { hud.toast('Walk to the room next to it first.'); return; }
    hud.hideConfirm(); selectedMove = null;
    onOpenDoor(door.id);
    return;
  }
  if (t.kind === 'jammed') {
    if (t.door.room === player.currentRoom) hud.toast(DOOR_FAIL.jammed);
    return;
  }
  if (t.kind !== 'room') return;
  if (t.id === player.currentRoom) {
    hud.hideConfirm(); selectedMove = null;
    if (!queued) hud.toast(`You are in the ${floor.rooms.get(t.id)?.name ?? 'room'}. Tap another room to go there.`);
    return;
  }
  offerMove(t.id);
}

// Why a walk to `dest` cannot be made (plan.reason from the rules: moves.planRoomMove).
function moveRefusal(plan, dest, player) {
  const next = doorBetween(floor, player.currentRoom, dest.id);
  if (plan.reason === 'locked') {
    return next ? 'That door is locked. A Master Key or Lock Pick used here opens it for the rest of your turn.'
      : `The ${dest.name} is locked. A Master Key or Lock Pick, used from the room next to it, opens its door.`;
  }
  if (plan.reason === 'barricaded') return next && isBarricaded(state, next.id) ? 'That doorway is barricaded.' : `A barricade is in the way to the ${dest.name}.`;
  if (plan.reason === 'notEnoughActionPoints') {
    return player.actionPoints <= 0 ? 'Not enough actions — none left this turn.'
      : `Not enough actions: the ${dest.name} is ${plan.cost} rooms away (${actionsWord(plan.cost)}).`;
  }
  return `There is no way through to the ${dest.name} right now.`;
}

// Offer the walk to room `destId`: the fewest-rooms route there (1 AP per room entered) to a free
// standing spot in its middle, shown as a dotted path, an outline round the room the walk ends in and a
// cost tag, with the Move / Cancel bar. If a meeting is forced in a room on the way, the walk ends there
// (the rules plan it so: planRoomMove) and the bar says so; a meeting waiting in the room it ends in is
// named on the bar too.
function offerMove(destId) {
  const player = activePlayer(state);
  const dest = floor.rooms.get(destId);
  if (!dest) return;
  const plan = discovery.planToRoom(destId, standAtFor(player.index));
  if (!plan.ok) {
    hud.hideConfirm(); selectedMove = null;
    if (plan.reason !== 'finished' && plan.reason !== 'dead') { hud.toast(moveRefusal(plan, dest, player), 4); sfx(plan.reason === 'locked' ? 'doorLocked' : 'deny'); }
    return;
  }
  const end = plan.waypoints[plan.waypoints.length - 1];
  plan.preview = { label: `Move · ${actionsWord(plan.cost)}`, anchor: end, room: floor.rooms.get(plan.dest) };
  selectedMove = plan;
  const who = plan.meet.map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
  // (a guest waiting in the room the walk ends in forces a meeting there too: say so before the tap)
  const there = plan.stop ? [] : encountersIn(state, floor, player, plan.dest).map(q => q.name);
  const note = plan.stop ? ` You will stop in the ${floor.rooms.get(plan.stop).name} to meet ${andList(who)}.`
    : there.length ? ` You will meet ${andList(there)} there: a meeting is forced.` : '';
  hud.showConfirm(`Move to ${dest.name}?${note}`, `Move · ${actionsWord(plan.cost)}`);
}

// Set off on a confirmed walk (the player's, or a computer guest's). The view comes back to the guest
// so the walk can be followed (on another guest's turn, only if the view follows them: Settings).
function startWalk(plan) {
  if (online()) { netMove(plan); return; }
  if (table && !isBot(state.activeIndex)) {
    const r = table.local.apply({ k: 'move', to: plan.target ?? plan.dest });
    if (!r.ok) { const dest = floor.rooms.get(plan.target ?? plan.dest); if (dest) hud.toast(moveRefusal(r, dest, me()), 4); return; }
  }
  walkFigure(plan);
}
// The active guest's figure sets off on a plan (the table has allowed the walk, or is asked: netMove).
function walkFigure(plan) {
  activeWalk = plan;
  walkCutShort = false;
  if (focusIndex() === state.activeIndex) rig.recentre({ zoom: false });
  discovery.go(plan);
}

// A free standing spot in a revealed room: the first of the room's standing spots (src/data/hotel.js
// standingSpots — the middle first, then round it, wide enough apart that guests sharing a room never
// hide one another) where a figure can stand (moves.standable: its footprint clear of walls and
// furniture), not on or beside another guest and not on a body lying there.
function standingSlot(roomId, forIndex) {
  const room = floor.rooms.get(roomId);
  const [cx, cz] = room.center;
  const others = movers.filter((m, i) => i !== forIndex && state.players[i].alive && !state.escaped?.has(state.players[i].id));
  const occupied = (x, z) => others.some(m => Math.hypot(m.x - x, m.z - z) < 1.0) || onABody(x, z);
  for (const [ox, oz] of hotel.standingSpots) {
    const x = cx + ox, z = cz + oz;
    if (standable(grid, roomId, x, z) && !occupied(x, z)) return { x, z };
  }
  return { x: cx, z: cz };
}

// The standing spot for guest `index` in any room (what planRoomMove asks for).
const standAtFor = index => roomId => { const s = standingSlot(roomId, index); return [s.x, s.z]; };
// The active guest as a walk is planned for them (discovery.planToRoom): the player's own record holds their action
// points; a computer guest's never reach the screens, and the table has already allowed its walk (its walk news, a walk
// cut short), so action points are not what the figure's path is planned by.
const walker = p => (p.index === humanSeat ? p : { ...p, actionPoints: Infinity });

// Bodies on the floor. A guest who dies falls on their back: feet where they stood, head about a
// body length behind them (src/render/characterView.js setDead turns the figure about its feet, and
// it keeps the heading it had). Standing spots keep clear of the whole length.
const BODY_LEN = 1.75;
function segmentDistance(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + t * vx), pz - (az + t * vz));
}
const bodyEnds = (m, heading = m.heading) => [m.x, m.z, m.x - Math.sin(heading) * BODY_LEN, m.z - Math.cos(heading) * BODY_LEN];
function onABody(x, z, clear = 0.6) {
  return state.players.some((q, i) => !q.alive && !state.escaped?.has(q.id) && segmentDistance(x, z, ...bodyEnds(movers[i])) < clear);
}
// A guest has just died: turn them (before they fall) so the body lands on free floor of their room,
// clear of the living guests there — the direction they faced if that works, else the nearest one
// that does.
function layBodyClear(index) {
  const m = movers[index];
  const roomId = state.players[index].currentRoom;
  const living = movers.filter((o, j) => j !== index && state.players[j].alive && state.players[j].currentRoom === roomId);
  const onFloor = (x, z) => { const c = grid.cellAt(x, z); return c >= 0 && grid.walkable[c] && grid.roomIdOf(c) === roomId; };
  let best = null, bestGap = -1;
  for (let k = 0; k < 16; k++) {
    const h = m.heading + Math.ceil(k / 2) * (k % 2 ? 1 : -1) * (Math.PI / 8);
    const [ax, az, bx, bz] = bodyEnds(m, h);
    if (![0.5, 0.95].every(f => onFloor(ax + (bx - ax) * f, az + (bz - az) * f))) continue;
    const gap = Math.min(9, ...living.map(o => segmentDistance(o.x, o.z, ax, az, bx, bz)));
    if (gap >= 0.75) { best = h; break; }
    if (gap > bestGap) { bestGap = gap; best = h; }
  }
  if (best != null) m.heading = best;
}

// Open a closed door of the active guest's room (1 AP): the room behind it is revealed and the
// guest stays put. The new room is empty, so nothing else happens.
const DOOR_FAIL = {
  jammed: 'The door is jammed shut — there is no way through here.',
  ap: 'No actions left to open a door.',
  notYourDoor: 'You can only open a door of the room you are in.',
};
function onOpenDoor(doorId) {
  if (!running || state.finished || !myTurn()) return;
  const player = activePlayer(state);
  const rooms = floor.roomList.length;
  after(act({ k: 'open', door: doorId }), r => {
    if (!r.ok) { hud.toast(DOOR_FAIL[r.reason] || 'That door will not open.'); refresh(); syncViews(false); return; }
    // (the room behind it: the one the table placed, as the screens' copy of the hotel now holds it)
    const room = floor.roomList[rooms] || floor.roomList.at(-1);
    const locked = state.lockedRooms.has(room.id);
    rebuildGrid();
    discovery.refresh();
    syncViews(true);
    refresh();
    // Ease the view so the guest's room and the room just revealed are both in view (it may lie behind
    // the room's far wall or under the interface otherwise).
    const rect = q => [q.min[0], q.min[1], q.max[0], q.max[1]];
    rig.showRooms([rect(floor.rooms.get(player.currentRoom)), rect(room)]);
    hud.toast(room.isExit ? `The door opens onto the ${room.name}!`
      : `The door opens: ${room.name}${locked ? ' — locked' : ''}${room.dark ? ' — dark' : ''}.`);
  });
}

// A tap on a ROOM made while the guest is still walking (or just arriving) is kept and answered as soon
// as they stand still — it only asks (Move / Cancel), so nothing is spent unasked: a player often taps
// the next room as the guest reaches this one. Only in the same turn, and anything that opens meanwhile
// (a meeting, a card) drops it. A tap on a fogged room or the search spot is NOT kept (each would spend
// an action at once, after the player has moved on): "Wait until you arrive."
let queuedTap = null;   // { target, turn }

// Taps that land just beside the interface are ignored: a finger that misses a button by a few pixels
// must not open a door (which costs an action at once, with no question). The dead zone is every part
// of the interface that is showing — the guest strip, the room name and round, the panel, the WHOLE box
// of the hand fan (between and above its tilted cards too), the buttons, End turn, the Move/Cancel bar,
// a toast, the search icon — grown by DEAD_ZONE px.
const DEAD_ZONE = 18;
const TAP_GUARD = ['.hud-top-left', '.hud-top-center', '.hud-top-right', '#player-panel', '#hand-fan', '#hand-fan .fan-card',
  '#hand-fan .fan-limit', '.hud-bottom-right', '#btn-end-turn', '#confirm-bar', '#toast', '.search-spot .ss-badge, .search-spot .ss-caption',
  '.path-label', '#tip'];
function inDeadZone(x, y) {
  const cr = container.getBoundingClientRect();
  const px = x - cr.left, py = y - cr.top;
  return interfaceRects(document, container, TAP_GUARD, DEAD_ZONE).some(q => px >= q.l && px <= q.r && py >= q.t && py <= q.b);
}
function replayQueuedTap() {
  if (!queuedTap || activeMover().walking || activeMover().path.length || pendingArrival) return;
  const q = queuedTap;
  queuedTap = null;
  if (uiBusy() || state.finished || q.turn !== state.turn) return;
  if (!myTurn() || !inActionPhase) return;
  tapTarget(q.target, { queued: true });
}

createInput(view.renderer.domElement, {
  onTap(x, y) {
    if (chat.swallowTap()) return;     // (a tap that closes the chat panel does nothing else)
    if (tips.swallowTap()) return;     // (nor the second tap of a double tap on a tip's button)
    if (gameMenu.swallowTap() || overlays.swallowTap()) return;     // (nor on the Menu panel or the Leave question closing)
    if (lockChoice.swallowTap()) return;     // (nor the second tap of a double tap on the lock choice, landing on the door)
    if (!running || state.finished || uiBusy()) return;
    if (!myTurn() || !inActionPhase) return;
    if (inDeadZone(x, y)) return;
    const t = tapTargetAt(x, y);
    if (!t) return;
    if (activeMover().walking || activeMover().path.length || pendingArrival) {
      if (t.kind === 'room') queuedTap = { target: t, turn: state.turn };
      else if (t.kind === 'fog' || t.kind === 'search' || t.kind === 'lock') { queuedTap = null; hud.toast('Wait until you arrive.'); }
      return;
    }
    queuedTap = null;
    tapTarget(t);
  },
  onPinch(factor) { if (running) { rig.zoomBy(factor); camTouchedIn = gameToken; } },
  onDrag(fromX, fromY, toX, toY) {
    if (!running) return;
    camTouchedIn = gameToken;
    const a = screenToGround(fromX, fromY, hitA);
    const b = screenToGround(toX, toY, hitB);
    if (a && b) rig.panByWorld(a.x - b.x, a.z - b.z);
  },
  onWheel(deltaY) { if (running) { rig.zoomBy(Math.exp(-deltaY * 0.0015)); camTouchedIn = gameToken; } },
  onGestureEnd() { rig.release(); },
});

hud.on('rotateLeft', () => { rig.rotateLeft(); camTouchedIn = camButtonIn = gameToken; });
hud.on('rotateRight', () => { rig.rotateRight(); camTouchedIn = camButtonIn = gameToken; });
// "Centre on me": back to the active guest, at the standard zoom.
function onCentre() { if (running) rig.recentre(); }
hud.on('centre', () => { onCentre(); camTouchedIn = camButtonIn = gameToken; });
hud.on('endTurn', doEndTurn);
hud.on('trade', onTrade);
hud.on('private', () => { if (running && !uiBusy()) hand.open(state, floor); });
hud.on('map', () => { if (!meeting.isOpen && !discard.isOpen && !overlays.endOpen && !handoff.isOpen) map.toggle(state, movers); });
// The Menu button opens the Menu panel (src/ui/gameMenu.js: Resume, Sound, How to play, Leave); its Leave asks the
// question below, after which the game in progress is lost. On the end screen the button still goes straight back
// to the main menu. While a screen of the game is up (or a meeting is live) it does nothing, as it always did.
// The clock: unchanged. The question held it still (askUp), and so does the panel that now comes first.
hud.on('leave', () => {
  if (overlays.endOpen) { if (online()) leaveCoop(); else backToMenu(); return; }
  if (uiBusy() || meetingLive) return;
  gameMenu.open();
});
function askLeave() {
  if (online()) { const w = ONLINE_TEXT.dialogs.leaveMatch; overlays.ask(w.title, w.line, { yes: w.buttons[1], no: w.buttons[0], safe: 'no' }, () => leaveCoop()); return; }
  overlays.ask(PRACTICE ? 'Leave practice?' : 'Leave the match?',
    PRACTICE ? 'This hotel and everything you have found will be lost.' : 'The others will carry on without you. This match will be lost.',
    { yes: 'Main menu', no: 'Keep playing', safe: 'no' }, backToMenu);
}
hud.onConfirm(
  () => {
    if (!selectedMove) return;
    const chosen = selectedMove;
    selectedMove = null; hud.hideConfirm();
    startWalk(chosen);
  },
  () => { selectedMove = null; hud.hideConfirm(); },
  () => doEndTurn({ ask: false }),      // (End turn, answered: the question was "You still have 3 actions. End turn?")
);
overlays.onRestart(restart);
overlays.onMenu(() => (online() ? leaveCoop() : backToMenu()));
// Restart practice throws the whole hotel away, so it asks first (from the end screen it does not:
// the match is over).
hud.on('restartPractice', () => {
  if (overlays.endOpen) { restart(); return; }
  if (uiBusy()) return;
  overlays.ask('Restart practice?', 'This hotel and everything you have found will be lost, and you start again in the lobby of a new hotel.',
    { yes: 'Restart', no: 'Keep playing', safe: 'no' }, restart);
});

// --- Music and sound -------------------------------------------------------------------------------
// src/audio/: the music of each scene (the lobby waltz in the menu and the lift, the night ambience in
// a game, the final-round piece in round 8, a stinger on the end screen) and every sound cue
// (src/audio/bus.js). The hotel's own sounds - doors, searches, attacks, footsteps - come from the
// engine's PUBLIC events (src/audio/gameSounds.js), so the game code needs no sound calls for them.
const audio = createAudio({ settings });
const gameSounds = createGameSounds({
  state,
  humanSeat: () => humanSeat,
  positionOf: i => (movers[i] ? [movers[i].x, movers[i].z] : null),
  listener: () => rig.centre,
  panOf: (x, z) => { const sp = groundToScreen(x, z); return innerWidth > 0 ? (sp.x / innerWidth) * 2 - 1 : 0; },
  mover: i => movers[i],
  walkPhase: i => { const d = characters[i]?.debug?.(); return d?.model && d.loaded ? { phase: d.walkPhase, stride: d.strideLength } : null; },
  // (an attack the player is in shows on the meeting screen, which plays its own blow: src/ui/meeting.js)
  skipAttack: e => e.by === humanSeat || e.target === humanSeat,
});
// From this round on, the four end fanfares are downloaded ahead (about 590 KB, bytes only, nothing decoded): a match runs
// six rounds at the median and can end sooner, so fetching them only in round 7 left most matches to fetch at the end.
const ENDING_FROM_ROUND = 3;
function syncSound() {
  const playing = running && phase === 'game';
  gameSounds.update(playing);
  if (!playing || state.finished) return;
  audio.setScene(!PRACTICE && isFinal(state) ? 'final' : 'game');
  if (PRACTICE) return;
  if (state.round >= ENDING_FROM_ROUND) audio.prefetchEnding();
  if (state.round >= rules.roundLimit - 1) audio.prefetch('final');      // (decoded ahead: the last round's music)
}
// The end screen: the round's music gives way to a stinger, from the player's side of the table (dawn
// tolls its bell first).
function endMusic() {
  if (audio.scene === 'end') return;              // (the end screen shown again: one stinger is enough)
  audio.setScene('end');
  const lead = state.escaped?.size ? 0.9 : 0.2;     // (an escape's door and night air go first)
  if (state.practice) { sfx('win', { delay: lead }); return; }
  const end = endOf();
  const you = end.reveal.find(r => r.seat === humanSeat);
  const yourSideWon = (end.won === 'humans') !== !!you?.possessed;
  const side = yourSideWon ? (you?.possessed ? 'winPossessed' : 'win') : 'lose';
  if (end.dawn) { sfx('dawn'); sfx(side, { delay: 3.2, volume: 0.8 }); } else sfx(side, { delay: lead });
}

// --- Start: the main menu, or a direct link --------------------------------------------------------
const menu = createMenu(document, {
  account,                         // (no profile yet: the menu opens on "Sign the register")
  onPlayBots: choice => startBots(choice),
  onPractice: choice => startPractice(choice),
  onSettingChanged: name => applySettings(name),
  onScreenChange: (name, prev) => onMenuScreen(name, prev),
  onHowToPlay: opts => howTo.open(opts),
  onCards: opts => cardsGuide.open(opts),
  onCoopMatch: (coop, info) => startCoopMatch(coop, info),     // (Co-op: a match dealt at the table, section "Co-op")
  onCoopSeat: (i, coop) => netSeatSwitch(i, coop),             // (the review link: the other seat's screen, in a match)
});
// The Wardrobe (src/ui/wardrobe/wardrobe.js, the menu's 'avatar' screen): every pick shows at once on your
// avatar in the lobby, which the lobby's wardrobe camera frames in the middle of the screen's stage, sharp
// (not blurred), close up or full length as the area asks; Save look keeps it (account.setAvatar), Cancel
// puts back the look you came in with. The Hotel Honours page (src/ui/honours.js) opens from its top bar and
// from the end screen's achievement line.
const avatarEditor = createWardrobe(document, {
  account, honours,
  onPreview: av => lobby?.setPlayerAvatar(av),
  onDone: () => menu.show('main'),
  onRename: () => menu.showRename(),
  onShot: shot => { if (wardrobeOpen) lobby?.setWardrobe(true, { centreX: wardrobeCentre(), shot }); },
  onTurn: (yaw, opts) => lobby?.turnWardrobe?.(yaw, opts),
  onHonours: ({ at } = {}) => honoursPage.open({ at, from: 'wardrobe' }),
  preload: list => preloadAvatars(list),
  portraitUrl: av => portraits.url(av),
});
const honoursPage = createHonoursPage(document, { honours, account, onTryOn: id => avatarEditor.tryOn(id) });
document.getElementById('end-honours')?.addEventListener('click', e => { e.preventDefault(); honoursPage.open({ from: 'end' }); });
let wardrobeOpen = false;
// (the middle of the wardrobe's stage, between its rail of areas and its panel of options)
function wardrobeCentre() {
  const r = document.getElementById('wd-stage')?.getBoundingClientRect();
  return r && r.width > 0 ? r.left + r.width / 2 : window.innerWidth * 0.42;
}
function onMenuScreen(name, prev) {
  const open = name === 'avatar';
  if (open) avatarEditor.open();
  else if (prev === 'avatar') avatarEditor.close().then(() => { if (!avatarEditor.isOpen) lobby?.setPlayerAvatar(account.profile?.avatar || null); });
  // (Change name, from the wardrobe: the camera stays on your avatar and the lobby stays sharp, so the
  // register comes and goes without the camera flying out to the lobby and back)
  const framing = open || (name === 'signup' && (prev === 'avatar' || wardrobeOpen));
  if (framing === wardrobeOpen) return;
  wardrobeOpen = framing;
  lobby?.setWardrobe(framing, { centreX: wardrobeCentre(), shot: avatarEditor.shot });
  if (phase === 'menu' && !DIRECT) { container.classList.toggle('blurred', !framing); applyPixelRatio(); }
}
window.addEventListener('resize', () => { if (wardrobeOpen) lobby?.setWardrobe(true, { centreX: wardrobeCentre() }); });
// Your avatar in the lobby follows your profile (a new name or look, another tab), except while the
// wardrobe shows the one being chosen.
account.onChange?.(p => {
  // (the profile gone — another tab cleared the site's data — while the menu shows: the register first)
  if (!p && menu.screen && menu.screen !== 'signup') menu.show('main');
  if (!avatarEditor.isOpen) lobby?.setPlayerAvatar(p?.avatar || null);
  // (a new player, signed up after the lobby loaded: their portraits' shaders built now, as on a later
  // visit; then, for any new look, both its portraits drawn ahead: the card shows one, a game needs both)
  if (p?.avatar && lobbyReady) warmPortraits(p.avatar);
});
let portraitsWarm = false;
function warmPortraits(av) {
  const both = () => portraits.prepare([av, { avatar: av, possessed: true }]);
  if (portraitsWarm) { both(); return; }
  portraitsWarm = true;
  portraits.prewarm(av).then(() => { portraits.resume(); both(); });
}
// The lobby behind the menu is drawn at a lower resolution (it is blurred anyway: cheaper on the iPad);
// the lift sequence and the game use the Graphics setting (and so does the wardrobe, sharp on your avatar).
const MENU_PIXEL_RATIO = 0.75;
function gamePixelRatio() { return settings.choice('graphics')?.pixelRatio ?? cfg.render.maxPixelRatio; }
function applyPixelRatio() { view.setPixelRatio(phase === 'menu' && !DIRECT && !wardrobeOpen ? Math.min(MENU_PIXEL_RATIO, gamePixelRatio()) : gamePixelRatio()); }
function applySettings(name = null) {
  if (!name || name === 'graphics') applyPixelRatio();
  if (name === 'music' || name === 'sound') audio.applySettings();
  if (name === 'botSpeed' && table && !PRACTICE) movers.forEach((m, i) => { if (isBot(i)) m.speedScale = botWalkScale(); });
}
applySettings();

// The words of the private-hand link and the card view's lock follow the game: practice has nobody to
// hide a hand from.
const privateBtn = document.getElementById('btn-private');
function syncPracticeLabels() {
  if (privateBtn) privateBtn.textContent = '▸ My cards';
  document.querySelector('#hand-overlay .lock')?.setAttribute('hidden', '');
}
syncPracticeLabels();

if (DIRECT) {
  // A direct link: the "Tap to begin" card for that game (no menu, no lift).
  phase = 'game';
  const sub = document.getElementById('start-sub');
  const dealt = rules.lanternsDealtEach || 0;
  const n = Math.max(rules.minBots, Math.min(rules.maxBots, parseInt(params.get('bots'), 10) || rules.maxBots));
  const role = ['random', 'clean', 'possessed'].includes(params.get('role')) ? params.get('role') : 'random';
  if (sub) {
    sub.textContent = DIRECT === 'practice'
      ? `Practice · explore the hotel alone\nYou start with ${dealt} Lantern — find ${rules.lanternsToEscape - dealt} more and escape through the Fire Exit`
      : `A match · you and ${n} computer guests · one is secretly possessed`;
  }
  overlays.showStart();
  // (you play as your profile, or ?user= for this visit, or 'Guest': a direct link never shows the register;
  // the account is waited for first, as a server account will need)
  const planned = account.ready.then(() => planGame(DIRECT === 'practice' ? { practice: true } : { bots: n, role }));
  planned.then(async plan => {
    setupGame(plan);
    // (the portraits' shaders, then every seat's portraits, behind the "Tap to begin" card)
    await portraits.prewarm(myIdentity().avatar);
    if (!plan.practice) portraits.prepare(tablePortraits(plan));
    await warmUp(5000); await ownSoulDrawn(); soulsRest(); startReady = true; maybeReady();
  })
    .catch(err => { console.error(err); overlays.showError('The game could not be set up. Try again.', { detail: String(err?.message || err).split('\n')[0].slice(0, 200) }); });
  overlays.onBegin(() => { if (startReady) begin(); });
} else {
  // (the account first: a server account has no profile until it is ready, and the menu sends anyone
  // without one to the register)
  const openMenu = () => { menu.show('main'); noteLostMatch(); };
  account.ready.then(openMenu, openMenu);
  audio.setScene('menu');          // (heard from the first tap: browsers allow no sound before one)
  container.classList.add('blurred');
  import('./menu/lobbyScene.js')
    .then(mod => {
      lobby = mod.createLobbyScene({ renderer: view.renderer, cfg });
      lobby.setSize(view.size.w, view.size.h);
      // (your avatar by the lift; the wardrobe's camera if that screen is already open)
      lobby.setPlayerAvatar(avatarEditor.isOpen ? avatarEditor.avatar : account.profile?.avatar || null);
      if (wardrobeOpen) lobby.setWardrobe(true, { centreX: wardrobeCentre(), shot: avatarEditor.shot });
      return lobby.ready;
    })
    .then(() => {
      lobbyReady = !!lobby; releaseHotel(); prepareWarmUp();
      // (your portraits, normal and possessed, drawn in the menu: the card shows one, a game needs both;
      // the portraits start once their shaders are built)
      const mine = account.profile?.avatar;
      if (mine) warmPortraits(mine); else portraits.resume();
    })
    .catch(err => { console.warn('The lobby behind the menu could not be loaded; the menu shows over the hotel instead.', err); lobby = null; releaseHotel(); portraits.resume(); });
}
let startReady = !DIRECT;
let framesReady = false;
function maybeReady() {
  if (!framesReady || !startReady) return;
  overlays.setReady();
  menu.setReady();
}

// --- Initial state -----------------------------------------------------------------------
syncViews(false);
rig.setFocus(...followPoint(), true);
mood.snap(activePlayer(state).currentRoom);
hud.update(state, floor);
view.compile();


// --- Game loop ---------------------------------------------------------------------------
let last = performance.now();
let frames = 0;
const lobbySize = { w: 0, h: 0 };
let lastLobby = performance.now();
let stillKey = '', stillAt = 0;     // what the 'Still' menu background last drew (size, pixel ratio), and when
// Every step of a frame runs through crash.step (src/ui/crash.js): a step that throws is skipped for that
// frame and the rest still run, above all the picture itself ('render'), so a failing decoration never
// freezes the hotel; only a step that keeps failing, frame after frame, brings up the "Something went
// wrong" card. The names are the steps' names in that card's small print.
view.renderer.setAnimationLoop(now => crash.step('frame', frameLoop, now));
function frameLoop(now) {
  const step = crash.step;
  step('stats', () => perfStats.frame(now - last));
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  const prevLobby = lastLobby; lastLobby = now;
  // The main menu and the lift: the lobby scene (once loaded; until then, the hotel itself shows,
  // blurred, behind the menu).
  if (phase !== 'game' && lobbyReady && lobby) { lobbyFrame(now, dt, time, prevLobby); return; }
  step('table', pullFrame);    // (a test hook handed out the real game: the screens catch up before anything reads)
  if (running && !state.finished) {
    step('clock', () => tickClock(now, dt));
    step('walk', () => {
      activeMover().update(dt);
      discovery.update();
      if (pendingArrival && !activeMover().walking && activeMover().path.length === 0) onArrive();
      // (a walk the table was told of that ended without crossing into a room: it is over all the same)
      else if (!pendingArrival && table?.local?.walking() && !activeMover().walking && !activeMover().path.length) table.local.arrived();
    });
    step('queued tap', replayQueuedTap);
    step('bots', () => tickBots(now));
  } else if (running && online()) step('table', () => follow());     // (Co-op: the view that ended the match came between frames)
  step('auto end', () => tickAutoEnd(now));      // (after the walk: an arrival and its meeting have started by now)
  // The lock choice stays only while it is still the player's own action phase (the clock may run out, the match end).
  step('lock choice', () => { if (lockChoice.isOpen && !(running && myTurn() && inActionPhase)) lockChoice.close(); });
  step('camera', () => { rig.setFocus(...followPoint()); rig.update(dt); });
  step('rooms', () => { for (const rv of roomViews.values()) rv.update(dt); });
  step('doorways', () => doorways.update(time, dt, roomViews));
  step('path', () => pathPreview.update(selectedMove && hud.confirmOpen && !activeMover().walking ? selectedMove : null, time));
  step('fog', () => fog.update(floor, me(), { time, dt, held: heldAt }));
  step('mood', () => { const fi = focusIndex(); mood.update(state.players[fi].currentRoom, dt, time, movers[fi]); });
  step('cutaway', () => updateCutaway(roomViews, rig, state, cfg, dt));
  // Red eyes on the player's own guest, on their own screen, while possessed — and then also on every
  // guest they KNOW is possessed (approved; src/ui/allies.js); never in practice, and not on the old game
  // still drawn behind the menu (when the menu's lobby scene is not loaded).
  // (warmEyes: three frames behind the black screen at the start of a game, see warmUp)
  step('guests', () => {
    const allies = redEyedAllies(state, me());
    characters.forEach((cv, i) => { cv.setPossessed(i === warmEyes || (phase === 'game' && !PRACTICE && (i === humanSeat ? !!state.players[i]?.possessed : allies.has(state.players[i]?.id)))); cv.setMisted(mistAt(movers[i].x, movers[i].z)); cv.update(movers[i], dt); });
  });
  step('lamps', () => halos.update(roomViews, rig.camera));   // (after the camera, the rooms, the mood and the cutaway: this frame's walls and bulbs)
  step('render', () => view.render());
  step('hand', syncHandFan);
  step('search icon', syncSearchSpot);     // after the render, so it reads this frame's camera
  step('feed', () => { if (running) { feed.sync(state, PRACTICE ? null : me()); feed.tick(); feed.place(topLeftEl); } });
  step('chat', () => syncChat(now));
  step('tips', () => tips.update(now));
  step('sound', syncSound);
  step('tags', placeTags);
  if (++frames >= 2 && !framesReady) { framesReady = true; maybeReady(); }
}
// The tags over the view, most important first (a later tag that would clash is left out): when zoomed
// far out, the active guest's name (so they can always be found); Explore over the fogged rooms next
// door; Go over the rooms next door (not when zoomed far out: the names take over); then the other
// guests' names; last, quick chat's speech bubbles. Each kind is a step of its own, and the frame's tags
// are always closed (screenTags.end) whatever one of them does.
function placeTags() {
  const step = crash.step;
  const still = !activeMover().walking && !activeMover().path.length && !pendingArrival;
  const tagsOk = actionPhaseClear() && !hand.isOpen && still;
  const namesOk = running && !handoff.isOpen && !overlays.endOpen && !map.isOpen;
  screenTags.begin();
  try {
    step('tags: names', () => guestTags.update(screenTags, state, movers, rig.distance, namesOk, 'active'));
    if (tagsOk) step('tags: explore', () => fog.tags(screenTags, me().actionPoints));
    step('tags: go', () => goTags.update(screenTags, state, floor, me(), tagsOk && !hud.confirmOpen && rig.distance <= cfg.camera.tagsFrom, heldRoom));
    step('tags: others', () => guestTags.update(screenTags, state, movers, rig.distance, namesOk, 'others'));
    step('tags: chat', () => chat.tags(screenTags, chatPoint, namesOk));      // speech bubbles over whoever just spoke (they give way to every other tag)
  } finally { screenTags.end(); }
}
// The main menu and the lift (the lobby scene): its own steps, and the picture drawn whatever the rest does.
function lobbyFrame(now, dt, time, prevLobby) {
  const step = crash.step;
  if (view.size.w !== lobbySize.w || view.size.h !== lobbySize.h) {
    lobbySize.w = view.size.w; lobbySize.h = view.size.h;
    step('lobby size', () => lobby.setSize(lobbySize.w, lobbySize.h));
  }
  // (the lift keeps to the clock even when frames are slow: up to a quarter of a second per frame)
  const ldt = phase === 'intro' ? Math.min(0.25, Math.max(0, (now - prevLobby) / 1000)) : dt;
  const still = phase === 'menu' && settings.get('menuMotion') === 'off';
  step('lobby', () => lobby.update(still ? 0 : ldt, time));
  // 'Still': the picture does not change, so it is drawn again only on a new size or pixel ratio (and
  // the first frame after switching to Still or coming back from a game), otherwise at most twice a
  // second (the lobby's guests may still be arriving); the canvas keeps the last picture meanwhile.
  if (still) {
    const key = `${view.size.w}x${view.size.h}@${view.renderer.getPixelRatio()}`;
    if (framesReady && key === stillKey && now - stillAt < 500) return;
    stillKey = key; stillAt = now;
  } else stillKey = '';
  step('render', () => view.renderer.render(lobby.scene, lobby.camera));
  if (++frames >= 2 && !framesReady) { framesReady = true; maybeReady(); }
}
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// --- Co-op: a match at a private table (DESIGN §4.5, §14.6, §16) ------------------------------------------------------
// A Co-op match is played at an online table (src/net/onlineTable.js): the server's referee runs it (whole walks at
// once, the server's clock, nothing on this device holds it), and the page presents it through the SAME screens and the
// same presenter state as Single player (applyView, the floor copy: DESIGN §6.6-§6.7). What differs, here and at the
// few `online()` branches above:
//   - a command goes to the server, and its outcome is read once the view after its reply is in (netAct, after());
//   - the player's own walk starts at the tap, on the page's own plan (netMove), and walks back if the server refuses
//     it; the other guests' walks are drawn from their `enter` events (netWalks); every figure not walking stands
//     where the table has its guest (netSnap);
//   - the clock is the view's (view.clock, counted down from its arrival: table.clockLeft; netClock);
//   - questions the page did not ask for itself (the role, a meeting someone walked into, a Fire Exit offer, a screen
//     not read before the review link's seat switch) come with the view and are shown when nothing else is
//     (talkNext, netScreens);
//   - no Skip to the result (TP5); Co-op matches count in neither Your record nor the achievements (TP7);
//   - the review link (?friends=demo) holds two seats: "Show sam's screen" presents the other seat's table, drawn fresh
//     (netSeatSwitch), and offers itself when a question waits there (netOffer).
let coopRun = null;           // the Co-op session on this device: { coops: [the coop of each seat held], demo }
const netHeard = new WeakSet();   // the tables already listened to
const NET_WALK = 1.45;        // the other guests' figures: a room in ONLINE.timing.walkMsPerRoom (8 m at 2.9 m/s × 1.45)
// (a guest the page does not play itself: at a Co-op table everyone but the player, whoever plays them)
const isOther = i => (online() ? i !== humanSeat : isBot(i));
// (the results whose screens pause the player's clock until read: DESIGN §6.4)
const SCREEN_RESULTS = new Set(['found', 'mirror', 'trade', 'noTrade', 'declined', 'notes']);

// A command to the server; it settles once the view after its reply is in (or it could not be sent: 'offline').
function netAct(cmd) {
  const t = table;
  netBusy++;
  return t.send(cmd, { afterView: true })
    .then(r => r || { ok: false, reason: 'offline' }, () => ({ ok: false, reason: 'offline' }))
    .finally(() => { netBusy = Math.max(0, netBusy - 1); });
}
// (a result whose screen is up, or was read)
function netSeen(id) { netShown.add(id); }
// End the turn at the table (once: the last discard passes it by itself).
function netEnd() {
  if (endAsked) return;
  endAsked = true;
  after(act({ k: 'end' }), r => { if (!r.ok) endAsked = false; });
}

// The clock on screen: the table's (whose turn it is, and what is left), counted down between views.
function netClock(now) {
  const c = state.clock;
  if (!c || state.finished || !netBegun) { if (clockShown) stopTimer(); return; }
  const before = timerLeft;
  const left = table.clockLeft(now) ?? 0;
  if (clockShown && left === timerLeft) return;
  timerLeft = left;
  clockShown = true;
  if (c.seat === humanSeat && c.running && timerLeft > 0 && timerLeft <= 10 && Math.ceil(timerLeft) < Math.ceil(before)) sfx('tick', { volume: timerLeft <= 3.5 ? 1 : 0.7 });
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
  if (discard.isOpen) discard.tick(timerLeft);
}

// The start of a Co-op match on screen: the role first (the table starts turn 1 once everyone has read theirs, or after
// a while); a match already under way (a return to the table, the seat switch) goes on from the turn as it stands.
function netBegin() {
  netBegun = false;
  netStarting = false;
  const done = () => {
    roleRead();
    netBegun = true;
    netStarting = state.phase?.kind === 'start' && !state.finished;
    if (!netStarting) { shown = turnNow(); beginTurn(); }
    refresh();
  };
  const a = state.ask;
  if (a?.kind === 'role' && !a.changed) { roleShownFor = a.id; handoff.revealRole(me(), {}, done); return; }
  netBegun = true;
  netStarting = state.phase?.kind === 'start' && !state.finished;
  if (!netStarting) { shown = turnNow(); beginTurn({ resume: true }); }
}

// The other guests' walks, from their public `enter` events: the guest on turn walks the rooms it entered, the way a
// computer guest's walk is drawn in Single player.
function netWalks(events) {
  let seat = null, rooms = null;
  for (const e of events) {
    if (e.type !== 'enter' || e.seat === humanSeat) continue;
    if (seat !== e.seat) { if (rooms) netWalk(seat, rooms); seat = e.seat; rooms = [e.from]; }
    rooms.push(e.to);
  }
  if (rooms) netWalk(seat, rooms);
}
function netWalk(seat, rooms) {
  const p = state.players[seat], m = movers[seat];
  const to = rooms[rooms.length - 1];
  // (not the guest on turn any more, or already somewhere else: the figure is put in place instead, netSnap)
  if (!p || !m || seat !== state.activeIndex || p.currentRoom !== to || !floor.rooms.has(to)) return;
  const plan = discovery.planToRoom(to, standAtFor(seat), { ...p, currentRoom: rooms[0], actionPoints: Infinity });
  if (!plan.ok || plan.dest !== to) return;
  m.speedScale = NET_WALK;
  walkFigure(plan);
  pendingArrival = { online: true };      // (its arrival: a meeting there, onArrive)
}
// Every figure that is not walking stands in the room the table has its guest in (a fresh view, a walk cut off by the
// turn passing, a guest the view moved while nobody watched). The player's own figure waits while a command is out.
function netSnap() {
  state.players.forEach((p, i) => {
    const m = movers[i];
    if (!m || m.walking || m.path.length || state.escaped?.has(p.id)) return;
    if (i === humanSeat && netBusy > 0) return;
    if (!floor.rooms.has(p.currentRoom) || roomAt(floor, m.x, m.z) === p.currentRoom) return;
    const s = standingSlot(p.currentRoom, i);
    m.reset(s.x, s.z);
  });
}

// The player's own walk: the figure sets off at the tap, on the page's own plan, while the table is asked; a refusal
// says why (as in Single player) and the figure walks back.
function netMove(plan) {
  const to = plan.target ?? plan.dest;
  walkFigure(plan);
  pendingArrival = { online: true };
  after(act({ k: 'move', to }), r => {
    if (r.ok) return;
    const dest = floor.rooms.get(to);
    if (dest) hud.toast(moveRefusal(r, dest, me()), 4);
    const p = me(), m = movers[humanSeat];
    m.halt();
    const back = discovery.planToRoom(p.currentRoom, standAtFor(humanSeat), { ...p, actionPoints: Infinity });
    if (back.ok) { activeWalk = back; discovery.go(back); } else { const s = standingSlot(p.currentRoom, humanSeat); m.reset(s.x, s.z); }
  });
}

// What the table asks of the player that no screen of theirs is showing yet: a role to read, the discard, a result not
// read before a seat switch. (Meetings and trades: talkNext.)
function netScreens() {
  if (!running || !netBegun || netStarting || state.finished || netBusy > 0 || talk) return;
  if (handoff.isOpen || tradeReveal.isOpen || meeting.isOpen || discard.isOpen || overlays.noticeOpen || overlays.endOpen || askUp()) return;
  if (pendingArrival || activeMover().walking || activeMover().path.length) return;
  const a = state.ask;
  if (a?.kind === 'role' && a.id !== roleShownFor) {
    roleShownFor = a.id;
    inActionPhase = false;
    handoff.revealRole(me(), a.changed ? { changed: true, by: state.players[a.by]?.name } : {}, () => {
      roleRead();
      if (myTurn() && !state.finished) inActionPhase = true;
      refresh();
    });
    return;
  }
  if (a?.kind === 'discard' && myTurn()) {
    endAsked = true;
    hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
    const seconds = discardAllowance(timerLeft, rules.turnTimerEnabled);
    discardStamp = turnStamp();
    discard.open(me(), passTurn, { seconds });
    return;
  }
  const r = (state.results || []).find(x => (x.kind === 'found' || x.kind === 'mirror') && !netShown.has(x.id));
  if (r) { inActionPhase = myTurn(); if (r.kind === 'found') showFound(me(), r); else showMirror(me(), r); }
}

// A match dealt at a Co-op table (src/ui/coopMenu.js calls it for each seat this device holds; a new table each match).
function startCoopMatch(coop, { seat = 0, demo = false } = {}) {
  const t = coop?.table;
  if (!t?.view || typeof t.on !== 'function') return false;      // (the pretend server's match has nothing to play)
  if (!coopRun || coopRun.demo !== demo) coopRun = { coops: [], demo };
  coopRun.coops[seat] = coop;
  if (!netByeHeard.has(coop)) { netByeHeard.add(coop); coop.on?.('bye', b => netBye(coop, b?.why)); coop.on?.('lobby', lv => netLobby(coop, lv)); }
  netWatch(t);
  netOffer();
  if (seat !== (menu.coopSeat ?? 0) || table === t) return true;     // (the review link's other seat: kept for the switch)
  enterCoop(t).catch(err => { console.error('the Co-op match could not be shown:', err); overlays.showError('The match could not be shown. Go back to the menu.', { title: 'Something went wrong', menu: true }); });
  return true;
}
// Every table of the session is listened to once: the one on screen is presented, the other (the review link's other
// seat) only tells the switch what waits there.
function netWatch(t) {
  if (netHeard.has(t)) return;
  netHeard.add(t);
  t.on(change => { onTableChange(t, change); netOffer(); });
  t.onChat(hearChat(t));
  t.net?.onStatus?.(s => netStatus(t, s));
}
// Into the match: from the menu by the lift, as a match against bots; from the end screen (Play again) by the fade.
async function enterCoop(t) {
  if (phase === 'menu') {
    portraits.resume();
    portraits.prepare(t.view.players.flatMap(p => [p.avatar, { avatar: p.avatar, possessed: true }]));
    await enterGame(null, { guests: 3, net: t });
    return;
  }
  if (phase !== 'game') return;
  audio.stopStinger();
  await fade(true, 450);
  setupCoop(t);
  await warmUp(1500, { eyes: true });
  await ownSoulDrawn();
  begin();
  await frame();
  await fade(false, 700);
  soulsRest();
}
// Seat a Co-op match from its first view: the guests as the table shows them, the player in their own seat.
function setupCoop(t) {
  holdHotel = false;
  PRACTICE = false;
  const v = t.view;
  cast.length = 0;
  cast.push(...shownHere(v.players.map(p => {
    const avatar = normaliseAvatar(p.avatar, { trusted: true });
    return { id: p.id, name: p.name, color: p.color, avatar, outfit: outfitOf(avatar) };
  })));
  humanSeat = v.seat;
  botProfiles = cast.map(() => null);
  applyMode('match', cast.length);
  rules.turnTimerEnabled = v.table?.clockOn !== false;     // (the table's clock: test links change nothing here, TP6)
  roleChoice = null;
  movers.length = 0;
  cast.forEach((_, i) => movers.push(createPlayer(cfg, startSpot(i))));
  castCharacters();
  usePracticeWording(false);
  ownSoul = prepareSoulCards([cast[humanSeat].id]);
  table = null;
  hud.rebuild();
  resetWorld(t);
  movers.forEach((m, i) => { m.speedScale = i === humanSeat ? 1 : NET_WALK; });
  document.body.classList.add('coop-match');
  document.title = `Hotel Escape — ${cast.length} guests`;
  refresh();
}
// (a new Co-op table on screen: nothing of the last one's is waited for)
function netReset() {
  netBusy = 0; endAsked = false; netBegun = true; netStarting = false; roleShownFor = null;
  netShown.clear(); netQueue.clear(); netDownSince = null;
}
// What the table says about the people at it (no `o`: not the game's events): in the feed, with today's words.
const netQueue = createPresentQueue({ maxBacklogMs: 3000 });
function netTableNews(events) {
  const F = ONLINE_TEXT.match.feed;
  for (const e of events || []) {
    if (e?.o != null || e.seat === humanSeat) continue;
    const name = state.players[e.seat]?.name;
    if (!name) continue;
    const line = e.type === 'away' ? byRules(F.dropped, ONLINE_RULES.approved) : e.type === 'back' ? F.back : e.type === 'left' ? byRules(F.left, ONLINE_RULES.approved) : null;
    if (line) feed.say(fill(line, { name }), 'table');
  }
}
// The connection of the table on screen: the pill (coopUI), "You're back at the table." once it is live again after
// the pill showed, the card after 20 s, and the restart notice once a restored match is back.
let netDownSince = null;
const netRestartSeen = new WeakSet();
function netStatus(t, s) {
  if (t !== table) return;
  coopUI.pill(s);
  if (s === 'live') {
    if (netDownSince != null && performance.now() - netDownSince >= ONLINE.timing.reconnectPillMs) hud.toast(ONLINE_TEXT.recovery.back);
    netDownSince = null;
    if (coopUI.cardKind === 'lost') coopUI.hideCard();
    const coop = coopRun?.coops.find(c => c?.table === t);
    if (coop?.restarted && !netRestartSeen.has(coop) && phase === 'game' && !state.finished) { netRestartSeen.add(coop); coopUI.card('restarted', { ok: () => refresh() }); }
    return;
  }
  if (s === 'reconnecting' || s === 'lost') netDownSince ??= performance.now();
  if (s === 'lost' && !coopUI.cardOpen && phase === 'game') coopUI.card('lost', { retry: () => {}, leave: () => leaveCoop() });
}
// A goodbye from the table while its match is on screen (removed, closed, another device, an update, a full server):
// the menu's Co-op screen shows its card (src/ui/coopMenu.js already holds it). A restart says nothing: it comes back.
const netByeHeard = new WeakSet();
function netBye(coop, why) {
  if (!['removed', 'closed', 'elsewhere', 'update', 'serverOld', 'busy'].includes(why)) return;
  if (!online() || coopRun?.coops.every(c => c !== coop) || coop.table !== table) return;
  coopRun = null;
  backToMenu({ screen: 'coop' });
}
// The end screen while the host starts the next match: "The next match starts in 5…" (the countdown of the table).
let netCountTimer = null;
function netLobby(coop, lv) {
  clearInterval(netCountTimer); netCountTimer = null;
  if (!online() || coop.table !== table || !overlays.endOpen || lv?.phase !== 'starting' || lv.startsInMs == null) { coopUI.endNote(null); return; }
  const until = performance.now() + lv.startsInMs;
  const show = () => coopUI.endNote(fill(ONLINE_TEXT.match.end.nextIn, { n: Math.max(1, Math.ceil((until - performance.now()) / 1000)) }));
  show();
  netCountTimer = setInterval(() => { if (!overlays.endOpen || performance.now() > until + 2000) { clearInterval(netCountTimer); netCountTimer = null; return; } show(); }, 250);
}
// The page leaves the Co-op match on screen (to the menu: the table itself is left, or kept, by the caller).
function netAway() {
  document.body.classList.remove('coop-match');
  coopUI.hide();
  menu.coopSwitch?.offer(null);
}

// The review link's switch, in a match: the other seat's table, drawn fresh from its own view (as after a reconnection),
// so each screen shows only its own cards. Whatever was open is closed; what still waits is asked again (netScreens).
function netSeatSwitch(i, coop) {
  const t = coop?.table;
  if (!t || !online() || phase !== 'game') return false;
  if (t !== table) presentSeat(t);
  netOffer();
  return true;
}
function presentSeat(t) {
  hand.close(); map.close(); discard.close(); handoff.close(); meeting.close(); lockChoice.close();
  overlays.hideAsk(); overlays.hideNotice(); hud.hideConfirm();
  table = lastTable = t;
  humanSeat = t.view.seat;
  presented = t;
  present(t.view, t.received, { newMatch: null, fresh: true });
  pendingArrival = null; selectedMove = null; activeWalk = null; walkCutShort = false; queuedTap = null;
  talk = null; meetingLive = inMeeting(); outNoticeShown = !me()?.alive; lockNews = '';
  tableNews = false; localNews = []; healthBefore.clear(); attackSeen = null;
  netReset();
  seenO = state.eventSeq; shown = turnNow();
  for (const m of movers) m.halt();
  rebuildGrid(); discovery.refresh(); netSnap(); syncViews(false);
  hud.rebuild();
  ownSoul = prepareSoulCards([cast[humanSeat].id]);
  rig.setFocus(...followPoint(), true);
  mood.snap(activePlayer(state).currentRoom);
  feed.skip(state);
  stopTimer();
  inActionPhase = false;
  refresh();
  if (state.finished) { showEnd(); return; }
  netBegin();
}
// When a question waits on the review link's other seat, the switch says so ("sam must choose a card"); on that seat's
// own turn, that it is theirs.
function netOffer() {
  const sw = menu.coopSwitch;
  if (!sw || !coopRun?.demo) return;
  const other = coopRun.coops[(menu.coopSeat ?? 0) === 0 ? 1 : 0];
  const v = online() && phase === 'game' ? other?.table?.view : null;
  sw.offer(v ? netWaitLine(v) : null);
}
function netWaitLine(v) {
  if (v.finished || v.end) return null;
  const W = ONLINE_TEXT.demo.waits;
  const name = v.players?.[v.seat]?.name || '';
  const kind = v.ask?.kind === 'tradeCard' ? 'card' : v.ask?.kind;
  if (kind && W[kind]) return fill(W[kind], { name });
  if ((v.results || []).some(r => SCREEN_RESULTS.has(r.kind))) return fill(W.screen, { name });
  if (v.phase?.kind === 'turn' && v.activeSeat === v.seat && W.turn) return fill(W.turn, { name });
  return null;
}

// The end screen's buttons at a Co-op table (DESIGN §14.6): the host plays again; a guest goes back to the table (the
// host starts the next match); either may leave the table.
const endMenuBtn = document.getElementById('btn-end-menu');
const END_MENU_WORD = endMenuBtn?.textContent ?? '';
const endRestartBtn = document.getElementById('btn-restart');
function netIsHost() {
  const lv = coopRun?.coops[menu.coopSeat ?? 0]?.lobby;
  return !!lv && lv.host === lv.you;
}
function netEndButtons() {
  const lv = coopRun?.coops[menu.coopSeat ?? 0]?.lobby;
  coopUI.endButtons(state, netIsHost(), lv?.people?.find(p => p.pid === lv.host)?.name || '');
}
// The table stopped the match without a result (TP3's long wait, a fault, a slow or updated server): its card, then
// back to the table (the match counts nowhere).
let netStopShown = null;
function netStopped() {
  if (netStopShown === table) return;
  netStopShown = table;
  stopTimer();
  hand.close(); map.close(); discard.close(); handoff.close(); meeting.close(); overlays.hideAsk(); hud.hideConfirm();
  meetingLive = false; talk = null; selectedMove = null;
  const why = state.end?.stopped;
  coopUI.card(why === 'stall' ? 'stopped' : why === 'update' ? 'update' : 'fault', { back: () => backToTable() });
}
function netRestart() {
  const coop = coopRun?.coops[menu.coopSeat ?? 0];
  if (!coop || !netIsHost()) { backToTable(); return; }
  // Play again: the table goes back to waiting and starts again at once (its countdown: the others can still stop it).
  coop.lobbyOp({ k: 'again' })
    .then(r => (r.ok || r.reason === 'notNow' ? coop.lobbyOp({ k: 'start' }) : r))
    .then(r => { if (!r?.ok && table === coop.table) backToTable(); })
    .catch(() => backToTable());
}
// Back to the waiting room (the seat is kept: the next match, when the host starts it, comes in by the lift).
function backToTable() {
  if (endMenuBtn) endMenuBtn.textContent = END_MENU_WORD;
  backToMenu({ screen: 'table' });
}
// Leave the Co-op table (the Menu's Leave, the end screen's Leave table, "You are out"): the seats this device holds
// are given up (src/ui/coopMenu.js), and the main menu.
function leaveCoop() {
  overlays.hideAsk();
  if (endMenuBtn) endMenuBtn.textContent = END_MENU_WORD;
  try { menu.leaveCoop?.(); } catch (err) { console.warn('leaving the Co-op table:', err); }
  coopRun = null;
  return backToMenu();
}
// (tests, on this machine only: a command sent as the player's seat would send it, and the seat's own view)
if (isLocalHost(location)) {
  window.__net = {
    send: cmd => (online() ? table.send(cmd, { afterView: true }) : Promise.resolve({ ok: false, reason: 'notNow' })),
    view: () => (online() ? table.view : null),
    seat: () => (online() ? humanSeat : null),
    // (what the page is waiting for: commands out, an End turn asked, the start, the turn on screen)
    debug: () => ({ netBusy, endAsked, netBegun, netStarting, shown: shown && { turn: shown.turn, seat: shown.seat, game: shown.game }, gameToken, turn: state.turn, phase: state.phase?.kind, ask: state.ask?.kind ?? null, results: (state.results || []).map(r => r.kind), clock: state.clock, stall: state.stall, end: state.end && { won: state.end.won, stopped: state.end.stopped ?? null } }),
  };
}

// --- Debug / test hooks ------------------------------------------------------------------
// The one place the page reaches the table's real game (table.local.debug: tests/seam-check.mjs holds it to this block).
window.__game = (() => {
  // the real game: the table's (behind the menu, the last table's; before the first table, the screens' own state)
  const real = () => (table ?? lastTable)?.local?.debug ?? { state, floor };
  const bots = () => table?.local?.debug.bots ?? null;
  return {
  // the REAL game (the table's), for the tests' direct engine calls; handing it out marks the screens to catch up
  // before they read again (pull). What the screens read: presenterState, presenterFloor.
  get state() { dirty = true; return real().state; },
  get floor() { dirty = true; return real().floor; },
  presenterState: state, presenterFloor: floor,
  table: () => table,
  cfg, rules, hotel, grid, movers, rig, roomViews, doorways, characters, discovery, view, pathPreview, fog, screenTags,
  crash,        // the safety net (src/ui/crash.js): ring(), shown, limits, step(), note()
  begin, restart, endTurn: () => doEndTurn({ ask: false }),     // (tests: End turn with the question answered; the button asks)
  autoEnd: on => { if (on !== undefined) { autoEndOn = !!on; autoEndKey = ''; } return autoEndOn; }, autoEndFired: () => autoEndFired,     // (tests: the turn passing by itself when the actions run out, on or off)
  refresh,
  activePlayer: () => { dirty = true; return activePlayer(real().state); },
  nextPlayer: () => { dirty = true; return nextPlayer(real().state); },
  activeMover,
  walkTo: (x, z) => discovery.walkTo(x, z),
  moveToRoom,
  search: () => onSearch(),
  // The search icon and the hand fan (tests).
  tapSearchSpot: () => onSearchSpot(),
  searchSpot: () => ({ mode: searchSpot.mode, kind: searchSpot.kind, point: searchSpot.point, second: searchSpot.second, spot: searchSpot.spot && { center: searchSpot.spot.center, height: searchSpot.spot.size[1], kind: searchSpot.spot.kind } }),
  searchPending: () => false,      // (searching no longer walks anywhere first; kept for older scripts)
  fanIds: () => (fan.visible ? fan.ids : []),
  cardViewOpen: () => hand.isOpen,
  cardViewId: () => hand.cardId,
  useBandage: id => onUseBandage(id),
  // Part 2: rooms with jobs and the new cards (same paths as the buttons).
  roomJob: () => canUseRoom(real().state, real().floor, activePlayer(real().state)),
  useRoom: () => onRoom(),
  useEspresso: id => onEspresso(id),
  useHandMirror: (id, targetId) => onHandMirror(id, targetId),
  handMirrorTargets: () => playersInRoom(state, activePlayer(state).currentRoom, activePlayer(state).id).map(q => q.id),
  mirrorOpen: () => handoff.kind === 'mirror',
  unlock: (id, room) => onUnlock(id, room),
  // The padlock of a locked room's door next to the guest (tests): where it is on screen, a tap on it, the choice card.
  lockPoint: (room, part) => lockPoint(room, part),
  tapLock: room => onLockTap(room),
  lockChoiceOpen: () => lockChoice.isOpen,
  doorsAnimating: () => doorways.animating,
  barricade: (id, door) => onBarricade(id, door),
  trade: () => onTrade(),
  mode: () => (PRACTICE ? 'practice' : 'match'),
  // A match against computer guests (tests): the player's seat, whose seats are bots, the bots' brains,
  // whose turn, the menu and the lift.
  humanSeat: () => humanSeat,
  isBot: i => isBot(i),
  bots,
  botProfiles: () => botProfiles.map(p => (p ? { username: p.username, style: p.style } : null)),
  // Who you are (src/account/account.js: the saved profile, or null before the register), and the seats
  // of this table (src/table.js: id, username, colour, avatar), you marked.
  profile: () => account.profile,
  seats: () => cast.map((s, i) => ({ id: s.id, name: s.name, color: s.color, avatar: s.avatar, you: i === humanSeat })),
  storageKept: () => account.persistent,      // (false: this device keeps nothing, the profile lasts the visit)
  menuShow: name => menu.show(name),          // (tests: a menu screen; Change name opens the register)
  showRename: () => menu.showRename(),
  rebuildHud: () => { hud.rebuild(); refresh(); },   // (tests: the strip built again, after renaming guests)
  myTurn: () => myTurn(),
  meetingLive: () => meetingLive,
  phase: () => phase,
  lobbyReady: () => lobbyReady,
  menuScreen: () => menu.screen,
  feedLines: () => [...document.querySelectorAll('#feed .feed-line')].map(e => e.textContent),
  // Quick chat (tests): say a line as the player (`about`: the seat a line names; null while cooling
  // down), the panel (its tab and step), the bubbles showing over the guests, the computer guests' chatter,
  // a line said as another seat (as the table would relay it), what the bots heard.
  chatSay: (id, about = null) => chat.send(id, about),
  chatOpen: () => chat.isOpen,
  chatPanel: () => chat.panelState(),
  chatPost: msg => chatRoad.post(msg),
  botsHeard: () => bots()?.heardCount?.() ?? 0,
  chatBubbles: () => screenTags.list('chat:'),
  chatRecent: () => chat.recent(),
  chatter: () => table?.local?.debug.chatter ?? null,
  tips: () => tips.debug(),          // first-match tips (tests): the one showing, the ones waiting, the ones seen
  skipToEnd: () => skipToEnd(),
  backToMenu: () => backToMenu(),
  record: () => record.get(),        // your record on this device (src/record.js)
  honours: () => honours.get(),      // your achievements on this device (src/honours.js)
  endOpen: () => overlays.endOpen,
  askOpen: () => overlays.askOpen,
  menuPanelOpen: () => gameMenu.isOpen, howToOpen: () => howTo.isOpen, cardsOpen: () => cardsGuide.isOpen,     // (tests: the in-match Menu panel, How to play, Cards)
  showEnd: () => showEnd(),          // (tests: the end screen for the state as it is; it counts the game in your record)
  handoff, meeting, tradeReveal,
  // QA: the private trade reveal for one outcome (src/ui/tradeReveal.js: swap, blocked, blockedMe,
  // possessed, possessedThem, soulSpent, alreadyPossessed, soulsCrossed, noTrade, and the extra samples
  // noTradeMe, noTradeBoth, blockedPossessed: a possessed you blocked a soul), with sample cards, for your
  // guest and another; nothing in the game changes.
  previewTradeReveal: (outcome = 'swap') => {
    const you = state.players[humanSeat] || cast[0];
    // (practice: a sample other guest, a bot's name in a look that is not yours)
    const them = state.players.find(p => p !== you)
      || { ...seatTable({ me: { username: 'nightowl', avatar: botAvatars(['nightowl'], { avoid: [you.avatar] })[0] }, seat: 0 })[0], id: 'p2', index: 1, color: '#73d4e6' };
    return tradeReveal.preview(outcome, you, them);
  },
  tradeRevealOutcome: () => tradeReveal.outcome,
  skipTradeReveal: () => tradeReveal.skip(),
  handoffOpen: () => handoff.isOpen, handoffKind: () => handoff.kind,
  handoffNext: () => document.getElementById('btn-handoff-next').click(),
  meetingOpen: () => meeting.isOpen,
  noticeOpen: () => overlays.noticeOpen,
  clickNotice: () => document.getElementById('btn-notice-ok').click(),
  // the turn clock (seconds; the table's own clock, src/net/referee.js, counts milliseconds): what is left, run it out now,
  // set what is left (tests: the clock's last seconds)
  timeLeft: () => timerLeft,
  forceTimeUp: () => { if (table?.local?.setTimeLeft(0.1)) timerLeft = 0.0001; },
  setTimeLeft: secs => { if (timerLeft > 0 && table?.local?.setTimeLeft(secs * 1000)) timerLeft = secs; },
  inActionPhase: () => inActionPhase,
  dressingDone: () => dressingDone,
  // (tests: nothing of the page is still downloading — the hotel behind the menu, its guests, the warm-up
  // tile — so leaving the page cuts no download off)
  settled: () => !holdHotel && dressingDone && (!warmPrep || warmSettled)
    && characters.every(cv => { const d = cv.debug(); return !d.model || d.loaded; }),
  publicLog: () => real().state.log.map(l => l.text),
  notesOf: i => [...(real().state.players[i].notes || [])],
  possessedIndexes: () => real().state.players.filter(p => p.possessed).map(p => p.index),
  lanterns: () => activePlayer(real().state).hand.filter(c => c.type === 'lantern').length,
  lockedRooms: () => [...state.lockedRooms],
  openLocks: () => [...state.openLocks.keys()],       // locked doors a key opened this turn
  canEscape: () => canEscape(real().state, real().floor, activePlayer(real().state)),
  escape: () => onEscape(),         // (the Exit icon's tap)
  openHand: cardId => hand.open(state, floor, cardId),
  rotate: steps => rig.rotate(steps),
  toggleMap: () => map.toggle(state, movers),
  isMapOpen: () => map.isOpen,
  isRunning: () => running,
  isFinished: () => state.finished,
  groundToScreen,
  queuedTap: () => !!queuedTap,
  // Tapping rooms (tests): what a tap at a screen point means, the fogged rooms, their tags, and the
  // screen point of a room's or fog room's middle.
  tapTargetAt: (x, y) => { const t = tapTargetAt(x, y); return t && { kind: t.kind, id: t.id ?? null, key: t.key ?? null, doors: t.doors?.map(d => d.id) ?? null }; },
  fogCells: () => fog.cells(),
  lampHalos: () => halos.info(),       // (tests: the lamp halos, src/render/lampHalos.js)
  // a screen point where a tap means room `id` (or fog room `fog`: its 'i,j' key) and lands on the
  // canvas, clear of the interface and its dead zone — the point nearest the middle of it — or null
  tapPointFor: ({ room = null, fog: fogKey = null } = {}) => {
    const r = room ? floor.rooms.get(room) : null;
    const c = r ? r.center : fogKey ? fogKey.split(',').map(n => +n * floor.tileSize) : null;
    if (!c) return null;
    const pts = [];
    for (let a = -3; a <= 3; a += 0.75) for (let b = -3; b <= 3; b += 0.75) pts.push([c[0] + a, c[1] + b]);
    pts.sort((p, q) => Math.hypot(p[0] - c[0], p[1] - c[1]) - Math.hypot(q[0] - c[0], q[1] - c[1]));
    for (const [x, z] of pts) {
      const sp = groundToScreen(x, z);
      if (sp.x < 4 || sp.y < 4 || sp.x > innerWidth - 4 || sp.y > innerHeight - 4) continue;
      const el = document.elementFromPoint(sp.x, sp.y);
      if (!el || el.tagName !== 'CANVAS' || inDeadZone(sp.x, sp.y)) continue;
      const t = tapTargetAt(sp.x, sp.y);
      if (t && (room ? t.kind === 'room' && t.id === room : t.kind === 'fog' && t.key === fogKey)) return sp;
    }
    return null;
  },
  fogLabels: () => screenTags.list('fog:').map(t => ({ key: t.key.slice(4), text: t.text, x: (t.l + t.r) / 2, y: (t.t + t.b) / 2 })),
  centreOnMe: () => onCentre(),
  inDeadZone: (x, y) => inDeadZone(x, y),
  walkPlan: () => activeWalk && { rooms: [...activeWalk.rooms], dest: activeWalk.dest, stop: activeWalk.stop, cost: activeWalk.cost },
  tags: prefix => screenTags.list(prefix),
  screenToGround: (x, y) => { const p = screenToGround(x, y, new THREE.Vector3()); return p ? [p.x, p.z] : null; },
  roomCenter: id => floor.rooms.get(id)?.center ?? null,
  // the random hotel: closed doors of the active guest's room, open one, stack the deck (tests)
  closedDoors: () => (floor.rooms.get(activePlayer(state).currentRoom)?.frontier || []).map(d => ({ id: d.id, side: d.side, jammed: d.jammed, center: d.center, fog: `${d.cell[0]},${d.cell[1]}` })),
  openDoor: id => onOpenDoor(id),
  stackDeck: id => real().stackDeck?.(id),
  // Tests: put a particular room on the board (next to room `nextTo` if given), as if its door
  // had been opened, without spending anyone's action points (the table does it: src/net/localTable.js).
  revealTile: (id, nextTo = null) => {
    real().revealTile?.(id, nextTo);
    rebuildGrid(); discovery.refresh(); syncViews(false); refresh();
    return floor.rooms.has(id) && (!nextTo || floor.rooms.get(id).neighbours.has(nextTo));
  },
  hotelRooms: () => floor.roomList.map(r => r.id),
  // Tests: where a guest walking into `room` would stand, and whether a point is on a body.
  standingSlot: (room, i) => standingSlot(room, i),
  onABody: (x, z) => onABody(x, z),
  bodyEnds: i => bodyEnds(movers[i]),
  programCount: () => view.renderer.info.programs.length,
  // Avatars (tests): the portrait service, the wardrobe screen, your avatar in the lobby, the character
  // views alive (one per seat: views not at the table are let go), the renderer's counts.
  portraits: () => portraits,
  avatarEditor: () => avatarEditor.debug(),
  honoursPage: () => honoursPage.debug(),
  lobbyPlayer: () => lobby?.debug.player ?? null,
  lobbyWardrobe: () => lobby?.debug.wardrobe ?? null,
  lobbyBoarders: () => lobby?.debug.boarders ?? null,
  lobbyPeople: () => lobby?.debug.people?.() ?? null,     // (each person in the menu's lobby: draw calls, triangles)
  characterViewCount: () => characterViews.length,
  renderInfo: () => ({ calls: view.renderer.info.render.calls, triangles: view.renderer.info.render.triangles,
    geometries: view.renderer.info.memory.geometries, textures: view.renderer.info.memory.textures, programs: view.renderer.info.programs.length }),
  setPixelRatio: cap => view.setPixelRatio(cap),
  };
})();


// Every hook reads the latest: a test may have changed the real game since it was handed out, so the screens catch up
// first (pull). (The two getters above are left as they are.)
for (const [k, d] of Object.entries(Object.getOwnPropertyDescriptors(window.__game))) {
  if (typeof d.value !== 'function' || k === 'table') continue;
  const fn = d.value;
  window.__game[k] = (...args) => { pull(); return fn(...args); };
}

// Move the active player into a room by id, as a confirmed tap on it would (tests): the
// fewest-rooms route to a free spot in its middle. Returns the plan; the walk and any meeting resolve
// over the next frames.
function moveToRoom(destId) {
  const player = activePlayer(state);
  if (!floor.rooms.has(destId) || destId === player.currentRoom) return { ok: false, reason: 'noRoom' };
  const plan = discovery.planToRoom(destId, standAtFor(player.index), walker(player));
  if (plan.ok) startWalk(plan);
  return plan;
}
