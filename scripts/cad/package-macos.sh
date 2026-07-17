#!/usr/bin/env bash
# Build unsigned macOS CAD packaging artifacts (pkg scaffold + optional dmg staging).
# Run on macOS for real pkgbuild; on other hosts this still emits the unsigned tree CI can wrap later.
# Usage: bash scripts/cad/package-macos.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/dist/cad-macos"
VERSION="$(node -p "require('$ROOT/packages/vantage-cad-cli/package.json').version" 2>/dev/null || echo "0.1.1")"
IDENTIFIER="app.vantage.cad.relay"

echo "==> Packaging base relay tree"
node "$ROOT/scripts/cad/package-relay.mjs"

rm -rf "$OUT"
mkdir -p "$OUT/payload/usr/local/lib/vantage-cad" \
  "$OUT/payload/usr/local/bin" \
  "$OUT/scripts" \
  "$OUT/resources" \
  "$OUT/pkgroot"

# Stage CLI package + macOS Fusion add-in install helper into payload layout
cp -R "$ROOT/dist/cad-relay/vantage-cad-cli" "$OUT/payload/usr/local/lib/vantage-cad/"
cp -R "$ROOT/dist/cad-relay/VantageCadRelay" "$OUT/payload/usr/local/lib/vantage-cad/"
cp "$ROOT/scripts/cad/install-fusion-addin.sh" "$OUT/scripts/"
cp "$ROOT/scripts/cad/install-cli.sh" "$OUT/scripts/"
cp "$ROOT/scripts/cad/macos/postinstall" "$OUT/scripts/postinstall" 2>/dev/null || true
if [[ ! -f "$OUT/scripts/postinstall" ]]; then
  cat > "$OUT/scripts/postinstall" <<'POST'
#!/bin/bash
set -euo pipefail
LIB="/usr/local/lib/vantage-cad"
ln -sfn "$LIB/vantage-cad-cli/bin/vantage-cad.mjs" /usr/local/bin/vantage-cad || true
# Fusion add-in: copy into user Library on first login helper — unsigned pkg cannot assume Autodesk path exists yet
echo "Vantage CAD macOS package installed. Run: bash /usr/local/lib/vantage-cad/../scripts/install-fusion-addin.sh from a repo checkout, or:"
echo "  cp -R $LIB/VantageCadRelay \"\$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/\""
POST
  chmod +x "$OUT/scripts/postinstall"
fi

# Fix postinstall path note — keep scripts alongside
cp "$ROOT/scripts/cad/install-fusion-addin.sh" "$OUT/payload/usr/local/lib/vantage-cad/install-fusion-addin.sh"

cat > "$OUT/resources/welcome.txt" <<EOF
Vantage CAD Relay (macOS) — unsigned scaffold
Version: $VERSION

This package installs the vantage-cad CLI sources under /usr/local/lib/vantage-cad.
Fusion 360 add-in must still be enabled inside Autodesk Fusion (Utilities → Add-Ins).
Code signing / notarization requires an Apple Developer ID (not included).
EOF

cat > "$OUT/distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Vantage CAD Relay</title>
  <organization>app.vantage</organization>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <options customize="never" require-scripts="false" rootVolumeOnly="true"/>
  <welcome file="welcome.txt"/>
  <pkg-ref id="${IDENTIFIER}"/>
  <choices-outline>
    <line choice="default">
      <line choice="${IDENTIFIER}"/>
    </line>
  </choices-outline>
  <choice id="default"/>
  <choice id="${IDENTIFIER}" visible="false">
    <pkg-ref id="${IDENTIFIER}"/>
  </choice>
  <pkg-ref id="${IDENTIFIER}" version="${VERSION}" onConclusion="none">VantageCadRelay-component.pkg</pkg-ref>
</installer-gui-script>
EOF

cp "$ROOT/scripts/cad/macos/README.md" "$OUT/README.md" 2>/dev/null || true

MANIFEST="$OUT/MANIFEST.json"
node -e "
const fs=require('fs');
const path=require('path');
const out=process.argv[1];
const version=process.argv[2];
fs.writeFileSync(path.join(out,'MANIFEST.json'), JSON.stringify({
  platform: 'macos',
  version,
  generatedAt: new Date().toISOString(),
  artifacts: {
    payload: 'payload/',
    distribution: 'distribution.xml',
    componentPkg: 'VantageCadRelay-component.pkg (built on macOS with pkgbuild)',
    productPkg: 'VantageCadRelay.pkg (built on macOS with productbuild)',
    dmgStaging: 'dmg/ (optional hdiutil)',
  },
  fusionAddin: true,
  signing: { status: 'unsigned', notarization: 'blocked-until-apple-developer-id' },
  installFallback: 'bash scripts/cad/install-cli.sh && bash scripts/cad/install-fusion-addin.sh',
}, null, 2));
" "$OUT" "$VERSION"

if [[ "$(uname -s)" == "Darwin" ]] && command -v pkgbuild >/dev/null 2>&1; then
  echo "==> Building component pkg with pkgbuild"
  pkgbuild \
    --root "$OUT/payload" \
    --identifier "$IDENTIFIER" \
    --version "$VERSION" \
    --scripts "$OUT/scripts" \
    --install-location / \
    "$OUT/VantageCadRelay-component.pkg"
  if command -v productbuild >/dev/null 2>&1; then
    productbuild \
      --distribution "$OUT/distribution.xml" \
      --resources "$OUT/resources" \
      --package-path "$OUT" \
      "$OUT/VantageCadRelay.pkg"
    echo "Product pkg: $OUT/VantageCadRelay.pkg"
  fi
  mkdir -p "$OUT/dmg"
  if command -v hdiutil >/dev/null 2>&1 && [[ -f "$OUT/VantageCadRelay.pkg" ]]; then
    cp "$OUT/VantageCadRelay.pkg" "$OUT/dmg/"
    hdiutil create -volname "Vantage CAD Relay" -srcfolder "$OUT/dmg" -ov -format UDZO "$OUT/VantageCadRelay.dmg" || true
  fi
else
  echo "==> Skipping pkgbuild (not macOS or pkgbuild missing). Scaffold ready at $OUT"
  echo "    On a Mac CI runner: bash scripts/cad/package-macos.sh"
fi

echo "macOS packaging output → $OUT"
