// The forced-encounter modal: when a player enters a room with someone, they choose Trade
// or Attack. In hot-seat both hands are visible; the flow still mirrors the real game —
// the entering player picks their card, then the other picks theirs, then it resolves.
import { tradeableCards } from '../game/actions.js';
import { CARDS, weaponsIn } from '../game/cards.js';
import { cardTile } from './cards.js';

export function createEncounter(doc, cfg) {
  const overlay = doc.getElementById('encounter-overlay');
  const title = doc.getElementById('encounter-title');
  const body = doc.getElementById('encounter-body');
  const actions = doc.getElementById('encounter-actions');
  let ctx = null;

  const who = p => `<span class="who"><span class="dot" style="--player-color:${p.color}"></span>${p.name}</span>`;
  const name = id => ctx.state.players.find(q => q.id === id)?.name ?? id;

  function button(label, onClick, { primary, disabled } = {}) {
    const b = doc.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.type = 'button';
    b.textContent = label;
    if (disabled) b.disabled = true;
    b.addEventListener('click', e => { e.preventDefault(); onClick(); });
    return b;
  }

  function clearActions() { actions.innerHTML = ''; }

  // Screen 1: pick Trade or Attack.
  function chooseAction() {
    const { P, Q } = ctx;
    title.innerHTML = `${who(P)} meets ${who(Q)}`;
    const hasWeapon = weaponsIn(P.hand).length > 0;
    const canAttack = hasWeapon && P.actionPoints >= cfg.attackCost;
    body.innerHTML = `<div class="modal-sub">A meeting is forced. ${P.name} chooses:</div>`;
    clearActions();
    actions.appendChild(button('Trade', () => tradePickGiver(), { primary: true }));
    const atk = button(canAttack ? 'Attack' : 'Attack (need a weapon)', () => attackPick(), { disabled: !canAttack });
    actions.appendChild(atk);
  }

  // Trade — entering player picks a card, then the other, then resolve.
  function tradePickGiver() {
    const { P } = ctx;
    title.textContent = 'Trade';
    const grid = doc.createElement('div');
    grid.className = 'cards';
    const options = tradeableCards(P);
    for (const card of options) grid.appendChild(cardTile(doc, card, { selectable: true, onSelect: c => tradePickOther(c.id) }));
    if (!options.length) grid.innerHTML = '<div class="panel-note">No tradeable cards.</div>';
    body.innerHTML = `<div class="modal-sub">${P.name}, choose a card to give ${ctx.Q.name}:</div>`;
    body.appendChild(grid);
    clearActions();
    actions.appendChild(button('Back', chooseAction));
  }

  function tradePickOther(cardIdP) {
    const { Q } = ctx;
    title.textContent = 'Trade';
    const grid = doc.createElement('div');
    grid.className = 'cards';
    const options = tradeableCards(Q);
    for (const card of options) grid.appendChild(cardTile(doc, card, { selectable: true, onSelect: c => tradeResolve(cardIdP, c.id) }));
    if (!options.length) grid.innerHTML = '<div class="panel-note">No tradeable cards.</div>';
    body.innerHTML = `<div class="modal-sub">${Q.name}, choose a card to give ${ctx.P.name}:</div>`;
    body.appendChild(grid);
    clearActions();
    actions.appendChild(button('Back', tradePickGiver));
  }

  function tradeResolve(cardIdP, cardIdQ) {
    const events = ctx.onResolveTrade(cardIdP, cardIdQ);
    title.textContent = 'Trade complete';
    const lines = [];
    lines.push(`<div class="result-line">${ctx.P.name} gave <b>${CARDS[events.given[ctx.P.id]].name}</b>, ${ctx.Q.name} gave <b>${CARDS[events.given[ctx.Q.id]].name}</b>.</div>`);
    for (const b of events.blocks || []) {
      lines.push(`<div class="result-line evil">${name(b.blocker)} blocked possession with a Lantern and now knows <b>${name(b.revealed)}</b> is possessed.</div>`);
    }
    for (const p of events.possessed || []) {
      lines.push(`<div class="result-line evil">${name(p.newly)} has been POSSESSED.</div>`);
    }
    if (!events.blocks?.length && !events.possessed?.length) lines.push('<div class="result-line good">An ordinary exchange.</div>');
    body.innerHTML = lines.join('');
    clearActions();
    actions.appendChild(button('Continue', () => finish(events), { primary: true }));
  }

  // Attack — pick a weapon, resolve.
  function attackPick() {
    const { P, Q } = ctx;
    title.textContent = 'Attack';
    const grid = doc.createElement('div');
    grid.className = 'cards';
    for (const w of weaponsIn(P.hand)) grid.appendChild(cardTile(doc, w, { selectable: true, onSelect: c => attackResolve(c.id) }));
    body.innerHTML = `<div class="modal-sub">${P.name} attacks ${Q.name}. Choose a weapon:</div>`;
    body.appendChild(grid);
    clearActions();
    actions.appendChild(button('Back', chooseAction));
  }

  function attackResolve(weaponId) {
    const events = ctx.onResolveAttack(weaponId);
    title.textContent = 'Attack';
    if (!events.ok) { body.innerHTML = `<div class="result-line bad">Cannot attack (${events.reason}).</div>`; }
    else {
      const lines = [`<div class="result-line bad">${ctx.P.name} hit ${ctx.Q.name} with a <b>${CARDS[events.weapon].name}</b> for ${events.damage} damage.</div>`];
      if (events.discarded) lines.push('<div class="result-line">The revolver is out of shots and discarded.</div>');
      if (events.killed) lines.push(`<div class="result-line bad">${ctx.Q.name} is dead.</div>`);
      body.innerHTML = lines.join('');
    }
    clearActions();
    actions.appendChild(button('Continue', () => finish(events), { primary: true }));
  }

  function finish(events) {
    overlay.hidden = true;
    const done = ctx.onDone;
    ctx = null;
    done?.(events);
  }

  return {
    get isOpen() { return !overlay.hidden; },
    // opts: { state, P, Q, onResolveTrade, onResolveAttack, onDone }
    start(opts) {
      ctx = { ...opts, attackCost: cfg.attackCost };
      overlay.hidden = false;
      chooseAction();
    },
  };
}
