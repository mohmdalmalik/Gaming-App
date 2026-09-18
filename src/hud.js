// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the fanned
// hand opener with a live count, the turn-action buttons (with costs / reasons), a move-confirm
// bar and toasts. Portraits are illustrated placeholders (see ui/portrait.js) so real art can
// drop in later without changing this logic. Possession is never revealed on the public strip.
import {
  activePlayer, nextPlayer, playersInRoom, objectivesFound, objectivesRequired, exitUnlocked,
  escapedCount, escapeesRequired,
} from './game/state.js';
import { canSearch } from './game/actions.js';
import { rules } from './data/rules.js';
import { CARDS, lanternCount, countableCount } from './game/cards.js';
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
    objectives: doc.getElementById('objectives'),
    objPips: doc.getElementById('obj-pips'),
    objCount: doc.getElementById('obj-count'),
    escapes: doc.getElementById('escapes'),
    escPips: doc.getElementById('esc-pips'),
    escCount: doc.getElementById('esc-count'),
    timer: doc.getElementById('turn-timer'),
    timerFill: doc.getElementById('tt-fill'),
    timerSeconds: doc.getElementById('tt-seconds'),
    restartPractice: doc.getElementById('btn-restart-practice'),
    healthRow: doc.getElementById('health-row'),
    topCenter: doc.querySelector('.hud-top-center'),
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
    offer: doc.getElementById('btn-offer'),
    offerSub: doc.getElementById('offer-sub'),
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
      // PUBLIC information only: where they are and how many cards they hold. A hidden role is
      // never shown here, and neither is anyone's Offer.
      const where = doc.createElement('div'); where.className = 'mini-where';
      cell.append(flag, port, name, where);
      el.strip.appendChild(cell);
      return { cell, flag, where };
    });
  }

  function renderPips(host, on, total) {
    if (host.childElementCount !== total) {
      host.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const pip = doc.createElement('span'); pip.className = 'obj-pip'; host.appendChild(pip);
      }
    }
    [...host.children].forEach((pip, i) => pip.classList.toggle('on', i < on));
  }

  function renderEscapes(state) {
    const out = escapedCount(state), need = escapeesRequired(state);
    renderPips(el.escPips, out, need);
    el.escCount.textContent = `${out} / ${need}`;
    el.escapes.classList.toggle('complete', out >= need);
  }

  function renderObjectives(state) {
    const found = objectivesFound(state), need = objectivesRequired();
    if (el.objPips.childElementCount !== need) {
      el.objPips.innerHTML = '';
      for (let i = 0; i < need; i++) {
        const pip = doc.createElement('span'); pip.className = 'obj-pip'; el.objPips.appendChild(pip);
      }
    }
    [...el.objPips.children].forEach((pip, i) => pip.classList.toggle('on', i < found));
    el.objCount.textContent = `${found} / ${need}`;
    el.objectives.classList.toggle('complete', exitUnlocked(state));
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
      const showPossessed = p.possessed && !state.hotseat;
      el.panel.classList.toggle('possessed', showPossessed);
      const key = `${p.index}:${showPossessed}:${p.outfit}`;
      if (key !== portraitKey) {
        portraitKey = key;
        el.portrait.innerHTML = '';
        el.portrait.appendChild(makePortrait(doc, p, { possessed: showPossessed }));
      }
      el.name.textContent = p.name;
      // In hot-seat the device sits on a table between six people, so the always-on HUD must
      // never carry a hidden role: no possessed portrait and no possessed screen wash. That
      // information lives on the private hand-over screens only.
      const publicOnly = !!state.hotseat;
      // Health is a Phase 1 system. While it is off nothing can change it, so showing three
      // bars would imply a rule that does not exist yet.
      el.healthRow.hidden = !rules.healthEnabled;
      if (rules.healthEnabled) renderHealth(p.health);
      renderAp(p.actionPoints);
      el.tint.hidden = !showPossessed;             // subtle possessed screen wash (never in hot-seat)

      // Header.
      const room = floor.rooms.get(p.currentRoom);
      el.room.textContent = room?.name ?? '—';
      el.safeBadge.hidden = !room?.safe;
      el.round.textContent = rules.roundLimitEnforced
        ? `Round ${Math.min(state.round, rules.roundLimit)} / ${rules.roundLimit}`
        : `Round ${state.round} · Turn ${state.turn}`;
      renderObjectives(state);
      el.escapes.hidden = !state.hotseat;
      if (state.hotseat) renderEscapes(state);
      // Practice is a single guest: the top strip of other players has nothing to show.
      el.topCenter.hidden = state.players.length < 2;
      el.restartPractice.hidden = !rules.practiceMode;

      // End turn (prominent; names the next guest).
      if (state.finished) { el.endMain.textContent = 'Game over'; el.endSub.textContent = ''; el.endTurn.disabled = true; }
      else { el.endMain.textContent = 'End turn ›'; el.endSub.textContent = next && next !== p ? `Next: ${next.name}` : `Refill to ${rules.actionPointsPerTurn}`; el.endTurn.disabled = false; }

      // Search: cost when available, plain-language reason when not.
      // Name the search point (the console table, the laundry cart) rather than the whole room.
      const gate = canSearch(state, floor, p);
      el.search.disabled = !gate.ok;
      el.searchSub.textContent = gate.ok
        ? (room?.searchPoint ? `${room.searchPoint} · ${rules.searchCost} action` : `${rules.searchCost} action`)
        : (SEARCH_REASON[gate.reason] || 'Unavailable');

      // Voluntary trade: only in a SAFE room when someone else is present to trade with. It is
      // switched off entirely in hot-seat — see docs/DECISIONS.md.
      const safeRoom = !!room?.safe;
      el.trade.hidden = publicOnly
        || !(safeRoom && !state.finished && playersInRoom(state, p.currentRoom, p.id).length > 0);

      // The Offer button: what this player has committed for the next meeting. Shown on their own
      // device during their own turn only, and it names a card only until the turn's first action.
      el.offer.hidden = !state.hotseat || state.finished;
      if (state.hotseat) {
        const card = p.offer ? p.hand.find(c => c.id === p.offer) : null;
        const label = card ? CARDS[card.type].name : 'Nothing';
        el.offerSub.textContent = p.offerLocked ? `${label} · locked` : label;
        el.offer.classList.toggle('locked', !!p.offerLocked);
        el.offer.classList.toggle('evil', p.intent === 'possess');
      }

      // Public card count excludes Possession cards, so it can never reveal a possessed role.
      renderHand(countableCount(p.hand));

      // Top strip: current-turn + next-player indicators.
      if (!mini || mini.length !== state.players.length) buildStrip(state);
      const nextIdx = !state.finished && next ? next.index : -1;
      state.players.forEach((q, i) => {
        const active = i === state.activeIndex && !state.finished;
        const out = !!state.escaped?.has(q.id);
        mini[i].cell.classList.toggle('active', active);
        mini[i].cell.classList.toggle('next', i === nextIdx && !active);
        mini[i].cell.classList.toggle('dead', !q.alive);
        mini[i].cell.classList.toggle('escaped', out);
        mini[i].flag.textContent = out ? 'Out' : active ? 'Your turn' : (i === nextIdx ? 'Next' : '');
        if (mini[i].where) {
          const seen = state.discovered.has(q.currentRoom);
          mini[i].where.textContent = out
            ? 'Escaped'
            : `${seen ? floor.rooms.get(q.currentRoom)?.name ?? '—' : 'Somewhere else'} · ${countableCount(q.hand)} cards`;
        }
      });
    },
    // --- Turn timer ---------------------------------------------------------------------------
    // Shown only while the active player's action phase is running. It is hidden (and not
    // counting) during every hand-over and role screen, so passing the device costs nobody time.
    showTimer(left, total) {
      el.timer.hidden = false;
      const frac = Math.max(0, Math.min(1, total ? left / total : 0));
      el.timerFill.style.width = `${(frac * 100).toFixed(1)}%`;
      el.timerSeconds.textContent = `${Math.ceil(Math.max(0, left))}s`;
      el.timer.classList.toggle('low', left <= 10);
    },
    hideTimer() { el.timer.hidden = true; el.timer.classList.remove('low'); },
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
