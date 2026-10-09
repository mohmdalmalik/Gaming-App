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
import { roster } from './data/characters.js';
import { createHotel, stackDeck, growTo, searchSpotOf, roomAt, cellOf, fogCells } from './game/hotel.js';
import { buildGrid } from './game/grid.js';
import {
  createState, resetState, endTurn, activePlayer, nextPlayer, checkWin, canEscape,
  openableDoors, pendingEncounters, lockEncounter, playersInRoom, isLocked,
  isBarricaded, canTradeVoluntarily, doorBetween,
} from './game/state.js';
import {
  search, canSearch, escape, useBandage, useUnlock, useBarricade, resolveTrade, resolveAttack,
  discardCard, overHandLimit, tradeableCards, canTrade, skipTrade, openDoor,
  canUseRoom, useInfirmary, useSwitchboard, useHandMirror, useEspresso,
} from './game/actions.js';
import { CARDS, weaponsIn, countableCount } from './game/cards.js';
import { createScene } from './render/scene.js';
import { addRoomView, clearRoomViews, createDoorwayViews } from './render/roomView.js';
import { dressRoom } from './render/roomDressing.js';
import { updateCutaway } from './render/cutaway.js';
import { createMood } from './render/mood.js';
import { createCharacterView } from './render/characterView.js';
import { createSearchMarks } from './render/searchMarks.js';
import { createPathPreview } from './render/pathPreview.js';
import { createFog } from './render/fog.js';
import { easeOutCubic } from './render/materials.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createDiscovery } from './discovery.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';
import { createOverlays } from './overlays.js';
import { createHand } from './ui/hand.js';
import { createHandFan } from './ui/handFan.js';
import { createSearchSpot } from './ui/searchSpot.js';
import { createDiscard } from './ui/discard.js';
import { createHandoff } from './ui/handoff.js';
import { createMeeting } from './ui/meeting.js';
import { roundLabel, finalRoundNote, isFinal } from './ui/roundLabel.js';
import { createPerfStats } from './ui/perfStats.js';
import { createGuestTags } from './ui/guestTags.js';
import { createGoTags } from './ui/goTags.js';
import { createScreenTags, interfaceRects } from './ui/screenTags.js';
import { standable } from './game/moves.js';
import { usePracticeWording } from './ui/cards.js';
import { createMenu } from './ui/menu.js';
import { createFeed } from './ui/feed.js';
import { settings } from './settings.js';
import { makeRng, shuffle } from './game/cards.js';

// --- World (pure data + rules) ---------------------------------------------------------
// The hotel is random every match: it starts as the lobby and grows as doors are opened
// (src/game/hotel.js). createState builds a fresh one.
const floor = createHotel(hotel, cfg);

// What the page opens on: the main menu. A direct link skips it, straight to a "Tap to begin" card for
// one kind of game (the tests use these):
//   ?mode=practice                       practice alone
//   ?mode=bots&bots=5&role=clean         a match against 5 computer guests (role: random | clean |
//                                        possessed); &seat=2 puts the player in that seat (testing)
//   ?seed=123                            force the deal, the hidden role and the hotel's room deck (testing)
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
  if (!params.has('bots')) params.set('bots', String(Math.max(3, Math.min(5, (parseInt(params.get('players'), 10) || 6) - 1))));
  if (!params.has('seat')) params.set('seat', '0');
}
const DIRECT = ['practice', 'bots'].includes(params.get('mode')) ? params.get('mode') : null;
const TIMER_OFF = params.get('timer') === 'off';
const INTRO = params.get('intro') !== 'off';
const BOT_PACE = Math.max(0, parseFloat(params.get('botpace'))) || 1;
const forcedSeed = parseInt(params.get('seed'), 10);
const newSeed = () => (Number.isFinite(forcedSeed) && forcedSeed > 0 ? forcedSeed
  : PRACTICE && rules.practiceSeed != null ? rules.practiceSeed
    : (Date.now() & 0x7fffffff) || 1);

// The game being played (or about to be). setupGame() changes it before each new game.
let PRACTICE = true;          // practice alone, or a match against bots
let humanSeat = 0;            // the player's own seat (a match: random, like joining an online table)
let bots = null;              // the computer guests' brains (src/bots/index.js), in a match
let botProfiles = [];         // per seat: the bot's profile (username, style), or null for the player
const cast = [roster[0]];     // the guests at the table, in seat order (filled in place by setupGame)
applyMode('practice', 1);
if (TIMER_OFF) rules.turnTimerEnabled = false;
let seed = newSeed();
const state = createState(floor, cast, seed, { mode: 'practice' });
state.viewerIndex = humanSeat;
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
const isBot = i => !!bots && !!botProfiles[i];
const myTurn = () => !state.finished && state.activeIndex === humanSeat;

// --- Rendering -------------------------------------------------------------------------
const container = document.getElementById('view');
const view = createScene(container, cfg);
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
// One view per guest of the roster, made the first time that guest is at a table and kept (shown or
// hidden) from game to game, so a new game never loads a model twice. `characters` holds this game's,
// in seat order.
const characterViews = new Map();
const characters = [];
function castCharacters() {
  for (const cv of characterViews.values()) cv.group.visible = false;
  characters.length = 0;
  for (const def of cast) {
    if (!characterViews.has(def.id)) characterViews.set(def.id, createCharacterView(def, cfg, view.scene));
    const cv = characterViews.get(def.id);
    cv.group.visible = true;
    cv.setDead(false);
    cv.setPossessed(false);   // (views are reused: no red eyes left over from the last game)
    characters.push(cv);
  }
}
castCharacters();
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
const hand = createHand(document, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror });
const discard = createDiscard(document, cfg, {
  onDiscard: cardId => { const r = discardCard(state, activePlayer(state), cardId); if (!r.ok) hud.toast('That card cannot be discarded.'); refresh(); },
});
// The hand, held as a fan of face-up cards; tapping one opens it large in the card view.
const fan = createHandFan(document, { onOpen: cardId => { if (running && !uiBusy()) hand.open(state, floor, cardId); } });
const feed = createFeed(document);     // what the other guests just did (a match)
const topLeftEl = document.querySelector('.hud-top-left');
const handoff = createHandoff(document);
const meeting = createMeeting(document, cfg, { isViewer: p => !PRACTICE && p.index === humanSeat });

let running = false;
let pendingArrival = null;   // enterRoom result waiting for the walk to finish
let selectedMove = null;     // a move to a room awaiting confirmation
let activeWalk = null;       // the confirmed walk under way (its plan), until the guest arrives
let walkCutShort = false;    // the clock ran out during this walk: it was cut short at the next room

const uiBusy = () => map.isOpen || hand.isOpen || discard.isOpen
  || overlays.endOpen || overlays.noticeOpen || overlays.askOpen || handoff.isOpen || meeting.isOpen;

const discovery = createDiscovery({
  floor, grid, state, movers, cfg,
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

// The search icon over the room's search spot (the furniture flagged `search: true`).
const searchSpot = createSearchSpot(document, { camera: view.camera, container, floor, state, onTap: onSearchSpot });

// The search icon is part of the player's own action phase only: never on another guest's turn, a
// private screen, a meeting, a notice or the end screen (CSS also hides it the moment any of those is
// up). The hand fan is the player's own hand: it shows on other guests' turns too (to look at — using a
// card needs their own turn), but never under a private screen, a meeting, a notice or the end screen.
// Cheap enough to run every frame; each only touches the page when something changed.
function screenClear() {
  return running && !state.finished && !handoff.isOpen && !meeting.isOpen && !overlays.endOpen
    && !overlays.noticeOpen && !overlays.askOpen && !map.isOpen && !discard.isOpen;
}
function actionPhaseClear() { return screenClear() && myTurn() && inActionPhase; }
function syncHandFan() {
  fan.update(me(), screenClear() && me().alive, { withPossession: true });
  if (running) hud.syncTell(state);   // (not behind the menu: backToMenu's hud.hide() put the tell away)
  hud.syncEndTurn(state);
}
function syncSearchSpot() {
  searchSpot.update(me(), actionPhaseClear() && !hand.isOpen && !pendingArrival);
}

// --- Render sync -------------------------------------------------------------------------
function syncViews(animate) {
  // A view for every room the hotel has grown (dressed if it has dressing), and for every door.
  for (const room of floor.roomList) {
    if (roomViews.has(room.id)) continue;
    const v = addRoomView(roomViews, room, cfg, view.scene, { animate });
    trackDressing(dressRoom(v, floor, cfg).then(done => { if (done) view.compile(); }));
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
}

function refresh() { hud.update(state, floor); refreshUsable(); hand.refresh(); searchMarks.update(state); discovery.refresh(); syncHandFan(); syncSearchSpot(); }

function activeMover() { return movers[state.activeIndex]; }

// Card names in sentences: "a Lantern", "an Espresso"; "a Lantern and a Knife".
function aCard(type) { const name = CARDS[type]?.name ?? type; return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`; }
function andList(items) { return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

// --- Turn flow ---------------------------------------------------------------------------
// Practice: the one guest's turns follow each other. A match: everyone's turns in seat order. On the
// player's turn they act (tapping rooms, cards, buttons); on a computer guest's turn the bot plays
// (botTick below): it decides, and the interface carries each action out through the same rules code,
// with the same walks and the same public words a person's action would have.
let timerLeft = 0;
let inActionPhase = true;    // the player may act now (their turn has started and nothing private is up)

function begin() {
  overlays.hideStart();
  hud.show();
  running = true;
  phase = 'game';
  refresh();
  if (PRACTICE) return;
  // A match: the player reads their secret role first, then the first turn begins.
  inActionPhase = false;
  handoff.revealRole(me(), {}, () => { me().roleSeen = true; beginTurn(); });
}

// A new turn: the player's own, or a computer guest's.
let lockNews = '';
function beginTurn() {
  if (state.finished) { showEnd(); return; }
  inActionPhase = false;
  stopTimer();
  hud.hideConfirm(); selectedMove = null; activeWalk = null; walkCutShort = false; queuedTap = null;
  const p = activePlayer(state);
  movers[p.index]?.halt();
  syncViews(false);
  refresh();
  if (isBot(p.index)) { startBotTurn(p); return; }
  // The player's turn: anything that happened to them meanwhile first (they were mirrored, a trade
  // they were dragged into), in private, then their actions.
  rig.recentre();
  mood.snap(p.currentRoom);
  const go = () => {
    inActionPhase = true;
    startTimer();
    refresh();
    hud.toast(`Your turn — ${rules.actionPointsPerTurn} actions.${lockNews ? ` ${lockNews}` : ''}`, lockNews ? 5 : undefined);
    lockNews = '';
  };
  if (p.roleChangePending) { p.roleChangePending = false; handoff.revealRole(p, { changed: true }, go); return; }
  if (p.notes.length) { handoff.privateNote(p, ['While the others played:'], go); return; }
  go();
}

// --- Turn timer --------------------------------------------------------------------------
// Counts the active guest's actions only. Meetings, hand-over screens, the end screen and every
// blocking prompt pause it.
function startTimer() {
  if (!rules.turnTimerEnabled) { hud.hideTimer(); timerLeft = 0; return; }
  timerLeft = rules.turnTimerSeconds;
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
}
function stopTimer() { timerLeft = 0; hud.hideTimer(); }
// The "turn your iPad sideways" card (pure CSS, styles.css) covers the game in portrait: the clock
// waits while it is up.
const sideways = window.matchMedia?.('(orientation: portrait), (max-width: 900px)');
const timerPaused = () => handoff.isOpen || overlays.endOpen || overlays.noticeOpen || overlays.askOpen
  || meeting.isOpen || discard.isOpen || meetingLive || !!sideways?.matches;

function tickTimer(dt) {
  if (!rules.turnTimerEnabled || state.finished || timerLeft <= 0) return;
  if (myTurn() && !inActionPhase) return;
  if (timerPaused()) return;
  timerLeft -= dt;
  // A guest still walking when the clock runs out always ends on a standing spot: the walk is cut short
  // at the next room (or, if they have just stepped into a room, at its middle), and they finish arriving
  // first (a forced meeting there pauses the clock); the turn then ends at once. Ending it mid-walk would
  // leave the guest off their spot, or that arrival for the next guest.
  if (timerLeft <= 0 && (pendingArrival || activeMover().walking || activeMover().path.length)) {
    cutWalkShort();
    timerLeft = 0.001;
  }
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
  if (timerLeft <= 0) onTimeUp();
}

// The clock ran out mid-walk: a guest still in the room the walk started from walks on to the standing
// spot of the next room (that room's move is charged as they cross into it, like any move); once they
// have stepped into a room on the way, they stop on that room's standing spot.
function cutWalkShort() {
  if (walkCutShort) return;
  walkCutShort = true;
  const m = activeMover();
  if (!m.walking && !m.path.length) return;           // (only arriving: that finishes by itself)
  const player = activePlayer(state);
  // (still in the room the walk started from: the step under way, into the next room, is finished;
  // already in a room on the way: they stop in it — nothing more is spent once the time is up)
  const route = activeWalk?.rooms || [];
  const next = !pendingArrival && route.length > 1 && route[0] === player.currentRoom ? route[1] : player.currentRoom;
  const plan = next !== player.currentRoom ? discovery.planToRoom(next, standAtFor(player.index)) : null;
  if (plan?.ok) { activeWalk = plan; discovery.go(plan); return; }
  const here = discovery.planToRoom(player.currentRoom, standAtFor(player.index));
  if (here.ok) { activeWalk = here; discovery.go(here); } else m.halt();
}

function onTimeUp() {
  stopTimer();
  if (myTurn()) hud.toast(PRACTICE ? `Time is up — ${activePlayer(state).name}'s turn ends.` : 'Time is up — your turn ends.');
  endTurnNow();
}

// "the door to the Library" (seen from `fromRoom`), or "door between the Hall and the Library".
function doorName(doorwayId, fromRoom = null) {
  const d = floor.doorways.find(x => x.id === doorwayId);
  if (!d) return 'doorway';
  const name = id => (state.discovered?.has(id) ?? true) ? floor.rooms.get(id)?.name ?? 'next room' : 'unknown room';
  if (fromRoom === d.a || fromRoom === d.b) return `door to the ${name(d.otherRoom(fromRoom))}`;
  return `door between the ${name(d.a)} and the ${name(d.b)}`;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function passTurn() {
  // Never past the hand limit: anything that ends a turn goes through the discard screen first.
  if (!state.finished && overHandLimit(activePlayer(state)) > 0) { endTurnNow(); return; }
  hud.hideConfirm(); selectedMove = null; activeWalk = null; walkCutShort = false;
  if (myTurn()) hand.close();     // (a computer guest's turn ending leaves the player's card view open)
  stopTimer();
  const sealedBefore = [...(state.barricades?.keys() ?? [])];
  const result = endTurn(state, floor);
  if (!result.ok) { endTurnNow(); return; }   // (the rules refuse it over the hand limit too: canEndTurn)
  endTurnGuardUntil = performance.now() + END_TURN_GUARD_MS;
  // (What the engine told the computer guests in private is theirs to read from their inbox: src/bots/.)
  for (const q of state.players) if (isBot(q.index)) q.notes.length = 0;
  // A locked door opened this turn has locked again (its door swings shut in syncViews below).
  const relocked = [
    ...(result.relocked || []).map(id => `The ${floor.rooms.get(id)?.name ?? 'locked room'} door has locked again.`),
    // a barricade that came down as this turn started (its boards go in syncViews below)
    ...sealedBefore.filter(id => !state.barricades.has(id)).map(id => `Barricade down: ${doorName(id, activePlayer(state).currentRoom)}.`),
  ].join(' ');
  movers[result.from.index]?.halt();
  syncViews(false);
  if (result.finished) { refresh(); showEnd(); return; }
  if (checkWin(state, floor)) { refresh(); showEnd(); return; }
  if (!PRACTICE) { lockNews = relocked; beginTurn(); return; }
  rig.setFocus(...followPoint());
  rig.recentre();
  mood.snap(activePlayer(state).currentRoom);
  refresh();
  hud.toast(`Turn ${state.turn} — ${rules.actionPointsPerTurn} action points.${relocked ? ` ${relocked}` : ''}`, relocked ? 5 : undefined);
}

// End the turn (the End turn button, or the 45-second clock running out). The hand limit is settled
// HERE and only here (approved rule): a guest holding more than 6 cards (Possession cards don't count)
// chooses what to discard on the discard screen first, and the turn passes only once they are down to
// 6. Nothing else is left open behind it. A computer guest chooses its discards itself.
function endTurnNow() {
  const p = activePlayer(state);
  if (overHandLimit(p) > 0) {
    if (isBot(p.index)) { botDiscardDown(p); passTurn(); return; }
    hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
    if (activeMover().walking) activeMover().halt();
    stopTimer();
    discard.open(p, passTurn);
    return;
  }
  passTurn();
}

// A second tap on End turn right after the first (a double tap) must not end the next turn too: in
// practice there is no hand-over screen in between to catch it. The new turn ignores End turn for a
// moment.
const END_TURN_GUARD_MS = 700;
let endTurnGuardUntil = 0;
function doEndTurn() {
  if (!running || state.finished || uiBusy()) return;
  // Out of the match (dead) with the others still playing: the button skips to the result.
  if (!PRACTICE && !me().alive) { skipToEnd(); return; }
  if (activeMover().walking || !myTurn() || !inActionPhase) return;
  if (performance.now() < endTurnGuardUntil) return;
  endTurnNow();
}

// The active guest finished walking into a room. The Fire Exit is a safe zone (never a meeting);
// escaping there is a separate action, the Escape button (1 AP).
function onArrive() {
  const player = activePlayer(state);
  const room = floor.rooms.get(player.currentRoom);
  pendingArrival = null;
  activeWalk = null;
  if (room?.isExit && !isBot(player.index)) {
    // The same words whoever you are, so they give nothing away about who is carrying what or who is
    // possessed.
    hud.toast(`The fire exit — a clean guest carrying ${rules.lanternsToEscape} Lanterns can escape here (${rules.actionCost.escape} action).`);
  }
  const candidates = pendingEncounters(state, floor, player);
  if (!candidates.length) { refresh(); return; }
  startMeeting(player, candidates);
}

// --- Meetings ----------------------------------------------------------------------------
// Walking into a room with another guest forces a meeting: the guest who walked in picks ONE guest
// (when several are there) and chooses Trade or Attack. In a trade each side picks a card in secret
// and the cards swap at the same moment; an attack is public. The player makes their own choices on
// their own screens. A computer guest makes its choices through src/bots/, after a short pause like a
// person's. A meeting between two computer guests plays out by itself and is reported in the feed.
let meetingLive = false;     // a meeting (or a proposed trade) is being played out: the bots wait for it

// Run `fn` after `ms`, unless a new game has started (or the player went back to the menu) meanwhile.
let gameToken = 0;
function after(ms, fn) {
  const token = gameToken;
  setTimeout(() => { if (token === gameToken && running) fn(); }, Math.max(0, ms));
}

function startMeeting(P, candidates) {
  meetingLive = true;
  hud.hideConfirm(); selectedMove = null;
  if (isBot(P.index)) { botMeeting(P, candidates); return; }
  // The player walked in. The meeting panel takes the screen: close anything they had open.
  hand.close(); map.close();
  rig.recentre();      // the meeting is where the guest is
  const met = Q => {
    lockEncounter(state, P.currentRoom, P.index, Q.index);
    const canAttack = weaponsIn(P.hand).length > 0 && P.actionPoints >= rules.actionCost.attack;
    // Trade or Attack; the weapon picker's Back returns here (nothing has happened yet).
    const chooseAction = () => meeting.chooseAction(P, Q, {
      canAttack,
      onTrade: () => runTrade(P, Q),
      onAttack: () => runAttack(P, Q, chooseAction),
    });
    chooseAction();
  };
  if (candidates.length === 1) met(candidates[0]);
  else meeting.choose(P, candidates, met);
}

// A computer guest walked in: it thinks a moment, picks whom to meet, then attacks or trades.
function botMeeting(P, candidates) {
  after(botThink(P.index, 'meet'), () => {
    if (state.finished) { meetingLive = false; return; }
    let pick = candidates[0].index;
    if (candidates.length > 1) {
      try { pick = bots.meetWhom(P.index, candidates.map(q => q.index)); } catch (err) { console.warn('bot meetWhom failed', err); }
    }
    const Q = candidates.find(q => q.index === pick) || candidates[0];
    lockEncounter(state, P.currentRoom, P.index, Q.index);
    const canAttack = weaponsIn(P.hand).length > 0 && P.actionPoints >= rules.actionCost.attack;
    let weapon = null;
    if (canAttack) { try { weapon = bots.attackWith(P.index, Q.index); } catch (err) { console.warn('bot attackWith failed', err); } }
    if (!isBot(Q.index)) { hand.close(); map.close(); hud.hideConfirm(); selectedMove = null; rig.recentre({ zoom: false }); }
    if (weapon && P.hand.some(c => c.id === weapon)) botAttack(P, Q, weapon);
    else runTrade(P, Q);
  });
}

function afterMeeting() {
  meetingLive = false;
  syncViews(false); refresh();
  if (state.finished) { showEnd(); return; }
  if (skipQueued) { skipToEnd(); return; }
  if (isBot(state.activeIndex)) botNextAt = performance.now() + botThink(state.activeIndex, 'act');
  checkPlayerOut();
}

// A trade between A (who walked in, or proposed it) and B. A computer guest's card is chosen in secret
// (src/bots/); the player picks theirs on a private screen. The cards swap at once; the player then
// reads, in private, what they received (and what it did to them). Between two computer guests nothing
// is shown but the public line in the feed. If either has no card they may give, the trade is skipped
// (GAME_RULES, Trade): skippedTrade.
function runTrade(A, B, onDone = afterMeeting, { voluntary = false } = {}) {
  if (!canTrade(A, B).ok) { skippedTrade(A, B, onDone); return; }
  const human = !isBot(A.index) ? A : !isBot(B.index) ? B : null;
  const botCard = (X, Y) => {
    const ids = tradeableCards(X).map(c => c.id);
    let id = null;
    try { id = bots.tradeCard(X.index, Y.index, ids); } catch (err) { console.warn('bot tradeCard failed', err); }
    return ids.includes(id) ? id : ids[0];
  };
  if (!human) {
    resolveTrade(state, floor, A, B, botCard(A, B), botCard(B, A));   // (the feed says they traded)
    onDone();
    return;
  }
  const other = human === A ? B : A;
  const theirs = botCard(other, human);
  handoff.privatePick(human, {
    kicker: voluntary ? `The Fire Exit — a trade with ${other.name}` : human === A ? `A trade with ${other.name}` : `${other.name} walked in — a trade`,
    title: `Give one card to ${other.name}`,
    sub: `${other.name} is choosing a card for you at the same moment. Neither of you sees the other's card until they have changed hands.`,
    cards: tradeableCards(human),
    onPick: card => {
      if (!card) { skippedTrade(A, B, onDone); return; }
      meeting.waiting('A trade', `${other.name} is choosing a card…`);
      after(botThink(other.index, 'trade'), () => {
        meeting.close();
        const [cA, cB] = human === A ? [card, theirs] : [theirs, card];
        const events = resolveTrade(state, floor, A, B, cA, cB);
        // What the player reads in private: what they received, then the rules' own notes. A Possession
        // card is explained by the note ("…You are now POSSESSED"), so it gets no "You received" line.
        const got = events.ok ? events.received[human.id] : null;
        const lines = !events.ok ? ['The trade could not be made.']
          : got === 'possession' ? []
            : [got ? `You received ${aCard(got)} from ${other.name}.` : `The card ${other.name} gave you burned away in your Lantern's light.`];
        const newly = !!events.possessed?.some(e => e.newly === human.id);
        if (newly) human.roleChangePending = false;
        refresh();
        handoff.privateNote(human, lines, () => (newly ? handoff.revealRole(human, { changed: true }, onDone) : onDone()));
      });
    },
  });
}

// The trade is skipped: nothing changes hands, the meeting ends. The player (if in it) reads why, in
// private (the rules' own note, worded the same whatever anyone's role).
function skippedTrade(A, B, onDone) {
  skipTrade(state, floor, A, B);
  const human = [A, B].find(X => !isBot(X.index));
  if (!human) { onDone(); return; }
  handoff.privateNote(human, [], onDone);
}

// The player attacks: choose a weapon, then the public result.
function runAttack(P, Q, onBack = null) {
  meeting.attackPick(P, Q, weaponId => {
    const events = resolveAttack(state, floor, P, Q, weaponId);
    if (events.killed) layBodyClear(Q.index);   // (the figure falls when the result is dismissed)
    meeting.attackResult(P, Q, events, afterMeeting);
  }, onBack);
}

// A computer guest attacks. If the player is the one attacked, they read it (and tap on); between two
// computer guests a short public line says what happened.
function botAttack(P, Q, weaponId) {
  const events = resolveAttack(state, floor, P, Q, weaponId);
  if (!events.ok) { runTrade(P, Q); return; }
  if (events.killed) layBodyClear(Q.index);
  if (!isBot(Q.index)) { meeting.attackResult(P, Q, events, afterMeeting); return; }
  hud.toast(`${P.name} attacked ${Q.name} with ${aCard(events.weapon)}${events.killed ? ` — ${Q.name} is dead` : ''}.`, 4);
  afterMeeting();
}

// Voluntary trade in a safe zone that allows it (the Fire Exit; never the lobby): the other guest must
// agree before anyone chooses. The player proposes it with the Trade button; a computer guest takes a
// moment to answer.
function onTrade() {
  if (!running || state.finished || uiBusy() || activeMover().walking || PRACTICE || !myTurn() || !inActionPhase) return;
  const P = me();
  if (!canTradeVoluntarily(state, floor, P)) return;
  const others = playersInRoom(state, P.currentRoom, P.id);
  if (!others.length) return;
  hud.hideConfirm(); selectedMove = null;
  const ask = Q => {
    meetingLive = true;
    meeting.waiting('A trade is proposed', `${Q.name} is thinking it over…`);
    after(botThink(Q.index, 'reply'), () => {
      meeting.close();
      let yes = false;
      try { yes = !!bots.acceptTrade(Q.index, P.index); } catch (err) { console.warn('bot acceptTrade failed', err); }
      if (yes) runTrade(P, Q, afterMeeting, { voluntary: true });
      else meeting.notice(`${Q.name} declined.`, afterMeeting, 'No trade');
    });
  };
  if (others.length === 1) ask(others[0]);
  else meeting.choose(P, others, ask, { voluntary: true, onCancel: refresh });
}

// A computer guest proposes a trade in the Fire Exit.
function botProposeTrade(P, Q) {
  meetingLive = true;
  if (isBot(Q.index)) {
    after(botThink(Q.index, 'reply'), () => {
      let yes = false;
      try { yes = !!bots.acceptTrade(Q.index, P.index); } catch (err) { console.warn('bot acceptTrade failed', err); }
      if (yes) runTrade(P, Q); else afterMeeting();
    });
    return;
  }
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
  handoff.privateChoice(Q, {
    kicker: 'The Fire Exit',
    title: `${P.name} would like to trade`,
    sub: 'You each give one card, in secret. You do not have to agree.',
    options: [{ label: 'Accept', value: true, primary: true }, { label: 'Decline', value: false }],
    onPick: yes => (yes ? runTrade(P, Q, afterMeeting, { voluntary: true }) : afterMeeting()),
  });
}

// The player has just died: they can watch the others play on, or skip straight to the result.
let outNoticeShown = false;
function checkPlayerOut() {
  if (PRACTICE || outNoticeShown || state.finished || me().alive) return;
  outNoticeShown = true;
  hand.close(); map.close(); hud.hideConfirm();
  overlays.ask('You are out', 'Your guest has died. Everything you carried lies on the floor. Watch the others play on, or skip straight to how it ends.',
    { yes: 'Skip to the result', no: 'Watch' }, skipToEnd);
}

// --- Computer guests' turns ------------------------------------------------------------------
// Each frame on a bot's turn, once nothing is under way (a walk, a meeting, a screen the player is
// reading) and its thinking pause is over, the bot takes ONE action (src/bots/: nextAction), carried
// out here through the rules code exactly like the player's. Refused actions are reported back to it;
// three in a turn (or a runaway turn) end it. The 45-second clock runs for bots too, as a backstop.
let botNextAt = 0;           // when the active bot takes its next step (performance.now ms)
let botSteps = 0, botRefusals = 0;

// A bot's thinking pause, scaled by the Bot speed setting (quicker still once the player is out).
function botThink(i, kind) {
  let base = 600;
  try { base = bots?.thinkMs(i, kind) ?? 600; } catch { /* keep the default */ }
  const k = settings.choice('botSpeed')?.think ?? 1;
  return base * k * BOT_PACE * (me()?.alive ? 1 : 0.5);
}
function botWalkScale() { return (settings.choice('botSpeed')?.walk ?? 1.45) * (me()?.alive ? 1 : 1.4); }

function startBotTurn(p) {
  movers[p.index].speedScale = botWalkScale();
  startTimer();          // everyone's clock shows, as it would online
  botSteps = 0; botRefusals = 0;
  botNextAt = performance.now() + botThink(p.index, 'turn');
  if (focusIndex() === p.index) rig.recentre({ zoom: false });
  refresh();
}

function botTick(now) {
  if (!running || PRACTICE || state.finished || !bots) return;
  const p = activePlayer(state);
  if (!isBot(p.index) || now < botNextAt || walkCutShort) return;
  if (meetingLive || pendingArrival || activeMover().walking || activeMover().path.length) return;
  if (handoff.isOpen || overlays.noticeOpen || overlays.askOpen || overlays.endOpen || discard.isOpen || meeting.isOpen) return;
  botStep(p);
}

function botStep(p) {
  if (++botSteps > 40 || botRefusals >= 3) { endTurnNow(); return; }
  let a = null;
  try { a = bots.nextAction(p.index); } catch (err) { console.error('A computer guest could not decide:', err); endTurnNow(); return; }
  let ok = false;
  try { ok = runBotAction(p, a || { k: 'end' }); } catch (err) { console.error('A computer guest action failed:', err); ok = false; }
  if (ok === 'ended') return;
  if (!ok) {
    botRefusals++;
    try { bots.reject(p.index, a, 'refused'); } catch { /* nothing to tell */ }
    botNextAt = performance.now() + 150;
    return;
  }
  botNextAt = performance.now() + botThink(p.index, a.k === 'move' ? 'move' : 'act');
}

// Carry out one bot action through the rules. true: done; false: refused; 'ended': the turn is over.
function runBotAction(p, a) {
  switch (a.k) {
    case 'end': endTurnNow(); return 'ended';
    case 'move': {
      if (!floor.rooms.has(a.to) || a.to === p.currentRoom) return false;
      const plan = discovery.planToRoom(a.to, standAtFor(p.index));
      if (!plan.ok) return false;
      startWalk(plan);
      return true;
    }
    case 'open': return botOpenDoor(p, a.door);
    case 'search': {
      const gate = canSearch(state, floor, p);
      if (!gate.ok) return false;
      const spot = searchSpotOf(floor.rooms.get(p.currentRoom));
      if (spot) faceTowards(spot.center);
      const r = search(state, floor, p);
      if (!r.ok) return false;
      syncViews(false); refresh();
      return true;
    }
    case 'card': return botCard(p, a);
    case 'job': return botJob(p);
    case 'escape': {
      const r = escape(state, floor, p);
      if (!r.ok) return false;
      syncViews(false); refresh(); showEnd();
      return 'ended';
    }
    case 'trade': {
      const Q = state.players[a.with];
      if (!Q || !Q.alive || Q.currentRoom !== p.currentRoom || !canTradeVoluntarily(state, floor, p)) return false;
      botProposeTrade(p, Q);
      return true;
    }
    default: return false;
  }
}

function botOpenDoor(p, doorId) {
  const r = openDoor(state, floor, p, doorId);
  // A jammed door is a discovery, not a mistake: the bot learns it (its view drops that door) and nothing
  // is spent, so it does not count as a refused action.
  if (!r.ok) { refresh(); return r.reason === 'jammed'; }
  rebuildGrid();
  discovery.refresh();
  syncViews(true);
  refresh();
  if (focusIndex() === p.index) {
    const rect = q => [q.min[0], q.min[1], q.max[0], q.max[1]];
    rig.showRooms([rect(floor.rooms.get(p.currentRoom)), rect(r.room)]);
  }
  return true;
}

function botCard(p, a) {
  let r = null;
  if (a.type === 'bandage') r = useBandage(state, p, a.card);
  else if (a.type === 'espresso') r = useEspresso(state, p, a.card);
  else if (a.type === 'handMirror') {
    r = useHandMirror(state, floor, p, a.card, a.target);
    // The player was looked at: told at once (the feed says it too), not again at their next turn.
    if (r.ok && a.target === me().id) {
      const line = `${p.name} looked at your whole hand with a Hand Mirror.`;
      me().notes = me().notes.filter(n => n !== line);
      hud.toast(line, 4);
    }
  } else if (a.type === 'masterKey' || a.type === 'lockPick') r = useUnlock(state, floor, p, a.card, a.target);
  else if (a.type === 'barricade') r = useBarricade(state, floor, p, a.card, a.target);
  if (!r?.ok) return false;
  syncViews(false); refresh();
  return true;
}

function botJob(p) {
  const gate = canUseRoom(state, floor, p);
  if (!gate.ok) return false;
  if (gate.job === 'infirmary') {
    if (!useInfirmary(state, floor, p).ok) return false;
  } else if (gate.job === 'switchboard') {
    const r = useSwitchboard(state, floor, p);
    if (!r.ok) return false;
    hud.toast(`${p.name} rang the Switchboard. ${switchboardLine(r.count)}`, 6);
  } else return false;
  refresh();
  return true;
}

// A bot over the hand limit at the end of its turn chooses what to drop.
function botDiscardDown(p) {
  for (let guard = 12; overHandLimit(p) > 0 && guard > 0; guard--) {
    const ids = p.hand.filter(c => c.type !== 'possession').map(c => c.id);
    let id = null;
    try { id = bots.discard(p.index, ids); } catch (err) { console.warn('bot discard failed', err); }
    if (!discardCard(state, p, id).ok) discardCard(state, p, ids[0]);
  }
}

// The player is out (dead): the rest of the match is played at once by the bots, through the same
// rules (src/bots/autoplay.js), and the guests are put where the rules left them.
let botsAutoplay = null;     // src/bots/autoplay.js, loaded with the bots
function skipToEnd() {
  if (state.finished || !bots || !botsAutoplay) return;
  if (meetingLive) { overlays.hideAsk(); hud.toast('A meeting is under way — skipping as soon as it ends.', 3); skipQueued = true; return; }
  skipQueued = false;
  overlays.hideAsk();
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null; activeWalk = null;
  stopTimer();
  for (const m of movers) m.halt();
  // A bot arriving in a room this very moment still has its forced meeting.
  const arriving = !!pendingArrival;
  pendingArrival = null;
  try {
    if (arriving && isBot(state.activeIndex)) botsAutoplay.runMeeting(state, floor, bots, activePlayer(state));
    botsAutoplay.playOut(state, floor, bots, { maxTurns: 600 });
  } catch (err) { console.error('could not finish the match:', err); }
  movers.forEach((m, i) => { const s = standingSlot(state.players[i].currentRoom, i); m.reset(s.x, s.z); });
  rebuildGrid(); discovery.refresh(); syncViews(false); refresh();
  if (state.finished) showEnd();
  else { hud.toast('The match could not be finished at once — it plays on.', 4); beginTurn(); }
}
let skipQueued = false;       // "Skip to the end" was asked for during a meeting

// --- Actions -----------------------------------------------------------------------------
const SEARCH_FAIL = {
  notSearchable: 'There is nothing to search in here.',
  searched: 'This room has already been searched.',
  dark: 'Too dark to search — you need a Flashlight.',
  ap: 'No action points left to search.',
  empty: 'Nothing left to find here.',
};

function onSearch() {
  if (!running || state.finished || uiBusy() || activeMover().walking || !myTurn()) return;
  const player = activePlayer(state);
  const r = search(state, floor, player);
  if (!r.ok) { hud.toast(SEARCH_FAIL[r.reason] || 'Cannot search now.'); return; }
  const where = r.searchPoint || 'the room';
  syncViews(false);
  // Everything found goes into the hand, even past the limit of 6 (approved rule): the limit is
  // settled only when the turn ends (endTurnNow -> the discard screen). Over it, the reveal adds a
  // calm reminder, and the hand fan shows "Cards 8/6 · discard 2 at end of turn".
  const found = r.kind === 'found' || r.kind === 'cards' ? r.cards : r.kind === 'card' ? [r.card] : [];
  const line = r.kind === 'found'
    ? `Lying in ${where}: ${r.cards.map(c => CARDS[c.type].name).join(', ')}. You take it all.`
    : r.kind === 'nothing' ? `You search ${where}. Nothing.`
      : r.kind === 'cards' ? `You search ${where} and find ${andList(r.cards.map(c => aCard(c.type)))}.`
        : `You search ${where} and find ${aCard(r.card.type)}.`;
  const lanterns = player.hand.filter(c => c.type === 'lantern').length;
  const tally = lanterns ? ` You now hold ${lanterns} Lantern${lanterns === 1 ? '' : 's'}.` : '';
  const over = r.over || 0;
  const limitNote = over > 0
    ? ` You hold ${countableCount(player.hand)} cards, more than ${rules.handLimit}: keep them all for now, and discard ${over} when you end your turn.` : '';
  const then = () => refresh();
  // Search results are PRIVATE: the others learn only that a search happened (the public log). The
  // found cards are shown large on the player's own screen, on a light backdrop with the room still in
  // view (only the player looks at this screen).
  handoff.privateFound(player, {
    kicker: `You search ${where}`,
    title: !found.length ? 'Nothing here' : r.kind === 'found' ? `You pick up ${andList(found.map(c => aCard(c.type)))}` : `You found ${andList(found.map(c => aCard(c.type)))}`,
    cards: found,
    lines: [line + tally + limitNote],
    soft: true,
  }, then);
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

// Turn the active guest to look at a point (the furniture they search).
function faceTowards([x, z]) {
  const m = activeMover();
  if (Math.hypot(x - m.x, z - m.z) > 0.05) m.heading = Math.atan2(x - m.x, z - m.z);
}

function onUseBandage(cardId) {
  if (!myTurn() || !inActionPhase) return;
  const r = useBandage(state, activePlayer(state), cardId);
  if (!r.ok) { hud.toast(r.reason === 'full' ? 'Already at full health.' : r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.'); return; }
  hud.toast(`Bandaged — health ${r.health} of ${rules.maxHealth}.`);
  refresh();
}

function onUnlock(cardId, roomId) {
  if (!myTurn() || !inActionPhase) return;
  const r = useUnlock(state, floor, activePlayer(state), cardId, roomId);
  const name = floor.rooms.get(roomId)?.name ?? 'locked room';
  if (!r.ok) {
    hud.toast(r.reason === 'ap' ? 'No action points left.'
      : r.reason === 'sealed' ? `The ${name} door is barricaded: a key or pick cannot get you through it until the barricade comes down.`
        : 'Cannot use that here.');
    return;
  }
  hud.toast(r.opened ? `The ${name} door is open until the end of your turn.`
    : `The lock pick snapped. The ${name} door stays locked.`);
  hand.close();
  syncViews(false); refresh();
}

function onBarricade(cardId, doorwayId) {
  if (!myTurn() || !inActionPhase) return;
  const r = useBarricade(state, floor, activePlayer(state), cardId, doorwayId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot barricade that.'); return; }
  hud.toast(`${cap(doorName(doorwayId, activePlayer(state).currentRoom))} barricaded until your next turn.`, 5);
  hand.close();
  syncViews(false); refresh();
}

// Espresso (free): extra action points for this turn only.
function onEspresso(cardId) {
  if (!myTurn() || !inActionPhase) return;
  const r = useEspresso(state, activePlayer(state), cardId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.'); return; }
  hud.toast(`Espresso — ${r.gained} extra actions this turn.`);
  refresh();
}

// Hand Mirror (1 action): another guest in the room shows the user their whole hand. What it shows
// is PRIVATE and goes on the user's own screen; the others learn only that the mirror was used, and on
// whom (the public log).
const MIRROR_FAIL = {
  ap: 'No action points left.',
  noTarget: 'Choose another guest in this room.',
  targetDead: 'That guest is dead.',
  notTogether: 'That guest is not in this room any more.',
};
function onHandMirror(cardId, targetId) {
  if (!myTurn() || !inActionPhase) return;
  // Not mid-walk: walking into a room with a guest starts a meeting first, before anything else.
  if (activeMover().walking || pendingArrival) { hud.toast('Wait until you have arrived.'); return; }
  const player = activePlayer(state);
  const r = useHandMirror(state, floor, player, cardId, targetId);
  if (!r.ok) { hud.toast(MIRROR_FAIL[r.reason] || 'Cannot use that now.'); return; }
  const target = state.players.find(q => q.id === r.target);
  hand.close();
  refresh();
  const lines = r.unmasked
    ? [player.possessed
      ? `${target.name} holds a Possession card — ${target.name} is possessed too.`
      : `${target.name} holds a Possession card — ${target.name} is POSSESSED. Only you know.`]
    : [];
  handoff.privateHand(player, {
    kicker: `Hand Mirror · private — ${player.name} only`,
    title: `${target.name}'s hand`,
    sub: `${target.name} shows you every card they carry. Nobody else sees this.`,
    cards: r.hand,
    lines,
  }, () => refresh());
}

// A room with a job (src/data/hotel.js `job`). The Infirmary heals; the Switchboard tells the whole
// table how many guests are possessed right now, never who. A Linen Store's job is in the search.
const ROOM_FAIL = {
  full: 'Already at full health.',
  ap: 'No action points left.',
  usedThisTurn: 'You have already rung the Switchboard this turn.',
  noJob: 'There is nothing to use in this room.',
};
function switchboardLine(n) {
  if (n === 0) return 'No guest is possessed right now.';
  return `${n} ${n === 1 ? 'guest is' : 'guests are'} possessed right now — it doesn't say who.`;
}
function onRoom() {
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
  if (!myTurn() || !inActionPhase) return;
  const player = activePlayer(state);
  // The Fire Exit: escaping is its own action (1 AP). The refusal reads the same for everyone.
  if (floor.rooms.get(player.currentRoom)?.isExit) {
    const r = escape(state, floor, player);
    if (r.ok) { syncViews(false); refresh(); showEnd(); return; }
    hud.toast(r.reason === 'ap' ? 'No actions left — you can escape on your next turn.'
      : `The fire exit opens only for a clean guest carrying ${rules.lanternsToEscape} Lanterns.`);
    return;
  }
  const gate = canUseRoom(state, floor, player);
  if (!gate.ok) { hud.toast(ROOM_FAIL[gate.reason] || 'Cannot use this room now.'); return; }
  if (gate.job === 'infirmary') {
    const r = useInfirmary(state, floor, player);
    if (!r.ok) { hud.toast(ROOM_FAIL[r.reason] || 'Cannot use this room now.'); return; }
    hud.toast(`Treated in the Infirmary — health ${r.health} of ${rules.maxHealth}.`);
    refresh();
  } else if (gate.job === 'switchboard') {
    const r = useSwitchboard(state, floor, player);
    if (!r.ok) { hud.toast(ROOM_FAIL[r.reason] || 'Cannot use this room now.'); return; }
    refresh();
    // PUBLIC, for every guest: it stays up until the player taps Continue (the clock waits).
    // Practice: nobody else is in the hotel, so there is nobody to count — say what it does in a match.
    overlays.showNotice('The Switchboard', PRACTICE
      ? 'You rang the Switchboard. In a match it tells everyone how many guests are possessed. You are alone in the hotel, so there is nobody to count.'
      : `You rang the Switchboard. ${switchboardLine(r.count)}`, refresh);
  }
}

// --- End of the match ----------------------------------------------------------------------
function showEnd() {
  stopTimer();
  meetingLive = false;
  hud.hideConfirm(); selectedMove = null;
  if (state.practice) {
    overlays.showEnd('You reached the fire exit',
      `Practice complete: ${rules.lanternsToEscape} Lanterns carried out.\n${floor.roomList.length} rooms of the hotel revealed, on round ${state.round}.`,
      { keepExploring: false, restartLabel: 'Restart practice' });
    return;
  }
  const you = me();
  const out = [...state.escaped].map(id => state.players.find(p => p.id === id)).filter(Boolean);
  const cleanWon = state.won === 'humans';
  const yourSideWon = cleanWon !== !!you.possessed;
  const name = p => (p.index === humanSeat ? 'You' : p.name);
  // What happened, in a line or two; then every guest's role revealed (the match is over).
  let title, line;
  if (cleanWon) {
    title = out.some(p => p.index === humanSeat) ? 'You got out!' : 'The guests got out';
    line = `${andList(out.map(name))} escaped carrying ${rules.lanternsToEscape} Lanterns.`;
  } else if (state.dawn) {
    title = 'Dawn breaks';
    line = `Round ${rules.roundLimit} has ended and nobody got out. The hotel keeps them.`;
  } else {
    title = 'The hotel keeps them';
    line = 'No clean guest is left.';
  }
  const verdict = yourSideWon ? (you.possessed ? 'The possessed win — your side.' : 'The clean guests win — your side.')
    : (you.possessed ? 'The clean guests win. Your side lost.' : 'The possessed win. Your side lost.');
  const reveal = state.players.map(p => ({
    name: p.name,
    who: p.index === humanSeat ? 'You' : (botProfiles[p.index]?.username || ''),
    color: p.color,
    possessed: p.possessed,
    status: state.escaped.has(p.id) ? 'Escaped' : !p.alive ? 'Dead' : '',
    you: p.index === humanSeat,
  }));
  overlays.showEnd(title, `${line}\n${verdict} · ${roundLabel(state)}`, { restartLabel: 'Play again', reveal, won: yourSideWon });
}

// A fresh hotel and a fresh deal for the guests at the table now.
function resetWorld() {
  gameToken++;
  seed = newSeed();
  resetState(state, floor, seed);          // a new random hotel
  state.viewerIndex = humanSeat;
  clearRoomViews(roomViews, view.scene);
  doorways.reset();
  rebuildGrid();
  movers.forEach((m, i) => { m.reset(startSpot(i)[0], startSpot(i)[1]); m.speedScale = 1; });
  pendingArrival = null; selectedMove = null; activeWalk = null; walkCutShort = false; queuedTap = null;
  meetingLive = false; outNoticeShown = false; botNextAt = 0; lockNews = ''; skipQueued = false;
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
  refresh();
}

// The end screen's main button, and Restart practice: practice starts again in a new hotel; a match
// becomes a new match at a new table with the same choices (how many guests, your role).
function restart() {
  if (PRACTICE) {
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
let botModules = null;       // src/bots/*, loaded the first time a match is set up
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
    const [index, profiles, autoplay] = await Promise.all([
      import('./bots/index.js'), import('./bots/profiles.js'), import('./bots/autoplay.js')]);
    botModules = { index, profiles, autoplay };
  }
  return botModules;
}

// Who sits where, who the computer guests are, and who starts possessed — like joining a random online
// table: a random seat, random guests, random bots. `choice`: { practice: true } or { bots: 3-5, role }.
async function planGame(choice) {
  if (choice.practice) return { practice: true, cast: [roster[0]], humanSeat: 0, profiles: [null], possessedIndex: null, choice };
  const mods = await loadBots();
  const n = Math.max(3, Math.min(5, Math.round(choice.bots) || 5)) + 1;
  const rng = makeRng(Number.isFinite(forcedSeed) && forcedSeed > 0 ? (forcedSeed * 7919 + 13) >>> 0 : ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0) || 1);
  const guests = shuffle([...roster], rng).slice(0, n);
  const askedSeat = parseInt(params.get('seat'), 10);
  const seat = Number.isFinite(askedSeat) ? Math.max(0, Math.min(n - 1, askedSeat)) : Math.floor(rng() * n);
  const rolled = mods.profiles.rollProfiles(n - 1, rng);
  const profiles = guests.map((_, i) => (i === seat ? null : rolled.shift()));
  let possessedIndex = null;                                   // random, dealt by the rules
  if (choice.role === 'possessed') possessedIndex = seat;
  else if (choice.role === 'clean') {
    const others = guests.map((_, i) => i).filter(i => i !== seat);
    possessedIndex = others[Math.floor(rng() * others.length)];
  }
  return { practice: false, cast: guests, humanSeat: seat, profiles, possessedIndex, choice };
}

// Seat the table and deal a new game (no screens: the caller shows them).
function setupGame(plan) {
  PRACTICE = plan.practice;
  lastChoice = plan.choice || { practice: true };
  cast.length = 0; cast.push(...plan.cast);
  humanSeat = plan.humanSeat;
  botProfiles = plan.profiles;
  applyMode(PRACTICE ? 'practice' : 'match', cast.length);
  if (TIMER_OFF) rules.turnTimerEnabled = false;
  Object.assign(state, { roster: cast, mode: PRACTICE ? 'practice' : 'match', practice: PRACTICE, hotseat: false });
  state.setup = { possessedIndex: plan.possessedIndex };
  movers.length = 0;
  cast.forEach((_, i) => movers.push(createPlayer(cfg, startSpot(i))));
  castCharacters();
  usePracticeWording(PRACTICE);
  bots = null;
  hud.rebuild();
  resetWorld();
  if (!PRACTICE) {
    const seats = botProfiles.map((profile, index) => (profile ? { index, profile } : null)).filter(Boolean);
    bots = botModules.index.createBotTable(state, floor, seats, ((seed * 2654435761) >>> 0) || 1);
    // (who plays each guest, for the strip: interface only, never read by the rules or the bots)
    state.players.forEach((p, i) => { p.handle = i === humanSeat ? 'You' : botProfiles[i]?.username || ''; });
    hud.rebuild();
    botsAutoplay = botModules.autoplay;
    movers.forEach((m, i) => { m.speedScale = isBot(i) ? botWalkScale() : 1; });
  }
  document.title = PRACTICE ? 'Hotel Escape — Practice' : `Hotel Escape — ${cast.length} guests`;
  refresh();
}

// From the menu into the game: the lift (unless switched off), black, the game, the lights come up.
async function enterGame(plan, { guests = 3 } = {}) {
  menu.leave();
  phase = 'intro';
  applyPixelRatio();
  container.classList.remove('blurred');
  if (INTRO && lobbyReady && lobby) {
    // (never longer than LIFT_MAX_MS: on a struggling device the scene runs slow, and the game must not wait)
    try { await Promise.race([lobby.enter({ guests }), wait(LIFT_MAX_MS)]); } catch (err) { console.warn('the lift sequence failed:', err); }
  } else await wait(400);
  await fade(true, 650);
  menu.hide();
  setupGame(plan);
  phase = 'game';
  view.compile();
  await frame(); await frame();
  begin();
  if (PRACTICE) {
    overlays.showNotice('Practice',
      `You are alone in the hotel. You start with ${rules.lanternsDealtEach} Lantern — find ${rules.lanternsToEscape - rules.lanternsDealtEach} more and escape through the Fire Exit.`, refresh);
  }
  await fade(false, 900);
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
  const seats = [humanSeatFirst(plan)].concat(plan.cast.map((def, i) => ({ i, def })).filter(x => x.i !== plan.humanSeat).map(x => ({
    name: x.def.name, color: x.def.color, username: plan.profiles[x.i]?.username || 'guest', you: false,
  })));
  menu.matchmake(seats, { onFull: () => enterGame(plan, { guests: 3 }), onCancel: () => {} });
}
function humanSeatFirst(plan) {
  const def = plan.cast[plan.humanSeat];
  return { name: def.name, color: def.color, username: 'You', you: true };
}

// Play again (a match): a new table with the same choices, straight in (no menu, no lift).
async function playAgain() {
  const plan = await planGame(lastChoice.practice ? { practice: true } : lastChoice);
  await fade(true, 450);
  setupGame(plan);
  begin();
  await frame();
  await fade(false, 700);
}

// Back to the main menu (from the end screen or the Menu button).
async function backToMenu() {
  await fade(true, 450);
  gameToken++;
  running = false;
  phase = 'menu';
  stopTimer();
  hud.hide();
  overlays.hideEnd(); overlays.hideNotice(); overlays.hideAsk(); overlays.hideStart();
  hand.close(); map.close(); discard.close(); handoff.close(); meeting.close(); hud.hideConfirm();
  feed.reset(false);
  movers.forEach(m => m.halt());
  meetingLive = false;
  bots = null;
  lobby?.reset();
  applyPixelRatio();
  container.classList.add('blurred');
  menu.show('main');
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
  if (t.kind === 'search') { if (!queued) onSearchSpot(); return; }
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
    return player.actionPoints <= 0 ? 'Not enough action points — none left this turn.'
      : `Not enough action points: the ${dest.name} is ${plan.cost} rooms away (${plan.cost} AP).`;
  }
  return `There is no way through to the ${dest.name} right now.`;
}

// Offer the walk to room `destId`: the fewest-rooms route there (1 AP per room entered) to a free
// standing spot in its middle, shown as a dotted path, an outline round the room the walk ends in and a
// cost tag, with the Move / Cancel bar. If a meeting is forced in a room on the way, the walk ends there
// (the rules plan it so: planRoomMove) and the bar says so.
function offerMove(destId) {
  const player = activePlayer(state);
  const dest = floor.rooms.get(destId);
  if (!dest) return;
  const plan = discovery.planToRoom(destId, standAtFor(player.index));
  if (!plan.ok) {
    hud.hideConfirm(); selectedMove = null;
    if (plan.reason !== 'finished' && plan.reason !== 'dead') hud.toast(moveRefusal(plan, dest, player), 4);
    return;
  }
  const end = plan.waypoints[plan.waypoints.length - 1];
  plan.preview = { label: `Move · ${plan.cost} AP`, anchor: end, room: floor.rooms.get(plan.dest) };
  selectedMove = plan;
  const who = plan.meet.map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
  const note = plan.stop ? ` You will stop in the ${floor.rooms.get(plan.stop).name} to meet ${andList(who)}.` : '';
  hud.showConfirm(`Move to ${dest.name}?${note}`, `Move · ${plan.cost} AP`);
}

// Set off on a confirmed walk (the player's, or a computer guest's). The view comes back to the guest
// so the walk can be followed (on another guest's turn, only if the view follows them: Settings).
function startWalk(plan) {
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
  ap: 'No action points left to open a door.',
  notYourDoor: 'You can only open a door of the room you are in.',
};
function onOpenDoor(doorId) {
  if (!running || state.finished || !myTurn()) return;
  const player = activePlayer(state);
  const r = openDoor(state, floor, player, doorId);
  if (!r.ok) { hud.toast(DOOR_FAIL[r.reason] || 'That door will not open.'); refresh(); syncViews(false); return; }
  rebuildGrid();
  discovery.refresh();
  syncViews(true);
  refresh();
  // Ease the view so the guest's room and the room just revealed are both in view (it may lie behind
  // the room's far wall or under the interface otherwise).
  const rect = q => [q.min[0], q.min[1], q.max[0], q.max[1]];
  rig.showRooms([rect(floor.rooms.get(player.currentRoom)), rect(r.room)]);
  hud.toast(r.room.isExit ? `The door opens onto the ${r.room.name}!`
    : `The door opens: ${r.room.name}${r.locked ? ' — locked' : ''}${r.room.dark ? ' — dark' : ''}.`);
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
  '#hand-fan .fan-limit', '.hud-bottom-right', '#btn-end-turn', '#confirm-bar', '#toast', '#search-spot', '.path-label'];
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
    if (!running || state.finished || uiBusy()) return;
    if (!myTurn() || !inActionPhase) return;
    if (inDeadZone(x, y)) return;
    const t = tapTargetAt(x, y);
    if (!t) return;
    if (activeMover().walking || activeMover().path.length || pendingArrival) {
      if (t.kind === 'room') queuedTap = { target: t, turn: state.turn };
      else if (t.kind === 'fog' || t.kind === 'search') { queuedTap = null; hud.toast('Wait until you arrive.'); }
      return;
    }
    queuedTap = null;
    tapTarget(t);
  },
  onPinch(factor) { if (running) rig.zoomBy(factor); },
  onDrag(fromX, fromY, toX, toY) {
    if (!running) return;
    const a = screenToGround(fromX, fromY, hitA);
    const b = screenToGround(toX, toY, hitB);
    if (a && b) rig.panByWorld(a.x - b.x, a.z - b.z);
  },
  onWheel(deltaY) { if (running) rig.zoomBy(Math.exp(-deltaY * 0.0015)); },
  onGestureEnd() { rig.release(); },
});

hud.on('rotateLeft', () => rig.rotateLeft());
hud.on('rotateRight', () => rig.rotateRight());
// "Centre on me": back to the active guest, at the standard zoom.
function onCentre() { if (running) rig.recentre(); }
hud.on('centre', onCentre);
hud.on('endTurn', doEndTurn);
hud.on('roomJob', onRoom);
hud.on('trade', onTrade);
hud.on('private', () => { if (running && !uiBusy()) hand.open(state, floor); });
hud.on('map', () => { if (!meeting.isOpen && !discard.isOpen && !overlays.endOpen && !handoff.isOpen) map.toggle(state, movers); });
// The Menu button: back to the main menu, after asking (the game in progress is lost).
hud.on('leave', () => {
  if (overlays.endOpen) { backToMenu(); return; }
  if (uiBusy() || meetingLive) return;
  overlays.ask(PRACTICE ? 'Leave practice?' : 'Leave the match?',
    PRACTICE ? 'This hotel and everything you have found will be lost.' : 'The others will carry on without you. This match will be lost.',
    { yes: 'Main menu', no: 'Keep playing' }, backToMenu);
});
hud.onConfirm(
  () => {
    if (!selectedMove) return;
    const chosen = selectedMove;
    selectedMove = null; hud.hideConfirm();
    startWalk(chosen);
  },
  () => { selectedMove = null; hud.hideConfirm(); },
);
overlays.onRestart(restart);
overlays.onMenu(backToMenu);
// Restart practice throws the whole hotel away, so it asks first (from the end screen it does not:
// the match is over).
hud.on('restartPractice', () => {
  if (overlays.endOpen) { restart(); return; }
  if (uiBusy()) return;
  overlays.ask('Restart practice?', 'This hotel and everything you have found will be lost, and you start again in the lobby of a new hotel.',
    { yes: 'Restart', no: 'Keep playing' }, restart);
});

// --- Start: the main menu, or a direct link --------------------------------------------------------
const menu = createMenu(document, {
  onPlayBots: choice => startBots(choice),
  onPractice: () => startPractice(),
  onSettingChanged: name => applySettings(name),
});
// The lobby behind the menu is drawn at a lower resolution (it is blurred anyway: cheaper on the iPad);
// the lift sequence and the game use the Graphics setting.
const MENU_PIXEL_RATIO = 0.75;
function gamePixelRatio() { return settings.choice('graphics')?.pixelRatio ?? cfg.render.maxPixelRatio; }
function applyPixelRatio() { view.setPixelRatio(phase === 'menu' && !DIRECT ? Math.min(MENU_PIXEL_RATIO, gamePixelRatio()) : gamePixelRatio()); }
function applySettings(name = null) {
  if (!name || name === 'graphics') applyPixelRatio();
  if (name === 'botSpeed' && bots) movers.forEach((m, i) => { if (isBot(i)) m.speedScale = botWalkScale(); });
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
  const n = Math.max(3, Math.min(5, parseInt(params.get('bots'), 10) || 5));
  const role = ['random', 'clean', 'possessed'].includes(params.get('role')) ? params.get('role') : 'random';
  if (sub) {
    sub.textContent = DIRECT === 'practice'
      ? `Practice · explore the hotel alone\nYou start with ${dealt} Lantern — find ${rules.lanternsToEscape - dealt} more and escape through the Fire Exit`
      : `A match · you and ${n} computer guests · one is secretly possessed`;
  }
  overlays.showStart();
  const planned = planGame(DIRECT === 'practice' ? { practice: true } : { bots: n, role });
  planned.then(plan => { setupGame(plan); startReady = true; maybeReady(); })
    .catch(err => { console.error(err); overlays.showError(`The game could not be set up. (${err?.message || err})`); });
  overlays.onBegin(() => { if (startReady) begin(); });
} else {
  menu.show('main');
  container.classList.add('blurred');
  import('./menu/lobbyScene.js')
    .then(mod => {
      lobby = mod.createLobbyScene({ renderer: view.renderer, cfg });
      lobby.setSize(view.size.w, view.size.h);
      return lobby.ready;
    })
    .then(() => { lobbyReady = !!lobby; })
    .catch(err => { console.warn('The lobby behind the menu could not be loaded; the menu shows over the hotel instead.', err); lobby = null; });
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
view.renderer.setAnimationLoop(now => {
  perfStats.frame(now - last);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  const prevLobby = lastLobby; lastLobby = now;
  // The main menu and the lift: the lobby scene (once loaded; until then, the hotel itself shows,
  // blurred, behind the menu).
  if (phase !== 'game' && lobbyReady && lobby) {
    if (view.size.w !== lobbySize.w || view.size.h !== lobbySize.h) {
      lobbySize.w = view.size.w; lobbySize.h = view.size.h;
      lobby.setSize(lobbySize.w, lobbySize.h);
    }
    // (the lift keeps to the clock even when frames are slow: up to a quarter of a second per frame)
    const ldt = phase === 'intro' ? Math.min(0.25, Math.max(0, (now - prevLobby) / 1000)) : dt;
    lobby.update(phase === 'menu' && settings.get('menuMotion') === 'off' ? 0 : ldt, time);
    view.renderer.render(lobby.scene, lobby.camera);
    if (++frames >= 2 && !framesReady) { framesReady = true; maybeReady(); }
    return;
  }
  if (running && !state.finished) {
    tickTimer(dt);
    activeMover().update(dt);
    discovery.update();
    if (pendingArrival && !activeMover().walking && activeMover().path.length === 0) onArrive();
    replayQueuedTap();
    botTick(now);
  }
  rig.setFocus(...followPoint());
  rig.update(dt);
  for (const rv of roomViews.values()) rv.update(dt);
  doorways.update(time, dt, roomViews);
  pathPreview.update(selectedMove && hud.confirmOpen && !activeMover().walking ? selectedMove : null, time);
  fog.update(floor, me(), { time, dt });
  const fi = focusIndex();
  mood.update(state.players[fi].currentRoom, dt, time, movers[fi]);
  updateCutaway(roomViews, rig, state, cfg, dt);
  // Red eyes only on the player's own guest, on their own screen, while possessed; never in practice,
  // and not on the old game still drawn behind the menu (when the menu's lobby scene is not loaded).
  characters.forEach((cv, i) => { cv.setPossessed(phase === 'game' && !PRACTICE && i === humanSeat && !!state.players[i]?.possessed); cv.update(movers[i], dt); });
  view.render();
  syncHandFan();
  syncSearchSpot();     // after the render, so it reads this frame's camera
  if (running) { feed.sync(state, PRACTICE ? null : me()); feed.tick(); feed.place(topLeftEl); }
  // The tags over the view, most important first (a later tag that would clash is left out): when zoomed
  // far out, the active guest's name (so they can always be found); Explore over the fogged rooms next
  // door; Go over the rooms next door (not when zoomed far out: the names take over); then the other
  // guests' names.
  const still = !activeMover().walking && !activeMover().path.length && !pendingArrival;
  const tagsOk = actionPhaseClear() && !hand.isOpen && still;
  const namesOk = running && !handoff.isOpen && !overlays.endOpen && !map.isOpen;
  screenTags.begin();
  guestTags.update(screenTags, state, movers, rig.distance, namesOk, 'active');
  if (tagsOk) fog.tags(screenTags, me().actionPoints);
  goTags.update(screenTags, state, floor, me(), tagsOk && !hud.confirmOpen && rig.distance <= cfg.camera.tagsFrom);
  guestTags.update(screenTags, state, movers, rig.distance, namesOk, 'others');
  screenTags.end();
  if (++frames >= 2 && !framesReady) { framesReady = true; maybeReady(); }
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// --- Debug / test hooks ------------------------------------------------------------------
window.__game = {
  cfg, rules, hotel, floor, grid, state, movers, rig, roomViews, doorways, characters, discovery, view, pathPreview, fog, screenTags,
  begin, restart, endTurn: doEndTurn,
  refresh,
  activePlayer: () => activePlayer(state),
  nextPlayer: () => nextPlayer(state),
  activeMover,
  walkTo: (x, z) => discovery.walkTo(x, z),
  moveToRoom,
  search: () => onSearch(),
  // The search icon and the hand fan (tests).
  tapSearchSpot: () => onSearchSpot(),
  searchSpot: () => ({ mode: searchSpot.mode, point: searchSpot.point, spot: searchSpot.spot && { center: searchSpot.spot.center, height: searchSpot.spot.size[1], kind: searchSpot.spot.kind } }),
  searchPending: () => false,      // (searching no longer walks anywhere first; kept for older scripts)
  fanIds: () => (fan.visible ? fan.ids : []),
  cardViewOpen: () => hand.isOpen,
  cardViewId: () => hand.cardId,
  useBandage: id => onUseBandage(id),
  // Part 2: rooms with jobs and the new cards (same paths as the buttons).
  roomJob: () => canUseRoom(state, floor, activePlayer(state)),
  useRoom: () => onRoom(),
  useEspresso: id => onEspresso(id),
  useHandMirror: (id, targetId) => onHandMirror(id, targetId),
  handMirrorTargets: () => playersInRoom(state, activePlayer(state).currentRoom, activePlayer(state).id).map(q => q.id),
  mirrorOpen: () => handoff.kind === 'mirror',
  unlock: (id, room) => onUnlock(id, room),
  barricade: (id, door) => onBarricade(id, door),
  trade: () => onTrade(),
  mode: () => (PRACTICE ? 'practice' : 'match'), hotseat: false,
  // A match against computer guests (tests): the player's seat, whose seats are bots, the bots' brains,
  // whose turn, the menu and the lift.
  humanSeat: () => humanSeat,
  isBot: i => isBot(i),
  bots: () => bots,
  botProfiles: () => botProfiles.map(p => (p ? { username: p.username, style: p.style } : null)),
  myTurn: () => myTurn(),
  meetingLive: () => meetingLive,
  phase: () => phase,
  lobbyReady: () => lobbyReady,
  menuScreen: () => menu.screen,
  feedLines: () => [...document.querySelectorAll('#feed .feed-line')].map(e => e.textContent),
  skipToEnd: () => skipToEnd(),
  backToMenu: () => backToMenu(),
  endOpen: () => overlays.endOpen,
  askOpen: () => overlays.askOpen,
  handoff, meeting,
  handoffOpen: () => handoff.isOpen, handoffKind: () => handoff.kind,
  handoffNext: () => document.getElementById('btn-handoff-next').click(),
  meetingOpen: () => meeting.isOpen,
  noticeOpen: () => overlays.noticeOpen,
  clickNotice: () => document.getElementById('btn-notice-ok').click(),
  timeLeft: () => timerLeft,
  forceTimeUp: () => { timerLeft = 0.0001; },
  inActionPhase: () => inActionPhase,
  dressingDone: () => dressingDone,
  publicLog: () => state.log.map(l => l.text),
  notesOf: i => [...(state.players[i].notes || [])],
  possessedIndexes: () => state.players.filter(p => p.possessed).map(p => p.index),
  lanterns: () => activePlayer(state).hand.filter(c => c.type === 'lantern').length,
  lockedRooms: () => [...state.lockedRooms],
  openLocks: () => [...state.openLocks.keys()],       // locked doors a key opened this turn
  canEscape: () => canEscape(state, floor, activePlayer(state)),
  escape: () => onRoom(),
  openHand: () => hand.open(state, floor),
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
  stackDeck: id => stackDeck(floor, id),
  // Tests: put a particular room on the board (next to room `nextTo` if given), as if its door
  // had been opened, without spending anyone's action points.
  revealTile: (id, nextTo = null) => {
    for (const room of growTo(floor, id, { isLocked: r => isLocked(state, r) }, nextTo)) {
      state.discovered.add(room.id);
      if (room.locked && rules.lockedDoorsEnabled) state.lockedRooms.add(room.id);
    }
    rebuildGrid(); discovery.refresh(); syncViews(false); refresh();
    return floor.rooms.has(id) && (!nextTo || floor.rooms.get(id).neighbours.has(nextTo));
  },
  hotelRooms: () => floor.roomList.map(r => r.id),
  // Tests: where a guest walking into `room` would stand, and whether a point is on a body.
  standingSlot: (room, i) => standingSlot(room, i),
  onABody: (x, z) => onABody(x, z),
  bodyEnds: i => bodyEnds(movers[i]),
  programCount: () => view.renderer.info.programs.length,
  setPixelRatio: cap => view.setPixelRatio(cap),
};

// Move the active player into a room by id, as a confirmed tap on it would (tests): the
// fewest-rooms route to a free spot in its middle. Returns the plan; the walk and any meeting resolve
// over the next frames.
function moveToRoom(destId) {
  const player = activePlayer(state);
  if (!floor.rooms.has(destId) || destId === player.currentRoom) return { ok: false, reason: 'noRoom' };
  const plan = discovery.planToRoom(destId, standAtFor(player.index));
  if (plan.ok) startWalk(plan);
  return plan;
}
