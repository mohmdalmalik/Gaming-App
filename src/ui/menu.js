// The main menu: the first thing on screen, over the lobby (src/menu/lobbyScene.js renders the lobby
// behind it; main.js blurs it). Small screens in one panel:
//   signup       "Sign the register": the first visit asks for a username (src/ui/register.js); the
//                same screen changes it later ("Change name" on the avatar screen: showRename)
//   main         your profile card ("Playing as <name> · Adjust avatar ›", src/ui/profileCard.js),
//                Play with bots · Practice alone · Settings and Your record side by side
//   avatar       your avatar (the wardrobe: #menu-avatar, built by the avatar screen's own module)
//   bots         how many other guests (3-5) and your role (random, clean, possessed)
//   matchmaking  the table filling up, guest by guest, as in an online game
//   settings     bot speed, the view on other guests' turns, graphics, the menu background, music,
//                sound effects, quick chat and tips (each applied at once, through onSettingChanged;
//                "Show tips again" brings back the tips already seen: src/ui/tips.js)
//   record       your record on this device (src/ui/record.js), with a reset that asks first
// Choices are remembered on this device (src/settings.js); who you are is the account's
// (src/account/account.js). Nothing here touches the game itself: main.js gets the choice through the
// callbacks and starts the match. A guest joining the table rings the reception bell (the sound cue
// bus, src/audio/bus.js). `onScreenChange(name, prev)` hears every change of screen (the lobby's camera
// follows it: the wardrobe frames your avatar).
import { settings, SETTING_CHOICES } from '../settings.js';
import { sfx } from '../audio/bus.js';
import { tooSoon } from './tapGuard.js';
import { createRegister } from './register.js';
import { createProfileCard } from './profileCard.js';
import { createRecordScreen } from './record.js';
import { record } from '../record.js';
import { renderTipsAgain } from './tips.js';

const ROLE_CHOICES = [
  { value: 'random', label: 'Random', note: 'Like a real table: you are told your role when the game starts. Usually you are a clean guest.' },
  { value: 'clean', label: 'Clean guest', note: 'Find Lanterns, trust carefully, and get one clean guest out through the Fire Exit before dawn.' },
  { value: 'possessed', label: 'Possessed', note: 'You start possessed, with souls of your own (your face on each). Win their trust, then give one in a trade.' },
];
const BOT_CHOICES = [3, 4, 5];

export function createMenu(doc, { onPlayBots, onPractice, onSettingChanged, onScreenChange, account = null } = {}) {
  const $ = id => doc.getElementById(id);
  const root = $('menu');
  // (looked up when shown: a screen another module adds to the page, #menu-avatar, is found too)
  const SCREENS = ['signup', 'main', 'avatar', 'bots', 'matchmaking', 'settings', 'record'];
  const screenEl = name => $(`menu-${name}`);
  const btn = { bots: $('btn-menu-bots'), practice: $('btn-menu-practice'), settings: $('btn-menu-settings'), record: $('btn-menu-record') };
  const recordView = createRecordScreen(doc);
  let current = 'main';
  let ready = false;
  let mmTimers = [];
  let shownAt = 0;   // when the current screen opened: its buttons ignore the second tap of the double
                     // tap that opened it (src/ui/tapGuard.js). Re-rendering after a pick does not reset it.

  function show(name = 'main') {
    if (!SCREENS.includes(name) || !screenEl(name)) name = 'main';
    // (no profile yet: the register comes first, whatever was asked for)
    if (account && !account.profile && name !== 'signup') { register.open('signup'); name = 'signup'; }
    const prev = root.hidden ? null : current;
    current = name;
    shownAt = performance.now();
    root.hidden = false;
    root.classList.remove('leaving');
    // (the register sits at the top, the other screens in the middle: the panel moves there at once, with
    // no slide across the screen)
    if (root.classList.contains('signup') !== (name === 'signup')) {
      root.classList.add('snap');
      root.classList.toggle('signup', name === 'signup');
      void root.offsetWidth;
      requestAnimationFrame(() => root.classList.remove('snap'));
    }
    for (const k of SCREENS) { const el = screenEl(k); if (el) el.hidden = k !== name; }
    if (name === 'main') card.render();
    if (name === 'bots') renderBots();
    if (name === 'settings') renderSettings();
    if (name === 'record') { recordView.confirm(false); recordView.render(); }
    if (name === 'signup') register.shown();
    try { onScreenChange?.(name, prev); } catch (err) { console.error('menu screen change failed:', err); }
  }

  // The register: first run (then the main menu), or Change name from the avatar screen (then back).
  const register = createRegister(doc, {
    account,
    guard: e => tooSoon(e, shownAt),
    onDone: (mode) => show(mode === 'rename' ? 'avatar' : 'main'),
  });
  // The profile card on the main menu: Adjust avatar opens the avatar screen.
  const card = createProfileCard(doc, { account, onOpen: () => show('avatar'), guard: e => tooSoon(e, shownAt) });

  // A row of buttons where exactly one is chosen (radio buttons that look like a segmented control).
  function segment(host, options, value, onPick) {
    host.innerHTML = '';
    for (const o of options) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (o.value === value ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.dataset.value = String(o.value);
      b.textContent = o.label;
      b.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; onPick(o.value); });
      host.appendChild(b);
    }
  }

  function renderBots() {
    const n = BOT_CHOICES.includes(+settings.get('bots')) ? +settings.get('bots') : 5;
    segment($('opt-bots'), BOT_CHOICES.map(v => ({ value: v, label: String(v) })), n, v => { settings.set('bots', v); renderBots(); });
    $('opt-bots-note').textContent = `A table of ${n + 1} guests: you and ${n} others.`;
    const role = ROLE_CHOICES.find(r => r.value === settings.get('role')) || ROLE_CHOICES[0];
    segment($('opt-role'), ROLE_CHOICES, role.value, v => { settings.set('role', v); renderBots(); });
    $('opt-role-note').textContent = role.note;
  }

  function renderSettings() {
    for (const name of Object.keys(SETTING_CHOICES)) {
      const host = $(`set-${name}`);
      if (!host) continue;
      segment(host, SETTING_CHOICES[name], settings.choice(name)?.value, v => {
        settings.set(name, v);
        renderSettings();
        onSettingChanged?.(name, v);
      });
    }
    renderTipsAgain($('btn-tips-again'), settings, {
      guard: e => tooSoon(e, shownAt),
      after: () => { renderSettings(); onSettingChanged?.('tips', 'on'); },
    });
  }

  // The table fills up like an online lobby: you first, then each other guest "joins" after a short,
  // uneven wait. `seats`: [{ username, color, you }] in the order they arrive (every seat shows its
  // username; yours is marked "You"). `onFull` runs a moment after the last one is in; Cancel goes back
  // to the bots screen.
  function matchmake(seats, { onFull, onCancel }) {
    mmStarted = performance.now();
    show('matchmaking');
    clearMatchmaking();
    const list = $('mm-seats');
    const total = seats.length;
    $('mm-kicker').textContent = `Play with bots · table for ${total}`;
    $('mm-title').textContent = 'Waiting for guests…';
    $('mm-note').textContent = '';
    list.innerHTML = '';
    const rows = seats.map(() => {
      const li = doc.createElement('li'); li.className = 'mm-seat empty';
      li.innerHTML = '<span class="mm-dot"></span><span class="mm-name">Waiting…</span><span class="mm-guest"></span>';
      list.appendChild(li);
      return li;
    });
    const fill = (i) => {
      const s = seats[i], li = rows[i];
      li.className = 'mm-seat joined' + (s.you ? ' you' : '');
      li.style.setProperty('--player-color', s.color);
      li.querySelector('.mm-name').textContent = s.username || s.name || 'Guest';
      li.querySelector('.mm-guest').textContent = s.you ? 'You' : '';
    };
    fill(0);
    let t = 350;
    for (let i = 1; i < total; i++) {
      // Uneven gaps, as people really join: mostly quick, now and then a longer wait.
      t += 380 + Math.random() * 900 + (Math.random() < 0.2 ? 700 : 0);
      mmTimers.push(setTimeout(() => {
        fill(i);
        sfx('joined');
        $('mm-note').textContent = i < total - 1 ? `${i + 1} of ${total} here` : '';
      }, t));
    }
    mmTimers.push(setTimeout(() => {
      $('mm-title').textContent = 'All guests are here';
      $('mm-note').textContent = 'The manager is waiting at the lift…';
    }, t + 250));
    mmTimers.push(setTimeout(() => { mmTimers = []; onFull?.(); }, t + 1300));
    cancelHandler = () => { clearMatchmaking(); onCancel?.(); };
  }
  let cancelHandler = null;
  let mmStarted = 0;
  function clearMatchmaking() { mmTimers.forEach(clearTimeout); mmTimers = []; }

  const click = (el, fn) => el.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; fn(); });
  click(btn.bots, () => { if (ready) show('bots'); });
  click(btn.practice, () => { if (ready) onPractice?.({}); });
  click(btn.settings, () => show('settings'));
  click(btn.record, () => show('record'));
  click($('btn-bots-back'), () => show('main'));
  click($('btn-bots-find'), () => {
    const n = BOT_CHOICES.includes(+settings.get('bots')) ? +settings.get('bots') : 5;
    onPlayBots?.({ bots: n, role: settings.get('role') || 'random' });
  });
  // Your record: Reset asks first, in place of the Back / Reset row (each step a fresh tap: shownAt).
  click($('btn-record-back'), () => show('main'));
  click($('btn-record-reset'), () => { shownAt = performance.now(); recordView.confirm(true); });
  click($('btn-record-keep'), () => { shownAt = performance.now(); recordView.confirm(false); });
  click($('btn-record-yes'), () => { shownAt = performance.now(); record.reset(); recordView.confirm(false); recordView.render(); });
  // (a second tap of "Find a table" lands where Cancel appears: ignore Cancel for a moment)
  click($('btn-mm-cancel'), () => {
    if (performance.now() - mmStarted < 700) return;
    cancelHandler?.(); cancelHandler = null; show('bots');
  });
  click($('btn-settings-done'), () => show('main'));

  return {
    get isOpen() { return !root.hidden; },
    get screen() { return root.hidden ? null : current; },
    show,
    // Change name (the avatar screen's button): the register in rename mode, back to the avatar screen.
    showRename() { register.open('rename'); show('signup'); },
    // Fade the panel away (the lift sequence plays behind it); hide() removes it at the end.
    leave() { root.classList.add('leaving'); },
    hide() { clearMatchmaking(); root.hidden = true; root.classList.remove('leaving'); },
    setReady() {
      ready = true;
      btn.bots.disabled = false; btn.practice.disabled = false;
      const loading = $('menu-loading'); if (loading) loading.hidden = true;
    },
    matchmake,
  };
}
