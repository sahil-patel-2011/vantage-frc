# Linux CAD packaging (CLI + mock relay)

## Honest limits

**Autodesk Fusion 360 is not available on Linux.** Vantage does not ship a Fusion add-in for Linux. Use:

- **Onshape hosted** (browser OAuth) — production path
- **`VANTAGE_CAD_MOCK=1`** — in-process loopback plugin for relay protocol / CI tests

## Artifacts

```bash
bash scripts/cad/package-linux.sh
```

| Artifact | Path |
|----------|------|
| AppDir scaffold | `dist/cad-linux/AppDir/` |
| Portable tarball | `dist/cad-linux/tarball/vantage-cad-cli-*-linux-*.tar.gz` |
| AppImage | `dist/cad-linux/VantageCAD-*.AppImage` (only if `appimagetool` is on PATH) |
| Manifest | `dist/cad-linux/MANIFEST.json` |

## Install

```bash
bash scripts/cad/install-linux-relay.sh
# or
bash scripts/cad/install-cli.sh
export VANTAGE_URL=https://vantage-frc-web.vercel.app
vantage-cad setup    # prefer Onshape on Linux
vantage-cad doctor
```

## AppImage tooling

CI can download [appimagetool](https://github.com/AppImage/appimagetool/releases) and run `package-linux.sh` on `ubuntu-latest`. Until then the tarball + AppDir are the shippable unsigned artifacts.
