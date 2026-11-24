import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { AppProfile, Engine, Settings, Status } from '../shared/types';
import { candidates, type Candidate } from './candidates';
import { l2tpAccount } from './configs/l2tp';
import { openvpnArgs, openvpnProfile, openvpnPushedAddress, openvpnUdp, unsafeOpenvpnDirective } from './configs/openvpn';
import { singboxTunConfig } from './configs/singbox';
import { dnsServers, proxyOutboundFor, serverNames, xrayConfig } from './configs/xray';
import { EngineProcess, waitForLine } from './engines/process';
import { freePort, probeThroughProxy, waitForPort } from './health';
import type { LogFn } from './log';
import type { L2tpDriver, SystemKit } from './os/kit';
import { resolveNames } from './resolve';
import { removeTunnel, WireguardWindowsConnection, wireguardTools } from './wireguardWindows';

export interface VpnPaths {
  bin: string;
  work: string;
}

export interface Connection {
  readonly engine: Engine;
  // The tunnel address the server gave this device, where the engine reports one (OpenVPN).
  readonly address?: string;
  start(): Promise<boolean>;
  stop(): Promise<void>;
  // Called once if the connection drops by itself; blocking means traffic stays held back.
  onLost(cb: (blocking: boolean) => void): void;
}

function writePrivate(file: string, content: string): void {
  fs.writeFileSync(file, content, { mode: 0o600 });
}

// An engine's output goes to the session log under its name, and its exit is noted there.
function logged(proc: EngineProcess, log: LogFn): EngineProcess {
  proc.on('line', (line: string) => log(proc.name, line));
  proc.on('exit', ({ code, expected }: { code: number | null; expected: boolean }) => log('vpn', `${proc.name} exited (code ${code ?? 'none'}${expected ? ', stopped by the app' : ''})`));
  return proc;
}

class XrayConnection implements Connection {
  readonly engine = 'xray' as const;
  private xray: EngineProcess | null = null;
  private tun: EngineProcess | null = null;
  private lost: ((blocking: boolean) => void) | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const socksPort = await freePort();
    const httpPort = await freePort();
    const xrayFile = path.join(this.paths.work, 'xray.json');
    const outbound = proxyOutboundFor(this.candidate.config);
    const dns = dnsServers(this.settings.dns);
    // Resolved now, while the system's resolver still answers outside any tunnel.
    const names = serverNames(outbound);
    const hosts = await resolveNames(names);
    for (const name of names) this.log('vpn', hosts[name] ? `${name} is ${hosts[name].join(', ')}` : `${name} did not resolve; Xray will try it itself`);
    const options = { socksPort, httpPort, iranDirect: this.settings.iranDirect, adBlock: this.settings.adBlock, dns, hosts };
    const xrayExe = path.join(this.paths.bin, this.kit.exe('xray'));
    const startXray = async (logLevel: 'info' | 'warning') => {
      writePrivate(xrayFile, JSON.stringify(xrayConfig(outbound, { ...options, logLevel }), null, 2));
      const proc = logged(new EngineProcess('xray', xrayExe, ['run', '-c', xrayFile], path.join(this.paths.work, 'xray.log'), this.paths.bin), this.log);
      this.xray = proc;
      proc.start();
      const ready = await waitForPort(socksPort, 8000, () => proc.alive);
      if (!ready) this.log('vpn', proc.alive ? 'Xray did not open its local port in 8 s' : 'Xray stopped before it was ready (its error is above)');
      return ready ? proc : null;
    };
    // Tested with Xray's detailed log, which then shows only the test page's connection.
    if (!(await startXray('info'))) {
      await this.stop();
      return false;
    }
    const started = Date.now();
    if (!(await probeThroughProxy(httpPort, 12_000))) {
      this.log('vpn', `no answer through this config (test page https://www.gstatic.com/generate_204, ${Date.now() - started} ms)`);
      await this.stop();
      return false;
    }
    this.log('vpn', `the test page answered through it in ${Date.now() - started} ms`);
    // Run again with the short log before the user's traffic goes through it.
    await this.xray?.stop();
    const xray = await startXray('warning');
    if (!xray) {
      await this.stop();
      return false;
    }

    const tunFile = path.join(this.paths.work, 'tun.json');
    const bypassApps = this.settings.splitTunneling ? this.settings.splitApps.map((a) => a.name) : [];
    const tunConfig = singboxTunConfig({ os: this.kit.os, interfaceName: this.kit.tunName, socksPort, strictRoute: this.settings.killSwitch, dns: dns[0], bypassApps });
    writePrivate(tunFile, JSON.stringify(tunConfig, null, 2));
    const tun = logged(
      new EngineProcess('sing-box', path.join(this.paths.bin, this.kit.exe('sing-box')), ['run', '-c', tunFile, '-D', this.paths.work], path.join(this.paths.work, 'sing-box.log'), this.paths.bin),
      this.log,
    );
    this.tun = tun;
    tun.start();
    await new Promise((r) => setTimeout(r, 2500));
    if (!tun.alive) {
      this.log('vpn', 'the system tunnel (sing-box) stopped while starting (its error is above)');
      await this.stop();
      return false;
    }
    xray.on('exit', ({ expected }: { expected: boolean }) => {
      if (expected) return;
      // With the kill switch the tunnel stays up with nothing behind it, so nothing leaks.
      const blocking = this.settings.killSwitch && tun.alive;
      if (!blocking) void tun.stop();
      this.lost?.(blocking);
    });
    tun.on('exit', ({ expected }: { expected: boolean }) => {
      if (expected) return;
      void xray.stop();
      this.lost?.(false);
    });
    return true;
  }

  async stop(): Promise<void> {
    await this.tun?.stop();
    await this.xray?.stop();
  }
}

// The exit notification takes about a second (openvpnExitNotify); more is a stuck OpenVPN.
const openvpnExitGraceMs = 5000;

class OpenvpnConnection implements Connection {
  readonly engine = 'openvpn' as const;
  private proc: EngineProcess | null = null;
  private managementPort = 0;
  private udp = true;
  address: string | undefined;
  private lost: ((blocking: boolean) => void) | null = null;

  constructor(
    private readonly candidate: Candidate,
    private readonly settings: Settings,
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    const exe = this.kit.openvpnBinary(this.paths.bin);
    if (!exe) throw new Error('engine_missing:openvpn');
    let profile: string;
    try {
      profile = openvpnProfile(this.candidate.config.link);
    } catch {
      this.log('vpn', 'this OpenVPN link carries no profile');
      return false;
    }
    const unsafe = unsafeOpenvpnDirective(profile);
    if (unsafe) {
      this.log('vpn', `the profile has '${unsafe}', which the app does not run`);
      return false;
    }
    this.udp = openvpnUdp(profile);
    const profileFile = path.join(this.paths.work, 'profile.ovpn');
    writePrivate(profileFile, profile);
    // Windows: OpenVPN only opens an adapter that already exists, so the app makes its own first.
    const dco = (await this.kit.openvpnPrepare?.(this.paths.bin, this.log)) ?? false;
    let up = await this.run(exe, profileFile, false);
    // Data Channel Offload refuses some servers' settings; TAP takes any.
    if (!up.ok && dco && up.dcoTrouble && !up.authFailed) {
      this.log('vpn', 'trying again without Data Channel Offload (TAP adapter)');
      up = await this.run(exe, profileFile, true);
    }
    if (!up.ok) return false;
    await this.kit.openvpnUp(dnsServers(this.settings.dns));
    this.proc?.on('exit', ({ expected }: { expected: boolean }) => {
      if (!expected) this.lost?.(false);
    });
    return true;
  }

  private async run(exe: string, profileFile: string, disableDco: boolean): Promise<{ ok: boolean; dcoTrouble: boolean; authFailed: boolean }> {
    this.managementPort = await freePort();
    const proc = logged(
      new EngineProcess('openvpn', exe, openvpnArgs(profileFile, this.managementPort, this.kit.os, { disableDco, udp: this.udp }), path.join(this.paths.work, 'openvpn.log'), path.dirname(exe)),
      this.log,
    );
    this.proc = proc;
    let dcoTrouble = false;
    let authFailed = false;
    let fatal = false;
    const watch = (line: string) => {
      if (/dco|data channel offload/i.test(line) && /error|fail|not supported|unable|cannot|disabl/i.test(line)) dcoTrouble = true;
      if (/AUTH_FAILED/.test(line)) authFailed = true;
      this.address = openvpnPushedAddress(line) ?? this.address;
      if (/Exiting due to fatal error|There are no TAP-Windows|currently in use or disabled/.test(line)) fatal = true;
    };
    proc.on('line', watch);
    proc.start();
    const ok = await waitForLine(proc, /Initialization Sequence Completed/, /AUTH_FAILED|Exiting due to fatal error|There are no TAP-Windows|adapters on this system are currently in use or disabled/, 45_000);
    proc.off('line', watch);
    if (!ok) {
      fatal = fatal || !proc.alive;
      this.log('vpn', authFailed ? 'the server refused the login (AUTH_FAILED)' : fatal ? 'OpenVPN stopped with an error (above)' : 'OpenVPN did not finish connecting in 45 s');
      await this.stop();
    }
    // A timeout is the network's doing; an error at start may be the adapter's.
    return { ok, dcoTrouble: dcoTrouble || fatal, authFailed };
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc?.alive) return;
    proc.expectExit();
    // SIGTERM through the management port lets OpenVPN tell the server it is leaving and take its
    // routes down itself. It has to be given the time: killing it at once (on Windows a kill ends the
    // process outright) left the server holding the session, and the account's seat, for two minutes.
    await new Promise<void>((resolve) => {
      // Sent is enough; the process's exit, awaited below, is what says OpenVPN is done.
      const socket = net.connect({ host: '127.0.0.1', port: this.managementPort }, () => socket.end('signal SIGTERM\r\n', () => resolve()));
      socket.on('error', () => resolve());
      socket.on('close', () => resolve());
      setTimeout(resolve, 2000);
    });
    if (!(await proc.exited(openvpnExitGraceMs))) this.log('vpn', `OpenVPN had not exited ${openvpnExitGraceMs / 1000} s after SIGTERM; stopping it`);
    await proc.stop(8000);
  }
}

class L2tpConnection implements Connection {
  readonly engine = 'l2tp' as const;
  private watch: NodeJS.Timeout | null = null;
  private lost: ((blocking: boolean) => void) | null = null;
  notice: string | undefined;

  constructor(
    private readonly candidate: Candidate,
    private readonly driver: L2tpDriver,
    private readonly log: LogFn,
  ) {}

  onLost(cb: (blocking: boolean) => void): void {
    this.lost = cb;
  }

  async start(): Promise<boolean> {
    let account;
    try {
      account = l2tpAccount(this.candidate.config.link);
    } catch {
      this.log('vpn', 'this L2TP link carries no account');
      return false;
    }
    this.log('vpn', `L2TP to ${account.host} as ${account.username}`);
    const result = await this.driver.connect(account, this.log);
    this.notice = result.notice;
    if (!result.ok) {
      this.log('vpn', `L2TP did not connect${result.notice ? ` (${result.notice})` : ''}`);
      return false;
    }
    this.watch = setInterval(async () => {
      if (!(await this.driver.isUp())) {
        this.clearWatch();
        this.lost?.(false);
      }
    }, 10_000);
    return true;
  }

  private clearWatch(): void {
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
  }

  async stop(): Promise<void> {
    this.clearWatch();
    await this.driver.disconnect();
  }
}

export class Vpn extends EventEmitter {
  private current: Status = { state: 'disconnected' };
  private connection: Connection | null = null;
  // The connection being started, so a disconnect can stop it, and the attempt it belongs to:
  // a newer connect or a disconnect ends an attempt, which then leaves the status alone.
  private pending: Connection | null = null;
  private attempt = 0;
  private zoneBackup: string | null = null;
  private webrtcBackup: Record<string, string | null> = {};

  constructor(
    private readonly paths: VpnPaths,
    private readonly kit: SystemKit,
    private readonly log: LogFn = () => undefined,
  ) {
    super();
    fs.mkdirSync(paths.work, { recursive: true });
    // A WireGuard tunnel left by a run that ended without disconnecting (a crash, a power cut).
    const tools = kit.os === 'windows' ? wireguardTools(paths.bin) : null;
    if (tools) void removeTunnel(tools, log);
  }

  status(): Status {
    return this.current;
  }

  private set(status: Status): Status {
    this.current = status;
    this.emit('status', status);
    return status;
  }

  async connect(profile: AppProfile, settings: Settings, locationId: number | null, latency?: Map<string, number | null>): Promise<Status> {
    if (this.current.state !== 'disconnected' || this.current.blocking || this.pending) await this.disconnect();
    const attempt = ++this.attempt;
    const list = candidates(profile, locationId, settings.protocol, latency);
    this.log('vpn', `connect to ${locationId === null ? 'the fastest location' : `location ${locationId}`}, protocol ${settings.protocol}: ${list.length} config(s) to try`);
    if (list.length === 0) return this.set({ state: 'disconnected', error: 'no_config' });
    this.set({ state: 'connecting', locationId });

    let notice: string | undefined;
    for (const [i, candidate] of list.entries()) {
      if (attempt !== this.attempt) return this.current;
      const serverId = candidate.config.locationId ?? null;
      this.set({ state: 'connecting', locationId, serverId, configName: candidate.config.name, protocol: candidate.config.protocol });
      this.log('vpn', `(${i + 1}/${list.length}) trying ${candidate.config.protocol} "${candidate.config.name}" of location ${serverId ?? '-'}`);
      const connection = this.connectionFor(candidate, settings);
      if (!connection) {
        this.log('vpn', 'this system cannot run it');
        continue;
      }
      let ok = false;
      const started = Date.now();
      this.pending = connection;
      try {
        ok = await connection.start();
      } catch (err) {
        this.log('vpn', `failed: ${err instanceof Error ? err.message : String(err)}`);
        if (String(err).includes('engine_missing:openvpn') && this.kit.os !== 'windows') notice = this.kit.os === 'macos' ? 'openvpn_missing_mac' : 'openvpn_missing';
        else if (String(err).includes('engine_missing')) notice = 'engine_missing';
      }
      if (this.pending === connection) this.pending = null;
      if (connection instanceof L2tpConnection && connection.notice) notice = connection.notice;
      this.log('vpn', ok ? `connected in ${Date.now() - started} ms` : `did not connect (${Date.now() - started} ms)`);
      if (!ok) {
        // A WireGuard try reaches the server even when it fails, and the panel counts the account's
        // seat until the peer has been quiet a while: it is told the device left at once.
        if (candidate.config.protocol === 'wireguard') this.emit('attemptFailed', { protocol: 'wireguard', locationId: serverId });
        continue;
      }
      if (attempt !== this.attempt) {
        await connection.stop();
        return this.current;
      }
      this.connection = connection;
      connection.onLost((blocking) => void this.dropped(blocking));
      await this.applyPrivacy(profile, settings, candidate.config.locationId ?? null);
      return this.set({
        state: 'connected',
        locationId,
        serverId,
        configName: candidate.config.name,
        protocol: candidate.config.protocol,
        address: (connection as Connection).address,
        since: Date.now(),
        notice,
      });
    }
    if (attempt !== this.attempt) return this.current;
    this.log('vpn', 'no config connected');
    return this.set({ state: 'disconnected', error: 'all_failed', notice });
  }

  private connectionFor(candidate: Candidate, settings: Settings): Connection | null {
    switch (candidate.engine) {
      case 'xray':
        // Windows runs WireGuard on the official engine; Xray's own WireGuard stays the fallback.
        if (candidate.config.protocol === 'wireguard' && this.kit.os === 'windows') {
          const tools = wireguardTools(this.paths.bin);
          if (tools) return new WireguardWindowsConnection(candidate, settings, tools, this.paths.bin, this.paths.work, this.log);
          this.log('vpn', 'the WireGuard engine is missing from the app; trying Xray\'s WireGuard');
        }
        return new XrayConnection(candidate, settings, this.paths, this.kit, this.log);
      case 'openvpn':
        return new OpenvpnConnection(candidate, settings, this.paths, this.kit, this.log);
      default:
        return this.kit.l2tp ? new L2tpConnection(candidate, this.kit.l2tp, this.log) : null;
    }
  }

  private async applyPrivacy(profile: AppProfile, settings: Settings, locationId: number | null): Promise<void> {
    if (settings.webrtcProtection) this.webrtcBackup = await this.kit.protectWebrtc();
    const timezone = profile.locations.find((l) => l.id === locationId)?.timezone;
    if (settings.timezoneSpoof && timezone) this.zoneBackup = await this.kit.applyZone(timezone);
  }

  private async restorePrivacy(): Promise<void> {
    await this.kit.restoreWebrtc(this.webrtcBackup);
    this.webrtcBackup = {};
    await this.kit.restoreZone(this.zoneBackup);
    this.zoneBackup = null;
  }

  private async dropped(blocking: boolean): Promise<void> {
    const previous = this.current;
    this.log('vpn', blocking ? 'the connection dropped; the kill switch holds traffic back' : 'the connection dropped');
    if (!blocking) {
      this.connection = null;
      await this.restorePrivacy();
    }
    this.set({ state: 'disconnected', locationId: previous.locationId, error: 'connection_lost', blocking });
  }

  async disconnect(): Promise<Status> {
    const locationId = this.current.locationId;
    if (this.connection || this.pending || this.current.state !== 'disconnected') this.log('vpn', 'disconnecting');
    // Ends the attempt in progress too: its engine stops now instead of finishing its test.
    this.attempt++;
    this.set({ state: 'disconnecting', locationId });
    const connection = this.connection;
    const pending = this.pending;
    this.connection = null;
    this.pending = null;
    await Promise.all([connection?.stop(), pending?.stop()]);
    await this.restorePrivacy();
    return this.set({ state: 'disconnected', locationId });
  }
}
