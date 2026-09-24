// The pass-the-device flow: the ONLY place private information is ever shown in hot-seat.
//
//   PASS     — neutral. "Pass the device to Eleanor." Nothing private on screen.
//   ROLE     — that guest alone: their secret role (once at the start, again if converted).
//   TURN     — their private start-of-turn screen: role, news, health, hand, Lanterns.
//   PICK     — a private card choice (which card to give in a trade).
//   CHOICE   — a private yes/no (accept a lobby trade?).
//   NOTE     — a private consequence (what you received, that you were possessed, who tried).
//
// Nothing here ever appears on the public HUD, and the turn timer is paused while any of it is up.
import { rules } from '../data/rules.js';
import { CARDS, countableCards, countableCount } from '../game/cards.js';
import { cardTile } from './cards.js';
import { roundLabel, finalRoundNote, isFinal } from './roundLabel.js';

export function createHandoff(doc) {
  const el = {
    overlay: doc.getElementById('handoff-overlay'),
    card: doc.getElementById('handoff-card'),
    kicker: doc.getElementById('handoff-kicker'),
    title: doc.getElementById('handoff-title'),
    sub: doc.getElementById('handoff-sub'),
    role: doc.getElementById('handoff-role'),
    notes: doc.getElementById('handoff-notes'),
    hand: doc.getElementById('handoff-hand'),
    pick: doc.getElementById('handoff-offer'),
    pickCards: doc.getElementById('offer-cards'),
    pickIntent: doc.getElementById('offer-intent'),
    pickSummary: doc.getElementById('offer-summary'),
    next: doc.getElementById('btn-handoff-next'),
  };
  let onNext = null;
  let kind = null;

  function reset(which) {
    kind = which;
    el.card.className = `card handoff-card ${which}`;
    el.role.hidden = true; el.role.className = 'role-badge';
    el.notes.hidden = true; el.notes.innerHTML = '';
    el.hand.hidden = true; el.hand.innerHTML = '';
    el.pick.hidden = true; el.pickCards.innerHTML = '';
    el.pickIntent.hidden = true; el.pickIntent.innerHTML = '';
    el.pickSummary.textContent = '';
    el.sub.textContent = ''; el.kicker.textContent = '';
    el.next.hidden = false;
  }
  function show(label, fn) {
    el.next.textContent = label;
    onNext = fn;
    el.overlay.hidden = false;
  }

  function renderRole(player) {
    el.role.hidden = false;
    el.role.className = `role-badge ${player.possessed ? 'evil' : 'good'}`;
    el.role.innerHTML = `<span class="role-word">${player.possessed ? 'POSSESSED' : 'CLEAN GUEST'}</span>`
      + `<span class="role-line">${player.possessed
        ? 'In a trade you may give a Possession card to convert someone — unless they hand you a Lantern, which burns it and tells them what you are. You can never escape.'
        : `Find Lanterns, pass them to one clean guest, and get that guest out through the fire exit with ${rules.lanternsToEscape}. Give a Lantern in a trade if you fear who you are trading with — it blocks possession, but is used up doing it.`}</span>`;
  }

  function renderNotes(player, extra = []) {
    const lines = [...extra, ...(player.notes || [])];
    if (!lines.length) return;
    el.notes.hidden = false;
    for (const line of lines) {
      const d = doc.createElement('div'); d.className = 'handoff-note'; d.textContent = line;
      el.notes.appendChild(d);
    }
    if (player.notes) player.notes.length = 0;   // read once, on the owner's own screen
  }

  function renderHand(player) {
    el.hand.hidden = false;
    const cards = [...player.hand.filter(c => c.type === 'possession'), ...countableCards(player.hand)];
    if (!cards.length) { el.hand.innerHTML = '<div class="panel-note">No cards.</div>'; return; }
    for (const c of cards) el.hand.appendChild(cardTile(doc, c, { hideDesc: true }));
  }

  const api = {
    get isOpen() { return !el.overlay.hidden; },
    get kind() { return el.overlay.hidden ? null : kind; },
    // Every screen here is private or a hand-over; the turn timer must not run during any of them.
    get handingOver() { return !el.overlay.hidden; },

    passTo(player, info, onContinue) {
      reset('pass');
      el.kicker.textContent = info || '';
      el.title.textContent = `Pass the device to ${player.name}`;
      el.sub.textContent = 'Everyone else: look away. Tap Continue only when they are holding it.';
      show(`I am ${player.name} — continue`, onContinue);
    },

    revealRole(player, opts, onContinue) {
      reset('role');
      el.kicker.textContent = opts?.changed ? 'Something has changed' : 'Your secret role';
      el.title.textContent = opts?.changed ? `${player.name}, read this alone` : player.name;
      el.sub.textContent = opts?.changed ? 'Do not show this to anyone.' : 'Only you may see this screen. Memorise it and pass the device on.';
      renderRole(player);
      renderNotes(player);
      show('I understand', onContinue);
    },

    privateTurn(state, floor, player, handlers) {
      reset('turn');
      el.kicker.textContent = `${roundLabel(state)} · ${rules.actionPointsPerTurn} action points · health ${player.health} of ${rules.maxHealth}`;
      if (isFinal(state)) el.kicker.textContent = `${finalRoundNote} · ${el.kicker.textContent}`;
      el.title.textContent = `${player.name}'s turn`;
      const room = floor.rooms.get(player.currentRoom);
      const lanterns = player.hand.filter(c => c.type === 'lantern').length;
      el.sub.textContent = `You are in ${room?.name ?? 'the hotel'}. Cards ${countableCount(player.hand)} / ${rules.handLimit}`
        + ` · Lanterns ${lanterns} / ${rules.lanternsToEscape}.`;
      renderRole(player);
      renderNotes(player);
      renderHand(player);
      show('Start my turn', handlers.onStart);
    },

    // A private card choice. `cards` are the options; the guest taps one.
    privatePick(player, { kicker, title, sub, cards, onPick, cancelLabel, onCancel }) {
      reset('pick');
      el.kicker.textContent = kicker || `Private — ${player.name} only`;
      el.title.textContent = title;
      el.sub.textContent = sub || '';
      el.pick.hidden = false;
      el.pick.querySelector('.offer-label').textContent = 'Tap the card you give';
      if (!cards.length) el.pickCards.innerHTML = '<div class="panel-note">No card you are allowed to give.</div>';
      for (const c of cards) {
        el.pickCards.appendChild(cardTile(doc, c, { hideDesc: true, selectable: true, onSelect: card => { api.close(); onPick(card.id); } }));
      }
      if (onCancel) show(cancelLabel || 'Cancel', onCancel); else el.next.hidden = true, el.overlay.hidden = false;
    },

    // A private yes/no.
    privateChoice(player, { kicker, title, sub, options, onPick }) {
      reset('choice');
      el.kicker.textContent = kicker || `Private — ${player.name} only`;
      el.title.textContent = title;
      el.sub.textContent = sub || '';
      el.pick.hidden = false;
      el.pick.querySelector('.offer-label').textContent = '';
      el.pickIntent.hidden = false;
      for (const o of options) {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'btn intent' + (o.primary ? ' on' : '');
        b.textContent = o.label;
        b.addEventListener('click', e => { e.preventDefault(); api.close(); onPick(o.value); });
        el.pickIntent.appendChild(b);
      }
      el.next.hidden = true; el.overlay.hidden = false;
    },

    // A private consequence for the guest holding the device.
    privateNote(player, lines, onContinue) {
      reset('note');
      el.kicker.textContent = 'Private — hold the device close';
      el.title.textContent = `For ${player.name} only`;
      renderNotes(player, lines);
      show('I understand', onContinue);
    },

    close() { el.overlay.hidden = true; onNext = null; kind = null; },
  };

  el.next.addEventListener('click', e => {
    e.preventDefault();
    const fn = onNext;
    api.close();
    fn?.();
  });
  return api;
}
