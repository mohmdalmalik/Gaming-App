// The wardrobe: the avatar screen of the main menu (#menu-avatar; src/ui/menu.js shows it as 'avatar').
// Your username with "Change name", then, in order: Male / Female (which shows that body's three looks),
// the look, Skin tone, Hair, Eyes, Glasses (and Frame while glasses are on), Outfit, Accent (only where
// the look has a tie, bow tie or sash) and Jewellery (the gowns). Every choice shows at once on your own
// avatar in the menu's 3D lobby (main.js turns the lobby's wardrobe camera on for this screen: onPreview),
// and is kept when you leave the screen (Done, or Change name), through the account
// (src/account/account.js setAvatar: made safe there, owned items only).
// Locked items (src/data/wardrobe.js, unlock 'earn' / 'shop') show with a lock and "Coming soon" and
// cannot be chosen: nothing can be bought or earned yet. The list scrolls inside the panel; the page
// never does. While a new look is still on its way (onPreview's promise: true shown, false could not be)
// the Look row says "Loading…"; a look that cannot be shown says so under the panel (the choice is
// still kept). Plain words, no emoji. Nothing here touches the game.
import { BASES, BODIES, SLOT_LABELS, basesFor, bodyOf, item, itemsFor, isAvailable, normaliseAvatar,
  slotsFor, withBase, withBody } from '../data/wardrobe.js';
import { tooSoon } from './tapGuard.js';

const LOCK = '<svg class="av-lock" viewBox="0 0 12 14" aria-hidden="true"><path d="M3.2 6V4.4a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="1.4" y="6" width="9.2" height="7" rx="1.6" fill="currentColor"/></svg>';
const SOON = 'Coming soon';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The look of a swatch (CSS background) for an item.
function swatchStyle(it) {
  if (it.slot === 'eyes') {
    if (!it.value) return 'radial-gradient(circle at 38% 34%, #3a3440 0 8%, #120e14 9% 100%)';
    const [rim, mid, core] = it.value;
    return `radial-gradient(circle at 36% 30%, #fff8f0 0 10%, transparent 11%), radial-gradient(circle at 56% 66%, ${core} 0 22%, ${mid} 48%, ${rim} 78%)`;
  }
  if (it.slot === 'frame') return `radial-gradient(circle, #14161e 0 46%, ${it.value} 48% 74%, #14161e 76%)`;
  return it.value;
}

export function createAvatarEditor(doc, { account, onPreview, onDone, onRename } = {}) {
  const $ = id => doc.getElementById(id);
  const host = $('menu-avatar');
  const body = $('av-body'), nameEl = $('av-name'), noteEl = $('av-note');
  const btnDone = $('btn-av-done'), btnRename = $('btn-av-rename');
  const menuRoot = $('menu');
  let working = null, saved = null, openedAt = 0, isOpen = false;
  let soon = null;                  // { slot, id }: the locked item last tapped (its row says "Coming soon")
  let lookLoading = false, previewBad = false, previewSeq = 0;   // (the preview of a new look: on its way / failed)
  if (!host || !body) return { open() {}, close() {}, get isOpen() { return false; }, debug: () => null };

  // The panel sits at the top of the screen while the wardrobe is open (styles.css .menu.avatar), so a
  // row that comes or goes (Frame, Accent, Jewellery) moves only the rows below it; it gets there at once,
  // with no slide (as the register does).
  const anchor = on => {
    if (!menuRoot || menuRoot.classList.contains('avatar') === on) return;
    menuRoot.classList.add('snap');
    menuRoot.classList.toggle('avatar', on);
    void menuRoot.offsetWidth;
    requestAnimationFrame(() => menuRoot.classList.remove('snap'));
  };
  const owns = id => !!account?.owns?.(id);
  const wearable = it => isAvailable(it, owns);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function preview() {
    const seq = ++previewSeq;
    let r = null;
    try { r = onPreview?.(working); } catch (err) { console.warn('wardrobe preview failed:', err); }
    lookLoading = !!(r && typeof r.then === 'function');
    if (!lookLoading) return;
    r.then(ok => {
      if (seq !== previewSeq) return;
      lookLoading = false;
      if (ok === true || ok === false) previewBad = !ok;
      if (isOpen) render();
    }, () => { if (seq === previewSeq) { lookLoading = false; previewBad = true; if (isOpen) render(); } });
  }
  function pick(av) {
    working = normaliseAvatar(av, { owns });
    soon = null;
    preview();
    render();
  }

  // ---- rows ----
  function row(slot, label, caption, inner, { chips = false } = {}) {
    return `<div class="av-row" data-slot="${slot}">
      <div class="av-label"><span class="av-slot">${esc(label)}</span><span class="av-caption">${caption}</span></div>
      <div class="av-opts${chips ? ' chips' : ''}" role="radiogroup" aria-label="${esc(label)}">${inner}</div></div>`;
  }
  const captionFor = (slot, current) => {
    if (soon?.slot === slot) { const it = item(slot, soon.id); return `${LOCK}<span>${esc(it?.label || '')} · ${SOON}</span>`; }
    return esc(current || '');
  };
  function chip(slot, id, label, on, locked = false) {
    return `<button type="button" class="av-chip${on ? ' on' : ''}${locked ? ' locked' : ''}" role="radio" aria-checked="${on}"
      data-slot="${slot}" data-id="${esc(id)}"${locked ? ` aria-label="${esc(label)}, ${SOON.toLowerCase()}"` : ''}>
      <span class="av-chip-main">${locked ? LOCK : ''}${esc(label)}</span>${locked ? `<span class="av-chip-soon">${SOON}</span>` : ''}</button>`;
  }
  function swatch(it, on) {
    const locked = !wearable(it);
    return `<button type="button" class="av-sw${on ? ' on' : ''}${locked ? ' locked' : ''}" role="radio" aria-checked="${on}"
      data-slot="${it.slot}" data-id="${esc(it.id)}" aria-label="${esc(it.label)}${locked ? `, ${SOON.toLowerCase()}` : ''}" title="${esc(it.label)}${locked ? ` (${SOON})` : ''}">
      <span class="av-dot" style="background:${swatchStyle(it)}"></span>${locked ? `<span class="av-badge">${LOCK}</span>` : ''}</button>`;
  }

  function render() {
    const av = working;
    if (!av) return;
    const keep = body.scrollTop;
    const html = [];
    const body0 = bodyOf(av.base);
    html.push(row('body', 'Body', '', BODIES.map(b => chip('body', b.id, b.label, b.id === body0)).join(''), { chips: true }));
    html.push(row('base', SLOT_LABELS.base, lookLoading ? `${esc(BASES[av.base].label)} · Loading…` : esc(BASES[av.base].label),
      basesFor(body0).map(b => chip('base', b, BASES[b].label, b === av.base)).join(''), { chips: true }));
    for (const slot of slotsFor(av)) {
      const list = itemsFor(slot, av.base);
      const cur = item(slot, av[slot]);
      let label = SLOT_LABELS[slot];
      if (slot === 'accent' && BASES[av.base].accentLabel) label = `${label} · ${BASES[av.base].accentLabel}`;
      if (slot === 'glasses') {
        html.push(row(slot, label, captionFor(slot, ''), list.map(it => chip(slot, it.id, it.label, it.id === av[slot], !wearable(it))).join(''), { chips: true }));
      } else {
        html.push(row(slot, label, captionFor(slot, cur?.label), list.map(it => swatch(it, it.id === av[slot])).join('')));
      }
    }
    body.innerHTML = html.join('');
    body.scrollTop = keep;
    if (nameEl) { const n = account?.profile?.username || ''; nameEl.textContent = n; nameEl.title = n; }
    if (noteEl) noteEl.textContent = account?.readOnly
      ? 'Hotel Escape has been updated: please reload the page. Until then, changes are not kept.'
      : account && account.persistent === false
        ? 'This device is not keeping your choices (private browsing?): they last until you close the page.'
        : previewBad ? 'Preview unavailable — your choices are still saved.'
          : 'More outfits and accessories are coming soon.';
  }

  // ---- taps ----
  body.addEventListener('click', e => {
    const b = e.target.closest('button[data-slot]');
    if (!b || !working) return;
    e.preventDefault();
    if (tooSoon(e, openedAt)) return;
    const slot = b.dataset.slot, id = b.dataset.id;
    if (slot === 'body') { if (id !== bodyOf(working.base)) pick(withBody(working, id, { owns })); return; }
    if (slot === 'base') { if (id !== working.base) pick(withBase(working, id, { owns })); return; }
    const it = item(slot, id);
    if (!it) return;
    if (!wearable(it)) { soon = { slot, id }; render(); return; }   // (locked: "Coming soon", nothing changes)
    if (working[slot] === id) { if (soon) { soon = null; render(); } return; }
    pick({ ...working, [slot]: id });
  });
  const click = (el, fn) => el?.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, openedAt)) return; fn(); });
  click(btnDone, () => onDone?.());
  click(btnRename, () => onRename?.());

  async function save() {
    if (!working || !account?.setAvatar || same(working, saved)) return;
    const res = await account.setAvatar(working);
    if (res?.avatar) saved = working = normaliseAvatar(res.avatar, { owns });
  }

  return {
    // The screen opened (menu 'avatar'): your saved avatar (back from Change name too: leaving saved it).
    open() {
      const profileAv = account?.profile?.avatar;
      working = normaliseAvatar(profileAv, { owns });
      saved = profileAv ? { ...working } : null;
      isOpen = true;
      openedAt = performance.now();
      soon = null;
      previewBad = false;
      anchor(true);
      preview();
      render();
      body.scrollTop = 0;
    },
    // The screen left: your choices are kept (account.setAvatar).
    close() {
      if (!isOpen) return Promise.resolve();
      isOpen = false;
      anchor(false);
      return save().catch(err => console.warn('your avatar could not be saved:', err));
    },
    get isOpen() { return isOpen; },
    get avatar() { return working ? { ...working } : null; },
    // (tests) what the screen shows: the rows, each with its choices, the chosen one and the locked ones
    debug() {
      return {
        open: isOpen, avatar: working ? { ...working } : null,
        rows: [...body.querySelectorAll('.av-row')].map(r => ({
          slot: r.dataset.slot,
          label: r.querySelector('.av-slot')?.textContent || '',
          caption: r.querySelector('.av-caption')?.textContent || '',
          options: [...r.querySelectorAll('button[data-id]')].map(b => b.dataset.id),
          on: r.querySelector('button.on')?.dataset.id ?? null,
          locked: [...r.querySelectorAll('button.locked')].map(b => b.dataset.id),
        })),
      };
    },
  };
}
