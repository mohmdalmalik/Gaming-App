// Small HTML tags over the 3D view — "Explore · 1 AP" over a fogged room, "Go · 1 AP" over a room next
// door, the guests' names when zoomed far out — and the interface they must keep clear of.
//
// Every tag lives in one layer inside the view, BELOW the interface (styles.css: #view is its own
// stacking context under #hud), never takes a tap (pointer-events: none: a tap lands on the room or fog
// under it), stays whole inside the screen, and is hidden for as long as it would overlap any part of
// the interface (the guest strip, the room name and round, the panel, the hand, the buttons, the
// Move/Cancel bar, a toast, the search icon, the path tag) or a more important tag placed before it in
// the same frame (a tag that would clash with another tag first tries one tag-height higher, then lower). Cheap: positions are written only when they change, sizes are measured only when a
// tag's words change, the interface's boxes are re-read every few frames, and the view's size is
// cached until it is resized.

// The parts of the interface a tag must never cover (whichever are showing).
export const INTERFACE = ['.hud-top-left', '.hud-top-center', '.hud-top-right', '#player-panel', '#hand-fan .fan-card',
  '#hand-fan .fan-limit', '.hud-bottom-right', '#confirm-bar', '#toast', '#search-spot', '.path-label'];

const shown = el => !!el && !el.hidden && !el.closest('[hidden]') && el.getClientRects().length > 0
  && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none';

// The boxes of the visible interface, relative to `container`, each grown by `pad` px.
export function interfaceRects(doc, container, selectors = INTERFACE, pad = 0) {
  const out = [];
  const cr = container.getBoundingClientRect();
  for (const sel of selectors) {
    for (const e of doc.querySelectorAll(sel)) {
      if (!shown(e)) continue;
      const r = e.getBoundingClientRect();
      if (r.width && r.height) out.push({ l: r.left - cr.left - pad, r: r.right - cr.left + pad, t: r.top - cr.top - pad, b: r.bottom - cr.top + pad });
    }
  }
  return out;
}

const hit = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

export function createScreenTags(doc, container, camera) {
  const layer = doc.createElement('div');
  layer.className = 'tag-layer';
  container.appendChild(layer);
  let W = container.clientWidth, H = container.clientHeight;
  const resize = () => { W = container.clientWidth; H = container.clientHeight; frameNo = 0; };
  window.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);

  const tags = new Map();      // key -> { el, html, cls, w, h, x, y, used }
  let ui = [];                 // the interface's boxes (grown by a margin)
  let placed = [];             // tags already placed this frame
  let frameNo = 0;
  let v = null;

  return {
    // Start a frame: forget last frame's placements; every few frames re-read the interface.
    begin() {
      if (frameNo++ % 4 === 0) ui = interfaceRects(doc, container, INTERFACE, 6);
      placed = [];
      for (const t of tags.values()) t.used = false;
    },
    // Place tag `key` over the world point p ([x, y, z]); `anchor` 'center' (centred on the point) or
    // 'above' (its foot on the point). Earlier calls win a clash, so place the important ones first.
    // Returns true if it is showing.
    put(key, p, html, cls, anchor = 'center') {
      v ||= camera.position.clone();
      v.set(p[0], p[1], p[2]).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3) return false;
      let t = tags.get(key);
      if (!t) {
        const el = doc.createElement('div');
        el.hidden = true;
        layer.appendChild(el);
        t = { el, html: null, cls: null, w: 0, h: 0, x: NaN, y: NaN, used: false };
        tags.set(key, t);
      }
      t.used = true;
      if (t.cls !== cls) { t.cls = cls; t.el.className = cls; t.html = null; }
      if (t.html !== html) {
        t.html = html; t.el.innerHTML = html;
        const was = t.el.hidden; t.el.hidden = false;
        t.w = t.el.offsetWidth; t.h = t.el.offsetHeight;
        t.el.hidden = was;
      }
      const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
      // whole inside the screen
      const l = Math.min(Math.max(px - t.w / 2, 6), W - 6 - t.w);
      const top0 = anchor === 'above' ? py - t.h : py - t.h / 2, step = t.h + 6;
      // never over the interface, nor over a tag already placed: where it would clash with a tag, it
      // may sit one tag-height higher or lower instead (still by its point); otherwise it is left out
      let box = null;
      for (const dy of [0, -step, step]) {
        const top = Math.min(Math.max(top0 + dy, 6), H - 6 - t.h);
        const b = { l, r: l + t.w, t: top, b: top + t.h };
        if (ui.some(q => hit(b, q))) { if (dy === 0) break; continue; }
        if (!placed.some(q => hit(b, q))) { box = b; break; }
      }
      if (!box) { if (!t.el.hidden) t.el.hidden = true; return false; }
      const top = box.t;
      placed.push({ l: box.l - 4, r: box.r + 4, t: box.t - 4, b: box.b + 4 });
      const x = Math.round(l), y = Math.round(top);
      if (x !== t.x || y !== t.y) { t.x = x; t.y = y; t.el.style.transform = `translate3d(${x}px, ${y}px, 0)`; }
      if (t.el.hidden) t.el.hidden = false;
      return true;
    },
    // End the frame: tags not placed this frame are hidden.
    end() {
      for (const t of tags.values()) if (!t.used && !t.el.hidden) t.el.hidden = true;
    },
    // Tests: the tags showing now, with their boxes (relative to the view).
    list(prefix = '') {
      return [...tags.entries()].filter(([k, t]) => k.startsWith(prefix) && !t.el.hidden)
        .map(([k, t]) => ({ key: k, text: t.el.textContent, cls: t.cls, l: t.x, t: t.y, r: t.x + t.w, b: t.y + t.h }));
    },
  };
}
