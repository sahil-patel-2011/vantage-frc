# Freebuff, the Pi fleet, and what Vantage will not do

Status as of 2026-09-10. Terms checked against https://freebuff.com/terms-of-service (effective 2026-09-02).

## What the owner is running

The shop runs **freebuff on Raspberry Pis** — unlimited free requests to **DeepSeek V4 Flash** through a local relay, not through Freebuff's hosted website. Vantage talks to **that Pi**, with a pairing code and a hashed device token, the same way the storage node works.

AI path order, everywhere:

1. Paired relay on the LAN (DeepSeek via the Pi)
2. The team's own keys (BYO)
3. Hosted paid keys (fallback, never the assumption)

The product tells the person which path answered.

## What Freebuff's terms forbid (so we will not build it)

Freebuff's terms (effective 2026-09-02) forbid:

- calling their inference "through scripts, custom clients, wrappers, integrations, or third-party software"
- bots, headless browsers, or automation; a human must initiate each session
- scraping
- use by anyone under 18 (the Service is 18+)

FRC users are often minors. Vantage must not send student prompts to Freebuff's **hosted** free product.

**A browser extension that rides a logged-in Freebuff tab is forbidden.** It is a wrapper around their session. Do not build it. `origin/pi-freebuff-layer` was dropped for this reason.

The official published SDK/API, used **on hardware the team owns** against an endpoint the team configured, is the compliant path.

## What we did build

### Connect your own relay

Settings → Connectors → Free relay. Paste the relay base URL and a token. The token is stored KMS-encrypted (same envelope as Onshape). Vantage never stores a Freebuff website cookie.

### Roles and instances

systemd template: `scripts/pi/vantage-relay@.service`

```
vantage-relay@chat.service
vantage-relay@agent.service
vantage-relay@video.service
```

Each instance is a worker with a role:

| Role | Handles | Owner's target fleet |
|---|---|---|
| `chat` | Ask AI streams | 2 Pis |
| `agent` | `free_relay_jobs`, assembly manual, bugbot | 1 Pi |
| `video` | `video_analysis_jobs` | 1 Pi; when idle it hosts agent instances |

A Pi advertises capacity via pairing + heartbeat (`relay_nodes`, `relay_node_capabilities`). Liveness is derived from `last_heartbeat_at`, never trusted from a status column.

### Dispatch

Chat goes to the least-loaded online chat instance. Agent/video jobs go to those roles. Fallback: team keys, then hosted. First-token target on the LAN is 1.5 s streamed; measure with `packages/free-relay` once a Pi is paired. Unmeasured in this agent image (no Pi).

### Conversation summaries

`packages/agent/src/context-compact.ts` folds older turns into an extractive "Earlier in this conversation…" note so the window stays inside the model. The original turns remain in the thread for expand.

### Account linking

Allowed: paste/authorize **your relay endpoint + token**.

Not allowed: a Freebuff website session, a browser extension, a scraper, or sending a student's prompt to freebuff.com.

## Owner still has to

1. Install the unit on each Pi (`scripts/pi/install-free-relay.sh`).
2. Set `FREE_RELAY_BASE_URL`, `FREE_RELAY_API_KEY`, `FREE_RELAY_MODEL=deepseek-v4-flash` on the Pi.
3. Pair the node from `/team/relays` (same human code flow as `/team/storage`).
4. Confirm DeepSeek V4 Flash on that endpoint accepts images before relying on the video role for vision. If it does not, set a vision model on the video instance and say so on the relays page.
