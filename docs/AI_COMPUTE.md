# Where the AI actually runs

*A decision record. Last measured 19 September 2026.*

Vantage is provider-agnostic: every feature works on any OpenAI-compatible key and any
model. This document says what we tested, what we chose as the default chain, and why —
so the next person does not have to re-run the measurements.

## The short version

| If you want | Use |
|---|---|
| The best answers, cheapest | Your own **OpenRouter** key, pointed at DeepSeek / GLM / Qwen |
| No key at all, and you accept weaker answers | The built-in **free pool** (Groq → OpenRouter free tier) |
| Nothing leaving your building | **Ollama** or **LM Studio** on a machine you own, via the local relay |
| A volunteer swarm, for ideological reasons | **Petals** — but read the measurement below first |

**Do not plan on Petals.** It is wired up, it is off by default, and it fails with an
honest message. It cannot be the backbone.

## What we measured about Petals

Petals is a genuinely good idea — a BitTorrent-style swarm where volunteers each host a
few layers of a large model, so no one needs the whole thing in VRAM. The question was
whether it could run a frontier-sized open model for several teams at once, for free.

It cannot, because there is no swarm any more:

- `chat.petals.dev` has exactly one model registered, `petals-team/StableBeluga2`
  (a Llama-2-70B fine-tune from 2023). Asking for anything else returns `KeyError`.
- Asking for **that** model returns
  `MissingBlocksError: No servers holding blocks [0..79] are online` — nobody is hosting
  any layer of it. This is the swarm being *empty*, not busy; waiting does not help.
- `health.petals.dev`, the public swarm monitor, refuses connections.
- The upstream repository's last commit is **7 September 2024**, with 114 open issues.
  It is not archived, but it has not been touched in two years.

So the ceiling is not "a 500B model shared between teams". The ceiling is one 2023-era
70B model that currently has zero hosts. Even at full health, a volunteer swarm runs at a
few tokens per second with unpredictable latency, which is the wrong shape for a question
asked in a pit between matches.

### Terms of service

Petals is **AGPL-3.0**, and the public swarm has no separate terms beyond the project's
own guidance. Using it as a client is allowed. The real obligations are about conduct and
about what you send, and the adapter in `packages/agent/src/petals-public-pool.ts`
observes them:

- **Opt-in.** Off unless `PETALS_PUBLIC_POOL=1`. We do not put load on a volunteer
  network by default.
- **Small asks.** Prompts capped at 8,000 characters and 256 new tokens, because the
  swarm is slow and shared. No retry storms.
- **Nothing private.** Inference runs on strangers' machines, so private-memory context
  is excluded and finance text is redacted before anything is sent. This is the part
  that matters most: a volunteer swarm is not a confidential channel, and student data
  must not go through one.
- **Last in the chain**, after every other free option, so it is only ever reached when
  nothing better is configured.

If the swarm ever comes back, none of this needs to change — it will simply start
working.

## What we chose instead

The free chain, in order (`packages/free-relay/src/adapter.ts`):

1. **`FREE_RELAY_*`** — an OpenAI-compatible proxy you run yourself, typically Ollama or
   LM Studio on a shop machine or a Raspberry Pi. Free, private, and as good as the
   hardware.
2. **Groq free tier** — fast, small open models.
3. **OpenRouter free tier** — rotating free open-weight models.
4. **Petals** — opt-in, as above.

For real work, a team's own **OpenRouter** key is the recommendation. One key reaches
DeepSeek, GLM, Qwen, Llama and the commercial models through one OpenAI-compatible
endpoint, at open-weight prices. That is the practical version of what Petals promised:
large open models, no GPU, cents per day for a team.

### Why there is still a floor

`packages/agent/src/reasoning-floor.ts` marks which features need real reasoning —
strategy, match prediction, design review, code review — and asks for a frontier-class
model for those. Below that line the answers are not merely worse, they are confidently
wrong, which on a competition day is worse than no answer. The floor never *refuses*: it
routes, warns, and lets the team decide.

This is why "run everything on a free 7B" is not offered as a supported mode. Scouting
data entry, summaries and chat are fine on small models. Deciding an alliance pick is
not.

## About self-hosting on a NAS

A NAS with good disks and no GPU can host the *database* and the *files* very well, and
that is worth doing. It cannot host a large language model: a 500B model needs hundreds
of gigabytes of VRAM, and even a 30B quantised model on CPU answers at a pace that makes
the feature unusable in a pit. Keep the data at home and the inference on a key.

## Related

- [LOCAL_AI.md](LOCAL_AI.md) — pointing Vantage at Ollama or LM Studio
- [LOCAL_RELAY.md](LOCAL_RELAY.md) — the Raspberry Pi relay
- [AI_BRIDGE.md](AI_BRIDGE.md) — how requests are routed and metered
