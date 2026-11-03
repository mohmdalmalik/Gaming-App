// The order a Co-op device shows what happened in (DESIGN §11.6). Every change from the table (a view, with the events
// since the last one) is played in the order it came; but a device that fell behind (a hidden page that drew nothing,
// a burst after a reconnection, a very slow frame) does not replay a backlog of walks and doors: once the oldest change
// not yet shown is more than `maxBacklogMs` old, the queue skips to the latest, and the page draws it fresh (every
// figure where the table has it, no animation). The presenter state itself is always current (src/main.js applies every
// view at once): only what is animated waits here. Pure: time is injected.
//
//   const q = createPresentQueue({ maxBacklogMs: 3000, now })
//   q.push(change)        a change arrived (anything: kept as it is, with the time it came)
//   q.next()              -> { change, skipped } the next change to show, or null when nothing waits. `skipped`: how many
//                            older changes were dropped to reach it (it is then the latest: draw it fresh)
//   q.skipToLatest()      -> the latest change, dropping the rest (or null)
//   q.size, q.backlogMs   (what waits, and how long the oldest has waited)
//   q.clear()
export function createPresentQueue({ maxBacklogMs = 3000, now = () => performance.now() } = {}) {
  const items = [];
  const q = {
    push(change) { items.push({ change, at: now() }); },
    next() {
      if (!items.length) return null;
      if (now() - items[0].at > maxBacklogMs) {
        const skipped = items.length - 1;
        const last = items[items.length - 1];
        items.length = 0;
        return { change: last.change, skipped, fresh: true };
      }
      return { change: items.shift().change, skipped: 0, fresh: false };
    },
    skipToLatest() {
      if (!items.length) return null;
      const last = items[items.length - 1];
      items.length = 0;
      return last.change;
    },
    clear() { items.length = 0; },
    get size() { return items.length; },
    get backlogMs() { return items.length ? now() - items[0].at : 0; },
  };
  return q;
}
