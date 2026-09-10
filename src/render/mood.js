// Per-room mood lighting: point light colour/intensity/flicker from the data file, and a
// global light level that eases toward the mood of the room the player is in.
import * as THREE from 'three';
import { easeOutCubic } from './materials.js';

function hash(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function flickerLevel(time, f, seed) {
  const step = Math.floor(time * f.speed) + Math.floor(seed * 100);
  const noise = hash(step);
  const slow = 0.5 + 0.5 * Math.sin(time * 2.3 + seed);
  return f.min + (f.max - f.min) * (0.65 * noise + 0.35 * slow);
}

export function createMood(roomViews, hemi, cfg) {
  const skyBase = new THREE.Color(cfg.render.hemisphere.sky);
  const target = new THREE.Color();
  return {
    update(state, dt, time) {
      const room = roomViews.get(state.currentRoom)?.room;
      const ambient = room?.mood.ambient ?? 0.6;
      const k = Math.min(1, dt * cfg.render.ambientLerp);
      hemi.intensity += (cfg.render.hemisphere.baseIntensity * ambient - hemi.intensity) * k;
      target.set(room?.mood.color || '#ffffff').lerp(skyBase, 0.5);
      hemi.color.lerp(target, k);

      for (const view of roomViews.values()) {
        const reveal = easeOutCubic(view.revealT);
        const fl = view.room.mood.flicker ? flickerLevel(time, view.room.mood.flicker, view.seed) : 1;
        for (const { light, base } of view.lights) light.intensity = base * reveal * fl;
      }
    },
    snap(state) {
      const room = roomViews.get(state.currentRoom)?.room;
      hemi.intensity = cfg.render.hemisphere.baseIntensity * (room?.mood.ambient ?? 0.6);
      hemi.color.set(room?.mood.color || '#ffffff').lerp(skyBase, 0.5);
    },
  };
}
