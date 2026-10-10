// The table feed (a match only): the last few things the OTHER guests did, in the public words of the
// rules' own log (state.log — never a role, a hand or a private result), under the room name at the
// top left. Each line fades out after a while; the newest is at the bottom. Lines about the player's
// own actions are left out (they know what they did); lines that name them say "you".
// Each line starts with a small brass icon for what happened, so it reads at a glance: two card backs
// crossing (a trade — never a card face: trades are secret), an empty card (met, no trade), the weapon
// (an attack — public), a door, a magnifier (a search), a telephone (the Switchboard), a mirror, a
// barricade, the Infirmary's cross, the fire exit.
import { CARD_BACK } from './cards.js';
import { CARD_ICONS } from './cardIcons.js';

const KEEP = 4;          // lines on screen at once
const LIFE_MS = 9000;    // how long a line stays

const svg = (body, box = 24) => `<svg viewBox="0 0 ${box} ${box}" fill="none" stroke="currentColor" stroke-width="${box === 24 ? 1.7 : 6}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fromCard = type => (CARD_ICONS[type] || '').replace(/stroke-width="4"/, 'stroke-width="7"');
const ICONS = {
  door: svg('<path d="M6.5 21V4.6c0-.9.7-1.6 1.6-1.6h7.8c.9 0 1.6.7 1.6 1.6V21"/><path d="M4 21h16"/><path d="M9.2 6.2h5.6v4.6H9.2z" stroke-width="1.2"/><circle cx="14.6" cy="13.8" r="0.9" fill="currentColor" stroke="none"/>'),
  search: svg('<circle cx="10.5" cy="10.5" r="5.6"/><path d="M14.6 14.6 20 20"/><path d="M8 8.6a3.2 3.2 0 0 1 2.6-1.3" stroke-width="1.2"/>'),
  phone: svg('<path d="M6.2 3.5h2.6l1.4 3.9-1.9 1.4a11 11 0 0 0 6.9 6.9l1.4-1.9 3.9 1.4v2.6c0 .9-.7 1.6-1.6 1.6C11.3 19.4 4.6 12.7 4.6 5.1c0-.9.7-1.6 1.6-1.6z"/>'),
  infirmary: svg('<path d="M12 6.5v11M6.5 12h11" stroke-width="2.6"/><circle cx="12" cy="12" r="9" stroke-width="1.2"/>'),
  escape: svg('<path d="M5 21V3.5h9V8"/><path d="M14 16v5H5"/><path d="M10.5 12h10M17.5 8.8l3.2 3.2-3.2 3.2"/>'),
  noTrade: svg('<rect x="7" y="4" width="10" height="15" rx="1.6" stroke-dasharray="2.6 2.2"/>'),
  mirror: fromCard('handMirror'),
  barricade: fromCard('barricade'),
  knife: fromCard('knife'),
  revolver: fromCard('revolver'),
};
// What a public line is about (the rules' own words, src/game/actions.js / state.js). Matched by the
// action's own phrase, never by a room name: "searched Switchboard" is a search, "opened a door:
// Infirmary" is a door; only "rang the Switchboard" / "treated in the Infirmary" are the rooms' jobs.
function kindOf(text) {
  const m = /attacked .+ with an? (.+?)( — fatally)?\.$/.exec(text);
  if (m) return { icon: /revolver/i.test(m[1]) ? 'revolver' : 'knife', cls: m[2] ? 'attack fatal' : 'attack' };
  if (/ traded\.$/.test(text)) return { icon: 'trade', cls: 'trade' };
  if (/met, but there was no trade/.test(text)) return { icon: 'noTrade', cls: 'trade' };
  if (/\bsearched\b/.test(text)) return { icon: 'search', cls: '' };
  if (/\bused a Hand Mirror\b/.test(text)) return { icon: 'mirror', cls: '' };
  if (/\bbarricaded\b/.test(text)) return { icon: 'barricade', cls: '' };
  if (/\bescaped\b/.test(text)) return { icon: 'escape', cls: 'escape' };
  if (/\brang the Switchboard\b/.test(text)) return { icon: 'phone', cls: '' };
  if (/\btreated in the Infirmary\b/.test(text)) return { icon: 'infirmary', cls: '' };
  if (/\bopened a door\b|\btried a door\b|\bunlocked\b|\bfailed to open\b|\bdoor locked again\b|\bdoor\b/.test(text)) return { icon: 'door', cls: '' };
  return null;
}
export const _kindOf = kindOf;   // (tests)

export function createFeed(doc) {
  const host = doc.getElementById('feed');
  const seen = new WeakSet();
  let lines = [];        // { el, until }
  let enabled = false;
  let placedTop = -1;

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function personal(text, me) {
    if (!me) return text;
    const name = escapeRe(me.name);
    return text
      .replace(new RegExp(`^${name}\\b`), 'You')
      .replace(new RegExp(`\\b${name}\\b`, 'g'), 'you');
  }

  function icon(kind) {
    const i = doc.createElement('span');
    i.className = `feed-icon ${kind.cls}`.trim();
    i.setAttribute('aria-hidden', 'true');
    if (kind.icon === 'trade') {
      // two card backs crossing
      for (const side of ['a', 'b']) {
        const img = doc.createElement('img'); img.src = CARD_BACK; img.alt = ''; img.draggable = false; img.className = `fi-back ${side}`;
        i.appendChild(img);
      }
    } else i.innerHTML = ICONS[kind.icon] || '';
    return i;
  }

  function add(text, cls = '') {
    const el = doc.createElement('div');
    el.className = `feed-line ${cls}`.trim();
    const kind = kindOf(text);
    if (kind) {
      el.classList.add('has-icon');
      el.appendChild(icon(kind));
      const t = doc.createElement('span'); t.className = 'feed-text'; t.textContent = text;
      el.appendChild(t);
    } else el.textContent = text;
    host.appendChild(el);
    lines.push({ el, until: performance.now() + LIFE_MS });
    while (lines.length > KEEP) lines.shift().el.remove();
    host.hidden = false;
  }

  return {
    // `on`: a match is being played (practice has nobody else to report on).
    reset(on) {
      enabled = !!on;
      host.innerHTML = '';
      lines = [];
      host.hidden = true;
    },
    // Mark everything already in the log as read (a new match: nothing old is reported).
    skip(state) { for (const l of state.log) seen.add(l); },
    // New public lines since the last call. `me`: the player's own guest.
    sync(state, me) {
      if (!enabled) return;
      for (const l of state.log) {
        if (seen.has(l)) continue;
        seen.add(l);
        if (me && l.text.startsWith(`${me.name} `)) continue;   // the player's own doing
        const mentionsMe = me && new RegExp(`\\b${escapeRe(me.name)}\\b`).test(l.text);
        add(personal(l.text, me), mentionsMe ? 'me' : '');
      }
    },
    // A line that is not in the rules' log (a public event the interface reports itself).
    say(text, cls = '') { if (enabled) add(text, cls); },
    // Sit just under the room name and safe badge (`above`: their box), whatever their height.
    place(above) {
      if (host.hidden || !above) return;
      const top = Math.round(above.getBoundingClientRect().bottom + 7);
      if (top !== placedTop) { placedTop = top; host.style.top = `${top}px`; }
    },
    // Fade out old lines (every frame; cheap).
    tick() {
      if (!lines.length) return;
      const now = performance.now();
      let changed = false;
      for (const l of lines) {
        if (now > l.until && !l.el.classList.contains('gone')) { l.el.classList.add('gone'); changed = true; }
      }
      if (changed) {
        setTimeout(() => {
          const t = performance.now();
          lines = lines.filter(l => { if (t > l.until + 500) { l.el.remove(); return false; } return true; });
          if (!lines.length) host.hidden = true;
        }, 600);
      }
    },
  };
}
