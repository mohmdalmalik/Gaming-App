// See-through window. Whatever stands between the camera and the active guest (a wardrobe or
// bookcase on the near side of the room, a tall cabinet in the next room, a side wall while the
// guest crosses a doorway) is faded out in a soft oval around the guest, so the guest is never
// hidden. The same is done for the room's search spot while its icon is up, so the furniture the
// icon points at is never hidden behind another room's furniture.
//
// It is a few lines added to the room materials' shaders (applyXray): a fragment is dropped when it
// is on screen inside the oval, nearer to the camera than the guest, and above the floor. The edge is
// an ordered dither (a fine screen-door pattern), so no transparency sorting and no extra draw calls.
// Floors and rugs never fade. The oval follows the guest's size on screen, so it works at any zoom.
import * as THREE from 'three';

const uniforms = {
  uXrA: { value: new THREE.Vector4(0, 0, 0, 0) },   // the guest: centre (NDC x, y), depth limit, on
  uXrAR: { value: new THREE.Vector2(1, 1) },        // its radii (NDC x, y)
  uXrB: { value: new THREE.Vector4(0, 0, 0, 0) },   // the search spot
  uXrBR: { value: new THREE.Vector2(1, 1) },
};

const VERT_HEAD = 'varying vec4 vXrClip;\nvarying float vXrY;\nvarying float vXrDepth;\n';
const VERT_BODY = `
  vXrClip = gl_Position;
  vXrY = (modelMatrix * vec4(transformed, 1.0)).y;
  vXrDepth = -mvPosition.z;
`;
const FRAG_HEAD = `varying vec4 vXrClip;
varying float vXrY;
varying float vXrDepth;
uniform vec4 uXrA; uniform vec2 uXrAR; uniform vec4 uXrB; uniform vec2 uXrBR;
float xrOpen(vec4 c, vec2 r, vec2 ndc) {
  if (c.w < 0.5 || vXrDepth > c.z) return 1.0;
  return smoothstep(0.62, 1.0, length((ndc - c.xy) / r));
}
float xrB2(vec2 v) { return fract(v.x * 0.5 + v.y * v.y * 0.75); }
`;
const FRAG_BODY = `
  if (vXrY > 0.06) {
    vec2 xrNdc = vXrClip.xy / vXrClip.w;
    float xrKeep = min(xrOpen(uXrA, uXrAR, xrNdc), xrOpen(uXrB, uXrBR, xrNdc));
    if (xrKeep < 0.999) {
      vec2 xrP = mod(floor(gl_FragCoord.xy), 4.0);
      float xrT = xrB2(floor(xrP * 0.5)) * 0.25 + xrB2(mod(xrP, 2.0)) + 0.03125;
      if (xrKeep < xrT) discard;
    }
  }
`;

// Add the see-through window to a material (room models, door leaves). Shares one set of uniforms.
export function applyXray(material) {
  if (material.userData.xray) return material;
  material.userData.xray = true;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAG_BODY}`);
  };
  material.customProgramCacheKey = () => 'xray1';
  return material;
}

// Targets for the next frame. Each is set every frame while it applies (characterView for the active
// guest, searchSpot for the search furniture) and lapses when it is not set again.
const guest = { x: 0, z: 0, h: 1.7, set: false };
const spot = { cx: 0, cz: 0, sx: 0, sy: 0, sz: 0, set: false };
export function xrayGuest(x, z, height) { guest.x = x; guest.z = z; guest.h = height; guest.set = true; }
export function xraySpot(f) {
  if (!f) { spot.set = false; return; }
  spot.cx = f.center[0]; spot.cz = f.center[1]; spot.sx = f.size[0]; spot.sy = f.size[1]; spot.sz = f.size[2]; spot.set = true;
}

const v = new THREE.Vector3(), fwd = new THREE.Vector3(), rel = new THREE.Vector3();
const depthOf = (camera, x, y, z) => rel.set(x, y, z).sub(camera.position).dot(fwd);
function ndc(camera, x, y, z) { return v.set(x, y, z).project(camera); }

// Once a frame, after the camera has moved and before the frame is drawn.
export function updateXray(camera) {
  camera.getWorldDirection(fwd);
  const A = uniforms.uXrA.value, B = uniforms.uXrB.value;
  if (guest.set) {
    const feet = ndc(camera, guest.x, 0, guest.z).clone();
    const head = ndc(camera, guest.x, guest.h, guest.z);
    const ry = Math.max(0.04, Math.abs(head.y - feet.y) * 0.62 + 0.03);
    A.set(feet.x, (head.y + feet.y) / 2, depthOf(camera, guest.x, guest.h * 0.5, guest.z) - 0.3, feet.z < 1 ? 1 : 0);
    uniforms.uXrAR.value.set(ry * 0.72 / camera.aspect, ry);
  } else A.w = 0;
  guest.set = false;
  if (spot.set) {
    // the piece's box on screen, and a depth limit just in front of its nearest corner
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity;
    for (const dx of [-0.5, 0.5]) for (const dz of [-0.5, 0.5]) for (const y of [0, spot.sy]) {
      const px = spot.cx + dx * spot.sx, pz = spot.cz + dz * spot.sz;
      const p = ndc(camera, px, y, pz);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      near = Math.min(near, depthOf(camera, px, y, pz));
    }
    B.set((x0 + x1) / 2, (y0 + y1) / 2, near - 0.2, 1);
    uniforms.uXrBR.value.set(Math.max(0.03, (x1 - x0) * 0.62), Math.max(0.03, (y1 - y0) * 0.62));
  } else B.w = 0;
}
