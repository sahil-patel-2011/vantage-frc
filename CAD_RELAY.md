# Vantage CAD desktop relay

## Install (cross-platform)

| OS | CLI | Fusion add-in | Onshape hosted |
|----|-----|---------------|----------------|
| Windows | `scripts/cad/install-cli.ps1` | `scripts/cad/install-fusion-addin.ps1` | Browser OAuth |
| macOS | `scripts/cad/install-cli.sh` | `scripts/cad/install-fusion-addin.sh` | Browser OAuth |
| Linux | `scripts/cad/install-cli.sh` | **Unsupported** (no Autodesk Fusion) | Browser OAuth |

```text
# From repo root
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
export VANTAGE_URL=https://vantage-frc-web.vercel.app   # or http://localhost:3001
vantage-cad setup
```

Unsigned artifact tree: `node scripts/cad/package-relay.mjs` → `dist/cad-relay/` (ready for future signed .msi/.pkg/.AppImage wrappers).

`setup` opens a browser with a ten-minute one-time pairing code. The user signs in there, selects an existing authorized organization, and chooses Onshape or Fusion 360. No Vantage password is entered in the terminal. The resulting device token is revocable, bound to user/org/machine/scopes, and stored in OS credential storage when optional `keytar` is available; otherwise a `0600` local file is used.

Browser setup wizard: `/cad/setup?orgId=…` (pick CAD → AI brain → copy commands → verify heartbeat).

Commands: `setup`, `start`, `status`, `diagnose`, `update`, and `logout`.

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
