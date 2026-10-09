// The card view: one card of the active guest's hand shown large — its face, its name, what it does
// and, when it has one, its action (Use, Open, Seal, Drink, whose hand to look at). Opened by tapping a
// card in the hand fan (src/ui/handFan.js) or the "Private details" link; ‹ › step through the hand.
// Private to the player (only they look at this screen): it shows their Lanterns, their Possession cards and who they
// have unmasked. Tap outside the panel, or Close, to put it away.
import { activePlayer, adjacentLockedRooms, isBarricaded, playersInRoom, doorBetween, moveCostInto } from '../game/state.js';

// The hand shown is the viewer's own (state.viewerIndex: the player). Its actions work only on their turn.
const viewerOf = state => state.players[state.viewerIndex ?? state.activeIndex] || activePlayer(state);
const ownTurn = (state, p) => !state.finished && state.players[state.activeIndex] === p;
import { rules } from '../data/rules.js';
import { CARDS, countableCount } from '../game/cards.js';
import { bigCard, sortHand, cardDesc, handLimitWarning } from './cards.js';
import { makePortrait } from './portrait.js';
import { soulsHeld, soulsChip } from './souls.js';

export function createHand(doc, cfg, { onUseBandage, onUnlock, onBarricade, onEspresso, onHandMirror }) {
  const overlay = doc.getElementById('hand-overlay');
  const title = doc.getElementById('hand-title');
  const banner = doc.getElementById('hand-banner');
  const big = doc.getElementById('hand-big');
  const detail = doc.getElementById('hand-detail');
  const note = doc.getElementById('hand-note');
  const closeBtn = doc.getElementById('btn-hand-close');
  const prevBtn = doc.getElementById('btn-hand-prev');
  const nextBtn = doc.getElementById('btn-hand-next');
  const position = doc.getElementById('hand-pos');
  let open = false;
  let ctx = null;
  let selectedId = null;
  let selectedType = null;      // so a Possession card given away hands the view to the next one

  function render() {
    const { state, floor } = ctx;
    const p = viewerOf(state);
    title.textContent = state.players.length > 1 ? 'Your hand' : `${p.name}'s hand`;
    const souls = soulsHeld(p);

    // Possession cards first, then the rest grouped by type (Lanterns lead the catalogue). The
    // Possession cards are one stack (×N): they are all the same card, and the count is what matters.
    const sorted = sortHand(p.hand);
    const firstSoul = sorted.find(c => c.type === 'possession');
    const hand = sorted.filter(c => c.type !== 'possession' || c === firstSoul);
    if (selectedType === 'possession' && firstSoul && !hand.some(c => c.id === selectedId)) selectedId = firstSoul.id;
    else if (firstSoul && sorted.some(c => c.id === selectedId && c.type === 'possession')) selectedId = firstSoul.id;
    if (!hand.some(c => c.id === selectedId)) selectedId = hand[0]?.id ?? null;
    const at = hand.findIndex(c => c.id === selectedId);
    const card = hand[at] || null;

    const showingSouls = card?.type === 'possession';

    // The possessed guest's reminder, as the crimson plate (only they look at this screen): their
    // possessed portrait (the same face, red eyes), the POSSESSED badge with "Only you can see this",
    // what it means and how many Possession cards ("souls") they can still trade.
    const tell = !!p.possessed;
    overlay.classList.toggle('possessed', tell);
    banner.className = 'banner'; banner.innerHTML = '';   // nothing left behind for the next guest
    if (p.possessed) {
      banner.hidden = false; banner.className = 'banner possessed';
      if (tell) {
        const port = doc.createElement('div'); port.className = 'banner-portrait';
        port.appendChild(makePortrait(doc, p, { possessed: true }));
        banner.appendChild(port);
      }
      const badge = doc.createElement('div'); badge.className = 'tell-badge possessed';
      badge.innerHTML = '<span class="tell-pill">POSSESSED</span><span class="tell-note">Only you can see this</span>';
      banner.appendChild(badge);
      const text = doc.createElement('div'); text.className = 'banner-text';
      const words = doc.createElement('div'); words.className = 'banner-words';
      // On the Possession card itself the count and what it does are in the detail beside it (said
      // once), so the banner keeps only the role; on every other card it carries both. The banner is
      // the same height either way (styles.css: two lines' room, the count chip beside the words), so
      // the card and the ‹ › arrows below it stay put while you step through the hand.
      words.innerHTML = showingSouls ? 'You can never escape.'
        : 'In a trade, give a Possession card to possess the other guest — unless they hand you a Lantern. You can never escape.';
      text.append(words);
      if (!showingSouls) text.append(soulsChip(doc, souls));
      banner.appendChild(text);
    } else if (p.knows.size) {
      const names = [...p.knows].map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
      banner.hidden = false; banner.className = 'banner info';
      banner.textContent = `You have unmasked: ${names.join(', ')} — possessed.`;
    } else banner.hidden = true;

    big.innerHTML = '';
    selectedType = card?.type ?? null;
    if (card) {
      const bc = bigCard(doc, card, { text: false });
      if (card.type === 'possession') {
        const b = doc.createElement('span'); b.className = 'face-badge souls'; b.textContent = `×${souls}`;
        b.setAttribute('aria-label', `${souls} Possession card${souls === 1 ? '' : 's'}`);
        bc.querySelector('.bc-face')?.appendChild(b);
      }
      big.appendChild(bc);
    }
    else big.innerHTML = '<div class="panel-note">No cards.</div>';
    position.textContent = hand.length ? `${at + 1} of ${hand.length}` : '';
    prevBtn.disabled = nextBtn.disabled = hand.length < 2;
    prevBtn.onclick = e => { e.preventDefault(); selectedId = hand[(at - 1 + hand.length) % hand.length]?.id; render(); };
    nextBtn.onclick = e => { e.preventDefault(); selectedId = hand[(at + 1) % hand.length]?.id; render(); };

    renderDetail(state, floor, p, card, souls);

    // An Espresso can lift a turn above the usual action points: say by how much.
    const base = rules.actionPointsPerTurn;
    const actions = p.actionPoints > base ? `Actions ${p.actionPoints} (+${p.actionPoints - base})` : `Actions ${p.actionPoints}/${base}`;
    const parts = [`Health ${p.health}/${rules.maxHealth}`, actions,
      handLimitWarning(p) || `Cards ${countableCount(p.hand)}/${rules.handLimit}`, `Lanterns ${p.hand.filter(c => c.type === 'lantern').length}/${rules.lanternsToEscape}`];
    // (No souls count here: the banner, or on the Possession card its own count line, already says it.)
    note.textContent = parts.join(' · ');
  }

  function renderDetail(state, floor, p, card, souls = 0) {
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
    // (A Possession card has its own count line and description below instead of the catalogue words.)
    if (card.type !== 'possession') line(cardDesc(card.type), 'd-desc');

    // Not their turn: the card can be read, not used.
    const notMine = !ownTurn(state, p);
    const noAp = notMine || p.actionPoints < rules.actionCost.useCard;
    const apNote = notMine ? (p.alive ? 'You can use it on your own turn.' : 'You are out of the match.') : 'No actions left this turn.';
    if (card.type === 'lantern') {
      const held = p.hand.filter(c => c.type === 'lantern').length;
      line(`<b>Escape:</b> you hold ${held} of ${rules.lanternsToEscape}. A clean guest carrying ${rules.lanternsToEscape} Lanterns escapes from the fire exit with the Escape button (${rules.actionCost.escape} action).${p.possessed ? ' While you are possessed it will not open for you.' : ''}`);
      if (!state.practice) {
        line('<b>In a trade:</b> in an ordinary trade it goes to the other guest like any card — pass them to one guest. If they handed you a Possession card, your Lantern blocks it: both cards are used up and you learn who tried.', 'd-tag');
      }
      return;
    }
    if (card.type === 'possession') {
      // One count line and one description, said once (docs/GAME_RULES.md > Meetings, Possession).
      line(`Souls to trade: <b>${souls}</b>`, 'd-line souls-line');
      line('Give one in a trade to possess the other guest — unless they hand you a Lantern: then both cards are used up and they learn you are possessed. Never counts toward your hand limit.', 'd-desc');
      return;
    }
    if (card.type === 'flashlight') { line('Kept in hand; lets you search a dark room. Never used up.', 'd-tag'); return; }
    if (meta.weapon) { line(state.practice ? 'No one to attack on your own.' : 'Chosen when you attack during a meeting.', 'd-tag'); return; }

    if (card.type === 'bandage') {
      const full = p.health >= rules.maxHealth;
      if (full || noAp) line(full ? 'Already at full health.' : apNote, 'd-tag');
      actionBtn(`Use · ${rules.actionCost.useCard} action`, full || noAp, () => onUseBandage(card.id));
      return;
    }
    if (meta.unlock) {
      const targets = adjacentLockedRooms(state, floor, p);
      if (!targets.length) { line('No locked door next to you to use it on.', 'd-tag'); return; }
      if (noAp) line(apNote, 'd-tag');
      for (const roomId of targets) {
        const name = floor.rooms.get(roomId)?.name ?? roomId;
        // A barricaded door stays shut to everyone until the door has locked again: the card would be wasted.
        const sealed = isBarricaded(state, doorBetween(floor, p.currentRoom, roomId)?.id);
        if (sealed) line(`The ${name} door is barricaded: no key or pick can get you through it until the barricade comes down.`, 'd-tag');
        // Allowed, but the door locks again when the turn ends: say so when there is no action left to go in.
        else if (!noAp && p.actionPoints - rules.actionCost.useCard < moveCostInto(state, roomId) && !p.hand.some(c => c.type === 'espresso')) {
          line('You will have no action left to go in: the door locks again when your turn ends.', 'd-tag d-warn');
        }
        actionBtn(`Open the ${name} door · ${rules.actionCost.useCard} action`, noAp || sealed, () => onUnlock(card.id, roomId));
      }
      return;
    }
    if (card.type === 'barricade') {
      const doors = (floor.rooms.get(p.currentRoom)?.doorways || []).filter(d => !isBarricaded(state, d.id));
      if (!doors.length) { line('Every doorway here is already sealed.', 'd-tag'); return; }
      if (noAp) line(apNote, 'd-tag');
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
      line(noAp ? apNote : `Whose hand? · ${rules.actionCost.useCard} action`, 'd-tag');
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
      const short = notMine || p.actionPoints < cost;
      line('The extra actions are gone when the turn ends, like any you have not used.', 'd-tag');
      if (short) line(apNote, 'd-tag');
      actionBtn(`Drink · ${cost ? `${cost} action` : 'free'}`, short, () => onEspresso(card.id));
    }
  }

  const api = {
    get isOpen() { return open; },
    get cardId() { return open ? selectedId : null; },
    // Open on card `cardId` (or the first card of the hand).
    open(state, floor, cardId = null) {
      ctx = { state, floor }; open = true; overlay.hidden = false;
      selectedId = cardId;
      render();
    },
    // After anything that changes the hand. A card that has just been used up takes the view with it.
    refresh() {
      if (!open) return;
      const p = viewerOf(ctx.state);
      const stillThere = p.hand.some(c => c.id === selectedId)
        || (selectedType === 'possession' && p.hand.some(c => c.type === 'possession'));
      if (selectedId && !stillThere) { api.close(); return; }
      render();
    },
    close() {
      open = false; overlay.hidden = true; overlay.classList.remove('possessed');
      banner.hidden = true; banner.className = 'banner'; banner.innerHTML = '';
      // Nothing of this guest's hand (a Possession card, a souls count) waits in the hidden view for
      // the next guest: open() renders it all again.
      big.innerHTML = ''; detail.innerHTML = ''; note.textContent = ''; position.textContent = '';
      ctx = null; selectedId = null; selectedType = null;
    },
  };
  closeBtn.addEventListener('click', e => { e.preventDefault(); api.close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) api.close(); });
  return api;
}
