// An optional performance readout for measuring on the real device: add ?stats=1 to the address.
// Shows frames per second (averaged over a second), the slowest frame in that second, draw calls
// and triangles for the last frame. Off by default; costs nothing when off.
export function createPerfStats(doc, renderer, enabled) {
  if (!enabled) return { frame() {} };
  const el = doc.createElement('div');
  el.className = 'perf-stats';
  doc.body.appendChild(el);
  let frames = 0, elapsed = 0, worst = 0;
  return {
    // `ms` is the real (unclamped) time since the previous frame.
    frame(ms) {
      frames++;
      elapsed += ms;
      worst = Math.max(worst, ms);
      if (elapsed < 1000) return;
      const info = renderer.info.render;
      el.textContent = `${Math.round((frames * 1000) / elapsed)} fps · worst ${Math.round(worst)} ms · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris`;
      frames = 0; elapsed = 0; worst = 0;
    },
  };
}
