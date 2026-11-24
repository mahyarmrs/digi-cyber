import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { useOs } from '../shared/engines';
import { defaultSettings, type AppProfile } from '../shared/types';
import { windowsKit } from './os/windows';
import { prepareOpenvpnAdapters } from './system/openvpnAdapters';
import { run } from './system/run';
import { Vpn } from './vpn';

// CI on Windows: the app connects to an OpenVPN server on the same machine the way it connects to
// Manifold's (tls-crypt, a login and no client certificate), once on the ovpn-dco adapter it adds and
// once on its TAP one. Usage: openvpn-check <packaged resources dir> <dir with ca.crt, server.crt, server.key>
const resources = path.resolve(process.argv[2] ?? 'release/win-unpacked/resources');
const pki = path.resolve(process.argv[3] ?? '.');
const bin = path.join(resources, 'bin');
const openvpn = path.join(bin, 'openvpn', 'openvpn.exe');
const tapctl = path.join(bin, 'openvpn', 'tapctl.exe');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-ovpn-'));
const log = (source: string, text: string) => console.log(`[${source}] ${text}`);
const serverAdapter = 'Digi Cyber test server';
const port = 11940;
const managementPort = 7690;

function startServer(tc: string): ChildProcess {
  const args = [
    '--dev', 'tun', '--dev-node', serverAdapter, '--windows-driver', 'tap-windows6', '--disable-dco',
    '--proto', 'udp4', '--port', String(port), '--server', '10.89.0.0', '255.255.255.0', '--topology', 'subnet',
    '--ca', path.join(pki, 'ca.crt'), '--cert', path.join(pki, 'server.crt'), '--key', path.join(pki, 'server.key'), '--dh', 'none',
    '--tls-crypt', tc, '--tls-version-min', '1.2', '--verify-client-cert', 'none', '--username-as-common-name', '--duplicate-cn',
    '--data-ciphers', 'AES-128-GCM:AES-256-GCM:CHACHA20-POLY1305',
    '--management', '127.0.0.1', String(managementPort), '--management-client-auth', '--keepalive', '2', '10', '--verb', '3',
  ];
  const server = spawn(openvpn, args, { windowsHide: true });
  const out = fs.createWriteStream(path.join(work, 'server.log'));
  server.stdout.pipe(out);
  server.stderr.pipe(out);
  return server;
}

// Sessions the server has closed, from its management port. OpenVPN 2.6 closes a session five seconds
// after its exit notification; without one it waits for its own timeout, 20 s here. One closed within
// 9 s of the app's disconnect proves the notification arrived.
let closedSessions = 0;

// Manifold checks the login through the management port; this one lets everyone in.
function approveClients(): void {
  const attempt = () => {
    const socket = net.connect({ host: '127.0.0.1', port: managementPort });
    let buffered = '';
    socket.on('data', (d) => {
      buffered += d.toString();
      let at: number;
      while ((at = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, at).trim();
        buffered = buffered.slice(at + 1);
        const m = /^>CLIENT:(?:CONNECT|REAUTH),(\d+),(\d+)/.exec(line);
        if (m) socket.write(`client-auth-nt ${m[1]} ${m[2]}\n`);
        if (/^>CLIENT:DISCONNECT,/.test(line)) closedSessions++;
      }
    });
    socket.on('error', () => setTimeout(attempt, 500));
  };
  attempt();
}

function profileText(tc: string, extra = ''): string {
  return [
    '# Digi Cyber CI', 'client', 'dev tun', 'proto udp', `remote 127.0.0.1 ${port}`, 'resolv-retry infinite', 'nobind', 'persist-key', 'persist-tun',
    'remote-cert-tls server', 'verify-x509-name manifold-openvpn-server name', 'data-ciphers AES-128-GCM:AES-256-GCM:CHACHA20-POLY1305',
    'ignore-unknown-option block-outside-dns', 'setenv opt block-outside-dns', 'setenv CLIENT_CERT 0', 'verb 3', extra,
    '<auth-user-pass>', 'ci-user', 'pa ss"w\\rd', '</auth-user-pass>',
    '<ca>', fs.readFileSync(path.join(pki, 'ca.crt'), 'utf8').trim(), '</ca>',
    '<tls-crypt>', fs.readFileSync(tc, 'utf8').trim(), '</tls-crypt>', '',
  ].join('\n');
}

async function connectOnce(label: string, text: string): Promise<boolean> {
  const lines: string[] = [];
  const vpn = new Vpn({ bin, work }, windowsKit, (source, line) => {
    lines.push(line);
    log(`${label} ${source}`, line);
  });
  const profile: AppProfile = {
    account: { username: 'ci-user', enabled: true, expiryTime: 0, upload: 0, download: 0, total: 0, deviceLimit: 0, devices: 0 },
    locations: [{ id: 1, name: 'Test', countryCode: 'DE', city: '', timezone: '' }],
    configs: [{ protocol: 'openvpn', name: 'ci', link: `openvpn://${Buffer.from(text).toString('base64url')}`, locationId: 1 }],
  };
  const status = await vpn.connect(profile, { ...defaultSettings, protocol: 'openvpn', webrtcProtection: false, timezoneSpoof: false }, 1);
  const opened = lines.find((l) => / device \[.*\] opened/.test(l));
  let ok = status.state === 'connected';
  if (ok) {
    await new Promise((r) => setTimeout(r, 3000));
    const ip = await run('powershell.exe', ['-NoProfile', '-Command', "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '10.89.0.*' } | ForEach-Object { \"$($_.InterfaceAlias) $($_.IPAddress)\" }"]);
    log(label, `tunnel addresses: ${ip.stdout.trim().replace(/\r?\n/g, '; ')}`);
    ok = /10\.89\.0\.(?!1\b)\d+/.test(ip.stdout);
  }
  log(label, `${ok ? 'PASS' : 'FAIL'}: ${status.state}${status.error ? ` (${status.error})` : ''}; ${opened ?? 'no adapter opened'}`);
  if (label === 'dco' && ok && !/ovpn-dco/i.test(opened ?? '')) console.log('::warning::OpenVPN fell back from ovpn-dco to TAP on this Windows');
  const closedBefore = closedSessions;
  const started = Date.now();
  await vpn.disconnect();
  if (ok) {
    const deadline = started + 9000;
    while (closedSessions === closedBefore && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    const left = closedSessions > closedBefore;
    log(label, `${left ? 'PASS' : 'FAIL'}: ${left ? `the server closed the session ${Date.now() - started} ms after the disconnect` : 'the server still held the session 9 s after the disconnect (no exit notification)'}`);
    ok = left;
  }
  return ok;
}

void (async () => {
  useOs('windows');
  const tc = path.join(work, 'tc.key');
  const gen = await run(openvpn, ['--genkey', 'tls-crypt', tc]);
  if (gen.code !== 0) throw new Error(`genkey: ${gen.stderr}`);
  const dco = await prepareOpenvpnAdapters(bin, log);
  console.log(`DCO adapter: ${dco}`);
  console.log((await run(tapctl, ['list'])).stdout);
  const made = await run(tapctl, ['create', '--hwid', 'root\\tap0901', '--name', serverAdapter], 120_000);
  if (made.code !== 0) throw new Error(`server adapter: ${made.stdout}${made.stderr}`);
  const server = startServer(tc);
  approveClients();
  await new Promise((r) => setTimeout(r, 3000));
  let ok = true;
  try {
    if (dco) ok = (await connectOnce('dco', profileText(tc))) && ok;
    else console.log('no DCO adapter on this Windows: only TAP is checked');
    ok = (await connectOnce('tap', profileText(tc, 'disable-dco'))) && ok;
  } finally {
    server.kill();
    await run(tapctl, ['delete', serverAdapter]);
    console.log('--- server log ---');
    console.log(fs.readFileSync(path.join(work, 'server.log'), 'utf8').split('\n').slice(-40).join('\n'));
  }
  process.exit(ok ? 0 : 1);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
