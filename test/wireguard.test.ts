import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  allowedIps,
  complement4,
  formatCidr4,
  geoipCidrs4,
  linkDns,
  parseCidr4,
  parseDump,
  privateRanges,
  wireguardConf,
  type Cidr4,
} from '../src/main/configs/wireguard';
import { proxyOutboundFor } from '../src/main/configs/xray';
import type { L2tpDriver, SystemKit } from '../src/main/os/kit';
import { Vpn } from '../src/main/vpn';
import { defaultSettings, type AppProfile, type Status } from '../src/shared/types';

const priv = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const pub = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const psk = 'FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE=';
const e = encodeURIComponent;
const link = `wireguard://${e(priv)}@wg.example.com:51820?address=10.66.66.2%2F32&publickey=${e(pub)}&presharedkey=${e(psk)}&keepalive=25&mtu=1380#de`;
const outbound = (l: string) => proxyOutboundFor({ protocol: 'wireguard', link: l });

describe('the WireGuard tunnel config', () => {
  it('carries the link, the resolved endpoint and the DNS', () => {
    const conf = wireguardConf(outbound(link), { dns: ['1.1.1.1', '8.8.8.8'], killSwitch: false, hosts: { 'wg.example.com': ['5.160.10.20'] } });
    expect(conf).toBe(
      [
        '[Interface]',
        `PrivateKey = ${priv}`,
        'Address = 10.66.66.2/32',
        'DNS = 1.1.1.1, 8.8.8.8',
        'MTU = 1380',
        '',
        '[Peer]',
        `PublicKey = ${pub}`,
        `PresharedKey = ${psk}`,
        'AllowedIPs = 0.0.0.0/1, 128.0.0.0/1, ::/1, 8000::/1',
        'Endpoint = 5.160.10.20:51820',
        'PersistentKeepalive = 25',
        '',
      ].join('\r\n'),
    );
  });

  it('leaves the MTU to the tunnel service when the link has none, and gives a bare address its prefix', () => {
    const bare = `wireguard://${e(priv)}@wg.example.com:51820?address=10.0.0.7&publickey=${e(pub)}`;
    const conf = wireguardConf(outbound(bare), { dns: ['1.1.1.1'], killSwitch: true }) as string;
    expect(conf).not.toContain('MTU');
    expect(conf).not.toContain('PresharedKey');
    expect(conf).toContain('Address = 10.0.0.7/32');
    expect(conf).toContain('Endpoint = wg.example.com:51820');
    expect(conf).toContain('AllowedIPs = 0.0.0.0/0, ::/0');
    expect(conf).toContain('PersistentKeepalive = 25');
  });

  it('refuses a link without an address', () => {
    expect(wireguardConf(outbound(`wireguard://${e(priv)}@wg.example.com:51820?publickey=${e(pub)}`), { dns: [], killSwitch: false })).toBeNull();
  });

  it('reads the DNS a link names', () => {
    expect(linkDns(`${link}&dns=1.0.0.1%2C9.9.9.9`)).toEqual(['1.0.0.1', '9.9.9.9']);
    expect(linkDns(link)).toEqual([]);
  });
});

const total = (list: Cidr4[]) => list.reduce((sum, c) => sum + 2 ** (32 - c.bits), 0);
const inside = (ip: string, c: Cidr4) => {
  const v = (parseCidr4(ip) as Cidr4).ip;
  return v >= c.ip && v < c.ip + 2 ** (32 - c.bits);
};

describe('Iran direct', () => {
  it('covers everything but the excluded ranges, exactly', () => {
    const excluded = ['10.0.0.0/8', '87.107.0.0/16', '5.160.0.0/14', '192.168.0.0/16'].map((r) => parseCidr4(r) as Cidr4);
    const rest = complement4(excluded);
    expect(total(rest)).toBe(2 ** 32 - total(excluded));
    expect(rest.some((c) => inside('5.160.10.20', c))).toBe(false);
    expect(rest.some((c) => inside('142.251.155.120', c))).toBe(true);
    expect(complement4([]).map(formatCidr4)).toEqual(['0.0.0.0/0']);
  });

  it('merges overlapping ranges and keeps the kill switch from making /0 routes', () => {
    const excluded = ['10.0.0.0/8', '10.1.0.0/16', ...privateRanges].map((r) => parseCidr4(r) as Cidr4);
    const ips = allowedIps({ killSwitch: true, direct: excluded });
    expect(ips).not.toContain('0.0.0.0/0');
    expect(ips).not.toContain('::/0');
    expect(ips.slice(-2)).toEqual(['::/1', '8000::/1']);
  });

  it("reads one country's IPv4 ranges from geoip.dat", () => {
    const varint = (n: number) => {
      const out: number[] = [];
      while (n >= 0x80) {
        out.push((n % 128) | 0x80);
        n = Math.floor(n / 128);
      }
      out.push(n);
      return Buffer.from(out);
    };
    const len = (field: number, body: Buffer) => Buffer.concat([varint(field * 8 + 2), varint(body.length), body]);
    const cidr = (ip: number[], prefix: number) => len(2, Buffer.concat([len(1, Buffer.from(ip)), varint(2 * 8), varint(prefix)]));
    const entry = (code: string, ...cidrs: Buffer[]) => len(1, Buffer.concat([len(1, Buffer.from(code)), ...cidrs]));
    const file = Buffer.concat([
      entry('US', cidr([8, 8, 8, 0], 24)),
      entry('IR', cidr([87, 107, 0, 0], 16), cidr([0x2a, 0x01, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 32), cidr([5, 160, 0, 0], 14)),
    ]);
    expect(geoipCidrs4(file, 'ir').map(formatCidr4)).toEqual(['87.107.0.0/16', '5.160.0.0/14']);
  });
});

describe('wg show dump', () => {
  it("reads the peer's handshake and counters", () => {
    const dump = [`${priv}\t${pub}\t0\toff`, `${pub}\t${psk}\t5.160.10.20:51820\t0.0.0.0/1,128.0.0.0/1\t1763600419\t9244\t3120\t25`].join('\n');
    expect(parseDump(dump)).toEqual({ handshake: 1763600419, rx: 9244, tx: 3120 });
    expect(parseDump(`${priv}\t${pub}\t0\toff\n${pub}\t(none)\t(none)\t0.0.0.0/0\t0\t0\t0\toff`)).toEqual({ handshake: 0, rx: 0, tx: 0 });
    expect(parseDump('')).toBeNull();
  });
});

// A disconnect or a new connect while a connection is still starting.
describe('an attempt that is overtaken', () => {
  const profile: AppProfile = {
    account: { username: 'u', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0 } as AppProfile['account'],
    locations: [],
    configs: [{ protocol: 'l2tp', name: 'l2tp', link: 'l2tp://u:p@vpn.example.com?ipsec=1&psk=k', locationId: 2 }],
  };

  function setup() {
    const calls: string[] = [];
    const pending: ((ok: boolean) => void)[] = [];
    const driver: L2tpDriver = {
      connect: () => new Promise((resolve) => pending.push((ok) => resolve({ ok }))),
      isUp: async () => true,
      disconnect: async () => {
        calls.push('disconnect');
      },
    };
    const kit = {
      os: 'windows',
      exe: (n: string) => `${n}.exe`,
      openvpnBinary: () => null,
      l2tp: driver,
      protectWebrtc: async () => ({}),
      restoreWebrtc: async () => undefined,
      applyZone: async () => null,
      restoreZone: async () => undefined,
    } as unknown as SystemKit;
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-vpn-'));
    const vpn = new Vpn({ bin: path.join(work, 'bin'), work }, kit);
    const statuses: Status[] = [];
    vpn.on('status', (s: Status) => statuses.push(s));
    return { vpn, calls, pending, statuses };
  }
  const settings = { ...defaultSettings, protocol: 'l2tp' as const };
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it('stops the connection that is starting, and it does not come up afterwards', async () => {
    const { vpn, calls, pending } = setup();
    const connecting = vpn.connect(profile, settings, 2);
    await tick();
    await vpn.disconnect();
    expect(calls).toContain('disconnect');
    pending[0](true);
    await connecting;
    expect(vpn.status().state).toBe('disconnected');
  });

  it("does not let the earlier attempt's failure end the newer one", async () => {
    const { vpn, pending } = setup();
    const first = vpn.connect(profile, settings, 2);
    await tick();
    const second = vpn.connect(profile, settings, 2);
    await tick();
    await tick();
    pending[0](false);
    await first;
    expect(vpn.status().state).toBe('connecting');
    pending[1](true);
    await second;
    expect(vpn.status().state).toBe('connected');
  });
});
