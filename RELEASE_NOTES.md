## Digi Cyber 1.1.1

Android feature-parity update for location checks and account management. Android APKs are signed with the configured release key so they install as updates over the previous version.

- Android: URL tests for Xray and WireGuard check the same fixed HTTP 204 endpoint as desktop, using a separate Xray instance so a live VPN connection is not replaced. OpenVPN keeps its Android-specific TCP/ICMP endpoint checks.
- Android: save multiple accounts, add and switch accounts, and sign out of only the active account. Existing single-account data is migrated automatically.
- Windows, macOS and Linux retain the shared desktop URL-test and multi-account behavior; macOS uses the same desktop implementation.
- Windows 10/11, macOS (Intel and Apple silicon), Linux (x64 and ARM64), and Android installers.

### Downloads

| System | File |
| --- | --- |
| Windows 10/11 | `Digi-Cyber-Setup-1.1.1.exe` |
| macOS (Apple silicon) | `Digi-Cyber-1.1.1-mac-arm64.pkg` |
| macOS (Intel) | `Digi-Cyber-1.1.1-mac-x64.pkg` |
| Debian / Ubuntu | `Digi-Cyber-1.1.1-linux-x64.deb` (`arm64` on ARM) |
| Fedora / RHEL / openSUSE | `Digi-Cyber-1.1.1-linux-x64.rpm` (`arm64` on ARM) |
| Arch / Manjaro | `Digi-Cyber-1.1.1-linux-x64.pacman` (`arm64` on ARM) |
| Android | `Digi-Cyber-1.1.1-android-<abi>.apk` |

`SHA256SUMS.txt` lists the checksum of every file included in the release.
