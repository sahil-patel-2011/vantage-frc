# @vantage/agent

Everything between "a feature wants a model" and "a provider answered":
picking an adapter, building the prompt, redacting what must not leave,
handling the ways providers fail.

## Picking a provider

`resolveChatAdapter` / `resolveOrgChatAdapter` walk the team's options in
order and return the first that can actually serve the call:

1. **A paired subscription bridge** — a member's own Claude Code or Codex plan
   (`subscription-bridge-adapter.ts`), when its device is online. Chat-class
   features use it by default; other features only when the device covers
   everything. On failure it falls through to the rest of this list.
2. **The team's own key** (BYOK) — OpenAI, Anthropic, Google, OpenRouter, or
   any OpenAI-compatible base URL, which is how Ollama and LM Studio work.
3. **A Vantage credit gift**, when an admin granted one.
4. **Hosted platform keys** for paid tiers.
5. **The OpenRouter free pool**, then the sponsored promo pool, for free teams
   when configured.
6. **The AI Horde volunteer swarm** (`AI_HORDE_POOL`), then **Petals**
   (`PETALS_PUBLIC_POOL=1`) — both off unless the operator turns them on. Horde
   comes first because the public Petals swarm was measured empty on
   2026-09-19.

If none of those exist it raises `ChatProviderResolutionError` naming what to
configure. It does not fall through to something that will half-work.

### Why the volunteer swarms are off by default

Petals' own documentation says not to send confidential data to the public
swarm (the Horde adapter also drops `private_memory` context for the same reason): the peers serving the model layers can read the prompt, read the reply,
and alter the reply on the way back, and they see the caller's IP. This
workspace holds student names, pick lists and sponsor contacts. A team can
still choose it — free AI for questions about public match data is a reasonable
trade — but a missing API key must not be what makes that choice for them.

For free AI that never leaves the team's own hardware, point a base URL at
Ollama or LM Studio. Same price, no third party.

## Metering is not optional

Nothing here calls a provider on its own account. The caller wraps the invoke
in `meteredAI` from [`@vantage/billing`](../billing/README.md), inside the
transaction `withRls` opened. An adapter that bills nobody is a bug.

## What never reaches a model

- `finance-redact.ts` strips finance figures before a prompt is built.
- Context items marked `private_memory` are excluded from the low-trust paths.
- `org-session-context.ts` keeps one team's context out of another's call.

## Failure is the normal case

Providers rate-limit, run out of capacity, and hang. `ProviderRateLimitError`,
`isProviderQuotaOrCapacityStatus` and `ChatUpstreamTimeoutError` exist so the
product can say which of those happened, because "try again" and "you are out
of credits" are different sentences to a student.

## Layout

| File | What it holds |
| --- | --- |
| `resolve-chat-adapter.ts` | The provider ladder above |
| `http-chat-adapter.ts` | The OpenAI-compatible transport and its error shapes |
| `ai-horde-pool.ts` / `petals-public-pool.ts` | The opt-in volunteer swarms |
| `byok-model-routing.ts` / `model-policy.ts` / `model-tier.ts` | Which model a feature gets |
| `chat-system-prompt.ts` | The product's own instructions to the model |
| `context-compact.ts` / `prompt-caching.ts` | Fitting and reusing context |
| `orchestrator.ts` / `autonomous-loop.ts` | Multi-step agent runs |
| `finance-redact.ts` | What is removed before sending |

Local and self-hosted setups: [`docs/LOCAL_AI.md`](../../docs/LOCAL_AI.md).
