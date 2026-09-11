// Placeholder articulated humanoid: head, torso, arms and legs built from boxes, with a
// simple walk cycle, plus a coloured floor ring and an "active" marker.
//
// This is the seam for real character art: a future glTF-based view only has to offer the
// same { group, update(mover, dt, active), setActive } surface; the game logic never
// touches anything inside.
import * as THREE from 'three';
import { lambert } from './materials.js';
import { bodyTypes, outfits } from '../data/characters.js';

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
  const top = outfit.jacket ?? outfit.bodice;      // colour of the upper body
  const legColor = outfit.trousers ?? b.skin;
  const sleeveColor = female ? (outfit.sleeves === 'long' ? outfit.bodice : b.skin) : outfit.jacket;
  const hipsTop = b.legLength + b.hipHeight;
  const shoulderY = hipsTop + b.torsoHeight;

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
  const marker = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(playerDef.color), toneMapped: false }));
  marker.position.y = shoulderY + b.neck + b.headRadius * 2 + c.markerHeight;
  marker.visible = false;
  group.add(marker);

  // Body (bobs while walking).
  const body = new THREE.Group();
  group.add(body);

  const hips = box(boxUp, female ? outfit.bodice : legColor, b.hipWidth, b.hipHeight, b.chestDepth * 0.9);
  hips.position.y = b.legLength;
  body.add(hips);

  const torso = box(boxUp, top, b.shoulderWidth, b.torsoHeight, b.chestDepth);
  torso.position.y = hipsTop;
  body.add(torso);

  if (!female) {
    // Shirt front, lapels, tie or bow tie.
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

  // Head and hair.
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

  // Arms: pivots at the shoulders.
  const arms = [-1, 1].map(s => {
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

  // Legs: pivots at the hips, feet attached so they swing too.
  const legs = [-1, 1].map(s => {
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

  // Skirt for dresses: a cone hanging from the hips; its shape is the silhouette.
  let skirt = null;
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

  // A blood pool, revealed when the character dies (a couple of overlapping dark-red discs).
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

  scene.add(group);

  let phase = 0;
  let amp = 0;     // 0 = standing, 1 = full walk cycle
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
    // Lay the figure out on the floor with a little blood, or stand it back up (on restart).
    setDead(v) {
      dead = v;
      blood.visible = v;
      ring.visible = !v;
      marker.visible = false;
      if (v) {
        body.rotation.set(-Math.PI / 2, 0, 0.15); // collapsed on its back
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
      if (dead) return; // a dead figure keeps its collapsed pose where it fell
      group.rotation.y = mover.heading;
      const target = mover.walking ? 1 : 0;
      amp += (target - amp) * Math.min(1, dt * 10);
      if (mover.walking) phase += dt * c.strideFrequency * Math.PI * 2;
      else phase += (Math.round(phase / Math.PI) * Math.PI - phase) * Math.min(1, dt * 8); // settle limbs
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
