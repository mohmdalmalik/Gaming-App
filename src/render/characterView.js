// Character view. Two kinds, behind ONE surface { group, def, outfit, update(mover, dt),
// setActive, setDead }:
//   • a real rounded glTF guest (when the outfit has a `model`) — a skinned model with Idle/Walk
//     clips, cross-faded by movement with the stride matched to speed;
//   • the placeholder articulated box figure (everyone else) with a simple procedural walk.
// The game logic never touches anything inside; travel/collision come from the mover.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { lambert, makeShadow } from './materials.js';
import { bodyTypes, outfits } from '../data/characters.js';

const gltfLoader = new GLTFLoader();

// Boxes hanging down from their pivot (limbs) and standing up from it (torso parts).
const boxDown = new THREE.BoxGeometry(1, 1, 1); boxDown.translate(0, -0.5, 0);
const boxUp = new THREE.BoxGeometry(1, 1, 1); boxUp.translate(0, 0.5, 0);
const sphere = new THREE.SphereGeometry(1, 14, 10);
const ringGeo = new THREE.RingGeometry(1, 1.16, 32); ringGeo.rotateX(-Math.PI / 2);
const markerGeo = new THREE.OctahedronGeometry(0.09);

function box(geo, color, w, h, d, emissive) {
  const m = new THREE.Mesh(geo, lambert(color, emissive));
  m.scale.set(w, h, d);
  return m;
}

export function createCharacterView(playerDef, cfg, scene) {
  const outfit = outfits[playerDef.outfit];
  if (!outfit) throw new Error(`Unknown outfit "${playerDef.outfit}" for ${playerDef.name}`);
  const b = bodyTypes[outfit.body];
  const c = cfg.character;
  const female = outfit.body === 'female';
  const top = outfit.jacket ?? outfit.bodice;
  const legColor = outfit.trousers ?? b.skin;
  const sleeveColor = female ? (outfit.sleeves === 'long' ? outfit.bodice : b.skin) : outfit.jacket;
  const hipsTop = b.legLength + b.hipHeight;
  const shoulderY = hipsTop + b.torsoHeight;
  const useModel = !!outfit.model;

  const group = new THREE.Group();
  group.name = `character:${playerDef.id}`;

  // Floor ring in the player's colour (steady, no pulse).
  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(playerDef.color), transparent: true, opacity: c.ringInactiveOpacity, depthWrite: false, toneMapped: false });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.scale.set(c.ringRadius, 1, c.ringRadius);
  ring.position.y = 0.02;
  ring.renderOrder = 1;
  group.add(ring);

  // Marker floating above the active player's head.
  const markerY = useModel ? (outfit.modelHeight || 1.8) + c.markerHeight + 0.18
    : shoulderY + b.neck + b.headRadius * 2 + c.markerHeight;
  const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(playerDef.color), toneMapped: false }));
  marker.position.y = markerY;
  marker.visible = false;
  group.add(marker);

  // Body: holds either the glTF model or the placeholder figure; bobs / rotates for death.
  const body = new THREE.Group();
  group.add(body);

  // Model-animation state (used only when useModel).
  let mixer = null, idleAction = null, walkAction = null, walkW = 0, prevX = null, prevZ = null;
  // Placeholder limbs (used only when !useModel).
  let arms = [], legs = [], skirt = null;

  if (useModel) {
    // Load the real guest. Skinned meshes can be wrongly frustum-culled from a stale bind-pose
    // bound, so disable culling; keep the model's own materials/shading (no palette recolour).
    gltfLoader.load(outfit.model, (gltf) => {
      const root = gltf.scene;
      root.traverse(o => { if (o.isMesh) o.frustumCulled = false; });
      body.add(root);
      mixer = new THREE.AnimationMixer(root);
      const idle = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
      const walk = gltf.animations.find(a => /walk/i.test(a.name)) || gltf.animations[1];
      if (idle) { idleAction = mixer.clipAction(idle); idleAction.play(); idleAction.setEffectiveWeight(1); }
      if (walk) { walkAction = mixer.clipAction(walk); walkAction.play(); walkAction.setEffectiveWeight(0); }
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
      } else {
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

  return {
    group,
    def: playerDef,
    outfit,
    setActive(v) {
      active = v && !dead;
      marker.visible = active;
      ringMat.opacity = active ? c.ringActiveOpacity : c.ringInactiveOpacity;
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
      group.rotation.y = mover.heading;

      if (useModel) {
        // Stride matched to actual ground speed; smooth cross-fade Idle <-> Walk.
        if (prevX === null) { prevX = mover.x; prevZ = mover.z; }
        const speed = Math.hypot(mover.x - prevX, mover.z - prevZ) / Math.max(dt, 1e-4);
        prevX = mover.x; prevZ = mover.z;
        const target = mover.walking ? 1 : 0;
        walkW += (target - walkW) * Math.min(1, dt * 9);
        if (walkAction) {
          walkAction.setEffectiveWeight(walkW);
          walkAction.timeScale = THREE.MathUtils.clamp(speed / cfg.player.speed, 0.5, 1.7);
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
}
