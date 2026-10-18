// The wardrobe: the avatar screen of the main menu (#menu-avatar; src/ui/menu.js shows it as 'avatar').
// (The W1 stand-in, kept working on avatar v2 until the new wardrobe screen replaces it.) Your username with "Change
// name", then, in order: Male / Female (which shows that body's three classic Looks), the Look, Skin tone, Hair, Eyes,
// Glasses (and Frame while glasses with a frame colour are on), Outfit, Accent (only with a tie, bow tie or sash) and
// Jewellery (only with something metal). Every choice shows at once on your own avatar in the menu's 3D lobby
// (main.js turns the lobby's wardrobe camera on for this screen: onPreview), and is kept when you leave the screen
// (Done, or Change name), through the account (src/account/account.js setAvatar: made safe there, owned items only).
// An avatar that mixes pieces (a bot-rolled first look) shows no Look chosen ("Your own mix") and keeps its pieces
// until a Look is picked.
// Unlockable items (src/data/wardrobe.js: 'achievement' and 'boutique') carry a small mark (a rosette: an
// achievement; a diamond: the Boutique) and their row says what they will be; while the catalogue's testing switch
// is on they can be worn, "unlocked for testing". With it off, one not owned shows a lock,
// says how it is had, and cannot be chosen. The list scrolls inside the panel; the page never does. While a new look is
// still on its way (onPreview's promise: true shown, false could not be) the Look row says "Loading…"; a look that
// cannot be shown says so under the panel (the choice is still kept). Plain words, no emoji. Nothing here touches the
// game.
import { GENDERS, ITEMS, LOOK_LABELS, SLOT_LABELS, applyLook, canWear, genderOf, isFree, item, itemsFor,
  labelOf, lookOf, looksFor, normaliseAvatar, slotsFor, unlockedForTesting, withBody, withItem, COLOUR_SLOTS, SLOTS_BY_GENDER } from '../data/wardrobe.js';
import { achievement } from '../data/achievements.js';
import { tooSoon } from './tapGuard.js';

const LOCK = '<svg class="av-lock" viewBox="0 0 12 14" aria-hidden="true"><path d="M3.2 6V4.4a2.8 2.8 0 0 1 5.6 0V6" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="1.4" y="6" width="9.2" height="7" rx="1.6" fill="currentColor"/></svg>';
// the marks of the two kinds of unlockable item: a rosette (an achievement), a diamond (the Boutique)
const ROSETTE = '<svg class="av-mark" viewBox="0 0 12 14" aria-hidden="true"><path d="M3.6 8.2 2.4 13l3.6-1.6L9.6 13 8.4 8.2" fill="currentColor" opacity="0.75"/><circle cx="6" cy="5.2" r="4.2" fill="currentColor"/><circle cx="6" cy="5.2" r="2" fill="#0f1118"/></svg>';
const DIAMOND = '<svg class="av-mark" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 0.8 11.2 6 6 11.2 0.8 6Z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6 3.6 8.4 6 6 8.4 3.6 6Z" fill="currentColor"/></svg>';
const SOON = 'Coming soon';
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// The colour rows and the glasses, in the screen's order (the pieces themselves come with the new wardrobe).
const ROWS = ['skin', 'hair', 'eyes', 'glasses', 'frame', 'main', 'accent', 'metal'];

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
  let told = null;                  // { slot, id }: the unlockable item last tapped (its row says what it is)
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
  const wearable = it => canWear(it, working.body, owns);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const chosen = slot => (COLOUR_SLOTS.includes(slot) ? working.colours[slot] : working[slot]);
  // What an unlockable item will be: "Achievement: Seen through" / "Achievement: a later honour" / "Boutique · opens
  // later", then "unlocked for testing" while the switch makes it wearable.
  function kindOf(it) {
    if (!it || isFree(it)) return '';
    const what = it.unlock === 'achievement'
      ? `Achievement: ${achievement(it.achievement)?.label || 'a later honour'}` : 'Boutique · opens later';
    return unlockedForTesting(it, owns) ? `${what} · unlocked for testing` : wearable(it) ? what : `${what} · ${SOON.toLowerCase()}`;
  }

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
    preview();
    render();
  }

  // ---- rows ----
  function row(slot, label, caption, inner, { chips = false, kind = '', locked = false } = {}) {
    return `<div class="av-row" data-slot="${slot}">
      <div class="av-label"><span class="av-slot">${esc(label)}</span><span class="av-caption">${caption}</span></div>
      ${kind ? `<div class="av-kind">${locked ? LOCK : ''}<span>${esc(kind)}</span></div>` : ''}
      <div class="av-opts${chips ? ' chips' : ''}" role="radiogroup" aria-label="${esc(label)}">${inner}</div></div>`;
  }
  const markOf = it => (isFree(it) ? '' : it.unlock === 'achievement' ? ROSETTE : DIAMOND);
  function chip(slot, id, label, on, it = null) {
    const locked = !!it && !wearable(it), kind = kindOf(it);
    return `<button type="button" class="av-chip${on ? ' on' : ''}${locked ? ' locked' : ''}${kind ? ' unlockable' : ''}" role="radio" aria-checked="${on}"
      data-slot="${slot}" data-id="${esc(id)}"${kind ? ` aria-label="${esc(label)}, ${esc(kind.toLowerCase())}"` : ''}>
      <span class="av-chip-main">${locked ? LOCK : it ? markOf(it) : ''}${esc(label)}</span>${locked ? `<span class="av-chip-soon">${SOON}</span>` : ''}</button>`;
  }
  function swatch(it, on) {
    const locked = !wearable(it), kind = kindOf(it), label = labelOf(it, working.body);
    const badge = locked ? LOCK : markOf(it);
    return `<button type="button" class="av-sw${on ? ' on' : ''}${locked ? ' locked' : ''}${kind ? ' unlockable' : ''}" role="radio" aria-checked="${on}"
      data-slot="${it.slot}" data-id="${esc(it.id)}" aria-label="${esc(label)}${kind ? `, ${esc(kind.toLowerCase())}` : ''}" title="${esc(label)}${kind ? ` (${esc(kind)})` : ''}">
      <span class="av-dot" style="background:${swatchStyle(it)}"></span>${badge ? `<span class="av-badge">${badge}</span>` : ''}</button>`;
  }

  function render() {
    const av = working;
    if (!av) return;
    const keep = body.scrollTop;
    const html = [];
    const gender = genderOf(av.body), look = lookOf(av);
    html.push(row('body', 'Body', '', GENDERS.map(g => chip('body', g.id, g.label, g.id === gender)).join(''), { chips: true }));
    // (the Look row keeps the data-slot 'base' of the v1 screen: its styles and tests)
    const lookCaption = look ? LOOK_LABELS[look] : 'Your own mix';
    html.push(row('base', SLOT_LABELS.look, lookLoading ? `${esc(lookCaption)} · Loading…` : esc(lookCaption),
      looksFor(gender).map(id => chip('base', id, LOOK_LABELS[id], id === look)).join(''), { chips: true }));
    const shown = slotsFor(av);
    for (const slot of ROWS.filter(s => shown.includes(s))) {
      const list = itemsFor(slot, av.body);
      const cur = item(slot, chosen(slot));
      let label = SLOT_LABELS[slot];
      if (slot === 'accent') {
        const by = SLOTS_BY_GENDER[gender].map(s => item(s, av[s])).find(it => it?.colours.includes('accent'));
        if (by) label = `${label} · ${labelOf(by, av.body)}`;
      }
      // (the item this row talks about: the unlockable one just tapped, else the one worn)
      const about = told?.slot === slot ? item(slot, told.id) : cur;
      const kind = kindOf(about), locked = !!about && !wearable(about);
      const caption = esc(about && about !== cur ? labelOf(about, av.body) : slot === 'glasses' ? '' : labelOf(cur, av.body));
      const inner = slot === 'glasses'
        ? list.map(it => chip(slot, it.id, labelOf(it, av.body), it.id === chosen(slot), it)).join('')
        : list.map(it => swatch(it, it.id === chosen(slot))).join('');
      html.push(row(slot, label, caption, inner, { chips: slot === 'glasses', kind, locked }));
    }
    body.innerHTML = html.join('');
    body.scrollTop = keep;
    if (nameEl) { const n = account?.profile?.username || ''; nameEl.textContent = n; nameEl.title = n; }
    if (noteEl) noteEl.textContent = account?.readOnly
      ? 'Hotel Escape has been updated: please reload the page. Until then, changes are not kept.'
      : account && account.persistent === false
        ? 'This device is not keeping your choices (private browsing?): they last until you close the page.'
        : previewBad ? 'Preview unavailable — your choices are still saved.'
          : ITEMS.some(it => unlockedForTesting(it, owns)) ? 'Marked colours (achievements and the Boutique) are unlocked for testing.'
            : 'More outfits and accessories are coming soon.';
  }

  // ---- taps ----
  body.addEventListener('click', e => {
    const b = e.target.closest('button[data-slot]');
    if (!b || !working) return;
    e.preventDefault();
    if (tooSoon(e, openedAt)) return;
    const slot = b.dataset.slot, id = b.dataset.id;
    if (slot === 'body') { told = null; if (id !== genderOf(working.body)) pick(withBody(working, id, { owns })); return; }
    if (slot === 'base') {
      // a classic Look: its pieces, your colours and your glasses kept
      told = null;
      if (id !== lookOf(working)) pick(withItem(applyLook(working, id, { keepColours: true, owns }), 'glasses', working.glasses, { owns }));
      return;
    }
    const it = item(slot, id);
    if (!it) return;
    told = isFree(it) ? null : { slot, id };
    if (!wearable(it)) { render(); return; }      // (locked: the row says how it is had; nothing changes)
    if (chosen(slot) === id) { render(); return; }
    pick(withItem(working, slot, id, { owns }));
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
      told = null;
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
    get avatar() { return working ? JSON.parse(JSON.stringify(working)) : null; },
    // (tests) what the screen shows: the rows, each with its choices, the chosen one, the locked ones and the
    // unlockable ones (marked)
    debug() {
      return {
        open: isOpen, avatar: working ? JSON.parse(JSON.stringify(working)) : null,
        rows: [...body.querySelectorAll('.av-row')].map(r => ({
          slot: r.dataset.slot,
          label: r.querySelector('.av-slot')?.textContent || '',
          caption: r.querySelector('.av-caption')?.textContent || '',
          kind: r.querySelector('.av-kind')?.textContent || '',
          options: [...r.querySelectorAll('button[data-id]')].map(b => b.dataset.id),
          on: r.querySelector('button.on')?.dataset.id ?? null,
          locked: [...r.querySelectorAll('button.locked')].map(b => b.dataset.id),
          unlockable: [...r.querySelectorAll('button.unlockable')].map(b => b.dataset.id),
        })),
      };
    },
  };
}
