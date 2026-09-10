// Full-screen overlays: "Tap to begin", the end screen (who won), and load errors.

export function createOverlays(doc) {
  const start = doc.getElementById('start-overlay');
  const end = doc.getElementById('end-overlay');
  const endTitle = doc.getElementById('end-title');
  const endSummary = doc.getElementById('end-summary');
  const restartBtn = doc.getElementById('btn-restart');
  const error = doc.getElementById('error-overlay');
  const errorMessage = doc.getElementById('error-message');
  const beginBtn = doc.getElementById('btn-begin');

  return {
    // The 3D view has rendered: the begin button becomes usable.
    setReady() { beginBtn.disabled = false; beginBtn.textContent = 'Tap to begin'; },
    onBegin(fn) { beginBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onRestart(fn) { restartBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    showStart() { start.hidden = false; },
    hideStart() { start.hidden = true; },
    showEnd(title, summary) { endTitle.textContent = title; endSummary.textContent = summary || ''; end.hidden = false; },
    hideEnd() { end.hidden = true; },
    get endOpen() { return !end.hidden; },
    showError(message) { errorMessage.textContent = message; error.hidden = false; start.hidden = true; },
  };
}
