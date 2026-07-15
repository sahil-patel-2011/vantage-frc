# Vantage CAD desktop relay

The CLI is a local workspace package; it is not published to npm.

```text
npm install
npm run build --workspace=@vantage/cad-cli
npm install -g ./packages/vantage-cad-cli
vantage-cad setup
```

`setup` opens a browser with a ten-minute one-time pairing code. The user signs in there, selects an existing authorized organization, and chooses Onshape or Fusion 360. No Vantage password is entered in the terminal. The resulting device token is revocable, bound to user/org/machine/scopes, and stored in OS credential storage when optional `keytar` is available; otherwise a `0600` local file is used.

Commands: `setup`, `start`, `status`, `diagnose`, `update`, and `logout`.

## Onshape

Hosted Onshape uses least-privilege OAuth and server workers. The browser selects document/workspace/element. The CLI can monitor health but does not need to remain running. Mutations use allowlisted operations (sketch, extrude, fillet, chamfer, shell, pattern, variable, assembly and reviewed FeatureScript), idempotency keys, explicit approval, and topology/render verification after every mutation. Real credentials must be tested only in a disposable document.

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

## AI provider billing

- Vantage managed: Vantage plan/allowance/credits and budget ledger.
- Team/platform OpenAI or Anthropic: proper encrypted API credentials and provider API billing.
- Personal BYOK: the user's official API account.
- Local OpenAI-compatible: the user's local host through the paired relay.
- Claude Code: optional platform-owner private/local sessions only, matching paired device, explicit opt-in. It cannot service members, other orgs, shared queues, scheduled jobs, team-memory generation, or production web traffic.

ChatGPT and Claude consumer subscriptions are not API credentials. Vantage does not scrape cookies/sessions, pool personal subscriptions, reverse-proxy them as SaaS APIs, or claim Plus/Pro includes API usage. Use official API keys and provider billing for customer/team managed AI.
