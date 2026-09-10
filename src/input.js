// Touch + mouse input for the 3D view. Emits high-level gestures:
//   onTap(x, y)                   one finger / left click, without dragging
//   onPinch(factor)               two fingers apart (>1) or together (<1); also trackpad pinch
//   onDrag(fromX, fromY, toX, toY) two-finger drag or right/middle mouse drag (screen px)
//   onWheel(deltaY)               mouse wheel (pixels, normalised)
//   onGestureEnd()                all fingers / buttons released
// Uses Pointer Events, which cover touch and mouse on iPad Safari and desktop browsers.

export function createInput(element, handlers, opts = {}) {
  const tapMaxMove = opts.tapMaxMove ?? 10;
  const tapMaxTime = opts.tapMaxTime ?? 450;
  const multiCooldown = opts.multiCooldown ?? 250;
  const pointers = new Map();
  let tapCandidate = null;
  let becameMulti = false;
  let lastMultiEnd = -Infinity;
  let pinch = null;
  let enabled = true;
  let gestureScale = 1;

  const prevent = e => { if (e.cancelable) e.preventDefault(); };

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  function onDown(e) {
    prevent(e);
    if (!enabled) return;
    if (pointers.size >= 2) return; // third finger / palm: ignore
    try { element.setPointerCapture(e.pointerId); } catch (_) { /* not all browsers */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), type: e.pointerType });
    if (pointers.size === 1) {
      tapCandidate = e.button === 0 && performance.now() - lastMultiEnd > multiCooldown ? e.pointerId : null;
      becameMulti = false;
    } else {
      tapCandidate = null;
      becameMulti = true;
      pinch = pinchState();
    }
  }

  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    prevent(e);
    const fromX = p.x, fromY = p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (tapCandidate === e.pointerId && Math.hypot(p.x - p.sx, p.y - p.sy) > tapMaxMove) tapCandidate = null;

    if (pointers.size === 2 && pinch) {
      const now = pinchState();
      if (pinch.dist > 0 && now.dist > 0) handlers.onPinch?.(now.dist / pinch.dist);
      handlers.onDrag?.(pinch.mx, pinch.my, now.mx, now.my);
      pinch = now;
    } else if (pointers.size === 1 && p.type === 'mouse' && (e.buttons & 6)) {
      handlers.onDrag?.(fromX, fromY, p.x, p.y); // right / middle mouse drag pans
    }
  }

  function release(e, allowTap) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    prevent(e);
    const isTap = allowTap && tapCandidate === e.pointerId && !becameMulti && pointers.size === 1 && performance.now() - p.t <= tapMaxTime;
    pointers.delete(e.pointerId);
    try { element.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    if (pinch) { pinch = null; lastMultiEnd = performance.now(); }
    if (pointers.size === 0) {
      tapCandidate = null;
      if (becameMulti) lastMultiEnd = performance.now();
      becameMulti = false;
      handlers.onGestureEnd?.();
    }
    if (isTap && enabled) handlers.onTap?.(p.x, p.y);
  }

  function onWheel(e) {
    prevent(e);
    if (!enabled) return;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    // ctrlKey + wheel is how Chrome/Firefox report a trackpad pinch.
    if (e.ctrlKey) handlers.onPinch?.(Math.exp(-dy * 0.01));
    else handlers.onWheel?.(dy);
  }

  // Safari (desktop trackpad) reports pinches as gesture events. On iPad these fire alongside
  // pointer events, so only use them when no touch pointers are down.
  function onGestureStart(e) { prevent(e); gestureScale = 1; }
  function onGestureChange(e) {
    prevent(e);
    if (!enabled || pointers.size > 0) return;
    if (e.scale > 0) handlers.onPinch?.(e.scale / gestureScale);
    gestureScale = e.scale;
  }

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', e => release(e, true));
  element.addEventListener('pointercancel', e => release(e, false));
  element.addEventListener('lostpointercapture', e => release(e, false));
  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('contextmenu', prevent);
  element.addEventListener('dblclick', prevent);
  element.addEventListener('gesturestart', onGestureStart, { passive: false });
  element.addEventListener('gesturechange', onGestureChange, { passive: false });
  element.addEventListener('gestureend', prevent, { passive: false });

  // Belt and braces for iOS Safari: a pinch whose second finger lands on the HUD must not
  // zoom the page. touch-action in CSS covers most cases; these listeners cover the rest.
  document.addEventListener('touchmove', e => {
    if (e.touches.length > 1 || !(e.target.closest && e.target.closest('button'))) prevent(e);
  }, { passive: false });
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(type, prevent, { passive: false });
  document.getElementById('app')?.addEventListener('contextmenu', prevent);

  return {
    setEnabled(v) { enabled = v; if (!v) { pointers.clear(); tapCandidate = null; pinch = null; becameMulti = false; } },
    get pointerCount() { return pointers.size; },
  };
}
