// 2D map overlay: discovered rooms, their doorways/connections and the player's position.

import { activePlayer } from './game/state.js';

export function createMap(doc, floor, cfg) {
  const overlay = doc.getElementById('map-overlay');
  const canvas = doc.getElementById('map-canvas');
  const closeBtn = doc.getElementById('btn-map-close');
  const ctx = canvas.getContext('2d');
  let open = false;
  let last = null;

  function draw(state, movers) {
    last = { state, movers };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (cw === 0 || ch === 0) return;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    // A quiet charcoal ground for the plan.
    ctx.fillStyle = '#0e1017'; ctx.fillRect(0, 0, cw, ch);

    const rooms = floor.roomList.filter(r => state.discovered.has(r.id));
    if (!rooms.length) return;
    const margin = 1.5;
    const minX = Math.min(...rooms.map(r => r.min[0])) - margin, maxX = Math.max(...rooms.map(r => r.max[0])) + margin;
    const minZ = Math.min(...rooms.map(r => r.min[1])) - margin, maxZ = Math.max(...rooms.map(r => r.max[1])) + margin;
    const pad = 26;
    const scale = Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxZ - minZ));
    const ox = (cw - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (ch - (maxZ - minZ) * scale) / 2 - minZ * scale;
    const X = x => ox + x * scale, Z = z => oz + z * scale;
    const serif = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';
    const BRASS = '#c9a24e', BRASS_BRIGHT = '#e8ca80', IVORY = '#efe7d6';

    // Rooms: ivory-washed cards with a brass edge; the active room glows brass, searched rooms
    // carry a small brass tick, the exit reads in green.
    const activeRoom = activePlayer(state).currentRoom;
    for (const r of rooms) {
      const x = X(r.min[0]), z = Z(r.min[1]), w = r.size[0] * scale, h = r.size[1] * scale;
      const here = r.id === activeRoom, searched = state.searchedRooms.has(r.id);
      ctx.fillStyle = here ? 'rgba(201,162,78,0.20)' : r.isExit ? 'rgba(120,200,150,0.16)' : 'rgba(239,231,214,0.08)';
      roundRect(ctx, x + 2, z + 2, w - 4, h - 4, Math.min(8, scale * 0.2)); ctx.fill();
      ctx.lineWidth = here ? 3 : 1.4;
      ctx.strokeStyle = here ? BRASS_BRIGHT : r.isExit ? 'rgba(120,200,150,0.7)' : 'rgba(201,162,78,0.45)';
      ctx.stroke();

      ctx.fillStyle = here ? IVORY : 'rgba(239,231,214,0.82)';
      ctx.font = `${here ? 'bold ' : ''}${Math.max(11, Math.min(15, scale * 0.5))}px ${serif}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = r.isExit ? `${r.name} · EXIT` : r.name;
      wrapText(ctx, label, X(r.center[0]), Z(r.center[1]), w - 10, 15);

      if (searched) {                          // a small brass tick in the corner
        ctx.fillStyle = 'rgba(120,200,150,0.9)'; ctx.font = `12px ${serif}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('✓', x + w - 6, z + 5);
      }
    }

    // Doorways: a gap between known rooms; a dashed brass mark with a "?" toward the unknown.
    for (const d of floor.doorways) {
      const aKnown = state.discovered.has(d.a), bKnown = state.discovered.has(d.b);
      if (!aKnown && !bKnown) continue;
      const frontier = aKnown !== bKnown;
      ctx.save();
      ctx.lineWidth = frontier ? 4 : 4;
      ctx.strokeStyle = frontier ? BRASS_BRIGHT : 'rgba(239,231,214,0.35)';
      ctx.setLineDash(frontier ? [4, 3] : []);
      ctx.beginPath();
      if (d.axis === 'x') { ctx.moveTo(X(d.center[0] - d.width / 2), Z(d.center[1])); ctx.lineTo(X(d.center[0] + d.width / 2), Z(d.center[1])); }
      else { ctx.moveTo(X(d.center[0]), Z(d.center[1] - d.width / 2)); ctx.lineTo(X(d.center[0]), Z(d.center[1] + d.width / 2)); }
      ctx.stroke();
      ctx.restore();
      if (frontier) {
        ctx.fillStyle = BRASS_BRIGHT;
        ctx.font = `bold 13px ${serif}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const side = aKnown ? d.sideB : d.sideA; // the unknown side
        const off = 0.9;
        const lx = d.center[0] + (side === 'east' ? -off : side === 'west' ? off : 0);
        const lz = d.center[1] + (side === 'south' ? -off : side === 'north' ? off : 0);
        ctx.fillText('?', X(lx), Z(lz));
      }
    }

    // Players: a dot per player in their colour; the active one gets a heading arrow.
    const active = activePlayer(state);
    for (const p of state.players) {
      const mover = movers[p.index];
      const px = X(mover.x), pz = Z(mover.z);
      const isActive = p === active;
      ctx.save();
      ctx.translate(px, pz);
      if (isActive) {
        ctx.rotate(-mover.heading + Math.PI); // heading 0 faces +z (south) in world = down on the map
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(0, -11); ctx.lineTo(7, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-7, 7); ctx.closePath();
        ctx.fill();
      } else {
        ctx.globalAlpha = !p.alive ? 0.4 : 1;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#1d1509'; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
    }
  }

  const api = {
    get isOpen() { return open; },
    open(state, movers) { open = true; overlay.hidden = false; requestAnimationFrame(() => draw(state, movers)); },
    close() { open = false; overlay.hidden = true; },
    toggle(state, movers) { open ? api.close() : api.open(state, movers); },
    redraw() { if (open && last) draw(last.state, last.movers); },
  };
  closeBtn.addEventListener('click', () => api.close());
  overlay.addEventListener('click', e => { if (e.target === overlay) api.close(); });
  window.addEventListener('resize', () => api.redraw());
  return api;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((l, i) => ctx.fillText(l, x, startY + i * lineHeight));
}
