// The hand panel: the active player's cards, health, possession status and what they know.
// In hot-seat everything is visible to the one person; the panel still shows each player's
// private information (their tell, who they've unmasked) so the mechanics can be verified.
import { activePlayer } from '../game/state.js';
import { rules } from '../data/rules.js';
import { CARDS, lanternCount } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createHand(doc, cfg, { onUseBandage }) {
  const overlay = doc.getElementById('hand-overlay');
  const title = doc.getElementById('hand-title');
  const banner = doc.getElementById('hand-banner');
  const cards = doc.getElementById('hand-cards');
  const note = doc.getElementById('hand-note');
  const closeBtn = doc.getElementById('btn-hand-close');
  let open = false;
  let ctx = null;

  function render() {
    const { state } = ctx;
    const p = activePlayer(state);
    title.textContent = `${p.name} · Hand`;

    if (p.possessed) {
      banner.hidden = false;
      banner.className = 'banner';
      banner.textContent = 'You are POSSESSED. In a trade you may give a Possession card to convert someone — unless they hand you a Lantern.';
    } else if (p.knows.size) {
      const names = [...p.knows].map(id => state.players.find(q => q.id === id)?.name).filter(Boolean);
      banner.hidden = false;
      banner.className = 'banner info';
      banner.textContent = `You have unmasked: ${names.join(', ')} — possessed.`;
    } else {
      banner.hidden = true;
    }

    cards.innerHTML = '';
    // Order the hand so the same types sit together.
    const order = Object.keys(CARDS);
    const hand = [...p.hand].sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    for (const card of hand) {
      const opts = {};
      if (card.type === 'bandage') {
        opts.action = {
          label: 'Use · 1 AP',
          primary: true,
          disabled: p.actionPoints < rules.actionCost.useCard || p.health >= rules.maxHealth,
          onClick: c => { onUseBandage(c.id); },
        };
      } else if (card.type === 'masterKey' || card.type === 'lockPick' || card.type === 'barricade') {
        opts.desc = CARDS[card.type].desc; // notes "no locked rooms in this build yet"
      }
      cards.appendChild(cardTile(doc, card, opts));
    }
    if (!hand.length) cards.innerHTML = '<div class="panel-note">No cards.</div>';

    const lc = lanternCount(p.hand);
    note.textContent = `Health ${p.health}/${rules.maxHealth} · AP ${p.actionPoints}/${rules.actionPointsPerTurn} · `
      + `Exit Key: ${lc}/${rules.lanternsToEscape} Lanterns${lc >= rules.lanternsToEscape ? ' — reach the Fire Exit to win!' : ''}`;
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
