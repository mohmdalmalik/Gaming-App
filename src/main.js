// Entry point: builds the floor, sets up rendering, interface and the turn-based rules of
// Hotel Escape, and runs the game loop. Two ways to play the same ruleset (docs/GAME_RULES.md):
// practice (one guest alone) and hot-seat (4-6 guests passing one device). No server, no
// networking — hot-seat is a testing tool for the real online game.
import * as THREE from 'three';
import { config as cfg } from './config.js';
import { rules, applyMode } from './data/rules.js';
import { hotel } from './data/hotel.js';
import { roster } from './data/characters.js';
import { createHotel, stackDeck, growTo } from './game/hotel.js';
import { buildGrid } from './game/grid.js';
import {
  createState, resetState, endTurn, activePlayer, nextPlayer, checkWin, canEscape,
  usableDoorways, openableDoors, pendingEncounters, lockEncounter, playersInRoom, isLocked,
  isBarricaded,
} from './game/state.js';
import {
  search, useBandage, useUnlock, useBarricade, resolveFullHand, resolveTrade, resolveAttack,
  discardCard, overHandLimit, tradeableCards, openDoor,
  canUseRoom, useInfirmary, useSwitchboard, useHandMirror, useEspresso,
} from './game/actions.js';
import { CARDS, weaponsIn } from './game/cards.js';
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
import { createDiscard } from './ui/discard.js';
import { createFullHand } from './ui/fullHand.js';
import { createHandoff } from './ui/handoff.js';
import { createMeeting } from './ui/meeting.js';
import { roundLabel, finalRoundNote, isFinal } from './ui/roundLabel.js';
import { createPerfStats } from './ui/perfStats.js';

// --- World (pure data + rules) ---------------------------------------------------------
// The hotel is random every match: it starts as the lobby and grows as doors are opened
// (src/game/hotel.js). createState builds a fresh one.
const floor = createHotel(hotel, cfg);

// Which game this page is. The choice is in the address so it can be linked, bookmarked and
// driven by the tests; the start screen writes it for the player.
//   ?mode=hotseat&players=6   a six-person hot-seat match on one device
//   ?seed=123                 force the deal, the hidden role and the hotel's room deck (testing)
//   ?timer=off                play without the 45-second turn clock
//   ?camera=classic           the previous, higher camera angle (for comparison)
//   ?stats=1                  a small frame-rate / draw-call readout, for measuring on the iPad
const params = new URLSearchParams(window.location.search);
if (params.get('camera') === 'classic') Object.assign(cfg.camera, cfg.cameraClassic);   // the old, higher view
const MODE = params.get('mode') === 'hotseat' ? 'hotseat' : 'practice';
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
const doorways = createDoorwayViews(floor, cfg, view.scene);
const characters = cast.map(def => createCharacterView(def, cfg, view.scene));
const searchMarks = createSearchMarks(floor, view.scene);
const pathPreview = createPathPreview(view.scene, view.camera, view.renderer.domElement, container);
const perfStats = createPerfStats(document, view.renderer, params.get('stats') === '1');
const mood = createMood(roomViews, view.hemi, cfg, view.scene);
const rig = createCameraRig(view.camera, cfg);

// --- Interface -------------------------------------------------------------------------
const hud = createHud(document, cfg);
const map = createMap(document, floor, cfg);
const overlays = createOverlays(document);
const hand = createHand(document, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror });
const discard = createDiscard(document, cfg, {
  onDiscard: cardId => { const r = discardCard(state, activePlayer(state), cardId); if (!r.ok) hud.toast('That card cannot be discarded.'); refresh(); },
});
const fullHand = createFullHand(document);
const handoff = createHandoff(document);
const meeting = createMeeting(document, cfg);

let running = false;
let pendingArrival = null;   // enterRoom result waiting for the walk to finish
let selectedMove = null;     // a door move awaiting confirmation

const uiBusy = () => map.isOpen || hand.isOpen || discard.isOpen || fullHand.isOpen
  || overlays.endOpen || overlays.noticeOpen || handoff.isOpen || meeting.isOpen;

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

function refresh() { hud.update(state, floor); refreshUsable(); hand.refresh(); searchMarks.update(state); discovery.refresh(); }

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
  hand.close(); map.close(); hud.hideConfirm(); selectedMove = null;
  const p = activePlayer(state);
  movers[p.index]?.halt();
  rig.setFocus(activeMover().x, activeMover().z, true);
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

function openPrivateTurn(p) {
  handoff.privateTurn(state, floor, p, { onStart: () => { inActionPhase = true; startTimer(); refresh(); } });
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
const timerPaused = () => handoff.handingOver || overlays.endOpen || overlays.noticeOpen
  || meeting.isOpen || fullHand.isOpen || discard.isOpen;

function tickTimer(dt) {
  if (!rules.turnTimerEnabled || !inActionPhase || state.finished || timerLeft <= 0) return;
  if (timerPaused()) return;
  timerLeft -= dt;
  hud.showTimer(timerLeft, rules.turnTimerSeconds);
  if (timerLeft <= 0) onTimeUp();
}

function onTimeUp() {
  stopTimer();
  hud.toast(`Time is up — ${activePlayer(state).name}'s turn ends.`);
  endTurnNow();
}

function passTurn() {
  hud.hideConfirm(); selectedMove = null;
  hand.close();
  stopTimer();
  const result = endTurn(state, floor);
  movers[result.from.index]?.halt();
  syncViews(false);
  if (result.finished) { refresh(); showEnd(); return; }
  if (checkWin(state, floor)) { refresh(); showEnd(); return; }
  if (HOTSEAT) { beginTurn(); return; }
  rig.setFocus(activeMover().x, activeMover().z);
  mood.snap(activePlayer(state).currentRoom);
  refresh();
  hud.toast(`Turn ${state.turn} — ${rules.actionPointsPerTurn} action points.`);
}

// End the turn, forcing the hand-limit discard first if it applies.
function endTurnNow() {
  if (overHandLimit(activePlayer(state)) > 0) { discard.open(activePlayer(state), passTurn); return; }
  passTurn();
}

function doEndTurn() {
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
  if (HOTSEAT && !inActionPhase) return;
  endTurnNow();
}

// The active guest finished walking into a room. ORDER MATTERS: the exit is resolved FIRST —
// a clean guest carrying three Lanterns escapes before any meeting can be forced there.
function onArrive() {
  const player = activePlayer(state);
  const room = floor.rooms.get(player.currentRoom);
  pendingArrival = null;
  if (room?.isExit) {
    if (checkWin(state, floor, player)) { syncViews(false); refresh(); showEnd(); return; }
    // The same words for everyone, so the shared screen gives nothing away about who is carrying
    // what or who is possessed.
    hud.toast(`The fire exit — it opens only for a clean guest carrying ${rules.lanternsToEscape} Lanterns.`);
  }
  const candidates = pendingEncounters(state, floor, player);
  if (!candidates.length) { refresh(); return; }
  startMeeting(player, candidates);
}

// --- Meetings ----------------------------------------------------------------------------
// The arriving guest picks ONE guest to meet, then Trade or Attack. A trade is made with each
// side choosing in private (the device changes hands); an attack is public.
function startMeeting(P, candidates) {
  hud.hideConfirm(); selectedMove = null;
  const met = Q => {
    lockEncounter(state, P.currentRoom, P.index, Q.index);
    const canAttack = weaponsIn(P.hand).length > 0 && P.actionPoints >= rules.actionCost.attack;
    meeting.chooseAction(P, Q, {
      canAttack,
      onTrade: () => runTrade(P, Q, { first: P, second: Q }),
      onAttack: () => runAttack(P, Q),
    });
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
// received. `second` reads theirs on their own next private screen.
function runTrade(A, B, { first, second }, onDone = afterMeeting) {
  const pick = (who, other, then) => handoff.privatePick(who, {
    kicker: `Private — ${who.name} only`,
    title: `Give one card to ${other.name}`,
    sub: 'They will not see which until the cards have already changed hands.',
    cards: tradeableCards(who),
    onPick: then,
  });
  pick(first, second, firstCard => {
    handoff.passTo(second, 'A trade — they choose in private', () => {
      pick(second, first, secondCard => {
        const [cardA, cardB] = first === A ? [firstCard, secondCard] : [secondCard, firstCard];
        const events = resolveTrade(state, floor, A, B, cardA, cardB);
        handoff.passTo(first, 'Back to you', () => {
          const got = events.ok ? events.received[first.id] : null;
          const lines = [events.ok
            ? (got ? `You received ${aCard(got)} from ${second.name}.` : `The card ${second.name} gave you burned away in your Lantern's light.`)
            : 'The trade could not be made.'];
          const mine = first.notes.splice(0, first.notes.length);
          handoff.privateNote(first, [...lines, ...mine], () => meeting.tradeDone(A, B, onDone));
        });
      });
    });
  });
}

function runAttack(P, Q) {
  meeting.attackPick(P, Q, weaponId => {
    const events = resolveAttack(state, floor, P, Q, weaponId);
    meeting.attackResult(P, Q, events, afterMeeting);
  });
}

// Voluntary trade in the lobby: the other guest must agree, in private, before anyone chooses.
function onTrade() {
  if (!running || state.finished || uiBusy() || activeMover().walking || PRACTICE) return;
  const P = activePlayer(state);
  if (!floor.rooms.get(P.currentRoom)?.safe) return;
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
  // A card that does not fit goes straight to the take-or-leave prompt, on the searcher's own turn.
  if (r.kind === 'card' && r.full) { askFullHand(player, r.card, where); return; }
  // A Linen Store's draw gives two cards; any that did not fit then go through the take-or-leave
  // prompt one after another, once the searcher has read what they found.
  const overflow = r.kind === 'cards' ? r.overflow : [];
  const line = r.kind === 'found'
    ? `Lying in ${where}: ${r.cards.map(c => CARDS[c.type].name).join(', ')}. You take it all.`
    : r.kind === 'nothing' ? `You search ${where}. Nothing.`
      : r.kind === 'cards' ? `You search ${where} and find ${andList(r.cards.map(c => aCard(c.type)))}.`
        : `You search ${where} and find ${aCard(r.card.type)}.`;
  const lanterns = player.hand.filter(c => c.type === 'lantern').length;
  const tally = lanterns ? ` You now hold ${lanterns} Lantern${lanterns === 1 ? '' : 's'}.` : '';
  const noRoom = overflow.length
    ? ` Your hands are full — choose what to do with ${andList(overflow.map(c => `the ${CARDS[c.type].name}`))} next.` : '';
  const then = () => askEachFullHand(player, overflow, where);
  // Search results are PRIVATE. In hot-seat the table sees only that a search happened; the
  // result goes on a private card for the searcher. Practice has nobody to hide it from.
  if (HOTSEAT) {
    hud.toast(`${player.name} searched.`);
    handoff.privateNote(player, [line + tally + noRoom], then);
  } else {
    hud.toast(line + tally + noRoom);
    then();
  }
}

// Every drawn card that did not fit, through the take-or-leave prompt one at a time.
function askEachFullHand(player, cards, where) {
  if (!cards.length) { refresh(); return; }
  askFullHand(player, cards[0], where, () => askEachFullHand(player, cards.slice(1), where));
}

// A drawn card with no room for it: never dropped silently — the guest decides. `then` runs once
// they have (the next card of a Linen Store's two, if that did not fit either).
function askFullHand(player, card, where = 'the room', then = null) {
  fullHand.open(state, player, card, {
    // Search results are private: in hot-seat nothing about the card goes on the shared toast.
    onTake: dropId => {
      const res = resolveFullHand(state, player, card, 'take', dropId);
      if (!res.ok) hud.toast('That card cannot be dropped.');
      else if (PRACTICE) hud.toast(`Kept the ${CARDS[card.type].name}, left the ${CARDS[res.dropped.type].name} behind.`);
      refresh(); then?.();
    },
    onUse: () => { resolveFullHand(state, player, card, 'leave'); refresh(); then?.(); },
    onLeave: () => {
      resolveFullHand(state, player, card, 'leave');
      if (PRACTICE) hud.toast(`Left the ${CARDS[card.type].name} in ${where}.`);
      refresh(); then?.();
    },
  });
}

function onUseBandage(cardId) {
  const r = useBandage(state, activePlayer(state), cardId);
  if (!r.ok) { hud.toast(r.reason === 'full' ? 'Already at full health.' : r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.'); return; }
  hud.toast(`Bandaged — health ${r.health} of ${rules.maxHealth}.`);
  refresh();
}

function onUnlock(cardId, roomId) {
  const r = useUnlock(state, floor, activePlayer(state), cardId, roomId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot use that here.'); return; }
  const name = floor.rooms.get(roomId)?.name ?? 'the room';
  hud.toast(r.opened ? `${name} is open.` : `The lock pick snapped. ${name} stays locked.`);
  hand.close();
  syncViews(false); refresh();
}

function onBarricade(cardId, doorwayId) {
  const r = useBarricade(state, floor, activePlayer(state), cardId, doorwayId);
  if (!r.ok) { hud.toast(r.reason === 'ap' ? 'No action points left.' : 'Cannot barricade that.'); return; }
  hud.toast('Doorway barricaded for one round.');
  hand.close();
  refresh();
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
    overlays.showNotice('The Switchboard', `${player.name} rang the Switchboard. ${switchboardLine(r.count)}`, refresh);
  }
}

// --- End of the match ----------------------------------------------------------------------
function showEnd() {
  stopTimer();
  if (state.practice) {
    const p = activePlayer(state);
    overlays.showEnd('You reached the fire exit',
      `Practice complete — ${rules.lanternsToEscape} Lanterns carried out, ${floor.roomList.length} rooms of the hotel revealed, on round ${state.round}.`,
      { keepExploring: false });
    void p;
    return;
  }
  const evil = state.players.filter(p => p.possessed).map(p => p.name);
  const dead = state.players.filter(p => !p.alive).map(p => p.name);
  const out = [...state.escaped].map(id => state.players.find(p => p.id === id)?.name).filter(Boolean);
  const parts = [`Possessed: ${evil.length ? evil.join(', ') : 'nobody'}`];
  if (dead.length) parts.push(`Dead: ${dead.join(', ')}`);
  parts.push(roundLabel(state));
  const opts = { restartLabel: 'New match' };
  if (state.won === 'humans') overlays.showEnd('The guests got out', `${out.join(', ')} escaped carrying ${rules.lanternsToEscape} Lanterns. ${parts.join(' · ')}`, opts);
  else if (state.dawn) overlays.showEnd('Dawn breaks', `Round ${rules.roundLimit} has ended and nobody got out. The hotel keeps them. ${parts.join(' · ')}`, opts);
  else overlays.showEnd('The hotel keeps them', `No clean guest is left. ${parts.join(' · ')}`, opts);
}

function restart() {
  seed = newSeed();
  resetState(state, floor, seed);          // a new random hotel
  clearRoomViews(roomViews, view.scene);
  doorways.reset();
  rebuildGrid();
  movers.forEach((m, i) => m.reset(startSpot(i)[0], startSpot(i)[1]));
  pendingArrival = null; selectedMove = null;
  discovery.refresh();
  syncViews(false);
  rig.setFocus(activeMover().x, activeMover().z, true);
  rig.reset();
  mood.snap(activePlayer(state).currentRoom);
  overlays.hideEnd(); overlays.hideNotice(); hand.close(); map.close();
  fullHand.close(); discard.close(); handoff.close(); meeting.close(); hud.hideConfirm();
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

// The usable doorway (if any) near a ground point, and the room it leads to.
function usableDoorwayNear(px, pz, player) {
  const t = cfg.walls.thickness;
  let best = null, bestD = Infinity;
  for (const d of usableDoorways(state, floor, player)) {
    const along = d.axis === 'x';
    const halfAlong = d.width / 2 + 0.6, halfAcross = t + 0.7;
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
  const t = cfg.walls.thickness;
  for (const d of (floor.rooms.get(player.currentRoom)?.frontier || [])) {
    const along = d.axis === 'x';
    const da = along ? Math.abs(px - d.center[0]) : Math.abs(pz - d.center[1]);
    const dc = along ? Math.abs(pz - d.center[1]) : Math.abs(px - d.center[0]);
    if (da <= d.width / 2 + 0.6 && dc <= t + 0.7) return d;
  }
  return null;
}

// Any doorway of the current room near a ground point, usable or not (for explaining a refusal).
function doorwayNear(px, pz, player) {
  const t = cfg.walls.thickness;
  for (const d of (floor.rooms.get(player.currentRoom)?.doorways || [])) {
    const along = d.axis === 'x';
    const da = along ? Math.abs(px - d.center[0]) : Math.abs(pz - d.center[1]);
    const dc = along ? Math.abs(pz - d.center[1]) : Math.abs(px - d.center[0]);
    if (da <= d.width / 2 + 0.6 && dc <= t + 0.7) return d;
  }
  return null;
}

// A free standing spot in a discovered room: the centre, or a nearby ring position not on
// another player.
function standingSlot(roomId, forIndex) {
  const room = floor.rooms.get(roomId);
  const [cx, cz] = room.center;
  const others = movers.filter((m, i) => i !== forIndex && state.players[i].alive);
  const occupied = (x, z) => others.some(m => Math.hypot(m.x - x, m.z - z) < 0.7);
  const walkable = (x, z) => { const c = grid.cellAt(x, z); return c >= 0 && grid.walkable[c]; };
  const ring = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [ox, oz] of ring) {
    const x = cx + ox * 0.95, z = cz + oz * 0.95;
    if (walkable(x, z) && !occupied(x, z)) return { x, z };
  }
  return { x: cx, z: cz };
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

createInput(view.renderer.domElement, {
  onTap(x, y) {
    if (!running || state.finished || uiBusy() || activeMover().walking) return;
    const p = screenToGround(x, y);
    if (!p) return;
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
      const dest = blocked.otherRoom(player.currentRoom);
      hud.toast(isBarricaded(state, blocked.id) ? 'That doorway is barricaded.'
        : isLocked(state, dest) ? 'That door is locked — a Master Key or Lock Pick opens it from here.'
          : 'Not enough action points to go through.');
      return;
    }
    // 2. Otherwise, a free reposition inside the current room.
    const plan = discovery.plan(p.x, p.z);
    if (plan.ok && plan.cost === 0) discovery.go(plan);
    else if (plan.ok) hud.toast('Tap a glowing doorway to change rooms.');
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
hud.on('endTurn', doEndTurn);
hud.on('search', onSearch);
hud.on('roomJob', onRoom);
hud.on('trade', onTrade);
hud.onHand(() => { if (running && !uiBusy()) hand.open(state, floor); });
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
hud.on('restartPractice', () => { if (!uiBusy() || overlays.endOpen) restart(); });

// --- Start screen: choose the game ---------------------------------------------------------
// The only decision that has to be made before the world is built, so it is in the address and
// picking a different one reloads the page. No file editing, no settings menu to get lost in.
function buildStartScreen() {
  const sub = document.getElementById('start-sub');
  const host = document.getElementById('mode-buttons');
  if (sub) {
    sub.textContent = HOTSEAT
      ? `Hot-seat · ${rules.playerCount} guests, one device · one is secretly possessed · find ${rules.lanternsToEscape} Lanterns and get one clean guest out before dawn (${rules.roundLimit} rounds)`
      : `Practice mode · explore the hotel alone, find ${rules.lanternsToEscape} Lanterns, reach the fire exit`;
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
// --- Initial state -----------------------------------------------------------------------
syncViews(false);
rig.setFocus(activeMover().x, activeMover().z, true);
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
  }
  rig.setFocus(activeMover().x, activeMover().z);
  rig.update(dt);
  for (const rv of roomViews.values()) rv.update(dt);
  doorways.update(time, dt, roomViews);
  pathPreview.update(selectedMove && hud.confirmOpen && !activeMover().walking ? selectedMove : null, time);
  mood.update(activePlayer(state).currentRoom, dt, time, activeMover());
  updateCutaway(roomViews, rig, state, cfg, dt);
  characters.forEach((cv, i) => cv.update(movers[i], dt));
  view.render();
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
  fullHandOpen: () => fullHand.isOpen,
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
  canEscape: () => canEscape(state, floor, activePlayer(state)),
  openHand: () => hand.open(state, floor),
  rotate: steps => rig.rotate(steps),
  toggleMap: () => map.toggle(state, movers),
  isMapOpen: () => map.isOpen,
  isRunning: () => running,
  isFinished: () => state.finished,
  groundToScreen,
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
