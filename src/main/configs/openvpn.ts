import type { Os } from '../../shared/platform';

const scheme = 'openvpn://';

// The panel carries the .ovpn profile as base64url after openvpn://.
export function openvpnProfile(link: string): string {
  if (!link.startsWith(scheme)) throw new Error('not an OpenVPN link');
  const text = Buffer.from(link.slice(scheme.length), 'base64url').toString('utf8');
  if (!/^\s*client\s*$/m.test(text) || !/^\s*remote\s+\S+/m.test(text)) throw new Error('not an OpenVPN profile');
  return text;
}

// Directives that run programs, read or write files, or open a control port.
const forbidden = new Set([
  'up', 'down', 'route-up', 'route-pre-down', 'ipchange', 'tls-verify', 'tls-export-cert', 'auth-user-pass-verify',
  'client-connect', 'client-disconnect', 'learn-address', 'script-security', 'plugin', 'config', 'cd', 'chroot',
  'log', 'log-append', 'writepid', 'status', 'daemon', 'askpass', 'iproute', 'dev-node', 'tmp-dir', 'syslog',
  'setcon', 'replay-persist', 'ifconfig-pool-persist', 'machine-readable-output', 'http-proxy-user-pass', 'echo',
]);
// Files are only accepted inline (<ca>…</ca>); a path would be read as root.
const inlineOnly = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'extra-certs', 'secret', 'pkcs12', 'crl-verify', 'dh', 'auth-user-pass']);

// The first directive of a profile the root helper must not run, or null when it is safe.
export function unsafeOpenvpnDirective(profile: string): string | null {
  let inline: string | null = null;
  for (const raw of profile.split(/\r?\n/)) {
    const line = raw.trim();
    if (inline) {
      if (line.toLowerCase() === `</${inline}>`) inline = null;
      continue;
    }
    const open = /^<([a-z0-9-]+)>$/i.exec(line);
    if (open) {
      inline = open[1].toLowerCase();
      continue;
    }
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;
    const [first, ...rest] = line.split(/\s+/);
    const name = first.replace(/^-+/, '').toLowerCase();
    if (forbidden.has(name) || name.startsWith('management')) return name;
    if (inlineOnly.has(name) && rest.length > 0 && rest[0] !== '[inline]') return name;
  }
  return inline ? `<${inline}>` : null;
}

// OpenVPN's default is UDP; "proto tcp-client" or a TCP remote makes it TCP. ([ \t], not \s: a match must not run into the next line.)
export function openvpnUdp(profile: string): boolean {
  const remoteProto = /^[ \t]*remote[ \t]+\S+[ \t]+\d+[ \t]+(\S+)/m.exec(profile)?.[1];
  const proto = remoteProto ?? /^[ \t]*proto[ \t]+(\S+)/m.exec(profile)?.[1] ?? 'udp';
  return proto.toLowerCase().startsWith('udp');
}

// Over UDP the server only learns that a client left from an exit notification; without one it keeps
// the session, and the account's seat, until its keepalive gives up (two minutes on Manifold). OpenVPN
// waits a second per try before it exits; one is enough, since the app also tells the panel which
// session left (AppApi.disconnected). Given after --config, so it wins over the profile.
export const openvpnExitNotify = ['--explicit-exit-notify', '1'];

// The tunnel address the server gave, from its PUSH_REPLY: what tells the panel which session was this device's.
export function openvpnPushedAddress(line: string): string | null {
  if (!/PUSH_REPLY/.test(line)) return null;
  return /(?:^|[,'\s])ifconfig ((?:\d{1,3}\.){3}\d{1,3})\b/.exec(line)?.[1] ?? null;
}

export function openvpnArgs(configPath: string, managementPort: number, os: Os, opts: { disableDco?: boolean; udp?: boolean } = {}): string[] {
  const args = ['--config', configPath, '--management', '127.0.0.1', String(managementPort), '--script-security', '1'];
  if (opts.udp) args.push(...openvpnExitNotify);
  // Windows: OpenVPN 2.6 takes the app's ovpn-dco adapter when the profile allows Data Channel Offload,
  // and its TAP-Windows6 adapter otherwise (src/main/system/openvpnAdapters.ts).
  if (os === 'windows') return opts.disableDco ? [...args, '--disable-dco'] : args;
  // A fixed name, so the helper can point systemd-resolved at the tunnel afterwards.
  return os === 'linux' ? [...args, '--dev-type', 'tun', '--dev', 'dcvpn0'] : args;
}
