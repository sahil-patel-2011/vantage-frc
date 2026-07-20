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
