## Digi Cyber 1.0.1

A maintenance release with account management, location ping, and macOS DNS improvements for the desktop app.

- Save multiple subscription accounts and switch between them without signing out of the others.
- Measure location ping using an HTTP request to `http://google.com/generate_204` through each Xray/WireGuard config.
- Apply and restore macOS system DNS settings while connected, with recovery after a helper restart.

### Downloads

| System | File |
| --- | --- |
| Windows 10/11 | `Digi-Cyber-Setup.exe` |
| macOS (Apple silicon) | `Digi-Cyber-mac-arm64.pkg` |
| macOS (Intel) | `Digi-Cyber-mac-x64.pkg` |
| Debian / Ubuntu | `Digi-Cyber-linux-amd64.deb` (`arm64` on ARM) |
| Fedora / RHEL / openSUSE | `Digi-Cyber-linux-x86_64.rpm` (`aarch64` on ARM) |
| Arch / Manjaro | `Digi-Cyber-linux-x64.pacman` (`aarch64` on ARM) |
| Android | Release APKs are included only when the release signing key is configured. |

`SHA256SUMS.txt` lists the checksum of every file included in the release.
