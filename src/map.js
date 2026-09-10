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

    const rooms = floor.roomList.filter(r => state.discovered.has(r.id));
    if (!rooms.length) return;
    const margin = 1.5;
    const minX = Math.min(...rooms.map(r => r.min[0])) - margin, maxX = Math.max(...rooms.map(r => r.max[0])) + margin;
    const minZ = Math.min(...rooms.map(r => r.min[1])) - margin, maxZ = Math.max(...rooms.map(r => r.max[1])) + margin;
    const pad = 24;
    const scale = Math.min((cw - pad * 2) / (maxX - minX), (ch - pad * 2) / (maxZ - minZ));
    const ox = (cw - (maxX - minX) * scale) / 2 - minX * scale;
    const oz = (ch - (maxZ - minZ) * scale) / 2 - minZ * scale;
    const X = x => ox + x * scale, Z = z => oz + z * scale;

    // Rooms (the active player's room is highlighted)
    const activeRoom = activePlayer(state).currentRoom;
    for (const r of rooms) {
      const x = X(r.min[0]), z = Z(r.min[1]), w = r.size[0] * scale, h = r.size[1] * scale;
      ctx.fillStyle = tint(r.mood.color, r.id === activeRoom ? 0.42 : 0.22);
      ctx.fillRect(x, z, w, h);
      ctx.lineWidth = r.id === activeRoom ? 3 : 1.5;
      ctx.strokeStyle = r.id === activeRoom ? activePlayer(state).color : 'rgba(255,255,255,0.55)';
      ctx.strokeRect(x, z, w, h);
      ctx.fillStyle = '#f2eee6';
      ctx.font = `${Math.max(11, Math.min(15, scale * 0.5))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const label = r.isExit ? `${r.name} (EXIT)` : r.name;
      wrapText(ctx, label, X(r.center[0]), Z(r.center[1]), w - 8, 15);
    }

    // Doorways: a gap in the wall between known rooms, a glowing mark toward the unknown.
    for (const d of floor.doorways) {
      const aKnown = state.discovered.has(d.a), bKnown = state.discovered.has(d.b);
      if (!aKnown && !bKnown) continue;
      const frontier = aKnown !== bKnown;
      ctx.lineWidth = frontier ? 5 : 4;
      ctx.strokeStyle = frontier ? '#ffcc66' : '#8f8f98';
      ctx.beginPath();
      if (d.axis === 'x') { ctx.moveTo(X(d.center[0] - d.width / 2), Z(d.center[1])); ctx.lineTo(X(d.center[0] + d.width / 2), Z(d.center[1])); }
      else { ctx.moveTo(X(d.center[0]), Z(d.center[1] - d.width / 2)); ctx.lineTo(X(d.center[0]), Z(d.center[1] + d.width / 2)); }
      ctx.stroke();
      if (frontier) {
        ctx.fillStyle = '#ffcc66';
        ctx.font = 'bold 13px system-ui, sans-serif';
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

function tint(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
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
