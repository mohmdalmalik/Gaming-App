// Camera rig: an elevated, angled view that follows the player, snaps its rotation in 90°
// steps, zooms within limits and can be dragged away (it eases back on its own once the
// fingers lift).
import * as THREE from 'three';

const QUARTER = Math.PI / 2;

function smoothstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

export function createCameraRig(camera, cfg) {
  const c = cfg.camera;
  const pitch = THREE.MathUtils.degToRad(c.pitchDeg);
  const target = new THREE.Vector3();   // where the player is
  const focus = new THREE.Vector3();    // eased focus point (before pan)
  const pan = new THREE.Vector3();      // world-space drag offset
  const offset = new THREE.Vector3();
  let yawIndex = 0;
  let yaw = 0, yawFrom = 0, yawTo = 0, yawT = 1;
  let distance = c.distance;
  let sincePan = Infinity;
  let holding = false;
  let followed = false;

  const rig = {
    camera,
    get yaw() { return yaw; },
    get yawIndex() { return yawIndex; },
    get distance() { return distance; },
    get pan() { return pan; },
    get debug() { return { sincePan, holding, yawT, distance }; },

    setFocus(x, z, immediate = false) {
      target.set(x, 0, z);
      if (immediate || !followed) { focus.copy(target); followed = true; }
    },

    rotate(steps) {
      yawIndex = ((yawIndex + steps) % 4 + 4) % 4;
      yawFrom = yaw;
      yawTo = yaw + steps * QUARTER;
      yawT = 0;
    },
    rotateLeft() { rig.rotate(1); },
    rotateRight() { rig.rotate(-1); },

    zoomBy(factor) {
      distance = THREE.MathUtils.clamp(distance / factor, c.minDistance, c.maxDistance);
    },

    // Shift the view by a world-space delta (the ground point under the finger stays put).
    panByWorld(dx, dz) {
      pan.x += dx; pan.z += dz;
      if (pan.length() > c.maxPanDistance) pan.setLength(c.maxPanDistance);
      sincePan = 0;
      holding = true;
    },
    // Fingers lifted: start the countdown before the camera drifts back to the player.
    release() { holding = false; sincePan = 0; },

    reset() {
      pan.set(0, 0, 0);
      distance = c.distance;
      yawIndex = 0; yaw = 0; yawFrom = 0; yawTo = 0; yawT = 1;
      focus.copy(target);
      sincePan = Infinity;
      holding = false;
    },

    update(dt) {
      if (yawT < 1) {
        yawT = Math.min(1, yawT + dt / c.rotateDuration);
        yaw = yawFrom + (yawTo - yawFrom) * smoothstep(yawT);
      }
      if (!holding) {
        sincePan += dt;
        if (sincePan > c.panReturnDelay) pan.multiplyScalar(Math.exp(-c.panReturnLerp * dt));
      }
      focus.lerp(target, 1 - Math.exp(-c.followLerp * dt));

      offset.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance);
      camera.position.copy(focus).add(pan).add(offset);
      camera.lookAt(focus.x + pan.x, 0, focus.z + pan.z);
    },
  };
  return rig;
}
