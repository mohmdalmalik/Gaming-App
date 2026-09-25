// Mood lighting. Rooms do not own lights: each lists where its lights are (colour, strength, reach,
// optional flicker), and a fixed POOL of point lights is handed to the ones nearest the camera.
// The number of lights never changes, so Three.js never has to rebuild a shader as the hotel grows
// (a stall on the iPad), and far-off rooms simply fall back to the ambient light.
// A global light level also eases toward the mood of the room the active guest is in.
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

export function createMood(roomViews, hemi, cfg, scene) {
  const skyBase = new THREE.Color(cfg.render.hemisphere.sky);
  const target = new THREE.Color();
  const pool = [];
  for (let i = 0; i < cfg.render.lightPool; i++) {
    const light = new THREE.PointLight(0xffffff, 0, 10, 2);
    light.position.set(0, -50, 0);
    scene.add(light);
    pool.push(light);
  }
  const candidates = [];
  return {
    pool,
    // `roomId` is the room the active guest is in (the scene's light level follows it); `focus` is
    // the point the camera looks at (the pool goes to the lights nearest it).
    update(roomId, dt, time, focus) {
      const room = roomViews.get(roomId)?.room;
      const ambient = room?.mood.ambient ?? 0.6;
      const k = Math.min(1, dt * cfg.render.ambientLerp);
      hemi.intensity += (cfg.render.hemisphere.baseIntensity * ambient - hemi.intensity) * k;
      target.set(room?.mood.color || '#ffffff').lerp(skyBase, 0.5);
      hemi.color.lerp(target, k);

      candidates.length = 0;
      for (const view of roomViews.values()) {
        if (!view.group.visible) continue;
        const reveal = easeOutCubic(view.revealT);
        const fl = view.room.mood.flicker ? flickerLevel(time, view.room.mood.flicker, view.seed) : 1;
        for (const L of view.lights) {
          const d = focus ? Math.hypot(L.pos.x - focus.x, L.pos.z - focus.z) : 0;
          candidates.push({ L, d, intensity: L.base * reveal * fl });
        }
      }
      candidates.sort((a, b) => a.d - b.d);
      for (let i = 0; i < pool.length; i++) {
        const c = candidates[i], light = pool[i];
        if (!c) { light.intensity = 0; continue; }
        light.position.copy(c.L.pos);
        light.color.copy(c.L.color);
        light.distance = c.L.reach;
        light.intensity = c.intensity;
      }
    },
    snap(roomId) {
      const room = roomViews.get(roomId)?.room;
      hemi.intensity = cfg.render.hemisphere.baseIntensity * (room?.mood.ambient ?? 0.6);
      hemi.color.set(room?.mood.color || '#ffffff').lerp(skyBase, 0.5);
    },
  };
}
