// Entry point: builds the floor from data, sets up rendering, input and interface, and
// runs the game loop.
import * as THREE from 'three';
import { config as cfg } from './config.js';
import { floor1 } from './data/floor1.js';
import { buildFloor } from './game/floor.js';
import { buildGrid } from './game/grid.js';
import { createState, resetState, endTurn } from './game/state.js';
import { createScene } from './render/scene.js';
import { createRoomViews, createDoorwayViews } from './render/roomView.js';
import { updateCutaway } from './render/cutaway.js';
import { createMood } from './render/mood.js';
import { createPlayerView } from './render/playerView.js';
import { createCameraRig } from './camera.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createDiscovery } from './discovery.js';
import { createHud } from './hud.js';
import { createMap } from './map.js';
import { createOverlays } from './overlays.js';

// --- World (pure data + rules) ---------------------------------------------------------
const floor = buildFloor(floor1, cfg);
const grid = buildGrid(floor, cfg);
if (floor.problems.length) {
  // A broken floor file is a bug worth stopping for, not something to limp past.
  throw new Error(`Problems in the floor data:\n• ${floor.problems.join('\n• ')}`);
}
const state = createState(floor);
const player = createPlayer(cfg, floor.start.pos);

// --- Rendering -------------------------------------------------------------------------
const container = document.getElementById('view');
const view = createScene(container, cfg);
const roomViews = createRoomViews(floor, cfg, view.scene);
const doorways = createDoorwayViews(floor, cfg, view.scene);
const playerView = createPlayerView(cfg, view.scene);
const mood = createMood(roomViews, view.hemi, cfg);
const rig = createCameraRig(view.camera, cfg);

// --- Interface -------------------------------------------------------------------------
const hud = createHud(document, cfg);
const map = createMap(document, floor, cfg);
const overlays = createOverlays(document);

let running = false;
let exitTimer = null;

const discovery = createDiscovery({
  floor, grid, state, player, cfg,
  on: {
    reject(reason, plan) {
      if (reason === 'notEnoughActionPoints') {
        hud.toast(state.actionPoints === 0
          ? 'No action points left — tap End turn.'
          : `That route needs ${plan.cost} action points — you have ${state.actionPoints}.`);
      } else if (reason === 'noPath') {
        hud.toast("Can't find a way there.");
      }
    },
    roomEntered(result) {
      syncViews(true);
      hud.update(state, floor);
      if (result.isExit) {
        clearTimeout(exitTimer);
        exitTimer = setTimeout(showExit, cfg.exit.overlayDelay * 1000);
      }
    },
  },
});

// Bring every render-side flag in line with the game state.
function syncViews(animate) {
  for (const [id, rv] of roomViews) {
    const known = state.discovered.has(id);
    if (known !== rv.revealed) rv.setRevealed(known, animate);
  }
  for (const dv of doorways.views.values()) {
    const a = state.discovered.has(dv.doorway.a), b = state.discovered.has(dv.doorway.b);
    dv.setState({ known: a || b, frontier: a !== b });
  }
}

function showExit() {
  overlays.showExit(`Turn ${state.turn} · ${state.discovered.size} of ${floor.roomList.length} rooms explored`);
}

function restart() {
  clearTimeout(exitTimer);
  resetState(state, floor);
  player.reset(floor.start.pos[0], floor.start.pos[1]);
  discovery.refresh();
  syncViews(false);
  rig.setFocus(player.x, player.z, true);
  rig.reset();
  mood.snap(state);
  hud.update(state, floor);
  overlays.hideExit();
  map.close();
}

function begin() {
  // Future audio unlock point: iOS only allows sound created synchronously inside a tap
  // handler like this one. No sound in this pass.
  overlays.hideStart();
  hud.show();
  running = true;
}

function doEndTurn() {
  if (state.finished) return;
  endTurn(state, floor);
  hud.update(state, floor);
  hud.toast(`Turn ${state.turn} — action points restored.`);
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

createInput(view.renderer.domElement, {
  onTap(x, y) {
    if (!running || map.isOpen) return;
    const p = screenToGround(x, y);
    if (p) discovery.walkTo(p.x, p.z);
  },
  onPinch(factor) { if (running) rig.zoomBy(factor); },
  // The ground point under the fingers stays under the fingers, whatever the zoom.
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
hud.on('map', () => map.toggle(state, player));
overlays.onBegin(begin);
overlays.onRestart(restart);

// --- Initial state -----------------------------------------------------------------------
syncViews(false);
rig.setFocus(player.x, player.z, true);
mood.snap(state);
hud.update(state, floor);
view.compile();

// --- Game loop ---------------------------------------------------------------------------
let last = performance.now();
let frames = 0;
view.renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  const time = now / 1000;
  if (running) {
    player.update(dt);
    discovery.update();
  }
  rig.setFocus(player.x, player.z);
  rig.update(dt);
  for (const rv of roomViews.values()) rv.update(dt);
  doorways.update(time);
  mood.update(state, dt, time);
  updateCutaway(roomViews, rig, state, cfg, dt);
  playerView.update(player, dt);
  view.render();
  if (++frames === 2) overlays.setReady(); // first frames are on screen: allow "Tap to begin"
});
document.addEventListener('visibilitychange', () => { last = performance.now(); });

// --- Debug / test hooks (also handy from the browser console) ----------------------------
window.__game = {
  cfg, floor, grid, state, player, rig, roomViews, doorways, discovery, view,
  begin, restart, endTurn: doEndTurn,
  walkTo: (x, z) => discovery.walkTo(x, z),
  rotate: steps => rig.rotate(steps),
  toggleMap: () => map.toggle(state, player),
  isMapOpen: () => map.isOpen,
  isRunning: () => running,
  groundToScreen,
  screenToGround: (x, y) => { const p = screenToGround(x, y, new THREE.Vector3()); return p ? [p.x, p.z] : null; },
  roomCenter: id => floor.rooms.get(id)?.center ?? null,
  programCount: () => view.renderer.info.programs.length,
  setPixelRatio: cap => view.setPixelRatio(cap),
  setExposure: x => { view.renderer.toneMappingExposure = x; },
  setLight: (roomId, intensity) => { for (const l of roomViews.get(roomId)?.lights ?? []) l.base = intensity * cfg.render.pointLightScale; },
};
