// Character portraits. A real illustration drops in via PORTRAIT_ART (keyed by outfit) without
// touching callers; until then a refined placeholder bust is drawn as an SVG — a period-dressed
// guest, framed in brass, with two states: normal and POSSESSED (the same face, both eyes a deep
// blood-red iris with a white catchlight; nothing else changes).
// Callers only ask for a portrait of a player in a given state and place the returned element.
import { outfits, bodyTypes } from '../data/characters.js';

// Drop-in artwork: outfit id → an image path, OR an object with separate looks:
//   tuxedo: 'assets/portraits/victor.png'                            // one image (normal)
//   tuxedo: { normal: '…/victor.png', possessed: '…/victor-poss.png' } // both looks supplied
// If only a normal image is given, the private possessed view shows it unchanged (no colour wash;
// the crimson plate around it carries the state).
export const PORTRAIT_ART = {
  // Victor (tuxedo): supplied portraits. The public strip always requests `normal`, so his hidden
  // role never leaks; his own active-player panel uses `possessed` when he is possessed.
  tuxedo: { normal: 'assets/portraits/victor.jpg', possessed: 'assets/portraits/victor-possessed.jpg' },
  suit: { normal: 'assets/portraits/marcus.jpg', possessed: 'assets/portraits/marcus-possessed.jpg' },
  dinnerJacket: { normal: 'assets/portraits/henry.jpg', possessed: 'assets/portraits/henry-possessed.jpg' },
  dressBurgundy: { normal: 'assets/portraits/clara.jpg', possessed: 'assets/portraits/clara-possessed.jpg' },
  dressEmerald: { normal: 'assets/portraits/beatrice.jpg', possessed: 'assets/portraits/beatrice-possessed.jpg' },
  dressMidnight: { normal: 'assets/portraits/eleanor.jpg', possessed: 'assets/portraits/eleanor-possessed.jpg' },
};

export function makePortrait(doc, player, { possessed = false } = {}) {
  // Real artwork, if registered for this guest's outfit. Honour the possessed state: use a
  // dedicated possessed image when supplied (the same face with red eyes), otherwise the normal image
  // unchanged. The public strip always asks for the neutral look (possessed:false).
  const entry = PORTRAIT_ART[player.outfit];
  if (entry) {
    const normal = typeof entry === 'string' ? entry : entry.normal;
    const possessedSrc = typeof entry === 'object' ? entry.possessed : null;
    const img = doc.createElement('img');
    img.alt = `${player.name}${possessed ? ', possessed' : ''}`;
    if (possessed && possessedSrc) { img.className = 'portrait-img'; img.src = possessedSrc; }
    else if (possessed) { img.className = 'portrait-img possessed'; img.src = normal; }  // no possessed image: the normal one
    else { img.className = 'portrait-img'; img.src = normal; }
    return img;
  }

  const outfit = outfits[player.outfit] || {};
  const body = bodyTypes[outfit.body] || bodyTypes.male;
  const skin = body.skin, hair = body.hair;
  const clothes = outfit.jacket || outfit.bodice || '#333';
  const shirt = outfit.shirt || '#e9e6dc';
  const lapels = outfit.lapels || shade(clothes, -0.18);
  const accent = player.color;
  const long = body.hairStyle === 'long';
  const uid = `${player.id}${possessed ? '-p' : ''}`;

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 118');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
  svg.setAttribute('class', 'portrait-svg' + (possessed ? ' possessed' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${player.name}${possessed ? ', possessed' : ''}`);

  // Neckwear: a tie or a bow for the men; a simple neckline for the women.
  const neck = outfit.neckwear === 'bow'
    ? `<path d="M50 80 l-9 -5 v10 z" fill="${outfit.neckwearColor || '#15151a'}"/><path d="M50 80 l9 -5 v10 z" fill="${outfit.neckwearColor || '#15151a'}"/><circle cx="50" cy="80" r="2.6" fill="${outfit.neckwearColor || '#15151a'}"/>`
    : outfit.neckwear === 'tie'
      ? `<path d="M50 76 l-4 4 l4 22 l4 -22 z" fill="${outfit.neckwearColor || '#8a1c2b'}"/>`
      : `<path d="M42 78 Q50 92 58 78" fill="none" stroke="${shade(clothes, -0.25)}" stroke-width="2"/>`;

  // The eyes: the normal dark pupils, or (possessed) a deep blood-red iris — darker at the rim, brighter
  // in the middle — with a small white catchlight at the upper left. Same brows, same mouth.
  const pupil = (cx, cy) => possessed
    ? `<circle cx="${cx}" cy="${cy}" r="2.9" fill="url(#iris-${uid})"/><circle cx="${cx - 0.9}" cy="${cy - 1}" r="0.85" fill="#fff"/>`
    : `<circle cx="${cx}" cy="${cy}" r="2.4" fill="#1a1420"/>`;
  const eyes = `<g class="eye"><ellipse cx="41" cy="50" rx="5.4" ry="4.4" fill="#fff"/>${pupil(41, 50)}</g>
       <g class="eye"><ellipse cx="60" cy="50" rx="5.4" ry="4.4" fill="#fff"/>${pupil(60, 50)}</g>
       <path d="M34 43 L47 43" stroke="#2a2030" stroke-width="1.8" stroke-linecap="round"/><path d="M53 43 L66 43" stroke="#2a2030" stroke-width="1.8" stroke-linecap="round"/>`;

  const mouth = `<path d="M43 65 Q50 70 57 65" fill="none" stroke="#7a4630" stroke-width="2.2" stroke-linecap="round"/>`;

  const hairShape = long
    ? `<path d="M24 50 Q22 20 50 18 Q78 20 76 50 L76 68 Q72 44 64 37 Q57 33 50 33 Q43 33 36 37 Q28 44 24 68 Z" fill="${hair}"/>`
    : `<path d="M28 48 Q28 20 50 20 Q72 20 72 48 Q67 34 50 34 Q33 34 28 48 Z" fill="${hair}"/>`;

  svg.innerHTML = `
    <defs>
      <clipPath id="clip-${uid}"><rect x="2" y="2" width="96" height="114" rx="12"/></clipPath>
      <linearGradient id="bg-${uid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#232838"/>
        <stop offset="1" stop-color="#12141d"/>
      </linearGradient>
      ${possessed ? `<radialGradient id="iris-${uid}"><stop offset="0" stop-color="#c0242f"/><stop offset="0.55" stop-color="#a51d2a"/><stop offset="1" stop-color="#4a0710"/></radialGradient>` : ''}
    </defs>
    <g clip-path="url(#clip-${uid})">
      <rect x="2" y="2" width="96" height="114" fill="url(#bg-${uid})"/>
      <!-- shoulders / jacket -->
      <path d="M18 118 Q22 84 50 82 Q78 84 82 118 Z" fill="${clothes}"/>
      <path d="M50 82 L38 118 L44 118 L50 90 L56 118 L62 118 Z" fill="${shirt}" opacity="0.95"/>
      <path d="M40 84 L33 104 L38 104 L50 86 Z" fill="${lapels}"/>
      <path d="M60 84 L67 104 L62 104 L50 86 Z" fill="${lapels}"/>
      ${neck}
      <!-- neck + head -->
      <rect x="45" y="70" width="10" height="16" rx="4" fill="${shade(skin, -0.08)}"/>
      <ellipse cx="50" cy="50" rx="24" ry="26" fill="${skin}"/>
      ${hairShape}
      ${eyes}
      <path d="M49 52 Q47 58 50 60" fill="none" stroke="${shade(skin, -0.18)}" stroke-width="1.6" stroke-linecap="round"/>
      ${mouth}
      <rect x="2" y="2" width="96" height="114" rx="12" fill="none" stroke="rgba(0,0,0,0.35)" stroke-width="6"/>
    </g>
    <rect x="3.5" y="3.5" width="93" height="111" rx="11" fill="none" stroke="${accent}" stroke-width="2.5"/>
    <rect x="6" y="6" width="88" height="106" rx="9" fill="none" stroke="rgba(201,162,78,0.4)" stroke-width="1"/>`;
  return svg;
}

// Lighten (t>0) or darken (t<0) a hex colour.
function shade(hex, t) {
  const n = parseInt((hex || '#888').replace('#', ''), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = c => Math.round(t < 0 ? c * (1 + t) : c + (255 - c) * t);
  r = f(r); g = f(g); b = f(b);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
