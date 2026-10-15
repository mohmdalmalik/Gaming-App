// On-screen interface: the top guest strip (with current-turn / next indicators), the
// bottom-left active-player panel (portrait, name, health segments, action pips), the turn-action
// buttons (with costs / reasons), a move-confirm bar and toasts. (The hand is src/ui/handFan.js;
// searching, leaving through the Fire Exit, healing in an Infirmary and ringing the Switchboard are the icon over the
// room's furniture, src/ui/searchSpot.js.) Portraits are
// illustrated placeholders (see ui/portrait.js) so real art can drop in later without changing
// this logic. Possession is never revealed on the public strip: only the VIEWER's own knowledge shows, a crimson
// "Possessed" marker on the guests they certainly know are possessed (either side; src/ui/stripModel.js,
// src/ui/allies.js), with red eyes too for a possessed viewer. Neither is how many cards anyone holds
// (docs/GAME_RULES.md > Possession: card counts are private). The strip also says where the round ends and how
// many turns are left in it (src/ui/roundLabel.js roundReadout), from the public turn order only.
//
// The panel, the hand and the buttons are the VIEWER's — the person looking at the screen
// (state.viewerIndex: in practice the only guest; in a match the player, whose seat is random). On the
// other guests' turns the panel stays the player's own, the buttons wait, and the strip shows who is
// playing.
import { activePlayer, nextPlayer, playersInRoom, canTradeVoluntarily } from './game/state.js';
import { rules } from './data/rules.js';
import { countableCount } from './game/cards.js';
import { makePortrait } from './ui/portrait.js';
import { avatarKey } from './data/wardrobe.js';
import { soulsHeld, soulsChip } from './ui/souls.js';
import { redEyedAllies, knownPossessedIds } from './ui/allies.js';
import { roundLabel, finalRoundShort, isFinal, roundReadout } from './ui/roundLabel.js';
import { stripGuests } from './ui/stripModel.js';
import { tooSoon } from './ui/tapGuard.js';
import { guestMarks } from './table.js';
import { LANTERN_CHIP } from './data/howToPlay.js';

const plural = n => `${n} action${n === 1 ? '' : 's'}`;
// The question before End turn, while actions are left (they are lost when the turn ends): the real number.
export const endTurnAsk = n => `You still have ${plural(n)}. End turn?`;

// The little eye on a guest the viewer certainly knows is possessed (the strip's badge; the same red eyes as the portraits).
const EYE_BADGE = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M1.6 12S5.6 5 12 5s10.4 7 10.4 7-4 7-10.4 7S1.6 12 1.6 12z" fill="#fff"/><circle cx="12" cy="12" r="4.4" fill="#c0242f"/><circle cx="12" cy="12" r="1.8" fill="#2a0508"/><circle cx="10.5" cy="10.5" r="1" fill="#fff"/></svg>';

const viewerOf = state => state.players[state.viewerIndex ?? state.activeIndex] || activePlayer(state);

export function createHud(doc, cfg) {
  const el = {
    root: doc.getElementById('hud'),
    strip: doc.getElementById('players-strip'),
    cards: doc.getElementById('strip-cards'),            // (the guests' cells, in turn order, inside the strip)
    cap: doc.getElementById('strip-cap'),                // (the divider where the round ends)
    capWord: doc.getElementById('strip-cap-word'),
    roundLine: doc.getElementById('strip-round'),        // ("3 turns left in Round 2", under the guests)
    roundText: doc.getElementById('strip-round-text'),
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
    clean: doc.getElementById('panel-clean'),
    souls: doc.getElementById('panel-souls'),
    lanternLabel: doc.getElementById('lantern-label'),
    lanternChip: doc.getElementById('lantern-chip'),
    lanternGlyph: doc.querySelector('#lantern-chip .lc-glyph'),
    lanternCount: doc.getElementById('lantern-count'),
    health: doc.getElementById('health'),
    apPips: doc.getElementById('ap-pips'),
    ap: doc.getElementById('action-points'),
    private: doc.getElementById('btn-private'),
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
  let confirmKind = 'move';     // what the bar asks: 'move' (Move / Cancel) or 'end' (End turn / Keep playing)
  let confirmShownAt = 0;       // when the bar last began asking something else (the double-tap guard of 'end')
  let mini = null;            // the top-strip guest cells
  let lastFloor = null;       // (the floor of the last update: the strip's own refresh in syncStrip needs it)
  let stripIds = null, stripPoss = false, stripSig = '';   // what the strip's "Possessed" markers were last drawn from (syncStrip)
  let roundKey = '';          // the strip's round line, so it only touches the page when it changes
  let portraitKey = '';       // so the panel portrait only rebuilds when it must
  let soulsKey = '';          // so the panel's souls counter only rebuilds when it must
  let lanternKey = '';        // so the Lanterns chip only touches the page when the count changes
  let endLine = { own: '', shared: '' };   // End turn's second line: the guest's own words / the shared words

  // Top strip: one always-neutral portrait per guest, built once for the roster. Each cell: the turn flag, the
  // portrait (the initial in its corner, health on its lower edge), the name and where they are. The red-eye badge and the
  // "Possessed" tag are in every cell but hidden (and empty) until the viewer certainly knows that guest is possessed.
  function buildStrip(state) {
    el.cards.innerHTML = '';
    el.root.style.setProperty('--n', state.players.length);      // (styles.css sizes the cells, and keeps the feed clear of them, by how many there are)
    const marks = guestMarks(state.players.map(p => p.name));      // (the initial in the portrait's corner, so the colour is not the only mark)
    mini = state.players.map((p, i) => {
      const cell = doc.createElement('div');
      cell.className = 'mini-player';
      cell.style.setProperty('--player-color', p.color);
      const flag = doc.createElement('div'); flag.className = 'mini-flag';
      const wrap = doc.createElement('div'); wrap.className = 'mini-pwrap';      // (the portrait clips its picture; the badge and the tag sit on its edge)
      const port = doc.createElement('div'); port.className = 'mini-portrait'; port.dataset.mark = marks[i];
      port.appendChild(makePortrait(doc, p, { possessed: false })); // never reveal roles here (but see `red` below)
      // Health is public: hearts on a dark band across the portrait's lower edge (the stats are drawn by setHearts).
      const stats = doc.createElement('span'); stats.className = 'mini-stats';
      const eye = doc.createElement('span'); eye.className = 'mini-eye'; eye.hidden = true; eye.innerHTML = EYE_BADGE;
      wrap.append(port, stats, eye);
      const tag = doc.createElement('div'); tag.className = 'mini-known';      // ("Possessed", under the portrait: filled in and shown only for a guest the viewer knows)
      // The guest's username, on one line (a long one ends in "…"; the full name on hover).
      const name = doc.createElement('div'); name.className = 'mini-name u'; name.textContent = p.name; name.title = p.name;
      // PUBLIC information only: where they are and their health. A hidden role is never shown here,
      // and neither is how many cards anyone holds (approved rule, docs/GAME_RULES.md > Possession: a
      // Possession card or a Lantern block changes counts unevenly). Your own count is in your own hand.
      // The room (its short name, full name on hover) under the name.
      const where = doc.createElement('div'); where.className = 'mini-where';
      const room = doc.createElement('span'); room.className = 'mini-room';
      where.append(room);
      cell.append(flag, wrap, tag, name, where);
      el.cards.appendChild(cell);
      return { cell, flag, where, room, stats, port, eye, tag, red: false, key: '' };
    });
    roundKey = '';
  }

  // Health as hearts, full ones bright and empty ones dim (the text is still "♥♥♥♡", so it reads without the colour).
  function setHearts(node, n) {
    const full = doc.createElement('span'); full.className = 'hf'; full.textContent = '♥'.repeat(n);
    const empty = doc.createElement('span'); empty.className = 'he'; empty.textContent = '♡'.repeat(Math.max(0, rules.maxHealth - n));
    node.replaceChildren(full, empty);
    node.classList.toggle('low', n <= 1);
  }

  // The strip itself, from the model (src/ui/stripModel.js: turn order, flags, and the guests the viewer CERTAINLY knows
  // are possessed; src/ui/roundLabel.js: turns left in the round). A cell is touched only when its row changed, the round
  // line only when its words did, so a turn that changes little costs little.
  function drawStrip(state, floor) {
    if (!mini || mini.length !== state.players.length) buildStrip(state);
    const p = viewerOf(state);
    stripIds = knownPossessedIds(state, p); stripPoss = !!p.possessed; stripSig = stripSignature(stripIds, stripPoss);
    // Red eyes on the guests the player KNOWS are possessed, while possessed themselves (approved;
    // src/ui/allies.js): the player's own screen only, from what they know, never from a real role.
    // (The clearer "Possessed" marker, below, is for either side: a clean guest who learned it sees it too, without red eyes.)
    const allies = redEyedAllies(state, p);
    const rows = stripGuests(state, p);
    let anyKnown = false;
    state.players.forEach((q, i) => {
      const g = rows[i], m = mini[i];
      if (g.known) anyKnown = true;
      const red = allies.has(q.id);
      const place = floor.rooms.get(q.currentRoom);
      const where = g.out ? 'Escaped' : !q.alive ? 'Dead' : (place?.short || place?.name || '—');
      const key = `${red}|${g.active}|${g.next}|${g.dead}|${g.out}|${g.me}|${g.known}|${g.flag}|${where}|${q.health}`;
      if (key === m.key) return;
      m.key = key;
      if (m.red !== red) { m.red = red; m.port.replaceChildren(makePortrait(doc, q, { possessed: red })); m.cell.classList.toggle('ally', red); }
      m.cell.classList.toggle('active', g.active);
      m.cell.classList.toggle('next', g.next);
      m.cell.classList.toggle('dead', g.dead);
      m.cell.classList.toggle('escaped', g.out);
      m.cell.classList.toggle('me', g.me);
      m.flag.textContent = g.flag;
      // The viewer's own knowledge only: a crimson frame, the eye badge and the word "Possessed", never on a guest they are unsure of.
      m.cell.classList.toggle('known', g.known);
      m.eye.hidden = !g.known;
      m.tag.classList.toggle('on', g.known);
      m.tag.textContent = g.known ? 'Possessed' : '';
      m.room.textContent = where;
      m.room.title = g.out || !q.alive ? '' : (place?.name ?? '');
      // Health only: no card count for anyone (see buildStrip).
      if (rules.healthEnabled && !g.out && q.alive) {
        setHearts(m.stats, q.health);
        m.stats.setAttribute('aria-label', `Health ${q.health} of ${rules.maxHealth}`);
      } else { m.stats.replaceChildren(); m.stats.removeAttribute('aria-label'); }
    });
    el.strip.classList.toggle('has-known', anyKnown);
    // Where the round ends: "3 turns left in Round 2", the divider after the last guest, and in the final round, dawn.
    const ro = roundReadout(state);
    const rk = ro ? `${ro.text}|${ro.final}|${ro.last}` : '';
    if (rk !== roundKey) {
      roundKey = rk;
      el.roundLine.hidden = el.cap.hidden = !ro;
      el.strip.classList.toggle('final', !!ro?.final);
      el.strip.classList.toggle('last-turn', !!ro?.last);
      el.roundText.textContent = ro ? ro.text : '';
      el.capWord.textContent = ro ? ro.capWord : '';
    }
  }

  // What the markers on the strip depend on: the guests the viewer knows are possessed, and whether they are possessed
  // themselves (that turns on the red eyes). A new string means the strip has to be drawn again.
  const stripSignature = (ids, possessed) => `${possessed ? 1 : 0}:${[...ids].join(',')}`;

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
    // (Back to the menu: the corner shadow sits outside #hud, so it is hidden too; syncTell turns it
    // back on in the next game only if the player is possessed there.)
    hide() { el.root.hidden = true; el.tint.hidden = true; },
    // A new table: the strip is built again for its guests.
    rebuild() { mini = null; portraitKey = ''; soulsKey = ''; lanternKey = ''; stripSig = ''; roundKey = ''; },
    update(state, floor) {
      const active = activePlayer(state);
      const p = viewerOf(state);
      const mine = p === active && !state.finished;          // the viewer's own turn
      const match = state.players.length > 1;
      const next = nextPlayer(state);

      // The viewer's panel (their own private view: only they look at this screen).
      el.panel.style.setProperty('--player-color', p.color);
      el.panel.classList.toggle('waiting', !mine && !state.finished);
      el.name.textContent = p.name;
      // Health is a Phase 1 system. While it is off nothing can change it, so showing three
      // bars would imply a rule that does not exist yet.
      el.healthRow.hidden = !rules.healthEnabled;
      if (rules.healthEnabled) renderHealth(p.health);
      renderAp(mine ? p.actionPoints : 0);
      if (!mine && !state.finished) { el.ap.textContent = !p.alive ? 'Out' : 'Waiting'; el.ap.classList.remove('empty'); }
      // The private tell: the crimson plate, the POSSESSED badge by the name (or a quiet CLEAN in a
      // match), how many Possession cards ("souls") are left to trade, and the faint corner shadow.
      hud.syncTell(state);

      // Header.
      const room = floor.rooms.get(p.currentRoom);
      el.room.textContent = room?.name ?? '—';
      el.safeBadge.hidden = !room?.safe;
      // "Round 3 of 8"; the last round before dawn is marked in words and colour: "Final round" on a second line,
      // so the label is no wider than the buttons under it (the guest strip beside it is wide).
      const last = isFinal(state) && !state.finished;
      const roundWords = roundLabel(state), roundK = last ? `${roundWords}|final` : roundWords;
      if (el.round.dataset.k !== roundK) {
        el.round.dataset.k = roundK;
        if (last) {
          const note = doc.createElement('span'); note.className = 'round-note'; note.textContent = finalRoundShort;
          el.round.replaceChildren(`${roundWords} `, note);
        } else el.round.textContent = roundWords;
      }
      el.round.classList.toggle('final', last);
      // Practice is a single guest: the top strip of other players has nothing to show.
      el.topCenter.hidden = state.players.length < 2;
      el.restartPractice.hidden = !rules.practiceMode;
      el.leave.hidden = false;

      // End turn (prominent; names the next guest). On another guest's turn it says whose turn it is and
      // waits; once the player is out (dead) it skips to the result.
      // The End turn question names the actions still unspent: it follows them (a card played behind it),
      // and goes when there is nothing to ask any more (none left, not the player's turn, game over).
      if (confirmKind === 'end') {
        if (!mine || p.actionPoints <= 0) hud.hideConfirm(); else el.confirmText.textContent = endTurnAsk(p.actionPoints);
      }
      el.endTurn.classList.toggle('waiting', !mine && !state.finished && p.alive);
      if (state.finished) { el.endMain.textContent = 'Game over'; endLine = { own: '', shared: '' }; el.endTurn.disabled = true; }
      else if (match && !p.alive) {
        el.endMain.textContent = 'Skip to the end ›';
        endLine = { own: '', shared: 'You are out' };
        el.endTurn.disabled = false;
      } else if (!mine) {
        // ("nightowl’s turn": a long name ends in "…" before "’s turn", styles.css .end-name)
        if (el.endMain.textContent !== `${active.name}’s turn`) {
          const who = doc.createElement('span'); who.className = 'end-name'; who.textContent = active.name;
          el.endMain.replaceChildren(who, '’s turn');
        }
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

      // (No room button: searching, leaving through the Fire Exit, healing in an Infirmary and ringing the Switchboard are
      // each the icon over the room's furniture, src/ui/searchSpot.js, main.js onEscape / onRoom.)

      // Voluntary trade: only in a safe zone that allows it (the Fire Exit, never the lobby), with
      // someone else there to trade with.
      el.trade.hidden = !mine || !canTradeVoluntarily(state, floor, p);

      // Top strip: current-turn + next-player indicators, who the viewer knows is possessed, how far round the round is.
      lastFloor = floor;
      drawStrip(state, floor);
    },
    // --- Turn timer ---------------------------------------------------------------------------
    // Shown only while the active player's action phase is running. It is hidden (and not
    // counting) during every hand-over and role screen, so passing the device costs nobody time.
    // Runs every frame of a turn, so it touches the page only where something changed, and the bar is
    // drawn with a transform (no page re-layout).
    showTimer(left, total) {
      if (el.timer.hidden) el.timer.hidden = false;
      const frac = Math.max(0, Math.min(1, total ? left / total : 0));
      const bar = `scaleX(${frac.toFixed(3)})`;
      if (el.timerFill.style.transform !== bar) el.timerFill.style.transform = bar;
      const secs = `${Math.ceil(Math.max(0, left))}s`;
      if (el.timerSeconds.textContent !== secs) el.timerSeconds.textContent = secs;
      const low = left <= 10;
      if (el.timer.classList.contains('low') !== low) el.timer.classList.toggle('low', low);
    },
    // The player's own role on their own panel: possessed → the crimson plate, the POSSESSED badge
    // ("Only you can see this"), the souls count and the faint corner shadow over the hotel; clean, in a
    // match → a quiet CLEAN badge; practice (one guest, no roles) → neither. Only ever the VIEWER's own
    // role: the public strip never shows it. Cheap (touches the page only on a change), so main.js also
    // runs it every frame — a mid-match possession turns it on at once, a new game turns it off.
    syncTell(state) {
      const p = viewerOf(state);
      if (!p) return;
      const match = state.players.length > 1;
      const on = match && !!p.possessed;
      const clean = match && !on;
      // Their own portrait: the possessed one (the same face, red eyes) only while possessed.
      const key = `${p.index}:${on}:${p.avatar ? avatarKey(p.avatar) : p.outfit}`;
      if (key !== portraitKey) {
        portraitKey = key;
        el.portrait.replaceChildren(makePortrait(doc, p, { possessed: on }));
      }
      el.panel.classList.toggle('possessed', on);
      if (el.role.hidden !== !on) el.role.hidden = !on;
      if (el.clean.hidden !== !clean) el.clean.hidden = !clean;
      if (el.tint.hidden !== !on) el.tint.hidden = !on;
      if (el.souls.hidden !== !on) el.souls.hidden = !on;
      const sk = on ? `${p.index}:${soulsHeld(p)}` : '';
      if (sk !== soulsKey) {
        soulsKey = sk;
        el.souls.replaceChildren(...(on ? [soulsChip(doc, soulsHeld(p), { compact: true, owner: p.id })] : []));
      }
      hud.syncLanterns(p);
      hud.syncStrip(state);
    },
    // The Lanterns chip: the VIEWER's own Lanterns out of the number that opens the Fire Exit ("✦ 1/3"). Their
    // own hand only, shown the same way whatever their role (a possessed guest can hold Lanterns too, and
    // the chip is no sign of one side or the other). Touches the page only on a change; syncTell runs it every frame.
    syncLanterns(p) {
      const n = p.hand.reduce((k, c) => k + (c.type === 'lantern' ? 1 : 0), 0);
      const key = `${p.index}:${n}`;
      if (key === lanternKey) return;
      lanternKey = key;
      const need = rules.lanternsToEscape;
      el.lanternLabel.textContent = LANTERN_CHIP.label;
      if (el.lanternGlyph) el.lanternGlyph.textContent = rules.cards.lantern.glyph;
      el.lanternCount.textContent = LANTERN_CHIP.text(n, need);
      el.lanternChip.setAttribute('aria-label', LANTERN_CHIP.aria(n, need));
    },
    // The strip's "Possessed" markers follow what the viewer knows. update() draws them; this cheap check (it runs with
    // syncTell, every frame) catches the moments nothing else refreshes the page, such as a trade scene letting a held-back
    // guest go. It draws again only when what the markers depend on changed.
    syncStrip(state) {
      if (!mini || !lastFloor) return;
      const p = viewerOf(state);
      if (!p) return;
      const ids = knownPossessedIds(state, p);
      if (ids === stripIds && !!p.possessed === stripPoss) return;     // (the usual frame: nothing new, nothing made)
      const sig = stripSignature(ids, !!p.possessed);
      stripIds = ids; stripPoss = !!p.possessed;
      if (sig !== stripSig) drawStrip(state, lastFloor);
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
      // (shown first, then written: a screen reader speaks text that appears in a live region it can already reach,
      // so a refusal like "No actions left." is heard, not only seen)
      el.toast.hidden = false;
      el.toast.textContent = message;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { el.toast.hidden = true; }, seconds * 1000);
    },
    // The bar asks Move / Cancel (kind 'move', the default) or, from End turn, End turn / Keep playing.
    showConfirm(text, moveLabel, { kind = 'move', cancelLabel = 'Cancel' } = {}) {
      el.confirmText.textContent = text;
      if (moveLabel) el.confirmMove.textContent = moveLabel;
      el.confirmCancel.textContent = cancelLabel;
      if (el.confirmBar.hidden) pressedConfirm = false;
      if (el.confirmBar.hidden || kind !== confirmKind) confirmShownAt = performance.now();
      confirmKind = kind;
      el.confirmBar.hidden = false;
    },
    // "You still have 3 actions. End turn?" (only called with actions left)
    askEndTurn(actionsLeft) { hud.showConfirm(endTurnAsk(actionsLeft), 'End turn', { kind: 'end', cancelLabel: 'Keep playing' }); },
    hideConfirm() { el.confirmBar.hidden = true; confirmKind = 'move'; },
    get confirmOpen() { return !el.confirmBar.hidden; },
    get confirmKind() { return el.confirmBar.hidden ? null : confirmKind; },
    on(name, fn) { el[name].addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onConfirm(move, cancel, endTurn) {
      // Belt and braces for src/input.js: a pointer click on Move/Cancel counts only if the press
      // started on the bar after it appeared (a late click left over from the tap that opened it
      // does not). Clicks with no pointer behind them (keyboard, e.detail 0) always count. The End turn
      // question is under the tap guard too: the second tap of a double tap on End turn must not answer
      // the question it opened (src/ui/tapGuard.js).
      el.confirmBar.addEventListener('pointerdown', () => { pressedConfirm = true; });
      const real = e => e.detail === 0 || pressedConfirm;
      el.confirmMove.addEventListener('click', e => {
        e.preventDefault();
        if (confirmKind === 'end') {
          if (!real(e) || tooSoon(e, confirmShownAt)) return;
          hud.hideConfirm(); endTurn?.();
          return;
        }
        if (real(e)) move();
      });
      el.confirmCancel.addEventListener('click', e => {
        e.preventDefault();
        if (confirmKind === 'end' && tooSoon(e, confirmShownAt)) return;
        if (real(e)) cancel();
      });
    },
  };
  return hud;
}
