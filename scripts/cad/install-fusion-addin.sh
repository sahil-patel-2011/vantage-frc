#!/usr/bin/env bash
# Copy the Vantage Fusion 360 add-in into the Autodesk AddIns folder (macOS).
# Fusion itself is not available on Linux — this script exits with guidance there.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/packages/fusion360-official-connector/VantageCadRelay"

OS="$(uname -s)"
if [[ "$OS" == "Linux" ]]; then
  echo "Autodesk Fusion 360 is not available on Linux."
  echo "Use Onshape hosted CAD, or test the relay protocol with:"
  echo "  VANTAGE_CAD_MOCK=1 vantage-cad start"
  exit 2
fi

if [[ "$OS" != "Darwin" ]]; then
  echo "Use install-fusion-addin.ps1 on Windows."
  exit 2
fi

DEST="${HOME}/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/VantageCadRelay"
mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

echo "Installed Fusion add-in to:"
echo "  $DEST"
echo ""
echo "In Fusion 360:"
echo "  1. Utilities → Add-Ins → Scripts and Add-Ins"
echo "  2. Add / select VantageCadRelay"
echo "  3. Run it (loopback http://127.0.0.1:32145)"
echo "  4. vantage-cad start"
echo ""
echo "Optional: export FUSION_RELAY_SIGNING_SECRET to match the Vantage server."
echo "Notarization / code signing of a .pkg/.dmg can wrap this folder later; this script is the unsigned install path."
