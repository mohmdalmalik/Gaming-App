// The hand sheet: the active guest's cards as large illustrated tiles, with a detail pane that
// explains the selected card and offers its action when it has one. Private to whoever holds
// the device: it shows their Lanterns, their Possession cards and who they have unmasked.
import { activePlayer, adjacentLockedRooms, isBarricaded, playersInRoom } from '../game/state.js';
import { rules } from '../data/rules.js';
import { CARDS, countableCount } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createHand(doc, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror }) {
  const overlay = doc.getElementById('hand-overlay');
  const title = doc.getElementById('hand-title');
  const banner = doc.getElementById('hand-banner');
  const cards = doc.getElementById('hand-cards');
  const detail = doc.getElementById('hand-detail');
  const note = doc.getElementById('hand-note');
  const closeBtn = doc.getElementById('btn-hand-close');
  let open = false;
  let ctx = null;
  let selectedId = null;

  function render() {
    const { state, floor } = ctx;
    const p = activePlayer(state);
    title.textContent = `${p.name}'s hand`;

    if (p.possessed) {
      banner.hidden = false; banner.className = 'banner';
      banner.textContent = 'You are POSSESSED. In a trade you may give a Possession card to convert someone — unless they hand you a Lantern. You can never escape.';
    } else if (p.knows.size) {
      const names = [...p.knows].map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
      banner.hidden = false; banner.className = 'banner info';
      banner.textContent = `You have unmasked: ${names.join(', ')} — possessed.`;
    } else banner.hidden = true;

    // Possession cards first, then the rest grouped by type (Lanterns lead the catalogue).
    const order = Object.keys(CARDS);
    const rank = c => (c.type === 'possession' ? -1 : order.indexOf(c.type));
    const hand = [...p.hand].sort((a, b) => rank(a) - rank(b));
    if (!hand.some(c => c.id === selectedId)) selectedId = hand[0]?.id ?? null;

    cards.innerHTML = '';
    for (const card of hand) {
      cards.appendChild(cardTile(doc, card, {
        hideDesc: true, selectable: true, selected: card.id === selectedId,
        onSelect: c => { selectedId = c.id; render(); },
      }));
    }
    if (!hand.length) cards.innerHTML = '<div class="panel-note">No cards.</div>';

    renderDetail(state, floor, p, hand.find(c => c.id === selectedId) || null);

    // An Espresso can lift a turn above the usual action points: say by how much.
    const base = rules.actionPointsPerTurn;
    const actions = p.actionPoints > base ? `Actions ${p.actionPoints} (+${p.actionPoints - base})` : `Actions ${p.actionPoints}/${base}`;
    const parts = [`Health ${p.health}/${rules.maxHealth}`, actions,
      `Cards ${countableCount(p.hand)}/${rules.handLimit}`, `Lanterns ${p.hand.filter(c => c.type === 'lantern').length}/${rules.lanternsToEscape}`];
    note.textContent = parts.join(' · ');
  }

  function renderDetail(state, floor, p, card) {
    detail.innerHTML = '';
    if (!card) { detail.innerHTML = '<div class="d-empty">Select a card to see what it does.</div>'; return; }
    const meta = CARDS[card.type];
    const line = (html, cls = 'd-line') => { const d = doc.createElement('div'); d.className = cls; d.innerHTML = html; detail.appendChild(d); };
    const actionBtn = (label, disabled, onClick) => {
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'btn primary'; btn.textContent = label; btn.disabled = disabled;
      btn.addEventListener('click', e => { e.preventDefault(); onClick(); });
      detail.appendChild(btn);
    };

    const name = doc.createElement('div'); name.className = 'd-name';
    const shots = card.type === 'revolver' && card.shots != null ? ` · ${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';
    name.textContent = `${meta.name}${shots}`;
    if (meta.evil) name.style.color = 'var(--evil)';
    detail.appendChild(name);
    line(meta.desc, 'd-desc');

    const noAp = p.actionPoints < rules.actionCost.useCard;
    if (card.type === 'lantern') {
      const held = p.hand.filter(c => c.type === 'lantern').length;
      line(`<b>Escape:</b> you hold ${held} of ${rules.lanternsToEscape}. A clean guest carrying ${rules.lanternsToEscape} Lanterns escapes from the fire exit with the Escape button (${rules.actionCost.escape} action).${p.possessed ? ' While you are possessed it will not open for you.' : ''}`);
      if (!state.practice) {
        line('<b>In a trade:</b> in an ordinary trade it goes to the other guest like any card — pass them to one guest. If they handed you a Possession card, your Lantern blocks it: both cards are used up and you learn who tried.', 'd-tag');
      }
      return;
    }
    if (card.type === 'possession') {
      line('Give it in a trade to convert the other guest. If they gave you a Lantern, it fails and they learn what you are. Never counts toward your hand.', 'd-tag');
      return;
    }
    if (card.type === 'flashlight') { line('Kept in hand; lets you search a dark room. Never used up.', 'd-tag'); return; }
    if (meta.weapon) { line(state.practice ? 'No one to attack on your own.' : 'Chosen when you attack during a meeting.', 'd-tag'); return; }

    if (card.type === 'bandage') {
      const full = p.health >= rules.maxHealth;
      if (full || noAp) line(full ? 'Already at full health.' : 'No actions left this turn.', 'd-tag');
      actionBtn(`Use · ${rules.actionCost.useCard} action`, full || noAp, () => onUseBandage(card.id));
      return;
    }
    if (meta.unlock) {
      const targets = adjacentLockedRooms(state, floor, p);
      if (!targets.length) { line('No locked room next door to use it on.', 'd-tag'); return; }
      if (noAp) line('No actions left this turn.', 'd-tag');
      for (const roomId of targets) {
        actionBtn(`Open ${floor.rooms.get(roomId)?.name ?? roomId} · ${rules.actionCost.useCard} action`, noAp, () => onUnlock(card.id, roomId));
      }
      return;
    }
    if (card.type === 'barricade') {
      const doors = (floor.rooms.get(p.currentRoom)?.doorways || []).filter(d => !isBarricaded(state, d.id));
      if (!doors.length) { line('Every doorway here is already sealed.', 'd-tag'); return; }
      if (noAp) line('No actions left this turn.', 'd-tag');
      for (const d of doors) {
        const other = floor.rooms.get(d.otherRoom(p.currentRoom));
        actionBtn(`Seal the door to ${state.discovered.has(other.id) ? other.name : 'the unknown room'} · ${rules.actionCost.useCard} action`, noAp, () => onBarricade(card.id, d.id));
      }
      return;
    }
    if (card.type === 'handMirror') {
      // One button per other living guest in this room; what they hold is shown in private.
      const others = playersInRoom(state, p.currentRoom, p.id);
      if (!others.length) { line(state.practice ? 'There is no one else here.' : 'No other guest in this room.', 'd-tag'); return; }
      // Short name buttons, so a full lobby (five other guests) fits without scrolling.
      line(noAp ? 'No actions left this turn.' : `Whose hand? · ${rules.actionCost.useCard} action`, 'd-tag');
      const row = doc.createElement('div'); row.className = 'd-targets';
      for (const q of others) {
        const btn = doc.createElement('button');
        btn.type = 'button'; btn.className = 'btn primary'; btn.textContent = q.name; btn.disabled = noAp;
        btn.setAttribute('aria-label', `Look at ${q.name}'s hand`);
        btn.addEventListener('click', e => { e.preventDefault(); onHandMirror(card.id, q.id); });
        row.appendChild(btn);
      }
      detail.appendChild(row);
      return;
    }
    if (card.type === 'espresso') {
      const cost = rules.actionCost.espresso;
      const short = p.actionPoints < cost;
      line('The extra actions are gone when the turn ends, like any you have not used.', 'd-tag');
      if (short) line('No actions left this turn.', 'd-tag');
      actionBtn(`Drink · ${cost ? `${cost} action` : 'free'}`, short, () => onEspresso(card.id));
    }
  }

  const api = {
    get isOpen() { return open; },
    open(state, floor) { ctx = { state, floor }; open = true; overlay.hidden = false; render(); },
    refresh() { if (open) render(); },
    close() { open = false; overlay.hidden = true; },
  };
  closeBtn.addEventListener('click', e => { e.preventDefault(); api.close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) api.close(); });
  return api;
}
