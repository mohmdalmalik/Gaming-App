// On-screen interface: room name, action points, turn, rotate / end turn / map buttons,
// and short toast messages.

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    room: doc.getElementById('room-name'),
    turn: doc.getElementById('turn'),
    ap: doc.getElementById('action-points'),
    endTurn: doc.getElementById('btn-end-turn'),
    rotateLeft: doc.getElementById('btn-rotate-left'),
    rotateRight: doc.getElementById('btn-rotate-right'),
    map: doc.getElementById('btn-map'),
    toast: doc.getElementById('toast'),
  };
  let toastTimer = 0;

  const hud = {
    show() { el.root.hidden = false; },
    hide() { el.root.hidden = true; },
    setRoom(name) { el.room.textContent = name; },
    setTurn(n) { el.turn.textContent = `Turn ${n}`; },
    setActionPoints(n, max) {
      el.ap.textContent = `Action points: ${n} / ${max}`;
      el.ap.classList.toggle('empty', n === 0);
    },
    update(state, floor) {
      hud.setRoom(floor.rooms.get(state.currentRoom)?.name ?? '—');
      hud.setTurn(state.turn);
      hud.setActionPoints(state.actionPoints, floor.rules.startActionPoints);
    },
    toast(message) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, cfg.ui.toastDuration * 1000);
    },
    on(name, fn) {
      const btn = el[name];
      btn.addEventListener('click', e => { e.preventDefault(); fn(); });
    },
  };
  return hud;
}
