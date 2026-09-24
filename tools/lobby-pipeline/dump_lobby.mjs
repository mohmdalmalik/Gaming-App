// Dump the starting room's geometry from the REAL floor data, so the Blender model is built on
// exactly the walls, doorways and furniture footprints the game uses.
//   node tools/lobby-pipeline/dump_lobby.mjs > tools/lobby-pipeline/lobby.json
import { floor1 } from '../../src/data/floor1.js';
import { config } from '../../src/config.js';
import { buildFloor } from '../../src/game/floor.js';

const f = buildFloor(floor1, config);
const r = f.rooms.get(floor1.start.room);
console.log(JSON.stringify({
  id: r.id, center: r.center, size: r.size, min: r.min, max: r.max,
  wallThickness: config.walls.thickness,
  walls: r.walls.map(w => ({ id: w.id, side: w.side, neighbour: w.neighbour, min: w.min, max: w.max })),
  doorways: r.doorways.map(d => ({ id: d.id, axis: d.axis, center: d.center, width: d.width })),
  furniture: r.furniture.map(x => ({ kind: x.kind, center: x.center, size: x.size })),
  start: floor1.start.positions,
}, null, 1));
