import fs from 'node:fs';
import net from 'node:net';

// WireGuard for the official engine (WireGuard for Windows' tunnel service): a wg-quick config built
// from the outbound the app derives from the config's link (proxyOutboundFor in ./xray).

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface WireguardConfOptions {
  // Resolver addresses for the tunnel (the user's DNS setting or the default).
  dns: string[];
  // Kill switch: every IPv4 and IPv6 route in the tunnel as 0.0.0.0/0 and ::/0, which makes the
  // tunnel service block traffic outside it. Without it the same space goes as halves, which it does not.
  killSwitch: boolean;
  // IPv4 ranges kept out of the tunnel (Iran direct). Takes precedence over the kill switch,
  // which cannot leave ranges out.
  direct?: Cidr4[];
  // Server names resolved before connecting, put in place of the endpoint's name.
  hosts?: Record<string, string[]>;
}

const halves4 = ['0.0.0.0/1', '128.0.0.0/1'];
const halves6 = ['::/1', '8000::/1'];

function hostPort(endpoint: string): { host: string; port: string } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(endpoint) ?? /^([^:]+):(\d+)$/.exec(endpoint);
  return m ? { host: m[1], port: m[2] } : null;
}

// An interface address with its prefix; a bare address is one host.
function withPrefix(address: string): string | null {
  const [ip, bits] = address.split('/');
  const kind = net.isIP(ip);
  if (kind === 0) return null;
  const max = kind === 4 ? 32 : 128;
  const n = bits === undefined ? max : Number(bits);
  if (!Number.isInteger(n) || n < 0 || n > max) return null;
  return `${ip}/${n}`;
}

export function allowedIps(opts: Pick<WireguardConfOptions, 'killSwitch' | 'direct'>): string[] {
  if (opts.direct && opts.direct.length > 0) return [...complement4(opts.direct).map(formatCidr4), ...halves6];
  return opts.killSwitch ? ['0.0.0.0/0', '::/0'] : [...halves4, ...halves6];
}

// The tunnel's config, or null when the outbound lacks a key, an address or an endpoint.
export function wireguardConf(outbound: Obj, opts: WireguardConfOptions): string | null {
  const s = isObj(outbound.settings) ? outbound.settings : null;
  const peer = s && Array.isArray(s.peers) && isObj(s.peers[0]) ? s.peers[0] : null;
  if (!s || !peer || typeof s.secretKey !== 'string' || typeof peer.publicKey !== 'string' || typeof peer.endpoint !== 'string') return null;
  const hp = hostPort(peer.endpoint);
  if (!hp) return null;
  const addresses = (Array.isArray(s.address) ? s.address : []).map((a) => (typeof a === 'string' ? withPrefix(a.trim()) : null)).filter((a): a is string => a !== null);
  if (addresses.length === 0) return null;
  const ip = net.isIP(hp.host) ? hp.host : opts.hosts?.[hp.host]?.[0];
  const host = ip ?? hp.host;
  const endpoint = net.isIPv6(host) ? `[${host}]:${hp.port}` : `${host}:${hp.port}`;
  const dns = opts.dns.filter((d) => net.isIP(d) !== 0);

  const lines = ['[Interface]', `PrivateKey = ${s.secretKey}`, `Address = ${addresses.join(', ')}`];
  if (dns.length > 0) lines.push(`DNS = ${dns.join(', ')}`);
  // Without an MTU line the tunnel service sets one from the system's own connection, as the official app does.
  if (typeof s.mtu === 'number' && Number.isInteger(s.mtu) && s.mtu >= 576 && s.mtu <= 9000) lines.push(`MTU = ${s.mtu}`);
  lines.push('', '[Peer]', `PublicKey = ${peer.publicKey}`);
  if (typeof peer.preSharedKey === 'string' && peer.preSharedKey !== '') lines.push(`PresharedKey = ${peer.preSharedKey}`);
  lines.push(`AllowedIPs = ${allowedIps(opts).join(', ')}`, `Endpoint = ${endpoint}`);
  // Keeps the path through NAT and a relay open, and a limited account's seat held while connected.
  const keepAlive = typeof peer.keepAlive === 'number' && peer.keepAlive > 0 ? peer.keepAlive : 25;
  lines.push(`PersistentKeepalive = ${keepAlive}`, '');
  return lines.join('\r\n');
}

// The resolver addresses a WireGuard link names (dns=…), if any.
export function linkDns(link: string): string[] {
  const m = /[?&]dns=([^&#]*)/i.exec(link);
  if (!m) return [];
  let value = m[1];
  try {
    value = decodeURIComponent(value);
  } catch {
    // Kept as written.
  }
  return value.split(/[\s,]+/).filter((d) => net.isIP(d) !== 0);
}

// The peer of `wg show <tunnel> dump`: its latest handshake (Unix seconds, 0 for none) and its counters.
export interface PeerState {
  handshake: number;
  rx: number;
  tx: number;
}

export function parseDump(text: string): PeerState | null {
  const rows = text.trim().split(/\r?\n/);
  for (const row of rows.slice(1)) {
    const f = row.split('\t');
    if (f.length < 8) continue;
    const handshake = Number(f[4]);
    const rx = Number(f[5]);
    const tx = Number(f[6]);
    if ([handshake, rx, tx].every(Number.isFinite)) return { handshake, rx, tx };
  }
  return null;
}

// ----- IPv4 ranges -----

export interface Cidr4 {
  ip: number; // unsigned 32-bit
  bits: number;
}

export function parseCidr4(text: string): Cidr4 | null {
  const [ip, bits] = text.split('/');
  if (!net.isIPv4(ip)) return null;
  const n = bits === undefined ? 32 : Number(bits);
  if (!Number.isInteger(n) || n < 0 || n > 32) return null;
  const value = ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
  return { ip: value, bits: n };
}

export function formatCidr4(c: Cidr4): string {
  const v = c.ip;
  return `${Math.floor(v / 2 ** 24) % 256}.${Math.floor(v / 2 ** 16) % 256}.${Math.floor(v / 2 ** 8) % 256}.${v % 256}/${c.bits}`;
}

const span = (bits: number) => 2 ** (32 - bits);

// The fewest CIDRs that cover [start, end] exactly.
function rangeToCidrs(start: number, end: number): Cidr4[] {
  const out: Cidr4[] = [];
  while (start <= end) {
    let bits = 32;
    // Grow the block while it stays aligned at start and inside the range.
    while (bits > 0 && start % span(bits - 1) === 0 && start + span(bits - 1) - 1 <= end) bits--;
    out.push({ ip: start, bits });
    start += span(bits);
  }
  return out;
}

// Everything in IPv4 that none of the given ranges covers, as the fewest CIDRs.
export function complement4(excluded: Cidr4[]): Cidr4[] {
  const ranges = excluded
    .map((c) => {
      const start = c.ip - (c.ip % span(c.bits));
      return [start, start + span(c.bits) - 1] as [number, number];
    })
    .sort((a, b) => a[0] - b[0]);
  const out: Cidr4[] = [];
  let next = 0;
  for (const [start, end] of ranges) {
    if (start > next) out.push(...rangeToCidrs(next, start - 1));
    next = Math.max(next, end + 1);
  }
  if (next <= 2 ** 32 - 1) out.push(...rangeToCidrs(next, 2 ** 32 - 1));
  return out;
}

// Addresses that never go through the tunnel when Iran direct is on, as Xray's geoip:private rule.
export const privateRanges = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '224.0.0.0/4', '240.0.0.0/4'];

// ----- geoip.dat -----
// GeoIPList { repeated GeoIP entry = 1 }  GeoIP { string country_code = 1; repeated CIDR cidr = 2 }
// CIDR { bytes ip = 1; uint32 prefix = 2 }: the file Xray ships, read for one country's IPv4 ranges.

function varint(buf: Buffer, pos: number): [number, number] {
  let result = 0;
  let mul = 1;
  for (;;) {
    if (pos >= buf.length) throw new Error('geoip: truncated');
    const b = buf[pos++];
    result += (b & 0x7f) * mul;
    if (b < 0x80) return [result, pos];
    mul *= 128;
  }
}

// Calls fn for each field of the message in buf[start, end).
function fields(buf: Buffer, start: number, end: number, fn: (field: number, wire: number, from: number, to: number, value: number) => void): void {
  let pos = start;
  while (pos < end) {
    let key: number;
    [key, pos] = varint(buf, pos);
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (wire === 0) {
      let value: number;
      [value, pos] = varint(buf, pos);
      fn(field, wire, pos, pos, value);
    } else if (wire === 2) {
      let len: number;
      [len, pos] = varint(buf, pos);
      fn(field, wire, pos, pos + len, len);
      pos += len;
    } else if (wire === 5) {
      pos += 4;
    } else if (wire === 1) {
      pos += 8;
    } else {
      throw new Error(`geoip: wire type ${wire}`);
    }
  }
}

export function geoipCidrs4(buf: Buffer, country: string): Cidr4[] {
  const want = country.toUpperCase();
  const out: Cidr4[] = [];
  fields(buf, 0, buf.length, (field, wire, from, to) => {
    if (field !== 1 || wire !== 2) return;
    // The country code is serialized first: other countries are skipped without reading their ranges.
    const [key, at] = varint(buf, from);
    if (key !== (1 << 3) + 2) return;
    const [len, codeAt] = varint(buf, at);
    if (buf.toString('latin1', codeAt, codeAt + len).toUpperCase() !== want) return;
    const cidrs: [number, number][] = [];
    fields(buf, codeAt + len, to, (f, w, a, b) => {
      if (f === 2 && w === 2) cidrs.push([a, b]);
    });
    for (const [a, b] of cidrs) {
      let ip: Buffer | null = null;
      let prefix = 0;
      fields(buf, a, b, (f, w, x, y, value) => {
        if (f === 1 && w === 2) ip = buf.subarray(x, y);
        else if (f === 2 && w === 0) prefix = value;
      });
      const bytes = ip as Buffer | null;
      if (bytes && bytes.length === 4 && prefix <= 32) out.push({ ip: bytes.readUInt32BE(0), bits: prefix });
    }
  });
  return out;
}

const directCache = new Map<string, Cidr4[]>();

// The ranges Iran direct keeps out of the tunnel: Iran's (from the geoip.dat beside the engines) and
// private ones. Null when the file cannot be read, so the caller sends everything through the tunnel.
export function iranDirectRanges(geoipFile: string): Cidr4[] | null {
  const hit = directCache.get(geoipFile);
  if (hit) return hit;
  try {
    const ir = geoipCidrs4(fs.readFileSync(geoipFile), 'IR');
    if (ir.length === 0) return null;
    const all = [...ir, ...privateRanges.map((r) => parseCidr4(r) as Cidr4)];
    directCache.set(geoipFile, all);
    return all;
  } catch {
    return null;
  }
}
