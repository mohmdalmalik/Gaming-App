// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the fanned
// hand opener with a live count, the turn-action buttons (with costs / reasons), a move-confirm
// bar and toasts. Portraits are illustrated placeholders (see ui/portrait.js) so real art can
// drop in later without changing this logic. Possession is never revealed on the public strip.
import { activePlayer, nextPlayer, playersInRoom } from './game/state.js';
import { canSearch } from './game/actions.js';
import { rules } from './data/rules.js';
import { lanternCount, countableCount } from './game/cards.js';
import { makePortrait } from './ui/portrait.js';

const MAX_BACKS = 8; // fanned face-down cards drawn before we rely on the count badge alone

// Plain-language reason the Search button is unavailable right now.
const SEARCH_REASON = {
  notSearchable: 'Nothing to search here',
  searched: 'Already searched',
  dark: 'Need a Flashlight',
  ap: 'No actions left',
  empty: 'Nothing left to find',
  finished: '—',
};

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    strip: doc.getElementById('players-strip'),
    room: doc.getElementById('room-name'),
    safeBadge: doc.getElementById('safe-badge'),
    round: doc.getElementById('round'),
    panel: doc.getElementById('player-panel'),
    portrait: doc.getElementById('portrait-slot'),
    name: doc.getElementById('active-player'),
    health: doc.getElementById('health'),
    apPips: doc.getElementById('ap-pips'),
    ap: doc.getElementById('action-points'),
    private: doc.getElementById('btn-private'),
    search: doc.getElementById('btn-search'),
    searchSub: doc.getElementById('search-sub'),
    trade: doc.getElementById('btn-trade'),
    endTurn: doc.getElementById('btn-end-turn'),
    endMain: doc.querySelector('#btn-end-turn .btn-main'),
    endSub: doc.getElementById('end-sub'),
    rotateLeft: doc.getElementById('btn-rotate-left'),
    rotateRight: doc.getElementById('btn-rotate-right'),
    map: doc.getElementById('btn-map'),
    handStrip: doc.getElementById('hand-strip'),
    handBacks: doc.getElementById('hand-backs'),
    handCount: doc.getElementById('hand-count'),
    tint: doc.getElementById('possess-tint'),
    toast: doc.getElementById('toast'),
    confirmBar: doc.getElementById('confirm-bar'),
    confirmText: doc.getElementById('confirm-text'),
    confirmMove: doc.getElementById('btn-confirm-move'),
    confirmCancel: doc.getElementById('btn-confirm-cancel'),
  };
  let toastTimer = 0;
  let mini = null;            // the top-strip guest cells
  let portraitKey = '';       // so the panel portrait only rebuilds when it must

  // Top strip: one always-neutral portrait per guest, built once for the roster.
  function buildStrip(state) {
    el.strip.innerHTML = '';
    mini = state.players.map(p => {
      const cell = doc.createElement('div');
      cell.className = 'mini-player';
      cell.style.setProperty('--player-color', p.color);
      const flag = doc.createElement('div'); flag.className = 'mini-flag';
      const port = doc.createElement('div'); port.className = 'mini-portrait';
      port.appendChild(makePortrait(doc, p, { possessed: false })); // never reveal roles here
      const name = doc.createElement('div'); name.className = 'mini-name'; name.textContent = p.name;
      cell.append(flag, port, name);
      el.strip.appendChild(cell);
      return { cell, flag };
    });
  }

  function renderHealth(n) {
    el.health.innerHTML = '';
    for (let i = 0; i < rules.maxHealth; i++) {
      const bar = doc.createElement('span');
      bar.className = 'bar' + (i < n ? ' full' : '');
      el.health.appendChild(bar);
    }
  }

  function renderAp(n) {
    el.apPips.innerHTML = '';
    for (let i = 0; i < rules.actionPointsPerTurn; i++) {
      const pip = doc.createElement('span');
      pip.className = 'pip' + (i < n ? ' full' : '');
      el.apPips.appendChild(pip);
    }
    el.ap.textContent = `${n} / ${rules.actionPointsPerTurn}`;
    el.ap.classList.toggle('empty', n === 0);
  }

  function renderHand(count) {
    const shown = Math.min(count, MAX_BACKS);
    if (el.handBacks.childElementCount !== shown) {
      el.handBacks.innerHTML = '';
      for (let i = 0; i < shown; i++) {
        const b = doc.createElement('div'); b.className = 'card-back'; el.handBacks.appendChild(b);
      }
    }
    el.handCount.textContent = String(count);
  }

  const hud = {
    show() { el.root.hidden = false; },
    hide() { el.root.hidden = true; },
    update(state, floor) {
      const p = activePlayer(state);
      const next = nextPlayer(state);

      // Active-player panel (this is the current guest's own private view).
      el.panel.style.setProperty('--player-color', p.color);
      el.panel.classList.toggle('possessed', p.possessed);
      const key = `${p.index}:${p.possessed}:${p.outfit}`;
      if (key !== portraitKey) {
        portraitKey = key;
        el.portrait.innerHTML = '';
        el.portrait.appendChild(makePortrait(doc, p, { possessed: p.possessed }));
      }
      el.name.textContent = p.name;
      renderHealth(p.health);
      renderAp(p.actionPoints);
      el.tint.hidden = !p.possessed;               // subtle possessed screen wash

      // Header.
      const room = floor.rooms.get(p.currentRoom);
      el.room.textContent = room?.name ?? '—';
      el.safeBadge.hidden = !room?.safe;
      el.round.textContent = `Round ${state.round}`;

      // End turn (prominent; names the next guest).
      if (state.finished) { el.endMain.textContent = 'Game over'; el.endSub.textContent = ''; el.endTurn.disabled = true; }
      else { el.endMain.textContent = 'End turn ›'; el.endSub.textContent = next && next !== p ? `Next: ${next.name}` : 'Refill actions'; el.endTurn.disabled = false; }

      // Search: cost when available, plain-language reason when not.
      const gate = canSearch(state, floor, p);
      el.search.disabled = !gate.ok;
      el.searchSub.textContent = gate.ok ? '1 action' : (SEARCH_REASON[gate.reason] || 'Unavailable');

      // Voluntary trade: only in a SAFE room when someone else is present to trade with.
      const safeRoom = !!room?.safe;
      el.trade.hidden = !(safeRoom && !state.finished && playersInRoom(state, p.currentRoom, p.id).length > 0);

      // Public card count excludes Possession cards, so it can never reveal a possessed role.
      renderHand(countableCount(p.hand));

      // Top strip: current-turn + next-player indicators.
      if (!mini || mini.length !== state.players.length) buildStrip(state);
      const nextIdx = !state.finished && next ? next.index : -1;
      state.players.forEach((q, i) => {
        const active = i === state.activeIndex && !state.finished;
        mini[i].cell.classList.toggle('active', active);
        mini[i].cell.classList.toggle('next', i === nextIdx && !active);
        mini[i].cell.classList.toggle('dead', !q.alive);
        mini[i].flag.textContent = active ? 'Your turn' : (i === nextIdx ? 'Next' : '');
      });
    },
    lanternHint(player) { return `${lanternCount(player.hand)} / ${rules.lanternsToEscape} Lanterns`; },
    toast(message) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, cfg.ui.toastDuration * 1000);
    },
    showConfirm(text, moveLabel) {
      el.confirmText.textContent = text;
      if (moveLabel) el.confirmMove.textContent = moveLabel;
      el.confirmBar.hidden = false;
    },
    hideConfirm() { el.confirmBar.hidden = true; },
    get confirmOpen() { return !el.confirmBar.hidden; },
    on(name, fn) { el[name].addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onHand(fn) {
      const open = e => { e.preventDefault(); fn(); };
      el.handStrip.addEventListener('click', open);
      el.handStrip.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(e); });
    },
    onConfirm(move, cancel) {
      el.confirmMove.addEventListener('click', e => { e.preventDefault(); move(); });
      el.confirmCancel.addEventListener('click', e => { e.preventDefault(); cancel(); });
    },
  };
  return hud;
}
