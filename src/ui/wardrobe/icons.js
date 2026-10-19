// The wardrobe's and the Hotel Honours page's line icons: one small set (1.5 px brass strokes, round ends, in the
// spirit of the game's card icons), put into the page once as an SVG sprite and drawn with <use>. From the screen's
// design mock-up (scratchpad shop-design/screen/mock), plus the lips (Make-up) and the honours' medals.
const SYMBOLS = {
  'i-body': '<circle cx="12" cy="4.9" r="2.6"/><path d="M6.6 20.6v-6.4c0-3.1 2.4-5.4 5.4-5.4s5.4 2.3 5.4 5.4v6.4"/><path d="M9.7 20.6v-5.2M14.3 20.6v-5.2"/>',
  'i-face': '<path d="M12 3.2c3.9 0 6.7 3.3 6.7 7.9 0 5.3-3 9.7-6.7 9.7s-6.7-4.4-6.7-9.7c0-4.6 2.8-7.9 6.7-7.9z"/><circle cx="9.4" cy="11.1" r="1" fill="currentColor" stroke="none"/><circle cx="14.6" cy="11.1" r="1" fill="currentColor" stroke="none"/><path d="M9.7 15.3c1.4 1.1 3.2 1.1 4.6 0"/><path d="M8.2 8.6c.6-.4 1.3-.5 2-.3M15.8 8.6c-.6-.4-1.3-.5-2-.3"/>',
  'i-hair': '<path d="M7.3 13.3c0 4.3 2.1 7.5 4.7 7.5s4.7-3.2 4.7-7.5"/><path d="M6.3 13.8c-1-5.3 1.8-10 6.6-10 3.1 0 5.2 1.5 5.7 3.7.9.3 1.4 1.2 1.1 2.5-.3 1.3-1 2.4-1.7 3.4-.9-2.5-3-4-6-4.2-2.4-.1-4.4 1.3-5.7 4.6z" fill="currentColor" fill-opacity=".28"/>',
  'i-stache': '<path d="M12 11.8c-1.1-1.6-2.9-2.3-4.5-1.7-1.4.5-1.9 1.9-3.3 2-.7 0-1.2-.4-1.5-1-.4 2 .9 4 3.3 4.2 2.6.2 4.5-1.3 6-2.7 1.5 1.4 3.4 2.9 6 2.7 2.4-.2 3.7-2.2 3.3-4.2-.3.6-.8 1-1.5 1-1.4-.1-1.9-1.5-3.3-2-1.6-.6-3.4.1-4.5 1.7z" fill="currentColor" fill-opacity=".3"/>',
  'i-lips': '<path d="M3 12.2c2.2-.6 3.9-3.7 6.2-3.7 1.2 0 2 .7 2.8 1.4.8-.7 1.6-1.4 2.8-1.4 2.3 0 4 3.1 6.2 3.7-2.2 2.9-5.3 5-9 5s-6.8-2.1-9-5z" fill="currentColor" fill-opacity=".28"/><path d="M3 12.2c3 .9 6 1.2 9 .8 3 .4 6.1.1 9-.8"/>',
  'i-glasses': '<circle cx="6.9" cy="13.4" r="3.8"/><circle cx="17.1" cy="13.4" r="3.8"/><path d="M10.7 12.9c.8-.9 1.8-.9 2.6 0M3.2 13.1L1.8 10.4M20.8 13.1l1.4-2.7"/>',
  'i-outfit': '<path d="M8.3 4.4L4.8 6c-1 .5-1.6 1.5-1.6 2.6v11.9h17.6V8.6c0-1.1-.6-2.1-1.6-2.6l-3.5-1.6"/><path d="M8.3 4.4l-.9 4.4 2.5 1.6L12 15.6l2.1-5.2 2.5-1.6-.9-4.4"/><path d="M10.2 5.7l1.8.9 1.8-.9v1.9l-1.8-.9-1.8.9z" fill="currentColor"/><path d="M12 15.6v4.9"/>',
  'i-extras': '<circle cx="11" cy="14.2" r="6.3"/><path d="M11 7.9V6.1M9.5 4.6h3M11 10.8v3.4l2.3 1.4"/><path d="M16.4 10.6c1.7-1.6 3.5-1.4 4.3.2.6 1.2.2 2.6-.9 3.6" stroke-dasharray="1.2 1.8"/>',
  'i-looks': '<path d="M10.1 6.2a1.9 1.9 0 1 1 1.9 1.9v1.3"/><path d="M12 9.4L3.5 15.4c-.9.6-.5 2.1.6 2.1h15.8c1.1 0 1.5-1.5.6-2.1z"/>',
  'i-undo': '<path d="M8.6 14.4L3.8 9.6l4.8-4.8"/><path d="M4.2 9.6h9.9a5.7 5.7 0 0 1 0 11.4h-3.7"/>',
  'i-dice': '<rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.2"/><g fill="currentColor" stroke="none"><circle cx="8.4" cy="8.4" r="1.3"/><circle cx="15.6" cy="8.4" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="8.4" cy="15.6" r="1.3"/><circle cx="15.6" cy="15.6" r="1.3"/></g>',
  'i-rosette': '<circle cx="12" cy="9.3" r="5.7"/><circle cx="12" cy="9.3" r="2.5"/><path d="M8.3 13.7L6.7 21l5.3-2.8 5.3 2.8-1.6-7.3"/>',
  'i-lock': '<path d="M8 11V8.3a4 4 0 0 1 8 0V11" stroke-width="2.2"/><rect x="5.4" y="10.8" width="13.2" height="9.8" rx="2.3" fill="currentColor" stroke="none"/>',
  'i-unlock': '<path d="M8 11V7.6a4 4 0 0 1 7.7-1.5" stroke-width="2.2"/><rect x="5.4" y="10.8" width="13.2" height="9.8" rx="2.3" fill="currentColor" stroke="none"/>',
  'i-check': '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  'i-pencil': '<path d="M4.5 19.5l1-4.1L15.7 5.2a2 2 0 0 1 2.8 0l.3.3a2 2 0 0 1 0 2.8L8.6 18.5z"/><path d="M13.8 7.1l3.1 3.1"/>',
  'i-x': '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  'i-trash': '<path d="M4.6 6.6h14.8M9.6 6.4V4.6h4.8v1.8M6.6 6.8l.9 12.6c.1.8.7 1.4 1.5 1.4h6c.8 0 1.4-.6 1.5-1.4l.9-12.6"/><path d="M10.2 10.4v6.4M13.8 10.4v6.4"/>',
  'i-save': '<path d="M5.4 3.8h10.4l3 3v12.4c0 .6-.5 1-1 1H5.4c-.6 0-1-.4-1-1V4.8c0-.6.4-1 1-1z"/><path d="M8 3.8v4.6h7V3.8M7.8 20.2v-6h8.4v6"/>',
  'i-plus': '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
  'i-lantern': '<path d="M9.2 5.4h5.6M10.2 3.2h3.6"/><path d="M8.8 5.4c-1 1.3-1.7 3.2-1.7 5.8 0 3.4 1.1 5.6 2 6.6h5.8c.9-1 2-3.2 2-6.6 0-2.6-.7-4.5-1.7-5.8"/><path d="M12 9.3c1.3 1.4 1.5 2.9.9 4.1-.4.8-1.5.8-1.9 0-.6-1.1 0-2.7 1-4.1z" fill="currentColor" fill-opacity=".45"/><path d="M8.3 20.6h7.4M12 17.8v2.8"/>',
  'i-mirror': '<ellipse cx="12" cy="9" rx="5.4" ry="6.2"/><path d="M12 15.2v6M10 21.2h4"/><path d="M9.6 6.6c.6-1 1.5-1.5 2.4-1.6" stroke-width="1.3"/>',
  'i-moon': '<path d="M19.4 14.4A7.7 7.7 0 1 1 9.6 4.6a6.3 6.3 0 0 0 9.8 9.8z"/><path d="M17 4.2v2.6M15.7 5.5h2.6" stroke-width="1.3"/>',
  'i-handshake': '<path d="M2.8 11.2l3.4-3.4 3 1.1 2.6-1.4 3.2.4 3 2.8 3.2-.8"/><path d="M6.2 7.8l-3.4 7.6 2.2 1.6M21.2 9.9l-2.4 6.6-2.4.4"/><path d="M8.6 14.2l1.6 1.6M10.6 12.6l2.4 2.4M12.8 11.2l2.8 2.8M16.4 16.9l-2.2-2.2"/>',
  'i-horse': '<path d="M7.2 20.6c.4-3.2 1.6-5.4 3.8-6.9-1.4-.4-2.8.3-4.2 1.5L5 13.4c1.1-2.6 3.1-5.1 5.9-6.6l.6-2.8 1.8 1.9c3.4.4 5.6 3.2 5.9 7.4.2 2.9-.4 5.3-1.4 7.3"/><circle cx="10.4" cy="9.6" r=".8" fill="currentColor" stroke="none"/>',
  'i-q': '<path d="M9.3 9.1a2.8 2.8 0 1 1 3.9 2.6c-.8.4-1.2 1-1.2 1.9v.7"/><circle cx="12" cy="17.4" r="1" fill="currentColor" stroke="none"/>',
  'i-corner': '<path d="M1 17V1h16" stroke-width="1.3"/><path d="M1 11.5A10.5 10.5 0 0 1 11.5 1M1 7a6 6 0 0 1 6-6M1 1l5.5 5.5" stroke-width="1"/>',
  'i-diamond': '<path d="M12 3.5l7.5 8.5-7.5 8.5L4.5 12z"/><path d="M12 8.4l3.2 3.6-3.2 3.6-3.2-3.6z" fill="currentColor" stroke="none"/>',
};
// The corner fan of a Boutique frame uses an 18 x 18 box; everything else 24 x 24.
const BOX = { 'i-corner': '0 0 18 18' };

export function ensureIcons(doc) {
  if (!doc || doc.getElementById('wd-icons')) return;
  const host = doc.createElement('div');
  host.innerHTML = `<svg id="wd-icons" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">${
    Object.entries(SYMBOLS).map(([id, body]) => `<symbol id="${id}" viewBox="${BOX[id] || '0 0 24 24'}">${body}</symbol>`).join('')}</svg>`;
  doc.body.appendChild(host.firstElementChild);
}
// An icon: <svg class="wi ..."><use href="#id"/></svg> (stroke = the text colour).
export const ic = (id, cls = '') => `<svg class="wi${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;
export const ICON_IDS = Object.keys(SYMBOLS);
