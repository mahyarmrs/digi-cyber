import fs from 'node:fs';

import { run } from '../system/run';
import type { SystemKit } from './kit';

// systemsetup prints "Time Zone: Europe/Berlin".
async function currentZone(): Promise<string> {
  return /:\s*(\S+)/.exec((await run('/usr/sbin/systemsetup', ['-gettimezone'])).stdout)?.[1] ?? '';
}

export const macosKit: SystemKit = {
  os: 'macos',
  exe: (name) => name,
  // macOS ships no OpenVPN; Homebrew's (brew install openvpn) is used when it is there.
  openvpnBinary() {
    return ['/opt/homebrew/sbin/openvpn', '/usr/local/sbin/openvpn', '/opt/homebrew/opt/openvpn/sbin/openvpn'].find((p) => fs.existsSync(p)) ?? null;
  },
  openvpnUp: async () => undefined,
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
