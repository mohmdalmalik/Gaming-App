// The table feed (a match only): the last few things the OTHER guests did, in the public words of the
// rules' own log (state.log — never a role, a hand or a private result), under the room name at the
// top left. Each line fades out after a while; the newest is at the bottom. Lines about the player's
// own actions are left out (they know what they did); lines that name them say "you".
const KEEP = 4;          // lines on screen at once
const LIFE_MS = 9000;    // how long a line stays

export function createFeed(doc) {
  const host = doc.getElementById('feed');
  const seen = new WeakSet();
  let lines = [];        // { el, until }
  let enabled = false;

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function personal(text, me) {
    if (!me) return text;
    const name = escapeRe(me.name);
    return text
      .replace(new RegExp(`^${name}\\b`), 'You')
      .replace(new RegExp(`\\b${name}\\b`, 'g'), 'you');
  }

  function add(text, cls = '') {
    const el = doc.createElement('div');
    el.className = `feed-line ${cls}`.trim();
    el.textContent = text;
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
