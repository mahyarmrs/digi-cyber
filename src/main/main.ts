import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, nativeTheme, Notification, powerMonitor, safeStorage, shell, Tray } from 'electron';

import { addSpan, pushRecent } from '../shared/activity';
import { engineOf, runsOnXray, useOs } from '../shared/engines';
import { helperSocket } from '../shared/helperProtocol';
import { osOf } from '../shared/platform';
import { linkSecrets, redact } from '../shared/redact';
import { parseSignIn, signInScheme, type SignInCode } from '../shared/signin';
import type { AppConfig, AppProfile, PingResult, ProfileUpdate, Settings, SplitApp, Status } from '../shared/types';
import { ApiError, AppApi, subscriptionAccount } from './api';
import { serverAddress } from './candidates';
import { connectivityTestUrl, freePort, pingDirect, pingThroughProxy, waitForPort } from './health';
import { appApiBase, LinkError, subInfoUrl } from './link';
import { EngineProcess } from './engines/process';
import { windowsKit } from './os/windows';
import { SessionLog, tail } from './log';
import { RemoteVpn } from './remoteVpn';
import { dnsServers, proxyOutboundFor, serverNames, xrayConfig } from './configs/xray';
import { resolveNames } from './resolve';
import { Store, accountIdFor } from './store';
import { setAutostart } from './system/autostart';
import { deviceId, deviceName } from './system/device';
import { Vpn } from './vpn';

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// digicyber://login?sub=…&user=… opens the app and signs in: on Windows and Linux the link comes as an
// argument (of this start or of a second one), on macOS as an open-url event.
let pendingSignIn: SignInCode | null = signInLinkIn(process.argv);

function signInLinkIn(argv: string[]): SignInCode | null {
  const link = argv.find((arg) => arg.toLowerCase().startsWith(`${signInScheme}:`));
  return link ? parseSignIn(link) : null;
}

function takeSignInLink(code: SignInCode | null): void {
  if (!code) return;
  pendingSignIn = code;
  if (!ready) return;
  showWindow();
  window?.webContents.send('signInLink');
}

app.on('open-url', (event, url) => {
  event.preventDefault();
  takeSignInLink(parseSignIn(url));
});

const system = osOf(process.platform);
useOs(system);
const userAgent = `DigiCyber/${app.getVersion()} (${system})`;
// Since the app started: the app's own steps, the engines' output (Windows runs them here; Linux and
// macOS add the helper's log to a report) and the window's errors.
const sessionLog = new SessionLog();
const log = sessionLog.write;
log('app', `Digi Cyber ${app.getVersion()} on ${system} ${os.release()} (${process.arch}), Electron ${process.versions.electron}`);
process.on('uncaughtException', (err) => log('app', `uncaught: ${err.stack ?? String(err)}`));
process.on('unhandledRejection', (err) => log('app', `unhandled rejection: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
const binDir = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(app.getAppPath(), 'resources', 'bin');
const iconPath = app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(app.getAppPath(), 'build', 'icon.png');
const trayDir = app.isPackaged ? path.join(process.resourcesPath, 'tray') : path.join(app.getAppPath(), 'build', 'tray');
const titleBarHeight = 52;

let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let store: Store;
// Windows runs the engines itself, as administrator; Linux and macOS ask the root helper.
let vpn: Vpn | RemoteVpn;
let ready = false;
let profileCache: AppProfile | null = null;
let lastStatus: Status = { state: 'disconnected' };
let bookedUntil = 0;
let reconnectAttempts = 0;
// The connection the device was on until it left 'connected', for the panel (tellPanelLeft).
let leaving: { protocol: string; locationId: number | null; address?: string } | null = null;
let panelTold: Promise<void> = Promise.resolve();
let fetchedAt = 0;
// The newest notice the window has had; only ones after it arrive as system notifications.
let noticesKnownUpTo = 0;

// Changes made on the panel reach a running app within this time; the refresh button is for now.
const profileRefreshMs = 10 * 60_000;

// IPC carries only a message string, so failures cross as a code the window translates.
type Result<T> = { ok: true; value: T } | { ok: false; code: string };

function codeOf(err: unknown): string {
  if (err instanceof ApiError) return err.code;
  if (err instanceof LinkError) return 'bad_link';
  return 'unexpected';
}

function handle<A extends unknown[], T>(channel: string, fn: (...args: A) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Result<T>> => {
    try {
      return { ok: true, value: await fn(...(args as A)) };
    } catch (err) {
      const code = codeOf(err);
      log('app', `${channel}: ${code}${code === 'unexpected' ? ` (${err instanceof Error ? (err.stack ?? err.message) : String(err)})` : ''}`);
      return { ok: false, code };
    }
  });
}

async function device() {
  const id = await deviceId(system, store.deviceIdFallback());
  if (!store.deviceIdFallback()) store.saveDeviceIdFallback(id);
  return { deviceId: id, deviceName: deviceName(), os: system, osVersion: os.release(), appVersion: app.getVersion() };
}

function profileSummary(profile: AppProfile): string {
  const counts = new Map<string, number>();
  for (const c of profile.configs) counts.set(c.protocol, (counts.get(c.protocol) ?? 0) + 1);
  return `${profile.locations.length} location(s), ${profile.configs.length} config(s): ${[...counts].map(([p, n]) => `${p} ${n}`).join(', ') || 'none'}`;
}

// The subscription link alone signs in: the account's name comes from the subscription itself,
// unless a sign-in link already carried it. Other saved accounts stay available for switching.
async function login(subLink: string, given = ''): Promise<AppProfile> {
  const link = subLink.trim();
  sessionLog.secret(...linkSecrets(link));
  const api = new AppApi(appApiBase(link), userAgent);
  const username = given.trim() || (await subscriptionAccount(subInfoUrl(link), userAgent));
  const id = accountIdFor(link, username);
  if (store.session(id)) {
    const existing = await switchAccount(id);
    if (existing) return existing;
    throw new ApiError('bad_session', 401);
  }
  log('app', `signing in as ${username} on ${new URL(appApiBase(link)).host}`);
  const info = await device();
  const token = await api.login(username, info);
  sessionLog.secret(token);
  const profile = await api.profile(token, info.deviceId);
  if (store.activeAccountId() && store.activeAccountId() !== id) {
    // Tell the old account's panel that its tunnel left before changing the active session.
    await vpn.disconnect();
    await panelTold;
    store.saveSettings({ locationId: null });
  }
  log('app', `signed in: ${profileSummary(profile)}`);
  store.saveSession(link, username, token);
  store.saveProfile(profile);
  profileCache = profile;
  fetchedAt = Date.now();
  noticesKnownUpTo = Math.max(0, ...(profile.notices ?? []).map((n) => n.id));
  return profile;
}

const sessionEndingCodes = ['bad_session', 'app_disabled', 'not_found'];

// Fetches the active profile; a response for an account switched away from mid-request is never
// allowed to replace the new account's cache.
async function fetchProfile(): Promise<ProfileUpdate | null> {
  const session = store.session();
  if (!session) return null;
  const info = await device();
  try {
    const profile = await new AppApi(appApiBase(session.subLink), userAgent).profile(session.token, info.deviceId);
    store.saveProfile(profile, session.id);
    if (store.activeAccountId() !== session.id) return null;
    profileCache = profile;
    if (Date.now() - fetchedAt > 60_000) log('app', `profile: ${profileSummary(profile)}`);
    fetchedAt = Date.now();
    noticesKnownUpTo = Math.max(noticesKnownUpTo, ...(profile.notices ?? []).map((n) => n.id));
    return { profile, fetchedAt };
  } catch (err) {
    log('app', `profile refresh failed: ${codeOf(err)}`);
    if (err instanceof ApiError && sessionEndingCodes.includes(err.code)) {
      const wasActive = store.activeAccountId() === session.id;
      store.clearSession(session.id);
      if (!wasActive) return null;
      profileCache = store.profile();
      fetchedAt = 0;
      noticesKnownUpTo = Math.max(0, ...(profileCache?.notices ?? []).map((n) => n.id));
      if (store.session() && profileCache) return (await fetchProfile()) ?? { profile: profileCache, fetchedAt };
      profileCache = null;
      throw err;
    }
    if (store.activeAccountId() !== session.id) return null;
    const cached = store.profile(session.id);
    if (!cached) throw err;
    profileCache = cached;
    return { profile: cached, fetchedAt, error: codeOf(err) };
  }
}

async function refreshProfile(force: boolean): Promise<AppProfile | null> {
  if (!store.session()) {
    profileCache = store.profile();
    return profileCache;
  }
  if (!force && profileCache) return profileCache;
  return (await fetchProfile())?.profile ?? profileCache ?? store.profile();
}

// Runs every 10 minutes and when the computer wakes; the window and the tray learn the result.
async function backgroundRefresh(): Promise<void> {
  if (!store.session()) return;
  const knownBefore = noticesKnownUpTo;
  try {
    const update = await fetchProfile();
    if (!update) return;
    window?.webContents.send('profile', update);
    announceNew(update.profile, knownBefore);
  } catch (err) {
    window?.webContents.send('signedOut', codeOf(err));
  }
}

function announceNew(profile: AppProfile, knownBefore: number): void {
  for (const n of profile.notices ?? []) {
    if (n.id <= knownBefore || n.level === 'info') continue;
    notify(n.level === 'critical' ? noticeTitles[store.settings().language].critical : noticeTitles[store.settings().language].warning, n.body);
  }
}

async function switchAccount(accountId: string): Promise<AppProfile | null> {
  const target = store.session(accountId);
  if (!target) throw new ApiError('bad_session', 401);
  if (store.activeAccountId() !== accountId) {
    await vpn.disconnect();
    await panelTold;
    if (!store.activateAccount(accountId)) throw new ApiError('bad_session', 401);
    store.saveSettings({ locationId: null });
    profileCache = store.profile(accountId);
    fetchedAt = 0;
    noticesKnownUpTo = Math.max(0, ...(profileCache?.notices ?? []).map((n) => n.id));
    log('app', `switched to account ${target.username}`);
  }
  return await refreshProfile(true).catch(() => profileCache ?? store.profile(accountId));
}

async function logout(accountId?: string): Promise<AppProfile | null> {
  const target = store.session(accountId);
  if (!target) return profileCache;
  const wasActive = target.id === store.activeAccountId();
  if (wasActive) {
    await vpn.disconnect();
    await panelTold;
  }
  const info = await device();
  await new AppApi(appApiBase(target.subLink), userAgent).logout(target.token, info.deviceId).catch(() => undefined);
  store.clearSession(target.id);
  if (!wasActive) return profileCache;

  profileCache = store.profile();
  fetchedAt = 0;
  noticesKnownUpTo = Math.max(0, ...(profileCache?.notices ?? []).map((n) => n.id));
  if (!store.session()) {
    profileCache = null;
    return null;
  }
  return await refreshProfile(true).catch(() => profileCache);
}

async function pingConfig(config: AppConfig, settings: Settings): Promise<number | null> {
  const outbound = proxyOutboundFor(config);
  if (!runsOnXray(config.protocol, outbound)) return null;

  let directory = '';
  let proc: EngineProcess | null = null;
  try {
    directory = fs.mkdtempSync(path.join(app.getPath('userData'), 'ping-'));
    const socksPort = await freePort();
    const httpPort = await freePort();
    const hosts = await resolveNames(serverNames(outbound));
    const file = path.join(directory, 'xray.json');
    fs.writeFileSync(
      file,
      JSON.stringify(xrayConfig(outbound, { socksPort, httpPort, iranDirect: false, adBlock: false, dns: dnsServers(settings.dns), hosts }), null, 2),
      { mode: 0o600 },
    );
    proc = new EngineProcess('xray-ping', path.join(binDir, 'xray'), ['run', '-c', file], path.join(directory, 'xray.log'), binDir);
    proc.start();
    if (!(await waitForPort(httpPort, 7000, () => proc?.alive ?? false))) return null;
    return await pingThroughProxy(httpPort, 8000, connectivityTestUrl);
  } catch (err) {
    log('app', `URL ping failed for ${config.protocol}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    await proc?.stop(1000);
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

// Each Xray/WireGuard config gets its own local proxy and an HTTP request to Google's 204 endpoint.
// OpenVPN/L2TP need to replace the system tunnel to probe another location; only the live one can be
// measured safely without interrupting the user's current connection.
async function ping(): Promise<PingResult[]> {
  const profile = profileCache ?? store.profile();
  if (!profile) return [];
  const usable = profile.configs.filter((config) => engineOf(config));
  const uniqueXray = [...new Map(usable.filter((config) => engineOf(config) === 'xray').map((config) => [config.link, config])).values()];
  const settings = store.settings();
  const measured = new Map<string, number | null>();
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, uniqueXray.length) }, async () => {
      while (next < uniqueXray.length) {
        const config = uniqueXray[next++];
        measured.set(config.link, await pingConfig(config, settings));
      }
    }),
  );

  const activeConfig = lastStatus.state === 'connected'
    ? usable.find((config) => config.locationId === lastStatus.serverId && config.protocol === lastStatus.protocol && config.name === lastStatus.configName)
    : undefined;
  if (activeConfig && engineOf(activeConfig) !== 'xray') measured.set(activeConfig.link, await pingDirect(8000, connectivityTestUrl));
  return usable.map((config) => ({ link: config.link, ms: measured.get(config.link) ?? null }));
}

async function connect(locationId: number | null): Promise<Status> {
  const profile = await refreshProfile(true).catch(() => profileCache ?? store.profile());
  if (!profile) return vpn.status();
  store.saveSettings({ locationId });
  const latency = locationId === null ? new Map((await ping()).map((p) => [p.link, p.ms])) : undefined;
  if (latency) log('app', `ping before choosing the fastest: ${[...latency.values()].filter((ms) => ms !== null).length}/${latency.size} servers answered`);
  return vpn.connect(profile, store.settings(), locationId, latency);
}

// What support needs to read a log: the app, the system, the settings, the account's configs and the state.
function reportHeader(): string {
  const s = store.settings();
  const session = store.session();
  const profile = profileCache ?? store.profile();
  let engines = '';
  try {
    engines = fs.readFileSync(path.join(binDir, 'VERSIONS.txt'), 'utf8').trim().replace(/\r?\n/g, ', ');
  } catch {
    engines = system === 'windows' ? 'VERSIONS.txt missing' : 'in the helper';
  }
  const st = vpn.status();
  const lines = [
    `Digi Cyber ${app.getVersion()} · ${system} ${os.release()} ${process.arch} · Electron ${process.versions.electron}`,
    `Engines: ${engines}`,
    `Account: ${profile?.account.username ?? session?.username ?? '-'} · device ${deviceName()} · panel ${session ? new URL(appApiBase(session.subLink)).host : '-'}`,
    `Status: ${st.state}${st.protocol ? ` ${st.protocol}` : ''}${st.configName ? ` "${st.configName}"` : ''}${st.error ? ` error ${st.error}` : ''}${st.notice ? ` notice ${st.notice}` : ''}`,
    `Settings: protocol ${s.protocol}, kill switch ${s.killSwitch}, reconnect ${s.autoReconnect}, Iran direct ${s.iranDirect}, ad block ${s.adBlock}, DNS ${s.dns || 'default'}, split ${s.splitTunneling ? s.splitApps.length : 'off'}, WebRTC ${s.webrtcProtection}, timezone ${s.timezoneSpoof}, language ${s.language}`,
    `Profile: ${profile ? profileSummary(profile) : '-'}${fetchedAt ? ` · fetched ${new Date(fetchedAt).toISOString()}` : ''}`,
  ];
  for (const c of profile?.configs ?? []) {
    const target = serverAddress(c);
    lines.push(`  ${c.protocol.padEnd(11)} location ${String(c.locationId ?? '-').padEnd(4)} ${target ? `${target.host}:${target.port}` : '?'} "${c.name}"${engineOf(c) ? '' : ' (not run on this system)'}`);
  }
  return lines.join('\n');
}

async function logText(): Promise<string> {
  const helper = vpn instanceof RemoteVpn ? await vpn.logs() : '';
  const parts = [reportHeader(), '', '=== app ===', sessionLog.text()];
  if (helper) parts.push('=== helper (engines) ===', helper);
  const previous = sessionLog.previous(150_000);
  if (previous) parts.push('=== previous run (end) ===', previous);
  // The helper's log passes through the app's own redaction too.
  return redactWithSession(parts.join('\n'));
}

function redactWithSession(text: string): string {
  const secrets = store.sessions().flatMap((session) => [...linkSecrets(session.subLink), session.token]);
  return redact(text, secrets);
}

async function sendReport(message: string): Promise<{ id: string | null }> {
  const session = store.session();
  if (!session) throw new ApiError('bad_session', 401);
  const info = await device();
  const text = tail(await logText(), 2_000_000);
  log('app', 'sending a support report');
  const id = await new AppApi(appApiBase(session.subLink), userAgent).report(session.token, { message: String(message ?? '').slice(0, 4000), log: text, ...info });
  log('app', `support report sent${id ? ` (number ${id})` : ''}`);
  return { id };
}

async function saveLog(): Promise<boolean> {
  const name = `digi-cyber-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`;
  const options = { defaultPath: path.join(app.getPath('downloads'), name), filters: [{ name: 'Text', extensions: ['txt'] }] };
  const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options);
  if (result.canceled || !result.filePath) return false;
  fs.writeFileSync(result.filePath, await logText());
  return true;
}

async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  if (patch.startWithWindows !== undefined && app.isPackaged) await setAutostart(system, patch.startWithWindows, process.env.APPIMAGE ?? process.execPath);
  const settings = store.saveSettings(patch);
  if (patch.theme) applyTheme(settings);
  return settings;
}

// sing-box matches a program by its file name: name.exe on Windows, the executable elsewhere.
async function pickApp(): Promise<SplitApp | null> {
  const filters = system === 'windows' ? [{ name: 'Programs', extensions: ['exe'] }] : system === 'macos' ? [{ name: 'Applications', extensions: ['app'] }] : [];
  const options = { properties: ['openFile' as const], filters, defaultPath: system === 'macos' ? '/Applications' : undefined };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  const file = result.filePaths[0];
  if (result.canceled || !file) return null;
  const base = path.basename(file);
  if (system === 'windows') return { name: base.toLowerCase(), path: file };
  return { name: system === 'macos' ? base.replace(/\.app$/i, '') : base, path: file };
}

async function appIcon(file: string): Promise<string | null> {
  try {
    return (await app.getFileIcon(file, { size: 'normal' })).toDataURL();
  } catch {
    return null;
  }
}

// The window controls Windows draws over the title bar follow the theme.
function applyTheme(settings: Settings): void {
  if (nativeTheme.themeSource !== settings.theme) nativeTheme.themeSource = settings.theme;
  paintWindowFrame();
}

function paintWindowFrame(): void {
  const dark = nativeTheme.shouldUseDarkColors;
  if (system === 'windows') window?.setTitleBarOverlay({ color: dark ? '#060a17' : '#f2f4fb', symbolColor: dark ? '#c3cbef' : '#0e1430', height: titleBarHeight });
  window?.setBackgroundColor(dark ? '#060a17' : '#f2f4fb');
}

// Windows draws its buttons over the app's own title bar, macOS its traffic lights; Linux keeps the system's frame.
function windowChrome(dark: boolean): Partial<Electron.BrowserWindowConstructorOptions> {
  if (system === 'windows') {
    return { titleBarStyle: 'hidden', titleBarOverlay: { color: dark ? '#060a17' : '#f2f4fb', symbolColor: dark ? '#c3cbef' : '#0e1430', height: titleBarHeight } };
  }
  if (system === 'macos') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 20 } };
  return { autoHideMenuBar: true };
}

const notices = {
  fa: { connected: 'متصل شد', lost: 'اتصال قطع شد', disconnected: 'اتصال قطع شد' },
  en: { connected: 'Connected', lost: 'Connection lost', disconnected: 'Disconnected' },
};

const noticeTitles = {
  fa: { critical: 'اطلاعیه مهم', warning: 'اطلاعیه' },
  en: { critical: 'Important notice', warning: 'Notice' },
};

function notify(title: string, body: string): void {
  if (!store.settings().notifications || !Notification.isSupported()) return;
  new Notification({ title, body, icon: iconPath, silent: true }).show();
}

// Books connected time up to now; runs on every change and once a minute while connected.
function bookActivity(now = Date.now()): void {
  if (lastStatus.state !== 'connected' || !lastStatus.since) return;
  const from = Math.max(bookedUntil, lastStatus.since);
  if (now <= from) return;
  const activity = store.activity();
  store.saveActivity({ ...activity, days: addSpan(activity.days, from, now) });
  bookedUntil = now;
}

// Once the old tunnel is down (a disconnect, a switch to another location or protocol, a drop), the
// panel hears that this device left, so its seat is free at once and not only after WireGuard's quiet.
async function tellPanelLeft(left: { protocol: string; locationId: number | null; address?: string }): Promise<void> {
  const session = store.session();
  if (!session) return;
  const info = await device();
  await new AppApi(appApiBase(session.subLink), userAgent)
    .disconnected(session.token, info.deviceId, left)
    .catch((err: unknown) => log('app', `telling the panel this device left failed: ${codeOf(err)}`));
}

function onStatus(status: Status): void {
  const previous = lastStatus;
  if (previous.state === 'connected' && status.state !== 'connected' && previous.protocol) {
    leaving = { protocol: previous.protocol, locationId: previous.serverId ?? null, address: previous.address };
  }
  if (status.state === 'disconnected' && leaving) {
    const left = leaving;
    leaving = null;
    panelTold = tellPanelLeft(left);
  }
  if (status.state !== previous.state || status.error !== previous.error) {
    log('app', `status ${status.state}${status.protocol ? ` ${status.protocol}` : ''}${status.configName ? ` "${status.configName}"` : ''}${status.error ? ` (${status.error})` : ''}${status.notice ? ` notice ${status.notice}` : ''}`);
  }
  bookActivity();
  lastStatus = status;
  const text = notices[store.settings().language];
  if (status.state === 'connected' && previous.state !== 'connected') {
    reconnectAttempts = 0;
    bookedUntil = status.since ?? Date.now();
    const used = status.serverId ?? status.locationId;
    if (typeof used === 'number') {
      const activity = store.activity();
      store.saveActivity({ ...activity, recents: pushRecent(activity.recents, used) });
    }
    notify(text.connected, status.configName ?? '');
  }
  if (status.state === 'disconnected' && previous.state === 'connected') {
    notify(status.error === 'connection_lost' ? text.lost : text.disconnected, previous.configName ?? '');
  }
  // A dropped connection comes back by itself up to three times, a few seconds apart.
  if (status.error === 'connection_lost' && store.settings().autoReconnect && reconnectAttempts < 3) {
    reconnectAttempts++;
    setTimeout(() => void connect(status.locationId ?? null), 2000 * reconnectAttempts);
  }
  window?.webContents.send('status', status);
  updateTray(status);
}

function showWindow(): void {
  if (!window) createWindow(true);
  window?.show();
  window?.focus();
}

function updateTray(status: Status): void {
  if (!tray) return;
  const connected = status.state === 'connected';
  tray.setToolTip(connected ? `Digi Cyber — ${status.configName ?? ''}` : 'Digi Cyber');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Digi Cyber', click: showWindow },
      connected || status.blocking
        ? { label: 'Disconnect', click: () => void vpn.disconnect() }
        : { label: 'Connect', click: () => void connect(store.settings().locationId) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
}

function createWindow(show: boolean): void {
  const dark = nativeTheme.shouldUseDarkColors;
  window = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 980,
    minHeight: 660,
    show,
    title: 'Digi Cyber',
    icon: iconPath,
    backgroundColor: dark ? '#060a17' : '#f2f4fb',
    ...windowChrome(dark),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.removeMenu();
  void window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('close', (event) => {
    if (quitting) return;
    event.preventDefault();
    window?.hide();
  });
}

app.on('second-instance', (_event, argv) => {
  showWindow();
  takeSignInLink(signInLinkIn(argv));
});

// The mark in one colour: white on a dark taskbar, dark on a light one, a template image in the macOS menu bar.
function trayImage(): Electron.NativeImage {
  if (system === 'macos') {
    const image = nativeImage.createFromPath(path.join(trayDir, 'trayTemplate.png'));
    image.setTemplateImage(true);
    return image;
  }
  const shade = system === 'linux' || nativeTheme.shouldUseDarkColors ? 'white' : 'dark';
  const file = system === 'windows' ? `tray-${shade}.ico` : `tray-${shade}-24.png`;
  const image = nativeImage.createFromPath(path.join(trayDir, file));
  return image.isEmpty() ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }) : image;
}

app.whenReady().then(async () => {
  // Linux without a keyring has no safeStorage; the file is then only private to the user (0600).
  const sealing = safeStorage.isEncryptionAvailable();
  sessionLog.open(path.join(app.getPath('userData'), 'logs', 'digi-cyber.log'));
  store = new Store(path.join(app.getPath('userData'), 'state.json'), {
    encrypt: (text) => (sealing ? safeStorage.encryptString(text).toString('base64') : `plain:${Buffer.from(text).toString('base64')}`),
    decrypt: (sealed) => (sealed.startsWith('plain:') ? Buffer.from(sealed.slice(6), 'base64').toString() : safeStorage.decryptString(Buffer.from(sealed, 'base64'))),
  });
  const saved = store.session();
  for (const account of store.sessions()) sessionLog.secret(...linkSecrets(account.subLink), account.token);
  if (saved) log('app', `signed in as ${saved.username}`);
  if (system === 'windows') {
    vpn = new Vpn({ bin: binDir, work: path.join(app.getPath('userData'), 'run') }, windowsKit, log);
  } else {
    const remote = new RemoteVpn(helperSocket[system], system === 'macos' ? 'helper_unreachable_macos' : 'helper_unreachable');
    vpn = remote;
    void remote.sync();
  }
  profileCache = store.profile();
  noticesKnownUpTo = Math.max(0, ...(profileCache?.notices ?? []).map((n) => n.id));
  nativeTheme.themeSource = store.settings().theme;
  ready = true;

  handle('takeSignIn', () => {
    const code = pendingSignIn;
    pendingSignIn = null;
    return code;
  });
  handle('session', () => {
    const s = store.session();
    return s ? { id: s.id, subLink: s.subLink, username: s.username } : null;
  });
  handle('accounts', () => store.accounts());
  handle('login', login);
  handle('switchAccount', switchAccount);
  handle('logout', logout);
  handle('profile', (force: boolean) => refreshProfile(force));
  handle('refresh', fetchProfile);
  handle('settings', () => store.settings());
  handle('saveSettings', saveSettings);
  handle('connect', connect);
  handle('disconnect', () => vpn.disconnect());
  handle('status', () => vpn.status());
  handle('ping', ping);
  handle('activity', () => store.activity());
  handle('pickApp', pickApp);
  handle('appIcon', appIcon);
  handle('openExternal', async (url: string) => {
    if (/^https?:\/\//.test(url) || url.startsWith('tg://')) await shell.openExternal(url);
  });
  handle('logText', logText);
  handle('sendReport', sendReport);
  handle('saveLog', saveLog);
  ipcMain.on('log', (_event, text: unknown) => log('window', String(text).slice(0, 4000)));

  vpn.on('status', onStatus);
  // A failed WireGuard try still reached the server: the panel frees the account's seat at once.
  vpn.on('attemptFailed', (left: { protocol: string; locationId: number | null }) => {
    panelTold = tellPanelLeft(left);
  });
  setInterval(() => bookActivity(), 60_000);
  setInterval(() => void backgroundRefresh(), profileRefreshMs);
  powerMonitor.on('resume', () => setTimeout(() => void backgroundRefresh(), 15_000));
  nativeTheme.on('updated', () => {
    paintWindowFrame();
    tray?.setImage(trayImage());
  });
  if (!app.isDefaultProtocolClient(signInScheme)) app.setAsDefaultProtocolClient(signInScheme);

  tray = new Tray(trayImage());
  tray.on('click', showWindow);
  updateTray(vpn.status());
  createWindow(!(process.argv.includes('--hidden') || store.settings().launchMinimized) || pendingSignIn !== null);

  if (store.session() && store.settings().connectOnStart) void connect(store.settings().locationId);
});

// The tunnel, the timezone and the browser policy are put back before the app goes.
app.on('before-quit', (event) => {
  if (quitting || !ready) return;
  event.preventDefault();
  quitting = true;
  bookActivity();
  void vpn
    .disconnect()
    .then(() => Promise.race([panelTold, new Promise((r) => setTimeout(r, 5000))]))
    .finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  // Stays in the tray.
});
