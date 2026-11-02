// WHO IS ASKING: the client address the server's limits count by (DESIGN §12.3).
//
//   clientIp(req, { trustProxy })   -> '203.0.113.7' | '2001:db8:1:2::/64' | 'unknown'
//
// Behind Render (TRUST_PROXY=render) every request comes from Render's proxy, which ADDS the real client address as
// the right-most entry of X-Forwarded-For. Entries to its left were sent by the client itself and can say anything,
// so only the right-most one is trusted. Anywhere else (TRUST_PROXY=none, the default) the header is ignored and the
// socket's own address is used. The server's tests start it with TRUST_PROXY=render and give each simulated device its
// own X-Forwarded-For, so one test machine can act as many devices (BUILD-PLAN P2A).
//
// An IPv6 address is grouped by its /64 (one home or one phone usually has a whole /64), so the limits can't be
// dodged by walking through addresses. An IPv4 address written as IPv6 (::ffff:1.2.3.4) is the IPv4 address.
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

export function clientIp(req, { trustProxy = 'none' } = {}) {
  if (trustProxy === 'render') {
    const xff = req.headers?.['x-forwarded-for'];
    const list = (Array.isArray(xff) ? xff.join(',') : String(xff ?? '')).split(',').map(s => s.trim()).filter(Boolean);
    if (list.length) return normaliseIp(list[list.length - 1]);
  }
  return normaliseIp(req.socket?.remoteAddress);
}
