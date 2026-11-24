#!/usr/bin/env bash
# Two OpenVPN servers on the CI machine for the emulator test (TCP 1194 on 10.8.0.0/24, UDP 1195 on
# 10.9.0.0/24), set up the way Manifold sets up an OpenVPN inbound: tls-crypt, no client certificate,
# a login checked by the server, redirect-gateway and DNS pushed. Each one's client profile, written
# as Manifold writes it, goes to <out>/<tcp|udp>.link as the openvpn:// link the app receives.
# The emulator reaches this machine as 10.0.2.2.
set -euo pipefail

out=$(mkdir -p "$1" && cd "$1" && pwd)
user=z7b21tfbhc
# A space, a quote and a backslash: the app must pass them through the management socket intact.
pass='pa ss"w\rd'

command -v openvpn >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq openvpn >/dev/null; }
openvpn --version | head -1

d=$(mktemp -d)
cd "$d"
openssl ecparam -name prime256v1 -genkey -noout -out ca.key
openssl req -x509 -new -key ca.key -subj "/CN=Digi Cyber test CA" -days 2 -out ca.crt
openssl ecparam -name prime256v1 -genkey -noout -out server.key
openssl req -new -key server.key -subj "/CN=manifold-openvpn-server" -out server.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature\nextendedKeyUsage=serverAuth\n' >ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile ext.cnf -out server.crt 2>/dev/null
openvpn --genkey tls-crypt tc.key
printf '%s\n%s' "$user" "$pass" >login.expected
# OpenVPN hands the login over as a file: the username on the first line, the password on the second.
cat >check.sh <<EOF
#!/bin/sh
[ "\$(head -n 2 "\$1")" = "\$(cat "$d/login.expected")" ]
EOF
chmod +x check.sh

for spec in "tcp 1194 10.8.0.0" "udp 1195 10.9.0.0"; do
  set -- $spec
  proto=$1 port=$2 subnet=$3
  cat >"server-$proto.conf" <<EOF
port $port
proto $([ "$proto" = tcp ] && echo tcp-server || echo udp)
dev tun
dev-type tun
topology subnet
server $subnet 255.255.255.0
ca $d/ca.crt
cert $d/server.crt
key $d/server.key
dh none
tls-crypt $d/tc.key
tls-version-min 1.2
verify-client-cert none
username-as-common-name
duplicate-cn
keepalive 10 60
persist-key
persist-tun
disable-dco
script-security 2
auth-user-pass-verify $d/check.sh via-file
push "redirect-gateway def1 bypass-dhcp"
push "dhcp-option DNS 1.1.1.1"
verb 3
EOF
  sudo openvpn --daemon "ovpn-test-$proto" --config "$d/server-$proto.conf" --log "$d/server-$proto.log"

  # Manifold's Profile.Render.
  profile=$(cat <<EOF
# Digi Cyber test $proto
client
dev tun
proto $([ "$proto" = tcp ] && echo tcp-client || echo udp)
remote ${TEST_REMOTE:-10.0.2.2} $port
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name manifold-openvpn-server name
ignore-unknown-option block-outside-dns
setenv opt block-outside-dns
setenv CLIENT_CERT 0
verb 3
<auth-user-pass>
$user
$pass
</auth-user-pass>
<ca>
$(cat ca.crt)
</ca>
<tls-crypt>
$(cat tc.key)
</tls-crypt>
EOF
)
  printf 'openvpn://%s' "$(printf '%s\n' "$profile" | base64 -w0 | tr '+/' '-_' | tr -d '=')" >"$out/$proto.link"
done

# The emulator's own network (SLIRP) reaches this machine's addresses too, the servers' tunnel
# addresses included, arriving on lo. Dropped there, a reply from 10.8.0.1 or 10.9.0.1 can only
# come through the tunnel.
sudo iptables -I INPUT -i lo -d 10.8.0.1 -j DROP
sudo iptables -I INPUT -i lo -d 10.9.0.1 -j DROP

sleep 2
for proto in tcp udp; do
  sudo tail -n 3 "$d/server-$proto.log"
done
echo "$d" >"$out/dir"
