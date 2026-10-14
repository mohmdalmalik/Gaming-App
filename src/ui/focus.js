// Keyboard focus for the screens that cover the game: the private screens (the secret role, a search's find,
// the trade pick and its result, hand-over notes, the Hand Mirror), the discard and meeting screens, a yes/no
// question, a notice, the end screen, a problem card, the card view and the map. Before this, focus stayed on
// the game's buttons behind them: with the secret role open, Tab reached "Main menu" underneath. While one of
// them is open:
//   - focus moves to its main button (where that button waits for a choice: the first card),
//   - Tab and Shift+Tab stay inside it,
//   - a screen reader is told it is a modal dialog (role="dialog", aria-modal="true", a name),
//   - Escape does not skip a private screen (it does the safe thing where the screen has a plain "no" or a close
//     button: see `escape`),
//   - and when it closes, focus goes back to where it was.
// Nothing here reads or shows anything private: it only moves focus between elements that are already there.
//
// It is a watcher: a dialog is "open" while its overlay has no `hidden` attribute, so the screens' own code
// (src/ui/handoff.js, discard.js, meeting.js, src/overlays.js, hand.js, map.js) needs no change, and a screen
// that shows or hides itself in any way is covered. Reusable: `watchDialog(doc, spec)` for one screen (the
// in-match Menu panel can use it), `watchDialogs(doc)` for the list below (src/main.js calls it once).
//
//   spec.overlay     the element (or its id) that is shown and hidden with the `hidden` attribute
//   spec.dialog      selector, inside the overlay, of the box that is the dialog (default: the overlay itself)
//   spec.labelledby  the id of the element that names it (its title), or spec.label: the name as words
//   spec.main        selectors, in order: the first that matches a shown, enabled element gets the focus
//   spec.escape      'ignore' (default: Escape does nothing), or 'click:<selector>': Escape presses that button
//
// While a screen is open and one of its buttons goes (the screen draws its next step in place), focus is put back
// on the same button if it is still there, else on the main one, so a keyboard user is never left on nothing.

const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]';

const shown = el => !!el && el.isConnected && !el.closest('[hidden], [inert]') && el.getClientRects().length > 0;
const usable = el => shown(el) && !el.disabled && el.getAttribute('aria-disabled') !== 'true';
const tabbable = root => [...root.querySelectorAll(FOCUSABLE)].filter(e => e.tabIndex >= 0 && usable(e));
const place = el => { try { el.focus({ preventScroll: true }); } catch { /* an element that cannot take focus */ } };
// A way to find the same element again after the screen has drawn itself anew: its id, or a card's id.
const keyOf = el => (el.id ? `#${CSS.escape(el.id)}` : el.dataset?.cardId ? `[data-card-id="${CSS.escape(el.dataset.cardId)}"]` : null);

const open = [];          // the dialogs that are open, the one on top last: { dialog, spec, from, lastKey }
let listening = false;

function main(entry) {
  const doc = entry.dialog.ownerDocument;
  for (const sel of entry.spec.main || []) {
    for (const el of doc.querySelectorAll(sel)) if (entry.dialog.contains(el) && usable(el)) return el;
  }
  return null;
}
function focusMain(entry) {
  const target = main(entry) || tabbable(entry.dialog)[0] || entry.dialog;
  place(target);
}

function onKey(e) {
  const top = open[open.length - 1];
  if (!top || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
  const doc = top.dialog.ownerDocument;
  if (e.key === 'Escape') {
    // (a private screen is never skipped by it; a question or a viewer you opened yourself takes its plain way out)
    const way = /^click:(.+)$/.exec(top.spec.escape || '');
    const btn = way && [...doc.querySelectorAll(way[1])].find(b => top.dialog.contains(b) && usable(b));
    e.preventDefault(); e.stopImmediatePropagation();
    if (btn) btn.click();
    return;
  }
  if (e.key !== 'Tab') return;
  e.preventDefault();                                    // (the focus is placed here, so it can never leave the dialog)
  const items = tabbable(top.dialog);
  if (!items.length) { place(top.dialog); return; }
  const now = items.findIndex(x => x === doc.activeElement || x.contains(doc.activeElement));
  const to = e.shiftKey ? (now <= 0 ? items.length - 1 : now - 1) : (now < 0 || now === items.length - 1 ? 0 : now + 1);
  place(items[to]);
}

// Start watching one screen. Returns { release() }, which stops it (and closes it as far as focus goes).
export function watchDialog(doc, spec) {
  const overlay = typeof spec.overlay === 'string' ? doc.getElementById(spec.overlay) : spec.overlay;
  if (!overlay) return { release() {} };
  const dialog = spec.dialog ? overlay.querySelector(spec.dialog) : overlay;
  if (!dialog) return { release() {} };
  if (!dialog.getAttribute('role')) dialog.setAttribute('role', 'dialog');           // (an alert dialog stays one)
  dialog.setAttribute('aria-modal', 'true');
  if (spec.labelledby) dialog.setAttribute('aria-labelledby', spec.labelledby);
  else if (spec.label) dialog.setAttribute('aria-label', spec.label);
  if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1;                        // (so it can hold the focus when nothing in it can)
  if (!listening) { listening = true; doc.addEventListener('keydown', onKey, true); }

  let entry = null;
  const enter = () => {
    const from = doc.activeElement;
    entry = { dialog, spec, from: from && from !== doc.body && !dialog.contains(from) ? from : null, lastKey: null };
    open.push(entry);
    focusMain(entry);
  };
  const leave = () => {
    const gone = entry; entry = null;
    const at = open.indexOf(gone); if (at >= 0) open.splice(at, 1);
    const top = open[open.length - 1];
    // (a screen that opened in the same moment this one closed was told to give focus back to a button of this one:
    // it gives it back to where this one found it)
    for (const o of open) if (!usable(o.from)) o.from = gone.from;
    if (top) { if (!top.dialog.contains(doc.activeElement) || !usable(doc.activeElement)) focusMain(top); return; }
    if (usable(gone.from)) place(gone.from);
  };
  const sync = () => { const on = !overlay.hidden; if (on && !entry) enter(); else if (!on && entry) leave(); };
  // The screen draws its next step in place (a new set of buttons): if the focus was on one that is gone, it goes
  // to the same one again, or to the main one.
  const repair = () => {
    if (!entry) return;
    const at = doc.activeElement;
    if (at && dialog.contains(at) && usable(at)) return;
    const same = entry.lastKey && dialog.querySelector(entry.lastKey);
    if (same && usable(same)) place(same); else focusMain(entry);
  };
  const watch = new MutationObserver(records => {
    sync();
    if (entry && records.some(r => r.target !== overlay || r.type !== 'attributes')) repair();
  });
  watch.observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  if (dialog !== overlay) watch.observe(dialog, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  else watch.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
  dialog.addEventListener('focusin', e => { if (entry) entry.lastKey = keyOf(e.target); });
  sync();
  return { release() { watch.disconnect(); if (entry) leave(); } };
}

// The screens of the game, with the button each one opens on. (The in-match Menu panel and How to play keep
// the focus themselves, in src/ui/gameMenu.js and howToPlay.js; the same list entry would do for them.)
export const DIALOGS = [
  // Every private screen is one overlay: the secret role, the turn's start, the trade pick (Give, once a card is
  // lifted; first a card), a yes/no, a note, the Hand Mirror, a search's find, and the trade's result.
  { overlay: 'handoff-overlay', dialog: '#handoff-card', labelledby: 'handoff-title',
    main: ['#btn-offer-give', '#offer-cards .card-tile', '#offer-intent .btn.on', '#offer-intent .btn', '#btn-handoff-next'] },
  { overlay: 'discard-overlay', dialog: '.modal', labelledby: 'discard-title',
    main: ['#btn-discard-done', '#discard-cards .card-tile'] },
  { overlay: 'encounter-overlay', dialog: '.modal', labelledby: 'encounter-title',
    main: ['#encounter-actions .btn.primary', '#encounter-actions .btn', '#encounter-body .card-tile'] },
  { overlay: 'ask-overlay', dialog: '.card', labelledby: 'ask-title', escape: 'click:#btn-ask-no',
    main: ['#btn-ask-no.primary', '#btn-ask-yes.primary', '#btn-ask-no'] },
  { overlay: 'notice-overlay', dialog: '.card', labelledby: 'notice-title', main: ['#btn-notice-ok'] },
  { overlay: 'end-overlay', dialog: '.card', labelledby: 'end-title', main: ['#end-overlay .btn.primary', '#btn-end-menu'] },
  // (the problem card's overlay is itself the alert dialog, in index.html)
  { overlay: 'error-overlay', main: ['#btn-error-reload', '#btn-error-menu'] },
  { overlay: 'hand-overlay', dialog: '.cv-panel', labelledby: 'hand-title', escape: 'click:#btn-hand-close',
    main: ['#hand-detail .btn.primary', '#btn-hand-close'] },
  { overlay: 'map-overlay', dialog: '.map-panel', label: 'Hotel floor plan', escape: 'click:#btn-map-close', main: ['#btn-map-close'] },
];
export function watchDialogs(doc, specs = DIALOGS) { return specs.map(s => watchDialog(doc, s)); }
