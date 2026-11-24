// Downloads the engines Digi Cyber runs into resources/bin/<os>-<arch> (CI):
//   node scripts/fetch-binaries.mjs win x64 | linux x64 | linux arm64 | mac x64 | mac arm64
// Xray and sing-box everywhere; on Windows also OpenVPN 2.6 with tapctl (run there: it unpacks an MSI),
// the TAP-Windows6 and ovpn-dco drivers its adapters need, and WireGuard for Windows' wireguard.exe and wg.exe.
// Linux and macOS use the system's OpenVPN. Xray's archives are checked against its published digests.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const target = process.argv[2] ?? 'win';
const arch = process.argv[3] ?? 'x64';
if (!['win', 'linux', 'mac'].includes(target) || !['x64', 'arm64'].includes(arch)) throw new Error(`unknown target ${target} ${arch}`);
const bin = path.resolve('resources/bin', `${target}-${arch}`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-bin-'));
const headers = { 'User-Agent': 'digi-cyber-build', Accept: 'application/vnd.github+json' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const versions = [];

// GitHub's release downloads now and then answer 5xx or drop the connection; a few tries ride it out.
async function fetchRetrying(url, init) {
  let last;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || res.status < 500) return res;
      last = new Error(`${url}: ${res.status}`);
    } catch (err) {
      last = err;
    }
    if (attempt < 4) {
      console.log(`${url}: ${last.message}, trying again`);
      await new Promise((r) => setTimeout(r, attempt * 5000));
    }
  }
  throw last;
}

async function json(url) {
  const res = await fetchRetrying(url, { headers });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetchRetrying(url, { headers: { 'User-Agent': 'digi-cyber-build' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

function unzip(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    // Windows' own bsdtar reads zip. Expand-Archive broke when a PowerShell 7 step started
    // Windows PowerShell, which then loaded PowerShell 7's archive module.
    const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tar, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
  } else if (zip.endsWith('.zip')) {
    execFileSync('unzip', ['-q', '-o', zip, '-d', dest], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xzf', zip, '-C', dest], { stdio: 'inherit' });
  }
  return dest;
}

// Xray publishes Xray-<os>.zip.dgst beside each archive, with its SHA2-256.
async function checkXrayDigest(rel, name, file) {
  const dgst = rel.assets.find((x) => x.name === `${name}.dgst`);
  if (!dgst) throw new Error(`${rel.tag_name}: no digest for ${name}`);
  const text = Buffer.from(await (await fetch(dgst.browser_download_url, { headers: { 'User-Agent': 'digi-cyber-build' }, redirect: 'follow' })).arrayBuffer()).toString();
  const want = /SHA2-256=\s*([0-9a-f]{64})/i.exec(text)?.[1];
  const got = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (!want || want.toLowerCase() !== got) throw new Error(`${name}: digest mismatch`);
}

function find(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const hit = find(full, name);
      if (hit) return hit;
    } else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

// License texts ship with the engines (resources/bin/licenses): each archive's own, plus the fixed
// texts in build/licenses for the parts whose archives carry none (OpenVPN, TAP-Windows6, WireGuard).
const licenses = path.join(bin, 'licenses');
fs.mkdirSync(licenses, { recursive: true });
for (const f of fs.readdirSync(path.resolve('build/licenses'))) fs.copyFileSync(path.resolve('build/licenses', f), path.join(licenses, f));
fs.copyFileSync(path.resolve('hub/THIRD-PARTY.md'), path.join(licenses, 'THIRD-PARTY.md'));
function license(dir, name) {
  const f = find(dir, 'LICENSE') ?? find(dir, 'LICENSE.txt') ?? find(dir, 'COPYING');
  if (!f) throw new Error(`${name}: no license file in its archive`);
  fs.copyFileSync(f, path.join(licenses, `${name}-LICENSE.txt`));
}

async function release(repo, pick) {
  const releases = await json(`https://api.github.com/repos/${repo}/releases?per_page=60`);
  const chosen = releases.find((r) => !r.draft && !r.prerelease && pick(r.tag_name));
  if (!chosen) throw new Error(`${repo}: no matching release`);
  return chosen;
}

function asset(rel, pattern) {
  const a = rel.assets.find((x) => pattern.test(x.name));
  if (!a) throw new Error(`${rel.tag_name}: no asset matching ${pattern}`);
  return a.browser_download_url;
}

fs.mkdirSync(bin, { recursive: true });
const exe = target === 'win' ? '.exe' : '';

const xrayNames = { 'win-x64': 'Xray-windows-64.zip', 'linux-x64': 'Xray-linux-64.zip', 'linux-arm64': 'Xray-linux-arm64-v8a.zip', 'mac-x64': 'Xray-macos-64.zip', 'mac-arm64': 'Xray-macos-arm64-v8a.zip' };
const xrayName = xrayNames[`${target}-${arch}`];
if (!xrayName) throw new Error(`no Xray build for ${target} ${arch}`);
const xray = await release('XTLS/Xray-core', () => true);
const xrayZip = await download(asset(xray, new RegExp(`^${xrayName.replace(/\./g, '\\.')}$`)), path.join(tmp, 'xray.zip'));
await checkXrayDigest(xray, xrayName, xrayZip);
const xrayDir = unzip(xrayZip, path.join(tmp, 'xray'));
for (const f of [`xray${exe}`, 'geoip.dat', 'geosite.dat']) fs.copyFileSync(path.join(xrayDir, f), path.join(bin, f));
license(xrayDir, 'Xray-core');
versions.push(`xray ${xray.tag_name}`);

const sbNames = { 'win-x64': /windows-amd64\.zip$/, 'linux-x64': /linux-amd64\.tar\.gz$/, 'linux-arm64': /linux-arm64\.tar\.gz$/, 'mac-x64': /darwin-amd64\.tar\.gz$/, 'mac-arm64': /darwin-arm64\.tar\.gz$/ };
const singbox = await release('SagerNet/sing-box', () => true);
const sbPattern = sbNames[`${target}-${arch}`];
const sbArchive = await download(asset(singbox, sbPattern), path.join(tmp, target === 'win' ? 'sing-box.zip' : 'sing-box.tar.gz'));
const sbDir = unzip(sbArchive, path.join(tmp, 'sing-box'));
fs.copyFileSync(find(sbDir, `sing-box${exe}`), path.join(bin, `sing-box${exe}`));
license(sbDir, 'sing-box');
versions.push(`sing-box ${singbox.tag_name}`);

if (target !== 'win') {
  for (const f of ['xray', 'sing-box']) fs.chmodSync(path.join(bin, f), 0o755);
  fs.writeFileSync(path.join(bin, 'VERSIONS.txt'), versions.join('\n') + '\n');
  console.log(versions.join('\n'));
  process.exit(0);
}
fs.mkdirSync(path.join(bin, 'openvpn'), { recursive: true });

// OpenVPN 2.6, the line the app has been tested with on Windows (with the drivers below).
// Its Windows builds are tags of openvpn-build; a tag can precede its published MSI.
const ovpnTags = execFileSync('git', ['ls-remote', '--tags', 'https://github.com/OpenVPN/openvpn-build'], { encoding: 'utf8' })
  .split('\n')
  .map((line) => /refs\/tags\/(OpenVPN-2\.6\.(\d+)-I(\d+))$/.exec(line))
  .filter(Boolean)
  .sort((a, b) => Number(b[2]) - Number(a[2]) || Number(b[3]) - Number(a[3]))
  .map((m) => m[1]);
const msi = path.join(tmp, 'openvpn.msi');
let ovpn = null;
for (const tag of ovpnTags.slice(0, 8)) {
  for (const url of [
    `https://github.com/OpenVPN/openvpn-build/releases/download/${tag}/${tag}-amd64.msi`,
    `https://swupdate.openvpn.org/community/releases/${tag}-amd64.msi`,
  ]) {
    try {
      await download(url, msi);
      ovpn = { tag_name: tag };
      break;
    } catch (err) {
      console.log(`skip ${url}: ${err.message}`);
    }
  }
  if (ovpn) break;
}
if (!ovpn) throw new Error('no OpenVPN 2.6 MSI found');
const ovpnDir = path.join(tmp, 'openvpn');
execFileSync('msiexec.exe', ['/a', msi, '/qn', `TARGETDIR=${ovpnDir}`], { stdio: 'inherit' });
const ovpnExe = find(ovpnDir, 'openvpn.exe');
if (!ovpnExe) throw new Error('openvpn.exe not found in the MSI');
for (const f of fs.readdirSync(path.dirname(ovpnExe))) {
  if (/\.(exe|dll)$/i.test(f)) fs.copyFileSync(path.join(path.dirname(ovpnExe), f), path.join(bin, 'openvpn', f));
}
versions.push(`openvpn ${ovpn.tag_name}`);

if (!fs.existsSync(path.join(bin, 'openvpn', 'tapctl.exe'))) throw new Error('tapctl.exe not found in the MSI');

// OpenVPN opens only an adapter that exists; the app adds one with tapctl from these drivers
// (src/main/system/openvpnAdapters.ts). Both are signed by Microsoft; the archives are pinned.
async function pinned(url, sha256, file) {
  await download(url, file);
  const got = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (got !== sha256) throw new Error(`${url}: digest ${got}, expected ${sha256}`);
  return file;
}
const drivers = path.join(bin, 'openvpn', 'drivers');
const tapDir = unzip(await pinned('https://github.com/OpenVPN/tap-windows6/releases/download/9.27.0/dist.win10.zip', '36e2609b7ceefedcb978ce5c48caf9e0e5af83423717c4e2e3c1d7ebca8f62a5', path.join(tmp, 'tap.zip')), path.join(tmp, 'tap'));
fs.mkdirSync(path.join(drivers, 'tap'), { recursive: true });
for (const f of ['OemVista.inf', 'tap0901.sys', 'tap0901.cat']) fs.copyFileSync(path.join(tapDir, 'dist.win10', 'amd64', f), path.join(drivers, 'tap', f));
versions.push('tap-windows6 9.27.0');
const dcoDir = unzip(await pinned('https://github.com/OpenVPN/ovpn-dco-win/releases/download/2.8.7/ovpn-dco-win-2.8.7-amd64.zip', '6ee142c11b5e98a2411751b6327dde811ffdd468d34727ce513e7321f8e96495', path.join(tmp, 'dco.zip')), path.join(tmp, 'dco'));
for (const variant of ['win10', 'win11']) {
  fs.mkdirSync(path.join(drivers, `dco-${variant}`), { recursive: true });
  for (const f of ['ovpn-dco.inf', 'ovpn-dco.sys', 'ovpn-dco.cat']) fs.copyFileSync(path.join(dcoDir, variant, f), path.join(drivers, `dco-${variant}`, f));
}
versions.push('ovpn-dco-win 2.8.7');

// WireGuard for Windows: the app runs WireGuard through its tunnel service, the official engine
// (src/main/wireguardWindows.ts). The amd64 MSI named in the list of latest versions (whose digests are
// BLAKE2b-256); the MSI, wireguard.exe and wg.exe must each carry WireGuard LLC's valid signature.
const wgBase = 'https://download.wireguard.com/windows-client/';
function wgSigned(file) {
  // Windows PowerShell with its own module path: a PowerShell 7 step's would hide its security module.
  const env = { ...process.env };
  delete env.PSModulePath;
  const sig = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$s = Get-AuthenticodeSignature -LiteralPath '${file}'; "$($s.Status)|$($s.SignerCertificate.Subject)"`], { encoding: 'utf8', env }).trim();
  if (!/^Valid\|.*WireGuard LLC/i.test(sig)) throw new Error(`${path.basename(file)}: signature ${sig}`);
}
let wgName = /wireguard-amd64-([0-9.]+)\.msi/.exec(await (await fetch(`${wgBase}latest.sig`, { headers: { 'User-Agent': 'digi-cyber-build' } })).text());
if (!wgName) {
  const page = await (await fetch(wgBase, { headers: { 'User-Agent': 'digi-cyber-build' } })).text();
  const newest = [...page.matchAll(/wireguard-amd64-([0-9.]+)\.msi/g)].map((m) => m[1]).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
  if (!newest) throw new Error('WireGuard: no amd64 MSI found');
  wgName = [`wireguard-amd64-${newest}.msi`, newest];
}
const wgMsi = await download(`${wgBase}${wgName[0]}`, path.join(tmp, 'wireguard.msi'));
wgSigned(wgMsi);
const wgDir = path.join(tmp, 'wireguard');
execFileSync('msiexec.exe', ['/a', wgMsi, '/qn', `TARGETDIR=${wgDir}`], { stdio: 'inherit' });
fs.mkdirSync(path.join(bin, 'wireguard'), { recursive: true });
for (const f of ['wireguard.exe', 'wg.exe']) {
  const found = find(wgDir, f);
  if (!found) throw new Error(`${f} not found in the WireGuard MSI`);
  const dest = path.join(bin, 'wireguard', f);
  fs.copyFileSync(found, dest);
  wgSigned(dest);
}
versions.push(`wireguard-windows ${wgName[1]}`);

fs.writeFileSync(path.join(bin, 'VERSIONS.txt'), versions.join('\n') + '\n');
console.log(versions.join('\n'));
