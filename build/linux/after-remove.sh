#!/bin/bash

# An upgrade (deb: "upgrade", rpm: 1 copy left) keeps the helper; the new package restarts it.
case "$1" in
  upgrade|1) exit 0 ;;
esac

if [ -d /run/systemd/system ]; then
  systemctl disable --now digi-cyber-helper.service >/dev/null 2>&1 || true
fi
rm -f /etc/systemd/system/digi-cyber-helper.service
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload || true
fi
rm -rf /var/lib/digi-cyber
rm -f /etc/opt/chrome/policies/managed/digi-cyber-webrtc.json /etc/chromium/policies/managed/digi-cyber-webrtc.json /etc/opt/edge/policies/managed/digi-cyber-webrtc.json /etc/brave/policies/managed/digi-cyber-webrtc.json
if command -v nmcli >/dev/null 2>&1; then
  nmcli connection delete id "Digi Cyber L2TP" >/dev/null 2>&1 || true
fi

# Delete the link to the binary
# update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
# not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
else
    rm -f '/usr/bin/${executable}'
fi

APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

# Remove and unload apparmor profile.
if [ -f "$APPARMOR_PROFILE_DEST" ]; then
  # Unload the profile from the running kernel before deleting the file so the
  # policy is not left enforced until the next reboot.  Mirror the chroot guard
  # used in the after-install script — live AppArmor operations are not
  # meaningful inside a chroot.
  # https://wiki.debian.org/AppArmor/HowToUse
  if apparmor_status --enabled > /dev/null 2>&1; then
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
    fi
  fi
  rm -f "$APPARMOR_PROFILE_DEST"
fi