import { describe, expect, it } from 'vitest';

import { openvpnArgs, openvpnPushedAddress, openvpnUdp, unsafeOpenvpnDirective } from '../src/main/configs/openvpn';

// The shape Manifold's renderer writes, client directives and inline credentials included.
const panelProfile = `# de-1
client
dev tun
proto udp
remote de.example.com 1194
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name manifold-openvpn-server name
data-ciphers AES-256-GCM:CHACHA20-POLY1305
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
setenv CLIENT_CERT 0
verb 3
<auth-user-pass>
dana
pass
</auth-user-pass>
<ca>
-----BEGIN CERTIFICATE-----
up /tmp/not-a-directive-inside-a-block.sh
-----END CERTIFICATE-----
</ca>
<tls-crypt>
-----BEGIN OpenVPN Static key V1-----
00
-----END OpenVPN Static key V1-----
</tls-crypt>
`;

describe('unsafeOpenvpnDirective', () => {
  it("accepts the panel's profiles", () => {
    expect(unsafeOpenvpnDirective(panelProfile)).toBeNull();
  });

  // The helper runs OpenVPN as root; a profile is input from whoever talks to it.
  it.each([
    ['up /tmp/x.sh', 'up'],
    ['  --route-up "/bin/sh -c id"', 'route-up'],
    ['script-security 2', 'script-security'],
    ['plugin /lib/evil.so', 'plugin'],
    ['auth-user-pass /etc/shadow', 'auth-user-pass'],
    ['ca /etc/ssl/private/server.key', 'ca'],
    ['management 0.0.0.0 7505', 'management'],
    ['management-client-user root', 'management-client-user'],
    ['log-append /etc/cron.d/x', 'log-append'],
    ['config /root/other.ovpn', 'config'],
    ['replay-persist /etc/passwd', 'replay-persist'],
  ])('refuses %s', (line, directive) => {
    expect(unsafeOpenvpnDirective(`client\nremote h 1194\n${line}\n`)).toBe(directive);
  });

  it('refuses an inline block that never closes, which would hide what follows', () => {
    expect(unsafeOpenvpnDirective('client\n<ca>\nup /tmp/x\n')).toBe('<ca>');
  });
});

describe('openvpnArgs', () => {
  it('lets OpenVPN run only its own system tools, whatever the profile says', () => {
    const args = openvpnArgs('/run/p.ovpn', 7505, 'linux');
    expect(args.slice(0, 2)).toEqual(['--config', '/run/p.ovpn']);
    expect(args).toContain('--script-security');
    expect(args[args.indexOf('--script-security') + 1]).toBe('1');
    expect(args).not.toContain('--windows-driver');
  });
});

describe('the exit notification', () => {
  it('is asked for over UDP, after the profile so it wins, and not over TCP', () => {
    const udp = openvpnArgs('/run/p.ovpn', 7505, 'linux', { udp: true });
    const at = udp.indexOf('--explicit-exit-notify');
    expect(at).toBeGreaterThan(udp.indexOf('--config'));
    expect(udp[at + 1]).toBe('1');
    expect(openvpnArgs('C:\\p.ovpn', 7505, 'windows', { udp: true, disableDco: true })).toContain('--explicit-exit-notify');
    expect(openvpnArgs('/run/p.ovpn', 7505, 'linux', { udp: false })).not.toContain('--explicit-exit-notify');
  });

  it('reads the tunnel address the server pushed', () => {
    const subnet = "2026-11-19 17:38:31 PUSH: Received control message: 'PUSH_REPLY,route-gateway 10.89.0.1,topology subnet,ping 10,ping-restart 120,ifconfig 10.89.0.2 255.255.255.0,peer-id 0,cipher AES-256-GCM'";
    expect(openvpnPushedAddress(subnet)).toBe('10.89.0.2');
    expect(openvpnPushedAddress("PUSH: Received control message: 'PUSH_REPLY,ifconfig 10.8.0.6 10.8.0.5,peer-id 1'")).toBe('10.8.0.6');
    expect(openvpnPushedAddress("PUSH: Received control message: 'PUSH_REPLY,ifconfig-ipv6 fd00::2/64 fd00::1,ifconfig 10.8.0.6 255.255.255.0'")).toBe('10.8.0.6');
    expect(openvpnPushedAddress('net_addr_v4_add: 10.89.0.2/24 dev dcvpn0')).toBeNull();
  });

  it('reads the transport the way OpenVPN does', () => {
    expect(openvpnUdp('client\nremote vpn.example.com 1194\n')).toBe(true);
    expect(openvpnUdp('client\nproto udp4\nremote vpn.example.com 1194\n')).toBe(true);
    expect(openvpnUdp('client\nproto tcp-client\nremote vpn.example.com 443\n')).toBe(false);
    expect(openvpnUdp('client\nproto udp\nremote vpn.example.com 443 tcp\n')).toBe(false);
    // "proto" must not be read off the next line.
    expect(openvpnUdp('client\nproto\ntcp-client\nremote vpn.example.com 443\n')).toBe(true);
  });
});
