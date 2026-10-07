// Entry point: builds the floor, sets up rendering, interface and the turn-based rules of
// Hotel Escape, and runs the game loop. Two ways to play the same ruleset (docs/GAME_RULES.md):
// practice (one guest alone) and hot-seat (4-6 guests passing one device). No server, no
// networking — hot-seat is a testing tool for the real online game.
import * as THREE from 'three';
import { config as cfg } from './config.js';
import { rules, applyMode } from './data/rules.js';
import { hotel } from './data/hotel.js';
import { roster } from './data/characters.js';
import { createHotel, stackDeck, growTo, searchSpotOf } from './game/hotel.js';
import { buildGrid } from './game/grid.js';
import {
  createState, resetState, endTurn, activePlayer, nextPlayer, checkWin, canEscape,
  usableDoorways, openableDoors, pendingEncounters, lockEncounter, playersInRoom, isLocked,
  isBarricaded, canTradeVoluntarily, lockedAgainst,
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
import { usePracticeWording } from './ui/cards.js';

// --- World (pure data + rules) ---------------------------------------------------------
// The hotel is random every match: it starts as the lobby and grows as doors are opened
// (src/game/hotel.js). createState builds a fresh one.
const floor = createHotel(hotel, cfg);

// Which game this page is. The choice is in the address so it can be linked, bookmarked and
// driven by the tests; the start screen writes it for the player.
//   ?mode=hotseat&players=6   a six-person hot-seat match on one device
//   ?seed=123                 force the deal, the hidden role and the hotel's room deck (testing)
//   ?timer=off                play without the 45-second turn clock
//   ?camera=square            the previous square-on view (the standard view is corner-on)
//   ?camera=classic           the older, higher square-on view (for comparison)
//   ?stats=1                  a small frame-rate / draw-call readout, for measuring on the iPad
//   ?possessedTell=private    hot-seat: the possessed guest's reminder on their private screens only
//   ?possessedTell=main       hot-seat: also on the main screen during their own turn (the default)
const params = new URLSearchParams(window.location.search);
if (params.get('camera') === 'square') Object.assign(cfg.camera, cfg.cameraSquare);     // the previous square-on view
if (params.get('camera') === 'classic') Object.assign(cfg.camera, cfg.cameraClassic);   // the old, higher view
if (params.get('camera') === 'diagonal') Object.assign(cfg.camera, cfg.cameraDiagonal); // (the standard view; old links)
const MODE = params.get('mode') === 'hotseat' ? 'hotseat' : 'practice';
// ?possessedTell=private (or =off) / =main override cfg.ui.hotseatPossessedOnMainScreen (hot-seat: the
// possessed guest's reminder on the shared main screen during their own action phase; on by default, as
// the owner-approved docs/GAME_RULES.md > Possession says).
if (['private', 'off'].includes(params.get('possessedTell'))) cfg.ui.hotseatPossessedOnMainScreen = false;
if (params.get('possessedTell') === 'main') cfg.ui.hotseatPossessedOnMainScreen = true;
const askedPlayers = parseInt(params.get('players'), 10);
applyMode(MODE, Number.isFinite(askedPlayers) ? askedPlayers : 6);
if (params.get('timer') === 'off') rules.turnTimerEnabled = false;
const HOTSEAT = MODE === 'hotseat';
const PRACTICE = !HOTSEAT;
const cast = roster.slice(0, HOTSEAT ? rules.playerCount : 1);
const forcedSeed = parseInt(params.get('seed'), 10);
const newSeed = () => (Number.isFinite(forcedSeed) && forcedSeed > 0 ? forcedSeed
  : PRACTICE && rules.practiceSeed != null ? rules.practiceSeed
    : (Date.now() & 0x7fffffff) || 1);
let seed = newSeed();
const state = createState(floor, cast, seed, { mode: MODE });
const grid = buildGrid(floor, cfg);
if (floor.problems.length) throw new Error(`Problems in the hotel:\n• ${floor.problems.join('\n• ')}`);
// The walkable grid follows the hotel as it grows (rebuilt in place: everyone keeps the same object).
function rebuildGrid() {
  Object.assign(grid, buildGrid(floor, cfg));
  if (floor.problems.length) console.warn('hotel problems:', floor.problems.join('; '));
}
const startSpot = i => floor.start.positions[i % floor.start.positions.length];
const movers = cast.map((_, i) => createPlayer(cfg, startSpot(i)));

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
const characters = cast.map(def => createCharacterView(def, cfg, view.scene));
const searchMarks = createSearchMarks(floor, view.scene);
const pathPreview = createPathPreview(view.scene, view.camera, view.renderer.domElement, container);
const perfStats = createPerfStats(document, view.renderer, params.get('stats') === '1');
const mood = createMood(roomViews, view.hemi, cfg, view.scene);
const rig = createCameraRig(view.camera, cfg);
// What the camera follows: the active guest while they walk; once they stand still, at most
// FOLLOW_SLACK m (at the default zoom; more when zoomed in) from the centre of their room. A guest
// searching in a far corner would otherwise push the room's near door rings under the hand, and the
// whole room is in view at the default zoom anyway.
const FOLLOW_SLACK = 1.2;
function followPoint() {
  const m = activeMover();
  const room = floor.rooms.get(activePlayer(state).currentRoom);
  if (!room || m.walking || m.path.length) return [m.x, m.z];
  const [cx, cz] = room.center;
  const dx = m.x - cx, dz = m.z - cz, d = Math.hypot(dx, dz);
  const zoom = cfg.camera.distance / rig.distance;
  const slack = FOLLOW_SLACK * zoom * zoom;
  return d <= slack ? [m.x, m.z] : [cx + dx * slack / d, cz + dz * slack / d];
}

// --- Interface -------------------------------------------------------------------------
const hud = createHud(document, cfg, { possessedTellOnMain: () => possessedTellOnMain(), ownInfoOnMain: () => ownInfoOnMain() });
const map = createMap(document, floor, cfg);
const overlays = createOverlays(document);
const hand = createHand(document, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror });
const discard = createDiscard(document, cfg, {
  onDiscard: cardId => { const r = discardCard(state, activePlayer(state), cardId); if (!r.ok) hud.toast('That card cannot be discarded.'); refresh(); },
});
// The hand, held as a fan of face-up cards; tapping one opens it large in the card view.
const fan = createHandFan(document, { onOpen: cardId => { if (running && !uiBusy()) hand.open(state, floor, cardId); } });
const handoff = createHandoff(document);
const meeting = createMeeting(document, cfg);

let running = false;
let pendingArrival = null;   // enterRoom result waiting for the walk to finish
let selectedMove = null;     // a door move awaiting confirmation
let pendingSearch = null;    // { room, face: [x, z] }: walking to the search spot, then searching

const uiBusy = () => map.isOpen || hand.isOpen || discard.isOpen
  || overlays.endOpen || overlays.noticeOpen || overlays.askOpen || handoff.isOpen || meeting.isOpen;

const discovery = createDiscovery({
  floor, grid, state, movers, cfg,
  on: {
    roomEntered(result) {
      pendingArrival = result;
      syncViews(true);
      hud.update(state, floor);
    },
  },
});

// The search icon over the room's search spot (the furniture flagged `search: true`).
const searchSpot = createSearchSpot(document, { camera: view.camera, container, floor, state, onTap: onSearchSpot });

// The fan and the search icon are part of the active guest's own action phase only: never on a
// hand-over, role, private-pick, meeting, notice or end screen (CSS also hides them the moment any of
// those is up). Cheap enough to run every frame; each only touches the page when something changed.
function actionPhaseClear() {
  return running && !state.finished && (PRACTICE || inActionPhase)
    && !handoff.isOpen && !meeting.isOpen && !overlays.endOpen && !overlays.noticeOpen && !overlays.askOpen
    && !map.isOpen && !discard.isOpen;
}
// The possessed guest's reminder (POSSESSED label + souls count in the panel, the Possession cards as
// one ×N card in the fan) on the main screen. Outside hot-seat: always. In hot-seat the whole table can
// see that screen, so only when cfg.ui.hotseatPossessedOnMainScreen is on (the default), and only during the guest's
// own action phase: never on a pass, private, meeting, public notice (the Switchboard) or end screen
// (it is re-checked every frame), and never before a converted guest has been told in private.
function possessedTellOnMain() {
  if (!state.hotseat) return true;
  return !!cfg.ui.hotseatPossessedOnMainScreen && ownInfoOnMain() && !activePlayer(state).roleChangePending;
}
// The active guest's own information on the main screen in hot-seat — their card count in End turn's
// "Discard N first" (card counts are private, docs/GAME_RULES.md > Possession): only during their own
// action phase, never on a pass, private, meeting, public notice or end screen (re-checked every frame).
function ownInfoOnMain() {
  if (!state.hotseat) return true;
  return running && inActionPhase && !state.finished
    && !handoff.isOpen && !meeting.isOpen && !overlays.endOpen && !overlays.noticeOpen && !overlays.askOpen;
}
function syncHandFan() {
  // A Possession card goes on the always-on fan in hot-seat only with that switch on (src/ui/handFan.js).
  fan.update(activePlayer(state), actionPhaseClear(), { withPossession: possessedTellOnMain() });
  hud.syncTell(state);
  hud.syncEndTurn(state);
}
function syncSearchSpot() {
  searchSpot.update(activePlayer(state), actionPhaseClear() && !hand.isOpen && !pendingArrival);
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
  searchMarks.update(state);
  characters.forEach((cv, i) => {
    cv.group.visible = !state.escaped?.has(state.players[i].id);
    cv.setDead(!state.players[i].alive);
    cv.setActive(i === state.activeIndex && !state.finished);
  });
}

// Ring the doors the active guest may use this turn: to open, or to walk through.
function refreshUsable() {
  const p = activePlayer(state);
  const usable = new Set(state.finished ? [] : [...usableDoorways(state, floor, p), ...openableDoors(state, floor, p)].map(d => d.id));
  for (const dv of doorways.views.values()) dv.setUsable(usable.has(dv.doorway.id), p.currentRoom);
}

function refresh() { hud.update(state, floor); refreshUsable(); hand.refresh(); searchMarks.update(state); discovery.refresh(); syncHandFan(); syncSearchSpot(); }

function activeMover() { return movers[state.activeIndex]; }

// Card names in sentences: "a Lantern", "an Espresso"; "a Lantern and a Knife".
function aCard(type) { const name = CARDS[type]?.name ?? type; return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`; }
function andList(items) { return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`; }

// --- Turn flow ---------------------------------------------------------------------------
// Hot-seat: every turn is pass screen -> private screen -> action phase. Private information
// only ever appears in the middle step. Practice skips both hand-over screens.
let timerLeft = 0;
let inActionPhase = !HOTSEAT;

function begin() {
  overlays.hideStart();
  hud.show();
  running = true;
  refresh();
  if (HOTSEAT) revealRoles(0);
}

// Once at the start of a match: every guest reads their own secret role and acknowledges it.
function revealRoles(i) {
  if (i >= state.players.length) { beginTurn(); return; }
  const p = state.players[i];
  handoff.passTo(p, `Secret roles · ${i + 1} of ${state.players.length}`, () => {
    handoff.revealRole(p, {}, () => { p.roleSeen = true; revealRoles(i + 1); });
  });
}

function beginTurn() {
  if (state.finished) { showEnd(); return; }
  inActionPhase = false;
  stopTimer();
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null; pendingSearch = null;
  const p = activePlayer(state);
  movers[p.index]?.halt();
  rig.setFocus(...followPoint(), true);
  mood.snap(p.currentRoom);
  syncViews(false);
  refresh();
  // The hand-over screen is where everyone looks between turns, so it says so when dawn is next.
  handoff.passTo(p, isFinal(state) ? `${roundLabel(state)} · ${finalRoundNote}` : roundLabel(state), () => {
    if (p.roleChangePending) {
      p.roleChangePending = false;
      handoff.revealRole(p, { changed: true }, () => openPrivateTurn(p));
    } else openPrivateTurn(p);
  });
}

// Hot-seat: a locked door that locked again as the last turn ended is announced once the next guest's
// action phase starts (the hand-over screens cover the toast before that).
let lockNews = '';
function openPrivateTurn(p) {
  handoff.privateTurn(state, floor, p, { onStart: () => {
    inActionPhase = true; startTimer(); refresh();
    if (lockNews) { hud.toast(lockNews, 5); lockNews = ''; }
  } });
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
const timerPaused = () => handoff.handingOver || overlays.endOpen || overlays.noticeOpen || overlays.askOpen
  || meeting.isOpen || discard.isOpen || !!sideways?.matches;

function tickTimer(dt) {
  if (!rules.turnTimerEnabled || !inActionPhase || state.finished || timerLeft <= 0) return;
  if (timerPaused()) return;
  timerLeft -= dt;
  // A guest who has just stepped into a room finishes arriving first (a forced meeting there pauses the
  // clock); the turn then ends at once. Ending it mid-arrival would leave that arrival for the next guest.
  if (timerLeft <= 0 && pendingArrival) timerLeft = 0.001;
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
  if (timerLeft <= 0) onTimeUp();
}

function onTimeUp() {
  stopTimer();
  hud.toast(`Time is up — ${activePlayer(state).name}'s turn ends.`);
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
  hud.hideConfirm(); selectedMove = null; pendingSearch = null;
  hand.close();
  stopTimer();
  const sealedBefore = [...(state.barricades?.keys() ?? [])];
  const result = endTurn(state, floor);
  if (!result.ok) { endTurnNow(); return; }   // (the rules refuse it over the hand limit too: canEndTurn)
  if (PRACTICE) endTurnGuardUntil = performance.now() + END_TURN_GUARD_MS;   // (hot-seat: the pass screen catches it)
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
  if (HOTSEAT) { lockNews = relocked; beginTurn(); return; }
  rig.setFocus(...followPoint());
  mood.snap(activePlayer(state).currentRoom);
  refresh();
  hud.toast(`Turn ${state.turn} — ${rules.actionPointsPerTurn} action points.${relocked ? ` ${relocked}` : ''}`, relocked ? 5 : undefined);
}

// End the turn (the End turn button, or the 45-second clock running out). The hand limit is settled
// HERE and only here (approved rule): a guest holding more than 6 cards (Possession cards don't count)
// chooses what to discard on the discard screen first, and the turn passes only once they are down to
// 6. In hot-seat that screen comes before the pass screen, so it is still the active guest's own,
// private moment. Nothing else is left open behind it.
function endTurnNow() {
  if (overHandLimit(activePlayer(state)) > 0) {
    hand.close(); map.close(); hud.hideConfirm(); selectedMove = null; pendingSearch = null;
    if (activeMover().walking) activeMover().halt();
    stopTimer();
    discard.open(activePlayer(state), passTurn, { hotseat: HOTSEAT });
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
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
  if (HOTSEAT && !inActionPhase) return;
  if (performance.now() < endTurnGuardUntil) return;
  endTurnNow();
}

// The active guest finished walking into a room. The Fire Exit is a safe zone (never a meeting);
// escaping there is a separate action, the Escape button (1 AP).
function onArrive() {
  const player = activePlayer(state);
  const room = floor.rooms.get(player.currentRoom);
  pendingArrival = null;
  if (room?.isExit) {
    // The same words for everyone, so the shared screen gives nothing away about who is carrying
    // what or who is possessed.
    hud.toast(`The fire exit — a clean guest carrying ${rules.lanternsToEscape} Lanterns can escape here (${rules.actionCost.escape} action).`);
  }
  const candidates = pendingEncounters(state, floor, player);
  if (!candidates.length) { refresh(); return; }
  startMeeting(player, candidates);
}

// --- Meetings ----------------------------------------------------------------------------
// The arriving guest picks ONE guest to meet, then Trade or Attack. A trade is made with each
// side choosing in private (the device changes hands); an attack is public.
function startMeeting(P, candidates) {
  // The meeting panel is public: close anything private first (a hand sheet opened mid-walk would
  // otherwise stay readable underneath it).
  hand.close(); map.close();
  hud.hideConfirm(); selectedMove = null; pendingSearch = null;
  const met = Q => {
    lockEncounter(state, P.currentRoom, P.index, Q.index);
    const canAttack = weaponsIn(P.hand).length > 0 && P.actionPoints >= rules.actionCost.attack;
    // Trade or Attack; the weapon picker's Back returns here (nothing has happened yet).
    const chooseAction = () => meeting.chooseAction(P, Q, {
      canAttack,
      onTrade: () => runTrade(P, Q, { first: P, second: Q }),
      onAttack: () => runAttack(P, Q, chooseAction),
    });
    chooseAction();
  };
  if (candidates.length === 1) met(candidates[0]);
  else meeting.choose(P, candidates, met);
}

function afterMeeting() {
  syncViews(false); refresh();
  if (state.finished) showEnd();
}

// A trade between A and B. `first` holds the device now and picks first; then it is passed to
// `second`, who picks; the cards swap; `first` gets the device back and privately reads what they
// received. `second` reads theirs on their own next private screen — or, when `second` is the guest
// whose turn it is (a voluntary trade in the Fire Exit), straight after the device comes back to them.
// If either has no card they may give, the trade is skipped (GAME_RULES, Trade): see skippedTrade.
function runTrade(A, B, { first, second }, onDone = afterMeeting) {
  if (!canTrade(A, B).ok) { skippedTrade(A, B, first, onDone); return; }
  const pick = (who, other, then) => handoff.privatePick(who, {
    kicker: `Private — ${who.name} only`,
    title: `Give one card to ${other.name}`,
    sub: 'They will not see which until the cards have already changed hands.',
    cards: tradeableCards(who),
    // (never empty here — checked above; the pick screen still offers a way on if it ever is)
    onPick: card => (card ? then(card) : skippedTrade(A, B, who, onDone)),
  });
  pick(first, second, firstCard => {
    handoff.passTo(second, 'A trade — they choose in private', () => {
      pick(second, first, secondCard => {
        const [cardA, cardB] = first === A ? [firstCard, secondCard] : [secondCard, firstCard];
        const events = resolveTrade(state, floor, A, B, cardA, cardB);
        // What `who` reads in private about the trade: what they received, then the engine's own
        // notes. A Possession card is explained by the engine's note ("…You are now POSSESSED"), so it
        // gets no separate "You received" line. Told privately now that they were converted: no second
        // role screen at their next turn.
        const readResult = (who, other, then) => {
          const got = events.ok ? events.received[who.id] : null;
          const lines = !events.ok ? ['The trade could not be made.']
            : got === 'possession' ? []
              : [got ? `You received ${aCard(got)} from ${other.name}.` : `The card ${other.name} gave you burned away in your Lantern's light.`];
          const mine = who.notes.splice(0, who.notes.length);
          if (events.possessed?.some(e => e.newly === who.id)) who.roleChangePending = false;
          handoff.privateNote(who, [...lines, ...mine], then);
        };
        handoff.passTo(first, 'Back to you', () => {
          // The device must end with the guest whose turn it is. In a voluntary trade (the Fire Exit)
          // the other guest picks first and reads their result first; the device then goes back to the
          // guest whose turn it is, who reads their own result in private at once — before the public
          // "Trade complete" screen and before their main screen (which, if they were just possessed,
          // shows the reminder) — never learning it in front of the table.
          const active = activePlayer(state);
          const finish = () => meeting.tradeDone(A, B, onDone);
          readResult(first, second, () => (first === active ? finish()
            : handoff.passTo(active, `The trade is done — back to ${active.name}'s turn`,
              () => (active === second ? readResult(second, first, finish) : finish()))));
        });
      });
    });
  });
}

// The trade is skipped: nothing changes hands. `holder` has the device now and reads their own
// reason in private at once; the other guest's reason waits on their next private screen (the engine
// puts it in their notes), unless they are the guest whose turn it is, who gets the device back and
// reads it straight away. Then the table sees a neutral public line that names no hand and no card,
// and says nothing about how many cards either holds (card counts are private).
function skippedTrade(A, B, holder, onDone) {
  const r = skipTrade(state, floor, A, B);
  const active = activePlayer(state);
  const finish = () => meeting.notice(r.ok
    ? `${A.name} and ${B.name} met, but there is no trade. The meeting ends.`
    : 'The trade could not be made. The meeting ends.', onDone, 'No trade');
  const read = (who, then) => handoff.privateNote(who, who.notes.splice(0, who.notes.length), then);
  read(holder, () => (holder === active ? finish()
    : handoff.passTo(active, `No trade — back to ${active.name}'s turn`, () => read(active, finish))));
}

function runAttack(P, Q, onBack = null) {
  meeting.attackPick(P, Q, weaponId => {
    const events = resolveAttack(state, floor, P, Q, weaponId);
    if (events.killed) layBodyClear(Q.index);   // (the figure falls when the result is dismissed)
    meeting.attackResult(P, Q, events, afterMeeting);
  }, onBack);
}

// Voluntary trade in a safe zone that allows it (the Fire Exit; never the lobby): the other guest
// must agree, in private, before anyone chooses.
function onTrade() {
  if (!running || state.finished || uiBusy() || activeMover().walking || PRACTICE) return;
  const P = activePlayer(state);
  if (!canTradeVoluntarily(state, floor, P)) return;
  const others = playersInRoom(state, P.currentRoom, P.id);
  if (!others.length) return;
  hud.hideConfirm(); selectedMove = null;
  const ask = Q => handoff.passTo(Q, 'A trade is proposed', () => handoff.privateChoice(Q, {
    title: `${P.name} would like to trade`,
    sub: 'You each give one card. Nobody has to agree.',
    options: [{ label: 'Accept', value: true, primary: true }, { label: 'Decline', value: false }],
    onPick: yes => {
      if (yes) runTrade(P, Q, { first: Q, second: P }, () => { refresh(); if (state.finished) showEnd(); });
      else handoff.passTo(P, 'Back to you', () => meeting.notice(`${Q.name} declined.`, refresh));
    },
  }));
  if (others.length === 1) ask(others[0]);
  else meeting.choose(P, others, ask, { voluntary: true, onCancel: refresh });
}

// --- Actions -----------------------------------------------------------------------------
const SEARCH_FAIL = {
  notSearchable: 'There is nothing to search in here.',
  searched: 'This room has already been searched.',
  dark: 'Too dark to search — you need a Flashlight.',
  ap: 'No action points left to search.',
  empty: 'Nothing left to find here.',
};

function onSearch() {
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
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
  // Search results are PRIVATE. In hot-seat the table sees only that a search happened; the found
  // cards are shown large on a private screen for the searcher. Practice has nobody to hide them from,
  // so the same reveal sits on a lighter backdrop with the room still in view.
  if (HOTSEAT) hud.toast(`${player.name} searched.`);
  handoff.privateFound(player, {
    kicker: HOTSEAT ? `Private — ${player.name} only · ${where}` : `You search ${where}`,
    title: !found.length ? 'Nothing here' : r.kind === 'found' ? `You pick up ${andList(found.map(c => aCard(c.type)))}` : `You found ${andList(found.map(c => aCard(c.type)))}`,
    cards: found,
    lines: [line + tally + limitNote],
    soft: PRACTICE,
  }, then);
}

// The search icon was tapped: walk to stand in front of the search spot (free, inside the room), then
// search — the same search as always, for 1 action. A refusal is explained where the tap was.
function onSearchSpot() {
  if (!running || state.finished || uiBusy() || pendingArrival) return;
  if (HOTSEAT && !inActionPhase) return;
  const player = activePlayer(state);
  const gate = canSearch(state, floor, player);
  if (!gate.ok) { hud.toast(SEARCH_FAIL[gate.reason] || 'Cannot search now.'); return; }
  hud.hideConfirm(); selectedMove = null;
  const spot = searchSpotOf(floor.rooms.get(player.currentRoom));
  const stand = spot && standInFront(spot, player);
  if (stand) {
    const plan = discovery.plan(stand[0], stand[1]);
    const m = activeMover();
    if (plan.ok && plan.cost === 0 && Math.hypot(m.x - stand[0], m.z - stand[1]) > 0.25) {
      pendingSearch = { room: player.currentRoom, face: spot.center };
      discovery.go(plan);
      return;
    }
  }
  if (activeMover().walking) activeMover().halt();
  pendingSearch = null;
  if (spot) faceTowards(spot.center);
  onSearch();
}

// Where to stand to search a piece of furniture: just off the side of its footprint that faces into
// the room, on free floor of the same room (the side nearest the room's centre that can be stood on).
function standInFront(f, player) {
  const room = floor.rooms.get(player.currentRoom);
  const gap = cfg.player.clearance + 0.3;
  const [cx, cz] = f.center;
  const spots = [[cx, f.min[1] - gap], [cx, f.max[1] + gap], [f.min[0] - gap, cz], [f.max[0] + gap, cz]];
  const others = movers.filter((m, i) => i !== player.index && state.players[i].alive);
  const ok = ([x, z]) => {
    const c = grid.cellAt(x, z);
    return c >= 0 && grid.walkable[c] && grid.roomIdOf(c) === room.id && !others.some(m => Math.hypot(m.x - x, m.z - z) < 0.6) && !onABody(x, z);
  };
  const d = ([x, z]) => Math.hypot(x - room.center[0], z - room.center[1]);
  return spots.filter(ok).sort((a, b) => d(a) - d(b))[0] || null;
}

// Turn the active guest to look at a point (after walking up to the search spot).
function faceTowards([x, z]) {
  const m = activeMover();
  if (Math.hypot(x - m.x, z - m.z) > 0.05) m.heading = Math.atan2(x - m.x, z - m.z);
}

function onUseBandage(cardId) {
  const r = useBandage(state, activePlayer(state), cardId);
  if (!r.ok) { hud.toast(r.reason === 'full' ? 'Already at full health.' : r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.'); return; }
  hud.toast(`Bandaged — health ${r.health} of ${rules.maxHealth}.`);
  refresh();
}

function onUnlock(cardId, roomId) {
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
  const r = useBarricade(state, floor, activePlayer(state), cardId, doorwayId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot barricade that.'); return; }
  hud.toast(`${cap(doorName(doorwayId, activePlayer(state).currentRoom))} barricaded until your next turn.`, 5);
  hand.close();
  syncViews(false); refresh();
}

// Espresso (free): extra action points for this turn only.
function onEspresso(cardId) {
  const r = useEspresso(state, activePlayer(state), cardId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.'); return; }
  hud.toast(`Espresso — ${r.gained} extra actions this turn.`);
  refresh();
}

// Hand Mirror (1 action): another guest in the room shows the user their whole hand. What it shows
// is PRIVATE and goes on a private screen for the user only; the shared screen says only that the
// mirror was used, and on whom.
const MIRROR_FAIL = {
  ap: 'No action points left.',
  noTarget: 'Choose another guest in this room.',
  targetDead: 'That guest is dead.',
  notTogether: 'That guest is not in this room any more.',
};
function onHandMirror(cardId, targetId) {
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
  }, () => { hud.toast(`${player.name} used a Hand Mirror on ${target.name}.`); refresh(); });
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
  if (HOTSEAT && !inActionPhase) return;
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
    // PUBLIC, for the whole table: it stays up until someone taps Continue (the clock waits).
    // Practice: nobody else is in the hotel, so there is nobody to count — say what it does in a match.
    overlays.showNotice('The Switchboard', PRACTICE
      ? 'You rang the Switchboard. In a match it tells everyone how many guests are possessed. You are alone in the hotel, so there is nobody to count.'
      : `${player.name} rang the Switchboard. ${switchboardLine(r.count)}`, refresh);
    syncHandFan();   // the possessed guest's reminder leaves the screen with the notice, not a frame later
  }
}

// --- End of the match ----------------------------------------------------------------------
function showEnd() {
  stopTimer();
  if (state.practice) {
    const p = activePlayer(state);
    overlays.showEnd('You reached the fire exit',
      `Practice complete: ${rules.lanternsToEscape} Lanterns carried out.\n${floor.roomList.length} rooms of the hotel revealed, on round ${state.round}.`,
      { keepExploring: false });
    void p;
    return;
  }
  const evil = state.players.filter(p => p.possessed).map(p => p.name);
  const dead = state.players.filter(p => !p.alive).map(p => p.name);
  const out = [...state.escaped].map(id => state.players.find(p => p.id === id)?.name).filter(Boolean);
  // One fact per line (styles.css keeps the breaks): what happened, then who was possessed, who died
  // and the round.
  const parts = [`Possessed: ${evil.length ? evil.join(', ') : 'nobody'}`];
  if (dead.length) parts.push(`Dead: ${dead.join(', ')}`);
  parts.push(roundLabel(state));
  const facts = parts.join('\n');
  const opts = { restartLabel: 'New match' };
  if (state.won === 'humans') overlays.showEnd('The guests got out', `${out.join(', ')} escaped carrying ${rules.lanternsToEscape} Lanterns.\n${facts}`, opts);
  else if (state.dawn) overlays.showEnd('Dawn breaks', `Round ${rules.roundLimit} has ended and nobody got out. The hotel keeps them.\n${facts}`, opts);
  else overlays.showEnd('The hotel keeps them', `No clean guest is left.\n${facts}`, opts);
}

function restart() {
  seed = newSeed();
  resetState(state, floor, seed);          // a new random hotel
  clearRoomViews(roomViews, view.scene);
  doorways.reset();
  rebuildGrid();
  movers.forEach((m, i) => m.reset(startSpot(i)[0], startSpot(i)[1]));
  pendingArrival = null; selectedMove = null; pendingSearch = null; queuedTap = null;
  fan.reset();
  discovery.refresh();
  syncViews(false);
  rig.setFocus(...followPoint(), true);
  rig.reset();
  mood.snap(activePlayer(state).currentRoom);
  overlays.hideEnd(); overlays.hideNotice(); overlays.hideAsk(); hand.close(); map.close();
  discard.close(); handoff.close(); meeting.close(); hud.hideConfirm();
  stopTimer();
  refresh();
  if (HOTSEAT) { inActionPhase = false; if (running) revealRoles(0); return; }
  if (running) hud.toast('Practice restarted.');
}

// --- Screen ↔ ground plane ----------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ndc = new THREE.Vector2();
const hitA = new THREE.Vector3();
const hitB = new THREE.Vector3();

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

// How far from a doorway's centre line a tap still counts as a tap on that door. The gold ring is
// drawn t + 0.62 m into the room with an outer radius of 0.33 m (src/render/roomView.js placeRing /
// ringGeo), so it reaches t + 0.95 m; the zone covers the whole ring plus a finger's slack. (It was
// t + 0.7, so a tap on the room-facing half of the ring walked the guest there instead.)
const DOOR_TAP_ACROSS = () => cfg.walls.thickness + 0.62 + 0.33 + 0.12;

// The usable doorway (if any) near a ground point, and the room it leads to.
function usableDoorwayNear(px, pz, player) {
  let best = null, bestD = Infinity;
  for (const d of usableDoorways(state, floor, player)) {
    const along = d.axis === 'x';
    const halfAlong = d.width / 2 + 0.6, halfAcross = DOOR_TAP_ACROSS();
    const da = along ? Math.abs(px - d.center[0]) : Math.abs(pz - d.center[1]);
    const dc = along ? Math.abs(pz - d.center[1]) : Math.abs(px - d.center[0]);
    if (da <= halfAlong && dc <= halfAcross) {
      const dist = da + dc;
      if (dist < bestD) { bestD = dist; best = d; }
    }
  }
  if (!best) return null;
  return { door: best, dest: best.a === player.currentRoom ? best.b : best.a };
}

// A closed door of the current room near a ground point (to open it, or to explain why not).
function closedDoorNear(px, pz, player) {
  for (const d of (floor.rooms.get(player.currentRoom)?.frontier || [])) {
    const along = d.axis === 'x';
    const da = along ? Math.abs(px - d.center[0]) : Math.abs(pz - d.center[1]);
    const dc = along ? Math.abs(pz - d.center[1]) : Math.abs(px - d.center[0]);
    if (da <= d.width / 2 + 0.6 && dc <= DOOR_TAP_ACROSS()) return d;
  }
  return null;
}

// Any doorway of the current room near a ground point, usable or not (for explaining a refusal).
function doorwayNear(px, pz, player) {
  for (const d of (floor.rooms.get(player.currentRoom)?.doorways || [])) {
    const along = d.axis === 'x';
    const da = along ? Math.abs(px - d.center[0]) : Math.abs(pz - d.center[1]);
    const dc = along ? Math.abs(pz - d.center[1]) : Math.abs(px - d.center[0]);
    if (da <= d.width / 2 + 0.6 && dc <= DOOR_TAP_ACROSS()) return d;
  }
  return null;
}

// A free standing spot in a discovered room: the centre, or a nearby ring position not on
// another player or on a body lying on the floor.
function standingSlot(roomId, forIndex) {
  const room = floor.rooms.get(roomId);
  const [cx, cz] = room.center;
  const others = movers.filter((m, i) => i !== forIndex && state.players[i].alive);
  const occupied = (x, z) => others.some(m => Math.hypot(m.x - x, m.z - z) < 0.7) || onABody(x, z);
  const walkable = (x, z) => { const c = grid.cellAt(x, z); return c >= 0 && grid.walkable[c]; };
  const ring = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
    [2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1], [2, -1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2]];
  for (const [ox, oz] of ring) {
    const x = cx + ox * 0.95, z = cz + oz * 0.95;
    if (walkable(x, z) && !occupied(x, z)) return { x, z };
  }
  return { x: cx, z: cz };
}

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

// Where to walk when moving through `door` into `dest`: the standing slot there (its centre, or a
// free spot beside others). Every room you can walk into has already been revealed.
function moveTargetInto(dest, door, forIndex) {
  return standingSlot(dest, forIndex);
}

// Open a closed door of the active guest's room (1 AP): the room behind it is revealed and the
// guest stays put. The new room is empty, so nothing else happens.
const DOOR_FAIL = {
  jammed: 'The door is jammed shut — there is no way through here.',
  ap: 'No action points left to open a door.',
  notYourDoor: 'You can only open a door of the room you are in.',
};
function onOpenDoor(doorId) {
  if (!running || state.finished) return;
  const player = activePlayer(state);
  const r = openDoor(state, floor, player, doorId);
  if (!r.ok) { hud.toast(DOOR_FAIL[r.reason] || 'That door will not open.'); refresh(); syncViews(false); return; }
  rebuildGrid();
  discovery.refresh();
  syncViews(true);
  refresh();
  hud.toast(r.room.isExit ? `The door opens onto the ${r.room.name}!`
    : `The door opens: ${r.room.name}${r.locked ? ' — locked' : ''}${r.room.dark ? ' — dark' : ''}.`);
}

// A tap on a door ring while the guest is still walking (or just arriving) is kept and answered
// as soon as they stand still, instead of being dropped: a player often taps the next door as the
// guest reaches the room. Only door taps are kept (the answer is only the Move/Open question), only
// in the same turn, and anything that opens meanwhile (a meeting, a card) drops it.
let queuedTap = null;   // { x, z, turn }: a ground point
function doorTapAt(px, pz) {
  const player = activePlayer(state);
  return closedDoorNear(px, pz, player) || usableDoorwayNear(px, pz, player) || doorwayNear(px, pz, player);
}
function replayQueuedTap() {
  if (!queuedTap || activeMover().walking || activeMover().path.length || pendingArrival) return;
  const q = queuedTap;
  queuedTap = null;
  if (uiBusy() || state.finished || q.turn !== state.turn) return;
  if (HOTSEAT && !inActionPhase) return;
  if (doorTapAt(q.x, q.z)) tapGroundPoint(q);
}

createInput(view.renderer.domElement, {
  onTap(x, y) {
    if (!running || state.finished || uiBusy()) return;
    const p = screenToGround(x, y);
    if (!p) return;
    if (activeMover().walking || pendingArrival) {
      queuedTap = { x: p.x, z: p.z, turn: state.turn };
      return;
    }
    queuedTap = null;
    pendingSearch = null;
    tapGroundPoint(p);
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

// A tap on the floor at ground point p (x, z): a door of this room, or a free step inside it.
function tapGroundPoint(p) {
  const player = activePlayer(state);
  // 0. A closed door of this room → offer to open it (you stay where you are).
  const closed = closedDoorNear(p.x, p.z, player);
  if (closed) {
    if (closed.jammed) { hud.toast(DOOR_FAIL.jammed); return; }
    if (player.actionPoints < rules.actionCost.open) { hud.toast(DOOR_FAIL.ap); return; }
    const m = activeMover();
    selectedMove = { kind: 'open', door: closed, waypoints: [[m.x, m.z]], preview: { label: `Open · ${rules.actionCost.open} AP`, anchor: closed.center } };
    hud.showConfirm('Open this door?', `Open · ${rules.actionCost.open} AP`);
    return;
  }
  // 1. A usable door → offer to move there.
  const near = usableDoorwayNear(p.x, p.z, player);
  if (near) {
    const slot = moveTargetInto(near.dest, near.door, player.index);
    const plan = discovery.plan(slot.x, slot.z);
    if (plan.ok) {
      // the dotted path + cost tag over the door, shown while the move awaits confirmation
      plan.preview = { label: `Move · ${plan.cost} AP`, anchor: near.door.center };
      selectedMove = plan;
      hud.showConfirm(`Move to ${floor.rooms.get(near.dest).name}?`, `Move · ${plan.cost} AP`);
    } else {
      hud.toast('Cannot reach that room.');
    }
    return;
  }
  // 1b. A door that is there but cannot be used: say why.
  const blocked = doorwayNear(p.x, p.z, player);
  if (blocked) {
    hud.toast(isBarricaded(state, blocked.id) ? 'That doorway is barricaded.'
      : lockedAgainst(state, blocked, player.currentRoom) ? 'That door is locked. A Master Key or Lock Pick used here opens it for the rest of your turn.'
        : 'Not enough action points to go through.');
    return;
  }
  // 2. Otherwise, a free reposition inside the current room.
  const plan = discovery.plan(p.x, p.z);
  if (plan.ok && plan.cost === 0) discovery.go(plan);
  else if (plan.ok) hud.toast('Tap a glowing doorway to change rooms.');
}

hud.on('rotateLeft', () => rig.rotateLeft());
hud.on('rotateRight', () => rig.rotateRight());
hud.on('endTurn', doEndTurn);
hud.on('roomJob', onRoom);
hud.on('trade', onTrade);
hud.on('private', () => { if (running && !uiBusy()) hand.open(state, floor); });
hud.on('map', () => { if (!meeting.isOpen && !discard.isOpen && !overlays.endOpen && !handoff.isOpen) map.toggle(state, movers); });
hud.onConfirm(
  () => {
    if (!selectedMove) return;
    const chosen = selectedMove;
    selectedMove = null; hud.hideConfirm();
    if (chosen.kind === 'open') onOpenDoor(chosen.door.id);
    else discovery.go(chosen);
  },
  () => { selectedMove = null; hud.hideConfirm(); },
);
overlays.onBegin(begin);
overlays.onRestart(restart);
// Restart practice throws the whole hotel away, so it asks first (from the end screen it does not:
// the match is over).
hud.on('restartPractice', () => {
  if (overlays.endOpen) { restart(); return; }
  if (uiBusy()) return;
  overlays.ask('Restart practice?', 'This hotel and everything you have found will be lost, and you start again in the lobby of a new hotel.',
    { yes: 'Restart', no: 'Keep playing' }, restart);
});

// --- Start screen: choose the game ---------------------------------------------------------
// The only decision that has to be made before the world is built, so it is in the address and
// picking a different one reloads the page. No file editing, no settings menu to get lost in.
function buildStartScreen() {
  const sub = document.getElementById('start-sub');
  const host = document.getElementById('mode-buttons');
  if (sub) {
    // Short lines rather than one that wraps with a word alone at the end (styles.css keeps the line
    // breaks and balances each line). Both say what every guest starts with (rules.lanternsDealtEach),
    // worked out from the rules numbers; the hot-seat goal takes two lines so the card stays as wide
    // as before on a 1024-wide iPad.
    const dealt = rules.lanternsDealtEach || 0;
    const lanterns = n => `${n} Lantern${n === 1 ? '' : 's'}`;
    sub.textContent = HOTSEAT
      ? `Hot-seat · ${rules.playerCount} guests, one device · one is secretly possessed\n${dealt
        ? `Everyone starts with ${lanterns(dealt)} — gather ${rules.lanternsToEscape} on one clean guest\nand get them out before dawn (${rules.roundLimit} rounds)`
        : `Find ${lanterns(rules.lanternsToEscape)} and get one clean guest out before dawn (${rules.roundLimit} rounds)`}`
      : `Practice · explore the hotel alone\nYou start with ${lanterns(dealt)} — find ${rules.lanternsToEscape - dealt} more and escape through the Fire Exit`;
  }
  document.title = HOTSEAT ? `Hotel Escape — Hot-seat (${rules.playerCount})` : 'Hotel Escape — Practice';
  if (!host) return;
  host.innerHTML = '';
  const options = [];
  if (HOTSEAT) options.push(['Practice · 1 guest', './']);
  for (const n of [4, 5, 6]) {
    if (HOTSEAT && n === rules.playerCount) continue;
    options.push([`Hot-seat · ${n} players`, `./?mode=hotseat&players=${n}`]);
  }
  for (const [label, href] of options) {
    const a = document.createElement('a');
    a.className = 'btn mode';
    a.href = href;
    a.textContent = label;
    host.appendChild(a);
  }
}
buildStartScreen();
// Practice is one guest alone: no trades, no possessed guest, nobody to hide a hand from. Words written
// for the shared hot-seat screen are swapped for plain ones (hot-seat is unchanged).
if (PRACTICE) {
  usePracticeWording(true);
  const privateBtn = document.getElementById('btn-private');
  if (privateBtn) privateBtn.textContent = '▸ My cards';
  document.querySelector('#hand-overlay .lock')?.setAttribute('hidden', '');
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
view.renderer.setAnimationLoop(now => {
  perfStats.frame(now - last);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  if (running && !state.finished) {
    tickTimer(dt);
    activeMover().update(dt);
    discovery.update();
    if (pendingArrival && !activeMover().walking && activeMover().path.length === 0) onArrive();
    // Walked up to the search spot: face it and search.
    if (pendingSearch && !activeMover().walking && activeMover().path.length === 0) {
      const ps = pendingSearch;
      pendingSearch = null;
      if (activePlayer(state).currentRoom === ps.room) { faceTowards(ps.face); onSearch(); }
    }
    replayQueuedTap();
  }
  rig.setFocus(...followPoint());
  rig.update(dt);
  for (const rv of roomViews.values()) rv.update(dt);
  doorways.update(time, dt, roomViews, activeMover());
  pathPreview.update(selectedMove && hud.confirmOpen && !activeMover().walking ? selectedMove : null, time);
  mood.update(activePlayer(state).currentRoom, dt, time, activeMover());
  updateCutaway(roomViews, rig, state, cfg, dt);
  characters.forEach((cv, i) => cv.update(movers[i], dt));
  view.render();
  syncHandFan();
  syncSearchSpot();     // after the render, so it reads this frame's camera
  if (++frames === 2) overlays.setReady();
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// --- Debug / test hooks ------------------------------------------------------------------
window.__game = {
  cfg, rules, floor, grid, state, movers, rig, roomViews, doorways, characters, discovery, view, pathPreview,
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
  searchPending: () => !!pendingSearch,
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
  mode: MODE, hotseat: HOTSEAT,
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
  doorTapAcross: () => DOOR_TAP_ACROSS(),   // how far into the room a door tap reaches (tests)
  queuedTap: () => !!queuedTap,
  screenToGround: (x, y) => { const p = screenToGround(x, y, new THREE.Vector3()); return p ? [p.x, p.z] : null; },
  roomCenter: id => floor.rooms.get(id)?.center ?? null,
  // the random hotel: closed doors of the active guest's room, open one, stack the deck (tests)
  closedDoors: () => (floor.rooms.get(activePlayer(state).currentRoom)?.frontier || []).map(d => ({ id: d.id, side: d.side, jammed: d.jammed, center: d.center })),
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

// Move the active player into an adjacent room by id (walks through the shared door).
// Returns the plan; the walk and any encounter resolve over subsequent frames.
function moveToRoom(destId) {
  const player = activePlayer(state);
  const door = (floor.rooms.get(player.currentRoom)?.doorways || []).find(d => d.a === destId || d.b === destId);
  if (!door) return { ok: false, reason: 'noDoor' };
  const slot = moveTargetInto(destId, door, player.index);
  const plan = discovery.plan(slot.x, slot.z);
  if (plan.ok) discovery.go(plan);
  return plan;
}
