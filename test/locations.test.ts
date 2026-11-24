import { describe, expect, it } from 'vitest';

import { countryName, countryPoint, project } from '../src/renderer/geo/geo';
import { groupLocations } from '../src/renderer/locations';
import type { AppProfile } from '../src/shared/types';

const vless = { protocol: 'vless', outbound: { protocol: 'vless' } };
const profile: AppProfile = {
  account: { username: 'dana', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 0, devices: 0 },
  locations: [
    { id: 0, name: 'Frankfurt 1', countryCode: 'de', city: 'Frankfurt', timezone: '' },
    { id: 1, name: '', countryCode: 'DE', city: 'Berlin', timezone: '' },
    { id: 2, name: 'Amsterdam', countryCode: 'NL', city: 'Amsterdam', timezone: '' },
    { id: 3, name: 'TUIC only', countryCode: 'FI', city: 'Helsinki', timezone: '' },
  ],
  configs: [
    { ...vless, name: 'a', link: 'vless://a', locationId: 0 },
    { ...vless, name: 'b', link: 'vless://b', locationId: 1 },
    { protocol: 'openvpn', name: 'c', link: 'openvpn://c', locationId: 2 },
    { protocol: 'tuic', name: 'd', link: 'tuic://d', locationId: 3 },
  ],
};
const pings = [
  { link: 'vless://a', ms: 90 },
  { link: 'vless://b', ms: 40 },
  { link: 'openvpn://c', ms: 20 },
];

describe('groupLocations', () => {
  it('groups by country, quickest country and server first, leaving out what the app cannot run', () => {
    const groups = groupLocations(profile, pings, 'all', '', 'en');
    expect(groups.map((g) => [g.code, g.name, g.items.map((i) => i.location.id)])).toEqual([
      ['NL', 'The Netherlands', [2]],
      ['DE', 'Germany', [1, 0]],
    ]);
  });

  it('keeps to a protocol and finds countries by either language', () => {
    expect(groupLocations(profile, pings, 'openvpn', '', 'en').map((g) => g.code)).toEqual(['NL']);
    expect(groupLocations(profile, pings, 'all', 'آلمان', 'en').map((g) => g.code)).toEqual(['DE']);
    expect(groupLocations(profile, pings, 'all', 'berlin', 'fa')[0].items.map((i) => i.location.id)).toEqual([1]);
  });
});

describe('geo', () => {
  it('places countries where the map draws them', () => {
    const de = countryPoint('de');
    expect(de && de.x > 0.5 && de.x < 0.56 && de.y > 0.42 && de.y < 0.5).toBe(true);
    const greenwich = project(0, 0);
    expect(greenwich.x).toBeCloseTo(0.5, 5);
    expect(countryName('IR', 'fa')).toBe('ایران');
    expect(countryPoint('ZZ')).toBeNull();
  });
});
