import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';

import type { Os } from '../../shared/platform';
import { regQuery, run } from './run';

// The system's own id survives reinstalling the app, so the device keeps its slot of the device limit.
async function machineId(system: Os): Promise<string | null> {
  if (system === 'windows') return regQuery('HKLM\\SOFTWARE\\Microsoft\\Cryptography', 'MachineGuid');
  if (system === 'linux') {
    for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      try {
        const id = fs.readFileSync(file, 'utf8').trim();
        if (id) return id;
      } catch {
        // Next one.
      }
    }
    return null;
  }
  const out = (await run('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])).stdout;
  return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null;
}

export async function deviceId(system: Os, stored: string | undefined): Promise<string> {
  const id = await machineId(system);
  if (id) return createHash('sha256').update(`digi-cyber:${id.toLowerCase()}`).digest('hex').slice(0, 32);
  return stored || randomBytes(16).toString('hex');
}

export function deviceName(): string {
  return os.hostname();
}
