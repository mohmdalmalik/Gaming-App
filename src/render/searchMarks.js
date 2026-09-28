// A small brass tag with an engraved tick, resting on the furniture of a room that has been searched
// (the piece the search icon was over), so the table can see at a glance which rooms are done
// without opening the map. One small sprite per searched room (at most 16 in a match), built the
// first time it is needed and then just shown or hidden — no per-frame allocation and no extra draw
// calls for rooms nobody has searched. It is part of the scene (furniture in front can hide it).
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

export function createSearchMarks(floor, scene) {
  const material = new THREE.SpriteMaterial({ map: tickTexture(), transparent: true, opacity: 0.92 });
  // On the searched furniture, at its edge facing the middle of the room (like the search icon),
  // or in the middle of a room that has none.
  const at = (sprite, room) => {
    const f = searchSpotOf(room);
    if (!f) { sprite.position.set(room.center[0], 0.9, room.center[1]); return; }
    const [cx, cz] = f.center, hx = f.size[0] / 2, hz = f.size[2] / 2;
    sprite.position.set(Math.min(cx + hx - 0.15, Math.max(cx - hx + 0.15, room.center[0])), Math.min(f.size[1], 1.1) + 0.2,
      Math.min(cz + hz - 0.15, Math.max(cz - hz + 0.15, room.center[1])));
  };
  const marks = new Map();   // roomId -> sprite

  function markFor(roomId) {
    let sprite = marks.get(roomId);
    if (sprite) return sprite;
    const room = floor.rooms.get(roomId);
    if (!room) return null;
    sprite = new THREE.Sprite(material);
    sprite.scale.set(0.3, 0.3, 1);
    at(sprite, room);
    sprite.renderOrder = 6;
    sprite.visible = false;
    scene.add(sprite);
    marks.set(roomId, sprite);
    return sprite;
  }

  return {
    // Show a tick in every discovered room that has been searched; hide the rest.
    update(state) {
      for (const id of state.searchedRooms) {
        const sprite = markFor(id), room = floor.rooms.get(id);
        if (!sprite) continue;
        // (the hotel is rebuilt every match, so a room can be somewhere else now)
        if (room) at(sprite, room);
        sprite.visible = !!room && state.discovered.has(id);
      }
      for (const [id, sprite] of marks) if (!state.searchedRooms.has(id)) sprite.visible = false;
    },
  };
}
