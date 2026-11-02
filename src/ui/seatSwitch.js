// The review link's seat switch (?friends=demo, DESIGN §16): you hold two seats of one Co-op table on one device,
// yours and sam's, and this one button shows the other seat's screen: "Show sam's screen", then "Show nora's screen".
// It sits at the top right (#btn-seat-switch in index.html), above the menu and, later, the match, and is shown from
// the waiting room on. Switching never mixes the two seats: whoever draws the screens redraws them fresh from the
// chosen seat's own view (src/ui/coopMenu.js in the waiting room; the match's presenter later), the same path as a
// reconnection, so each screen shows only its own cards.
//
//   createSeatSwitch(doc, { clients, onSwitch, names, text, guard }) → { show(on), current, set(i), offer(line) }
//     clients    the two seats (src/ui/coopMenu.js's seats, each with its coop once it has one)
//     onSwitch   (i, client) → void, after the switch: draw seat i
//     names      () → [name0, name1]: the button names the seat it would show
//     offer      (line | null): when a question waits on the seat NOT shown, the button says so and stands out
//                ("sam must choose a card", text.demo.waits); null puts it back
// Every word is src/data/onlineText.js's.
import { ONLINE_TEXT, fill } from '../data/onlineText.js';

export function createSeatSwitch(doc, { clients = [], onSwitch = null, names = () => [], text = ONLINE_TEXT, guard = () => false } = {}) {
  const btn = doc.getElementById('btn-seat-switch');
  let current = 0;
  let offered = null;
  let on = false;
  const other = () => (current === 0 ? 1 : 0);
  function render() {
    if (!btn) return;
    btn.hidden = !on;
    const name = names()[other()] || '';
    btn.textContent = offered || fill(text.demo.showSeat, { name });
    btn.classList.toggle('offer', !!offered);
    btn.setAttribute('aria-label', fill(text.demo.showSeat, { name }) + (offered ? `. ${offered}` : ''));
  }
  function set(i) {
    if (i !== 0 && i !== 1 || i === current) return;
    current = i;
    offered = null;
    render();
    try { onSwitch?.(i, clients[i]); } catch (err) { console.error('switching seats failed:', err); }
  }
  btn?.addEventListener('click', e => { e.preventDefault(); if (guard(e)) return; set(other()); });
  render();
  return {
    show(v = true) { on = !!v; render(); },
    get current() { return current; },
    set,
    offer(line = null) { offered = line || null; render(); },
    update: render,
  };
}
