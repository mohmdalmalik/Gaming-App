// On-screen interface: whose turn it is, the turn order, room name, action points,
// rotate / end turn / map buttons, and short toast messages.
import { activePlayer, nextPlayer } from './game/state.js';

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    player: doc.getElementById('active-player'),
    room: doc.getElementById('room-name'),
    round: doc.getElementById('round'),
    order: doc.getElementById('turn-order'),
    ap: doc.getElementById('action-points'),
    endTurn: doc.getElementById('btn-end-turn'),
    rotateLeft: doc.getElementById('btn-rotate-left'),
    rotateRight: doc.getElementById('btn-rotate-right'),
    map: doc.getElementById('btn-map'),
    toast: doc.getElementById('toast'),
  };
  let toastTimer = 0;
  let chips = null;

  function buildOrder(state) {
    el.order.innerHTML = '';
    chips = state.players.map(p => {
      const chip = doc.createElement('div');
      chip.className = 'chip';
      chip.style.setProperty('--player-color', p.color);
      chip.innerHTML = `<span class="dot"></span><span class="chip-name"></span>`;
      chip.querySelector('.chip-name').textContent = p.name;
      el.order.appendChild(chip);
      return chip;
    });
  }

  const hud = {
    show() { el.root.hidden = false; },
    hide() { el.root.hidden = true; },
    update(state, floor) {
      const p = activePlayer(state);
      const next = nextPlayer(state);
      el.player.style.setProperty('--player-color', p.color);
      el.player.textContent = `${p.name}'s turn`;
      el.room.textContent = floor.rooms.get(p.currentRoom)?.name ?? '—';
      el.round.textContent = `Round ${state.round}`;
      el.ap.textContent = `Action points: ${p.actionPoints} / ${floor.rules.actionPointsPerTurn}`;
      el.ap.classList.toggle('empty', p.actionPoints === 0);
      el.endTurn.textContent = state.finished ? 'Game over' : next && next !== p ? `End turn → ${next.name}` : 'End turn';
      el.endTurn.disabled = state.finished;
      if (!chips || chips.length !== state.players.length) buildOrder(state);
      state.players.forEach((q, i) => {
        chips[i].classList.toggle('active', i === state.activeIndex);
        chips[i].classList.toggle('escaped', q.escaped);
      });
    },
    toast(message) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, cfg.ui.toastDuration * 1000);
    },
    on(name, fn) {
      el[name].addEventListener('click', e => { e.preventDefault(); fn(); });
    },
  };
  return hud;
}
