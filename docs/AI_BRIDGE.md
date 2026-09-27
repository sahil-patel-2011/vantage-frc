# Personal Codex connections

Last updated September 26, 2026.

Each connection belongs to the person who pairs it. Other members' requests never run through that person's device or subscription. Use a separate profile for each Vantage user on a shared computer.

## Connect Vantage to your local Codex

Open **Team → Personal connections** at `/team/ai-bridge`. Copy your Vantage user ID and the commands shown there. Install Node 22 or later and the official Codex CLI.

Download `/vantage-ai-bridge.mjs` from your Vantage installation. Replace `USER_ID` with the ID shown in Personal connections:

```sh
node vantage-ai-bridge.mjs --profile USER_ID --setup --url https://vantagefrc.vercel.app
node vantage-ai-bridge.mjs --profile USER_ID --codex-login
node vantage-ai-bridge.mjs --profile USER_ID --test
node vantage-ai-bridge.mjs --profile USER_ID
```

After the setup command, enter its pairing code in **your own** Vantage account. Approval by a different account is rejected locally. Then run login, test and the connector.

The login uses a dedicated Codex home. It does not reuse the computer's ordinary Codex login. Credentials remain on this device. Pairing records are in `~/.vantage/profiles/USER_ID/ai-bridge.json`; provider homes are also scoped to your Vantage ID. Protect the operating-system account and these directories.

`--test` checks the personal ChatGPT account through Codex App Server and verifies the server heartbeat identity without running a model turn. A version check alone does not establish connection readiness. `--status` reports engine and authentication detection; Vantage shows actual heartbeat and failure states.

## Connect your Codex terminal to Vantage

After pairing, register the stdio MCP server with the complete local file path:

```sh
codex mcp add vantage -- node "/absolute/path/vantage-ai-bridge.mjs" --profile USER_ID --mcp
```

The server uses newline-delimited JSON-RPC. Tools cover connector status, scouting, scouting schemas, inventory availability, knowledge search, CAD briefs, event readiness, purchase-request proposals and CAD-brief proposals.

Inputs cannot select another user or organization. The server derives identity from the device and rechecks membership, age eligibility, revocation and team AI controls on every call. Existing application services run under the person's permissions.

Write tools create pending proposals. Review and confirm them in Vantage before an action runs. A purchase proposal never places an order or spends money. Tools do not expose SQL, Google operator credentials or arbitrary platform shell commands.

## How Vantage requests run

1. Vantage selects an eligible, recently connected device belonging to the requesting person.
2. The server stores the submitted request in a personal queue and issues a bounded lease.
3. The connector checks job, user and organization identity.
4. Codex App Server starts a new ephemeral thread, streams the answer and uses permitted Vantage tools. Shell, local filesystem and unrelated conversation access are disabled.
5. Cancellation, membership loss or revocation invalidates the lease. The connector interrupts the request; the server rejects an obsolete result.

Interactive chat uses a preferred personal device. A person's `everything` setting permits longer requests **made by that person**. Background work without a requesting person cannot use a subscription connection.

After a bridge failure, existing configured API routing may supply an answer and report the degradation. Those calls have separate costs and limits. There is no team-wide subscription fallback or promise of unlimited provider usage.

The standalone bridge also supports an isolated Claude Code login with `--claude-login`. Codex is the default when both engines are available; an explicit requested engine is honored. Claude execution disables local tools and session persistence.

The full `vantage-connector` CLI requires `--profile USER_ID` for setup, status, settings, its run loop and MCP. It can adopt a matching standalone pairing from that profile. It never adopts another person's machine-wide pairing. Media storage is retired and cannot be enabled.

## Restarts and revocation

Task Scheduler or systemd launches must include the complete script path and `--profile USER_ID`, running in that person's operating-system session. Keep provider credentials in that profile. Do not use one mentor's subscription to serve a team.

Restart after updating the file. Re-pair when the pairing is revoked or invalid. Revocation in Vantage takes effect on the next server access.

## Operator configuration and release evidence

Configure `DATABASE_AI_BRIDGE_URL` with the restricted `vantage_pairing` role. Application tools use the request role and personal identity. A database-owner connection must not serve normal requests.

Heavy requests need a host duration longer than the polling budget. `VANTAGE_BRIDGE_MAX_WAIT_MS` bounds waiting within that duration. Provider availability and usage limits remain part of connection readiness.

Evidence includes profile isolation, actual PostgreSQL access-rejection checks, installed App Server protocol/schema checks, unsigned-in account rejection and a real downloadable MCP subprocess round trip. Authenticated subscriber execution, browser pairing, confirmed actions and production restart/cancellation journeys still need acceptance evidence.

See [release status](release/STATUS.md) and the [completion matrix](release/completion-matrix.md).
