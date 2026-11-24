import { bestPing, engineOf } from '../shared/engines';
import type { AppConfig, AppLocation, AppProfile, Language, PingResult } from '../shared/types';
import { countryName } from './geo/geo';

export type ProtocolFilter = 'all' | 'xray' | 'wireguard' | 'openvpn' | 'l2tp';

export interface LocationItem {
  location: AppLocation;
  ping: number | null;
  protocols: string[];
}

export interface CountryGroup {
  code: string;
  name: string;
  items: LocationItem[];
}

function kind(config: AppConfig): ProtocolFilter | null {
  const engine = engineOf(config);
  if (!engine) return null;
  if (engine === 'xray') return config.protocol === 'wireguard' ? 'wireguard' : 'xray';
  return engine;
}

export function locationLabel(location: AppLocation, lang: Language): string {
  if (location.name) return location.name;
  if (location.countryCode) return countryName(location.countryCode, lang);
  return `#${location.id}`;
}

// Locations the app can run, by country, filtered by protocol and search; quickest first.
export function groupLocations(profile: AppProfile, pings: PingResult[], filter: ProtocolFilter, query: string, lang: Language): CountryGroup[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, CountryGroup>();
  for (const location of profile.locations) {
    const configs = profile.configs.filter((c) => c.locationId === location.id);
    const protocols = [...new Set(configs.map(kind).filter((k): k is ProtocolFilter => k !== null))];
    if (protocols.length === 0 || (filter !== 'all' && !protocols.includes(filter))) continue;
    const code = location.countryCode.toUpperCase();
    const name = code ? countryName(code, lang) : '';
    const haystack = [name, code ? countryName(code, lang === 'fa' ? 'en' : 'fa') : '', location.name, location.city].join(' ').toLowerCase();
    if (q && !haystack.includes(q)) continue;
    const group = groups.get(code) ?? { code, name, items: [] };
    group.items.push({ location, ping: bestPing(profile, pings, location.id), protocols });
    groups.set(code, group);
  }
  const quickest = (items: LocationItem[]) => Math.min(...items.map((i) => i.ping ?? Infinity));
  for (const group of groups.values()) group.items.sort((a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity));
  return [...groups.values()].sort((a, b) => quickest(a.items) - quickest(b.items) || a.name.localeCompare(b.name));
}
