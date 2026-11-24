import fs from 'node:fs';
import path from 'node:path';

import type { Settings } from '../shared/types';
import type { Candidate } from './candidates';
import { iranDirectRanges, linkDns, parseDump, wireguardConf, type Cidr4, type PeerState } from './configs/wireguard';
import { dnsServers, proxyOutboundFor, serverNames } from './configs/xray';
import { probeDirect } from './health';
import type { LogFn } from './log';
import { resolveNames } from './resolve';
import { run } from './system/run';

// WireGuard on Windows runs on the official engine: WireGuard for Windows' tunnel service over the
// WireGuardNT driver, the one the official app uses (`wireguard.exe /installtunnelservice`). The app
// writes the tunnel's config, installs the service, waits for the handshake and the test page,
// and removes the service when it disconnects.

// The tunnel's name: the config file's name, the service's (WireGuardTunnel$DigiCyber) and the adapter's.
export const tunnelName = 'DigiCyber';
export const tunnelService = `WireGuardTunnel$${tunnelName}`;

const handshakeWaitMs = 15_000;
const probeMs = 12_000;
const watchMs = 5_000;

export interface WireguardTools {
  wireguard: string;
  wg: string;
}

export function wireguardTools(bin: string): WireguardTools | null {
  const dir = path.join(bin, 'wireguard');
  const tools = { wireguard: path.join(dir, 'wireguard.exe'), wg: path.join(dir, 'wg.exe') };
  return fs.existsSync(tools.wireguard) && fs.existsSync(tools.wg) ? tools : null;
}

export async function tunnelInstalled(): Promise<boolean> {
  const res = await run('sc.exe', ['query', tunnelService], 10_000);
  return res.code === 0 && /SERVICE_NAME/i.test(res.stdout);
}

async function tunnelRunning(): Promise<boolean> {
  const res = await run('sc.exe', ['query', tunnelService], 10_000);
  return res.code === 0 && /RUNNING/.test(res.stdout);
}

// Removes the tunnel's service, if there is one; the adapter, its routes and firewall rules go with it.
export async function removeTunnel(tools: WireguardTools, log?: LogFn): Promise<void> {
  if (!(await tunnelInstalled())) return;
  const res = await run(tools.wireguard, ['/uninstalltunnelservice', tunnelName], 30_000);
  if (res.code !== 0) log?.('vpn', `removing the WireGuard tunnel failed: ${(res.stderr || res.stdout).trim()}`);
  // The service manager can take a moment to forget a deleted service.
  for (let i = 0; i < 15 && (await tunnelInstalled()); i++) await new Promise((r) => setTimeout(r, 300));
}

export async function peerState(tools: WireguardTools): Promise<PeerState | null> {
  const res = await run(tools.wg, ['show', tunnelName, 'dump'], 5_000);
  return res.code === 0 ? parseDump(res.stdout) : null;
}

// The tunnel service's own log lines for this tunnel, the newest last.
export async function tunnelLog(tools: WireguardTools, max = 40): Promise<string[]> {
  const res = await run(tools.wireguard, ['/dumplog'], 10_000);
  if (res.code !== 0) return [];
  return res.stdout
    .split(/\r?\n/)
    .filter((line) => line.includes(`[${tunnelName}]`))
    .slice(-max);
}

export class WireguardWindowsConnection {
  readonly engine = 'xray' as const;
  private lost: ((blocking: boolean) => void) | null = null;
  private watch: NodeJS.Timeout | null = null;
  private stopped = false;
  private stopping: Promise<void> | null = null;
  private readonly confFile: string;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly tools: WireguardTools,
    private readonly bin: string,
    work: string,
    private readonly log: LogFn,
  ) {
    this.confFile = path.join(work, `${tunnelName}.conf`);
  }

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const outbound = proxyOutboundFor(this.candidate.config);
    const names = serverNames(outbound);
    const hosts = await resolveNames(names);
    for (const name of names) this.log('vpn', hosts[name] ? `${name} is ${hosts[name].join(', ')}` : `${name} did not resolve; WireGuard will try it itself`);

    let direct: Cidr4[] | null = null;
    if (this.settings.iranDirect) {
      direct = iranDirectRanges(path.join(this.bin, 'geoip.dat'));
      if (!direct) this.log('vpn', "Iran's address list could not be read; all traffic goes through the tunnel");
    }
    if (direct && this.settings.killSwitch) this.log('vpn', 'Iran direct is on, so the kill switch does not block traffic outside the tunnel');
    const fromLink = linkDns(this.candidate.config.link);
    const dns = this.settings.dns.trim() !== '' || fromLink.length === 0 ? dnsServers(this.settings.dns) : fromLink;
    const confFor = (withDirect: Cidr4[] | null) => wireguardConf(outbound, { dns, killSwitch: this.settings.killSwitch, direct: withDirect ?? undefined, hosts });
    const conf = confFor(direct);
    if (!conf) {
      this.log('vpn', 'this WireGuard link lacks a key, an address or a server');
      return false;
    }
    let result = await this.up(conf);
    // Iran direct is thousands of routes; should the tunnel not take them, it runs without.
    if (direct && (result === 'install' || result === 'answer') && !this.stopped) {
      this.log('vpn', 'trying again with all traffic in the tunnel (without Iran direct)');
      result = await this.up(confFor(null) as string);
    }
    if (result === 'ok') {
      this.watch = setInterval(() => void this.check(), watchMs);
      return true;
    }
    if (this.stopped) await this.abandon();
    return false;
  }

  // One run of the tunnel with this config; anything but 'ok' leaves no tunnel behind.
  private async up(conf: string): Promise<'ok' | 'install' | 'handshake' | 'answer' | 'stopped'> {
    if (this.stopped) return 'stopped';
    // A tunnel left by a run that ended without disconnecting, or by the previous try.
    await removeTunnel(this.tools, this.log);
    fs.writeFileSync(this.confFile, conf, { mode: 0o600 });
    const started = Date.now();
    const install = await run(this.tools.wireguard, ['/installtunnelservice', this.confFile], 60_000);
    if (install.code !== 0) {
      this.log('vpn', `the WireGuard tunnel service did not start: ${(install.stderr || install.stdout).trim() || `exit ${install.code}`}`);
      await this.fail();
      return 'install';
    }
    // Installed to start with Windows; the app starts it itself, so a tunnel never outlives the app.
    void run('sc.exe', ['config', tunnelService, 'start=', 'demand'], 10_000);
    if (this.stopped) return 'stopped';
    this.log('vpn', `WireGuard tunnel service started (${Date.now() - started} ms)`);

    let state: PeerState | null = null;
    while (!this.stopped && Date.now() - started < handshakeWaitMs) {
      state = await peerState(this.tools);
      if (state && state.handshake > 0) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    if (this.stopped) return 'stopped';
    if (!state || state.handshake === 0) {
      this.log('vpn', `no WireGuard handshake with the server in ${Math.round(handshakeWaitMs / 1000)} s`);
      await this.fail();
      return 'handshake';
    }
    this.log('vpn', `WireGuard handshake in ${Date.now() - started} ms`);

    const probeStarted = Date.now();
    const ok = await probeDirect(probeMs);
    if (this.stopped) return 'stopped';
    if (!ok) {
      this.log('vpn', `no answer through this config (test page http://google.com/generate_204, ${Date.now() - probeStarted} ms)`);
      await this.fail();
      return 'answer';
    }
    this.log('vpn', `the test page answered through it in ${Date.now() - probeStarted} ms`);
    return 'ok';
  }

  // Disconnected while connecting: stop() may have run before the service existed.
  private async abandon(): Promise<void> {
    await this.stopping;
    await this.teardown();
  }

  private async fail(): Promise<void> {
    for (const line of await tunnelLog(this.tools)) this.log('wireguard', line);
    await this.teardown();
  }

  private async teardown(): Promise<void> {
    await removeTunnel(this.tools, this.log);
    fs.rmSync(this.confFile, { force: true });
  }

  private async check(): Promise<void> {
    if (this.stopped || (await tunnelRunning()) || this.stopped) return;
    this.log('vpn', 'the WireGuard tunnel service stopped');
    for (const line of await tunnelLog(this.tools, 15)) this.log('wireguard', line);
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    await this.stop();
    this.lost?.(false);
  }

  stop(): Promise<void> {
    this.stopped = true;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    this.stopping ??= this.teardown();
    return this.stopping;
  }
}
