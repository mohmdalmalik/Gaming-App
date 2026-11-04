// The main menu: the first thing on screen, over the lobby (src/menu/lobbyScene.js renders the lobby
// behind it; main.js blurs it). Small screens in one panel:
//   signup       "Sign the register": the first visit asks for a username (src/ui/register.js); the
//                same screen changes it later ("Change name" on the avatar screen: showRename)
//   main         your profile card ("Playing as <name> · Wardrobe ›", src/ui/profileCard.js),
//                Single player · Co-op (the two ways to play) · How to play and Cards side by side (both open a
//                read-only screen above the menu: src/ui/howToPlay.js, src/ui/cardsGuide.js), then Settings and
//                Your record side by side
//   single       Single player: Play with bots · Practice alone (with a hint under it for a player who has played
//                nothing yet), ‹ Back
//   coop         Co-op: start a private table or join one by its code, or the one card that says it is coming soon
//                or why a table can't be joined (src/ui/coopMenu.js; every word: src/data/onlineText.js)
//   table        Your private table, Co-op's waiting room (src/ui/coopMenu.js)
//   avatar       the Wardrobe: your avatar (#menu-avatar, built by src/ui/wardrobe/wardrobe.js)
//   bots         how many other guests (3-5) and your role (random, clean, possessed)
//   matchmaking  the table filling up, guest by guest, as in an online game
//   settings     bot speed, the view on other guests' turns, graphics, the menu background, music,
//                sound effects, quick chat beside clearer possessed eyes (for colour blindness: read when a
//                game is set up, src/main.js planGame), and tips (each applied at once, through onSettingChanged;
//                "Show tips again" brings back the tips already seen: src/ui/tips.js; the version of the
//                game in a quiet line at the bottom: src/version.js)
//   record       your record on this device (src/ui/record.js), with a reset that asks first
// Choices are remembered on this device (src/settings.js); who you are is the account's
// (src/account/account.js). Nothing here touches the game itself: main.js gets the choice through the
// callbacks and starts the match. A guest joining the table rings the reception bell (the sound cue
// bus, src/audio/bus.js). `onScreenChange(name, prev)` hears every change of screen (the lobby's camera
// follows it: the wardrobe frames your avatar).
// Co-op, kept here so src/main.js needs no change for it: the links ?join=CODE (straight to that table, after the
// register if this device has no profile yet) and ?friends=demo (the review link: two seats on one device), read on
// the first show (with neither, a table remembered from the last 6 hours is rejoined); the Wardrobe's Done going back
// to the waiting room while a table is open; a new look sent to the table; and `onCoopMatch(coop)`, which main.js
// passes once a Co-op match can be played (until then the waiting room says the match was dealt). Development only,
// on localhost: ?coop=fake (a pretend server, src/net/fakeLobby.js, loaded only then) and ?coop=soon (the Coming soon
// card).
import { rules } from '../data/rules.js';
import { settings, SETTING_CHOICES } from '../settings.js';
import { reducedMotion } from '../motion.js';
import { sfx } from '../audio/bus.js';
import { tooSoon } from './tapGuard.js';
import { createRegister } from './register.js';
import { createProfileCard } from './profileCard.js';
import { createRecordScreen } from './record.js';
import { record } from '../record.js';
import { renderTipsAgain } from './tips.js';
import { versionLine } from '../version.js';
import { NEW_PLAYER_HINT } from '../data/howToPlay.js';
import { ONLINE_TEXT, fill } from '../data/onlineText.js';
import { createCoopMenu } from './coopMenu.js';
import { resolveServer, isLocalHost } from '../net/serverUrl.js';
import { openCoop, rememberedTable } from '../net/onlineTable.js';
import { normaliseCode } from '../net/codes.js';

const ROLE_CHOICES = [
  { value: 'random', label: 'Random', note: 'Like a real table: you are told your role when the game starts. Usually you are a clean guest.' },
  { value: 'clean', label: 'Clean guest', note: 'Find Lanterns, trust carefully, and get one clean guest out through the Fire Exit before dawn.' },
  { value: 'possessed', label: 'Possessed', note: 'You start possessed, with souls of your own (your face on each). Win their trust, then give one in a trade.' },
];
const BOT_CHOICES = Array.from({ length: rules.maxBots - rules.minBots + 1 }, (_, i) => rules.minBots + i);     // the computer guests to play with: 3, 4 or 5 (rules.js: a table of 4 to 6)

export function createMenu(doc, { onPlayBots, onPractice, onSettingChanged, onScreenChange, onHowToPlay, onCards, account = null,
  onCoopMatch = null, onCoopSeat = null, loc = globalThis.location } = {}) {
  const $ = id => doc.getElementById(id);
  const root = $('menu');
  // (looked up when shown: a screen another module adds to the page, #menu-avatar, is found too)
  const SCREENS = ['signup', 'main', 'single', 'coop', 'table', 'avatar', 'bots', 'matchmaking', 'settings', 'record'];
  const screenEl = name => $(`menu-${name}`);
  const btn = { single: $('btn-menu-single'), coop: $('btn-menu-coop'), bots: $('btn-menu-bots'), practice: $('btn-menu-practice'), settings: $('btn-menu-settings'), record: $('btn-menu-record'), howto: $('btn-menu-howto'), cards: $('btn-menu-cards') };
  const recordView = createRecordScreen(doc);
  let current = 'main';
  let ready = false;
  let mmTimers = [];
  let shownAt = 0;   // when the current screen opened: its buttons ignore the second tap of the double
                     // tap that opened it (src/ui/tapGuard.js). Re-rendering after a pick does not reset it.

  // --- Co-op (src/ui/coopMenu.js) -----------------------------------------------------------------------------------
  const params = new URLSearchParams(loc?.search || '');
  const local = isLocalHost(loc);
  const fake = local && params.get('coop') === 'fake';      // development: the pretend server (never on the live site)
  let fakeLobby = null;
  const loadFake = () => (fakeLobby ||= import('../net/fakeLobby.js').then(m => {
    const h = m.fakeHooks;
    if (params.get('fake')) h.script(params.get('fake'));
    if (params.get('fakeErr')) h.nextError(params.get('fakeErr'));
    if (params.get('fakeDelay')) h.delay(params.get('fakeDelay'));
    if (params.get('pace') === 'fast') h.timeScale(20);
    globalThis.__fakeLobby = h;
    return m;
  }));
  if (fake) loadFake();
  const serverFor = () => (fake ? { url: 'fake://hotel' } : resolveServer(loc, params));
  const coop = createCoopMenu(doc, {
    text: ONLINE_TEXT,
    resolveServer: serverFor,
    openCoop: fake ? async o => (await loadFake()).openFakeCoop(o) : openCoop,
    onMatch: onCoopMatch,
    onSeat: onCoopSeat,
    onSinglePlayer: () => show('single'),
    account,
    sfx,
    go: name => show(name),
    menuScreen: () => (root.hidden ? null : current),
    guard: e => tooSoon(e, shownAt),
  });
  // (tests and development, on localhost only: where Co-op is, and any one of its cards on demand)
  if (local) globalThis.__coop = { state: () => coop.debug(), card: (kind, vars) => coop.showCard(kind, vars) };

  // ?join=CODE and ?friends=demo, read once, on the first show (after the register if there is no profile yet).
  // With neither, a table this device sat at in the last 6 hours (src/net/onlineTable.js keeps the record) is
  // rejoined: "Rejoining your table…" · Cancel (DESIGN §11.5). Never on the live site while Co-op is coming soon.
  let linksRead = false;
  let links = null;
  function readLinks() {
    linksRead = true;
    const join = params.get('join');
    const demo = params.get('friends') === 'demo';
    if (join == null && !demo) {
      if (!fake && (!account || account.profile) && !serverFor().comingSoon && rememberedTable()) Promise.resolve().then(() => coop.resume());
      return;
    }
    links = { join, demo };
    if (account && !account.profile) {
      // the register first: "You're invited to nora's table." above it, when the table can be asked
      if (join != null && !demo && !serverFor().comingSoon) {
        coop.peek(normaliseCode(join) || join).then(host => {
          if (current === 'signup' && links) register.invite(host ? fill(ONLINE_TEXT.coop.invited, { host }) : ONLINE_TEXT.coop.invitedAny);
        });
      }
      return;
    }
    Promise.resolve().then(followLinks);
  }
  function followLinks() {
    const l = links;
    links = null;
    register.invite(null);
    if (!l) return false;
    if (l.demo) { if (current === 'signup') show('main'); startDemo(); } else coop.openJoin(l.join);
    return true;
  }
  // The review link: two seats on this device, through the real Co-op screens, on any host (it is the owner's link).
  // Its server runs inside the page (src/net/loopback.js, ticked every 250 ms); if it can't load, the link simply
  // opens the menu.
  async function startDemo() {
    try {
      if (fake) await coop.startDemo({});
      else {
        const { createLoopback } = await import('../net/loopback.js');
        const loop = createLoopback({ people: 2, timeScale: local && params.get('pace') === 'fast' ? 20 : 1 });
        if (typeof loop?.tick === 'function') setInterval(() => { try { loop.tick(Date.now()); } catch (err) { console.error(err); } }, 250);
        await coop.startDemo({ openCoop, resolveServer: () => ({ url: 'loopback://hotel' }), transport: loop.WebSocketImpl });
      }
    } catch (err) { console.warn('the review link could not open its test table:', err); return; }
    show('coop');
  }

  function show(name = 'main') {
    if (!SCREENS.includes(name) || !screenEl(name)) name = 'main';
    // (no profile yet: the register comes first, whatever was asked for)
    if (account && !account.profile && name !== 'signup') { register.open('signup'); name = 'signup'; }
    // Co-op: the Wardrobe's Done (main.js asks for 'main') goes back to the waiting room while a table is open; the
    // waiting room with no table is the Co-op screen, and the Co-op screen while seated is the waiting room
    if (name === 'main' && current === 'avatar' && !root.hidden && coop.hasTable) name = 'table';
    if (name === 'coop' || name === 'table') name = coop.screenFor(name);
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
    if (name === 'main' || name === 'single') renderHint();
    if (name === 'coop' || name === 'table') coop.show(name);
    if (name === 'bots') renderBots();
    if (name === 'settings') { renderSettings(); screenEl('settings').scrollTop = 0; }   // (it opens at its top, the version line showing, if it scrolls: styles.css "Settings > Version")
    if (name === 'record') { recordView.confirm(false); recordView.render(); }
    if (name === 'signup') register.shown();
    try { onScreenChange?.(name, prev); } catch (err) { console.error('menu screen change failed:', err); }
    if (!linksRead) readLinks();
  }

  // The register: first run (then the main menu), or Change name from the avatar screen (then back).
  const register = createRegister(doc, {
    account,
    guard: e => tooSoon(e, shownAt),
    // (a Co-op link waited for the register: its table now)
    onDone: (mode) => { if (mode === 'rename') show('avatar'); else if (!followLinks()) show('main'); },
  });
  // A new look (the Wardrobe's Save look, another tab) reaches the Co-op table you sit at.
  account?.onChange?.(p => { if (p?.avatar) coop.look(p.avatar); });
  // The profile card on the main menu: it opens the Wardrobe (the avatar screen).
  const card = createProfileCard(doc, { account, onOpen: () => show('avatar'), guard: e => tooSoon(e, shownAt) });

  // A row of buttons where exactly one is chosen (radio buttons that look like a segmented control).
  // (`unavailable(option)`: a choice the device rules out right now is shown dimmed and cannot be tapped)
  function segment(host, options, value, onPick, unavailable = null) {
    host.innerHTML = '';
    for (const o of options) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'seg-btn' + (o.value === value ? ' on' : '');
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o.value === value));
      b.dataset.value = String(o.value);
      b.textContent = o.label;
      if (unavailable?.(o)) { b.disabled = true; b.setAttribute('aria-disabled', 'true'); }
      b.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; onPick(o.value); });
      host.appendChild(b);
    }
  }

  // Under "Practice alone", for a player who has played no match and finished no practice yet (your record,
  // src/record.js): the soft way in. It goes for good once either is counted.
  function renderHint() {
    const hint = $('menu-hint');
    if (!hint) return;
    const r = record.get();
    const fresh = !r.played && !r.practiceEscapes;
    hint.textContent = fresh ? NEW_PLAYER_HINT : '';
    hint.hidden = !fresh;
  }

  function renderBots() {
    const n = BOT_CHOICES.includes(+settings.get('bots')) ? +settings.get('bots') : rules.maxBots;
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
      // (Reduce Motion is on: the lobby stays Still whatever is chosen, so Animated cannot be chosen, and the
      // row says why: src/motion.js)
      const still = name === 'menuMotion' && reducedMotion();
      segment(host, SETTING_CHOICES[name], settings.choice(name)?.value, v => {
        settings.set(name, v);
        renderSettings();
        onSettingChanged?.(name, v);
      }, still ? o => o.value === 'on' : null);
      if (name === 'menuMotion') { const why = $('set-menuMotion-why'); if (why) why.hidden = !still; }
    }
    renderTipsAgain($('btn-tips-again'), settings, {
      guard: e => tooSoon(e, shownAt),
      after: () => { renderSettings(); onSettingChanged?.('tips', 'on'); },
    });
    const version = $('set-version'); if (version) version.textContent = versionLine();   // (which build this is: src/version.js)
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
  // The two ways to play: Single player (once the hotel has opened, as its two buttons) and Co-op.
  click(btn.single, () => { if (ready) show('single'); });
  click(btn.coop, () => { coop.enter(); show('coop'); });
  click($('btn-single-back'), () => show('main'));
  click(btn.bots, () => { if (ready) show('bots'); });
  // (no profile — another tab cleared it — : the register first, as for every screen)
  click(btn.practice, () => { if (!ready) return; if (account && !account.profile) { show('main'); return; } onPractice?.({}); });
  click(btn.settings, () => show('settings'));
  click(btn.record, () => show('record'));
  // How to play opens over the menu (src/ui/howToPlay.js); Close gives the focus back to this button.
  click(btn.howto, () => onHowToPlay?.({ focusBack: btn.howto }));
  // Cards opens the same way (src/ui/cardsGuide.js): a read-only list above the menu; Close gives the focus back here.
  click(btn.cards, () => onCards?.({ focusBack: btn.cards }));
  click($('btn-bots-back'), () => show('single'));
  click($('btn-bots-find'), () => {
    const n = BOT_CHOICES.includes(+settings.get('bots')) ? +settings.get('bots') : rules.maxBots;
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
      if (btn.single) btn.single.disabled = false;
      const loading = $('menu-loading'); if (loading) loading.hidden = true;
    },
    matchmake,
    // Co-op, for the match (src/main.js): the seat shown (the review link holds two), its switch, and leaving the table.
    get coopSeat() { return coop.seat; },
    get coopSwitch() { return coop.switcher; },
    leaveCoop: () => coop.leaveAll(),
  };
}
