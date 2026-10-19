// The Hotel Honours page (#honours-overlay; the look: wardrobe.css): your achievements and the pieces they earn,
// which are never sold. Opened from the wardrobe's top bar (the Honours pill), from a details card's "See
// achievement" (the page opens at that achievement), and from the end screen's achievement line (#end-honours).
// Over the whole screen, a soft dark glass:
//   - left: "Hotel Honours", how many are earned, a filter (All / In progress / Earned) and how achievements work, in
//     plain words (checked on the end screen only; practice, test links and idle matches earn nothing; a win counts
//     for the side you started on; what you earn is yours for good);
//   - right: one row per achievement (src/data/achievements.js): its medal, its name and task, how far you have come
//     (a bar and "2 of 3", or "Earned 19 Oct"), and the piece it earns, with its picture. From the wardrobe, tapping
//     that piece tries it on (the page closes onto the stage).
// Progress is read from src/honours.js (this device). Nothing here changes it: achievements are checked on the end
// screen only (src/main.js), never during a match. Keyboard: the page keeps the focus while it is open (src/ui/focus.js),
// Escape or Done closes it and the focus goes back where it was.
import { ACHIEVEMENTS } from '../data/achievements.js';
import { itemById, labelOf, isPending, genderOf } from '../data/wardrobe.js';
import { watchDialog } from './focus.js';
import { tooSoon } from './tapGuard.js';
import { ensureIcons, ic } from './wardrobe/icons.js';
import { progressText } from './wardrobe/areas.js';
import { thumbFor } from './wardrobe/wardrobe.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Each achievement's medal (an engraved icon).
const MEDAL = { seenThrough: 'i-mirror', savedByTheLight: 'i-lantern', lamplighter: 'i-lantern', goodCompany: 'i-handshake', darkHorse: 'i-horse' };
const AREA_ICON = { glasses: 'i-glasses', extra: 'i-extras', hairStyle: 'i-hair', top: 'i-outfit', dress: 'i-outfit', facial: 'i-stache' };
const FILTERS = [{ id: 'all', label: 'All' }, { id: 'progress', label: 'In progress' }, { id: 'earned', label: 'Earned' }];
const dateOf = iso => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } catch { return ''; } };

export function createHonoursPage(doc, { honours, account, onTryOn = null } = {}) {
  const $ = id => doc.getElementById(id);
  const overlay = $('honours-overlay');
  const list = $('hn-list'), side = $('hn-side');
  if (!overlay || !list) return { open() {}, close() {}, get isOpen() { return false; } };
  ensureIcons(doc);
  let filter = 'all', from = null, openedAt = 0, at = null;

  const bodyNow = () => account?.profile?.avatar?.body || 'm';
  const progressOf = id => { try { return honours?.progressOf?.(id) || { have: 0, goal: 1, earned: false }; } catch { return { have: 0, goal: 1, earned: false }; } };
  const earnedAt = id => { try { return honours?.get?.().earned?.[id] || null; } catch { return null; } };

  function row(a) {
    const p = progressOf(a.id);
    const it = itemById(a.item);
    const b = bodyNow();
    const name = it ? labelOf(it, b) : 'A new piece';
    const pending = !it || isPending(it, b);
    const src = it && !pending ? thumbFor(b, it.slot, it.id) : null;
    const pic = src ? `<img src="${esc(src)}" alt="" draggable="false">` : `<span class="hn-ic">${ic(AREA_ICON[it?.slot] || 'i-rosette')}</span>`;
    const have = Math.min(p.have, a.goal);
    const pg = p.earned
      ? `${ic('i-check')}<span>Earned${earnedAt(a.id) ? ` ${esc(dateOf(earnedAt(a.id)))}` : ''}</span>`
      : `<span class="hn-bar"><i style="width:${Math.max(3, Math.round(100 * have / a.goal))}%"></i></span><span>${have} of ${a.goal}</span>`;
    const canTry = !!onTryOn && from === 'wardrobe' && !pending && it && genderFits(it, b);
    const reward = `<span class="hn-th">${pic}<span class="${p.earned ? 'hn-ok' : 'hn-lk'}">${ic(p.earned ? 'i-check' : 'i-lock')}</span></span><span class="hn-rn">${esc(name)}</span>`;
    const words = `${a.label}. ${a.desc} ${p.earned ? 'Earned.' : `${have} of ${a.goal}.`} Earns ${name}${p.earned ? ', yours' : ''}.`;
    return `<div class="hn-row${p.earned ? ' done' : ''}${a.id === at ? ' at' : ''}" role="listitem" data-ach="${a.id}" aria-label="${esc(words)}">
      <span class="hn-medal">${ic(MEDAL[a.id] || 'i-rosette')}</span>
      <div class="hn-bd"><div class="hn-tt">${esc(a.label)}</div><div class="hn-ds">${esc(a.desc)}</div><div class="hn-pg">${pg}</div></div>
      ${canTry ? `<button type="button" class="hn-rw" data-try="${esc(a.item)}" aria-label="Try on ${esc(name)}" title="Try it on">${reward}<span class="hn-try">Try it on</span></button>`
        : `<div class="hn-rw">${reward}${pending ? '<span class="hn-try soon">Coming soon</span>' : ''}</div>`}</div>`;
  }
  const genderFits = (it, b) => !Array.isArray(it.bodies) || it.bodies.some(x => genderOf(x) === genderOf(b));
  // The one closest to being earned (the most of its way done), shown large at the top where the screen is tall enough.
  function hero(rows) {
    const open = rows.filter(r => !r.p.earned);
    const b = bodyNow();
    if (!open.length) {
      return `<div class="hn-hero done" role="listitem"><span class="hn-medal big">${ic('i-rosette')}</span><div class="hn-hero-b">
        <div class="hn-kicker">Every honour earned</div><div class="hn-hero-t">The hotel salutes you</div>
        <div class="hn-hero-d">Each piece is yours for good. New honours come with new pieces.</div></div></div>`;
    }
    // (the most of its way done; on a tie, one whose piece is in the game already, so it can be tried on)
    const share = r => Math.min(r.p.have, r.a.goal) / r.a.goal;
    const ready = r => { const it = itemById(r.a.item); return it && !isPending(it, b) ? 1 : 0; };
    const best = open.reduce((x, r) => (share(r) > share(x) || (share(r) === share(x) && ready(r) > ready(x)) ? r : x), open[0]);
    const { a, p } = best, it = itemById(a.item), have = Math.min(p.have, a.goal);
    const pending = !it || isPending(it, b), name = it ? labelOf(it, b) : 'A new piece';
    const src = it && !pending ? thumbFor(b, it.slot, it.id) : null;
    const canTry = !!onTryOn && from === 'wardrobe' && !pending && it && genderFits(it, b);
    return `<div class="hn-hero" role="listitem" data-ach="${a.id}" aria-label="${esc(`Closest to earning: ${a.label}. ${a.desc} ${have} of ${a.goal}. Earns ${name}.`)}">
      <span class="hn-medal big">${ic(MEDAL[a.id] || 'i-rosette')}</span>
      <div class="hn-hero-b"><div class="hn-kicker">${have ? 'Closest to earning' : 'A good one to start with'}</div><div class="hn-hero-t">${esc(a.label)}</div>
        <div class="hn-hero-d">${esc(a.desc)}</div>
        <div class="hn-pg"><span class="hn-bar"><i style="width:${Math.max(3, Math.round(100 * have / a.goal))}%"></i></span><span>${have} of ${a.goal}</span></div></div>
      <div class="hn-hero-rw"><span class="hn-th big">${src ? `<img src="${esc(src)}" alt="" draggable="false">` : `<span class="hn-ic">${ic(AREA_ICON[it?.slot] || 'i-rosette')}</span>`}</span>
        <span class="hn-rn">${esc(name)}</span>
        ${canTry ? `<button type="button" class="wd-btn hn-hero-try" data-try="${esc(a.item)}">Try it on</button>` : pending ? '<span class="hn-try soon">Coming soon</span>' : ''}</div></div>`;
  }

  function render() {
    const rows = ACHIEVEMENTS.map(a => ({ a, p: progressOf(a.id) }));
    const earned = rows.filter(r => r.p.earned).length;
    const shown = rows.filter(r => filter === 'all' || (filter === 'earned' ? r.p.earned : !r.p.earned));
    const count = { all: rows.length, progress: rows.length - earned, earned };
    side.innerHTML = `
      <div><div class="hn-kicker">Hotel Honours</div><h2 id="hn-title" class="hn-title">Achievements</h2></div>
      <p class="hn-tag">Play well to earn pieces money can’t buy. What you earn is yours for good.</p>
      <div class="hn-sum"><span class="hn-badge">${ic('i-rosette')}</span><div><div class="hn-big">${earned} <small>of ${rows.length}</small></div><div class="hn-lb">achievements earned</div></div></div>
      <div class="hn-cats" role="tablist" aria-label="Show">${FILTERS.map(f => `<button type="button" class="hn-cat${f.id === filter ? ' on' : ''}" role="tab" aria-selected="${f.id === filter}" data-filter="${f.id}" data-sfx="select">${esc(f.label)}<span class="n">${count[f.id]}</span></button>`).join('')}</div>
      <div class="hn-how"><b>How they work</b>
        <span>Checked when a match ends, never during one.</span>
        <span>A win counts for the side you started on.</span>
        <span>Practice and test links don’t count.</span>
        <span>Earned pieces are never sold.</span></div>`;
    list.innerHTML = shown.length ? (filter === 'all' ? hero(rows) : '') + shown.map(r => row(r.a)).join('') + (filter === 'all' ? '<div class="hn-row later" role="listitem"><span class="hn-medal">' + ic('i-q') + '</span><div class="hn-bd"><div class="hn-tt">More honours</div><div class="hn-ds">New achievements come with new pieces.</div></div></div>' : '')
      : `<p class="hn-empty">${filter === 'earned' ? 'Nothing earned yet. Your first honour is waiting at the end of a match.' : 'Every honour is earned. Well played.'}</p>`;
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    at = null;
  }
  overlay.addEventListener('click', e => {
    if (tooSoon(e, openedAt)) return;
    const b = e.target.closest('button');
    if (!b) { if (e.target.classList.contains('hn-scrim')) close(); return; }
    e.preventDefault();
    if (b.id === 'btn-hn-done') { close(); return; }
    if (b.dataset.filter) { filter = b.dataset.filter; at = null; render(); doc.querySelector(`#honours-overlay [data-filter="${filter}"]`)?.focus(); return; }
    if (b.dataset.try) { const id = b.dataset.try; close(); onTryOn?.(id); }
  });
  watchDialog(doc, { overlay, dialog: '.hn-sheet', labelledby: 'hn-title', escape: 'click:#btn-hn-done', main: ['#btn-hn-done'] });

  return {
    // { at: an achievement id to open at (scrolled to and lit), from: 'wardrobe' | 'end' (only the wardrobe can try a
    // piece on) }
    open({ at: id = null, from: where = null } = {}) {
      from = where; at = id; filter = 'all';
      openedAt = performance.now();
      render();
      overlay.hidden = false;
      list.scrollTop = 0;
      if (at) requestAnimationFrame(() => list.querySelector(`[data-ach="${at}"]`)?.scrollIntoView?.({ block: 'nearest' }));
    },
    close,
    get isOpen() { return !overlay.hidden; },
    debug() {
      return { open: !overlay.hidden, filter, at, rows: [...list.querySelectorAll('.hn-row[data-ach]')].map(r => ({ id: r.dataset.ach, earned: r.classList.contains('done'), at: r.classList.contains('at'), canTry: !!r.querySelector('[data-try]'), text: r.querySelector('.hn-pg')?.textContent.trim() || '' })) };
    },
  };
}

