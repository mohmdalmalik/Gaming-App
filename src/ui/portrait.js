// Placeholder character portraits, drawn as a simple SVG face. Two states: normal and
// POSSESSED (an altered "weird eye" plus a colder wash). Kept behind one function so real
// character faces can replace it later without the interface logic changing — callers only
// ask for a portrait of a player in a given state and drop the returned element in place.
import { outfits, bodyTypes } from '../data/characters.js';

// Returns an <svg> element (100×100 viewBox, scaled by CSS to any size).
export function makePortrait(doc, player, { possessed = false } = {}) {
  const outfit = outfits[player.outfit] || {};
  const body = bodyTypes[outfit.body] || bodyTypes.male;
  const skin = body.skin;
  const hair = body.hair;
  const clothes = outfit.jacket || outfit.bodice || '#333';
  const accent = player.color;
  const long = body.hairStyle === 'long';

  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('class', 'portrait-svg' + (possessed ? ' possessed' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${player.name}${possessed ? ', possessed' : ''}`);

  // Eyes: normal is a pair of calm dots; possessed keeps the left eye and turns the right
  // into a wide glowing "weird eye" with a slit pupil.
  const eyes = possessed
    ? `
      <g class="eye">
        <ellipse cx="40" cy="46" rx="6" ry="4.5" fill="#fff"/>
        <circle cx="40" cy="46" r="2.6" fill="#1a1420"/>
      </g>
      <g class="eye weird">
        <circle cx="61" cy="45" r="8.5" fill="#ffdede"/>
        <circle cx="61" cy="45" r="7" fill="#e23b3b"/>
        <ellipse cx="61" cy="45" rx="1.7" ry="6" fill="#210206"/>
        <circle cx="61" cy="45" r="8.5" fill="none" stroke="#b46bff" stroke-width="1.4" opacity="0.9"/>
      </g>
      <path d="M32 37 L46 40" stroke="#2a2030" stroke-width="2.2" stroke-linecap="round"/>
      <path d="M69 34 L52 39" stroke="#2a2030" stroke-width="2.6" stroke-linecap="round"/>`
    : `
      <g class="eye"><ellipse cx="40" cy="46" rx="5.5" ry="4.5" fill="#fff"/><circle cx="40" cy="46" r="2.5" fill="#1a1420"/></g>
      <g class="eye"><ellipse cx="60" cy="46" rx="5.5" ry="4.5" fill="#fff"/><circle cx="60" cy="46" r="2.5" fill="#1a1420"/></g>
      <path d="M33 39 L47 39" stroke="#2a2030" stroke-width="2" stroke-linecap="round"/>
      <path d="M53 39 L67 39" stroke="#2a2030" stroke-width="2" stroke-linecap="round"/>`;

  const mouth = possessed
    ? `<path d="M40 66 Q50 60 60 66" fill="none" stroke="#3a1520" stroke-width="2.4" stroke-linecap="round"/>`
    : `<path d="M42 62 Q50 68 58 62" fill="none" stroke="#5a3020" stroke-width="2.4" stroke-linecap="round"/>`;

  const hairShape = long
    ? `<path d="M22 46 Q20 18 50 16 Q80 18 78 46 L78 60 Q74 40 66 34 Q58 30 50 30 Q42 30 34 34 Q26 40 22 60 Z" fill="${hair}"/>`
    : `<path d="M26 44 Q26 18 50 18 Q74 18 74 44 Q70 32 50 32 Q30 32 26 44 Z" fill="${hair}"/>`;

  svg.innerHTML = `
    <rect x="3" y="3" width="94" height="94" rx="16" fill="#171620"/>
    <clipPath id="clip-${player.id}${possessed ? '-p' : ''}"><rect x="3" y="3" width="94" height="94" rx="16"/></clipPath>
    <g clip-path="url(#clip-${player.id}${possessed ? '-p' : ''})">
      <rect x="3" y="3" width="94" height="94" fill="${possessed ? '#241830' : '#20222c'}"/>
      <ellipse cx="50" cy="98" rx="34" ry="26" fill="${clothes}"/>
      <rect x="44" y="70" width="12" height="16" fill="${skin}"/>
      <circle cx="50" cy="46" r="26" fill="${skin}"/>
      ${hairShape}
      ${eyes}
      ${mouth}
      ${possessed ? '<rect x="3" y="3" width="94" height="94" fill="#7a2bd0" opacity="0.14"/>' : ''}
    </g>
    <rect x="3" y="3" width="94" height="94" rx="16" fill="none" stroke="${accent}" stroke-width="3"/>`;
  return svg;
}
