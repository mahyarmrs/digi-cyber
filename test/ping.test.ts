import { describe, expect, it } from 'vitest';

import { answersOnUdp } from '../src/main/candidates';
import { pingArgs, pingMs } from '../src/main/ping';

describe('pingMs', () => {
  it('reads the round trip from the ping of each system, in any Windows language', () => {
    expect(pingMs('Reply from 1.2.3.4: bytes=32 time=48ms TTL=52')).toBe(48);
    expect(pingMs('Antwort von 1.2.3.4: Bytes=32 Zeit=7ms TTL=118')).toBe(7);
    expect(pingMs('Reply from 1.2.3.4: bytes=32 time<1ms TTL=128')).toBe(1);
    expect(pingMs('64 bytes from 1.2.3.4: icmp_seq=1 ttl=52 time=63.4 ms')).toBe(63);
  });

  it('is null when nothing came back', () => {
    expect(pingMs('Request timed out.')).toBeNull();
    expect(pingMs('1 packets transmitted, 0 received, 100% packet loss')).toBeNull();
  });
});

describe('pingArgs', () => {
  it('sends one echo with a timeout, in the flags of each system', () => {
    expect(pingArgs('win32', 'de.example.com')).toEqual(['-n', '1', '-w', '2000', 'de.example.com']);
    expect(pingArgs('linux', 'de.example.com')).toEqual(['-c', '1', '-W', '2', 'de.example.com']);
    expect(pingArgs('darwin', 'de.example.com')).toEqual(['-c', '1', '-t', '2', 'de.example.com']);
  });
});

describe('pingArgs with a host the panel should not send', () => {
  it('refuses anything ping could take as a flag', () => {
    expect(pingArgs('linux', '-f')).toBeNull();
    expect(pingArgs('win32', 'a b')).toBeNull();
  });
});

describe('answersOnUdp', () => {
  const ovpn = (proto: string) => ({ protocol: 'openvpn', name: 'o', link: 'openvpn://' + Buffer.from(`client\nproto ${proto}\nremote de.example.com 1194\n`).toString('base64url') });
  it('knows the servers a TCP connect cannot reach', () => {
    expect(answersOnUdp({ protocol: 'wireguard', name: 'w', link: 'wireguard://k@de.example.com:51820' })).toBe(true);
    expect(answersOnUdp({ protocol: 'hysteria2', name: 'h', link: 'hysteria2://p@de.example.com:443' })).toBe(true);
    expect(answersOnUdp({ protocol: 'l2tp', name: 'l', link: 'l2tp://u:p@de.example.com?psk=k' })).toBe(true);
    expect(answersOnUdp(ovpn('udp'))).toBe(true);
    expect(answersOnUdp(ovpn('tcp-client'))).toBe(false);
    expect(answersOnUdp({ protocol: 'vless', name: 'v', link: 'vless://id@de.example.com:443' })).toBe(false);
  });
});
