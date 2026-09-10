// Full-screen overlays: "Tap to begin", "found the exit", and load errors.

export function createOverlays(doc) {
  const start = doc.getElementById('start-overlay');
  const exit = doc.getElementById('exit-overlay');
  const exitTitle = doc.getElementById('exit-title');
  const exitSummary = doc.getElementById('exit-summary');
  const continueBtn = doc.getElementById('btn-continue');
  const restartBtn = doc.getElementById('btn-restart');
  const error = doc.getElementById('error-overlay');
  const errorMessage = doc.getElementById('error-message');
  const beginBtn = doc.getElementById('btn-begin');

  return {
    // The 3D view has rendered: the begin button becomes usable.
    setReady() { beginBtn.disabled = false; beginBtn.textContent = 'Tap to begin'; },
    onBegin(fn) { beginBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onContinue(fn) { continueBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    onRestart(fn) { restartBtn.addEventListener('click', e => { e.preventDefault(); fn(); }); },
    showStart() { start.hidden = false; },
    hideStart() { start.hidden = true; },
    showExit({ title, summary, canContinue, continueLabel }) {
      exitTitle.textContent = title;
      exitSummary.textContent = summary || '';
      continueBtn.hidden = !canContinue;
      continueBtn.textContent = continueLabel || 'Continue';
      exit.hidden = false;
    },
    hideExit() { exit.hidden = true; },
    get exitOpen() { return !exit.hidden; },
    showError(message) { errorMessage.textContent = message; error.hidden = false; start.hidden = true; },
  };
}
