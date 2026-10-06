// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the turn-action
// buttons (with costs / reasons), a move-confirm bar and toasts. (The hand is src/ui/handFan.js;
// searching is the icon over the room's search spot, src/ui/searchSpot.js.) Portraits are
// illustrated placeholders (see ui/portrait.js) so real art can drop in later without changing
// this logic. Possession is never revealed on the public strip.
import { activePlayer, nextPlayer, playersInRoom, canEscape, canTradeVoluntarily } from './game/state.js';
import { canUseRoom } from './game/actions.js';
import { rules } from './data/rules.js';
import { countableCount } from './game/cards.js';
import { makePortrait } from './ui/portrait.js';
import { soulsHeld, soulsChip } from './ui/souls.js';
import { roundLabel, finalRoundShort, isFinal } from './ui/roundLabel.js';

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

// `possessedTellOnMain()`: whether the possessed guest's words-and-count reminder (POSSESSED label and
// "Souls to trade") may show on the main screen right now. Outside hot-seat it always may; in hot-seat
// only when cfg.ui.hotseatPossessedOnMainScreen is on, during that guest's own action phase (main.js).
export function createHud(doc, cfg, { possessedTellOnMain = state => !state.hotseat } = {}) {
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
    role: doc.getElementById('panel-role'),
    souls: doc.getElementById('panel-souls'),
    health: doc.getElementById('health'),
    apPips: doc.getElementById('ap-pips'),
    ap: doc.getElementById('action-points'),
    private: doc.getElementById('btn-private'),
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
    tint: doc.getElementById('possess-tint'),
    toast: doc.getElementById('toast'),
    confirmBar: doc.getElementById('confirm-bar'),
    confirmText: doc.getElementById('confirm-text'),
    confirmMove: doc.getElementById('btn-confirm-move'),
    confirmCancel: doc.getElementById('btn-confirm-cancel'),
  };
  let toastTimer = 0;
  let pressedConfirm = false;   // a press began on the Move/Cancel bar since it appeared (onConfirm)
  let mini = null;            // the top-strip guest cells
  let portraitKey = '';       // so the panel portrait only rebuilds when it must
  let soulsKey = '';          // so the panel's souls counter only rebuilds when it must

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
      // Two short lines: the room (its short name, full name on hover), then cards and health.
      const where = doc.createElement('div'); where.className = 'mini-where';
      const room = doc.createElement('span'); room.className = 'mini-room';
      const stats = doc.createElement('span'); stats.className = 'mini-stats';
      where.append(room, stats);
      cell.append(flag, port, name, where);
      el.strip.appendChild(cell);
      return { cell, flag, where, room, stats };
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
  // "bonus" pips after the normal row, and the label is just the number (the copper pips already
  // show the extra; a longer label ran out of the panel on an iPad mini). The hand sheet says "6 (+2)".
  function renderAp(n) {
    const base = rules.actionPointsPerTurn;
    const total = Math.max(base, n);
    el.apPips.innerHTML = '';
    el.apPips.classList.toggle('many', total > base);   // smaller pips, so the row stays in the panel
    for (let i = 0; i < total; i++) {
      const pip = doc.createElement('span');
      pip.className = 'pip' + (i < n ? ' full' : '') + (i >= base ? ' bonus' : '');
      el.apPips.appendChild(pip);
    }
    el.ap.textContent = n > base ? `${n}` : `${n} / ${base}`;
    el.ap.classList.toggle('empty', n === 0);
    el.ap.classList.toggle('bonus', n > base);
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
      // In hot-seat the device sits on a table between six people, so the always-on HUD never shows
      // the possessed portrait or the possessed screen wash (they live on the private hand-over
      // screens). The approved exception is the words-and-count reminder below (syncTell), during the
      // possessed guest's own action phase only.
      const publicOnly = !!state.hotseat;
      // Health is a Phase 1 system. While it is off nothing can change it, so showing three
      // bars would imply a rule that does not exist yet.
      el.healthRow.hidden = !rules.healthEnabled;
      if (rules.healthEnabled) renderHealth(p.health);
      renderAp(p.actionPoints);
      el.tint.hidden = !showPossessed;             // subtle possessed screen wash (never in hot-seat)
      // The same tell, in words: a POSSESSED label by the name and how many Possession cards
      // ("souls") are left to trade. Outside hot-seat it shows with the portrait and wash; in hot-seat
      // during that guest's own action phase while cfg.ui.hotseatPossessedOnMainScreen is on (the
      // default; it also lives on the private hand-over screens and in the card view).
      hud.syncTell(state);

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
      else {
        // Over the hand limit (allowed during the turn): ending it opens the discard screen first.
        const over = countableCount(p.hand) - rules.handLimit;
        el.endMain.textContent = 'End turn ›';
        el.endSub.textContent = over > 0 ? `Discard ${over} first` : next && next !== p ? `Next: ${next.name}` : `Refill to ${rules.actionPointsPerTurn}`;
        el.endTurn.disabled = false;
      }

      // A room with a job: its button shows only while standing in one (Infirmary, Switchboard).
      // The Fire Exit uses the same button for Escape. It is enabled only for a guest it would let
      // out, so nobody gives themselves away by trying: a possessed guest carrying the Lanterns sees
      // exactly what a clean guest short of Lanterns sees ("Clean + 3 Lanterns"), so the button never
      // says which of the two it is. (Enabled means "this guest can escape now" — and escaping ends the
      // match at once.) With no actions left it reads the same for everyone. Practice has nothing to
      // hide, so it says plainly when Lanterns are missing.
      const job = ROOM_JOB[room?.job];
      el.roomJob.hidden = !job && !room?.isExit;
      if (room?.isExit) {
        const short = p.actionPoints < rules.actionCost.escape;
        const barred = !canEscape(state, floor, p);
        el.roomJobMain.textContent = 'Escape';
        el.roomJob.disabled = state.finished || short || barred;
        el.roomJobSub.textContent = state.finished ? '—' : short ? 'No actions left'
          : barred ? (state.practice ? `Need ${rules.lanternsToEscape} Lanterns` : `Clean + ${rules.lanternsToEscape} Lanterns`)
            : plural(rules.actionCost.escape);
      } else if (job) {
        const use = canUseRoom(state, floor, p);
        el.roomJobMain.textContent = job.name;
        el.roomJob.disabled = !use.ok;
        el.roomJobSub.textContent = use.ok ? job.does() : (ROOM_REASON[use.reason] || 'Unavailable');
      }

      // Voluntary trade: only in a safe zone that allows it (the Fire Exit, never the lobby), with
      // someone else there to trade with.
      el.trade.hidden = !canTradeVoluntarily(state, floor, p);

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
          const hearts = rules.healthEnabled ? '♥'.repeat(q.health) + '♡'.repeat(Math.max(0, rules.maxHealth - q.health)) : '';
          const place = floor.rooms.get(q.currentRoom);
          mini[i].room.textContent = out ? 'Escaped' : !q.alive ? 'Dead' : (place?.short || place?.name || '—');
          mini[i].room.title = out || !q.alive ? '' : (place?.name ?? '');
          if (out || !q.alive) mini[i].stats.textContent = '';
          else {
            const h = doc.createElement('span'); h.className = 'mini-hearts'; h.textContent = hearts;
            mini[i].stats.replaceChildren(doc.createTextNode(`${countableCount(q.hand)} cards`), h);
          }
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
    // The POSSESSED label and souls count in the panel. Cheap (touches the page only on a change), so
    // main.js also runs it every frame: in hot-seat it must be gone before any pass screen is up.
    syncTell(state) {
      const p = activePlayer(state);
      const on = !!p?.possessed && !!possessedTellOnMain(state);
      el.role.hidden = !on;
      el.souls.hidden = !on;
      const sk = on ? `${p.index}:${soulsHeld(p)}` : '';
      if (sk !== soulsKey) {
        soulsKey = sk;
        el.souls.replaceChildren(...(on ? [soulsChip(doc, soulsHeld(p), { compact: true })] : []));
      }
    },
    hideTimer() { el.timer.hidden = true; el.timer.classList.remove('low'); },
    // `seconds`: how long it stays (default cfg.ui.toastDuration); a longer message asks for longer.
    toast(message, seconds = cfg.ui.toastDuration) {
      el.toast.textContent = message;
      el.toast.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, seconds * 1000);
    },
    showConfirm(text, moveLabel) {
      el.confirmText.textContent = text;
      if (moveLabel) el.confirmMove.textContent = moveLabel;
      if (el.confirmBar.hidden) pressedConfirm = false;
      el.confirmBar.hidden = false;
    },
    hideConfirm() { el.confirmBar.hidden = true; },
    get confirmOpen() { return !el.confirmBar.hidden; },
    on(name, fn) { el[name].addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onConfirm(move, cancel) {
      // Belt and braces for src/input.js: a pointer click on Move/Cancel counts only if the press
      // started on the bar after it appeared (a late click left over from the tap that opened it
      // does not). Clicks with no pointer behind them (keyboard, e.detail 0) always count.
      el.confirmBar.addEventListener('pointerdown', () => { pressedConfirm = true; });
      const real = e => e.detail === 0 || pressedConfirm;
      el.confirmMove.addEventListener('click', e => { e.preventDefault(); if (real(e)) move(); });
      el.confirmCancel.addEventListener('click', e => { e.preventDefault(); if (real(e)) cancel(); });
    },
  };
  return hud;
}
