// Full-screen overlays: "Tap to begin", a one-off notice (the exit opening), the end screen
// and load errors.

export function createOverlays(doc) {
  const start = doc.getElementById('start-overlay');
  const end = doc.getElementById('end-overlay');
  const endTitle = doc.getElementById('end-title');
  const endSummary = doc.getElementById('end-summary');
  const restartBtn = doc.getElementById('btn-restart');
  const keepBtn = doc.getElementById('btn-keep-exploring');
  const notice = doc.getElementById('notice-overlay');
  const noticeTitle = doc.getElementById('notice-title');
  const noticeBody = doc.getElementById('notice-body');
  const noticeOk = doc.getElementById('btn-notice-ok');
  const error = doc.getElementById('error-overlay');
  const errorMessage = doc.getElementById('error-message');
  const beginBtn = doc.getElementById('btn-begin');

  let noticeNext = null;
  const apiTail = {
    // The 3D view has rendered: the begin button becomes usable.
    setReady() { beginBtn.disabled = false; beginBtn.textContent = 'Tap to begin'; },
    onBegin(fn) { beginBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onRestart(fn) { restartBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onKeepExploring(fn) { keepBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    showStart() { start.hidden = false; },
    hideStart() { start.hidden = true; },
    // `opts.keepExploring` offers a way back into the hotel instead of only restarting —
    // practice has no losing side, so finishing should never force a new game.
    showEnd(title, summary, opts = {}) {
      endTitle.textContent = title;
      endSummary.textContent = summary || '';
      keepBtn.hidden = !opts.keepExploring;
      restartBtn.textContent = opts.restartLabel || 'Restart practice';
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
    showError(message) { errorMessage.textContent = message; error.hidden = false; start.hidden = true; },
  };
  noticeOk.addEventListener('click', e => {
    e.preventDefault();
    notice.hidden = true;
    const fn = noticeNext; noticeNext = null; fn?.();
  });
  return apiTail;
}
