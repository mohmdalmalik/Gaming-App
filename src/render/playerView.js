// Placeholder player: a capsule with a small dark "nose" so the facing direction reads.
import * as THREE from 'three';
import { unitBox, lambert } from './materials.js';

export function createPlayerView(cfg, scene) {
  const r = cfg.player.radius, h = cfg.player.height;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.1, h - 2 * r), 4, 12), lambert(cfg.palette.player));
  body.position.y = h / 2;
  const nose = new THREE.Mesh(unitBox, lambert(cfg.palette.playerMarker));
  nose.scale.set(0.16, 0.14, 0.1);
  nose.position.set(0, h * 0.7, r - 0.03);
  group.add(body, nose);
  scene.add(group);

  let lean = 0;
  return {
    group,
    update(player, dt) {
      group.position.set(player.x, player.bob, player.z);
      group.rotation.y = player.heading;
      const targetLean = player.walking ? 0.07 : 0;
      lean += (targetLean - lean) * Math.min(1, dt * 8);
      body.rotation.x = lean;
    },
  };
}
