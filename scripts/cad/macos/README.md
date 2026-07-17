# macOS CAD packaging (unsigned scaffold)

## What ships

| Artifact | Path | Notes |
|----------|------|-------|
| Install scripts | `scripts/cad/install-cli.sh`, `install-fusion-addin.sh` | Primary path today |
| Package scaffold | `bash scripts/cad/package-macos.sh` → `dist/cad-macos/` | pkgbuild/productbuild when run on macOS |
| Component / product pkg | `VantageCadRelay-component.pkg`, `VantageCadRelay.pkg` | Built only on Darwin CI/runners |
| DMG | `VantageCadRelay.dmg` | Optional `hdiutil` wrap of the product pkg |

## OS matrix

| Capability | macOS |
|------------|-------|
| `vantage-cad` CLI | Yes |
| Fusion 360 Autodesk app | Yes |
| VantageCadRelay add-in | Yes |
| Onshape hosted | Yes (browser OAuth) |

## Signing / notarization (blocked)

Apple Developer ID + notarization are **not** configured in this repo. `MANIFEST.json` reports `signing.status: unsigned`.

When certs exist:

1. `codesign --sign "Developer ID Application: …" …`
2. `productbuild` / `pkgbuild` with signed component
3. `xcrun notarytool submit … --wait`
4. Staple: `xcrun stapler staple VantageCadRelay.pkg`

Never commit `.p12` / App Store Connect API keys.

## Local install (recommended until notarized packages exist)

```bash
bash scripts/cad/install-cli.sh
bash scripts/cad/install-fusion-addin.sh
export VANTAGE_URL=https://vantage-frc-web.vercel.app
vantage-cad setup
vantage-cad doctor
```
