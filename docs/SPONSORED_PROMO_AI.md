# Sponsored free / promotional AI (platform keys)

Env var **names** only (set values in Vercel or gitignored `.env.local` — never commit secrets):

- `MISTRAL_API_KEY` — primary free/promo path
- `GROQ_API_KEY` — failover
- `COHERE_API_KEY` — failover
- `CEREBRAS_API_KEY` — last failover (chat may return HTTP 402 payment/quota while models list still works)

**Promo:** FRC team number `1111` only, through **2026-10-18** (`funding_mode` / ledger `key_source=sponsored`, $0 Vantage charge).

**After expiry (AI-only):** Soft-UI banners + in-app `sponsored_promo.expired` notify owners/admins; sponsored Mistral/Groq/Cohere/Cerebras keys stop. Chat/metered AI falls back to BYOK or upgrade messaging. **Dashboard, hubs, membership, Media/Business, and all non-AI features keep working** — the promo date never gates org access.

**Routing:** `resolveOrgChatAdapter` → sponsored failover pool (Mistral → Groq → Cohere → Cerebras on 429/402/quota) → `meteredAI` records `sponsored`.
