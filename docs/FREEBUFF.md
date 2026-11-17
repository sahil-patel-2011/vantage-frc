# Freebuff, and why Vantage has no Pi relay

*For anyone asking what Vantage will and will not do with Freebuff. Last updated 2026-10-14.*

Terms checked against https://freebuff.com/terms-of-service (effective 2026-09-02).

## The Pi relay is gone

Vantage used to document a fleet of Raspberry Pis serving Freebuff's free DeepSeek inference through a
local proxy, paired to a team and used ahead of the team's own keys. That is a wrapper around
Freebuff's service, which their terms forbid, so it has been removed: there is no Pi install script,
no relay systemd unit, and no pairing page. Do not bring it back.

AI path order now:

1. A member's paired Claude Code or Codex plan (`/team/ai-bridge`, `packages/ai-bridge`)
2. The team's own keys (BYO), including a local Ollama or LM Studio server set as an OpenAI base URL
   on `/team/ai-keys`
3. Hosted keys (fallback, never the assumption)

The product tells the person which path answered.

## What Freebuff's terms forbid (so we will not build it)

Freebuff's terms (effective 2026-09-02) forbid:

- calling their inference "through scripts, custom clients, wrappers, integrations, or third-party software"
- bots, headless browsers, or automation; a human must initiate each session
- scraping
- use by anyone under 18 (the Service is 18+)

FRC users are often minors. Vantage must not send student prompts to Freebuff in any form.

Not allowed, in any shape: a Pi or server proxy in front of Freebuff, a browser extension that rides a
logged-in Freebuff tab, a scraper, or storing a Freebuff website cookie. `origin/pi-freebuff-layer`
was dropped for this reason.

## What is left in the code

`packages/free-relay` still holds the lease-based queues the assembly manual and video analysis use,
and the free-tier writer the assembly manual calls for step wording. It runs inside the web app's cron
routes, not on team hardware.
