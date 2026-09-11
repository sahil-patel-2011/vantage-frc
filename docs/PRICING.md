# Vantage pricing ladder

*For operators enabling billing, and anyone asking what a plan includes. Last updated 2026-08-24.*

Effective 2026-08-24 (migration `0481_pricing_ladder.sql`, catalog `packages/billing/src/catalog.ts`).

## The model in one paragraph

**Every feature ships on every plan, including Free.** Nothing on Vantage is feature-gated by
plan — no locked hubs, no tiered strategy depth by entitlement snapshot, no plan-only tools.
Plans differ **only** in how much *hosted* AI usage is included. BYOK and local models are
available on every plan and are unlimited by Vantage (you pay your provider directly).

## The four plans

| Plan | Price / mo | Hosted AI allowance | Allowance runs on |
| ---- | ---------- | ------------------- | ----------------- |
| Free | $0   | $3  | Budget-class models (sponsored pool / OpenRouter free router) |
| Pro  | $20  | $12 | Frontier models (hosted platform path) |
| Pro+ | $60  | $40 | Frontier models |
| Max  | $100 | $70 | Frontier models |

- All paid plans are **team-wide** (org-scoped billing owner) — there is no separate individual track.
- The **7-day team trial** remains: admin-granted, $15 hosted allowance, no auto-charge.
- Hosted usage debits at **0.75× typical provider list** (~25% cheaper than the same call on
  your own key). When an allowance is exhausted, usage **hard-stops**: buy credit packs, enable
  PAYG with an explicit spend cap, or keep working on BYOK/local. There is never silent overage.

### Why those allowance numbers

At the 0.75× debit, $70 of Max credits covers ≈ $93 of provider list usage; with wholesale
capacity ≈ 0.5× list, worst-case provider cost is ≈ $47 on a $100 plan. Allowances sit at
60–70% of price on every paid rung so a fully-drained month still covers Stripe fees
(2.9% + $0.30), the $2 infra allocation, and the 5% support reserve enforced by the
`plan_margin_guard` trigger — without depending on breakage. Free's $3 is a sponsored,
budget-class pool (never billed to the team) with its own rate/concurrency guardrails.

## BYOK / local — on every plan, including Free

Any provider key: **OpenAI, Anthropic, Google AI Studio, OpenRouter, Groq, Mistral**, or any
OpenAI-compatible endpoint; local endpoints via **Ollama / LM Studio** (or the desktop relay).
Configured at `/team/ai-keys`. BYOK/local calls are metered for visibility (`key_source =
byo/local`, `cost_usd = 0` for local) but never debited by Vantage.

## What Free's hosted allowance actually routes to

Only providers that are really wired (see `packages/agent/src/sponsored-provider-pool.ts` and
`hosted-platform-keys.ts`): Mistral Small, Groq Llama 3.1 8B, Cohere Command R, Cerebras
Llama 3.1 — plus OpenRouter's free-model router when `OPENROUTER_API_KEY` is set. Never
frontier models; the pricing page says so explicitly.

## Legacy plan codes and the 0481 remap

Old codes were: Free $0 · Access $69 · Individual Pro $109 · Individual Max $159 ·
Team Pro $299 · Team Max $549. Migration `0481_pricing_ladder.sql` remaps org rows:

| Legacy code | New code |
| ----------- | -------- |
| `free` | `free` |
| `access`, `individual_pro`, `individual_max` | `pro` |
| `team_pro` | `pro_plus` |
| `team_max` | `max` |

Details:

- `org_entitlements` and `org_plan_periods` are remapped in place; in-flight periods keep their
  snapshotted allowance (e.g. Team Pro's $225) until renewal — teams keep what they were sold.
- `billing_subscriptions` / `trial_grants` keep legacy codes (they mirror Stripe contracts and
  terms snapshots); legacy `pricing_plans` rows stay present but `active = false`, so FKs hold
  and legacy codes cannot be checked out.
- In code, `LEGACY_PLAN_CODE_MAP` / `canonicalPlanCode()` (`@vantage/billing/catalog`) resolve
  any stored legacy code to its ladder rung; `PRICING_CATALOG.team_pro` etc. alias the live plan.

## Stripe checklist for going live

1. Create three new monthly Prices in the Stripe Dashboard: Pro $20, Pro+ $60, Max $100.
2. Set `pricing_plans.stripe_price_id` for `pro` / `pro_plus` / `max` via the admin surface —
   checkout refuses plans without a configured Price ID.
3. Migrate existing Stripe subscriptions to the new Prices (or leave them until renewal);
   subscription metadata `planCode` on old subs still resolves through the legacy aliases.
4. Credit packs and PAYG enrollment are unchanged.

## Invariants (tested in `packages/billing/test/pricing.test.ts`)

- Four rungs, monotonic in both price and allowance; every paid allowance < its price.
- Legacy aliases map exactly per the table above.
- The catalog copy commits to "everything on every plan", names only real BYOK/local providers,
  and is honest that Free's hosted allowance is budget-class.
