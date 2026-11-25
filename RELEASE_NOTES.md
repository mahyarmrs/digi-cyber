## Digi Cyber 1.1.2

Android ping-test improvements, alongside the location and account features from 1.1.1. Android APKs are signed with the configured release key so they install as updates over the previous version.

- Android tests every distinct runnable Xray and WireGuard connection. Up to two isolated Xray probes run at once so a live VPN is never replaced; each connection's result is shown as soon as that test finishes, without waiting for the whole scan.
- A location whose checks have finished without a response no longer stays in a loading state while other locations are still being tested.
- Android keeps the same fixed HTTP 204 URL test as desktop. OpenVPN keeps its Android-specific TCP/ICMP endpoint checks.
- Android supports multiple saved accounts, adding and switching accounts, and signing out of only the active account. Existing single-account data migrates automatically.
- Windows, macOS and Linux retain their shared desktop URL-test and multi-account behavior; macOS uses the same desktop implementation.
- Windows 10/11, macOS (Intel and Apple silicon), Linux (x64 and ARM64), and Android installers.

### Downloads

| System | File |
| --- | --- |
| Windows 10/11 | `Digi-Cyber-Setup-1.1.2.exe` |
| macOS (Apple silicon) | `Digi-Cyber-1.1.2-mac-arm64.pkg` |
| macOS (Intel) | `Digi-Cyber-1.1.2-mac-x64.pkg` |
| Debian / Ubuntu | `Digi-Cyber-1.1.2-linux-x64.deb` (`arm64` on ARM) |
| Fedora / RHEL / openSUSE | `Digi-Cyber-1.1.2-linux-x64.rpm` (`arm64` on ARM) |
| Arch / Manjaro | `Digi-Cyber-1.1.2-linux-x64.pacman` (`arm64` on ARM) |
| Android | `Digi-Cyber-1.1.2-android-<abi>.apk` |

`SHA256SUMS.txt` lists the checksum of every file included in the release.
