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

    // A quiet charcoal ground for the plan, with a faint 1 m drafting grid.
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

    ctx.save();
    ctx.strokeStyle = 'rgba(201,162,78,0.07)'; ctx.lineWidth = 1;
    for (let gx = Math.floor(minX); gx <= maxX; gx++) { ctx.beginPath(); ctx.moveTo(X(gx), 0); ctx.lineTo(X(gx), ch); ctx.stroke(); }
    for (let gz = Math.floor(minZ); gz <= maxZ; gz++) { ctx.beginPath(); ctx.moveTo(0, Z(gz)); ctx.lineTo(cw, Z(gz)); ctx.stroke(); }
    ctx.restore();

    // Compass: north is "up" on the plan (world -z).
    ctx.save();
    ctx.translate(cw - 34, 34);
    ctx.strokeStyle = 'rgba(201,162,78,0.55)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = BRASS_BRIGHT;
    ctx.beginPath(); ctx.moveTo(0, -13); ctx.lineTo(5, 4); ctx.lineTo(0, 1); ctx.lineTo(-5, 4); ctx.closePath(); ctx.fill();
    ctx.font = `bold 10px ${serif}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', 0, -23);
    ctx.restore();

    // Rooms: wood-toned plates with a brass edge; the active room glows brass, searched rooms
    // carry a green tick, the exit reads in green. Labels sit in the upper part of the plate so
    // the position marker (drawn at the true position, often the room centre) never covers them.
    const activeRoom = activePlayer(state).currentRoom;
    for (const r of rooms) {
      const x = X(r.min[0]), z = Z(r.min[1]), w = r.size[0] * scale, h = r.size[1] * scale;
      const here = r.id === activeRoom, searched = state.searchedRooms.has(r.id);
      const grad = ctx.createLinearGradient(x, z, x, z + h);
      if (here) { grad.addColorStop(0, 'rgba(201,162,78,0.30)'); grad.addColorStop(1, 'rgba(201,162,78,0.16)'); }
      else if (r.isExit) { grad.addColorStop(0, 'rgba(120,200,150,0.22)'); grad.addColorStop(1, 'rgba(120,200,150,0.12)'); }
      else { grad.addColorStop(0, 'rgba(120,88,52,0.42)'); grad.addColorStop(1, 'rgba(90,64,38,0.34)'); }
      ctx.fillStyle = grad;
      roundRect(ctx, x + 2, z + 2, w - 4, h - 4, Math.min(8, scale * 0.2)); ctx.fill();
      ctx.lineWidth = here ? 3 : 1.4;
      ctx.strokeStyle = here ? BRASS_BRIGHT : r.isExit ? 'rgba(120,200,150,0.75)' : 'rgba(201,162,78,0.5)';
      ctx.stroke();
      // inner hairline for the "framed plate" look
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      roundRect(ctx, x + 5, z + 5, w - 10, h - 10, Math.min(6, scale * 0.15)); ctx.stroke();

      ctx.fillStyle = here ? IVORY : 'rgba(239,231,214,0.86)';
      const fs = Math.max(11, Math.min(15, scale * 0.5));
      ctx.font = `${here ? 'bold ' : ''}${fs}px ${serif}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const label = r.isExit ? `${r.name} · EXIT` : r.name;
      const labelY = h > 70 ? z + 14 + fs : Z(r.center[1]);
      wrapText(ctx, label, X(r.center[0]), labelY, w - 14, fs + 3);

      if (searched) {                          // a small green tick in the corner
        ctx.fillStyle = 'rgba(120,200,150,0.9)'; ctx.font = `12px ${serif}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        ctx.fillText('✓', x + w - 8, z + 7);
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
