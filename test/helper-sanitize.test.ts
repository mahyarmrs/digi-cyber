import { describe, expect, it } from 'vitest';

import { sanitizeConnect } from '../src/helper/sanitize';

const vless = { protocol: 'vless', name: 'de', link: 'vless://id@de.example.com:443', locationId: 1, outbound: { protocol: 'vless', settings: { address: 'de.example.com' } } };
const account = { username: 'dana', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 0, devices: 0 };
const request = (patch: Record<string, unknown> = {}) => ({
  profile: { account, locations: [{ id: 1, name: 'DE', countryCode: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin' }], configs: [vless] },
  settings: { killSwitch: true, dns: '9.9.9.9', splitApps: [{ name: 'steam', path: '/usr/bin/steam' }] },
  locationId: 1,
  latency: [['vless://id@de.example.com:443', 40]],
  ...patch,
});

// Whoever can reach the helper's socket is untrusted: it runs engines as root.
describe('sanitizeConnect', () => {
  it('passes a request from the app through', () => {
    const out = sanitizeConnect(request());
    expect(out.profile.configs).toHaveLength(1);
    expect(out.settings.killSwitch).toBe(true);
    expect(out.settings.dns).toBe('9.9.9.9');
    expect(out.locationId).toBe(1);
    expect(out.latency.get('vless://id@de.example.com:443')).toBe(40);
  });

  it('refuses what is not a request', () => {
    expect(() => sanitizeConnect(null)).toThrow('bad_request');
    expect(() => sanitizeConnect(request({ locationId: '1; rm -rf /' }))).toThrow('bad_request');
    expect(() => sanitizeConnect(request({ profile: { account, locations: [], configs: 'x' } }))).toThrow('bad_request');
  });

  it('drops a timezone that is not an IANA name and split apps that are not plain names', () => {
    const out = sanitizeConnect(
      request({
        profile: { account, locations: [{ id: 1, name: 'DE', countryCode: 'DE', city: '', timezone: '../../etc/x' }], configs: [vless] },
        settings: { splitApps: [{ name: 'ok-app', path: '' }, { name: '-rf', path: '' }, { name: 'a\nb', path: '' }] },
      }),
    );
    expect(out.profile.locations[0].timezone).toBe('');
    expect(out.settings.splitApps.map((a) => a.name)).toEqual(['ok-app']);
  });

  it('keeps only DNS addresses', () => {
    expect(sanitizeConnect(request({ settings: { dns: '1.1.1.1, evil.example.com; 2606:4700::1111' } })).settings.dns).toBe('1.1.1.1,2606:4700::1111');
  });

  it('strips files an Xray outbound would read as root', () => {
    const tls = { ...vless, outbound: { protocol: 'vless', streamSettings: { tlsSettings: { serverName: 'x', certificates: [{ certificateFile: '/etc/shadow' }] } } } };
    const out = sanitizeConnect(request({ profile: { account, locations: [], configs: [tls] } }));
    expect(JSON.stringify(out.profile.configs[0].outbound)).not.toContain('/etc/shadow');
    expect(JSON.stringify(out.profile.configs[0].outbound)).toContain('"serverName":"x"');
  });
});
