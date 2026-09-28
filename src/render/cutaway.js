// Dollhouse cutaway. Walls that face the camera are lowered to a stub so interiors stay
// visible. The decision uses the camera's (eased) yaw and the active guest's room only, so walls
// never flap while the player walks inside a room or the view pans.
//
// Corner-on view (the standard one, config.camera.yawOffsetDeg 45): like the owner's room pictures,
// every room's two near walls (those facing the camera) are lowered and its two far walls stand as a
// backdrop. Rooms nearer the camera than the active guest's room are cut down entirely (their far
// walls would stand between the camera and the guest's room), so that room is always open to view.
//
// Square-on views (?camera=square / classic): a wall shared with another discovered room lowers
// whenever it is perpendicular to the view (either slab of the pair faces the camera), so you can see
// over it into the next room. Exterior walls and walls to undiscovered rooms lower only when they
// face the camera, leaving the far walls standing as a backdrop.
//
// Anything still standing between the camera and the guest (a side wall at a doorway, a wardrobe)
// is faded locally by the see-through window in xray.js (updated here, once a frame).
import { updateXray } from './xray.js';

export function updateCutaway(roomViews, rig, state, cfg, dt) {
  const fx = -Math.sin(rig.yaw), fz = -Math.cos(rig.yaw); // camera forward on the ground
  const H = cfg.walls.height;
  const k = 1 - Math.exp(-cfg.cutaway.lerpSpeed * dt);
  const thr = cfg.cutaway.threshold;
  const corner = Math.abs(((cfg.camera.yawOffsetDeg || 0) % 90 + 90) % 90 - 45) < 30;
  const current = state.players?.[state.activeIndex]?.currentRoom;
  const here = current && roomViews.get(current)?.room.center;
  for (const view of roomViews.values()) {
    if (!view.group.visible) continue;
    // (corner-on) a room more than 2 m nearer the camera than the guest's room: every wall comes down
    const inFront = corner && here && view.room.id !== current
      && (view.room.center[0] - here[0]) * fx + (view.room.center[1] - here[1]) * fz < -2;
    for (const w of view.walls) {
      const facing = -(w.wall.normal[0] * fx + w.wall.normal[1] * fz); // > 0: faces the camera
      let lower;
      if (corner) lower = inFront || facing > thr || (!!current && w.wall.neighbour === current && view.room.id !== current);
      else {
        const shared = w.wall.neighbour && state.discovered.has(w.wall.neighbour);
        lower = shared ? Math.abs(facing) > thr : facing > thr;
      }
      const target = lower ? cfg.cutaway.stubHeight : H;
      view.setWallHeight(w, w.height + (target - w.height) * k);
    }
  }
  updateXray(rig.camera);
}
