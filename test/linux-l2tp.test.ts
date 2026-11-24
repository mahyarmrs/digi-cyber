import { describe, expect, it } from 'vitest';

import { nmcliAddArgs } from '../src/main/os/linux';

const account = { host: 'vpn.example.com', username: 'dana@example.com', password: "pa'ss word", psk: 'shared-key-123' };

describe('nmcliAddArgs', () => {
  it("adds an L2TP/IPsec connection for NetworkManager's l2tp plugin with the login stored", () => {
    expect(nmcliAddArgs(account)).toEqual([
      'connection', 'add', 'type', 'vpn', 'con-name', 'Digi Cyber L2TP', 'ifname', '--', 'vpn-type', 'l2tp',
      'connection.autoconnect', 'no',
      'vpn.data', 'gateway=vpn.example.com, user=dana@example.com, password-flags=0, ipsec-enabled=yes, ipsec-psk-flags=0, refuse-eap=yes, refuse-pap=yes, refuse-chap=yes, refuse-mschap=yes',
      'vpn.secrets', "password=pa'ss word, ipsec-psk=shared-key-123",
    ]);
  });

  // nmcli splits vpn.data and vpn.secrets on commas: one would smuggle in another setting.
  it('refuses a value that would add a setting of its own', () => {
    expect(nmcliAddArgs({ ...account, password: 'x, ipsec-esp=null' })).toBeNull();
    expect(nmcliAddArgs({ ...account, host: 'h\nuser=root' })).toBeNull();
    expect(nmcliAddArgs({ ...account, psk: '' })).toBeNull();
  });
});
