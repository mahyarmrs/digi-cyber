#!/bin/sh
# Removes Digi Cyber from a Mac: sudo "/Applications/Digi Cyber.app/Contents/Resources/uninstall.sh"
if [ "$(id -u)" != 0 ]; then echo "Run with sudo." >&2; exit 1; fi
launchctl bootout system/com.digicyber.client.helper >/dev/null 2>&1 || true
rm -f /Library/LaunchDaemons/com.digicyber.client.helper.plist /var/run/digi-cyber.sock
rm -rf "/Library/Application Support/Digi Cyber" "/Applications/Digi Cyber.app"
pkgutil --forget com.digicyber.client >/dev/null 2>&1 || true
echo "Digi Cyber removed."
