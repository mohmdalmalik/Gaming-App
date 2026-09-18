// The hot-seat pass-the-device flow: the only place private information is ever shown.
//
// Three screens, in this order, every turn:
//   1. PASS    — neutral. "Pass the device to Eleanor." Nothing private on screen, so the
//                previous player's hand and role are already gone before anyone else looks.
//   2. PRIVATE — that player alone: their role, anything that happened to them since, their
//                hand, and the Offer they commit for this turn.
//   3. (the turn itself — this overlay closes and the turn timer starts)
//
// The role screen is also used on its own: once per player at the start of a match, and again
// privately for a guest who has just been converted.
//
// Nothing in here is ever shown on the public HUD, and nothing here asks a player anything while
// it is not their turn.
import { rules } from '../data/rules.js';
import { CARDS, countableCards, countableCount } from '../game/cards.js';

import { cardTile } from './cards.js';

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
    offer: doc.getElementById('handoff-offer'),
    offerCards: doc.getElementById('offer-cards'),
    offerIntent: doc.getElementById('offer-intent'),
    offerSummary: doc.getElementById('offer-summary'),
    next: doc.getElementById('btn-handoff-next'),
  };
  let onNext = null;
  let kind = null;      // which screen is showing: pass | role | note | turn | offeronly

  function reset(kind) {
    el.card.className = `card handoff-card ${kind}`;
    el.role.hidden = true; el.role.className = 'role-badge';
    el.notes.hidden = true; el.notes.innerHTML = '';
    el.hand.hidden = true; el.hand.innerHTML = '';
    el.offer.hidden = true; el.offerCards.innerHTML = '';
    el.offerIntent.hidden = true; el.offerIntent.innerHTML = '';
    el.offerSummary.textContent = '';
    el.sub.textContent = '';
    el.kicker.textContent = '';
  }

  function show(which, label, fn) {
    kind = which;
    el.next.textContent = label;
    onNext = fn;
    el.overlay.hidden = false;
    el.card.classList.add(which);
  }

  const roleName = p => (p.possessed ? 'POSSESSED' : 'GUEST');

  function renderRole(player) {
    el.role.hidden = false;
    el.role.className = `role-badge ${player.possessed ? 'evil' : 'good'}`;
    el.role.innerHTML = `<span class="role-word">${roleName(player)}</span>`
      + `<span class="role-line">${player.possessed
        ? 'On your turn you may commit to POSSESS instead of trading. A guest who offers you a Lantern blocks it — and learns what you are.'
        : 'Find the objectives, open the fire exit and get out clean. Keep a Lantern in your Offer if you are worried.'}</span>`;
  }

  function renderNotes(player) {
    if (!player.notes?.length) return;
    el.notes.hidden = false;
    for (const line of player.notes) {
      const d = doc.createElement('div');
      d.className = 'handoff-note';
      d.textContent = line;
      el.notes.appendChild(d);
    }
    player.notes.length = 0;    // read once, on the owner's own screen
  }

  // The Offer chooser. Tapping a card commits it; "Nothing" commits an empty Offer. A possessed
  // player also picks Trade or Possess. `onChange(cardId, intent)` writes it into the rules engine.
  function renderOffer(state, player, onChange, label) {
    el.offer.hidden = false;
    el.offer.querySelector('.offer-label').textContent = label
      || 'Your Offer — what you hand over if someone walks in on you';
    el.offerCards.innerHTML = '';
    const locked = player.offerLocked;

    const nothing = doc.createElement('div');
    nothing.className = 'card-tile nothing selectable' + (player.offer == null ? ' selected' : '');
    nothing.innerHTML = '<div class="art"><span class="glyph">—</span></div><span class="cname">Nothing</span>';
    if (!locked) nothing.addEventListener('click', e => { e.preventDefault(); onChange(null, player.intent); });
    el.offerCards.appendChild(nothing);

    for (const c of countableCards(player.hand)) {
      el.offerCards.appendChild(cardTile(doc, c, {
        hideDesc: true,
        selectable: !locked,
        selected: player.offer === c.id,
        onSelect: card => onChange(card.id, player.intent),
      }));
    }

    if (player.possessed) {
      el.offerIntent.hidden = false;
      for (const [value, label] of [['trade', 'Trade normally'], ['possess', 'Try to POSSESS']]) {
        const b = doc.createElement('button');
        b.type = 'button';
        b.className = 'btn intent' + (player.intent === value ? ' on' : '') + (value === 'possess' ? ' evil' : '');
        b.textContent = label;
        b.disabled = locked;
        b.addEventListener('click', e => { e.preventDefault(); onChange(player.offer, value); });
        el.offerIntent.appendChild(b);
      }
    }

    const card = player.offer ? player.hand.find(c => c.id === player.offer) : null;
    const what = card ? CARDS[card.type].name : 'Nothing';
    el.offerSummary.textContent = locked
      ? `Committed: ${what}${player.intent === 'possess' ? ' · POSSESS' : ''} — your turn has already started, so it cannot be changed.`
      : `You are offering: ${what}${player.intent === 'possess' ? ' · POSSESS' : ''}.`;
    el.offerSummary.classList.toggle('locked', locked);
  }

  const api = {
    get isOpen() { return !el.overlay.hidden; },
    get kind() { return el.overlay.hidden ? null : kind; },
    // True while a HAND-OVER or ROLE screen is up. The turn timer must not run during these.
    get handingOver() { return !el.overlay.hidden && kind !== 'offeronly'; },

    // 1. Neutral hand-over. Nothing private is on screen.
    passTo(player, info, onContinue) {
      reset('pass');
      el.kicker.textContent = info || '';
      el.title.textContent = `Pass the device to ${player.name}`;
      el.sub.textContent = 'Everyone else: look away. Tap Continue only when they are holding it.';
      show('pass', `I am ${player.name} — continue`, onContinue);
    },

    // 2. A private role screen: at the start of a match, and again if a guest is converted.
    revealRole(player, opts, onContinue) {
      reset('role');
      el.kicker.textContent = opts?.changed ? 'Something has changed' : 'Your secret role';
      el.title.textContent = opts?.changed ? `${player.name}, read this alone` : `${player.name}`;
      el.sub.textContent = opts?.changed
        ? 'Do not show this to anyone.'
        : 'Only you may see this screen. Memorise it and pass the device on.';
      renderRole(player);
      renderNotes(player);
      show('role', 'I understand', onContinue);
    },

    // A private consequence of something that just happened, for the player holding the device.
    privateNote(player, lines, onContinue) {
      reset('note');
      el.kicker.textContent = 'Private — hold the device close';
      el.title.textContent = `For ${player.name} only`;
      el.sub.textContent = '';
      el.notes.hidden = false;
      for (const line of lines) {
        const d = doc.createElement('div'); d.className = 'handoff-note'; d.textContent = line;
        el.notes.appendChild(d);
      }
      show('note', 'I understand', onContinue);
    },

    // 3. The private start-of-turn screen: role, news, hand and this turn's Offer.
    privateTurn(state, floor, player, handlers) {
      reset('turn');
      el.kicker.textContent = `Round ${state.round} of ${rules.roundLimit} · ${rules.actionPointsPerTurn} action points`;
      el.title.textContent = `${player.name}'s turn`;
      const room = floor.rooms.get(player.currentRoom);
      el.sub.textContent = `You are in ${room?.name ?? 'the hotel'}. Cards ${countableCount(player.hand)} / ${rules.handLimit}.`;
      renderRole(player);
      renderNotes(player);
      // No separate hand row here: the Offer chooser below already shows every card the player
      // holds, and showing them twice pushes the Start button off a landscape iPad screen.
      const redraw = () => renderOffer(state, player, (cardId, intent) => {
        handlers.onOffer(cardId, intent);
        redraw();
      }, 'Your hand — tap one to make it your Offer if someone walks in on you');
      redraw();
      show('turn', 'Start my turn', handlers.onStart);
    },

    // The Offer on its own, reopened from the turn bar before the first action locks it.
    offerOnly(state, floor, player, handlers) {
      reset('offeronly');
      el.kicker.textContent = 'Private';
      el.title.textContent = 'Your Offer';
      el.sub.textContent = 'What you hand over if another guest walks in on you before your next turn.';
      const redraw = () => renderOffer(state, player, (cardId, intent) => {
        handlers.onOffer(cardId, intent);
        redraw();
      });
      redraw();
      show('offeronly', 'Done', handlers.onClose);
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
