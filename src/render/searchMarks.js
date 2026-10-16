// Small brass tags on the furniture of a room, so the table can see at a glance which rooms are done without opening the
// map. Two kinds, both public:
//   - a tick on a room that has been searched (on the piece the search icon was over);
//   - a grey cross with a tick on an Infirmary that has been used (each Infirmary works once per match, for everyone),
//     hanging over the piece its heal icon stands on. The icon itself also shows "already used" to the guest standing there.
// One small sprite per marked room (at most 16 searched and 2 used Infirmaries in a match), built the first time it is
// needed and then just shown or hidden — no per-frame allocation and no extra draw calls for rooms nobody has marked.
// They are part of the scene (furniture in front can hide them).
import * as THREE from 'three';
import { searchSpotOf } from '../game/hotel.js';

function tickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(26, 22, 4, 32, 32, 30);
  grad.addColorStop(0, '#f3dc97'); grad.addColorStop(0.6, '#c9a24e'); grad.addColorStop(1, '#8c6c2c');
  g.fillStyle = grad;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#3a2a10'; g.lineWidth = 3;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = '#3a2a10';
  g.lineWidth = 6; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(20, 33); g.lineTo(29, 42); g.lineTo(45, 23); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A used Infirmary: a pewter disc with a grey cross (so it reads as "the Infirmary", turned off) and a small green tick
// on its lower right ("done").
function spentTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  const grad = g.createRadialGradient(26, 22, 4, 32, 32, 30);
  grad.addColorStop(0, '#b9bdc4'); grad.addColorStop(0.6, '#858a92'); grad.addColorStop(1, '#5d626a');
  g.fillStyle = grad;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#2c2f35'; g.lineWidth = 3;
  g.beginPath(); g.arc(32, 32, 27, 0, Math.PI * 2); g.stroke();
  // the cross
  g.fillStyle = '#3d4148';
  g.beginPath();
  g.moveTo(27, 12); g.lineTo(37, 12); g.lineTo(37, 27); g.lineTo(52, 27); g.lineTo(52, 37); g.lineTo(37, 37);
  g.lineTo(37, 52); g.lineTo(27, 52); g.lineTo(27, 37); g.lineTo(12, 37); g.lineTo(12, 27); g.lineTo(27, 27);
  g.closePath(); g.fill();
  // the tick, on a green disc
  g.fillStyle = '#8bd7ab'; g.strokeStyle = '#1f6b45'; g.lineWidth = 3;
  g.beginPath(); g.arc(46, 46, 12, 0, Math.PI * 2); g.fill(); g.stroke();
  g.strokeStyle = '#0d4326'; g.lineWidth = 4.2; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(40, 46.5); g.lineTo(44.3, 51); g.lineTo(52, 41.5); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSearchMarks(floor, scene) {
  const material = new THREE.SpriteMaterial({ map: tickTexture(), transparent: true, opacity: 0.92 });
  const spentMaterial = new THREE.SpriteMaterial({ map: spentTexture(), transparent: true, opacity: 0.95 });
  // On the searched furniture, at its edge facing the middle of the room (like the search icon),
  // or in the middle of a room that has none.
  const at = (sprite, room) => {
    const f = searchSpotOf(room);
    if (!f) { sprite.position.set(room.center[0], 0.9, room.center[1]); return; }
    const [cx, cz] = f.center, hx = f.size[0] / 2, hz = f.size[2] / 2;
    sprite.position.set(Math.min(cx + hx - 0.15, Math.max(cx - hx + 0.15, room.center[0])), Math.min(f.size[1], 1.1) + 0.2,
      Math.min(cz + hz - 0.15, Math.max(cz - hz + 0.15, room.center[1])));
  };
  // The used-Infirmary mark hangs just above the piece (the Infirmary's cabinet is tall, and a tag at the height of the search
  // icon would sit inside it or behind its model), or in the middle of a room that has none.
  const above = (sprite, room) => {
    const f = searchSpotOf(room);
    if (!f) { at(sprite, room); return; }
    sprite.position.set(f.center[0], f.size[1] + 0.32, f.center[1]);
  };
  const marks = new Map();        // roomId -> the tick of a searched room
  const spentMarks = new Map();   // roomId -> the cross of a used Infirmary

  function markFor(roomId, pool, mat, size, put) {
    let sprite = pool.get(roomId);
    if (sprite) return sprite;
    const room = floor.rooms.get(roomId);
    if (!room) return null;
    sprite = new THREE.Sprite(mat);
    sprite.scale.set(size, size, 1);
    put(sprite, room);
    sprite.renderOrder = 6;
    sprite.visible = false;
    scene.add(sprite);
    pool.set(roomId, sprite);
    return sprite;
  }
  // Show the mark of every discovered room in `ids`; hide the rest of the pool.
  function show(ids, pool, mat, size, put, state) {
    for (const id of ids) {
      const sprite = markFor(id, pool, mat, size, put), room = floor.rooms.get(id);
      if (!sprite) continue;
      // (the hotel is rebuilt every match, so a room can be somewhere else now)
      if (room) put(sprite, room);
      sprite.visible = !!room && state.discovered.has(id);
    }
    for (const [id, sprite] of pool) if (!ids.has(id)) sprite.visible = false;
  }
  const NONE = new Set();

  return {
    // A tick and a used-Infirmary mark with the real materials, for the warm-up at the start of a game (main.js warmUp).
    warmObjects: () => [new THREE.Sprite(material), new THREE.Sprite(spentMaterial)],
    // Show a tick in every discovered room that has been searched, and the grey cross in every discovered Infirmary that has
    // been used; hide the rest.
    update(state) {
      show(state.searchedRooms, marks, material, 0.3, at, state);
      show(state.spentInfirmaries || NONE, spentMarks, spentMaterial, 0.48, above, state);
    },
  };
}
