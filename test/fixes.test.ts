import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { ApiError, AppApi, type ReportBody } from '../src/main/api';
import { carrierAddress, proxyOutboundFor, serverNames, wireguardOutbound, xrayConfig } from '../src/main/configs/xray';
import { SessionLog, tail } from '../src/main/log';
import { resolveNames } from '../src/main/resolve';
import { dcoDriverDir, parseTapctlList, windowsBuild } from '../src/main/system/openvpnAdapters';
import { linkSecrets, redact } from '../src/shared/redact';

// Keys with '+' and '/', which a decode too many turns into spaces.
const priv = 'cOFJbW0HSNNXo+dpvVBiNMGbWXfzKaw8tc+B+WWRjX0=';
const pub = 'Sa1M9+7tF7y2jNcvHDb2EhHH9dsZdFWkU6P3RuPXamY=';
const psk = 'FpCyhws9cxwWoV4xELtfJvjJN+zQVRPISllRWgeopVE=';
// As Manifold's genWireguardLink writes it: QueryEscape'd userinfo, url.Values query.
const wgLink = `wireguard://${encodeURIComponent(priv)}@wg.example.com:51820?address=10.66.66.2%2F32&keepalive=25&mtu=1420&presharedkey=${encodeURIComponent(psk)}&publickey=${encodeURIComponent(pub)}#wg-de`;
// What Manifold's app API hands over for it today: the key read twice, its '+' turned into spaces.
const panelOutbound = {
  protocol: 'wireguard',
  settings: { secretKey: priv.replace(/\+/g, ' '), address: ['10.66.66.2/32'], mtu: 1420, peers: [{ publicKey: pub, endpoint: 'wg.example.com:51820', allowedIPs: ['0.0.0.0/0', '::/0'], preSharedKey: psk, keepAlive: 25 }] },
};

describe('WireGuard outbound', () => {
  it('is built from the link with the keys intact', () => {
    const ob = wireguardOutbound(wgLink, panelOutbound) as { settings: Record<string, unknown> & { peers: Record<string, unknown>[] } };
    expect(ob.settings.secretKey).toBe(priv);
    expect(ob.settings.peers[0]).toEqual({ publicKey: pub, endpoint: 'wg.example.com:51820', allowedIPs: ['0.0.0.0/0', '::/0'], preSharedKey: psk, keepAlive: 25 });
    expect(ob.settings.address).toEqual(['10.66.66.2/32']);
    expect(ob.settings.mtu).toBe(1420);
    expect(ob.settings.noKernelTun).toBe(true);
    expect(ob.settings.domainStrategy).toBe('ForceIPv4');
  });

  it('reads a link whose query keeps a raw +', () => {
    const raw = `wireguard://${priv}@[2001:db8::1]:51820?publickey=${pub}&address=10.0.0.2/32,fd00::2/128`;
    const ob = wireguardOutbound(raw) as { settings: Record<string, unknown> & { peers: Record<string, unknown>[] } };
    expect(ob.settings.secretKey).toBe(priv);
    expect(ob.settings.peers[0].publicKey).toBe(pub);
    expect(ob.settings.peers[0].endpoint).toBe('[2001:db8::1]:51820');
    expect(ob.settings.domainStrategy).toBe('ForceIP');
  });

  it('repairs the panel outbound when the link has no usable key', () => {
    const ob = proxyOutboundFor({ protocol: 'wireguard', link: 'wireguard://@wg.example.com:51820', outbound: panelOutbound }) as { settings: { secretKey: string } };
    expect(ob.settings.secretKey).toBe(priv);
  });

  it('leaves other protocols as the panel wrote them', () => {
    const vless = { protocol: 'vless', settings: { address: 'de.example.com', port: 443 } };
    const ob = proxyOutboundFor({ protocol: 'vless', link: 'vless://x@de.example.com:443', outbound: vless });
    expect(ob).toEqual(vless);
    expect(ob).not.toBe(vless);
  });
});

describe('server names', () => {
  it('finds every server name an outbound dials, leaving addresses out', () => {
    expect(serverNames({ protocol: 'vless', settings: { address: 'de.example.com', port: 443 } })).toEqual(['de.example.com']);
    expect(serverNames({ protocol: 'vmess', settings: { vnext: [{ address: 'vm.example.com' }, { address: '1.2.3.4' }] } })).toEqual(['vm.example.com']);
    expect(serverNames({ protocol: 'trojan', settings: { servers: [{ address: 'tj.example.com' }] } })).toEqual(['tj.example.com']);
    expect(serverNames(wireguardOutbound(wgLink)!)).toEqual(['wg.example.com']);
    expect(serverNames({ protocol: 'wireguard', settings: { peers: [{ endpoint: '[2001:db8::1]:51820' }] } })).toEqual([]);
  });

  it('puts the resolved addresses in Xray hosts, so it never asks its own tunnel', () => {
    const cfg = xrayConfig({ protocol: 'vless', settings: { address: 'de.example.com', port: 443 }, streamSettings: { security: 'tls' } }, { socksPort: 1, httpPort: 2, iranDirect: false, hosts: { 'de.example.com': ['203.0.113.7'] } }) as {
      dns: { hosts: Record<string, unknown>; queryStrategy: string };
    };
    expect(cfg.dns.hosts).toEqual({ 'full:de.example.com': '203.0.113.7' });
    expect(cfg.dns.queryStrategy).toBe('UseIPv4');
  });

  it('resolves with the system before connecting and skips names that do not resolve', async () => {
    const lookup = (async (name: string) => {
      if (name === 'v4.example.com') return [{ address: '2001:db8::7', family: 6 }, { address: '203.0.113.7', family: 4 }];
      if (name === 'v6.example.com') return [{ address: '2001:db8::8', family: 6 }];
      throw new Error('ENOTFOUND');
    }) as unknown as typeof import('node:dns').promises.lookup;
    expect(await resolveNames(['v4.example.com', 'v6.example.com', 'none.example.com'], 1000, lookup)).toEqual({ 'v4.example.com': ['203.0.113.7'], 'v6.example.com': ['2001:db8::8'] });
  });
});

describe('VLESS and Trojan without TLS', () => {
  it('reach a public server through a freedom outbound, since Xray 26.7 refuses them otherwise', () => {
    const plain = { protocol: 'vless', settings: { address: 'ir.example.com', port: 8080, id: 'u', encryption: 'none', flow: '' }, streamSettings: { network: 'ws', security: 'none', wsSettings: { path: '/x', host: '' } } };
    const cfg = xrayConfig(plain, { socksPort: 1, httpPort: 2, iranDirect: false }) as { outbounds: Record<string, unknown>[] };
    const proxy = cfg.outbounds[0] as { settings: { address: string }; streamSettings: { sockopt: { dialerProxy: string }; wsSettings: { host: string } } };
    expect(proxy.settings.address).toBe(carrierAddress);
    expect(proxy.streamSettings.sockopt.dialerProxy).toBe('carrier');
    expect(proxy.streamSettings.wsSettings.host).toBe('ir.example.com');
    expect(cfg.outbounds.find((o) => o.tag === 'carrier')).toEqual({ tag: 'carrier', protocol: 'freedom', settings: { redirect: 'ir.example.com:8080' }, streamSettings: { sockopt: { domainStrategy: 'UseIPv4' } } });
    expect(plain.settings.address).toBe('ir.example.com');
  });

  it('leaves TLS, REALITY, encrypted VLESS and private servers alone', () => {
    for (const ob of [
      { protocol: 'vless', settings: { address: 'a.example.com', port: 443 }, streamSettings: { security: 'tls' } },
      { protocol: 'vless', settings: { address: 'a.example.com', port: 443 }, streamSettings: { security: 'reality' } },
      { protocol: 'vless', settings: { address: 'a.example.com', port: 443, encryption: 'mlkem768x25519plus.native.0rtt.x' }, streamSettings: { security: 'none' } },
      { protocol: 'trojan', settings: { servers: [{ address: '192.168.1.5', port: 443 }] }, streamSettings: { security: 'none' } },
    ]) {
      const cfg = xrayConfig(ob, { socksPort: 1, httpPort: 2, iranDirect: false }) as { outbounds: Record<string, unknown>[] };
      expect(cfg.outbounds.some((o) => o.tag === 'carrier')).toBe(false);
    }
  });
});

describe('session log', () => {
  it('keeps links, ids, keys, passwords and tokens out of what it records', () => {
    const log = new SessionLog();
    log.secret(...linkSecrets('https://sub.example.com:2096/sub/abcdef123456'), 'tok-123456789');
    log.write('app', 'GET https://sub.example.com:2096/sub/abcdef123456/app/v1/profile with Bearer tok-123456789');
    log.write('xray', `vless://11111111-2222-4333-8444-555555555555@de.example.com:443 key ${priv} password=hunter22`);
    log.write('openvpn', "PUSH: Received control message: 'PUSH_REPLY,route-gateway 10.8.0.1,auth-token SESS_ID_AT_x1y2,peer-id 0'");
    const text = log.text();
    for (const secret of ['abcdef123456', 'tok-123456789', '11111111-2222', priv, 'hunter22', 'SESS_ID_AT_x1y2']) expect(text).not.toContain(secret);
    expect(text).toContain('sub.example.com');
    expect(text).toContain('[openvpn]');
  });

  it('redacts lines written before a secret was known', () => {
    const log = new SessionLog();
    log.write('app', 'token is abcdefgh-secret');
    log.secret('abcdefgh-secret');
    expect(log.text()).not.toContain('abcdefgh-secret');
  });

  it('keeps the newest lines within its size', () => {
    const log = new SessionLog(2000);
    for (let i = 0; i < 200; i++) log.write('app', `line ${i}`);
    expect(log.text()).toContain('line 199');
    expect(log.text()).not.toContain('line 0\n');
    expect(log.text().length).toBeLessThanOrEqual(2100);
    expect(tail('a\nb\nc\nd\n', 4)).toMatch(/d\n$/);
  });

  it('leaves the username and server addresses in', () => {
    expect(redact('signed in as dana@example.com to 203.0.113.7:443')).toBe('signed in as dana@example.com to 203.0.113.7:443');
  });
});

describe('Windows OpenVPN adapters', () => {
  it('reads tapctl list', () => {
    expect(parseTapctlList('{0E5A2B13-6B8F-4D2C-9C1E-3F7A2B1C4D5E}\tDigi Cyber TAP\r\n{11111111-2222-3333-4444-555555555555}\tOpenVPN Data Channel Offload\r\n')).toEqual([
      { guid: '{0E5A2B13-6B8F-4D2C-9C1E-3F7A2B1C4D5E}', name: 'Digi Cyber TAP' },
      { guid: '{11111111-2222-3333-4444-555555555555}', name: 'OpenVPN Data Channel Offload' },
    ]);
    expect(parseTapctlList('')).toEqual([]);
  });

  it('picks the ovpn-dco build for the Windows version', () => {
    expect(windowsBuild('10.0.19045')).toBe(19045);
    expect(dcoDriverDir('C:\\o', 22631)).toMatch(/dco-win11$/);
    expect(dcoDriverDir('C:\\o', 19045)).toMatch(/dco-win10$/);
  });
});

describe('support report', () => {
  const body: ReportBody = { message: 'no connect', log: 'line 1\nline 2', deviceId: 'd1', deviceName: 'pc', os: 'windows', osVersion: '10', appVersion: '1.1.0' };

  it('posts the log gzipped with the session and returns the report number', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 42 }), { status: 200 });
    }) as unknown as typeof fetch;
    const id = await new AppApi('https://s.example.com/sub/x/app/v1', 'DigiCyber/1.1.0', fetchImpl).report('tok', body);
    expect(id).toBe('42');
    expect(seen!.url).toBe('https://s.example.com/sub/x/app/v1/report');
    const headers = seen!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(Buffer.from(seen!.init.body as Uint8Array)).toString())).toEqual(body);
  });

  it('says so when the panel has no report endpoint yet', async () => {
    for (const reply of [new Response('404 page not found', { status: 404 }), new Response('<html>sub page</html>', { status: 200 })]) {
      const fetchImpl = (async () => reply) as unknown as typeof fetch;
      await expect(new AppApi('https://s/sub/x/app/v1', 'ua', fetchImpl).report('tok', body)).rejects.toEqual(new ApiError('report_unsupported', reply.status));
    }
  });
});
