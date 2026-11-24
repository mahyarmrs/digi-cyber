import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

import { executableName } from '../../shared/platform';
import { run } from '../system/run';
import type { SystemDnsBackup, SystemDnsResult, SystemKit } from './kit';

const networksetup = '/usr/sbin/networksetup';
const dnsStateFile = '/Library/Application Support/Digi Cyber/run/macos-dns.json';

// systemsetup prints "Time Zone: Europe/Berlin".
async function currentZone(): Promise<string> {
  return /:\s*(\S+)/.exec((await run('/usr/sbin/systemsetup', ['-gettimezone'])).stdout)?.[1] ?? '';
}

export function networkServices(output: string): string[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('*'));
}

// `networksetup -getdnsservers` prints one literal address per line, or a sentence when DHCP supplies DNS.
export function networkDnsServers(output: string): string[] | null {
  const text = output.trim();
  if (text === '' || /no dns servers|aren't any dns servers|there are no dns servers/i.test(text)) return [];
  const values = text.split(/\s+/);
  return values.length > 0 && values.every((value) => net.isIP(value) !== 0) ? values : null;
}

function sameServers(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value.toLowerCase() === b[index].toLowerCase());
}

function readDnsBackup(): SystemDnsBackup | null {
  try {
    const value = JSON.parse(fs.readFileSync(dnsStateFile, 'utf8')) as Partial<SystemDnsBackup>;
    if (!Array.isArray(value.applied) || typeof value.services !== 'object' || value.services === null) return null;
    const services: Record<string, string[]> = {};
    for (const [name, servers] of Object.entries(value.services)) {
      if (Array.isArray(servers) && servers.every((server) => typeof server === 'string')) services[name] = servers;
    }
    return { applied: value.applied.filter((server): server is string => typeof server === 'string'), services };
  } catch {
    return null;
  }
}

function saveDnsBackup(backup: SystemDnsBackup): void {
  fs.mkdirSync(path.dirname(dnsStateFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(dnsStateFile, JSON.stringify(backup), { mode: 0o600 });
}

async function getServiceDns(service: string): Promise<string[] | null> {
  const result = await run(networksetup, ['-getdnsservers', service]);
  return result.code === 0 ? networkDnsServers(result.stdout) : null;
}

async function setServiceDns(service: string, servers: string[]): Promise<boolean> {
  const result = await run(networksetup, ['-setdnsservers', service, ...(servers.length > 0 ? servers : ['empty'])]);
  return result.code === 0;
}

async function restoreDnsState(backup?: SystemDnsBackup | null): Promise<boolean> {
  const saved = backup ?? readDnsBackup();
  if (!saved) return true;
  let failed = false;
  for (const [service, previous] of Object.entries(saved.services)) {
    const current = await getServiceDns(service);
    if (current === null) {
      failed = true;
      continue;
    }
    // Do not overwrite a DNS change the user or another network tool made while the VPN was up.
    if (!sameServers(current, saved.applied)) continue;
    if (!(await setServiceDns(service, previous))) failed = true;
  }
  if (!failed) fs.rmSync(dnsStateFile, { force: true });
  return !failed;
}

async function applyDns(servers: string[]): Promise<SystemDnsResult> {
  const wanted = [...new Set(servers.filter((server) => net.isIP(server) !== 0))];
  if (wanted.length === 0) return { backup: null, configured: 0, failed: 1 };
  // Recover a snapshot left behind if the helper or the computer stopped while connected.
  if (!(await restoreDnsState())) return { backup: null, configured: 0, failed: 1 };

  const listed = await run(networksetup, ['-listallnetworkservices']);
  if (listed.code !== 0) return { backup: null, configured: 0, failed: 1 };
  const services = networkServices(listed.stdout);
  const before: Record<string, string[]> = {};
  let configured = 0;
  let failed = 0;

  for (const service of services) {
    const previous = await getServiceDns(service);
    if (previous === null) {
      failed++;
      continue;
    }
    if (sameServers(previous, wanted)) {
      configured++;
      continue;
    }
    before[service] = previous;
  }

  const backup: SystemDnsBackup = { applied: wanted, services: before };
  if (Object.keys(before).length > 0) {
    try {
      // Persist the original resolver settings before changing any network service.
      saveDnsBackup(backup);
    } catch {
      return { backup: null, configured: 0, failed: failed + Object.keys(before).length };
    }
  }

  for (const service of Object.keys(before)) {
    if (await setServiceDns(service, wanted)) configured++;
    else failed++;
  }

  return {
    backup: Object.keys(before).length > 0 ? backup : null,
    configured,
    failed,
  };
}

export const macosKit: SystemKit = {
  os: 'macos',
  exe: (name) => executableName('macos', name),
  // macOS ships no OpenVPN; Homebrew's (brew install openvpn) is used when it is there.
  openvpnBinary() {
    return ['/opt/homebrew/sbin/openvpn', '/usr/local/sbin/openvpn', '/opt/homebrew/opt/openvpn/sbin/openvpn'].find((p) => fs.existsSync(p)) ?? null;
  },
  openvpnUp: async () => undefined,
  applyDns,
  async restoreDns(backup) {
    await restoreDnsState(backup);
  },
  l2tp: null,
  async applyZone(iana) {
    const current = await currentZone();
    if (!current || current === iana) return null;
    return (await run('/usr/sbin/systemsetup', ['-settimezone', iana])).code === 0 ? current : null;
  },
  async restoreZone(previous) {
    if (previous) await run('/usr/sbin/systemsetup', ['-settimezone', previous]);
  },
  // Chrome on macOS takes policies only through a configuration profile; nothing to set here.
  protectWebrtc: async () => ({}),
  restoreWebrtc: async () => undefined,
};
