// WHERE CO-OP TABLES ARE SAVED (DESIGN §10.3). The server's brain (src/net/rooms.js) saves a table after every step
// it runs, before it tells anybody what happened, so a crash or a restart can bring every table back exactly as the
// devices last saw it. This file is the store kept in memory: the tests, the in-page review link (src/net/loopback.js)
// and a server without a disk (Render Free) use it. server/fileStore.js is the same shape on files (DATA_DIR).
// Pure: no DOM, no Node APIs, no clock.
//
//   const store = createMemoryStore();
//   store.save(id, obj)    keep this table's latest save (a plain object; a copy is kept, so later changes to `obj`
//                          never reach it)
//   store.load()        -> [obj, ...]  every table saved (copies), in no particular order
//   store.remove(id)       forget a table (a closed table's file, a day after it closed)
//   store.kind             'memory'
//
// The saves are kept as JSON text: each load is a fresh copy, and what the memory store keeps is exactly what the
// file store would write.
export function createMemoryStore() {
  const saved = new Map();      // id -> JSON text
  return {
    kind: 'memory',
    save(id, obj) { saved.set(String(id), JSON.stringify(obj)); },
    load() { return [...saved.values()].map(text => JSON.parse(text)); },
    remove(id) { saved.delete(String(id)); },
    // (tests: how many tables are kept, and the text of one)
    get size() { return saved.size; },
    text: id => saved.get(String(id)) ?? null,
  };
}
