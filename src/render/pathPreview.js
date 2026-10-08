// The chosen-move preview: a dotted path on the floor from the guest to where they will stand, a gold
// outline round the room they are about to walk to, and a small tag over their standing spot with
// what it costs ("Move · 2 AP"). Shown only while a move is waiting for confirmation; the rules never
// see it.
//
// The dots are ONE InstancedMesh (one draw call), the outline one mesh, and the tag a plain HTML label
// positioned over the canvas, so the preview costs next to nothing on the iPad. Dots that would lie
// under the Move/Cancel bar are left out (the bar would hide them anyway, and the path then reads as
// running behind it): `hideUnder` gives the bar's box on the canvas, or null.
const PAD = 10;   // px kept clear round the bar
import * as THREE from 'three';

const MAX_DOTS = 80;
const SPACING = 0.34;   // metres between dots

export function createPathPreview(scene, camera, canvas, container, hideUnder = () => null) {
  const dotGeo = new THREE.CircleGeometry(0.055, 12);
  dotGeo.rotateX(-Math.PI / 2);
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4cf6a'), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, MAX_DOTS);
  dots.count = 0;
  dots.renderOrder = 3;
  dots.frustumCulled = false;
  dots.visible = false;
  scene.add(dots);

  // The outline round the destination room: a thin square frame, built once per room size.
  const frames = new Map();
  const frameGeo = size => {
    if (frames.has(size)) return frames.get(size);
    const h = size / 2 - 0.3, w = 0.14, i = h - w;
    const shape = new THREE.Shape([new THREE.Vector2(-h, -h), new THREE.Vector2(h, -h), new THREE.Vector2(h, h), new THREE.Vector2(-h, h)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(-i, -i), new THREE.Vector2(-i, i), new THREE.Vector2(i, i), new THREE.Vector2(i, -i)]));
    const g = new THREE.ShapeGeometry(shape);
    g.rotateX(-Math.PI / 2);
    frames.set(size, g);
    return g;
  };
  const outline = new THREE.Mesh(frameGeo(8), dotMat);
  outline.renderOrder = 3;
  outline.visible = false;
  scene.add(outline);

  const label = document.createElement('div');
  label.className = 'path-label';
  label.hidden = true;
  container.appendChild(label);

  const m = new THREE.Matrix4();
  const anchor = new THREE.Vector3();
  const p = new THREE.Vector3();
  let shown = null;   // the plan currently drawn
  let laidFor = '';   // the camera and bar the dots were last laid out for

  function layDots(points) {
    const r = canvas.getBoundingClientRect(), bar = hideUnder();
    const under = (x, z) => {
      if (!bar) return false;
      p.set(x, 0.03, z).project(camera);
      const sx = r.left + (p.x + 1) / 2 * r.width, sy = r.top + (1 - p.y) / 2 * r.height;
      return sx > bar.left - PAD && sx < bar.right + PAD && sy > bar.top - PAD && sy < bar.bottom + PAD;
    };
    let n = 0, carry = SPACING * 0.6;   // the first dot sits a little ahead of the guest
    for (let i = 1; i < points.length && n < MAX_DOTS; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const len = Math.hypot(bx - ax, bz - az);
      let d = carry;
      while (d <= len && n < MAX_DOTS) {
        const t = d / len, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (!under(x, z)) { m.makeTranslation(x, 0.03, z); dots.setMatrixAt(n++, m); }
        d += SPACING;
      }
      carry = d - len;
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
  }
  // (a cheap fingerprint of the view and the bar: the dots are laid out again only when it changes)
  const viewKey = () => {
    const e = camera.matrixWorld.elements, b = hideUnder();
    return `${e[12].toFixed(2)},${e[13].toFixed(2)},${e[14].toFixed(2)},${e[0].toFixed(3)},${e[8].toFixed(3)}|${b ? `${b.left},${b.top},${b.right},${b.bottom}` : ''}`;
  };

  return {
    // `plan` is a confirmed-pending door move ({ waypoints, preview: { label, anchor: [x, z] } })
    // or null. Cheap to call every frame: it only rebuilds when the plan changes.
    update(plan, time) {
      if (plan !== shown) {
        shown = plan;
        dots.visible = !!plan;
        label.hidden = !plan;
        const room = plan?.preview?.room;
        outline.visible = !!room;
        if (room) {
          outline.geometry = frameGeo(room.size[0]);
          outline.position.set(room.center[0], 0.07, room.center[1]);
        }
        if (plan) label.textContent = plan.preview?.label || '';
        laidFor = '';
      }
      if (!plan) return;
      const k = viewKey();
      if (k !== laidFor) { laidFor = k; layDots(plan.waypoints); }
      dotMat.opacity = 0.7 + 0.25 * Math.sin(time * 4);
      const [ax, az] = plan.preview?.anchor || plan.waypoints[plan.waypoints.length - 1];
      anchor.set(ax, 2.55, az).project(camera);
      const r = canvas.getBoundingClientRect(), c = container.getBoundingClientRect();
      // Kept on screen: a door on the far wall can sit near the top edge. (The tag hangs above its
      // point: `top` is the tag's bottom edge.)
      const half = (label.offsetWidth || 120) / 2 + 8, tall = (label.offsetHeight || 34) + 12;
      const x = THREE.MathUtils.clamp(((anchor.x + 1) / 2) * r.width, half, r.width - half);
      const y = THREE.MathUtils.clamp(((1 - anchor.y) / 2) * r.height, tall + 56, r.height - 12);
      label.style.left = `${r.left - c.left + x}px`;
      label.style.top = `${r.top - c.top + y}px`;
    },
    get visible() { return dots.visible; },
    get outlined() { return outline.visible ? [outline.position.x, outline.position.z] : null; },
    get dotCount() { return dots.count; },
    // Tests: each dot laid now, on the ground ({ x, z }) and on the page ({ sx, sy }, CSS px).
    dotPoints() {
      const r = canvas.getBoundingClientRect(), out = [];
      for (let i = 0; i < dots.count; i++) {
        dots.getMatrixAt(i, m); p.setFromMatrixPosition(m);
        const x = p.x, z = p.z; p.project(camera);
        out.push({ x, z, sx: r.left + (p.x + 1) / 2 * r.width, sy: r.top + (1 - p.y) / 2 * r.height });
      }
      return out;
    },
    get labelText() { return label.hidden ? '' : label.textContent; },
  };
}
