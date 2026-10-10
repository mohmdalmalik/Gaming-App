// "Your guest" on the Play with bots screen (src/ui/menu.js): Random, or one of the six guests of the
// roster (src/data/characters.js), each shown by portrait and name. The choice is remembered on this
// device (the 'guest' setting, src/settings.js) and is the guest you play: at a table with bots
// (src/main.js planGame seats them at your seat, and the bots get the others) and in practice.
// Only the look of who you play: nothing here touches a rule.
import { roster } from '../data/characters.js';
import { makePortrait } from './portrait.js';

export const RANDOM_GUEST = 'random';
const NOTES = {
  random: 'A different guest at each table.',
  chosen: name => `You play ${name} at every table, and in practice.`,
};

// The roster guest a choice names (a roster id, or a guest's name as a direct link may give it), or
// null for Random (and for anything this roster does not know).
export function findGuest(value) {
  if (value == null || value === RANDOM_GUEST) return null;
  const v = String(value).trim().toLowerCase();
  return roster.find(g => g.id === v || g.name.toLowerCase() === v) || null;
}

// The Random tile: a brass question mark in an Art Deco diamond, on the portraits' navy.
const RANDOM_MARK = `<svg class="gb-random" viewBox="0 0 44 52" aria-hidden="true">
  <path d="M22 6 L40 26 L22 46 L4 26 Z" fill="none" stroke="currentColor" stroke-width="1.3" opacity="0.75"/>
  <path d="M22 11 L35.5 26 L22 41 L8.5 26 Z" fill="none" stroke="currentColor" stroke-width="0.7" opacity="0.4"/>
  <text x="22" y="33.5" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="21" font-weight="700" fill="currentColor">?</text>
</svg>`;

// Fill `host` with the row (radio buttons drawn as portrait tiles) and `note` with its line. The tiles
// are built once and then only re-marked, so the portraits never reload on a pick. `guard(e)` is the
// menu's tap guard (src/ui/tapGuard.js): true for the second tap of the double tap that opened the
// screen, which is ignored.
const live = new WeakMap();      // host -> { onPick, guard }: the latest callbacks
export function renderGuestPicker(doc, host, note, value, { onPick, guard = () => false } = {}) {
  if (!host) return;
  const chosen = findGuest(value);
  const current = chosen ? chosen.id : RANDOM_GUEST;
  live.set(host, { onPick, guard });
  if (!host.querySelector('.guest-btn')) {
    host.innerHTML = '';
    for (const g of [{ id: RANDOM_GUEST, name: 'Random' }, ...roster]) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn guest-btn' + (g.id === RANDOM_GUEST ? ' random' : '');
      b.setAttribute('role', 'radio');
      b.dataset.value = g.id;
      const face = doc.createElement('span');
      face.className = 'gb-face';
      if (g.id === RANDOM_GUEST) face.innerHTML = RANDOM_MARK;
      else {
        const pic = makePortrait(doc, g);
        if (pic.tagName === 'IMG') { pic.alt = ''; pic.decoding = 'async'; pic.draggable = false; }
        face.appendChild(pic);
      }
      const name = doc.createElement('span');
      name.className = 'gb-name';
      name.textContent = g.name;
      b.append(face, name);
      b.addEventListener('click', e => {
        e.preventDefault();
        const cb = live.get(host);
        if (!cb || cb.guard(e)) return;
        cb.onPick?.(g.id);
      });
      host.appendChild(b);
    }
  }
  for (const b of host.querySelectorAll('.guest-btn')) {
    const on = b.dataset.value === current;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  }
  if (note) note.textContent = chosen ? NOTES.chosen(chosen.name) : NOTES.random;
}
