// The hot-seat meeting panel. Two jobs, both PUBLIC:
//   1. When the arriving player walks into a room with more than one guest in it, they choose
//      which single guest they meet.
//   2. Afterwards it shows what the table is allowed to know about what happened.
//
// It never asks the other player anything — both Offers were committed on their own turns — and
// it never prints a hidden role. Anything private (who attacked whom, who has just been
// possessed) is queued on the player it belongs to and shown on their own screen.
export function createMeeting(doc) {
  const overlay = doc.getElementById('encounter-overlay');
  const title = doc.getElementById('encounter-title');
  const body = doc.getElementById('encounter-body');
  const actions = doc.getElementById('encounter-actions');

  const who = p => `<span class="who"><span class="dot" style="--player-color:${p.color}"></span>${p.name}</span>`;

  function button(label, onClick, primary) {
    const b = doc.createElement('button');
    b.className = 'btn' + (primary ? ' primary' : '');
    b.type = 'button';
    b.innerHTML = label;
    b.addEventListener('click', e => { e.preventDefault(); onClick(); });
    return b;
  }

  const OUTCOME = {
    cancelled: { cls: 'good', line: 'The meeting broke up before anything could happen.' },
    blocked: { cls: 'evil', line: 'Who tried it is not public — only the guest who blocked it knows.' },
    possessed: { cls: '', line: 'Nothing visibly changed hands.' },
    trade: { cls: 'good', line: 'The exchange was made.' },
    nothing: { cls: '', line: 'Neither of them was willing to part with anything.' },
  };

  return {
    get isOpen() { return !overlay.hidden; },

    // Step 1 — the arriving player picks who they meet.
    choose(P, candidates, onPick) {
      overlay.hidden = false;
      title.innerHTML = `${who(P)} is not alone`;
      body.innerHTML = '<div class="modal-sub">Choose one guest to meet. Only one meeting happens per turn.</div>';
      actions.innerHTML = '';
      for (const q of candidates) actions.appendChild(button(who(q), () => { overlay.hidden = true; onPick(q); }));
    },

    // Step 2 — the public result. Safe for everyone at the table to read.
    result(res, roomName, onDone) {
      overlay.hidden = false;
      title.textContent = `A meeting in ${roomName || 'the hotel'}`;
      const meta = OUTCOME[res.outcome] || OUTCOME.nothing;
      body.innerHTML = `<div class="result-line ${meta.cls}">${res.publicText}</div>`
        + `<div class="modal-sub">${meta.line}</div>`;
      actions.innerHTML = '';
      actions.appendChild(button('Continue', () => { overlay.hidden = true; onDone?.(); }, true));
    },

    close() { overlay.hidden = true; },
  };
}
