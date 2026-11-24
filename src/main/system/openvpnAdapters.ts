import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { LogFn } from '../log';
import { run } from './run';

// OpenVPN 2.6 on Windows opens an adapter that already exists; it never makes one. The app ships the
// TAP-Windows6 and ovpn-dco drivers (signed by Microsoft) with tapctl, and adds an adapter of each
// the first time OpenVPN is used: TAP takes any profile, ovpn-dco (Windows 10 2004 and later) is faster.
export const tapAdapterName = 'Digi Cyber TAP';
export const dcoAdapterName = 'Digi Cyber DCO';
export const tapHwid = 'root\\tap0901';
export const dcoHwid = 'ovpn-dco';

export interface Adapter {
  guid: string;
  name: string;
}

// tapctl list prints one adapter per line: {GUID}<tab>name.
export function parseTapctlList(stdout: string): Adapter[] {
  const out: Adapter[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\{[0-9A-Fa-f-]{36}\})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ guid: m[1], name: m[2] });
  }
  return out;
}

// os.release() on Windows is "10.0.<build>".
export function windowsBuild(release = os.release()): number {
  return Number(release.split('.')[2]) || 0;
}

// The ovpn-dco build for this Windows: one for Windows 11 (build 22000 and later), one for Windows 10.
export function dcoDriverDir(openvpnDir: string, build: number): string {
  return path.join(openvpnDir, 'drivers', build >= 22000 ? 'dco-win11' : 'dco-win10');
}

const pnputil = () => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'pnputil.exe');

async function ensureAdapter(tapctl: string, hwid: string, name: string, inf: string, log: LogFn): Promise<boolean> {
  const listed = parseTapctlList((await run(tapctl, ['list', '--hwid', hwid])).stdout);
  if (listed.some((a) => a.name.toLowerCase() === name.toLowerCase())) return true;
  if (!fs.existsSync(inf)) {
    log('openvpn-setup', `driver missing: ${inf}`);
    return listed.length > 0;
  }
  log('openvpn-setup', `adding the ${hwid} driver and the "${name}" adapter`);
  const added = await run(pnputil(), ['/add-driver', inf, '/install'], 120_000);
  log('openvpn-setup', `pnputil exit ${added.code}: ${(added.stdout + added.stderr).replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  const created = await run(tapctl, ['create', '--hwid', hwid, '--name', name], 120_000);
  log('openvpn-setup', `tapctl create exit ${created.code}: ${(created.stdout + created.stderr).replace(/\s+/g, ' ').trim().slice(0, 400)}`);
  const after = parseTapctlList((await run(tapctl, ['list', '--hwid', hwid])).stdout);
  return after.length > 0;
}

let preparing: Promise<boolean> | null = null;

// True when an ovpn-dco adapter is there for OpenVPN to prefer. Runs once per app start.
export function prepareOpenvpnAdapters(binDir: string, log: LogFn): Promise<boolean> {
  if (!preparing) {
    preparing = (async () => {
      const dir = path.join(binDir, 'openvpn');
      const tapctl = path.join(dir, 'tapctl.exe');
      if (!fs.existsSync(tapctl)) {
        log('openvpn-setup', 'tapctl.exe is missing; reinstall Digi Cyber');
        return false;
      }
      const tap = await ensureAdapter(tapctl, tapHwid, tapAdapterName, path.join(dir, 'drivers', 'tap', 'OemVista.inf'), log);
      const build = windowsBuild();
      const dco = build >= 19041 ? await ensureAdapter(tapctl, dcoHwid, dcoAdapterName, path.join(dcoDriverDir(dir, build), 'ovpn-dco.inf'), log) : false;
      log('openvpn-setup', `Windows build ${build}: TAP adapter ${tap ? 'ready' : 'missing'}, DCO adapter ${dco ? 'ready' : build >= 19041 ? 'missing' : 'not supported'}`);
      // Tried again on the next connect when something is still missing.
      if (!tap || (build >= 19041 && !dco)) preparing = null;
      return dco;
    })().catch((err: unknown) => {
      log('openvpn-setup', `failed: ${String(err)}`);
      preparing = null;
      return false;
    });
  }
  return preparing;
}
