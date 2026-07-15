# Vantage CAD desktop relay

The CLI is a local workspace package; it is not published to npm.

```text
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
vantage-cad setup
```

`setup` opens a browser with a ten-minute one-time pairing code. The user signs in there, selects an existing authorized organization, and chooses Onshape or Fusion 360. No Vantage password is entered in the terminal. The resulting device token is revocable, bound to user/org/machine/scopes, and stored in OS credential storage when optional `keytar` is available; otherwise a `0600` local file is used.

Browser setup wizard: `/cad/setup?orgId=…` (pick CAD → AI brain → copy commands → verify heartbeat).

Commands: `setup`, `start`, `status`, `diagnose`, `update`, and `logout`.

Mock Fusion (CI / no Autodesk): `VANTAGE_CAD_MOCK=1 vantage-cad start` boots an in-process loopback plugin that verifies signed job envelopes.

## Onshape

Hosted Onshape uses least-privilege OAuth and server workers. The browser selects document/workspace/element. The CLI can monitor health but does not need to remain running. Mutations use allowlisted operations (sketch, extrude, fillet, chamfer, shell, pattern, variable, assembly and reviewed FeatureScript), idempotency keys, explicit approval, and topology/render verification after every mutation. Real credentials must be tested only in a disposable document.

**Status:** OAuth client wiring is setup-required (admin env). UI Connect button stays disabled until credentials exist.

## Fusion 360

Fusion is local. Vantage/Vercel signs an approved, expiring job; the paired relay claims only jobs matching its device, user and org. The relay calls an HTTP loopback endpoint exposed by the repository's `fusion360-official` connector stub. Fusion must be running and signed in to the user's Autodesk account.

Windows add-in location:

```text
%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns
```

macOS add-in location:

```text
~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns
```

In Fusion choose Utilities → Add-Ins → Scripts and Add-Ins, add the connector folder, run it, then run `vantage-cad start`. Installation requires user action; Vantage does not silently modify Fusion.

**Mock path:** use `VANTAGE_CAD_MOCK=1` so CI and onboarding can exercise signed jobs without Autodesk.

## AI provider billing

- **Vantage managed API:** plan/allowance/credits and budget ledger.
- **Team/personal BYOK:** official provider **API** credentials only (encrypted in Vantage). Not ChatGPT Plus / Claude Pro web subscriptions.
- **Terminal / local CLI** (`key_source=local_cli`): Claude Code / Codex CLI / local OpenAI-compatible via `vantage-cad` — **no Vantage model charge** (usage may still be logged at cost 0 for observability).
- **Local OpenAI-compatible:** paired relay + local model host.
- **Claude Code:** optional platform-owner private/local sessions only on the matching paired device; never team/shared/scheduled traffic.

ChatGPT and Claude consumer subscriptions are not API credentials. Vantage does not scrape cookies/sessions, pool personal subscriptions, reverse-proxy them as SaaS APIs, or claim Plus/Pro includes API usage.

## Agent safety (prompt-injection defense)

CAD agent policy uses strong system prompts, allowlisted tools, untrusted-text isolation (`<untrusted_user_or_context>`), destructive-geometry confirmations, and plan → verify loops. Prompt injection is defended against — not enabled. Never claims certified engineering.

## Security

Signed Fusion jobs (HMAC), device binding on relay claim, allowlisted operations, explicit approval for mutations, topology/render checkpoints after execute.
