// Dump every room tile from the REAL game data (src/data/hotel.js), so each Blender model is built on
// exactly the walls, doorways and furniture footprints the game uses for collision and pathfinding.
//   node tools/room-pipeline/dump_rooms.mjs > tools/room-pipeline/rooms.json
// Tiles are dumped in their DEFAULT orientation, centred on (0, 0); the game turns the finished model
// with the tile (src/render/bakedRoom.js).
import { hotel } from '../../src/data/hotel.js';
import { config } from '../../src/config.js';
import { createHotel, placeTile } from '../../src/game/hotel.js';

const rooms = {};
for (const def of hotel.tiles) {
  const floor = createHotel(hotel, config);
  floor.bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  const r = placeTile(floor, def, [0, 0], 0);
  rooms[def.id] = {
    id: r.id, name: r.name, center: r.center, size: r.size, min: r.min, max: r.max,
    dark: r.dark, locked: r.locked, job: r.job, isExit: r.isExit, safe: r.safe, searchPoint: r.searchPoint,
    mood: def.mood, doors: [...r.doorSides],
    walls: r.walls.map(w => ({ id: w.id, side: w.side, min: w.min, max: w.max })),
    doorways: r.frontier.map(d => ({ side: d.side, axis: d.axis, center: d.center, width: d.width })),
    furniture: r.furniture.map(x => ({ kind: x.kind, center: x.center, size: x.size })),
  };
}
console.log(JSON.stringify({ wallThickness: config.walls.thickness, tileSize: hotel.tileSize, rooms }, null, 1));
