// Dump the starting room from the REAL game data, so the Blender model is built on exactly the
// size, doorways and furniture footprints the game uses (collision and pathfinding).
//   node tools/lobby-pipeline/dump_lobby.mjs > tools/lobby-pipeline/lobby.json
// The lobby has 3 or 4 open doorways, chosen each match, so the model has a doorway on all four
// sides AND a plain wall piece ("F") for each side; the game shows whichever the match needs.
import { hotel } from '../../src/data/hotel.js';
import { config } from '../../src/config.js';
import { createHotel, placeTile, SIDES } from '../../src/game/hotel.js';

const floor = createHotel(hotel, config);
floor.bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
const r = placeTile(floor, { ...hotel.lobby, doors: SIDES, searchable: false }, [0, 0], 0);
console.log(JSON.stringify({
  id: r.id, center: r.center, size: r.size, min: r.min, max: r.max,
  wallThickness: config.walls.thickness,
  doorways: r.frontier.map(d => ({ id: `${r.id}:${d.side}`, side: d.side, axis: d.axis, center: d.center, width: d.width })),
  furniture: r.furniture.map(x => ({ kind: x.kind, center: x.center, size: x.size })),
  start: hotel.lobby.startPositions,
}, null, 1));
