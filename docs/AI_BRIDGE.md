# AI Subscription Bridge

*For members who want the team's AI chats to run through their own Claude Code subscription, and the contributors who maintain the bridge. Last updated 2026-08-24.*

A team member (typically a mentor) who already pays for **Claude Pro/Max** — which includes the
Claude Code CLI — or **ChatGPT** — which includes the Codex CLI — can serve the team's AI from
their own always-on computer: *interactive chat* by default, or — if they flip the device's
coverage to **Everything** — every AI feature across the entire platform. The bridge is a tiny
local service that executes queued jobs through the locally-authenticated CLI under
**subscription** auth, so those turns cost the team **$0 in API usage**.

It mirrors the CAD relay / storage-node pairing architecture: an 8-character pairing code, a
sha256-hashed device token, heartbeats, and SECURITY DEFINER job-lease functions
(`packages/db/migrations/0486_ai_bridge.sql`).

## Honest terms & limits (read before pairing)

- **It is the pairer's subscription on the pairer's machine.** Every bridged turn draws from that
  person's Claude Pro/Max or ChatGPT plan — there is no team pool and nothing is unlimited.
- Subscription plans have **usage windows and rate limits**, and the providers' own terms govern
  this use: [Anthropic consumer terms](https://www.anthropic.com/legal/consumer-terms) ·
  [OpenAI terms of use](https://openai.com/policies/terms-of-use). Review whether bridged team use
  fits your plan before pairing.
- When the CLI reports a rate limit, Vantage surfaces the provider's message **verbatim**
  (including the reset time when present) and the turn **falls back to the team's configured AI
  keys** automatically (`degraded: bridge-rate-limited`).
- **Coverage is the pairer's choice** (`/team/ai-bridge`, per device, `0488` migration):
  - `chat` (default) — only **interactive chat-class features** route through the bridge (see
    `BRIDGE_CHAT_FEATURES` in `packages/agent/src/resolve-chat-adapter.ts`: chat, writer,
    troubleshoot-coach). Long/batch features (dreams, Bugbot scans, season reports) use the
    team's own keys — they run for minutes and would burn the plan's usage window.
  - `everything` — **every AI feature platform-wide** rides the subscription while the device is
    online, including long jobs (season reports, CAD plans, nightly dreams, digests — worker jobs
    included). Heavy jobs enqueue the `BRIDGE_HEAVY_CLI_TIMEOUT_MS` budget (~210 s), the job lease
    grows to match, and the web waits out the poll budget (~240 s, overridable — see *Function
    duration* below) before falling back. This burns the plan's usage window fastest; when the
    plan rate-limits, everything falls back to the team's keys until it resets.
- Bridged prompts include team context and execute on the pairer's machine. Revoking the device
  on `/team/ai-bridge` stops that immediately.
- **Your Claude Code** (`scope=personal`, migration `0655`) is this signed-in person's computer
  for their turns only. It is not the team's shared subscription bridge. Another person cannot
  use that session. Claim only picks jobs whose `user_id` matches the pairer. The page title
  stays **AI subscription bridge**; the hub label stays **Subscription bridge**.

## How a turn flows

1. A chat-class request resolves its model. If the org has a bridge device with
   `prefer_when_online = true` and a heartbeat under 3 minutes old, the **bridge is tried first**;
   the normal key chain is resolved alongside as the fall-through target.
2. The web server enqueues an `ai_bridge_jobs` row (queue, **not** the request's RLS transaction —
   the device polls on its own connection) and polls with backoff, bounded at ~75 s.
3. The bridge service claims the job (2-minute lease), builds nothing — the prompt document is
   already assembled server-side (system + delimited team context + user message, size-capped) —
   and runs the CLI.
4. `done` → the answer returns with the CLI-reported model and token usage, metered through the
   existing metering path at **$0 cost**. `failed`/`expired`/timeout → the resolution **falls
   through to the normal key chain** and the result metadata says why
   (`bridge-offline` | `bridge-timeout` | `bridge-rate-limited`).
5. A queued job older than **120 s expires** server-side, so the web caller never waits forever.

## Function duration (deployment constraint — read before enabling `everything`)

A bridged turn holds the HTTP request open while the pairer's CLI works, so every AI route that
can be bridged declares `export const maxDuration = 300`: `/api/season-report`, `/api/cad`,
`/api/code`, `/api/ai-insights`, `/api/match-debrief`, `/api/grants/assist`,
`/api/grants/writing`, `/api/learning/predictions`, `/api/agent-narration/explain`,
`/api/agent/autonomous`.

**That 300 s only takes effect on a hosting plan whose maximum Node function duration is at
least 300 s.** The ceiling is the plan's, not this repo's — check the limit for the Vercel plan
this project actually deploys on before turning a device's coverage to `everything`.

**If the plan caps function duration below the bridge's poll budget, set the override.** Left
unset, the platform kills the function before the bridge answers *and* before the fall-through
to the team's own keys runs, so the user sees a 504 and the keys they paid for are never tried:

```sh
# 60 s function cap → give up ~10 s inside it
VANTAGE_BRIDGE_MAX_WAIT_MS=50000
```

With the override, a heavy bridged job that has not finished in time falls through to the
team's configured keys with `degraded: bridge-timeout` — slower and not free, but an answer.

## Setup on the always-on machine

Requirements: Node 18+ and at least one signed-in CLI.

```sh
# Claude Pro/Max (verified path)
claude --version           # install: https://docs.anthropic.com/en/docs/claude-code
claude auth login          # sign in with the subscription account
claude auth status         # {"loggedIn": true, ...}

# ChatGPT / Codex (EXPERIMENTAL path — see caveat below)
codex --version            # install: https://developers.openai.com/codex/cli
codex login
```

Pair and run (the service is a single stdlib-only file — no npm install needed):

```sh
cd packages/ai-bridge
node bridge.mjs --setup --url https://your-vantage-host   # prints an 8-char code
# approve the code at https://your-vantage-host/team/ai-bridge
node bridge.mjs                                           # run the bridge loop
node bridge.mjs --status                                  # engine detection report
```

Config (device token, org, host) is stored at `~/.vantage/ai-bridge.json` (mode 0600).
Heartbeats run every 60 s and report engine availability, version, and sign-in state — the team
page shows exactly what the machine reported, or "No heartbeat yet" until it does.

### Run at boot — Linux (systemd)

`/etc/systemd/system/vantage-ai-bridge.service`:

```ini
[Unit]
Description=Vantage AI subscription bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
# Must run as the user whose CLI subscription login it uses.
User=mentor
ExecStart=/usr/bin/node /home/mentor/vantage-frc/packages/ai-bridge/bridge.mjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now vantage-ai-bridge
journalctl -u vantage-ai-bridge -f
```

### Run at boot — Windows

Task Scheduler (no extra software):

1. Task Scheduler → *Create Task…* → run only when the pairing user is logged on (the CLI's
   sign-in lives in that profile).
2. Trigger: *At log on*. Action: Program `node`, arguments
   `C:\path\to\vantage-frc\packages\ai-bridge\bridge.mjs`.
3. Settings: enable *If the task fails, restart every 1 minute*.

(Alternatively `nssm install vantage-ai-bridge node ...\bridge.mjs` to run it as a service —
still under the account that holds the CLI login.)

## CLI invocations (verified vs experimental)

**Claude Code — verified against 2.1.241 on Windows:**

```sh
claude -p --output-format json --tools "" --no-session-persistence \
  --disable-slash-commands --setting-sources ""   # prompt on stdin
```

- `--tools ""` disables all tool use — pure chat turns only.
- Output is a single JSON object: `is_error`, `result` (the text),
  `usage.input_tokens`/`usage.output_tokens`, and `modelUsage` keyed by the answering model id.
- **The CLI exits 0 even on errors** — failures must be read from the JSON
  (`packages/agent/test/subscription-bridge.test.ts` carries a verbatim captured fixture).
- Never pass `--bare`: it restricts auth to `ANTHROPIC_API_KEY` and would bypass the
  subscription OAuth that is the whole point of the bridge.

**Codex CLI — EXPERIMENTAL:** the Codex CLI was not installed on the machine this bridge was
built on, so `executeCodex()` in `packages/ai-bridge/bridge.mjs` follows OpenAI's documented
`codex exec --json` non-interactive interface and is deliberately isolated in one small function.
Engine detection (`codex --version`) gates it: jobs only route to codex when the CLI is actually
present, and any interface mismatch is a one-function fix.

## Server pieces

| Piece | Path |
| --- | --- |
| Migration (tables, RLS, claim/complete functions) | `packages/db/migrations/0486_ai_bridge.sql` |
| Migration (`coverage` column, long-job lease) | `packages/db/migrations/0488_ai_bridge_full_coverage.sql` |
| Device routes (public, token-authed) | `apps/web/app/api/ai-bridge/device/{pair/start,pair/poll,heartbeat,jobs}` |
| Approval + status routes (session) | `apps/web/app/api/ai-bridge/{pair/approve,status}` |
| Queue transport (pairing pool) | `apps/web/lib/ai-bridge/{pool,transport}.ts` |
| Adapter + resolver integration | `packages/agent/src/{subscription-bridge-adapter,resolve-chat-adapter}.ts` |
| Team UI | `apps/web/app/team/ai-bridge/` |

Environment: `DATABASE_AI_BRIDGE_URL` (a `vantage_pairing`-role connection; falls back to
`DATABASE_CAD_RELAY_URL`, and to the app URL in development) and, on hosts that cap function
duration below the poll budget, `VANTAGE_BRIDGE_MAX_WAIT_MS` (see *Function duration* above).

To activate the bridge for a chat route, pass the transport when resolving the adapter:

```ts
import { createBridgeTransport } from "@/lib/ai-bridge/transport";
const { adapter, provenance, degraded } = await resolveOrgChatAdapterWithProvenance(client, {
  orgId, userId, feature: "chat", promptCachingEnabled,
  bridgeTransport: createBridgeTransport(),
});
// after adapter.complete(...): (adapter as SubscriptionBridgeChatAdapter).lastDegraded
// says whether the turn fell through, and provenance/model reflect what answered.
```
