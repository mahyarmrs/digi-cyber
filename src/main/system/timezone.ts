import { run } from './run';
import { windowsZone } from './zones';

// Sets the device's zone to the server's and gives back the one to restore.
export async function applyZone(iana: string): Promise<string | null> {
  const target = windowsZone(iana);
  if (!target) return null;
  const current = (await run('tzutil.exe', ['/g'])).stdout.trim();
  if (!current || current === target) return null;
  const res = await run('tzutil.exe', ['/s', target]);
  return res.code === 0 ? current : null;
}

export async function restoreZone(previous: string | null): Promise<void> {
  if (previous) await run('tzutil.exe', ['/s', previous]);
}
