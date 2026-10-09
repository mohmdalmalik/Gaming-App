// Full-screen overlays: "Tap to begin", a one-off notice (the exit opening), a yes/no question,
// the end screen and load errors.

export function createOverlays(doc) {
  const start = doc.getElementById('start-overlay');
  const end = doc.getElementById('end-overlay');
  const endTitle = doc.getElementById('end-title');
  const endSummary = doc.getElementById('end-summary');
  const restartBtn = doc.getElementById('btn-restart');
  const keepBtn = doc.getElementById('btn-keep-exploring');
  const menuBtn = doc.getElementById('btn-end-menu');
  const reveal = doc.getElementById('end-reveal');
  const menuRoot = doc.getElementById('menu');
  const notice = doc.getElementById('notice-overlay');
  const noticeTitle = doc.getElementById('notice-title');
  const noticeBody = doc.getElementById('notice-body');
  const noticeOk = doc.getElementById('btn-notice-ok');
  const error = doc.getElementById('error-overlay');
  const errorMessage = doc.getElementById('error-message');
  const beginBtn = doc.getElementById('btn-begin');

  const ask = doc.getElementById('ask-overlay');
  const askTitle = doc.getElementById('ask-title');
  const askBody = doc.getElementById('ask-body');
  const askYes = doc.getElementById('btn-ask-yes');
  const askNo = doc.getElementById('btn-ask-no');

  let noticeNext = null;
  let askNext = null;
  const apiTail = {
    // The 3D view has rendered: the begin button becomes usable.
    setReady() { beginBtn.disabled = false; beginBtn.textContent = 'Tap to begin'; },
    onBegin(fn) { beginBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onRestart(fn) { restartBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onKeepExploring(fn) { keepBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onMenu(fn) { menuBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    showStart() { start.hidden = false; },
    hideStart() { start.hidden = true; },
    // `opts.keepExploring` offers a way back into the hotel instead of only restarting —
    // practice has no losing side, so finishing should never force a new game. `opts.reveal` (a match):
    // every guest with their role, now that it is over — { name, who, color, possessed, status, you }.
    // `opts.won`: whether the player's side won (colours the title).
    showEnd(title, summary, opts = {}) {
      endTitle.textContent = title;
      endSummary.textContent = summary || '';
      keepBtn.hidden = !opts.keepExploring;
      restartBtn.textContent = opts.restartLabel || 'Restart practice';
      end.classList.toggle('won', opts.won === true);
      end.classList.toggle('lost', opts.won === false);
      reveal.innerHTML = '';
      reveal.hidden = !opts.reveal?.length;
      for (const r of opts.reveal || []) {
        const row = doc.createElement('div');
        row.className = 'er-row' + (r.you ? ' you' : '') + (r.status ? ` ${r.status.toLowerCase()}` : '');
        row.style.setProperty('--player-color', r.color);
        const dot = doc.createElement('span'); dot.className = 'er-dot';
        const name = doc.createElement('span'); name.className = 'er-name'; name.textContent = r.name;
        const who = doc.createElement('span'); who.className = 'er-who'; who.textContent = r.who || '';
        const role = doc.createElement('span'); role.className = `er-role ${r.possessed ? 'evil' : 'good'}`; role.textContent = r.possessed ? 'Possessed' : 'Clean';
        const status = doc.createElement('span'); status.className = 'er-status'; status.textContent = r.status || '';
        row.append(dot, name, who, role, status);
        reveal.appendChild(row);
      }
      end.hidden = false;
    },
    hideEnd() { end.hidden = true; },
    get endOpen() { return !end.hidden; },
    // `onOk` fires when the player dismisses it, so a notice can sit in the middle of a turn
    // sequence (a guest escaping, the exit opening) without the flow losing its place.
    showNotice(title, body, onOk = null) {
      noticeTitle.textContent = title; noticeBody.textContent = body || '';
      noticeNext = onOk; notice.hidden = false;
    },
    hideNotice() { notice.hidden = true; noticeNext = null; },
    get noticeOpen() { return !notice.hidden; },
    // A yes/no question ("Restart practice?"). `onYes` runs only on the yes button; the other button
    // (or tapping outside the card) just closes it.
    ask(title, body, { yes = 'OK', no = 'Cancel' } = {}, onYes = null) {
      askTitle.textContent = title; askBody.textContent = body || '';
      askYes.textContent = yes; askNo.textContent = no;
      askNext = onYes; ask.hidden = false;
    },
    hideAsk() { ask.hidden = true; askNext = null; },
    get askOpen() { return !ask.hidden; },
    showError(message) { errorMessage.textContent = message; error.hidden = false; start.hidden = true; if (menuRoot) menuRoot.hidden = true; },
  };
  noticeOk.addEventListener('click', e => {
    e.preventDefault();
    notice.hidden = true;
    const fn = noticeNext; noticeNext = null; fn?.();
  });
  askYes.addEventListener('click', e => {
    e.preventDefault();
    ask.hidden = true;
    const fn = askNext; askNext = null; fn?.();
  });
  askNo.addEventListener('click', e => { e.preventDefault(); apiTail.hideAsk(); });
  ask.addEventListener('click', e => { if (e.target === ask) apiTail.hideAsk(); });
  return apiTail;
}
