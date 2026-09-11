// On-screen interface: the top players strip, the bottom-left active-player panel (portrait,
// name, health, AP), the face-down hand with a live count, the action buttons, a move-confirm
// bar and toasts. Portraits are placeholder SVGs (see ui/portrait.js) so real faces can drop
// in later without changing this logic.
import { activePlayer, nextPlayer } from './game/state.js';
import { canSearch } from './game/actions.js';
import { rules } from './data/rules.js';
import { lanternCount } from './game/cards.js';
import { makePortrait } from './ui/portrait.js';

const MAX_BACKS = 8; // face-down cards drawn before we just rely on the count badge

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    strip: doc.getElementById('players-strip'),
    room: doc.getElementById('room-name'),
    round: doc.getElementById('round'),
    panel: doc.getElementById('player-panel'),
    portrait: doc.getElementById('portrait-slot'),
    name: doc.getElementById('active-player'),
    health: doc.getElementById('health'),
    ap: doc.getElementById('action-points'),
    search: doc.getElementById('btn-search'),
    endTurn: doc.getElementById('btn-end-turn'),
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
  let mini = null;            // the top-strip player cells
  let portraitKey = '';       // so the panel portrait only rebuilds when it must

  // Top strip: one small (always-normal) portrait per player, built once for the roster.
  function buildStrip(state) {
    el.strip.innerHTML = '';
    mini = state.players.map(p => {
      const cell = doc.createElement('div');
      cell.className = 'mini-player';
      cell.style.setProperty('--player-color', p.color);
      const tag = doc.createElement('div'); tag.className = 'turn-tag';
      const port = doc.createElement('div'); port.className = 'mini-portrait';
      port.appendChild(makePortrait(doc, p, { possessed: false })); // never reveal roles here
      const name = doc.createElement('div'); name.className = 'mini-name'; name.textContent = p.name;
      cell.append(tag, port, name);
      el.strip.appendChild(cell);
      return { cell, tag };
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

      // Active-player panel.
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
      el.ap.textContent = `AP ${p.actionPoints} / ${rules.actionPointsPerTurn}`;
      el.ap.classList.toggle('empty', p.actionPoints === 0);
      el.tint.hidden = !p.possessed;               // subtle possessed screen wash

      el.room.textContent = floor.rooms.get(p.currentRoom)?.name ?? '—';
      el.round.textContent = `Round ${state.round}`;
      el.endTurn.textContent = state.finished ? 'Game over' : next && next !== p ? `End turn → ${next.name}` : 'End turn';
      el.endTurn.disabled = state.finished;
      el.search.disabled = !canSearch(state, floor, p).ok;

      renderHand(p.hand.length);

      // Top strip.
      if (!mini || mini.length !== state.players.length) buildStrip(state);
      state.players.forEach((q, i) => {
        mini[i].cell.classList.toggle('active', i === state.activeIndex && !state.finished);
        mini[i].cell.classList.toggle('dead', !q.alive);
        mini[i].tag.textContent = (i === state.activeIndex && !state.finished) ? 'TURN' : '';
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
