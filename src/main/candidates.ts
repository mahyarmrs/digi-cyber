import { engineOf } from '../shared/engines';
import type { AppConfig, AppProfile, Engine, ProtocolChoice } from '../shared/types';

export interface Candidate {
  config: AppConfig;
  engine: Engine;
}

// Auto tries the Xray protocols first: they get through filtering where the others are blocked.
function rank(config: AppConfig, engine: Engine): number {
  if (engine === 'xray') return config.protocol === 'wireguard' ? 1 : 0;
  return engine === 'openvpn' ? 2 : 3;
}

function matches(choice: ProtocolChoice, config: AppConfig, engine: Engine): boolean {
  switch (choice) {
    case 'auto':
      return true;
    case 'xray':
      return engine === 'xray' && config.protocol !== 'wireguard';
    case 'wireguard':
      return config.protocol === 'wireguard';
    default:
      return engine === choice;
  }
}

// The configs a connect to locationId tries, in order; null means every location, the
// lowest latency first within each kind. latency maps a link to its ping in ms.
export function candidates(
  profile: AppProfile,
  locationId: number | null,
  choice: ProtocolChoice,
  latency: Map<string, number | null> = new Map(),
): Candidate[] {
  const out: Candidate[] = [];
  for (const config of profile.configs) {
    const engine = engineOf(config);
    if (!engine || !matches(choice, config, engine)) continue;
    if (locationId !== null && config.locationId !== locationId) continue;
    out.push({ config, engine });
  }
  const ms = (c: Candidate) => latency.get(c.config.link) ?? Number.POSITIVE_INFINITY;
  return out.sort((a, b) => rank(a.config, a.engine) - rank(b.config, b.engine) || ms(a) - ms(b));
}

export function serverAddress(config: AppConfig): { host: string; port: number } | null {
  try {
    if (config.protocol === 'vmess') {
      const json = JSON.parse(Buffer.from(config.link.slice('vmess://'.length), 'base64').toString('utf8')) as { add?: string; port?: string | number };
      return json.add ? { host: json.add, port: Number(json.port) || 443 } : null;
    }
    if (config.protocol === 'openvpn') {
      const remote = /^\s*remote\s+(\S+)\s+(\d+)/m.exec(Buffer.from(config.link.slice('openvpn://'.length), 'base64url').toString('utf8'));
      return remote ? { host: remote[1], port: Number(remote[2]) } : null;
    }
    const url = new URL(config.link);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (!host) return null;
    return { host, port: Number(url.port) || (config.protocol === 'l2tp' ? 1701 : 443) };
  } catch {
    return null;
  }
}

// These servers listen on UDP only, so a TCP connect says nothing about them.
export function answersOnUdp(config: AppConfig): boolean {
  if (['wireguard', 'hysteria', 'hysteria2', 'l2tp'].includes(config.protocol)) return true;
  if (config.protocol !== 'openvpn') return false;
  try {
    return /^\s*proto\s+udp/m.test(Buffer.from(config.link.slice('openvpn://'.length), 'base64url').toString('utf8'));
  } catch {
    return false;
  }
}
