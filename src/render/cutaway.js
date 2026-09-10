// Dollhouse cutaway. Walls that face the camera are lowered to a stub so interiors stay
// visible. The decision uses the camera's (eased) yaw only, so walls never flap while the
// player walks or the view pans; they only change when the view rotates.
//
// Rule: a wall shared with another discovered room lowers whenever it is perpendicular to
// the view (either slab of the pair faces the camera), so you can see over it into the next
// room. Exterior walls and walls to undiscovered rooms lower only when they face the camera,
// leaving the far walls standing as a backdrop.

export function updateCutaway(roomViews, rig, state, cfg, dt) {
  const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw); // camera forward on the ground
  const H = cfg.walls.height;
  const k = 1 - Math.exp(-cfg.cutaway.lerpSpeed * dt);
  for (const view of roomViews.values()) {
    if (!view.group.visible) continue;
    for (const w of view.walls) {
      const facing = -(w.wall.normal[0] * fx + w.wall.normal[1] * fz); // > 0: faces the camera
      const shared = w.wall.neighbour && state.discovered.has(w.wall.neighbour);
      const lower = shared ? Math.abs(facing) > cfg.cutaway.threshold : facing > cfg.cutaway.threshold;
      const target = lower ? cfg.cutaway.stubHeight : H;
      view.setWallHeight(w, w.height + (target - w.height) * k);
    }
  }
}
