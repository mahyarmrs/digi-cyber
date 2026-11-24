import { execFile } from 'node:child_process';

// Host names and addresses only: a leading dash would reach ping as a flag.
const safeHost = /^[A-Za-z0-9.:_[\]][A-Za-z0-9.:_\-[\]%]*$/;

export function pingArgs(platform: NodeJS.Platform, host: string): string[] | null {
  if (!safeHost.test(host)) return null;
  if (platform === 'win32') return ['-n', '1', '-w', '2000', host];
  if (platform === 'darwin') return ['-c', '1', '-t', '2', host];
  return ['-c', '1', '-W', '2', host];
}

// "time=48ms", "Zeit=7ms", "time<1ms", "time=63.4 ms": every ping prints its round trip so.
export function pingMs(output: string): number | null {
  const match = /[=<]\s*(\d+(?:[.,]\d+)?)\s*ms\b/i.exec(output);
  if (!match) return null;
  return Math.max(1, Math.round(Number(match[1].replace(',', '.'))));
}

// ICMP through the system's ping, for servers that only answer on UDP (WireGuard, Hysteria, L2TP).
export function icmpPing(host: string, platform = process.platform): Promise<number | null> {
  const args = pingArgs(platform, host.replace(/^\[|\]$/g, ''));
  if (!args) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('ping', args, { timeout: 4000, windowsHide: true }, (_err, stdout) => resolve(pingMs(String(stdout))));
  });
}
