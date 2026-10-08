// "Go · 1 AP": a quiet tag over each revealed room next to the active guest's room that they can walk
// into right now (an open doorway that is not barricaded, not into a locked room, and an action left).
// It tells a first-time player that a room is tapped to go there; it is lighter than the gold
// "Explore · 1 AP" over a fogged room, and main.js leaves it out while the Move/Cancel bar, a meeting
// or anything else is up, while the guest is walking, and when zoomed far out (cfg.camera.tagsFrom:
// the guests' name tags take over there). The rules decide what can be entered
// (doorwayPassable, the move cost); this only draws it, through the shared tag layer
// (src/ui/screenTags.js).
import { doorwayPassable, moveCostInto } from '../game/state.js';

export function createGoTags() {
  return {
    update(tags, state, floor, player, show) {
      if (!show || !player?.alive) return;
      const room = floor.rooms.get(player.currentRoom);
      if (!room) return;
      for (const d of room.doorways) {
        const to = d.otherRoom(room.id);
        const cost = moveCostInto(state, to);
        if (!doorwayPassable(state, d, room.id) || player.actionPoints < cost) continue;
        const r = floor.rooms.get(to);
        // a little in from the room's middle toward the door: near the guest, on screen more often
        const p = [r.center[0] + (d.center[0] - r.center[0]) * 0.35, 0.9, r.center[1] + (d.center[1] - r.center[1]) * 0.35];
        tags.put(`go:${to}`, p, `Go · ${cost} AP`, 'go-label');
      }
    },
  };
}
