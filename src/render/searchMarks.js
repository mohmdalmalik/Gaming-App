// A small brass tick that floats in a room once it has been searched, so the table can see at a
// glance which rooms are done without opening the map. One thin plane per searched room (at most
// 16 in a match), built the first time it is needed and then just shown or hidden — no per-frame
// allocation and no extra draw calls for rooms nobody has searched.
import * as THREE from 'three';

function tickTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#e8ca80';
  g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(14, 34); g.lineTo(27, 47); g.lineTo(50, 18); g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSearchMarks(floor, scene) {
  const material = new THREE.SpriteMaterial({
    map: tickTexture(), transparent: true, opacity: 0.85, depthTest: false,
  });
  const marks = new Map();   // roomId -> sprite

  function markFor(roomId) {
    let sprite = marks.get(roomId);
    if (sprite) return sprite;
    const room = floor.rooms.get(roomId);
    if (!room) return null;
    sprite = new THREE.Sprite(material);
    sprite.scale.set(0.55, 0.55, 1);
    sprite.position.set(room.center[0], 2.05, room.center[1]);
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
        const sprite = markFor(id);
        if (sprite) sprite.visible = state.discovered.has(id);
      }
      for (const [id, sprite] of marks) if (!state.searchedRooms.has(id)) sprite.visible = false;
    },
  };
}
