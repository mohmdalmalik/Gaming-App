// Character view. Three kinds, behind ONE surface { group, def, outfit, update(mover, dt),
// setActive, setDead, setPossessed, setAvatar, setDef, dispose }:
//   • a player's avatar (when the seat has an `avatar`: every seat at the table) — its pieces on a shared
//     body, merged once per set of pieces and cloned with its own colours and eye colour: two draw calls
//     (src/render/avatar.js, avatarParts.js), with Idle/Walk clips cross-faded by movement, the stride matched to speed;
//   • a real rounded glTF guest (an outfit with a `model`: old fixtures) — the same, loaded on its own;
//   • the placeholder articulated box figure (everyone else) with a simple procedural walk.
// The game logic never touches anything inside; travel/collision come from the mover.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lambert, makeShadow } from './materials.js';
import { bodyTypes, outfits } from '../data/characters.js';
import { xrayGuest } from './xray.js';
import { createPossessedEyes } from './possessedLook.js';
import { loadBase, createAvatarModel, GAME_RIM } from './avatar.js';
import { LOOK_LABELS, genderOf, geometryKey, item, lookOf } from '../data/wardrobe.js';

const gltfLoader = new GLTFLoader();

// Boxes hanging down from their pivot (limbs) and standing up from it (torso parts).
const boxDown = new THREE.BoxGeometry(1, 1, 1); boxDown.translate(0, -0.5, 0);
const boxUp = new THREE.BoxGeometry(1, 1, 1); boxUp.translate(0, 0.5, 0);
const sphere = new THREE.SphereGeometry(1, 14, 10);
const ringGeo = new THREE.RingGeometry(1, 1.16, 32); ringGeo.rotateX(-Math.PI / 2);
// A thin dark edge round every ring (a second, wider ring just under it, the same for every guest), so a seat's
// colour still reads on a red rug, a cream floor or a dark one.
const ringEdgeGeo = new THREE.RingGeometry(0.9, 1.26, 32); ringEdgeGeo.rotateX(-Math.PI / 2);
// ...and a thin light edge outside that one: on a dark floor (the red rug) a dark edge shows nothing, and an orange or blue
// ring hardly stood out from it (the dark and the light edge together read on a light floor, a rug and a dark one).
const ringLightGeo = new THREE.RingGeometry(1.26, 1.35, 32); ringLightGeo.rotateX(-Math.PI / 2);
const markerGeo = new THREE.OctahedronGeometry(0.09);

// A faint light that only the guests get, so a navy suit still reads in a dark room: a warm rim
// on the edges turned away from the camera plus a little fill. It is part of the guests' own
// shader (no scene light, so nothing else changes and there is no extra draw call).
const RIM = { color: new THREE.Color('#ffe2b8'), rim: 0.42, fill: 0.1 };
function guestLight(m) {
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = { value: RIM.color };
    shader.uniforms.uRim = { value: new THREE.Vector2(RIM.rim, RIM.fill) };
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform vec2 uRim;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
      outgoingLight += uRimColor * rimK * uRim.x * (0.35 + 0.65 * diffuseColor.rgb) + diffuseColor.rgb * uRim.y;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'guestLight1';
  return m;
}

function box(geo, color, w, h, d, emissive) {
  const m = new THREE.Mesh(geo, lambert(color, emissive));
  m.scale.set(w, h, d);
  return m;
}

// (an avatar's stand-in outfit: its body and nominal height are read before the model loads; its colours
// only if the model cannot be loaded, when the box figure stands in for it: from the gender, the jacket or
// dress and the colours)
const SKIRTS = { column: 'column', ballgown: 'full', aline: 'aline' };
const avatarOutfit = av => {
  const female = genderOf(av?.body) === 'f', c = av?.colours || {};
  const main = item('main', c.main)?.value || '#36436a', accent = item('accent', c.accent)?.value || '#1a1a1e';
  const look = lookOf(av);
  return { name: (look && LOOK_LABELS[look]) || 'Guest', body: female ? 'female' : 'male', modelHeight: 1.66, avatar: true,
    ...(female ? { bodice: main, skirt: main, skirtStyle: SKIRTS[av.dress] || 'aline', sleeves: 'none', ...(av.belt === 'sash' ? { sash: accent } : {}) }
      : { jacket: main, trousers: av.legs === 'blackTrousers' ? '#16161a' : main, shirt: '#e9e6dc', neckwear: av.neck === 'tie' ? 'tie' : av.neck === 'none' ? 'none' : 'bow', neckwearColor: accent }) };
};

export function createCharacterView(playerDef, cfg, scene) {
  let avatar = playerDef.avatar || null;
  const outfit = avatar ? avatarOutfit(avatar) : outfits[playerDef.outfit];
  if (!outfit) throw new Error(`Unknown outfit "${playerDef.outfit}" for ${playerDef.name}`);
  const b = bodyTypes[outfit.body];
  const c = cfg.character;
  const female = outfit.body === 'female';
  const top = outfit.jacket ?? outfit.bodice;
  const legColor = outfit.trousers ?? b.skin;
  const sleeveColor = female ? (outfit.sleeves === 'long' ? outfit.bodice : b.skin) : outfit.jacket;
  const hipsTop = b.legLength + b.hipHeight;
  const shoulderY = hipsTop + b.torsoHeight;
  const useModel = !!avatar || !!outfit.model;

  const group = new THREE.Group();
  group.name = `character:${playerDef.id}`;

  // Floor ring in the player's colour (steady, no pulse).
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(playerDef.color), transparent: true, opacity: c.ringInactiveOpacity, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.scale.set(c.ringRadius, 1, c.ringRadius);
  ring.position.y = 0.02;
  ring.renderOrder = 1;
  group.add(ring);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x0c0a08, transparent: true, opacity: c.ringEdgeOpacity, depthWrite: false, toneMapped: false });
  const ringEdge = new THREE.Mesh(ringEdgeGeo, edgeMat);
  ringEdge.position.y = -0.004;                    // (a child of the ring: it follows its scale, and goes with it when hidden)
  ringEdge.renderOrder = 0.5;
  ring.add(ringEdge);
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xf2ead8, transparent: true, opacity: c.ringLightOpacity, depthWrite: false, toneMapped: false });
  const ringLight = new THREE.Mesh(ringLightGeo, lightMat);
  ringLight.position.y = -0.004;
  ringLight.renderOrder = 0.5;
  ring.add(ringLight);

  // Marker floating just above the active player's head (for a model: re-measured from the model
  // once it has loaded, since modelHeight is only its nominal height).
  let headY = useModel ? (outfit.modelHeight || 1.8) : shoulderY + b.neck + b.headRadius * 2;
  const markerY = headY + c.markerHeight;
  // (drawn over everything: even in a crowded room the active guest's marker is never hidden)
  const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(playerDef.color), toneMapped: false, depthTest: false }));
  marker.renderOrder = 12;
  marker.position.y = markerY;
  marker.visible = false;
  group.add(marker);

  // Body: holds either the glTF model or the placeholder figure; bobs / rotates for death.
  const body = new THREE.Group();
  group.add(body);

  // Model-animation state (used only when useModel). The walk clip is IN PLACE; its phase is driven
  // by the distance the mover actually travelled divided by the clip's stride (metres per cycle,
  // measured in Blender and carried in the GLB's extras), so the planted foot moves backward at
  // exactly the ground speed and never slides — whatever the speed.
  let mixer = null, idleAction = null, walkAction = null, walkW = 0, prevX = null, prevZ = null;
  let strideLength = outfit.strideLength || 1.0, walkDuration = 1;
  // Placeholder limbs (used only when !useModel).
  let arms = [], legs = [], skirt = null;
  // The possessed look (red eyes, src/render/possessedLook.js): wanted state, applied once the model
  // has loaded. The placeholder box figure has no eyes to change.
  let eyes = null, possessedWanted = false;
  let model = null, loadToken = 0, ownGltf = null;   // (avatar: the avatar model; a glTF guest: its own scene)

  // An avatar's model: its pieces merged once (shared by every seat wearing them), cloned with this seat's colours.
  // If it cannot be downloaded the box figure stands in (the guest is never invisible), and it is tried
  // once more a few seconds later.
  let placeholderParts = null, retried = false;
  function showPlaceholder() {
    if (placeholderParts) return;
    const n = body.children.length;
    buildPlaceholder();
    placeholderParts = body.children.slice(n);
  }
  function dropPlaceholder() {
    if (!placeholderParts) return;
    for (const o of placeholderParts) body.remove(o);
    skirt?.geometry.dispose();
    arms = []; legs = []; skirt = null; placeholderParts = null;
  }
  function loadAvatar(av) {
    const token = ++loadToken;
    loadBase(av).then(base => {
      if (token !== loadToken || disposed) return;
      dropModel();
      dropPlaceholder();
      model = createAvatarModel(base, av, { rim: GAME_RIM });
      body.add(model.root);
      eyes = { set: v => model.setPossessed(v), get on() { return model.eyes.on; } };
      eyes.set(possessedWanted);
      strideLength = base.strideLength;
      headY = base.height > 0.8 && base.height < 2.4 ? base.height : headY;
      marker.position.y = headY + c.markerHeight;
      startClips(model.root, base.clips.idle, base.clips.walk);
    }).catch(e => {
      console.warn('character model load failed:', geometryKey(av), e && e.message);
      if (token !== loadToken || disposed) return;
      if (!model) showPlaceholder();
      if (!retried) { retried = true; setTimeout(() => { if (token === loadToken && !disposed) loadAvatar(av); }, 4000); }
    });
  }
  function startClips(root, idle, walk) {
    mixer = new THREE.AnimationMixer(root);
    walkW = 0; prevX = prevZ = null;
    if (idle) { idleAction = mixer.clipAction(idle); idleAction.play(); idleAction.setEffectiveWeight(1); }
    if (walk) {
      walkAction = mixer.clipAction(walk); walkAction.play(); walkAction.setEffectiveWeight(0);
      walkAction.timeScale = 0;              // phase is advanced by distance in update(), not by time
      walkDuration = walk.duration;
    }
    if (dead) api.setDead(true);
  }
  function dropModel() {
    if (mixer) mixer.stopAllAction();
    mixer = idleAction = walkAction = null;
    if (model) { model.dispose(); model = null; }
    eyes = null;
  }

  if (avatar) loadAvatar(avatar);
  else if (useModel) {
    // Load the real guest. Skinned meshes can be wrongly frustum-culled from a stale bind-pose
    // bound, so disable culling. Convert the model's PBR materials to the same matte
    // MeshLambertMaterial the rest of the greybox uses (KEEPING each part's own colour — no
    // recolour), exactly like the furniture loader. This is what makes the guest sit in the room:
    // MeshStandard's specular would blow a bright hotspot on the round head under the warm overhead
    // light, reading as a shiny bald dome; matte Lambert removes it and matches every other guest.
    gltfLoader.load(outfit.model, (gltf) => {
      if (disposed) return;
      const root = gltf.scene;
      ownGltf = root;
      root.traverse(o => {
        if (o.userData && typeof o.userData.strideLength === 'number') strideLength = o.userData.strideLength;
        if (!o.isMesh) return;
        o.frustumCulled = false;
        const flatten = (src) => {
          const m = new THREE.MeshLambertMaterial({ color: src.color ? src.color.clone() : new THREE.Color('#cccccc') });
          if (src.map) m.map = src.map;
          if (src.emissive) m.emissive = src.emissive.clone();
          if (src.transparent) { m.transparent = true; m.opacity = src.opacity; }
          if (src.side !== undefined) m.side = src.side;
          if (src.vertexColors) m.vertexColors = true;   // baked shading (glTF COLOR_0) multiplies the base colour
          m.name = src.name;                             // (the eyes are found by name: 'Eye', 'Shine')
          return guestLight(m);
        };
        o.material = Array.isArray(o.material) ? o.material.map(flatten) : flatten(o.material);
      });
      body.add(root);
      eyes = createPossessedEyes(root);
      eyes.set(possessedWanted);
      const top = new THREE.Box3().setFromObject(root).max.y;
      if (top > 0.8 && top < 2.4) { headY = top; marker.position.y = headY + c.markerHeight; }
      mixer = new THREE.AnimationMixer(root);
      const idle = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
      const walk = gltf.animations.find(a => /walk/i.test(a.name)) || gltf.animations[1];
      if (idle) { idleAction = mixer.clipAction(idle); idleAction.play(); idleAction.setEffectiveWeight(1); }
      if (walk) {
        walkAction = mixer.clipAction(walk); walkAction.play(); walkAction.setEffectiveWeight(0);
        walkAction.timeScale = 0;              // phase is advanced by distance in update(), not by time
        walkDuration = walk.duration;
      }
    }, undefined, (e) => console.warn('character model load failed:', outfit.model, e && e.message));
  } else {
    buildPlaceholder();
  }

  function buildPlaceholder() {
    const hips = box(boxUp, female ? outfit.bodice : legColor, b.hipWidth, b.hipHeight, b.chestDepth * 0.9);
    hips.position.y = b.legLength;
    body.add(hips);

    const torso = box(boxUp, top, b.shoulderWidth, b.torsoHeight, b.chestDepth);
    torso.position.y = hipsTop;
    body.add(torso);

    if (!female) {
      const shirt = box(boxUp, outfit.shirt, b.shoulderWidth * 0.34, b.torsoHeight * 0.6, 0.02);
      shirt.position.set(0, hipsTop + b.torsoHeight * 0.45, b.chestDepth / 2 + 0.005);
      body.add(shirt);
      if (outfit.lapels) {
        for (const s of [-1, 1]) {
          const lapel = box(boxUp, outfit.lapels, b.shoulderWidth * 0.12, b.torsoHeight * 0.5, 0.015);
          lapel.position.set(s * b.shoulderWidth * 0.24, hipsTop + b.torsoHeight * 0.48, b.chestDepth / 2 + 0.01);
          body.add(lapel);
        }
      }
      if (outfit.neckwear === 'tie') {
        const tie = box(boxDown, outfit.neckwearColor, 0.05, b.torsoHeight * 0.55, 0.02);
        tie.position.set(0, shoulderY - 0.02, b.chestDepth / 2 + 0.02);
        body.add(tie);
      } else if (outfit.neckwear !== 'none') {
        const bow = box(boxUp, outfit.neckwearColor, 0.11, 0.045, 0.03);
        bow.position.set(0, shoulderY - 0.06, b.chestDepth / 2 + 0.02);
        body.add(bow);
      }
    } else if (outfit.sash) {
      const sash = box(boxUp, outfit.sash, b.hipWidth * 1.02, 0.06, b.chestDepth * 0.95);
      sash.position.y = hipsTop - 0.01;
      body.add(sash);
    }

    const headY = shoulderY + b.neck + b.headRadius;
    const neck = box(boxUp, b.skin, 0.09, b.neck + 0.02, 0.09);
    neck.position.y = shoulderY - 0.01;
    body.add(neck);
    const head = new THREE.Mesh(sphere, lambert(b.skin));
    head.scale.setScalar(b.headRadius);
    head.position.y = headY;
    body.add(head);
    const hair = new THREE.Mesh(sphere, lambert(b.hair));
    if (b.hairStyle === 'long') {
      hair.scale.set(b.headRadius * 1.08, b.headRadius * 1.2, b.headRadius * 1.1);
      hair.position.set(0, headY + b.headRadius * 0.15, -b.headRadius * 0.15);
    } else {
      hair.scale.set(b.headRadius * 1.05, b.headRadius * 0.9, b.headRadius * 1.02);
      hair.position.set(0, headY + b.headRadius * 0.25, -b.headRadius * 0.08);
    }
    body.add(hair);

    arms = [-1, 1].map(s => {
      const pivot = new THREE.Group();
      pivot.position.set(s * (b.shoulderWidth / 2 + b.armWidth / 2 + 0.01), shoulderY - 0.03, 0);
      const arm = box(boxDown, sleeveColor, b.armWidth, b.armLength, b.armWidth);
      pivot.add(arm);
      const hand = box(boxDown, b.skin, b.armWidth * 0.9, 0.09, b.armWidth * 0.9);
      hand.position.y = -b.armLength;
      pivot.add(hand);
      body.add(pivot);
      return pivot;
    });

    legs = [-1, 1].map(s => {
      const pivot = new THREE.Group();
      pivot.position.set(s * (b.hipWidth / 2 - b.legWidth / 2 - 0.01), b.legLength, 0);
      const leg = box(boxDown, legColor, b.legWidth, b.legLength, b.legWidth);
      pivot.add(leg);
      const foot = box(boxUp, '#1a1418', b.legWidth * 1.05, 0.06, b.legWidth * 1.8);
      foot.position.set(0, -b.legLength, b.legWidth * 0.35);
      pivot.add(foot);
      body.add(pivot);
      return pivot;
    });

    if (female) {
      const style = outfit.skirtStyle || 'aline';
      const rTop = b.hipWidth * 0.55;
      const rBottom = style === 'full' ? b.hipWidth * 1.5 : style === 'column' ? b.hipWidth * 0.6 : b.hipWidth * 1.0;
      const length = style === 'column' ? b.legLength * 0.92 : b.legLength * 0.97;
      const geo = new THREE.CylinderGeometry(rTop, rBottom, length, 16, 1, true);
      geo.translate(0, -length / 2, 0);
      skirt = new THREE.Mesh(geo, lambert(outfit.skirt));
      skirt.material.side = THREE.DoubleSide;
      skirt.position.y = b.legLength + 0.02;
      body.add(skirt);
    }
  }

  // Blood pool, revealed on death.
  const bloodMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#6b0f12'), transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false });
  const blood = new THREE.Group();
  for (const [bx, bz, r] of [[0, 0.15, 0.5], [0.28, 0.35, 0.28], [-0.22, 0.45, 0.22]]) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 16), bloodMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(bx, 0.03, bz);
    blood.add(disc);
  }
  blood.visible = false;
  group.add(blood);

  const shadow = makeShadow(0.95);
  shadow.position.y = 0.011;
  group.add(shadow);

  scene.add(group);

  let phase = 0;
  let amp = 0;     // placeholder: 0 = standing, 1 = full walk cycle
  let active = false;
  let dead = false;
  let disposed = false;

  const api = {
    group,
    def: playerDef,
    outfit,
    // The seat's new look (the wardrobe, a reused view): the same pieces are repainted at once; other pieces
    // load (shared, merged once) and replace the figure. (Avatar views only.)
    setAvatar(av) {
      if (!avatar || !av) return;
      const samePieces = geometryKey(av) === geometryKey(avatar);
      avatar = av;
      if (samePieces && model) model.setAvatar(av);
      else loadAvatar(av);
    },
    // A reused view at a new table: the seat it now shows (its colour: ring and marker).
    setDef(def) {
      api.def = def;
      ringMat.color.set(def.color);
      marker.material.color.set(def.color);
      if (def.avatar) api.setAvatar(def.avatar);
    },
    // Let go of everything this view made (a view not at the table any more). The look's shared
    // geometry stays with the look (src/render/avatar.js), ready for the next guest wearing it.
    dispose() {
      disposed = true;
      loadToken++;
      dropModel();
      dropPlaceholder();
      scene.remove(group);
      // (the shadow, the box figure's colours and the shared geometries are shared by every view: kept)
      ringMat.dispose(); edgeMat.dispose(); lightMat.dispose(); marker.material.dispose(); bloodMat.dispose();
      for (const d of blood.children) d.geometry.dispose();
      if (ownGltf) ownGltf.traverse(o => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
    },
    // Test/debug hook: what the animation is doing (stride in use, walk weight, walk phase 0..1).
    debug() {
      return { model: useModel, loaded: !!mixer, strideLength, walkDuration, walkW, walkPhase: walkAction ? walkAction.time / walkDuration : 0, possessedEyes: !!eyes?.on,
        avatar: avatar ? { ...avatar } : null, glasses: !!model?.glasses, standIn: !!placeholderParts,
        ring: { color: `#${ringMat.color.getHexString()}`, opacity: ringMat.opacity, edgeOpacity: edgeMat.opacity, lightOpacity: lightMat.opacity, visible: ring.visible } };
    },
    // The possessed look on this figure (red eyes). Cheap: does nothing unless it changes. Whose screen
    // shows it is main.js's decision (the player's own guest while possessed, and the guests a possessed
    // player KNOWS are possessed: src/ui/allies.js; never from a guest's real role).
    setPossessed(on) {
      possessedWanted = !!on;
      if (eyes) eyes.set(possessedWanted);
    },
    setActive(v) {
      active = v && !dead;
      marker.visible = active;
      ringMat.opacity = active ? c.ringActiveOpacity : c.ringInactiveOpacity;
      // The active guest's ring shows through anyone standing in front of them (crowded rooms).
      ringMat.depthTest = !active;
      ring.renderOrder = active ? 11 : 1;
      edgeMat.opacity = active ? c.ringEdgeActiveOpacity : c.ringEdgeOpacity;
      edgeMat.depthTest = !active;
      ringEdge.renderOrder = active ? 10.5 : 0.5;
      lightMat.opacity = active ? c.ringLightActiveOpacity : c.ringLightOpacity;
      lightMat.depthTest = !active;
      ringLight.renderOrder = active ? 10.5 : 0.5;
      ring.scale.set(c.ringRadius * (active ? 1.15 : 1), 1, c.ringRadius * (active ? 1.15 : 1));
    },
    setDead(v) {
      dead = v;
      blood.visible = v;
      ring.visible = !v;
      marker.visible = false;
      shadow.scale.set(v ? 1.5 : 0.95, 1, v ? 1.15 : 0.95);
      if (useModel) {
        if (v) {
          walkW = 0;
          if (walkAction) walkAction.setEffectiveWeight(0);
          if (idleAction) idleAction.setEffectiveWeight(1);
          if (mixer) mixer.update(0);
          body.rotation.set(-Math.PI / 2, 0, 0.15);
          body.position.y = 0.12;
        } else { body.rotation.set(0, 0, 0); body.position.y = 0; }
        return;
      }
      if (v) {
        body.rotation.set(-Math.PI / 2, 0, 0.15);
        body.position.y = 0.12;
        legs[0].rotation.x = 0.2; legs[1].rotation.x = -0.15;
        arms[0].rotation.x = 0.5; arms[1].rotation.x = -0.4;
      } else {
        body.rotation.set(0, 0, 0);
        body.position.y = 0;
      }
    },
    update(mover, dt) {
      group.position.set(mover.x, 0, mover.z);
      if (dead) return;
      if (active) xrayGuest(mover.x, mover.z, headY);   // never hidden behind furniture or walls (xray.js)
      group.rotation.y = mover.heading;

      if (useModel) {
        // Walk phase from distance travelled / stride; smooth cross-fade Idle <-> Walk. A jump larger
        // than half a stride in one frame is a teleport (restart / room placement), not a step.
        if (prevX === null) { prevX = mover.x; prevZ = mover.z; }
        let dist = Math.hypot(mover.x - prevX, mover.z - prevZ);
        prevX = mover.x; prevZ = mover.z;
        if (dist > strideLength * 0.5) dist = 0;
        const target = mover.walking ? 1 : 0;
        walkW += (target - walkW) * Math.min(1, dt * 10);
        if (walkAction) {
          walkAction.setEffectiveWeight(walkW);
          if (dist > 0) walkAction.time = (walkAction.time + (dist / strideLength) * walkDuration) % walkDuration;
        }
        if (idleAction) idleAction.setEffectiveWeight(1 - walkW);
        if (mixer) mixer.update(dt);
        marker.rotation.y += dt * 1.5;
        return;
      }

      // Placeholder walk cycle.
      const target = mover.walking ? 1 : 0;
      amp += (target - amp) * Math.min(1, dt * 10);
      if (mover.walking) phase += dt * c.strideFrequency * Math.PI * 2;
      else phase += (Math.round(phase / Math.PI) * Math.PI - phase) * Math.min(1, dt * 8);
      const s = Math.sin(phase) * amp;
      legs[0].rotation.x = s * c.legSwing;
      legs[1].rotation.x = -s * c.legSwing;
      arms[0].rotation.x = -s * c.armSwing;
      arms[1].rotation.x = s * c.armSwing;
      if (skirt) skirt.rotation.x = s * 0.06;
      body.position.y = Math.abs(Math.sin(phase)) * c.bobAmplitude * amp;
      marker.rotation.y += dt * 1.5;
    },
  };
  return api;
}
