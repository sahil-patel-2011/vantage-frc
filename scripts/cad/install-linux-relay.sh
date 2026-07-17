#!/usr/bin/env bash
# Linux-friendly CAD relay helper: install CLI + verify doctor + document Fusion limits.
# Does NOT install a Fusion add-in (Autodesk Fusion is unavailable on Linux).
# Usage: bash scripts/cad/install-linux-relay.sh
set -euo pipefail

OS="$(uname -s)"
if [[ "$OS" != "Linux" ]]; then
  echo "This helper targets Linux. On macOS use install-cli.sh + install-fusion-addin.sh."
  echo "On Windows use install-windows.ps1 / install-cli.ps1."
  exit 2
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Linux CAD relay path (Onshape hosted + optional mock Fusion protocol)"
echo "    Autodesk Fusion 360: UNSUPPORTED on Linux"
echo ""

bash "$ROOT/scripts/cad/install-cli.sh"

echo ""
echo "==> Doctor (local diagnostics)"
export VANTAGE_URL="${VANTAGE_URL:-http://localhost:3001}"
if command -v vantage-cad >/dev/null 2>&1; then
  vantage-cad doctor || true
else
  echo "vantage-cad not on PATH yet — open a new shell or use npx tsx packages/vantage-cad-cli/src/cli.ts doctor"
fi

cat <<'EOF'

Next steps (Linux):
  1. Onshape (recommended): pair with platform=onshape, authorize at /cad/connections
       export VANTAGE_URL=https://vantage-frc-web.vercel.app
       vantage-cad setup
       vantage-cad doctor

  2. Mock Fusion relay protocol tests (no Autodesk):
       export VANTAGE_CAD_MOCK=1
       vantage-cad setup   # choose Fusion if testing relay envelopes
       vantage-cad start   # boots in-process mock on 127.0.0.1:32145
       vantage-cad doctor

  3. Optional portable artifacts:
       bash scripts/cad/package-linux.sh
       # → dist/cad-linux/tarball/*.tar.gz and AppDir (AppImage if appimagetool present)

EOF
