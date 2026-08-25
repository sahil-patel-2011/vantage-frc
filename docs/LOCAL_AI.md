# Running Vantage on local or free AI endpoints

A team that points Vantage at Ollama, LM Studio, a LAN inference box, or any $0
OpenAI-compatible key gets the **same features** as a team on a frontier key.
What changes is only (a) which endpoint answers and (b) an honest, one-line
quality notice on smaller models. Running local is a supported configuration,
not a degraded account.

This document covers how to configure it, which features honor the
configuration (the compliance audit table), how the quality notice works, and
the deliberate hosted-only exceptions.

## Configuring a local endpoint or free key

All configuration lives under **Team → AI API keys**.

There are two key scopes:

- **Team keys** (`org_llm_keys` / `org_provider_configs`) — set by an owner or
  admin, used by every member. This is where a shared workshop inference box or
  the team's OpenAI/Anthropic/Google/OpenRouter key goes.
- **Member keys** (`member_llm_keys`) — personal keys that overlay the team's
  key **for the same provider**. A member with a personal OpenAI-compatible
  base URL (e.g. Ollama on their laptop) uses it for their own requests while
  the rest of the team stays on the team key.

For a local server, fill in the **base URL** field on an OpenAI-compatible
entry, for example:

| Server | Base URL |
| --- | --- |
| Ollama | `http://127.0.0.1:11434/v1` |
| LM Studio | `http://127.0.0.1:1234/v1` |
| LAN inference box | `http://workshop-pc:8000/v1` |

The API key can be anything (local servers ignore `Authorization`); the model
field or the connector's model mappings pick which local model answers
(`default` / `chat` for chat, `stt` / `transcribe` / `whisper` for
speech-to-text).

### Resolution order

`resolveOrgChatAdapter` (packages/agent/src/resolve-chat-adapter.ts) resolves
every request the same way:

1. Member key for the chosen provider (personal overlay, including a personal
   base URL) — when the request carries a `userId`.
2. Team BYOK keys / OpenAI-compatible connector (Automode or a fixed model,
   subject to the org model policy). A configured local connector wins whenever
   no cloud key exists or the fixed model targets it.
3. Paid tiers: platform-managed key / hosted Anthropic (`ANTHROPIC_API_KEY`).
4. Free tier: platform OpenRouter free pool (`OPENROUTER_API_KEY`), then the
   sponsored promo pool where eligible.
5. Honest `ChatProviderResolutionError` — never a fabricated answer.

Every resolution also returns **provenance**
(`{ provider, modelId, baseUrlOrigin, source }` via
`resolveOrgChatAdapterWithProvenance`) so surfaces can say what answered.
`baseUrlOrigin` is origin-only — the path and key never leave the server.
`source` is one of `org-key | member-key | hosted | sponsored |
local-connector | local-fallback`.

## The quality notice

`classifyModelTier` (packages/agent/src/model-tier.ts) is a pure classifier
over the provenance:

- **frontier** — current flagship families (Claude Opus/Sonnet, GPT-5 /
  GPT-4.1 / GPT-4o class, Gemini Pro class). No notice shown.
- **capable** — hosted mini/flash/haiku-class models. Soft notice: frontier
  models may give deeper answers.
- **small-or-local** — llama/qwen/gemma/phi/mistral-small/deepseek-distill
  families, **and anything served from a localhost/LAN origin** regardless of
  its name. Notice: "Running on `<model>` — a smaller model than Vantage's
  frontier defaults; expect rougher output."
- **unknown** — anything unrecognized. HONESTY RULE: unknown never claims
  degradation; the reason is "custom model — quality depends on what you
  chose."

`degradedNoticeCopy(tier, modelId)` returns the one-liner (null for frontier).
UI-side labeling lives in `apps/web/components/ui/model-provenance-policy.ts`.

## Compliance audit: which features honor the configuration

Method: every `meteredAI` feature id in `apps/web` and `packages` was
enumerated and traced to how it obtains a model. Three resolution paths exist;
only one deliberate exception is not local-capable.

### Path 1 — resolved through `resolveOrgChatAdapter` (works on local: **yes**)

These run entirely on whatever endpoint resolution picks, including a local
connector:

| Feature | Call site | Works on local |
| --- | --- | --- |
| `chat` | `apps/web/app/api/agent/route.ts` | yes |
| `agent` (autonomous) | `apps/web/app/api/agent/autonomous/route.ts` (loop in `packages/agent/src/autonomous-loop.ts` uses the injected adapter) | yes |
| `writer` | `apps/web/app/api/writer/route.ts` (deterministic local fallback when no key at all) | yes |
| `ai_insights` | `apps/web/app/api/ai-insights/route.ts` | yes |
| `explain_step` | `apps/web/app/api/agent-narration/explain/route.ts` | yes |
| `cad` | `apps/web/app/api/cad/route.ts`, `apps/web/lib/cad/run-cad-agent.ts` | yes |
| `coding` (Bugbot subscription) | `apps/web/app/api/code/route.ts` | yes |
| `match_debrief` | `apps/web/app/api/match-debrief/route.ts` | yes |
| `season_report` | `apps/web/app/api/season-report/route.ts` | yes |
| grants assist / grant writing | `apps/web/app/api/grants/assist/route.ts`, `apps/web/app/api/grants/writing/route.ts` | yes |
| `troubleshoot` | `apps/web/lib/troubleshoot/compute-troubleshoot.ts` | yes |
| `performance_digest` | `apps/web/lib/performance-email/run-performance-email.ts` | yes |
| `team_dream` / `team_dream_week` | `apps/web/lib/dreaming/run-dream.ts` | yes |
| `learning_coach` | `apps/web/app/api/learning/predictions/route.ts` | yes |

### Path 2 — speech-to-text through `resolveOrgSttEndpoint` (works on local: **yes, when the endpoint supports audio**)

| Feature | Call site | Works on local |
| --- | --- | --- |
| `scout_voice_stt` | `apps/web/lib/scout-voice/compute-scout-voice.ts` | yes — resolves member/org OpenAI key → OpenAI-compatible base URL → platform `OPENAI_API_KEY`, and POSTs to `<base>/audio/transcriptions` (OpenAI Whisper, LocalAI, faster-whisper-server, Speaches, …). When the configured endpoint lacks audio support (404/405/501) the error says so honestly and the UI degrades to browser speech recognition — a transcript is never fabricated. Local endpoints are metered at $0. |

The STT model comes from the connector's model mappings (`stt` / `transcribe` /
`whisper` keys), defaulting to `whisper-1`.

### Path 3 — deterministic on-server compute (works on local: **yes — no external model at all**)

These features are metered for accounting but their `invoke` runs a
deterministic engine on real team data (`provider: "vantage-local"`, cost $0).
They work identically with no AI key configured and never fabricate data:

`alliance-partner-brief`, `budget_reconciler`, `cad_change_radar`,
`code_perf`, `decision_critic`, `decision_search`, `defense_planner`,
`grant_report_generate`, `impact_essay`, `inspection_copilot`, `judge_sim`,
`knowledge_gap`, `matching_gift_finder`, `media_post_draft`,
`media_kit_one_pager`, `meeting_autopilot`, `mock_judging`,
`onboarding_buddy`, `picklist-justifier`, `pit_repair_triage`,
`prototype_tracker`, `readiness_score`, `retro_postmortem`, `reuse_advisor`,
`rule_impact`, `skills_graph`, `spare_forecast`, `spare_robot_kit`,
`sponsor_renewal_roi`, `sponsor_suite_deck`, `sponsor_suite_roi_report`,
`standup_digest`, `tuning_autopilot`, `wiring_diagnoser`
(each in `apps/web/lib/<feature>/compute-*.ts`).

### Deliberate hosted-only exceptions

| Feature | Why hosted-only | How it's surfaced |
| --- | --- | --- |
| `bugbot_ultra` | Flat-fee hosted SKU: `apps/web/app/api/code/route.ts` resolves with `preferPlatform: true`, which skips org BYOK and local connectors by design and uses Vantage's hosted keys. | The resolver throws an honest `ChatProviderResolutionError` naming the hosted requirement when no platform key exists ("Bugbot Ultra needs a hosted Vantage model … Use subscription Bugbot with your own key instead."), and usage is metered with `keySource: "platform"`. Subscription Bugbot (`coding`) fully honors local/BYOK. |

### Not local-capable but not AI either

The desktop **local relay** (`org_provider_configs.local_relay = true`) cannot
serve hosted web requests; resolution fails with an honest error telling the
team to add an OpenAI-compatible base URL instead.

## Compliance test

`packages/agent/test/local-connector-compliance.test.ts` asserts the matrix:
a single local-connector config (localhost base URL + any key + model mapping)
resolves a usable adapter for chat / writer / agent / dream-class / cad /
code features, the provenance carries `source: "local-connector"` with an
origin-only base URL, a completion actually hits
`<base>/chat/completions`, STT resolves through the same connector, and
`classifyModelTier` flags the localhost origin as `small-or-local`.
