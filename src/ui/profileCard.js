// The profile card on the main menu (#btn-profile): your portrait, "Playing as", your username and
// "Adjust avatar ›". The whole card is one button: it opens the avatar screen (src/ui/menu.js). It
// follows the account (src/account/account.js): a new name or a new look shows at once.
import { makePortrait } from './portrait.js';
import { avatarKey } from '../data/wardrobe.js';
import { OUTFIT_OF_BASE, SEAT_COLORS } from '../table.js';

export function createProfileCard(doc, { account, onOpen, guard = () => false } = {}) {
  const $ = id => doc.getElementById(id);
  const btn = $('btn-profile'), nameEl = $('pc-name'), face = $('pc-portrait');
  let shownKey = '';
  if (!btn) return { render() {} };

  function render() {
    const p = account?.profile;
    btn.hidden = !p;
    if (!p) return;
    if (nameEl) { nameEl.textContent = p.username; nameEl.title = p.username; }
    btn.setAttribute('aria-label', `Playing as ${p.username}. Adjust avatar`);
    const key = avatarKey(p.avatar);
    if (face && key !== shownKey) {
      shownKey = key;
      const pic = makePortrait(doc, { id: 'me', name: p.username, color: SEAT_COLORS[0], avatar: p.avatar, outfit: OUTFIT_OF_BASE[p.avatar.base] });
      if (pic.tagName === 'IMG') { pic.alt = ''; pic.decoding = 'async'; pic.draggable = false; }
      face.replaceChildren(pic);
    }
  }

  btn.addEventListener('click', e => { e.preventDefault(); if (guard(e)) return; onOpen?.(); });
  account?.onChange?.(() => render());
  render();
  return { render };
}
