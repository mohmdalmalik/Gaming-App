// Renderer, scene, camera and global light. Sized to its container and re-sized on
// rotation / toolbar changes.
import * as THREE from 'three';

export function createScene(container, cfg) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  let pixelRatioCap = cfg.render.maxPixelRatio;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioCap));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = cfg.render.exposure;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(cfg.render.background);

  const camera = new THREE.PerspectiveCamera(cfg.camera.fov, 1, cfg.camera.near, cfg.camera.far);

  const hemi = new THREE.HemisphereLight(
    new THREE.Color(cfg.render.hemisphere.sky),
    new THREE.Color(cfg.render.hemisphere.ground),
    cfg.render.hemisphere.baseIntensity,
  );
  scene.add(hemi);

  const size = { w: 1, h: 1 };
  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    if (w === size.w && h === size.h) return;
    size.w = w; size.h = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(container);

  return {
    renderer,
    scene,
    camera,
    hemi,
    size,
    resize,
    render() { renderer.render(scene, camera); },
    // Lower = smoother on iPad, higher = sharper. Handy for comparing on the device.
    setPixelRatio(cap) {
      pixelRatioCap = cap;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
      renderer.setSize(size.w, size.h, false);
    },
    // Build the shader program up front so the first reveal doesn't stall.
    compile() { renderer.compile(scene, camera); },
  };
}
