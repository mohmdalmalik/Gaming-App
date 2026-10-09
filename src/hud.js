// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the turn-action
// buttons (with costs / reasons), a move-confirm bar and toasts. (The hand is src/ui/handFan.js;
// searching is the icon over the room's search spot, src/ui/searchSpot.js.) Portraits are
// illustrated placeholders (see ui/portrait.js) so real art can drop in later without changing
// this logic. Possession is never revealed on the public strip, and neither is how many cards anyone
// holds (docs/GAME_RULES.md > Possession: card counts are private).
//
// The panel, the hand and the buttons are the VIEWER's — the person looking at the screen
// (state.viewerIndex: in practice the only guest; in a match the player, whose seat is random). On the
// other guests' turns the panel stays the player's own, the buttons wait, and the strip shows who is
// playing.
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

const viewerOf = state => state.players[state.viewerIndex ?? state.activeIndex] || activePlayer(state);

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
    leave: doc.getElementById('btn-leave'),
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
    centre: doc.getElementById('btn-centre'),
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
  let endLine = { own: '', shared: '' };   // End turn's second line: the guest's own words / the shared words

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
      // PUBLIC information only: where they are and their health. A hidden role is never shown here,
      // and neither is how many cards anyone holds (approved rule, docs/GAME_RULES.md > Possession: a
      // Possession card or a Lantern block changes counts unevenly). Your own count is in your own hand.
      // Two short lines: the room (its short name, full name on hover), then health.
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
    // A new table: the strip is built again for its guests.
    rebuild() { mini = null; portraitKey = ''; soulsKey = ''; },
    update(state, floor) {
      const active = activePlayer(state);
      const p = viewerOf(state);
      const mine = p === active && !state.finished;          // the viewer's own turn
      const match = state.players.length > 1;
      const next = nextPlayer(state);

      // The viewer's panel (their own private view: only they look at this screen).
      el.panel.style.setProperty('--player-color', p.color);
      el.panel.classList.toggle('waiting', !mine && !state.finished);
      const showPossessed = !!p.possessed;
      el.panel.classList.toggle('possessed', showPossessed);
      const key = `${p.index}:${showPossessed}:${p.outfit}`;
      if (key !== portraitKey) {
        portraitKey = key;
        el.portrait.innerHTML = '';
        el.portrait.appendChild(makePortrait(doc, p, { possessed: showPossessed }));
      }
      el.name.textContent = p.name;
      // Health is a Phase 1 system. While it is off nothing can change it, so showing three
      // bars would imply a rule that does not exist yet.
      el.healthRow.hidden = !rules.healthEnabled;
      if (rules.healthEnabled) renderHealth(p.health);
      renderAp(mine ? p.actionPoints : 0);
      if (!mine && !state.finished) { el.ap.textContent = !p.alive ? 'Out' : 'Waiting'; el.ap.classList.remove('empty'); }
      el.tint.hidden = !showPossessed;             // subtle possessed screen wash
      // The same tell, in words: a POSSESSED label by the name and how many Possession cards
      // ("souls") are left to trade.
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
      el.leave.hidden = false;

      // End turn (prominent; names the next guest). On another guest's turn it says whose turn it is and
      // waits; once the player is out (dead) it skips to the result.
      el.endTurn.classList.toggle('waiting', !mine && !state.finished && p.alive);
      if (state.finished) { el.endMain.textContent = 'Game over'; endLine = { own: '', shared: '' }; el.endTurn.disabled = true; }
      else if (match && !p.alive) {
        el.endMain.textContent = 'Skip to the end ›';
        endLine = { own: '', shared: 'You are out' };
        el.endTurn.disabled = false;
      } else if (!mine) {
        el.endMain.textContent = `${active.name}’s turn`;
        endLine = { own: '', shared: next === p ? 'You are next' : 'Waiting…' };
        el.endTurn.disabled = true;
      } else {
        // Over the hand limit (allowed during the turn): ending it opens the discard screen first (the
        // player's own count, on their own screen).
        const over = countableCount(p.hand) - rules.handLimit;
        const shared = next && next !== p ? `Next: ${next.name}` : `Refill to ${rules.actionPointsPerTurn}`;
        el.endMain.textContent = 'End turn ›';
        endLine = { own: over > 0 ? `Discard ${over} first` : '', shared };
        el.endTurn.disabled = false;
      }
      hud.syncEndTurn(state);

      // A room with a job: its button shows only while standing in one (Infirmary, Switchboard).
      // The Fire Exit uses the same button for Escape. It is enabled only for a guest it would let
      // out, so nobody gives themselves away by trying: a possessed guest carrying the Lanterns sees
      // exactly what a clean guest short of Lanterns sees ("Clean + 3 Lanterns"), so the button never
      // says which of the two it is. (Enabled means "this guest can escape now" — and escaping ends the
      // match at once.) With no actions left it reads the same for everyone. Practice has nothing to
      // hide, so it says plainly when Lanterns are missing.
      const job = ROOM_JOB[room?.job];
      el.roomJob.hidden = (!job && !room?.isExit) || !mine;
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
      el.trade.hidden = !mine || !canTradeVoluntarily(state, floor, p);

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
        const isMe = match && q === p;
        mini[i].cell.classList.toggle('me', isMe);
        mini[i].flag.textContent = out ? 'Out' : active ? (isMe || !match ? 'Your turn' : 'Playing')
          : i === nextIdx ? (isMe ? 'You · next' : 'Next') : isMe ? 'You' : '';
        if (mini[i].where) {
          const hearts = rules.healthEnabled ? '♥'.repeat(q.health) + '♡'.repeat(Math.max(0, rules.maxHealth - q.health)) : '';
          const place = floor.rooms.get(q.currentRoom);
          mini[i].room.textContent = out ? 'Escaped' : !q.alive ? 'Dead' : (place?.short || place?.name || '—');
          mini[i].room.title = out || !q.alive ? '' : (place?.name ?? '');
          // Health only: no card count for anyone (see buildStrip).
          const health = out || !q.alive ? '' : hearts;
          if (mini[i].stats.textContent !== health) mini[i].stats.textContent = health;
          if (health) mini[i].stats.setAttribute('aria-label', `Health ${q.health} of ${rules.maxHealth}`);
          else mini[i].stats.removeAttribute('aria-label');
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
      const p = viewerOf(state);
      const on = !!p?.possessed;
      el.role.hidden = !on;
      el.souls.hidden = !on;
      const sk = on ? `${p.index}:${soulsHeld(p)}` : '';
      if (sk !== soulsKey) {
        soulsKey = sk;
        el.souls.replaceChildren(...(on ? [soulsChip(doc, soulsHeld(p), { compact: true })] : []));
      }
    },
    // End turn's second line: "Discard N first" (the player's own card count), or who is next. Cheap
    // (touches the page only on a change), so main.js runs it every frame.
    syncEndTurn(state) {
      const own = !!endLine.own;
      const text = own ? endLine.own : endLine.shared;
      if (el.endSub.textContent !== text) el.endSub.textContent = text;
      el.endSub.classList.toggle('own', own);
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
