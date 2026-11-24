import net from 'node:net';

export interface XrayOptions {
  socksPort: number;
  httpPort: number;
  iranDirect: boolean;
  adBlock?: boolean;
  dns?: string[];
  // Server names resolved before connecting, so Xray never asks its own tunnel where its server is.
  hosts?: Record<string, string[]>;
  // info while the config is tested (only the test page goes through it then), so a failure says why;
  // warning once it carries the user's traffic, which then stays out of the log.
  logLevel?: 'info' | 'warning';
}

// Resolver Xray uses for names inside the tunnel; its own UDP leaves the tunnel by process rule.
export const defaultDns = ['1.1.1.1', '8.8.8.8'];

// The user's DNS setting: addresses separated by commas or spaces, the default when empty.
export function dnsServers(setting: string): string[] {
  const list = setting.split(/[\s,]+/).filter((s) => /^[0-9a-fA-F.:]+$/.test(s));
  return list.length > 0 ? list : defaultDns;
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

// The objects of an outbound that carry its server's address: settings itself (VLESS and Hysteria as
// Manifold writes them), each vnext entry (VMess) or each servers entry (Trojan, Shadowsocks).
function serverEntries(outbound: Obj): Obj[] {
  const settings = outbound.settings;
  if (!isObj(settings)) return [];
  const out: Obj[] = [];
  if (typeof settings.address === 'string') out.push(settings);
  for (const key of ['vnext', 'servers']) {
    const list = settings[key];
    if (Array.isArray(list)) for (const entry of list) if (isObj(entry) && typeof entry.address === 'string') out.push(entry);
  }
  return out;
}

function splitHostPort(endpoint: string): { host: string; port: string } | null {
  const m = /^\[([^\]]+)\]:(\d+)$/.exec(endpoint) ?? /^([^:]+):(\d+)$/.exec(endpoint);
  return m ? { host: m[1], port: m[2] } : null;
}

// The server names (not addresses) an outbound connects to, to be resolved before it runs.
export function serverNames(outbound: Obj): string[] {
  const names = new Set<string>();
  for (const entry of serverEntries(outbound)) names.add(String(entry.address));
  const settings = outbound.settings;
  if (isObj(settings) && Array.isArray(settings.peers)) {
    for (const peer of settings.peers) {
      const hp = isObj(peer) && typeof peer.endpoint === 'string' ? splitHostPort(peer.endpoint) : null;
      if (hp) names.add(hp.host);
    }
  }
  return [...names].filter((n) => n !== '' && net.isIP(n) === 0);
}

// wireguard://<private key>@host:port?publickey=…&address=…&presharedkey=…&mtu=…&keepalive=…&reserved=…
// The query is read without turning '+' into a space: a key is base64, which has no spaces but many '+'.
function query(link: string): Map<string, string> {
  const out = new Map<string, string>();
  const at = link.indexOf('?');
  if (at < 0) return out;
  const raw = link.slice(at + 1).split('#')[0];
  for (const part of raw.split('&')) {
    const eq = part.indexOf('=');
    const k = (eq < 0 ? part : part.slice(0, eq)).toLowerCase();
    const v = eq < 0 ? '' : part.slice(eq + 1);
    try {
      if (k && !out.has(k)) out.set(k, decodeURIComponent(v));
    } catch {
      if (k && !out.has(k)) out.set(k, v);
    }
  }
  return out;
}

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
// A 32-byte key in standard base64.
const wgKey = /^[A-Za-z0-9+/]{43}=$/;

// The WireGuard outbound, built from the link itself: the panel's outbound for it can carry a key
// whose '+' became a space (Manifold reads the key from the link twice), which Xray refuses.
export function wireguardOutbound(link: string, fallback?: Obj): Obj | null {
  const m = /^(?:wireguard|wg):\/\/([^@/?#]*)@([^/?#]+)/i.exec(link.trim());
  let secretKey = '';
  let endpoint = '';
  if (m) {
    try {
      secretKey = decodeURIComponent(m[1]);
    } catch {
      secretKey = m[1];
    }
    endpoint = m[2];
  }
  const q = query(link);
  const fb = isObj(fallback?.settings) ? (fallback!.settings as Obj) : {};
  const fbPeer = Array.isArray(fb.peers) && isObj(fb.peers[0]) ? (fb.peers[0] as Obj) : {};
  const repair = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/ /g, '+') : '');
  secretKey = wgKey.test(secretKey) ? secretKey : repair(fb.secretKey);
  const publicKey = q.get('publickey') ?? q.get('public_key') ?? q.get('peerpublickey') ?? repair(fbPeer.publicKey);
  endpoint = endpoint || (typeof fbPeer.endpoint === 'string' ? fbPeer.endpoint : '');
  if (!wgKey.test(secretKey) || !wgKey.test(publicKey.replace(/ /g, '+')) || !splitHostPort(endpoint)) return null;

  let address = list(q.get('address') ?? q.get('ip'));
  if (address.length === 0 && Array.isArray(fb.address)) address = fb.address.filter((a): a is string => typeof a === 'string');
  if (address.length === 0) return null;
  const allowed = list(q.get('allowedips') ?? q.get('allowed_ips'));
  const peer: Obj = { publicKey: publicKey.replace(/ /g, '+'), endpoint, allowedIPs: allowed.length > 0 ? allowed : ['0.0.0.0/0', '::/0'] };
  const psk = q.get('presharedkey') ?? q.get('preshared_key') ?? q.get('psk') ?? repair(fbPeer.preSharedKey);
  if (psk) peer.preSharedKey = psk.replace(/ /g, '+');
  const keepAlive = Number(q.get('keepalive') ?? q.get('persistentkeepalive') ?? fbPeer.keepAlive);
  if (Number.isInteger(keepAlive) && keepAlive > 0) peer.keepAlive = keepAlive;

  // The tunnel's own address family decides what the target names resolve to inside it.
  const has6 = address.some((a) => a.includes(':'));
  const settings: Obj = { secretKey, address, peers: [peer], noKernelTun: true, domainStrategy: has6 ? 'ForceIP' : 'ForceIPv4' };
  const mtu = Number(q.get('mtu') ?? fb.mtu);
  if (Number.isInteger(mtu) && mtu >= 576 && mtu <= 9000) settings.mtu = mtu;
  const reserved = list(q.get('reserved')).map(Number);
  if (reserved.length > 0 && reserved.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) settings.reserved = reserved;
  else if (Array.isArray(fb.reserved)) settings.reserved = fb.reserved;
  return { protocol: 'wireguard', settings };
}

// The outbound the app runs for a config: WireGuard from its link, the rest as the panel wrote it.
export function proxyOutboundFor(config: { protocol: string; link: string; outbound?: Obj | null }): Obj {
  if (config.protocol === 'wireguard') {
    const built = wireguardOutbound(config.link, config.outbound ?? undefined);
    if (built) return built;
  }
  return structuredClone(config.outbound ?? {});
}

function isPublicAddress(address: string): boolean {
  const kind = net.isIP(address);
  if (kind === 0) return !/(^|\.)(localhost|local|lan|internal|home\.arpa)$/i.test(address);
  if (kind === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127));
  }
  const v6 = address.toLowerCase();
  return !(v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80'));
}

// The address the outbound points at while a freedom outbound carries its connection to the real server.
export const carrierAddress = '10.255.255.254';

// Xray 26.7 and later refuse VLESS and Trojan without TLS to a public address, which plenty of
// services still run (often to a relay in the country). Such an outbound then points at a private
// address and dials through a freedom outbound that redirects to the real server, so it still connects.
function carryPlainOutbound(proxy: Obj, outbounds: Obj[]): void {
  if (proxy.protocol !== 'vless' && proxy.protocol !== 'trojan') return;
  const stream = (isObj(proxy.streamSettings) ? proxy.streamSettings : {}) as Obj;
  const security = typeof stream.security === 'string' ? stream.security : '';
  if (security !== '' && security !== 'none') return;
  const settings = isObj(proxy.settings) ? proxy.settings : {};
  if (proxy.protocol === 'vless' && typeof settings.encryption === 'string' && settings.encryption !== '' && settings.encryption !== 'none') return;
  const entry = serverEntries(proxy)[0];
  if (!entry) return;
  const real = String(entry.address);
  const port = Number(entry.port);
  if (!isPublicAddress(real) || !Number.isInteger(port)) return;

  entry.address = carrierAddress;
  // The transport's Host would otherwise become the private address.
  const hostOf: Record<string, string> = { ws: 'wsSettings', httpupgrade: 'httpupgradeSettings', xhttp: 'xhttpSettings', splithttp: 'splithttpSettings' };
  const network = typeof stream.network === 'string' ? stream.network : 'tcp';
  const key = hostOf[network];
  if (key) {
    const t = (isObj(stream[key]) ? stream[key] : {}) as Obj;
    const headers = isObj(t.headers) ? t.headers : {};
    if (!t.host && !headers.Host && !headers.host) t.host = real;
    stream[key] = t;
  } else if (network === 'grpc') {
    const g = (isObj(stream.grpcSettings) ? stream.grpcSettings : {}) as Obj;
    if (!g.authority) g.authority = net.isIPv6(real) ? `[${real}]` : real;
    stream.grpcSettings = g;
  }
  const sockopt = (isObj(stream.sockopt) ? stream.sockopt : {}) as Obj;
  sockopt.dialerProxy = 'carrier';
  stream.sockopt = sockopt;
  proxy.streamSettings = stream;
  const target = net.isIPv6(real) ? `[${real}]:${port}` : `${real}:${port}`;
  outbounds.push({ tag: 'carrier', protocol: 'freedom', settings: { redirect: target }, streamSettings: { sockopt: { domainStrategy: 'UseIPv4' } } });
}

export function xrayConfig(outbound: Obj, opts: XrayOptions): Obj {
  const proxy = structuredClone(outbound);
  proxy.tag = 'proxy';
  const stream = (isObj(proxy.streamSettings) ? proxy.streamSettings : {}) as Obj;
  const sockopt = (isObj(stream.sockopt) ? stream.sockopt : {}) as Obj;
  // Server names come from the hosts below; without them Xray would ask through the tunnel.
  sockopt.domainStrategy = 'UseIPv4';
  stream.sockopt = sockopt;
  proxy.streamSettings = stream;

  const extra: Obj[] = [];
  carryPlainOutbound(proxy, extra);

  const rules: Obj[] = [];
  if (opts.adBlock) rules.push({ type: 'field', domain: ['geosite:category-ads-all'], outboundTag: 'block' });
  rules.push({ type: 'field', ip: ['geoip:private'], outboundTag: 'direct' });
  if (opts.iranDirect) {
    rules.push(
      { type: 'field', domain: ['geosite:category-ir', 'regexp:\\.ir$'], outboundTag: 'direct' },
      { type: 'field', ip: ['geoip:ir'], outboundTag: 'direct' },
    );
  }
  const hosts: Obj = {};
  for (const [name, ips] of Object.entries(opts.hosts ?? {})) if (ips.length > 0) hosts[`full:${name}`] = ips.length === 1 ? ips[0] : ips;
  const onlyV6 = Object.values(opts.hosts ?? {}).some((ips) => ips.length > 0 && ips.every((ip) => ip.includes(':')));
  if (onlyV6) sockopt.domainStrategy = 'UseIP';
  return {
    log: { loglevel: opts.logLevel ?? 'warning', access: 'none' },
    dns: { ...(Object.keys(hosts).length > 0 ? { hosts } : {}), servers: opts.dns ?? defaultDns, queryStrategy: onlyV6 ? 'UseIP' : 'UseIPv4' },
    inbounds: [
      {
        tag: 'socks',
        listen: '127.0.0.1',
        port: opts.socksPort,
        protocol: 'socks',
        settings: { auth: 'noauth', udp: true },
        sniffing: { enabled: true, destOverride: ['http', 'tls', 'quic'], routeOnly: true },
      },
      { tag: 'http', listen: '127.0.0.1', port: opts.httpPort, protocol: 'http', settings: {} },
    ],
    outbounds: [proxy, { tag: 'direct', protocol: 'freedom' }, { tag: 'block', protocol: 'blackhole' }, ...extra],
    routing: { domainStrategy: 'IPIfNonMatch', rules },
  };
}
