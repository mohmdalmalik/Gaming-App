// "Sign the register": the username screen (#menu-signup in index.html), in two modes:
//   signup   the first visit: Welcome · Sign the register · [Suggest a name] [Continue] → the main menu
//   rename   Change name (from the avatar screen): Change your name, filled in · [Cancel] [Save] → back
// The panel is anchored to the top of the screen (styles.css .menu.signup), so the name field and its
// buttons stay above the iPad's on-screen keyboard. The rules of a name are src/account/username.js;
// the account (src/account/account.js) keeps it. Checked when Continue (or Enter) is pressed, then
// live while typing once a name has been refused.
import { USERNAME, checkUsername, suggestUsername } from '../account/username.js';
import { startingAvatar } from '../account/profile.js';
import { settings } from '../settings.js';

const HINT = `${USERNAME.min} to ${USERNAME.max} letters or numbers; _ is allowed too.`;
const WORDS = {
  signup: { kicker: 'Welcome to Hotel Escape', title: 'Sign the register', left: 'Suggest a name', go: 'Continue',
    note: 'The name the other guests will know you by. Kept on this device for now; you can change it later.' },
  rename: { kicker: 'Your avatar', title: 'Change your name', left: 'Cancel', go: 'Save',
    note: 'The name the other guests will know you by.' },
};
// One note at most under the panel, for what this device can or cannot keep (src/account/account.js):
const NOTES = {
  // nothing saved, and nothing can be (blocked storage, a private window)
  private: "This device isn't keeping your name (private browsing?). It lasts until you close the page.",
  // a saved profile, but changes cannot be saved now (storage full, or blocked since)
  unsaved: "This device can't save changes right now (storage full?). Your new name lasts until you close the page.",
  // the saved profile is a newer version's: it is never written over
  newer: 'Hotel Escape has been updated: please reload the page. Until then, changes are not kept.',
  // a saved name a newer version of the rules no longer allows
  nameLost: 'Your name can no longer be used: please choose another. Your avatar is kept.',
};
const SAVE_FAILED = 'Could not save your name. Try again.';

export function createRegister(doc, { account, guard = () => false, onDone } = {}) {
  const $ = id => doc.getElementById(id);
  const input = $('su-name'), hint = $('su-hint'), count = $('su-count'), form = $('su-form');
  const left = $('btn-su-suggest'), go = $('btn-su-go');
  let mode = 'signup';
  let live = false;          // checking while typing (after a refused name)
  let busy = false;
  if (!input || !form) return { open() {}, shown() {}, get mode() { return mode; } };
  input.maxLength = USERNAME.max;

  const setHint = (text, bad) => { hint.textContent = text; hint.classList.toggle('bad', !!bad); input.classList.toggle('bad', !!bad); input.setAttribute('aria-invalid', String(!!bad)); };
  const setCount = () => { if (count) count.textContent = `${input.value.length} / ${USERNAME.max}`; };
  function check() {
    const r = checkUsername(input.value);
    if (r.ok || !input.value.trim()) setHint(HINT, !r.ok && live && !!input.value.trim());
    else setHint(r.message, true);
    return r;
  }

  function render() {
    const w = WORDS[mode];
    $('su-kicker').textContent = w.kicker;
    $('su-title').textContent = w.title;
    left.textContent = w.left;
    go.textContent = w.go;
    const note = account?.readOnly ? NOTES.newer
      : mode === 'signup' && account?.nameLost ? NOTES.nameLost
      : account && !account.persistent ? (mode === 'rename' ? NOTES.unsaved : NOTES.private) : '';
    // (the "Kept on this device" line only where it is true: never above a note that says otherwise)
    $('su-device').textContent = note && mode === 'signup' ? WORDS.rename.note : w.note;
    const priv = $('su-private');
    if (priv) { priv.textContent = note; priv.hidden = !note; }
  }

  async function submit() {
    if (busy) return;
    const r = checkUsername(input.value);
    if (!r.ok) { live = true; setHint(r.message, true); return; }
    input.blur();
    busy = true;
    try {
      const res = mode === 'rename' ? await account.rename(r.name)
        : await account.signUp(r.name, { avatar: startingAvatar(r.name, settings.get('guest')) });
      if (!res.ok) { live = true; setHint(res.error || 'That name cannot be used.', true); return; }
      onDone?.(mode);
    } catch (err) {
      // (a server account can fail: say so, and let the player try again)
      console.warn('Saving the name failed:', err);
      setHint(SAVE_FAILED, true);
    } finally { busy = false; }
  }

  input.addEventListener('input', () => {
    // (no spaces: typed ones become _, which is what most people mean)
    if (/\s/.test(input.value)) { const at = input.selectionStart; input.value = input.value.replace(/\s/g, '_'); try { input.setSelectionRange(at, at); } catch { /* fine */ } }
    setCount();
    if (live) check();
  });
  form.addEventListener('submit', e => { e.preventDefault(); submit(); });
  go.addEventListener('click', e => { e.preventDefault(); if (guard(e)) return; submit(); });
  left.addEventListener('click', e => {
    e.preventDefault();
    if (guard(e)) return;
    if (mode === 'rename') { input.blur(); onDone?.('rename'); return; }
    input.value = suggestUsername(Math.random, { avoid: [input.value] });
    setCount();
    live = false;
    check();
  });

  return {
    get mode() { return mode; },
    // Set the mode (and fill the field) before the screen shows.
    open(m = 'signup') {
      mode = m === 'rename' ? 'rename' : 'signup';
      live = false;
      input.value = mode === 'rename' ? account?.profile?.username || '' : (account?.profile?.username || input.value || '');
      setCount();
      setHint(HINT, false);
      render();
    },
    // The screen is showing (src/ui/menu.js).
    shown() { render(); setCount(); },
  };
}
