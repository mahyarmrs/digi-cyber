import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { allowedIps, iranDirectRanges, wireguardConf } from './configs/wireguard';
import { proxyOutboundFor } from './configs/xray';
import { run } from './system/run';
import { removeTunnel, tunnelInstalled, tunnelName, wireguardTools } from './wireguardWindows';

// CI on Windows: the packaged WireGuard engine takes the config the app writes, with Iran direct's
// full range list from the packaged geoip.dat, as a tunnel service, and the app removes it again.
// `Table = off` keeps the runner's own routes untouched. Usage: wireguard-check <packaged resources dir>
const resources = path.resolve(process.argv[2] ?? 'release/win-unpacked/resources');
const bin = path.join(resources, 'bin');
const log = (source: string, text: string) => console.log(`[${source}] ${text}`);

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const tools = wireguardTools(bin) ?? fail(`wireguard.exe and wg.exe are not in ${bin}\\wireguard`);
  const direct = iranDirectRanges(path.join(bin, 'geoip.dat')) ?? fail("Iran's ranges could not be read from the packaged geoip.dat");
  const expected = allowedIps({ killSwitch: false, direct }).length;
  log('check', `Iran direct: ${direct.length} ranges kept out, ${expected} allowed IPs`);

  const key = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
  const peer = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
  const link = `wireguard://${encodeURIComponent(key)}@127.0.0.1:51999?address=10.98.0.2%2F32&publickey=${encodeURIComponent(peer)}&keepalive=25`;
  const conf = wireguardConf(proxyOutboundFor({ protocol: 'wireguard', link }), { dns: [], killSwitch: false, direct }) ?? fail('no config');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-wg-'));
  const file = path.join(work, `${tunnelName}.conf`);
  fs.writeFileSync(file, conf.replace('[Interface]\r\n', '[Interface]\r\nTable = off\r\n'));

  await removeTunnel(tools, log);
  const started = Date.now();
  const install = await run(tools.wireguard, ['/installtunnelservice', file], 60_000);
  if (install.code !== 0) fail(`install: exit ${install.code}: ${install.stderr}${install.stdout}`);
  log('check', `tunnel service installed in ${Date.now() - started} ms`);

  let count = 0;
  for (let i = 0; i < 40 && count !== expected; i++) {
    const res = await run(tools.wg, ['show', tunnelName, 'allowed-ips'], 10_000);
    count = res.code === 0 ? res.stdout.trim().split(/\s+/).length - 1 : 0;
    if (count !== expected) await new Promise((r) => setTimeout(r, 500));
  }
  const dump = await run(tools.wireguard, ['/dumplog'], 10_000);
  for (const line of dump.stdout.split(/\r?\n/).filter((l) => l.includes(`[${tunnelName}]`)).slice(-15)) log('wireguard', line);
  if (count !== expected) {
    await removeTunnel(tools, log);
    fail(`the tunnel carries ${count} allowed IPs, expected ${expected}`);
  }
  log('check', `the tunnel carries all ${count} allowed IPs (${Date.now() - started} ms)`);

  await removeTunnel(tools, log);
  if (await tunnelInstalled()) fail('the tunnel service is still installed after removing it');
  log('check', 'tunnel service removed');
}

void main();
