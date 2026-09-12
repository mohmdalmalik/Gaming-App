// The forced-encounter modal. On entering a room with other players, the entering player
// first chooses WHICH one to meet (when there is more than one), then Trade or Attack. In
// hot-seat both hands are visible; the flow still mirrors the real game — the entering
// player picks their card, then the other picks theirs, then it resolves.
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
  const clearActions = () => { actions.innerHTML = ''; };

  function button(label, onClick, opts = {}) {
    const b = doc.createElement('button');
    b.className = 'btn' + (opts.primary ? ' primary' : '');
    b.type = 'button';
    b.innerHTML = label;
    if (opts.disabled) b.disabled = true;
    b.addEventListener('click', e => { e.preventDefault(); onClick(); });
    return b;
  }

  // Step 0: who to meet (only when more than one player is here). In a safe room this is a
  // VOLUNTARY trade (trade only, and it can be cancelled); elsewhere it is a forced encounter.
  function choosePartner() {
    const proceed = ctx.voluntary ? tradePickGiver : chooseAction;
    title.textContent = ctx.voluntary ? 'Trade with whom?' : 'Who do you meet?';
    body.innerHTML = `<div class="modal-sub">${ctx.P.name} ${ctx.voluntary ? 'may trade with someone here' : 'enters a room with several people'}. Choose one:</div>`;
    clearActions();
    for (const q of ctx.candidates) actions.appendChild(button(who(q), () => { ctx.Q = q; proceed(); }));
    if (ctx.voluntary) actions.appendChild(button('Cancel', cancel));
  }

  // Step 1: Trade or Attack.
  function chooseAction() {
    const { P, Q } = ctx;
    title.innerHTML = `${who(P)} meets ${who(Q)}`;
    const canAttack = weaponsIn(P.hand).length > 0 && P.actionPoints >= ctx.attackCost;
    body.innerHTML = `<div class="modal-sub">A meeting is forced. ${P.name} chooses:</div>`;
    clearActions();
    actions.appendChild(button('Trade', tradePickGiver, { primary: true }));
    actions.appendChild(button(canAttack ? 'Attack' : 'Attack (need a weapon)', attackPick, { disabled: !canAttack }));
    if (ctx.candidates.length > 1) actions.appendChild(button('Back', choosePartner));
  }

  // Trade — entering player picks a card, then the other, then resolve.
  function tradePickGiver() {
    const { P, Q } = ctx;
    const grid = doc.createElement('div');
    grid.className = 'cards';
    const options = tradeableCards(P);
    for (const card of options) grid.appendChild(cardTile(doc, card, { selectable: true, onSelect: c => tradePickOther(c.id) }));
    if (!options.length) grid.innerHTML = '<div class="panel-note">No tradeable cards.</div>';
    title.textContent = ctx.voluntary ? 'Voluntary trade' : 'Trade';
    body.innerHTML = `<div class="modal-sub">${P.name}, choose a card to give ${Q.name}:</div>`;
    body.appendChild(grid);
    clearActions();
    // Back to the partner chooser, the Trade/Attack step, or (single-partner voluntary) cancel.
    const back = ctx.voluntary ? (ctx.candidates.length > 1 ? choosePartner : cancel) : chooseAction;
    actions.appendChild(button(ctx.voluntary && ctx.candidates.length === 1 ? 'Cancel' : 'Back', back));
  }

  function tradePickOther(cardIdP) {
    const { Q } = ctx;
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
    const events = ctx.onResolveTrade(ctx.Q, cardIdP, cardIdQ);
    title.textContent = 'Trade complete';
    const lines = [`<div class="result-line">${ctx.P.name} gave <b>${CARDS[events.given[ctx.P.id]].name}</b>, ${ctx.Q.name} gave <b>${CARDS[events.given[ctx.Q.id]].name}</b>.</div>`];
    for (const b of events.blocks || []) lines.push(`<div class="result-line evil">${name(b.blocker)} blocked possession with a Lantern and now knows <b>${name(b.revealed)}</b> is possessed.</div>`);
    for (const p of events.possessed || []) lines.push(`<div class="result-line evil">${name(p.newly)} has been POSSESSED.</div>`);
    if (!events.blocks?.length && !events.possessed?.length) lines.push('<div class="result-line good">An ordinary exchange.</div>');
    body.innerHTML = lines.join('');
    clearActions();
    actions.appendChild(button('Continue', () => finish(events), { primary: true }));
  }

  // Attack — pick a weapon, resolve.
  function attackPick() {
    const { P, Q } = ctx;
    const grid = doc.createElement('div');
    grid.className = 'cards';
    for (const w of weaponsIn(P.hand)) grid.appendChild(cardTile(doc, w, { selectable: true, onSelect: c => attackResolve(c.id) }));
    title.textContent = 'Attack';
    body.innerHTML = `<div class="modal-sub">${P.name} attacks ${Q.name}. Choose a weapon:</div>`;
    body.appendChild(grid);
    clearActions();
    actions.appendChild(button('Back', chooseAction));
  }

  function attackResolve(weaponId) {
    const events = ctx.onResolveAttack(ctx.Q, weaponId);
    title.textContent = 'Attack';
    if (!events.ok) body.innerHTML = `<div class="result-line bad">Cannot attack (${events.reason}).</div>`;
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
    const { onDone, Q } = ctx;
    ctx = null;
    onDone?.(Q, events);
  }

  // Close a voluntary trade without exchanging anything.
  function cancel() {
    overlay.hidden = true;
    const onCancel = ctx?.onCancel;
    ctx = null;
    onCancel?.();
  }

  return {
    get isOpen() { return !overlay.hidden; },
    // opts: { state, P, candidates, mode?, onResolveTrade(Q,cardIdP,cardIdQ),
    //         onResolveAttack(Q,weaponId), onDone(Q,events), onCancel() }
    // mode 'voluntary' (safe rooms) offers trade only and can be cancelled.
    start(opts) {
      ctx = { ...opts, attackCost: cfg.attackCost, voluntary: opts.mode === 'voluntary', Q: null };
      overlay.hidden = false;
      const proceed = ctx.voluntary ? tradePickGiver : chooseAction;
      if (ctx.candidates.length === 1) { ctx.Q = ctx.candidates[0]; proceed(); }
      else choosePartner();
    },
  };
}
