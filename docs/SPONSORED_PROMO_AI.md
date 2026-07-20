# Sponsored free / promotional AI (platform keys)

Env var **names** only (set values in Vercel or gitignored `.env.local` — never commit secrets):

- `MISTRAL_API_KEY` — weighted free/promo path (weight **2**)
- `GROQ_API_KEY` — weighted pool member (weight **1**)
- `COHERE_API_KEY` — weighted pool member (weight **1**)
- `CEREBRAS_API_KEY` — weighted pool member (weight **1**; chat may return HTTP 402 payment/quota while models list still works)

**Promo:** FRC team number `1111` only, through **2026-10-18** (`funding_mode` / ledger `key_source=sponsored`, $0 Vantage charge).

**After expiry (AI-only):** Soft-UI banners + in-app `sponsored_promo.expired` notify owners/admins; sponsored Mistral/Groq/Cohere/Cerebras keys stop. Chat/metered AI falls back to BYOK or upgrade messaging. **Dashboard, hubs, membership, Media/Business, and all non-AI features keep working** — the promo date never gates org access.

**Routing:** `resolveOrgChatAdapter` → sponsored failover pool → `meteredAI` records `sponsored`.

**Balancing (weighted round-robin):** Each request advances an in-memory cursor and picks a primary from a weight wheel (`mistral×2`, `groq×1`, `cohere×1`, `cerebras×1` among configured keys). With all four keys present, first attempts land ~40% Mistral / ~20% each other provider — not fixed Mistral-first drain. On 429/402/503 (and similar quota/capacity failures), the same request walks the remaining unique providers in that wheel order and never retries a provider that already failed in the chain. Cursor is process-local (Hobby-friendly; resets on cold start).

**Health / degraded TTL:** After a 402/429/503, that provider is marked degraded for ~5 minutes and moved to last-resort (not chosen as primary). Cerebras chat often returns 402 while models list still works — the pool keeps serving from Mistral/Groq/Cohere.

**Models (smoke-tested pins):** `mistral-small-latest`, `llama-3.1-8b-instant` (Groq), `command-r-08-2024` (Cohere dated id), `llama3.1-8b` (Cerebras). Soft-UI `/api/organizations/sponsored-promo` returns masked pool status (configured providers + balancing note — never key values).

**Prompts:** Sponsored and normal HttpChatAdapter paths share `buildVantageChatSystemPrompt` + org session context injection (team number, org name, active event/season, funding flags). Failover reuses the same message/context — it does not strip system instructions.
