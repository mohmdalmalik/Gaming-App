// On-screen interface: whose turn it is, health, action points, the turn order, the action
// bar (search / hand / end turn), a move-confirm bar, and short toast messages.
import { activePlayer, nextPlayer } from './game/state.js';
import { canSearch } from './game/actions.js';
import { rules } from './data/rules.js';
import { lanternCount } from './game/cards.js';

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    player: doc.getElementById('active-player'),
    playerName: doc.querySelector('#active-player .pill-name'),
    tell: doc.getElementById('possessed-tell'),
    health: doc.getElementById('health'),
    room: doc.getElementById('room-name'),
    round: doc.getElementById('round'),
    order: doc.getElementById('turn-order'),
    ap: doc.getElementById('action-points'),
    search: doc.getElementById('btn-search'),
    hand: doc.getElementById('btn-hand'),
    endTurn: doc.getElementById('btn-end-turn'),
    rotateLeft: doc.getElementById('btn-rotate-left'),
    rotateRight: doc.getElementById('btn-rotate-right'),
    map: doc.getElementById('btn-map'),
    toast: doc.getElementById('toast'),
    confirmBar: doc.getElementById('confirm-bar'),
    confirmText: doc.getElementById('confirm-text'),
    confirmMove: doc.getElementById('btn-confirm-move'),
    confirmCancel: doc.getElementById('btn-confirm-cancel'),
  };
  let toastTimer = 0;
  let chips = null;

  function buildOrder(state) {
    el.order.innerHTML = '';
    chips = state.players.map(p => {
      const chip = doc.createElement('div');
      chip.className = 'chip';
      chip.style.setProperty('--player-color', p.color);
      chip.innerHTML = `<span class="dot"></span><span class="chip-name"></span><span class="hp"></span>`;
      chip.querySelector('.chip-name').textContent = p.name;
      el.order.appendChild(chip);
      return chip;
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

  const hud = {
    show() { el.root.hidden = false; },
    hide() { el.root.hidden = true; },
    update(state, floor) {
      const p = activePlayer(state);
      const next = nextPlayer(state);
      el.player.style.setProperty('--player-color', p.color);
      el.playerName.textContent = `${p.name}'s turn`;
      el.tell.hidden = !p.possessed;               // hot-seat: the active player sees their own tell
      renderHealth(p.health);
      el.room.textContent = floor.rooms.get(p.currentRoom)?.name ?? '—';
      el.round.textContent = `Round ${state.round}`;
      el.ap.textContent = `AP: ${p.actionPoints} / ${rules.actionPointsPerTurn}`;
      el.ap.classList.toggle('empty', p.actionPoints === 0);
      el.endTurn.textContent = state.finished ? 'Game over' : next && next !== p ? `End turn → ${next.name}` : 'End turn';
      el.endTurn.disabled = state.finished;
      el.search.disabled = !canSearch(state, floor, p).ok;
      if (!chips || chips.length !== state.players.length) buildOrder(state);
      state.players.forEach((q, i) => {
        chips[i].classList.toggle('active', i === state.activeIndex);
        chips[i].classList.toggle('dead', !q.alive);
        chips[i].querySelector('.hp').textContent = q.alive ? '♥'.repeat(q.health) : '✝';
      });
    },
    // The Exit Key hint used by the hand panel / toasts.
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
    onConfirm(move, cancel) {
      el.confirmMove.addEventListener('click', e => { e.preventDefault(); move(); });
      el.confirmCancel.addEventListener('click', e => { e.preventDefault(); cancel(); });
    },
  };
  return hud;
}
