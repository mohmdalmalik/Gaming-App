// WHO IS ASKING: the client address the server's limits count by (DESIGN §12.3).
//
//   whoIs(req, { trustProxy })      -> { ip: '203.0.113.7' | '2001:db8:1:2::/64' | 'unknown', from: 'cloudflare' | 'forwarded' | 'socket' }
//   clientIp(req, { trustProxy })   -> whoIs(...).ip
//
// Behind Render (TRUST_PROXY=render) every visitor reaches the server through Cloudflare, which Render runs in front of
// every service, and then Render's own proxy. Cloudflare puts the address the visitor connected from in
// CF-Connecting-IP, replacing anything the visitor sent under that name, so that is the address counted. X-Forwarded-For
// is not relied on there (since 22 Nov 2026): Render adds to it without clearing what the visitor sent, and which entry
// is the visitor's own depends on the proxies in between. Only a request with no usable CF-Connecting-IP (one that did
// not come through Cloudflare, such as Render's own health check) falls back to the right-most X-Forwarded-For entry.
// Behind another reverse proxy that appends the client address itself (Caddy, nginx: TRUST_PROXY=proxy) the right-most
// X-Forwarded-For entry is counted and CF-Connecting-IP is ignored, since there a visitor could send it. Anywhere else
// (TRUST_PROXY=none, the default) both headers are ignored and the socket's own address is used. The server's tests
// start it with TRUST_PROXY=render and give each simulated device its own X-Forwarded-For (and no CF-Connecting-IP), so
// one test machine can act as many devices (BUILD-PLAN P2A). GET /health tells whoever asks how it sees them
// (their own address only), so the counting can be checked from outside.
//
// An IPv6 address is grouped by its /64 (one phone usually has a whole /64), so the limits can't be dodged by walking
// through addresses. Sockets are counted by that /64; the server's brain widens it again for wrong codes and tables
// (a /56, and a share per /48: a home is often given a whole /56 or /48, RIPE-690; addressGroups in src/net/rooms.js).
// An IPv4 address written as IPv6 (::ffff:1.2.3.4) is the IPv4 address.
import net from 'node:net';

export function normaliseIp(raw) {
  let ip = String(raw ?? '').trim();
  if (!ip) return 'unknown';
  if (ip.startsWith('[') && ip.includes(']')) ip = ip.slice(1, ip.indexOf(']'));   // [v6]:port
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.slice(0, ip.lastIndexOf(':'));   // v4:port
  const pct = ip.indexOf('%');
  if (pct >= 0) ip = ip.slice(0, pct);                                               // a zone id
  const lower = ip.toLowerCase();
  if (lower.startsWith('::ffff:') && net.isIPv4(lower.slice(7))) return lower.slice(7);
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return 'unknown';
  return `${expandV6(lower).slice(0, 4).join(':')}::/64`;
}

// The eight groups of an IPv6 address, each without leading zeros.
function expandV6(ip) {
  let head = ip, tail = '';
  if (ip.includes('::')) [head, tail] = ip.split('::');
  const part = s => (s ? s.split(':') : []);
  let h = part(head), t = part(tail);
  const v4 = t.length && net.isIPv4(t[t.length - 1]) ? t.pop() : (!tail && h.length && net.isIPv4(h[h.length - 1]) ? h.pop() : null);
  const groups = [...h];
  const fill = 8 - h.length - t.length - (v4 ? 2 : 0);
  for (let i = 0; i < fill; i++) groups.push('0');
  groups.push(...t);
  if (v4) { const [a, b, c, d] = v4.split('.').map(Number); groups.push(((a << 8) | b).toString(16), ((c << 8) | d).toString(16)); }
  return groups.map(g => (parseInt(g, 16) || 0).toString(16));
}

const firstValue = v => (Array.isArray(v) ? v[0] : v);

export function whoIs(req, { trustProxy = 'none' } = {}) {
  if (trustProxy === 'render') {
    const cf = normaliseIp(firstValue(req.headers?.['cf-connecting-ip']));
    if (cf !== 'unknown') return { ip: cf, from: 'cloudflare' };
  }
  if (trustProxy === 'render' || trustProxy === 'proxy') {
    const xff = req.headers?.['x-forwarded-for'];
    const list = (Array.isArray(xff) ? xff.join(',') : String(xff ?? '')).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) return { ip: normaliseIp(list[list.length - 1]), from: 'forwarded' };
  }
  return { ip: normaliseIp(req.socket?.remoteAddress), from: 'socket' };
}

export const clientIp = (req, opts) => whoIs(req, opts).ip;
