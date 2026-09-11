// Pure floor model: turns the data file into world-space rooms, resolved doorways,
// wall segments (split around openings) and adjacency. No rendering code here so a
// server can reuse it later.

const SIDES = {
  north: { normal: [0, -1], axis: 'x' }, // wall along the room's smallest z
  south: { normal: [0, 1], axis: 'x' },  // wall along the room's largest z
  east: { normal: [1, 0], axis: 'z' },   // wall along the room's largest x
  west: { normal: [-1, 0], axis: 'z' },  // wall along the room's smallest x
};

const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const EPS = 1e-6;

export function buildFloor(data, cfg) {
  const t = cfg.walls.thickness;
  const problems = [];
  const rooms = new Map();
  const roomList = [];

  for (const r of data.rooms) {
    if (rooms.has(r.id)) problems.push(`Duplicate room id "${r.id}"`);
    const [cx, cz] = r.center;
    const [w, d] = r.size;
    const room = {
      id: r.id,
      name: r.name,
      isExit: !!r.isExit,
      dark: !!r.dark,          // enterable, but cannot be searched without a Flashlight
      searchable: !!r.searchable, // only certain rooms can be searched at all (not corridors)
      center: [cx, cz],
      size: [w, d],
      min: [cx - w / 2, cz - d / 2],
      max: [cx + w / 2, cz + d / 2],
      mood: r.mood || { color: '#ffffff', intensity: 1, ambient: 0.6 },
      furniture: (r.furniture || []).map((f, i) => {
        const [fx, fz] = f.pos;
        const [fw, fh, fd] = f.size;
        return {
          id: `${r.id}:${f.kind || 'block'}:${i}`,
          kind: f.kind || 'block',
          color: f.color,
          emissive: f.emissive,
          // Presentation hints passed straight through for the room-dressing layer (which glTF
          // model to draw for this footprint, its rotation, and any props on top). The game
          // logic ignores them — collision only uses center/size below.
          model: f.model,
          yaw: f.yaw,
          props: f.props,
          center: [cx + fx, cz + fz],
          size: [fw, fh, fd],
          min: [cx + fx - fw / 2, cz + fz - fd / 2],
          max: [cx + fx + fw / 2, cz + fz + fd / 2],
        };
      }),
      doorways: [],
      openings: { north: [], south: [], east: [], west: [] },
      walls: [],
      neighbours: new Set(),
    };
    rooms.set(r.id, room);
    roomList.push(room);
  }

  // Rooms must not overlap (touching is fine).
  for (let i = 0; i < roomList.length; i++) {
    for (let j = i + 1; j < roomList.length; j++) {
      const a = roomList[i], b = roomList[j];
      const overlapX = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
      const overlapZ = Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]);
      if (overlapX > EPS && overlapZ > EPS) problems.push(`Rooms "${a.id}" and "${b.id}" overlap`);
    }
  }

  // Resolve doorways. Each is declared once; the other room gets the matching opening.
  const doorways = [];
  for (const r of data.rooms) {
    const a = rooms.get(r.id);
    for (const dw of r.doorways || []) {
      const b = rooms.get(dw.to);
      if (!b) { problems.push(`Room "${a.id}" has a doorway to unknown room "${dw.to}"`); continue; }
      const side = dw.wall;
      if (!SIDES[side]) { problems.push(`Room "${a.id}" doorway has unknown wall "${side}"`); continue; }
      const width = dw.width ?? cfg.doorways.defaultWidth;
      const half = width / 2;
      let center, axis, wallCoord;

      if (side === 'north' || side === 'south') {
        wallCoord = side === 'north' ? a.min[1] : a.max[1];
        const bCoord = side === 'north' ? b.max[1] : b.min[1];
        if (Math.abs(wallCoord - bCoord) > EPS) {
          problems.push(`Doorway ${a.id}→${b.id}: "${b.id}" does not touch the ${side} wall of "${a.id}"`);
          continue;
        }
        const x = a.center[0] + (dw.at || 0);
        const lo = Math.max(a.min[0], b.min[0]) + t, hi = Math.min(a.max[0], b.max[0]) - t;
        if (x - half < lo - EPS || x + half > hi + EPS) {
          problems.push(`Doorway ${a.id}→${b.id} does not fit within both rooms' ${side} wall`);
          continue;
        }
        center = [x, wallCoord];
        axis = 'x';
      } else {
        wallCoord = side === 'east' ? a.max[0] : a.min[0];
        const bCoord = side === 'east' ? b.min[0] : b.max[0];
        if (Math.abs(wallCoord - bCoord) > EPS) {
          problems.push(`Doorway ${a.id}→${b.id}: "${b.id}" does not touch the ${side} wall of "${a.id}"`);
          continue;
        }
        const z = a.center[1] + (dw.at || 0);
        const lo = Math.max(a.min[1], b.min[1]) + t, hi = Math.min(a.max[1], b.max[1]) - t;
        if (z - half < lo - EPS || z + half > hi + EPS) {
          problems.push(`Doorway ${a.id}→${b.id} does not fit within both rooms' ${side} wall`);
          continue;
        }
        center = [wallCoord, z];
        axis = 'z';
      }

      const doorway = {
        id: `${a.id}->${b.id}`,
        a: a.id,
        b: b.id,
        sideA: side,
        sideB: OPPOSITE[side],
        center,
        axis,          // direction the opening runs along ('x' = opening in a north/south wall)
        width,
        // The opening cut through both rooms' walls.
        opening: axis === 'x'
          ? { min: [center[0] - half, center[1] - t], max: [center[0] + half, center[1] + t] }
          : { min: [center[0] - t, center[1] - half], max: [center[0] + t, center[1] + half] },
        otherRoom(id) { return id === this.a ? this.b : this.a; },
        sideFor(id) { return id === this.a ? this.sideA : this.sideB; },
      };
      doorways.push(doorway);
      a.doorways.push(doorway);
      b.doorways.push(doorway);
      a.neighbours.add(b.id);
      b.neighbours.add(a.id);
      const interval = axis === 'x' ? [center[0] - half, center[0] + half] : [center[1] - half, center[1] + half];
      a.openings[side].push(interval);
      b.openings[OPPOSITE[side]].push(interval);
    }
  }

  // Wall segments: each side's strip minus its openings, also split wherever the room on
  // the other side changes so every segment knows its single neighbour (or none). Side
  // walls are shortened by the wall thickness at both ends so corner boxes don't overlap.
  const walls = [];
  for (const room of roomList) {
    for (const side of Object.keys(SIDES)) {
      const { normal, axis } = SIDES[side];
      const extent = axis === 'x' ? [room.min[0], room.max[0]] : [room.min[1] + t, room.max[1] - t];
      const wallCoord = side === 'north' ? room.min[1] : side === 'south' ? room.max[1] : side === 'east' ? room.max[0] : room.min[0];
      // Rooms touching this wall from the outside.
      const touching = roomList.filter(o => {
        if (o === room) return false;
        const oCoord = side === 'north' ? o.max[1] : side === 'south' ? o.min[1] : side === 'east' ? o.min[0] : o.max[0];
        if (Math.abs(oCoord - wallCoord) > EPS) return false;
        const [lo, hi] = axis === 'x' ? [o.min[0], o.max[0]] : [o.min[1], o.max[1]];
        return hi > extent[0] + EPS && lo < extent[1] - EPS;
      });
      const cuts = new Set([extent[0], extent[1]]);
      for (const [o0, o1] of room.openings[side]) { cuts.add(o0); cuts.add(o1); }
      for (const o of touching) {
        const [lo, hi] = axis === 'x' ? [o.min[0], o.max[0]] : [o.min[1], o.max[1]];
        if (lo > extent[0] + EPS && lo < extent[1] - EPS) cuts.add(lo);
        if (hi > extent[0] + EPS && hi < extent[1] - EPS) cuts.add(hi);
      }
      const points = [...cuts].sort((p, q) => p - q);
      for (let i = 0; i < points.length - 1; i++) {
        const s0 = points[i], s1 = points[i + 1];
        if (s1 - s0 < EPS) continue;
        const mid = (s0 + s1) / 2;
        if (room.openings[side].some(([o0, o1]) => mid > o0 && mid < o1)) continue; // it's a doorway
        const neighbour = touching.find(o => {
          const [lo, hi] = axis === 'x' ? [o.min[0], o.max[0]] : [o.min[1], o.max[1]];
          return mid > lo && mid < hi;
        });
        let min, max;
        if (side === 'north') { min = [s0, room.min[1]]; max = [s1, room.min[1] + t]; }
        else if (side === 'south') { min = [s0, room.max[1] - t]; max = [s1, room.max[1]]; }
        else if (side === 'east') { min = [room.max[0] - t, s0]; max = [room.max[0], s1]; }
        else { min = [room.min[0], s0]; max = [room.min[0] + t, s1]; }
        const wall = {
          id: `${room.id}:${side}:${walls.length}`,
          room: room.id,
          neighbour: neighbour ? neighbour.id : null,
          side,
          normal,
          min,
          max,
          center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
          size: [max[0] - min[0], max[1] - min[1]],
        };
        walls.push(wall);
        room.walls.push(wall);
      }
    }
  }

  // Bounds, start, exit, connectivity.
  const bounds = {
    min: [Math.min(...roomList.map(r => r.min[0])), Math.min(...roomList.map(r => r.min[1]))],
    max: [Math.max(...roomList.map(r => r.max[0])), Math.max(...roomList.map(r => r.max[1]))],
  };

  // Start room and the spots (room-relative) where the players stand at the beginning.
  const startRoom = rooms.get(data.start?.room);
  if (!startRoom) problems.push(`Start room "${data.start?.room}" not found`);
  const base = startRoom || roomList[0];
  const rel = data.start?.positions?.length ? data.start.positions : [data.start?.pos || [0, 0]];
  const positions = base ? rel.map(p => [base.center[0] + p[0], base.center[1] + p[1]]) : [[0, 0]];
  const start = { room: base?.id, pos: positions[0], positions };

  const exits = roomList.filter(r => r.isExit);
  if (exits.length === 0) problems.push('No room is marked isExit: true');

  if (startRoom) {
    const seen = new Set([startRoom.id]);
    const queue = [startRoom.id];
    while (queue.length) {
      const id = queue.shift();
      for (const n of rooms.get(id).neighbours) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    for (const r of roomList) if (!seen.has(r.id)) problems.push(`Room "${r.id}" cannot be reached from the start room`);
  }

  return {
    id: data.id,
    name: data.name,
    rules: { moveWithinRoomCost: 0, enterRoomCost: 1, actionPointsPerTurn: 5, ...(data.rules || {}) },
    rooms,
    roomList,
    doorways,
    walls,
    bounds,
    start,
    exitRoom: exits[0]?.id ?? null,
    problems,
  };
}

// Which room contains the point? Rooms touch but never overlap; a point exactly on a shared
// boundary belongs to whichever room lists it first with min <= p < max.
export function roomAt(floor, x, z) {
  for (const r of floor.roomList) {
    if (x >= r.min[0] && x < r.max[0] && z >= r.min[1] && z < r.max[1]) return r.id;
  }
  return null;
}
