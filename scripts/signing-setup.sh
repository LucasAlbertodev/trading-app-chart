#!/bin/bash
# Creates a local code-signing certificate for AlbertosCharts (run once per Mac).
#
# Why: an ad-hoc signed app gets a new identity on every build, so macOS asks for the keychain
# password ("AlbertosCharts wants to use … Safe Storage") after every update. Signed with the same
# certificate, every build keeps the same identity and "Always Allow" sticks.
#
# Everything stays on this Mac, outside the repository:
#   ~/Library/Application Support/AlbertosCharts-signing/
#     signing.keychain-db   a keychain used only for signing (not your login keychain)
#     keychain-password     its random password (readable only by you)
# No admin password and no Apple account are needed. Never commit these files.
set -euo pipefail

NAME="AlbertosCharts Local Signing"
DIR="$HOME/Library/Application Support/AlbertosCharts-signing"
KC="$DIR/signing.keychain-db"
OPENSSL=/usr/bin/openssl   # macOS's LibreSSL: writes a .p12 that `security import` reads

mkdir -p "$DIR"
chmod 700 "$DIR"

FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

# Already set up? The keychain may be locked (it locks on sleep): unlock it before looking.
# Never replace an existing certificate on our own: a new one means a new app identity, and
# macOS would ask for the keychain password again.
if [ -f "$KC" ] && [ "$FORCE" = 0 ]; then
  if [ -f "$DIR/keychain-password" ]; then
    security unlock-keychain -p "$(cat "$DIR/keychain-password")" "$KC" 2>/dev/null || true
  fi
  if security find-certificate -c "$NAME" "$KC" >/dev/null 2>&1; then
    echo "Already set up: $KC"
    security find-certificate -c "$NAME" -Z "$KC" | grep SHA-1
    exit 0
  fi
  echo "A signing keychain exists at $KC but \"$NAME\" could not be read from it." >&2
  echo "Nothing was changed. To create a new certificate anyway (macOS will ask for the keychain" >&2
  echo "password once more after the next update), run: bash scripts/signing-setup.sh --force" >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS="$("$OPENSSL" rand -hex 24)"
P12PASS="$("$OPENSSL" rand -hex 24)"

cat >"$TMP/cert.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
O = AlbertosCharts
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
EOF

"$OPENSSL" req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" 2>/dev/null
"$OPENSSL" pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -out "$TMP/cert.p12" -passout "pass:$P12PASS" 2>/dev/null

rm -f "$KC"
security create-keychain -p "$PASS" "$KC"
security set-keychain-settings "$KC"            # no auto-lock timeout
security unlock-keychain -p "$PASS" "$KC"
security import "$TMP/cert.p12" -k "$KC" -P "$P12PASS" -T /usr/bin/codesign >/dev/null
# Let codesign use the key without a dialog.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$PASS" "$KC" >/dev/null

umask 077
printf '%s' "$PASS" >"$DIR/keychain-password"
chmod 600 "$DIR/keychain-password" "$KC"

echo "Created \"$NAME\" in $KC"
security find-certificate -c "$NAME" -Z "$KC" | grep SHA-1
