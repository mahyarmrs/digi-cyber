import { findWindows } from 'windows-iana';

// tzutil takes Windows zone names; the panel gives IANA ones.
export function windowsZone(iana: string): string | null {
  if (!iana) return null;
  try {
    return findWindows(iana)[0] ?? null;
  } catch {
    return null;
  }
}
