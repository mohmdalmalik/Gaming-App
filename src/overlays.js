// Full-screen overlays: "Tap to begin", "You found the exit", and load errors.

export function createOverlays(doc) {
  const start = doc.getElementById('start-overlay');
  const exit = doc.getElementById('exit-overlay');
  const exitSummary = doc.getElementById('exit-summary');
  const error = doc.getElementById('error-overlay');
  const errorMessage = doc.getElementById('error-message');
  const beginBtn = doc.getElementById('btn-begin');
  const restartBtn = doc.getElementById('btn-restart');

  return {
    // The 3D view has rendered: the begin button becomes usable.
    setReady() { beginBtn.disabled = false; beginBtn.textContent = 'Tap to begin'; },
    onBegin(fn) { beginBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onRestart(fn) { restartBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    showStart() { start.hidden = false; },
    hideStart() { start.hidden = true; },
    showExit(summary) { exitSummary.textContent = summary || ''; exit.hidden = false; },
    hideExit() { exit.hidden = true; },
    showError(message) { errorMessage.textContent = message; error.hidden = false; start.hidden = true; },
  };
}
