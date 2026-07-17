# Fusion 360 official connector (VantageCadRelay)

Local Autodesk Fusion 360 add-in for the Vantage desktop relay. **Not hosted CAD** — Vercel never runs Fusion.

## Layout

```text
VantageCadRelay/
  VantageCadRelay.manifest
  VantageCadRelay.py          # loopback HTTP :32145 — /health, /execute
```

## Install

| OS | Script | Autodesk Fusion |
|----|--------|-----------------|
| Windows | `scripts/cad/install-fusion-addin.ps1` | Supported |
| macOS | `scripts/cad/install-fusion-addin.sh` | Supported |
| Linux | n/a | **Unavailable** — use Onshape or `VANTAGE_CAD_MOCK=1` |

Manual paths:

- Windows: `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\VantageCadRelay`
- macOS: `~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/VantageCadRelay`

In Fusion: **Utilities → Add-Ins → Scripts and Add-Ins** → run **VantageCadRelay**. Then `vantage-cad start`.

## Protocol

- Bind **127.0.0.1 only**
- Verify HMAC signed envelopes (`FUSION_RELAY_SIGNING_SECRET`, protocol `2026-07-1`)
- Allowlisted operations only; idempotent by job/step/nonce
- Implemented mutations: `create_sketch`, `create_extrude`, plus verify/checkpoint/render
- Other allowlisted ops return explicit not-implemented errors (no fake production geometry)

## Packaging / signing

`node scripts/cad/package-relay.mjs` builds an **unsigned** `dist/cad-relay/` tree. Authenticode / Apple notarization can wrap the same folder later when certs exist.

## Mock

Without Autodesk: `VANTAGE_CAD_MOCK=1 vantage-cad start` uses the in-process Node mock plugin.
