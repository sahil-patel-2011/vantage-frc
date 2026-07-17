# Windows signed installer scaffolding (unsigned today)

Vantage ships a **script-based** Windows path that is deployable without code-signing certificates:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1
```

That installs:

1. `vantage-cad` CLI (global npm link from this monorepo)
2. `VantageCadRelay` into `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\`

## Authenticode / MSI (blocked until certs)

When an Authenticode code-signing certificate is available:

| Piece | Planned artifact | Notes |
|-------|------------------|-------|
| WiX source | `VantageCadRelay.wxs` (stub in this folder) | Harvest CLI + add-in into Program Files + AddIns |
| Sign | `signtool sign /tr http://timestamp.digicert.com …` | Sign MSI and any bundled `.exe` |
| CI | Future GitHub Actions job | Never commit `.pfx` / secrets |

Until then:

- `npm run cad:package` → `dist/cad-relay/` (unsigned tree + `MANIFEST.json`)
- `signing.status` in that manifest stays `"unsigned"`
- Teams install via `install-windows.ps1` from a trusted checkout or release zip

## SmartScreen

Unsigned PowerShell installs may show SmartScreen / execution-policy prompts. Document for mentors: unblock with `-ExecutionPolicy Bypass` only for this trusted script path, or set a team-signed policy later.
