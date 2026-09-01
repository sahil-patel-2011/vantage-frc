# Free relay on a Pi (FreeBuff / Codebuff)

Run platform-funded AI for granted teams through a self-hosted OpenAI-compatible proxy
instead of a paid provider.

## Why a box at all

FreeBuff (Codebuff's free coding agent) exposes its models **only through its official
CLI**. The backend fingerprints traffic and rejects direct API calls with
`403 free_mode_cli_required`. So you cannot point Vantage at FreeBuff directly — you need
an always-on process that replicates the CLI's request envelope and holds the session.
That process is the only reason a Pi is involved.

The Pi does **no inference**. DeepSeek V4 is a several-hundred-billion-parameter model; the
Pi is a credential holder and traffic shaper. Its CPU is irrelevant — its uptime and your
home upload bandwidth are what matter.

If you would rather not run a box, an OpenAI-compatible hosted gateway with a real API key
(for example OpenCode Zen's free tier) drops into the same `FREE_RELAY_*` variables with no
Pi and no code change. Everything below applies unchanged apart from the tunnel.

## Two paths, deliberately different

**Background jobs — outbound only.** The sweep daemon on the Pi dials *out* to Postgres,
claims rows from `free_relay_jobs` with `FOR UPDATE SKIP LOCKED`, runs them, and writes
results back. Nothing is exposed: no port forward, no tunnel, no inbound auth to get wrong.
If the Pi is off, jobs stay queued and nobody notices.

**Interactive chat — inbound.** A team holding a `platform_relay` grant has its chat
resolved to the relay, which means a Vercel function must reach the Pi *synchronously*.
That requires the Pi to be internet-reachable, which is the entire security cost of this
design. Use a tunnel, never a port forward: serverless calls arrive from rotating IPs, so
there is no source range to allowlist.

## Setup

```sh
FREEBUFF_AUTH_TOKENS=eyJ... bash scripts/pi/install-free-relay.sh
```

The installer generates a `FREE_RELAY_API_KEY`, writes `.env.free-relay` (chmod 600,
gitignored), starts the proxy bound to `127.0.0.1` with that key as its required client
key, verifies that a keyless request is *refused*, and installs the sweep as a systemd
unit. It is idempotent and never overwrites an existing key.

Then, only if you want interactive chat on the relay:

```sh
cloudflared tunnel login
cloudflared tunnel create vantage-relay
cloudflared tunnel route dns vantage-relay relay.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8080 vantage-relay
```

and set on the Vercel project:

```
FREE_RELAY_BASE_URL=https://relay.yourdomain.com/v1
FREE_RELAY_API_KEY=<the generated key>
FREE_RELAY_MODEL=deepseek/deepseek-v4-flash
FREE_RELAY_PROVIDER=freebuff
```

`FREE_RELAY_API_KEY` must match one of the proxy's `API_KEYS`. Vantage **refuses** a
non-loopback `FREE_RELAY_BASE_URL` with no key (`readFreeRelayConfig` returns null and
`/api/admin/ai-grants` explains why at grant time), because an internet-reachable relay
without a key is an open pass-through to your FreeBuff account for anyone who finds the
hostname.

## Granting it to a team

`/admin/ai-grants` → open a `platform_relay` window for one team for N days. Teams without
a grant are untouched and keep using their own keys. A team's own BYOK keys always take
precedence over the relay, so lending someone the relay never overrides a key they pay for.

## What happens when it breaks

Assume it will: the free pool is roughly **5 sessions/day per account**, and the box is on a
home connection. `RelayFailoverChatAdapter` treats that as normal. On an unreachable host
(`ECONNREFUSED`, dead tunnel DNS, TLS failure, timeout), a spent pool (402/429/503), or a
rejected operator token (401/403, including `free_mode_cli_required`), it falls through to
the platform free pools — OpenRouter free, then Groq — and the usage ledger records the
upstream that *actually* served the call, not the one that was tried first.

Two deliberate non-behaviors:

- A malformed request (400) does **not** fail over. Every upstream would reject it, so
  burning the backup pool on it is pointless.
- A relay 401/403 falls through rather than surfacing. The credential is the operator's
  FreeBuff token; a team cannot act on it and should not be told to fix a key it doesn't own.

If every upstream fails, the error names each attempt so you can tell "Pi asleep" from
"pool spent" from "token dead" without reproducing it.

## Limits and risk

- The premium free pool is small and per-account. This is not an unmetered supply.
- Proxy projects scale past it by rotating tokens across multiple accounts. That is
  multi-accounting to defeat a quota, and if it goes wrong every granted team loses AI at
  once. Keep the relay off the paid path and grant it narrowly.
- Check FreeBuff/Codebuff's terms before pointing a product you bill for at their free tier.
- Background jobs contain the blast radius by construction; interactive chat does not.
  Prefer granting relay access to teams you can afford to have degrade.

## Operating it

```sh
npm run free-relay:sweep     # one pass, prints backend + counts
npm run free-relay:daemon    # loop on FREE_RELAY_INTERVAL_MS (default 5m)
journalctl -u vantage-free-relay -f
docker logs vantage-freebuff-proxy
```

The sweep logs `backend=<provider>@<url>` so you can confirm which upstream it resolved
without printing any key.

## Job kinds

`memory_dream` is implemented. `overnight_intel` and `bugbot_scan` are enqueueable but
marked `skipped` with `reason: not_implemented_on_pi_yet` — they are not silently faked.
Neither is a wiring job: bugbot needs a GitHub repo and token that `free_relay_jobs.metadata`
does not model, and overnight intel's compute is currently bound to web-only nav helpers.
