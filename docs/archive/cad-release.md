# CAD release & reproducibility

This document describes how to test, package, and ship the Vantage CAD desktop relay across Windows, macOS, and Linux without claiming signed installers that do not yet exist.

## Protocol version

| Field | Value |
|-------|-------|
| Current envelope protocol | `2026-07-1` |
| Compatibility API | `GET /api/cad/compatibility` |
| Min CLI | `0.1.0` |
| Min Fusion add-in | `0.1.0` |

Bump `FUSION_RELAY_PROTOCOL_VERSION` in `packages/cad/src/fusion-relay.ts` when the signed-job wire format or verify rules change. Keep prior ids in `FUSION_RELAY_SUPPORTED_PROTOCOLS` only during an intentional dual-run window.

Probe (no auth):

```bash
curl "$VANTAGE_URL/api/cad/compatibility?cliVersion=0.1.0&protocol=2026-07-1&platform=windows"
```

Optional query params: `protocol`, `cliVersion`, `addinVersion`, `platform` (`windows`|`macos`|`linux` or `win32`|`darwin`).

## Local CI parity

```bash
npm ci
npm run cad:ci
```

Artifacts land in:

- `dist/cad-relay/` — add-in, CLI package tree, install scripts, `MANIFEST.json`
- `dist/cad-archives/` — `.tar.gz` (Unix) or `.zip` (Windows) of the same tree

## GitHub Actions (manual install)

OAuth tokens for this repo often lack the `workflow` scope, so CAD workflows live as examples:

- `scripts/cad/ci/cad.yml.example` — cross-OS unit/integration + unsigned package artifacts
- `scripts/cad/ci/cad-package.yml.example` — Linux/macOS packaging scaffolds

Copy into `.github/workflows/` when a PAT with `workflow` scope is available. Until then, run `npm run cad:ci` locally.

## OS support

| OS | CLI | Fusion add-in | Onshape |
|----|-----|---------------|---------|
| Windows | Yes | Yes | Yes |
| macOS | Yes | Yes | Yes |
| Linux | Yes | **No** | Yes |

Linux: use Onshape OAuth or `VANTAGE_CAD_MOCK=1 vantage-cad start` for protocol tests.

## Signing status

Packages are **unsigned**. Authenticode / Apple notarization are tracked as next steps in `MANIFEST.json` → `signing.nextSteps`.

## Related

- Operator guide: [`CAD_RELAY.md`](../CAD_RELAY.md)
- Skills: `.agents/skills/cad-fusion`, `.agents/skills/cad-onshape`
