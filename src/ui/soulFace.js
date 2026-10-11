// Soul cards (owner-approved, 10 Oct 2026): every Possession card is its owner's own soul, with their
// face on it. The face is the owner's possessed portrait (assets/portraits/<id>-possessed.jpg, red eyes)
// set in the card's own brass mirror, behind the card's purple smoke, with a thin crimson line inside
// the brass. It is drawn ONCE per guest on a small canvas from the Possession card face and the
// portrait, and kept as an image; every surface then shows that image like any other card face (one
// <img>, so the hand fan, the tiles, the card view, the trade scenes and the burning dissolve all work
// unchanged). Nothing is drawn per frame.
//
//   soulFaceSrc(ownerId, plain)    the drawn face if it is ready; else `plain`, the Possession card's own
//                                  face (and it starts drawing it)
//   markSoul(img, ownerId)         an <img> showing `plain` now gets the drawn face the moment it is ready
//   prepareSoulFaces(ids, plain, { gapMs })   fetch the pictures for these guests and draw their faces
//                                  ahead, one at a time, `gapMs` apart (main.js: the player's own at the
//                                  start of a game, the others' once it is in view), so no screen waits
// Once nothing is left to draw (for a few seconds), the drawing canvas and the pictures are let go: only
// the drawn faces are kept. A face needed later simply draws them again.
// (src/ui/cards.js wraps these with the card face it owns: cardFaceSrc, setCardFace, prepareSoulCards.)
// A card whose owner is unknown, or whose owner has no portrait image, keeps the plain face.
import { roster } from '../data/characters.js';
import { PORTRAIT_ART } from './portrait.js';

// The mirror's opening on the card face, measured on the 512 x 768 image (tools/card-pipeline): its
// middle and half-widths, and the painted silhouette's two glowing eyes (left out of the smoke, so
// they never float over the owner's own face).
const OVAL = { cx: 250, cy: 340, rx: 144, ry: 214 };
const SIL_EYES = [[242, 304], [286, 307]];
const SMOKE = 0.8;          // how strongly the card's smoke shows over the face (less in the middle)
const ZOOM = 1.12;          // the portrait a little closer than "just covers the mirror": the face reads
const FACE_Y = 0.47;        // the portrait's height above the mirror's middle, as a share of the portrait
const RING = 'rgba(178, 36, 56, 0.9)';   // the crimson line inside the brass (the possessed plates' line)

const faces = new Map();    // ownerId -> { src: data URL | null, loading: Promise }
const images = new Map();   // url -> Promise<HTMLImageElement> (only while faces are being drawn)
let frame = null;           // the card with the mirror opened (alpha), drawn once (while faces are drawn)
let queue = Promise.resolve();   // faces are drawn one at a time, a little apart
let pending = 0, releaseTimer = 0;   // faces still to draw; when none have been for a while, let go
let warned = false;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const RELEASE_MS = 5000;
function release() { frame = null; images.clear(); }

function load(url) {
  if (!images.has(url)) {
    images.set(url, new Promise((resolve, reject) => {
      const i = new Image();
      i.decoding = 'async';
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`could not load ${url}`));
      i.src = url;
    }));
  }
  return images.get(url);
}

// The owner's possessed portrait image, or null.
function portraitOf(ownerId) {
  const who = roster.find(r => r.id === ownerId);
  const art = who && PORTRAIT_ART[who.outfit];
  if (!art) return null;
  return typeof art === 'string' ? art : art.possessed || art.normal || null;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The Possession card with the inside of its mirror cleared: opaque where the brass and the card are,
// and inside it only the purple smoke, as see-through wisps (the darker the card was there, the more
// see-through), fading toward the middle so the face stays clear.
function makeFrame(card) {
  const W = card.naturalWidth || 512, H = card.naturalHeight || 768, sx = W / 512, sy = H / 768;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(card, 0, 0, W, H);
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const cx = OVAL.cx * sx, cy = OVAL.cy * sy, rx = OVAL.rx * sx, ry = OVAL.ry * sy;
  const eyes = SIL_EYES.map(([x, y]) => [x * sx, y * sy]);
  const D = [30, 20, 28];   // the dark behind the smoke on the card
  for (let y = Math.floor(cy - ry - 2); y <= Math.ceil(cy + ry + 2); y++) {
    for (let x = Math.floor(cx - rx - 2); x <= Math.ceil(cx + rx + 2); x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const e = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (e >= 1.005) continue;
      const j = (y * W + x) * 4;
      const edge = Math.min(1, Math.max(0, (e - 0.975) / 0.03));   // the brass's inner rim stays solid
      if (edge >= 1) continue;
      let a0 = Math.min(1, Math.max(0, ((d[j] + d[j + 1] + d[j + 2]) / 3 - 48) / 150)) ** 0.85;
      if (eyes.some(([ex, ey]) => Math.hypot((x - ex) / (15 * sx), (y - ey) / (10 * sy)) < 1)) a0 = 0;
      const a = a0 * SMOKE * (0.35 + 0.65 * smooth(0.35, 0.92, e));
      if (edge <= 0) {
        // the smoke's own colour, as if laid over nothing (so it reads the same over a face)
        for (let k = 0; k < 3; k++) d[j + k] = Math.min(255, Math.max(0, D[k] + (d[j + k] - D[k]) / Math.max(a0, 1e-3)));
      }
      d[j + 3] = Math.round(255 * Math.max(edge, a * (1 - edge)));
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// One guest's soul card: the card's dark, their portrait in the mirror (a little darker toward the
// brass), the smoke and the card over it, the crimson line.
function draw(card, port) {
  frame ||= makeFrame(card);
  const W = frame.width, H = frame.height, sx = W / 512, sy = H / 768;
  const cx = OVAL.cx * sx, cy = OVAL.cy * sy, rx = OVAL.rx * sx, ry = OVAL.ry * sy;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#140e14'; g.fillRect(0, 0, W, H);
  const s = Math.max((2 * rx + 8) / port.naturalWidth, (2 * ry + 8) / port.naturalHeight) * ZOOM;
  const pw = port.naturalWidth * s, ph = port.naturalHeight * s;
  g.drawImage(port, cx - pw / 2, cy - ph * FACE_Y, pw, ph);
  g.save(); g.translate(cx, cy); g.scale(rx, ry);
  const v = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const t of [0.5, 0.625, 0.75, 0.875, 1]) v.addColorStop(t, `rgba(0,0,0,${(0.5 * smooth(0.5, 1, t)).toFixed(3)})`);
  g.fillStyle = v; g.fillRect(-1, -1, 2, 2);
  g.restore();
  g.drawImage(frame, 0, 0);
  g.beginPath(); g.ellipse(cx, cy, rx - 1 * sx, ry - 1 * sy, 0, 0, Math.PI * 2);
  g.strokeStyle = RING; g.lineWidth = 3.5 * sx; g.stroke();
  return c.toDataURL('image/jpeg', 0.9);
}

function build(ownerId, plain, gapMs = 16) {
  let f = faces.get(ownerId);
  if (f) return f;
  const url = portraitOf(ownerId);
  f = { src: null, loading: null };
  faces.set(ownerId, f);
  if (!url || !plain) return f;
  pending++; clearTimeout(releaseTimer);
  const pictures = Promise.all([load(plain), load(url)]);
  f.loading = queue = queue.then(() => pictures).then(async ([card, port]) => {
    await wait(gapMs);
    f.src = draw(card, port);
    for (const img of document.querySelectorAll(`img[data-soul="${ownerId}"]`)) img.src = f.src;
  }).catch(err => { if (!warned) { warned = true; console.warn('soul card faces: the plain face is used:', err?.message || err); } })
    .finally(() => { if (--pending === 0) releaseTimer = setTimeout(release, RELEASE_MS); });
  return f;
}

export function soulFaceSrc(ownerId, plain) {
  if (ownerId == null) return plain;
  return build(ownerId, plain).src || plain;
}

export function markSoul(img, ownerId) {
  if (ownerId == null) { delete img.dataset.soul; return; }
  img.dataset.soul = String(ownerId);
}

export function prepareSoulFaces(ids = [], plain, { gapMs = 16 } = {}) {
  return Promise.all(ids.map(id => build(id, plain, gapMs).loading).filter(Boolean));
}
