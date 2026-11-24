#!/usr/bin/env bash
# OpenVPN 2.7 for Android, built from the upstream sources with OpenSSL, LZ4 and LZO linked in
# statically: one program per processor family, saved as <jniLibs>/<abi>/libovpnexec.so so that
# Android unpacks it next to the app's other native libraries, where it may be executed.
#
#   ANDROID_NDK_HOME=/path/to/ndk android/openvpn/build.sh android/app/src/main/jniLibs
#
# OpenVPN's own CMake build knows Android (TARGET_ANDROID): instead of configuring a tun device
# itself it asks the app over its management socket (IFCONFIG, ROUTE, OPENTUN, PROTECTFD, ...).
set -euo pipefail

OPENVPN_TAG=v2.7.9
OPENSSL_TAG=openssl-3.5.9
LZ4_TAG=v1.10.0
# LZO 2.10 has no git home of its own; OpenVPN for Android (ics-openvpn) carries the release.
ICS_OPENVPN_COMMIT=660901ce320539aec476bd04bd1999c396d5e778
API=21
ABIS=${ABIS:-armeabi-v7a arm64-v8a x86 x86_64}

out=$(mkdir -p "$1" && cd "$1" && pwd)
ndk=${ANDROID_NDK_HOME:?ANDROID_NDK_HOME must point at an Android NDK}
toolchain="$ndk/toolchains/llvm/prebuilt/linux-x86_64"
work=${OVPN_WORK:-/tmp/ovpn-android}
jobs=$(nproc)

mkdir -p "$work"
cd "$work"

fetch() {
  [ -d "$3" ] || git clone -q --depth 1 --branch "$2" "$1" "$3"
}
fetch https://github.com/OpenVPN/openvpn "$OPENVPN_TAG" openvpn
fetch https://github.com/openssl/openssl "$OPENSSL_TAG" openssl
fetch https://github.com/lz4/lz4 "$LZ4_TAG" lz4
if [ ! -d lzo ]; then
  git init -q ics
  git -C ics remote add origin https://github.com/schwabe/ics-openvpn
  git -C ics sparse-checkout set --no-cone /main/src/main/cpp/lzo/
  git -C ics fetch -q --depth 1 --filter=blob:none origin "$ICS_OPENVPN_COMMIT"
  git -C ics checkout -q FETCH_HEAD
  mv ics/main/src/main/cpp/lzo lzo
  rm -rf ics
fi
grep -q "Changes in 2.10" lzo/NEWS

for abi in $ABIS; do
  ossl_extra=()
  case "$abi" in
    armeabi-v7a) triple=armv7a-linux-androideabi; ossl_target=android-arm; lzo_opt=-O0 ;;
    arm64-v8a) triple=aarch64-linux-android; ossl_target=android-arm64; lzo_opt=-O2 ;;
    # OpenSSL's 32-bit x86 assembly would need text relocations, which Android refuses.
    x86) triple=i686-linux-android; ossl_target=android-x86; lzo_opt=-O2; ossl_extra=(no-asm) ;;
    x86_64) triple=x86_64-linux-android; ossl_target=android-x86_64; lzo_opt=-O2 ;;
    *) echo "unknown ABI $abi" >&2; exit 1 ;;
  esac
  echo "::group::OpenVPN for $abi"
  prefix="$work/prefix-$abi"
  cc="$toolchain/bin/${triple}${API}-clang"
  ar="$toolchain/bin/llvm-ar"
  rm -rf "$prefix" "$work/ssl-$abi" "$work/obj-$abi" "$work/ovpn-$abi"
  mkdir -p "$prefix/lib/pkgconfig" "$prefix/include/lzo" "$work/ssl-$abi" "$work/obj-$abi/lz4" "$work/obj-$abi/lzo"

  # OpenSSL: static libraries only.
  (
    cd "$work/ssl-$abi"
    export ANDROID_NDK_ROOT="$ndk" PATH="$toolchain/bin:$PATH"
    "$work/openssl/Configure" "$ossl_target" "-D__ANDROID_API__=$API" no-shared no-tests no-docs no-ui-console "${ossl_extra[@]}" \
      --prefix="$prefix" --libdir=lib >/dev/null
    make -s -j"$jobs" build_libs >/dev/null
    make -s install_dev >/dev/null
  )

  # LZ4 and LZO: the few sources OpenVPN needs, with pkg-config files for OpenVPN's CMake.
  "$cc" -O2 -fPIC -c "$work/lz4/lib/lz4.c" -o "$work/obj-$abi/lz4/lz4.o"
  "$ar" rcs "$prefix/lib/liblz4.a" "$work/obj-$abi/lz4/lz4.o"
  cp "$work/lz4/lib/lz4.h" "$prefix/include/"
  for src in "$work"/lzo/src/*.c; do
    "$cc" "$lzo_opt" -fPIC -I"$work/lzo/include" -I"$work/lzo/src" -c "$src" -o "$work/obj-$abi/lzo/$(basename "$src" .c).o"
  done
  "$ar" rcs "$prefix/lib/liblzo2.a" "$work/obj-$abi"/lzo/*.o
  cp "$work"/lzo/include/lzo/*.h "$prefix/include/lzo/"
  printf 'prefix=%s\nName: liblz4\nDescription: LZ4\nVersion: %s\nLibs: -L${prefix}/lib -llz4\nCflags: -I${prefix}/include\n' \
    "$prefix" "${LZ4_TAG#v}" >"$prefix/lib/pkgconfig/liblz4.pc"
  printf 'prefix=%s\nName: lzo2\nDescription: LZO\nVersion: 2.10\nLibs: -L${prefix}/lib -llzo2\nCflags: -I${prefix}/include/lzo\n' \
    "$prefix" >"$prefix/lib/pkgconfig/lzo2.pc"

  # OpenVPN with Android's CMake toolchain.
  PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" PKG_CONFIG_PATH="" cmake -S "$work/openvpn" -B "$work/ovpn-$abi" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$ndk/build/cmake/android.toolchain.cmake" \
    -DANDROID_ABI="$abi" -DANDROID_PLATFORM="android-$API" \
    -DCMAKE_BUILD_TYPE=Release -DUNSUPPORTED_BUILDS=ON -DUSE_WERROR=OFF -DBUILD_TESTING=OFF \
    -DENABLE_PKCS11=OFF -DENABLE_DNS_UPDOWN_BY_DEFAULT=OFF \
    -DOPENSSL_ROOT_DIR="$prefix" -DOPENSSL_USE_STATIC_LIBS=TRUE \
    -DCMAKE_EXE_LINKER_FLAGS="-Wl,--build-id=none" >/dev/null
  PKG_CONFIG_LIBDIR="$prefix/lib/pkgconfig" PKG_CONFIG_PATH="" cmake --build "$work/ovpn-$abi" --target openvpn -j"$jobs" >/dev/null

  mkdir -p "$out/$abi"
  "$toolchain/bin/llvm-strip" -o "$out/$abi/libovpnexec.so" "$work/ovpn-$abi/openvpn"
  file "$out/$abi/libovpnexec.so" || true
  echo "::endgroup::"
done
