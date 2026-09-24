// The chosen-door preview: a dotted path on the floor from the guest to where they will walk, and
// a small label over the door with what it costs ("Explore · 2 AP"). Shown only while a door move
// is waiting for confirmation; the rules never see it.
//
// The dots are ONE InstancedMesh (one draw call) and the label is a plain HTML tag positioned over
// the canvas, so the preview costs next to nothing on the iPad.
import * as THREE from 'three';

const MAX_DOTS = 80;
const SPACING = 0.34;   // metres between dots

export function createPathPreview(scene, camera, canvas, container) {
  const dotGeo = new THREE.CircleGeometry(0.055, 12);
  dotGeo.rotateX(-Math.PI / 2);
  const dotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#f4cf6a'), transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
  const dots = new THREE.InstancedMesh(dotGeo, dotMat, MAX_DOTS);
  dots.count = 0;
  dots.renderOrder = 3;
  dots.frustumCulled = false;
  dots.visible = false;
  scene.add(dots);

  const label = document.createElement('div');
  label.className = 'path-label';
  label.hidden = true;
  container.appendChild(label);

  const m = new THREE.Matrix4();
  const anchor = new THREE.Vector3();
  let shown = null;   // the plan currently drawn

  function layDots(points) {
    let n = 0, carry = SPACING * 0.6;   // the first dot sits a little ahead of the guest
    for (let i = 1; i < points.length && n < MAX_DOTS; i++) {
      const [ax, az] = points[i - 1], [bx, bz] = points[i];
      const len = Math.hypot(bx - ax, bz - az);
      let d = carry;
      while (d <= len && n < MAX_DOTS) {
        const t = d / len;
        m.makeTranslation(ax + (bx - ax) * t, 0.03, az + (bz - az) * t);
        dots.setMatrixAt(n++, m);
        d += SPACING;
      }
      carry = d - len;
    }
    dots.count = n;
    dots.instanceMatrix.needsUpdate = true;
  }

  return {
    // `plan` is a confirmed-pending door move ({ waypoints, preview: { label, anchor: [x, z] } })
    // or null. Cheap to call every frame: it only rebuilds when the plan changes.
    update(plan, time) {
      if (plan !== shown) {
        shown = plan;
        dots.visible = !!plan;
        label.hidden = !plan;
        if (plan) {
          layDots(plan.waypoints);
          label.textContent = plan.preview?.label || '';
        }
      }
      if (!plan) return;
      dotMat.opacity = 0.7 + 0.25 * Math.sin(time * 4);
      const [ax, az] = plan.preview?.anchor || plan.waypoints[plan.waypoints.length - 1];
      anchor.set(ax, 2.55, az).project(camera);
      const r = canvas.getBoundingClientRect(), c = container.getBoundingClientRect();
      label.style.left = `${r.left - c.left + ((anchor.x + 1) / 2) * r.width}px`;
      label.style.top = `${r.top - c.top + ((1 - anchor.y) / 2) * r.height}px`;
    },
    get visible() { return dots.visible; },
    get dotCount() { return dots.count; },
    get labelText() { return label.hidden ? '' : label.textContent; },
  };
}
