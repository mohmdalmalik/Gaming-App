// The profile card on the main menu (#btn-profile): your portrait, "Playing as", your username and
// "Adjust avatar ›". The whole card is one button: it opens the avatar screen (src/ui/menu.js). It
// follows the account (src/account/account.js): a new name or a new look shows at once.
// Its portrait is drawn in the game (once the menu's lobby is up): until then the card shows the last one
// drawn of this avatar, kept on the device (one JPEG, about 30 kB, guarded like every storage access),
// or a plain plate on a first visit — never another look's face.
import { makePortrait } from './portrait.js';
import { avatarKey, outfitOf } from '../data/wardrobe.js';
import { SEAT_COLORS } from '../table.js';

const CARD_KEY = 'hotelEscape.cardPortrait.v1';
function remembered(key) {
  try {
    const v = JSON.parse(globalThis.localStorage?.getItem(CARD_KEY) || 'null');
    return v && v.key === key && typeof v.data === 'string' && v.data.startsWith('data:image/') ? v.data : null;
  } catch { return null; }
}
function remember(key, url) {
  if (!url || url.startsWith('data:') || remembered(key)) return;
  fetch(url).then(r => r.blob()).then(b => new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(b);
  })).then(data => {
    try { globalThis.localStorage?.setItem(CARD_KEY, JSON.stringify({ key, data })); } catch { /* the device keeps nothing: fine */ }
  }).catch(() => {});
}

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
      const pic = makePortrait(doc, { id: 'me', name: p.username, color: SEAT_COLORS[0], avatar: p.avatar, outfit: outfitOf(p.avatar) },
        { first: remembered(key), plate: true, onReady: url => remember(key, url) });
      if (pic.tagName === 'IMG') { pic.alt = ''; pic.decoding = 'async'; pic.draggable = false; }
      face.replaceChildren(pic);
    }
  }

  btn.addEventListener('click', e => { e.preventDefault(); if (guard(e)) return; onOpen?.(); });
  account?.onChange?.(() => render());
  render();
  return { render };
}
