// The PUBLIC side of a meeting: who to meet, Trade or Attack, which weapon, the outcome of an
// attack, and a short wait while another guest makes up their mind. Everything private about a trade
// — which card each guest gives, what each receives — happens on the player's private screens in
// handoff.js and src/ui/tradeReveal.js, so nothing here ever shows a hand, a role or a trade result.
// The player (the viewer) is called "you". An attack is public, so its result is SHOWN here: the
// two guests (their normal portraits, never a possessed one), the weapon card striking, and the
// hearts the target lost dropping away.
import { CARDS, weaponsIn } from '../game/cards.js';
import { cardTile, CARD_FACE } from './cards.js';
import { makePortrait } from './portrait.js';
import { rules } from '../data/rules.js';
import { sfx } from '../audio/bus.js';
import { tooSoon } from './tapGuard.js';

const HEART = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 20.5 3.6 12.4A5.2 5.2 0 0 1 11.3 5.4L12 6.2l.7-.8a5.2 5.2 0 0 1 7.7 7z"/></svg>';

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
    // (not the second tap of the double tap that opened this panel: src/ui/tapGuard.js)
    b.addEventListener('click', e => { e.preventDefault(); if (tooSoon(e, shownAt)) return; onClick(); });
    return b;
  }
  let shownAt = 0;   // when the current panel opened (every panel calls show())
  const show = () => { overlay.hidden = false; shownAt = performance.now(); };
  let cues = [];     // the attack's sound cues still to come (dropped if the panel closes first)
  const hide = () => { overlay.hidden = true; for (const t of cues) clearTimeout(t); cues = []; };
  const el = (tag, cls, parent) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; };

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
      for (const w of weaponsIn(P.hand)) grid.appendChild(cardTile(doc, w, { selectable: true, onSelect: (c, _tile, e) => { if (tooSoon(e, shownAt)) return; hide(); onWeapon(c.id); } }));
      body.appendChild(grid);
      actions.innerHTML = '';
      if (onBack) actions.appendChild(button('‹ Back', () => { hide(); onBack(); }));
    },

    // The public outcome of an attack. Health is public, so this is safe for the table.
    // Shown, in a second and a half: the attacker and the target (normal portraits), the weapon card
    // striking (a Knife's slash, a Revolver's muzzle flash), and the hearts the target lost dropping
    // away. `before`: the target's health before the blow (from main.js).
    attackResult(P, Q, events, onDone, { before } = {}) {
      show();
      for (const t of cues) clearTimeout(t);
      cues = [];
      title.textContent = 'Attack';
      if (!events.ok) body.innerHTML = `<div class="result-line bad">Cannot attack (${events.reason}).</div>`;
      else {
        body.innerHTML = '';
        const after = Math.max(0, Q.health ?? 0);
        const was = Math.min(rules.maxHealth, Math.max(after, before ?? after + (events.damage || 0)));
        const stage = el('div', `atk-stage atk-${events.weapon}${events.killed ? ' killed' : ''}`, body);
        stage.setAttribute('role', 'img');
        const seat = (p, cls) => {
          const s = el('div', `atk-seat ${cls}`, stage);
          const port = el('div', 'atk-port', s);
          port.appendChild(makePortrait(doc, p, { possessed: false }));   // public: never a possessed face
          if (cls === 'atk-target') el('div', 'atk-slash', port);
          el('div', 'atk-name', s).innerHTML = who(p);
          return s;
        };
        seat(P, 'atk-by');
        const weapon = el('div', `atk-weapon${events.discarded ? ' gone' : ''}`, stage);
        const img = el('img', '', weapon); img.src = CARD_FACE[events.weapon] || ''; img.alt = CARDS[events.weapon]?.name ?? ''; img.draggable = false;
        el('div', 'atk-flash', weapon);
        if (events.discarded) el('span', 'atk-empty', weapon).textContent = 'Empty';
        const target = seat(Q, 'atk-target');
        if (rules.healthEnabled) {
          const hearts = el('div', 'atk-hearts', target);
          hearts.setAttribute('aria-label', `Health ${after} of ${rules.maxHealth}`);
          let lost = 0;
          for (let i = 0; i < rules.maxHealth; i++) {
            const h = el('span', `atk-heart ${i < after ? 'full' : i < was ? 'lost' : 'empty'}`, hearts);
            h.innerHTML = HEART.replace('<svg', '<svg class="h-o"') + HEART.replace('<svg', '<svg class="h-f"');
            if (i >= after && i < was) h.style.setProperty('--i', String(lost++));
          }
          if (was > after) el('span', 'atk-minus', hearts).textContent = `−${was - after}`;
        }
        stage.setAttribute('aria-label', `${Name(P)} hit ${nameOf(Q)} with ${/^[aeiou]/i.test(img.alt) ? 'an' : 'a'} ${img.alt}`);
        el('div', 'result-line atk-line', body).textContent = events.killed
          ? `${Name(P)} hit ${nameOf(Q)}. ${isViewer(Q) ? 'You are dead — your' : `${Q.name} is dead — their`} things lie on the floor here.`
          : `${Name(P)} hit ${nameOf(Q)}.`;
        const reduced = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();
        const k = reduced ? 0.2 : 1;
        cues.push(setTimeout(() => sfx(events.weapon === 'revolver' ? 'revolver' : 'knife'), 520 * k));
        if (events.killed) cues.push(setTimeout(() => sfx('death'), 900 * k));
        else cues.push(setTimeout(() => sfx('hurt'), 680 * k));
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
