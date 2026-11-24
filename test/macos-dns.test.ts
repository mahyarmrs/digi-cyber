import { describe, expect, it } from 'vitest';

import { networkDnsServers, networkServices } from '../src/main/os/macos';

describe('macOS network DNS parsing', () => {
  it('lists enabled network services only', () => {
    expect(networkServices('An asterisk (*) denotes that a network service is disabled.\nWi-Fi\n*Thunderbolt Bridge\nUSB Ethernet\n')).toEqual(['Wi-Fi', 'USB Ethernet']);
  });

  it('reads explicit IPv4 and IPv6 resolvers', () => {
    expect(networkDnsServers('9.9.9.9\n2606:4700:4700::1111\n')).toEqual(['9.9.9.9', '2606:4700:4700::1111']);
  });

  it('recognizes DHCP-provided DNS and rejects command error text', () => {
    expect(networkDnsServers("There aren't any DNS Servers set on Wi-Fi.")).toEqual([]);
    expect(networkDnsServers('Could not find network service')).toBeNull();
  });
});
