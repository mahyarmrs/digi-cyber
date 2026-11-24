import type { Engine } from './types';

export type Os = 'windows' | 'linux' | 'macos';

export function osOf(platform: string): Os {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return 'linux';
}

// macOS has no L2TP client an app may set up without the user installing a profile by hand.
export function enginesOn(os: Os): Engine[] {
  return os === 'macos' ? ['xray', 'openvpn'] : ['xray', 'openvpn', 'l2tp'];
}
