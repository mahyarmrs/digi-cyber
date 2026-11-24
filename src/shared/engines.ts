import { enginesOn, type Os } from './platform';
import type { AppConfig, AppProfile, Engine, PingResult } from './types';

let runsOn: Engine[] = enginesOn('windows');

// Set once at start by each process, so every list leaves out what this system cannot run.
export function useOs(os: Os): void {
  runsOn = enginesOn(os);
}

const xrayProtocols = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'hysteria', 'hysteria2', 'wireguard']);

export function runsOnXray(protocol: string, outbound: unknown): boolean {
  return xrayProtocols.has(protocol) && typeof outbound === 'object' && outbound !== null;
}

export function engineOf(config: AppConfig): Engine | null {
  let engine: Engine | null = null;
  if (runsOnXray(config.protocol, config.outbound)) engine = 'xray';
  else if (config.protocol === 'openvpn') engine = 'openvpn';
  else if (config.protocol === 'l2tp') engine = 'l2tp';
  return engine && runsOn.includes(engine) ? engine : null;
}

// A location appears in the list only if the app can run something there.
export function usableLocationIds(profile: AppProfile): number[] {
  const ids = new Set<number>();
  for (const config of profile.configs) {
    if (engineOf(config) && typeof config.locationId === 'number') ids.add(config.locationId);
  }
  return [...ids];
}

export function bestPing(profile: AppProfile, pings: PingResult[], locationId: number | null): number | null {
  const byLink = new Map(pings.map((p) => [p.link, p.ms]));
  let best: number | null = null;
  for (const config of profile.configs) {
    if (!engineOf(config) || (locationId !== null && config.locationId !== locationId)) continue;
    const ms = byLink.get(config.link);
    if (typeof ms === 'number' && (best === null || ms < best)) best = ms;
  }
  return best;
}
