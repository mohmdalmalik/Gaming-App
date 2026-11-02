// TABLES SAVED AS FILES (DESIGN §10.3): the same shape as createMemoryStore() (src/net/store.js), used when the server
// has a disk (DATA_DIR: a Render disk on a paid plan, or a folder on this computer for restore-check).
//
//   const store = createFileStore(dir, { log })
//   store.save(id, obj)    one file per table, <dir>/<id>.json, written safely: a temporary file, flushed to the disk
//                          (fsync), then renamed over the old one, so a crash at any moment leaves either the old save
//                          or the new one, never half of one
//   store.load()        -> [obj, ...]   every table saved (a file that can't be read is skipped and logged)
//   store.remove(id)       delete a table's file
//   store.kind             'file'
//
// Every save is synchronous on purpose: the server saves a table BEFORE it tells any device what happened (the commit
// rule, §10.1), so after a crash no device has seen something the saved table doesn't hold.
import fs from 'node:fs';
import path from 'node:path';

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function createFileStore(dir, { log = () => {} } = {}) {
  if (!dir) throw new Error('createFileStore needs a folder');
  fs.mkdirSync(dir, { recursive: true });
  const file = id => {
    if (!SAFE_ID.test(String(id))) throw new Error(`fileStore: not a table id: ${String(id).slice(0, 40)}`);
    return path.join(dir, `${id}.json`);
  };
  let dirFd = null;
  try { dirFd = fs.openSync(dir, 'r'); } catch { dirFd = null; }   // (to make the renames themselves durable)

  return {
    kind: 'file',
    dir,
    save(id, obj) {
      const target = file(id);
      const tmp = `${target}.tmp`;
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, JSON.stringify(obj));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, target);
      if (dirFd != null) { try { fs.fsyncSync(dirFd); } catch { /* not every system can */ } }
    },
    load() {
      const out = [];
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try { out.push(JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))); } catch (e) { log(`fileStore: ${name} skipped: ${e.message}`); }
      }
      return out;
    },
    remove(id) {
      try { fs.unlinkSync(file(id)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    },
  };
}
