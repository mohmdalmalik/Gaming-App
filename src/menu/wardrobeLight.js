// The Wardrobe's key light: in the Wardrobe your avatar is lit a little like the portraits beside it, so a navy suit
// reads navy (not brown-black) and the skin peach (the graphics review of 21 Oct 2026, C1, the judge's trimmed
// variant "D", approved by the owner the same day). In the Wardrobe ONLY: never in a match (the game's guests,
// src/render/characterView.js), never on the lobby's other people (src/menu/lobbyCast.js), never on the portraits.
//
// One warm-white "studio" key from the upper left, in front, fixed to the camera (so it stays put while the guest is
// turned by a drag), wrapping softly round the forms; the lobby's own light on it is turned down a little (the guest's
// warm rim is added on top, as before). Nothing else: no skin tint, no hair band, no glints (the rejected full version).
// It follows the Wardrobe's camera: 0 in the lobby, full once the camera has come in (lobbyScene.js), so it is off
// whenever the Wardrobe is not on screen and comes on with the camera's own ease (at once when the room is still).
//
// Cheap: it is part of the avatar's own shader (src/render/avatar.js guestMaterial), no light in the scene and no
// draw call; one more shader program in the menu (your avatar's), none in a match.
import * as THREE from 'three';

export const WARDROBE_KEY = {
  strength: 0.62,              // the key at full (the Wardrobe open)
  wrap: 0.35,                  // how far it wraps round a form past its edge (0: a hard edge)
  ambient: 0.78,               // the lobby's own light on the avatar × this at full (not its rim)
  color: '#fff1de',            // warm white
  dir: [-0.75, 0.5, 0.42],     // where it comes from, in the camera's own space (x right, y up, z toward the viewer)
};

const KEY_CODE = `
      {
        // the Wardrobe's key light (src/menu/wardrobeLight.js)
        float keyLit = clamp((dot(normal, normalize(uKeyDir)) + uKey.y) / (1.0 + uKey.y), 0.0, 1.0);
        outgoingLight = outgoingLight * uKey.z + diffuseColor.rgb * uKeyCol * keyLit * uKey.x;
      }
      #include <opaque_fragment>`;

// Give the avatar `model` (src/render/avatar.js createAvatarModel: its body, and its face's own eye materials) the
// key light, off to begin with. -> { set(k) }: k 0 (off: exactly the lobby's look) .. 1 (the Wardrobe's).
export function wardrobeKeyLight(model) {
  const uniforms = {
    uKeyDir: { value: new THREE.Vector3(...WARDROBE_KEY.dir).normalize() },
    uKeyCol: { value: new THREE.Color(WARDROBE_KEY.color) },
    uKey: { value: new THREE.Vector3(0, WARDROBE_KEY.wrap, 1) },     // x: strength, y: wrap, z: the lobby's light × this
  };
  const own = m => m && m.isMeshLambertMaterial && m.customProgramCacheKey?.() === 'guestPalette1';
  const eyes = model.eyeMesh ? [].concat(model.eyeMesh.material) : [];
  for (const m of [model.mesh.material, ...eyes]) {
    if (!own(m)) continue;          // (the iris and the red eyes have their own shader: as they are)
    const before = m.onBeforeCompile;
    // (put in before the guest's own rim, which then adds on top, as in the judge's version)
    m.onBeforeCompile = (shader, renderer) => {
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = 'uniform vec3 uKeyDir;\nuniform vec3 uKeyCol;\nuniform vec3 uKey;\n'
        + shader.fragmentShader.replace('#include <opaque_fragment>', KEY_CODE);
      before.call(m, shader, renderer);
    };
    m.customProgramCacheKey = () => 'guestPaletteKey1';
    m.needsUpdate = true;
  }
  return {
    set(k) {
      k = Math.max(0, Math.min(1, +k || 0));
      uniforms.uKey.value.x = WARDROBE_KEY.strength * k;
      uniforms.uKey.value.z = 1 - (1 - WARDROBE_KEY.ambient) * k;
    },
    get k() { return uniforms.uKey.value.x / WARDROBE_KEY.strength; },
  };
}
