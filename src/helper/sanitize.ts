import { defaultSettings, type AppConfig, type AppLocation, type AppProfile, type ProtocolChoice, type Settings } from '../shared/types';

export interface ConnectRequest {
  profile: AppProfile;
  settings: Settings;
  locationId: number | null;
  latency: Map<string, number | null>;
}

function bad(): never {
  throw new Error('bad_request');
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 256): string => (typeof v === 'string' && v.length <= max ? v : '');
const int = (v: unknown): number | null => (Number.isSafeInteger(v) ? (v as number) : null);
const ianaZone = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const programName = /^[A-Za-z0-9_][A-Za-z0-9_ .+-]{0,127}$/;
const protocols: ProtocolChoice[] = ['auto', 'xray', 'wireguard', 'openvpn', 'l2tp'];

// Keys under which Xray reads a file; as root it could be any file on the machine.
const fileKeys = new Set(['certificates', 'certificateFile', 'keyFile', 'pinnedPeerCertificateChainSha256File']);

function withoutFiles(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutFiles);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => !fileKeys.has(k)).map(([k, v]) => [k, withoutFiles(v)]));
}

function location(v: unknown): AppLocation | null {
  if (!isObject(v) || int(v.id) === null) return null;
  const timezone = str(v.timezone, 64);
  return { id: v.id as number, name: str(v.name), countryCode: str(v.countryCode, 2), city: str(v.city), timezone: ianaZone.test(timezone) ? timezone : '' };
}

function config(v: unknown): AppConfig | null {
  if (!isObject(v)) return null;
  const protocol = str(v.protocol, 32);
  const link = str(v.link, 1 << 16);
  if (!/^[a-z0-9-]+$/.test(protocol) || !link) return null;
  const locationId = v.locationId === null || v.locationId === undefined ? null : int(v.locationId);
  if (locationId === null && v.locationId !== null && v.locationId !== undefined) return null;
  const outbound = isObject(v.outbound) ? (withoutFiles(JSON.parse(JSON.stringify(v.outbound))) as Record<string, unknown>) : undefined;
  return { protocol, name: str(v.name), link, locationId, outbound };
}

function settings(v: unknown): Settings {
  const s = isObject(v) ? v : {};
  const out: Settings = { ...defaultSettings };
  for (const key of ['killSwitch', 'autoReconnect', 'webrtcProtection', 'timezoneSpoof', 'iranDirect', 'adBlock', 'splitTunneling'] as const) {
    if (typeof s[key] === 'boolean') out[key] = s[key] as boolean;
  }
  if (protocols.includes(s.protocol as ProtocolChoice)) out.protocol = s.protocol as ProtocolChoice;
  out.dns = str(s.dns, 512)
    .split(/[\s,;]+/)
    .filter((d) => /^[0-9a-fA-F.:]+$/.test(d))
    .join(',');
  out.splitApps = Array.isArray(s.splitApps)
    ? s.splitApps.filter((a): a is { name: string; path: string } => isObject(a) && programName.test(str(a.name, 128))).map((a) => ({ name: a.name, path: str(a.path, 4096) }))
    : [];
  return out;
}

export function sanitizeConnect(params: unknown): ConnectRequest {
  if (!isObject(params) || !isObject(params.profile)) bad();
  const p = params.profile;
  if (!Array.isArray(p.locations) || !Array.isArray(p.configs) || !isObject(p.account)) bad();
  const locationId = params.locationId === null ? null : int(params.locationId);
  if (locationId === null && params.locationId !== null) bad();
  const latency = new Map<string, number | null>();
  if (Array.isArray(params.latency)) {
    for (const pair of params.latency) {
      if (Array.isArray(pair) && typeof pair[0] === 'string') latency.set(pair[0], typeof pair[1] === 'number' ? pair[1] : null);
    }
  }
  const a = p.account;
  return {
    profile: {
      account: {
        username: str(a.username),
        enabled: a.enabled === true,
        expiryTime: Number(a.expiryTime) || 0,
        upload: Number(a.upload) || 0,
        download: Number(a.download) || 0,
        total: Number(a.total) || 0,
        deviceLimit: Number(a.deviceLimit) || 0,
        devices: Number(a.devices) || 0,
      },
      locations: p.locations.slice(0, 500).map(location).filter((l): l is AppLocation => l !== null),
      configs: p.configs.slice(0, 2000).map(config).filter((c): c is AppConfig => c !== null),
    },
    settings: settings(params.settings),
    locationId,
    latency,
  };
}
