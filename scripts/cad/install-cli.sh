#!/usr/bin/env bash
# Install Vantage CAD CLI from a local monorepo checkout (macOS / Linux).
# Usage: ./scripts/cad/install-cli.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "==> Installing workspace dependencies"
npm install

echo "==> Building @vantage/cad-cli"
npm run build --workspace=@vantage/cad-cli

echo "==> Linking vantage-cad globally from local package"
npm install -g "$ROOT/packages/vantage-cad-cli"

echo ""
echo "Installed. Next steps:"
echo "  export VANTAGE_URL=https://vantage-frc-web.vercel.app   # or http://localhost:3001"
echo "  vantage-cad setup"
echo "  vantage-cad diagnose"
echo ""
echo "OS notes:"
echo "  macOS / Windows: Fusion 360 add-in supported (see install-fusion-addin.sh / .ps1)"
echo "  Linux: Fusion Autodesk app is unavailable — use Onshape hosted or VANTAGE_CAD_MOCK=1"
