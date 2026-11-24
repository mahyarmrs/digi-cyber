# Digi Cyber: development notes

How the app is built, what it runs on each system and how it talks to the panel. The download page for customers is the [README](../README.md).

A customer signs in with the subscription link of their service alone; the app then shows their account and servers and connects with the protocols the service offers.

## Signing in

The subscription link is all a customer enters. The panel's app API signs in one of the subscription's accounts by name, so the app first asks the subscription for its summary, `<subscription link>?format=info` (Manifold answers it with JSON that lists the subscription's account names under `emails`), and signs in as the first one. A panel without that summary answers with the subscription itself, and the app says the server cannot sign in with the link alone yet.

A sign-in link carries the subscription link, and may carry the account's name too, which then skips the summary:

```
digicyber://login?sub=<subscription link, percent-encoded>[&user=<username, percent-encoded>]
```

- **Android**: the sign-in page takes the link (or pastes it from the clipboard); *Scan QR* opens the camera (ZXing, works without Google services) and *QR picture* reads the QR code from a screenshot or a photo. Tapping a sign-in link opens the app and signs in.
- **Windows, Linux, macOS**: the app registers `digicyber://`, so opening the link signs in; pasting it into the subscription link field works too.

Opening a link of another account while signed in asks before switching.

Runs on Windows 10 and 11 (64-bit), Linux (Debian, Ubuntu and their family, Fedora, RHEL, openSUSE, Arch and Manjaro; x64 and ARM64) macOS 12 or later (Intel and Apple silicon) and Android 5.0 or later (every processor family; see `android/README.md`). iOS users keep using the subscription link in Streisand, Happ or other apps, and share the same device limit with the app.

## Installing

| System | Installer | How |
| --- | --- | --- |
| Windows | `Digi-Cyber-Setup-<version>.exe` | Run it. Windows SmartScreen asks once (More info → Run anyway) until the installer is code-signed. |
| Debian, Ubuntu, Mint, Pop!_OS | `Digi-Cyber-<version>-linux-amd64.deb` (`arm64` on ARM) | `sudo apt install ./Digi-Cyber-<version>-linux-amd64.deb` |
| Fedora, RHEL, Rocky, AlmaLinux, openSUSE | `Digi-Cyber-<version>-linux-x86_64.rpm` (`aarch64` on ARM) | `sudo dnf install ./Digi-Cyber-<version>-linux-x86_64.rpm` (openSUSE: `sudo zypper install …`) |
| Arch, Manjaro, EndeavourOS | `Digi-Cyber-<version>-linux-x64.pacman` (`aarch64` on ARM) | `sudo pacman -U ./Digi-Cyber-<version>-linux-x64.pacman` |
| macOS, Apple silicon | `Digi-Cyber-<version>-mac-arm64.pkg` | Open it. Until the package is notarized macOS refuses the first time: open **System Settings → Privacy & Security** and press **Open Anyway**. It installs for all users of the Mac and asks for the Mac's password, since it sets up the helper. |
| macOS, Intel | `Digi-Cyber-<version>-mac-x64.pkg` | As above. |
| Android 5.0+ | `Digi-Cyber-<version>-android-arm64-v8a.apk` (most phones), `armeabi-v7a` (older phones), `x86_64`/`x86` (emulators, a few tablets), or `universal` (any) | Open the APK and allow installing from that source once. |

Each package installs the app and its helper service and removes both when uninstalled (`sudo apt remove digi-cyber`, `sudo dnf remove digi-cyber`, `sudo pacman -R digi-cyber`; on macOS `sudo "/Applications/Digi Cyber.app/Contents/Resources/uninstall.sh"`). Nothing else is installed or left running. Every release lists the SHA-256 of each file in `SHA256SUMS.txt`.

### Linux and macOS: the helper

A VPN needs administrator rights for the tunnel, routes, DNS and timezone, while the app's window should run as the user. So on Linux and macOS the engines run in a small root helper, the same program started without its window: a systemd service (`digi-cyber-helper`) on Linux and a LaunchDaemon (`com.digicyber.client.helper`) on macOS. The app talks to it over a local socket (`/run/digi-cyber/helper.sock`, `/var/run/digi-cyber.sock`) with five requests: who are you, status, connect, disconnect and its log. The helper checks what it is given, since anyone on the computer can reach the socket: OpenVPN profiles that would run programs, read files or open a control port are refused, Xray outbounds lose any file they would read, and DNS, timezone and program names must be plain values.

What differs by system:

| | Windows | Linux | macOS | Android |
| --- | --- | --- | --- | --- |
| Xray protocols and WireGuard | ✓ | ✓ | ✓ | ✓ |
| OpenVPN | bundled (2.6, on the TAP-Windows6 and ovpn-dco adapters the app adds) | the system's `openvpn` package (installed with the app) | Homebrew's: `brew install openvpn` | bundled (2.7, built from source, see `android/README.md`) |
| L2TP/IPsec | Windows' own client | NetworkManager with its L2TP plugin (`network-manager-l2tp`, `NetworkManager-l2tp` or `networkmanager-l2tp`, recommended by the package) | not offered: macOS sets up L2TP only from a profile the user installs by hand | not offered: apps cannot drive Android's own client, and Android 12 removed it |
| Kill switch, split tunneling, Iranian sites direct | ✓ | ✓ | ✓ | Android's own kill switch, apps without VPN; Iranian sites direct on Xray and WireGuard |
| WebRTC leak protection | Chrome, Edge, Brave policy | the same policy as a file in `/etc/…/policies/managed` | not offered | not offered |
| Match timezone | `tzutil` | `timedatectl` | `systemsetup` | not offered |
| Launch at startup | scheduled task | `~/.config/autostart` | login item | Android's Always-on VPN |

## How it works

The app talks to the Manifold panel's app API on the subscription server (`<subscription link>/app/v1`):

| Call | What it does |
| --- | --- |
| `GET <subscription link>?format=info` | The subscription's summary; the app takes the first of its account names (`emails`) to sign in with. |
| `POST /login` | The username of one of the link's accounts plus a device id (from Windows' MachineGuid) returns a session token. The device takes a slot of the account's device limit. |
| `GET /profile` | The account (usage, expiry, devices), the locations, every configuration of the subscription, with the Xray outbound of each one Xray runs, and the panel's notices (Manifold 0.18+). |
| `POST /logout` | Ends the session. |

App access is switched on in the panel under **Settings → App**, where each server also gets its name, country, city and timezone.

The app fetches the profile again every 10 minutes, when the computer wakes, and when the refresh button in the sidebar is pressed, so locations, configs and notices changed on the panel reach it within that time. When the panel cannot be reached the last profile is kept and the button says so.

**Notices** are published from the panel under **Settings → App notices** at a level: info goes to the notices drawer (the bell in the sidebar), warning and critical also show as an amber or red strip at the top of every page until closed with its ✕, and one that arrives while the window is in the tray comes as a system notification too. Notices are written in Persian, so they are always laid out right to left in Estedad, also when the app is in English. The bell counts what arrived since it was last opened.

OpenVPN and L2TP need a login: the panel puts the account's username and password in the OpenVPN profile (always, for the app) and in the L2TP link, and the app connects with them, so the customer never types them.

Engines, all started by the app (which runs as administrator):

| Protocols | Engine |
| --- | --- |
| VLESS, VMess, Trojan, Shadowsocks, Hysteria 2, WireGuard | `xray.exe` with the outbound from the panel (WireGuard's built from its link), behind `sing-box.exe` as the system-wide TUN (wintun). The engines' own traffic leaves directly; DNS goes through the tunnel. The server's name is looked up before connecting and handed to Xray, so Xray never asks its own tunnel where its server is. |
| OpenVPN | `openvpn.exe` 2.6 with the panel's profile, stopped through its management port. OpenVPN only opens an adapter that already exists, so the first time it is used the app adds the TAP-Windows6 and ovpn-dco drivers it ships (both signed by Microsoft) with `pnputil` and an adapter of each with `tapctl` (*Digi Cyber TAP*, *Digi Cyber DCO*); OpenVPN takes ovpn-dco (Windows 10 2004 and later) when the profile allows it and TAP otherwise, and the app tries TAP again if ovpn-dco fails. Uninstalling removes both adapters. |
| L2TP/IPsec | Windows' own client: a VPN connection added with `Add-VpnConnection` and dialled with `rasdial`. |

**Automatic** tries the Xray protocols of the chosen location first, then WireGuard, OpenVPN and L2TP, and keeps the first that answers (an Xray config must fetch `https://www.gstatic.com/generate_204` through itself).

The window has a sidebar (home, locations, statistics, settings, notices and the account), a hero card on the home page that carries the connection (state, location, protocol, ping and the action; it turns into the logo's gradient once protected), the plan's traffic as a bar (amber from 80%, red from 95%), time connected this week, and quick protection switches, with the locations always beside home and statistics: search, a protocol filter and every country quickest first. The locations page lists countries beside the chosen country's servers; statistics show the plan's traffic and the last 30 days; settings are an index beside cards of rows. The Android app follows the same look: the hero card, four tabs (home, locations, protection, account) and notices behind the bell. Ping is the TCP connect time to each server, or an ICMP echo through the system's `ping` for servers that answer on UDP only (WireGuard, Hysteria, L2TP, OpenVPN over UDP) or refuse the TCP connect. Persian (right to left) and English, dark, light or the system's theme, in Alexandria (Latin) and Estedad (Persian). Country names come from Natural Earth (via `world-atlas`) and `i18n-iso-countries`, written once by `scripts/gen-map.mjs`. `node scripts/preview/shoot.mjs <playwright> out.png [query]` renders the built window in Chrome with a demo account (`scripts/preview/mock-dc.js`), for screenshots.

Settings:

- **Protocol**: automatic, or only Xray, WireGuard, OpenVPN or L2TP.
- **Kill switch** (Xray and WireGuard): the TUN runs with `strict_route`, and if Xray stops the tunnel stays up with nothing behind it until the user disconnects.
- **Reconnect automatically**: a dropped connection is tried again up to three times.
- **Block ads and trackers**: `geosite:category-ads-all` goes to Xray's blackhole.
- **Custom DNS**: the servers sing-box asks through the tunnel and Xray resolves server names with.
- **Split tunneling** (Xray and WireGuard): chosen `.exe` files leave directly by sing-box process rule, and **Iranian sites without VPN** sends `geosite:category-ir`, `.ir` and `geoip:ir` direct.
- **WebRTC leak protection**: sets the `WebRtcIPHandling` policy of Chrome, Edge and Brave to `disable_non_proxied_udp` while connected, and restores it after.
- **Match timezone**: sets Windows' timezone to the location's (`tzutil`) while connected and restores it after.
- Launch at startup (a scheduled task, since the app needs administrator rights), launch minimized to the tray, connect when the app starts, connection notifications, language and appearance.

The session token and the profile are stored sealed with Electron's `safeStorage` (DPAPI).

## Icons

`brand/mark.py` holds the mark's shapes; `python3 brand/gen-icons.py` draws every desktop, tray and Android launcher size from them and `python3 brand/gen-android-icons.py` the Android vector icons.

## Logs and support reports

Every app keeps a log from the moment it starts: each connection attempt (which config, the server's address, how long it took and why it failed), the engines' messages (Xray in detail while a config is tested, then only its warnings, so the sites a user opens stay out; sing-box, OpenVPN, rasdial or NetworkManager for L2TP; on Linux and macOS the helper's log), profile refreshes and errors, and the end of the previous run's log in case it crashed. Links, ids, keys, passwords and tokens are taken out as each line is written; the username stays, so support knows whose it is.

**Settings → Support** (desktop) and **Account → Report a problem** (Android) show it, copy it, save it to a file (desktop) or share it (Android), and **Send log to support** posts it with the user's message to the panel: `POST <subscription link>/app/v1/report` with the session's `Authorization: Bearer` and `X-HWID`, a gzipped JSON body (`Content-Encoding: gzip`) of `message`, `log`, `deviceId`, `deviceName`, `os`, `osVersion` and `appVersion`, answered `{"id": <report number>}`. The panel knows the account from the session and files the report under its username and numeric id. A panel without the endpoint answers 404, and the app says so and offers the other ways. A failed connection's banner on the home page links to it.

## Development

Node 22. The app is Electron with a React window; the main process is bundled with esbuild, the window with Vite.

```
npm ci
npm test          # unit tests
npm run typecheck
npm run build     # dist/
```

`node scripts/fetch-binaries.mjs <win|linux|mac> <x64|arm64>` downloads the engines into `resources/bin/<os>-<arch>`: the latest Xray (checked against its published SHA-256) and sing-box from their GitHub releases, and on Windows OpenVPN 2.6 with `tapctl` from its MSI and the TAP-Windows6 9.27 and ovpn-dco-win 2.8.7 drivers (pinned by SHA-256). `npm run dist:win`, `dist:linux` and `dist:mac` build the installers into `release/`. The helper is `src/helper/helper.ts`, bundled to `dist/helper/helper.js`.

CI (`.github/workflows/build.yml`) runs the tests, then for each system fetches the engines, checks the configurations the app writes with the real `xray run -test` and `sing-box check`, and builds the installers. On Linux it installs the deb on the runner, checks the helper service answers on its socket and removes the package, and installs the deb, rpm and pacman packages in Debian, Ubuntu, Fedora and Arch containers to check every dependency resolves. macOS (Intel and Apple silicon from one runner) builds for a release, when the workflow is started by hand with **macOS** ticked, and on a pull request labelled `macos`; it checks each package installs only system-wide (a home-folder install is refused), installs the Apple silicon package, checks the signature, that the helper answers, and uninstalls. A push to `main` whose `package.json` version has no release yet (or a `v*` tag, or a release made on GitHub's Releases page, or **Run workflow** with *Publish* ticked) publishes every installer with `SHA256SUMS.txt` as that version's release on this repository, each also under a name without the version (`Digi-Cyber-Setup.exe`, …) so `releases/latest/download/<name>` always gives the newest; macOS is built for it too. The Android APKs go into a release only when they are signed with the release key (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`; see `android/README.md`).

Nothing is code-signed with a paid certificate yet: Windows SmartScreen asks once (More info → Run anyway) and macOS needs **Open Anyway** once. The macOS app is signed ad hoc, which Apple silicon requires to run at all. A Windows code-signing certificate and an Apple Developer ID (with notarization) remove both prompts; the build only needs them added as secrets.
