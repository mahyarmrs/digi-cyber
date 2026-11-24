import fs from 'node:fs';
import path from 'node:path';

import { osOf } from '../shared/platform';
import { singboxTunConfig } from './configs/singbox';
import { proxyOutboundFor, xrayConfig } from './configs/xray';

// CI writes the configs the app would run and checks them with the bundled xray and sing-box.
const out = process.argv[2] ?? 'smoke';
fs.mkdirSync(out, { recursive: true });
const outbounds: Record<string, Record<string, unknown>> = {
  // The shape Manifold's link parser gives the app.
  vless: {
    protocol: 'vless',
    settings: { address: 'de.example.com', encryption: 'none', flow: '', id: '11111111-2222-4333-8444-555555555555', port: 443 },
    streamSettings: { network: 'tcp', security: 'tls', tlsSettings: { serverName: 'de.example.com' } },
  },
  wireguard: {
    protocol: 'wireguard',
    settings: {
      secretKey: 'cOFJbW0HSNNXo+dpvVBiNMGbWXfzKaw8tc+B+WWRjX0=',
      address: ['10.0.0.2/32'],
      peers: [{ publicKey: 'Sa1M9+7tF7y2jNcvHDb2EhHH9dsZdFWkU6P3RuPXamY=', endpoint: 'wg.example.com:51820', allowedIPs: ['0.0.0.0/0'] }],
    },
  },
};
// Plain VLESS to a public server (a relay), which Xray 26.7+ refuses unless carried (configs/xray.ts).
outbounds['vless-plain'] = {
  protocol: 'vless',
  settings: { address: 'relay.example.com', encryption: 'none', flow: '', id: '11111111-2222-4333-8444-555555555555', port: 8080 },
  streamSettings: { network: 'ws', security: 'none', wsSettings: { path: '/x', host: '', headers: {}, heartbeatPeriod: 0 } },
};
// WireGuard as the app builds it from the link, over the panel's outbound whose key lost its '+'.
const wgKey = 'cOFJbW0HSNNXo+dpvVBiNMGbWXfzKaw8tc+B+WWRjX0=';
outbounds['wireguard-link'] = proxyOutboundFor({
  protocol: 'wireguard',
  link: `wireguard://${encodeURIComponent(wgKey)}@wg.example.com:51820?address=10.0.0.2%2F32&publickey=${encodeURIComponent('Sa1M9+7tF7y2jNcvHDb2EhHH9dsZdFWkU6P3RuPXamY=')}&mtu=1420&keepalive=25`,
  outbound: { protocol: 'wireguard', settings: { secretKey: wgKey.replace(/\+/g, ' ') } },
});
for (const [name, outbound] of Object.entries(outbounds)) {
  const hosts = name === 'vless' ? { 'de.example.com': ['203.0.113.7'] } : undefined;
  fs.writeFileSync(path.join(out, `xray-${name}.json`), JSON.stringify(xrayConfig(outbound, { socksPort: 20808, httpPort: 20809, iranDirect: true, adBlock: true, dns: ['9.9.9.9'], hosts }), null, 2));
}
const os = osOf(process.platform);
const tun = singboxTunConfig({ os, interfaceName: os === 'linux' ? 'digicyber0' : os === 'windows' ? 'Digi Cyber' : undefined, socksPort: 20808, strictRoute: true, dns: '9.9.9.9', bypassApps: [os === 'windows' ? 'steam.exe' : 'steam'] });
fs.writeFileSync(path.join(out, 'tun.json'), JSON.stringify(tun, null, 2));
console.log(`wrote configs to ${out}`);
