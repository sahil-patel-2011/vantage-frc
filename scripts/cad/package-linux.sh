#!/usr/bin/env bash
# Build Linux CAD CLI tarball + AppImage AppDir scaffold (no Fusion add-in).
# Autodesk Fusion 360 is unavailable on Linux — this packages CLI + mock-relay helpers only.
# Usage: bash scripts/cad/package-linux.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/dist/cad-linux"
VERSION="$(node -p "require('$ROOT/packages/vantage-cad-cli/package.json').version" 2>/dev/null || echo "0.1.1")"
ARCH="$(uname -m 2>/dev/null || echo x86_64)"
case "$ARCH" in
  x86_64|amd64) ARCH_TAG="x86_64" ;;
  aarch64|arm64) ARCH_TAG="aarch64" ;;
  *) ARCH_TAG="$ARCH" ;;
esac

echo "==> Packaging base relay tree"
node "$ROOT/scripts/cad/package-relay.mjs"

rm -rf "$OUT"
mkdir -p "$OUT/AppDir/usr/bin" \
  "$OUT/AppDir/usr/lib/vantage-cad" \
  "$OUT/AppDir/usr/share/applications" \
  "$OUT/AppDir/usr/share/metainfo" \
  "$OUT/tarball"

# CLI only — never ship Fusion add-in as a Linux runtime requirement
cp -R "$ROOT/dist/cad-relay/vantage-cad-cli" "$OUT/AppDir/usr/lib/vantage-cad/"
cp "$ROOT/scripts/cad/install-cli.sh" "$OUT/AppDir/usr/lib/vantage-cad/"
cp "$ROOT/scripts/cad/install-linux-relay.sh" "$OUT/AppDir/usr/lib/vantage-cad/" 2>/dev/null || true

cat > "$OUT/AppDir/AppRun" <<'APPRUN'
#!/bin/sh
HERE="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")"
export PATH="$HERE/usr/bin:$PATH"
if [ -x "$HERE/usr/bin/vantage-cad" ]; then
  exec "$HERE/usr/bin/vantage-cad" "$@"
fi
# Fallback: run via node + tsx from staged package
CLI="$HERE/usr/lib/vantage-cad/vantage-cad-cli"
if command -v node >/dev/null 2>&1; then
  if [ -f "$CLI/bin/vantage-cad.mjs" ]; then
    exec node "$CLI/bin/vantage-cad.mjs" "$@"
  fi
  if [ -f "$CLI/src/cli.ts" ] && command -v npx >/dev/null 2>&1; then
    exec npx --yes tsx "$CLI/src/cli.ts" "$@"
  fi
fi
echo "vantage-cad: Node.js >=22 required" >&2
exit 1
APPRUN
chmod +x "$OUT/AppDir/AppRun"

# Fix: usr/bin wrapper should call AppDir AppRun relative to AppDir root
cat > "$OUT/AppDir/usr/bin/vantage-cad" <<'BIN'
#!/bin/sh
HERE="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec "$HERE/../../AppRun" "$@"
BIN
chmod +x "$OUT/AppDir/usr/bin/vantage-cad"

cat > "$OUT/AppDir/vantage-cad.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Vantage CAD
Comment=Vantage FRC CAD desktop CLI (Onshape / mock Fusion relay)
Exec=vantage-cad
Icon=vantage-cad
Categories=Development;Engineering;
Terminal=true
EOF

# Minimal SVG icon placeholder (AppImage tooling expects an icon)
mkdir -p "$OUT/AppDir/usr/share/icons/hicolor/scalable/apps"
cat > "$OUT/AppDir/usr/share/icons/hicolor/scalable/apps/vantage-cad.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="16" fill="#0b1115"/>
  <path d="M28 96 L64 24 L100 96 Z" fill="none" stroke="#16d9e8" stroke-width="8"/>
</svg>
SVG
cp "$OUT/AppDir/usr/share/icons/hicolor/scalable/apps/vantage-cad.svg" "$OUT/AppDir/vantage-cad.svg"

cat > "$OUT/AppDir/usr/share/metainfo/app.vantage.cad.metainfo.xml" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>app.vantage.cad</id>
  <name>Vantage CAD</name>
  <summary>FRC CAD desktop CLI — Onshape hosted + mock Fusion relay on Linux</summary>
  <metadata_license>MIT</metadata_license>
  <project_license>LicenseRef-Proprietary</project_license>
  <description>
    <p>Cross-platform Vantage CAD CLI. Linux does not support Autodesk Fusion 360; use Onshape or VANTAGE_CAD_MOCK=1.</p>
  </description>
  <launchable type="desktop-id">vantage-cad.desktop</launchable>
</component>
EOF

# Portable tarball (primary Linux artifact for CI)
TAR_NAME="vantage-cad-cli-${VERSION}-linux-${ARCH_TAG}.tar.gz"
tar -czf "$OUT/tarball/$TAR_NAME" \
  -C "$OUT/AppDir" \
  AppRun vantage-cad.desktop vantage-cad.svg usr

# Optional: invoke appimagetool when present
APPIMAGE_OUT="$OUT/VantageCAD-${VERSION}-${ARCH_TAG}.AppImage"
if command -v appimagetool >/dev/null 2>&1; then
  echo "==> Building AppImage with appimagetool"
  ARCH="$ARCH_TAG" appimagetool "$OUT/AppDir" "$APPIMAGE_OUT" || true
elif [[ -x "$ROOT/scripts/cad/linux/appimagetool" ]]; then
  ARCH="$ARCH_TAG" "$ROOT/scripts/cad/linux/appimagetool" "$OUT/AppDir" "$APPIMAGE_OUT" || true
else
  echo "==> appimagetool not found — AppDir + tarball produced (CI can run appimagetool later)"
  echo "    Download: https://github.com/AppImage/appimagetool/releases"
fi

node -e "
const fs=require('fs');
const path=require('path');
const out=process.argv[1];
const version=process.argv[2];
const tarName=process.argv[3];
const arch=process.argv[4];
fs.writeFileSync(path.join(out,'MANIFEST.json'), JSON.stringify({
  platform: 'linux',
  version,
  arch,
  generatedAt: new Date().toISOString(),
  artifacts: {
    tarball: 'tarball/' + tarName,
    appDir: 'AppDir/',
    appImage: 'VantageCAD-' + version + '-' + arch + '.AppImage (when appimagetool available)',
  },
  fusionAddin: false,
  onshapeHosted: true,
  mockFusionRelay: true,
  signing: { status: 'unsigned' },
  note: 'Autodesk Fusion 360 is not available on Linux.',
  installFallback: 'bash scripts/cad/install-cli.sh && bash scripts/cad/install-linux-relay.sh',
  doctor: 'vantage-cad doctor',
}, null, 2));
" "$OUT" "$VERSION" "$TAR_NAME" "$ARCH_TAG"

cp "$ROOT/scripts/cad/linux/README.md" "$OUT/README.md" 2>/dev/null || true

echo "Linux packaging output → $OUT"
echo "  Tarball: $OUT/tarball/$TAR_NAME"
