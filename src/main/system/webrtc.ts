import { regDelete, regQuery, regSet } from './run';

// Chromium browsers read this policy; it keeps WebRTC from offering addresses outside the proxy.
const policyKeys = [
  'HKLM\\SOFTWARE\\Policies\\Google\\Chrome',
  'HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge',
  'HKLM\\SOFTWARE\\Policies\\BraveSoftware\\Brave',
];
const valueName = 'WebRtcIPHandling';
const protectedValue = 'disable_non_proxied_udp';

export type WebrtcBackup = Record<string, string | null>;

export async function protectWebrtc(): Promise<WebrtcBackup> {
  const backup: WebrtcBackup = {};
  for (const key of policyKeys) {
    const current = await regQuery(key, valueName);
    if (current === protectedValue) continue;
    if (await regSet(key, valueName, 'REG_SZ', protectedValue)) backup[key] = current;
  }
  return backup;
}

export async function restoreWebrtc(backup: WebrtcBackup): Promise<void> {
  for (const [key, previous] of Object.entries(backup)) {
    if (previous === null) await regDelete(key, valueName);
    else await regSet(key, valueName, 'REG_SZ', previous);
  }
}
