// The main menu: the first thing on screen, over the lobby (src/menu/lobbyScene.js renders the lobby
// behind it; main.js blurs it). Four small screens in one panel:
//   main         Play with bots · Practice alone · Settings
//   bots         how many other guests (3-5) and your role (random, clean, possessed)
//   matchmaking  the table filling up, guest by guest, as in an online game
//   settings     bot speed, the view on other guests' turns, graphics, the menu background
// Choices are remembered on this device (src/settings.js). Nothing here touches the game itself:
// main.js gets the choice through the callbacks and starts the match.
import { settings, SETTING_CHOICES } from '../settings.js';

const ROLE_CHOICES = [
  { value: 'random', label: 'Random', note: 'Like a real table: you are told your role when the game starts. Usually you are a clean guest.' },
  { value: 'clean', label: 'Clean guest', note: 'Find Lanterns, trust carefully, and get one clean guest out through the Fire Exit before dawn.' },
  { value: 'possessed', label: 'Possessed', note: 'You start possessed with the Possession cards. Win their trust, then pass a Possession card in a trade.' },
];
const BOT_CHOICES = [3, 4, 5];

export function createMenu(doc, { onPlayBots, onPractice, onSettingChanged } = {}) {
  const $ = id => doc.getElementById(id);
  const root = $('menu');
  const screens = { main: $('menu-main'), bots: $('menu-bots'), matchmaking: $('menu-matchmaking'), settings: $('menu-settings') };
  const btn = { bots: $('btn-menu-bots'), practice: $('btn-menu-practice'), settings: $('btn-menu-settings') };
  let current = 'main';
  let ready = false;
  let mmTimers = [];

  function show(name = 'main') {
    current = name;
    root.hidden = false;
    root.classList.remove('leaving');
    for (const [k, el] of Object.entries(screens)) el.hidden = k !== name;
    if (name === 'bots') renderBots();
    if (name === 'settings') renderSettings();
  }

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
      b.addEventListener('click', e => { e.preventDefault(); onPick(o.value); });
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
  }

  // The table fills up like an online lobby: you first, then each other guest "joins" after a short,
  // uneven wait. `seats`: [{ name, username, color, you }] in the order they arrive. `onFull` runs a
  // moment after the last one is in; Cancel goes back to the bots screen.
  function matchmake(seats, { onFull, onCancel }) {
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
      li.querySelector('.mm-name').textContent = s.you ? 'You' : s.username;
      li.querySelector('.mm-guest').textContent = s.you ? `playing ${s.name}` : s.name;
    };
    fill(0);
    let t = 350;
    for (let i = 1; i < total; i++) {
      // Uneven gaps, as people really join: mostly quick, now and then a longer wait.
      t += 380 + Math.random() * 900 + (Math.random() < 0.2 ? 700 : 0);
      mmTimers.push(setTimeout(() => {
        fill(i);
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
  function clearMatchmaking() { mmTimers.forEach(clearTimeout); mmTimers = []; }

  const click = (el, fn) => el.addEventListener('click', e => { e.preventDefault(); fn(); });
  click(btn.bots, () => { if (ready) show('bots'); });
  click(btn.practice, () => { if (ready) onPractice?.(); });
  click(btn.settings, () => show('settings'));
  click($('btn-bots-back'), () => show('main'));
  click($('btn-bots-find'), () => {
    const n = BOT_CHOICES.includes(+settings.get('bots')) ? +settings.get('bots') : 5;
    onPlayBots?.({ bots: n, role: settings.get('role') || 'random' });
  });
  click($('btn-mm-cancel'), () => { cancelHandler?.(); cancelHandler = null; show('bots'); });
  click($('btn-settings-done'), () => show('main'));

  return {
    get isOpen() { return !root.hidden; },
    get screen() { return root.hidden ? null : current; },
    show,
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
