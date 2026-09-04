# Free relay on a Pi (FreeBuff / Codebuff)

Run platform-funded AI for granted teams through a self-hosted OpenAI-compatible proxy
instead of a paid provider.

## Why a box at all

FreeBuff (Codebuff's free coding agent) exposes its models **through the official
Coder UI / CLI session**. The backend fingerprints traffic and rejects raw API calls
with `403 free_mode_cli_required`. Vantage does not impersonate that client. You keep
**Freebuff Coder UI signed in on the Pi**; the Vantage layer only forwards OpenAI-shaped
requests to that UI's local `/v1`. That logged-in session is the only reason a Pi is
involved.

The Pi does **no inference**. The unmetered models (GLM 5.3 Flash, MiMo 2.5) run in
FreeBuff's cloud; the Pi is a credential holder and traffic shaper. Its CPU is irrelevant —
its uptime and your home upload bandwidth are what matter.

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

From a Raspberry Pi Connect remote shell on the Pi 5 (see `docs/FREE_RELAY_CONNECT.md`):

The platform box is named **frcvantagefreebuff relay**. Each granted team gets its
own `org-<uuid>/` coding folder on that box. Teams without a grant never use this
path — they stay on API keys or included credits. Granted teams can also connect
their own Pi and Freebuff account (Team → AI keys walkthrough).

Sign in once **on the Pi** (`npx --yes @codebuff/cli login`). That session lives
in `~/.config/manicode/credentials.json` and does not need a laptop or a GUI.
Then:

```sh
bash scripts/pi/connect-bootstrap.sh
```

Or, already in a checkout:

```sh
bash scripts/pi/install-free-relay.sh
```

That starts the Vantage layer on `:8080` and points it at Coder UI's local `/v1`
(default `http://127.0.0.1:3457`). No FreeBuff token is pasted into the installer.
Vantage (and the tunnel) talk only to `:8080`. Override with `FREEBUFF_UPSTREAM_URL`
if the UI listens on `:8080` or another port.

The installer generates a `FREE_RELAY_API_KEY`, writes `.env.free-relay` (chmod 600,
gitignored), starts the Vantage layer bound to `127.0.0.1` with that key as its
required client key, verifies that a keyless request is *refused*, and installs the
sweep as a systemd unit. It is idempotent and never overwrites an existing key.

Then, only if you want interactive chat on the relay:

```sh
cloudflared tunnel login
cloudflared tunnel create vantage-relay
cloudflared tunnel route dns vantage-relay relay.yourdomain.com
cloudflared tunnel run --url http://127.0.0.1:8080 vantage-relay
```

Raspberry Pi Connect is how you operate the box. It is not this tunnel.

and set on the Vercel project:

```
FREE_RELAY_BASE_URL=https://relay.yourdomain.com/v1,https://second-pi.yourdomain.com/v1
FREE_RELAY_API_KEY=<the generated key>
FREE_RELAY_MODEL=glm/glm-5.3-flash
FREE_RELAY_PROVIDER=freebuff
```

Comma-separate one `/v1` URL per Pi so Vantage load-balances across both official
Freebuff sessions. `FREE_RELAY_MODEL` is the default slug (`deepseek/deepseek-v4-flash`,
`glm/glm-5.3-flash`, or `mimo/mimo-2.5`). Team pickers offer those three free models,
with DeepSeek V4 Flash first. Unknown slugs clamp to DeepSeek V4 Flash.

`FREE_RELAY_API_KEY` must match the Pi layer key. Vantage **refuses** a
non-loopback `FREE_RELAY_BASE_URL` with no key (`readFreeRelayConfig` returns null and
`/api/admin/ai-grants` explains why at grant time), because an internet-reachable relay
without a key is an open pass-through to your FreeBuff account for anyone who finds the
hostname.

## Verifying it for real

```sh
npm run free-relay:verify
```

Reads `FREE_RELAY_*` from `.env.free-relay` at the repo root (or the shell) and checks the
chain Vantage actually uses rather than a hand-rolled `curl`:

- resolves the relay config through `readFreeRelayConfig`, so a refused config fails here
  with the reason instead of at request time;
- lists `/v1/models` and **warns when `FREE_RELAY_MODEL` is not in the catalog** — the
  forever-free slugs are `glm/glm-5.3-flash` and `mimo/mimo-2.5`, and a mismatch otherwise
  shows up as every request 404ing;
- asserts a keyless request is **refused**, and fails loudly if the relay is an open
  pass-through to your FreeBuff account;
- runs a real completion through `tryCreateFreeRelayAdapter` + `HttpChatAdapter`, so a pass
  means production code can parse this relay's responses;
- captures the SSE wire format verbatim and warns if the proxy buffers the whole answer
  into one chunk, which would make streaming feel no different from blocking.

It never prints the relay key or the upstream token. Exit code is 0 on pass, 1 on failure.

## Which model to point it at

This is the setting that decides whether the relay is effectively unlimited, and it is easy
to get backwards. Per Codebuff's README:

| Model | Metering |
| --- | --- |
| **DeepSeek V4 Flash** | **Free, unlimited, and fast request routing.** Vantage default. |
| **GLM 5.3 Flash** | **Unmetered — costs no session at all.** |
| **MiMo 2.5** | **Unmetered — costs no session at all.** |
| DeepSeek V4 Pro | Retired from the catalog. |

Vantage forwards the picker slugs (`deepseek/deepseek-v4-flash`, `glm/glm-5.3-flash`,
and `mimo/mimo-2.5`).
Run `npm run free-relay:verify` and use an id from the `/v1/models` catalog it prints if
the proxy names them differently. The verifier warns when `FREE_RELAY_MODEL` is absent
from that catalog, which is the difference between a working relay and every request 404ing.

## Two product-level caveats

Neither is a code problem, and both matter more here than they would for a personal tool,
because this relay serves other people's teams.

**Ads.** FreeBuff is ad-supported — Codebuff describes text ads in the terminal as what pays
for the models. Through an OpenAI-compatible proxy there is no terminal, so confirm ad text
is not being appended into completion content before granting the relay to a team. Check the
verifier's completion output: it prints exactly what came back.

**Training on submissions.** The README's data-use answer is that submissions may be
retained to train and improve models "when a model or feature says data may be used for AI
training." Vantage is multi-tenant and the prompts carry other teams' scouting, strategy,
and chat. Read the applicable notice before pointing team traffic at it, and prefer granting
the relay for background jobs over interactive chat if that clause is unresolved.

## Granting it to a team

`/admin/ai-grants` → **None / 100 requests / Unlimited** for one team. None revokes the
active `platform_relay` window. 100 requests grants 100 credits plus a year of relay.
Unlimited opens the relay window without putting them on the credit plan. Teams without
a grant are untouched and keep using their own keys.

The team can turn **Use platform Free AI** off under Team → AI API keys. When that
toggle is on (the default after a grant), chat, the CAD / design assistant, Bugbot,
agent loops, and Pi background jobs go to FreeBuff *before* team keys. Isolation is
per-request: Vantage tags every completion with exactly one `org_id` and drops context
that names another team. The Pi holds one session; it never becomes shared memory.
Chat, CAD words, and agents share the box concurrently (default 16 in-flight). Onshape
and Fusion tools still talk to CAD hosts — only the assistant text uses FreeBuff.

Watch the box from `/admin/free-relay`: connect a named Pi, probe tok/s out, and see
tokens in/out for the UTC day. Those numbers are device totals. Per-team tokens stay
on the home dashboard and `/admin/analytics`.

The model picker offers DeepSeek V4 Flash (free, unlimited, fast), GLM 5.3 Flash,
and MiMo 2.5. Unknown slugs still clamp to DeepSeek V4 Flash.

## What happens when it breaks

Assume it will: the box is on a home connection, and a relay can still 429 or drop.
`RelayFailoverChatAdapter` treats that as normal. On an unreachable host
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

- Two models are genuinely unmetered (see above); the rest spend daily sessions. Pick the
  unmetered ones and this is a real supply, not a trickle.
- Full access is region-gated. A VPN drops you to limited mode, so a relay that works from
  home may behave differently from a hosted box in another region.
- Proxy projects also support rotating tokens across multiple accounts. That is
  multi-accounting to defeat a quota, and if it goes wrong every granted team loses AI at
  once. Prefer one account on an unmetered model over many accounts on a metered one.
- Check FreeBuff/Codebuff's terms before pointing a product you bill for at their free tier.
- Background jobs contain the blast radius by construction; interactive chat does not.
  Prefer granting relay access to teams you can afford to have degrade.

## Operating it

```sh
npm run free-relay:sweep     # one pass, prints backend + counts
npm run free-relay:daemon    # loop on FREE_RELAY_INTERVAL_MS (default 5m)
journalctl -u vantage-pi-layer -f
journalctl -u vantage-free-relay -f
```

Coder UI must stay signed in on the box. The layer only forwards to that UI’s `/v1`.

The sweep logs `backend=<provider>@<url>` so you can confirm which upstream it resolved
without printing any key.

## Job kinds

`memory_dream` is implemented. `deep_game_analysis` is implemented for FRC team **6925
only** — one job thinks continuously for five wall-clock hours on Freebuff Coder UI,
fetching teasers/theme/community text, comparing it to official past games, and
storing a labeled guess. It does not schedule hourly loops. `overnight_intel` and `bugbot_scan` are enqueueable but
marked `skipped` with `reason: not_implemented_on_pi_yet` — they are not silently faked.
Neither is a wiring job: bugbot needs a GitHub repo and token that `free_relay_jobs.metadata`
does not model, and overnight intel's compute is currently bound to web-only nav helpers.
