// Name tags over the guests, shown only while the view is zoomed far out (cfg.camera.tagsFrom): from
// up there the figures are small, so each room with guests in it carries ONE small tag naming them —
// "● Victor · ● Eleanor +4" — in their colours, the active guest first and the tag in brass when they
// are in it. One tag per room, so guests sharing a room never pile their tags up. Where everyone is, is
// public (the guest strip at the top says it too); nothing private is ever on a tag.
//
// The tags go through the shared tag layer (src/ui/screenTags.js): under the interface, inside the
// screen, hidden while they would cover the interface or a more important tag.
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

export function createGuestTags(cfg) {
  return {
    // `show`: false while a hand-over, private or end screen is up. `which`: 'active' places only the tag
    // of the room the active guest is in, 'others' all the rest (main.js places the active guest's
    // first of all — finding yourself comes before any other tag — and the others last).
    update(tags, state, movers, distance, show, which = 'all') {
      if (!show || distance <= cfg.camera.tagsFrom) return;
      const rooms = new Map();
      state.players.forEach((p, i) => {
        if (!p.alive || state.escaped?.has(p.id)) return;
        if (!rooms.has(p.currentRoom)) rooms.set(p.currentRoom, []);
        rooms.get(p.currentRoom).push(i);
      });
      const active = state.finished ? -1 : state.activeIndex;
      // The active guest's room first: its tag wins any clash with the other guests' tags.
      const order = [...rooms.entries()].sort((a, b) => (b[1].includes(active) ? 1 : 0) - (a[1].includes(active) ? 1 : 0));
      for (const [room, who] of order) {
        if (which !== 'all' && (which === 'active') !== who.includes(active)) continue;
        who.sort((a, b) => (b === active) - (a === active) || a - b);
        const x = who.reduce((s, i) => s + movers[i].x, 0) / who.length, z = who.reduce((s, i) => s + movers[i].z, 0) / who.length;
        const names = who.slice(0, 2).map(i => `<span class="gt-dot" style="background:${esc(state.players[i].color)}"></span><span class="gt-name">${esc(state.players[i].name)}</span>`);
        const more = who.length - 2;
        const html = names.join('<span class="gt-sep">·</span>') + (more > 0 ? `<span class="gt-more">+${more}</span>` : '');
        tags.put(`guest:${room}`, [x, 2.3, z], html, `guest-tag${who.includes(active) ? ' active' : ''}`, 'above');
      }
    },
  };
}
