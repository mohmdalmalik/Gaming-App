// End-of-turn discard: the ONLY place the hand limit is settled (approved rule). During a turn a
// guest keeps everything they find or receive, even past 6; when they end the turn (the button, the
// turn passing by itself when the actions run out, or the clock running out) holding more than 6, they
// choose cards to discard until they hold 6, before control passes on. Possession cards never count and
// are never offered here, so the screen looks the same whatever the guest's role. Two steps for each
// card, so nothing is thrown away by a stray tap: tap a card to pick it (tap it again, or another, to
// change your mind), then confirm with the button, which names the card.
// The discard that brings the hand down to the limit finishes the screen by itself: the card is seen
// leaving for a moment, then the screen closes and the turn goes on (there is no "Keep these 6" step).
// Where the turn clock is on the screen also shows a COUNTDOWN (approved rule, 15 Oct 2026): src/main.js keeps
// the clock (it runs on during the discard, never under rules.discardMinSeconds) and tells the screen how
// many seconds are left, every frame, through tick(); the screen only draws them, calmly, and turns urgent
// in the last seconds. When it reaches zero main.js closes the screen, the game discards at random and shows
// the guest, privately and without blocking anything, what went (note()). The seconds maths and the words:
// src/ui/discardClock.js.
import { rules } from '../data/rules.js';
import { CARDS, countableCards, countableCount } from '../game/cards.js';
import { cardTile } from './cards.js';
import { isUrgent, secondsShown, announcement } from './discardClock.js';

// From more cards than this the tiles are drawn smaller (styles.css #discard-cards.dense): 11 cards fit on the
// shortest iPad window (1024x694) without scrolling; up to 8 fit at the usual size on every iPad.
const DENSE_FROM = 8;
// How long the last discarded card is seen leaving before the screen closes (ms). The card's own exit
// animation (styles.css, "Round 4, turn flow") lasts the same time; with Reduce Motion it only fades.
const LEAVE_MS = 520;
// How long the private "the game discarded..." notice stays (s).
const NOTE_SECONDS = 4;

export function createDiscard(doc, cfg, { onDiscard }) {
  const overlay = doc.getElementById('discard-overlay');
  const sub = doc.getElementById('discard-sub');
  const kicker = doc.getElementById('discard-kicker');
  const cards = doc.getElementById('discard-cards');
  const doneBtn = doc.getElementById('btn-discard-done');
  const clock = doc.getElementById('discard-clock');            // the countdown (only where the turn clock is on)
  const clockSecs = doc.getElementById('dc-secs');
  const clockLabel = doc.getElementById('dc-label');
  const clockFill = doc.getElementById('dc-fill');
  const live = doc.getElementById('discard-live');              // what a screen reader is told as the clock runs down
  const noteEl = doc.getElementById('discard-note');
  let ctx = null;                 // { player, onComplete, leaving, timed } while the screen is open
  let picked = null;              // the card chosen to discard, awaiting the button
  let total = 0;                  // the seconds the countdown started from (the bar's full length)
  let shown = -1, urgent = false; // what the countdown draws now (so a frame that changes nothing touches nothing)
  let heard = Infinity;           // the seconds left at the last look, for the spoken "10 / 5 seconds left"
  let noteTimer = 0;

  function render() {
    const p = ctx.player;
    // Possession cards don't count and can't be discarded here — only normal item cards.
    const items = countableCards(p.hand);
    const count = items.length;
    const over = count - rules.handLimit;
    if (!items.some(c => c.id === picked)) picked = null;
    sub.textContent = `You hold ${count} cards — at the end of your turn the limit is ${rules.handLimit}. Choose ${over} to discard${over === 1 ? '' : ', one at a time'}: tap a card, then the button.`
      + (ctx.timed ? ' If the time runs out, the game chooses for you.' : '');
    cards.innerHTML = '';
    cards.classList.toggle('dense', items.length > DENSE_FROM);      // (a big hand: smaller cards, so it fits without scrolling)
    for (const card of items) {
      cards.appendChild(cardTile(doc, card, {
        selectable: true,
        selected: card.id === picked,
        // (while the last card is leaving, a tap does nothing and makes no sound)
        onSelect: c => { if (!ctx || ctx.leaving) return false; picked = picked === c.id ? null : c.id; render(); },
      }));
    }
    const pickedCard = items.find(c => c.id === picked);
    doneBtn.disabled = !pickedCard;
    doneBtn.textContent = pickedCard ? `Discard the ${CARDS[pickedCard.type]?.name ?? 'card'}` : 'Tap a card to discard';
  }

  // The countdown: the seconds as a number (whole seconds, so it only changes once a second), a bar that runs
  // down (a transform: no page layout), the urgent look for the last seconds. Called every frame; it writes to
  // the page only when something changed. The number is NOT a live region (it would be read out every second):
  // a screen reader reads its words ("30 seconds left") on demand, and is told politely at 10 and at 5.
  function drawClock(left) {
    if (!ctx?.timed || !total) return;
    const n = secondsShown(left);
    if (n !== shown) {
      shown = n;
      clockSecs.textContent = String(n);
      clockLabel.textContent = n === 1 ? 'second left' : 'seconds left';
    }
    const bar = `scaleX(${Math.max(0, Math.min(1, left / total)).toFixed(3)})`;
    if (clockFill.style.transform !== bar) clockFill.style.transform = bar;
    const hurry = isUrgent(left);
    if (hurry !== urgent) { urgent = hurry; clock.classList.toggle('urgent', hurry); }
    const say = announcement(heard, left);
    heard = left;
    if (say) live.textContent = say;
  }

  // The hand is down to the limit: show the last card leaving (its tile stays on the screen a moment,
  // greyed out of reach), then close and carry on with the turn passing. The screen is not drawn again
  // here, so the tile that was just discarded is still the one that leaves.
  function finish(tile, name) {
    const mine = ctx;
    mine.leaving = true;
    overlay.classList.add('leaving');
    tile?.classList.remove('selected');
    tile?.classList.add('leaving');
    sub.textContent = `Down to ${rules.handLimit} cards.`;
    doneBtn.disabled = true;
    doneBtn.textContent = `Discarded the ${name}`;
    setTimeout(() => {
      if (ctx !== mine) return;          // (closed or reopened meanwhile: a new game, the menu)
      const done = mine.onComplete;
      api.close();
      done?.();
    }, LEAVE_MS);
  }

  const api = {
    get isOpen() { return !overlay.hidden; },
    // The last discard is on its way out (the screen closes by itself in a moment): the choosing is over, so
    // the clock stands still for that half second and cannot end the turn a second time.
    get finishing() { return !!ctx?.leaving; },
    // `seconds`: how long the countdown runs (null / left out: no time limit, no countdown).
    open(player, onComplete, { seconds = null } = {}) {
      // A guest already at or under the limit never sees this screen (the callers only open it when over).
      if (countableCount(player.hand) <= rules.handLimit) { onComplete?.(); return; }
      const timed = seconds > 0;
      ctx = { player, onComplete, leaving: false, timed }; picked = null;
      total = timed ? seconds : 0; shown = -1; urgent = false; heard = Infinity;
      if (kicker) { kicker.hidden = true; kicker.textContent = ''; }
      overlay.classList.remove('leaving');
      clock.hidden = !timed;
      clock.classList.remove('urgent');
      live.textContent = '';
      overlay.hidden = false;
      const modal = overlay.querySelector('.modal'); if (modal) modal.scrollTop = 0;
      render();
      if (timed) drawClock(seconds);
    },
    // main.js: the seconds left on the clock, every frame the screen is open.
    tick(left) { if (ctx) drawClock(left); },
    // A calm notice on the guest's own screen (nothing is blocked, nothing is tapped): what the game did for them.
    // Public to nobody: it is only ever written to this guest's own page.
    note(text, seconds = NOTE_SECONDS) {
      clearTimeout(noteTimer);
      noteEl.hidden = false;            // (shown first, then written: a screen reader reads text that appears in a live region it can already reach)
      noteEl.textContent = text;
      noteTimer = setTimeout(() => { noteEl.hidden = true; noteEl.textContent = ''; }, seconds * 1000);
    },
    // Nothing of this guest's hand waits in the hidden screen for the next guest.
    close() {
      overlay.hidden = true; overlay.classList.remove('leaving'); ctx = null; picked = null; total = 0;
      cards.innerHTML = ''; sub.textContent = ''; clock.hidden = true; clock.classList.remove('urgent'); live.textContent = '';
      clearTimeout(noteTimer); noteEl.hidden = true; noteEl.textContent = '';
    },
  };
  // (A second tap of a double tap on Discard finds the button already disabled: the pick is cleared and the
  // screen redrawn before anything else can be tapped, so a card never goes twice.)
  doneBtn.addEventListener('click', e => {
    e.preventDefault();
    if (!ctx || ctx.leaving || !picked) return;
    const id = picked;
    const card = ctx.player.hand.find(c => c.id === id);
    const tile = cards.querySelector(`.card-tile[data-card-id="${id}"]`);
    picked = null;
    onDiscard(id);
    if (!ctx) return;
    if (countableCount(ctx.player.hand) > rules.handLimit) { render(); return; }
    finish(tile, CARDS[card?.type]?.name ?? 'card');
  });
  return api;
}
