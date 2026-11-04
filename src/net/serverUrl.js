// Which Co-op server this page talks to, or "coming soon". Reads only the address it is given (no DOM of its own).
//
//   resolveServer(location)  ->  { url: 'wss://…' }  or  { comingSoon: true }
//
// On localhost or 127.0.0.1 (development and the tests):
//   ?coop=soon                  coming soon (so that screen can be tested and screenshotted)
//   ?server=ws://localhost:PORT, ws://127.0.0.1:PORT or wss://…   that server
//   otherwise                   ONLINE.server.local (a server on this computer)
// Anywhere else (the live site): ONLINE.server.live when it is set AND (ONLINE.server.open, or the owner's own
// ?coop=preview link); otherwise coming soon. ?server= never works on the live site, so a link can't point a
// player's page at another server.
import { ONLINE } from '../data/online.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);
export const isLocalHost = loc => LOCAL_HOSTS.has(String(loc?.hostname || '').toLowerCase());

const LOCAL_SERVER = /^ws:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?(\/[^\s]*)?$/i;
const SECURE_SERVER = /^wss:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[^\s]*)?$/i;
export const isAllowedServerParam = s => typeof s === 'string' && (LOCAL_SERVER.test(s) || SECURE_SERVER.test(s));

export function resolveServer(loc = globalThis.location, params = new URLSearchParams(loc?.search || '')) {
  if (isLocalHost(loc)) {
    if (params.get('coop') === 'soon') return { comingSoon: true };
    const asked = params.get('server');
    return { url: isAllowedServerParam(asked) ? asked : ONLINE.server.local };
  }
  const live = ONLINE.server.live;
  if (live && (ONLINE.server.open || params.get('coop') === 'preview')) return { url: live };
  return { comingSoon: true };
}
