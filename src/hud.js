// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the fanned
// hand opener with a live count, the turn-action buttons (with costs / reasons), a move-confirm
// bar and toasts. Portraits are illustrated placeholders (see ui/portrait.js) so real art can
// drop in later without changing this logic. Possession is never revealed on the public strip.
import { activePlayer, nextPlayer, playersInRoom } from './game/state.js';
import { canSearch, canUseRoom } from './game/actions.js';
import { rules } from './data/rules.js';
import { countableCount } from './game/cards.js';
import { makePortrait } from './ui/portrait.js';
import { roundLabel, finalRoundShort, isFinal } from './ui/roundLabel.js';

const MAX_BACKS = 8; // fanned face-down cards drawn before we rely on the count badge alone

// Plain-language reason the Search button is unavailable right now.
const SEARCH_REASON = {
  notSearchable: 'Nothing to search here',
  searched: 'Already searched',
  dark: 'Dark — need a Flashlight',
  ap: 'No actions left',
  empty: 'Nothing left to find',
  finished: '—',
};

// The room-job button (Infirmary, Switchboard): its label, what it does for its cost, and a plain
// reason when it can't be used. A Linen Store has no button — its job is in the search itself.
const plural = n => `${n} action${n === 1 ? '' : 's'}`;
const ROOM_JOB = {
  infirmary: { name: 'Infirmary', does: () => `Heal ${rules.infirmaryHeal} · ${plural(rules.actionCost.infirmary)}` },
  switchboard: { name: 'Switchboard', does: () => `Call · ${plural(rules.actionCost.switchboard)}` },
};
const ROOM_REASON = {
  full: 'Full health',
  ap: 'No actions left',
  usedThisTurn: 'Called this turn',
  finished: '—',
  dead: '—',
};

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    strip: doc.getElementById('players-strip'),
    room: doc.getElementById('room-name'),
    safeBadge: doc.getElementById('safe-badge'),
    round: doc.getElementById('round'),
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
    // (`room` above is the room-name header; the room's job button is `roomJob`.)
    roomJob: doc.getElementById('btn-room'),
    roomJobMain: doc.querySelector('#btn-room .btn-main'),
    roomJobSub: doc.getElementById('room-sub'),
    trade: doc.getElementById('btn-trade'),
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

  function renderHealth(n) {
    el.health.innerHTML = '';
    for (let i = 0; i < rules.maxHealth; i++) {
      const bar = doc.createElement('span');
      bar.className = 'bar' + (i < n ? ' full' : '');
      el.health.appendChild(bar);
    }
  }

  // An Espresso can lift a turn above the usual action points: the extra ones get their own
  // "bonus" pips after the normal row, and the label says how many extra ("6 (+2)").
  function renderAp(n) {
    const base = rules.actionPointsPerTurn;
    const total = Math.max(base, n);
    el.apPips.innerHTML = '';
    el.apPips.classList.toggle('many', total > base + 2);
    for (let i = 0; i < total; i++) {
      const pip = doc.createElement('span');
      pip.className = 'pip' + (i < n ? ' full' : '') + (i >= base ? ' bonus' : '');
      el.apPips.appendChild(pip);
    }
    el.ap.textContent = n > base ? `${n} (+${n - base})` : `${n} / ${base}`;
    el.ap.classList.toggle('empty', n === 0);
    el.ap.classList.toggle('bonus', n > base);
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
      // "Round 3 of 8"; the last round before dawn is marked in words and colour.
      const last = isFinal(state) && !state.finished;
      el.round.textContent = last ? `${roundLabel(state)} · ${finalRoundShort}` : roundLabel(state);
      el.round.classList.toggle('final', last);
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

      // A room with a job: its button shows only while standing in one (Infirmary, Switchboard).
      const job = ROOM_JOB[room?.job];
      el.roomJob.hidden = !job;
      if (job) {
        const use = canUseRoom(state, floor, p);
        el.roomJobMain.textContent = job.name;
        el.roomJob.disabled = !use.ok;
        el.roomJobSub.textContent = use.ok ? job.does() : (ROOM_REASON[use.reason] || 'Unavailable');
      }

      // Voluntary trade: only in the lobby (a safe zone) when someone else is there to trade with.
      const safeRoom = !!room?.safe;
      el.trade.hidden = state.practice
        || !(safeRoom && !state.finished && playersInRoom(state, p.currentRoom, p.id).length > 0);

      // Public card count excludes Possession cards, so it never reveals a role.
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
          const hearts = rules.healthEnabled ? ' · ' + '♥'.repeat(q.health) + '♡'.repeat(Math.max(0, rules.maxHealth - q.health)) : '';
          mini[i].where.textContent = out ? 'Escaped'
            : !q.alive ? 'Dead'
              : `${floor.rooms.get(q.currentRoom)?.name ?? '—'} · ${countableCount(q.hand)} cards${hearts}`;
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
