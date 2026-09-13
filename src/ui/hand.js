// The hand sheet: the active player's cards as large illustrated tiles, with a detail pane that
// shows the selected card's description and any valid action. It docks to the bottom so the room
// stays in view. In hot-seat everything is visible to the one person; the sheet still shows this
// player's private information (their possession tell, who they've unmasked).
import { activePlayer } from '../game/state.js';
import { rules } from '../data/rules.js';
import { CARDS, lanternCount } from '../game/cards.js';
import { cardTile } from './cards.js';

// How each card is actually used — so the detail pane can explain it instead of implying every
// card has a "Use" button. Only Bandage is a standalone play; the rest are used in context.
const USAGE = {
  // Lantern is explained in full by renderDetail (two functions), so it is not listed here.
  flashlight: 'Used automatically when you search a dark room.',
  knife: 'Chosen when you attack during a forced encounter.',
  revolver: 'Chosen when you attack during a forced encounter.',
  bandage: 'Play it on your turn to restore a health bar.',
  possession: 'The possessed side gives this in a trade to convert someone — unless they hand back a Lantern.',
  masterKey: 'Would open a locked room. No locked rooms in this build yet.',
  lockPick: 'Would attempt a locked room. No locked rooms in this build yet.',
  barricade: 'Would seal a doorway for a round. No locked rooms in this build yet.',
  trinket: 'A worthless keepsake — no effect.',
};

export function createHand(doc, cfg, { onUseBandage }) {
  const overlay = doc.getElementById('hand-overlay');
  const title = doc.getElementById('hand-title');
  const banner = doc.getElementById('hand-banner');
  const cards = doc.getElementById('hand-cards');
  const detail = doc.getElementById('hand-detail');
  const note = doc.getElementById('hand-note');
  const closeBtn = doc.getElementById('btn-hand-close');
  let open = false;
  let ctx = null;
  let selectedId = null;

  function render() {
    const { state } = ctx;
    const p = activePlayer(state);
    title.textContent = `${p.name}'s hand`;

    if (p.possessed) {
      banner.hidden = false; banner.className = 'banner';
      banner.textContent = 'You are POSSESSED. In a trade you may give a Possession card to convert someone — unless they hand you a Lantern.';
    } else if (p.knows.size) {
      const names = [...p.knows].map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
      banner.hidden = false; banner.className = 'banner info';
      banner.textContent = `You have unmasked: ${names.join(', ')} — possessed.`;
    } else banner.hidden = true;

    // Order the hand so like types sit together.
    const order = Object.keys(CARDS);
    const hand = [...p.hand].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    if (!hand.some(c => c.id === selectedId)) selectedId = hand[0]?.id ?? null;

    cards.innerHTML = '';
    for (const card of hand) {
      cards.appendChild(cardTile(doc, card, {
        hideDesc: true,
        selectable: true,
        selected: card.id === selectedId,
        onSelect: c => { selectedId = c.id; render(); },
      }));
    }
    if (!hand.length) cards.innerHTML = '<div class="panel-note">No cards.</div>';

    renderDetail(p, hand.find(c => c.id === selectedId) || null);

    // Footer summary. The Exit-Key / escape hint is for clean players only — a possessed player is
    // never shown an unconditional "reach the exit to win" message.
    const lc = lanternCount(p.hand);
    let summary = `Health ${p.health}/${rules.maxHealth} · Actions ${p.actionPoints}/${rules.actionPointsPerTurn}`;
    if (!p.possessed) {
      summary += ` · Exit Key ${lc}/${rules.lanternsToEscape} Lanterns`;
      if (lc >= rules.lanternsToEscape) summary += ' — reach the Fire Exit while unpossessed to escape!';
    }
    note.textContent = summary;
  }

  function renderDetail(p, card) {
    detail.innerHTML = '';
    if (!card) { detail.innerHTML = '<div class="d-empty">Select a card to see what it does.</div>'; return; }
    const meta = CARDS[card.type];
    const line = (html, cls = 'd-line') => { const d = doc.createElement('div'); d.className = cls; d.innerHTML = html; detail.appendChild(d); };

    const name = doc.createElement('div'); name.className = 'd-name';
    const shots = card.type === 'revolver' && card.shots != null ? ` · ${card.shots} shot${card.shots === 1 ? '' : 's'}` : '';
    name.textContent = `${meta.name}${shots}`;
    if (meta.evil) name.style.color = 'var(--evil)';
    detail.appendChild(name);

    if (card.type === 'lantern') {
      // Two distinct functions, explained once each — no repeated line. The escape function is
      // shown only to a player who could actually use it (never an unconditional win hint to the
      // possessed).
      line('<b>In a trade:</b> give it in the same exchange to block a possession attempt — the possession fails and you learn who tried.');
      if (p.possessed) {
        line('<b>Escape:</b> three Lanterns are the Exit Key — but only an unpossessed guest can escape, so it will not free you while you are possessed.');
      } else {
        line(`<b>To escape:</b> collect ${rules.lanternsToEscape} Lanterns and reach the Fire Exit while unpossessed.`);
        const lc = lanternCount(p.hand);
        const track = doc.createElement('div'); track.className = 'lantern-track';
        for (let i = 0; i < rules.lanternsToEscape; i++) {
          const pip = doc.createElement('span'); pip.className = 'pip' + (i < lc ? ' on' : ''); pip.textContent = '✦'; track.appendChild(pip);
        }
        const c = doc.createElement('span'); c.className = 'lt-count'; c.textContent = `${lc} / ${rules.lanternsToEscape} Lanterns held`; track.appendChild(c);
        detail.appendChild(track);
      }
      return;
    }

    line(meta.desc, 'd-desc');
    if (USAGE[card.type]) line(USAGE[card.type], 'd-tag');

    // Bandage is the one card played directly from the hand.
    if (card.type === 'bandage') {
      const full = p.health >= rules.maxHealth, noAp = p.actionPoints < rules.actionCost.useCard;
      if (full || noAp) line(full ? 'Already at full health.' : 'No actions left this turn.', 'd-tag');
      const btn = doc.createElement('button');
      btn.type = 'button'; btn.className = 'btn primary';
      btn.textContent = 'Use · 1 action';
      btn.disabled = full || noAp;
      btn.addEventListener('click', e => { e.preventDefault(); onUseBandage(card.id); });
      detail.appendChild(btn);
    }
  }

  const api = {
    get isOpen() { return open; },
    open(state, floor) { ctx = { state, floor }; open = true; overlay.hidden = false; render(); },
    refresh() { if (open) render(); },
    close() { open = false; overlay.hidden = true; },
  };
  closeBtn.addEventListener('click', e => { e.preventDefault(); api.close(); });
  overlay.addEventListener('click', e => { if (e.target === overlay) api.close(); });
  return api;
}
