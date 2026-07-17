# Vantage CAD desktop relay

## OS matrix (honest)

| OS | `vantage-cad` CLI | Fusion Autodesk app | VantageCadRelay add-in | Onshape hosted |
|----|-------------------|---------------------|------------------------|----------------|
| Windows | Yes — `install-cli.ps1` / `install-windows.ps1` | Yes | Yes | Browser OAuth |
| macOS | Yes — `install-cli.sh` | Yes | Yes — `install-fusion-addin.sh` | Browser OAuth |
| Linux | Yes — `install-cli.sh` / `install-linux-relay.sh` | **No** | **No** | Browser OAuth |

Linux teams use **Onshape** for real CAD, or `VANTAGE_CAD_MOCK=1` to exercise the signed Fusion relay protocol without Autodesk.

## Install (cross-platform)

```text
# From repo root
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
export VANTAGE_URL=https://vantage-frc-web.vercel.app   # or http://localhost:3001
vantage-cad setup
vantage-cad doctor
```

| OS | One-shot helpers |
|----|------------------|
| Windows | `powershell -ExecutionPolicy Bypass -File .\scripts\cad\install-windows.ps1` |
| macOS | `bash scripts/cad/install-cli.sh && bash scripts/cad/install-fusion-addin.sh` |
| Linux | `bash scripts/cad/install-linux-relay.sh` |

## Packaging artifacts (unsigned, CI-ready)

| Command | Output | Notes |
|---------|--------|-------|
| `npm run cad:package` | `dist/cad-relay/` + archive under `dist/cad-archives/` | Cross-platform tree + `MANIFEST.json` |
| `npm run cad:package:macos` | `dist/cad-macos/` | pkg/dmg scaffold; real `pkgbuild` on Darwin |
| `npm run cad:package:linux` | `dist/cad-linux/` | tarball + AppDir; AppImage if `appimagetool` present |

Signing / notarization / Authenticode remain **blocked until certs** — see `scripts/cad/macos/README.md`, `scripts/cad/linux/README.md`, `scripts/cad/windows/README.md`.

GitHub Actions: `.github/workflows/cad-package.yml` builds Linux + macOS artifacts on path changes.

`setup` opens a browser with a ten-minute one-time pairing code. The user signs in there, selects an existing authorized organization, and chooses Onshape or Fusion 360. No Vantage password is entered in the terminal. The resulting device token is revocable, bound to user/org/machine/scopes, and stored in OS credential storage when optional `keytar` is available; otherwise a `0600` local file is used.

Browser setup wizard: `/cad/setup?orgId=…` (pick CAD → AI brain → copy commands → verify heartbeat).

Commands: `setup`, `start`, `status`, `doctor` (alias `diagnose`), `update`, and `logout`.

### Doctor

```text
vantage-cad doctor
vantage-cad doctor --json
```

Checks Node ≥22, OS capability matrix, credential storage, pairing, Vantage URL reachability, relay heartbeat (when paired), local `ONSHAPE_OAUTH_*` (admin/dev machines), Fusion add-in presence (Win/Mac), and loopback `/health` on the Fusion/mock plugin.

Mock Fusion (CI / no Autodesk): `VANTAGE_CAD_MOCK=1 vantage-cad start` boots an in-process loopback plugin that verifies signed job envelopes.

## Onshape

Hosted Onshape uses least-privilege OAuth and server workers. Admin sets:

```text
ONSHAPE_OAUTH_CLIENT_ID=
ONSHAPE_OAUTH_CLIENT_SECRET=
ONSHAPE_OAUTH_REDIRECT_URI=   # optional; defaults to $BETTER_AUTH_URL/api/cad/onshape/oauth/callback
ONSHAPE_OAUTH_SCOPES=OAuth2Read OAuth2Write
```

Until those exist, Connect stays **Setup required**. When configured: Connections → Connect Onshape OAuth → bind document/workspace/element → approve steps → **Run Onshape**.

Real credentials must be tested only in a disposable document. Agent skill: `.agents/skills/cad-onshape`.

## Fusion 360

Fusion is local (Windows/macOS). Vantage signs an approved, expiring job; the paired relay claims only matching jobs and calls `VantageCadRelay` on loopback. Install the add-in from `packages/fusion360-official-connector/VantageCadRelay` via the scripts above.

**Linux:** Autodesk Fusion is not available. Use Onshape or the mock plugin.

Agent skill: `.agents/skills/cad-fusion`.

## AI provider billing

- **Vantage managed API:** plan/allowance/credits and budget ledger.
- **Team/personal BYOK:** official provider **API** credentials only (encrypted in Vantage). Not ChatGPT Plus / Claude Pro web subscriptions.
- **Terminal / local CLI** (`key_source=local_cli`): Claude Code / Codex CLI / local OpenAI-compatible via `vantage-cad` — **no Vantage model charge** (usage may still be logged at cost 0 for observability).
- **Local OpenAI-compatible:** paired relay + local model host.
- **Claude Code:** optional platform-owner private/local sessions only on the matching paired device; never team/shared/scheduled traffic.

## Agent safety

CAD agent policy uses strong system prompts, allowlisted tools, untrusted-text isolation, destructive-geometry confirmations, and plan → verify loops. Never claims certified engineering.

## Security

Signed Fusion jobs (HMAC), device binding on relay claim, allowlisted operations, explicit approval for mutations, topology/render checkpoints after execute. Pair/poll/relay API routes are session-public but device-token authenticated.
