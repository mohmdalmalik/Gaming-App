// Entry point: builds the floor, sets up rendering, interface and the turn-based rules of
// Hotel Escape, and runs the game loop. Five players take turns on one device (hot-seat).
import * as THREE from 'three';
import { config as cfg } from './config.js';
import { rules } from './data/rules.js';
import { floor1 } from './data/floor1.js';
import { roster } from './data/characters.js';
import { buildFloor } from './game/floor.js';
import { buildGrid } from './game/grid.js';
import {
  createState, resetState, endTurn, activePlayer, nextPlayer, checkWin,
  usableDoorways, pendingEncounters, lockEncounter,
} from './game/state.js';
import { search, useBandage, resolveTrade, resolveAttack, discardCard, overHandLimit } from './game/actions.js';
import { CARDS } from './game/cards.js';
import { createScene } from './render/scene.js';
import { createRoomViews, createDoorwayViews } from './render/roomView.js';
import { dressRooms } from './render/roomDressing.js';
import { updateCutaway } from './render/cutaway.js';
import { createMood } from './render/mood.js';
import { createCharacterView } from './render/characterView.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createDiscovery } from './discovery.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';
import { createOverlays } from './overlays.js';
import { createHand } from './ui/hand.js';
import { createEncounter } from './ui/encounter.js';
import { createDiscard } from './ui/discard.js';

// --- World (pure data + rules) ---------------------------------------------------------
const floor = buildFloor(floor1, cfg);
const grid = buildGrid(floor, cfg);
if (floor.problems.length) throw new Error(`Problems in the floor data:\n• ${floor.problems.join('\n• ')}`);
let seed = (Date.now() & 0x7fffffff) || 1;
const state = createState(floor, roster, seed);
const startSpot = i => floor.start.positions[i % floor.start.positions.length];
const movers = roster.map((_, i) => createPlayer(cfg, startSpot(i)));

// --- Rendering -------------------------------------------------------------------------
const container = document.getElementById('view');
const view = createScene(container, cfg);
const roomViews = createRoomViews(floor, cfg, view.scene);
const doorways = createDoorwayViews(floor, cfg, view.scene);
const characters = roster.map(def => createCharacterView(def, cfg, view.scene));
const mood = createMood(roomViews, view.hemi, cfg);
const rig = createCameraRig(view.camera, cfg);

// --- Interface -------------------------------------------------------------------------
const hud = createHud(document, cfg);
const map = createMap(document, floor, cfg);
const overlays = createOverlays(document);
const hand = createHand(document, cfg, { onUseBandage });
const encounter = createEncounter(document, cfg);
const discard = createDiscard(document, cfg, {
  onDiscard: cardId => { discardCard(state, activePlayer(state), cardId); refresh(); },
});

let running = false;
let pendingArrival = null;   // enterRoom result waiting for the walk to finish
let selectedMove = null;     // a door move awaiting confirmation

const uiBusy = () => map.isOpen || hand.isOpen || encounter.isOpen || discard.isOpen || overlays.endOpen;

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
  for (const [id, rv] of roomViews) {
    const known = state.discovered.has(id);
    if (known !== rv.revealed) rv.setRevealed(known, animate);
  }
  for (const dv of doorways.views.values()) {
    const a = state.discovered.has(dv.doorway.a), b = state.discovered.has(dv.doorway.b);
    dv.setState({ known: a || b, frontier: a !== b });
  }
  characters.forEach((cv, i) => { cv.setDead(!state.players[i].alive); cv.setActive(i === state.activeIndex && !state.finished); });
}

// Blink the doors the active player may use this turn.
function refreshUsable() {
  const usable = new Set(state.finished ? [] : usableDoorways(state, floor, activePlayer(state)).map(d => d.id));
  for (const dv of doorways.views.values()) dv.setUsable(usable.has(dv.doorway.id));
}

function refresh() { hud.update(state, floor); refreshUsable(); hand.refresh(); }

function activeMover() { return movers[state.activeIndex]; }

// --- Turn flow ---------------------------------------------------------------------------
function begin() {
  overlays.hideStart();
  hud.show();
  running = true;
  refresh();
}

function passTurn() {
  hud.hideConfirm(); selectedMove = null;
  const result = endTurn(state, floor);
  movers[result.from.index]?.halt();
  syncViews(false);
  if (result.finished) { refresh(); return; }
  rig.setFocus(activeMover().x, activeMover().z);
  mood.snap(activePlayer(state).currentRoom);
  refresh();
  hud.toast(`${result.to.name}'s turn — ${rules.actionPointsPerTurn} action points.`);
}

function doEndTurn() {
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
  // Obey the hand limit before control passes on.
  if (overHandLimit(activePlayer(state)) > 0) { discard.open(activePlayer(state), passTurn); return; }
  passTurn();
}

// The active player finished walking into a new room: check the exit, then a single forced
// encounter — with a player of their choosing when more than one is here.
function onArrive() {
  const player = activePlayer(state);
  const room = floor.rooms.get(player.currentRoom);
  pendingArrival = null;
  if (room?.isExit && checkWin(state, floor, player)) { showEnd(); return; }
  const candidates = pendingEncounters(state, floor, player);
  if (candidates.length) openEncounter(player, candidates);
  else refresh();
}

function openEncounter(P, candidates) {
  hud.hideConfirm(); selectedMove = null;
  encounter.start({
    state, P, candidates,
    onResolveTrade: (Q, cardIdP, cardIdQ) => resolveTrade(state, floor, P, Q, cardIdP, cardIdQ),
    onResolveAttack: (Q, weaponId) => resolveAttack(state, floor, P, Q, weaponId),
    onDone: (Q) => {
      // One meeting per entry: only the chosen pair is locked; the others aren't forced.
      lockEncounter(state, P.currentRoom, P.index, Q.index);
      syncViews(false); refresh();
      if (state.finished) showEnd();
    },
  });
}

function onSearch() {
  if (!running || state.finished || uiBusy() || activeMover().walking) return;
  const player = activePlayer(state);
  const r = search(state, floor, player);
  if (!r.ok) {
    hud.toast(r.reason === 'notSearchable' ? 'There is nothing to search in here.'
      : r.reason === 'searched' ? 'This room has already been searched.'
      : r.reason === 'dark' ? 'This room is dark — you need a Flashlight to search.'
      : r.reason === 'ap' ? 'No action points left to search.'
      : r.reason === 'empty' ? 'Nothing left to find here.' : 'Cannot search now.');
    return;
  }
  hud.toast(`${player.name} found a ${CARDS[r.card.type].name}.`);
  refresh();
}

function onUseBandage(cardId) {
  const r = useBandage(state, activePlayer(state), cardId);
  if (!r.ok) {
    hud.toast(r.reason === 'full' ? 'Already at full health.' : r.reason === 'ap' ? 'No action points left.' : 'Cannot use that now.');
    return;
  }
  refresh();
}

function showEnd() {
  const possessedNames = state.players.filter(p => p.possessed).map(p => p.name).join(', ');
  const dead = state.players.filter(p => !p.alive).map(p => p.name);
  const parts = [`Possessed: ${possessedNames || 'nobody'}`];
  if (dead.length) parts.push(`Dead: ${dead.join(', ')}`);
  parts.push(`Round ${state.round}`);
  if (state.won === 'humans') overlays.showEnd('The humans escaped!', `A clean guest reached the Fire Exit with the Exit Key. ${parts.join(' · ')}`);
  else overlays.showEnd('The hotel keeps them', `No clean guest is left to escape. ${parts.join(' · ')}`);
  refreshUsable();
}

function restart() {
  seed = (Date.now() & 0x7fffffff) || 1;
  resetState(state, floor, seed);
  movers.forEach((m, i) => m.reset(startSpot(i)[0], startSpot(i)[1]));
  pendingArrival = null; selectedMove = null;
  discovery.refresh();
  syncViews(false);
  rig.setFocus(activeMover().x, activeMover().z, true);
  rig.reset();
  mood.snap(activePlayer(state).currentRoom);
  overlays.hideEnd(); hand.close(); map.close(); hud.hideConfirm();
  refresh();
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

// Where to walk when moving through `door` into `dest`. A discovered room takes the standing
// slot (its centre / a free spot beside others); an undiscovered room can only be entered as
// far as the doorway landing until it is revealed.
function moveTargetInto(dest, door, forIndex) {
  if (state.discovered.has(dest)) return standingSlot(dest, forIndex);
  const room = floor.rooms.get(dest);
  const depth = cfg.walls.thickness + cfg.player.clearance + 0.5;
  if (door.axis === 'x') return { x: door.center[0], z: door.center[1] + (Math.sign(room.center[1] - door.center[1]) || 1) * depth };
  return { x: door.center[0] + (Math.sign(room.center[0] - door.center[0]) || 1) * depth, z: door.center[1] };
}

createInput(view.renderer.domElement, {
  onTap(x, y) {
    if (!running || state.finished || uiBusy() || activeMover().walking) return;
    const p = screenToGround(x, y);
    if (!p) return;
    const player = activePlayer(state);
    // 1. A usable door → offer to move there.
    const near = usableDoorwayNear(p.x, p.z, player);
    if (near) {
      const slot = moveTargetInto(near.dest, near.door, player.index);
      const plan = discovery.plan(slot.x, slot.z);
      if (plan.ok) {
        selectedMove = plan;
        hud.showConfirm(`Move to ${floor.rooms.get(near.dest).name}?`, `Move · ${plan.cost} AP`);
      } else {
        hud.toast('Cannot reach that room.');
      }
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
hud.onHand(() => { if (running && !uiBusy()) hand.open(state, floor); });
hud.on('map', () => { if (!encounter.isOpen && !discard.isOpen && !overlays.endOpen) map.toggle(state, movers); });
hud.onConfirm(
  () => { if (selectedMove) { discovery.go(selectedMove); selectedMove = null; hud.hideConfirm(); } },
  () => { selectedMove = null; hud.hideConfirm(); },
);
overlays.onBegin(begin);
overlays.onRestart(restart);

// --- Initial state -----------------------------------------------------------------------
syncViews(false);
rig.setFocus(activeMover().x, activeMover().z, true);
mood.snap(activePlayer(state).currentRoom);
hud.update(state, floor);
view.compile();

// Dress the starting room with the real glTF furniture (async — the models are local files,
// so this is quick). The greybox shows until it loads; if a piece fails the room just keeps
// its greybox. Recompile once dressed so the new materials don't stall the first frames.
dressRooms(roomViews, floor, cfg)
  .then(() => view.compile())
  .catch(err => console.warn('room dressing failed:', err && err.message));

// --- Game loop ---------------------------------------------------------------------------
let last = performance.now();
let frames = 0;
view.renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  if (running && !state.finished) {
    activeMover().update(dt);
    discovery.update();
    if (pendingArrival && !activeMover().walking && activeMover().path.length === 0) onArrive();
  }
  rig.setFocus(activeMover().x, activeMover().z);
  rig.update(dt);
  for (const rv of roomViews.values()) rv.update(dt);
  doorways.update(time);
  mood.update(activePlayer(state).currentRoom, dt, time);
  updateCutaway(roomViews, rig, state, cfg, dt);
  characters.forEach((cv, i) => cv.update(movers[i], dt));
  view.render();
  if (++frames === 2) overlays.setReady();
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// --- Debug / test hooks ------------------------------------------------------------------
window.__game = {
  cfg, rules, floor, grid, state, movers, rig, roomViews, doorways, characters, discovery, view,
  begin, restart, endTurn: doEndTurn,
  refresh,                // re-sync HUD/doors after tests mutate state directly
  activePlayer: () => activePlayer(state),
  nextPlayer: () => nextPlayer(state),
  activeMover,
  walkTo: (x, z) => discovery.walkTo(x, z),
  moveToRoom,             // scripted move through a door (used by tests)
  search: () => onSearch(),
  openHand: () => hand.open(state, floor),
  rotate: steps => rig.rotate(steps),
  toggleMap: () => map.toggle(state, movers),
  isMapOpen: () => map.isOpen,
  encounterOpen: () => encounter.isOpen,
  isRunning: () => running,
  isFinished: () => state.finished,
  groundToScreen,
  screenToGround: (x, y) => { const p = screenToGround(x, y, new THREE.Vector3()); return p ? [p.x, p.z] : null; },
  roomCenter: id => floor.rooms.get(id)?.center ?? null,
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
