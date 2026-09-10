// Player movement: follows a list of waypoints at walking speed, turning smoothly toward
// the direction of travel, with a subtle bob while moving. Pure numbers, no rendering.

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function createPlayer(cfg, start) {
  const p = {
    x: start[0],
    z: start[1],
    heading: 0,        // radians; forward = (sin heading, cos heading)
    path: [],
    walking: false,
    bob: 0,
    bobPhase: 0,
    destination: null,

    setPath(points) {
      this.path = points.map(pt => [pt[0], pt[1]]);
      this.destination = this.path.length ? this.path[this.path.length - 1] : null;
    },
    stop() { this.path = []; this.destination = null; },
    reset(x, z) { this.x = x; this.z = z; this.heading = 0; this.stop(); this.walking = false; this.bob = 0; this.bobPhase = 0; },

    update(dt) {
      let remaining = cfg.player.speed * dt;
      let moved = false;
      while (this.path.length && remaining > 0) {
        const [tx, tz] = this.path[0];
        const dx = tx - this.x, dz = tz - this.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= cfg.player.arriveDistance) { this.path.shift(); continue; }
        const desired = Math.atan2(dx, dz);
        this.heading += wrapAngle(desired - this.heading) * Math.min(1, dt * cfg.player.turnSpeed);
        const step = Math.min(dist, remaining);
        this.x += dx / dist * step;
        this.z += dz / dist * step;
        remaining -= step;
        moved = true;
        if (step >= dist - 1e-9) this.path.shift();
      }
      this.walking = moved;
      if (moved) {
        this.bobPhase += dt * cfg.player.bobFrequency * Math.PI * 2;
        this.bob = Math.abs(Math.sin(this.bobPhase)) * cfg.player.bobAmplitude;
      } else {
        this.bob += (0 - this.bob) * Math.min(1, dt * 10);
        if (!this.path.length) this.destination = null;
      }
      return moved;
    },
  };
  return p;
}
