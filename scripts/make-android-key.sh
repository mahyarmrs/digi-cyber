#!/usr/bin/env bash
# Makes the Android release signing key, once, and writes the four values the repository's Actions
# secrets need. Every APK release must be signed with this same key, or customers have to uninstall
# to update: keep the keystore and its password somewhere safe and offline, never in the repository.
#
#   bash scripts/make-android-key.sh [folder]      (needs keytool: any JDK, or Android Studio's)
set -euo pipefail

out="${1:-android-signing}"
if [ -e "$out/release.jks" ]; then
  echo "$out/release.jks exists already; this makes a key only once." >&2
  exit 1
fi
command -v keytool >/dev/null || { echo "keytool not found: install a JDK (or use the one inside Android Studio)." >&2; exit 1; }
mkdir -p "$out"
chmod 700 "$out"
password="$(set +o pipefail; LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
alias=release

keytool -genkeypair -keystore "$out/release.jks" -storetype PKCS12 -alias "$alias" -keyalg RSA -keysize 4096 \
  -validity 10950 -dname "CN=Digi Cyber" -storepass "$password" -keypass "$password" >/dev/null

base64 <"$out/release.jks" | tr -d '\n' >"$out/ANDROID_KEYSTORE_BASE64.txt"
cat >"$out/secrets.txt" <<EOF
Add these in the repository: Settings -> Secrets and variables -> Actions -> New repository secret

ANDROID_KEYSTORE_BASE64   = the whole content of ANDROID_KEYSTORE_BASE64.txt
ANDROID_KEYSTORE_PASSWORD = $password
ANDROID_KEY_ALIAS         = $alias
ANDROID_KEY_PASSWORD      = $password

Then: Actions -> Build -> Run workflow (main) with "Publish" ticked, so the APKs go into the release.
EOF
chmod 600 "$out"/*
echo "Done: $out/release.jks and $out/secrets.txt. Keep this folder out of git and back it up offline."
