# Sponsored free / promotional AI (platform keys)

Env var **names** only (set values in Vercel or gitignored `.env.local` — never commit secrets):

- `MISTRAL_API_KEY` — primary free/promo path
- `CEREBRAS_API_KEY` — failover
- `GROQ_API_KEY` — failover
- `COHERE_API_KEY` — failover

**Promo:** FRC team number `1111` only, through **2026-10-18** (`funding_mode` / ledger `key_source=sponsored`, $0 Vantage charge). After expiry, Soft-UI banners + in-app `sponsored_promo.expired` notify owners/admins; AI falls back to BYOK.

**Routing:** `resolveOrgChatAdapter` → sponsored failover pool (Mistral → Cerebras → Groq → Cohere on 429/quota) → `meteredAI` records `sponsored`.
