// The PUBLIC side of a meeting: who to meet, Trade or Attack, which weapon, the outcome of an
// attack, and a short wait while another guest makes up their mind. Everything private about a trade
// — which card each guest gives, what each receives — happens on the player's private screens in
// handoff.js, so nothing here ever shows a hand, a role or a trade result. The player (the viewer)
// is called "you".
import { CARDS, weaponsIn } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createMeeting(doc, cfg, { isViewer = () => false } = {}) {
  const overlay = doc.getElementById('encounter-overlay');
  const title = doc.getElementById('encounter-title');
  const body = doc.getElementById('encounter-body');
  const actions = doc.getElementById('encounter-actions');

  const nameOf = p => (isViewer(p) ? 'you' : p.name);
  const Name = p => (isViewer(p) ? 'You' : p.name);
  const who = (p, cap = true) => `<span class="who"><span class="dot" style="--player-color:${p.color}"></span>${cap ? Name(p) : nameOf(p)}</span>`;

  function button(label, onClick, opts = {}) {
    const b = doc.createElement('button');
    b.className = 'btn' + (opts.primary ? ' primary' : '');
    b.type = 'button';
    b.innerHTML = label;
    if (opts.disabled) b.disabled = true;
    b.addEventListener('click', e => { e.preventDefault(); onClick(); });
    return b;
  }
  const show = () => { overlay.hidden = false; };
  const hide = () => { overlay.hidden = true; };

  return {
    get isOpen() { return !overlay.hidden; },

    // Who to meet, when more than one guest is in the room. `voluntary` (the lobby) can be cancelled.
    choose(P, candidates, onPick, opts = {}) {
      show();
      title.innerHTML = opts.voluntary ? `${isViewer(P) ? 'Trade' : `${who(P)} may trade`}` : `${isViewer(P) ? 'You are not alone' : `${who(P)} is not alone`}`;
      body.innerHTML = `<div class="modal-sub">${opts.voluntary ? 'Trade with whom?' : 'Choose one guest to meet.'}</div>`;
      actions.innerHTML = '';
      for (const q of candidates) actions.appendChild(button(who(q), () => { hide(); onPick(q); }));
      if (opts.voluntary) actions.appendChild(button('Cancel', () => { hide(); opts.onCancel?.(); }));
    },

    // Trade or Attack. Attack needs a weapon and an action point.
    chooseAction(P, Q, { canAttack, onTrade, onAttack }) {
      show();
      title.innerHTML = `${who(P)} ${isViewer(P) ? 'meet' : 'meets'} ${who(Q, false)}`;
      body.innerHTML = `<div class="modal-sub">A meeting is forced. ${isViewer(P) ? 'Choose' : `${P.name} chooses`}:</div>`;
      actions.innerHTML = '';
      actions.appendChild(button('Trade', () => { hide(); onTrade(); }, { primary: true }));
      actions.appendChild(button(canAttack ? 'Attack' : 'Attack (need a weapon)', () => { hide(); onAttack(); }, { disabled: !canAttack }));
    },

    // Which weapon. The weapon is public the moment it is used, so this can stay on the shared screen.
    // `onBack` (Back) returns to Trade or Attack: nothing has happened until a weapon is tapped.
    attackPick(P, Q, onWeapon, onBack = null) {
      show();
      title.textContent = 'Attack';
      body.innerHTML = `<div class="modal-sub">${Name(P)} ${isViewer(P) ? 'attack' : 'attacks'} ${nameOf(Q)}. Choose a weapon:</div>`;
      const grid = doc.createElement('div'); grid.className = 'cards';
      for (const w of weaponsIn(P.hand)) grid.appendChild(cardTile(doc, w, { selectable: true, onSelect: c => { hide(); onWeapon(c.id); } }));
      body.appendChild(grid);
      actions.innerHTML = '';
      if (onBack) actions.appendChild(button('‹ Back', () => { hide(); onBack(); }));
    },

    // The public outcome of an attack. Health is public, so this is safe for the table.
    attackResult(P, Q, events, onDone) {
      show();
      title.textContent = 'Attack';
      if (!events.ok) body.innerHTML = `<div class="result-line bad">Cannot attack (${events.reason}).</div>`;
      else {
        const lines = [`<div class="result-line bad">${Name(P)} hit ${nameOf(Q)} with a <b>${CARDS[events.weapon].name}</b> for ${events.damage} damage.</div>`];
        if (events.discarded) lines.push('<div class="result-line">The revolver is empty and is gone.</div>');
        if (events.killed) lines.push(`<div class="result-line bad">${isViewer(Q) ? 'You are dead. Everything you carried is' : `${Q.name} is dead. Everything they carried is`} on the floor of this room.</div>`);
        body.innerHTML = lines.join('');
      }
      actions.innerHTML = '';
      actions.appendChild(button('Continue', () => { hide(); onDone?.(); }, { primary: true }));
    },

    // The trade has been made. Nothing about what changed hands is shown here.
    tradeDone(P, Q, onDone) {
      show();
      title.textContent = 'Trade complete';
      body.innerHTML = `<div class="result-line">${P.name} and ${Q.name} exchanged one card each. What they received is theirs to know.</div>`;
      actions.innerHTML = '';
      actions.appendChild(button('Continue', () => { hide(); onDone?.(); }, { primary: true }));
    },

    // A moment while another guest makes up their mind (a card for a trade, an answer). No button: the
    // caller closes it.
    waiting(heading, text) {
      show();
      title.textContent = heading;
      body.innerHTML = `<div class="result-line waiting"><span class="think-dots" aria-hidden="true"><i></i><i></i><i></i></span>${text}</div>`;
      actions.innerHTML = '';
    },

    // A plain public message (a declined lobby trade, for instance).
    notice(text, onDone, heading = 'Meeting') {
      show();
      title.textContent = heading;
      body.innerHTML = `<div class="result-line">${text}</div>`;
      actions.innerHTML = '';
      actions.appendChild(button('Continue', () => { hide(); onDone?.(); }, { primary: true }));
    },

    close: hide,
  };
}
