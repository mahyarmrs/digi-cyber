# Open-source components in Digi Cyber

Digi Cyber's installers also carry the open-source programs below, each under its own license. The engines run as separate programs the app starts; their source is at the upstream projects linked here, at the release each Digi Cyber version was built from.

| Component | Used for | License | Source |
| --- | --- | --- | --- |
| Xray-core | VLESS, VMess, Trojan, Shadowsocks, Hysteria 2, WireGuard | MPL-2.0 | https://github.com/XTLS/Xray-core |
| sing-box | The system-wide tunnel on Windows, Linux and macOS | GPL-3.0-or-later | https://github.com/SagerNet/sing-box |
| Wintun | sing-box's network adapter on Windows | Wintun prebuilt binaries license | https://www.wintun.net |
| OpenVPN | OpenVPN connections (Windows and Android builds) | GPL-2.0 with the OpenSSL linking exception | https://github.com/OpenVPN/openvpn |
| TAP-Windows6 | OpenVPN's adapter on Windows | GPL-2.0 | https://github.com/OpenVPN/tap-windows6 |
| ovpn-dco-win | OpenVPN's fast adapter on Windows | see upstream | https://github.com/OpenVPN/ovpn-dco-win |
| WireGuard for Windows (wireguard.exe, wg.exe, with WireGuardNT) | WireGuard on Windows | MIT; WireGuardNT's prebuilt driver under WireGuard LLC's binary license | https://git.zx2c4.com/wireguard-windows · https://git.zx2c4.com/wireguard-nt |
| OpenSSL | OpenVPN's cryptography on Android | Apache-2.0 | https://github.com/openssl/openssl |
| LZ4, LZO | OpenVPN compression on Android | BSD-2-Clause, GPL-2.0 | https://github.com/lz4/lz4 · https://www.oberhumer.com/opensource/lzo/ |
| hev-socks5-tunnel | Android's tunnel to Xray | MIT | https://github.com/heiher/hev-socks5-tunnel |
| Electron | The desktop app | MIT | https://github.com/electron/electron |
| ZXing | QR code scanning on Android | Apache-2.0 | https://github.com/zxing/zxing |
| Estedad | Persian font (desktop and Android) | OFL-1.1 | https://github.com/aminabedi68/Estedad |
| Alexandria | Latin font (desktop) | OFL-1.1 | https://github.com/Gue3bara/Alexandria |
| Lucide | Icons | ISC | https://github.com/lucide-icons/lucide |
| Natural Earth via world-atlas | Country names and centres | Public domain / ISC | https://github.com/topojson/world-atlas |
| flag-icons | Country flags | MIT | https://github.com/lipis/flag-icons |

The desktop installers carry these license texts in the app's `resources/bin/licenses` folder; each full text is also in the component's repository linked above. For the exact source of a GPL component of a given Digi Cyber release, ask your service's support and it will be provided.
