// Your record on screen: the main menu's "Your record" screen (index.html #menu-record; src/ui/menu.js
// opens it and wires its buttons through the tap guard) and the quiet line under the result on the end
// screen (#end-record). The numbers are kept on this device by src/record.js; the words are
// src/data/record.js. Only the player's own results: nothing about any other guest.
import { record, winRate } from '../record.js';
import { RECORD_WORDS as W } from '../data/record.js';

export function createRecordScreen(doc) {
  const $ = id => doc.getElementById(id);
  const put = (id, text) => { const el = $(id); if (el) el.textContent = String(text); };

  function render() {
    const r = record.get();
    put('rec-played', r.played); put('rec-won', r.won); put('rec-lost', r.lost);
    put('rec-rate', W.rate(winRate(r)));
    put('rec-clean', W.side(r.clean));
    put('rec-possessed', W.side(r.possessed));
    put('rec-escaped', W.escaped(r.escaped));
    put('rec-practice', W.practice(r.practiceEscapes));
    put('rec-note', r.played ? W.some : W.none);
    put('rec-confirm-text', W.confirm);
    // (nothing to reset yet: the button rests)
    const reset = $('btn-record-reset');
    if (reset) reset.disabled = !r.played && !r.practiceEscapes;
  }

  // The reset's confirm step, in place of the Back / Reset record row.
  function confirm(on) {
    $('record-actions').hidden = !!on;
    $('record-confirm').hidden = !on;
  }

  return { render, confirm, get confirming() { return !$('record-confirm').hidden; } };
}

// The end screen, under the result: the record after this game (a match: wins and losses; practice:
// the practice escapes).
export function showEndRecord(doc, { practice = false } = {}) {
  const el = doc.getElementById('end-record');
  if (!el) return;
  const r = record.get();
  el.textContent = practice ? W.endPractice(r) : W.endMatch(r);
  el.hidden = false;
}
