// Walkable grid + A* pathfinding over the floor. Pure logic, no rendering.
//
// Cells are walkable when their centre is inside a room (keeping clear of the walls) or
// inside a doorway opening, and not inside a piece of furniture. Every cell remembers
// which room owns it so a path can be charged per doorway crossed.

const DIAG = Math.SQRT2;

export function buildGrid(floor, cfg) {
  const cell = cfg.grid.cell;
  const clearance = cfg.player.clearance;
  const t = cfg.walls.thickness;
  const pad = cell * 2;
  const originX = floor.bounds.min[0] - pad;
  const originZ = floor.bounds.min[1] - pad;
  const cols = Math.ceil((floor.bounds.max[0] - floor.bounds.min[0] + pad * 2) / cell);
  const rows = Math.ceil((floor.bounds.max[1] - floor.bounds.min[1] + pad * 2) / cell);
  const count = cols * rows;
  const walkable = new Uint8Array(count);
  const room = new Int16Array(count).fill(-1);
  const roomIndex = new Map(floor.roomList.map((r, i) => [r.id, i]));

  // Doorway zones: the opening through both walls, widened into each room by the clearance
  // so the walkable interior connects to it, and narrowed sideways so the player keeps
  // clear of the door jambs.
  const zones = floor.doorways.map(d => {
    const half = Math.max(d.width / 2 - clearance, cell * 0.5);
    const reach = t + clearance;
    return d.axis === 'x'
      ? { min: [d.center[0] - half, d.center[1] - reach], max: [d.center[0] + half, d.center[1] + reach] }
      : { min: [d.center[0] - reach, d.center[1] - half], max: [d.center[0] + reach, d.center[1] + half] };
  });

  const inRect = (r, x, z) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const idx = j * cols + i;
      const x = originX + (i + 0.5) * cell;
      const z = originZ + (j + 0.5) * cell;
      let owner = -1;
      for (let k = 0; k < floor.roomList.length; k++) {
        const r = floor.roomList[k];
        if (x >= r.min[0] && x < r.max[0] && z >= r.min[1] && z < r.max[1]) { owner = k; break; }
      }
      if (owner < 0) continue;
      room[idx] = owner;
      const r = floor.roomList[owner];
      const inset = t + clearance;
      let ok = x >= r.min[0] + inset && x <= r.max[0] - inset && z >= r.min[1] + inset && z <= r.max[1] - inset;
      if (!ok) for (const zone of zones) if (inRect(zone, x, z)) { ok = true; break; }
      if (ok) {
        for (const f of r.furniture) {
          if (x >= f.min[0] - clearance && x <= f.max[0] + clearance && z >= f.min[1] - clearance && z <= f.max[1] + clearance) { ok = false; break; }
        }
      }
      walkable[idx] = ok ? 1 : 0;
    }
  }

  const grid = {
    cell, cols, rows, originX, originZ, walkable, room,
    roomList: floor.roomList,
    landings: new Map(),
    index(i, j) { return j * cols + i; },
    cellAt(x, z) {
      const i = Math.floor((x - originX) / cell), j = Math.floor((z - originZ) / cell);
      if (i < 0 || j < 0 || i >= cols || j >= rows) return -1;
      return j * cols + i;
    },
    center(idx) {
      const i = idx % cols, j = (idx - i) / cols;
      return [originX + (i + 0.5) * cell, originZ + (j + 0.5) * cell];
    },
    roomIdOf(idx) { const k = room[idx]; return k >= 0 ? floor.roomList[k].id : null; },
  };

  // Landing cells: the walkable cells just inside each side of a doorway. When only one
  // side of the doorway is discovered, the other side's landing is where the player may
  // step to reveal the room.
  for (let n = 0; n < floor.doorways.length; n++) {
    const d = floor.doorways[n];
    const depth = t + clearance + cfg.grid.landingDepth;
    const half = d.width / 2 + clearance;
    const perSide = {};
    for (const roomId of [d.a, d.b]) {
      const r = floor.rooms.get(roomId);
      const side = d.sideFor(roomId);
      let rect;
      if (side === 'north') rect = { min: [d.center[0] - half, d.center[1]], max: [d.center[0] + half, d.center[1] + depth] };
      else if (side === 'south') rect = { min: [d.center[0] - half, d.center[1] - depth], max: [d.center[0] + half, d.center[1]] };
      else if (side === 'east') rect = { min: [d.center[0] - depth, d.center[1] - half], max: [d.center[0], d.center[1] + half] };
      else rect = { min: [d.center[0], d.center[1] - half], max: [d.center[0] + depth, d.center[1] + half] };
      const cells = [];
      const i0 = Math.max(0, Math.floor((rect.min[0] - originX) / cell)), i1 = Math.min(cols - 1, Math.floor((rect.max[0] - originX) / cell));
      const j0 = Math.max(0, Math.floor((rect.min[1] - originZ) / cell)), j1 = Math.min(rows - 1, Math.floor((rect.max[1] - originZ) / cell));
      const k = roomIndex.get(r.id);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = j * cols + i;
        if (walkable[idx] && room[idx] === k) cells.push(idx);
      }
      perSide[roomId] = cells;
      if (cells.length === 0) floor.problems.push(`Doorway ${d.id} has no walkable landing inside "${roomId}" (blocked by furniture?)`);
    }
    grid.landings.set(d.id, perSide);
  }

  // Sanity: every room should be reachable on foot from the start.
  const startIdx = nearestWalkable(grid, floor.start.pos[0], floor.start.pos[1], 2, () => true);
  if (startIdx < 0) floor.problems.push('Start position is not on walkable floor');
  else {
    const reached = new Set();
    const seen = new Uint8Array(count);
    const stack = [startIdx];
    seen[startIdx] = 1;
    while (stack.length) {
      const idx = stack.pop();
      reached.add(room[idx]);
      for (const n of neighbours(grid, idx)) if (!seen[n]) { seen[n] = 1; stack.push(n); }
    }
    for (let k = 0; k < floor.roomList.length; k++) {
      if (!reached.has(k)) floor.problems.push(`Room "${floor.roomList[k].id}" is not reachable on foot from the start`);
    }
  }

  return grid;
}

function neighbours(grid, idx) {
  const { cols, rows, walkable } = grid;
  const i = idx % cols, j = (idx - i) / cols;
  const out = [];
  const can = (di, dj) => {
    const ni = i + di, nj = j + dj;
    return ni >= 0 && nj >= 0 && ni < cols && nj < rows && walkable[nj * cols + ni] === 1;
  };
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    if (!di && !dj) continue;
    if (!can(di, dj)) continue;
    // No cutting corners: a diagonal step needs both orthogonal neighbours free.
    if (di && dj && !(can(di, 0) && can(0, dj))) continue;
    out.push((j + dj) * cols + i + di);
  }
  return out;
}

// Small binary heap keyed on f-score.
class Heap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const a = this.items; a.push(item);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.items; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// A* from cell to cell. `allowed(idx)` gates which walkable cells may be used (discovery).
export function findPath(grid, from, to, allowed = () => true) {
  if (from < 0 || to < 0 || !grid.walkable[from] || !grid.walkable[to] || !allowed(to)) return null;
  if (from === to) return [from];
  const { cols } = grid;
  const g = new Map([[from, 0]]);
  const came = new Map();
  const closed = new Set();
  const h = idx => {
    const di = Math.abs((idx % cols) - (to % cols));
    const dj = Math.abs(Math.floor(idx / cols) - Math.floor(to / cols));
    return Math.max(di, dj) + (DIAG - 1) * Math.min(di, dj);
  };
  const open = new Heap();
  open.push({ idx: from, f: h(from) });
  while (open.size) {
    const { idx } = open.pop();
    if (closed.has(idx)) continue;
    if (idx === to) {
      const path = [to];
      let cur = to;
      while (came.has(cur)) { cur = came.get(cur); path.push(cur); }
      return path.reverse();
    }
    closed.add(idx);
    const gi = g.get(idx);
    for (const n of neighbours(grid, idx)) {
      if (closed.has(n) || !allowed(n)) continue;
      const step = (n % cols !== idx % cols && Math.floor(n / cols) !== Math.floor(idx / cols)) ? DIAG : 1;
      const gn = gi + step;
      if (gn < (g.get(n) ?? Infinity)) {
        g.set(n, gn);
        came.set(n, idx);
        open.push({ idx: n, f: gn + h(n) });
      }
    }
  }
  return null;
}

// Straight-line check used to smooth paths. Samples along the segment and also a little to
// each side so the smoothed line keeps some clearance from corners.
export function lineIsClear(grid, x0, z0, x1, z1, allowed = () => true, sideOffset = 0) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return true;
  const steps = Math.ceil(len / (grid.cell * 0.5));
  const px = -dz / len * sideOffset, pz = dx / len * sideOffset;
  const offsets = sideOffset > 0 ? [[0, 0], [px, pz], [-px, -pz]] : [[0, 0]];
  for (let s = 0; s <= steps; s++) {
    const u = s / steps;
    const x = x0 + dx * u, z = z0 + dz * u;
    for (const [ox, oz] of offsets) {
      const idx = grid.cellAt(x + ox, z + oz);
      if (idx < 0 || !grid.walkable[idx] || !allowed(idx)) return false;
    }
  }
  return true;
}

// Turns a cell path into as few waypoints as possible (string pulling).
export function smoothPath(grid, cells, allowed = () => true, sideOffset = 0) {
  if (!cells || cells.length === 0) return [];
  const pts = cells.map(idx => grid.center(idx));
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !lineIsClear(grid, pts[i][0], pts[i][1], pts[j][0], pts[j][1], allowed, sideOffset)) j--;
    out.push(pts[j]);
    i = j;
  }
  return out;
}

// The rooms a cell path passes through, in order, without consecutive repeats.
export function roomSequence(grid, cells) {
  const seq = [];
  for (const idx of cells) {
    const id = grid.roomIdOf(idx);
    if (id && seq[seq.length - 1] !== id) seq.push(id);
  }
  return seq;
}

// Nearest walkable + allowed cell to a point, searching within `radius` metres.
export function nearestWalkable(grid, x, z, radius, allowed = () => true) {
  const { cell, cols, rows, originX, originZ, walkable } = grid;
  const r = Math.ceil(radius / cell);
  const ci = Math.floor((x - originX) / cell), cj = Math.floor((z - originZ) / cell);
  let best = -1, bestD = Infinity;
  for (let j = cj - r; j <= cj + r; j++) {
    if (j < 0 || j >= rows) continue;
    for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || i >= cols) continue;
      const idx = j * cols + i;
      if (!walkable[idx] || !allowed(idx)) continue;
      const cx = originX + (i + 0.5) * cell, cz = originZ + (j + 0.5) * cell;
      const d = (cx - x) ** 2 + (cz - z) ** 2;
      if (d < bestD && d <= radius * radius) { bestD = d; best = idx; }
    }
  }
  return best;
}
